import * as C from '@grihaone/contracts';
import { errors } from './errors.js';
import type { Clock } from './clock.js';
import {
  ok,
  type Result,
  type BookingView,
  type FacilitiesService,
  type FacilityView,
  type SlotView,
  type SocietyBookingView,
} from './ports.js';
import type { FacilitiesStore, OutboxEventInput, StoredBooking, StoredFacility } from './store.js';

/**
 * Facilities. The slot a resident asks for is checked twice: once here for the friendly
 * refusal, and once inside the write by the partial unique index over live bookings — the
 * constraint is what makes double booking impossible under concurrency, the check is what makes
 * the message kind (D-18). The window rules — at most six hours, at most sixty days ahead,
 * inside the facility's hours — are enforced on booking, not merely displayed (D-72), and the
 * charge is computed at request time from the rate and the window, so the advertised price and
 * the billed price are the same number.
 */

type MailPayload = Readonly<Record<string, string | number | boolean | null>>;

function mailEvent(
  type: C.OutboxEventType,
  payload: MailPayload,
  correlationId: string,
): OutboxEventInput {
  return { type, channel: 'EMAIL', payload, correlationId };
}

/** `A-101`, as every address a household reads is formatted. */
function homeLabel(home: { readonly blockName: string; readonly label: string }): string {
  return `${home.blockName} · ${home.label}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The society's calendar. IST has no daylight saving, so one fixed offset is exact. */
const IST_OFFSET_MINUTES = 330;

function istDayString(at: Date): string {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Minutes past midnight of an IST instant — "has this slot already begun?". */
function istMinutesOfDay(at: Date): number {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function utcMidnight(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function dayStringOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** `HH:MM` as minutes since midnight, so windows compare as numbers. */
function minutesOf(clockTime: string): number {
  return Number(clockTime.slice(0, 2)) * 60 + Number(clockTime.slice(3, 5));
}

function clockTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Two windows overlap when each starts before the other ends. */
function overlaps(
  a: { readonly startTime: string; readonly endTime: string },
  b: { readonly startTime: string; readonly endTime: string },
): boolean {
  return minutesOf(a.startTime) < minutesOf(b.endTime) && minutesOf(a.endTime) > minutesOf(b.startTime);
}

function bookingView(booking: StoredBooking): BookingView {
  return {
    id: booking.id,
    facilityName: booking.facilityName,
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    status: booking.status,
    amountPaise: booking.amountPaise,
  };
}

/** The charge: the rate prorated by the minute, rounded up to the whole paisa. */
function chargeFor(facility: StoredFacility, startTime: string, endTime: string): C.Paise {
  const minutes = minutesOf(endTime) - minutesOf(startTime);
  const exact = (facility.hourlyRatePaise * minutes) / 60;
  return C.paise(Number.isInteger(exact) ? exact : Math.ceil(exact));
}

export interface FacilitiesDeps {
  readonly store: FacilitiesStore;
  readonly clock: Clock;
}

export function facilitiesService(deps: FacilitiesDeps): FacilitiesService {
  const { store, clock } = deps;

  return {
    async list(actor): Promise<Result<readonly ReturnType<typeof facilityView>[]>> {
      const facilities = await store.listFacilities({
        // The committee desk also manages retired facilities (UC-22, D-27).
        includeInactive: actor.role === 'A',
      });
      return ok(facilities.map(facilityView));
    },

    async availability(_actor, input): Promise<Result<readonly SlotView[]>> {
      const facility = await store.findFacilityById(input.facilityId);
      if (facility === null || !facility.active) return errors.notFound('facility');

      const held = await store.liveBookingsForFacilityOn(
        facility.id,
        utcMidnight(input.on),
      );
      const today = istDayString(clock.now());
      const nowMinutes = istMinutesOfDay(clock.now());

      const slots: SlotView[] = [];
      for (let start = 0; start < 24 * 60; start += 60) {
        const end = start + 60;
        const window = { startTime: clockTime(start), endTime: clockTime(end) };
        const outside = start < minutesOf(facility.opensAt) || end > minutesOf(facility.closesAt);
        const past = input.on < today || (input.on === today && start <= nowMinutes);
        // A held slot is returned disabled with its reason, not rejected on submit (D-72).
        const taken = held.some((booking) => overlaps(window, booking));
        if (past) {
          slots.push({ ...window, available: false, reason: 'PAST' });
        } else if (taken) {
          slots.push({ ...window, available: false, reason: 'HELD' });
        } else if (outside) {
          slots.push({ ...window, available: false, reason: 'OUTSIDE_HOURS' });
        } else {
          slots.push({ ...window, available: true });
        }
      }
      return ok(slots);
    },

    async request(actor, input): Promise<Result<BookingView>> {
      if (actor.unitId === null) return errors.forbidden('book a facility');

      const facility = await store.findFacilityById(input.facilityId);
      if (facility === null || !facility.active) return errors.notFound('facility');

      const today = istDayString(clock.now());
      if (input.bookingDate < today) {
        return errors.windowClosed('A past date cannot be booked.');
      }
      if (input.bookingDate === today && minutesOf(input.startTime) <= istMinutesOfDay(clock.now())) {
        return errors.windowClosed('That slot has already passed.');
      }
      const latest = dayStringOf(new Date(Date.parse(`${today}T00:00:00.000Z`) + C.MAX_BOOKING_LEAD_DAYS * MS_PER_DAY));
      if (input.bookingDate > latest) {
        return errors.windowClosed(`Bookings open at most ${C.MAX_BOOKING_LEAD_DAYS} days ahead.`);
      }

      const minutes = minutesOf(input.endTime) - minutesOf(input.startTime);
      if (minutes > C.MAX_BOOKING_HOURS * 60) {
        return errors.invalid(`A booking can be at most ${C.MAX_BOOKING_HOURS} hours.`, 'endTime');
      }
      if (input.startTime < facility.opensAt) {
        return errors.invalid('That window starts before the facility opens.', 'startTime');
      }
      if (input.endTime > facility.closesAt) {
        return errors.invalid('That window ends after the facility closes.', 'endTime');
      }

      // The friendly refusal; the write below is what makes it true (D-18).
      const held = await store.liveBookingsForFacilityOn(facility.id, utcMidnight(input.bookingDate));
      if (held.some((booking) => overlaps(input, booking))) {
        return errors.conflict('That slot is already taken.');
      }

      const home = await store.findHome(actor.unitId);
      const committee = await store.findCommitteeMembers();
      const correlationId = C.idempotencyKey();
      const booking = await store.createBooking(
        {
          facilityId: facility.id,
          unitId: actor.unitId,
          bookingDate: utcMidnight(input.bookingDate),
          startTime: input.startTime,
          endTime: input.endTime,
          amountPaise: chargeFor(facility, input.startTime, input.endTime),
          requestedAt: clock.now(),
        },
        (created) =>
          committee.map((member) =>
            mailEvent(
              'booking.requested',
              {
                name: member.name,
                email: member.email,
                bookingId: created.id,
                facilityName: facility.name,
                residentName: actor.name,
                home: home === null ? '' : homeLabel(home),
                bookingDate: created.bookingDate.toISOString(),
                startTime: created.startTime,
                endTime: created.endTime,
                amountPaise: created.amountPaise,
              },
              correlationId,
            ),
          ),
      );
      if (booking === null) return errors.conflict('That slot is already taken.');
      return ok(bookingView(booking));
    },

    async forHousehold(actor): Promise<Result<readonly BookingView[]>> {
      if (actor.unitId === null) return errors.forbidden('view bookings');
      const bookings = await store.findBookingsForUnit(actor.unitId);
      return ok(bookings.map(bookingView));
    },

    async bookingsForSociety(actor): Promise<Result<readonly SocietyBookingView[]>> {
      if (actor.role !== 'A') return errors.forbidden('review bookings');
      const bookings = await store.findBookingsForSociety();
      return ok(
        bookings.map((booking) => ({
          ...bookingView(booking),
          home: {
            unitId: booking.home.unitId,
            blockName: booking.home.blockName,
            label: booking.home.label,
            type: booking.home.type,
            monthlyChargePaise: booking.home.monthlyChargePaise,
          },
        })),
      );
    },

    async listAll(actor): Promise<Result<readonly (FacilityView & { active: boolean })[]>> {
      if (actor.role !== 'A') return errors.forbidden('manage facilities');
      const facilities = await store.listFacilities({ includeInactive: true });
      return ok(facilities.map(managedView));
    },

    async create(actor, input): Promise<Result<FacilityView & { active: boolean }>> {
      if (actor.role !== 'A') return errors.forbidden('manage facilities');
      // The schema already refuses a close before its open; this is the same rule stated for
      // the desk's benefit in case a caller bypassed it (defense in depth costs one line).
      if (input.closesAt <= input.opensAt) {
        return errors.invalid('The facility has to close after it opens.', 'closesAt');
      }
      const created = await store.createFacility({
        name: input.name,
        description: input.description,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        hourlyRatePaise: C.paise(input.hourlyRatePaise),
      });
      if (created === null) {
        return errors.conflict('A facility with that name already exists.');
      }
      return ok(managedView(created));
    },

    async update(actor, input): Promise<Result<FacilityView & { active: boolean }>> {
      if (actor.role !== 'A') return errors.forbidden('manage facilities');
      const existing = await store.findFacilityById(input.facilityId);
      if (existing === null) return errors.notFound('facility');

      // The hours arrive as a pair or not at all (the schema's rule); when they arrive they are
      // re-checked against each other, because the pair is coherent but may still be inverted.
      if (input.opensAt !== undefined && input.closesAt !== undefined && input.closesAt <= input.opensAt) {
        return errors.invalid('The facility has to close after it opens.', 'closesAt');
      }

      const updated = await store.updateFacility({
        facilityId: input.facilityId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.opensAt === undefined ? {} : { opensAt: input.opensAt }),
        ...(input.closesAt === undefined ? {} : { closesAt: input.closesAt }),
        ...(input.hourlyRatePaise === undefined ? {} : { hourlyRatePaise: C.paise(input.hourlyRatePaise) }),
        ...(input.active === undefined ? {} : { active: input.active }),
      });
      if (updated === null) {
        // The facility existed a moment ago, so the name must have been the refusal.
        return errors.conflict('A facility with that name already exists.');
      }
      return ok(managedView(updated));
    },

    async cancel(actor, input): Promise<Result<BookingView>> {
      const booking = await store.findBookingById(input.bookingId);
      if (booking === null) return errors.notFound('booking');
      if (booking.unitId !== actor.unitId && actor.role !== 'A') {
        return errors.forbidden('cancel this booking');
      }
      if (booking.status === 'CANCELLED') {
        return errors.alreadyDone('This booking is already cancelled.');
      }
      if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') {
        return errors.stateNotAllowed('This booking cannot be cancelled now.');
      }

      const cancelled = await store.cancelBooking(
        { bookingId: booking.id, cancelledAt: clock.now() },
        [],
      );
      if (cancelled === null) {
        return errors.conflict('This booking changed while it was being cancelled.');
      }
      return ok(bookingView(cancelled));
    },

    async decide(actor, input): Promise<Result<BookingView>> {
      if (actor.role !== 'A') return errors.forbidden('decide a booking');

      const booking = await store.findBookingById(input.bookingId);
      if (booking === null) return errors.notFound('booking');

      const target: 'CONFIRMED' | 'REJECTED' =
        input.decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED';
      if (booking.status === target) {
        // A repeated decision is idempotent, not an error.
        return errors.alreadyDone(`This booking is already ${target === 'CONFIRMED' ? 'confirmed' : 'declined'}.`);
      }
      if (booking.status !== 'PENDING') {
        return errors.stateNotAllowed('Only a booking awaiting approval can be decided.');
      }

      const residents = await store.findResidentsForUnit(booking.unitId);
      const now = clock.now();
      const correlationId = C.idempotencyKey();
      const events = residents.map((resident) =>
        mailEvent(
          'booking.decided',
          {
            name: resident.name,
            email: resident.email,
            recipientName: resident.name,
            bookingId: booking.id,
            facilityName: booking.facilityName,
            bookingDate: booking.bookingDate.toISOString(),
            startTime: booking.startTime,
            endTime: booking.endTime,
            status: target,
            amountPaise: booking.amountPaise,
            decidedByName: actor.name,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          },
          correlationId,
        ),
      );

      const decided = await store.decideBooking(
        {
          bookingId: booking.id,
          statusAfter: target,
          decidedById: actor.userId,
          decidedAt: now,
          reason: input.reason ?? null,
        },
        events,
      );
      if (decided === null) {
        return errors.conflict('This booking changed while it was being decided.');
      }
      return ok(bookingView(decided));
    },
  };
}

function facilityView(facility: StoredFacility) {
  return {
    id: facility.id,
    name: facility.name,
    description: facility.description,
    opensAt: facility.opensAt,
    closesAt: facility.closesAt,
    hourlyRatePaise: facility.hourlyRatePaise,
  };
}

/** The management view: everything residents see, plus the retired flag the desk works with. */
function managedView(facility: StoredFacility) {
  return { ...facilityView(facility), active: facility.active };
}
