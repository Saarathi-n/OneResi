'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { paise } from '@grihaone/contracts';
import { Money, useToast } from '@grihaone/ui';
import { Icon } from '@/components/icons';
import { Shell } from '@/components/Shell';
import type { TabDef } from '@/components/BottomTabs';
import { simple } from '@/lib/api';
import { usePerson } from '@/lib/session';
import { useAsync } from '@/hooks/useAsync';
import { usePolling } from '@/hooks/usePolling';
import type { EntryLogWire, InvoiceWire, NoticeWire, NotificationsWire, WaitingVisitorWire } from '@/lib/types';

/**
 * Gold standard PWA Mobile Home (Prompt 24, Ref 24):
 * "The morning glance":
 * - Translucent frosted glass header with the resident's name, home, and notification bell.
 * - Outstanding Dues hero card: the real total with inline 'Pay Now' green pill button.
 * - 'Needing You' section: compact walk-in approval card with visitor icon, name, and inline
 *   'Approve' / 'Decline' pill buttons — success only ever toasted on a succeeded request.
 * - Quick action pills grid (6 rounded pill chips: 'New Pass', 'Complaints', 'Bookings', etc.).
 * - 'Society Notices': pinned notice card with 'Pinned' badge.
 * - 'Recent Gate Entries': timeline feed with timestamps.
 */

const PWA_HOME_TABS: readonly TabDef[] = [
  { href: '/home', label: 'Home', icon: 'home' },
  { href: '/home/invoices', label: 'Invoices', icon: 'receipt' },
  { href: '/home/visitors', label: 'Visitors', icon: 'users' },
  { href: '/home/notices', label: 'Notices', icon: 'clipboard' },
  { href: '/home/more', label: 'More', icon: 'more' },
];

const QUICK_ACTIONS = [
  { label: 'New Pass', href: '/home/visitors' },
  { label: 'Complaints', href: '/home/complaints' },
  { label: 'Bookings', href: '/home/facilities' },
  { label: 'Invoices', href: '/home/invoices' },
  { label: 'Notices', href: '/home/notices' },
  { label: 'More', href: '/home/more' },
] as const;

function formatEntryTime(isoString: string): string | null {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return null;
    return date
      .toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      .toUpperCase();
  } catch {
    return null;
  }
}

