'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Money,
  Table,
  Textarea,
  useToast,
  type SortState,
} from '@oneresi/ui';
import {
  INVOICE_STATUS,
  UNIT_TYPE,
  formatMoney,
  paise,
  type InvoiceStatus,
  type UnitType,
  formatCalendarDateShort,
  formatPeriod,
} from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * The society ledger: every invoice in the society, on one dense, sortable table — the desk is
 * where a committee member works, so rows per screen beat pages of cards. Raise, record offline
 * money, and void, all without leaving the ledger.
 */

interface LedgerRow {
  readonly id: number;
  readonly period: string;
  readonly amountPaise: number;
  readonly dueOn: string;
  readonly status: InvoiceStatus;
  readonly receiptNo: string | null;
  readonly paidAt: string | null;
  readonly home: {
    readonly unitId: number;
    readonly blockName: string;
    readonly label: string;
    readonly type: UnitType;
    readonly monthlyChargePaise: number;
  };
}

type SortKey = 'home' | 'period' | 'dueOn' | 'amount' | 'status';

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const;

export default function LedgerPage() {
  const ledger = useFetch<readonly LedgerRow[]>('/api/billing/invoices/society');
  const toast = useToast();

  const [sort, setSort] = useState<SortState>({ columnId: 'dueOn', direction: 'asc' });
  const [filter, setFilter] = useState<string>('ALL');

  const [raiseOpen, setRaiseOpen] = useState(false);
  const [period, setPeriod] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [raiseError, setRaiseError] = useState<string | null>(null);
  const [raisePending, setRaisePending] = useState(false);

  const [offlineFor, setOfflineFor] = useState<LedgerRow | null>(null);
  const [offlineAmount, setOfflineAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [offlineNote, setOfflineNote] = useState('');
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const [offlinePending, setOfflinePending] = useState(false);

  const [cancelFor, setCancelFor] = useState<LedgerRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelPending, setCancelPending] = useState(false);

  const rows = useMemo(() => {
    if (ledger.state.state !== 'ready') return [] as LedgerRow[];
    const filtered =
      filter === 'ALL'
        ? ledger.state.data
        : ledger.state.data.filter((row) => row.status === filter);
    const home = (row: LedgerRow): string => `${row.home.blockName} ${row.home.label}`;
    const compare: Readonly<Record<SortKey, (a: LedgerRow, b: LedgerRow) => number>> = {
      home: (a, b) => home(a).localeCompare(home(b)),
      period: (a, b) => a.period.localeCompare(b.period),
      dueOn: (a, b) => a.dueOn.localeCompare(b.dueOn),
      amount: (a, b) => a.amountPaise - b.amountPaise,
      status: (a, b) => a.status.localeCompare(b.status),
    };
    const column = compare[sort.columnId as SortKey] ?? compare.dueOn;
    const sorted = [...filtered].sort(
      (a, b) => (sort.direction === 'asc' ? column(a, b) : -column(a, b)),
    );
    return sorted;
  }, [ledger.state, filter, sort]);

  const totalDue = useMemo(() => {
    if (ledger.state.state !== 'ready') return 0;
    return ledger.state.data
      .filter((row) => row.status === 'UNPAID' || row.status === 'OVERDUE')
      .reduce((sum, row) => sum + row.amountPaise, 0);
  }, [ledger.state]);

  async function raise(): Promise<void> {
    if (period.trim().length === 0 || dueDate === '') {
      setRaiseError('Give the period and the due date.');
      return;
    }
    setRaisePending(true);
    setRaiseError(null);
    const result = await call<{ raised: number }>('/api/billing/invoices', {
      method: 'POST',
      json: { period: period.trim(), dueDate },
    });
    setRaisePending(false);
    if (result.ok) {
      setRaiseOpen(false);
      setPeriod('');
      setDueDate('');
      ledger.reload();
      toast.show({
        title: `${result.data.raised} invoice${result.data.raised === 1 ? '' : 's'} raised`,
        description: 'Every home in the society gets its maintenance demand for this period.',
        tone: 'positive',
      });
      return;
    }
    setRaiseError(result.error.message);
  }

  async function recordOffline(): Promise<void> {
    if (offlineFor === null) return;
    const rupees = Number(offlineAmount.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setOfflineError('Type the amount you actually received, in rupees.');
      return;
    }
    const amountPaise = Math.round(rupees * 100);
    if (amountPaise !== offlineFor.amountPaise) {
      setOfflineError(
        `The amount has to match the invoice in full (${formatMoney(paise(offlineFor.amountPaise))}) — part settlement is not supported.`,
      );
      return;
    }
    if (receivedOn === '') {
      setOfflineError('When did the money arrive?');
      return;
    }
    setOfflinePending(true);
    setOfflineError(null);
    const result = await call<null>(`/api/billing/invoices/${offlineFor.id}/offline-payment`, {
      method: 'POST',
      json: {
        invoiceId: offlineFor.id,
        amountPaise,
        method: 'CASH',
        receivedOn,
        ...(offlineNote.trim().length === 0 ? {} : { note: offlineNote.trim() }),
      },
    });
    setOfflinePending(false);
    if (result.ok) {
      setOfflineFor(null);
      ledger.reload();
      toast.show({ title: 'Offline payment recorded', tone: 'positive' });
      return;
    }
    setOfflineError(result.error.message);
  }

  async function cancelInvoice(): Promise<void> {
    if (cancelFor === null) return;
    if (cancelReason.trim().length < 4) {
      setCancelError('Say why the invoice is being voided.');
      return;
    }
    setCancelPending(true);
    setCancelError(null);
    const result = await call<null>(`/api/billing/invoices/${cancelFor.id}/cancel`, {
      method: 'POST',
      json: { invoiceId: cancelFor.id, reason: cancelReason.trim() },
    });
    setCancelPending(false);
    if (result.ok) {
      setCancelFor(null);
      setCancelReason('');
      ledger.reload();
      toast.show({ title: 'Invoice voided', tone: 'neutral' });
      return;
    }
    setCancelError(result.error.message);
  }

  const data = ledger.state.state === 'ready' ? ledger.state.data : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-display text-content">Society ledger</h1>
          <p className="type-body mt-1 text-content-muted">
            {data.length} invoice{data.length === 1 ? '' : 's'}
            {totalDue > 0
              ? ` · ${formatMoney(paise(totalDue))} outstanding`
              : ' · nothing outstanding'}
          </p>
        </div>
        <Button
          onClick={() => {
            setRaiseOpen(true);
            setPeriod(new Date().toISOString().slice(0, 7));
            setDueDate(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
            setRaiseError(null);
          }}
        >
          Raise a period
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((option) => (
          <Button
            key={option.value}
            variant={filter === option.value ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <Table
        caption="Society ledger, sorted"
        minWidth={860}
        columns={[
          {
            id: 'home',
            header: 'Home',
            sortable: true,
            width: '22%',
            cell: (row) => (
              <div className="min-w-0">
                <p
                  className="type-body truncate text-content"
                  title={`${row.home.blockName} ${row.home.label}`}
                >
                  {row.home.blockName} {row.home.label}
                </p>
                <p
                  className="type-micro truncate text-content-subtle"
                  title={UNIT_TYPE[row.home.type].label}
                >
                  {UNIT_TYPE[row.home.type].label}
                </p>
              </div>
            ),
          },
          {
            id: 'period',
            header: 'Period',
            sortable: true,
            width: '13%',
            cell: (row) => (
              <div className="truncate" title={formatPeriod(row.period)}>
                <span className="type-label">{formatPeriod(row.period)}</span>
              </div>
            ),
          },
          {
            id: 'dueOn',
            header: 'Due',
            sortable: true,
            width: '11%',
            cell: (row) => (
              <span className="type-label whitespace-nowrap">
                {formatCalendarDateShort(row.dueOn)}
              </span>
            ),
            secondary: true,
          },
          {
            id: 'amount',
            header: 'Amount',
            align: 'end',
            sortable: true,
            width: '13%',
            cell: (row) => (
              <div
                className="truncate"
                title={formatMoney(paise(row.amountPaise), { compact: true })}
              >
                <Money
                  value={paise(row.amountPaise)}
                  size="body"
                  compact
                  animated={false}
                  label={`${row.period} amount`}
                />
              </div>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            sortable: true,
            width: '13%',
            cell: (row) => (
              <div className="whitespace-nowrap" title={INVOICE_STATUS[row.status].label}>
                <Badge tone={INVOICE_STATUS[row.status].tone} size="sm">
                  {INVOICE_STATUS[row.status].label}
                </Badge>
              </div>
            ),
          },
          {
            id: 'actions',
            header: ' ',
            align: 'end',
            width: '18%',
            cell: (row) => (
              <div className="flex justify-end gap-2 whitespace-nowrap">
                {row.status === 'UNPAID' || row.status === 'OVERDUE' ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setOfflineFor(row);
                        setOfflineAmount((row.amountPaise / 100).toFixed(2));
                        setReceivedOn(new Date().toISOString().slice(0, 10));
                        setOfflineNote('');
                        setOfflineError(null);
                      }}
                    >
                      Offline
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setCancelFor(row)}>
                      Void
                    </Button>
                  </>
                ) : row.status === 'PAID' && row.receiptNo !== null ? (
                  <a
                    href={`/receipts/${row.receiptNo}`}
                    className="type-mono text-accent underline decoration-border underline-offset-2 hover:decoration-accent"
                  >
                    {row.receiptNo}
                  </a>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={rows}
        rowKey={(row) => String(row.id)}
        dense
        sort={sort}
        onSortChange={setSort}
        pending={ledger.state.state === 'loading'}
        error={
          ledger.state.state === 'failed' ? (
            <ErrorState title="The ledger did not load" onRetry={ledger.reload} />
          ) : undefined
        }
        empty={
          filter === 'ALL' ? (
            <EmptyState
              size="compact"
              title="No invoices yet"
              description="Raise a period and every home in the society gets its maintenance demand at once."
            />
          ) : (
            <EmptyState
              size="compact"
              title="Nothing here"
              description={`No ${filter.toLowerCase()} invoices right now.`}
            />
          )
        }
      />

      <Dialog
        open={raiseOpen}
        onClose={() => setRaiseOpen(false)}
        title="Raise invoices for a period"
        description="One run, every home, one amount each: the monthly charge set on the unit. If the period already exists, the run is refused outright."
      >
        <div className="space-y-4">
          <Field label="Period" required hint="e.g. 2026-09 — the label residents will see.">
            <Input
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              placeholder="2026-09"
            />
          </Field>
          <Field label="Due date" required>
            <Input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
          {raiseError !== null ? (
            <p className="type-body text-critical" role="alert">
              {raiseError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRaiseOpen(false)}>
              Cancel
            </Button>
            <Button
              pending={raisePending}
              pendingLabel="Raising the invoices"
              onClick={() => void raise()}
            >
              Raise
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={offlineFor !== null}
        onClose={() => setOfflineFor(null)}
        title="Record money received outside OneResi"
        description={
          offlineFor !== null
            ? `${offlineFor.home.blockName} ${offlineFor.home.label} · ${offlineFor.period}`
            : ''
        }
      >
        <div className="space-y-4">
          <Field
            label="Amount received"
            required
            hint={
              offlineFor !== null
                ? `Rupees. The invoice stands at ${formatMoney(paise(offlineFor.amountPaise))} — the amount has to match it in full.`
                : 'Rupees. The amount has to match the invoice in full.'
            }
          >
            <Input
              inputMode="decimal"
              value={offlineAmount}
              onChange={(event) => setOfflineAmount(event.target.value)}
            />
          </Field>
          <Field label="Received on" required>
            <Input
              type="date"
              value={receivedOn}
              onChange={(event) => setReceivedOn(event.target.value)}
            />
          </Field>
          <Field label="Note (optional)" optional>
            <Textarea
              rows={2}
              value={offlineNote}
              onChange={(event) => setOfflineNote(event.target.value)}
              placeholder="Cash at the office, cheque number, anything the record should keep."
            />
          </Field>
          {offlineError !== null ? (
            <p className="type-body text-critical" role="alert">
              {offlineError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOfflineFor(null)}>
              Cancel
            </Button>
            <Button
              pending={offlinePending}
              pendingLabel="Recording the payment"
              onClick={() => void recordOffline()}
            >
              Record
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={cancelFor !== null}
        onClose={() => setCancelFor(null)}
        title="Void an invoice"
        description={
          cancelFor !== null
            ? `${cancelFor.home.blockName} ${cancelFor.home.label} · ${cancelFor.period} — this cannot be undone, and the resident sees it.`
            : ''
        }
      >
        <div className="space-y-4">
          <Field label="Reason" required hint="Kept with the invoice and shown to the resident.">
            <Textarea
              rows={3}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="What was wrong with the demand."
            />
          </Field>
          {cancelError !== null ? (
            <p className="type-body text-critical" role="alert">
              {cancelError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelFor(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              pending={cancelPending}
              pendingLabel="Voiding the invoice"
              onClick={() => void cancelInvoice()}
            >
              Void
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
