import { beforeAll, describe, expect, it } from 'vitest';
import type { OutboxEventInput } from '@oneresi/domain';
import type { Db } from '../client.js';
import { visitorStore } from './visitors.js';

/**
 * The Prisma truth for VisitorStore: the joined reads (creator name, enteredAt/exitedAt from the
 * log) the port promises, the guarded pass transitions, the walk-in queue, and the outbox
 * atomicity on every mutation.
 */

interface Harness {
  readonly testDatabase: () => Promise<{ db: Db; provider: 'sqlite' | 'postgresql' }>;
}
interface Fixtures {
  readonly aBlock: (db: Db, name?: string) => Promise<{ id: number }>;
  readonly aUnit: (
    db: Db,
    blockId: number,
    overrides?: { label?: string; type?: string; monthlyChargePaise?: number },
  ) => Promise<{ id: number }>;
  readonly aUser: (
    db: Db,
    overrides?: { role?: string; status?: string; unitId?: number; email?: string },
  ) => Promise<{ id: number }>;
  readonly onDay: (iso: string) => Date;
}

const HARNESS = '../../../../test/helpers/database.js';
const FIXTURES = '../../../../test/helpers/fixtures.js';

const { testDatabase } = (await import(HARNESS)) as Harness;
const { aBlock, aUnit, aUser, onDay } = (await import(FIXTURES)) as Fixtures;

let db: Db;

beforeAll(async () => {
  db = (await testDatabase()).db;
});

let eventCounter = 0;
function anEvent(type: OutboxEventInput['type']): OutboxEventInput {
  eventCounter += 1;
  return {
    type,
    channel: 'IN_APP',
    payload: { visitorName: 'Meera', unitId: 1 },
    correlationId: `corr-${eventCounter}`,
  };
}

async function aPassContext() {
  const block = await aBlock(db);
  const unit = await aUnit(db, block.id);
  const resident = await aUser(db, { status: 'ACTIVE', unitId: unit.id });
  const staff = await aUser(db, { role: 'S', status: 'ACTIVE' });
  return { unit, resident, staff };
}

