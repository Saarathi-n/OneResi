'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  RelativeTime,
  Skeleton,
  useToast,
  buttonClass,
} from '@oneresi/ui';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * Notifications: the short, personal feed — who arrived, what was decided, when a bill landed.
 * Unread ones carry weight; marking them read is one action for the whole screen, not one per row
 * (the design doc's rule: never make the resident sweep).
 */

interface NoticeItem {
  id: number;
  title: string;
  body: string;
  href: string | null;
  at: string;
  read: boolean;
}

export default function NotificationsPage() {
  const notifications = useFetch<{ count: number; items: readonly NoticeItem[] }>(
    '/api/notifications',
  );
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const unread =
    notifications.state.state === 'ready'
      ? notifications.state.data.items.filter((item) => !item.read)
      : [];

  async function markAllRead(): Promise<void> {
    if (unread.length === 0) return;
    setPending(true);
    const result = await call<null>('/api/notifications/read', {
      method: 'POST',
      json: { ids: unread.map((item) => item.id) },
    });
    setPending(false);
    if (result.ok) {
      notifications.reload();
      return;
    }
    toast.show({
      title: 'Could not mark them read',
      description: result.error.message,
      tone: 'critical',
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="type-title text-content">Notifications</h1>
          <p className="type-body mt-1 text-content-muted">
            {unread.length === 0 ? 'You are all caught up.' : `${unread.length} unread`}
          </p>
        </div>
        {unread.length > 0 ? (
          <Button
            size="sm"
            pending={pending}
            pendingLabel="Marking them read"
            onClick={() => void markAllRead()}
          >
            Mark all read
          </Button>
        ) : null}
      </div>

      {notifications.state.state === 'loading' ? (
        <div className="space-y-3">
          <Skeleton variant="block" height={64} />
          <Skeleton variant="block" height={64} />
          <Skeleton variant="block" height={64} />
        </div>
      ) : notifications.state.state === 'failed' ? (
        <Card elevation={1}>
          <CardBody>
            <ErrorState
              title="Notifications did not load"
              onRetry={notifications.reload}
            />
          </CardBody>
        </Card>
      ) : notifications.state.data.items.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="When something happens that concerns your home — a visitor, a decision, a bill — it lands here."
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface-raised">
          {notifications.state.data.items.map((item) => (
            <li key={item.id} className={`px-4 py-3 ${item.read ? '' : 'bg-accent-soft'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`type-body ${item.read ? 'text-content' : 'text-content font-medium'}`}>
                    {item.title}
                  </p>
                  <p className="type-body mt-1 text-content-muted">{item.body}</p>
                </div>
                <span className="type-micro shrink-0 text-content-subtle">
                  <RelativeTime value={item.at} size="micro" />
                </span>
              </div>
              {item.href !== null ? (
                <Link href={item.href} className={buttonClass('ghost', 'sm', 'mt-2 inline-block')}>
                  Open
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
