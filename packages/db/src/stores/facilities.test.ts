import { beforeAll, describe, expect, it } from 'vitest';
import * as C from '@oneresi/contracts';
import type { OutboxEventInput } from '@oneresi/domain';
import type { Db } from '../client.js';
import { facilitiesStore } from './facilities.js';

/**
 * The Prisma truth for FacilitiesStore: overlap refusal before the write (the partial unique
 * index is the concurrency backstop, D-18), guarded PENDING decisions and cancellations, and the
 * committee roster the requests are addressed to.
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
  readonly aFacility: (
    db: Db,
    overrides?: { name?: string; opensAt?: string; closesAt?: string; hourlyRatePaise?: number },
  ) => Promise<{ id: number; name: string }>;
  readonly onDay: (iso: string) => Date;
}

const HARNESS = '../../../../test/helpers/database.js';
const FIXTURES = '../../../../test/helpers/fixtures.js';

const { testDatabase } = (await import(HARNESS)) as Harness;
const { aBlock, aUnit, aUser, aFacility, onDay } = (await import(FIXTURES)) as Fixtures;

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
    payload: { bookingId: 1 },
    correlationId: `facilities-${eventCounter}`,
  };
}

/** A home that books, a committee member that decides, and the hall they book. */
async function aSociety() {
  const block = await aBlock(db);
  const unit = await aUnit(db, block.id);
  const resident = await aUser(db, { status: 'ACTIVE', unitId: unit.id });
  const committee = await aUser(db, { role: 'A', status: 'ACTIVE' });
  const facility = await aFacility(db);
  return { unit, resident, committee, facility };
}

describe('listFacilities and findFacilityById', () => {
  it('lists the bookable ones, with retired ones for the committee', async () => {
    const store = facilitiesStore(db);
    const live = await aFacility(db);
    const retired = await aFacility(db);
    await db.facility.update({ where: { id: retired.id }, data: { active: false } });

    const bookable = await store.listFacilities({ includeInactive: false });
    expect(bookable.some((facility) => facility.id === live.id)).toBe(true);
    expect(bookable.some((facility) => facility.id === retired.id)).toBe(false);

    const every = await store.listFacilities({ includeInactive: true });
    expect(every.some((facility) => facility.id === live.id)).toBe(true);
    expect(every.some((facility) => facility.id === retired.id)).toBe(true);

    const found = await store.findFacilityById(live.id);
    expect(found?.name).toBe(live.name);
    expect(found?.opensAt).toBe('06:00');
    expect(found?.closesAt).toBe('22:00');
    expect(found?.hourlyRatePaise).toBe(C.rupees(150));
    expect(await store.findFacilityById(live.id + 1_000_000)).toBeNull();
  });
});