export default function ResidentHomePage(): ReactNode {
  const router = useRouter();
  const person = usePerson();
  const toast = useToast();

  const invoices = useAsync(() => simple<readonly InvoiceWire[]>('/api/billing/invoices'), []);
  const waiting = useAsync(() => simple<readonly WaitingVisitorWire[]>('/api/visitors/waiting'), []);
  const entries = useAsync(() => simple<readonly EntryLogWire[]>('/api/visitors/entries'), []);
  const notifications = useAsync(() => simple<NotificationsWire>('/api/notifications'), []);
  const notices = useAsync(() => simple<readonly NoticeWire[]>('/api/notices'), []);

  const [decidedIds, setDecidedIds] = useState<ReadonlySet<number>>(new Set());
  const [pendingDecision, setPendingDecision] = useState<{ id: number; type: 'APPROVE' | 'REJECT' } | null>(null);

  const refreshAll = useCallback(async () => {
    waiting.reload();
    entries.reload();
    invoices.reload();
    notifications.reload();
    notices.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [waiting, entries, invoices, notifications, notices]);

  usePolling(
    useCallback(() => {
      waiting.reload();
    }, [waiting]),
    20_000,
  );

  const handleDecision = async (
    visitor: { logId: number; name: string },
    decision: 'APPROVE' | 'REJECT',
  ) => {
    if (pendingDecision !== null) return;
    setPendingDecision({ id: visitor.logId, type: decision });

    const result = await simple<null>(`/api/visitors/walk-ins/${visitor.logId}/decision`, {
      method: 'POST',
      json: { logId: visitor.logId, decision },
    });
    setPendingDecision(null);

    if (!result.ok) {
      toast.show({ title: 'That did not go through', description: result.error.message, tone: 'critical' });
      waiting.reload();
      return;
    }

    setDecidedIds((prev) => new Set([...prev, visitor.logId]));
    toast.show({
      title: decision === 'APPROVE' ? `${visitor.name} is on the way in` : `${visitor.name} was turned away`,
      description: 'The gate has been told.',
    });

    waiting.reload();
    entries.reload();
  };

  const dueInvoices =
    invoices.state.state === 'ready'
      ? invoices.state.data.filter((invoice) => invoice.status === 'UNPAID' || invoice.status === 'OVERDUE')
      : [];
  const totalDuesPaise = paise(dueInvoices.reduce((sum, inv) => sum + (inv.amountPaise as number), 0));

  const unread = notifications.state.state === 'ready' ? notifications.state.data.count : 0;

  const residentName = person?.name ?? '';
  const residentHome =
    person !== null && person.home !== null
      ? `${person.home.blockName} · ${person.home.label}`
      : 'GrihaOne';

  const liveWaiting = waiting.state.state === 'ready' ? waiting.state.data : [];
  const waitingVisitors = liveWaiting.filter((item) => !decidedIds.has(item.logId));

  const pinnedNotice =
    notices.state.state === 'ready'
      ? notices.state.data.find((notice) => notice.pinned) ?? notices.state.data[0]
      : undefined;

  const gateEntries =
    entries.state.state === 'ready'
      ? entries.state.data.slice(0, 3).map((entry) => {
          const arrived = entry.enteredAt !== null;
          const at = arrived ? formatEntryTime(entry.enteredAt) : null;
          return {
            id: entry.logId,
            title: entry.visitorName,
            subtitle: arrived ? `Came in · ${entry.purpose}` : entry.purpose,
            timestamp: at,
          };
        })
      : [];

  const notificationBellAffordance = (
    <Link
      href="/home/notifications"
      aria-label={unread > 0 ? `${unread} new notifications` : 'Notifications'}
      className="relative flex size-11 items-center justify-center rounded-full text-content hover:bg-surface-sunken/60 transition-colors focus-ring"
    >
      <Icon name="bell" size={22} />
      {unread > 0 ? (
        <span className="absolute top-2 right-2 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-on ring-2 ring-surface-raised">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  );

  return (
    <Shell
      title={residentName}
      subtitle={residentHome}
      tabs={PWA_HOME_TABS}
      activeTab="/home"
      onRefresh={refreshAll}
      headerRight={notificationBellAffordance}
    >
      <div className="relative flex flex-col gap-5 pb-24">
        {/* Morning atmospheric glow at top */}
        <div
          className="pointer-events-none absolute -top-12 inset-x-0 h-40 bg-gradient-to-b from-accent-soft/40 via-accent-soft/10 to-transparent blur-2xl"
          aria-hidden
        />

        {/* 1. Outstanding Dues hero card */}
        <section
          aria-label="Outstanding Dues"
          className="relative overflow-hidden rounded-2xl border border-border/80 bg-surface-raised p-5 shadow-e1"
        >
          <p className="type-label font-medium text-content">Outstanding Dues:</p>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <Money value={totalDuesPaise} size="mega" tone="gold" glow />
            <button
              type="button"
              onClick={() => {
                router.push('/home/invoices');
              }}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent px-6 py-2 type-label font-semibold text-accent-on shadow-e1 hover:bg-accent-hover active:bg-accent-pressed transition-colors focus-ring"
            >
              Pay Now
            </button>
          </div>
        </section>

        {/* 2. Needing You section */}
        {waitingVisitors.length > 0 ? (
          <section aria-label="Needing You" className="flex flex-col gap-2.5">
            <h2 className="type-title font-semibold text-content">Needing You</h2>
            <div className="flex gap-3 overflow-x-auto pb-1 snap-x scrollbar-none">
              {waitingVisitors.map((visitor) => (
                <div
                  key={visitor.logId}
                  className="w-full shrink-0 snap-center rounded-2xl border border-border/80 bg-surface-raised p-4 shadow-e1"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"
                      aria-hidden
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width={20}
                        height={20}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="type-body text-content">
                        <span className="font-bold">Walk-in</span>{' '}
                        <span className="text-content-muted">· {visitor.name}</span>
                      </p>
                    </div>
                  </div>

                  <div className="mt-3.5 flex gap-2.5">
                    <button
                      type="button"
                      disabled={pendingDecision !== null}
                      onClick={() => {
                        void handleDecision(visitor, 'APPROVE');
                      }}
                      className="flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-border bg-surface-raised px-4 py-2 type-label font-semibold text-content hover:bg-surface-sunken/60 active:bg-surface-sunken transition-colors focus-ring disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={pendingDecision !== null}
                      onClick={() => {
                        void handleDecision(visitor, 'REJECT');
                      }}
                      className="flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-border bg-surface-raised px-4 py-2 type-label font-semibold text-content hover:bg-surface-sunken/60 active:bg-surface-sunken transition-colors focus-ring disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* 3. Quick action pills grid (6 rounded pill chips) */}
        <section aria-label="Quick Actions" className="grid grid-cols-3 gap-2.5">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="flex min-h-[44px] items-center justify-center rounded-full border border-border/90 bg-surface-raised/90 px-3 py-2 text-center type-label font-medium text-content shadow-e0 hover:bg-surface-sunken/60 active:bg-surface-sunken transition-colors focus-ring"
            >
              {action.label}
            </Link>
          ))}
        </section>

        {/* 4. Society Notices */}
        <section aria-label="Society Notices" className="flex flex-col gap-2.5">
          <h2 className="type-title font-semibold text-content">Society Notices</h2>
          {pinnedNotice !== undefined ? (
            <Link
              href="/home/notices"
              className="group block rounded-2xl border border-border/80 bg-surface-raised p-4 shadow-e1 transition-all hover:border-border-strong hover:shadow-e2 focus-ring"
            >
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-0.5 type-micro font-medium text-content-muted">
                <span aria-hidden>📌</span>
                <span>Pinned</span>
              </span>
              <h3 className="mt-2.5 type-body font-semibold text-content group-hover:text-accent transition-colors">
                {pinnedNotice.title}
              </h3>
            </Link>
          ) : (
            <Link
              href="/home/notices"
              className="block rounded-2xl border border-border/80 bg-surface-raised p-4 shadow-e1 transition-all hover:border-border-strong hover:shadow-e2 focus-ring"
            >
              <p className="type-body text-content-muted">No notices yet. Society announcements land here.</p>
            </Link>
          )}
        </section>

        {/* 5. Recent Gate Entries */}
        <section aria-label="Recent Gate Entries" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="type-title font-semibold text-content">Recent Gate Entries</h2>
            <Link
              href="/home/visitors"
              className="type-label font-medium text-content-subtle hover:text-content transition-colors focus-ring rounded"
            >
              View all
            </Link>
          </div>

          <div className="relative flex flex-col gap-4 pl-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
            {gateEntries.length === 0 ? (
              <p className="type-body text-content-muted">
                No gate entries yet. Everyone the gate logs for your flat shows up here.
              </p>
            ) : (
              gateEntries.map((item) => (
                <div key={item.id} className="relative flex items-start justify-between gap-3">
                  <span
                    className="absolute -left-6 top-1.5 size-2.5 rounded-full bg-border-strong ring-4 ring-surface"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="type-body font-semibold text-content truncate">{item.title}</p>
                    <p className="type-micro text-content-subtle truncate mt-0.5">{item.subtitle}</p>
                  </div>
                  {item.timestamp !== null ? (
                    <span className="type-label font-medium text-content tabular-nums shrink-0">
                      {item.timestamp}
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </Shell>
  );
}
