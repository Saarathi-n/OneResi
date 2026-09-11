import { API_BASE, simple } from './api';

/**
 * The enable-push flow, once, for whichever surface offers it. The browser's order is fixed and
 * not negotiable, so it lives here rather than in a component:
 *
 *   1. ask the API for its public VAPID key — when the server has none (the console driver in a
 *      dev checkout without keys), the control that starts this flow is never rendered, because
 *      a button that can only fail is worse than no button (D-30's argument, seen from the
 *      client)
 *   2. ask the person, once — `Notification.requestPermission()`; a "denied" here is final until
 *      they change it in the browser's site settings, and the honest response is copy that says
 *      so, not a retry button that will bounce
 *   3. register the service worker — `ServiceWorkerRegister` only does this in production, and
 *      dev deserves push too, so the flow registers it itself; registering an already-registered
 *      worker is a no-op the browser resolves to the same registration
 *   4. subscribe with the server's key and hand the subscription to the API
 *
 * Every failure is a value, never a thrown exception — the same rule `api.ts` keeps.
 */

/** What the key route answers. `null` is "could not ask" — offline, or the API is down. */
export type PushKeyAnswer =
  | { readonly configured: true; readonly publicKey: string }
  | { readonly configured: false };

/**
 * A bare fetch on purpose: no credentials, no custom headers, so a dev checkout's cross-origin
 * call (the API is port 3000, this app is 3001) is a simple request with no preflight, and the
 * key route's `Access-Control-Allow-Origin: *` answers it. The key is public — it is what a
 * browser encrypts TO, not a secret.
 */
export async function fetchPushKey(): Promise<PushKeyAnswer | null> {
  try {
    const response = await fetch(`${API_BASE}/api/push/key`);
    if (!response.ok) return null;
    const body = (await response.json()) as { configured?: unknown; publicKey?: unknown };
    if (body.configured === false) return { configured: false };
    if (
      body.configured === true &&
      typeof body.publicKey === 'string' &&
      body.publicKey.length > 0
    ) {
      return { configured: true, publicKey: body.publicKey };
    }
    return null;
  } catch {
    return null;
  }
}

/** What the browser sends, base64url — the encoding `applicationServerKey` wants is raw bytes. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64 + padding);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/** Push needs a service worker, a push manager and the permission prompt — all of them. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export type EnableOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'denied' | 'unsupported' | 'unavailable';
      readonly message: string;
    };

/** Runs the whole flow. See the module comment for the order and why it is fixed. */
export async function enablePush(): Promise<EnableOutcome> {
  if (!pushSupported()) {
    return {
      ok: false,
      reason: 'unsupported',
      message: 'This browser cannot receive notifications.',
    };
  }

  const key = await fetchPushKey();
  if (key === null || !key.configured) {
    // The server had a key when the control was rendered and does not now. Rare, but the honest
    // answer is a sentence, not a silent no-op.
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Notifications are not set up on the server right now.',
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      ok: false,
      reason: 'denied',
      message:
        'Notifications are blocked. Allow them for this app in your browser settings to get alerts.',
    };
  }

  // ServiceWorkerRegister skips dev, so the flow registers the worker itself; a second
  // registration resolves to the first one, so this is safe in production too.
  const registration = await navigator.serviceWorker.register('/a/sw.js', { scope: '/a/' });
  await navigator.serviceWorker.ready;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key.publicKey),
  });

  const wire = subscription.toJSON();
  const endpoint = typeof wire.endpoint === 'string' ? wire.endpoint : null;
  const keys = wire.keys;
  const p256dh = keys !== undefined && typeof keys.p256dh === 'string' ? keys.p256dh : null;
  const auth = keys !== undefined && typeof keys.auth === 'string' ? keys.auth : null;
  if (endpoint === null || p256dh === null || auth === null) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'This browser could not create a notification subscription.',
    };
  }

  const result = await simple<null>('/api/push/subscribe', {
    method: 'POST',
    json: {
      endpoint,
      keys: { p256dh, auth },
      ...(wire.expirationTime === null || wire.expirationTime === undefined
        ? {}
        : { expirationTime: wire.expirationTime }),
    },
  });
  if (!result.ok) {
    // The browser holds a subscription the server refused. Drop it, so a person who retries
    // starts clean instead of re-posting a subscription the API just rejected.
    await subscription.unsubscribe();
    return { ok: false, reason: 'unavailable', message: result.error.message };
  }
  return { ok: true };
}

export type DisableOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** Retires the subscription server-side first, then in the browser. */
export async function disablePush(): Promise<DisableOutcome> {
  const registration = await navigator.serviceWorker.getRegistration('/a/');
  const subscription =
    registration === undefined ? null : await registration.pushManager.getSubscription();
  if (subscription === null) return { ok: true };

  const result = await simple<null>('/api/push/unsubscribe', {
    method: 'POST',
    json: { endpoint: subscription.endpoint },
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  await subscription.unsubscribe();
  return { ok: true };
}

/**
 * The state a surface renders from, read once on mount: blocked (the person already said no, and
 * only the browser's settings can change that), subscribed (there is a live subscription), or
 * off (nothing yet — the "turn on" control).
 */
export type PushState = 'blocked' | 'subscribed' | 'off';

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return 'off';
  if (Notification.permission === 'denied') return 'blocked';
  const registration = await navigator.serviceWorker.getRegistration('/a/');
  const subscription =
    registration === undefined ? null : await registration.pushManager.getSubscription();
  return subscription === null ? 'off' : 'subscribed';
}
