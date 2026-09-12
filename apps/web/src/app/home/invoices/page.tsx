'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, EmptyState, ErrorState, Skeleton, useToast } from '@oneresi/ui';
import {
  formatPeriod,
  formatMoney,
  paise,
  idempotencyKey,
  type PaymentMethod,
} from '@oneresi/contracts';
import { call, usePerson } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * Maintenance & Invoices — Resident Payments surface.
 * Visual reference: docs/reference-images/06-resident-payments.jpg
 *
 * Requirements:
 * - Human-readable status sentences ('Due in 3 days', 'Overdue by 4 days', 'Paid').
 * - Monospace receipt tags (#REC-8841) linking directly to the receipt ceremony.
 * - Radio-card payment selection dialog and panel:
 *   * 'UPI — GPay/PhonePe' with 'Saved' tag
 *   * 'Credit/Debit Card'
 *   * 'Netbanking'
 *   * Action pill: 'Pay ₹X via UPI'
 * - Instant receipt highlight pulse on payment success.
 */

const INVOICES_PATH = '/api/billing/invoices';
const METHOD_KEY = 'oneresi.payment.method';

interface InvoiceLine {
  id: number;
  period: string;
  amountPaise: number;
  dueOn: string;
  status: 'UNPAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  receiptNo: string | null;
  paidAt: string | null;
}

interface PaymentOption {
  id: PaymentMethod;
  label: string;
  saved?: boolean;
  provider: string;
}

const PAYMENT_OPTIONS: readonly PaymentOption[] = [
  { id: 'UPI', label: 'UPI — GPay/PhonePe', saved: true, provider: 'UPI' },
  { id: 'CARD', label: 'Credit/Debit Card', provider: 'Card' },
  { id: 'NETBANKING', label: 'Netbanking', provider: 'Netbanking' },
];

function loadLastMethod(): PaymentMethod {
  if (typeof window === 'undefined') return 'UPI';
  try {
    const raw = window.localStorage.getItem(METHOD_KEY);
    if (raw === 'UPI' || raw === 'CARD' || raw === 'NETBANKING') {
      return raw;
    }
  } catch {
    // Default stands
  }
  return 'UPI';
}

function getStatusSentence(invoice: InvoiceLine): {
  label: string;
  tone: 'caution' | 'critical' | 'positive' | 'neutral';
} {
  if (invoice.status === 'PAID') {
    return { label: 'Paid', tone: 'positive' };
  }
  if (invoice.status === 'CANCELLED') {
    return { label: 'Cancelled', tone: 'neutral' };
  }

  // Calculate day difference against due date
  const due = new Date(invoice.dueOn);
  const now = new Date();
  const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffTime = dueMidnight.getTime() - todayMidnight.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > 1) {
    return { label: `Due in ${diffDays} days`, tone: 'caution' };
  }
  if (diffDays === 1) {
    return { label: 'Due tomorrow', tone: 'caution' };
  }
  if (diffDays === 0) {
    return { label: 'Due today', tone: 'caution' };
  }
  if (diffDays === -1) {
    return { label: 'Overdue by 1 day', tone: 'critical' };
  }
  return { label: `Overdue by ${Math.abs(diffDays)} days`, tone: 'critical' };
}

