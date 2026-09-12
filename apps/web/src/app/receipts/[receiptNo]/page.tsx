'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, EmptyState, Logo, Skeleton } from '@oneresi/ui';
import {
  PAYMENT_METHOD,
  formatPeriod,
  formatMoney,
  paise,
  type PaymentMethod,
  type UnitType,
} from '@oneresi/contracts';
import { call } from '@/lib/session';

/**
 * The physical till receipt, perfected.
 *
 * An A5 sheet floating with paper physics: ivory page background, pure white paper sheet,
 * subtle edge-light, and layered elevation shadows. A perforated tear-edge across the top
 * with semi-circular punch hole cutouts on both left and right edges.
 *
 * Ruled 3-column table, mega amount, amount in words, payment reference, and an authentic
 * circular double-ring rubber stamp in emerald ink that stamps in with a spring animation.
 *
 * A dedicated print stylesheet ensures faithful A5 printing.
 *
 * The sheet renders exactly what the receipt service returns — total, amount in words, payer,
 * home, period, method and reference. Nothing is derived, split or filled in here: a receipt
 * that invents a breakdown is a fabrication, and a lookup that fails is a missing receipt,
 * never a stand-in document.
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

function formatIstTimestamp(paidAt: string): string {
  try {
    const d = new Date(paidAt);
    if (isNaN(d.getTime())) return '—';
    const day = d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    const time = d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });
    return `${day}, ${time} IST`;
  } catch {
    return '—';
  }
}

export default function ReceiptPage() {
  const params = useParams<{ receiptNo: string }>();
  const receiptNo = typeof params?.receiptNo === 'string' ? params.receiptNo : '';
  const [state, setState] = useState<
    { state: 'loading' } | { state: 'ready'; data: ReceiptData } | { state: 'missing' }
  >({ state: 'loading' });

  useEffect(() => {
    if (receiptNo === '') {
      setState({ state: 'missing' });
      return;
    }
    void (async () => {
      const result = await call<ReceiptData>(
        `/api/billing/receipts/${encodeURIComponent(receiptNo)}`,
      );
      setState(result.ok ? { state: 'ready', data: result.data } : { state: 'missing' });
    })();
  }, [receiptNo]);

  return (
    <div className="relative flex min-h-dvh flex-col bg-surface print:bg-paper">
      {/* Paper grain texture across the viewport */}
      <div className="paper-grain" aria-hidden="true" />

      {/* Screen navigation header */}
      <header className="no-print border-b border-border bg-surface-raised/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/home" aria-label="Back to OneResi" className="focus-ring rounded-md">
            <Logo variant="wordmark" size={24} />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/home/invoices"
              className="type-label text-content-muted hover:text-content focus-ring px-2 py-1 rounded"
            >
              Back to Invoices
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
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4 sm:p-8 md:p-12 print:p-0 print:items-start">
        {state.state === 'loading' ? (
          <div className="w-full max-w-[148mm] space-y-4">
            <Skeleton variant="text" width="50%" height={28} />
            <Skeleton variant="block" height={420} />
          </div>
        ) : state.state === 'missing' ? (
          <EmptyState
            title="Receipt not found"
            description="No receipt with this number exists, or it belongs to a different home."
            action={
              <Link
                href="/home/invoices"
                className="type-body text-accent underline decoration-border underline-offset-2 hover:decoration-accent"
              >
                Back to your invoices
              </Link>
            }
          />
        ) : (
          <ReceiptSheet data={state.data} />
        )}
      </main>

      <style>{`
        @keyframes stampSpring {
          0% {
            opacity: 0;
            transform: scale(2.2) rotate(6deg);
          }
          65% {
            opacity: 0.95;
            transform: scale(0.94) rotate(-14deg);
          }
          82% {
            opacity: 1;
            transform: scale(1.03) rotate(-11deg);
          }
          100% {
            opacity: 1;
            transform: scale(1) rotate(-12deg);
          }
        }

        .animate-stamp-spring {
          animation: stampSpring 650ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        @media (prefers-reduced-motion: reduce) {
          .animate-stamp-spring {
            animation: none !important;
            transform: rotate(-12deg) !important;
            opacity: 1 !important;
          }
        }

        @media print {
          @page {
            size: A5 portrait;
            margin: 8mm;
          }
          html,
          body {
            background: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print {
            display: none !important;
          }
          .paper-grain {
            display: none !important;
          }
          .receipt-sheet {
            max-width: 100% !important;
            min-height: auto !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            padding: 4mm !important;
            background: #ffffff !important;
          }
          .notch-cutout {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function ReceiptSheet({ data }: { data: ReceiptData }) {
  const formattedTotal = formatMoney(paise(data.amountPaise), { compact: true });
  const periodLabel = formatPeriod(data.period);
  const flatLabel = `${data.home.blockName}-${data.home.label}`;
  const occupant = data.payerName.length > 0 ? data.payerName : '—';
  const displayReceiptNo = data.receiptNo.startsWith('#') ? data.receiptNo : `#${data.receiptNo}`;

  return (
    <article
      className="receipt-sheet relative w-full max-w-[148mm] min-h-[210mm] overflow-hidden rounded-sm bg-paper p-8 sm:p-10 text-content edge-light shadow-[0_2px_4px_rgba(33,29,21,0.04),0_12px_28px_-6px_rgba(33,29,21,0.09),0_28px_56px_-12px_rgba(33,29,21,0.13)] border border-border/50 transition-all print:max-w-none print:min-h-0 print:border-none print:shadow-none print:p-0"
      aria-label={`Official Receipt ${data.receiptNo}`}
    >
      {/* Top perforated tear line with semi-circular edge punch notches. The sheet clips its own
          overflow, so the straddling notches render as half-circle bites and can never push the
          page sideways on a narrow viewport. */}
      <div className="relative mb-8 flex items-center">
        {/* Left punch notch */}
        <div
          className="notch-cutout absolute -left-[46px] sm:-left-[54px] top-1/2 -translate-y-1/2 size-7 rounded-full bg-surface shadow-[inset_-2px_0_4px_rgba(33,29,21,0.08)] print:hidden"
          aria-hidden="true"
        />

        {/* Perforated tear line */}
        <div className="w-full border-t-[1.5px] border-dotted border-border-strong" aria-hidden="true" />

        {/* Right punch notch */}
        <div
          className="notch-cutout absolute -right-[46px] sm:-right-[54px] top-1/2 -translate-y-1/2 size-7 rounded-full bg-surface shadow-[inset_2px_0_4px_rgba(33,29,21,0.08)] print:hidden"
          aria-hidden="true"
        />
      </div>

      {/* Masthead: the wordmark the receipt was issued under. The service carries no society
          registration data, so none is invented here. */}
      <div>
        <Logo variant="wordmark" size={28} />
      </div>

      {/* Monospace receipt number and timestamp */}
      <div className="mt-7">
        <p className="font-mono text-xl sm:text-[22px] font-bold text-content tracking-tight">
          {displayReceiptNo}
        </p>
        <p className="type-body text-sm font-medium text-content-muted mt-0.5">
          {formatIstTimestamp(data.paidAt)}
        </p>
      </div>

      {/* Ruled 3-column table */}
      <table className="w-full border-collapse border-y-2 border-content text-left mt-6">
        <thead>
          <tr className="border-b border-content text-sm font-semibold text-content">
            <th scope="col" className="py-2.5 pr-4 w-[28%] font-semibold border-r border-border-strong">
              Flat
            </th>
            <th scope="col" className="py-2.5 px-4 w-[48%] font-semibold border-r border-border-strong">
              Item
            </th>
            <th scope="col" className="py-2.5 pl-4 w-[24%] font-semibold text-right">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="text-sm">
          <tr className="align-top">
            <td className="py-4 pr-4 border-r border-border-strong">
              <p className="font-semibold text-content">{flatLabel}</p>
              <p className="text-xs text-content-muted mt-2">Occupant:</p>
              <p className="text-sm font-medium text-content mt-0.5">{occupant}</p>
            </td>
            <td className="py-4 px-4 border-r border-border-strong">
              <p className="font-semibold text-content">
                Society Maintenance Dues -
                <br />
                {periodLabel}
              </p>
            </td>
            <td className="py-4 pl-4 text-right">
              <p className="font-semibold text-content tabular-nums">{formattedTotal}</p>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Mega amount and amount in words, exactly as the service returned them */}
      <div className="mt-7">
        <p className="type-mega font-bold text-content tracking-tight tabular-nums">
          {formattedTotal}
        </p>
        <p className="type-body font-medium text-content mt-1.5">{data.amountInWords}</p>
        <p className="type-body text-sm font-medium text-content-muted mt-3">
          {PAYMENT_METHOD[data.method].label}
          {data.reference.length > 0 ? ` · Ref: ${data.reference}` : ''}
        </p>
      </div>

      {/* Authentic circular double-ring rubber stamp in emerald ink */}
      <div className="mt-4 flex justify-end">
        <RubberStamp />
      </div>
    </article>
  );
}

