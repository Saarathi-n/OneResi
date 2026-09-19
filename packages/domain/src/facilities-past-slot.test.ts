import { describe, expect, it } from 'vitest';
import * as C from '@grihaone/contracts';
import { facilitiesService } from './facilities.js';
import type { Clock } from './clock.js';
import type { FacilitiesStore, StoredBooking, StoredFacility, StoredHome } from './store.js';
import type { Actor } from './ports.js';

class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return this.instant;
  }
}

describe('Facilities Past Slot Rejection on Current Day (Bug 21)', () => {
  const facility: StoredFacility = {
    id: 1,
    name: 'Badminton Court',
    description: 'Indoor court',
    opensAt: '06:00',
    closesAt: '22:00',
    hourlyRatePaise: C.paise(20000),
    active: true,
  };

  const resident: Actor = {
    userId: 5,
    name: 'Resident Five',
    role: 'R',
    unitId: 101,
    email: 'five@society.in',
  };

  const fakeStore: FacilitiesStore = {
    findHome: (unitId: number): Promise<StoredHome | null> =>
      Promise.resolve({
        unitId,
        blockId: 1,
        blockName: 'Tower A',
        label: '101',
        type: 'FLAT_2BHK',
        monthlyChargePaise: C.paise(250000),
        active: true,
      }),
    findResidentsForUnit: () => Promise.resolve([{ id: 5, name: 'Resident Five', email: 'five@society.in' }]),
    findFacilityById: (id: number) => Promise.resolve(id === 1 ? facility : null),
    listFacilities: () => Promise.resolve([facility]),
    createFacility: () => Promise.resolve(null),
    updateFacility: () => Promise.resolve(null),
    findBookingById: () => Promise.resolve(null),
    findBookingsForUnit: () => Promise.resolve([]),
    findBookingsForSociety: () => Promise.resolve([]),
    liveBookingsForFacilityOn: () => Promise.resolve([]),
    findCommitteeMembers: () => Promise.resolve([{ id: 99, name: 'Admin', email: 'admin@society.in' }]),
    createBooking: (input): Promise<StoredBooking | null> =>
      Promise.resolve({
        id: 501,
        facilityId: input.facilityId,
        facilityName: facility.name,
        unitId: input.unitId,
        bookingDate: input.bookingDate,
        startTime: input.startTime,
        endTime: input.endTime,
        status: 'PENDING',
        amountPaise: input.amountPaise,
        decidedAt: null,
        decisionReason: null,
        requestedAt: input.requestedAt,
      }),
    decideBooking: () => Promise.resolve(null),
    cancelBooking: () => Promise.resolve(null),
  };

  it('rejects a past time slot on today in IST', async () => {
    // 2026-09-15T09:00:00.000Z is 14:30 IST on 2026-09-15
    const clock = new FixedClock(new Date('2026-09-15T09:00:00.000Z'));
    const service = facilitiesService({ store: fakeStore, clock });

    // Try booking 10:00 to 12:00 on 2026-09-15 (earlier today)
    const pastSlot = await service.request(
      resident,
      C.RequestBookingInput.parse({
        facilityId: 1,
        bookingDate: '2026-09-15',
        startTime: '10:00',
        endTime: '12:00',
      }),
    );

    expect(pastSlot.ok).toBe(false);
    if (!pastSlot.ok) {
      expect(pastSlot.error.code).toBe('WINDOW_CLOSED');
      expect(pastSlot.error.message).toContain('already passed');
    }
  });

  it('rejects a slot that started 15 minutes ago on today in IST', async () => {
    // 2026-09-15T09:00:00.000Z is 14:30 IST
    const clock = new FixedClock(new Date('2026-09-15T09:00:00.000Z'));
    const service = facilitiesService({ store: fakeStore, clock });

    // Try booking 14:00 to 15:00 on 2026-09-15 (started 30 mins ago)
    const pastSlot = await service.request(
      resident,
      C.RequestBookingInput.parse({
        facilityId: 1,
        bookingDate: '2026-09-15',
        startTime: '14:00',
        endTime: '15:00',
      }),
    );

    expect(pastSlot.ok).toBe(false);
    if (!pastSlot.ok) {
      expect(pastSlot.error.code).toBe('WINDOW_CLOSED');
      expect(pastSlot.error.message).toContain('already passed');
    }
  });

  it('allows booking a future time slot on today in IST', async () => {
    // 2026-09-15T09:00:00.000Z is 14:30 IST
    const clock = new FixedClock(new Date('2026-09-15T09:00:00.000Z'));
    const service = facilitiesService({ store: fakeStore, clock });

    // Try booking 16:00 to 18:00 on 2026-09-15
    const futureSlot = await service.request(
      resident,
      C.RequestBookingInput.parse({
        facilityId: 1,
        bookingDate: '2026-09-15',
        startTime: '16:00',
        endTime: '18:00',
      }),
    );

    expect(futureSlot.ok).toBe(true);
    if (futureSlot.ok) {
      expect(futureSlot.value.id).toBe(501);
      expect(futureSlot.value.startTime).toBe('16:00');
    }
  });

  it('allows booking a morning time slot for tomorrow', async () => {
    // 2026-09-15T09:00:00.000Z is 14:30 IST
    const clock = new FixedClock(new Date('2026-09-15T09:00:00.000Z'));
    const service = facilitiesService({ store: fakeStore, clock });

    // Tomorrow at 10:00 is in the future
    const tomorrowSlot = await service.request(
      resident,
      C.RequestBookingInput.parse({
        facilityId: 1,
        bookingDate: '2026-09-16',
        startTime: '10:00',
        endTime: '12:00',
      }),
    );

    expect(tomorrowSlot.ok).toBe(true);
  });
});
