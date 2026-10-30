// Loading and data use: the service worker's cache rules, the connection gate on background downloads, and the
// shape of the initial bundle (the menu must not pull in three.js or the battle code).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { backgroundDownloadBlocker, backgroundDownloadsAllowed } from '../src/platform/network';

const root = path.resolve(import.meta.dirname, '..');

/** public/sw.js evaluated in a sandbox with a fake worker scope; its top-level functions are the context's globals. */
function loadSw(): Record<string, any> {
  const ctx: Record<string, any> = {
    URL, Response, Headers, Request, console,
    self: { location: { href: 'https://game.example/sw.js?v=index-abc', origin: 'https://game.example' }, registration: { scope: 'https://game.example/' }, addEventListener() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(root, 'public/sw.js'), 'utf8') + '\n;globalThis.__sw = { cacheable, isContent, htmlOk, localeChunk, SHELL, LANG_FONTS };', ctx);
  return ctx.__sw;
}

describe('service worker cache rules', () => {
  const sw = loadSw();
  const res = (body: string, init: ResponseInit & { type?: string } = {}) => {
    const r = new Response(body, { status: init.status ?? 200, headers: init.headers });
    if (init.type) Object.defineProperty(r, 'type', { value: init.type });
    return r;
  };
  test('stores complete same-origin responses only', () => {
    assert.equal(sw.cacheable(res('x', { headers: { 'content-type': 'text/javascript' } }), 'https://game.example/assets/index-1.js'), true, 'a script is stored');
    assert.equal(sw.cacheable(res('x', { status: 404 }), 'https://game.example/models/a.glb'), false, 'an error is not');
    assert.equal(sw.cacheable(res('x', { status: 206 }), 'https://game.example/models/a.glb'), false, 'a partial response is not');
    assert.equal(sw.cacheable(res('x', { type: 'opaque' }), 'https://game.example/models/a.glb'), false, 'an opaque response is not');
    assert.equal(sw.cacheable(res('x', { type: 'cors' }), 'https://game.example/models/a.glb'), false, 'a CORS response is not');
    assert.equal(sw.cacheable(null, 'https://game.example/'), false, 'no response is not');
  });
  test('an HTML fallback page never stands in for an asset', () => {
    const html = { headers: { 'content-type': 'text/html; charset=utf-8' } };
    assert.equal(sw.cacheable(res('<!doctype html>', html), 'https://game.example/models/missing.glb?v=1'), false, 'SPA fallback for a model');
    assert.equal(sw.cacheable(res('<!doctype html>', html), 'https://game.example/assets/gone-123.js'), false, 'SPA fallback for a chunk');
    assert.equal(sw.cacheable(res('<!doctype html>', html), 'https://game.example/index.html'), true, 'the page itself');
    assert.equal(sw.cacheable(res('<!doctype html>', html), 'https://game.example/'), true, 'the scope root');
    assert.equal(sw.cacheable(res('<!doctype html>', html), 'https://game.example/dev/preview-models.html'), true, 'another page');
  });
  test('an update precaches the remembered language only', () => {
    const glob = 'Object.assign({"./locales/de.json":()=>y(()=>import(`./de-C2kHNqu_.js`),[]),"./locales/pt-BR.json":()=>y(()=>import(`./pt-BR-CP2UcNjb.js`),[])';
    assert.equal(sw.localeChunk(glob, 'de'), 'de-C2kHNqu_.js', 'the German catalogue');
    assert.equal(sw.localeChunk(glob, 'pt-BR'), 'pt-BR-CP2UcNjb.js', 'a region tag');
    assert.equal(sw.localeChunk('import(`./debug-Dup4p-jU.js`)', 'de'), null, 'not a chunk that merely starts with the tag');
    assert.equal(sw.localeChunk(glob, 'en'), null, 'English is built in');
    assert.equal(sw.localeChunk(glob, 'x"); alert(1); ("'), null, 'a malformed tag is ignored');
    assert.ok(sw.SHELL.some((u: string) => u.endsWith('/fonts/tektur-cyrillic.woff2')), 'the small Cyrillic font is in the shell');
    assert.ok(!sw.SHELL.some((u: string) => u.includes('noto-sans-sc')), 'the CJK font is not');
    assert.deepEqual([...sw.LANG_FONTS['zh-CN']], ['fonts/noto-sans-sc-subset.woff2'], 'the CJK font goes with Chinese');
  });
  test('content-hashed HD files go to the cache that survives updates', () => {
    assert.equal(sw.isContent('https://game.example/models/2tnk.allies.glb?v=4989f61247'), true, 'versioned model');
    assert.equal(sw.isContent('https://game.example/textures/terrain/asphalt.albedo.webp?v=72e89a84f4'), true, 'versioned texture');
    assert.equal(sw.isContent('https://game.example/models/manifest.json'), false, 'manifests change with the build');
    assert.equal(sw.isContent('https://game.example/models/2tnk.allies.glb'), false, 'unversioned');
    assert.equal(sw.isContent('https://game.example/assets/index-1.js'), false, 'bundles stay in the build cache');
  });
});

