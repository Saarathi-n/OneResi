import { describe, expect, it } from 'vitest';
import * as C from '@grihaone/contracts';
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
import type { Actor, RequestMeta } from './ports.js';

class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return this.instant;
  }
}

class AllowAllLimiter implements RateLimiter {
  consume(): Promise<RateLimitVerdict> {
    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  }
  clear(): Promise<void> {
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

class FakeVisitorStore implements VisitorStore {
  nextPassId = 1;
  nextLogId = 1;
  passes: PassRow[] = [];
  logs: LogRow[] = [];
  outbox: OutboxEventInput[] = [];

  findPassByCode(code: string): Promise<StoredVisitorPass | null> {
    const p = this.passes.find((x) => x.code === code);
    return Promise.resolve(p ? { ...p } : null);
  }

  findPassById(id: number): Promise<StoredVisitorPass | null> {
    const p = this.passes.find((x) => x.id === id);
    return Promise.resolve(p ? { ...p } : null);
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
        .map((p) => ({ ...p })),
    );
  }

  createPass(input: NewVisitorPass, events: readonly OutboxEventInput[]): Promise<StoredVisitorPass | null> {
    const pass: PassRow = {
      id: this.nextPassId++,
      unitId: input.unitId,
      createdById: input.createdById,
      createdByName: 'Resident One',
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
    return Promise.resolve({ ...pass });
  }

  cancelPass(id: number, _cancelledAt: Date, events: readonly OutboxEventInput[]): Promise<StoredVisitorPass | null> {
    const p = this.passes.find((x) => x.id === id);
    if (!p || p.status !== 'ACTIVE') return Promise.resolve(null);
    p.status = 'CANCELLED';
    this.outbox.push(...events);
    return Promise.resolve({ ...p });
  }

  checkInPass(
    input: { passId: number; at: Date; idempotencyKey: string | null },
    logInput: Omit<NewVisitorLog, 'id'>,
    events: readonly OutboxEventInput[],
  ): Promise<StoredVisitorPass | null> {
    const p = this.passes.find((x) => x.id === input.passId);
    if (!p || p.status !== 'ACTIVE') return Promise.resolve(null);
    p.status = 'USED';
    p.enteredAt = input.at;
    const log: LogRow = { ...logInput, id: this.nextLogId++, exitedAt: null };
    this.logs.push(log);
    this.outbox.push(...events);
    return Promise.resolve({ ...p });
  }

  checkOutPass(passId: number, at: Date): Promise<StoredVisitorLog | null> {
    const log = this.logs.find((l) => l.passId === passId && l.enteredAt !== null && l.exitedAt === null);
    if (!log) return Promise.resolve(null);
    log.exitedAt = at;
    const p = this.passes.find((x) => x.id === passId);
    if (p) p.exitedAt = at;
    return Promise.resolve({ ...log });
  }

  stampWalkInEntry(input: { logId: number; at: Date }, events: readonly OutboxEventInput[]): Promise<StoredVisitorLog | null> {
    const log = this.logs.find((l) => l.id === input.logId);
    if (!log || log.approvalStatus !== 'APPROVED' || log.enteredAt !== null) return Promise.resolve(null);
    log.enteredAt = input.at;
    this.outbox.push(...events);
    return Promise.resolve({ ...log });
  }

  stampWalkInExit(logId: number, at: Date): Promise<StoredVisitorLog | null> {
    const log = this.logs.find((l) => l.id === logId);
    if (!log || log.enteredAt === null || log.exitedAt !== null) return Promise.resolve(null);
    log.exitedAt = at;
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
    return Promise.resolve(log ? { ...log } : null);
  }

  findPendingWalkIns(unitId: number): Promise<readonly StoredVisitorLog[]> {
    return Promise.resolve(this.logs.filter((l) => l.unitId === unitId && l.approvalStatus === 'PENDING').map((l) => ({ ...l })));
  }

  findPendingWalkInsForSociety(): Promise<readonly (StoredVisitorLog & { home: StoredHome })[]> {
    return Promise.resolve([]);
  }

  findExpectedPassesForSociety(validOn: Date): Promise<readonly (StoredVisitorPass & { home: StoredHome })[]> {
    return Promise.resolve(
      this.passes
        .filter((p) => p.validOn.getTime() === validOn.getTime() && p.status === 'ACTIVE')
        .map((p) => ({
          ...p,
          home: {
            unitId: p.unitId,
            blockId: 1,
            blockName: 'Tower A',
            label: '101',
            type: 'FLAT_2BHK',
            monthlyChargePaise: C.paise(250000),
            active: true,
          },
        })),
    );
  }

  findLogsForUnit(unitId: number, limit: number): Promise<readonly StoredVisitorEntry[]> {
    return Promise.resolve(
      this.logs
        .filter((l) => l.unitId === unitId)
        .slice(0, limit)
        .map((l) => ({
          logId: l.id,
          kind: l.passId === null ? 'WALK_IN' : 'PASS',
          visitorName: l.walkInName ?? '',
          purpose: l.walkInPurpose ?? '',
          approvalStatus: l.approvalStatus,
          decidedByName: null,
          overrideReason: l.overrideReason,
          enteredAt: l.enteredAt,
          exitedAt: l.exitedAt,
          createdAt: l.createdAt,
        })),
    );
  }

  findLogsForSociety(_limit: number): Promise<readonly (StoredVisitorEntry & { home: StoredHome })[]> {
    return Promise.resolve([]);
  }

  decideWalkInLog(input: { logId: number; approvalStatus: C.ApprovalStatus; decidedById: number; decidedAt: Date }, events: readonly OutboxEventInput[]): Promise<StoredVisitorLog | null> {
    const log = this.logs.find((l) => l.id === input.logId);
    if (!log || log.approvalStatus !== 'PENDING') return Promise.resolve(null);
    log.approvalStatus = input.approvalStatus;
    log.decidedById = input.decidedById;
    log.decidedAt = input.decidedAt;
    this.outbox.push(...events);
    return Promise.resolve({ ...log });
  }

  findHome(unitId: number): Promise<StoredHome | null> {
    return Promise.resolve({
      unitId,
      blockId: 1,
      blockName: 'Tower A',
      label: '101',
      type: 'FLAT_2BHK',
      monthlyChargePaise: C.paise(250000),
      active: true,
    });
  }

  findResidentsForUnit(_unitId: number): Promise<readonly { id: number; name: string; email: string }[]> {
    return Promise.resolve([{ id: 1, name: 'Resident One', email: 'resident@society.in' }]);
  }
}

const META: RequestMeta = { ip: '127.0.0.1', userAgent: 'test', correlationId: 'c-1' };
const GUARD: Actor = { userId: 88, name: 'Guard Gate', role: 'S', unitId: null, email: 'guard@society.in' };
const RESIDENT: Actor = { userId: 1, name: 'Resident One', role: 'R', unitId: 10, email: 'res@society.in' };

describe('Visitors IST Midnight Transition (Bug 2)', () => {
  it('correctly verifies and checks in a pass between 00:00 and 05:30 IST on the valid day', async () => {
    // 2026-09-09T20:30:00.000Z is 2026-09-10 02:00:00 IST (Day in IST is 2026-09-10, UTC is 2026-09-09).
    const clock = new FixedClock(new Date('2026-09-09T20:30:00.000Z'));
    const store = new FakeVisitorStore();
    const service = visitorsService({ store, limiter: new AllowAllLimiter(), clock });

    // 1. Issue pass for today (2026-09-10 IST)
    const issueRes = await service.issuePass(RESIDENT, {
      visitorName: 'Early Visitor',
      purpose: 'Emergency Plumbing',
      validDate: '2026-09-10',
    });
    expect(issueRes.ok).toBe(true);
    if (!issueRes.ok) return;
    const passCode = issueRes.value.code;
    const passId = issueRes.value.id;

    // 2. Guard verifies the pass code at 02:00 IST
    const verifyRes = await service.verifyCode(GUARD, { code: passCode }, META);
    expect(verifyRes.ok).toBe(true);
    if (!verifyRes.ok) return;
    expect(verifyRes.value.verdict).toBe('ADMIT');

    // 3. Expected today lists this pass for the resident
    const expected = await service.expectedToday(RESIDENT);
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(expected.value.some((p) => p.code === passCode)).toBe(true);

    // 4. Guard records check-in at 02:00 IST
    const entryRes = await service.recordEntry(
      GUARD,
      C.RecordEntryInput.parse({
        passId,
        action: 'CHECK_IN',
        idempotencyKey: 'idem-early-01-abcdef123456789012',
      }),
    );
    expect(entryRes.ok).toBe(true);

    // Verify pass is now marked USED in store
    const storedPass = store.passes.find((p) => p.code === passCode);
    expect(storedPass?.status).toBe('USED');
    expect(storedPass?.enteredAt).toBeDefined();
  });
});

describe('Visitors Walk-in Entry Idempotency (Bug 29 & Bug 11)', () => {
  it('gracefully handles idempotency retry on walk-in check-in', async () => {
    const clock = new FixedClock(new Date('2026-09-10T10:00:00.000Z'));
    const store = new FakeVisitorStore();
    const service = visitorsService({ store, limiter: new AllowAllLimiter(), clock });

    // Seed an approved walk-in log
    const log = await store.createWalkInLog(
      {
        passId: null,
        unitId: 10,
        walkInName: 'Delivery Person',
        walkInPhone: '9876543210',
        walkInPurpose: 'Package',
        approvalStatus: 'APPROVED',
        decidedById: 1,
        decidedAt: new Date('2026-09-10T09:55:00.000Z'),
        overrideReason: null,
        enteredAt: null,
        createdAt: new Date('2026-09-10T09:50:00.000Z'),
      },
      [],
    );

    const idempotencyKey = 'walkin12345678901234567890123456';

    // First check-in call with idempotencyKey
    const firstCall = await service.recordEntry(
      GUARD,
      C.RecordEntryInput.parse({
        walkInLogId: log.id,
        action: 'CHECK_IN',
        idempotencyKey,
      }),
    );
    expect(firstCall.ok).toBe(true);

    // Second retry with same idempotencyKey must return ok(null) without error
    const retryCall = await service.recordEntry(
      GUARD,
      C.RecordEntryInput.parse({
        walkInLogId: log.id,
        action: 'CHECK_IN',
        idempotencyKey,
      }),
    );
    expect(retryCall.ok).toBe(true);
  });
});
