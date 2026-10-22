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
 *  - Content-hashed HD files (models/*.glb?v=<hash>, textures/*.webp?v=<hash>) live in their own cache
 *    ("rh-content-v1") that survives updates: an update never re-downloads the ~40 MB of models and textures,
 *    and a new version of a file replaces the old one.
 *  - Only complete, same-origin 200 responses are stored: never errors, opaque or partial responses, nor an
 *    HTML page answering an asset URL (a host's SPA fallback for a missing file).
 *  - The player's language (the page reports it: LANG) is remembered across builds, so an update also precaches
 *    that language's catalogue chunk (and, for Chinese, the CJK font): an offline start after an update stays in
 *    that language. Other languages load on demand only.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'v1';
const PREFIX = 'red-horizon-';
const CACHE = PREFIX + VERSION;
const SCOPE = self.registration.scope; // ends with '/'
const INDEX = new URL('index.html', SCOPE).href;
const FONTS = ['rajdhani-500', 'rajdhani-600', 'rajdhani-700', 'share-tech-mono-400', 'tektur-cyrillic'].map((f) => `fonts/${f}.woff2`);
/** Fonts precached only for the language that needs them (big: loaded on demand otherwise). */
const LANG_FONTS = { 'zh-CN': ['fonts/noto-sans-sc-subset.woff2'] };
/** Small preferences that outlive a build's cache (the language). */
const PREFS = 'rh-prefs-v1';
const LANG_KEY = new URL('__rh/lang', SCOPE).href;
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;
const SHELL = ['', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/icon.svg', ...FONTS]
  .map((p) => new URL(p, SCOPE).href);
/** Font cache left by older builds that loaded web fonts from a CDN (fonts are self-hosted); deleted on activate. */
const LEGACY_CACHES = ['rh-fonts-v1'];
const ASSET_RE = /\.(?:js|mjs|css|wasm|png|jpe?g|webp|avif|gif|svg|ico|json|webmanifest|woff2?|ttf|mp3|ogg|wav|glb)$/i; // glb: baked models (public/models), runtime cache-first

const sameOrigin = (u) => { try { return new URL(u, SCOPE).origin === self.location.origin; } catch { return false; } };
/** Keys are plain URLs; hosts often send `Vary: Origin` and module scripts are CORS requests, so ignore Vary. */
const MATCH = { ignoreVary: true };
const CONTENT = 'rh-content-v1';
/** A content-hashed HD file (kept across updates in CONTENT). */
const isContent = (u) => { try { const url = new URL(u, SCOPE); return url.searchParams.has('v') && /\.(?:glb|webp)$/i.test(url.pathname); } catch { return false; } };
/** HTML is only ever the page itself; anything else answered with HTML is a host's fallback page, not the file. */
const htmlOk = (u) => { try { return /(?:\.html?|\/)$/i.test(new URL(u, SCOPE).pathname); } catch { return false; } };
const cacheable = (res, url) => !!res && res.ok && res.status === 200 && (res.type === 'basic' || res.type === 'default')
  && (!url || htmlOk(url) || !/text\/html/i.test(res.headers.get('content-type') || ''));

/** Store a response; a content file replaces the older versions of itself (same path, another ?v=). */
async function store(cache, key, res) {
  if (isContent(key)) {
    const url = new URL(typeof key === 'string' ? key : key.url, SCOPE);
    for (const old of await cache.keys(url.origin + url.pathname, { ignoreSearch: true, ignoreVary: true })) if (old.url !== url.href) await cache.delete(old);
  }
  await cache.put(key, res);
}

/** Asset URLs referenced from an HTML page (src/href attributes). */
function htmlRefs(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)) {
    const u = new URL(m[1], base);
    if (u.origin === self.location.origin && ASSET_RE.test(u.pathname)) out.add(u.href);
  }
  return [...out];
}

/**
 * Asset URLs referenced from a JS/CSS bundle (string literals and url(...) pointing into assets/). Vite lists a lazy
 * chunk's files relative to the app's base ("assets/results-<hash>.js"), not to the chunk that mentions them: resolved
 * against the chunk, they became assets/assets/... (404s), so chunks the page had not loaded yet (the results
 * screen, the locker, clips) were missing offline. Paths starting with ./, ../ or / keep resolving against the file.
 */
