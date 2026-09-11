'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  Dialog,
  EmptyState,
  ErrorState,
  Money,
  Select,
  Skeleton,
  StatusPill,
  useToast,
  buttonClass,
} from '@oneresi/ui';
import {
  INVOICE_STATUS,
  PAYMENT_METHODS,
  PAYMENT_METHOD,
  paise,
  type PaymentMethod,
  formatCalendarDate,
} from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * Payments. Every invoice for the household, paid or not, with the receipt link on every settled
 * one. The pay dialog remembers the method last used (04-product-design.md "pre-fill what the
 * household already chose"), so the second payment is one tap shorter than the first.
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
        description: `${paying.period} is settled. The receipt is in your history.`,
        tone: 'positive',
      });
      return;
    }
    setError(result.error.message);
  }

  return (
    <div className="space-y-6">
      <h1 className="type-title text-content">Payments</h1>
      <p className="type-body text-content-muted">
        Maintenance invoices for your home, with the receipt for every settled one.
      </p>

      {invoices.state.state === 'loading' ? (
        <div className="space-y-3">
          <Skeleton variant="block" height={80} />
          <Skeleton variant="block" height={80} />
          <Skeleton variant="block" height={80} />
        </div>
      ) : invoices.state.state === 'failed' ? (
        <Card elevation={1}>
          <CardBody>
            <ErrorState
              title="Your payments did not load"
              description="Try again in a moment; nothing has changed on your account."
              onRetry={invoices.reload}
            />
          </CardBody>
        </Card>
      ) : invoices.state.data.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="When the committee raises a billing period, the invoice for your home appears here."
        />
      ) : (
        <ul className="space-y-3">
          {invoices.state.data.map((invoice) => (
            <Card key={invoice.id} elevation={0} className="border border-border">
              <CardBody className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-3">
                    <Money value={paise(invoice.amountPaise)} size="title" label={`${invoice.period} maintenance`} />
                    <StatusPill descriptor={INVOICE_STATUS[invoice.status]} size="sm" />
                  </div>
                  <p className="type-label mt-1 text-content-muted">
                    Period {invoice.period}
                    {invoice.status === 'UNPAID' || invoice.status === 'OVERDUE'
                      ? ` · due ${formatCalendarDate(invoice.dueOn)}`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {invoice.status === 'UNPAID' || invoice.status === 'OVERDUE' ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setPaying(invoice);
                        setError(null);
                      }}
                    >
                      Pay
                    </Button>
                  ) : null}
                  {invoice.receiptNo !== null ? (
                    <Link href={`/receipts/${invoice.receiptNo}`} className={buttonClass('ghost', 'sm')}>
                      Receipt
                    </Link>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ))}
        </ul>
      )}

      <Dialog
        open={paying !== null}
        onClose={() => (pending ? undefined : setPaying(null))}
        title={paying !== null ? `Pay ${paying.period}` : 'Pay'}
        description={
          paying !== null
            ? 'The society records the payment and issues a numbered receipt.'
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