describe('background downloads respect the connection', () => {
  test('Data Saver, slow and metered connections skip the prefetch', () => {
    assert.equal(backgroundDownloadsAllowed(null), true, 'no Network Information API: allowed');
    assert.equal(backgroundDownloadsAllowed({ effectiveType: '4g' }), true, '4g');
    assert.equal(backgroundDownloadBlocker({ effectiveType: '4g', saveData: true }), 'save-data', 'Data Saver');
    for (const t of ['slow-2g', '2g', '3g']) assert.equal(backgroundDownloadBlocker({ effectiveType: t }), 'slow', t);
    assert.equal(backgroundDownloadBlocker({ effectiveType: '4g', type: 'cellular' }), 'metered', 'cellular');
    assert.equal(backgroundDownloadBlocker({ effectiveType: '4g', metered: true }), 'metered', 'metered flag');
    assert.equal(backgroundDownloadsAllowed({ effectiveType: '4g', type: 'wifi' }), true, 'wifi');
  });
});

describe('offline prefetch', () => {
  test('waits for a fit connection, then hands the lists to the service worker', async () => {
    const posted: string[][] = [];
    const conn: Record<string, unknown> = { saveData: true, effectiveType: '4g' };
    const worker = { postMessage: (m: { type: string; urls: string[] }) => { if (m.type === 'CACHE_URLS') posted.push(m.urls); } };
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { connection: conn, serviceWorker: { controller: {}, ready: Promise.resolve({ active: worker }) } } });
    try {
      const { prefetchOffline } = await import('../src/platform/prefetch');
      prefetchOffline(async () => ['/models/a.glb?v=1'], 0);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(posted.length, 0, 'Data Saver: nothing prefetched');
      conn.saveData = false;
      prefetchOffline(async () => ['/textures/terrain/b.webp?v=2'], 0); // registered after the timer fired: goes at once
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(posted, [['/textures/terrain/b.webp?v=2']], 'a fit connection prefetches');
    } finally {
      if (prev) Object.defineProperty(globalThis, 'navigator', prev);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });
});

/** Static imports reachable from a module (no `import type`, no dynamic import()). */
function staticClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const walk = (f: string) => {
    if (seen.has(f)) return;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/^\s*(import|export)\s+(?!type\b)([^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
      if (m[1] === 'export' && !m[2]) continue;
      if (m[2] && /^\{\s*(type\s+\w+(\s+as\s+\w+)?\s*,?\s*)+\}\s*from\s+$/.test(m[2].trim() + ' ')) continue;
      const spec = m[3];
      if (spec === 'three' || spec.startsWith('three/')) { seen.add(`three:${f}`); continue; }
      if (!spec.startsWith('.')) continue;
      const b = path.resolve(path.dirname(f), spec);
      const hit = [b, `${b}.ts`, path.join(b, 'index.ts')].find((c) => existsSync(c) && statSync(c).isFile());
      if (hit) walk(hit);
    }
  };
  walk(path.join(root, entry));
  return seen;
}

describe('initial bundle', () => {
  const shell = staticClosure('src/main.ts');
  const rel = (f: string) => path.relative(root, f);
  test('the menu loads without three.js (the engine chunk brings it)', () => {
    const three = [...shell].filter((f) => f.startsWith('three:')).map((f) => rel(f.slice(6)));
    assert.deepEqual(three, [], `modules importing three.js statically from main.ts: ${three.join(', ')}`);
  });
  test('battle code stays out of the first menu frame', () => {
    for (const m of ['src/game.ts', 'src/render/renderer.ts', 'src/ui/hud.ts', 'src/ui/results.ts', 'src/ui/locker.ts', 'src/ui/profile.ts', 'src/share/attract.ts', 'src/replay/playback.ts', 'src/editor/index.ts']) {
      assert.ok(!shell.has(path.join(root, m)), `${m} is statically reachable from main.ts`);
    }
  });
});