function bundleRefs(text, base) {
  const out = new Set();
  for (const m of text.matchAll(/["'`(]((?:\.{0,2}\/)?(?:[\w.-]+\/)*assets\/[\w.@-]+\.[a-z0-9]+)["'`)]/gi)) {
    try {
      const u = new URL(m[1], /^\.{0,2}\//.test(m[1]) ? base : SCOPE);
      if (u.origin === self.location.origin && ASSET_RE.test(u.pathname)) out.add(u.href);
    } catch { /* not a URL */ }
  }
  return [...out];
}

/** Fetch `urls` into `cache` (skipping ones already there); follows JS/CSS references one level deep. */
async function cacheAll(cache, urls, depth = 1) {
  const nested = [];
  const content = await caches.open(CONTENT);
  await Promise.all(urls.map(async (u) => {
    const c = isContent(u) ? content : cache;
    if (await c.match(u, MATCH)) return;
    try {
      const res = await fetch(u, { cache: 'no-cache', credentials: 'same-origin' });
      if (!cacheable(res, u)) return;
      if (depth > 0 && /\.(?:m?js|css)$/i.test(new URL(u).pathname)) nested.push(...bundleRefs(await res.clone().text(), u));
      await store(c, u, res);
    } catch { /* offline or 404: best effort */ }
  }));
  if (nested.length) await cacheAll(cache, nested.filter((u) => !urls.includes(u)), depth - 1);
}

/** The language's catalogue chunk in a bundle's text: the lazy import `./<lang>-<8-char hash>.js` (src/i18n/core.ts). */
function localeChunk(text, lang) {
  if (!LANG_RE.test(lang) || lang === 'en') return null;
  const m = new RegExp(`["'\`]\\./(${lang}-[\\w-]{8}\\.js)["'\`]`).exec(text);
  return m ? m[1] : null;
}

async function storedLang() {
  try {
    const r = await (await caches.open(PREFS)).match(LANG_KEY);
    const l = r ? (await r.text()).trim() : '';
    return LANG_RE.test(l) ? l : '';
  } catch { return ''; }
}

/** Precache the remembered language's catalogue (found in the precached bundles) and its fonts. */
async function precacheLang(cache) {
  const lang = await storedLang();
  if (!lang || lang === 'en') return;
  const extra = (LANG_FONTS[lang] || []).map((p) => new URL(p, SCOPE).href);
  for (const req of await cache.keys()) {
    if (!/\/assets\/[^/]+\.js$/.test(new URL(req.url).pathname)) continue;
    const res = await cache.match(req);
    const file = res ? localeChunk(await res.text(), lang) : null;
    if (file) { extra.push(new URL(file, req.url).href); break; }
  }
  if (extra.length) await cacheAll(cache, extra, 0);
}

/** Fetch index.html, cache everything it needs, then (and only then) store the HTML itself. */
async function refreshShell(cache) {
  const res = await fetch(INDEX, { cache: 'no-cache', credentials: 'same-origin' });
  if (!cacheable(res, INDEX)) throw new Error(`index.html: HTTP ${res.status}`);
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
    await precacheLang(cache).catch(() => {});
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
  else if (data.type === 'LANG' && typeof data.lang === 'string' && LANG_RE.test(data.lang)) {
    event.waitUntil(caches.open(PREFS).then((c) => c.put(LANG_KEY, new Response(data.lang))).catch(() => {}));
  }
  else if (data.type === 'CACHE_URLS' && Array.isArray(data.urls)) {
    const urls = data.urls.filter((u) => typeof u === 'string' && sameOrigin(u) && ASSET_RE.test(new URL(u, SCOPE).pathname));
    event.waitUntil(caches.open(CACHE).then((c) => cacheAll(c, urls.map((u) => new URL(u, SCOPE).href), 0)));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(isContent(request.url) ? CONTENT : CACHE);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res, request.url)) store(cache, request, res.clone()).catch(() => {});
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
    if (cacheable(res, req.url) && new URL(req.url).pathname.endsWith('.html')) cache.put(new URL(req.url).pathname, res.clone()).catch(() => {});
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
