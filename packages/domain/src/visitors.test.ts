import { describe, expect, it } from 'vitest';
import * as C from '@oneresi/contracts';
import { visitorsService } from './visitors.js';
import type { Clock } from './clock.js';
import type {
  NewVisitorLog,
  NewVisitorPass,
  OutboxEventInput,
  RateLimiter,
  RateLimitVerdict,
  StoredHome,
  StoredVisitorEntry,
  StoredVisitorLog,
  StoredVisitorPass,
  VisitorStore,
} from './store.js';
import type {
  Actor,
  GateDecision,
  RequestMeta,
  Result,
  VisitorsService,
  WaitingVisitorView,
  SocietyWaitingVisitorView,
} from './ports.js';

/**
 * The visitors service, exercised against fakes that implement the store seam. Every gate rule
 * the defect register asked for has a test here: what the kiosk is told (a decision, never a
 * row), what a retried check-in costs (nothing, and no second row), what a guard's override
 * carries (its reason and its author), and what the six-digit code space is worth (a rate
 * window that counts the misses).
 *
 * The clock is mutable, so "today" is tested by moving a hand — not by faking the global timer.
 */

// ---------------------------------------------------------------- fakes

/** Time under the test's control. `now()` always returns the same instant until it is moved. */
class MutableClock implements Clock {
  #now: Date;
  constructor(iso: string) {
    this.#now = new Date(iso);
  }
  now(): Date {
    return this.#now;
  }
  advanceMs(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}

/** Counting only. The window never rolls over inside a test; each case gets a fresh one. */
class MemoryLimiter implements RateLimiter {
  readonly counts = new Map<string, number>();
  consume(
    key: string,
    limit: { attempts: number; windowSeconds: number },
  ): Promise<RateLimitVerdict> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return Promise.resolve({
      allowed: count <= limit.attempts,
      retryAfterSeconds: limit.windowSeconds,
    });
  }
  clear(key: string): Promise<void> {
    this.counts.delete(key);
    return Promise.resolve();
  }
}

interface PassRow {
  id: number;
  unitId: number;
  createdById: number;
  createdByName: string;
  visitorName: string;
  purpose: string;
  code: string;
  validOn: Date;
  status: C.PassStatus;
  createdAt: Date;
  enteredAt: Date | null;
  exitedAt: Date | null;
}

interface LogRow {
  id: number;
  passId: number | null;
  unitId: number;
  walkInName: string | null;
  walkInPhone: string | null;
  walkInPurpose: string | null;
  approvalStatus: C.ApprovalStatus;
  decidedById: number | null;
  decidedAt: Date | null;
  overrideReason: string | null;
  enteredAt: Date | null;
  exitedAt: Date | null;
  createdAt: Date;
}

/** An in-memory VisitorStore: the same contract the db package will implement, minus SQL. */
class MemoryVisitorStore implements VisitorStore {
  private nextPassId = 1;
  private nextLogId = 1;
  readonly passes: PassRow[] = [];
  readonly logs: LogRow[] = [];
  readonly outbox: OutboxEventInput[] = [];
  /** Test hooks: simulate the guarded transitions losing a race. */
  rejectNextCodes = 0;
  forceNextCancelNull = false;
  forceNextCheckInNull = false;
  forceNextDecideNull = false;
  /** The last idempotency key recordEntry handed down, for the retry test. */
  lastIdempotencyKey: string | null = null;

  // ---- seeding, test-only

  seedBlock(name: string, active = true): number {
    const id = this.blocks.length + 1;
    this.blocks.push({ id, name, floors: 1, active });
    return id;
  }

  seedUnit(blockId: number, label: string, active = true): number {
    const unitId = this.units.length + 1;
    this.units.push({ unitId, blockId, label, active });
    return unitId;
  }

  seedResident(unitId: number, name: string, email: string, active = true): number {
    const id = this.residents.length + 1;
    this.residents.push({ id, unitId, name, email, active });
    return id;
  }

  seedPass(row: Omit<PassRow, 'id' | 'createdAt' | 'enteredAt' | 'exitedAt'>): PassRow {
    const pass: PassRow = {
      ...row,
      id: this.nextPassId++,
      createdAt: new Date('2026-09-01T09:00:00Z'),
      enteredAt: null,
      exitedAt: null,
    };
    this.passes.push(pass);
    return pass;
  }

  seedLog(row: Omit<LogRow, 'id' | 'createdAt'>): LogRow {
    const log: LogRow = { ...row, id: this.nextLogId++, createdAt: new Date('2026-09-08T09:00:00Z') };
    this.logs.push(log);
    return log;
  }

  // ---- lookups

  private homeFor(unitId: number): StoredHome | null {
    const unit = this.units.find((u) => u.unitId === unitId);
    const block = unit === undefined ? undefined : this.blocks.find((b) => b.id === unit.blockId);
    if (unit === undefined || block === undefined) return null;
    return {
      unitId,
      blockId: block.id,
      blockName: block.name,
      label: unit.label,
      type: 'FLAT_2BHK',
      monthlyChargePaise: C.paise(250_000),
      active: unit.active,
    };
  }

  findHome(unitId: number): Promise<StoredHome | null> {
    return Promise.resolve(this.homeFor(unitId));
  }

