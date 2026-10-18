// End-to-end PWA check: production build -> `vite preview` on :5191 -> headless Chromium.
// Verifies the manifest parses (CDP Page.getAppManifest / installability), the service worker
// installs, controls the page after a reload, precaches the bundles, and the game boots offline.
//   npm run verify:pwa
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(os.tmpdir(), 'rh-pwa-verify');
const PORT = +(process.env.PORT ?? 5191);
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };

await build({ root, logLevel: 'warn', build: { outDir, emptyOutDir: true } });

const server = await preview({ root, logLevel: 'warn', build: { outDir }, preview: { port: PORT, strictPort: true, host: '127.0.0.1' } });
const url = `http://127.0.0.1:${PORT}/`;
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url + '?demo=0', { waitUntil: 'load' });
  const cdp = await context.newCDPSession(page);
  const man = await cdp.send('Page.getAppManifest');
  ok(!!man.url && man.url.endsWith('/manifest.webmanifest'), `manifest linked (${man.url})`);
  ok(man.errors.length === 0, `manifest parses without errors ${JSON.stringify(man.errors)}`);
  const parsed = JSON.parse(man.data || '{}');
  ok(parsed.display === 'fullscreen' && parsed.theme_color === '#05070b' && parsed.orientation === 'landscape', 'manifest display / theme / orientation');
  for (const icon of parsed.icons ?? []) {
    const r = await page.request.get(new URL(icon.src, man.url).href);
    ok(r.ok() && (r.headers()['content-type'] ?? '').startsWith(icon.type.split('+')[0]), `icon ${icon.src} served (${r.status()} ${r.headers()['content-type']})`);
  }
  try {
    const inst = await cdp.send('Page.getInstallabilityErrors');
    ok(inst.installabilityErrors.length === 0, `installable ${JSON.stringify(inst.installabilityErrors)}`);
  } catch (e) { console.log('note: Page.getInstallabilityErrors unavailable:', e.message); }

  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, script: r.active?.scriptURL, controlled: !!navigator.serviceWorker.controller };
  });
  ok(!!reg.script && /sw\.js\?v=index-/.test(reg.script), `service worker active: ${reg.script}`);
  console.log(`info  first load ${reg.controlled ? 'already controlled (clients.claim won the race)' : 'not controlled yet'}`);
  await page.waitForTimeout(1500); // let install-time precaching settle
  await page.reload({ waitUntil: 'load' });
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
  ok(!!controlled, `navigator.serviceWorker.controller after reload: ${controlled}`);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const out = {};
    for (const k of keys) out[k] = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname);
    return out;
  });
  const names = Object.keys(cached).filter((k) => k.startsWith('red-horizon-'));
  ok(names.length === 1 && names[0].startsWith('red-horizon-index-'), `one versioned cache: ${Object.keys(cached).join(', ')}`);
  const entries = cached[names[0]] ?? [];
  ok(entries.some((p) => /\/assets\/index-.*\.js$/.test(p)) && entries.some((p) => /\/assets\/index-.*\.css$/.test(p)), 'entry JS + CSS precached');
  ok(entries.some((p) => /ambworker-.*\.js$/.test(p)), 'worker chunk referenced from the bundle precached');
  ok(entries.some((p) => /\/assets\/engine-.*\.js$/.test(p)) && entries.some((p) => /\/assets\/three-.*\.js$/.test(p)), 'lazily loaded engine and three.js chunks precached (offline battles)');
  ok(entries.includes('/') || entries.includes('/index.html'), 'app shell precached');
  ok(entries.some((p) => p.endsWith('/fonts/rajdhani-600.woff2')) && entries.some((p) => p.endsWith('/fonts/share-tech-mono-400.woff2')), 'self-hosted fonts precached');
  console.log(`      ${entries.length} cached entries`);

  // offline boot
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  // the bundle ran: the main menu (.mm-layout) is built by src/ui/menu.ts
  const booted = await page.waitForFunction(() => !!document.querySelector('.mm-layout, #game-canvas'), null, { timeout: 30000 }).then(() => true, () => false);
  ok(booted, 'game boots while offline (served by the service worker)');
  const nav = await page.goto(url + '?demo=0&offline-check=1', { waitUntil: 'load' }).catch(() => null);
  ok(!!nav && nav.status() === 200, `query-string navigations resolve offline (status ${nav?.status()})`);
  const svgIcon = await page.evaluate(async () => (await fetch('/icons/icon.svg')).status).catch(() => -1);
  ok(svgIcon === 200, `precached icon served offline (status ${svgIcon})`);
  await context.setOffline(false);
  ok(errors.length === 0, `no page errors ${JSON.stringify(errors.slice(0, 3))}`);
} finally {
  await browser.close();
  await server.close();
}
