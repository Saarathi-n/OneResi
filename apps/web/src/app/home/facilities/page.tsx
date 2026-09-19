'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Input,
  Money,
  Skeleton,
  StatusPill,
  useToast,
} from '@grihaone/ui';
import {
  BOOKING_STATUS,
  MAX_BOOKING_HOURS,
  formatCalendarDate,
  formatMoney,
  paise,
} from '@grihaone/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * Facilities. The booking flow is a slot grid per facility per day: slots already held arrive
 * disabled with their reason, so the household never submits a booking the system would
 * reject. Their own bookings sit below with cancel while a decision is still pending.
 */

const FACILITIES_PATH = '/api/facilities';
const BOOKINGS_PATH = '/api/facilities/bookings';

/** The facility booked (or browsed) last, so the next visit opens on it. */
const LAST_FACILITY_KEY = 'grihaone.facility.last';

interface FacilityLine {
  id: number;
  name: string;
  description: string;
  opensAt: string;
  closesAt: string;
  hourlyRatePaise: number;
}

interface SlotLine {
  startTime: string;
  endTime: string;
  available: boolean;
  reason?: 'HELD' | 'OUTSIDE_HOURS' | 'PAST';
}

interface EvaluatedSlot {
  readonly startTime: string;
  readonly endTime: string;
  readonly available: boolean;
  readonly reason?: 'HELD' | 'OUTSIDE_HOURS' | 'PAST';
}

interface BookingLine {
  id: number;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: keyof typeof BOOKING_STATUS;
  amountPaise: number;
}

const SLOT_REASON: Record<string, string> = {
  HELD: 'Already taken',
  OUTSIDE_HOURS: 'Outside hours',
  PAST: 'Past',
};

