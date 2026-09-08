import type { Db } from '../client.js';
import type { NotificationsStore } from '@oneresi/domain';
import { toNotification } from './shared.js';

/**
 * NotificationsStore over Prisma: the read model the worker fans IN_APP outbox events into, one
 * row per person (D-29). Services never insert here — they write the outbox row inside the
 * transaction that caused it, and the worker relays.
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
  };

  return store;
}