  findResidentsForUnit(
    unitId: number,
  ): Promise<readonly { id: number; name: string; email: string }[]> {
    return Promise.resolve(
      this.residents.filter((r) => r.unitId === unitId && r.active).map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
      })),
    );
  }

  private snapshotPass(pass: PassRow): StoredVisitorPass {
    return { ...pass };
  }

  findPassByCode(code: string): Promise<StoredVisitorPass | null> {
    const pass = this.passes.find((p) => p.code === code);
    return Promise.resolve(pass === undefined ? null : this.snapshotPass(pass));
  }

  findPassById(id: number): Promise<StoredVisitorPass | null> {
    const pass = this.passes.find((p) => p.id === id);
    return Promise.resolve(pass === undefined ? null : this.snapshotPass(pass));
  }

  findPassesForUnit(
    unitId: number,
    filter: { validOn?: Date; statuses?: readonly C.PassStatus[] },
  ): Promise<readonly StoredVisitorPass[]> {
    return Promise.resolve(
      this.passes
        .filter((p) => p.unitId === unitId)
        .filter((p) => filter.validOn === undefined || p.validOn.getTime() === filter.validOn.getTime())
        .filter((p) => filter.statuses === undefined || filter.statuses.includes(p.status))
        .map((p) => this.snapshotPass(p)),
    );
  }

  // ---- writes (each one is "a transaction" in the real store)

  createPass(
    input: NewVisitorPass,
    events: readonly OutboxEventInput[],
  ): Promise<StoredVisitorPass | null> {
    if (this.rejectNextCodes > 0) {
      this.rejectNextCodes -= 1;
      return Promise.resolve(null);
    }
    if (this.passes.some((p) => p.code === input.code)) return Promise.resolve(null);
    const creator = this.residents.find((r) => r.id === input.createdById);
    const pass: PassRow = {
      id: this.nextPassId++,
      unitId: input.unitId,
      createdById: input.createdById,
      createdByName: creator === undefined ? '' : creator.name,
      visitorName: input.visitorName,
      purpose: input.purpose,
      code: input.code,
      validOn: input.validOn,
      status: 'ACTIVE',
      createdAt: input.createdAt,
      enteredAt: null,
      exitedAt: null,
    };
    this.passes.push(pass);
    this.outbox.push(...events);
    return Promise.resolve(this.snapshotPass(pass));
  }

  cancelPass(
    id: number,
    cancelledAt: Date,
    events: readonly OutboxEventInput[],
  ): Promise<StoredVisitorPass | null> {
    if (this.forceNextCancelNull) {
      this.forceNextCancelNull = false;
      return Promise.resolve(null);
    }
    const pass = this.passes.find((p) => p.id === id);
    if (pass === undefined || pass.status !== 'ACTIVE') return Promise.resolve(null);
    pass.status = 'CANCELLED';
    void cancelledAt;
    this.outbox.push(...events);
    return Promise.resolve(this.snapshotPass(pass));
  }

  checkInPass(
    input: { passId: number; at: Date; idempotencyKey: string | null },
    log: NewVisitorLog,
    events: readonly OutboxEventInput[],
  ): Promise<StoredVisitorPass | null> {
    if (this.forceNextCheckInNull) {
      this.forceNextCheckInNull = false;
      return Promise.resolve(null);
    }
    const pass = this.passes.find((p) => p.id === input.passId);
    if (pass === undefined || pass.status !== 'ACTIVE') return Promise.resolve(null);
    this.lastIdempotencyKey = input.idempotencyKey;
    pass.status = 'USED';
    pass.enteredAt = input.at;
    this.logs.push({
      id: this.nextLogId++,
      passId: log.passId,
      unitId: log.unitId,
      walkInName: log.walkInName,
      walkInPhone: log.walkInPhone,
      walkInPurpose: log.walkInPurpose,
      approvalStatus: log.approvalStatus,
      decidedById: log.decidedById,
      decidedAt: log.decidedAt,
      overrideReason: log.overrideReason,
      enteredAt: log.enteredAt,
      exitedAt: null,
      createdAt: log.createdAt,
    });
    this.outbox.push(...events);
    return Promise.resolve(this.snapshotPass(pass));
  }

  checkOutPass(passId: number, at: Date): Promise<StoredVisitorLog | null> {
    const log = this.logs.find(
      (l) => l.passId === passId && l.enteredAt !== null && l.exitedAt === null,
    );
    if (log === undefined) return Promise.resolve(null);
    log.exitedAt = at;
    // The real store joins the log into the pass view, so the pass carries the exit too.
    const pass = this.passes.find((p) => p.id === passId);
    if (pass !== undefined) pass.exitedAt = at;
    return Promise.resolve({ ...log });
  }

  createWalkInLog(input: NewVisitorLog, events: readonly OutboxEventInput[]): Promise<StoredVisitorLog> {
    const log: LogRow = { ...input, id: this.nextLogId++, exitedAt: null };
    this.logs.push(log);
    this.outbox.push(...events);
    return Promise.resolve({ ...log });
  }

  findLogById(id: number): Promise<StoredVisitorLog | null> {
    const log = this.logs.find((l) => l.id === id);
    return Promise.resolve(log === undefined ? null : { ...log });
  }

  findPendingWalkIns(unitId: number): Promise<readonly StoredVisitorLog[]> {
    return Promise.resolve(
      this.logs
        .filter((l) => l.unitId === unitId && l.approvalStatus === 'PENDING')
        .map((l) => ({ ...l })),
    );
  }

  findPendingWalkInsForSociety(): Promise<readonly (StoredVisitorLog & { home: StoredHome })[]> {
    return Promise.resolve(
      this.logs
        .filter((l) => l.approvalStatus === 'PENDING')
        .map((l) => {
          const home = this.homeFor(l.unitId);
          if (home === null) throw new Error(`test seed: unit ${l.unitId} has no home`);
          return { ...l, home };
        }),
    );
  }

  findLogsForUnit(unitId: number, limit: number): Promise<readonly StoredVisitorEntry[]> {
    // The feed: newest first, joined the way the adapter joins — a pass entry names its visitor
    // from the pass, a walk-in's decision names the person who made it.
    const ordered = [...this.logs]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
      .filter((l) => l.unitId === unitId)
      .slice(0, limit);
    return Promise.resolve(
      ordered.map((log) => {
        const pass = log.passId === null ? undefined : this.passes.find((p) => p.id === log.passId);
        const decider =
          log.decidedById === null
            ? undefined
            : this.residents.find((r) => r.id === log.decidedById);
        return {
          logId: log.id,
          kind: log.passId === null ? ('WALK_IN' as const) : ('PASS' as const),
          visitorName: log.walkInName ?? pass?.visitorName ?? '',
          purpose: log.walkInPurpose ?? pass?.purpose ?? '',
          approvalStatus: log.approvalStatus,
          decidedByName: decider?.name ?? null,
          overrideReason: log.overrideReason,
          enteredAt: log.enteredAt,
          exitedAt: log.exitedAt,
          createdAt: log.createdAt,
        };
      }),
    );
  }

  findLogsForSociety(
    limit: number,
  ): Promise<readonly (import('./store.js').StoredVisitorEntry & { home: import('./store.js').StoredHome })[]> {
    // The society feed, the same mapping with every unit's home joined.
    const ordered = [...this.logs]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
      .slice(0, limit);
    return Promise.resolve(
      ordered.flatMap((log) => {
        const home = this.homeFor(log.unitId);
        if (home === null) return [];
        const pass = log.passId === null ? undefined : this.passes.find((p) => p.id === log.passId);
        const decider =
          log.decidedById === null
            ? undefined
            : this.residents.find((r) => r.id === log.decidedById);
        return [
          {
            logId: log.id,
            kind: log.passId === null ? ('WALK_IN' as const) : ('PASS' as const),
            visitorName: log.walkInName ?? pass?.visitorName ?? '',
            purpose: log.walkInPurpose ?? pass?.purpose ?? '',
            approvalStatus: log.approvalStatus,
            decidedByName: decider?.name ?? null,
            overrideReason: log.overrideReason,
            enteredAt: log.enteredAt,
            exitedAt: log.exitedAt,
            createdAt: log.createdAt,
            home,
          },
        ];
      }),
    );
  }

  decideWalkInLog(
    input: {
      logId: number;
      approvalStatus: 'APPROVED' | 'REJECTED';
      decidedById: number;
      decidedAt: Date;
    },
    events: readonly OutboxEventInput[],
  ): Promise<StoredVisitorLog | null> {
    if (this.forceNextDecideNull) {
      this.forceNextDecideNull = false;
      return Promise.resolve(null);
    }
    const log = this.logs.find((l) => l.id === input.logId);
    if (log === undefined || log.approvalStatus !== 'PENDING') return Promise.resolve(null);
    log.approvalStatus = input.approvalStatus;
    log.decidedById = input.decidedById;
    log.decidedAt = input.decidedAt;
    this.outbox.push(...events);
    return Promise.resolve({ ...log });
  }

  // residents/blocks/units back the seed helpers; the tests read residents to build actors
  readonly blocks: { id: number; name: string; floors: number; active: boolean }[] = [];
  readonly units: { unitId: number; blockId: number; label: string; active: boolean }[] = [];
  readonly residents: {
    id: number;
    unitId: number;
    name: string;
    email: string;
    active: boolean;
  }[] = [];
}

