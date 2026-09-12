'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Money,
  RelativeTime,
  Select,
  Skeleton,
  useToast,
} from '@oneresi/ui';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD,
  formatCalendarDate,
  formatPeriod,
  paise,
  type INVOICE_STATUS,
  type PaymentMethod,
} from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * The household passbook. One page, one sheet: the figure the page is about sits at the top and
 * counts itself up, a perforation tears it away from the ledger, and every period reads as a
 * ruled line — the month in words, the amount, the stamp, the receipt number in the fixed-width
 * hand a ledger is kept in. It is modelled on the passbook it replaces, not on a dashboard.
 */

const INVOICES_PATH = '/api/billing/invoices';
const METHOD_KEY = 'oneresi.payment.method';

/**
 * What a household may settle with online. Cash is deliberately absent: money in hand is recorded
 * by the committee against the invoice, with their name on the row — a household marking its own
 * invoice settled "by cash" is a claim nobody witnessed, not a payment.
 */
const RESIDENT_METHODS = PAYMENT_METHODS.filter((method) => method !== 'CASH');

interface InvoiceLine {
  id: number;
  period: string;
  amountPaise: number;
  dueOn: string;
  status: keyof typeof INVOICE_STATUS;
  receiptNo: string | null;
  paidAt: string | null;
}

function loadLastMethod(): PaymentMethod {
  if (typeof window === 'undefined') return 'UPI';
  try {
    const raw = window.localStorage.getItem(METHOD_KEY);
    if (raw !== null && (RESIDENT_METHODS as readonly string[]).includes(raw)) {
      return raw as PaymentMethod;
    }
  } catch {
    // No draft then; the default stands.
  }
  return 'UPI';
}

/** The rubber stamp a line earns. The word lands; it is not styled. */
function Stamp({ tone, children }: { tone: string; children: ReactNode }): ReactNode {
  return <span className={`stamp type-micro ${tone}`}>{children}</span>;
}

