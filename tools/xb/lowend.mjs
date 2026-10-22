// Low-end CPU check (the 2-vCPU Ubuntu VM): a battle of N units at 1x, 2x and 5x game speed. Per speed: frame rate and
// frame cost, simulation cost per tick, ticks per second against the target (20 x speed), input delay (key and
// pointer events: handler time minus event time) and long tasks. Graceful degradation at 5x means the frame rate and
// the input delay stay usable while the game runs slower than 5x, not a frame rate that collapses.
//   tools/lab/lab.sh run ubuntu tools/xb/lowend.mjs [browser=chromium] [units=300] [speeds=1,2,5] [secs=25]
// env: Q (preset, low), DYN=1 (Auto render scale on), SCALE (fixed render scale), W / H, CHROME_ARGS, EXTRA (query)
import { launch, instrument, watch, setupBattle, frameStats, sleep, GAME_URL, writeJsonl, browserRssMB } from './vmlib.mjs';

const [name = 'chromium', unitsArg = '300', speedsArg = '1,2,5', secsArg = '25'] = process.argv.slice(2);
const W = +(process.env.W ?? 1366), H = +(process.env.H ?? 768);
const Q = process.env.Q ?? 'low';
const file = `lowend-${name}-${unitsArg}${process.env.TAG ?? ''}.jsonl`;
const browser = await launch(name);
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const log = watch(page);
await page.addInitScript(instrument);
const url = `${GAME_URL}?autostart=1&intro=0&scenario=battle&fog=0&size=96&seed=11&tod=day&q=${Q}&debug=1${process.env.EXTRA ? '&' + process.env.EXTRA : ''}`;
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__game?.running && window.__game.world.tick > 0, null, { timeout: 600000, polling: 500 });
const loadMs = Date.now() - t0;
const setup = await setupBattle(page, +unitsArg);
// DYN=1: Auto render scale as shipped (test URLs switch it off); SCALE=<0.5..1>: a fixed render scale
await page.evaluate(([dyn, scale]) => { const gx = window.__game.gfx; if (dyn) gx.dynamicResolution = true; if (scale) gx.setRenderScaleMode(+scale); }, [!!process.env.DYN, process.env.SCALE ?? null]);
// cost probes: the simulation step, the whole frame, and input delay
await page.evaluate(() => {
  const g = window.__game, w = g.world;
  const st = window.__st = { sim: [], frame: [], key: [], ptr: [] };
  const step = w.step.bind(w);
  w.step = (...a) => { const s = performance.now(); const r = step(...a); st.sim.push(performance.now() - s); return r; };
  const frame = g.frame.bind(g);
  g.frame = (now) => { const s = performance.now(); frame(now); st.frame.push(performance.now() - s); };
  // main-thread cost per subsystem (instance methods wrapped; ms summed over the window)
  st.parts = {};
  const wrap = (label, obj, name) => {
    const f = obj?.[name];
    if (typeof f !== 'function') return;
    const bound = f.bind(obj);
    obj[name] = (...a) => { const s = performance.now(); try { return bound(...a); } finally { st.parts[label] = (st.parts[label] ?? 0) + performance.now() - s; } };
  };
  wrap('events', g, 'processEvents');
  wrap('entities', g.ents, 'update');
  wrap('fog', g.gfx.fog, 'update');
  wrap('input', g.input, 'update');
  wrap('effects', g.effects, 'update');
  wrap('render', g.gfx, 'render');
  wrap('overlay', g.overlay, 'draw');
  wrap('hud', g.hud, 'update');
  wrap('minimap', g.hud?.minimap, 'draw');
  wrap('audio', g.audio, 'update');
  wrap('juice', g.juice, 'update');
  wrap('life', g.life, 'update');
  wrap('props', g.props, 'update');
  wrap('save', g, 'save');
  addEventListener('keydown', (e) => st.key.push(performance.now() - e.timeStamp), true);
  addEventListener('pointermove', (e) => st.ptr.push(performance.now() - e.timeStamp), true);
});
writeJsonl(file, { browser: name, version: browser.version(), url, loadMs, units: setup.units, W, H, cpus: (await import('node:os')).cpus().length });
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1) : null; };
const mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);

for (const speed of speedsArg.split(',').map(Number)) {
  await page.evaluate((s) => { window.__game.speed = s; }, speed);
  await sleep(5000);
  await page.evaluate(() => { const st = window.__st; for (const k of ['sim', 'frame', 'key', 'ptr']) st[k].length = 0; st.parts = {}; window.__t0 = [performance.now(), window.__game.world.tick, window.__long ? { ...window.__long } : null]; });
  // input during the window: a key every 1.5 s, the mouse moving across the map
  const secs = +secsArg;
  const end = Date.now() + secs * 1000;
  const fsP = frameStats(page, secs * 1000 - 500);
  let k = 0;
  while (Date.now() < end - 800) {
    await page.keyboard.press('Shift');
    for (let i = 0; i < 6; i++) await page.mouse.move(300 + ((k * 37 + i * 90) % 700), 200 + ((k * 53 + i * 40) % 300));
    k++;
    await sleep(1500);
  }
  const fps = await fsP;
  const r = await page.evaluate(() => {
    const st = window.__st, g = window.__game, [t, tick, long0] = window.__t0;
    const dt = (performance.now() - t) / 1000;
    const l = window.__long;
    const nf = Math.max(1, st.frame.length);
    return { parts: Object.fromEntries(Object.entries(st.parts).map(([k, v]) => [k, +(v / nf).toFixed(2)]).sort((a, b) => b[1] - a[1])), sim: st.sim, frame: st.frame, key: st.key, ptr: st.ptr, ticksPerS: +((g.world.tick - tick) / dt).toFixed(1), units: g.world.units.filter((u) => u.alive).length, long: l && long0 ? { n: l.n - long0.n, ms: Math.round(l.ms - long0.ms), max: Math.round(l.max) } : null, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
  });
  const rec = {
    browser: name, speed, units: r.units, ...fps,
    frameMs: { mean: mean(r.frame), p50: pct(r.frame, 0.5), p95: pct(r.frame, 0.95), max: pct(r.frame, 1) },
    simMsPerTick: { mean: mean(r.sim), p95: pct(r.sim, 0.95), max: pct(r.sim, 1) },
    msPerFrame: { sim: r.frame.length ? +(r.sim.reduce((a, b) => a + b, 0) / r.frame.length).toFixed(2) : null, ...r.parts },
    ticksPerS: r.ticksPerS, target: 20 * speed, effectiveSpeed: +(r.ticksPerS / 20).toFixed(2),
    simShare: r.frame.length ? +(r.sim.reduce((a, b) => a + b, 0) / r.frame.reduce((a, b) => a + b, 0)).toFixed(2) : null,
    keyDelayMs: { n: r.key.length, p50: pct(r.key, 0.5), max: pct(r.key, 1) }, ptrDelayMs: { n: r.ptr.length, p50: pct(r.ptr, 0.5), p95: pct(r.ptr, 0.95), max: pct(r.ptr, 1) },
    long: r.long, heapMB: r.heapMB, rss: browserRssMB(name), renderScale: await page.evaluate(() => window.__game.gfx.currentRenderScale),
  };
  writeJsonl(file, rec);
}
await page.screenshot({ path: `${process.env.OUT_DIR ?? 'out'}/lowend-${name}.png` });
writeJsonl(file, { done: true, log: log.slice(0, 10) });
await browser.close();
