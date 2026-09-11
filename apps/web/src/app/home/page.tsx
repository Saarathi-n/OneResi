'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Skeleton,
  StatusPill,
  Money,
  EmptyState,
  buttonClass,
} from '@oneresi/ui';
import {
  APPROVAL_STATUS,
  COMPLAINT_STATUS,
  paise,
  type INVOICE_STATUS,
  type Paise,
} from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch, type FetchState } from '@/lib/useFetch';

/**
 * The resident's home: the next-action model (04-product-design.md). The top card is whatever
 * the household must answer right now — a visitor at the gate, an unpaid bill — and it moves by
 * itself: the waiting list arrives over the live stream, without a reload.
 */

const WAITING_PATH = '/api/visitors/waiting';
const INVOICES_PATH = '/api/billing/invoices';
const COMPLAINTS_PATH = '/api/complaints';
const ENTRIES_PATH = '/api/visitors/entries';

/** The wire shape of a waiting walk-in — Date fields arrive as strings over JSON. */
interface WaitingVisitor {
  readonly logId: number;
  readonly name: string;
  readonly phone: string | null;
  readonly purpose: string;
  readonly since: string;
}

interface InvoiceLine {
  id: number;
  period: string;
  amountPaise: Paise;
  dueOn: string;
  status: keyof typeof INVOICE_STATUS;
}

interface EntryLine {
  logId: number;
  kind: 'PASS' | 'WALK_IN';
  visitorName: string;
  purpose: string;
  approvalStatus: keyof typeof APPROVAL_STATUS;
  enteredAt: string | null;
  at: string;
}

interface ComplaintLine {
  id: number;
  category: string;
  priority: string;
  description: string;
  status: keyof typeof COMPLAINT_STATUS;
  raisedAt: string;
}

