// Cost of the effects director's cut: a 150+ unit battle fought inside a burning base, N frames at a fixed
// 1/20 s step, with the director's cut on (?fxdc=1) or off (?fxdc=0): JS frame time, GPU-synced frame time
// (SwiftShader: a proxy for relative GPU work), draw calls (per post pass), haze sources, dynamic lights.
//   QA_BASE=http://localhost:5274/ node tools/qa/fxdc_bench.mjs <high|medium|low> <0|1> [frames=60] [shot.png]
import { launch, BASE } from './browser.mjs';

const [q = 'high', fx = '1', framesArg = '60', shot] = process.argv.slice(2);
const FRAMES = +framesArg;
const url = `${BASE}?autostart=1&scenario=battle&fog=0&size=64&seed=11&tod=${process.env.TOD ?? 'dusk'}&q=${q}&fxdc=${fx}&hd=1&speed=0.1${process.env.EXTRA ? '&' + process.env.EXTRA : ''}`;
const { browser, page, errors } = await launch({ width: +(process.env.W ?? 1600), height: +(process.env.H ?? 900) });
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 240000 });
await page.evaluate(() => {
  const g = window.__game;
  g.running = false;
  cancelAnimationFrame(g.raf);
  while (g.world.tick < 8) { g.world.step(); g.processEvents(); }
});

// armies: 150+ units fighting their way into the Soviet base, half of which is already burning
const setup = await page.evaluate(() => {
  const g = window.__game, w = g.world;
  const sov = w.players.find((p) => p.faction === 'soviet') ?? w.players[1];
  const bs = w.buildings.filter((b) => b.alive && b.owner === sov && !b.bt.wall);
  const cx = bs.reduce((s, b) => s + b.x, 0) / bs.length, cy = bs.reduce((s, b) => s + b.y, 0) / bs.length;
  bs.forEach((b, i) => { if (i % 2 === 0) b.hp = Math.max(1, b.maxHp * (i % 4 === 0 ? 0.2 : 0.42)); });
  const extra = {
    allies: ['2tnk', '2tnk', '1tnk', '1tnk', 'jeep', 'apc', 'arty', 'e1', 'e1', 'e1', 'e1', 'e3', 'e3', 'e3', 'e1', 'e1', 'e3', '2tnk', '2tnk', '1tnk', 'e1', 'e1', 'e3', 'e3', 'jeep', 'heli', 'e1', 'e1', 'e1', 'e3', '2tnk', '1tnk', 'e1', 'e3', 'e1', 'e1', 'e1', 'e3', '2tnk', '1tnk', 'e1', 'e1', 'e3', 'e1', 'e1', 'e1', 'e3', 'e1', 'e1', '1tnk', 'e3', 'e1', 'e1'],
    soviet: ['3tnk', '3tnk', '4tnk', 'v2rl', 'e1', 'e1', 'e1', 'e2', 'e2', 'e4', 'e4', 'e1', 'e1', 'e3', '3tnk', '3tnk', 'e1', 'e1', 'e2', 'dog', 'e1', 'e1', 'e3', '3tnk', 'hind', 'e1', 'e1', 'e1', 'e2', 'e4', '3tnk', 'ftrk', 'e1', 'e1', 'e3', 'e1', 'e4', 'e4', '3tnk', 'e1', 'e2', 'e1', 'e1', 'e3', 'e1', 'e1', 'e2', 'e1', 'e1', '3tnk', 'e1', 'e4', 'e1'],
  };
  for (const p of w.players) {
    const own = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length);
    const ox = own.reduce((s, u) => s + u.x, 0) / Math.max(1, own.length), oy = own.reduce((s, u) => s + u.y, 0) / Math.max(1, own.length);
    (extra[p.faction] ?? extra.allies).forEach((t, k) => {
      try {
        const [x, y] = w.findFreeSpot(ox + (k % 8) * 1.0 - 3.5, oy + Math.floor(k / 8) * 1.0 - 2.5, 6);
        const u = w.addUnit(t, p, x, y);
        if (u.kind === 'aircraft') u.altitude = u.ut.vtol ? 1.55 : 2.3;
      } catch { /* unknown type */ }
    });
    w.dirtyLists = true;
    const ids = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
    // everyone converges on the front of the Soviet base
    w.issue({ c: 'move', player: p.id, units: ids, x: cx + (w.map.w / 2 - cx) * 0.3, y: cy + (w.map.h / 2 - cy) * 0.3, attackMove: true });
  }
  // two structures already destroyed: collapses, rubble, smoking ruins
  bs.filter((b, i) => i % 2 === 1).slice(0, 2).forEach((b) => w.kill(b, 'normal'));
  g.processEvents();
  return { cx, cy, units: w.units.filter((u) => u.alive).length };
});
await page.evaluate(([cx, cy, d]) => {
  const g = window.__game;
  g.fastForward(+(new URLSearchParams(location.search).get('ffb') ?? 9));
  const m = g.world.map;
  const fx = cx + (m.w / 2 - cx) * 0.2, fy = cy + (m.h / 2 - cy) * 0.2;
  g.gfx.cam.jumpTo(fx, fy + 1);
  g.gfx.cam.dist = g.gfx.cam.targetDist = d;
  g.speed = 1;
}, [setup.cx, setup.cy, +(process.env.DIST ?? 26)]);

