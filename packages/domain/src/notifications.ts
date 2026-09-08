import * as C from '@oneresi/contracts';
import type { Clock } from './clock.js';
import { ok, type Result, type NotificationsService, type NoticeItem } from './ports.js';
import type { NewNotification, NotificationsStore, OutboxEventInput } from './store.js';

/**
 * Notifications. The feed is read-model only: services never insert notification rows — they
 * write IN_APP outbox events inside the transaction that caused them, and a worker fans those in,
 * one row per person (D-29). The wording lives here, once, so the worker stays a relay: it
 * resolves the payload's `email` to a person, stamps the time, and inserts what
 * {@link inAppNotification} returned.
 *
 * Read state is per person: marking read is scoped to the caller in the store, so another
 * household's ids mark nothing.
 */

/**
 * The notification a worker writes for one IN_APP outbox event: null when the event is not one
 * the feed words (email-only events, or a channel this surface does not serve). The caller
 * supplies `userId` (resolved from the payload's `email`) and `createdAt`.
 */
export function inAppNotification(
  event: OutboxEventInput,
): Omit<NewNotification, 'userId' | 'createdAt'> | null {
  if (event.channel !== 'IN_APP') return null;
  const payload = event.payload;
  switch (event.type) {
    case 'pass.created':
      return {
        type: event.type,
        title: 'Visitor pass ready',
        body: `${payload.visitorName} is expected on ${String(payload.validOn).slice(0, 10)}. Purpose: ${payload.purpose}.`,
        href: null,
      };
    case 'visitor.arrived':
      return {
        type: event.type,
        title: 'Your visitor has arrived',
        body: `${payload.visitorName} has checked in. Purpose: ${payload.purpose}.`,
        href: null,
      };
    case 'complaint.raised':
      return {
        type: event.type,
        title: 'Complaint recorded',
        body: `Your complaint about ${C.COMPLAINT_CATEGORY[payload.category as C.ComplaintCategory].label} has been recorded.`,
        href: null,
      };
    case 'complaint.reopened':
      return {
        type: event.type,
        title: 'Complaint reopened',
        body: `Your complaint about ${C.COMPLAINT_CATEGORY[payload.category as C.ComplaintCategory].label} was reopened. Reason: ${payload.reason}.`,
        href: null,
      };
    default:
      return null;
  }
}

export interface NotificationsDeps {
  readonly store: NotificationsStore;
  readonly clock: Clock;
}

export function notificationsService(deps: NotificationsDeps): NotificationsService {
  const { store, clock } = deps;

  return {
    async unread(actor): Promise<Result<{ count: number; items: readonly NoticeItem[] }>> {
      const rows = await store.notificationsForUser(actor.userId);
      const items = rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        href: row.href,
        at: row.createdAt,
        read: row.readAt !== null,
      }));
      return ok({ count: items.filter((item) => !item.read).length, items });
    },

    async markRead(actor, ids): Promise<Result<null>> {
      // Scoped to the caller in the store: a foreign id marks nothing, and marking an
      // already-read row again is not an error.
      await store.markNotificationsRead(actor.userId, ids, clock.now());
      return ok(null);
    },
  };
}