// ---------------------------------------------------------------- harness

interface Harness {
  service: VisitorsService;
  store: MemoryVisitorStore;
  limiter: MemoryLimiter;
  clock: MutableClock;
}

function harness(): Harness {
  const clock = new MutableClock('2026-09-08T09:00:00Z');
  const store = new MemoryVisitorStore();
  const limiter = new MemoryLimiter();
  const service = visitorsService({ store, limiter, clock });
  return { service, store, limiter, clock };
}

const META: RequestMeta = { ip: '203.0.113.9', userAgent: 'kiosk', correlationId: 'corr-1' };

function residentActor(store: MemoryVisitorStore, unitId: number): Actor {
  const resident = store.residents.find((r) => r.unitId === unitId);
  if (resident === undefined) throw new Error(`no resident for unit ${unitId}`);
  return {
    userId: resident.id,
    name: resident.name,
    role: 'R',
    unitId,
    email: resident.email,
  };
}

const GUARD: Actor = {
  userId: 901,
  name: 'Main Gate',
  role: 'S',
  unitId: null,
  email: 'ashvin.ks2024@vitstudent.ac.in',
};

/**
 * A seeded household: Brindavan B-101 with two ACTIVE residents (plus one on another unit, to
 * prove nothing leaks across homes) and one pass already valid today.
 */
function seededWorld(store: MemoryVisitorStore): {
  unitId: number;
  otherUnitId: number;
  pass: PassRow;
} {
  const blockId = store.seedBlock('Brindavan');
  const unitId = store.seedUnit(blockId, 'B-101');
  const otherUnitId = store.seedUnit(blockId, 'B-102');
  const asha = store.seedResident(unitId, 'Asha Rao', 'asha@example.com');
  store.seedResident(unitId, 'Vikram Rao', 'vikram@example.com');
  store.seedResident(otherUnitId, 'Priya Sharma', 'priya@example.com');
  const pass = store.seedPass({
    unitId,
    createdById: asha,
    createdByName: 'Asha Rao',
    visitorName: 'Ravi Kumar',
    purpose: 'Family visit',
    code: '123456',
    validOn: new Date('2026-09-08T00:00:00.000Z'),
    status: 'ACTIVE',
  });
  return { unitId, otherUnitId, pass };
}

const expectError = async <T>(
  result: Promise<Result<T>>,
  code: string,
): Promise<{ code: string; message: string; field?: string }> => {
  const settled = await result;
  if (settled.ok) throw new Error('expected a failure, got a value');
  expect(settled.error.code).toBe(code);
  return settled.error;
};

