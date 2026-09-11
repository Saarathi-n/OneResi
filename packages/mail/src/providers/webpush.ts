import webpush from 'web-push';
import type { PushSubscription as BrowserSubscription, SendResult } from 'web-push';
import { describeError } from '../errors.js';
import { vapidSettings, type VapidSettings } from '../env.js';

/**
 * The real push transport, mirroring `providers/ses.ts` one boundary over: the domain names the
 * port (`PushTransport` in packages/domain/src/ports.ts), this file is the adapter that knows
 * about an actual push service, and nothing in packages/domain imports a push library.
 *
 * The types below are local and structural on purpose. The layering in docs/plan/WIRING.md has
 * packages/mail importing contracts and db only — not the domain package, not even its types.
 * Structural typing is what lets both sides describe the same shape without one importing the
 * other: what runtime.ts hands to `notificationsService({push})` is this object, and it satisfies
 * the domain port because every field lines up.
 */

// ---------------------------------------------------------------- the port, restated locally

/** One browser subscription: the three strings the browser produced, nothing more. */
export interface PushSubscriptionTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * One message to one device. `path` is a path, never a URL — the service worker joins it to the
 * app origin when the notification is clicked, the same rule mail's action block keeps and for
 * the same reason: the origin is configuration, never the sender's guess (D-22).
 */
export interface WebPushRequest {
  readonly subscription: PushSubscriptionTarget;
  readonly title: string;
  readonly body: string;
  readonly path: string | null;
  /** Ties the delivery back to the request that caused it, for log correlation. */
  readonly correlationId: string;
}

export interface WebPushResult {
  readonly delivered: boolean;
  /**
   * True when the push service answered that the subscription no longer exists (404 or 410).
   * Not a failure: the honest response is for the dispatcher to retire the subscription, not for
   * the worker to retry a message to a device that will never receive it.
   */
  readonly gone: boolean;
  /** Never shown. For the log line the transport owes the operator. */
  readonly detail?: string;
}

export interface WebPushTransport {
  readonly name: 'webpush';
  send(request: WebPushRequest): Promise<WebPushResult>;
}

// ---------------------------------------------------------------- the adapter

/**
 * Narrow on purpose, so a test double is one function. The real `webpush.sendNotification`
 * satisfies this exactly.
 */
export interface WebPushSender {
  sendNotification(
    subscription: BrowserSubscription,
    payload: string | null,
    options: { readonly vapidDetails: VapidSettings },
  ): Promise<SendResult>;
}

export interface WebPushTransportOptions {
  /** A recording double in tests; the library itself otherwise. */
  readonly sender?: WebPushSender;
  /**
   * Resolved eagerly when omitted, so a production misconfiguration fails at boot — the
   * composition root constructing this transport is the enforcement point for D-30's argument.
   */
  readonly vapid?: VapidSettings;
}

/**
 * What the service worker parses. `path` rides along verbatim as a path (D-22); the click
 * handler joins it to the app's own origin, so no origin is ever baked in here.
 */
function payloadFor(request: WebPushRequest): string {
  return JSON.stringify({ title: request.title, body: request.body, path: request.path });
}

export function createWebPushTransport(options: WebPushTransportOptions = {}): WebPushTransport {
  const sender: WebPushSender = options.sender ?? webpush;
  const vapid = options.vapid ?? vapidSettings();

  return {
    name: 'webpush',
    send: async (request: WebPushRequest): Promise<WebPushResult> => {
      const subscription: BrowserSubscription = {
        endpoint: request.subscription.endpoint,
        keys: { p256dh: request.subscription.p256dh, auth: request.subscription.auth },
      };

      try {
        await sender.sendNotification(subscription, payloadFor(request), {
          vapidDetails: vapid,
        });
        return { delivered: true, gone: false };
      } catch (cause) {
        const statusCode =
          typeof cause === 'object' && cause !== null && 'statusCode' in cause
            ? (cause as { readonly statusCode: unknown }).statusCode
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          return { delivered: false, gone: true };
        }
        // Transient by default — a 5xx, a network blip, a push service that is briefly down —
        // so the row keeps its attempts and comes back with backoff. The one status pair that
        // says "this will never work" is handled above.
        return {
          delivered: false,
          gone: false,
          detail:
            typeof statusCode === 'number'
              ? `status ${statusCode}: ${describeError(cause)}`
              : describeError(cause),
        };
      }
    },
  };
}
