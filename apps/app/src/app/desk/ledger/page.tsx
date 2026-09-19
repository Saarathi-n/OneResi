'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Card,
  Field,
  Input,
  Money,
  NumericInput,
  Sheet,
  StatusPill,
  Textarea,
  useToast,
} from '@grihaone/ui';
import * as C from '@grihaone/contracts';
import { Icon } from '@/components/icons';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { simple, webOrigin } from '@/lib/api';
import { COMMITTEE_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import { duePhrase, formatDayYear, formatPeriod, todayInput } from '@/lib/format';
import type { SocietyInvoiceWire } from '@/lib/types';

/**
 * The society ledger: every invoice raised for every home, in one scroll. This is where a period is
 * raised, where a cash payment taken at the office is recorded against the right invoice, and where
 * a wrongly raised invoice is voided with a reason — money moves here, so nothing on this screen
 * animates beyond the plain row entrance the rest of the app uses.
 */
export default function LedgerPage(): ReactNode {
  const reduced = useReducedMotion();
  const toast = useToast();
  const [raising, setRaising] = useState(false);
  const [cashFor, setCashFor] = useState<SocietyInvoiceWire | null>(null);
  const [voiding, setVoiding] = useState<SocietyInvoiceWire | null>(null);

  const invoices = useAsync(
    () => simple<readonly SocietyInvoiceWire[]>('/api/billing/invoices/society'),
    [],
  );

  const refresh = useCallback(async () => {
    invoices.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [invoices]);

  return (
    <Shell
      title="Billing ledger"
      tabs={COMMITTEE_TABS}
      activeTab="/desk/ledger"
      onRefresh={refresh}
      headerRight={
        <Button size="sm" leadingIcon={<Icon name="plus" size={16} />} onClick={() => { setRaising(true); }}>
          Raise
        </Button>
      }
    >
      <AsyncView
        state={invoices.state}
        skeleton={<CardListSkeleton rows={5} />}
        empty={
          <div className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
            <p className="type-body font-medium">Nothing raised yet</p>
            <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
              Raise a period and every home in the society gets its invoice, at its own monthly charge.
            </p>
            <div className="mt-4 flex justify-center">
              <Button size="sm" onClick={() => { setRaising(true); }}>
                Raise a period
              </Button>
            </div>
          </div>
        }
        onRetry={invoices.reload}
        render={(list) => (
          <div className="flex flex-col gap-3">
            {list.map((invoice, index) => (
              <div key={invoice.id} className="row-in" style={rowStyle(index, reduced)}>
                <Card tone={C.INVOICE_STATUS[invoice.status].tone}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate type-body font-medium">
                        {invoice.home.blockName}, {invoice.home.label}
                      </p>
                      <p className="type-label text-content-subtle">{formatPeriod(invoice.period)}</p>
                      <Money value={invoice.amountPaise} compact animated={false} />
                      <p className="type-label text-content-muted">
                        {invoice.status === 'PAID' && invoice.paidAt !== null
                          ? `Paid ${formatDayYear(invoice.paidAt)}`
                          : invoice.status === 'CANCELLED'
                            ? 'Cancelled — nothing to collect'
                            : duePhrase(invoice.dueOn)}
                      </p>
                    </div>
                    <StatusPill descriptor={C.INVOICE_STATUS[invoice.status]} size="sm" />
                  </div>

                  {invoice.status === 'UNPAID' || invoice.status === 'OVERDUE' ? (
                    <div className="mt-3 flex gap-3">
                      <Button size="sm" variant="secondary" fullWidth onClick={() => { setCashFor(invoice); }}>
                        Record cash
                      </Button>
                      <Button size="sm" variant="ghost" fullWidth onClick={() => { setVoiding(invoice); }}>
                        Void
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

      {raising ? (
        <RaisePeriodSheet
          onClose={() => {
            setRaising(false);
          }}
          onRaised={() => {
            setRaising(false);
            invoices.reload();
            toast.show({
              title: 'Invoices raised',
              description: 'Every home has been billed for the period.',
            });
          }}
        />
      ) : null}

      {cashFor !== null ? (
        <CashSheet
          invoice={cashFor}
          onClose={() => {
            setCashFor(null);
          }}
          onRecorded={() => {
            setCashFor(null);
            invoices.reload();
            toast.show({
              title: 'Payment recorded',
              description: 'The receipt is issued against the invoice.',
            });
          }}
        />
      ) : null}

      {voiding !== null ? (
        <VoidSheet
          invoice={voiding}
          onClose={() => {
            setVoiding(null);
          }}
          onCancelled={() => {
            setVoiding(null);
            invoices.reload();
            toast.show({
              title: 'Invoice cancelled',
              description: 'Nothing is collected for it any more.',
            });
          }}
        />
      ) : null}
    </Shell>
  );
}

function RaisePeriodSheet({
  onClose,
  onRaised,
}: {
  readonly onClose: () => void;
  readonly onRaised: () => void;
}): ReactNode {
  const [period, setPeriod] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ period?: string; dueDate?: string }>({});

  async function submit(): Promise<void> {
    if (pending) return;
    const problems: { period?: string; dueDate?: string } = {};
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) problems.period = 'Pick the month to bill for';
    if (dueDate === '') problems.dueDate = 'Pick the day payments are due by';
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    setErrors({});
    setPending(true);
    const result = await simple<null>('/api/billing/invoices', {
      method: 'POST',
      json: { period, dueDate },
    });
    setPending(false);
    if (result.ok) {
      onRaised();
      return;
    }
    if (result.error.field === 'period') setErrors({ period: result.error.message });
    else if (result.error.field === 'dueDate') setErrors({ dueDate: result.error.message });
    else setErrors({ dueDate: result.error.message });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Raise a period"
      description="Every active home is billed its own monthly charge. Homes that already have this period are skipped."
      pending={pending}
      footer={
        <Button size="lg" fullWidth pending={pending} pendingLabel="Raising" onClick={() => { void submit(); }}>
          Raise invoices
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Bill for the month of" required error={errors.period}>
          <Input
            type="month"
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value);
            }}
          />
        </Field>

        <Field label="Due by" required error={errors.dueDate} hint="The day after which an unpaid invoice is overdue.">
          <Input
            type="date"
            value={dueDate}
            min={todayInput()}
            onChange={(event) => {
              setDueDate(event.target.value);
            }}
          />
        </Field>
      </div>
    </Sheet>
  );
}

function CashSheet({
  invoice,
  onClose,
  onRecorded,
}: {
  readonly invoice: SocietyInvoiceWire;
  readonly onClose: () => void;
  readonly onRecorded: () => void;
}): ReactNode {
  const [rupees, setRupees] = useState<number | null>(invoice.amountPaise / 100);
  const [receivedOn, setReceivedOn] = useState(todayInput());
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (pending) return;
    // The wire carries paise. The rupee figure the desk types becomes paise here, once, and never
    // as a float anywhere else.
    const amountPaise = rupees === null ? null : Math.round(rupees * 100);
    if (amountPaise === null || !Number.isInteger(amountPaise) || amountPaise <= 0) {
      setFailed('Enter the amount you actually received, in rupees.');
      return;
    }
    if (amountPaise !== invoice.amountPaise) {
      setFailed(
        `The amount has to match the invoice in full (${C.formatMoney(invoice.amountPaise)}) — part settlement is not supported.`,
      );
      return;
    }
    setPending(true);
    setFailed(null);
    const result = await simple<null>(`/api/billing/invoices/${invoice.id}/offline-payment`, {
      method: 'POST',
      json: {
        invoiceId: invoice.id,
        amountPaise,
        method: 'CASH',
        receivedOn,
        ...(note.trim() !== '' ? { note: note.trim() } : {}),
      },
    });
    setPending(false);
    if (result.ok) {
      onRecorded();
      return;
    }
    setFailed(result.error.message);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Record a cash payment"
      description="For money taken at the office or handed to a committee member."
      pending={pending}
      footer={
        <Button size="lg" fullWidth pending={pending} pendingLabel="Recording" onClick={() => { void submit(); }}>
          Record payment
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Card padding="tight">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="type-label text-content-subtle">
                {invoice.home.blockName}, {invoice.home.label} · {formatPeriod(invoice.period)}
              </p>
              <p className="type-label text-content-muted">
                Invoice stands at <Money value={invoice.amountPaise} compact />
              </p>
            </div>
            <StatusPill descriptor={C.INVOICE_STATUS[invoice.status]} size="sm" />
          </div>
        </Card>

        <Field
          label="Amount received"
          required
          hint={`In rupees. The invoice stands at ${C.formatMoney(invoice.amountPaise)} — the amount has to match it in full.`}
        >
          <NumericInput
            value={rupees}
            onValueChange={setRupees}
            min={1}
            max={invoice.amountPaise / 100}
            step={1}
            pending={pending}
          />
        </Field>

        <Field label="Received on" required>
          <Input
            type="date"
            value={receivedOn}
            max={todayInput()}
            onChange={(event) => {
              setReceivedOn(event.target.value);
            }}
          />
        </Field>

        <Field label="Note" hint="Optional — for example who handed it over.">
          <Textarea
            value={note}
            rows={2}
            maxLength={280}
            showCount
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </Field>

        {failed !== null ? (
          <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
            {failed}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function VoidSheet({
  invoice,
  onClose,
  onCancelled,
}: {
  readonly invoice: SocietyInvoiceWire;
  readonly onClose: () => void;
  readonly onCancelled: () => void;
}): ReactNode {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (pending) return;
    if (reason.trim().length < 4) {
      setFailed('Say why this invoice is being cancelled — it goes in the records.');
      return;
    }
    setPending(true);
    setFailed(null);
    const result = await simple<null>(`/api/billing/invoices/${invoice.id}/cancel`, {
      method: 'POST',
      json: { invoiceId: invoice.id, reason: reason.trim() },
    });
    setPending(false);
    if (result.ok) {
      onCancelled();
      return;
    }
    setFailed(result.error.message);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Cancel this invoice"
      description="Cancelling is the only way to void a wrongly raised invoice. A paid invoice cannot be cancelled — refund it outside the system."
      pending={pending}
      footer={
        <Button size="lg" variant="danger" fullWidth pending={pending} pendingLabel="Cancelling" onClick={() => { void submit(); }}>
          Cancel invoice
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Card padding="tight">
          <p className="type-label text-content-subtle">
            {invoice.home.blockName}, {invoice.home.label} · {formatPeriod(invoice.period)} ·{' '}
            <Money value={invoice.amountPaise} compact />
          </p>
        </Card>

        <Field label="Reason" required>
          <Textarea
            value={reason}
            rows={3}
            maxLength={280}
            showCount
            invalid={failed !== null}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>

        {failed !== null ? (
          <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
            {failed}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
