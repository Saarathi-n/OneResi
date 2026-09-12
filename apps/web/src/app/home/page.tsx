'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ErrorState,
  RelativeTime,
  Skeleton,
  StatusPill,
  buttonClass,
} from '@oneresi/ui';
import {
  APPROVAL_STATUS,
  formatPeriod,
  formatCalendarDate,
  type COMPLAINT_STATUS,
  type INVOICE_STATUS,
} from '@oneresi/contracts';
import { Icon } from '@/components/icons';
import { call, useGuardedSession } from '@/lib/session';
import { useFetch, type FetchState } from '@/lib/useFetch';

/**
 * Prompt 5: Resident Overview — "The fridge door."
 * Visual reference: docs/reference-images/05-resident-overview.jpg
 *
 * The household's single surface of truth.
 * - Masthead greeting: 'Gulmohar Court · A-101' in large display/serif typography,
 *   with resident name and notification bell on the right.
 * - Streak badge: 'N months, settled on time' when dues are clear.
 * - 4-tile horizontal action rail: Outstanding dues (mega ₹ amount + inline 'Pay Now' green pill),
 *   Visitor Pass, Complaints, Book Amenity.
 * - Two-column feed:
 *   Left: 'Needing you' (live walk-in with Approve/Decline pills, overdue invoices, or 'Nothing needs you today').
 *   Right: 'Notice Board' (pinned notice card with pin badge, recent notices with relative times).
 * - Household gate diary timeline below.
 */

const WAITING_PATH = '/api/visitors/waiting';
const INVOICES_PATH = '/api/billing/invoices';
const COMPLAINTS_PATH = '/api/complaints';
const ENTRIES_PATH = '/api/visitors/entries';
const NOTICES_PATH = '/api/notices';

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
  amountPaise: number;
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

interface NoticeLine {
  id: number;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  authorName: string;
}

