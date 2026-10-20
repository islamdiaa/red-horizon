// Effective game speed: a big battle at x5 (or any speed) with the real frame loop (12 ticks a frame at most, frame
// time clamped to 100 ms). Each frame's timestamp advances by what the previous frame cost the main thread (at least
// 1/60 s), so the run measures how much game time the CPU side (simulation, events, client systems, GL submission)
// delivers per real second when the GPU keeps up (SwiftShader's GPU backlog is drained outside the timing).
//   node tests/perf/speed.mjs [q=medium] [seconds=30] [units=400] [speed=5]   (PORT=5190, W/H/PR for the view)
import { startServer, launch } from './lib.mjs';

const [Q = 'medium', secondsArg = '30', unitsArg = '400', speedArg = '5'] = process.argv.slice(2);
const SECONDS = +secondsArg, SPEED = +speedArg;
const UNITS = +unitsArg;
const VIEW = { width: +(process.env.W ?? 960), height: +(process.env.H ?? 540) };
const PR = +(process.env.PR ?? 0.5);
const { server, url } = await startServer(+(process.env.PORT ?? 5190));
const browser = await launch();
const page = await browser.newPage({ viewport: VIEW });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await page.context().newCDPSession(page);
try {
  await page.goto(`${url}?autostart=1&scenario=battle&fog=0&size=96&seed=11&tod=dusk&q=${Q}&rules=commander&demo=0&speed=0.1`, { waitUntil: 'load' });
  console.error('speed: page loading');
  await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 300000, polling: 200 });
  console.error('speed: game running, adding units');
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

  console.error('speed: battle ready', JSON.stringify(setup));
  const res = await page.evaluate(async ([SECONDS, SPEED]) => {
    const g = window.__game, w = g.world;
    const gl = g.gfx.renderer.getContext();
    const px = new Uint8Array(4);
    const T = { sim: 0, frames: 0 };
    const step = w.step.bind(w);
    let simMs = 0, ticks = 0;
    const tickMs = [];
    w.step = () => { const t = performance.now(); step(); const d = performance.now() - t; simMs += d; ticks++; tickMs.push(d); };
    g.speed = SPEED;
    let clock = performance.now(), wall = 0;
    g.last = clock;
    const t0tick = w.tick, ft = [];
    let warm = 0;
    while (wall < SECONDS * 1000) {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // drain the GPU outside the timing
      const a = performance.now();
      g.frame(clock);
      const cost = performance.now() - a;
      const adv = Math.max(1000 / 60, cost);
      clock += adv;
      if (warm++ > 20) { wall += adv; ft.push(cost); }
      else { simMs = 0; ticks = 0; tickMs.length = 0; }
      if (warm % 20 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const s = [...ft].sort((x, y) => x - y), q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
    const ts = [...tickMs].sort((x, y) => x - y), tq = (p) => +ts[Math.min(ts.length - 1, Math.floor(p * ts.length))].toFixed(2);
    return {
      speed: SPEED, wallSeconds: +(wall / 1000).toFixed(1), ticks, effectiveSpeed: +(ticks / 20 / (wall / 1000)).toFixed(2),
      fps: +(ft.length / (wall / 1000)).toFixed(1), frameMs: { p50: q(0.5), p95: q(0.95), max: q(1) },
      simShare: +(simMs / wall).toFixed(2), tickMs: { mean: +(simMs / Math.max(1, ticks)).toFixed(2), p50: tq(0.5), p95: tq(0.95), max: tq(1) },
      units: w.units.filter((u) => u.alive).length, tick: w.tick - t0tick,
    };
  }, [SECONDS, SPEED]);
  console.log(JSON.stringify({ q: Q, ...setup, ...res, errors: errors.slice(0, 5) }, null, 1));
} finally {
  await browser.close();
  await server.close();
}
