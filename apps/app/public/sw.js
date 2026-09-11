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

/*
 * Push. The payload is the three fields the server's push transport writes —
 * { title, body, path } — where `path` is a path, never a URL: the origin is this worker's
 * business, never the sender's guess, so a message cannot carry a link that points anywhere
 * but this app (D-22).
 */
self.addEventListener('push', (event) => {
  const payload = { title: 'OneResi', body: 'You have a new notification.', path: null };
  if (event.data !== null) {
    try {
      const parsed = event.data.json();
      if (typeof parsed === 'object' && parsed !== null) {
        if (typeof parsed.title === 'string' && parsed.title.length > 0) payload.title = parsed.title;
        if (typeof parsed.body === 'string' && parsed.body.length > 0) payload.body = parsed.body;
        if (typeof parsed.path === 'string') payload.path = parsed.path;
      }
    } catch {
      // Not JSON, or no data at all: the defaults above stand, because a push that shows
      // nothing is indistinguishable from one that never arrived.
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/a/icons/icon-192.png',
      badge: '/a/icons/icon-192.png',
      data: { path: payload.path },
    }),
  );
});

/*
 * A tap on the notification. If the app is already open, focus it and take it to the path the
 * message carried — focusing without navigating lands the resident on whatever screen they last
 * had open, which is rarely the screen the notification is about. Otherwise open the app at that
 * path (or its root when the message had none), which is why the path rides along in the
 * notification's `data`.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const path = event.notification.data && typeof event.notification.data.path === 'string'
    ? event.notification.data.path
    : '';
  const target = new URL('/a' + path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ('focus' in client) {
          await client.focus();
          // Navigating a client this SW controls reloads it at the target; one that cannot be
          // navigated (an uncontrolled window) keeps whatever it was showing.
          if (typeof client.navigate === 'function') {
            try {
              await client.navigate(target);
            } catch {
              /* not controlled by this worker; the focus above is the best available */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
