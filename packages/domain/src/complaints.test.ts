import { describe, expect, it } from 'vitest';
import * as C from '@oneresi/contracts';
import { complaintsService } from './complaints.js';
import type { Clock } from './clock.js';
import type {
  ComplaintStore,
  NewComplaint,
  OutboxEventInput,
  StoredComplaint,
  StoredComplaintUpdate,
} from './store.js';
import type { Actor, ComplaintsService, ComplaintView, Result } from './ports.js';

/**
 * The complaints service, exercised against an in-memory store. The register's complaints each
 * have a test here: `resolvedAt` is set on entering RESOLVED and survives every later update
 * (D-20), the reopen window is measured from resolution — never from the last edit — and a
 * household never sees, updates, or reopens a complaint that is not its own.
 */

// ---------------------------------------------------------------- fakes

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

interface ResidentRow {
  id: number;
  unitId: number;
  name: string;
  email: string;
  active: boolean;
}

interface UpdateRow {
  id: number;
  complaintId: number;
  updatedById: number;
  updatedByName: string;
  statusAfter: C.ComplaintStatus;
  note: string;
  createdAt: Date;
}

/** The store's own mutable row; snapshots handed back are the read-only StoredComplaint. */
interface ComplaintRow {
  id: number;
  unitId: number;
  category: C.ComplaintCategory;
  priority: C.ComplaintPriority;
  description: string;
  photoKeys: string[];
  status: C.ComplaintStatus;
  resolvedAt: Date | null;
  reopenCount: number;
  raisedAt: Date;
  updates: UpdateRow[];
}

/** An in-memory ComplaintStore: the same contract the db package will implement, minus SQL. */
class MemoryComplaintStore implements ComplaintStore {
  private nextComplaintId = 1;
  private nextUpdateId = 1;
  readonly complaints: ComplaintRow[] = [];
  readonly residents: ResidentRow[] = [];
  readonly outbox: OutboxEventInput[] = [];
  /** Test hooks: simulate the guarded transitions losing a race. */
  forceNextUpdateNull = false;
  forceNextReopenNull = false;
  /** The status filter the last forSociety call received, to prove it never widens. */
  lastSocietyFilter: { status?: C.ComplaintStatus } | null = null;

  // ---- seeding, test-only

  seedResident(unitId: number, name: string, email: string, active = true): number {
    const id = this.residents.length + 1;
    this.residents.push({ id, unitId, name, email, active });
    return id;
  }

  /** Seed a person under a chosen id — the committee desk's actor, whose userId the update rows carry. */
  seedPerson(id: number, name: string, email: string): void {
    this.residents.push({ id, unitId: 999, name, email, active: true });
  }

  seedComplaint(row: {
    unitId: number;
    category?: C.ComplaintCategory;
    priority?: C.ComplaintPriority;
    status?: C.ComplaintStatus;
    resolvedAt?: Date | null;
    raisedAt?: Date;
  }): ComplaintRow {
    const complaint: ComplaintRow = {
      id: this.nextComplaintId++,
      unitId: row.unitId,
      category: row.category ?? 'PLUMBING',
      priority: row.priority ?? 'MEDIUM',
      description: 'The kitchen tap has been dripping for a week.',
      photoKeys: [],
      status: row.status ?? 'OPEN',
      resolvedAt: row.resolvedAt ?? null,
      reopenCount: 0,
      raisedAt: row.raisedAt ?? new Date('2026-09-01T09:00:00Z'),
      updates: [],
    };
    this.complaints.push(complaint);
    return complaint;
  }

  // ---- lookups

  private snapshot(complaint: ComplaintRow): StoredComplaint {
    return {
      ...complaint,
      photoKeys: [...complaint.photoKeys],
      updates: complaint.updates.map(
        (update): StoredComplaintUpdate => ({ ...update }),
      ),
    };
  }

  findComplaintById(id: number): Promise<StoredComplaint | null> {
    const complaint = this.complaints.find((c) => c.id === id);
    return Promise.resolve(complaint === undefined ? null : this.snapshot(complaint));
  }

  findComplaintsForUnit(unitId: number): Promise<readonly StoredComplaint[]> {
    return Promise.resolve(
      this.complaints.filter((c) => c.unitId === unitId).map((c) => this.snapshot(c)),
    );
  }

  findComplaintsForSociety(
    filter: { status?: C.ComplaintStatus },
  ): Promise<readonly StoredComplaint[]> {
    this.lastSocietyFilter = filter;
    return Promise.resolve(
      this.complaints
        .filter((c) => filter.status === undefined || c.status === filter.status)
        .map((c) => this.snapshot(c)),
    );
  }

