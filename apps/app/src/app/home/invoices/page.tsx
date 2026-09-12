'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Card,
  Field,
  Money,
  Select,
  Sheet,
  StatusPill,
  useToast,
} from '@oneresi/ui';
import * as C from '@oneresi/contracts';
import { Icon } from '@/components/icons';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { call, simple, webOrigin } from '@/lib/api';
import { RESIDENT_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import { duePhrase, formatDayYear, formatPeriod } from '@/lib/format';
import { newIdempotencyKey } from '@/lib/replay-queue';
import type { InvoiceWire } from '@/lib/types';

/**
 * The household ledger. Every invoice the society has raised, what is due now, and the receipt for
 * everything paid. Payment goes out with a client-generated idempotency key, so a retry after a
 * dropped connection can never pay twice — but a payment is never queued for later: money moves
 * only when the person sees it move.
 */

/** Methods a resident can pay with here; cash reaches the ledger through the committee desk. */
const RESIDENT_METHODS = (['UPI', 'CARD', 'NETBANKING'] as const).map((method) => ({
  value: method,
  label: C.PAYMENT_METHOD[method].label,
}));

const METHOD_KEY = 'oneresi.payment.method';

function loadLastMethod(): C.PaymentMethod {
  if (typeof window === 'undefined') return 'UPI';
  try {
    const raw = window.localStorage.getItem(METHOD_KEY);
    if (raw === 'UPI' || raw === 'CARD' || raw === 'NETBANKING') return raw;
  } catch {
    // Remembering is a convenience, never a requirement.
  }
  return 'UPI';
}

export default function InvoicesPage(): ReactNode {
  const reduced = useReducedMotion();
  const toast = useToast();
  const invoices = useAsync(() => simple<readonly InvoiceWire[]>('/api/billing/invoices'), []);

  const refresh = useCallback(async () => {
    invoices.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [invoices]);

  const [paying, setPaying] = useState<InvoiceWire | null>(null);

  const due =
    invoices.state.state === 'ready'
      ? invoices.state.data.filter((invoice) => invoice.status === 'UNPAID' || invoice.status === 'OVERDUE')
      : [];
  const dueTotal = C.addMoney(...due.map((invoice) => invoice.amountPaise));

  return (
    <Shell title="Billing" tabs={RESIDENT_TABS} activeTab="/home/invoices" onRefresh={refresh}>
      <div className="flex flex-col gap-4">
        {due.length > 0 ? (
          <Card tone="caution">
            <p className="type-label text-content-subtle">Total due</p>
            <Money value={dueTotal} size="title" />
            <p className="type-label text-content-muted">
              {due.length} {due.length === 1 ? 'invoice' : 'invoices'} pending
            </p>
          </Card>
        ) : null}

        <AsyncView
          state={invoices.state}
          skeleton={<CardListSkeleton rows={4} />}
          empty={
            <div className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
              <p className="type-body font-medium">No invoices yet</p>
              <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
                When the committee raises the monthly maintenance, it appears here with its due date.
              </p>
            </div>
          }
          onRetry={invoices.reload}
          render={(list) => (
            <div className="flex flex-col gap-3">
              {list.map((invoice, index) => (
                <div key={invoice.id} className="row-in" style={rowStyle(index, reduced)}>
                  <Card tone={C.INVOICE_STATUS[invoice.status].tone}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="type-body font-medium">{formatPeriod(invoice.period)}</p>
                        <Money value={invoice.amountPaise} compact />
                        <p className="type-label text-content-subtle">
                          {invoice.status === 'PAID' && invoice.paidAt !== null
                            ? `Paid ${formatDayYear(invoice.paidAt)}`
                            : invoice.status === 'CANCELLED'
                              ? 'Cancelled — nothing to pay'
                              : duePhrase(invoice.dueOn)}
                        </p>
                      </div>
                      <StatusPill descriptor={C.INVOICE_STATUS[invoice.status]} size="sm" />
                    </div>
                    {invoice.status === 'UNPAID' || invoice.status === 'OVERDUE' ? (
                      <div className="mt-3">
                        <Button
                          size="sm"
                          fullWidth
                          onClick={() => {
                            setPaying(invoice);
                          }}
                        >
                          Pay {C.formatMoney(invoice.amountPaise)}
                        </Button>
                      </div>
                    ) : null}
                    {invoice.receiptNo !== null ? (
                      <a
                        href={`${webOrigin()}/receipts/${invoice.receiptNo}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-accent focus-ring rounded-sm type-label"
                      >
                        <Icon name="receipt" size={14} /> Receipt {invoice.receiptNo}
                      </a>
                    ) : null}
                  </Card>
                </div>
              ))}
            </div>
          )}
        />
      </div>

      {paying !== null ? (
        <PaySheet
          invoice={paying}
          onClose={() => {
            setPaying(null);
          }}
          onPaid={() => {
            setPaying(null);
            invoices.reload();
            toast.show({
              title: 'Payment received',
              description: 'The receipt is ready in your billing history.',
            });
          }}
        />
      ) : null}
    </Shell>
  );
}

function PaySheet({
  invoice,
  onClose,
  onPaid,
}: {
  readonly invoice: InvoiceWire;
  readonly onClose: () => void;
  readonly onPaid: () => void;
}): ReactNode {
  const [method, setMethod] = useState<C.PaymentMethod>('UPI');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  // The method you paid with last time is the one you probably will again.
  useEffect(() => {
    setMethod(loadLastMethod());
  }, []);

  // Minted once for this sheet. Every retry of this payment — a double-tap, a tap after a dropped
  // response — reuses it, which is exactly what makes the retry safe: the server records the first
  // result against the key and hands back the same receipt instead of taking the money twice.
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  async function pay(): Promise<void> {
    if (pending) return;
    setPending(true);
    setFailed(null);
    setOffline(false);

    const outcome = await call<InvoiceWire>(`/api/billing/invoices/${invoice.id}/pay`, {
      method: 'POST',
      json: {
        invoiceId: invoice.id,
        method,
        idempotencyKey,
      },
    });
    setPending(false);
    if (outcome.ok) {
      try {
        window.localStorage.setItem(METHOD_KEY, method);
      } catch {
        // Remembering is a convenience, never a requirement.
      }
      onPaid();
      return;
    }
    if ('network' in outcome && outcome.network) {
      // Never queued. The person pays when they can see the result.
      setOffline(true);
      return;
    }
    if (outcome.error.code === 'ALREADY_DONE') {
      // Already settled — most often this attempt's own first try, gone through after all.
      onPaid();
      return;
    }
    if (outcome.error.code === 'STATE_NOT_ALLOWED' || outcome.error.code === 'CONFLICT') {
      setFailed('This invoice changed while you were paying — refreshing your billing.');
      setTimeout(onPaid, 1600);
      return;
    }
    setFailed(outcome.error.message);
  }

  return (
    <Sheet
      open={invoice !== null}
      onClose={onClose}
      title={`Pay ${formatPeriod(invoice.period)}`}
      description="The society has no payment gateway — this records your payment against the invoice and issues the receipt."
      pending={pending}
      footer={
        <Button size="lg" fullWidth pending={pending} pendingLabel="Paying" onClick={() => { void pay(); }}>
          Pay <Money value={invoice.amountPaise} compact />
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Card padding="tight">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="type-label text-content-subtle">Amount</p>
              <Money value={invoice.amountPaise} size="title" />
              <p className="type-label text-content-muted">
                {C.INVOICE_STATUS[invoice.status].label} · {duePhrase(invoice.dueOn)}
              </p>
            </div>
            <StatusPill descriptor={C.INVOICE_STATUS[invoice.status]} size="sm" />
          </div>
        </Card>

        <Field label="Pay by" required hint="The receipt names the method you choose.">
          <Select
            value={method}
            onChange={(event) => {
              setMethod(event.target.value as C.PaymentMethod);
            }}
            options={RESIDENT_METHODS}
          />
        </Field>

        {failed !== null ? (
          <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
            {failed}
          </p>
        ) : null}
        {offline ? (
          <p role="status" className="rounded-lg border border-caution-border bg-caution-soft px-4 py-3 type-body text-caution">
            You appear to be offline. Payments are not queued — try again when you have a connection,
            so you can see the result for yourself.
          </p>
        ) : null}
        <p className="type-label text-content-subtle">
          One tap pays once. If the connection drops mid-payment the same attempt is retried safely —
          it cannot pay the invoice twice.
        </p>
      </div>
    </Sheet>
  );
}
