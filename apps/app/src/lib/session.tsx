'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type * as C from '@oneresi/contracts';
import { adoptSession, clearAccessToken, onSessionDropped, simple } from './api';
import type { PersonWire, SessionWire } from './types';

/**
 * The session context. The person object is in React state; the access token never is — it stays
 * in the api module's memory (the route map's token rule), and this layer only hears about the
 * person. Bootstrap is one `/api/auth/me` through `call()`, which silently refreshes on the 401
 * the first request always gets after a reload.
 */

export type SessionStatus =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'signed-in'; person: PersonWire };

interface SessionContextValue {
  readonly status: SessionStatus;
  /** Role destination on sign-in and on the entry page: R home, A desk, S gate. */
  readonly homeFor: (role: C.Role) => string;
  readonly signIn: (
    email: string,
    password: string,
  ) => Promise<{ ok: true; person: PersonWire } | { ok: false; error: string }>;
  readonly signOut: () => Promise<void>;
  /** Re-reads /api/auth/me after a change that the server may have made to the person. */
  readonly reloadPerson: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function roleHome(role: C.Role): string {
  if (role === 'A') return '/desk';
  if (role === 'S') return '/gate';
  return '/home';
}

export function SessionProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const router = useRouter();
  const [status, setStatus] = useState<SessionStatus>({ state: 'loading' });
  const booted = useRef(false);

  const loadMe = useCallback(async () => {
    const result = await simple<PersonWire>('/api/auth/me');
    if (result.ok) {
      setStatus({ state: 'signed-in', person: result.data });
    } else {
      clearAccessToken();
      setStatus({ state: 'signed-out' });
    }
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void loadMe();
  }, [loadMe]);

  // A refresh that failed mid-session (cookie expired or revoked) drops everyone to sign-in
  // without waiting for the next navigation to notice.
  useEffect(
    () =>
      onSessionDropped(() => {
        clearAccessToken();
        setStatus({ state: 'signed-out' });
      }),
    [],
  );

  const signIn = useCallback(
    async (
      email: string,
      password: string,
    ): Promise<{ ok: true; person: PersonWire } | { ok: false; error: string }> => {
      const result = await simple<SessionWire>('/api/auth/sign-in', {
        method: 'POST',
        json: { email, password },
      });
      if (!result.ok) return { ok: false, error: result.error.message };
      adoptSession(result.data);
      setStatus({ state: 'signed-in', person: result.data.person });
      return { ok: true, person: result.data.person };
    },
    [],
  );

  const signOut = useCallback(async () => {
    await simple<null>('/api/auth/sign-out', { method: 'POST' });
    clearAccessToken();
    setStatus({ state: 'signed-out' });
    router.replace('/sign-in');
  }, [router]);

  const reloadPerson = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      homeFor: roleHome,
      signIn,
      signOut,
      reloadPerson,
    }),
    [status, signIn, signOut, reloadPerson],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession requires a SessionProvider above it in the tree.');
  }
  return value;
}

/**
 * Gates a role shell. Loading holds a skeleton (never a flash of a redirect), a signed-out
 * person or the wrong role is routed away, and only then does the shell render its children.
 */
export type Guarded =
  | { state: 'loading' }
  | { state: 'redirecting' }
  | { state: 'ok'; person: PersonWire };

export function useRequireRole(role: C.Role): Guarded {
  const router = useRouter();
  const { status } = useSession();
  const [guarded, setGuarded] = useState<Guarded>({ state: 'loading' });
  const decided = useRef(false);

  useEffect(() => {
    if (status.state === 'loading' || decided.current) return;
    decided.current = true;
    if (status.state === 'signed-out') {
      setGuarded({ state: 'redirecting' });
      router.replace('/sign-in');
      return;
    }
    if (status.person.role !== role) {
      setGuarded({ state: 'redirecting' });
      router.replace(roleHome(status.person.role));
      return;
    }
    setGuarded({ state: 'ok', person: status.person });
  }, [status, role, router]);

  // A mid-session drop (refresh failed) leaves the guarded screen immediately.
  useEffect(() => {
    if (status.state === 'signed-out' && decided.current) {
      setGuarded({ state: 'redirecting' });
      router.replace('/sign-in');
    }
  }, [status, router]);

  return guarded;
}

/** The person, synchronously, for components inside a shell that already resolved it. */
export function usePerson(): PersonWire | null {
  const { status } = useSession();
  return status.state === 'signed-in' ? status.person : null;
}
