'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { call, type ApiError } from '@/lib/session';

/**
 * The one data hook the screens use. Three states — loading, failed, ready — because a screen
 * with a single "not loaded" state hides the difference between a slow network and a dead one
 * (04-product-design.md "Every screen that reads data has three states").
 */

export type FetchState<T> =
  | { state: 'loading' }
  | { state: 'failed'; error: ApiError }
  | { state: 'ready'; data: T };

export interface Fetch<T> {
  readonly state: FetchState<T>;
  readonly reload: () => void;
}

export function useFetch<T>(path: string | null): Fetch<T> {
  const [fetchState, setFetchState] = useState<FetchState<T>>({ state: 'loading' });
  const attempt = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const current = (attempt.current += 1);
    setFetchState((previous) =>
      previous.state === 'ready' ? previous : { state: 'loading' },
    );
    void (async () => {
      const result = await call<T>(path);
      if (attempt.current !== current) return;
      if (result.ok) {
        setFetchState({ state: 'ready', data: result.data });
      } else {
        setFetchState({ state: 'failed', error: result.error });
      }
    })();
  }, [path]);

  const reload = useCallback(() => {
    if (path === null) return;
    const current = (attempt.current += 1);
    setFetchState({ state: 'loading' });
    void (async () => {
      const result = await call<T>(path);
      if (attempt.current !== current) return;
      if (result.ok) {
        setFetchState({ state: 'ready', data: result.data });
      } else {
        setFetchState({ state: 'failed', error: result.error });
      }
    })();
  }, [path]);

  return { state: fetchState, reload };
}
