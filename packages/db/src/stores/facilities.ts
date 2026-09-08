import * as C from '@oneresi/contracts';
import type { Db, Prisma } from '../client.js';
import type { FacilitiesStore } from '@oneresi/domain';
import {
  bookingInclude,
  isUniqueViolation,
  sharedLookups,
  toBooking,
  toFacility,
  toHome,
  unitInclude,
  writeEvents,
} from './shared.js';

/**
 * FacilitiesStore over Prisma: the bookable list, the slots a facility is holding, and the
 * booking lifecycle. A booking request is refused inside the write when its window overlaps a
 * live one — the partial unique index over live bookings is what makes the exact-start case
 * true under concurrency; this check is what makes every overlapping case refuse kindly (D-18).
 */

/** `HH:MM` as minutes since midnight, so windows compare as numbers. */
function minutesOf(clockTime: string): number {
  return Number(clockTime.slice(0, 2)) * 60 + Number(clockTime.slice(3, 5));
}

/** Two windows overlap when each starts before the other ends. */
function overlaps(
  a: { readonly startTime: string; readonly endTime: string },
  b: { readonly startTime: string; readonly endTime: string },
): boolean {
  return minutesOf(a.startTime) < minutesOf(b.endTime) && minutesOf(a.endTime) > minutesOf(b.startTime);
}

/**
 * The society's booking queue: the facility name, and the home that asked, joined — the desk
 * sees who requested and not just which unit id.
 */
const SOCIETY_BOOKING_INCLUDE = {
  facility: { select: { name: true } },
  unit: { include: unitInclude },
} satisfies Prisma.BookingInclude;

export function facilitiesStore(db: Db): FacilitiesStore {
  const store: FacilitiesStore = {
    ...sharedLookups(db),

    async findFacilityById(id) {
      const row = await db.facility.findUnique({ where: { id } });
      return row === null ? null : toFacility(row);
    },

    async listFacilities(input) {
      // Residents see what they can book; the committee's desk also manages retired facilities
      // (UC-22, D-27).
      const rows = await db.facility.findMany({
        where: input.includeInactive ? {} : { active: true },
        orderBy: { id: 'asc' },
      });
      return rows.map(toFacility);
    },

    async findBookingById(id) {
      const row = await db.booking.findUnique({ where: { id }, include: bookingInclude });
      return row === null ? null : toBooking(row);
    },

    async findBookingsForUnit(unitId) {
      const rows = await db.booking.findMany({
        where: { unitId },
        include: bookingInclude,
        orderBy: [{ bookingDate: 'desc' }, { startTime: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toBooking);
    },

    async findBookingsForSociety() {
      const rows = await db.booking.findMany({
        include: SOCIETY_BOOKING_INCLUDE,
        orderBy: [{ bookingDate: 'desc' }, { startTime: 'asc' }, { id: 'asc' }],
      });
      return rows.map((row) => ({ ...toBooking(row), home: toHome(row.unit) }));
    },

    async liveBookingsForFacilityOn(facilityId, on) {
      // PENDING and CONFIRMED — the two states that hold a slot, read against the partial
      // unique index's own definition of "live" (D-18).
      const rows = await db.booking.findMany({
        where: { facilityId, bookingDate: on, status: { in: [...C.LIVE_BOOKING_STATUSES] } },
        include: bookingInclude,
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toBooking);
    },

    async findCommitteeMembers() {
      // ACTIVE committee members — the people a booking request is addressed to.
      return db.residentUser.findMany({
        where: { role: 'A', status: 'ACTIVE' },
        select: { id: true, name: true, email: true },
        orderBy: { id: 'asc' },
      });
    },

    async createBooking(input, eventsFor) {
      try {
        return await db.$transaction(async (tx) => {
          // The friendly refusal, inside the write: a live booking that overlaps this window
          // nulls the request before anything is written. The partial unique index makes the
          // same-start case true under concurrency even between two transactions.
          const held = await tx.booking.findMany({
            where: {
              facilityId: input.facilityId,
              bookingDate: input.bookingDate,
              status: { in: [...C.LIVE_BOOKING_STATUSES] },
            },
            select: { startTime: true, endTime: true },
          });
          if (held.some((booking) => overlaps(input, booking))) return null;

          const created = await tx.booking.create({
            data: {
              facilityId: input.facilityId,
              unitId: input.unitId,
              bookingDate: input.bookingDate,
              startTime: input.startTime,
              endTime: input.endTime,
              amountPaise: input.amountPaise,
              createdAt: input.requestedAt,
            },
          });
          const row = await tx.booking.findUniqueOrThrow({
            where: { id: created.id },
            include: bookingInclude,
          });
          const booking = toBooking(row);
          await writeEvents(tx, eventsFor(booking));
          return booking;
        });
      } catch (error) {
        // The index refused a same-start window a concurrent request had just taken.
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    async decideBooking(input, events) {
      return db.$transaction(async (tx) => {
        // A decision is a guarded transition: only a booking still awaiting approval moves.
        const applied = await tx.booking.updateMany({
          where: { id: input.bookingId, status: 'PENDING' },
          data: {
            status: input.statusAfter,
            decidedById: input.decidedById,
            decidedAt: input.decidedAt,
            decisionReason: input.reason,
          },
        });
        if (applied.count === 0) return null;

        await writeEvents(tx, events);
        const row = await tx.booking.findUniqueOrThrow({
          where: { id: input.bookingId },
          include: bookingInclude,
        });
        return toBooking(row);
      });
    },

    async cancelBooking(input, events) {
      return db.$transaction(async (tx) => {
        // PENDING and CONFIRMED hold a slot; either may be cancelled. The model keeps no
        // cancellation timestamp of its own — the status is the record.
        const applied = await tx.booking.updateMany({
          where: { id: input.bookingId, status: { in: ['PENDING', 'CONFIRMED'] } },
          data: { status: 'CANCELLED' },
        });
        if (applied.count === 0) return null;

        await writeEvents(tx, events);
        const row = await tx.booking.findUniqueOrThrow({
          where: { id: input.bookingId },
          include: bookingInclude,
        });
        return toBooking(row);
      });
    },
  };

  return store;
}
