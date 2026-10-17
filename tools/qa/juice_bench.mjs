// [JUICE] Big-battle cost probe: scenario "battle" plus extra armies (100+ units), fast-forwarded to contact,
// then N frames measured at x1 speed: draw calls, triangles, particles, dynamic lights, audio voices and the
// CPU time of the per-frame client systems. A/B with ?juice=0 (pre-JUICE behaviour).
//   QA_BASE=http://localhost:5264/ node tools/qa/juice_bench.mjs <high|medium|low> <0|1> [frames=90] [shot.png]
// SwiftShader frame times are not GPU numbers: compare the JS-side costs and the counts, not the FPS.
import { launch, sleep, BASE } from './browser.mjs';

const [q = 'high', juice = '1', framesArg = '90', shot] = process.argv.slice(2);
const FRAMES = +framesArg;
const FF = process.env.FF ?? '13';
const url = `${BASE}?autostart=1&steps=1&scenario=battle&charge=1&fog=0&size=64&seed=11&tod=day&q=${q}&juice=${juice}&hd=1&ffb=${FF}&speed=0.1`;
const { browser, page, errors } = await launch({ width: +(process.env.W ?? 1600), height: +(process.env.H ?? 900) });
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 240000 }); // started (main.ts exposes the game before start())
// determinism: stop the real-time loop at once (it ran at x0.1 until now) and line both runs up on the same tick
const tick0 = await page.evaluate(() => {
  const g = window.__game;
  g.running = false;
  cancelAnimationFrame(g.raf);
  while (g.world.tick < 8) { g.world.step(); g.processEvents(); }
  return g.world.tick;
});

// more armies: 100+ units fighting in the middle
const spawned = await page.evaluate(() => {
  const g = window.__game;
  const w = g.world;
  const extra = {
    allies: ['2tnk', '2tnk', '1tnk', '1tnk', 'jeep', 'apc', 'arty', 'e1', 'e1', 'e1', 'e1', 'e3', 'e3', 'e3', 'e1', 'e1', 'e3', '2tnk', '2tnk', '1tnk', 'e1', 'e1', 'e3', 'e3', 'jeep', 'heli', 'e1', 'e1', 'e1', 'e3', '2tnk', '1tnk', 'e1', 'e3', 'e1'],
    soviet: ['3tnk', '3tnk', '4tnk', 'v2rl', 'e1', 'e1', 'e1', 'e2', 'e2', 'e4', 'e4', 'e1', 'e1', 'e3', '3tnk', '3tnk', 'e1', 'e1', 'e2', 'dog', 'e1', 'e1', 'e3', '3tnk', 'hind', 'e1', 'e1', 'e1', 'e2', 'e4', '3tnk', 'ftrk', 'e1', 'e1', 'e3'],
  };
  const mid = { x: w.map.w / 2, y: w.map.h / 2 };
  for (const p of w.players) {
    const own = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length);
    const cx = own.reduce((s, u) => s + u.x, 0) / Math.max(1, own.length);
    const cy = own.reduce((s, u) => s + u.y, 0) / Math.max(1, own.length);
    const list = extra[p.faction] ?? extra.allies;
    list.forEach((t, k) => {
      try {
        const [x, y] = w.findFreeSpot(cx + (k % 7) * 1.1 - 3.3, cy + Math.floor(k / 7) * 1.1 - 2.5, 5);
        const u = w.addUnit(t, p, x, y);
        if (u.kind === 'aircraft') u.altitude = u.ut.vtol ? 1.55 : 2.3;
      } catch { /* unknown type on this ruleset */ }
    });
    w.dirtyLists = true;
    const ids = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
    w.issue({ c: 'move', player: p.id, units: ids, x: mid.x, y: mid.y, attackMove: true });
  }
  g.audio.unlock?.();
  return w.units.filter((u) => u.alive).length;
});
// fast-forward to contact, then watch the middle
await page.evaluate((d) => { const g = window.__game; g.fastForward(+(new URLSearchParams(location.search).get('ffb') ?? 13)); const m = g.world.map; g.gfx.cam.jumpTo(m.w / 2, m.h / 2 + 1); g.gfx.cam.dist = g.gfx.cam.targetDist = d; g.speed = 1; }, +(process.env.DIST ?? 34));

