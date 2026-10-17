#!/usr/bin/env node
// Terrain / nature screenshots (headless Chromium + SwiftShader): the five benchmark scenes and close-ups of
// roads, cliffs, trees and snow, with draw calls / triangles per shot. Run your own no-HMR vite server first.
//
//   node tools/assets/terrain/shots.mjs --port 5271 --out /tmp/rh-terrain --tag after
//   node tools/assets/terrain/shots.mjs --port 5271 --out /tmp/rh-terrain --tag low --extra q=low --only A,C
//   options: --bench N (time N GPU-synced frames after the shot)  --only A,B,C,D,E,road,cliff,trees,snow,desert-road,winter-road,winter-cliff  --wait ms (default 9000)
//            --size WxH (default 1600x900)  --extra 'k=v&...' (more URL params)
// Writes <out>/<tag>-<shot>.png and prints one JSON line per shot.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const port = opt('--port', '5271');
const outDir = opt('--out', '/tmp/rh-terrain');
const tag = opt('--tag', 'shot');
const wait = Number(opt('--wait', '9000'));
const extra = opt('--extra', '');
/** --bench N: after the shot, time N frames of the renderer (GPU-synced with a 1-pixel readback; SwiftShader). */
const bench = Number(opt('--bench', '0')) || 0;
const [W, H] = opt('--size', '1600x900').split('x').map(Number);
const BASE = 'size=64&fog=0&intro=0';
const SCENES = {
  A: 'scenario=base&faction=soviet&climate=winter&tod=day&hour=10.5&wx=clear',
  B: 'scenario=battle&faction=soviet&climate=winter&tod=day&hour=10.5&wx=clear',
  C: 'scenario=base&faction=allies&climate=temperate&tod=day&hour=15&wx=clear',
  D: 'scenario=battle&faction=allies&climate=desert&tod=day&hour=9&wx=clear',
  E: 'scenario=base&faction=soviet&climate=temperate&tod=night',
};

