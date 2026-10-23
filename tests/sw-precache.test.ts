// public/sw.js install precache, run against a small Vite-like build held in memory (fake fetch + Cache Storage).
// Offline play needs every code chunk the game can load, including lazy chunks that are only named relative to the
// chunk that imports them (`import("./dmath-<hash>.js")`) and chunks two or three imports deep; the language
// catalogues stay on demand, except the player's own language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SCOPE = 'https://game.example/';

/** A build: path -> body. Text bodies; the entry chunk lists, imports and maps chunks the way Vite emits them. */
function viteLikeBuild(): Record<string, string> {
  return {
    '/index.html': '<!doctype html><script type="module" crossorigin src="/assets/index-AAAAaaaa.js"></script><link rel="modulepreload" crossorigin href="/assets/ai-BBBBbbbb.js">',
    '/assets/index-AAAAaaaa.js': [
      'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/challenges-CCCCcccc.js","assets/index-x1Yz-9Qw.css"])))=>i.map(i=>d[i]);',
      'async function Fs(e){e&&!Ps&&(Ps=await p(()=>import(`./dmath-DDDDdddd.js`),[]))}', // a lazy chunk with no preload list
      'i(()=>import(`./challenges-CCCCcccc.js`),__vite__mapDeps([0,1]));',
    ].join('\n'),
    '/assets/ai-BBBBbbbb.js': 'function Le(e){return Object.assign({"./locales/de.json":()=>y(()=>import(`./de-EEEEeeee.js`),[]),"./locales/pt-BR.json":()=>y(()=>import(`./pt-BR-FFFF-fff.js`),[])})}',
    '/assets/index-x1Yz-9Qw.css': 'body{color:red}',
    '/assets/challenges-CCCCcccc.js': 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/leaderboard-GGGGgggg.js"])))=>i.map(i=>d[i]);i(()=>import(`./leaderboard-GGGGgggg.js`),__vite__mapDeps([0]));',
    '/assets/leaderboard-GGGGgggg.js': 'researchP??=m(async()=>{let{ResearchTree:e}=await import(`./research-HHHHhhhh.js`);return e})',
    '/assets/research-HHHHhhhh.js': 'export const tree=1;',
    '/assets/dmath-DDDDdddd.js': 'export const sin=Math.sin;',
    '/assets/de-EEEEeeee.js': 'export default {}',
    '/assets/pt-BR-FFFF-fff.js': 'export default {}',
  };
}

/** Install the worker over `files` (optionally with a remembered language); returns what it cached and fetched. */
async function install(files: Record<string, string>, lang?: string) {
  const stores = new Map<string, Map<string, string>>();
  const fetched: string[] = [];
  const res = (body: string, status: number, type: string) => ({
    ok: status === 200, status, type: 'basic', headers: { get: (k: string) => (k === 'content-type' ? type : null) },
    clone() { return res(body, status, type); }, text: async () => body,
  });
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        match: async (u: string | { url: string }) => { const k = typeof u === 'string' ? u : u.url; return m.has(k) ? res(m.get(k)!, 200, '') : undefined; },
        put: async (k: string | { url: string }, r: { text(): Promise<string> }) => { m.set(typeof k === 'string' ? k : k.url, await r.text()); },
        keys: async () => [...m.keys()].map((url) => ({ url })),
        delete: async (k: { url: string }) => m.delete(k.url),
      };
    },
    keys: async () => [...stores.keys()],
  };
  const fetchFn = async (u: string | { url: string }) => {
    const p = new URL(typeof u === 'string' ? u : u.url).pathname;
    fetched.push(p);
    const body = files[p === '/' ? '/index.html' : p];
    return body === undefined ? res('<!doctype html>not found', 404, 'text/html') : res(body, 200, p.endsWith('.html') ? 'text/html' : 'text/javascript');
  };
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = { registration: { scope: SCOPE }, location: new URL('sw.js?v=index-AAAAaaaa', SCOPE), addEventListener: (t: string, f: (e: unknown) => void) => { listeners[t] = f; }, clients: { claim: async () => {} }, skipWaiting() {} };
  class Resp { constructor(private b: string) {} async text() { return this.b; } }
  const ctx = vm.createContext({ self, URL, caches, fetch: fetchFn, console, Response: Resp });
  vm.runInContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), ctx);
  if (lang) await (await caches.open('rh-prefs-v1')).put(new URL('__rh/lang', SCOPE).href, { text: async () => lang });
  let done: Promise<unknown> = Promise.resolve();
  listeners.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
  await done;
  const cached = [...(stores.get('red-horizon-index-AAAAaaaa')?.keys() ?? [])].map((u) => new URL(u).pathname);
  return { cached, fetched };
}

test('sw precache: every code chunk, also relative-only and nested lazy chunks (offline ranked runs)', async () => {
  const files = viteLikeBuild();
  const { cached, fetched } = await install(files);
  for (const f of ['/index.html', '/assets/index-AAAAaaaa.js', '/assets/ai-BBBBbbbb.js', '/assets/index-x1Yz-9Qw.css', '/assets/challenges-CCCCcccc.js'])
    assert.ok(cached.includes(f), `${f} precached (cached: ${cached.join(' ')})`);
  assert.ok(cached.includes('/assets/dmath-DDDDdddd.js'), `a lazy chunk named only as ./dmath-<hash>.js is precached (cached: ${cached.join(' ')})`);
  assert.ok(cached.includes('/assets/leaderboard-GGGGgggg.js'), 'a chunk two imports deep is precached');
  assert.ok(cached.includes('/assets/research-HHHHhhhh.js'), 'a chunk three imports deep is precached');
  assert.ok(!cached.includes('/assets/de-EEEEeeee.js') && !cached.includes('/assets/pt-BR-FFFF-fff.js'), `language catalogues stay on demand (cached: ${cached.join(' ')})`);
  const missing = fetched.filter((p) => files[p === '/' ? '/index.html' : p] === undefined && !/\.(png|svg|woff2|webmanifest)$/.test(p));
  assert.deepEqual(missing, [], 'no request for a file the build does not have (e.g. ./locales/de.json)');
  assert.equal(new Set(fetched).size, fetched.length, `each file is fetched once (${fetched.length} fetches)`);
});

