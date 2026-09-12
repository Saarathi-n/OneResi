import { beforeAll, describe, expect, it } from 'vitest';
import type { OutboxEventInput } from '@grihaone/domain';
import type { Db } from '../client.js';
import { complaintStore } from './complaints.js';

/**
 * The Prisma truth for ComplaintStore: the state machine is applied by guarded transitions
 * (D-20's resolvedAt/reopenCount rules), photo keys cross as an array, and every change lands
 * with its attributed update row and its mail in one transaction.
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
  ) => Promise<{ id: number; name: string }>;
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
    payload: { complaintId: 1 },
    correlationId: `complaints-${eventCounter}`,
  };
}

/** A household with a resident to raise complaints and a committee member to answer them. */
async function aHousehold() {
  const block = await aBlock(db);
  const unit = await aUnit(db, block.id);
  const resident = await aUser(db, { status: 'ACTIVE', unitId: unit.id });
  const committee = await aUser(db, { role: 'A', status: 'ACTIVE' });
  return { unit, resident, committee };
}

describe('createComplaint', () => {
  it('stores a complaint with its photos and acknowledgement events', async () => {
    const store = complaintStore(db);
    const home = await aHousehold();
    const event = anEvent('complaint.raised');

    const complaint = await store.createComplaint(
      {
        unitId: home.unit.id,
        category: 'PLUMBING',
        priority: 'HIGH',
        description: 'The kitchen tap will not stop dripping.',
        photoKeys: ['photos/kitchen-1.jpg', 'photos/kitchen-2.jpg'],
        raisedAt: onDay('2026-09-01'),
      },
      (raised) => [{ ...event, payload: { complaintId: raised.id } }],
    );

    expect(complaint.status).toBe('OPEN');
    expect(complaint.category).toBe('PLUMBING');
    expect(complaint.priority).toBe('HIGH');
    expect(complaint.raisedAt).toEqual(onDay('2026-09-01'));
    expect(complaint.resolvedAt).toBeNull();
    expect(complaint.reopenCount).toBe(0);
    expect(complaint.updates).toEqual([]);
    // The keys cross as an array and come back as one, in order.
    expect(complaint.photoKeys).toEqual(['photos/kitchen-1.jpg', 'photos/kitchen-2.jpg']);
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);

    const reread = await store.findComplaintById(complaint.id);
    expect(reread?.photoKeys).toEqual(['photos/kitchen-1.jpg', 'photos/kitchen-2.jpg']);

    // A complaint with no photos is an empty array, not a stray separator.
    const bare = await store.createComplaint(
      {
        unitId: home.unit.id,
        category: 'OTHER',
        priority: 'LOW',
        description: 'A note for the office.',
        photoKeys: [],
        raisedAt: onDay('2026-09-02'),
      },
      () => [],
    );
    expect(bare.photoKeys).toEqual([]);
  });
});

describe('the lists', () => {
  it('the household reads its own newest first; the desk narrows by status', async () => {
    const store = complaintStore(db);
    const home = await aHousehold();
    const first = await store.createComplaint(
      {
        unitId: home.unit.id,
        category: 'CIVIL',
        priority: 'LOW',
        description: 'A crack in the lobby ceiling.',
        photoKeys: [],
        raisedAt: onDay('2026-09-03'),
      },
      () => [],
    );
    const second = await store.createComplaint(
      {
        unitId: home.unit.id,
        category: 'SECURITY',
        priority: 'URGENT',
        description: 'The gate intercom is silent.',
        photoKeys: [],
        raisedAt: onDay('2026-09-05'),
      },
      () => [],
    );
    await store.applyComplaintUpdate(
      {
        complaintId: second.id,
        statusAfter: 'IN_PROGRESS',
        updatedById: home.committee.id,
        note: 'Technician visited.',
        at: onDay('2026-09-06'),
      },
      [anEvent('complaint.updated')],
    );

    // The household list is newest first, with the joined update trail.
    const forUnit = await store.findComplaintsForUnit(home.unit.id);
    expect(forUnit.map((complaint) => complaint.id)).toEqual([second.id, first.id]);
    expect(forUnit[0]!.updates).toHaveLength(1);
    expect(forUnit[0]!.updates[0]!.statusAfter).toBe('IN_PROGRESS');
    // The attribution joins the acting identity's name (UC-20 step 3).
    expect(forUnit[0]!.updates[0]!.updatedByName).toBe(home.committee.name);

    // The desk can narrow; an absent status means not narrowed.
    const openOnly = await store.findComplaintsForSociety({ status: 'OPEN' });
    expect(openOnly.every((complaint) => complaint.status === 'OPEN')).toBe(true);
    expect(openOnly.some((complaint) => complaint.id === first.id)).toBe(true);
    expect(openOnly.some((complaint) => complaint.id === second.id)).toBe(false);

    const everything = await store.findComplaintsForSociety({});
    expect(everything.some((complaint) => complaint.id === first.id)).toBe(true);
    expect(everything.some((complaint) => complaint.id === second.id)).toBe(true);
  });
});

