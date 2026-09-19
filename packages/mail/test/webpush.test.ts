import { describe, expect, it } from 'vitest';
import type { PushSubscription as BrowserSubscription, SendResult } from 'web-push';
import { pushDriver, pushPublicKey, vapidSettings, type VapidSettings } from '../src/env.js';
import { MailConfigError } from '../src/errors.js';
import {
  createWebPushTransport,
  type WebPushRequest,
  type WebPushSender,
  type WebPushTransport,
} from '../src/providers/webpush.js';

/**
 * The web-push transport, asserted without touching a push service.
 *
 * A recording sender stands where `webpush.sendNotification` goes and keeps everything it was
 * handed, so the wire format is checked exactly: the subscription's three strings, and the JSON
 * the service worker parses. The one failure vocabulary that matters — 404/410 mean the
 * subscription is gone, everything else is transient with a detail — is the part a broken
 * transport would quietly get wrong, and a retired-versus-retried decision hangs on it
 * (D-30: a provider that misreports has the same effect as one that never sends).
 */

const VAPID: VapidSettings = {
  subject: 'mailto:admin@grihaone.test',
  publicKey: 'BPb2NeV2LwYFhFxStz0JXjmS7FJmZy1hZQq5zF5uQk3cO7XjGcQbVnOa3P3zI9jBq2E4Tt6Yy8sA',
  privateKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
};

/** What one failing push service answered, with the `statusCode` web-push attaches to its errors. */
function aPushServiceError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

/** Every call the transport made, verbatim. `failWith` makes the push service refuse. */
function aRecordingSender(options: { readonly failWith?: Error } = {}) {
  const calls: {
    readonly subscription: BrowserSubscription;
    readonly payload: string | null;
    readonly vapid: VapidSettings;
  }[] = [];

  const sender: WebPushSender = {
    sendNotification: (subscription, payload, opts) => {
      calls.push({ subscription, payload, vapid: opts.vapidDetails });
      if (options.failWith !== undefined) return Promise.reject(options.failWith);
      return Promise.resolve({} as SendResult);
    },
  };

  return { sender, calls };
}

function aRequest(overrides: Partial<WebPushRequest> = {}): WebPushRequest {
  return {
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/dE2xW9qTr7',
      p256dh: 'BIXrPxaZmGWp4d1P0sLQk6mXcVl0xHbTvgzA7lV8bG2bN9uJ3uU0lY5kF1dS4nQmX',
      auth: 'c2VjcmV0LWF1dC1rZXk',
    },
    title: 'Your visitor has arrived',
    body: 'Ravi has checked in.',
    path: null,
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe('a delivered notification', () => {
  it('sends the three strings and exactly the JSON the service worker parses', async () => {
    const recording = aRecordingSender();
    const transport: WebPushTransport = createWebPushTransport({
      sender: recording.sender,
      vapid: VAPID,
    });

    const result = await transport.send(aRequest({ path: '/a/visitors' }));

    expect(result).toEqual({ delivered: true, gone: false });

    // The wire format: the subscription verbatim, and a three-field JSON payload whose `path`
    // is a path, never a URL — the origin is the click handler's business, not the sender's (D-22).
    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]?.subscription).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/dE2xW9qTr7',
      keys: {
        p256dh: 'BIXrPxaZmGWp4d1P0sLQk6mXcVl0xHbTvgzA7lV8bG2bN9uJ3uU0lY5kF1dS4nQmX',
        auth: 'c2VjcmV0LWF1dC1rZXk',
      },
    });
    expect(recording.calls[0]?.payload).toBe(
      JSON.stringify({
        title: 'Your visitor has arrived',
        body: 'Ravi has checked in.',
        path: '/a/visitors',
      }),
    );

    // The VAPID identity is passed as the push service's auth header material, not embedded in
    // the payload — the person's device never sees the keypair.
    expect(recording.calls[0]?.vapid).toEqual(VAPID);
  });

  it('keeps a null path null, so the click handler opens the app root', async () => {
    const recording = aRecordingSender();
    const transport = createWebPushTransport({ sender: recording.sender, vapid: VAPID });

    await transport.send(aRequest());

    expect(JSON.parse(recording.calls[0]?.payload ?? '{}')).toEqual({
      title: 'Your visitor has arrived',
      body: 'Ravi has checked in.',
      path: null,
    });
  });
});

