// QA probe: per-stage timing of Game.frame after starting from the main menu vs autostart.
// node tools/qa/frame_probe2.mjs menu|auto
import { launch, sleep, BASE } from './browser.mjs';
const mode = process.argv[2] ?? 'menu';
const { browser, page, errors } = await launch();
if (mode === 'menu') {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.main-screen .deploy', { timeout: 120000 });
  await sleep(1500);
  await page.click('.main-screen .deploy');
} else {
  await page.goto(BASE + '?autostart=1&size=96&units=light&fog=1&intro=1&cycle=1&wx=auto', { waitUntil: 'load' });
}
await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo, null, { timeout: 180000 });
await sleep(1000);
await page.keyboard.press('Space');
await sleep(2000);
await page.evaluate(() => {
  const g = window.__game;
  const T = (window.__qaT = {});
  const wrap = (obj, name, key) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const t = performance.now(); try { return f(...a); } finally { T[key] = T[key] ?? [0, 0]; T[key][0] += performance.now() - t; T[key][1]++; } }; };
  wrap(g.gfx, 'render', 'gfx.render');
  wrap(g.hud, 'update', 'hud.update');
  wrap(g.ents, 'update', 'ents.update');
  wrap(g.effects, 'update', 'effects.update');
  wrap(g.world, 'step', 'world.step');
  if (g.overlay) wrap(g.overlay, 'draw', 'overlay.draw');
  wrap(g.hud.minimap, 'draw', 'minimap.draw');
  wrap(g.input, 'update', 'input.update');
});
await sleep(15000);
const r = await page.evaluate(() => ({ T: window.__qaT, t: window.__game.world.time, canvases: [...document.querySelectorAll('canvas')].map((c) => `${c.id || c.className}:${c.width}x${c.height}`), dpr: devicePixelRatio, pixelRatio: window.__game.gfx.renderer.getPixelRatio(), res: window.__game.gfx.renderer.getSize(new (window.__game.gfx.cam.camera.position.constructor.prototype.constructor)()) }));
console.log(mode, JSON.stringify(r, null, 1));
console.log('errors:', errors);
await browser.close();
