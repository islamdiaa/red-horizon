// Serve a relative-base build (default dist-itch/) from a sub-folder of a plain static server and check that
// the game boots there: no failed requests, fonts and HD models load, a match starts.
//   node tools/release/verify-subpath.mjs [dir=dist-itch] [prefix=/games/red-horizon/] [out.png]
// Runs headless Chromium (SwiftShader) and a static server on PORT (default 5278).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { root } from './relative-build.mjs';

const dir = path.resolve(root, process.argv[2] ?? 'dist-itch');
const prefix = process.argv[3] ?? '/games/red-horizon/';
const out = process.argv[4] ?? '/tmp/rh-subpath.png';
const PORT = +(process.env.PORT ?? 5278);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.txt': 'text/plain' };
const served = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  served.push(url.pathname);
  if (!url.pathname.startsWith(prefix)) { res.writeHead(404); res.end('outside the game folder'); return; }
  let rel = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(dir, rel);
  if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const base = `http://127.0.0.1:${PORT}${prefix}`;
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failed++; };
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
});
try {
  const page = await browser.newPage({ viewport: { width: +(process.env.W ?? 1280), height: +(process.env.H ?? 720) } });
  const bad = [], errors = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => bad.push(`failed ${r.url()}`));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}?autostart=1&q=${process.env.Q ?? "medium"}&hd=1&size=64&fog=0&intro=0&scenario=base`, { waitUntil: 'load', timeout: 60000 });
  const started = await page.waitForFunction(() => !!(window).__game?.world, null, { timeout: 90000 }).then(() => true, () => false);
  ok(started, 'a match starts from the sub-folder');
  // the loading screen fades once the battle's HD models are in (slow under SwiftShader)
  await page.waitForFunction(() => getComputedStyle(document.getElementById('loading')).display === 'none', null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const info = await page.evaluate(async () => {
    const faces = await Promise.all(['500 16px Rajdhani', '600 16px Rajdhani', '700 16px Rajdhani', '16px "Share Tech Mono"'].map((f) => document.fonts.load(f).then((l) => l.length, () => 0)));
    const hd = (window).__hdStatus?.() ?? null;
    const n = (v) => (Array.isArray(v) ? v.length : typeof v === 'number' ? v : -1);
    return { faces, hdLoaded: n(hd?.loaded), hdFailed: n(hd?.failed), base: document.baseURI };
  });
  ok(info.faces.every((n) => n > 0), `self-hosted fonts load (${info.faces.join(', ')} faces)`);
  ok(info.hdLoaded > 0 && info.hdFailed === 0, `HD models load (${info.hdLoaded} loaded, ${info.hdFailed} failed)`);
  const outside = served.filter((p) => !p.startsWith(prefix));
  ok(outside.length === 0, `every request stays inside ${prefix} ${outside.length ? JSON.stringify(outside.slice(0, 5)) : ''}`);
  ok(bad.length === 0, `no failed requests ${bad.length ? JSON.stringify(bad.slice(0, 5)) : ''}`);
  ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  await page.screenshot({ path: out });
  console.log(`saved ${out} (${served.length} requests, base ${info.base})`);
  // the service worker: scoped to the folder, precaching the shell under it
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 30000))]);
    if (!reg) return null;
    await new Promise((r) => setTimeout(r, 3000));
    const keys = await caches.keys();
    const urls = [];
    for (const k of keys) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname);
    return { scope: reg.scope, script: reg.active?.scriptURL ?? reg.installing?.scriptURL ?? '', urls };
  });
  ok(!!sw && sw.scope === base, `service worker scoped to the folder (${sw?.scope})`);
  ok(!!sw && sw.urls.length > 0 && sw.urls.every((u) => u.startsWith(prefix)), `precache stays inside the folder (${sw?.urls.length ?? 0} entries, e.g. ${sw?.urls.find((u) => u.endsWith('.woff2'))})`);
  // the main menu too (with the backdrop battle)
  await page.goto(base, { waitUntil: 'load' });
  const menu = await page.waitForFunction(() => !!document.querySelector('.mm-layout'), null, { timeout: 60000 }).then(() => true, () => false);
  ok(menu, 'the main menu opens from the sub-folder');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: out.replace(/\.png$/, '-menu.png') });
} finally {
  await browser.close();
  server.close();
}
process.exitCode = failed ? 1 : 0;
