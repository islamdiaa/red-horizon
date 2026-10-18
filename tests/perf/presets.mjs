// Graphics-preset benchmark (headless Chromium + SwiftShader): a 150-unit battle inside a burning base and a
// full base at the default zoom, per preset. Reports load time (navigation -> first battle frame), the
// shader-compile phase of the loading screen, compiled programs, draw calls, triangles, CPU frame time and
// GPU-synced frame time (a 1-pixel readback after each frame: SwiftShader's numbers are a proxy for relative GPU
// work, not real FPS). Run any no-HMR server first (a dev server or `vite preview`):
//   node tests/perf/presets.mjs <url[,url2...]> [presets=low,medium,high] [scenes=battle,base] [frames=40]
// Several URLs (two builds, e.g. before / after) are measured interleaved, REPS=n times each, so machine-load drift
// hits both alike. One JSON line per (url, preset, scene, rep). HD=default leaves the model detail to the preset's
// default (Standard on Low); otherwise ?hd=1. Run tools/assets/memguard.sh first: one headless browser at a time.
import { launch } from './lib.mjs';

const [baseArg = 'http://localhost:5282/', presetArg = 'low,medium,high', sceneArg = 'battle,base', framesArg = '40'] = process.argv.slice(2);
const FRAMES = +framesArg;
const bases = baseArg.split(',');
const W = +(process.env.W ?? 1600), H = +(process.env.H ?? 900);
const SCENES = {
  battle: 'scenario=battle&fog=0&size=64&seed=11&tod=dusk',
  base: 'scenario=base&faction=soviet&climate=winter&fog=0&size=64&seed=11&tod=day&hour=10.5&wx=clear',
};

