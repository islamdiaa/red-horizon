// World Conquest QA: the globe's frame rate on the real GPU (round 6 contract: "The globe runs at 60 fps on Low on an
// iGPU"). Runs inside the gpu-rig container (tools/gpu-rig/README.md), like tools/gpu-rig/perf.mjs:
//
//   $RIG tools/world/qa-globe-perf.mjs http://127.0.0.1:5326/ [presets=low,medium,high] [states=new,fresh,world,attack] [outDir=/out]
//
// For each preset and screen state (the UI's ?world= test states: new = the homeland picker, fresh = a Blitz run's
// first turn, world = a World run's first turn (~100 territories), attack = a selected attack, arrows pulsing), the
// globe turns continuously (rotateBy every frame, as a drag does) and the script records:
//   vsync    the frame rate with the normal 60 Hz pacing (what a player sees; 60 is the target)
//   free     the free-running frame rate (vsync and the frame-rate limit off: headroom)
//   gpuMs    GPU time of the globe's render (timer queries, median), cpuMs = JS time of a frame (render + overlay)
// W/H (default 1920x1080), SECS (default 6) and SETTLE (ms after load, default 2500) are environment variables.
// (The free-running pass counts rAF callbacks, which fire without new frames: read its gpuMs / globeFps, not fps.)
import fs from 'node:fs';
import { launchGpu } from '../gpu-rig/lib.mjs';

const [base = 'http://127.0.0.1:5326/', presetArg = 'low', stateArg = 'new,fresh,world,attack', out = '/out'] = process.argv.slice(2);
const W = +(process.env.W ?? 1920), H = +(process.env.H ?? 1080), SECS = +(process.env.SECS ?? 6);
const outFile = `${out}/globe-perf-${W}x${H}.jsonl`;
const STATE = { new: 'world=new', fresh: 'world=fresh&size=blitz', world: 'world=fresh&size=world', attack: 'world=attack&size=world' };

async function measure(browser, preset, state, vsync) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript((Q) => { try { localStorage.setItem('rh.settings', JSON.stringify({ quality: Q, renderScale: 1, skipIntro: true, hints: false })); localStorage.setItem('rh.firstRun', '0'); } catch { /* */ } }, preset);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await page.goto(`${base}?debug=1&${STATE[state]}&seed=1953`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__world?.globe?.ok !== undefined && window.__world.globe.w > 0, null, { timeout: 120000, polling: 250 });
  await page.waitForTimeout(+(process.env.SETTLE ?? 2500)); // (SETTLE: ms to wait first, e.g. for the picker's landmark thumbnails)
  const r = await page.evaluate(async (SECS) => {
    const gl0 = window.__world.globe;
    const renderer = gl0.renderer, gl = renderer?.getContext?.();
    const ext = gl && gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const queries = [], gpu = [], cpu = [];
    // time each globe render on the GPU and each frame's JS
    const orig = renderer.render.bind(renderer);
    renderer.render = (s, c) => {
      let q = null;
      if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      orig(s, c);
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(q); }
    };
    const frame0 = gl0.frame.bind(gl0);
    gl0.frame = (now) => { const t = performance.now(); frame0(now); cpu.push(performance.now() - t); };
    const poll = () => { for (let i = queries.length - 1; i >= 0; i--) { const q = queries[i]; if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); queries.splice(i, 1); } } };
    const dts = [];
    let prev = performance.now();
    await new Promise((res) => {
      const end = prev + SECS * 1000;
      const tick = (now) => {
        gl0.rotateBy(0.35, 0); // (a steady drag)
        dts.push(now - prev); prev = now;
        if (ext) poll();
        if (now > end) { res(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    renderer.render = orig;
    gl0.frame = frame0;
    const tail = dts.slice(Math.floor(dts.length * 0.2));
    const sorted = [...tail].sort((a, b) => a - b), med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(2) : null; };
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    return {
      fps: +(1000 / mean).toFixed(1), p5fps: +(1000 / sorted[Math.floor(sorted.length * 0.95)]).toFixed(1), frames: tail.length,
      gpuMs: med(gpu), gpuP95: gpu.length ? +[...gpu].sort((a, b) => a - b)[Math.floor(gpu.length * 0.95)].toFixed(2) : null, cpuMs: med(cpu), cpuP95: cpu.length ? +[...cpu].sort((a, b) => a - b)[Math.floor(cpu.length * 0.95)].toFixed(2) : null,
      territories: window.__world.run?.territories.length ?? window.__world.sites?.ids?.length ?? null, globeFps: gl0.fps, dpr: gl0.dpr,
      renderer: gl ? (gl.getExtension('WEBGL_debug_renderer_info') ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : 'n/a') : 'no webgl',
    };
  }, SECS);
  await ctx.close();
  return { preset, state, vsync, W, H, ...r, errors: errs.slice(0, 3) };
}

fs.writeFileSync(outFile, '');
for (const vsync of [true, false]) {
  const browser = await launchGpu(undefined, vsync ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit']);
  for (const preset of presetArg.split(',')) for (const state of stateArg.split(',')) {
    const rec = await measure(browser, preset, state, vsync).catch((e) => ({ preset, state, vsync, error: String(e).slice(0, 300) }));
    fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
    console.log(JSON.stringify(rec));
  }
  await browser.close();
}
