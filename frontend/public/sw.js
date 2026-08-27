// YPJ KK Inventory — Service Worker
// Strategy:
//   /api/*                 → Network-first (always fresh data; fall back to nothing)
//   navigation (HTML shell) → Network-first (always the latest deploy; cache is only an offline fallback)
//   everything else         → Cache-first (JS/CSS/images — Vite content-hashes these filenames,
//                             so a given URL is immutable and safe to cache aggressively)

const CACHE = 'ypj-inv-v12';

const PRECACHE = [
  '/',
  '/manifest.json',
];

// ── Install: pre-cache the app shell ────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ───────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Always go to network for API calls (don't cache dynamic data)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(request).catch(() => new Response(
      JSON.stringify({ error: 'You are offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  // Network-first for the HTML shell so every deploy is visible immediately —
  // cache-first here is what caused stale UI after past updates.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(response => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('/')))
    );
    return;
  }

  // Cache-first for everything else (content-hashed JS/CSS, icons, manifest)
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // Only cache successful GET responses
        if (request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: serve the app shell so React Router still works
        return caches.match('/');
      });
    })
  );
});
