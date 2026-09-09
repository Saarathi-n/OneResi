'use client';

import { useEffect, useRef } from 'react';

/**
 * Interval polling that pauses while the tab is hidden — a live surface that keeps hammering the
 * API from a phone in a pocket is a battery problem, not a freshness win. Used for the waiting
 * visitor list, where the route map's SSE wrapper is not reachable from an EventSource that
 * cannot attach a Bearer header; polling the underlying endpoint is the documented alternative.
 */
export function usePolling(
  callback: () => void,
  intervalMs: number,
  options: { readonly enabled?: boolean } = {},
): void {
  const saved = useRef(callback);
  saved.current = callback;
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') saved.current();
    }, intervalMs);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') saved.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, enabled]);
}