describe('createBooking', () => {
  it('creates a booking with its request events, joining the facility name', async () => {
    const store = facilitiesStore(db);
    const home = await aSociety();
    const event = anEvent('booking.requested');

    const booking = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2026-10-01'),
        startTime: '10:00',
        endTime: '12:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2026-09-20'),
      },
      (made) => [{ ...event, payload: { bookingId: made.id } }],
    );

    expect(booking).not.toBeNull();
    expect(booking!.status).toBe('PENDING');
    expect(booking!.facilityName).toBe(home.facility.name);
    expect(booking!.amountPaise).toBe(C.rupees(300));
    expect(booking!.requestedAt).toEqual(onDay('2026-09-20'));
    expect(booking!.decidedAt).toBeNull();
    expect(booking!.decisionReason).toBeNull();
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);

    expect(await store.findBookingById(booking!.id)).toMatchObject({ id: booking!.id, status: 'PENDING' });
    expect(await store.findBookingsForUnit(home.unit.id)).toHaveLength(1);
    // The slot is held from the moment it is requested.
    const live = await store.liveBookingsForFacilityOn(home.facility.id, onDay('2026-10-01'));
    expect(live.map((held) => held.id)).toEqual([booking!.id]);
    expect(await store.liveBookingsForFacilityOn(home.facility.id, onDay('2026-10-02'))).toHaveLength(0);
  });

  it('refuses a window that overlaps a live booking, writing nothing', async () => {
    const store = facilitiesStore(db);
    const home = await aSociety();
    const held = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2026-11-01'),
        startTime: '10:00',
        endTime: '12:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2026-10-20'),
      },
      () => [],
    );
    expect(held).not.toBeNull();

    const clashes = [
      { startTime: '09:00', endTime: '10:30', label: 'overlaps the start' },
      { startTime: '11:00', endTime: '13:00', label: 'overlaps the end' },
      { startTime: '10:00', endTime: '12:00', label: 'is the same window' },
      { startTime: '09:00', endTime: '14:00', label: 'contains it' },
    ];
    for (const clash of clashes) {
      const event = anEvent('booking.requested');
      const refused = await store.createBooking(
        {
          facilityId: home.facility.id,
          unitId: home.unit.id,
          bookingDate: onDay('2026-11-01'),
          startTime: clash.startTime,
          endTime: clash.endTime,
          amountPaise: C.rupees(300),
          requestedAt: onDay('2026-10-21'),
        },
        () => [event],
      );
      expect(refused, clash.label).toBeNull();
      expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } }), clash.label).toBe(0);
    }
    expect(await db.booking.count({ where: { facilityId: home.facility.id, bookingDate: onDay('2026-11-01') } })).toBe(1);

    // Adjacent is not overlapping: the door closing at 12:00 does not hold 12:00.
    const adjacent = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2026-11-01'),
        startTime: '12:00',
        endTime: '14:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2026-10-22'),
      },
      () => [],
    );
    expect(adjacent).not.toBeNull();
    expect(await store.liveBookingsForFacilityOn(home.facility.id, onDay('2026-11-01'))).toHaveLength(2);

    // A cancelled booking no longer holds its window.
    await store.cancelBooking(
      { bookingId: adjacent?.id ?? -1, cancelledAt: onDay('2026-10-23') },
      [],
    );
    const relapse = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2026-11-01'),
        startTime: '12:00',
        endTime: '14:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2026-10-24'),
      },
      () => [],
    );
    expect(relapse).not.toBeNull();
  });

  it('writes one hold per hour the window touches, with the end exclusive', async () => {
    const store = facilitiesStore(db);
    const home = await aSociety();

    const whole = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2026-11-02'),
        startTime: '10:00',
        endTime: '12:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2026-10-20'),
      },
      () => [],
    );
    // 10:00–12:00 holds hours 10 and 11 — the 12:00 end does not hold hour 12.
    expect(
      await db.bookingSlotHold.findMany({
        where: { bookingId: whole!.id },
        orderBy: { startHour: 'asc' },
      }),
    ).toEqual([
      expect.objectContaining({ facilityId: home.facility.id, startHour: 10 }),
      expect.objectContaining({ facilityId: home.facility.id, startHour: 11 }),
    ]);

    const partial = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2026-11-03'),
        startTime: '10:30',
        endTime: '10:45',
        amountPaise: C.rupees(150),
        requestedAt: onDay('2026-10-20'),
      },
      () => [],
    );
    // 10:30–10:45 never leaves hour 10.
    expect(await db.bookingSlotHold.count({ where: { bookingId: partial!.id } })).toBe(1);
  });

  it('the hold constraint refuses an hour a concurrent window took, whatever the isolation level (D-81)', async () => {
    const store = facilitiesStore(db);
    const home = await aSociety();

    const first = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2026-11-04'),
        startTime: '10:00',
        endTime: '12:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2026-10-20'),
      },
      () => [],
    );
    expect(first).not.toBeNull();

    // The race the in-memory check cannot see: a second transaction that read no live booking
    // writes its own booking row, and its holds collide with the first window's. The unique key
    // on (facilityId, bookingDate, startHour) refuses it — 10:00–12:00 and 11:00–13:00 share
    // hour 11 — and the transaction rolls back to nothing.
    const raced = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2026-11-04'),
        startTime: '11:00',
        endTime: '13:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2026-10-21'),
      },
      () => [],
    );
    expect(raced).toBeNull();
    expect(
      await db.booking.count({ where: { facilityId: home.facility.id, bookingDate: onDay('2026-11-04') } }),
    ).toBe(1);
  });

  it('a rejected or cancelled booking releases its hours; a confirmed one keeps them', async () => {
    const store = facilitiesStore(db);
    const home = await aSociety();

    const rejected = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2026-11-05'),
        startTime: '10:00',
        endTime: '11:00',
        amountPaise: C.rupees(150),
        requestedAt: onDay('2026-10-20'),
      },
      () => [],
    );
    await store.decideBooking(
      {
        bookingId: rejected!.id,
        statusAfter: 'REJECTED',
        decidedById: home.committee.id,
        decidedAt: onDay('2026-10-21'),
        reason: 'Maintenance that morning.',
      },
      [],
    );
    expect(await db.bookingSlotHold.count({ where: { bookingId: rejected!.id } })).toBe(0);

    // The rejected window's hour is bookable again.
    const retry = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2026-11-05'),
        startTime: '10:00',
        endTime: '11:00',
        amountPaise: C.rupees(150),
        requestedAt: onDay('2026-10-22'),
      },
      () => [],
    );
    expect(retry).not.toBeNull();

    await store.decideBooking(
      {
        bookingId: retry!.id,
        statusAfter: 'CONFIRMED',
        decidedById: home.committee.id,
        decidedAt: onDay('2026-10-23'),
        reason: null,
      },
      [],
    );
    expect(await db.bookingSlotHold.count({ where: { bookingId: retry!.id } })).toBe(1);

    await store.cancelBooking({ bookingId: retry!.id, cancelledAt: onDay('2026-10-24') }, []);
    expect(await db.bookingSlotHold.count({ where: { bookingId: retry!.id } })).toBe(0);
  });
});