test('sw precache: the remembered language\'s catalogue is added (a hyphenated code too)', async () => {
  const { cached } = await install(viteLikeBuild(), 'pt-BR');
  assert.ok(cached.includes('/assets/pt-BR-FFFF-fff.js'), `pt-BR catalogue precached (cached: ${cached.join(' ')})`);
  assert.ok(!cached.includes('/assets/de-EEEEeeee.js'), 'other catalogues stay on demand');
});

test('sw runtime: unhashed files are revalidated with the server before the build cache keeps them', async () => {
  const calls: { url: string; cache?: string }[] = [];
  const res = { ok: true, status: 200, type: 'basic', headers: { get: () => 'application/json' }, clone() { return res; }, text: async () => '{}' };
  const caches = { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => true }), keys: async () => [], match: async () => undefined };
  const self = { registration: { scope: SCOPE }, location: new URL('sw.js?v=index-AAAAaaaa', SCOPE), addEventListener() {}, clients: { claim: async () => {} } };
  const ctx = vm.createContext({ self, URL, caches, console, fetch: async (r: { url: string }, init?: { cache?: string }) => { calls.push({ url: new URL(r.url).pathname + new URL(r.url).search, cache: init?.cache }); return res; } });
  vm.runInContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), ctx);
  const cacheFirst = ctx.cacheFirst as (r: { url: string }) => Promise<unknown>;
  for (const p of ['models/manifest.json', 'fonts/noto-sans-sc-subset.woff2', 'assets/engine-AbCd1234.js', 'models/1tnk.allies.glb?v=abc123']) await cacheFirst({ url: SCOPE + p });
  const mode = Object.fromEntries(calls.map((c) => [c.url, c.cache ?? 'default']));
  assert.equal(mode['/models/manifest.json'], 'no-cache', `an unhashed manifest is revalidated (${JSON.stringify(mode)})`);
  assert.equal(mode['/fonts/noto-sans-sc-subset.woff2'], 'no-cache', 'a font (fixed name) is revalidated');
  assert.equal(mode['/assets/engine-AbCd1234.js'], 'default', 'hashed bundles use the HTTP cache as is');
  assert.equal(mode['/models/1tnk.allies.glb?v=abc123'], 'default', 'content-hashed HD files use the HTTP cache as is');
});

test('sw update: another tab still running the old build keeps its chunks until it is the only page left', async () => {
  const stores = new Map<string, Map<string, string>>([
    ['red-horizon-index-OLDold11', new Map([[SCOPE + 'assets/editor-OLDold11.js', 'old editor'], [SCOPE + 'models/manifest.json', 'old manifest']])],
    ['red-horizon-index-NEWnew22', new Map()],
    ['rh-fonts-v1', new Map()],
  ]);
  const res = (body: string) => ({ ok: true, status: 200, type: 'basic', headers: { get: () => 'text/javascript' }, clone() { return res(body); }, text: async () => body });
  const cacheOf = (m: Map<string, string>) => ({
    match: async (r: string | { url: string }) => { const k = typeof r === 'string' ? r : r.url; return m.has(k) ? res(m.get(k)!) : undefined; },
    put: async () => {}, keys: async () => [...m.keys()].map((url) => ({ url })), delete: async () => true,
  });
  const caches = {
    open: async (n: string) => { if (!stores.has(n)) stores.set(n, new Map()); return cacheOf(stores.get(n)!); },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (r: { url: string }) => { for (const m of stores.values()) if (m.has(r.url)) return res(m.get(r.url)!); return undefined; },
  };
  let windows = 2;
  const fetched: string[] = [];
  const self = { registration: { scope: SCOPE }, location: new URL('sw.js?v=index-NEWnew22', SCOPE), addEventListener() {}, clients: { claim: async () => {}, matchAll: async () => new Array(windows).fill({}) } };
  const ctx = vm.createContext({ self, URL, caches, console, fetch: async (r: { url: string }) => { fetched.push(new URL(r.url).pathname); return res('from network'); } });
  vm.runInContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), ctx);
  const cacheFirst = ctx.cacheFirst as (r: { url: string }) => Promise<{ text(): Promise<string> }>;
  const dropOldCaches = ctx.dropOldCaches as () => Promise<void>;
  await dropOldCaches();
  assert.ok(stores.has('red-horizon-index-OLDold11'), 'with two pages open, the old build\'s cache stays');
  assert.ok(!stores.has('rh-fonts-v1'), 'legacy caches go at once');
  assert.equal(await (await cacheFirst({ url: SCOPE + 'assets/editor-OLDold11.js' })).text(), 'old editor', 'an old page\'s lazy chunk comes from the old cache (the server no longer has it)');
  assert.equal(await (await cacheFirst({ url: SCOPE + 'models/manifest.json' })).text(), 'from network', 'an unhashed file is never taken from another build\'s cache');
  windows = 1;
  await dropOldCaches();
  assert.ok(!stores.has('red-horizon-index-OLDold11') && stores.has('red-horizon-index-NEWnew22'), `with one page left, only the current cache remains (${[...stores.keys()].join(', ')})`);
});
