// PWA install and offline play in Chromium browsers (Chrome, Edge), e.g. in the Windows VM:
//   tools/lab/lab.sh run win11 tools/xb/pwa.mjs <chrome|msedge|chromium> [KEY=value...]
// The VMs reach the game over plain HTTP, which is not a secure context: the browser is told to treat the game's
// origin as secure (--unsafely-treat-insecure-origin-as-secure), as HTTPS would be in production.
// Checks: the service worker controls a reload; the manifest has no installability errors (DevTools protocol);
// PWA.install and PWA.launch (the installed app opens, display-mode standalone / fullscreen); offline: a reload
// reaches the main menu and a Quick Battle starts and runs; back online.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, GAME_URL, OUT, writeJsonl, watch, instrument, sleep, win } from './vmlib.mjs';

const [name = 'chrome'] = process.argv.slice(2);
const origin = new URL(GAME_URL).origin;
const file = `pwa-${name}${process.env.TAG ?? ''}.jsonl`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-pwa-'));
const args = [`--unsafely-treat-insecure-origin-as-secure=${origin}`, ...(process.env.CHROME_ARGS ?? (win ? '--use-angle=d3d11 --ignore-gpu-blocklist' : '--ignore-gpu-blocklist --enable-unsafe-swiftshader')).split(' ').filter(Boolean)];
const ctx = await chromium.launchPersistentContext(dir, { channel: name === 'chromium' ? undefined : name, headless: process.env.HEADED !== '1', args, viewport: { width: 1280, height: 720 } });
const page = ctx.pages()[0] ?? await ctx.newPage();
const log = watch(page);
await page.addInitScript(instrument);
const rec = { browser: name, version: ctx.browser()?.version() ?? null, origin };
const menu = () => page.waitForSelector('.mm-layout', { timeout: 240000 });
try {
  await page.goto(GAME_URL + '?debug=1', { waitUntil: 'load', timeout: 240000 });
  await menu();
  rec.secure = await page.evaluate(() => isSecureContext);
  rec.sw = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then((r) => r.active?.state), new Promise((r) => setTimeout(() => r('timeout'), 90000))]));
  await sleep(5000); // the worker precaches the build and caches what the page loaded
  await page.reload({ waitUntil: 'load', timeout: 240000 });
  await menu();
  rec.swControls = await page.evaluate(() => !!navigator.serviceWorker.controller);
  rec.caches = await page.evaluate(async () => { const out = {}; for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).length; return out; });
  const cdp = await ctx.newCDPSession(page);
  rec.installability = await cdp.send('Page.getInstallabilityErrors').then((r) => r.installabilityErrors.map((e) => e.errorId)).catch((e) => 'n/a: ' + String(e).slice(0, 120));
  const man = await cdp.send('Page.getAppManifest').catch(() => null);
  rec.manifestErrors = man?.errors?.map((e) => e.message) ?? null;
  // (the protocol reports the id relative to the origin; PWA.install wants it absolute)
  const appId = await cdp.send('Page.getAppId').then((r) => r.appId ?? r.recommendedId).catch(() => null);
  const manifestId = new URL(appId ?? '/', GAME_URL).href;
  rec.manifestId = manifestId;
  // install and launch the app (DevTools PWA domain)
  rec.install = await cdp.send('PWA.install', { manifestId, installUrlOrBundleUrl: GAME_URL }).then(() => 'ok').catch((e) => 'failed: ' + String(e).slice(0, 160));
  if (rec.install === 'ok') {
    const before = ctx.pages().length;
    rec.launch = await cdp.send('PWA.launch', { manifestId }).then((r) => 'ok ' + (r.targetId ? 'target' : '')).catch((e) => 'failed: ' + String(e).slice(0, 160));
    await sleep(8000);
    const app = ctx.pages().length > before ? ctx.pages()[ctx.pages().length - 1] : null;
    if (app) {
      await app.waitForSelector('.mm-layout', { timeout: 240000 }).catch(() => {});
      rec.appMode = await app.evaluate(() => ['fullscreen', 'standalone', 'minimal-ui', 'browser'].find((m) => matchMedia(`(display-mode: ${m})`).matches) ?? null);
      await app.screenshot({ path: `${OUT}/pwa-${name}-app.png`, timeout: 120000 }).catch(() => {});
      await app.close().catch(() => {});
    }
  }
  // offline: reload, the menu, then a Quick Battle that must start and run; note what the worker could not serve
  const failed = new Map();
  page.on('requestfailed', (r) => { const u = r.url().replace(origin, ''); failed.set(u, (failed.get(u) ?? 0) + 1); });
  await ctx.setOffline(true);
  const t0 = Date.now();
  await page.reload({ waitUntil: 'load', timeout: 240000 });
  await menu();
  rec.offlineMenuMs = Date.now() - t0;
  await page.locator('.mm-layout button').filter({ hasText: /Quick Battle/i, visible: true }).first().click({ timeout: 120000 });
  await page.waitForFunction(() => window.__game?.running && window.__game.world.tick > 40, null, { timeout: 600000, polling: 1000 });
  rec.offlineMatch = await page.evaluate(() => ({ tick: window.__game.world.tick, hd: window.__hdStatus?.() ? { loaded: window.__hdStatus().loaded.length, failed: window.__hdStatus().failed.length } : null }));
  await page.screenshot({ path: `${OUT}/pwa-${name}-offline-match.png`, timeout: 120000 });
  rec.offlineFailed = Object.fromEntries([...failed].slice(0, 30));
  await ctx.setOffline(false);
} catch (e) {
  rec.fail = String(e).split('\n').slice(0, 3).join(' | ').slice(0, 500);
  await page.screenshot({ path: `${OUT}/pwa-${name}-fail.png`, timeout: 120000 }).catch(() => {});
}
rec.csp = await page.evaluate(() => window.__csp).catch(() => null);
rec.log = log.slice(0, 15);
writeJsonl(file, rec);
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
