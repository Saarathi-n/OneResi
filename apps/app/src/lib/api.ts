import type { SessionWire } from './types';

/**
 * The one fetch wrapper this app makes requests through. Every rule the route map states for the
 * client lives here, once:
 *
 *   - every request carries `credentials: 'include'`, because dev is cross-origin (the API is
 *     port 3000, this app is 3001) and the refresh token is an httpOnly cookie
 *   - the access token is held in a module variable only — never localStorage, never a cookie
 *     this script can read — and attached as `Authorization: Bearer`
 *   - a 401 performs ONE silent refresh and ONE retry. The refresh itself is single-flight: a
 *     burst of expired-token requests shares one round trip instead of racing
 *   - failures come back as the shared error shape `{ code, message, field? }`, never as a
 *     thrown exception the caller has to remember to catch
 */

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
  readonly fields?: string[];
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** Error used when the network never answered — the caller decides whether to queue the write. */
export interface NetworkFailure {
  readonly kind: 'network';
}

export type CallOutcome<T> = ApiResult<T> | { ok: false; error: ApiError; network: true };

/**
 * Where the API lives. Dev: the sibling @oneresi/web app on port 3000, cross-origin. Prod: the
 * same container, same origin, served beside this app under /a/ — so an empty base. Set
 * NEXT_PUBLIC_API_BASE to override either.
 */
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_BASE ??
  (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '');

/** The origin pages and receipts live on — links to the receipt route in prod are same-origin. */
export function webOrigin(): string {
  if (API_BASE !== '') return API_BASE;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

// ---------------------------------------------------------------- token plumbing

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

/** True when a request has already been retried after a refresh, so it never loops. */
const retried = new WeakSet<object>();

type DropListener = () => void;
const dropListeners = new Set<DropListener>();

/** The session layer subscribes to this to route to sign-in the moment a refresh fails. */
export function onSessionDropped(listener: DropListener): () => void {
  dropListeners.add(listener);
  return () => {
    dropListeners.delete(listener);
  };
}

function dropSession(): void {
  accessToken = null;
  for (const listener of dropListeners) listener();
}

/** Called by the session layer after sign-in, refresh, or bootstrap hands back a session. */
export function adoptSession(session: SessionWire): void {
  accessToken = session.accessToken;
}

export function clearAccessToken(): void {
  accessToken = null;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      dropSession();
      return false;
    }
    const session = (await response.json()) as SessionWire;
    adoptSession(session);
    return true;
  } catch {
    // Offline, or the API is down: the cookie may still be perfectly good. Keep the person
    // signed in rather than dumping them at a sign-in screen for a network blip.
    return false;
  }
}

function refresh(): Promise<boolean> {
  refreshInFlight ??= tryRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// ---------------------------------------------------------------- the call

export interface CallInit {
  readonly method?: string;
  readonly json?: unknown;
  readonly signal?: AbortSignal;
}

/**
 * Performs one request. Network-level failures (fetch rejects) come back as
 * `{ ok: false, error, network: true }` so offline-aware callers can queue the write; everything
 * else is the API's own error shape.
 */
export async function call<T>(path: string, init: CallInit = {}): Promise<CallOutcome<T>> {
  const headers: Record<string, string> = {};
  if (accessToken !== null) headers.authorization = `Bearer ${accessToken}`;
  if (init.json !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
      credentials: 'include',
      headers,
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
      ...(init.signal !== undefined ? { signal: init.signal } : {}),
    });
  } catch {
    return {
      ok: false,
      error: { code: 'NETWORK', message: 'You appear to be offline. Check your connection.' },
      network: true,
    };
  }

  if (
    response.status === 401 &&
    !retried.has(init) &&
    path !== '/api/auth/refresh' &&
    path !== '/api/auth/sign-out'
  ) {
    const refreshed = await refresh();
    if (refreshed) {
      retried.add(init);
      const retriedCall = await call<T>(path, init);
      retried.delete(init);
      return retriedCall;
    }
    return {
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: 'Please sign in again.' },
    };
  }

  if (!response.ok) {
    let error: ApiError = {
      code: `HTTP_${response.status}`,
      message: 'Something went wrong on our side. Please try again.',
    };
    try {
      error = (await response.json()) as ApiError;
    } catch {
      // Not the error shape; the fallback stands.
    }
    return { ok: false, error };
  }

  const text = await response.text();
  if (text.length === 0) return { ok: true, data: undefined as T };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return {
      ok: false,
      error: { code: 'HTTP_200_NOT_JSON', message: 'The response could not be read.' },
    };
  }
}

/** Strips the `network` marker for callers that treat offline as an ordinary failure. */
export async function simple<T>(path: string, init: CallInit = {}): Promise<ApiResult<T>> {
  const outcome = await call<T>(path, init);
  return outcome.ok ? outcome : { ok: false, error: outcome.error };
}

// ---------------------------------------------------------------- photo upload

/**
 * One complaint photo, as multipart — the only request the app makes that is not JSON. Validation
 * lives on the server (type and size per UC-06); the client only reports what it refused. The
 * `already` count lets the server refuse a fourth photo before the form is submitted.
 */
export async function uploadPhoto(
  file: File,
  alreadyAttached: number,
): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  const headers: Record<string, string> = {};
  if (accessToken !== null) headers.authorization = `Bearer ${accessToken}`;
  const body = new FormData();
  body.set('photo', file);
  body.set('already', String(alreadyAttached));

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/complaints/photos/upload`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body,
    });
  } catch {
    return { ok: false, message: 'You appear to be offline. Check your connection.' };
  }

  if (response.ok) {
    const data = (await response.json()) as { key: string };
    return { ok: true, key: data.key };
  }
  const error = (await response.json().catch(() => null)) as { message?: string } | null;
  return { ok: false, message: error?.message ?? 'That photo could not be attached.' };
}

/** The URL a stored photo key renders at. */
export function photoUrl(key: string): string {
  return `${API_BASE}/api/complaints/photos/file?key=${encodeURIComponent(key)}`;
}
