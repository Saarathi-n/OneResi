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

const fetchCache = new Map<string, unknown>();

export function clearFetchCache(): void {
  fetchCache.clear();
}

export function useFetch<T>(path: string | null): Fetch<T> {
  const [fetchState, setFetchState] = useState<FetchState<T>>(() => {
    if (path !== null && fetchCache.has(path)) {
      return { state: 'ready', data: fetchCache.get(path) as T };
    }
    return { state: 'loading' };
  });
  const attempt = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const current = (attempt.current += 1);
    // If not in cache, show loading skeleton; otherwise keep showing cached data while revalidating
    if (!fetchCache.has(path)) {
      setFetchState({ state: 'loading' });
    }
    void (async () => {
      const result = await call<T>(path);
      if (attempt.current !== current) return;
      if (result.ok) {
        fetchCache.set(path, result.data);
        setFetchState({ state: 'ready', data: result.data });
      } else {
        setFetchState({ state: 'failed', error: result.error });
      }
    })();
  }, [path]);

  const reload = useCallback(() => {
    if (path === null) return;
    const current = (attempt.current += 1);
    void (async () => {
      const result = await call<T>(path);
      if (attempt.current !== current) return;
      if (result.ok) {
        fetchCache.set(path, result.data);
        setFetchState({ state: 'ready', data: result.data });
      } else {
        setFetchState({ state: 'failed', error: result.error });
      }
    })();
  }, [path]);

  return { state: fetchState, reload };
}
