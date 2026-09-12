import type { Db } from '../client.js';
import type { NotificationsStore } from '@grihaone/domain';
import { toNotification, toPushSubscription } from './shared.js';

/**
 * NotificationsStore over Prisma: the read model the worker fans IN_APP outbox events into, one
 * row per person (D-29). Services never insert here — they write the outbox row inside the
 * transaction that caused it, and the worker relays.
 *
 * The same seam also carries the person's Web Push subscriptions: the endpoint URL is the natural
 * key, a subscription is retired rather than deleted, and every method is scoped to the one
 * person it belongs to.
 */
export function notificationsStore(db: Db): NotificationsStore {
  const store: NotificationsStore = {
    async notificationsForUser(userId) {
      // One person's feed, newest first.
      const rows = await db.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return rows.map(toNotification);
    },

    async markNotificationsRead(userId, ids, readAt) {
      if (ids.length === 0) return 0;
      // Scoped to the caller, so a foreign id marks nothing; and scoped to unread rows, so the
      // count is the rows this call actually changed — marking an already-read row again is a
      // no-op, not an error.
      const applied = await db.notification.updateMany({
        where: { userId, id: { in: [...ids] }, readAt: null },
        data: { readAt },
      });
      return applied.count;
    },

    async createNotifications(rows) {
      // One insert, one statement — the fan-in is atomic by construction.
      if (rows.length === 0) return;
      await db.notification.createMany({
        data: rows.map((row) => ({
          userId: row.userId,
          type: row.type,
          title: row.title,
          body: row.body,
          href: row.href,
          createdAt: row.createdAt,
        })),
      });
    },

    async upsertSubscription(input) {
      // The endpoint is the natural key, so both branches describe the same device. The update
      // re-claims the row — userId, both keys and the subscribed stamp — because a browser's
      // subscription outlives its sign-in and must follow the account that last asked for it.
      const row = await db.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: {
          userId: input.userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          subscribedAt: input.subscribedAt,
        },
        update: {
          userId: input.userId,
          p256dh: input.p256dh,
          auth: input.auth,
          subscribedAt: input.subscribedAt,
          unsubscribedAt: null,
        },
      });
      return toPushSubscription(row);
    },

    async activeSubscriptionsForUser(userId) {
      // Every device the person subscribed on and none they retired, oldest first. This is the
      // (userId, unsubscribedAt) index's own query.
      const rows = await db.pushSubscription.findMany({
        where: { userId, unsubscribedAt: null },
        orderBy: [{ subscribedAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toPushSubscription);
    },

    async markSubscriptionUnsubscribed(userId, endpoint, at) {
      // Scoped to the user, so another person's endpoint retires nothing; and scoped to active
      // rows, so retiring twice is a no-op — the count is the rows this call actually changed.
      const applied = await db.pushSubscription.updateMany({
        where: { userId, endpoint, unsubscribedAt: null },
        data: { unsubscribedAt: at },
      });
      return applied.count;
    },
  };

  return store;
}
