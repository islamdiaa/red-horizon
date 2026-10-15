// QA probe: frame timing during the intro vs. normal play, via the real main menu.
// node tools/qa/frame_probe.mjs [query]
import { launch, shot, sleep, BASE } from './browser.mjs';
const { browser, page, errors } = await launch();
await page.goto(BASE + (process.argv[2] ?? ''), { waitUntil: 'load' });
await page.waitForSelector('.main-screen .deploy', { timeout: 120000 });
await sleep(1500);
const probe = () => page.evaluate(() => new Promise((res) => {
  const ts = []; const t0 = performance.now();
  const f = (t) => { ts.push(t); if (performance.now() - t0 < 6000) requestAnimationFrame(f); else res({ frames: ts.length, avgMs: ts.length > 1 ? (ts[ts.length - 1] - ts[0]) / (ts.length - 1) : null }); };
  requestAnimationFrame(f);
}));
console.log('menu (demo battle behind):', JSON.stringify(await probe()));
await page.click('.main-screen .deploy');
await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo, null, { timeout: 180000 });
console.log('intro:', JSON.stringify(await probe()), JSON.stringify(await page.evaluate(() => ({ paused: window.__game.paused, cine: document.body.className, dist: window.__game.gfx.cam.dist }))));
await page.keyboard.press('Space');
await sleep(3000);
console.log('after skip:', JSON.stringify(await probe()), JSON.stringify(await page.evaluate(() => ({ paused: window.__game.paused, cine: document.body.className, t: window.__game.world.time, dist: window.__game.gfx.cam.dist }))));
await sleep(20000);
console.log('20s later:', JSON.stringify(await probe()), JSON.stringify(await page.evaluate(() => ({ t: window.__game.world.time, cards: document.querySelectorAll('.bitem').length }))));
await shot(page, 'frame-probe');
console.log('errors:', errors);
await browser.close();