// close-ups: a scene plus a camera aim computed in the page (returns [x, y, dist] or null)
const AIM = {
  // the longest straight-ish stretch of road (roads.ts) or, without roads, half way between the first two bases
  road: `(() => {
    const t = g.gfx.terrain; const r = t.roads;
    if (r && r.segments && r.segments.length) {
      let best = null, bl = -1;
      for (const s of r.segments) { const n = s.points.length; if (n > bl) { bl = n; best = s; } }
      const p = best.points[Math.floor(best.points.length / 2)];
      return [p[0], p[1], 11];
    }
    const s = g.world.map.startPositions; return [(s[0].x * 2 + s[1].x) / 3, (s[0].y * 2 + s[1].y) / 3, 11];
  })()`,
  // the rock cell with the steepest drop to open ground
  cliff: `(() => {
    const m = g.world.map; let best = null, bd = -1;
    for (let y = 2; y < m.h - 2; y++) for (let x = 2; x < m.w - 2; x++) {
      if (m.terrain[m.idx(x, y)] !== 2) continue;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const t = m.terrain[m.idx(x + dx, y + dy)]; if (t === 2 || t === 1) continue;
        const d = m.heightAt(x + 0.5, y + 0.5) - m.heightAt(x + 0.5 + dx, y + 0.5 + dy);
        if (d > bd) { bd = d; best = [x + 0.5 + dx * 1.5, y + 0.5 + dy * 1.5]; }
      }
    }
    return best ? [best[0], best[1], 10] : null;
  })()`,
  // the densest 7x7 patch of forest
  trees: `(() => {
    const m = g.world.map; let best = null, bn = -1;
    for (let y = 4; y < m.h - 4; y += 2) for (let x = 4; x < m.w - 4; x += 2) {
      let n = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (m.tree[m.idx(x + dx, y + dy)]) n++;
      if (n > bn) { bn = n; best = [x + 0.5, y + 2.5]; }
    }
    return best ? [best[0], best[1], 10] : null;
  })()`,
  // the corner of a structure's concrete apron
  apron: `(() => {
    const b = g.world.buildings.find((b) => b.alive && b.owner === g.local && b.bt.size[0] >= 2);
    return b ? [b.cx + b.bt.size[0] + 0.5, b.cy + b.bt.size[1] + 0.5, 7] : null;
  })()`,
  // open ground next to the local base
  snow: `(() => {
    const s = g.world.map.startPositions[0]; const m = g.world.map;
    return [Math.min(m.w - 6, s.x + 6), Math.min(m.h - 6, s.y + 5), 10];
  })()`,
};
const CLOSE = {
  road: ['C', 'road'], 'winter-road': ['A', 'road'], 'desert-road': ['D', 'road'],
  cliff: ['C', 'cliff'], 'winter-cliff': ['A', 'cliff'], 'desert-cliff': ['D', 'cliff'],
  trees: ['C', 'trees'], 'winter-trees': ['A', 'trees'], 'desert-trees': ['D', 'trees'],
  snow: ['A', 'snow'],
  apron: ['C', 'apron'], 'winter-apron': ['A', 'apron'],
};
const only = opt('--only', null)?.split(',') ?? [...Object.keys(SCENES), 'road', 'cliff', 'trees', 'snow'];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(here, '..', '..', 'nsslibs/lib') },
});
try {
  for (const name of only) {
    const sceneKey = SCENES[name] ? name : CLOSE[name]?.[0];
    if (!sceneKey) { console.log(JSON.stringify({ name, error: 'unknown shot' })); continue; }
    const url = `http://localhost:${port}/?autostart=1&${SCENES[sceneKey]}&${BASE}${extra ? `&${extra}` : ''}`;
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 600000 });
      await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 600000 });
      await page.waitForTimeout(1500);
      let aim = null;
      if (CLOSE[name]) {
        aim = await page.evaluate(`(() => { const g = window.__game; return ${AIM[CLOSE[name][1]]}; })()`);
        if (aim) await page.evaluate(([x, y, d]) => { const c = window.__game.gfx.cam; c.jumpTo(x, y); c.dist = c.targetDist = d; }, aim);
      }
      await page.waitForTimeout(wait);
      const out = path.join(outDir, `${tag}-${name}.png`);
      await page.screenshot({ path: out, timeout: 300000 });
      const info = await page.evaluate(() => {
        const g = window.__game;
        const r = g.gfx.renderer;
        const t = g.gfx.terrain;
        return {
          calls: g.gfx.stats.calls, tris: g.gfx.stats.tris, textures: r.info.memory.textures, geometries: r.info.memory.geometries,
          programs: r.info.programs?.length, terrain: t.textureStatus?.() ?? null, nature: g.gfx.vegetation.hdStatus?.() ?? null,
        };
      });
      if (bench) {
        info.bench = await page.evaluate(async (n) => {
          const g = window.__game;
          g.running = false;
          cancelAnimationFrame(g.raf);
          const gl = g.gfx.renderer.getContext();
          const px = new Uint8Array(4);
          const ms = [];
          let t = performance.now();
          for (let k = 0; k < n; k++) {
            const t0 = performance.now();
            g.gfx.render(1 / 30, (t += 33) / 1000);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            ms.push(performance.now() - t0);
            await new Promise((r) => setTimeout(r, 0));
          }
          ms.sort((a, b) => a - b);
          return { frames: n, medianMs: +ms[ms.length >> 1].toFixed(1), calls: g.gfx.stats.calls, tris: g.gfx.stats.tris };
        }, bench);
      }
      console.log(JSON.stringify({ name, out, aim, ...info, errors: errors.slice(0, 6) }));
    } catch (e) {
      console.log(JSON.stringify({ name, error: String(e), errors: errors.slice(0, 6) }));
    }
    await page.close();
  }
} finally {
  await browser.close();
}