/** Unwraps a result or fails the test with the error's code and message. */
async function expectOk<T>(result: Promise<Result<T>>): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw new Error(`expected a value, got ${settled.error.code}`);
  return settled.value;
}

// ---------------------------------------------------------------- tests

describe('issuePass', () => {
  it('issues a pass for today with a six-digit code, and notes it in-app', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const input = C.CreatePassInput.parse({
      visitorName: 'Ravi Kumar',
      purpose: 'Family visit',
      validDate: '2026-09-08',
    });

    const pass = await expectOk(world.service.issuePass(residentActor(world.store, unitId), input));

    expect(pass.code).toMatch(/^\d{6}$/);
    expect(pass.validOn).toEqual(new Date('2026-09-08T00:00:00.000Z'));
    expect(pass.status).toBe('ACTIVE');
    expect(pass.arrivedAt).toBeNull();
    expect(world.store.outbox).toEqual([
      expect.objectContaining({
        type: 'pass.created',
        channel: 'IN_APP',
        payload: expect.objectContaining({ visitorName: 'Ravi Kumar', purpose: 'Family visit' }),
      }),
      expect.objectContaining({
        type: 'pass.created',
        channel: 'PUSH',
        payload: expect.objectContaining({ visitorName: 'Ravi Kumar', purpose: 'Family visit' }),
      }),
    ]);
  });

  it('refuses a date in the past — a pass valid last week was once accepted (D-72)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const input = C.CreatePassInput.parse({
      visitorName: 'Ravi Kumar',
      purpose: 'Family visit',
      validDate: '2026-09-07',
    });

    const error = await expectError(
      world.service.issuePass(residentActor(world.store, unitId), input),
      'INVALID_INPUT',
    );
    expect(error.field).toBe('validDate');
    expect(error.message).toBe('Choose today or a later date.');
  });

  it('accepts the last day of the lead window and refuses the day after (D-72)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const actor = residentActor(world.store, unitId);
    const atEdge = C.CreatePassInput.parse({
      visitorName: 'Ravi Kumar',
      purpose: 'Family visit',
      validDate: '2026-10-08',
    });
    const pastEdge = C.CreatePassInput.parse({
      visitorName: 'Ravi Kumar',
      purpose: 'Family visit',
      validDate: '2026-10-09',
    });

    const edge = await expectOk(world.service.issuePass(actor, atEdge));
    expect(edge.validOn).toEqual(new Date('2026-10-08T00:00:00.000Z'));

    const error = await expectError(world.service.issuePass(actor, pastEdge), 'INVALID_INPUT');
    expect(error.message).toBe('A pass can be issued at most 30 days ahead.');
  });

  it('refuses anyone without a home to issue for', async () => {
    const world = harness();
    seededWorld(world.store);
    const input = C.CreatePassInput.parse({
      visitorName: 'Ravi Kumar',
      purpose: 'Family visit',
      validDate: '2026-09-08',
    });

    await expectError(world.service.issuePass(GUARD, input), 'FORBIDDEN');
  });

  it('answers a taken code with a fresh code, and gives up after a streak', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const input = C.CreatePassInput.parse({
      visitorName: 'Ravi Kumar',
      purpose: 'Family visit',
      validDate: '2026-09-08',
    });
    const actor = residentActor(world.store, unitId);

    world.store.rejectNextCodes = 2;
    const pass = await expectOk(world.service.issuePass(actor, input));
    expect(pass.code).toMatch(/^\d{6}$/);

    world.store.rejectNextCodes = 5;
    await expectError(world.service.issuePass(actor, input), 'INVALID_INPUT');
  });
});

describe('cancelPass', () => {
  it('cancels an active pass of the household', async () => {
    const world = harness();
    const { unitId, pass } = seededWorld(world.store);

    const cancelled = await expectOk(
      world.service.cancelPass(residentActor(world.store, unitId), pass.id),
    );

    expect(cancelled.status).toBe('CANCELLED');
    expect(world.store.passes.find((p) => p.id === pass.id)?.status).toBe('CANCELLED');
  });

  it('treats another household\'s pass as missing, and a used pass as unchangeable', async () => {
    const world = harness();
    const { unitId, otherUnitId, pass } = seededWorld(world.store);

    await expectError(
      world.service.cancelPass(residentActor(world.store, otherUnitId), pass.id),
      'NOT_FOUND',
    );

    const used = world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'Nani',
      purpose: 'Lunch',
      code: '654321',
      validOn: new Date('2026-09-08T00:00:00.000Z'),
      status: 'USED',
    });
    await expectError(world.service.cancelPass(residentActor(world.store, unitId), used.id), 'STATE_NOT_ALLOWED');
  });

  it('reports a race lost between the check and the transition as a rule, not a crash', async () => {
    const world = harness();
    const { unitId, pass } = seededWorld(world.store);
    world.store.forceNextCancelNull = true;

    await expectError(
      world.service.cancelPass(residentActor(world.store, unitId), pass.id),
      'STATE_NOT_ALLOWED',
    );
  });
});

describe('passesForHousehold and expectedToday', () => {
  it('lists only the household\'s passes', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);

    const passes = await expectOk(
      world.service.passesForHousehold(residentActor(world.store, unitId)),
    );

    expect(passes).toHaveLength(1);
    expect(passes[0]?.visitorName).toBe('Ravi Kumar');
  });

  it('expects today\'s active and used passes, and nothing else', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'Nani',
      purpose: 'Lunch',
      code: '111111',
      validOn: new Date('2026-09-08T00:00:00.000Z'),
      status: 'USED',
    });
    world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'Cousin',
      purpose: 'Dinner',
      code: '222222',
      validOn: new Date('2026-09-08T00:00:00.000Z'),
      status: 'CANCELLED',
    });
    world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'Tomorrow\'s guest',
      purpose: 'Delivery',
      code: '333333',
      validOn: new Date('2026-09-09T00:00:00.000Z'),
      status: 'ACTIVE',
    });

    const expected = await expectOk(
      world.service.expectedToday(residentActor(world.store, unitId)),
    );

    expect(expected.map((p) => p.visitorName).sort()).toEqual(['Nani', 'Ravi Kumar']);
    const arrived = expected.find((p) => p.visitorName === 'Nani');
    expect(arrived?.status).toBe('USED');
  });

  it('refuses anyone without a home', async () => {
    const world = harness();
    seededWorld(world.store);
    await expectError(world.service.passesForHousehold(GUARD), 'FORBIDDEN');
    await expectError(world.service.expectedToday(GUARD), 'FORBIDDEN');
  });
});

