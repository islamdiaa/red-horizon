// Fixed look scenes for comparing renderers (engines, Direct3D vs the Linux GPU reference): each scene paused at a
// fixed camera after fixed-step frames, read back as an 80x45 grid of mean sRGB colours plus a screenshot, with the
// HDR scan of tools/gpu-rig (non-finite / out-of-range values, gl errors) and the time to the first frame.
// Compare grids with tools/xb/compare.mjs. Used by tools/xb/matrix.mjs (rig) and tools/xb/vmlook.mjs (VMs).
import { openMatch, setupBattle } from './probe-core.mjs';

export const LOOK_SCENES = {
  'battle-medium': { q: 'medium', query: 'scenario=battle&fog=0&size=64&seed=11&tod=day&climate=temperate', battle: 120 },
  'battle-high-dusk': { q: 'high', query: 'scenario=battle&fog=0&size=64&seed=11&tod=dusk&climate=temperate', battle: 120 },
  'base-winter-high': { q: 'high', query: 'scenario=base&faction=soviet&climate=winter&fog=0&size=64&seed=11&tod=day&hour=10.5&wx=clear' },
  'desert-low': { q: 'low', query: 'scenario=battle&fog=0&size=64&seed=11&tod=day&climate=desert', battle: 60 },
  'night-high': { q: 'high', query: 'scenario=battle&fog=0&size=64&seed=11&tod=night&climate=temperate', battle: 120 },
};

/** The canvas as a GX x GY grid of mean sRGB colours (read straight after a frame). */
export function grid([GX, GY]) {
  const g = window.__game, gl = g.gfx.renderer.getContext();
  window.__rig.frame(1, 0.0001);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const out = new Array(GX * GY * 3).fill(0), n = new Array(GX * GY).fill(0);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GY - 1, Math.floor((h - 1 - y) / h * GY)); // readPixels rows start at the bottom
    for (let x = 0; x < w; x++) {
      const gx = Math.min(GX - 1, Math.floor(x / w * GX)), k = gy * GX + gx, i = (y * w + x) * 4;
      out[k * 3] += px[i]; out[k * 3 + 1] += px[i + 1]; out[k * 3 + 2] += px[i + 2]; n[k]++;
    }
  }
  return { w, h, cells: out.map((v, i) => Math.round(v / n[Math.floor(i / 3)])) };
}

/**
 * Render every scene in `browser`; returns { scene: { w, h, cells, loadMs, scan } }. `emit(record, bad)` gets one record
 * per scene. `only` limits the scenes (comma list).
 */
export async function runLook({ browser, base, label, out, emit = () => {}, only = null, W = 1280, H = 720 }) {
  const res = {};
  for (const [name, sc] of Object.entries(LOOK_SCENES)) {
    if (only && !only.split(',').includes(name)) continue;
    let s;
    try {
      const t0 = Date.now();
      s = await openMatch(browser, `${base}?autostart=1&intro=0&speed=0.1&q=${sc.q}&hd=1&${sc.query}`, { width: W, height: H });
      const loadMs = Date.now() - t0;
      await s.page.evaluate(() => { const g = window.__game; g.speed = 1; while (g.world.tick < 8) { g.world.step(); g.processEvents(); } });
      if (sc.battle) await setupBattle(s.page, sc.battle);
      // a fixed camera and a paused scene; fixed-step frames so animated materials agree in time
      await s.page.evaluate(() => {
        const g = window.__game, m = g.world.map;
        const sov = g.world.players.find((p) => p.faction === 'soviet') ?? g.world.players[1];
        const bs = g.world.buildings.filter((b) => b.alive && b.owner === sov && !b.bt.wall);
        const cx = bs.length ? bs.reduce((a, b) => a + b.x, 0) / bs.length : m.w / 2, cy = bs.length ? bs.reduce((a, b) => a + b.y, 0) / bs.length : m.h / 2;
        g.gfx.cam.jumpTo(cx + (m.w / 2 - cx) * 0.2, cy + (m.h / 2 - cy) * 0.2 + 1);
        g.gfx.cam.dist = g.gfx.cam.targetDist = 26;
        g.paused = true;
        window.__rig.frame(40, 1000 / 30);
      });
      const scan = await s.page.evaluate(() => window.__rig.scan());
      const gr = await s.page.evaluate(grid, [80, 45]);
      res[name] = { ...gr, loadMs, scan: { bad: scan.bad, glErrors: scan.glErrors, maxHdr: scan.maxHdr, canvas: scan.canvas } };
      await s.page.screenshot({ path: `${out}/look-${name}-${label}.png` });
      emit({ scene: name, renderer: s.info.renderer, loadMs, w: gr.w, h: gr.h, scan: res[name].scan, log: s.log.slice(0, 10) }, s.log.length > 0 || scan.bad.length > 0 || scan.glErrors.length > 0);
    } catch (e) {
      emit({ scene: name, fail: String(e).split('\n').slice(0, 3).join(' | ').slice(0, 600), log: s?.log.slice(0, 10) }, true);
    }
    await s?.ctx.close();
  }
  return res;
}