describe('applyComplaintUpdate', () => {
  it('applies permitted transitions, stamping resolvedAt only on the way into RESOLVED', async () => {
    const store = complaintStore(db);
    const home = await aHousehold();
    const complaint = await store.createComplaint(
      {
        unitId: home.unit.id,
        category: 'ELECTRICAL',
        priority: 'MEDIUM',
        description: 'The corridor light flickers.',
        photoKeys: [],
        raisedAt: onDay('2026-09-07'),
      },
      () => [],
    );

    // OPEN -> IN_PROGRESS: no timestamp anywhere near it (D-20).
    const started = await store.applyComplaintUpdate(
      {
        complaintId: complaint.id,
        statusAfter: 'IN_PROGRESS',
        updatedById: home.committee.id,
        note: 'Fault traced to the timer relay.',
        at: onDay('2026-09-08'),
      },
      [anEvent('complaint.updated')],
    );
    expect(started?.status).toBe('IN_PROGRESS');
    expect(started?.resolvedAt).toBeNull();
    expect(started?.updates).toHaveLength(1);
    expect(started?.updates[0]!.note).toBe('Fault traced to the timer relay.');

    // IN_PROGRESS -> RESOLVED: the one transition that stamps resolvedAt.
    const resolved = await store.applyComplaintUpdate(
      {
        complaintId: complaint.id,
        statusAfter: 'RESOLVED',
        updatedById: home.committee.id,
        note: 'Relay replaced.',
        at: onDay('2026-09-10'),
      },
      [anEvent('complaint.updated')],
    );
    expect(resolved?.status).toBe('RESOLVED');
    expect(resolved?.resolvedAt).toEqual(onDay('2026-09-10'));
    expect(resolved?.updates).toHaveLength(2);

    // The resident's reopen via the same seam: resolvedAt cleared, reopenCount advanced.
    const reopened = await store.applyComplaintUpdate(
      {
        complaintId: complaint.id,
        statusAfter: 'OPEN',
        updatedById: home.resident.id,
        note: 'It flickers again at night.',
        at: onDay('2026-09-12'),
      },
      [anEvent('complaint.reopened')],
    );
    expect(reopened?.status).toBe('OPEN');
    expect(reopened?.resolvedAt).toBeNull();
    expect(reopened?.reopenCount).toBe(1);
    expect(reopened?.updates).toHaveLength(3);
    expect(reopened?.updates[2]!.updatedByName).toBe(home.resident.name);
  });

  it('refuses a transition the machine does not permit, and an unknown id, changing nothing', async () => {
    const store = complaintStore(db);
    const home = await aHousehold();
    const complaint = await store.createComplaint(
      {
        unitId: home.unit.id,
        category: 'COMMON_AREA',
        priority: 'LOW',
        description: 'The lift mirror is cracked.',
        photoKeys: [],
        raisedAt: onDay('2026-09-13'),
      },
      () => [],
    );
    await store.applyComplaintUpdate(
      {
        complaintId: complaint.id,
        statusAfter: 'CLOSED',
        updatedById: home.committee.id,
        note: 'Out of scope for the society.',
        at: onDay('2026-09-14'),
      },
      [],
    );
    const closedAt = onDay('2026-09-15');

    // CLOSED admits nothing — not even CLOSED again.
    const event = anEvent('complaint.updated');
    const refused = await store.applyComplaintUpdate(
      {
        complaintId: complaint.id,
        statusAfter: 'IN_PROGRESS',
        updatedById: home.committee.id,
        note: 'Let me reopen this.',
        at: closedAt,
      },
      [event],
    );
    expect(refused).toBeNull();
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(0);
    const still = await store.findComplaintById(complaint.id);
    expect(still?.status).toBe('CLOSED');
    expect(still?.updates).toHaveLength(1);

    const unknown = await store.applyComplaintUpdate(
      {
        complaintId: complaint.id + 1_000_000,
        statusAfter: 'IN_PROGRESS',
        updatedById: home.committee.id,
        note: 'Anything.',
        at: closedAt,
      },
      [],
    );
    expect(unknown).toBeNull();
  });
});

describe('reopenComplaint', () => {
  it('reopens a RESOLVED complaint with the reason attributed; anything else is a null', async () => {
    const store = complaintStore(db);
    const home = await aHousehold();
    const complaint = await store.createComplaint(
      {
        unitId: home.unit.id,
        category: 'PLUMBING',
        priority: 'HIGH',
        description: 'The bathroom drain is slow.',
        photoKeys: [],
        raisedAt: onDay('2026-09-16'),
      },
      () => [],
    );
    await store.applyComplaintUpdate(
      {
        complaintId: complaint.id,
        statusAfter: 'RESOLVED',
        updatedById: home.committee.id,
        note: 'Drain cleared.',
        at: onDay('2026-09-17'),
      },
      [],
    );

    const event = anEvent('complaint.reopened');
    const reopened = await store.reopenComplaint(
      {
        complaintId: complaint.id,
        reopenedById: home.resident.id,
        reason: 'It is slow again after two days.',
        at: onDay('2026-09-19'),
      },
      [event],
    );
    expect(reopened?.status).toBe('OPEN');
    expect(reopened?.resolvedAt).toBeNull();
    expect(reopened?.reopenCount).toBe(1);
    expect(reopened?.updates).toHaveLength(2);
    expect(reopened?.updates[1]!.note).toBe('It is slow again after two days.');
    expect(reopened?.updates[1]!.updatedByName).toBe(home.resident.name);
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);

    // Not RESOLVED any more — the resident's own reopen is not repeatable.
    const second = await store.reopenComplaint(
      {
        complaintId: complaint.id,
        reopenedById: home.resident.id,
        reason: 'Once more.',
        at: onDay('2026-09-20'),
      },
      [anEvent('complaint.reopened')],
    );
    expect(second).toBeNull();
    expect(await store.findComplaintById(complaint.id)).toMatchObject({ status: 'OPEN', reopenCount: 1 });
  });
});
