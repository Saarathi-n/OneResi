'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, RelativeTime } from '@grihaone/ui';
import { Icon } from '@/components/icons';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { PushSetting } from '@/components/PushSetting';
import { Shell } from '@/components/Shell';
import { simple } from '@/lib/api';
import { RESIDENT_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import type { NotificationItemWire, NotificationsWire } from '@/lib/types';

/**
 * The inbox of what happened while you were not looking: a payment landed, a visitor was let in, a
 * booking was confirmed. Everything here is unread by definition — reading one (or all) marks it so
 * on the server, which is what keeps the badge on the shelf honest.
 */
export default function NotificationsPage(): ReactNode {
  const reduced = useReducedMotion();
  const notifications = useAsync(() => simple<NotificationsWire>('/api/notifications'), []);
  const [marking, setMarking] = useState(false);

  const refresh = useCallback(async () => {
    notifications.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [notifications]);

  const items =
    notifications.state.state === 'ready' ? [...notifications.state.data.items] : [];

  async function markRead(ids: readonly number[]): Promise<void> {
    if (marking || ids.length === 0) return;
    setMarking(true);
    // Optimistic: the row disappears now; a failure reloads the truth.
    if (notifications.state.state === 'ready') {
      notifications.ready({
        count: Math.max(0, notifications.state.data.count - ids.length),
        items: notifications.state.data.items.filter((item) => !ids.includes(item.id)),
      });
    }
    const result = await simple<null>('/api/notifications/read', {
      method: 'POST',
      json: { ids: [...ids] },
    });
    setMarking(false);
    if (!result.ok) {
      notifications.reload();
    }
  }

  return (
    <Shell
      title="Notifications"
      backHref="/home/more"
      tabs={RESIDENT_TABS}
      activeTab="/home/more"
      onRefresh={refresh}
      headerRight={
        items.length > 0 ? (
          <Button size="sm" variant="ghost" pending={marking} onClick={() => { void markRead(items.map((item) => item.id)); }}>
            Mark all read
          </Button>
        ) : undefined
      }
    >
      {/* The lock-screen switch, above the feed it governs. It renders nothing when this
          browser or this checkout cannot do push — the layout below is unchanged in that case. */}
      <PushSetting />
      <AsyncView
        state={notifications.state}
        skeleton={<CardListSkeleton rows={4} />}
        empty={
          <div className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
            <p className="type-body font-medium">All read</p>
            <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
              Payments, visitors, bookings — anything new shows up here first.
            </p>
          </div>
        }
        onRetry={notifications.reload}
        render={(list) => (
          <div className="flex flex-col gap-3">
            {list.items.map((item, index) => (
              <div key={item.id} className="row-in" style={rowStyle(index + 1, reduced)}>
                <NotificationCard
                  item={item}
                  onRead={() => {
                    void markRead([item.id]);
                  }}
                />
              </div>
            ))}
          </div>
        )}
      />
    </Shell>
  );
}

function NotificationCard({
  item,
  onRead,
}: {
  readonly item: NotificationItemWire;
  readonly onRead: () => void;
}): ReactNode {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="type-body font-medium">{item.title}</p>
          <p className="mt-1 type-label text-content-muted">{item.body}</p>
          <p className="mt-1 type-label text-content-subtle">
            <RelativeTime value={item.at} size="label" />
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onRead} aria-label={`Mark "${item.title}" as read`}>
          <Icon name="check" size={16} />
          <span className="sr-only">Mark as read</span>
        </Button>
      </div>
    </Card>
  );
}