const res = await page.evaluate(async (FRAMES) => {
  const g = window.__game;
  const T = {};
  const wrap = (obj, name, key) => {
    const f = obj[name].bind(obj);
    obj[name] = (...a) => { const t = performance.now(); try { return f(...a); } finally { const r = (T[key] ??= [0, 0]); r[0] += performance.now() - t; r[1]++; } };
  };
  wrap(g.gfx, 'render', 'render');
  wrap(g.effects, 'update', 'effects');
  wrap(g.ents, 'update', 'ents');
  wrap(g.world, 'step', 'sim');
  const gl = g.gfx.renderer.getContext();
  const px = new Uint8Array(4);
  let clock = performance.now();
  g.last = clock;
  const calls = [], frameMs = [], gpuMs = [], haze = [], dyn = [], parts = [];
  const passes = {};
  // warm: two frames not counted (first-use uploads)
  for (let n = 0; n < FRAMES + 2; n++) {
    clock += 1000 / 20;
    const t0 = performance.now();
    g.frame(clock);
    const t1 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t2 = performance.now();
    if (n < 2) continue;
    frameMs.push(t1 - t0);
    gpuMs.push(t2 - t0);
    calls.push(g.gfx.stats.calls);
    const st = g.gfx.fxStats();
    haze.push(st.haze ? st.haze.drawn : 0);
    dyn.push(st.dyn.drawn);
    const es = g.effects.stats();
    parts.push(es.mainAlive + es.glowAlive);
    for (const [k, v] of Object.entries(st.passes)) passes[k] = (passes[k] ?? 0) + v;
    await new Promise((r) => setTimeout(r, 0));
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1] ?? 0; };
  const per = {};
  for (const [k, [ms, n]] of Object.entries(T)) per[k] = +(ms / Math.max(1, n)).toFixed(2);
  for (const k of Object.keys(passes)) passes[k] = +(passes[k] / FRAMES).toFixed(1);
  return {
    units: g.world.units.filter((u) => u.alive).length, worldTime: +g.world.time.toFixed(1),
    msPerCall: per,
    cpuFrameMs: +avg(frameMs).toFixed(1), cpuFrameMedian: +med(frameMs).toFixed(1),
    gpuSyncedFrameMs: +avg(gpuMs).toFixed(1), gpuSyncedMedian: +med(gpuMs).toFixed(1),
    calls: Math.round(avg(calls)), callsMax: Math.max(...calls), passes,
    hazeSources: +avg(haze).toFixed(1), dynLights: Math.round(avg(dyn)), particles: Math.round(avg(parts)),
    destruction: g.ents.destruction.stats(),
  };
}, FRAMES);
console.log(JSON.stringify({ q, fxdc: fx, unitsAtStart: setup.units, ...res }));
if (shot) { await page.screenshot({ path: shot, timeout: 180000 }); console.log('shot', shot); }
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
await browser.close();