const browser = await launch();
try {
  for (const q of presetArg.split(',')) for (const scene of sceneArg.split(',')) for (let rep = 0; rep < +(process.env.REPS ?? 1); rep++) for (const base of bases) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } }); // fresh: no service worker or cache carried over
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // loading-screen phases: label changes with timestamps (shader compile = "Compiling shaders" -> "Ready")
    await page.addInitScript(() => {
      window.__phases = [];
      const watch = () => {
        const l = document.querySelector('#loading .label');
        if (!l) { requestAnimationFrame(watch); return; }
        // synchronous (the constructor sets several labels in one task): wrap the element's textContent setter
        const d = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
        Object.defineProperty(l, 'textContent', { get() { return d.get.call(this); }, set(v) { window.__phases.push([String(v), performance.now()]); d.set.call(this, v); } });
      };
      watch();
    });
    const hd = process.env.HD === 'default' ? '' : '&hd=1';
    const url = `${base}?autostart=1&intro=0&${SCENES[scene]}&q=${q}${hd}&speed=0.1${process.env.EXTRA ? '&' + process.env.EXTRA : ''}`;
    await page.goto(url, { waitUntil: 'load', timeout: 240000 });
    await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 300000, polling: 100 });
    const load = await page.evaluate(() => {
      const ph = window.__phases;
      const at = (k) => ph.find((p) => p[0].toUpperCase().startsWith(k))?.[1];
      const comp = at('COMPILING'), ready = at('READY');
      return { loadMs: Math.round(performance.now()), compileMs: comp != null && ready != null ? Math.round(ready - comp) : null };
    });
    await page.evaluate(() => {
      const g = window.__game;
      g.running = false;
      cancelAnimationFrame(g.raf);
      while (g.world.tick < 8) { g.world.step(); g.processEvents(); }
    });
    const setup = await page.evaluate((scene) => {
      const g = window.__game, w = g.world;
      if (scene !== 'battle') return { units: w.units.filter((u) => u.alive).length };
      // the fxdc_bench battle: 150+ units fighting their way into the Soviet base, half of which is burning
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
        w.issue({ c: 'move', player: p.id, units: ids, x: cx + (w.map.w / 2 - cx) * 0.3, y: cy + (w.map.h / 2 - cy) * 0.3, attackMove: true });
      }
      bs.filter((b, i) => i % 2 === 1).slice(0, 2).forEach((b) => w.kill(b, 'normal'));
      g.processEvents();
      g.fastForward(9);
      const m = w.map;
      g.gfx.cam.jumpTo(cx + (m.w / 2 - cx) * 0.2, cy + (m.h / 2 - cy) * 0.2 + 1);
      g.gfx.cam.dist = g.gfx.cam.targetDist = 26;
      g.speed = 1;
      return { units: w.units.filter((u) => u.alive).length };
    }, scene);
    const res = await page.evaluate(async (FRAMES) => {
      const g = window.__game;
      const gl = g.gfx.renderer.getContext();
      const px = new Uint8Array(4);
      let clock = performance.now();
      g.last = clock;
      const cpu = [], gpu = [], calls = [], tris = [];
      for (let n = 0; n < FRAMES + 3; n++) {
        clock += 1000 / 20;
        const t0 = performance.now();
        g.frame(clock);
        const t1 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t2 = performance.now();
        if (n < 3) continue; // first-use uploads
        cpu.push(t1 - t0);
        gpu.push(t2 - t0);
        calls.push(g.gfx.stats.calls);
        tris.push(g.gfx.stats.tris);
        await new Promise((r) => setTimeout(r, 0));
      }
      const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
      const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1] ?? 0; };
      return {
        calls: Math.round(avg(calls)), tris: Math.round(avg(tris)),
        cpuMs: +avg(cpu).toFixed(1), cpuMed: +med(cpu).toFixed(1), cpuMin: +Math.min(...cpu).toFixed(1), gpuMs: +avg(gpu).toFixed(1), gpuMed: +med(gpu).toFixed(1), gpuMin: +Math.min(...gpu).toFixed(1),
        programs: g.gfx.renderer.info.programs?.length ?? null,
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null,
        hd: window.__hdStatus ? window.__hdStatus().loaded.length : null, texMB: window.__hdStatus ? window.__hdStatus().textureMB : null,
      };
    }, FRAMES);
    // KNOCK=1: GPU-synced cost of each layer / pass, measured by switching it off for a few frames
    if (process.env.KNOCK) {
      res.knock = await page.evaluate(async (K) => {
        const g = window.__game, gfx = g.gfx, r = gfx.renderer;
        const gl = r.getContext();
        const px = new Uint8Array(4);
        let clock = g.last;
        const run = async () => {
          const t = [];
          for (let n = 0; n < K + 1; n++) {
            clock += 1000 / 20;
            const t0 = performance.now();
            g.frame(clock);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            if (n) t.push(performance.now() - t0);
            await new Promise((res) => setTimeout(res, 0));
          }
          return Math.min(...t); // (the least-disturbed frame: other load on the machine only ever adds time)
        };
        const vis = (o) => { const v = o.visible; o.visible = false; return () => { o.visible = v; }; };
        // (renderer fields, not class names: production builds minify those)
        const pass = (p) => { if (!p || !p.enabled) return null; p.enabled = false; return () => { p.enabled = true; }; };
        const items = {
          terrain: () => { const a = vis(gfx.terrain.mesh), b = vis(gfx.skirt.mesh); return () => { a(); b(); }; },
          vegetation: () => vis(gfx.vegetation.group),
          water: () => vis(gfx.water.mesh),
          entities: () => (g.ents.root ? vis(g.ents.root) : null),
          shadowMap: () => { const sm = r.shadowMap; Object.defineProperty(sm, 'needsUpdate', { configurable: true, get: () => false, set() {} }); return () => { delete sm.needsUpdate; }; },
          softDepth: () => (gfx.softDepth ? vis(gfx.softDepth.marker) : null),
          haze: () => pass(gfx.haze),
          ao: () => pass(gfx.aoPass),
          volumetrics: () => pass(gfx.volumetrics),
          bloom: () => pass(gfx.bloom),
          fxaa: () => pass(gfx.fxaa),
        };
        const out = { all: +(await run()).toFixed(0) };
        for (const [k, f] of Object.entries(items)) {
          const undo = f();
          if (!undo) continue;
          const ms = await run();
          undo();
          out[k] = +(out.all - ms).toFixed(0);
        }
        return out;
      }, +(process.env.KNOCK_FRAMES ?? 6));
    }
    console.log(JSON.stringify({ build: base, q, scene, rep, units: setup.units, ...load, ...res, errors: errors.length ? errors.slice(0, 3) : undefined }));
    if (process.env.SHOT && rep === 0) await page.screenshot({ path: `${process.env.SHOT}-${base.replace(/\W+/g, '_').slice(-12)}-${q}-${scene}.png`, timeout: 180000 });
    await ctx.close();
  }
} finally {
  await browser.close();
}