export default function ResidentHomePage() {
  const [waiting, setWaiting] = useState<FetchState<readonly WaitingVisitor[]>>({ state: 'loading' });
  const invoices = useFetch<readonly InvoiceLine[]>(INVOICES_PATH);
  const complaints = useFetch<readonly ComplaintLine[]>(COMPLAINTS_PATH);
  const entries = useFetch<readonly EntryLine[]>(ENTRIES_PATH);

  // The live surface: /api/gate/live pushes the waiting list whenever it changes.
  const [live, setLive] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const liveSource = useRef<EventSource | null>(null);

  useEffect(() => {
    // The first paint comes from the ordinary fetch; the stream then keeps it current.
    void (async () => {
      const result = await call<readonly WaitingVisitor[]>(WAITING_PATH);
      setWaiting(result.ok ? { state: 'ready', data: result.data } : { state: 'failed', error: result.error });
    })();

    const source = new EventSource('/api/gate/live', { withCredentials: true });
    liveSource.current = source;
    source.addEventListener('open', () => setLive('open'));
    source.addEventListener('waiting', (event) => {
      setLive('open');
      try {
        const frame: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (!Array.isArray(frame)) return;
        setWaiting({ state: 'ready', data: frame as readonly WaitingVisitor[] });
      } catch {
        // A malformed frame does not clear a good list.
      }
    });
    source.addEventListener('error', () => setLive('closed'));
    return () => {
      source.close();
      liveSource.current = null;
    };
  }, []);

  const openInvoices =
    invoices.state.state === 'ready'
      ? invoices.state.data.filter((invoice) => invoice.status === 'UNPAID' || invoice.status === 'OVERDUE')
      : [];
  const firstOpen = openInvoices[0];
  const nextDueComplaint =
    complaints.state.state === 'ready'
      ? complaints.state.data.find(
          (complaint) => complaint.status === 'OPEN' || complaint.status === 'IN_PROGRESS',
        )
      : undefined;
  const recentEntries =
    entries.state.state === 'ready' ? entries.state.data.slice(0, 5) : [];

  return (
    <div className="space-y-6">
      <h1 className="type-title text-content">Good to see you</h1>

      {/* The next-action card: whatever needs an answer now, at the top. */}
      {waiting.state === 'ready' && waiting.data.length > 0 ? (
        <WaitingCard waiting={waiting.data} onDecided={entries.reload} />
      ) : waiting.state === 'failed' ? (
        <Card elevation={1}>
          <CardBody>
            <ErrorState
              title="The gate feed is not reaching us"
              description="We could not load who is waiting. Your passes and log are unaffected."
              onRetry={() => window.location.reload()}
            />
          </CardBody>
        </Card>
      ) : null}

      {/* Money next. */}
      {invoices.state.state === 'loading' ? (
        <Skeleton variant="block" height={110} />
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
      ) : firstOpen !== undefined ? (
        <Card elevation={1}>
          <CardHeader
            title="Maintenance due"
            actions={
              <Link href="/home/invoices" className={buttonClass('ghost', 'sm')}>
                All payments
              </Link>
            }
          />
          <CardBody className="flex items-center justify-between">
            <div>
              <Money value={paise(firstOpen.amountPaise)} size="title" label={`${firstOpen.period} maintenance`} />
              <p className="type-label mt-1 text-content-muted">
                Period {firstOpen.period}
              </p>
            </div>
            <Link href="/home/invoices" className={buttonClass()}>
              Pay now
            </Link>
          </CardBody>
        </Card>
      ) : (
        <EmptyState
          title="No maintenance due"
          description="Every invoice for your home is settled. Receipts stay in Payments."
          action={
            <Link href="/home/invoices" className={buttonClass('secondary')}>
              See payment history
            </Link>
          }
        />
      )}

      {/* Then the complaint being worked on, if any. */}
      {complaints.state.state === 'ready' && nextDueComplaint !== undefined ? (
        <Card elevation={0} className="border border-border">
          <CardBody className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <StatusPill descriptor={COMPLAINT_STATUS[nextDueComplaint.status]} size="sm" />
              <p className="type-body mt-2 truncate text-content">
                {nextDueComplaint.description}
              </p>
            </div>
            <Link href="/home/complaints" className={buttonClass('ghost', 'sm', 'shrink-0')}>
              Track
            </Link>
          </CardBody>
        </Card>
      ) : null}

      {/* The household's gate feed — the thing the household opens the app for. */}
      <Card elevation={0} className="border border-border">
        <CardHeader
          title="At your door today"
          actions={
            live === 'open' ? (
              <Badge tone="positive" size="sm">
                Live
              </Badge>
            ) : (
              <Badge tone="neutral" size="sm">
                Reconnecting
              </Badge>
            )
          }
        />
        <CardBody>
          {entries.state.state === 'loading' ? (
            <div className="space-y-3">
              <Skeleton variant="text" width="70%" />
              <Skeleton variant="text" width="55%" />
              <Skeleton variant="text" width="62%" />
            </div>
          ) : entries.state.state === 'failed' ? (
            <ErrorState
              size="compact"
              title="Your visitor log did not load"
              onRetry={entries.reload}
            />
          ) : recentEntries.length === 0 ? (
            <p className="type-body text-content-muted">
              Nobody has come calling yet. Issue a pass from Visitors and the gate will know them
              by name.
            </p>
          ) : (
            <ul className="space-y-3">
              {recentEntries.map((entry) => (
                <li key={entry.logId} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="type-body truncate text-content">
                      {entry.visitorName} · {entry.purpose}
                    </p>
                    <p className="type-micro text-content-subtle">
                      {entry.enteredAt === null ? 'Waiting' : 'Arrived'} ·{' '}
                      {new Date(entry.at).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <StatusPill descriptor={APPROVAL_STATUS[entry.approvalStatus]} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * The waiting card: one row per walk-in at the gate, Admit or Turn away, decided here. The
 * decisions go straight to the gate, so the kiosk never waits on a page reload.
 */
function WaitingCard({
  waiting,
  onDecided,
}: {
  waiting: readonly WaitingVisitor[];
  onDecided: () => void;
}) {
  const [busyLogId, setBusyLogId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(logId: number, decision: 'ADMIT' | 'REJECT'): Promise<void> {
    setBusyLogId(logId);
    setError(null);
    const result = await call<null>(`/api/visitors/walk-ins/${logId}/decision`, {
      method: 'POST',
      json: { logId, decision },
    });
    setBusyLogId(null);
    if (result.ok) {
      onDecided();
      return;
    }
    setError(result.error.message);
  }

  return (
    <Card elevation={2} className="border-strong">
      <CardHeader
        title={`${waiting.length} at the gate for you`}
        subtitle="The guard is waiting on your answer."
      />
      <CardBody className="space-y-4">
        {error !== null ? (
          <p className="type-body text-critical" role="alert">
            {error}
          </p>
        ) : null}
        {waiting.map((visitor) => (
          <div
            key={visitor.logId}
            className="flex items-center justify-between gap-4 rounded-xl bg-accent-soft p-4"
          >
            <div className="min-w-0">
              <p className="type-body truncate text-content">
                {visitor.name} · {visitor.purpose}
              </p>
              <p className="type-micro mt-1 text-content-muted">
                {visitor.phone !== null ? `${visitor.phone} · ` : ''}
                waiting since{' '}
                {new Date(visitor.since).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                pending={busyLogId === visitor.logId}
                pendingLabel="Recording your answer"
                onClick={() => void decide(visitor.logId, 'ADMIT')}
              >
                Admit
              </Button>
              <Button
                size="sm"
                variant="danger"
                pending={busyLogId === visitor.logId}
                pendingLabel="Recording your answer"
                onClick={() => void decide(visitor.logId, 'REJECT')}
              >
                Turn away
              </Button>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
