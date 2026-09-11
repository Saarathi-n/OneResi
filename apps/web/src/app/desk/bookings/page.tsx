'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Money,
  Table,
  Textarea,
  useToast,
  type SortState,
} from '@oneresi/ui';
import {
  BOOKING_STATUS,
  UNIT_TYPE,
  paise,
  type BookingStatus,
  type UnitType,
  formatCalendarDate,
} from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * Booking decisions: the committee's half of the facilities handshake. Held slots already appear
 * as taken to the resident (D-72), so this queue only ever contains requests that could still be
 * confirmed. A rejection carries a reason — the resident planned an evening around this.
 */

interface SocietyBookingRow {
  readonly id: number;
  readonly facilityName: string;
  readonly bookingDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: BookingStatus;
  readonly amountPaise: number;
  readonly home: {
    readonly unitId: number;
    readonly blockName: string;
    readonly label: string;
    readonly type: UnitType;
    readonly monthlyChargePaise: number;
  };
}

type SortKey = 'home' | 'facility' | 'date' | 'status' | 'amount';

export default function BookingsPage() {
  const bookings = useFetch<readonly SocietyBookingRow[]>('/api/facilities/bookings/society');
  const toast = useToast();

  const [sort, setSort] = useState<SortState>({ columnId: 'date', direction: 'asc' });
  const [open, setOpen] = useState<SocietyBookingRow | null>(null);
  const [decision, setDecision] = useState<'CONFIRM' | 'REJECT'>('CONFIRM');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const rows = useMemo(() => {
    if (bookings.state.state !== 'ready') return [] as SocietyBookingRow[];
    const home = (row: SocietyBookingRow): string =>
      `${row.home.blockName} ${row.home.label}`;
    const time = (row: SocietyBookingRow): string =>
      `${row.bookingDate}T${row.startTime.padStart(5, '0')}`;
    const compare: Readonly<Record<SortKey, (a: SocietyBookingRow, b: SocietyBookingRow) => number>> = {
      home: (a, b) => home(a).localeCompare(home(b)),
      facility: (a, b) => a.facilityName.localeCompare(b.facilityName),
      date: (a, b) => time(a).localeCompare(time(b)),
      status: (a, b) => a.status.localeCompare(b.status),
      amount: (a, b) => a.amountPaise - b.amountPaise,
    };
    const column = compare[sort.columnId as SortKey] ?? compare.date;
    return [...bookings.state.data].sort(
      (a, b) => (sort.direction === 'asc' ? column(a, b) : -column(a, b)),
    );
  }, [bookings.state, sort]);

  function ask(row: SocietyBookingRow, which: 'CONFIRM' | 'REJECT'): void {
    setOpen(row);
    setDecision(which);
    setReason('');
    setError(null);
  }

  async function decide(): Promise<void> {
    if (open === null) return;
    const trimmed = reason.trim();
    if (decision === 'REJECT' && trimmed.length < 4) {
      setError('A rejection needs a reason the resident can read.');
      return;
    }
    setPending(true);
    setError(null);
    const result = await call<null>(`/api/facilities/bookings/${open.id}/decision`, {
      method: 'POST',
      json: {
        bookingId: open.id,
        decision,
        ...(trimmed.length === 0 ? {} : { reason: trimmed }),
      },
    });
    setPending(false);
    if (result.ok) {
      setOpen(null);
      bookings.reload();
      toast.show({
        title: decision === 'CONFIRM' ? 'Booking confirmed' : 'Booking rejected',
        tone: decision === 'CONFIRM' ? 'positive' : 'neutral',
      });
      return;
    }
    setError(result.error.message);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-display text-content">Booking decisions</h1>
        <p className="type-body mt-1 text-content-muted">
          Clubhouse, terrace, anything bookable. Confirm or reject — either way the household hears
          about it.
        </p>
      </div>

      <Table
        caption="Society bookings, sorted"
        columns={[
          {
            id: 'home',
            header: 'Home',
            sortable: true,
            cell: (row) => (
              <div>
                <p className="type-body text-content">
                  {row.home.blockName} {row.home.label}
                </p>
                <p className="type-micro text-content-subtle">{UNIT_TYPE[row.home.type].label}</p>
              </div>
            ),
          },
          {
            id: 'facility',
            header: 'Facility',
            sortable: true,
            cell: (row) => row.facilityName,
          },
          {
            id: 'date',
            header: 'When',
            sortable: true,
            cell: (row) => (
              <div>
                <p className="type-body text-content">
                  {formatCalendarDate(row.bookingDate)}
                </p>
                <p className="type-micro text-content-subtle">
                  {row.startTime}–{row.endTime}
                </p>
              </div>
            ),
          },
          {
            id: 'amount',
            header: 'Charge',
            align: 'end',
            sortable: true,
            cell: (row) => <Money value={paise(row.amountPaise)} size="body" label={`${row.facilityName} charge`} />,
          },
          {
            id: 'status',
            header: 'Status',
            sortable: true,
            cell: (row) => (
              <Badge tone={BOOKING_STATUS[row.status].tone} size="sm">
                {BOOKING_STATUS[row.status].label}
              </Badge>
            ),
          },
          {
            id: 'actions',
            header: ' ',
            align: 'end',
            cell: (row) => (
              <div className="flex justify-end gap-2">
                {row.status === 'PENDING' ? (
                  <>
                    <Button size="sm" onClick={() => ask(row, 'CONFIRM')}>
                      Confirm
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => ask(row, 'REJECT')}>
                      Reject
                    </Button>
                  </>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={rows}
        rowKey={(row) => String(row.id)}
        sort={sort}
        onSortChange={setSort}
        pending={bookings.state.state === 'loading'}
        error={
          bookings.state.state === 'failed' ? (
            <ErrorState title="Bookings did not load" onRetry={bookings.reload} />
          ) : undefined
        }
        empty={
          <EmptyState
            size="compact"
            title="No bookings"
            description="When a household requests a slot, it lands here for a decision."
          />
        }
      />

      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={
          decision === 'CONFIRM' ? 'Confirm this booking' : 'Reject this booking'
        }
        description={
          open !== null
            ? `${open.home.blockName} ${open.home.label} · ${open.facilityName} · ${open.bookingDate} ${open.startTime}–${open.endTime}`
            : ''
        }
      >
        <div className="space-y-4">
          {decision === 'REJECT' ? (
            <Textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why not — maintenance, another event, whatever the household should know."
            />
          ) : (
            <Textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional note alongside the confirmation."
            />
          )}
          {error !== null ? (
            <p className="type-body text-critical" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button
              variant={decision === 'CONFIRM' ? 'primary' : 'danger'}
              pending={pending}
              pendingLabel={decision === 'CONFIRM' ? 'Confirming' : 'Rejecting'}
              onClick={() => void decide()}
            >
              {decision === 'CONFIRM' ? 'Confirm' : 'Reject'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