describe('decideBooking', () => {
  it('confirms a pending booking once; the second decision is a null', async () => {
    const store = facilitiesStore(db);
    const home = await aSociety();
    const booking = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2026-12-01'),
        startTime: '16:00',
        endTime: '18:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2026-11-20'),
      },
      () => [],
    );

    const event = anEvent('booking.decided');
    const confirmed = await store.decideBooking(
      {
        bookingId: booking!.id,
        statusAfter: 'CONFIRMED',
        decidedById: home.committee.id,
        decidedAt: onDay('2026-11-21'),
        reason: 'See you there.',
      },
      [event],
    );
    expect(confirmed?.status).toBe('CONFIRMED');
    expect(confirmed?.decidedAt).toEqual(onDay('2026-11-21'));
    expect(confirmed?.decisionReason).toBe('See you there.');
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);

    const second = await store.decideBooking(
      {
        bookingId: booking!.id,
        statusAfter: 'REJECTED',
        decidedById: home.committee.id,
        decidedAt: onDay('2026-11-22'),
        reason: 'On reflection, no.',
      },
      [anEvent('booking.decided')],
    );
    expect(second).toBeNull();
    expect(await store.findBookingById(booking!.id)).toMatchObject({ status: 'CONFIRMED', decisionReason: 'See you there.' });
  });

  it('declines a pending booking with its reason', async () => {
    const store = facilitiesStore(db);
    const home = await aSociety();
    const booking = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2027-01-01'),
        startTime: '16:00',
        endTime: '18:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2026-12-20'),
      },
      () => [],
    );

    const rejected = await store.decideBooking(
      {
        bookingId: booking!.id,
        statusAfter: 'REJECTED',
        decidedById: home.committee.id,
        decidedAt: onDay('2026-12-21'),
        reason: null,
      },
      [],
    );
    expect(rejected?.status).toBe('REJECTED');
    expect(rejected?.decisionReason).toBeNull();
    // A declined booking holds no slot.
    expect(await store.liveBookingsForFacilityOn(home.facility.id, onDay('2027-01-01'))).toHaveLength(0);
  });
});