describe('createPass', () => {
  it('stores the pass and joins the creator name and empty timestamps into the read', async () => {
    const store = visitorStore(db);
    const { unit, staff } = await aPassContext();
    const validOn = onDay('2026-09-10');
    const event = anEvent('pass.created');

    const pass = await store.createPass(
      {
        unitId: unit.id,
        createdById: staff.id,
        visitorName: 'Meera Iyer',
        purpose: 'Family visit',
        code: 'VPASS-AAA111',
        validOn,
        createdAt: onDay('2026-09-08'),
      },
      [event],
    );
    if (pass === null) throw new Error('pass creation failed');

    expect(pass.visitorName).toBe('Meera Iyer');
    expect(pass.code).toBe('VPASS-AAA111');
    expect(pass.validOn.toISOString()).toBe(validOn.toISOString());

    // The joined read: creator's name and the log timestamps, in one query, no N+1.
    const byCode = await store.findPassByCode('VPASS-AAA111');
    expect(byCode?.id).toBe(pass.id);
    expect(byCode?.createdByName).toBe((await db.residentUser.findUniqueOrThrow({ where: { id: staff.id } })).name);
    expect(byCode?.createdById).toBe(staff.id);
    expect(byCode?.enteredAt).toBeNull();
    expect(byCode?.exitedAt).toBeNull();

    const byId = await store.findPassById(pass.id);
    expect(byId?.code).toBe('VPASS-AAA111');

    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);
    expect(await store.findPassByCode('VPASS-ZZZ999')).toBeNull();
  });

  it('returns null on a taken code and writes nothing — not even the events', async () => {
    const store = visitorStore(db);
    const { unit, staff } = await aPassContext();
    const first = await store.createPass(
      {
        unitId: unit.id,
        createdById: staff.id,
        visitorName: 'First',
        purpose: 'Visit',
        code: 'VPASS-DUP777',
        validOn: onDay('2026-09-10'),
        createdAt: onDay('2026-09-08'),
      },
      [],
    );
    expect(first).not.toBeNull();

    const event = anEvent('pass.created');
    const second = await store.createPass(
      {
        unitId: unit.id,
        createdById: staff.id,
        visitorName: 'Second',
        purpose: 'Visit',
        code: 'VPASS-DUP777',
        validOn: onDay('2026-09-11'),
        createdAt: onDay('2026-09-08'),
      },
      [event],
    );

    // A duplicate natural key is a null with nothing committed: no pass, no events (D-29).
    expect(second).toBeNull();
    expect(await db.visitorPass.count({ where: { code: 'VPASS-DUP777' } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(0);
  });
});

describe('findPassesForUnit', () => {
  it('filters by validOn and statuses, ordered, and only this unit', async () => {
    const store = visitorStore(db);
    const { unit, staff } = await aPassContext();
    const other = await aUnit(db, (await aBlock(db)).id);

    // A pass is born ACTIVE through the port, so the other statuses are seeded as rows — this is
    // a database test, and the filter is what is under test, not the transitions.
    const mk = (code: string, validOn: string, status: 'ACTIVE' | 'USED' | 'CANCELLED') =>
      db.visitorPass.create({
        data: {
          unitId: unit.id,
          createdById: staff.id,
          visitorName: 'V',
          purpose: 'Visit',
          code,
          validOn: onDay(validOn),
          status,
          createdAt: onDay('2026-09-08'),
        },
      });
    const monday = await mk('VPASS-MON1', '2026-09-07', 'ACTIVE');
    const mondayUsed = await mk('VPASS-MON2', '2026-09-07', 'USED');
    const tuesday = await mk('VPASS-TUE1', '2026-09-08', 'ACTIVE');
    const cancelled = await mk('VPASS-CXL1', '2026-09-08', 'CANCELLED');
    await db.visitorPass.create({
      data: {
        unitId: other.id,
        createdById: staff.id,
        visitorName: 'Elsewhere',
        purpose: 'Visit',
        code: 'VPASS-OTH1',
        validOn: onDay('2026-09-08'),
        status: 'ACTIVE',
        createdAt: onDay('2026-09-08'),
      },
    });

    const all = await store.findPassesForUnit(unit.id, {});
    expect(all.map((p) => p.code)).toEqual(['VPASS-MON1', 'VPASS-MON2', 'VPASS-TUE1', 'VPASS-CXL1']);

    const mondayOnly = await store.findPassesForUnit(unit.id, { validOn: onDay('2026-09-07') });
    expect(mondayOnly.map((p) => p.code)).toEqual(['VPASS-MON1', 'VPASS-MON2']);

    const live = await store.findPassesForUnit(unit.id, { statuses: ['ACTIVE', 'USED'] });
    expect(live.map((p) => p.id)).toEqual([monday?.id, mondayUsed?.id, tuesday?.id]);

    const narrow = await store.findPassesForUnit(unit.id, {
      validOn: onDay('2026-09-08'),
      statuses: ['ACTIVE'],
    });
    expect(narrow.map((p) => p.code)).toEqual(['VPASS-TUE1']);
    expect(narrow.map((p) => p.createdByName)).toEqual([
      (await db.residentUser.findUniqueOrThrow({ where: { id: staff.id } })).name,
    ]);
    expect(cancelled).not.toBeNull();
  });
});

describe('cancelPass', () => {
  it('moves ACTIVE to CANCELLED with its events, and a second cancel is a null', async () => {
    const store = visitorStore(db);
    const { unit, staff } = await aPassContext();
    const pass = await store.createPass(
      {
        unitId: unit.id,
        createdById: staff.id,
        visitorName: 'Ravi',
        purpose: 'Delivery',
        code: 'VPASS-CNL9',
        validOn: onDay('2026-09-10'),
        createdAt: onDay('2026-09-08'),
      },
      [],
    );
    if (pass === null) throw new Error('pass creation failed');
    // No outbox type exists for a cancellation yet; any type proves the row lands in the same
    // transaction as the change, which is what this test is about.
    const event = anEvent('pass.created');

    const cancelled = await store.cancelPass(pass.id, onDay('2026-09-09'), [event]);
    expect(cancelled?.status).toBe('CANCELLED');
    expect((await store.findPassById(pass.id))?.status).toBe('CANCELLED');
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);

    // The timestamp landed with the status in the same guarded write — the port's read model
    // does not expose cancelledAt, so this is asserted on the row.
    const row = await db.visitorPass.findUniqueOrThrow({ where: { id: pass.id } });
    expect(row.cancelledAt?.toISOString()).toBe(onDay('2026-09-09').toISOString());

    const second = await store.cancelPass(pass.id, onDay('2026-09-09'), [anEvent('pass.created')]);
    expect(second).toBeNull();
    expect(
      await db.outboxEvent.count({ where: { correlationId: `corr-${eventCounter}` } }),
    ).toBe(0);
  });
});

describe('checkInPass and checkOutPass', () => {
  async function aLivePass() {
    const store = visitorStore(db);
    const { unit, staff } = await aPassContext();
    const pass = await store.createPass(
      {
        unitId: unit.id,
        createdById: staff.id,
        visitorName: 'Guest',
        purpose: 'Visit',
        code: `VPASS-IN-${unit.id}`,
        validOn: onDay('2026-09-10'),
        createdAt: onDay('2026-09-08'),
      },
      [],
    );
    if (pass === null) throw new Error('pass creation failed');
    return { store, pass, unit };
  }

  it('marks the pass USED, writes the log row and events, and reports enteredAt', async () => {
    const { store, pass, unit } = await aLivePass();
    const event = anEvent('visitor.arrived');
    const at = onDay('2026-09-10');
    const guard = await aUser(db, { role: 'S', status: 'ACTIVE' });

    const checkedIn = await store.checkInPass(
      { passId: pass.id, at, idempotencyKey: 'gate-1' },
      {
        passId: pass.id,
        unitId: unit.id,
        walkInName: null,
        walkInPhone: null,
        walkInPurpose: null,
        approvalStatus: 'APPROVED',
        decidedById: guard.id,
        decidedAt: at,
        overrideReason: null,
        enteredAt: at,
        createdAt: at,
      },
      [event],
    );

    expect(checkedIn?.status).toBe('USED');
    expect(checkedIn?.enteredAt?.toISOString()).toBe(at.toISOString());

    // The join reads the log back through the pass.
    const reread = await store.findPassById(pass.id);
    expect(reread?.enteredAt?.toISOString()).toBe(at.toISOString());
    expect(reread?.exitedAt).toBeNull();

    // The idempotency key is persisted on the log row — it is what a retried check-in is
    // recognized by (D-40).
    const logRow = await db.visitorLog.findUniqueOrThrow({ where: { idempotencyKey: 'gate-1' } });
    expect(logRow.passId).toBe(pass.id);
    expect(await db.visitorLog.count({ where: { passId: pass.id } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);
  });

  it('acknowledges a retried check-in by its key — the pass again, nothing written', async () => {
    const { store, pass, unit } = await aLivePass();
    const at = onDay('2026-09-10');
    const guard = await aUser(db, { role: 'S', status: 'ACTIVE' });
    const logInput = {
      passId: pass.id,
      unitId: unit.id,
      walkInName: null,
      walkInPhone: null,
      walkInPurpose: null,
      approvalStatus: 'APPROVED' as const,
      decidedById: guard.id,
      decidedAt: at,
      overrideReason: null,
      enteredAt: at,
      createdAt: at,
    };
    const first = await store.checkInPass(
      { passId: pass.id, at, idempotencyKey: 'gate-retry' },
      logInput,
      [anEvent('visitor.arrived')],
    );
    expect(first).not.toBeNull();

    // The retry: the gate re-sends the same check-in with the same key. The answer is the pass as
    // it now stands — not a null, and not a second log row or event.
    const event = anEvent('visitor.arrived');
    const retried = await store.checkInPass(
      { passId: pass.id, at, idempotencyKey: 'gate-retry' },
      logInput,
      [event],
    );
    expect(retried?.id).toBe(pass.id);
    expect(retried?.status).toBe('USED');
    expect(await db.visitorLog.count({ where: { passId: pass.id } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(0);
  });

  it('refuses a second check-in with nothing written — the guard is the idempotency', async () => {
    const { store, pass, unit } = await aLivePass();
    const at = onDay('2026-09-10');
    const guard = await aUser(db, { role: 'S', status: 'ACTIVE' });
    const logInput = {
      passId: pass.id,
      unitId: unit.id,
      walkInName: null,
      walkInPhone: null,
      walkInPurpose: null,
      approvalStatus: 'APPROVED' as const,
      decidedById: guard.id,
      decidedAt: at,
      overrideReason: null,
      enteredAt: at,
      createdAt: at,
    };
    const first = await store.checkInPass({ passId: pass.id, at, idempotencyKey: 'a' }, logInput, []);
    expect(first).not.toBeNull();

    const event = anEvent('visitor.arrived');
    const second = await store.checkInPass(
      { passId: pass.id, at, idempotencyKey: 'b' },
      logInput,
      [event],
    );
    expect(second).toBeNull();
    expect(await db.visitorLog.count({ where: { passId: pass.id } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(0);
  });

  it('check-out stamps the open log row and returns it; a second check-out is a null', async () => {
    const { store, pass, unit } = await aLivePass();
    const inAt = onDay('2026-09-10');
    const outAt = new Date(onDay('2026-09-10').getTime() + 3 * 60 * 60 * 1000);
    const guard = await aUser(db, { role: 'S', status: 'ACTIVE' });
    await store.checkInPass(
      { passId: pass.id, at: inAt, idempotencyKey: 'gate-out-1' },
      {
        passId: pass.id,
        unitId: unit.id,
        walkInName: null,
        walkInPhone: null,
        walkInPurpose: null,
        approvalStatus: 'APPROVED',
        decidedById: guard.id,
        decidedAt: inAt,
        overrideReason: null,
        enteredAt: inAt,
        createdAt: inAt,
      },
      [],
    );

    const out = await store.checkOutPass(pass.id, outAt);
    expect(out?.exitedAt?.toISOString()).toBe(outAt.toISOString());

    // The pass's joined read now shows both timestamps.
    const passRow = await store.findPassById(pass.id);
    expect(passRow?.enteredAt?.toISOString()).toBe(inAt.toISOString());
    expect(passRow?.exitedAt?.toISOString()).toBe(outAt.toISOString());

    expect(await store.checkOutPass(pass.id, outAt)).toBeNull();
    expect(await store.checkOutPass(pass.id + 100_000, outAt)).toBeNull();
  });

  it('a pass that was never checked in has no open entry to close', async () => {
    const { store, pass } = await aLivePass();
    expect(await store.checkOutPass(pass.id, onDay('2026-09-10'))).toBeNull();
    expect(await store.checkOutPass(pass.id + 100_000, onDay('2026-09-10'))).toBeNull();
  });
});

describe('the walk-in queue', () => {
  it('creates a PENDING walk-in with its events, and the queue is oldest-first for one unit', async () => {
    const store = visitorStore(db);
    const block = await aBlock(db);
    const unit = await aUnit(db, block.id);
    const otherUnit = await aUnit(db, block.id);
    const event = anEvent('walkin.awaiting_decision');

    const early = await store.createWalkInLog(
      {
        passId: null,
        unitId: unit.id,
        walkInName: 'Plumber',
        walkInPhone: '+919876500010',
        walkInPurpose: 'Repair',
        approvalStatus: 'PENDING',
        decidedById: null,
        decidedAt: null,
        overrideReason: null,
        enteredAt: null,
        createdAt: onDay('2026-09-08'),
      },
      [event],
    );
    if (early === null) throw new Error('walk-in creation failed');
    const late = await store.createWalkInLog(
      {
        passId: null,
        unitId: unit.id,
        walkInName: 'Electrician',
        walkInPhone: '+919876500011',
        walkInPurpose: 'Repair',
        approvalStatus: 'PENDING',
        decidedById: null,
        decidedAt: null,
        overrideReason: null,
        enteredAt: null,
        createdAt: onDay('2026-09-08'),
      },
      [],
    );
    if (late === null) throw new Error('walk-in creation failed');
    await store.createWalkInLog(
      {
        passId: null,
        unitId: otherUnit.id,
        walkInName: 'Other unit',
        walkInPhone: '+919876500012',
        walkInPurpose: 'Visit',
        approvalStatus: 'PENDING',
        decidedById: null,
        decidedAt: null,
        overrideReason: null,
        enteredAt: null,
        createdAt: onDay('2026-09-08'),
      },
      [],
    );

    expect(early.approvalStatus).toBe('PENDING');
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);

    const queue = await store.findPendingWalkIns(unit.id);
    expect(queue.map((log) => log.id)).toEqual([early.id, late.id]);

    const found = await store.findLogById(early.id);
    expect(found?.walkInName).toBe('Plumber');
    expect(await store.findLogById(early.id + 100_000)).toBeNull();
  });

  it('decides a walk-in once; the second decision is a null', async () => {
    const store = visitorStore(db);
    const unit = await aUnit(db, (await aBlock(db)).id);
    const guard = await aUser(db, { role: 'S', status: 'ACTIVE' });
    const log = await store.createWalkInLog(
      {
        passId: null,
        unitId: unit.id,
        walkInName: 'Salesman',
        walkInPhone: '+919876500013',
        walkInPurpose: 'Sales',
        approvalStatus: 'PENDING',
        decidedById: null,
        decidedAt: null,
        overrideReason: null,
        enteredAt: null,
        createdAt: onDay('2026-09-08'),
      },
      [],
    );
    if (log === null) throw new Error('walk-in creation failed');
    const at = onDay('2026-09-10');
    const event = anEvent('walkin.decided');

    const decided = await store.decideWalkInLog(
      { logId: log.id, approvalStatus: 'APPROVED', decidedById: guard.id, decidedAt: at },
      [event],
    );
    expect(decided?.approvalStatus).toBe('APPROVED');
    expect(decided?.decidedById).toBe(guard.id);
    expect(decided?.decidedAt?.toISOString()).toBe(at.toISOString());
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);

    // PENDING is gone; the guard fails and nothing else is written.
    const second = await store.decideWalkInLog(
      { logId: log.id, approvalStatus: 'REJECTED', decidedById: guard.id, decidedAt: at },
      [anEvent('walkin.decided')],
    );
    expect(second).toBeNull();
    expect((await store.findLogById(log.id))?.approvalStatus).toBe('APPROVED');
    expect(
      await db.outboxEvent.count({ where: { correlationId: `corr-${eventCounter}` } }),
    ).toBe(0);

    // And the decided walk-in is no longer pending.
    expect(await store.findPendingWalkIns(unit.id)).toHaveLength(0);
  });
});

describe('findResidentsForUnit', () => {
  it('returns ACTIVE residents of the unit only, by id', async () => {
    const store = visitorStore(db);
    const block = await aBlock(db);
    const unit = await aUnit(db, block.id);
    const otherUnit = await aUnit(db, block.id);
    const active = await aUser(db, { status: 'ACTIVE', unitId: unit.id });
    const alsoActive = await aUser(db, { status: 'ACTIVE', unitId: unit.id });
    await aUser(db, { status: 'PENDING', unitId: unit.id });
    await aUser(db, { status: 'ACTIVE', unitId: otherUnit.id });

    const residents = await store.findResidentsForUnit(unit.id);
    expect(residents.map((r) => r.id)).toEqual([active.id, alsoActive.id]);
    for (const resident of residents) {
      expect(Object.keys(resident).sort()).toEqual(['email', 'id', 'name']);
    }
  });
});
