/**
 * The OneResi app-shell service worker. Hand-rolled and deliberately small — no workbox, no
 * dependency. It is served from /a/sw.js, so its scope ends at /a/: the website the container
 * also hosts never lands in this cache, and this app never caches the website.
 *
 * Strategy per request:
 *
 *   - `/api/auth/**`        NEVER cached. Not the response, not a fallback. Tokens and session
 *                           state must always be live.
 *   - other same-origin API network-first. A fresh answer is preferred; the last good answer is
 *                           the offline fallback, so the unit's dues, passes and notices are
 *                           readable with no network.
 *   - `/_next/static/**`    cache-first. Content-hashed, immutable by construction.
 *   - navigations           network-first, falling back to the cached shell — the app opens
 *                           offline to something real rather than a browser error page.
 *   - the precached shell   icons and the manifest.
 *   - anything cross-origin passes straight through (dev's API lives on port 3000).
 */

const VERSION = 'oneresi-app-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const STATIC_CACHE = `${VERSION}-static`;

const SHELL_ASSETS = [
  '/a/',
  '/a/manifest.webmanifest',
  '/a/icons/icon-192.png',
  '/a/icons/icon-512.png',
  '/a/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(new Request(asset, { cache: 'reload' }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

function isAuth(url) {
  return url.pathname.startsWith('/api/auth/');
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && request.method === 'GET') cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached !== undefined) return cached;
    return new Response(
      JSON.stringify({ code: 'OFFLINE', message: 'You are offline and this is not saved on your phone.' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached !== undefined) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // dev's cross-origin API: not ours to touch.
  if (isAuth(url)) return; // never cached, never faked.

  if (isApi(url)) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  if (url.pathname.startsWith('/a/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (url.pathname.startsWith('/a/icons/') || url.pathname === '/a/manifest.webmanifest') {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});