  findResidentsForUnit(
    unitId: number,
  ): Promise<readonly { id: number; name: string; email: string }[]> {
    return Promise.resolve(
      this.residents.filter((r) => r.unitId === unitId && r.active).map((r) => ({ id: r.id, name: r.name, email: r.email })),
    );
  }

  // ---- writes (each one is "a transaction" in the real store)

  createComplaint(
    input: NewComplaint,
    eventsFor: (complaint: StoredComplaint) => readonly OutboxEventInput[],
  ): Promise<StoredComplaint> {
    const complaint: ComplaintRow = {
      id: this.nextComplaintId++,
      unitId: input.unitId,
      category: input.category,
      priority: input.priority,
      description: input.description,
      photoKeys: [...input.photoKeys],
      status: 'OPEN',
      resolvedAt: null,
      reopenCount: 0,
      raisedAt: input.raisedAt,
      updates: [],
    };
    this.complaints.push(complaint);
    const snapshot = this.snapshot(complaint);
    this.outbox.push(...eventsFor(snapshot));
    return Promise.resolve(snapshot);
  }

  applyComplaintUpdate(
    input: {
      complaintId: number;
      statusAfter: C.ComplaintStatus;
      updatedById: number;
      note: string;
      at: Date;
    },
    events: readonly OutboxEventInput[],
  ): Promise<StoredComplaint | null> {
    if (this.forceNextUpdateNull) {
      this.forceNextUpdateNull = false;
      return Promise.resolve(null);
    }
    const complaint = this.complaints.find((c) => c.id === input.complaintId);
    if (complaint === undefined) return Promise.resolve(null);
    // The state machine from the CURRENT status; the caller has already validated it.
    if (!C.COMPLAINT_TRANSITIONS[complaint.status].includes(input.statusAfter)) {
      return Promise.resolve(null);
    }
    const actor = this.residents.find((r) => r.id === input.updatedById);
    const update: UpdateRow = {
      id: this.nextUpdateId++,
      complaintId: complaint.id,
      updatedById: input.updatedById,
      updatedByName: actor === undefined ? '' : actor.name,
      statusAfter: input.statusAfter,
      note: input.note,
      createdAt: input.at,
    };
    complaint.updates.push(update);
    complaint.status = input.statusAfter;
    if (input.statusAfter === 'RESOLVED') {
      complaint.resolvedAt = input.at;
    } else if (input.statusAfter === 'OPEN' && complaint.resolvedAt !== null) {
      // Whoever moved it back, the timestamp is cleared and the reopen is counted (D-20).
      complaint.resolvedAt = null;
      complaint.reopenCount += 1;
    }
    this.outbox.push(...events);
    return Promise.resolve(this.snapshot(complaint));
  }

  reopenComplaint(
    input: { complaintId: number; reopenedById: number; reason: string; at: Date },
    events: readonly OutboxEventInput[],
  ): Promise<StoredComplaint | null> {
    if (this.forceNextReopenNull) {
      this.forceNextReopenNull = false;
      return Promise.resolve(null);
    }
    const complaint = this.complaints.find((c) => c.id === input.complaintId);
    if (complaint === undefined || complaint.status !== 'RESOLVED') {
      return Promise.resolve(null);
    }
    const actor = this.residents.find((r) => r.id === input.reopenedById);
    const update: UpdateRow = {
      id: this.nextUpdateId++,
      complaintId: complaint.id,
      updatedById: input.reopenedById,
      updatedByName: actor === undefined ? '' : actor.name,
      statusAfter: 'OPEN',
      note: input.reason,
      createdAt: input.at,
    };
    complaint.updates.push(update);
    complaint.status = 'OPEN';
    complaint.resolvedAt = null;
    complaint.reopenCount += 1;
    this.outbox.push(...events);
    return Promise.resolve(this.snapshot(complaint));
  }
}

// ---------------------------------------------------------------- harness

interface Harness {
  service: ComplaintsService;
  store: MemoryComplaintStore;
  clock: MutableClock;
}

function harness(): Harness {
  const clock = new MutableClock('2026-09-08T09:00:00Z');
  const store = new MemoryComplaintStore();
  const service = complaintsService({ store, clock });
  return { service, store, clock };
}

const ADMIN: Actor = {
  userId: 902,
  name: 'Committee Chair',
  role: 'A',
  unitId: null,
  email: 'chair@oneresi.in',
};

const GUARD: Actor = {
  userId: 901,
  name: 'Main Gate',
  role: 'S',
  unitId: null,
  email: 'gate@oneresi.in',
};

