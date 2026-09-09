'use client';

import { useEffect } from 'react';

/**
 * Registers the app-shell service worker. In dev the worker is pointless and occasionally in the
 * way (a stale shell while iterating), so it only registers for production builds.
 */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = (): void => {
      void navigator.serviceWorker.register('/a/sw.js', { scope: '/a/' });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