describe('verifyCode', () => {
  it('admits a valid pass with a destination and a host, never a row (D-40)', async () => {
    const world = harness();
    const { pass } = seededWorld(world.store);

    const decision: GateDecision = await expectOk(
      world.service.verifyCode(GUARD, C.VerifyPassInput.parse({ code: pass.code }), META),
    );

    expect(decision).toEqual({
      verdict: 'ADMIT',
      passId: pass.id,
      visitorName: 'Ravi Kumar',
      purpose: 'Family visit',
      destination: 'Brindavan · B-101',
      hostName: 'Asha Rao',
    });
  });

  it('refuses an unknown code without revealing anything', async () => {
    const world = harness();
    seededWorld(world.store);

    const decision = await expectOk(
      world.service.verifyCode(GUARD, C.VerifyPassInput.parse({ code: '000000' }), META),
    );

    expect(decision).toEqual({ verdict: 'REFUSE', reason: 'NOT_FOUND' });
  });

  it('refuses a cancelled, expired, or already-used pass, and a pass for another day', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const cancelled = world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'A',
      purpose: 'Visit',
      code: '100001',
      validOn: new Date('2026-09-08T00:00:00.000Z'),
      status: 'CANCELLED',
    });
    const expired = world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'B',
      purpose: 'Visit',
      code: '100002',
      validOn: new Date('2026-09-08T00:00:00.000Z'),
      status: 'EXPIRED',
    });
    const used = world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'C',
      purpose: 'Visit',
      code: '100003',
      validOn: new Date('2026-09-08T00:00:00.000Z'),
      status: 'USED',
    });
    const yesterday = world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'D',
      purpose: 'Visit',
      code: '100004',
      validOn: new Date('2026-09-07T00:00:00.000Z'),
      status: 'ACTIVE',
    });
    const tomorrow = world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'E',
      purpose: 'Visit',
      code: '100005',
      validOn: new Date('2026-09-09T00:00:00.000Z'),
      status: 'ACTIVE',
    });

    const reasons = await Promise.all(
      [cancelled, expired, used, yesterday, tomorrow].map((pass) =>
        expectOk(world.service.verifyCode(GUARD, C.VerifyPassInput.parse({ code: pass.code }), META)),
      ),
    );

    expect(reasons).toEqual([
      { verdict: 'REFUSE', reason: 'CANCELLED' },
      { verdict: 'REFUSE', reason: 'EXPIRED' },
      { verdict: 'REFUSE', reason: 'ALREADY_USED' },
      { verdict: 'REFUSE', reason: 'WRONG_DAY' },
      { verdict: 'REFUSE', reason: 'WRONG_DAY' },
    ]);
  });

  it('refuses anyone but the gate', async () => {
    const world = harness();
    const { unitId, pass } = seededWorld(world.store);

    await expectError(
      world.service.verifyCode(
        residentActor(world.store, unitId),
        C.VerifyPassInput.parse({ code: pass.code }),
        META,
      ),
      'FORBIDDEN',
    );
  });

  it('throttles the 31st check from one source, misses included, and only that source', async () => {
    const world = harness();
    seededWorld(world.store);
    const input = C.VerifyPassInput.parse({ code: '000000' });
    const otherIp: RequestMeta = { ...META, ip: '203.0.113.10' };

    const misses = await Promise.all(
      Array.from({ length: C.RATE_LIMITS.gateVerify.attempts }, () =>
        expectOk(world.service.verifyCode(GUARD, input, META)),
      ),
    );
    expect(misses).toHaveLength(C.RATE_LIMITS.gateVerify.attempts);
    expect(misses[misses.length - 1]).toEqual({ verdict: 'REFUSE', reason: 'NOT_FOUND' });

    await expectError(world.service.verifyCode(GUARD, input, META), 'RATE_LIMITED');

    // Another kiosk is another window; the gate itself is never a single point of lockout.
    const decision = await expectOk(world.service.verifyCode(GUARD, input, otherIp));
    expect(decision).toEqual({ verdict: 'REFUSE', reason: 'NOT_FOUND' });
  });
});

