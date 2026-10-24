// A/B frame cost of two builds on the real GPU, robust to a drifting GPU clock (a shared iGPU slows down when the host's
// CPU cores are busy): both builds run the bigmatch.mjs late-game scene (four Brutal commanders on a 128 map,
// fast-forwarded, camera on the busiest fight) in two pages of one browser, and every measurement alternates A, B, A,
// B... Per preset it prints the GPU time per pass (timer queries, median of each round) and, with FPS=1, the frame
// rate of the game's own loop at a fixed 100 % render scale and at Auto.
//   node tools/gpu-rig/perfab.mjs <urlA> <urlB> [presets=low] [rounds=4] [minutes=13] [map=coastline] [outDir=/out]
import fs from 'node:fs';
import { launchGpu, installProbe } from './lib.mjs';

const [urlA, urlB, presetArg = 'low', roundArg = '4', minArg = '13', map = 'coastline', out = '/out'] = process.argv.slice(2);
const W = +(process.env.W ?? 1920), H = +(process.env.H ?? 1080);
const SECS = +(process.env.SECS ?? 15);
const T0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - T0) / 1000).toFixed(0).padStart(5)}s`, ...a);
const label = (u) => u.replace(/\/+$/, '').split('/').pop();
const browser = await launchGpu(undefined, []);
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };

async function open(base, q) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript((Q) => localStorage.setItem('rh.settings', JSON.stringify({ quality: Q, renderScale: 1, skipIntro: true, fullscreen: false, hints: false })), q);
  const page = await ctx.newPage();
  const msgs = [];
  page.on('pageerror', (e) => msgs.push(['pageerror', e.message.slice(0, 300)]));
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /THREE|WebGL|GL_|shader|program|INVALID/i.test(m.text()))) msgs.push([m.type(), m.text().slice(0, 300)]); });
  await page.goto(`${base}?autostart=1&map=${map}&ai=brutal&selfplay=brutal&fog=0&q=${q}&seed=7&debug=1&intro=0`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game?.running && window.__game.world.tick > 0, null, { timeout: 240000, polling: 250 });
  await page.evaluate(async (MIN) => {
    const g = window.__game, w = g.world;
    while (w.time < MIN * 60 && !w.gameOver) { g.fastForward(Math.min(30, MIN * 60 - w.time + 0.05)); await new Promise((r) => requestAnimationFrame(() => r())); }
    const us = w.units.filter((u) => u.alive && u.weapons.length);
    let best = us[0], bestN = -1;
    for (const u of us) { let n = 0; for (const v of us) if (u.owner.isEnemy(v.owner) && Math.abs(v.x - u.x) < 10 && Math.abs(v.y - u.y) < 10) n++; if (n > bestN) { bestN = n; best = u; } }
    g.gfx.cam.jumpTo(best.x, best.y); g.gfx.cam.dist = g.gfx.cam.targetDist = 26;
    g.gfx.dynamicResolution = false; g.gfx.setRenderScaleMode(1);
  }, +minArg);
  // a few seconds of real time so effects and fires fill in
  await page.waitForTimeout(5000);
  const info = await page.evaluate(installProbe);
  return { ctx, page, msgs, info, label: label(base) };
}

/** The game's own loop for `secs` (rAF interval = what a player sees), at a fixed 100 % scale or Auto. */
const fpsRun = (page, secs, dyn) => page.evaluate(async ([SECS, DYN]) => {
  const g = window.__game;
  g.gfx.dynamicResolution = DYN;
  g.gfx.setRenderScaleMode(DYN ? 'auto' : 1);
  cancelAnimationFrame(g.raf);
  g.running = true;
  g.last = performance.now();
  const t = [], cpu = [];
  let prev = performance.now();
  await new Promise((res) => {
    const end = prev + SECS * 1000;
    const loop = (now) => {
      if (now > end) { res(); return; }
      g.raf = requestAnimationFrame(loop);
      t.push(now - prev);
      prev = now;
      const f0 = performance.now();
      g.frame(now);
      cpu.push(performance.now() - f0);
    };
    g.raf = requestAnimationFrame(loop);
  });
  cancelAnimationFrame(g.raf);
  g.running = false;
  const scale = g.gfx.currentRenderScale;
  const k = Math.floor(t.length * 0.4);
  const tt = t.slice(k), cc = cpu.slice(k).sort((a, b) => a - b);
  const mean = tt.reduce((a, b) => a + b, 0) / Math.max(1, tt.length);
  g.gfx.dynamicResolution = false;
  g.gfx.setRenderScaleMode(1);
  const ts = [...tt].sort((a, b) => a - b);
  return { fps: +(1000 / mean).toFixed(1), cpuMed: +(cc[cc.length >> 1] ?? 0).toFixed(1), scale: +scale.toFixed(2), p50: +(ts[ts.length >> 1] ?? 0).toFixed(1), p95: +(ts[Math.floor(ts.length * 0.95)] ?? 0).toFixed(1) };
}, [secs, dyn]);

/** GPU time of whole frames (one timer query around the game's frame: shadow map, particle and water simulation, every pass). */
const frameGpu = (page, n) => page.evaluate(async (N) => {
  const g = window.__game, gl = g.gfx.renderer.getContext();
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!tq) return null;
  const px = new Uint8Array(4), out = [], pending = [];
  for (let i = 0; i < N; i++) {
    const q = gl.createQuery();
    gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
    window.__clock += 1000 / 60;
    g.frame(window.__clock);
    gl.endQuery(tq.TIME_ELAPSED_EXT);
    pending.push(q);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    await new Promise((r) => setTimeout(r, 0));
  }
  for (let k = 0; k < 50 && pending.length; k++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const q = pending[i];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
      pending.splice(i, 1);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  out.sort((a, b) => a - b);
  return { med: +(out[out.length >> 1] ?? 0).toFixed(2), p90: +(out[Math.floor(out.length * 0.9)] ?? 0).toFixed(2), n: out.length };
}, n);

/** GPU time of the shadow-map render alone (timer query around renderer.shadowMap.render), median over frames that drew one. */
const shadowGpu = (page, n) => page.evaluate(async (N) => {
  const g = window.__game, r = g.gfx.renderer, gl = r.getContext();
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!tq || !r.shadowMap.enabled) return null;
  const orig = r.shadowMap.render, pending = [], out = [];
  r.shadowMap.render = function (...a) {
    if (!this.needsUpdate && !this.autoUpdate) return orig.apply(this, a);
    const q = gl.createQuery();
    gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
    try { return orig.apply(this, a); } finally { gl.endQuery(tq.TIME_ELAPSED_EXT); pending.push(q); }
  };
  const px = new Uint8Array(4);
  try {
    for (let i = 0; i < N; i++) { window.__clock += 1000 / 60; g.frame(window.__clock); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); await new Promise((res) => setTimeout(res, 0)); }
  } finally { r.shadowMap.render = orig; }
  for (let k = 0; k < 50 && pending.length; k++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (!gl.getQueryParameter(pending[i], gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) out.push(gl.getQueryParameter(pending[i], gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(pending[i]); pending.splice(i, 1);
    }
    await new Promise((res) => setTimeout(res, 20));
  }
  out.sort((a, b) => a - b);
  return out.length ? +out[out.length >> 1].toFixed(2) : null;
}, n);

const results = [];
for (const q of presetArg.split(',')) {
  const pages = [await open(urlA, q), await open(urlB, q)];
  log(q, 'pages ready', pages.map((p) => p.label).join(' / '));
  const per = pages.map(() => ({}));
  for (let r = 0; r < +roundArg; r++) {
    for (let i = 0; i < 2; i++) {
      const t = await pages[i].page.evaluate(async () => { await window.__rig.timers(6); return window.__rig.timers(24); });
      for (const [k, v] of Object.entries(t?.passes ?? {})) (per[i][k] ??= []).push(v);
      (per[i].total ??= []).push(t?.gpuTotal ?? 0);
      const fr = await frameGpu(pages[i].page, 24);
      if (fr) { (per[i].frame ??= []).push(fr.med); (per[i].frameP90 ??= []).push(fr.p90); }
      const sh = await shadowGpu(pages[i].page, 12);
      if (sh != null) (per[i].shadowMap ??= []).push(sh);
    }
  }
  const rec = { q, a: pages[0].label, b: pages[1].label, passes: {}, fps: null, renderer: pages[0].info.renderer };
  for (const k of Object.keys(per[0])) {
    const a = med(per[0][k]), b = med(per[1][k] ?? []);
    rec.passes[k] = { a: +a.toFixed(2), b: b == null ? null : +b.toFixed(2), ratio: b == null || !a ? null : +(b / a).toFixed(3) };
  }
  for (const [k, v] of Object.entries(rec.passes)) log(q, k.padEnd(12), `${rec.a} ${String(v.a).padStart(7)}`, `${rec.b} ${String(v.b).padStart(7)}`, `x${v.ratio}`);
  if (process.env.FPS === '1') {
    const f = { fixedA: [], fixedB: [], autoA: [], autoB: [] };
    for (let r = 0; r < 2; r++) {
      f.fixedA.push(await fpsRun(pages[0].page, SECS, false)); f.fixedB.push(await fpsRun(pages[1].page, SECS, false));
      f.autoA.push(await fpsRun(pages[0].page, SECS + 5, true)); f.autoB.push(await fpsRun(pages[1].page, SECS + 5, true));
    }
    rec.fps = f;
    for (const [k, v] of Object.entries(f)) log(q, k.padEnd(7), v.map((x) => `${x.fps} fps (cpu ${x.cpuMed}, rAF p50 ${x.p50} p95 ${x.p95} ms, scale ${x.scale})`).join(' | '));
  }
  rec.messages = pages.map((p) => p.msgs.slice(0, 8));
  results.push(rec);
  for (const p of pages) await p.ctx.close();
}
fs.appendFileSync(`${out}/perfab.jsonl`, results.map((r) => JSON.stringify({ ...r, at: new Date().toISOString() })).join('\n') + '\n');
await browser.close();