export default function InvoicesPage() {
  const person = usePerson();
  const invoices = useFetch<readonly InvoiceLine[]>(INVOICES_PATH);
  const toast = useToast();

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('UPI');
  const [paying, setPaying] = useState<InvoiceLine | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedReceiptNo, setHighlightedReceiptNo] = useState<string | null>(null);
  const [justPaidReceipt, setJustPaidReceipt] = useState<{
    receiptNo: string;
    period: string;
    amountPaise: number;
  } | null>(null);

  // One key per invoice, minted when the payment is first attempted. Every retry — a double-tap,
  // a tap after a dropped response — reuses it, which is what makes the retry safe: the server
  // records the first result against the key instead of taking the money twice.
  const payKeys = useRef(new Map<number, string>());

  useEffect(() => {
    setSelectedMethod(loadLastMethod());
  }, []);

  const rows = useMemo(
    () =>
      invoices.state.state === 'ready'
        ? [...invoices.state.data].sort((a, b) => b.period.localeCompare(a.period))
        : [],
    [invoices.state],
  );

  const openInvoices = rows.filter((r) => r.status === 'UNPAID' || r.status === 'OVERDUE');
  const primaryDueInvoice = openInvoices[0] ?? rows[0];

  const unitSubtitle =
    person?.home != null ? `${person.home.blockName}-${person.home.label}` : null;

  async function handleSettle(target: InvoiceLine): Promise<void> {
    setPending(true);
    setError(null);

    const key = payKeys.current.get(target.id) ?? idempotencyKey();
    payKeys.current.set(target.id, key);

    const result = await call<InvoiceLine>(`/api/billing/invoices/${target.id}/pay`, {
      method: 'POST',
      json: { invoiceId: target.id, method: selectedMethod, idempotencyKey: key },
    });

    setPending(false);

    if (!result.ok || result.data.receiptNo === null) {
      const message = result.ok
        ? 'The payment was recorded, but no receipt number came back — check your invoices in a moment.'
        : result.error.message;
      setError(message);
      // The key stays minted for this invoice: if the first attempt landed after all, a retry
      // replays the same result instead of taking the money twice.
      toast.show({
        title: 'The payment did not go through',
        description: message,
        tone: 'critical',
      });
      return;
    }

    const receiptNo = result.data.receiptNo;
    payKeys.current.delete(target.id);

    try {
      window.localStorage.setItem(METHOD_KEY, selectedMethod);
    } catch {
      // Storage failure is non-blocking
    }

    // Instant receipt highlight pulse
    setHighlightedReceiptNo(receiptNo);
    setJustPaidReceipt({
      receiptNo,
      period: target.period,
      amountPaise: result.data.amountPaise,
    });

    invoices.reload();

    toast.show({
      title: 'Payment recorded',
      description: `${formatPeriod(target.period)} is settled. Receipt #${receiptNo} issued.`,
      tone: 'positive',
    });
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Page Header matching Reference 06 */}
      <header>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-content">
          Maintenance & Invoices
        </h1>
        {unitSubtitle !== null ? (
          <p className="type-body text-base text-content-muted mt-1 font-medium">{unitSubtitle}</p>
        ) : null}
      </header>

      {invoices.state.state === 'loading' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 space-y-3">
            <Skeleton variant="block" height={72} />
            <Skeleton variant="block" height={72} />
            <Skeleton variant="block" height={72} />
            <Skeleton variant="block" height={72} />
          </div>
          <div className="lg:col-span-4">
            <Skeleton variant="block" height={320} />
          </div>
        </div>
      ) : invoices.state.state === 'failed' ? (
        <ErrorState title="Your invoices did not load" onRetry={invoices.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="When the society raises a maintenance demand, it appears here with its amount and due date."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: List of Invoice Rows */}
          <section className="lg:col-span-8 space-y-3.5" aria-label="Invoice Ledger">
            {rows.map((invoice) => {
              const statusSentence = getStatusSentence(invoice);
              const isHighlighted =
                highlightedReceiptNo !== null && invoice.receiptNo === highlightedReceiptNo;
              const formattedAmount = formatMoney(paise(invoice.amountPaise), { compact: true });

              return (
                <div
                  key={invoice.id}
                  className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-raised px-5 py-4 shadow-xs transition-all ${
                    isHighlighted
                      ? 'ring-2 ring-accent bg-accent-soft/30 border-accent'
                      : 'hover:border-border-strong'
                  }`}
                >
                  {/* Left: Period & Amount */}
                  <div className="flex items-center gap-6 sm:gap-12 min-w-[220px]">
                    <span className="type-body font-medium text-content text-base sm:text-lg min-w-[140px]">
                      {formatPeriod(invoice.period)}
                    </span>
                    <span className="type-numeric font-semibold text-content text-base sm:text-lg tabular-nums">
                      {formattedAmount}
                    </span>
                  </div>

                  {/* Right: Status Pill, Monospace Receipt Tag & Action Link */}
                  <div className="flex items-center gap-3 ml-auto">
                    {/* Human-readable status sentence pill */}
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${
                        statusSentence.tone === 'positive'
                          ? 'bg-positive-soft text-positive border-positive-border'
                          : statusSentence.tone === 'critical'
                            ? 'bg-critical-soft text-critical border-critical-border'
                            : statusSentence.tone === 'caution'
                              ? 'bg-caution-soft text-caution border-caution-border'
                              : 'bg-surface-sunken text-content-muted border-border'
                      }`}
                    >
                      {statusSentence.label}
                    </span>

                    {/* Monospace receipt tag and link */}
                    {invoice.receiptNo !== null ? (
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/receipts/${invoice.receiptNo}`}
                          className={`font-mono text-xs font-semibold px-2.5 py-1 rounded-md bg-surface-sunken border border-border text-content hover:border-accent hover:text-accent transition-colors ${
                            isHighlighted ? 'animate-pulse ring-2 ring-accent/60 bg-accent-soft' : ''
                          }`}
                        >
                          #{invoice.receiptNo}
                        </Link>
                        <Link
                          href={`/receipts/${invoice.receiptNo}`}
                          className="text-sm font-medium text-content hover:text-accent focus-ring rounded transition-colors"
                        >
                          Receipt
                        </Link>
                      </div>
                    ) : (
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
                    )}
                  </div>
                </div>
              );
            })}
          </section>

          {/* Right Column: Radio-Card Payment Panel matching Reference 06 */}
          {primaryDueInvoice !== undefined && (
            <aside className="lg:col-span-4 sticky top-20">
              <div className="rounded-2xl border border-border bg-surface-raised p-6 shadow-sm">
                {justPaidReceipt !== null ? (
                  /* Success State with Instant Receipt Highlight Pulse */
                  <div className="text-center py-4 space-y-4">
                    <div className="size-12 rounded-full bg-positive-soft text-positive flex items-center justify-center mx-auto">
                      <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="type-title font-semibold text-content">Payment Settled</h3>
                      <p className="type-micro text-content-subtle mt-0.5">
                        {formatPeriod(justPaidReceipt.period)} maintenance dues settled
                      </p>
                    </div>

                    <div className="my-5 p-4 rounded-xl bg-accent-soft border border-accent-border ring-4 ring-accent/20 animate-pulse text-left">
                      <p className="type-micro uppercase tracking-wider font-semibold text-accent">
                        Official Receipt
                      </p>
                      <p className="font-mono text-lg font-bold text-content mt-0.5">
                        #{justPaidReceipt.receiptNo}
                      </p>
                    </div>

                    <div className="space-y-2 pt-2">
                      <Link
                        href={`/receipts/${justPaidReceipt.receiptNo}`}
                        className="w-full inline-flex items-center justify-center rounded-pill bg-accent hover:bg-accent-hover text-accent-on py-3 px-6 font-semibold transition-all shadow-xs"
                      >
                        View Receipt Ceremony →
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => setJustPaidReceipt(null)}
                      >
                        Settle another period
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Payment Selector */
                  <div className="space-y-6">
                    <div>
                      <p className="type-mega text-4xl sm:text-5xl font-bold text-content tracking-tight tabular-nums">
                        {formatMoney(paise(primaryDueInvoice.amountPaise), { compact: true })}
                      </p>
                      <p className="type-micro text-content-subtle mt-1 font-medium">
                        {formatPeriod(primaryDueInvoice.period)} Maintenance Dues
                      </p>
                    </div>

                    {/* Radio Cards */}
                    <div className="space-y-3" role="radiogroup" aria-label="Payment Method">
                      {PAYMENT_OPTIONS.map((option) => {
                        const isSelected = selectedMethod === option.id;
                        return (
                          <label
                            key={option.id}
                            className={`relative flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer ${
                              isSelected
                                ? 'border-accent bg-accent-soft/20 shadow-xs'
                                : 'border-border bg-surface-raised hover:border-border-strong'
                            }`}
                          >
                            <div className="flex items-center gap-3.5">
                              {/* Custom Radio Ring */}
                              <div
                                className={`size-5 rounded-full border flex items-center justify-center transition-colors ${
                                  isSelected
                                    ? 'border-accent bg-surface-raised'
                                    : 'border-border-strong bg-surface'
                                }`}
                              >
                                {isSelected && (
                                  <div className="size-2.5 rounded-full bg-accent" />
                                )}
                              </div>
                              <span className="type-body font-medium text-content text-sm sm:text-base">
                                {option.label}
                              </span>
                            </div>

                            {option.saved && (
                              <span className="type-micro font-medium px-2 py-0.5 rounded-full bg-surface-sunken text-content-subtle border border-border">
                                Saved
                              </span>
                            )}

                            <input
                              type="radio"
                              name="primary-payment-method"
                              value={option.id}
                              checked={isSelected}
                              onChange={() => setSelectedMethod(option.id)}
                              className="sr-only"
                            />
                          </label>
                        );
                      })}
                    </div>

                    {/* Action Pill Button */}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void handleSettle(primaryDueInvoice)}
                      className="w-full rounded-pill bg-accent hover:bg-accent-hover active:bg-accent-pressed text-accent-on py-3.5 px-6 font-semibold shadow-e2 transition-all flex items-center justify-center gap-2 focus-ring disabled:opacity-60"
                    >
                      {pending ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="size-4 rounded-full border-2 border-accent-on border-t-transparent animate-spin" />
                          Processing settlement...
                        </span>
                      ) : (
                        `Pay ${formatMoney(paise(primaryDueInvoice.amountPaise), { compact: true })} via ${
                          selectedMethod === 'UPI'
                            ? 'UPI'
                            : selectedMethod === 'CARD'
                              ? 'Card'
                              : 'Netbanking'
                        }`
                      )}
                    </button>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {/* Radio-card Payment Selection Dialog */}
      <Dialog
        open={paying !== null}
        onClose={() => (pending ? undefined : setPaying(null))}
        title={paying !== null ? `Settle ${formatPeriod(paying.period)}` : 'Pay'}
        description={
          paying !== null
            ? 'The society records the payment and issues an official numbered receipt with a live ledger entry.'
            : undefined
        }
        pending={pending}
      >
        {paying !== null && (
          <div className="space-y-6 pt-2">
            {error !== null && (
              <p className="type-body text-critical" role="alert">
                {error}
              </p>
            )}

            <div>
              <p className="type-micro uppercase tracking-wider text-content-subtle font-semibold">
                Amount Due
              </p>
              <p className="type-mega text-3xl sm:text-4xl font-bold text-content mt-1 tabular-nums">
                {formatMoney(paise(paying.amountPaise), { compact: true })}
              </p>
            </div>

            {/* Radio-card Payment Selection in Dialog */}
            <div className="space-y-3" role="radiogroup" aria-label="Select Payment Method">
              {PAYMENT_OPTIONS.map((option) => {
                const isSelected = selectedMethod === option.id;
                return (
                  <label
                    key={option.id}
                    className={`relative flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-accent bg-accent-soft/20 shadow-xs'
                        : 'border-border bg-surface-raised hover:border-border-strong'
                    }`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className={`size-5 rounded-full border flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'border-accent bg-surface-raised'
                            : 'border-border-strong bg-surface'
                        }`}
                      >
                        {isSelected && <div className="size-2.5 rounded-full bg-accent" />}
                      </div>
                      <span className="type-body font-medium text-content text-sm sm:text-base">
                        {option.label}
                      </span>
                    </div>

                    {option.saved && (
                      <span className="type-micro font-medium px-2 py-0.5 rounded-full bg-surface-sunken text-content-subtle border border-border">
                        Saved
                      </span>
                    )}

                    <input
                      type="radio"
                      name="dialog-payment-method"
                      value={option.id}
                      checked={isSelected}
                      onChange={() => setSelectedMethod(option.id)}
                      className="sr-only"
                    />
                  </label>
                );
              })}
            </div>

            {/* Dialog Footer Actions */}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t border-border">
              <Button variant="ghost" onClick={() => setPaying(null)} disabled={pending}>
                Cancel
              </Button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (paying !== null) {
                    const target = paying;
                    setPaying(null);
                    void handleSettle(target);
                  }
                }}
                className="rounded-pill bg-accent hover:bg-accent-hover active:bg-accent-pressed text-accent-on py-3 px-6 font-semibold shadow-xs transition-all flex items-center justify-center gap-2 focus-ring disabled:opacity-60"
              >
                {pending ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="size-4 rounded-full border-2 border-accent-on border-t-transparent animate-spin" />
                    Recording...
                  </span>
                ) : (
                  `Pay ${formatMoney(paise(paying.amountPaise), { compact: true })} via ${
                    selectedMethod === 'UPI'
                      ? 'UPI'
                      : selectedMethod === 'CARD'
                        ? 'Card'
                        : 'Netbanking'
                  }`
                )}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
