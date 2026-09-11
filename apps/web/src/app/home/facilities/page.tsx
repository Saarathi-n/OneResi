'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  Money,
  Skeleton,
  StatusPill,
  useToast,
} from '@oneresi/ui';
import { BOOKING_STATUS, formatCalendarDate, paise } from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * Facilities. The booking flow is a slot grid per facility per day: slots already held arrive
 * disabled with their reason (D-72), so the household never submits a booking the system would
 * reject. Their own bookings sit below with cancel while a decision is still pending.
 */

const FACILITIES_PATH = '/api/facilities';
const BOOKINGS_PATH = '/api/facilities/bookings';

/** The facility booked (or browsed) last, so the next visit opens on it. */
const LAST_FACILITY_KEY = 'oneresi.facility.last';

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function FacilitiesPage() {
  const facilities = useFetch<readonly FacilityLine[]>(FACILITIES_PATH);
  const bookings = useFetch<readonly BookingLine[]>(BOOKINGS_PATH);
  const toast = useToast();

  const [selectedFacility, setSelectedFacility] = useState<FacilityLine | null>(null);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<
    { state: 'loading' } | { state: 'failed' } | { state: 'ready'; data: readonly SlotLine[] }
  >({ state: 'loading' });
  const [chosen, setChosen] = useState<SlotLine | null>(null);
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
      // A blocked localStorage just means starting on the first facility.
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
                  onClick={() => {
                    setSelectedFacility(facility);
                    setDate(today());
                    try {
                      window.localStorage.setItem(LAST_FACILITY_KEY, String(facility.id));
                    } catch {
                      // Remembering is a convenience, never a requirement.
                    }
                    void loadSlots(facility.id, today());
                  }}
                  onMouseEnter={() => view(facility, date)}
                >
                  {facility.name}
                </Button>
              );
            })}
          </div>

          {activeFacility !== null ? (
            <Card elevation={0} className="border border-border">
              <CardHeader
                title={activeFacility.name}
                subtitle={`${activeFacility.description} · open ${activeFacility.opensAt} to ${activeFacility.closesAt}`}
                actions={
                  <Money
                    value={paise(activeFacility.hourlyRatePaise)}
                    size="body"
                    label={`${activeFacility.name} hourly rate`}
                  />
                }
              />
              <CardBody className="space-y-5">
                <label className="block">
                  <span className="type-label text-content">Day</span>
                  <Input
                    type="date"
                    value={date}
                    min={today()}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDate(next);
                      void loadSlots(activeFacility.id, next);
                    }}
                    className="mt-1 max-w-56"
                  />
                </label>

                {slots.state === 'loading' ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {Array.from({ length: 8 }, (_, index) => (
                      <Skeleton key={index} variant="block" height={56} />
                    ))}
                  </div>
                ) : slots.state === 'failed' ? (
                  <ErrorState
                    title="Slots did not load"
                    description="The facility is there; the day's availability is not. Try again."
                    onRetry={() => void loadSlots(activeFacility.id, date)}
                  />
                ) : (
                  <div>
                    <p className="type-label text-content-subtle">Available slots</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {slots.data.map((slot) => {
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
                            onClick={() => setChosen(slot)}
                            className={
                              slot.available
                                ? `rounded-xl border px-3 py-3 text-left transition-colors ${
                                    isSelected
                                      ? 'border-strong bg-accent-soft text-content'
                                      : 'border-border bg-surface-raised text-content hover:border-strong'
                                  }`
                                : 'cursor-not-allowed rounded-xl border border-border bg-surface-sunken px-3 py-3 text-left opacity-70'
                            }
                          >
                            <span className="type-label block">
                              {slot.startTime} – {slot.endTime}
                            </span>
                            <span
                              className={
                                slot.available
                                  ? 'type-micro text-content-subtle'
                                  : 'type-micro text-critical'
                              }
                            >
                              {slot.available
                                ? 'Free'
                                : (slot.reason !== undefined ? SLOT_REASON[slot.reason] : 'Taken')}
                            </span>
                          </button>
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

                <div className="flex items-center justify-between">
                  <p className="type-label text-content-muted">
                    {chosen !== null
                      ? `${chosen.startTime} – ${chosen.endTime} selected`
                      : 'Pick a slot to request'}
                  </p>
                  <Button
                    pending={pending}
                    pendingLabel="Requesting the booking"
                    disabled={chosen === null}
                    onClick={() => void submitBooking()}
                  >
                    Request booking
                  </Button>
                </div>
              </CardBody>
            </Card>
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