describe('a subscription the push service no longer knows', () => {
  it('reports gone, not failed, on a 404', async () => {
    const recording = aRecordingSender({
      failWith: aPushServiceError(404, 'Subscription not found'),
    });
    const transport = createWebPushTransport({ sender: recording.sender, vapid: VAPID });

    const result = await transport.send(aRequest());

    // Retire, do not retry: this result is what makes the dispatcher unsubscribe the device
    // instead of the worker spending four more attempts on it.
    expect(result).toEqual({ delivered: false, gone: true });
  });

  it('reports gone on a 410 as well', async () => {
    const recording = aRecordingSender({
      failWith: aPushServiceError(410, 'Subscription expired'),
    });
    const transport = createWebPushTransport({ sender: recording.sender, vapid: VAPID });

    expect(await transport.send(aRequest())).toEqual({ delivered: false, gone: true });
  });
});

describe('every other failure', () => {
  it('is transient, with the status and the reason in the detail', async () => {
    const recording = aRecordingSender({
      failWith: aPushServiceError(503, 'Push service unavailable'),
    });
    const transport = createWebPushTransport({ sender: recording.sender, vapid: VAPID });

    const result = await transport.send(aRequest());

    expect(result.delivered).toBe(false);
    expect(result.gone).toBe(false);
    expect(result.detail).toContain('status 503');
    expect(result.detail).toContain('Push service unavailable');
  });

  it('reports the error alone when there is no status, and never throws', async () => {
    const recording = aRecordingSender({
      failWith: new Error('getaddrinfo ENOTFOUND fcm.googleapis.com'),
    });
    const transport = createWebPushTransport({ sender: recording.sender, vapid: VAPID });

    const result = await transport.send(aRequest());

    expect(result.gone).toBe(false);
    expect(result.detail).toContain('getaddrinfo ENOTFOUND');
  });
});

// ---------------------------------------------------------------- the environment

/**
 * The same strictness the mail side keeps (D-30): outside production the console transport is
 * the default so a checkout runs with no keys; in production an unset variable must refuse to
 * boot rather than quietly deliver nothing. `pushPublicKey` is the exception — it runs on the
 * key route's request path, so its answer to any misconfiguration is null, never a throw.
 */
describe('the environment it reads', () => {
  const KEYS = {
    VAPID_SUBJECT: 'mailto:admin@grihaone.test',
    VAPID_PUBLIC_KEY: 'a-public-key',
    VAPID_PRIVATE_KEY: 'a-private-key',
  };

  it('defaults to console outside production, and accepts webpush when named', () => {
    expect(pushDriver({})).toBe('console');
    expect(pushDriver({ PUSH_DRIVER: 'webpush' })).toBe('webpush');
    expect(() => pushDriver({ PUSH_DRIVER: 'apns' })).toThrow(MailConfigError);
  });

  it('refuses anything but webpush in production', () => {
    expect(() => pushDriver({ NODE_ENV: 'production' })).toThrow(
      /PUSH_DRIVER must be "webpush" in production/,
    );
    expect(pushDriver({ NODE_ENV: 'production', PUSH_DRIVER: 'webpush' })).toBe('webpush');
  });

  it('requires all three VAPID values, and a mailto: subject', () => {
    expect(vapidSettings(KEYS)).toEqual({
      subject: KEYS.VAPID_SUBJECT,
      publicKey: KEYS.VAPID_PUBLIC_KEY,
      privateKey: KEYS.VAPID_PRIVATE_KEY,
    });
    expect(() => vapidSettings({ ...KEYS, VAPID_SUBJECT: 'admin@grihaone.test' })).toThrow(/mailto/);
    expect(() => vapidSettings({ ...KEYS, VAPID_PRIVATE_KEY: '' })).toThrow(/VAPID_PRIVATE_KEY/);
  });

  it('answers the key route honestly: the key, or null, never a throw', () => {
    expect(pushPublicKey(KEYS)).toBeNull(); // console driver, so no key to hand a browser
    expect(pushPublicKey({ ...KEYS, PUSH_DRIVER: 'webpush' })).toBe('a-public-key');
    // Half-configured, wrong driver, garbage: null, because the route renders "not configured".
    expect(pushPublicKey({ PUSH_DRIVER: 'webpush' })).toBeNull();
    expect(
      pushPublicKey({ ...KEYS, PUSH_DRIVER: 'webpush', VAPID_SUBJECT: 'not-a-mailto' }),
    ).toBeNull();
  });
});
