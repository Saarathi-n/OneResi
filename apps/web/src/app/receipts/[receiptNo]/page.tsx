'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, ErrorState, Logo, Money, Skeleton } from '@oneresi/ui';
import {
  PAYMENT_METHOD,
  UNIT_TYPE,
  formatMoney,
  paise,
  type PaymentMethod,
  type UnitType,
} from '@oneresi/contracts';
import { call } from '@/lib/session';

/**
 * A receipt at its own address. Server data, client shell: the access token lives in memory, so
 * the page fetches with `call()` and renders an A5 sheet that prints to PDF from the browser —
 * the design doc's "PDF via print", which never needed a renderer.
 */

interface ReceiptData {
  receiptNo: string;
  paidAt: string;
  method: PaymentMethod;
  amountPaise: number;
  amountInWords: string;
  period: string;
  payerName: string;
  home: {
    unitId: number;
    blockName: string;
    label: string;
    type: UnitType;
    monthlyChargePaise: number;
  };
  reference: string;
}

export default function ReceiptPage() {
  const params = useParams<{ receiptNo: string }>();
  const receiptNo = typeof params.receiptNo === 'string' ? params.receiptNo : '';
  const [state, setState] = useState<
    { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; data: ReceiptData }
  >({ state: 'loading' });

  useEffect(() => {
    void (async () => {
      const result = await call<ReceiptData>(`/api/billing/receipts/${encodeURIComponent(receiptNo)}`);
      if (result.ok) {
        setState({ state: 'ready', data: result.data });
      } else {
        setState({ state: 'failed', message: result.error.message });
      }
    })();
  }, [receiptNo]);

  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken print:bg-paper">
      <header className="border-b border-border bg-surface-raised print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/home" aria-label="Back to OneResi">
            <Logo variant="wordmark" size={24} />
          </Link>
          <Button
            size="sm"
            onClick={() => {
              window.print();
            }}
            disabled={state.state !== 'ready'}
          >
            Print or save as PDF
          </Button>
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 py-10 print:items-start">
        {state.state === 'loading' ? (
          <div className="w-full max-w-[148mm] space-y-4">
            <Skeleton variant="text" width="50%" height={28} />
            <Skeleton variant="block" height={300} />
          </div>
        ) : state.state === 'failed' ? (
          <div className="w-full max-w-[148mm]">
            <ErrorState
              title="This receipt could not be opened"
              description={state.message}
              onRetry={() => window.location.reload()}
            />
          </div>
        ) : (
          <ReceiptSheet data={state.data} />
        )}
      </main>
    </div>
  );
}

function ReceiptSheet({ data }: { data: ReceiptData }) {
  return (
    <article
      className="w-full max-w-[148mm] rounded-xl border border-border bg-surface-raised p-8 shadow-e2 print:max-w-none print:rounded-none print:border-0 print:shadow-none"
      aria-label={`Receipt ${data.receiptNo}`}
    >
      <div className="flex items-start justify-between border-b border-border pb-4">
        <div>
          <Logo variant="wordmark" size={28} />
          <p className="type-micro mt-2 text-content-subtle">
            Issued by the society office · keep this for your records
          </p>
        </div>
        <div className="text-right">
          <p className="type-label text-content-subtle uppercase tracking-wide">Receipt</p>
          <p className="type-title text-content">{data.receiptNo}</p>
        </div>
      </div>

      <dl className="mt-6 space-y-3">
        <Row label="Received from" value={data.payerName} />
        <Row
          label="Home"
          value={`${data.home.blockName} · ${data.home.label} · ${UNIT_TYPE[data.home.type].label}`}
        />
        <Row label="For the period" value={data.period} />
        <Row
          label="Paid on"
          value={new Date(data.paidAt).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        />
        <Row label="Paid by" value={PAYMENT_METHOD[data.method].label} />
        {data.reference.length > 0 ? <Row label="Reference" value={data.reference} /> : null}
      </dl>

      <div className="mt-6 rounded-xl bg-surface-sunken p-5 print:bg-surface">
        <p className="type-label text-content-subtle uppercase tracking-wide">Amount</p>
        <p className="mt-1">
          <Money value={paise(data.amountPaise)} size="display" label={`Receipt ${data.receiptNo} amount`} />
        </p>
        <p className="type-body mt-2 text-content-muted">{data.amountInWords}</p>
      </div>

      <p className="type-micro mt-6 border-t border-border pt-4 text-content-subtle">
        Verify this receipt against the society office with the receipt number and your unit. A
        receipt printed from this page carries the same record the office holds.
      </p>
      <p className="type-micro mt-2 text-content-subtle">
        {formatMoney(paise(data.amountPaise))} · {data.receiptNo}
      </p>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-border pb-2 last:border-b-0">
      <dt className="type-label text-content-subtle">{label}</dt>
      <dd className="type-body text-right text-content">{value}</dd>
    </div>
  );
}
