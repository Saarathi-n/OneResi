'use client';

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, Money, StatusPill, useToast } from '@oneresi/ui';
import * as C from '@oneresi/contracts';
import { Icon } from '@/components/icons';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { WaitingDecision } from '@/components/WaitingDecision';
import { simple } from '@/lib/api';
import { RESIDENT_TABS } from '@/lib/tabs';
import { usePerson } from '@/lib/session';
import { useAsync } from '@/hooks/useAsync';
import { usePolling } from '@/hooks/usePolling';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import { duePhrase, formatDay, formatPeriod, groupByDay } from '@/lib/format';
import type { EntryLogWire, InvoiceWire, NotificationsWire, WaitingVisitorWire } from '@/lib/types';

/**
 * The resident's dashboard: what needs an answer now, then what needs attention soon, then the
 * diary. The waiting-walk-in card is the one live surface — it polls, and it can be answered right
 * here (approve or turn away) without leaving home.
 */
export default function ResidentHomePage(): ReactNode {
  const router = useRouter();
  const person = usePerson();
  const reduced = useReducedMotion();
  const toast = useToast();

  const invoices = useAsync(() => simple<readonly InvoiceWire[]>('/api/billing/invoices'), []);
  const waiting = useAsync(() => simple<readonly WaitingVisitorWire[]>('/api/visitors/waiting'), []);
  const entries = useAsync(() => simple<readonly EntryLogWire[]>('/api/visitors/entries'), []);
  const notifications = useAsync(
    () => simple<NotificationsWire>('/api/notifications'),
    [],
  );

  const refreshAll = useCallback(async () => {
    // Pull-to-refresh kicks every feed; each hook keeps its own loading state out of the way, and
    // the small settle keeps the spinner from flashing for a frame.
    waiting.reload();
    entries.reload();
    invoices.reload();
    notifications.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [waiting, entries, invoices, notifications]);

  usePolling(
    useCallback(() => {
      waiting.reload();
    }, [waiting]),
    20_000,
  );

  const dueInvoices =
    invoices.state.state === 'ready'
      ? invoices.state.data.filter((invoice) => invoice.status === 'UNPAID' || invoice.status === 'OVERDUE')
      : [];
  const nextDue = dueInvoices[0];
  const unread = notifications.state.state === 'ready' ? notifications.state.data.count : 0;

  return (
    <Shell
      title={`Hello, ${person?.name.split(' ')[0] ?? 'there'}`}
      subtitle={
        person !== null && person.home !== null
          ? `${person.home.blockName}, ${person.home.label}`
          : undefined
      }
      tabs={RESIDENT_TABS}
      activeTab="/home"
      onRefresh={refreshAll}
    >
      <div className="flex flex-col gap-4">
        {/* ------------------------------------------------ waiting walk-ins — answerable here */}
        <AsyncView
          state={waiting.state}
          skeleton={<CardListSkeleton rows={1} />}
          empty={null}
          onRetry={waiting.reload}
          render={(current) => (
            <section aria-label="Visitors waiting for your answer">
              {current.map((visitor, index) => (
                <WaitingDecision key={visitor.logId} visitor={visitor} index={index} reduced={reduced} onDecided={(name, admitted) => {
                  toast.show({
                    title: admitted ? `${name} is on the way in` : `${name} was turned away`,
                    description: 'The gate has been told.',
                  });
                  waiting.ready(current.filter((item) => item.logId !== visitor.logId));
                  entries.reload();
                }} />
              ))}
            </section>
          )}
        />

        {/* ------------------------------------------------ dues */}
        <AsyncView
          state={invoices.state}
          skeleton={
            <Card padding="default" pending>
              <SkeletonLine />
            </Card>
          }
          empty={
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="type-body font-medium">No dues pending</p>
                  <p className="type-label text-content-subtle">Every invoice is settled.</p>
                </div>
                <Icon name="check" size={20} className="text-positive" />
              </div>
            </Card>
          }
          onRetry={invoices.reload}
          render={() =>
            nextDue === undefined ? null : (
              <Card tone={C.INVOICE_STATUS[nextDue.status].tone}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="type-label text-content-subtle">Maintenance dues</p>
                    <Money value={nextDue.amountPaise} size="title" tone={nextDue.status === 'OVERDUE' ? 'critical' : 'default'} />
                    <p className="type-label text-content-muted">
                      {formatPeriod(nextDue.period)} — {duePhrase(nextDue.dueOn)}
                    </p>
                  </div>
                  <StatusPill descriptor={C.INVOICE_STATUS[nextDue.status]} size="sm" />
                </div>
                {dueInvoices.length > 1 ? (
                  <p className="mt-2 type-label text-content-subtle">
                    And {dueInvoices.length - 1} more {dueInvoices.length === 2 ? 'invoice' : 'invoices'}
                  </p>
                ) : null}
                <div className="mt-3">
                  <Button size="sm" fullWidth onClick={() => { router.push('/home/invoices'); }}>
                    Review and pay
                  </Button>
                </div>
              </Card>
            )
          }
        />

        {/* ------------------------------------------------ quick links */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/home/notices" className="focus-ring rounded-xl">
            <Card padding="tight">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-surface-sunken text-content-muted">
                  <Icon name="megaphone" size={20} />
                </span>
                <div className="min-w-0">
                  <p className="type-body font-medium">Notices</p>
                  {unread > 0 ? (
                    <Badge tone="info" size="sm">{unread} new</Badge>
                  ) : (
                    <p className="type-label text-content-subtle">All caught up</p>
                  )}
                </div>
              </div>
            </Card>
          </Link>
          <Link href="/home/visitors" className="focus-ring rounded-xl">
            <Card padding="tight">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-surface-sunken text-content-muted">
                  <Icon name="car" size={20} />
                </span>
                <div className="min-w-0">
                  <p className="type-body font-medium">Visitors</p>
                  <p className="type-label text-content-subtle">Passes and today</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>

        {/* ------------------------------------------------ the diary */}
        <AsyncView
          state={entries.state}
          skeleton={<CardListSkeleton rows={2} />}
          empty={
            <p className="type-label text-content-subtle">
              Nothing at your door yet today. Visitors the gate logs will show up here.
            </p>
          }
          onRetry={entries.reload}
          render={(log) => (
            <section aria-label="At your door">
              <h2 className="type-label text-content-subtle">At your door</h2>
              <div className="mt-2 flex flex-col gap-3">
                {groupByDay(log.slice(0, 8), (item) => item.at).map((group) => (
                  <div key={group.day} className="flex flex-col gap-2">
                    <p className="type-micro uppercase tracking-wide text-content-subtle">
                      {formatDay(group.day)}
                    </p>
                    {group.items.map((item, index) => (
                      <div key={item.logId} className="row-in" style={rowStyle(index, reduced)}>
                        <Card padding="tight" tone={C.APPROVAL_STATUS[item.approvalStatus].tone}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate type-body font-medium">{item.visitorName}</p>
                              <p className="truncate type-label text-content-subtle">
                                {item.purpose}
                                {item.enteredAt !== null ? ' — came in' : ' — did not come in'}
                              </p>
                            </div>
                            <StatusPill descriptor={C.APPROVAL_STATUS[item.approvalStatus]} size="sm" />
                          </div>
                        </Card>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}
        />
      </div>
    </Shell>
  );
}

function SkeletonLine(): ReactNode {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <span className="h-4 w-24 rounded bg-surface-sunken" />
      <span className="h-7 w-32 rounded bg-surface-sunken" />
      <span className="h-3 w-40 rounded bg-surface-sunken" />
    </div>
  );
}
