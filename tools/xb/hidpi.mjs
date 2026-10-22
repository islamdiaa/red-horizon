// High-DPI check in a real desktop session (Windows display scaling, e.g. 150%): the browser window takes the OS
// scale, so devicePixelRatio is what players get. Run headed in the signed-in desktop:
//   tools/lab/lab.sh display win11 1920x1080 150
//   LAB_DESKTOP=1 tools/lab/lab.sh run win11 tools/xb/hidpi.mjs <chrome|msedge|moz-firefox> [KEY=value...]
// Records the pixel ratio, the canvas backing size against its CSS size, the renderer's pixel ratio and render
// scale, the UI scale, text sizes and anything laid out outside the window, in the menu and in a match; screenshots.
import { launch, GAME_URL, OUT, writeJsonl, watch, instrument, frameStats, sleep } from './vmlib.mjs';

const [name = 'chrome'] = process.argv.slice(2);
const file = `hidpi-${name}${process.env.TAG ?? ''}.jsonl`;
const browser = await launch(name, { headless: process.env.HEADED !== '1' });
// viewport: null keeps the real window, so the OS scale reaches the page
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();
const log = watch(page);
await page.addInitScript(instrument);
const layout = () => page.evaluate(() => {
  const W = innerWidth, H = innerHeight;
  const off = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed' && cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right > W + 2 || r.bottom > H + 2 || r.left < -2 || r.top < -2) off.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const fonts = [...document.querySelectorAll('button, .mm-layout *, #hud *')].slice(0, 400).map((e) => parseFloat(getComputedStyle(e).fontSize)).filter((x) => x > 0);
  const c = document.querySelector('canvas#game-canvas') ?? document.querySelector('canvas');
  const g = window.__game;
  return {
    dpr: devicePixelRatio, inner: [W, H], screen: [screen.width, screen.height], res15: matchMedia('(resolution: 1.5dppx)').matches,
    canvas: c ? { css: [Math.round(c.clientWidth), Math.round(c.clientHeight)], backing: [c.width, c.height] } : null,
    rendererPR: g?.gfx.renderer.getPixelRatio?.() ?? null, renderScale: g?.gfx.currentRenderScale ?? null,
    uiScale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale') || null,
    minFontPx: fonts.length ? Math.min(...fonts) : null, offscreen: off.length, offscreenSample: off.slice(0, 8),
    hScroll: document.documentElement.scrollWidth > W + 1, vScroll: document.documentElement.scrollHeight > H + 1,
  };
});
const rec = { browser: name, version: browser.version() };
try {
  await page.goto(GAME_URL + '?debug=1', { waitUntil: 'load', timeout: 240000 });
  await page.waitForSelector('.mm-layout', { timeout: 240000 });
  await sleep(3000);
  rec.menu = await layout();
  await page.screenshot({ path: `${OUT}/hidpi-${name}-menu.png`, timeout: 120000 });
  await page.locator('.mm-layout button').filter({ hasText: /Quick Battle/i, visible: true }).first().click({ timeout: 120000 });
  await page.waitForFunction(() => window.__game?.running && window.__game.world.tick > 0, null, { timeout: 600000, polling: 1000 });
  await sleep(5000);
  rec.match = await layout();
  rec.frames = await frameStats(page, 4000);
  // fullscreen in a real desktop: Deploy enters it (Settings > Display), Alt+Enter leaves and re-enters
  const fs = () => page.evaluate(() => !!document.fullscreenElement);
  const fs0 = await fs();
  await page.keyboard.press('Alt+Enter'); await sleep(1500);
  const fs1 = await fs();
  await page.keyboard.press('Alt+Enter'); await sleep(1500);
  rec.fullscreen = { atDeploy: fs0, afterAltEnter: fs1, afterSecond: await fs() };
  await page.screenshot({ path: `${OUT}/hidpi-${name}-match.png`, timeout: 120000 });
} catch (e) {
  rec.fail = String(e).split('\n').slice(0, 3).join(' | ').slice(0, 500);
  await page.screenshot({ path: `${OUT}/hidpi-${name}-fail.png`, timeout: 120000 }).catch(() => {});
}
rec.log = log.slice(0, 12);
writeJsonl(file, rec);
await browser.close();
