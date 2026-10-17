#!/usr/bin/env node
// Lazy HD loading check (dev server): scene A with every type loading lazily (?hdlazy=1).
//   1. which power plants swapped to HD (off-screen ones) and which stayed procedural (on screen in frame 1)
//   2. a power plant built while its HD model loads: swaps during construction (hologram + build-up)
//   3. a heavy tank produced while its HD model loads: swaps while still inside the war factory / off-screen
//   node tools/assets/hdlazy.mjs [port=5231] [outDir=/tmp/rh-assets] [q=high]
// Prints JSON (timings, swap moments, HD memory) and writes lazy-*.png screenshots.
import { chromium } from 'playwright';
const port = process.argv[2] ?? '5231';
const outDir = process.argv[3] ?? '/tmp/rh-assets';
const q = process.argv[4] ?? 'high';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], env: { ...process.env, LD_LIBRARY_PATH: new URL('../nsslibs/lib', import.meta.url).pathname } });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('crash', () => console.log('PAGE CRASHED', JSON.stringify(errors.slice(-5))));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
await page.goto(`http://localhost:${port}/?autostart=1&scenario=base&faction=soviet&climate=winter&tod=day&hour=10.5&wx=clear&size=64&fog=0&intro=0&hd=1&hdlazy=1&q=${q}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 600000 });
await page.waitForTimeout(4000);
const ev = (f, a) => page.evaluate(f, a);
const shot = (n) => page.screenshot({ path: `${outDir}/lazy-${n}.png`, timeout: 180000 });
const out = {};
out.start = await ev(async () => {
  const g = window.__game; const hd = await import('/src/render/models/hd.ts');
  const vs = [...g.ents.views.values()];
  return { status: hd.hdStatus(), powr: vs.filter((v) => v.ent.type.id === 'powr').map((v) => ({ owner: v.ent.owner.faction, hd: !!v.model.hd, shown: !!v.hdShown })) };
});
// ---- a structure built after load (its type loaded lazily with 0 refs: must not be swept) is HD at once
out.builtAfterLoad = await ev(async () => {
  const g = window.__game;
  const fact = g.world.buildings.find((b) => b.owner === g.local && b.type.id === 'fact') ?? g.world.buildings.find((b) => b.owner === g.local);
  const before = new Set(g.world.buildings.map((b) => b.id));
  window.__debug.construct('powr', fact.x - 4, fact.y + 3);
  const b = g.world.buildings.find((x) => !before.has(x.id));
  return { id: b?.id, type: b?.type.id };
});
await page.waitForTimeout(1500);
out.builtAfterLoad.hd = await ev((id) => !!window.__game.ents.views.get(id)?.model.hd, out.builtAfterLoad.id);
// ---- late arrivals: the structures shown procedural in frame 1 swap at the next hidden moment (off-screen)
out.lateArrivals = await ev(async () => {
  const g = window.__game;
  const c = g.gfx.cam;
  const at = [c.x, c.y];
  c.jumpTo(4, 4);
  await new Promise((r) => setTimeout(r, 3000));
  c.jumpTo(at[0], at[1]);
  await new Promise((r) => setTimeout(r, 1500));
  const vs = [...g.ents.views.values()].filter((v) => v.ent.type.id === 'powr' && v.ent.owner.faction === 'soviet');
  return vs.map((v) => !!v.model.hd);
});
// ---- structure built while its HD model loads
const site = await ev(async () => {
  const g = window.__game; const hd = await import('/src/render/models/hd.ts');
  const fact = g.world.buildings.find((b) => b.owner === g.local && b.type.id === 'fact') ?? g.world.buildings.find((b) => b.owner === g.local);
  hd.hdDebugDrop('powr.soviet', true);
  const before = new Set(g.world.buildings.map((b) => b.id));
  window.__debug.construct('powr', fact.x + 4, fact.y + 2);
  const b = g.world.buildings.find((x) => !before.has(x.id));
  g.gfx.cam.jumpTo(b.x, b.y); g.gfx.cam.dist = g.gfx.cam.targetDist = 9;
  window.__lazyB = b.id;
  return { id: b.id, x: b.x, y: b.y };
});
const samples = [];
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(400);
  const s = await ev(() => { const g = window.__game; const v = g.ents.views.get(window.__lazyB); const b = v.ent; return { t: +g.time.toFixed(2), build: +b.buildAnim.toFixed(2), hd: !!v.model.hd, holo: !!v.holo, holoHd: !!v.holo?.hd }; });
  samples.push(s);
  if (i === 1) await shot('build-early');
  if (s.hd && !samples.find((x) => x.shotHd)) { s.shotHd = true; await shot('build-swapped'); }
  if (s.build >= 1) break;
}
await page.waitForTimeout(1500);
await shot('build-done');
out.structure = { site, firstHd: samples.find((s) => s.hd), samples: samples.filter((s, i) => i % 4 === 0 || s.hd !== samples[Math.max(0, i - 1)].hd) };
// ---- unit produced while its HD model loads
const fac = await ev(async () => {
  const g = window.__game; const hd = await import('/src/render/models/hd.ts');
  const weap = g.world.buildings.find((b) => b.owner === g.local && b.type.id === 'weap');
  // the tanks already on the map keep their (HD) models alive: drop the template only when none is in use
  const dropped = hd.hdDebugDrop('3tnk.soviet', true);
  window.__units0 = new Set(g.world.units.map((u) => u.id));
  g.world.issue({ c: 'build', player: g.local.id, type: '3tnk' });
  g.speed = 4;
  g.gfx.cam.jumpTo(weap.x, weap.y + 1.5); g.gfx.cam.dist = g.gfx.cam.targetDist = 9;
  return { weap: [weap.x, weap.y], dropped, status: hd.hdStatus() };
});
const usamples = [];
let shotsTaken = 0;
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(500);
  const s = await ev(() => {
    const g = window.__game;
    const u = g.world.units.find((x) => !window.__units0.has(x.id) && x.type.id === '3tnk');
    if (!u) return null;
    const v = g.ents.views.get(u.id);
    const weap = g.world.buildings.find((b) => b.owner === g.local && b.type.id === 'weap');
    const inside = u.x >= weap.cx && u.x <= weap.cx + weap.w && u.y >= weap.cy && u.y <= weap.cy + weap.h;
    return { t: +g.time.toFixed(2), x: +u.x.toFixed(2), y: +u.y.toFixed(2), inside, hd: !!v?.model.hd, shown: !!v?.hdShown, visible: !!v?.model.root.visible, inView: !!v?.inView };
  });
  if (!s) continue;
  usamples.push(s);
  if (shotsTaken < 4 && (usamples.length === 1 || (s.hd && !usamples[usamples.length - 2]?.hd) || usamples.length === 6 || usamples.length === 14)) { await shot(`unit-${shotsTaken++}`); }
  if (usamples.length > 16) break;
}
out.unit = { fac, firstHd: usamples.find((s) => s.hd), samples: usamples };
out.end = await ev(async () => (await import('/src/render/models/hd.ts')).hdStatus());
console.log(JSON.stringify({ ...out, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
