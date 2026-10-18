// Stress audit: a 300-unit battle (Commander rules) on a preset, stepped frame by frame at 60 fps for N frames.
// Reports the CPU frame-time distribution (main thread: simulation, client systems, GL submission; the GPU is drained
// before each frame, so SwiftShader's backlog does not count), frames over
// 50 ms and what they spent their time on, garbage collections during the run, and the top allocation sites of the
// hot loop (sampling heap profiler, resolved to src/ file:line through Vite's source maps). SwiftShader renders on
// the CPU, so the canvas is kept small: the numbers are main-thread costs, not GPU ones.
//   node tests/perf/stress.mjs [q=medium] [frames=600] [units=300]   (PORT=5190, W/H/PR for the view)
import { startServer, launch, loadSourceMap, originalPosition } from './lib.mjs';

const [Q = 'medium', framesArg = '600', unitsArg = '300'] = process.argv.slice(2);
const FRAMES = +framesArg, UNITS = +unitsArg;
const VIEW = { width: +(process.env.W ?? 960), height: +(process.env.H ?? 540) };
const PR = +(process.env.PR ?? 0.5);
const { server, url } = await startServer(+(process.env.PORT ?? 5190));
const browser = await launch(['--js-flags=--expose-gc']);
const page = await browser.newPage({ viewport: VIEW });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await page.context().newCDPSession(page);
try {
  await page.goto(`${url}?autostart=1&scenario=battle&fog=0&size=96&seed=11&tod=dusk&q=${Q}&rules=commander&demo=0&speed=0.1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 300000, polling: 200 });
  const setup = await page.evaluate(([UNITS, PR]) => {
    const g = window.__game, w = g.world;
    g.running = false;
    cancelAnimationFrame(g.raf);
    g.gfx.renderer.setPixelRatio(PR);
    g.gfx.composer.setPixelRatio?.(PR);
    g.gfx.resize?.();
    const kinds = { allies: ['2tnk', '1tnk', 'e1', 'e1', 'e3', 'jeep', 'e1', 'arty', 'e3', 'apc'], soviet: ['3tnk', 'e1', 'e1', 'e2', '4tnk', 'e4', 'v2rl', 'e1', 'ftrk', 'e3'] };
    const sides = w.players.filter((p) => !p.neutral).slice(0, 2);
    let k = 0;
    while (w.units.filter((u) => u.alive).length < UNITS && k < UNITS * 2) {
      const p = sides[k % 2];
      const own = w.buildings.filter((b) => b.alive && b.owner === p);
      const c = own[0] ?? { x: w.map.w / 2, y: w.map.h / 2 };
      const list = kinds[p.faction] ?? kinds.allies;
      try {
        const [x, y] = w.findFreeSpot(c.x + ((k >> 1) % 10) - 5, c.y + Math.floor((k >> 1) / 10) % 10 - 5, 10);
        w.addUnit(list[(k >> 1) % list.length], p, x, y);
      } catch { /* no room */ }
      k++;
    }
    w.dirtyLists = true;
    for (const p of sides) {
      const ids = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
      w.issue({ c: 'move', player: p.id, units: ids, x: w.map.w / 2, y: w.map.h / 2, attackMove: true });
    }
    g.fastForward(12); // to contact
    g.gfx.cam.jumpTo(w.map.w / 2, w.map.h / 2 + 2);
    g.speed = 1;
    return { units: w.units.filter((u) => u.alive).length };
  }, [UNITS, PR]);

  const run = async (n, sample) => page.evaluate(async ([n, sample]) => {
    const g = window.__game;
    const T = (window.__stressT ??= {});
    const wrap = (obj, name, key) => {
      if (!obj?.[name] || obj[name].__wrapped) return;
      const f = obj[name].bind(obj);
      const w = (...a) => { const t = performance.now(); try { return f(...a); } finally { (T[key] ??= []).push(performance.now() - t); } };
      w.__wrapped = true;
      obj[name] = w;
    };
    wrap(g.gfx, 'render', 'render');
    wrap(g.effects, 'update', 'effects');
    wrap(g.ents, 'update', 'ents');
    wrap(g.world, 'step', 'sim');
    wrap(g.hud, 'update', 'hud');
    for (const k of ['overlay', 'walls', 'tracks', 'props', 'lightPools', 'life', 'juice', 'crates', 'audio', 'input', 'minimap', 'wakes', 'bridges']) {
      const o = g[k] ?? g.hud?.[k];
      if (o) wrap(o, typeof o.update === 'function' ? 'update' : 'draw', k);
    }
    wrap(g, 'processEvents', 'events');
    for (const k of Object.keys(T)) T[k].length = 0;
    let clock = performance.now();
    g.last = clock;
    const ft = [], slow = [];
    const gl = g.gfx.renderer.getContext();
    const px = new Uint8Array(4);
    for (let i = 0; i < n; i++) {
      for (const k of Object.keys(T)) T[k].length = 0;
      clock += 1000 / 60;
      // drain the GPU first (SwiftShader lags far behind under load): the frame then measures the main thread only
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      g.frame(clock);
      const dt = performance.now() - t0;
      ft.push(dt);
      if (dt > 50 && !sample) slow.push({ i, ms: +dt.toFixed(1), parts: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, +v.reduce((a, b) => a + b, 0).toFixed(1)])) });
      if (i % 30 === 29) await new Promise((r) => setTimeout(r, 0)); // let the GPU process and timers breathe
    }
    const s = [...ft].sort((a, b) => a - b);
    const q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
    return { frames: n, mean: +(ft.reduce((a, b) => a + b, 0) / n).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over50: ft.filter((x) => x > 50).length, slow: slow.slice(0, 8), units: g.world.units.filter((u) => u.alive).length, calls: g.gfx.stats.calls };
  }, [n, sample]);

  await run(60, true); // warm-up (first-use uploads, compiles)
  // GC share from the CPU profile's "(garbage collector)" samples, plus the heap delta
  const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  const res = await run(FRAMES, false);
  const { profile } = await cdp.send('Profiler.stop');
  if (process.env.CPUPROFILE) (await import('node:fs')).writeFileSync(process.env.CPUPROFILE, JSON.stringify(profile)); // open in DevTools
  const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  // the autosave (every two minutes of play) serialises the whole world on the main thread: a spike candidate
  const saveMs = await page.evaluate(async () => {
    const g = window.__game;
    const t = [];
    for (let i = 0; i < 3; i++) { const t0 = performance.now(); g.save('stress'); t.push(performance.now() - t0); }
    try { for (const k of Object.keys(localStorage)) if (k.endsWith('stress')) localStorage.removeItem(k); } catch { /* storage unavailable */ }
    // the parts: building the snapshot, JSON, the storage write (dev server: the app's own module instance)
    const parts = {};
    try {
      const sv = await import('/src/sim/save.ts');
      let t0 = performance.now();
      const w = sv.serializeWorld(g.world);
      parts.serialize = +(performance.now() - t0).toFixed(1);
      t0 = performance.now();
      const json = JSON.stringify(w);
      parts.stringify = +(performance.now() - t0).toFixed(1);
      parts.kb = Math.round(json.length / 1024);
      t0 = performance.now();
      localStorage.setItem('rh.stress.tmp', json);
      parts.store = +(performance.now() - t0).toFixed(1);
      localStorage.removeItem('rh.stress.tmp');
    } catch { /* production build */ }
    return { total: +Math.min(...t).toFixed(1), ...parts };
  });
  let gcUs = 0, totalUs = 0;
  const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
  profile.samples.forEach((id, k) => {
    const n = nodes.get(id);
    const d = profile.timeDeltas[k] ?? 0;
    totalUs += d;
    if (n?.callFrame.functionName === '(garbage collector)') gcUs += d;
  });
  // allocation sites: sampling heap profiler over a shorter run
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const AF = Math.min(300, FRAMES);
  await run(AF, true);
  const { profile: hp } = await cdp.send('HeapProfiler.stopSampling');
  const sites = new Map();
  const chains = new Map(); // site -> heaviest caller chain
  const label = async (cf) => {
    if (!cf.url) return cf.functionName || '(anonymous)';
    const sm = /\/src\/|\/deps\//.test(cf.url) ? await loadSourceMap(cf.url) : null;
    const pos = sm ? originalPosition(sm, cf.lineNumber, cf.columnNumber) : null;
    const where = pos ? `${pos.file.replace(/^.*?\/(src\/|node_modules\/)/, '$1')}:${pos.line}` : new URL(cf.url).pathname;
    return `${cf.functionName || '(anonymous)'} @ ${where}`;
  };
  const walk = async (node, stack) => {
    const here = [...stack, node.callFrame];
    if (node.selfSize > 0 && node.callFrame.url) {
      const key = await label(node.callFrame);
      sites.set(key, (sites.get(key) ?? 0) + node.selfSize);
      const best = chains.get(key);
      if (!best || best.size < node.selfSize) chains.set(key, { size: node.selfSize, stack: here });
    }
    for (const c of node.children ?? []) await walk(c, here);
  };
  await walk(hp.head, []);
  const top = [...sites].sort((a, b) => b[1] - a[1]).slice(0, +(process.env.TOP ?? 15));
  const totalAlloc = [...sites.values()].reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ q: Q, view: `${VIEW.width}x${VIEW.height}@${PR}`, unitsAtStart: setup.units, ...res, gcPct: +((100 * gcUs) / Math.max(1, totalUs)).toFixed(1), saveMs, heapDeltaMB: +((heap1 - heap0) / 1048576).toFixed(1) }));
  console.log(`allocations sampled over ${AF} frames: ${(totalAlloc / 1048576).toFixed(1)} MB (${(totalAlloc / AF / 1024).toFixed(1)} KB/frame); top sites:`);
  for (const [k, v] of top) {
    console.log(`  ${(v / 1024).toFixed(0).padStart(7)} KB  ${k}`);
    if (process.env.CHAINS) { // the heaviest caller chain of the site (innermost first)
      const st = chains.get(k)?.stack ?? [];
      const names = [];
      for (const cf of st.slice(-9, -1).reverse()) names.push((await label(cf)).replace(/ @ (src|node_modules)\//, ' @ '));
      console.log(`            <- ${names.join(' <- ')}`);
    }
  }
  console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
} finally {
  await browser.close();
  await server.close();
}