const TIME_PERIODS = [
  {
    id: 'morning',
    label: 'Morning',
    hours: '06:00–12:00',
    startMinutes: 6 * 60,
    endMinutes: 12 * 60,
  },
  {
    id: 'afternoon',
    label: 'Afternoon',
    hours: '12:00–17:00',
    startMinutes: 12 * 60,
    endMinutes: 17 * 60,
  },
  {
    id: 'evening',
    label: 'Evening',
    hours: '17:00–23:00',
    startMinutes: 17 * 60,
    endMinutes: 23 * 60,
  },
] as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatMinutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function FacilitiesPage() {
  const facilities = useFetch<readonly FacilityLine[]>(FACILITIES_PATH);
  const bookings = useFetch<readonly BookingLine[]>(BOOKINGS_PATH);
  const toast = useToast();

  const [selectedFacility, setSelectedFacility] = useState<FacilityLine | null>(null);
  const [date, setDate] = useState(today);
  const [durationHours, setDurationHours] = useState<number>(1);
  const [slots, setSlots] = useState<
    { state: 'loading' } | { state: 'failed' } | { state: 'ready'; data: readonly SlotLine[] }
  >({ state: 'loading' });
  const [chosen, setChosen] = useState<{ startTime: string; endTime: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // When the list arrives, open on the facility used last time (or the first one) and load its
  // day — without this the slot grid would sit on its skeleton until the first hover.
  useEffect(() => {
    if (facilities.state.state !== 'ready' || selectedFacility !== null) return;
    let toOpen = facilities.state.data[0] ?? null;
    try {
      const lastId = Number(window.localStorage.getItem(LAST_FACILITY_KEY));
      const remembered = facilities.state.data.find((facility) => facility.id === lastId);
      if (remembered !== undefined) {
        toOpen = remembered;
        setSelectedFacility(remembered);
      }
    } catch {
      // Remembering is a convenience, never a requirement.
    }
    if (toOpen !== null) void loadSlots(toOpen.id, today());
  }, [facilities.state, selectedFacility]);

  const activeFacility = useMemo(
    () =>
      selectedFacility !== null
        ? selectedFacility
        : facilities.state.state === 'ready'
          ? (facilities.state.data[0] ?? null)
          : null,
    [selectedFacility, facilities.state],
  );

  // Slots load for the facility and day the household is looking at, and nothing else.
  async function loadSlots(facilityId: number, on: string): Promise<void> {
    setSlots({ state: 'loading' });
    setChosen(null);
    const result = await call<readonly SlotLine[]>(
      `/api/facilities/${facilityId}/availability?on=${encodeURIComponent(on)}`,
    );
    if (result.ok) {
      setSlots({ state: 'ready', data: result.data });
    } else {
      setSlots({ state: 'failed' });
    }
  }

  // Load slots whenever the effective facility or the date changes.
  function view(facility: FacilityLine | null, on: string): void {
    if (facility === null) return;
    if (
      activeFacility?.id !== facility.id ||
      date !== on ||
      slots.state === 'loading'
    ) {
      void loadSlots(facility.id, on);
    }
  }

  function handleFacilitySelect(facility: FacilityLine) {
    setSelectedFacility(facility);
    setDate(today());
    setDurationHours(1);
    setChosen(null);
    try {
      window.localStorage.setItem(LAST_FACILITY_KEY, String(facility.id));
    } catch {
      // Remembering is a convenience, never a requirement.
    }
    void loadSlots(facility.id, today());
  }

  function handleDateChange(nextDate: string) {
    setDate(nextDate);
    setChosen(null);
    if (activeFacility !== null) {
      void loadSlots(activeFacility.id, nextDate);
    }
  }

  function handleDurationChange(hours: number) {
    setDurationHours(hours);
    setChosen(null);
  }

  const totalChargePaise = useMemo(() => {
    if (activeFacility === null) return paise(0);
    return paise(activeFacility.hourlyRatePaise * durationHours);
  }, [activeFacility, durationHours]);

  // Evaluates slot availability dynamically based on selected duration and operating hours
  const evaluatedSlots = useMemo<readonly EvaluatedSlot[]>(() => {
    if (slots.state !== 'ready' || activeFacility === null) return [];
    const facilityOpenMin = parseTimeToMinutes(activeFacility.opensAt);
    const facilityCloseMin = parseTimeToMinutes(activeFacility.closesAt);

    return slots.data
      .map((s) => {
        const startMin = parseTimeToMinutes(s.startTime);
        const endMin = startMin + durationHours * 60;
        const endTimeStr = formatMinutesToTime(endMin);

        // Outside operating hours of the facility
        if (startMin < facilityOpenMin || endMin > facilityCloseMin) {
          return {
            startTime: s.startTime,
            endTime: endTimeStr,
            available: false,
            reason: 'OUTSIDE_HOURS' as const,
          };
        }

        // Find consecutive 1-hour slots covering this window
        const covered = slots.data.filter((cand) => {
          const candMin = parseTimeToMinutes(cand.startTime);
          return candMin >= startMin && candMin < endMin;
        });

        if (covered.length < durationHours) {
          return {
            startTime: s.startTime,
            endTime: endTimeStr,
            available: false,
            reason: 'OUTSIDE_HOURS' as const,
          };
        }

        if (covered.some((c) => c.reason === 'PAST')) {
          return {
            startTime: s.startTime,
            endTime: endTimeStr,
            available: false,
            reason: 'PAST' as const,
          };
        }

        if (covered.some((c) => c.reason === 'HELD')) {
          return {
            startTime: s.startTime,
            endTime: endTimeStr,
            available: false,
            reason: 'HELD' as const,
          };
        }

        if (covered.some((c) => !c.available || c.reason === 'OUTSIDE_HOURS')) {
          return {
            startTime: s.startTime,
            endTime: endTimeStr,
            available: false,
            reason: 'OUTSIDE_HOURS' as const,
          };
        }

        return {
          startTime: s.startTime,
          endTime: endTimeStr,
          available: true,
        };
      })
      .filter((s) => {
        const startMin = parseTimeToMinutes(s.startTime);
        return startMin >= 6 * 60 && startMin < 23 * 60;
      });
  }, [slots.state, activeFacility, durationHours]);

  async function submitBooking(): Promise<void> {
    if (activeFacility === null || chosen === null) return;
    setPending(true);
    setError(null);
    const result = await call<BookingLine>('/api/facilities/bookings', {
      method: 'POST',
      json: {
        facilityId: activeFacility.id,
        bookingDate: date,
        startTime: chosen.startTime,
        endTime: chosen.endTime,
      },
    });
    setPending(false);
    if (result.ok) {
      setChosen(null);
      bookings.reload();
      toast.show({
        title: 'Booking requested',
        description: `${activeFacility.name}, ${chosen.startTime}–${chosen.endTime}. The committee will confirm.`,
        tone: 'positive',
      });
      void loadSlots(activeFacility.id, date);
      return;
    }
    setError(result.error.message);
    void loadSlots(activeFacility.id, date);
  }

  async function cancelBooking(booking: BookingLine): Promise<void> {
    setCancellingId(booking.id);
    const result = await call<BookingLine>(`/api/facilities/bookings/${booking.id}/cancel`, {
      method: 'POST',
      json: { bookingId: booking.id },
    });
    setCancellingId(null);
    if (result.ok) {
      bookings.reload();
      if (activeFacility !== null) void loadSlots(activeFacility.id, date);
      toast.show({
        title: 'Booking cancelled',
        description: `${booking.facilityName} is free for others again.`,
      });
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="type-title text-content">Facilities</h1>

      {facilities.state.state === 'loading' ? (
        <div className="space-y-3">
          <Skeleton variant="block" height={96} />
          <Skeleton variant="block" height={96} />
        </div>
      ) : facilities.state.state === 'failed' ? (
        <Card elevation={1}>
          <CardBody>
            <ErrorState title="Facilities did not load" onRetry={facilities.reload} />
          </CardBody>
        </Card>
      ) : facilities.state.data.length === 0 ? (
        <EmptyState
          title="No facilities yet"
          description="When the society lists a clubhouse, gym or hall, it appears here to book."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Facility">
            {facilities.state.data.map((facility) => {
              const active = activeFacility?.id === facility.id;
              return (
                <Button
                  key={facility.id}
                  variant={active ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={active}
                  onClick={() => handleFacilitySelect(facility)}
                  onMouseEnter={() => view(facility, date)}
                >
                  {facility.name}
                </Button>
              );
            })}
          </div>

          {activeFacility !== null ? (
            <div className="rounded-2xl border border-border bg-surface-raised shadow-e1 overflow-hidden">
              {/* Facility Header Area with generous padding */}
              <div className="p-6 sm:p-7 border-b border-border bg-surface-raised space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1.5 max-w-xl">
                    <h2 className="type-title text-xl sm:text-2xl font-bold text-content">
                      {activeFacility.name}
                    </h2>
                    <p className="type-body text-content-muted leading-relaxed">
                      {activeFacility.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-sunken px-3.5 py-1 text-xs font-medium text-content">
                      Open {activeFacility.opensAt} – {activeFacility.closesAt}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-sunken px-3.5 py-1 text-xs font-semibold text-content">
                      <Money
                        value={paise(activeFacility.hourlyRatePaise)}
                        size="body"
                        tone="gold"
                        label={`${activeFacility.name} hourly rate`}
                      />
                      <span className="text-content-muted font-normal">/ hr</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Booking Options Paper Card Grouping */}
              <div className="p-6 sm:p-7 space-y-6">
                <div className="rounded-xl border border-border bg-surface-sunken/40 p-5 sm:p-6 space-y-5">
                  <h3 className="type-title text-base font-semibold text-content">
                    Select booking details
                  </h3>
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    {/* Date Field */}
                    <div className="space-y-2">
                      <label
                        htmlFor="facility-booking-date"
                        className="type-label font-semibold text-content block"
                      >
                        Booking Date
                      </label>
                      <Input
                        id="facility-booking-date"
                        type="date"
                        value={date}
                        min={today()}
                        onChange={(event) => handleDateChange(event.target.value)}
                        className="w-full"
                      />
                      <p className="type-micro text-content-subtle">
                        Select the day you wish to reserve the amenity.
                      </p>
                    </div>

                    {/* Multi-hour Duration Field */}
                    <div className="space-y-2">
                      <span className="type-label font-semibold text-content block">
                        Duration (hours)
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {Array.from({ length: MAX_BOOKING_HOURS }, (_, i) => i + 1).map((hours) => {
                          const active = durationHours === hours;
                          return (
                            <button
                              key={hours}
                              type="button"
                              onClick={() => handleDurationChange(hours)}
                              className={`min-h-[40px] min-w-[48px] px-3.5 rounded-xl border text-sm font-medium transition-all ${
                                active
                                  ? 'border-accent bg-accent text-accent-on font-semibold shadow-xs'
                                  : 'border-border bg-surface-raised text-content hover:bg-surface-sunken hover:border-border-strong'
                              }`}
                              aria-pressed={active}
                            >
                              {hours} {hours === 1 ? 'hr' : 'hrs'}
                            </button>
                          );
                        })}
                      </div>
                      <p className="type-micro text-content-subtle">
                        Single reservations can be up to {MAX_BOOKING_HOURS} hours.
                      </p>
                    </div>
                  </div>

                  {/* Dynamic Charge Calculation */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
                    <span className="type-label text-content-muted">Rate calculation:</span>
                    <div className="flex items-center gap-2 type-body tabular-nums text-content font-medium">
                      <span className="text-content-muted">
                        {formatMoney(paise(activeFacility.hourlyRatePaise), { compact: true })} × {durationHours} {durationHours === 1 ? 'hr' : 'hrs'} =
                      </span>
                      <span className="font-bold text-accent">
                        {formatMoney(totalChargePaise, { compact: true })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Available Slots Section */}
                {slots.state === 'loading' ? (
                  <div className="space-y-4">
                    <div className="h-5 w-40 rounded bg-surface-sunken animate-pulse" />
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      {Array.from({ length: 8 }, (_, index) => (
                        <Skeleton key={index} variant="block" height={60} />
                      ))}
                    </div>
                  </div>
                ) : slots.state === 'failed' ? (
                  <ErrorState
                    title="Slots did not load"
                    description="The facility is there; the day's availability is not. Try again."
                    onRetry={() => void loadSlots(activeFacility.id, date)}
                  />
                ) : (
                  <div className="space-y-6">
                    <div>
                      <h3 className="type-title text-base font-semibold text-content">
                        Available time slots
                      </h3>
                      <p className="type-micro text-content-subtle mt-0.5">
                        Choose a starting slot for your {durationHours}-hour reservation.
                      </p>
                    </div>

                    <div className="space-y-5">
                      {TIME_PERIODS.map((period) => {
                        const periodSlots = evaluatedSlots.filter(
                          (s) =>
                            parseTimeToMinutes(s.startTime) >= period.startMinutes &&
                            parseTimeToMinutes(s.startTime) < period.endMinutes,
                        );
                        const availableCount = periodSlots.filter((s) => s.available).length;

                        return (
                          <div
                            key={period.id}
                            className="rounded-xl border border-border bg-surface-raised p-4 sm:p-5 space-y-3"
                          >
                            <div className="flex items-center justify-between border-b border-border pb-2.5">
                              <div className="flex items-center gap-2">
                                <h4 className="type-body font-semibold text-content">
                                  {period.label}
                                </h4>
                                <span className="type-micro text-content-subtle">
                                  ({period.hours})
                                </span>
                              </div>
                              <span
                                className={`type-micro px-2.5 py-0.5 rounded-full font-medium ${
                                  availableCount > 0
                                    ? 'bg-positive-soft text-positive border border-positive-border'
                                    : 'bg-surface-sunken text-content-subtle'
                                }`}
                              >
                                {availableCount > 0
                                  ? `${availableCount} available`
                                  : 'No slots available'}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                              {periodSlots.map((slot) => {
                                const isSelected =
                                  chosen !== null &&
                                  chosen.startTime === slot.startTime &&
                                  chosen.endTime === slot.endTime;

                                return (
                                  <button
                                    key={`${slot.startTime}-${slot.endTime}`}
                                    type="button"
                                    disabled={!slot.available}
                                    aria-pressed={isSelected}
                                    onClick={() =>
                                      setChosen({
                                        startTime: slot.startTime,
                                        endTime: slot.endTime,
                                      })
                                    }
                                    className={
                                      slot.available
                                        ? `rounded-xl border p-3 text-left transition-all ${
                                            isSelected
                                              ? 'border-accent bg-accent-soft text-content ring-2 ring-accent/30 shadow-xs'
                                              : 'border-border bg-surface text-content hover:border-border-strong hover:bg-surface-sunken/40'
                                          }`
                                        : 'cursor-not-allowed rounded-xl border border-border/60 bg-surface-sunken/60 p-3 text-left opacity-60'
                                    }
                                  >
                                    <span className="type-label font-semibold block text-content">
                                      {slot.startTime} – {slot.endTime}
                                    </span>
                                    <span
                                      className={
                                        slot.available
                                          ? 'type-micro text-content-muted font-medium'
                                          : 'type-micro text-critical font-medium'
                                      }
                                    >
                                      {slot.available
                                        ? `Free · ${durationHours} hr${durationHours > 1 ? 's' : ''}`
                                        : (slot.reason !== undefined
                                            ? SLOT_REASON[slot.reason]
                                            : 'Taken')}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {error !== null ? (
                  <p className="type-body text-critical" role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border pt-5">
                  <div className="space-y-0.5">
                    <p className="type-body font-medium text-content">
                      {chosen !== null
                        ? `${chosen.startTime} – ${chosen.endTime} (${durationHours} ${durationHours === 1 ? 'hour' : 'hours'} selected)`
                        : 'Pick a slot to request'}
                    </p>
                    {chosen !== null ? (
                      <p className="type-micro text-content-muted">
                        Total charge:{' '}
                        <span className="font-semibold text-content">
                          {formatMoney(totalChargePaise, { compact: true })}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  <Button
                    pending={pending}
                    pendingLabel="Requesting the booking"
                    disabled={chosen === null}
                    onClick={() => void submitBooking()}
                  >
                    Request booking
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      <div>
        <h2 className="type-title text-content">Your bookings</h2>
        {bookings.state.state === 'loading' ? (
          <div className="mt-3 space-y-3">
            <Skeleton variant="block" height={64} />
            <Skeleton variant="block" height={64} />
          </div>
        ) : bookings.state.state === 'failed' ? (
          <div className="mt-3">
            <ErrorState title="Your bookings did not load" onRetry={bookings.reload} />
          </div>
        ) : bookings.state.data.length === 0 ? (
          <p className="type-body mt-3 text-content-muted">
            You have not requested a facility yet. Pick a slot above.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {bookings.state.data.map((booking) => (
              <Card key={booking.id} elevation={0} className="border border-border">
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-3">
                      <p className="type-body text-content">{booking.facilityName}</p>
                      <StatusPill descriptor={BOOKING_STATUS[booking.status]} size="sm" />
                    </div>
                    <p className="type-micro mt-1 text-content-subtle">
                      {formatCalendarDate(booking.bookingDate)}{' '}
                      · {booking.startTime}–{booking.endTime} ·{' '}
                      <Money value={paise(booking.amountPaise)} label="booking charge" />
                    </p>
                  </div>
                  {booking.status === 'PENDING' || booking.status === 'CONFIRMED' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      pending={cancellingId === booking.id}
                      pendingLabel="Cancelling"
                      onClick={() => void cancelBooking(booking)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
