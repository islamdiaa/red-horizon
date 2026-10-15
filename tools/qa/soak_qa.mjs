// QA: long-session soak in the real renderer. selfplay AI (hard) vs AI, day/night + auto weather.
// Alternates fast-forward chunks with rendered frames; tracks errors, heap, view/entity leaks, renderer
// memory, invariants and orphaned selection. node tools/qa/soak_qa.mjs [simMinutes=35] [query]
import { launch, shot, sleep, BASE } from './browser.mjs';

const MIN = +(process.argv[2] ?? 35);
const Q = process.argv[3] ?? '?autostart=1&size=64&units=mcv&fog=1&selfplay=hard&ai=hard&cycle=1&wx=auto';
const { browser, page, errors, warnings } = await launch({ width: 1280, height: 720 });
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now())));
});
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s]`, ...a);
await page.goto(BASE + Q, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.hud, null, { timeout: 180000 });
await sleep(3000);
// select a few own units and keep the selection to test orphan handling
const sample = () => page.evaluate(() => {
  const g = window.__game, w = g.world;
  const inv = [];
  for (const p of w.players) { if (!(p.cash >= -0.01) || !(p.ore >= -0.01) || !Number.isFinite(p.cash)) inv.push(`credits ${p.name} ${p.cash} ${p.ore}`); }
  for (const u of w.units) {
    if (!u.alive) continue;
    if (!Number.isFinite(u.x) || !Number.isFinite(u.y) || !Number.isFinite(u.hp)) inv.push(`nan ${u.ut.id}#${u.id}`);
    if (u.kind !== 'aircraft') {
      const cx = Math.floor(u.x), cy = Math.floor(u.y);
      if (w.map.inBounds(cx, cy)) { const i = w.map.idx(cx, cy); const occ = w.map.occupant[i]; if (occ && !w.map.passableOverride[i] && occ !== u.exitBuilding) inv.push(`in-bld ${u.ut.id}#${u.id}@${u.x.toFixed(1)},${u.y.toFixed(1)}`); }
    }
  }
  const orphanSel = [...g.selection].filter((id) => !w.getEntity(id)?.alive).length;
  const ents = w.units.length + w.buildings.length;
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1;
  const ri = g.gfx.renderer.info.memory;
  return {
    t: Math.round(w.time), over: w.gameOver, units: w.units.length, blds: w.buildings.length, proj: w.projectiles.length,
    views: g.ents.views.size, ents, heapMB: mem, geo: ri.geometries, tex: ri.textures, prog: g.gfx.renderer.info.programs?.length ?? -1,
    fx: JSON.stringify(g.effects.stats?.() ?? {}), sceneChildren: g.gfx.scene.children.length, orphanSel, inv: inv.slice(0, 4), invN: inv.length,
    hours: g.hours.toFixed(1), wx: g.gfx.weather.kind, domToasts: document.querySelectorAll('.toast').length, domNodes: document.getElementsByTagName('*').length,
  };
});
const rows = [];
let lastLog = -999;
while (true) {
  const s = await sample();
  if (s.t - lastLog >= 120 || s.over) {
    lastLog = s.t;
    rows.push(s);
    log(JSON.stringify(s));
    if (s.t % 600 < 120) await shot(page, `soak-${Math.round(s.t / 60)}min`);
  }
  if (s.over || s.t >= MIN * 60) break;
  // keep a selection of own units (orphan test)
  await page.evaluate(() => { const g = window.__game; if (g.selection.size < 3) for (const u of g.world.units) if (u.owner === g.local && u.weapons.length) { g.selection.add(u.id); if (g.selection.size >= 6) break; } });
  await page.evaluate(() => window.__game.fastForward(6));
  await sleep(700); // let a couple of frames render
}
const first = rows[1] ?? rows[0], last = rows[rows.length - 1];
log(`heap ${first.heapMB} -> ${last.heapMB} MB, geometries ${first.geo} -> ${last.geo}, textures ${first.tex} -> ${last.tex}, programs ${first.prog} -> ${last.prog}, scene children ${first.sceneChildren} -> ${last.sceneChildren}, DOM nodes ${first.domNodes} -> ${last.domNodes}`);
log('max view/entity gap:', Math.max(...rows.map((r) => r.views - r.ents)));
log('errors:', errors.length, [...new Set(errors)].slice(0, 6));
log('warnings:', warnings.length, [...new Set(warnings)].slice(0, 6));
await shot(page, 'soak-end');
await browser.close();
