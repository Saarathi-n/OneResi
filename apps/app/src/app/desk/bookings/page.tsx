'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Field, Money, Sheet, StatusPill, Textarea, useToast } from '@oneresi/ui';
import * as C from '@oneresi/contracts';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { simple } from '@/lib/api';
import { COMMITTEE_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import { formatClockTime, formatDayYear } from '@/lib/format';
import type { SocietyBookingWire } from '@/lib/types';

/**
 * Every booking request in the society. A request is not a grab — the desk confirms or declines it,
 * and a decline says why, because "Declined" on a club house booking with no reason starts phone
 * calls. Confirmations and declines reach the resident as notifications.
 */
export default function DeskBookingsPage(): ReactNode {
  const reduced = useReducedMotion();
  const toast = useToast();
  const [rejecting, setRejecting] = useState<SocietyBookingWire | null>(null);

  const bookings = useAsync(
    () => simple<readonly SocietyBookingWire[]>('/api/facilities/bookings/society'),
    [],
  );

  const refresh = useCallback(async () => {
    bookings.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [bookings]);

  async function decide(booking: SocietyBookingWire, decision: 'CONFIRM' | 'REJECT', reason?: string): Promise<void> {
    const result = await simple<null>(`/api/facilities/bookings/${booking.id}/decision`, {
      method: 'POST',
      json: {
        bookingId: booking.id,
        decision,
        ...(reason !== undefined && reason !== '' ? { reason } : {}),
      },
    });
    if (result.ok) {
      toast.show({
        title:
          decision === 'CONFIRM'
            ? `${booking.home.label} is booked in`
            : `The request from ${booking.home.label} was declined`,
        description:
          decision === 'CONFIRM'
            ? 'They have been told their slot is theirs.'
            : 'They have been told why, in the words you wrote.',
      });
      bookings.reload();
      return;
    }
    toast.show({ title: 'That did not go through', description: result.error.message, tone: 'critical' });
  }

  return (
    <Shell title="Booking requests" tabs={COMMITTEE_TABS} activeTab="/desk/bookings" onRefresh={refresh}>
      <AsyncView
        state={bookings.state}
        skeleton={<CardListSkeleton rows={3} />}
        empty={
          <div className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
            <p className="type-body font-medium">No bookings</p>
            <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
              When a resident requests the club house or a court, the request lands here for a decision.
            </p>
          </div>
        }
        onRetry={bookings.reload}
        render={(list) => {
          const pending = list.filter((booking) => booking.status === 'PENDING');
          const settled = list.filter((booking) => booking.status !== 'PENDING');
          return (
            <div className="flex flex-col gap-3">
              {pending.length > 0 ? (
                <p className="type-label text-content-subtle">
                  {pending.length} waiting on you
                </p>
              ) : null}
              {pending.map((booking, index) => (
                <div key={booking.id} className="row-in" style={rowStyle(index, reduced)}>
                  <Card tone={C.BOOKING_STATUS[booking.status].tone}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate type-body font-medium">{booking.facilityName}</p>
                        <p className="type-label text-content-subtle">
                          {booking.home.blockName}, {booking.home.label}
                        </p>
                        <p className="type-label text-content-muted">
                          {formatDayYear(booking.bookingDate)} · {formatClockTime(booking.startTime)} –{' '}
                          {formatClockTime(booking.endTime)}
                        </p>
                        <Money value={booking.amountPaise} compact />
                      </div>
                      <StatusPill descriptor={C.BOOKING_STATUS[booking.status]} size="sm" />
                    </div>
                    <div className="mt-3 flex gap-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        fullWidth
                        onClick={() => {
                          setRejecting(booking);
                        }}
                      >
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        fullWidth
                        onClick={() => {
                          void decide(booking, 'CONFIRM');
                        }}
                      >
                        Confirm
                      </Button>
                    </div>
                  </Card>
                </div>
              ))}

              {pending.length > 0 && settled.length > 0 ? (
                <p className="mt-2 type-label text-content-subtle">Already decided</p>
              ) : null}
              {settled.map((booking, index) => (
                <div key={booking.id} className="row-in" style={rowStyle(index, reduced)}>
                  <Card tone={C.BOOKING_STATUS[booking.status].tone}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate type-body font-medium">{booking.facilityName}</p>
                        <p className="type-label text-content-subtle">
                          {booking.home.blockName}, {booking.home.label}
                        </p>
                        <p className="type-label text-content-muted">
                          {formatDayYear(booking.bookingDate)} · {formatClockTime(booking.startTime)} –{' '}
                          {formatClockTime(booking.endTime)}
                        </p>
                      </div>
                      <StatusPill descriptor={C.BOOKING_STATUS[booking.status]} size="sm" />
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          );
        }}
      />

      {rejecting !== null ? (
        <RejectSheet
          booking={rejecting}
          onClose={() => {
            setRejecting(null);
          }}
          onRejected={(reason) => {
            const booking = rejecting;
            setRejecting(null);
            void decide(booking, 'REJECT', reason);
          }}
        />
      ) : null}
    </Shell>
  );
}

function RejectSheet({
  booking,
  onClose,
  onRejected,
}: {
  readonly booking: SocietyBookingWire;
  readonly onClose: () => void;
  readonly onRejected: (reason: string) => void;
}): ReactNode {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(): void {
    if (pending) return;
    if (reason.trim().length < 4) {
      setError('Say why — the resident sees exactly this.');
      return;
    }
    setError(null);
    setPending(true);
    onRejected(reason.trim());
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Decline this booking"
      description="A booking is a shared space; a refusal with a reason keeps it civil."
      pending={pending}
      footer={
        <Button size="lg" variant="danger" fullWidth pending={pending} pendingLabel="Declining" onClick={submit}>
          Decline the booking
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Card padding="tight">
          <p className="type-label text-content-subtle">The request</p>
          <p className="type-body">
            {booking.facilityName} · {booking.home.blockName}, {booking.home.label}
          </p>
          <p className="mt-1 type-label text-content-muted">
            {formatDayYear(booking.bookingDate)} · {formatClockTime(booking.startTime)} –{' '}
            {formatClockTime(booking.endTime)}
          </p>
        </Card>

        <Field
          label="Reason"
          required
          hint="For example: the slot clashes with the society's annual general meeting."
        >
          <Textarea
            value={reason}
            rows={3}
            maxLength={280}
            showCount
            invalid={error !== null}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>

        {error !== null ? (
          <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
