// QA repro: Game.frame() does not clamp negative dt. After start()/resume() set `last = performance.now()`,
// the next rAF timestamp can be older -> negative dt -> acc/time negative, HUD slow-path frozen (slowT -= dt),
// renderer fed negative dt. Run with `patch` to simulate the fix (clamp dt >= 0) in-page for comparison.
// node tools/qa/negdt_probe.mjs [patch]
import { launch, shot, sleep, BASE } from './browser.mjs';
const patch = process.argv[2] === 'patch';
const { browser, page, errors } = await launch({ width: 1280, height: 720 });
if (patch) {
  // simulate the fix at the source: rAF callbacks never see a timestamp older than performance.now()
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now())));
  });
}
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.main-screen .deploy', { timeout: 120000 });
await sleep(1500);
if (false) {
  // (old approach, too late: first frame runs before the patch)
  await page.evaluate(() => {
    const iv = setInterval(() => {
      const g = window.__game;
      if (!g || g.setup.demo) return;
      const proto = Object.getPrototypeOf(g);
      if (proto.__qaPatched) { clearInterval(iv); return; }
      const orig = proto.frame;
      proto.frame = function (now) { if (now < this.last) this.last = now; return orig.call(this, now); };
      proto.__qaPatched = true;
      clearInterval(iv);
    }, 5);
  });
}
await page.locator('.main-screen .deploy').click({ noWaitAfter: true, timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo, null, { timeout: 180000 });
const minTime = { v: 0 };
await sleep(1000);
console.log('during intro:', JSON.stringify(await page.evaluate(() => ({ slowT: +window.__game.hud.slowT.toFixed(2), camDist: +window.__game.gfx.cam.dist.toExponential(2), time: window.__game.time }))));
await shot(page, patch ? 'negdt-intro-patched' : 'negdt-intro-unpatched');
await sleep(3000);
await page.keyboard.press('Space');
for (let k = 0; k < 8; k++) {
  await sleep(2500);
  const s = await page.evaluate(() => ({ acc: +window.__game.acc.toFixed(2), time: +window.__game.time.toFixed(2), wt: window.__game.world.time, slowT: +window.__game.hud.slowT.toFixed(2), camDist: +window.__game.gfx.cam.dist.toExponential(2), clock: document.querySelector('.tb-time')?.textContent, cards: document.querySelectorAll('.bitem').length }));
  minTime.v = Math.min(minTime.v, s.time);
  console.log(JSON.stringify(s));
}
await shot(page, patch ? 'negdt-patched' : 'negdt-unpatched');
console.log(`${patch ? 'PATCHED' : 'UNPATCHED'}: min Game.time ${minTime.v.toFixed(2)}`, 'errors', errors.length);
await browser.close();
