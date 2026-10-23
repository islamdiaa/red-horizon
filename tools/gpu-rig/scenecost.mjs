// What the scene pass spends its GPU time on: the bigmatch.mjs late-game scene (four Brutal commanders on a 128 map,
// fast-forwarded), the camera on the busiest fight, then the scene pass timed (EXT_disjoint_timer_query_webgl2) with
// each top-level scene child hidden in turn, and with the shadow map off. The difference is that child's cost.
//   node tools/gpu-rig/scenecost.mjs <base-url> [preset=low] [minutes=13] [map=coastline] [outDir=/out]
import fs from 'node:fs';
import { launchGpu, installProbe } from './lib.mjs';

const [base = 'http://127.0.0.1:8815/', q = 'low', minArg = '13', map = 'coastline', out = '/out'] = process.argv.slice(2);
const W = +(process.env.W ?? 1920), H = +(process.env.H ?? 1080);
const browser = await launchGpu(undefined, []);
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript((Q) => localStorage.setItem('rh.settings', JSON.stringify({ quality: Q, renderScale: 1, skipIntro: true, fullscreen: false, hints: false })), q);
const page = await ctx.newPage();
await page.goto(`${base}?autostart=1&map=${map}&ai=brutal&selfplay=brutal&fog=0&q=${q}&seed=7&debug=1&intro=0`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game?.running && window.__game.world.tick > 0, null, { timeout: 240000, polling: 250 });
await page.evaluate(async (MIN) => {
  const g = window.__game, w = g.world;
  while (w.time < MIN * 60 && !w.gameOver) { g.fastForward(Math.min(30, MIN * 60 - w.time + 0.05)); await new Promise((r) => setTimeout(r, 0)); }
  const us = w.units.filter((u) => u.alive && u.weapons.length);
  let best = us[0], bestN = -1;
  for (const u of us) { let n = 0; for (const v of us) if (u.owner.isEnemy(v.owner) && Math.abs(v.x - u.x) < 10 && Math.abs(v.y - u.y) < 10) n++; if (n > bestN) { bestN = n; best = u; } }
  g.gfx.cam.jumpTo(best.x, best.y); g.gfx.cam.dist = g.gfx.cam.targetDist = 26;
  g.gfx.dynamicResolution = false; g.gfx.setRenderScaleMode(1);
}, +minArg);
await page.waitForTimeout(8000);
const info = await page.evaluate(installProbe);
const time = () => page.evaluate(async () => { const t = await window.__rig.timers(24); return { scene: t?.passes.scenePass ?? null, total: t?.gpuTotal ?? null }; });
const rows = [];
const base0 = await time();
rows.push({ what: 'all', ...base0 });
const kids = await page.evaluate(() => window.__game.gfx.scene.children.map((c, i) => {
  let n = 0; c.traverse(() => n++);
  return { i, name: c.name || '', type: c.type, n, visible: c.visible, ctor: c.constructor.name };
}));
for (const k of kids) {
  if (!k.visible) continue;
  await page.evaluate((i) => { window.__game.gfx.scene.children[i].visible = false; }, k.i);
  const t = await time();
  await page.evaluate((i) => { window.__game.gfx.scene.children[i].visible = true; }, k.i);
  rows.push({ what: `child ${k.i} ${k.name} ${k.type}/${k.ctor} (${k.n} objects)`, ...t, saves: base0.scene != null && t.scene != null ? +(base0.scene - t.scene).toFixed(2) : null });
}
await page.evaluate(() => { const r = window.__game.gfx.renderer; r.shadowMap.enabled = false; });
const ns = await time();
rows.push({ what: 'shadow map off', ...ns, saves: +(base0.scene - ns.scene).toFixed(2) });
await page.evaluate(() => { const r = window.__game.gfx.renderer; r.shadowMap.enabled = true; r.shadowMap.needsUpdate = true; });
const ri = await page.evaluate(() => ({ calls: window.__game.gfx.renderer.info.render.calls, tris: window.__game.gfx.renderer.info.render.triangles, px: [window.__game.gfx.renderer.domElement.width, window.__game.gfx.renderer.domElement.height] }));
const rec = { q, map, W, H, renderer: info.renderer, ri, rows: rows.sort((a, b) => (b.saves ?? 0) - (a.saves ?? 0)) };
fs.writeFileSync(`${out}/scenecost-${q}.json`, JSON.stringify(rec, null, 1));
for (const r of rec.rows.slice(0, 14)) console.log(JSON.stringify(r));
await browser.close();
