'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Field, Input, Money, Sheet, StatusPill, Tabs, useToast } from '@oneresi/ui';
import * as C from '@oneresi/contracts';
import { Icon } from '@/components/icons';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { simple } from '@/lib/api';
import { RESIDENT_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import { formatClockTime, formatDayYear, slotReasonLabel, todayInput } from '@/lib/format';
import type { BookingWire, FacilityWire, SlotWire } from '@/lib/types';

/**
 * The society's shared spaces. The list is the same for everyone; the availability sheet answers
 * "can I have it then" with the day's real slots, and a booking request goes to the committee for
 * confirmation rather than being grabbed outright — a club house is a shared thing, not a seat on
 * a train.
 */

export default function FacilitiesPage(): ReactNode {
  const reduced = useReducedMotion();
  const toast = useToast();
  const [view, setView] = useState('browse');
  const [availabilityFor, setAvailabilityFor] = useState<FacilityWire | null>(null);

  const facilities = useAsync(() => simple<readonly FacilityWire[]>('/api/facilities'), []);
  const bookings = useAsync(() => simple<readonly BookingWire[]>('/api/facilities/bookings'), []);

  const refresh = useCallback(async () => {
    facilities.reload();
    bookings.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [facilities, bookings]);

  return (
    <Shell title="Facilities" tabs={RESIDENT_TABS} activeTab="/home/more" onRefresh={refresh}>
      <Tabs
        label="Facility views"
        value={view}
        onValueChange={setView}
        items={[
          { value: 'browse', label: 'Book' },
          { value: 'mine', label: 'My bookings' },
        ]}
      >
        {view === 'browse' ? (
          <AsyncView
            state={facilities.state}
            skeleton={<CardListSkeleton rows={3} />}
            empty={
              <div className="mt-3 rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
                <p className="type-body font-medium">No facilities listed</p>
                <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
                  The committee has not set up any bookable spaces yet.
                </p>
              </div>
            }
            onRetry={facilities.reload}
            render={(list) => (
              <div className="mt-3 flex flex-col gap-3">
                {list.map((facility, index) => (
                  <div key={facility.id} className="row-in" style={rowStyle(index, reduced)}>
                    <Card>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="type-body font-medium">{facility.name}</p>
                          <p className="type-label text-content-subtle">
                            Open {formatClockTime(facility.opensAt)} – {formatClockTime(facility.closesAt)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <Money value={facility.hourlyRatePaise} compact />
                          <p className="type-label text-content-muted">per hour</p>
                        </div>
                      </div>
                      {facility.description !== '' ? (
                        <p className="mt-2 type-label text-content-subtle">{facility.description}</p>
                      ) : null}
                      <div className="mt-3">
                        <Button size="sm" fullWidth variant="secondary" onClick={() => { setAvailabilityFor(facility); }}>
                          Check availability
                        </Button>
                      </div>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          />
        ) : null}

        {view === 'mine' ? (
          <AsyncView
            state={bookings.state}
            skeleton={<CardListSkeleton rows={2} />}
            empty={
              <div className="mt-3 rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
                <p className="type-body font-medium">No bookings</p>
                <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
                  When you request the club house or the badminton court, it lives here until it is over.
                </p>
              </div>
            }
            onRetry={bookings.reload}
            render={(list) => (
              <div className="mt-3 flex flex-col gap-3">
                {list.map((booking, index) => (
                  <div key={booking.id} className="row-in" style={rowStyle(index, reduced)}>
                    <BookingCard
                      booking={booking}
                      onCancelled={() => {
                        toast.show({
                          title: 'Booking cancelled',
                          description: 'The slot goes back into the pool.',
                        });
                        bookings.reload();
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          />
        ) : null}
      </Tabs>

      {availabilityFor !== null ? (
        <AvailabilitySheet
          facility={availabilityFor}
          onClose={() => {
            setAvailabilityFor(null);
          }}
          onRequested={() => {
            setAvailabilityFor(null);
            bookings.reload();
            setView('mine');
            toast.show({
              title: 'Booking requested',
              description: 'The committee confirms it — you will see it under My bookings.',
            });
          }}
        />
      ) : null}
    </Shell>
  );
}

function BookingCard({
  booking,
  onCancelled,
}: {
  readonly booking: BookingWire;
  readonly onCancelled: () => void;
}): ReactNode {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const cancellable = booking.status === 'PENDING' || booking.status === 'CONFIRMED';

  async function cancel(): Promise<void> {
    if (pending) return;
    setPending(true);
    setFailed(null);
    const result = await simple<BookingWire>(`/api/facilities/bookings/${booking.id}/cancel`, {
      method: 'POST',
      json: { bookingId: booking.id },
    });
    setPending(false);
    if (result.ok) {
      onCancelled();
      return;
    }
    setFailed(result.error.message);
  }

  return (
    <Card tone={C.BOOKING_STATUS[booking.status].tone}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate type-body font-medium">{booking.facilityName}</p>
          <p className="type-label text-content-subtle">
            {formatDayYear(booking.bookingDate)} · {formatClockTime(booking.startTime)} –{' '}
            {formatClockTime(booking.endTime)}
          </p>
          <Money value={booking.amountPaise} compact />
        </div>
        <StatusPill descriptor={C.BOOKING_STATUS[booking.status]} size="sm" />
      </div>
      {cancellable ? (
        <div className="mt-3">
          <Button size="sm" variant="ghost" fullWidth pending={pending} onClick={() => { void cancel(); }}>
            Cancel booking
          </Button>
        </div>
      ) : null}
      {failed !== null ? (
        <p role="alert" className="mt-2 rounded-lg border border-critical-border bg-critical-soft px-3 py-2 type-label text-critical">
          {failed}
        </p>
      ) : null}
    </Card>
  );
}

function AvailabilitySheet({
  facility,
  onClose,
  onRequested,
}: {
  readonly facility: FacilityWire;
  readonly onClose: () => void;
  readonly onRequested: () => void;
}): ReactNode {
  const toast = useToast();
  const [date, setDate] = useState(todayInput());
  const [slots, setSlots] = useState<readonly SlotWire[] | null>(null);
  const [selected, setSelected] = useState<SlotWire | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(
    async (on: string): Promise<void> => {
      setLoading(true);
      setLoadFailed(null);
      setSelected(null);
      const result = await simple<readonly SlotWire[]>(
        `/api/facilities/${facility.id}/availability?on=${on}`,
      );
      setLoading(false);
      if (result.ok) {
        setSlots(result.data);
        return;
      }
      setSlots(null);
      setLoadFailed(result.error.message);
    },
    [facility.id],
  );

  // Fetch on open and again whenever the picked day changes.
  useEffect(() => {
    void load(date);
  }, [date, load]);

  async function request(): Promise<void> {
    if (pending || selected === null) return;
    setPending(true);
    setFailed(null);
    const result = await simple<BookingWire>('/api/facilities/bookings', {
      method: 'POST',
      json: {
        facilityId: facility.id,
        bookingDate: date,
        startTime: selected.startTime,
        endTime: selected.endTime,
      },
    });
    setPending(false);
    if (result.ok) {
      onRequested();
      return;
    }
    // The slot may have been taken between reading and writing — pull the day again.
    if (result.error.code === 'CONFLICT') {
      toast.show({
        title: 'That slot was just taken',
        description: 'The day has been refreshed — pick another slot.',
      });
      void load(date);
      return;
    }
    setFailed(result.error.message);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={facility.name}
      description="Pick a day, then a free slot. Requests go to the committee for confirmation."
      pending={pending}
      footer={
        <Button
          size="lg"
          fullWidth
          disabled={selected === null}
          pending={pending}
          pendingLabel="Requesting"
          onClick={() => { void request(); }}
        >
          {selected === null
            ? 'Pick a slot'
            : selected.available
              ? `Request ${formatClockTime(selected.startTime)} – ${formatClockTime(selected.endTime)}`
              : 'Pick a free slot'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Day" required>
          <Input
            type="date"
            value={date}
            min={todayInput()}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
        </Field>

        <div role="group" aria-label="Slots for the day" className="flex flex-col gap-2">
          {loading ? (
            <p className="type-label text-content-subtle" aria-busy>
              Checking the day…
            </p>
          ) : null}
          {loadFailed !== null ? (
            <div className="flex flex-col gap-2">
              <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-3 py-2 type-label text-critical">
                {loadFailed}
              </p>
              <Button size="sm" variant="secondary" onClick={() => { void load(date); }}>
                Try again
              </Button>
            </div>
          ) : null}
          {!loading && slots !== null && slots.length === 0 ? (
            <p className="type-label text-content-subtle">
              The society has not published slots for this day.
            </p>
          ) : null}
          {!loading &&
            slots?.map((slot) => {
              const isSelected = selected !== null && selected.startTime === slot.startTime;
              return (
                <button
                  key={slot.startTime}
                  type="button"
                  disabled={!slot.available}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelected(slot);
                  }}
                  className={`tab-target flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left type-body focus-ring-inset ${
                    isSelected
                      ? 'border-accent bg-accent-soft'
                      : slot.available
                        ? 'border-border bg-surface-raised'
                        : 'cursor-not-allowed border-dashed border-border bg-surface-sunken opacity-60'
                  }`}
                >
                  <span className="font-medium">
                    {formatClockTime(slot.startTime)} – {formatClockTime(slot.endTime)}
                  </span>
                  {slot.available ? (
                    <span className="type-label text-positive">
                      {isSelected ? <Icon name="check" size={14} /> : null} Free
                    </span>
                  ) : (
                    <span className="type-label text-content-muted">{slot.reason !== undefined ? slotReasonLabel(slot.reason) : 'Not available'}</span>
                  )}
                </button>
              );
            })}
        </div>

        {selected !== null && selected.available ? (
          <Card padding="tight">
            <div className="flex items-center justify-between gap-3">
              <p className="type-label text-content-subtle">This booking, on approval</p>
              <Money value={facility.hourlyRatePaise} compact />
            </div>
          </Card>
        ) : null}

        {failed !== null ? (
          <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
            {failed}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