const res = await page.evaluate(async ([FRAMES, INTERLEAVE]) => {
  const g = window.__game;
  const T = {};
  const wrap = (obj, name, key) => {
    const f = obj[name].bind(obj);
    obj[name] = (...a) => { const t = performance.now(); try { return f(...a); } finally { const r = (T[key] ??= [0, 0]); r[0] += performance.now() - t; r[1]++; } };
  };
  wrap(g.gfx, 'render', 'render');
  wrap(g.ents, 'update', 'ents');
  wrap(g.effects, 'update', 'effects');
  if (g.juice) wrap(g.juice, 'update', 'juice');
  wrap(g.world, 'step', 'sim');
  // every Effects API entry point (base recipes + the JUICE layers they now add) and the director's event hook
  const T2 = { fxApi: [0, 0] };
  for (const m of ['explosion', 'muzzleFlash', 'tracer', 'teslaBolt', 'flameStream', 'hitFlash', 'flakBurst', 'heavyDeath', 'promotionBurst', 'milestoneBurst', 'createEmitter', 'scorch', 'dust']) {
    if (typeof g.effects[m] !== 'function') continue;
    const f = g.effects[m].bind(g.effects);
    g.effects[m] = (...a) => { const t = performance.now(); try { return f(...a); } finally { T2.fxApi[0] += performance.now() - t; T2[m] = (T2[m] ?? 0) + 1; } };
  }
  if (g.juice) wrap(g.juice, 'onEvent', 'juiceEvents');
  window.__T2 = T2;
  const calls = [], tris = [], frameMs = [], gpuMs = [], mainAlive = [], glowAlive = [], dyn = [], voices = [];
  g.audio.resetMixStats?.();
  // deterministic stepping: stop the rAF loop and drive Game.frame with a fixed 1/30 s clock, so both runs
  // of an A/B see the same simulation; a 1-pixel readback after each frame waits for the GPU (SwiftShader)
  const gl = g.gfx.renderer.getContext();
  const px = new Uint8Array(4);
  let clock = performance.now();
  g.last = clock;
  const inter = INTERLEAVE && g.juice?.setEnabled;
  const par = [[0, 0, 0], [0, 0, 0]]; // per parity: client ms (frame − render − sim), fx API ms, frames
  const parS = [[], []]; // per-frame client ms samples (medians)
  const fxDbg = [];
  for (let n = 0; n < FRAMES; n++) {
    clock += 1000 / 20; // exactly one sim tick per frame
    if (inter) g.juice.setEnabled(n % 2 === 0);
    const r0 = T.render?.[0] ?? 0, s0 = T.sim?.[0] ?? 0, f0 = window.__T2.fxApi[0];
    const t0 = performance.now();
    g.frame(clock);
    const t1 = performance.now();
    if (n >= 2) {
      const p = par[n % 2];
      p[0] += (t1 - t0) - ((T.render?.[0] ?? 0) - r0) - ((T.sim?.[0] ?? 0) - s0);
      p[1] += window.__T2.fxApi[0] - f0;
      p[2]++;
      parS[n % 2].push((t1 - t0) - ((T.render?.[0] ?? 0) - r0) - ((T.sim?.[0] ?? 0) - s0));
      fxDbg.push(+(window.__T2.fxApi[0] - f0).toFixed(2));
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t2 = performance.now();
    frameMs.push(t1 - t0);
    gpuMs.push(t2 - t0);
    calls.push(g.gfx.stats.calls);
    tris.push(g.gfx.stats.tris);
    const st = g.effects.stats();
    mainAlive.push(st.mainAlive);
    glowAlive.push(st.glowAlive);
    dyn.push(g.gfx.dynLights?.stats?.drawn ?? 0);
    voices.push(g.audio.activeVoices ?? 0);
    await new Promise((r) => setTimeout(r, 0));
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const max = (a) => a.reduce((s, v) => Math.max(s, v), 0);
  const per = { fxApiPerFrame: +(window.__T2.fxApi[0] / FRAMES).toFixed(2) };
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? +b[b.length >> 1].toFixed(2) : 0; };
  const interleaved = inter ? { onMedianMs: med(parS[0]), offMedianMs: med(parS[1]), fxDbg: fxDbg.slice(0, 12), onClientMs: +(par[0][0] / par[0][2]).toFixed(2), offClientMs: +(par[1][0] / par[1][2]).toFixed(2), onFxMs: +(par[0][1] / par[0][2]).toFixed(2), offFxMs: +(par[1][1] / par[1][2]).toFixed(2) } : null;
  const callsPerFrame = {};
  for (const [k, v] of Object.entries(window.__T2)) if (k !== 'fxApi') callsPerFrame[k] = +(v / FRAMES).toFixed(2);
  for (const [k, [ms, n]] of Object.entries(T)) per[k] = k === 'juiceEvents' ? +(ms / FRAMES).toFixed(3) : +(ms / Math.max(1, n)).toFixed(2);
  const alive = g.world.units.filter((u) => u.alive).length;
  return {
    units: alive, frames: FRAMES, worldTime: +g.world.time.toFixed(1),
    msPerCall: per, fxCallsPerFrame: callsPerFrame, interleaved,
    cpuFrameMs: +avg(frameMs.slice(2)).toFixed(1), gpuSyncedFrameMs: +avg(gpuMs.slice(2)).toFixed(1),
    calls: Math.round(avg(calls)), callsMax: max(calls), tris: Math.round(avg(tris)), trisMax: max(tris),
    particles: Math.round(avg(mainAlive) + avg(glowAlive)), particlesMax: max(mainAlive.map((m, i) => m + glowAlive[i])),
    dynLights: Math.round(avg(dyn)), dynMax: max(dyn),
    voices: +avg(voices).toFixed(1), voicesMax: max(voices),
    mix: g.audio.mixStats ?? null, audioUnlocked: g.audio.isUnlocked,
    director: g.juice?.stats ?? null,
  };
}, [FRAMES, !!process.env.INTERLEAVE]);
console.log(JSON.stringify({ q, juice, tick0, spawned, ...res }, null, 1));
if (shot) { await page.screenshot({ path: shot, timeout: 180000 }); console.log('shot', shot); }
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
await browser.close();