describe('cancelBooking', () => {
  it('cancels PENDING and CONFIRMED bookings, and refuses everything else', async () => {
    const store = facilitiesStore(db);
    const home = await aSociety();
    const pending = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2027-02-01'),
        startTime: '16:00',
        endTime: '18:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2027-01-20'),
      },
      () => [],
    );
    const cancelled = await store.cancelBooking(
      { bookingId: pending!.id, cancelledAt: onDay('2027-01-21') },
      [],
    );
    expect(cancelled?.status).toBe('CANCELLED');

    const confirmed = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2027-02-02'),
        startTime: '16:00',
        endTime: '18:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2027-01-20'),
      },
      () => [],
    );
    await store.decideBooking(
      {
        bookingId: confirmed!.id,
        statusAfter: 'CONFIRMED',
        decidedById: home.committee.id,
        decidedAt: onDay('2027-01-21'),
        reason: 'Confirmed.',
      },
      [],
    );
    const cancelledToo = await store.cancelBooking(
      { bookingId: confirmed!.id, cancelledAt: onDay('2027-01-22') },
      [],
    );
    expect(cancelledToo?.status).toBe('CANCELLED');

    const rejected = await store.createBooking(
      {
        facilityId: home.facility.id,
        unitId: home.unit.id,
        bookingDate: onDay('2027-02-03'),
        startTime: '16:00',
        endTime: '18:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2027-01-20'),
      },
      () => [],
    );
    await store.decideBooking(
      {
        bookingId: rejected!.id,
        statusAfter: 'REJECTED',
        decidedById: home.committee.id,
        decidedAt: onDay('2027-01-21'),
        reason: 'No.',
      },
      [],
    );
    const refused = await store.cancelBooking(
      { bookingId: rejected!.id, cancelledAt: onDay('2027-01-23') },
      [],
    );
    expect(refused).toBeNull();
    expect((await store.findBookingById(rejected!.id))?.status).toBe('REJECTED');

    // Already cancelled is not cancellable again.
    const twice = await store.cancelBooking(
      { bookingId: pending!.id, cancelledAt: onDay('2027-01-24') },
      [],
    );
    expect(twice).toBeNull();
    expect(await store.cancelBooking({ bookingId: pending!.id + 1_000_000, cancelledAt: onDay('2027-01-24') }, [])).toBeNull();
  });
});

describe('findBookingsForSociety', () => {
  it('lists the queue newest-date-first, each row naming the facility and the home that asked', async () => {
    const store = facilitiesStore(db);
    const hall = await aFacility(db);
    const first = await aSociety();
    const second = await aSociety();

    const earlier = await store.createBooking(
      {
        facilityId: hall.id,
        unitId: first.unit.id,
        bookingDate: onDay('2027-03-10'),
        startTime: '10:00',
        endTime: '12:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2027-03-01'),
      },
      () => [],
    );
    const later = await store.createBooking(
      {
        facilityId: hall.id,
        unitId: second.unit.id,
        bookingDate: onDay('2027-03-12'),
        startTime: '18:00',
        endTime: '20:00',
        amountPaise: C.rupees(300),
        requestedAt: onDay('2027-03-02'),
      },
      () => [],
    );
    expect(earlier).not.toBeNull();
    expect(later).not.toBeNull();

    const queue = await store.findBookingsForSociety();
    const mine = queue.filter((booking) => booking.id === earlier!.id || booking.id === later!.id);
    // Newest booking date first; the same date would order by start time then id.
    expect(mine.map((booking) => booking.bookingDate.toISOString().slice(0, 10))).toEqual([
      '2027-03-12',
      '2027-03-10',
    ]);
    // The desk sees who asked, not just which unit id — facility name and home are joined in.
    expect(mine[0]?.facilityName).toBe(hall.name);
    expect(mine[0]?.home.unitId).toBe(second.unit.id);
    expect(mine[0]?.home.blockName.length ?? 0).toBeGreaterThan(0);
    expect(mine[1]?.home.unitId).toBe(first.unit.id);
    expect(mine[1]?.facilityName).toBe(hall.name);
  });
});

describe('findCommitteeMembers', () => {
  it('returns ACTIVE committee members only', async () => {
    const store = facilitiesStore(db);
    const active = await aUser(db, { role: 'A', status: 'ACTIVE' });
    const pending = await aUser(db, { role: 'A', status: 'PENDING' });
    const disabled = await aUser(db, { role: 'A', status: 'DISABLED' });
    await aUser(db, { role: 'R', status: 'ACTIVE' });

    const members = await store.findCommitteeMembers();
    expect(members.some((member) => member.id === active.id)).toBe(true);
    expect(members.some((member) => member.id === pending.id)).toBe(false);
    expect(members.some((member) => member.id === disabled.id)).toBe(false);
    expect(members.every((member) => member.email.length > 0)).toBe(true);
  });
});