function residentActor(store: MemoryComplaintStore, unitId: number): Actor {
  const resident = store.residents.find((r) => r.unitId === unitId);
  if (resident === undefined) throw new Error(`no resident for unit ${unitId}`);
  return { userId: resident.id, name: resident.name, role: 'R', unitId, email: resident.email };
}

/** B-101 with two residents; B-102 with one, to prove nothing leaks across homes. */
function seededWorld(store: MemoryComplaintStore): { unitId: number; otherUnitId: number } {
  const unitId = 1;
  const otherUnitId = 2;
  store.seedResident(unitId, 'Asha Rao', 'asha@example.com');
  store.seedResident(unitId, 'Vikram Rao', 'vikram@example.com');
  store.seedResident(otherUnitId, 'Priya Sharma', 'priya@example.com');
  // The committee desk's actor is a person row too, so update rows can be attributed.
  store.seedPerson(902, 'Committee Chair', 'chair@oneresi.in');
  return { unitId, otherUnitId };
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

async function expectOk<T>(result: Promise<Result<T>>): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw new Error(`expected a value, got ${settled.error.code}`);
  return settled.value;
}

// ---------------------------------------------------------------- tests

describe('raise', () => {
  it('records the complaint with its photos as opaque keys, and notes the household in-app', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const input = C.RaiseComplaintInput.parse({
      category: 'PLUMBING',
      priority: 'HIGH',
      description: 'The kitchen tap has been dripping for a week and the sink is overflowing.',
      photoKeys: ['uploads/b101-tap-1.jpg', 'uploads/b101-tap-2.jpg'],
    });

    const complaint: ComplaintView = await expectOk(world.service.raise(residentActor(world.store, unitId), input));

    expect(complaint.status).toBe('OPEN');
    expect(complaint.category).toBe('PLUMBING');
    expect(complaint.priority).toBe('HIGH');
    expect(complaint.updates).toEqual([]);
    expect(complaint.raisedAt).toEqual(new Date('2026-09-08T09:00:00Z'));
    expect(world.store.complaints[0]?.photoKeys).toEqual(['uploads/b101-tap-1.jpg', 'uploads/b101-tap-2.jpg']);

    // One in-app note per ACTIVE resident of the home (D-29); no email template exists.
    expect(world.store.outbox).toHaveLength(2);
    expect(world.store.outbox.every((e) => e.type === 'complaint.raised' && e.channel === 'IN_APP')).toBe(true);
    expect(world.store.outbox[0]?.payload).toEqual(
      expect.objectContaining({
        name: 'Asha Rao',
        email: 'asha@example.com',
        complaintId: complaint.id,
        category: 'PLUMBING',
      }),
    );
  });

  it('refuses anyone without a home to complain for', async () => {
    const world = harness();
    seededWorld(world.store);
    const input = C.RaiseComplaintInput.parse({
      category: 'PLUMBING',
      description: 'The kitchen tap has been dripping for a week and the sink is overflowing.',
    });

    await expectError(world.service.raise(GUARD, input), 'FORBIDDEN');
  });
});

describe('forHousehold and forSociety', () => {
  it('shows a household only its own complaints', async () => {
    const world = harness();
    const { unitId, otherUnitId } = seededWorld(world.store);
    world.store.seedComplaint({ unitId, category: 'ELECTRICAL' });
    world.store.seedComplaint({ unitId: otherUnitId, category: 'SECURITY' });

    const mine: readonly ComplaintView[] = await expectOk(
      world.service.forHousehold(residentActor(world.store, unitId)),
    );

    expect(mine).toHaveLength(1);
    expect(mine[0]?.category).toBe('ELECTRICAL');
    await expectError(world.service.forHousehold(GUARD), 'FORBIDDEN');
  });

  it('shows the committee the society\'s complaints, narrowed exactly as asked', async () => {
    const world = harness();
    const { unitId, otherUnitId } = seededWorld(world.store);
    world.store.seedComplaint({ unitId, status: 'OPEN' });
    world.store.seedComplaint({ unitId: otherUnitId, status: 'IN_PROGRESS' });
    world.store.seedComplaint({ unitId, status: 'RESOLVED' });

    const open = await expectOk(world.service.forSociety(ADMIN, { status: 'OPEN' }));
    expect(open).toHaveLength(1);
    expect(world.store.lastSocietyFilter).toEqual({ status: 'OPEN' });

    const all = await expectOk(world.service.forSociety(ADMIN));
    expect(all).toHaveLength(3);
    expect(world.store.lastSocietyFilter).toEqual({});

    await expectError(world.service.forSociety(residentActor(world.store, unitId)), 'FORBIDDEN');
  });
});

