// The biggest match the game hosts, on the real GPU: four Brutal commanders (three opponents plus the local side played
// by a Brutal AI) on a 128-cell four-player map, fast-forwarded until the armies are large, then played on in real time
// with the camera on the busiest fight. Per quality preset it measures what a player sees at a fixed 100 % render scale
// and at the default Auto scale (dynamic resolution): frame times (vsync on, as players run it), the game's CPU time
// per frame, GPU time per post pass, the HDR targets scanned for non-finite values, shader and GL errors, and memory.
//   node tools/gpu-rig/bigmatch.mjs <base-url> [presets=high] [minutes=13] [map=coastline] [outDir=/out]
// EXTRA=<n> adds n units per commander and sends every army to the middle (an eight-commander-sized battle).
// Runs in the real-GPU rig (tools/gpu-rig/README.md; tools/xb/rig.sh with XB_MEM=4g): one JSON line per preset in
// <outDir>/bigmatch-<presets><TAG>.jsonl, plus a screenshot per preset.
import fs from 'node:fs';
import { launchGpu, installProbe } from './lib.mjs';

const [base = 'http://127.0.0.1:8815/', presetArg = 'high', minArg = '13', map = 'coastline', out = '/out'] = process.argv.slice(2);
const W = +(process.env.W ?? 1920), H = +(process.env.H ?? 1080);
const SECS = +(process.env.SECS ?? 20);
const outFile = `${out}/bigmatch-${presetArg.replace(/,/g, '-')}${process.env.EXTRA ? `-x${process.env.EXTRA}` : ''}${process.env.TAG ?? ''}.jsonl`;
const T0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - T0) / 1000).toFixed(0).padStart(5)}s`, ...a);
const cgroupMB = () => { try { return Math.round(+fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8') / 1048576); } catch { return null; } };
const browser = await launchGpu(undefined, []);

// 'detect': the preset the game picks for this GPU on a first launch (src/platform/gpu.ts detectQuality)
let detected = null;
if (presetArg.split(',').includes('detect')) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.goto(`${base}?debug=1`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('.mm-nav-btn', { timeout: 180000 });
  detected = await page.evaluate(() => JSON.parse(localStorage.getItem('rh.settings') ?? '{}').quality ?? null);
  log('detected preset', detected);
  await ctx.close();
}
for (const qa of presetArg.split(',')) {
  const q = qa === 'detect' ? detected ?? 'medium' : qa;
  const rec = { q, detected: qa === 'detect', map, W, H, minutes: +minArg };
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript((Q) => {
    localStorage.setItem('rh.settings', JSON.stringify({ quality: Q, renderScale: 'auto', skipIntro: true, fullscreen: false, hints: false }));
  }, q);
  const page = await ctx.newPage();
  const msgs = [];
  page.on('pageerror', (e) => msgs.push(['pageerror', e.message.slice(0, 400)]));
  page.on('console', (m) => {
    const t = m.type(), s = m.text();
    if (/WebGL context was lost|WEBGL_debug_renderer_info is deprecated|GPU stall due to ReadPixels/.test(s)) return;
    if (t === 'error' || (t === 'warning' && /THREE|WebGL|GL_|shader|program|INVALID|framebuffer|NaN/i.test(s))) msgs.push([t, s.slice(0, 600)]);
  });
  const url = `${base}?autostart=1&map=${map}&ai=brutal&selfplay=brutal&fog=0&q=${q}&seed=7&debug=1&intro=0`;
  rec.url = url;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__game?.running && window.__game.world.tick > 0, null, { timeout: 240000, polling: 250 });
    rec.loadS = Math.round((Date.now() - T0) / 1000);
    rec.players = await page.evaluate(() => window.__game.world.players.map((p) => `${p.faction}:${p.isHuman ? 'local' : 'ai'}`));
    // ---- fast-forward to the late game (the simulation only; a frame drawn between chunks keeps the page alive)
    const ff0 = Date.now();
    for (;;) {
      const t = await page.evaluate(async (MIN) => {
        const g = window.__game, w = g.world;
        if (w.time < MIN * 60 && !w.gameOver) g.fastForward(Math.min(30, MIN * 60 - w.time + 0.05));
        await new Promise((r) => requestAnimationFrame(() => r()));
        return { t: w.time, over: w.gameOver, units: w.units.filter((u) => u.alive).length };
      }, +minArg);
      if (t.over || t.t >= +minArg * 60) { rec.ff = { wallS: Math.round((Date.now() - ff0) / 1000), ...t }; break; }
    }
    log(q, 'ff done', JSON.stringify(rec.ff));
    // EXTRA=<n>: n more units per commander, then every army attack-moves to the middle (the size of battle an
    // eight-commander match would bring, which the game's four seats cannot), fast-forwarded until they meet
    if (+(process.env.EXTRA ?? 0) > 0) {
      rec.extra = await page.evaluate((N) => {
        const g = window.__game, w = g.world;
        const mix = {
          allies: ['2tnk', '2tnk', '1tnk', 'jeep', 'apc', 'arty', 'e1', 'e1', 'e1', 'e3', 'e3', 'e1', 'e1', 'e3', '2tnk', '1tnk', 'e1', 'e1', 'e3', 'heli'],
          soviet: ['3tnk', '3tnk', '4tnk', 'v2rl', 'e1', 'e1', 'e2', 'e2', 'e4', 'e1', 'e1', 'e3', '3tnk', 'e1', 'e2', 'dog', 'e1', 'e3', 'ftrk', 'hind'],
        };
        const mid = { x: w.map.w / 2, y: w.map.h / 2 };
        let added = 0;
        for (const p of w.players) {
          if (p.defeated) continue;
          const own = w.buildings.filter((b) => b.alive && b.owner === p);
          if (!own.length) continue;
          const ox = own.reduce((a, b) => a + b.x, 0) / own.length, oy = own.reduce((a, b) => a + b.y, 0) / own.length;
          const bx = ox + (mid.x - ox) * 0.35, by = oy + (mid.y - oy) * 0.35;
          const list = mix[p.faction] ?? mix.allies;
          for (let j = 0; j < N; j++) {
            try {
              const [x, y] = w.findFreeSpot(bx + (j % 10) - 4.5, by + Math.floor(j / 10) - 4, 10);
              const u = w.addUnit(list[j % list.length], p, x, y);
              if (u.kind === 'aircraft') u.altitude = u.ut.vtol ? 1.55 : 2.3;
              added++;
            } catch { /* no room */ }
          }
        }
        w.dirtyLists = true;
        for (const p of w.players) {
          const ids = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
          if (ids.length) w.issue({ c: 'move', player: p.id, units: ids, x: mid.x, y: mid.y, attackMove: true });
        }
        g.processEvents();
        g.fastForward(25);
        g.gfx.cam.jumpTo(mid.x, mid.y);
        return { added, alive: w.units.filter((u) => u.alive).length };
      }, +process.env.EXTRA);
      log(q, 'extra', JSON.stringify(rec.extra));
    }
    // ---- the busiest fight: the unit with the most enemy units within 10 cells; camera there at the default zoom
    const aim = () => page.evaluate(() => {
      const g = window.__game, w = g.world;
      const us = w.units.filter((u) => u.alive && u.weapons.length);
      let best = null, bestN = -1;
      for (let i = 0; i < us.length; i += Math.max(1, Math.floor(us.length / 300))) {
        const u = us[i];
        let n = 0;
        for (const v of us) if (v.owner !== u.owner && u.owner.isEnemy(v.owner) && Math.abs(v.x - u.x) < 10 && Math.abs(v.y - u.y) < 10) n++;
        if (n > bestN) { bestN = n; best = u; }
      }
      if (best) { g.gfx.cam.jumpTo(best.x, best.y); g.gfx.cam.dist = g.gfx.cam.targetDist = 26; }
      return { x: best && Math.round(best.x), y: best && Math.round(best.y), enemiesNear: bestN, units: us.length };
    });
    rec.aim = await aim();
    // ---- real time for a while so effects, wrecks and fires fill in, then measure
    await page.evaluate(() => { const g = window.__game; g.speed = 1; g.gfx.dynamicResolution = false; g.gfx.setRenderScaleMode(1); });
    await page.waitForTimeout(20000);
    rec.aim2 = await aim();
    const run = (secs, dyn) => page.evaluate(async ([SECS, DYN]) => {
      const g = window.__game;
      g.gfx.dynamicResolution = DYN;
      g.gfx.setRenderScaleMode(DYN ? 'auto' : 1);
      // the game's own loop, timed: rAF interval (what the player sees) and the CPU time of each frame
      cancelAnimationFrame(g.raf);
      g.running = true;
      g.last = performance.now();
      const t = [], cpu = [], scales = [];
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
          if (t.length % 30 === 0) scales.push(+g.gfx.currentRenderScale.toFixed(2));
        };
        g.raf = requestAnimationFrame(loop);
      });
      // the steady state: the last 60 % of the run (Auto settles first)
      const k = Math.floor(t.length * 0.4);
      const tt = t.slice(k), cc = cpu.slice(k);
      const st = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(1); return { med: q(0.5), p95: q(0.95), p99: q(0.99), max: +(s[s.length - 1] ?? 0).toFixed(1), n: s.length }; };
      const mean = tt.reduce((a, b) => a + b, 0) / Math.max(1, tt.length);
      const ri = g.gfx.renderer.info;
      return {
        fps: +(1000 / mean).toFixed(1), frameMs: st(tt), cpuMs: st(cc), over50: tt.filter((x) => x > 50).length, over100: tt.filter((x) => x > 100).length,
        scaleEnd: +g.gfx.currentRenderScale.toFixed(2), scales: scales.slice(-12), calls: ri.render.calls, tris: ri.render.triangles,
        geo: ri.memory.geometries, tex: ri.memory.textures, programs: ri.programs?.length, units: g.world.units.filter((u) => u.alive).length,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, gameT: Math.round(g.world.time),
      };
    }, [secs, dyn]);
    rec.fixed100 = await run(SECS, false);
    log(q, 'fixed 100%', JSON.stringify(rec.fixed100));
    rec.auto = await run(SECS + 10, true);
    log(q, 'auto', JSON.stringify(rec.auto));
    await page.screenshot({ path: `${out}/bigmatch-${q}${process.env.EXTRA ? `-x${process.env.EXTRA}` : ''}${process.env.TAG ?? ''}.png` });
    // ---- GPU time per pass and the HDR scan (the probe stops the loop and draws frames itself), at 100 %
    await page.evaluate(() => { const g = window.__game; g.gfx.dynamicResolution = false; g.gfx.setRenderScaleMode(1); });
    rec.probe = await page.evaluate(installProbe);
    rec.timers = await page.evaluate(() => window.__rig.timers(40));
    const scans = {};
    scans.battle = await page.evaluate(() => { window.__rig.frame(3); return window.__rig.scan(); });
    scans.far = await page.evaluate(() => { const c = window.__game.gfx.cam; c.dist = c.targetDist = 60; window.__rig.frame(8); return window.__rig.scan(); });
    scans.near = await page.evaluate(() => { const c = window.__game.gfx.cam; c.dist = c.targetDist = 12; window.__rig.frame(8); return window.__rig.scan(); });
    scans.base = await page.evaluate(() => {
      const g = window.__game, b = g.world.buildings.find((x) => x.alive && !x.bt.wall && x.owner === g.local) ?? g.world.buildings.find((x) => x.alive);
      if (b) g.gfx.cam.jumpTo(b.x, b.y);
      g.gfx.cam.dist = g.gfx.cam.targetDist = 26;
      window.__rig.frame(8);
      return window.__rig.scan();
    });
    rec.scans = Object.fromEntries(Object.entries(scans).map(([k, s]) => [k, { glErrors: s.glErrors, bad: s.bad, targets: s.targets, maxHdr: s.maxHdr, canvas: s.canvas }]));
    rec.nonFinite = Object.values(scans).reduce((a, s) => a + s.bad.reduce((b, t) => b + t.nonFinite, 0), 0);
    rec.glErrors = Object.values(scans).flatMap((s) => s.glErrors);
    rec.mem = { cgroupMB: cgroupMB(), hd: await page.evaluate(() => window.__hdStatus?.() ?? null).catch(() => null) };
  } catch (e) {
    rec.error = String(e.stack ?? e).split('\n').slice(0, 4).join(' | ');
    await page.screenshot({ path: `${out}/bigmatch-${q}-error.png` }).catch(() => {});
  }
  rec.messages = msgs.slice(0, 20);
  rec.messageCount = msgs.length;
  rec.wallS = Math.round((Date.now() - T0) / 1000);
  fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
  log(q, 'done', JSON.stringify({ nonFinite: rec.nonFinite, glErrors: rec.glErrors, messages: rec.messageCount, error: rec.error ?? null }));
  await ctx.close();
}
await browser.close();
