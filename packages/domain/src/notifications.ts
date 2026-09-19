import * as C from '@oneresi/contracts';
import type { Clock } from './clock.js';
import {
  ok,
  type Result,
  type NotificationsService,
  type NoticeItem,
  type PushDispatchReport,
  type PushTransport,
} from './ports.js';
import type {
  NewNotification,
  NotificationsStore,
  OutboxEventInput,
} from './store.js';

/**
 * Notifications. The feed is read-model only: services never insert notification rows — they
 * write IN_APP outbox events inside the transaction that caused them, and a worker fans those in,
 * one row per person (D-29). The wording lives here, once, so the worker stays a relay: it
 * resolves the payload's `email` to a person, stamps the time, and inserts what
 * {@link inAppNotification} returned.
 *
 * Push is the same shape one level further out: the worker resolves the payload's `email` to a
 * person, hands the PUSH event to {@link dispatchPush}'s service, and the wording again lives
 * here, once ({@link pushNotification}) — the transport only carries it.
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
    case 'complaint.updated':
      return {
        type: event.type,
        title: 'Complaint updated',
        body: `Your complaint about ${C.COMPLAINT_CATEGORY[payload.category as C.ComplaintCategory].label} is now ${C.COMPLAINT_STATUS[payload.status as C.ComplaintStatus].label}. ${payload.note}`,
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

/** What a push says: title and a body short enough for a lock screen. */
export interface PushWording {
  readonly title: string;
  readonly body: string;
  readonly path: string | null;
}

/**
 * The push a worker sends for one PUSH outbox event: null when the event is not one this surface
 * words. The same four events the in-app feed words — the ones mail deliberately has no template
 * for, because they are what a resident wants on their lock screen, not in their inbox.
 */
export function pushNotification(event: OutboxEventInput): PushWording | null {
  if (event.channel !== 'PUSH') return null;
  const payload = event.payload;
  switch (event.type) {
    case 'pass.created':
      return {
        title: 'Visitor pass ready',
        body: `${payload.visitorName} is expected on ${String(payload.validOn).slice(0, 10)}.`,
        path: null,
      };
    case 'visitor.arrived':
      return {
        title: 'Your visitor has arrived',
        body: `${payload.visitorName} has checked in.`,
        path: null,
      };
    case 'complaint.raised':
      return {
        title: 'Complaint recorded',
        body: `Your complaint about ${C.COMPLAINT_CATEGORY[payload.category as C.ComplaintCategory].label} has been recorded.`,
        path: null,
      };
    case 'complaint.updated':
      return {
        title: 'Complaint updated',
        body: `Your complaint about ${C.COMPLAINT_CATEGORY[payload.category as C.ComplaintCategory].label} is now ${C.COMPLAINT_STATUS[payload.status as C.ComplaintStatus].label}. ${payload.note}`,
        path: null,
      };
    case 'complaint.reopened':
      return {
        title: 'Complaint reopened',
        body: `Your complaint about ${C.COMPLAINT_CATEGORY[payload.category as C.ComplaintCategory].label} was reopened.`,
        path: null,
      };
    default:
      return null;
  }
}

export interface NotificationsDeps {
  readonly store: NotificationsStore;
  readonly clock: Clock;
  /**
   * The transport a dispatch sends through. Dev wiring passes the console no-op
   * (`createConsolePushTransport`); production passes the web-push transport, installed at
   * integration — this package never imports a push library.
   */
  readonly push: PushTransport;
}

export function notificationsService(deps: NotificationsDeps): NotificationsService {
  const { store, clock, push } = deps;

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

    async subscribe(actor, input): Promise<Result<null>> {
      // The endpoint is the natural key, so this is a refresh as often as a create: the browser
      // re-subscribes when it rotates its keys, and the row it names is updated in place.
      await store.upsertSubscription({
        userId: actor.userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        subscribedAt: clock.now(),
      });
      return ok(null);
    },

    async unsubscribe(actor, input): Promise<Result<null>> {
      // Scoped to the caller in the store: a foreign endpoint retires nothing, and retiring an
      // already-retired subscription is a no-op, not an error.
      await store.markSubscriptionUnsubscribed(actor.userId, input.endpoint, clock.now());
      return ok(null);
    },

    async dispatchPush({ userId, event }): Promise<Result<PushDispatchReport>> {
      const wording = pushNotification(event);
      if (wording === null) {
        // A PUSH row nothing words is not this surface's problem to report. The caller marks the
        // row done its own way, the same way the in-app relay treats it.
        return ok({ addressed: 0, sent: 0, failed: 0, retired: 0, problems: [] });
      }

      const subscriptions = await store.activeSubscriptionsForUser(userId);
      const problems: string[] = [];
      let sent = 0;
      let failed = 0;
      let retired = 0;

      for (const subscription of subscriptions) {
        // A transport that throws has broken its contract, but a monthly billing run must not
        // fail because push is down (D-29's whole reason for the outbox) — so the throw is
        // counted, not propagated.
        let result;
        try {
          result = await push.send({
            subscription: {
              endpoint: subscription.endpoint,
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
            title: wording.title,
            body: wording.body,
            path: wording.path,
            correlationId: event.correlationId,
          });
        } catch (cause) {
          failed += 1;
          problems.push(
            `${subscription.endpoint} threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
          continue;
        }

        if (result.delivered) {
          sent += 1;
          continue;
        }
        if (result.gone) {
          // The push service's own answer about its subscription. Retiring it here is not a
          // failure — retrying a subscription the service says no longer exists would be.
          await store.markSubscriptionUnsubscribed(userId, subscription.endpoint, clock.now());
          retired += 1;
        } else {
          failed += 1;
          problems.push(
            result.detail === undefined
              ? `${subscription.endpoint} was not delivered`
              : `${subscription.endpoint} was not delivered: ${result.detail}`,
          );
        }
      }

      return ok({ addressed: subscriptions.length, sent, failed, retired, problems });
    },
  };
}