describe('update', () => {
  it('moves a complaint along the machine, with an attributed update row and a mail per resident', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const complaint = world.store.seedComplaint({ unitId });

    const updated: ComplaintView = await expectOk(
      world.service.update(
        ADMIN,
        C.UpdateComplaintInput.parse({ complaintId: complaint.id, status: 'IN_PROGRESS', note: 'Plumber visits tomorrow morning' }),
      ),
    );

    expect(updated.status).toBe('IN_PROGRESS');
    expect(updated.updates).toHaveLength(1);
    expect(updated.updates[0]).toMatchObject({
      by: 'Committee Chair',
      statusAfter: 'IN_PROGRESS',
      note: 'Plumber visits tomorrow morning',
      at: new Date('2026-09-08T09:00:00Z'),
    });

    expect(world.store.outbox).toHaveLength(2);
    expect(world.store.outbox.every((e) => e.type === 'complaint.updated' && e.channel === 'EMAIL')).toBe(true);
    expect(world.store.outbox[0]?.payload).toEqual(
      expect.objectContaining({
        recipientName: 'Asha Rao',
        complaintId: complaint.id,
        status: 'IN_PROGRESS',
        updatedByName: 'Committee Chair',
        updatedAt: '2026-09-08T09:00:00.000Z',
      }),
    );
    // A follow-up note is not a resolution: no reopenable-until is offered.
    expect(world.store.outbox[0]?.payload['reopenableUntil']).toBeUndefined();
  });

  it('resolves the complaint and tells the household how long the reopen window is (D-20)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const complaint = world.store.seedComplaint({ unitId, status: 'IN_PROGRESS' });

    const resolved = await expectOk(
      world.service.update(
        ADMIN,
        C.UpdateComplaintInput.parse({ complaintId: complaint.id, status: 'RESOLVED', note: 'Washer replaced and tested' }),
      ),
    );

    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedAt).toEqual(new Date('2026-09-08T09:00:00Z'));
    expect(resolved.reopenableUntil).toEqual(new Date('2026-09-15T09:00:00Z'));
    expect(world.store.outbox[0]?.payload['reopenableUntil']).toBe('2026-09-15T09:00:00.000Z');
  });

  it('keeps resolvedAt through every later update — the window survives a follow-up note (D-20)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const complaint = world.store.seedComplaint({
      unitId,
      status: 'RESOLVED',
      resolvedAt: new Date('2026-09-05T09:00:00Z'),
    });

    const closed = await expectOk(
      world.service.update(
        ADMIN,
        C.UpdateComplaintInput.parse({ complaintId: complaint.id, status: 'CLOSED', note: 'Resident confirmed it holds' }),
      ),
    );

    expect(closed.status).toBe('CLOSED');
    expect(closed.resolvedAt).toEqual(new Date('2026-09-05T09:00:00Z'));
    expect(closed.reopenableUntil).toBeNull();
  });

  it('refuses a transition the machine does not permit, and anyone but the committee', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const closed = world.store.seedComplaint({ unitId, status: 'CLOSED' });
    const open = world.store.seedComplaint({ unitId });

    const error = await expectError(
      world.service.update(
        ADMIN,
        C.UpdateComplaintInput.parse({ complaintId: closed.id, status: 'IN_PROGRESS', note: 'Reopening a closed desk item' }),
      ),
      'STATE_NOT_ALLOWED',
    );
    expect(error.message).toContain('not allowed');

    await expectError(
      world.service.update(
        residentActor(world.store, unitId),
        C.UpdateComplaintInput.parse({ complaintId: open.id, status: 'RESOLVED', note: 'Fixed it myself' }),
      ),
      'FORBIDDEN',
    );
    await expectError(
      world.service.update(ADMIN, C.UpdateComplaintInput.parse({ complaintId: 999, status: 'RESOLVED', note: 'No such complaint' })),
      'NOT_FOUND',
    );
  });

  it('reports a race lost between the check and the transition as a conflict', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const complaint = world.store.seedComplaint({ unitId });
    world.store.forceNextUpdateNull = true;

    await expectError(
      world.service.update(
        ADMIN,
        C.UpdateComplaintInput.parse({ complaintId: complaint.id, status: 'IN_PROGRESS', note: 'Lost the race' }),
      ),
      'CONFLICT',
    );
  });
});

