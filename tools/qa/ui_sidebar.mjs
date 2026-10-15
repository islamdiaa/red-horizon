// QA: sidebar card states with tick-synchronised waits (robust on slow renderers).
// node tools/qa/ui_sidebar.mjs
import { launch, shot, sleep, BASE, report, waitGame, toasts } from './browser.mjs';
const { browser, page, errors } = await launch({ width: 1280, height: 720 });
await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now()))); });
await page.goto(BASE + '?autostart=1&size=64&units=light&fog=1&scenario=base&seed=4321', { waitUntil: 'load' });
await waitGame(page);
await sleep(3000);
const card = (name) => page.locator('.bitem').filter({ has: page.locator('.bi-name', { hasText: new RegExp(`^${name}$`) }) }).first();
// wait until the sim has stepped twice and the HUD has had two frames
async function settle() {
  const t0 = await page.evaluate(() => window.__game.world.tick);
  await page.waitForFunction((t) => window.__game.world.tick >= t + 2, t0, { timeout: 60000, polling: 50 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
const st = async () => ({ card: await card('Rifle Infantry').getAttribute('data-state'), q: await page.evaluate(() => window.__game.local.queues.infantry.items.map((i) => (i.paused ? 'P' : '') + i.type).join(',')) });
await page.locator('#sidebar .tab').nth(2).click(); await settle();
await card('Rifle Infantry').click(); await settle();
let s = await st(); report('Click: card shows "build" while training', s.card === 'build', JSON.stringify(s));
await card('Rifle Infantry').click({ button: 'right' }); await settle();
s = await st(); report('Right-click: on hold', s.card === 'hold', JSON.stringify(s));
await card('Rifle Infantry').click(); await settle();
s = await st(); report('Left-click: resumes', s.card === 'build', JSON.stringify(s));
await card('Rifle Infantry').click({ button: 'right' }); await settle();
await card('Rifle Infantry').click({ button: 'right' }); await settle();
s = await st(); report('Right-click on held item: cancels', s.q === '', JSON.stringify(s));
await page.keyboard.down('Shift'); await card('Rifle Infantry').click(); await page.keyboard.up('Shift'); await settle();
s = await st();
const cnt = await card('Rifle Infantry').locator('.bi-count').textContent();
report('Shift-click queues 5 with a ×5 counter', s.q.split(',').length === 5 && cnt.includes('5'), `${JSON.stringify(s)} counter "${cnt}"`);
await shot(page, 'ui-sidebar-queue');
await page.evaluate(() => { const p = window.__game.local; p.cash = 0; p.ore = 0; }); await settle(); await settle();
s = await st(); report('No funds: card shows "nofunds"', s.card === 'nofunds', JSON.stringify(s));
await shot(page, 'ui-sidebar-nofunds');
// double right-click within one sim tick (fast double-click): what happens?
await page.evaluate(() => { window.__game.local.cash = 20000; }); await settle();
await page.keyboard.down('Shift'); await card('Rifle Infantry').click(); await page.keyboard.up('Shift'); await settle();
await page.evaluate(() => window.__game.paused = true); // freeze sim so both clicks land in the same tick
await card('Rifle Infantry').click({ button: 'right' }); await card('Rifle Infantry').click({ button: 'right' });
await page.evaluate(() => { window.__game.paused = false; window.__game.last = performance.now(); }); await settle();
s = await st();
console.log('two right-clicks within one sim tick ->', JSON.stringify(s), '(expected: hold then cancel one)');
console.log('errors', errors);
await browser.close();
