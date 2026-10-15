// QA probe: after a menu start, is Hud.update() throwing or stuck in its slow-path gate?
import { launch, sleep, BASE } from './browser.mjs';
const { browser, page, errors } = await launch({ width: 1280, height: 720 });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.main-screen .deploy', { timeout: 120000 });
await sleep(1500);
await page.locator('.main-screen .deploy').click({ noWaitAfter: true, timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo, null, { timeout: 180000 });
await sleep(3000);
for (let k = 0; k < 3; k++) {
  const r = await page.evaluate(() => {
    const g = window.__game, h = g.hud;
    const out = { slowT: h.slowT, last: g.last, now: performance.now(), time: g.time, acc: g.acc, cards: document.querySelectorAll('.bitem').length };
    try { h.update(0.2); out.manual = 'ok'; } catch (e) { out.manual = 'THREW: ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | '); }
    out.cardsAfter = document.querySelectorAll('.bitem').length;
    out.slowTAfter = h.slowT;
    return out;
  });
  console.log(JSON.stringify(r));
  await sleep(3000);
}
console.log('errors', errors);
await browser.close();
