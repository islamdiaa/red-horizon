/* Red Horizon service worker: offline play + instant start.
 *
 * Registered only in production builds by src/platform/pwa.ts as `sw.js?v=<build id>`.
 *  - One versioned cache per build ("red-horizon-<build id>"); older caches are deleted on activate.
 *  - install: precaches the app shell (index.html, manifest, icons, fonts) plus every same-origin asset
 *    index.html references, and the assets those JS/CSS bundles reference (worker chunks), so the
 *    game works offline right after the first visit.
 *  - fetch: same-origin GET only, cache-first. Page navigations are cache-first too, but revalidate
 *    in the background (the new index.html is only stored once all of its assets are cached, so an
 *    offline start never sees HTML whose bundles are missing). That background refresh is what makes
 *    the next load register the next build's worker.
 *  - A new build's worker waits until the page asks for SKIP_WAITING (pwa.ts applyUpdate) so assets
 *    are never swapped under a running match.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'v1';
const PREFIX = 'red-horizon-';
const CACHE = PREFIX + VERSION;
const SCOPE = self.registration.scope; // ends with '/'
const INDEX = new URL('index.html', SCOPE).href;
const FONTS = ['rajdhani-500', 'rajdhani-600', 'rajdhani-700', 'share-tech-mono-400'].map((f) => `fonts/${f}.woff2`);
const SHELL = ['', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/icon.svg', ...FONTS]
  .map((p) => new URL(p, SCOPE).href);
/** Cache of the Google Fonts era (fonts are self-hosted now); deleted on activate. */
const LEGACY_CACHES = ['rh-fonts-v1'];
const ASSET_RE = /\.(?:js|mjs|css|wasm|png|jpe?g|webp|avif|gif|svg|ico|json|webmanifest|woff2?|ttf|mp3|ogg|wav)$/i;

const sameOrigin = (u) => { try { return new URL(u, SCOPE).origin === self.location.origin; } catch { return false; } };
/** Keys are plain URLs; hosts often send `Vary: Origin` and module scripts are CORS requests, so ignore Vary. */
const MATCH = { ignoreVary: true };
const cacheable = (res) => res && res.ok && res.status === 200 && (res.type === 'basic' || res.type === 'default');

/** Asset URLs referenced from an HTML page (src/href attributes). */
function htmlRefs(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)) {
    const u = new URL(m[1], base);
    if (u.origin === self.location.origin && ASSET_RE.test(u.pathname)) out.add(u.href);
  }
  return [...out];
}

/** Asset URLs referenced from a JS/CSS bundle (string literals and url(...) pointing into assets/). */
function bundleRefs(text, base) {
  const out = new Set();
  for (const m of text.matchAll(/["'`(]((?:\.{0,2}\/)?(?:[\w.-]+\/)*assets\/[\w.@-]+\.[a-z0-9]+)["'`)]/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.origin === self.location.origin && ASSET_RE.test(u.pathname)) out.add(u.href);
    } catch { /* not a URL */ }
  }
  return [...out];
}

/** Fetch `urls` into `cache` (skipping ones already there); follows JS/CSS references one level deep. */
async function cacheAll(cache, urls, depth = 1) {
  const nested = [];
  await Promise.all(urls.map(async (u) => {
    if (await cache.match(u, MATCH)) return;
    try {
      const res = await fetch(u, { cache: 'no-cache', credentials: 'same-origin' });
      if (!cacheable(res)) return;
      if (depth > 0 && /\.(?:m?js|css)$/i.test(new URL(u).pathname)) nested.push(...bundleRefs(await res.clone().text(), u));
      await cache.put(u, res);
    } catch { /* offline or 404: best effort */ }
  }));
  if (nested.length) await cacheAll(cache, nested.filter((u) => !urls.includes(u)), depth - 1);
}

/** Fetch index.html, cache everything it needs, then (and only then) store the HTML itself. */
async function refreshShell(cache) {
  const res = await fetch(INDEX, { cache: 'no-cache', credentials: 'same-origin' });
  if (!cacheable(res)) throw new Error(`index.html: HTTP ${res.status}`);
  const html = await res.clone().text();
  await cacheAll(cache, htmlRefs(html, INDEX));
  await cache.put(INDEX, res.clone());
  await cache.put(new URL('', SCOPE).href, res);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cacheAll(cache, SHELL.filter((u) => u !== INDEX && u !== new URL('', SCOPE).href));
    await refreshShell(cache).catch(() => {});
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => (k.startsWith(PREFIX) && k !== CACHE) || LEGACY_CACHES.includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  else if (data.type === 'CACHE_URLS' && Array.isArray(data.urls)) {
    const urls = data.urls.filter((u) => typeof u === 'string' && sameOrigin(u) && ASSET_RE.test(new URL(u, SCOPE).pathname));
    event.waitUntil(caches.open(CACHE).then((c) => cacheAll(c, urls.map((u) => new URL(u, SCOPE).href), 0)));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) cache.put(request, res.clone()).catch(() => {});
  return res;
}

/** Navigations: serve the cached page instantly, refresh it (and its assets) in the background. */
async function navigate(event) {
  const cache = await caches.open(CACHE);
  const req = event.request;
  // any query string (?autostart=1, ...) maps to the same document
  const hit = (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) || (new URL(req.url).pathname === new URL(SCOPE).pathname ? await cache.match(INDEX, MATCH) : null);
  if (hit) {
    event.waitUntil(refreshShell(cache).catch(() => {}));
    return hit;
  }
  try {
    const res = await fetch(req);
    if (cacheable(res) && new URL(req.url).pathname.endsWith('.html')) cache.put(new URL(req.url).pathname, res.clone()).catch(() => {});
    return res;
  } catch {
    const fallback = await cache.match(INDEX, MATCH);
    if (fallback) return fallback;
    return new Response('<!doctype html><meta charset="utf-8"><title>Red Horizon</title><body style="background:#05070b;color:#e9f0f7;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0">You are offline and Red Horizon has not been cached yet. Connect once to install it.</body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the game makes no cross-origin requests; never intercept them
  if (url.pathname.endsWith('/sw.js') || req.headers.has('range')) return;
  if (req.mode === 'navigate') {
    event.respondWith(navigate(event));
    return;
  }
  event.respondWith(cacheFirst(req));
});