export default function InvoicesPage() {
  const invoices = useFetch<readonly InvoiceLine[]>(INVOICES_PATH);
  const toast = useToast();
  const [paying, setPaying] = useState<InvoiceLine | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('UPI');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMethod(loadLastMethod());
  }, []);

  async function confirmPay(): Promise<void> {
    if (paying === null) return;
    setPending(true);
    setError(null);
    const result = await call<InvoiceLine>(`/api/billing/invoices/${paying.id}/pay`, {
      method: 'POST',
      json: { invoiceId: paying.id, method },
    });
    setPending(false);
    if (result.ok) {
      try {
        window.localStorage.setItem(METHOD_KEY, method);
      } catch {
        // Remembering is a convenience, never a requirement.
      }
      setPaying(null);
      invoices.reload();
      toast.show({
        title: 'Payment recorded',
        description: `${formatPeriod(paying.period)} is settled. The receipt is in your ledger.`,
        tone: 'positive',
      });
      return;
    }
    setError(result.error.message);
  }

  const rows =
    invoices.state.state === 'ready'
      ? [...invoices.state.data].sort((a, b) => b.period.localeCompare(a.period))
      : [];
  const open = rows.filter((row) => row.status === 'UNPAID' || row.status === 'OVERDUE');
  const overdue = open.some((row) => row.status === 'OVERDUE');
  const settled = rows.filter((row) => row.status === 'PAID');
  const settledTotal = settled.reduce((sum, row) => sum + row.amountPaise, 0);
  const nextDue = open[0];

  return (
    <div className="space-y-6">
      <header>
        <p className="type-micro uppercase tracking-[0.22em] text-content-subtle">Payments</p>
        <h1 className="type-display mt-1 text-content">
          {open.length > 0 ? 'The ledger has an open line.' : 'All settled.'}
        </h1>
      </header>

      {invoices.state.state === 'loading' ? (
        <div className="space-y-3">
          <Skeleton variant="block" height={190} />
          <Skeleton variant="block" height={64} />
          <Skeleton variant="block" height={64} />
          <Skeleton variant="block" height={64} />
        </div>
      ) : invoices.state.state === 'failed' ? (
        <div className="rounded-2xl border border-border bg-surface-raised p-6">
          <ErrorState
            title="Your passbook did not load"
            description="Try again in a moment; nothing has changed on your account."
            onRetry={invoices.reload}
          />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing on the ledger yet"
          description="When the committee raises a billing period, the invoice for your home appears here with its own line."
        />
      ) : (
        <section className="clip-ticket shadow-e2 overflow-hidden rounded-2xl bg-surface-raised edge-light">
          {/* The figure the page is about. One per screen. */}
          <div className="hero-wash px-6 pb-6 pt-5">
            <p className="type-micro uppercase tracking-[0.22em] text-content-subtle">
              {open.length > 0 ? 'Total due' : 'Settled this year'}
            </p>
            <div className="mt-2">
              {open.length > 0 ? (
                <Money
                  value={paise(open.reduce((sum, row) => sum + row.amountPaise, 0))}
                  size="mega"
                  countUp
                  tone={overdue ? 'critical' : 'default'}
                  label="total due"
                />
              ) : (
                <Money
                  value={paise(settledTotal)}
                  size="mega"
                  countUp
                  tone="gold"
                  glow
                  label="settled this year"
                />
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="type-label text-content-muted">
                {open.length > 0 && nextDue !== undefined ? (
                  <>
                    {open.length === 1
                      ? formatPeriod(nextDue.period)
                      : `${open.length} invoices open`}
                    {` · due ${formatCalendarDate(nextDue.dueOn)}`}
                    {overdue ? ' · the office has begun to ask' : ''}
                  </>
                ) : (
                  <>
                    {settled.length} receipt{settled.length === 1 ? '' : 's'} on file · nothing
                    outstanding
                  </>
                )}
              </p>
              {nextDue !== undefined ? (
                <Button
                  pending={pending}
                  pendingLabel="Opening the pay dialog"
                  onClick={() => {
                    setPaying(nextDue);
                    setError(null);
                  }}
                >
                  Settle {formatPeriod(nextDue.period)}
                </Button>
              ) : null}
            </div>
          </div>

          {/* Where the header tears away from the ledger. */}
          <div className="tear-line" style={{ ['--tear-inset' as string]: '24px' }} aria-hidden />

          <ul className="divide-y divide-border px-6 pb-2">
            {rows.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="type-body font-medium text-content">
                    {formatPeriod(invoice.period)}
                  </p>
                  <p className="type-micro mt-0.5 text-content-subtle">
                    {invoice.status === 'PAID' && invoice.paidAt !== null ? (
                      <>
                        Paid <RelativeTime value={invoice.paidAt} /> ·{' '}
                      </>
                    ) : invoice.status === 'CANCELLED' ? (
                      'Cancelled — nothing to pay · '
                    ) : (
                      `Due ${formatCalendarDate(invoice.dueOn)} · `
                    )}
                    {invoice.receiptNo !== null ? (
                      <Link
                        href={`/receipts/${invoice.receiptNo}`}
                        className="type-mono text-accent underline decoration-border underline-offset-2 hover:decoration-accent focus-ring rounded-xs"
                      >
                        {invoice.receiptNo}
                      </Link>
                    ) : (
                      'receipt to follow'
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Money value={paise(invoice.amountPaise)} compact label={`${invoice.period} maintenance`} />
                  {invoice.status === 'PAID' ? (
                    <Stamp tone="text-gold">Paid</Stamp>
                  ) : invoice.status === 'OVERDUE' ? (
                    <Stamp tone="text-critical">Overdue</Stamp>
                  ) : invoice.status === 'UNPAID' ? (
                    <Stamp tone="text-accent">Due</Stamp>
                  ) : (
                    <Stamp tone="text-content-subtle">Cancelled</Stamp>
                  )}
                  {invoice.status === 'UNPAID' || invoice.status === 'OVERDUE' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setPaying(invoice);
                        setError(null);
                      }}
                    >
                      Pay
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        open={paying !== null}
        onClose={() => (pending ? undefined : setPaying(null))}
        title={paying !== null ? `Settle ${formatPeriod(paying.period)}` : 'Pay'}
        description={
          paying !== null
            ? 'The society records the payment and issues a numbered receipt — it lands at the top of your ledger.'
            : undefined
        }
        pending={pending}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPaying(null)} disabled={pending}>
              Cancel
            </Button>
            <Button pending={pending} pendingLabel="Recording payment" onClick={() => void confirmPay()}>
              Pay {paying !== null ? <Money value={paise(paying.amountPaise)} label="amount" /> : null}
            </Button>
          </div>
        }
      >
        {error !== null ? (
          <p className="type-body text-critical" role="alert">
            {error}
          </p>
        ) : null}
        <Select
          options={RESIDENT_METHODS.map((value) => ({
            value,
            label: PAYMENT_METHOD[value].label,
          }))}
          value={method}
          onChange={(event) => setMethod(event.target.value as PaymentMethod)}
        />
        <p className="type-micro mt-2 text-content-subtle">
          We remembered {PAYMENT_METHOD[loadLastMethod()].label} from last time. Cash is recorded
          by the society office.
        </p>
      </Dialog>
    </div>
  );
}
