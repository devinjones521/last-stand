// ---------------------------------------------------------------------------
// Service worker: makes the game fully playable offline once it's been opened.
//
// Bump CACHE whenever you ship changed files, or clients will keep serving the
// old bundle. Note main.js deliberately does NOT register this on localhost, so
// local development never fights a stale cache.
// ---------------------------------------------------------------------------

const CACHE = 'laststand-v5';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/main.js',
  './src/config.js',
  './src/game.js',
  './src/render.js',
  './src/ui.js',
  './src/audio.js',
  './src/towers.js',
  './src/enemies.js',
  './src/waves.js',
  './src/pathfinding.js',
  './src/research.js',
  './src/viewport.js',
  './src/tutorial.js',
  './src/maps.js',
  './fonts/bigshoulders-800.woff2',
  './fonts/barlow-400.woff2',
  './fonts/barlow-600.woff2',
  './fonts/plexmono-500.woff2',
  './icons/icon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Individual misses shouldn't abort the whole install.
      .then((cache) => Promise.allSettled(ASSETS.map((a) => cache.add(a))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Save a good response into the cache without blocking the response. */
function stash(request, res) {
  if (res && res.status === 200 && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return res;
}

/** Network first, cache only as the offline fallback. */
function fresh(event, fallbackKey) {
  event.respondWith(
    fetch(event.request)
      .then((res) => stash(fallbackKey ?? event.request, res))
      .catch(() => caches.match(fallbackKey ?? event.request)
        .then((r) => r ?? caches.match('./'))),
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Navigations: try the network first so a deployed update lands promptly,
  // but fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    fresh(event, './index.html');
    return;
  }

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isAppCode = sameOrigin && /\/src\/.*\.(js|css)$/.test(url.pathname);

  // App code goes network-first for the same reason the shell does, and it has
  // to match the shell's strategy or a deploy serves NEW index.html against an
  // OLD cached bundle for one load. That mismatch is invisible until the day
  // the markup and the code actually disagree, so they move together.
  if (isAppCode) {
    fresh(event);
    return;
  }

  // Fonts, icons and the manifest never change without a filename change, so
  // they stay cache-first: instant, and refreshed quietly in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => stash(request, res)).catch(() => cached);
      return cached ?? network;
    }),
  );
});