describe('recordEntry', () => {
  it('checks a valid pass in: the guarded USED transition, one log row, in-app arrival notes', async () => {
    const world = harness();
    const { unitId, pass } = seededWorld(world.store);
    const key = C.idempotencyKey();

    const result = await world.service.recordEntry(
      GUARD,
      C.RecordEntryInput.parse({ passId: pass.id, action: 'CHECK_IN', idempotencyKey: key }),
    );

    expect(result.ok).toBe(true);
    expect(world.store.passes.find((p) => p.id === pass.id)?.status).toBe('USED');
    expect(world.store.logs).toHaveLength(1);
    expect(world.store.logs[0]).toMatchObject({
      passId: pass.id,
      unitId,
      approvalStatus: 'NOT_REQUIRED',
      enteredAt: new Date('2026-09-08T09:00:00Z'),
      exitedAt: null,
    });
    expect(world.store.lastIdempotencyKey).toBe(key);
    // One in-app note and one push per ACTIVE resident of the home (D-29).
    expect(world.store.outbox).toHaveLength(4);
    expect(world.store.outbox.every((e) => e.type === 'visitor.arrived')).toBe(true);
    expect(world.store.outbox.filter((e) => e.channel === 'IN_APP')).toHaveLength(2);
    expect(world.store.outbox.filter((e) => e.channel === 'PUSH')).toHaveLength(2);
  });

  it('treats a retried check-in as a success with still one log row (D-40)', async () => {
    const world = harness();
    const { pass } = seededWorld(world.store);
    const first = await world.service.recordEntry(
      GUARD,
      C.RecordEntryInput.parse({ passId: pass.id, action: 'CHECK_IN' }),
    );
    const second = await world.service.recordEntry(
      GUARD,
      C.RecordEntryInput.parse({ passId: pass.id, action: 'CHECK_IN' }),
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(world.store.logs).toHaveLength(1);
  });

  it('refuses a check-in for the wrong day, a cancelled pass, and a lost race', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const yesterday = world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'D',
      purpose: 'Visit',
      code: '200004',
      validOn: new Date('2026-09-07T00:00:00.000Z'),
      status: 'ACTIVE',
    });
    const cancelled = world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'A',
      purpose: 'Visit',
      code: '200001',
      validOn: new Date('2026-09-08T00:00:00.000Z'),
      status: 'CANCELLED',
    });
    const racer = world.store.seedPass({
      unitId,
      createdById: 1,
      createdByName: 'Asha Rao',
      visitorName: 'F',
      purpose: 'Visit',
      code: '200006',
      validOn: new Date('2026-09-08T00:00:00.000Z'),
      status: 'ACTIVE',
    });

    await expectError(
      world.service.recordEntry(GUARD, C.RecordEntryInput.parse({ passId: yesterday.id, action: 'CHECK_IN' })),
      'STATE_NOT_ALLOWED',
    );
    await expectError(
      world.service.recordEntry(GUARD, C.RecordEntryInput.parse({ passId: cancelled.id, action: 'CHECK_IN' })),
      'STATE_NOT_ALLOWED',
    );
    world.store.forceNextCheckInNull = true;
    await expectError(
      world.service.recordEntry(GUARD, C.RecordEntryInput.parse({ passId: racer.id, action: 'CHECK_IN' })),
      'STATE_NOT_ALLOWED',
    );
  });

  it('checks out an open entry, and says so when there is none or it is already closed', async () => {
    const world = harness();
    const { pass } = seededWorld(world.store);

    // No check-in yet.
    await expectError(
      world.service.recordEntry(GUARD, C.RecordEntryInput.parse({ passId: pass.id, action: 'CHECK_OUT' })),
      'STATE_NOT_ALLOWED',
    );

    await world.service.recordEntry(
      GUARD,
      C.RecordEntryInput.parse({ passId: pass.id, action: 'CHECK_IN' }),
    );
    const out = await world.service.recordEntry(
      GUARD,
      C.RecordEntryInput.parse({ passId: pass.id, action: 'CHECK_OUT' }),
    );
    expect(out.ok).toBe(true);
    expect(world.store.logs[0]?.exitedAt).toEqual(new Date('2026-09-08T09:00:00Z'));

    // A re-entry after checkout is not a permitted transition.
    await expectError(
      world.service.recordEntry(GUARD, C.RecordEntryInput.parse({ passId: pass.id, action: 'CHECK_IN' })),
      'STATE_NOT_ALLOWED',
    );
    await expectError(
      world.service.recordEntry(GUARD, C.RecordEntryInput.parse({ passId: pass.id, action: 'CHECK_OUT' })),
      'ALREADY_DONE',
    );
  });

  it('refuses anyone but the gate', async () => {
    const world = harness();
    const { unitId, pass } = seededWorld(world.store);

    await expectError(
      world.service.recordEntry(
        residentActor(world.store, unitId),
        C.RecordEntryInput.parse({ passId: pass.id, action: 'CHECK_IN' }),
      ),
      'FORBIDDEN',
    );
  });
});

