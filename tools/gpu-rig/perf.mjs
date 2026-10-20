// Real-GPU frame rate per preset: a 150- or 300-unit battle in a burning base (the tests/perf/presets.mjs scene).
//   node tools/gpu-rig/perf.mjs <base-url> [presets=low,medium,high] [units=150,300] [outDir=/out]
// Per preset and army size:
//   fps      free-running game loop (vsync and the frame-rate limit off), 6 s, mean and 5th-percentile FPS
//   synced   median CPU + GPU time of one frame (each frame waits for the GPU)
//   passes   median GPU time per post pass (EXT_disjoint_timer_query_webgl2); 'scenePass' includes the shadows
import fs from 'node:fs';
import { launchGpu, openMatch, setupBattle } from './lib.mjs';

const [base = 'http://127.0.0.1:5291/', presetArg = 'low,medium,high', unitsArg = '150,300', out = '/out'] = process.argv.slice(2);
const W = +(process.env.W ?? 1920), H = +(process.env.H ?? 1080);
const outFile = `${out}/perf-${presetArg.replace(/,/g, '-')}-hd${process.env.HD ?? '1'}${process.env.DYN ? '-dyn' : ''}${process.env.TAG ?? ''}.jsonl`;
fs.writeFileSync(outFile, '');
// VSYNC=1: the normal 60 Hz frame pacing (as players run it; dynamic resolution needs real frame times)
const browser = await launchGpu(undefined, process.env.VSYNC ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit']);
const hd = process.env.HD ?? '1';

for (const q of presetArg.split(',')) for (const n of unitsArg.split(',').map(Number)) {
  const url = `${base}?autostart=1&intro=0&scenario=battle&fog=0&size=64&seed=11&tod=dusk&q=${q}&hd=${hd}${process.env.EXTRA ? '&' + process.env.EXTRA : ''}`;
  const s = await openMatch(browser, url, { width: W, height: H });
  const setup = await setupBattle(s.page, n);
  const timers = await s.page.evaluate(() => window.__rig.timers(40));
  // free-running: the game's own loop, as a player sees it
  const fps = await s.page.evaluate(async ([DYN, SECS]) => {
    const g = window.__game;
    if (DYN) g.gfx.dynamicResolution = true; // the shipped behaviour (test URLs switch it off)
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
    g.running = false;
    cancelAnimationFrame(g.raf);
    // the steady state: the last 4 s (dynamic resolution settles first)
    let acc = 0, k = t.length;
    while (k > 10 && acc < 4000) acc += t[--k];
    t.splice(0, k);
    const sorted = [...t].sort((a, b) => a - b);
    const mean = t.reduce((a, b) => a + b, 0) / t.length;
    return { fps: +(1000 / mean).toFixed(1), p5fps: +(1000 / sorted[Math.floor(sorted.length * 0.95)]).toFixed(1), frames: t.length, calls: g.gfx.stats.calls, tris: g.gfx.stats.tris, renderScale: g.gfx.currentRenderScale ?? null, frameJs: (() => { const c = [...cpu].sort((a, b) => a - b); return { med: +c[c.length >> 1].toFixed(1), p95: +c[Math.floor(c.length * 0.95)].toFixed(1), max: +c[c.length - 1].toFixed(1), over150: c.filter((x) => x > 150).length, n: c.length }; })(), dbg: { paused: g.paused, demo: !!g.setup.demo, dyn: g.gfx.dynamicResolution, mode: g.gfx.scaleMode, bad: g.gfx.badWindows, good: g.gfx.goodWindows, acc: Math.round(g.gfx.frameAcc), n: g.gfx.frameN } };
  }, [!!process.env.DYN, +(process.env.SECS ?? 6)]);
  const rec = { q, units: setup.units, W, H, ...fps, syncedMs: timers?.frameMs, gpuMs: timers?.gpuTotal, passes: timers?.passes, mem: await s.page.evaluate(() => ({ heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, hdTexMB: window.__hdStatus?.().textureMB })), log: s.log.slice(0, 5) };
  if (process.env.SHOT) await s.page.screenshot({ path: `${out}/perf-${q}-${n}${process.env.DYN ? '-auto' : ''}.png` });
  fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
  console.log(JSON.stringify(rec));
  await s.ctx.close();
}
await browser.close();
