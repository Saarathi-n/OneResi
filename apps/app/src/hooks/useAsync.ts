'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError, ApiResult } from '../lib/api';

/**
 * The one data hook. Three states — loading, failed, ready — because a screen with a single
 * "not loaded" state hides the difference between a slow network and a dead one. The empty case
 * is the caller's: it knows what an empty list means, the hook does not.
 *
 * A reload is stale-while-revalidate: whatever the person is already looking at stays on screen
 * while the fresh answer travels, and `reloading` says that a background refresh is in flight.
 * Blank-then-content flaps are what make a pass code fade out and back for no reason.
 */

export type AsyncState<T> =
  | { state: 'loading' }
  | { state: 'failed'; error: ApiError }
  | { state: 'ready'; data: T };

export interface Async<T> {
  readonly state: AsyncState<T>;
  readonly reload: () => void;
  readonly ready: (data: T) => void;
  /** True while a refresh is in flight over data the person may already be seeing. */
  readonly reloading: boolean;
}

export function useAsync<T>(loader: () => Promise<ApiResult<T>>, deps: readonly unknown[]): Async<T> {
  const [state, setState] = useState<AsyncState<T>>({ state: 'loading' });
  const [reloading, setReloading] = useState(false);
  const attempt = useRef(0);
  // The loader is captured per run, so a closure over fresh props does not restart the effect —
  // `deps` is what decides.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const current = (attempt.current += 1);
    setState((previous) => (previous.state === 'ready' ? previous : { state: 'loading' }));
    setReloading(true);
    void (async () => {
      const result = await loaderRef.current();
      if (attempt.current !== current) return;
      setReloading(false);
      if (result.ok) {
        setState({ state: 'ready', data: result.data });
      } else {
        setState({ state: 'failed', error: result.error });
      }
    })();
    // The caller names the deps; the loader's own identity is deliberately not one of them, so
    // a closure over fresh props does not restart the request.
  }, deps);

  const reload = useCallback(() => {
    const current = (attempt.current += 1);
    setReloading(true);
    void (async () => {
      const result = await loaderRef.current();
      if (attempt.current !== current) return;
      setReloading(false);
      if (result.ok) {
        setState({ state: 'ready', data: result.data });
      } else {
        setState({ state: 'failed', error: result.error });
      }
    })();
  }, []);

  /** Replaces the ready data after a local mutation, without a round trip. */
  const ready = useCallback((data: T) => {
    attempt.current += 1;
    setReloading(false);
    setState({ state: 'ready', data });
  }, []);

  return { state, reload, ready, reloading };
}
