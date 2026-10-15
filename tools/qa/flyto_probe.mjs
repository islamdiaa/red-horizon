// QA repro: RTSCamera.flyToPoint() is cancelled on the next frame because InputController.update() calls
// cam.pan(0, 0, dt) every frame and pan() always sets flyTo = null. Affects the intro sweep, H (jump to base),
// Space (jump to last attack), control-group double-tap and the game-over sweep.
// node tools/qa/flyto_probe.mjs [fix]   ('fix' patches pan() in-page to clear flyTo only on real input)
import { launch, shot, sleep, BASE } from './browser.mjs';
const fix = process.argv[2] === 'fix';
const { browser, page } = await launch({ width: 1280, height: 720 });
await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now()))); });
await page.goto(BASE + '?autostart=1&size=96&units=light&fog=1&intro=1&seed=7', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.hud, null, { timeout: 180000 });
if (fix) await page.evaluate(() => {
  const cam = window.__game.gfx.cam; const orig = cam.pan.bind(cam);
  cam.pan = (dx, dy, dt) => { const keep = cam.flyTo; const keepFrom = cam.flyFrom; orig(dx, dy, dt); if (!dx && !dy) { cam.flyTo = keep; cam.flyFrom = keepFrom; } };
});
const cam = () => page.evaluate(() => { const c = window.__game.gfx.cam; return [+c.x.toFixed(1), +c.y.toFixed(1)]; });
const mcv = await page.evaluate(() => { const g = window.__game; const m = g.world.units.find((u) => u.owner === g.local && u.ut.deploysInto); return [m.x, m.y]; });
await sleep(6000);
await page.keyboard.press('Space'); // skip intro (triggers flyToPoint(start, 0.6s))
await page.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 120000 });
await page.waitForFunction(() => !window.__game.gfx.cam.flyTo, null, { timeout: 60000, polling: 300 }).catch(() => {});
await sleep(1000);
const afterIntro = await cam();
console.log(`${fix ? 'FIXED' : 'CURRENT'}: after intro camera at ${afterIntro} vs MCV ${mcv} -> ${Math.hypot(afterIntro[0] - mcv[0], afterIntro[1] - mcv[1]) < 3 ? 'ON BASE' : 'NOT on base'}`);
await shot(page, fix ? 'flyto-fixed-after-intro' : 'flyto-after-intro');
// press H: select MCV and fly to it
await page.evaluate(() => window.__game.gfx.cam.jumpTo(20, 20));
await sleep(500);
await page.keyboard.press('h');
await sleep(4000);
const afterH = await cam();
console.log(`${fix ? 'FIXED' : 'CURRENT'}: H from (20,20) -> camera ${afterH} (MCV ${mcv}) -> ${Math.hypot(afterH[0] - mcv[0], afterH[1] - mcv[1]) < 3 ? 'jumped' : 'DID NOT MOVE'}`);
// Space: jump to last attack
await page.evaluate(() => { const g = window.__game; g.local.lastAttackX = 70; g.local.lastAttackY = 30; g.gfx.cam.jumpTo(20, 20); });
await sleep(500);
await page.keyboard.press('Space');
await sleep(4000);
const afterSpace = await cam();
console.log(`${fix ? 'FIXED' : 'CURRENT'}: Space (last attack 70,30) -> camera ${afterSpace} -> ${Math.hypot(afterSpace[0] - 70, afterSpace[1] - 30) < 3 ? 'jumped' : 'DID NOT MOVE'}`);
await browser.close();