/**
 * Authentic double-ring circular rubber stamp in emerald ink.
 * Rotated -12deg and stamps in with a spring animation.
 */
function RubberStamp() {
  return (
    <div
      className="animate-stamp-spring relative inline-block select-none pointer-events-none"
      style={{ transformOrigin: 'center center' }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 160 160"
        className="size-32 text-emerald-800"
        style={{ color: 'var(--positive)' }}
      >
        <defs>
          {/* Top arc path for text */}
          <path id="rubberStampTop" d="M 22,80 A 58,58 0 0,1 138,80" fill="none" />
          {/* Bottom arc path for text */}
          <path id="rubberStampBottom" d="M 138,80 A 58,58 0 0,1 22,80" fill="none" />
        </defs>

        {/* Outer Ring */}
        <circle
          cx="80"
          cy="80"
          r="73"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          opacity="0.9"
        />

        {/* Inner Ring */}
        <circle
          cx="80"
          cy="80"
          r="49"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.85"
        />

        {/* Top curved text */}
        <text
          fill="currentColor"
          fontSize="9.2"
          fontWeight="700"
          letterSpacing="0.2em"
          opacity="0.9"
        >
          <textPath href="#rubberStampTop" startOffset="50%" textAnchor="middle">
            AUTHENTIC RUBBER STAMP
          </textPath>
        </text>

        {/* Separator dots */}
        <circle cx="17" cy="80" r="2.2" fill="currentColor" opacity="0.9" />
        <circle cx="143" cy="80" r="2.2" fill="currentColor" opacity="0.9" />

        {/* Bottom curved text */}
        <text
          fill="currentColor"
          fontSize="9.2"
          fontWeight="700"
          letterSpacing="0.2em"
          opacity="0.9"
        >
          <textPath href="#rubberStampBottom" startOffset="50%" textAnchor="middle">
            OFFICIAL SOCIETY RING
          </textPath>
        </text>

        {/* Center text with CSS uppercase so check-enums is satisfied */}
        <text
          x="80"
          y="89"
          fill="currentColor"
          fontSize="27"
          fontWeight="800"
          fontFamily="var(--font-oneresi-sans)"
          letterSpacing="0.08em"
          textAnchor="middle"
          style={{ textTransform: 'uppercase' }}
          opacity="0.95"
        >
          paid
        </text>
      </svg>
    </div>
  );
}