describe('logWalkIn', () => {
  it('logs a waiting walk-in and emails every ACTIVE resident of the home, one row each', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const input = C.LogWalkInInput.parse({
      unitId,
      visitorName: 'Suresh the courier',
      phone: '9886012345',
      purpose: 'Package for B-101',
    });

    const { logId } = await expectOk(world.service.logWalkIn(GUARD, input));

    const log = world.store.logs.find((l) => l.id === logId);
    expect(log).toMatchObject({
      passId: null,
      unitId,
      walkInName: 'Suresh the courier',
      // Phone parses to E.164 on the way in — the log stores what contracts accepted.
      walkInPhone: '+919886012345',
      walkInPurpose: 'Package for B-101',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
    });

    // Two residents on B-101, one on B-102 — only the household's two are addressed (D-29).
    expect(world.store.outbox).toHaveLength(2);
    for (const event of world.store.outbox) {
      expect(event.type).toBe('walkin.awaiting_decision');
      expect(event.channel).toBe('EMAIL');
      expect(event.payload).toEqual(
        expect.objectContaining({
          recipientName: expect.any(String),
          email: expect.stringContaining('@example.com'),
          visitorName: 'Suresh the courier',
          purpose: 'Package for B-101',
          arrivedAt: '2026-09-08T09:00:00.000Z',
          visitorPhone: '+919886012345',
        }),
      );
    }
    const recipients = world.store.outbox.map((e) => e.payload['email']);
    expect(recipients).toEqual(['asha@example.com', 'vikram@example.com']);
  });

  it('omits the phone variable when the visitor left none', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const input = C.LogWalkInInput.parse({
      unitId,
      visitorName: 'Suresh the courier',
      purpose: 'Package for B-101',
    });

    await expectOk(world.service.logWalkIn(GUARD, input));

    expect(world.store.outbox[0]?.payload['visitorPhone']).toBeUndefined();
  });

  it('admits on a guard override: APPROVED, attributed, with the reason on the record (D-21)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const input = C.LogWalkInInput.parse({
      unitId,
      visitorName: 'Plumber',
      purpose: 'Burst pipe in B-101',
      guardOverride: { reason: 'Resident called ahead from the gate phone' },
    });

    const { logId } = await expectOk(world.service.logWalkIn(GUARD, input));

    const log = world.store.logs.find((l) => l.id === logId);
    expect(log).toMatchObject({
      approvalStatus: 'APPROVED',
      decidedById: GUARD.userId,
      decidedAt: new Date('2026-09-08T09:00:00Z'),
      overrideReason: 'Resident called ahead from the gate phone',
    });
    // The household still hears the decision — told the same way as their own.
    expect(world.store.outbox.every((e) => e.type === 'walkin.decided')).toBe(true);
    expect(world.store.outbox[0]?.payload).toEqual(
      expect.objectContaining({
        decision: 'APPROVED',
        decidedByName: 'Main Gate',
        home: 'Brindavan · B-101',
      }),
    );
  });

  it('refuses anyone but the gate, and a unit that does not exist', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const input = C.LogWalkInInput.parse({
      unitId,
      visitorName: 'Suresh the courier',
      purpose: 'Package for B-101',
    });

    await expectError(world.service.logWalkIn(residentActor(world.store, unitId), input), 'FORBIDDEN');
    await expectError(
      world.service.logWalkIn(
        GUARD,
        C.LogWalkInInput.parse({
          unitId: 999,
          visitorName: 'Suresh the courier',
          purpose: 'Package for B-101',
        }),
      ),
      'NOT_FOUND',
    );
  });
});

describe('decideWalkIn', () => {
  it('approves a waiting visit and writes who and when — the columns UC-05 lacked (D-21)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const log = world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'Suresh the courier',
      walkInPhone: '9886012345',
      walkInPurpose: 'Package for B-101',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });

    const result = await world.service.decideWalkIn(
      residentActor(world.store, unitId),
      C.DecideWalkInInput.parse({ logId: log.id, decision: 'APPROVE' }),
    );

    expect(result.ok).toBe(true);
    expect(world.store.logs.find((l) => l.id === log.id)).toMatchObject({
      approvalStatus: 'APPROVED',
      decidedById: expect.any(Number),
      decidedAt: new Date('2026-09-08T09:00:00Z'),
    });
    expect(world.store.outbox).toHaveLength(2);
    expect(world.store.outbox[0]?.payload).toEqual(
      expect.objectContaining({
        decision: 'APPROVED',
        decidedByName: 'Asha Rao',
        decidedAt: '2026-09-08T09:00:00.000Z',
        home: 'Brindavan · B-101',
        visitorName: 'Suresh the courier',
      }),
    );
  });

  it('rejects a waiting visit the same way', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const log = world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'Suresh the courier',
      walkInPhone: null,
      walkInPurpose: 'Package for B-101',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });

    const result = await world.service.decideWalkIn(
      residentActor(world.store, unitId),
      C.DecideWalkInInput.parse({ logId: log.id, decision: 'REJECT' }),
    );

    expect(result.ok).toBe(true);
    expect(world.store.logs.find((l) => l.id === log.id)?.approvalStatus).toBe('REJECTED');
    expect(world.store.outbox[0]?.payload['decision']).toBe('REJECTED');
  });

  it('treats another household\'s visit as missing, and a decided visit as done', async () => {
    const world = harness();
    const { unitId, otherUnitId } = seededWorld(world.store);
    const mine = world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'A',
      walkInPhone: null,
      walkInPurpose: 'Visit',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });
    const theirs = world.store.seedLog({
      passId: null,
      unitId: otherUnitId,
      walkInName: 'B',
      walkInPhone: null,
      walkInPurpose: 'Visit',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });
    const decided = world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'C',
      walkInPhone: null,
      walkInPurpose: 'Visit',
      approvalStatus: 'REJECTED',
      decidedById: 1,
      decidedAt: new Date('2026-09-08T08:00:00Z'),
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });

    await expectError(
      world.service.decideWalkIn(
        residentActor(world.store, unitId),
        C.DecideWalkInInput.parse({ logId: theirs.id, decision: 'APPROVE' }),
      ),
      'NOT_FOUND',
    );
    await expectError(
      world.service.decideWalkIn(
        residentActor(world.store, unitId),
        C.DecideWalkInInput.parse({ logId: decided.id, decision: 'APPROVE' }),
      ),
      'ALREADY_DONE',
    );
    // The pending one is still pending.
    expect(world.store.logs.find((l) => l.id === mine.id)?.approvalStatus).toBe('PENDING');
  });

  it('reports a race lost between the check and the decision as done, not a crash', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const log = world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'A',
      walkInPhone: null,
      walkInPurpose: 'Visit',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });
    world.store.forceNextDecideNull = true;

    await expectError(
      world.service.decideWalkIn(
        residentActor(world.store, unitId),
        C.DecideWalkInInput.parse({ logId: log.id, decision: 'APPROVE' }),
      ),
      'ALREADY_DONE',
    );
  });

  it('refuses anyone without a home to answer for', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const log = world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'A',
      walkInPhone: null,
      walkInPurpose: 'Visit',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });

    await expectError(
      world.service.decideWalkIn(GUARD, C.DecideWalkInInput.parse({ logId: log.id, decision: 'APPROVE' })),
      'FORBIDDEN',
    );
  });
});

