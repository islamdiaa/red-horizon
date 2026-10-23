// The "graphics acceleration is off" notice (src/platform/webgl.ts showSlowRendererNotice) in a real browser:
//  1. as an ordinary visitor (navigator.webdriver hidden): on a software rasteriser the banner appears by itself;
//  2. it steps aside while a battle runs and comes back in the menus;
//  3. "Got it" removes it, and a reload does not show it again.
//   node tools/xb/vmnotice.mjs <browser> [locale=en-US]      (tools/lab/lab.sh run <vm> tools/xb/vmnotice.mjs chrome)
// Browsers by vmlib.mjs name. Chromium-based: --disable-blink-features=AutomationControlled hides navigator.webdriver;
// Firefox: the dom.webdriver.enabled pref. Writes OUT_DIR/vmnotice-<browser>.json and screenshots.
import fs from 'node:fs';
import { launch, sleep, GAME_URL, OUT, watch } from './vmlib.mjs';

const [name = 'chromium', locale = 'en-US'] = process.argv.slice(2);
if (/firefox/.test(name)) process.env.FIREFOX_PREFS = JSON.stringify({ ...JSON.parse(process.env.FIREFOX_PREFS ?? (process.platform === 'win32' ? '{"webgl.force-enabled":true}' : '{}')), 'dom.webdriver.enabled': false });
const browser = await launch(name, { args: /firefox|webkit/.test(name) ? [] : ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale });
const page = await ctx.newPage();
page.setDefaultTimeout(600000);
const log = watch(page);
const r = { browser: name, version: browser.version(), locale, checks: {} };
const check = (k, ok, detail) => { r.checks[k] = { ok: !!ok, detail }; console.log(ok ? 'PASS' : 'FAIL', k, JSON.stringify(detail ?? '').slice(0, 300)); };
const banner = () => page.evaluate(() => { const b = document.querySelector('[data-notice="slow-gpu"]'); return b ? { shown: b.style.display !== 'none' && b.getClientRects().length > 0, text: b.innerText.replace(/\s+/g, ' ').slice(0, 300) } : null; });
try {
  let url = GAME_URL;
  await page.goto(url, { waitUntil: 'load', timeout: 600000 });
  r.webdriver = await page.evaluate(() => navigator.webdriver);
  // Playwright's Firefox keeps navigator.webdriver on whatever the pref says: then the URL forces the notice, and the
  // renderer string shows whether the game would have picked it by itself (the classification has unit tests)
  if (r.webdriver) { url = GAME_URL + (GAME_URL.includes('?') ? '&' : '?') + 'slowgpu=1'; r.forced = true; await page.goto(url, { waitUntil: 'load', timeout: 600000 }); }
  r.renderer = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c?.getExtension('WEBGL_debug_renderer_info'); return c ? (d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER)) : null; });
  await page.waitForSelector('.mm-nav-btn', { timeout: 600000 });
  const b0 = await banner();
  r.softwareRenderer = /swiftshader|llvmpipe|softpipe|basic render driver/i.test(r.renderer ?? '');
  check(r.forced ? 'the notice shows (forced: webdriver visible)' : 'the notice shows by itself on this renderer', b0?.shown, { ...b0, webdriver: r.webdriver, renderer: r.renderer, software: r.softwareRenderer });
  await page.screenshot({ path: `${OUT}/vmnotice-${name}-menu.png`, timeout: 120000 });
  // into a battle (Quick Battle): out of the way of the HUD
  await page.locator('.mm-nav-btn[data-nav="quick"]').click();
  await page.waitForFunction(() => { const t = document.getElementById('topbar'); return !!t && t.getClientRects().length > 0; }, null, { timeout: 900000, polling: 1000 });
  await sleep(3000);
  const b1 = await banner();
  check('hidden while a battle runs', b1 && !b1.shown, b1);
  await page.screenshot({ path: `${OUT}/vmnotice-${name}-battle.png`, timeout: 120000 });
  // back to the menu (Esc, quit) is long on a slow machine: reload instead, then dismiss
  await page.goto(url, { waitUntil: 'load', timeout: 600000 });
  await page.waitForSelector('.mm-nav-btn', { timeout: 600000 });
  const b2 = await banner();
  check('back in the menus after the battle', b2?.shown, b2);
  await page.locator('[data-notice="slow-gpu"] button').click();
  await sleep(1500);
  check('Got it removes it', !(await banner()), null);
  await page.reload({ waitUntil: 'load', timeout: 600000 });
  await page.waitForSelector('.mm-nav-btn', { timeout: 600000 });
  await sleep(2000);
  check('not shown again after a reload', !(await banner()), await page.evaluate(() => localStorage.getItem('rh.slowGpuNotice')));
} catch (e) {
  check('ran to the end', false, String(e).split('\n')[0].slice(0, 300));
  await page.screenshot({ path: `${OUT}/vmnotice-${name}-error.png`, timeout: 120000 }).catch(() => {});
}
r.errors = log.slice(0, 10);
fs.writeFileSync(`${OUT}/vmnotice-${name}.json`, JSON.stringify(r, null, 1));
await browser.close();
process.exit(Object.values(r.checks).every((c) => c.ok) ? 0 : 1);
