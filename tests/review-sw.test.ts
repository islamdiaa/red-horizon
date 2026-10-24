// REVIEW round 5: public/sw.js with an update waiting. The active (old) worker serves a reload while a newer worker
// has installed and waits for SKIP_WAITING (applied on the main menu): its navigate() used to delete the waiting
// worker's precache, and the new worker, once active, never cached the shell again: every offline start showed the
// "not cached yet" page until the next deploy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SCOPE = 'https://game.example/';
const SW = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const stores = new Map<string, Map<string, string>>();
const res = (body: string, type = 'text/html') => ({ ok: true, status: 200, type: 'basic', headers: { get: (k: string) => (k === 'content-type' ? type : null) }, clone() { return res(body, type); }, text: async () => body });
const cacheOf = (m: Map<string, string>) => ({
  match: async (r: string | { url: string }) => { const k = typeof r === 'string' ? r : r.url; const u = new URL(k); const hit = m.get(k) ?? m.get(u.origin + u.pathname); return hit !== undefined ? res(hit) : undefined; },
  put: async (k: string | { url: string }, r: { text(): Promise<string> }) => { m.set(typeof k === 'string' ? k : k.url, await r.text()); },
  keys: async () => [...m.keys()].map((url) => ({ url })), delete: async (k: { url: string }) => m.delete(k.url),
});
const caches = {
  open: async (n: string) => { if (!stores.has(n)) stores.set(n, new Map()); return cacheOf(stores.get(n)!); },
  keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n),
  match: async (r: { url: string }) => { for (const m of stores.values()) if (m.has(r.url)) return res(m.get(r.url)!); return undefined; },
};
let online = true;
const fetchFn = async (r: string | { url: string }) => { if (!online) throw new TypeError('offline'); return res('<!doctype html>new build'); };
function worker(v: string, waiting?: string) {
  const reg = { scope: SCOPE, waiting: waiting ? { scriptURL: SCOPE + 'sw.js?v=' + waiting } : null, installing: null };
  const self = { registration: reg, location: new URL('sw.js?v=' + v, SCOPE), addEventListener() {}, clients: { claim: async () => {}, matchAll: async () => [{}] } };
  const ctx = vm.createContext({ self, URL, caches, console, fetch: fetchFn, Response: class { constructor(public b: string, public o: unknown) {} } });
  vm.runInContext(SW, ctx);
  return ctx as unknown as { navigate(e: unknown): Promise<{ text?(): Promise<string>; o?: { status: number } }>; dropOldCaches(): Promise<void> };
}
const nav = (url: string) => { const waits: Promise<unknown>[] = []; return { e: { request: { url, mode: 'navigate', headers: { has: () => false } }, waitUntil: (p: Promise<unknown>) => waits.push(p) }, done: () => Promise.all(waits) }; };

test('a reload while a newer worker waits must not delete the waiting worker\'s cache', async () => {
  stores.set('red-horizon-index-OLD', new Map([[SCOPE + 'index.html', 'old shell'], [SCOPE, 'old shell']]));
  stores.set('red-horizon-index-NEW', new Map([[SCOPE + 'index.html', 'new shell'], [SCOPE, 'new shell'], [SCOPE + 'assets/index-NEW.js', 'x']]));
  const old = worker('index-OLD', 'index-NEW'); // active; the new one installed and waits for SKIP_WAITING
  const n = nav(SCOPE);
  await old.navigate(n.e);
  await n.done();
  assert.ok(stores.has('red-horizon-index-NEW'), `the waiting worker's precache survives a reload (caches: ${[...stores.keys()].join(', ')})`);
});

test('after the update applies, an offline start still has the game', async () => {
  const neu = worker('index-NEW');
  await neu.dropOldCaches(); // (activate)
  online = true;
  const a = nav(SCOPE); await neu.navigate(a.e); await a.done(); // the reload that follows controllerchange
  online = false;
  const b = nav(SCOPE);
  const r = await neu.navigate(b.e);
  assert.ok(!(r as { o?: { status: number } }).o || (r as { o: { status: number } }).o.status !== 503, `offline start serves the game, not the 503 page (caches: ${[...stores.entries()].map(([k, m]) => `${k}[${[...m.keys()].length}]`).join(', ')})`);
});
