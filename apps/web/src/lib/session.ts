'use client';

import type { PersonView } from '@grihaone/domain';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The client's session: the access token in memory only (the route map's "Tokens" rule), the
 * refresh token an httpOnly cookie neither this code nor the page can read. Every request goes
 * through `call()` so a 401 triggers one silent refresh and one retry, not a redirect loop.
 */

interface StoredSession {
  accessToken: string;
  person: PersonView;
  accessExpiresAt: string;
}

type Listener = (person: PersonView | null) => void;

const SESSION_KEY = 'grihaone.active.session';

function hydrateFromStorage(): void {
  if (typeof window === 'undefined') return;
  if (accessToken !== null) return;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(raw) as StoredSession;
    if (session.accessExpiresAt && new Date(session.accessExpiresAt).getTime() > Date.now()) {
      accessToken = session.accessToken;
      person = session.person;
    } else {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

// Module state first, the hydration call after: hydrateFromStorage() writes these at module
// load, and a `let` read before its declaration is the temporal dead zone — the error that
// took the sign-in page down in the production bundle (dev mode only warned).
let accessToken: string | null = null;
let person: PersonView | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<Listener>();

// Hydrate immediately upon script execution
hydrateFromStorage();

function notify(): void {
  for (const listener of listeners) listener(person);
}

export function onSessionChange(listener: Listener): () => void {
  hydrateFromStorage();
  listeners.add(listener);
  listener(person);
  return () => {
    listeners.delete(listener);
  };
}

export function currentPerson(): PersonView | null {
  hydrateFromStorage();
  return person;
}

/** Role destination on sign-in and at the shells: R home, A desk, S gate. */
export function roleHome(role: PersonView['role']): string {
  if (role === 'A') return '/desk';
  if (role === 'S') return '/gate';
  return '/home';
}

/** Signs the person in: stores the access token in memory, the person for the shell. */
export function adoptSession(session: StoredSession): void {
  accessToken = session.accessToken;
  person = session.person;
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage write issues
  }
  notify();
}

function dropSession(): void {
  accessToken = null;
  person = null;
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Ignore
  }
  notify();
}

/** One silent refresh attempt. True when a new access token arrived. */
async function tryRefresh(): Promise<boolean> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    dropSession();
    return false;
  }
  const session = (await response.json()) as StoredSession;
  adoptSession(session);
  return true;
}

export function refresh(): Promise<boolean> {
  refreshInFlight ??= tryRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Error shape every endpoint returns on failure. */
export interface ApiError {
  code: string;
  message: string;
  field?: string;
  fields?: string[];
}

export type CallResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/**
 * The one fetch wrapper. Attaches the Bearer token, and on a 401 performs one silent refresh and
 * one retry — a 15-minute access token must not sign a person out mid-session.
 */
export async function call<T>(
  path: string,
  init: RequestInit & { json?: unknown; retried?: boolean } = {},
): Promise<CallResult<T>> {
  hydrateFromStorage();
  const headers = new Headers(init.headers);
  if (accessToken !== null) headers.set('authorization', `Bearer ${accessToken}`);
  if (init.json !== undefined) headers.set('content-type', 'application/json');

  const { json: _json, retried: _retried, ...rest } = init;
  void _json;
  void _retried;
  const requestInit: RequestInit = {
    ...rest,
    headers,
    credentials: 'include',
    ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
  };
  const response = await fetch(path, requestInit);

  if (response.status === 401 && !init.retried && path !== '/api/auth/refresh') {
    const refreshed = await refresh();
    if (refreshed) {
      return call<T>(path, { ...init, retried: true });
    }
    return { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in again.' } };
  }

  if (!response.ok) {
    let error: ApiError = {
      code: 'UNAUTHENTICATED',
      message: 'Something went wrong on our side. Please try again.',
    };
    try {
      error = (await response.json()) as ApiError;
    } catch {
      // The body was not the error shape; the fallback stands.
    }
    return { ok: false, error };
  }

  const text = await response.text();
  if (text.length === 0) {
    return { ok: true, data: undefined as T };
  }
  return { ok: true, data: JSON.parse(text) as T };
}

/**
 * The headers `call()` would attach, for the one place that needs the raw Response rather than
 * parsed JSON: a file download. Returns null when there is no session — the caller's 401 path
 * is the sign-in redirect, the same event `call()` produces.
 */
export function authHeaders(): Record<string, string> | null {
  if (accessToken === null) return null;
  return { authorization: `Bearer ${accessToken}` };
}

/** Loads the session at mount from the refresh cookie. Null when there is nobody. */
export async function loadSession(): Promise<PersonView | null> {
  hydrateFromStorage();
  if (person !== null && accessToken !== null) {
    return person;
  }
  const ok = await refresh();
  return ok ? person : null;
}

export async function signIn(
  email: string,
  password: string,
): Promise<CallResult<PersonView>> {
  const result = await call<StoredSession>('/api/auth/sign-in', {
    method: 'POST',
    json: { email, password },
  });
  if (result.ok) {
    adoptSession(result.data);
    return { ok: true, data: result.data.person };
  }
  return result;
}

export async function signOut(): Promise<void> {
  await call<null>('/api/auth/sign-out', { method: 'POST' });
  dropSession();
}

/**
 * Gates a client shell: resolves the session once on mount, redirects to sign-in when nobody is
 * there, and answers the role the caller requires. Returns `unresolved` while the cookie round
 * trip is in flight so the shell can hold its skeleton without flashing a redirect.
 */
export type Guarded =
  | { state: 'unresolved' }
  | { state: 'signed-out' }
  | { state: 'signed-in'; person: PersonView };

export function useGuardedSession(requiredRole?: 'COMMITTEE'): Guarded {
  const router = useRouter();
  const [guarded, setGuarded] = useState<Guarded>(() => {
    const existing = currentPerson();
    if (existing) {
      if (requiredRole === 'COMMITTEE' && existing.role !== 'A') {
        return { state: 'signed-out' };
      }
      return { state: 'signed-in', person: existing };
    }
    return { state: 'unresolved' };
  });

  useEffect(() => {
    if (person) {
      if (requiredRole === 'COMMITTEE' && person.role !== 'A') {
        setGuarded({ state: 'signed-out' });
        router.replace('/home');
        return;
      }
      setGuarded({ state: 'signed-in', person });
      return;
    }

    let cancelled = false;
    void (async () => {
      const who = await loadSession();
      if (cancelled) return;
      if (who === null) {
        setGuarded({ state: 'signed-out' });
        router.replace('/sign-in');
        return;
      }
      if (requiredRole === 'COMMITTEE' && who.role !== 'A') {
        setGuarded({ state: 'signed-out' });
        router.replace('/home');
        return;
      }
      setGuarded({ state: 'signed-in', person: who });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, requiredRole]);

  return guarded;
}

/** The person, synchronously, for components inside a shell that already resolved it. */
export function usePerson(): PersonView | null {
  const [who, setWho] = useState<PersonView | null>(person);
  useEffect(() => onSessionChange(setWho), []);
  return who;
}