describe('waitingForHousehold', () => {
  it('shows the household\'s undecided walk-ins, oldest first, and nothing of anyone else\'s', async () => {
    const world = harness();
    const { unitId, otherUnitId } = seededWorld(world.store);
    const older = world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'Suresh the courier',
      walkInPhone: '9886012345',
      walkInPurpose: 'Package for B-101',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });
    const newer = world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'Aunt Meera',
      walkInPhone: null,
      walkInPurpose: 'Surprise visit',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });
    world.store.seedLog({
      passId: null,
      unitId: otherUnitId,
      walkInName: 'Not mine to see',
      walkInPhone: null,
      walkInPurpose: 'Visit',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });
    world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'Already answered',
      walkInPhone: null,
      walkInPurpose: 'Visit',
      approvalStatus: 'APPROVED',
      decidedById: 1,
      decidedAt: new Date('2026-09-08T08:30:00Z'),
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });

    const waiting: readonly WaitingVisitorView[] = await expectOk(
      world.service.waitingForHousehold(residentActor(world.store, unitId)),
    );

    expect(waiting.map((w) => w.name)).toEqual(['Suresh the courier', 'Aunt Meera']);
    expect(waiting[0]).toMatchObject({
      logId: older.id,
      phone: '9886012345',
      purpose: 'Package for B-101',
    });
    expect(waiting[1]?.logId).toBe(newer.id);
    expect(waiting[1]?.phone).toBeNull();
  });

  it('refuses anyone without a home', async () => {
    const world = harness();
    seededWorld(world.store);
    await expectError(world.service.waitingForHousehold(GUARD), 'FORBIDDEN');
  });
});

describe('waitingForSociety', () => {
  it('is the kiosk’s queue: every household’s pending walk-ins, oldest first, each naming the home it waits on', async () => {
    const world = harness();
    const { unitId, otherUnitId } = seededWorld(world.store);
    const older = world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'Suresh the courier',
      walkInPhone: '9886012345',
      walkInPurpose: 'Package for B-101',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });
    const newer = world.store.seedLog({
      passId: null,
      unitId: otherUnitId,
      walkInName: 'Aunt Meera',
      walkInPhone: null,
      walkInPurpose: 'Surprise visit',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });
    world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'Already answered',
      walkInPhone: null,
      walkInPurpose: 'Visit',
      approvalStatus: 'APPROVED',
      decidedById: 1,
      decidedAt: new Date('2026-09-08T08:30:00Z'),
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });

    const waiting: readonly SocietyWaitingVisitorView[] = await expectOk(
      world.service.waitingForSociety(GUARD),
    );

    expect(waiting.map((w) => w.name)).toEqual(['Suresh the courier', 'Aunt Meera']);
    expect(waiting[0]).toMatchObject({
      logId: older.id,
      homeLabel: 'Brindavan · B-101',
      purpose: 'Package for B-101',
    });
    expect(waiting[1]).toMatchObject({ logId: newer.id, homeLabel: 'Brindavan · B-102' });
  });

  it('refuses everyone but the gate — a household’s queue is not the society’s', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    await expectError(world.service.waitingForSociety(residentActor(world.store, unitId)), 'FORBIDDEN');
  });
});

describe('entriesForHousehold', () => {
  it('is the feed: this home only, newest first, pass entries named from the pass', async () => {
    const world = harness();
    const { unitId, otherUnitId, pass } = seededWorld(world.store);
    const asha = world.store.residents.find((r) => r.unitId === unitId);
    if (asha === undefined) throw new Error('seed broken');

    // A used pass: checked in and out, decided by nobody in particular.
    const checkedIn = world.store.seedLog({
      passId: pass.id,
      unitId,
      walkInName: null,
      walkInPhone: null,
      walkInPurpose: null,
      approvalStatus: 'APPROVED',
      decidedById: asha.id,
      decidedAt: new Date('2026-09-08T08:00:00Z'),
      overrideReason: null,
      enteredAt: new Date('2026-09-08T08:00:00Z'),
      exitedAt: new Date('2026-09-08T09:30:00Z'),
    });
    // A later walk-in, still waiting — the feed's top line.
    const walkIn = world.store.seedLog({
      passId: null,
      unitId,
      walkInName: 'Suresh the courier',
      walkInPhone: '9886012345',
      walkInPurpose: 'Package for B-101',
      approvalStatus: 'PENDING',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });
    // Another home's traffic is not this feed's business.
    world.store.seedLog({
      passId: null,
      unitId: otherUnitId,
      walkInName: 'Elsewhere',
      walkInPhone: null,
      walkInPurpose: 'Visit',
      approvalStatus: 'APPROVED',
      decidedById: null,
      decidedAt: null,
      overrideReason: null,
      enteredAt: null,
      exitedAt: null,
    });

    const feed = await expectOk(
      world.service.entriesForHousehold(residentActor(world.store, unitId)),
    );
    expect(feed.map((entry) => entry.logId)).toEqual([walkIn.id, checkedIn.id]);

    expect(feed[0]).toMatchObject({
      kind: 'WALK_IN',
      visitorName: 'Suresh the courier',
      purpose: 'Package for B-101',
      approvalStatus: 'PENDING',
      decidedByName: null,
      enteredAt: null,
    });
    expect(feed[1]).toMatchObject({
      kind: 'PASS',
      visitorName: 'Ravi Kumar', // from the pass, not the log row
      purpose: 'Family visit',
      approvalStatus: 'APPROVED',
      decidedByName: 'Asha Rao',
    });
    expect(feed[1]?.enteredAt?.toISOString()).toBe('2026-09-08T08:00:00.000Z');
    expect(feed[1]?.exitedAt?.toISOString()).toBe('2026-09-08T09:30:00.000Z');
  });

  it('refuses anyone without a home', async () => {
    const world = harness();
    seededWorld(world.store);
    await expectError(world.service.entriesForHousehold(GUARD), 'FORBIDDEN');
  });
});
