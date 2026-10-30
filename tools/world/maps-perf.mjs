// World Conquest region battlefields on the real-GPU rig: are they slower than the old Conquest maps? The same
// Conquest battle (same seed) opened on the old generator's map and on a world region's battlefield (testing hook
// &region=<id>), alternating A / B / A / B so the iGPU's clock drift hits both; median frame time, GPU time (timer
// queries per pass) and draw calls at the start camera and over the middle of the field.
//   node tools/world/maps-perf.mjs <url> [presets=low,high] [regions=paris,cairo,angkor,moscow] [rounds=2]
import { launchGpu, openMatch } from '../gpu-rig/lib.mjs';

const [base = 'http://127.0.0.1:5323/', presetArg = 'low,high', regionArg = 'paris,cairo,angkor,moscow', roundsArg = '2'] = process.argv.slice(2);
const browser = await launchGpu();
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };

async function measure(url, q) {
  // (a Conquest battle takes the saved settings' quality, not `q=`: set it before the page loads)
  const s = await openMatch(browser, url, { width: 1920, height: 1080, init: [`try { localStorage.setItem('rh.settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('rh.settings') || '{}'), quality: '${q}' })); } catch {}`] });
  try {
    await s.page.keyboard.press('Shift');
    return await s.page.evaluate(async () => {
      const g = window.__game, m = g.world.map, cam = g.gfx.cam;
      g.cameraDirector = null;
      g.gfx.dynamicResolution = false;
      window.__rig.frame(40);
      const out = {};
      const s0 = m.startPositions[0], f = m.startFocus ?? { x: s0.x, y: s0.y + 1 };
      for (const [name, x, y, d] of [['start', f.x, f.y, f.dist ?? 20], ['middle', m.w / 2, m.h / 2, 26]]) {
        cam.jumpTo(x, y);
        cam.dist = cam.targetDist = d;
        window.__rig.frame(20);
        const t = await window.__rig.timers(60);
        g.gfx.renderer.info.reset?.();
        window.__rig.frame(1);
        out[name] = { frameMs: t?.frameMs ?? 0, gpu: t?.gpuTotal ?? 0, calls: g.gfx.renderer.info.render.calls, tris: g.gfx.renderer.info.render.triangles };
      }
      out.size = m.w;
      out.quality = g.setup.quality;
      out.civ = g.world.buildings.filter((b) => b.scenery).length;
      return out;
    });
  } finally {
    await s.ctx.close();
  }
}

for (const q of presetArg.split(',')) for (const region of regionArg.split(',')) {
  const A = [], B = [];
  for (let r = 0; r < +roundsArg; r++) {
    A.push(await measure(`${base}?autostart=1&intro=0&conquest=assault&seed=7&q=${q}&hd=1`, q));
    B.push(await measure(`${base}?autostart=1&intro=0&conquest=assault&seed=7&region=${region}&q=${q}&hd=1`, q));
  }
  const row = (L, k) => ({ frameMs: +med(L.map((x) => x[k].frameMs)).toFixed(2), gpu: +med(L.map((x) => x[k].gpu)).toFixed(2), calls: med(L.map((x) => x[k].calls)), tris: med(L.map((x) => x[k].tris)) });
  console.log(JSON.stringify({ preset: q, applied: [A[0].quality, B[0].quality], region, old: { size: A[0].size, start: row(A, 'start'), middle: row(A, 'middle') }, regionMap: { size: B[0].size, civ: B[0].civ, start: row(B, 'start'), middle: row(B, 'middle') } }));
}
await browser.close();
