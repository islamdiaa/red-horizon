// QA probe: where is the camera after the intro vs. the player's MCV? (with the rAF shim)
// node tools/qa/cam_probe.mjs [skip|wait] [query]
import { launch, shot, sleep, BASE } from './browser.mjs';
const mode = process.argv[2] ?? 'skip';
const { browser, page } = await launch({ width: 1280, height: 720 });
await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now()))); });
await page.goto(BASE + (process.argv[3] ?? '?autostart=1&size=96&units=light&fog=1&intro=1&seed=7'), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.hud, null, { timeout: 180000 });
const cam = () => page.evaluate(() => { const g = window.__game, c = g.gfx.cam; const m = g.world.units.find((u) => u.owner === g.local && u.ut.deploysInto); const s = g.world.map.startPositions; return { cam: [+c.x.toFixed(1), +c.y.toFixed(1), +c.dist.toFixed(1), +c.yaw.toFixed(2)], flyTo: c.flyTo, mcv: m && [+m.x.toFixed(1), +m.y.toFixed(1)], starts: s.map((p) => [p.x, p.y]), seed: g.setup.seed, t: +g.world.time.toFixed(1), cine: document.body.classList.contains('cine-active') }; });
for (let k = 0; k < 3; k++) { console.log('intro', JSON.stringify(await cam())); await sleep(3000); }
if (mode === 'skip') await page.keyboard.press('Space');
for (let k = 0; k < 8; k++) { await sleep(3000); console.log('after', JSON.stringify(await cam())); }
await shot(page, 'cam-probe-' + mode);
await browser.close();