describe('reopen', () => {
  it('reopens a resolved complaint within the window, with the reason attributed to the resident', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const complaint = world.store.seedComplaint({
      unitId,
      status: 'RESOLVED',
      resolvedAt: new Date('2026-09-05T09:00:00Z'),
    });

    const reopened: ComplaintView = await expectOk(
      world.service.reopen(
        residentActor(world.store, unitId),
        C.ReopenComplaintInput.parse({ complaintId: complaint.id, reason: 'The drip came back after two days, worse than before.' }),
      ),
    );

    expect(reopened.status).toBe('OPEN');
    expect(reopened.resolvedAt).toBeNull();
    // reopenCount is the store's bookkeeping, not the view's — the view shows the history, which
    // is what the updates assertion below reads.
    const stored = await world.store.findComplaintById(complaint.id);
    expect(stored?.reopenCount).toBe(1);
    expect(reopened.reopenableUntil).toBeNull();
    // The reason lives in the history, under the resident's own name.
    expect(reopened.updates[reopened.updates.length - 1]).toMatchObject({
      by: 'Asha Rao',
      statusAfter: 'OPEN',
      note: 'The drip came back after two days, worse than before.',
    });

    expect(world.store.outbox).toHaveLength(2);
    expect(world.store.outbox.every((e) => e.type === 'complaint.reopened' && e.channel === 'IN_APP')).toBe(true);
    expect(world.store.outbox[0]?.payload).toEqual(
      expect.objectContaining({
        complaintId: complaint.id,
        category: 'PLUMBING',
        reason: 'The drip came back after two days, worse than before.',
      }),
    );
  });

  it('closes the window seven days after resolution, not after the last edit (D-20)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    // Resolved eight days ago; a follow-up note was added yesterday. The window is gone.
    const complaint = world.store.seedComplaint({
      unitId,
      status: 'RESOLVED',
      resolvedAt: new Date('2026-08-31T09:00:00Z'),
    });

    const error = await expectError(
      world.service.reopen(
        residentActor(world.store, unitId),
        C.ReopenComplaintInput.parse({ complaintId: complaint.id, reason: 'Too late, but the drip never stopped.' }),
      ),
      'WINDOW_CLOSED',
    );
    expect(error.message).toContain('7 days');
  });

  it('accepts a reopen on the deadline itself — the window closes after, not on, the seventh day', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const complaint = world.store.seedComplaint({
      unitId,
      status: 'RESOLVED',
      // The clock starts at 2026-09-08T09:00:00Z; seeding resolvedAt at that same instant makes
      // the seven-day advance land exactly on the deadline, not a week past it.
      resolvedAt: new Date('2026-09-08T09:00:00Z'),
    });
    // Exactly seven days later, to the minute.
    world.clock.advanceMs(7 * 24 * 60 * 60 * 1000);

    const reopened = await expectOk(
      world.service.reopen(
        residentActor(world.store, unitId),
        C.ReopenComplaintInput.parse({ complaintId: complaint.id, reason: 'Last day and the leak is back for certain.' }),
      ),
    );
    expect(reopened.status).toBe('OPEN');
  });

  it('refuses to reopen anything but a resolved complaint, and hides other households\'', async () => {
    const world = harness();
    const { unitId, otherUnitId } = seededWorld(world.store);
    const open = world.store.seedComplaint({ unitId });
    const theirs = world.store.seedComplaint({
      unitId: otherUnitId,
      status: 'RESOLVED',
      resolvedAt: new Date('2026-09-05T09:00:00Z'),
    });

    await expectError(
      world.service.reopen(
        residentActor(world.store, unitId),
        C.ReopenComplaintInput.parse({ complaintId: open.id, reason: 'It was never fixed in the first place.' }),
      ),
      'STATE_NOT_ALLOWED',
    );
    await expectError(
      world.service.reopen(
        residentActor(world.store, unitId),
        C.ReopenComplaintInput.parse({ complaintId: theirs.id, reason: 'Not my complaint to reopen.' }),
      ),
      'NOT_FOUND',
    );
    await expectError(
      world.service.reopen(GUARD, C.ReopenComplaintInput.parse({ complaintId: open.id, reason: 'The gate has no complaints.' })),
      'FORBIDDEN',
    );
  });

  it('reports a race lost between the check and the reopen as a conflict', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const complaint = world.store.seedComplaint({
      unitId,
      status: 'RESOLVED',
      resolvedAt: new Date('2026-09-05T09:00:00Z'),
    });
    world.store.forceNextReopenNull = true;

    await expectError(
      world.service.reopen(
        residentActor(world.store, unitId),
        C.ReopenComplaintInput.parse({ complaintId: complaint.id, reason: 'The committee closed it while I typed.' }),
      ),
      'CONFLICT',
    );
  });
});