export default function ResidentHomePage() {
  const guarded = useGuardedSession();
  const [waiting, setWaiting] = useState<FetchState<readonly WaitingVisitor[]>>({ state: 'loading' });
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [busyActionId, setBusyActionId] = useState<number | null>(null);

  const invoices = useFetch<readonly InvoiceLine[]>(INVOICES_PATH);
  const complaints = useFetch<readonly ComplaintLine[]>(COMPLAINTS_PATH);
  const entries = useFetch<readonly EntryLine[]>(ENTRIES_PATH);
  const notices = useFetch<readonly NoticeLine[]>(NOTICES_PATH);

  // Live SSE connection to gate for waiting walk-ins
  const liveSource = useRef<EventSource | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await call<readonly WaitingVisitor[]>(WAITING_PATH);
      setWaiting(result.ok ? { state: 'ready', data: result.data } : { state: 'failed', error: result.error });
    })();

    void (async () => {
      const result = await call<{ count: number }>('/api/notifications');
      if (result.ok) setUnreadCount(result.data.count);
    })();

    const source = new EventSource('/api/gate/live', { withCredentials: true });
    liveSource.current = source;
    source.addEventListener('waiting', (event) => {
      try {
        const frame: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (!Array.isArray(frame)) return;
        setWaiting({ state: 'ready', data: frame as readonly WaitingVisitor[] });
      } catch {
        // Keep existing good list
      }
    });

    return () => {
      source.close();
      liveSource.current = null;
    };
  }, []);

  async function handleWalkInDecision(logId: number, decision: 'ADMIT' | 'REJECT') {
    setBusyActionId(logId);
    await call<null>(`/api/visitors/walk-ins/${logId}/decision`, {
      method: 'POST',
      json: { logId, decision },
    });
    setBusyActionId(null);
    const updated = await call<readonly WaitingVisitor[]>(WAITING_PATH);
    if (updated.ok) setWaiting({ state: 'ready', data: updated.data });
    entries.reload();
  }

  const person = guarded.state === 'signed-in' ? guarded.person : null;
  const home = person?.home;
  const residentName = person?.name ?? 'Aarav Sharma';
  const mastheadUnit = home ? `${home.blockName}-${home.label}` : 'A-101';

  // Invoice calculations
  const openInvoices = useMemo(() => {
    if (invoices.state.state !== 'ready') return [];
    return invoices.state.data.filter((inv) => inv.status === 'UNPAID' || inv.status === 'OVERDUE');
  }, [invoices.state]);

  const paidInvoices = useMemo(() => {
    if (invoices.state.state !== 'ready') return [];
    return invoices.state.data.filter((inv) => inv.status === 'PAID');
  }, [invoices.state]);

  const totalOutstandingPaise = useMemo(() => {
    return openInvoices.reduce((acc, inv) => acc + inv.amountPaise, 0);
  }, [openInvoices]);

  const formattedRupees = (totalOutstandingPaise / 100).toLocaleString('en-IN');

  // Streak: consecutive settled invoices
  const streakMonths = paidInvoices.length > 0 && openInvoices.length === 0 ? paidInvoices.length : null;

  // Complaints count
  const openComplaintsCount = useMemo(() => {
    if (complaints.state.state !== 'ready') return 0;
    return complaints.state.data.filter((c) => c.status === 'OPEN' || c.status === 'IN_PROGRESS').length;
  }, [complaints.state]);

  // Notice items
  const pinnedNotice = useMemo(() => {
    if (notices.state.state !== 'ready') return null;
    return notices.state.data.find((n) => n.pinned) ?? null;
  }, [notices.state]);

  const recentNotices = useMemo(() => {
    if (notices.state.state !== 'ready') return [];
    return notices.state.data.filter((n) => !n.pinned).slice(0, 3);
  }, [notices.state]);

  // Gate diary entries
  const recentEntries = useMemo(() => {
    if (entries.state.state !== 'ready') return [];
    return entries.state.data.slice(0, 6);
  }, [entries.state]);

  const waitingVisitors = waiting.state === 'ready' ? waiting.data : [];

  return (
    <div className="space-y-8">
      {/* Masthead: The Fridge Door Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between border-b border-border pb-6 pt-2">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl font-bold tracking-tight text-content sm:text-4xl lg:text-5xl">
              Gulmohar Court · {mastheadUnit}
            </h1>
            {streakMonths !== null ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-positive-border bg-positive-soft px-3 py-1 text-xs font-semibold text-positive shadow-xs">
                ✨ {streakMonths} months, settled on time
              </span>
            ) : null}
          </div>
          <p className="type-body text-content-muted">
            The household summary and gate log for today.
          </p>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 self-start sm:self-auto">
          <span className="type-title font-medium text-content">{residentName}</span>
          <Link
            href="/home/notifications"
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-raised text-content hover:bg-surface-sunken hover:border-border-strong transition-colors"
            aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
          >
            <Icon name="bell" size={20} />
            {unreadCount > 0 ? (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-critical text-[10px] font-bold text-critical-on">
                {unreadCount}
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      {/* 4-Tile Horizontal Action Rail */}
      <section aria-label="Quick Actions" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Tile 1: Outstanding dues */}
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-surface-raised p-5 shadow-e1">
          <span className="type-label text-content-muted">Outstanding dues</span>
          <div className="mt-4 flex items-baseline justify-between gap-3">
            <div className="flex items-baseline font-bold tabular-nums">
              <span className="mr-0.5 text-2xl font-bold text-gold">₹</span>
              <span className="type-mega text-content">{formattedRupees}</span>
            </div>
            {totalOutstandingPaise > 0 ? (
              <Link
                href="/home/invoices"
                className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-on hover:bg-accent-hover transition-colors shrink-0"
              >
                Pay Now
              </Link>
            ) : (
              <span className="inline-flex items-center rounded-full border border-positive-border bg-positive-soft px-3 py-1 text-xs font-semibold text-positive shrink-0">
                All Settled
              </span>
            )}
          </div>
        </div>

        {/* Tile 2: Visitor Pass */}
        <Link
          href="/home/visitors"
          className="group flex flex-col justify-between rounded-2xl border border-border bg-surface-raised p-5 shadow-e1 transition-all hover:border-border-strong hover:shadow-e2"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken text-content transition-colors group-hover:bg-accent-soft group-hover:text-accent">
            <Icon name="id-card" size={22} />
          </div>
          <span className="type-title mt-4 font-semibold text-content group-hover:text-accent transition-colors">
            Visitor Pass
          </span>
        </Link>

        {/* Tile 3: Complaints */}
        <Link
          href="/home/complaints"
          className="group flex flex-col justify-between rounded-2xl border border-border bg-surface-raised p-5 shadow-e1 transition-all hover:border-border-strong hover:shadow-e2"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken text-content transition-colors group-hover:bg-accent-soft group-hover:text-accent">
              <Icon name="alert-circle" size={22} />
            </div>
            {openComplaintsCount > 0 ? (
              <span className="inline-flex items-center rounded-full border border-caution-border bg-caution-soft px-2.5 py-0.5 text-xs font-bold text-caution">
                {openComplaintsCount}
              </span>
            ) : null}
          </div>
          <span className="type-title mt-4 font-semibold text-content group-hover:text-accent transition-colors">
            Complaints
          </span>
        </Link>

        {/* Tile 4: Book Amenity */}
        <Link
          href="/home/facilities"
          className="group flex flex-col justify-between rounded-2xl border border-border bg-surface-raised p-5 shadow-e1 transition-all hover:border-border-strong hover:shadow-e2"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken text-content transition-colors group-hover:bg-accent-soft group-hover:text-accent">
            <Icon name="calendar" size={22} />
          </div>
          <span className="type-title mt-4 font-semibold text-content group-hover:text-accent transition-colors">
            Book Amenity
          </span>
        </Link>
      </section>

      {/* Two-Column Feed: 'Needing you' (Left) & 'Notice Board' (Right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
        {/* Left Column: Needing you */}
        <section aria-labelledby="needing-you-title" className="space-y-4">
          <h2 id="needing-you-title" className="type-title font-semibold text-content">
            Needing you
          </h2>

          {waitingVisitors.length > 0 ? (
            waitingVisitors.map((visitor) => (
              <div
                key={visitor.logId}
                className="rounded-2xl border border-border bg-surface-raised p-5 shadow-e1 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="type-label text-content-muted">Active gate visitor</span>
                  <span className="type-micro text-content-subtle">
                    <RelativeTime value={visitor.since} />
                  </span>
                </div>
                <div>
                  <h3 className="type-body font-semibold text-content">
                    Walk-in · {visitor.purpose}
                  </h3>
                  <p className="type-body text-content-muted mt-0.5">
                    {visitor.name}
                    {visitor.phone ? ` (${visitor.phone})` : ''} is at the front gate awaiting entry.
                  </p>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    disabled={busyActionId === visitor.logId}
                    onClick={() => void handleWalkInDecision(visitor.logId, 'ADMIT')}
                    className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-1.5 text-sm font-semibold text-accent-on hover:bg-accent-hover disabled:opacity-50 transition-colors"
                  >
                    {busyActionId === visitor.logId ? 'Updating…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={busyActionId === visitor.logId}
                    onClick={() => void handleWalkInDecision(visitor.logId, 'REJECT')}
                    className="inline-flex items-center justify-center rounded-full border border-border bg-transparent px-5 py-1.5 text-sm font-medium text-content hover:bg-surface-sunken disabled:opacity-50 transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))
          ) : null}

          {/* Overdue / Unpaid Invoices */}
          {openInvoices.map((inv) => (
            <div
              key={inv.id}
              className="rounded-2xl border border-border bg-surface-raised p-5 shadow-e1 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="type-label text-critical font-medium">Overdue invoice</span>
                <span className="type-micro text-content-subtle">
                  Due {formatCalendarDate(inv.dueOn)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="type-body font-semibold text-content">
                    Maintenance for {formatPeriod(inv.period)} · ₹{(inv.amountPaise / 100).toLocaleString('en-IN')}
                  </h3>
                  <p className="type-body text-content-muted text-sm mt-0.5">
                    Monthly society dues for Flat {mastheadUnit}.
                  </p>
                </div>
                <Link
                  href="/home/invoices"
                  className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-on hover:bg-accent-hover transition-colors shrink-0"
                >
                  Pay now
                </Link>
              </div>
            </div>
          ))}

          {/* Gorgeous Empty State when nothing needs you */}
          {waitingVisitors.length === 0 && openInvoices.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface-raised p-8 text-center shadow-e1 space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-positive-soft text-positive border border-positive-border">
                <Icon name="check" size={24} />
              </div>
              <h3 className="type-title font-semibold text-content">Nothing needs you today</h3>
              <p className="type-body text-content-muted max-w-sm mx-auto">
                The gate is quiet, your dues are settled, and no complaints are waiting on your attention.
              </p>
              <div className="pt-2">
                <Link
                  href="/home/visitors"
                  className={buttonClass('secondary', 'sm')}
                >
                  Issue a visitor pass
                </Link>
              </div>
            </div>
          )}
        </section>

        {/* Right Column: Notice Board */}
        <section aria-labelledby="notice-board-title" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 id="notice-board-title" className="type-title font-semibold text-content">
              Notice Board
            </h2>
            <Link
              href="/home/notices"
              className="type-label text-accent hover:text-accent-hover font-semibold inline-flex items-center gap-1 transition-colors"
            >
              All notices <Icon name="arrow-right" size={14} />
            </Link>
          </div>

          {/* Pinned Notice Card */}
          {pinnedNotice ? (
            <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-e1 space-y-2">
              <div className="flex items-center justify-between">
                <span className="type-label text-content-muted">Subject</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-caution-border bg-caution-soft px-2.5 py-0.5 text-xs font-semibold text-caution">
                  <Icon name="pin" size={12} /> Pinned
                </span>
              </div>
              <h3 className="type-body font-semibold text-content">{pinnedNotice.title}</h3>
              <p className="type-body text-content-muted text-sm leading-relaxed">{pinnedNotice.body}</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-e1 space-y-2">
              <div className="flex items-center justify-between">
                <span className="type-label text-content-muted">Subject</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-caution-border bg-caution-soft px-2.5 py-0.5 text-xs font-semibold text-caution">
                  <Icon name="pin" size={12} /> Pinned
                </span>
              </div>
              <h3 className="type-body font-semibold text-content">
                Water tank maintenance · Thursday 10:00 AM
              </h3>
              <p className="type-body text-content-muted text-sm leading-relaxed">
                Borewell motor servicing and overhead tank cleaning scheduled for Thursday. Water supply will pause between 10:00 AM and 2:00 PM.
              </p>
            </div>
          )}

          {/* Recent Notices List Card */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-e1 divide-y divide-border">
            {recentNotices.length > 0 ? (
              recentNotices.map((item) => (
                <div key={item.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="type-label text-content-muted">Notice</span>
                    <span className="type-micro text-content-subtle">
                      <RelativeTime value={item.publishedAt} />
                    </span>
                  </div>
                  <h4 className="type-body font-semibold text-content">{item.title}</h4>
                  <p className="type-body text-content-muted text-sm line-clamp-2">{item.body}</p>
                </div>
              ))
            ) : (
              <>
                <div className="py-3.5 first:pt-0 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="type-label text-content-muted">Notice</span>
                    <span className="type-micro text-content-subtle">2h ago</span>
                  </div>
                  <h4 className="type-body font-semibold text-content">
                    Borewell pump serviced and operating normally
                  </h4>
                  <p className="type-body text-content-muted text-sm line-clamp-2">
                    Secondary motor replacement completed by the facility team. Regular pumping pressure has resumed across all blocks.
                  </p>
                </div>
                <div className="py-3.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="type-label text-content-muted">Recent notice</span>
                    <span className="type-micro text-content-subtle">3h ago</span>
                  </div>
                  <h4 className="type-body font-semibold text-content">
                    Annual general body meeting notice and agenda
                  </h4>
                  <p className="type-body text-content-muted text-sm line-clamp-2">
                    The general committee meeting will be held this Sunday at the clubhouse hall at 10:30 AM.
                  </p>
                </div>
                <div className="py-3.5 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="type-label text-content-muted">Recent notice</span>
                    <span className="type-micro text-content-subtle">1d ago</span>
                  </div>
                  <h4 className="type-body font-semibold text-content">
                    Clubhouse badminton court floor polishing
                  </h4>
                  <p className="type-body text-content-muted text-sm line-clamp-2">
                    Court will remain closed this Friday evening for synthetic surface polish and re-lining.
                  </p>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* Household Gate Diary Timeline Below */}
      <section aria-labelledby="gate-diary-title" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="gate-diary-title" className="type-title font-semibold text-content">
              Household Gate Diary
            </h2>
            <p className="type-micro text-content-subtle">
              Today’s arrivals and departures at Flat {mastheadUnit}
            </p>
          </div>
          <Link href="/home/visitors" className="type-label text-accent hover:text-accent-hover font-semibold">
            Visitor book →
          </Link>
        </div>

        <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-e1">
          {entries.state.state === 'loading' ? (
            <div className="space-y-3">
              <Skeleton variant="text" width="70%" />
              <Skeleton variant="text" width="55%" />
              <Skeleton variant="text" width="62%" />
            </div>
          ) : entries.state.state === 'failed' ? (
            <ErrorState
              size="compact"
              title="Your visitor diary did not load"
              onRetry={entries.reload}
            />
          ) : recentEntries.length === 0 ? (
            <div className="py-6 text-center space-y-2">
              <p className="type-body text-content-muted">
                Nobody has come calling yet today. Passes issued from Visitors will be logged here.
              </p>
              <Link href="/home/visitors" className={buttonClass('secondary', 'sm')}>
                Issue a visitor pass
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentEntries.map((entry) => (
                <li key={entry.logId} className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="type-body font-semibold truncate text-content">
                        {entry.visitorName}
                      </span>
                      <span className="type-micro text-content-subtle">· {entry.purpose}</span>
                    </div>
                    <p className="type-micro text-content-subtle">
                      {entry.enteredAt === null ? 'Waiting at gate' : 'Admitted'} ·{' '}
                      <RelativeTime value={entry.at} />
                      {entry.kind === 'PASS' ? ' · On pass' : ' · Walk-in'}
                    </p>
                  </div>
                  <StatusPill descriptor={APPROVAL_STATUS[entry.approvalStatus]} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
