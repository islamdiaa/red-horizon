// World Conquest QA: region battlefields against skirmish maps of the same size on the real GPU (the goal:
// "Battles are no slower than today's skirmish maps of the same size"). Runs in the gpu-rig container:
//
//   $RIG tools/world/qa-battle-perf.mjs http://127.0.0.1:5326/ [presets=low] [units=150] [views=centre,start] [outDir=/out]
//
// Maps: generated 64-cell skirmish maps in each climate (the baseline) and World Conquest region battles (src/main.ts
// ?autostart=1&conquest=<kind>&region=<id>, the region test hook) with cities, towns, landmarks, jungle. In each, the
// same 150-unit battle is added (tools/xb/probe-core.mjs setupBattle) and measured from two views: the map centre at
// the default zoom (`centre`) and the human's starting view (`start`: the region's landmark framing). Per map:
//   fps      free-running frame rate of the game's own loop at a fixed 100 % render scale (6 s)
//   gpuMs    GPU time of a frame (timer queries, median), calls / tris per frame
// The iGPU's clock follows the host's CPU load: compare maps within one run only.
import fs from 'node:fs';
import { launchGpu, openMatch, setupBattle } from '../gpu-rig/lib.mjs';

const [base = 'http://127.0.0.1:5326/', presetArg = 'low', unitsArg = '150', viewArg = 'centre,start', out = '/out'] = process.argv.slice(2);
const W = +(process.env.W ?? 1920), H = +(process.env.H ?? 1080), SECS = +(process.env.SECS ?? 6);
const MAPS = (process.env.MAPS ?? [
  'skirmish:temperate', 'skirmish:desert', 'skirmish:winter',
  'assault:paris', 'assault:new-york', 'assault:bangkok', 'assault:cairo', 'assault:leningrad', 'assault:amazon', 'hold:rome', 'boss:moscow',
].join(',')).split(',');
const outFile = `${out}/battle-perf-${presetArg.replace(/,/g, '-')}.jsonl`;
fs.writeFileSync(outFile, '');
const browser = await launchGpu(undefined, ['--disable-gpu-vsync', '--disable-frame-rate-limit']);

function urlOf(m, q) {
  const [kind, arg] = m.split(':');
  const common = `debug=1&intro=0&fog=0&q=${q}&hd=1&seed=11`;
  if (kind === 'skirmish') return `${base}?autostart=1&scenario=battle&size=64&climate=${arg}&tod=day&${common}`;
  return `${base}?autostart=1&conquest=${kind}&region=${arg}&${common}`;
}

for (const q of presetArg.split(',')) for (const n of unitsArg.split(',').map(Number)) for (const m of MAPS) {
  let rec;
  try {
    // (the conquest hook takes its quality from the settings, not ?q=: set both)
    const init = `try { localStorage.setItem('rh.settings', JSON.stringify({ quality: '${q}', renderScale: 1, skipIntro: true, hints: false })); } catch {}`;
    const s = await openMatch(browser, urlOf(m, q), { width: W, height: H, init: [init] });
    const units = await setupBattle(s.page, n);
    for (const view of viewArg.split(',')) {
      await s.page.evaluate((view) => {
        const g = window.__game, map = g.world.map;
        if (view === 'centre') { g.gfx.cam.jumpTo(map.w / 2, map.h / 2 + 2); g.gfx.cam.dist = g.gfx.cam.targetDist = 26; }
        else { const st = map.startFocus ?? { x: map.startPositions[0].x, y: map.startPositions[0].y + 1, dist: 20 }; g.gfx.cam.jumpTo(st.x, st.y); g.gfx.cam.dist = g.gfx.cam.targetDist = st.dist ?? 20; }
        g.gfx.dynamicResolution = false; g.gfx.setRenderScaleMode?.(1);
      }, view);
      await s.page.waitForTimeout(1500);
      const timers = await s.page.evaluate(() => window.__rig.timers(30));
      const fps = await s.page.evaluate(async (SECS) => {
        const g = window.__game;
        g.running = true; g.last = performance.now();
        const t = [];
        let prev = performance.now();
        await new Promise((res) => {
          const end = prev + SECS * 1000;
          const loop = (now) => { if (now > end) { res(); return; } g.raf = requestAnimationFrame(loop); t.push(now - prev); prev = now; g.frame(now); };
          g.raf = requestAnimationFrame(loop);
        });
        g.running = false; cancelAnimationFrame(g.raf);
        const tail = t.slice(Math.floor(t.length * 0.3)), mean = tail.reduce((a, b) => a + b, 0) / tail.length;
        const sorted = [...tail].sort((a, b) => a - b);
        return { fps: +(1000 / mean).toFixed(1), p5fps: +(1000 / sorted[Math.floor(sorted.length * 0.95)]).toFixed(1), calls: g.gfx.stats.calls, tris: g.gfx.stats.tris, size: g.world.map.w, landmark: g.world.map.landmarks?.[0]?.id ?? null, civilians: g.world.buildings.filter((b) => b.alive && b.scenery).length };
      }, SECS);
      rec = { map: m, view, q, units, ...fps, gpuMs: timers?.gpuTotal ?? null, frameMs: timers?.frameMs ?? null, log: s.log.slice(0, 3) };
      fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
      console.log(JSON.stringify(rec));
    }
    await s.ctx.close();
  } catch (e) {
    rec = { map: m, q, error: String(e).slice(0, 300) };
    fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
    console.log(JSON.stringify(rec));
  }
}
await browser.close();
