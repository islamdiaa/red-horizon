// A/B look check for render changes: the same paused scenes rendered by two (or more) builds on the real GPU, compared
// pixel by pixel. Per scene and preset it saves the full frame of each build and a composite PNG (a 1:1 crop of A, of B
// and their difference x4), and prints the mean absolute difference (0-255), the share of pixels off by more than 8 and
// 24 levels, and the PSNR. Scenes are deterministic (seeded match, fixed camera, fixed-step frames, paused); particles
// spawned with Math.random still differ a little between any two runs, so compare against an A-vs-A run.
//   node tools/gpu-rig/lookab.mjs <urlA> <urlB>[,<urlC>...] [presets=low,medium,high] [scenes=all] [outDir=/out]
// Labels are the last path segment of each URL (http://127.0.0.1:5314/base/ -> "base").
import fs from 'node:fs';
import { launchGpu } from './lib.mjs';
import { openMatch, setupBattle } from '../xb/probe-core.mjs';

const [urlA, urlBs, presetArg = 'low,medium,high', sceneArg = 'all', out = '/out'] = process.argv.slice(2);
const W = +(process.env.W ?? 1920), H = +(process.env.H ?? 1080);
const CROP = { x: +(process.env.CX ?? 640), y: +(process.env.CY ?? 300), w: +(process.env.CW ?? 640), h: +(process.env.CH ?? 400) };
const SCENES = {
  battle: { query: 'scenario=battle&fog=0&size=64&seed=11&tod=day&climate=temperate', battle: 120 },
  winter: { query: 'scenario=base&faction=soviet&climate=winter&fog=0&size=64&seed=11&tod=day&hour=10.5&wx=clear' },
  desert: { query: 'scenario=battle&fog=0&size=64&seed=11&tod=day&climate=desert', battle: 60 },
  night: { query: 'scenario=battle&fog=0&size=64&seed=11&tod=night&climate=temperate', battle: 60 },
  far: { query: 'scenario=base&fog=0&size=64&seed=11&tod=day&climate=temperate', dist: 60 },
  near: { query: 'scenario=base&fog=0&size=64&seed=11&tod=day&climate=desert', dist: 12 },
  rain: { query: 'scenario=base&fog=0&size=64&seed=11&tod=day&climate=temperate&wx=rain', settle: 600 },
  fog: { query: 'scenario=battle&size=64&seed=11&tod=day&climate=temperate', battle: 40, fogOfWar: true },
};
const label = (u) => u.replace(/\/+$/, '').split('/').pop();
const builds = [urlA, ...urlBs.split(',')];
const scenes = sceneArg === 'all' ? Object.keys(SCENES) : sceneArg.split(',');
const browser = await launchGpu(undefined, []);
const T0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - T0) / 1000).toFixed(0).padStart(5)}s`, ...a);

async function capture(base, q, name) {
  const sc = SCENES[name];
  const s = await openMatch(browser, `${base}?autostart=1&intro=0&speed=0.1&q=${q}&hd=1&debug=1&${sc.query}`, { width: W, height: H });
  try {
    // HD models and scanned terrain materials in place (bounded)
    await s.page.waitForFunction(() => {
      const st = window.__hdStatus?.();
      const t = window.__game.gfx.terrain.textureStatus().state;
      return (!st || st.pending.length === 0) && t !== 'loading';
    }, null, { timeout: 60000, polling: 250 }).catch(() => {});
    await s.page.evaluate(() => { const g = window.__game; g.speed = 1; while (g.world.tick < 8) { g.world.step(); g.processEvents(); } });
    if (sc.battle) await setupBattle(s.page, sc.battle);
    await s.page.evaluate(([dist, settle, fogOfWar]) => {
      const g = window.__game, m = g.world.map;
      if (!fogOfWar) g.gfx.fog.enabled = false;
      const sov = g.world.players.find((p) => p.faction === 'soviet') ?? g.world.players[1];
      const bs = g.world.buildings.filter((b) => b.alive && b.owner === sov && !b.bt.wall);
      const cx = bs.length ? bs.reduce((a, b) => a + b.x, 0) / bs.length : m.w / 2, cy = bs.length ? bs.reduce((a, b) => a + b.y, 0) / bs.length : m.h / 2;
      g.gfx.cam.jumpTo(cx + (m.w / 2 - cx) * 0.2, cy + (m.h / 2 - cy) * 0.2 + 1);
      g.gfx.cam.dist = g.gfx.cam.targetDist = dist ?? 26;
      g.gfx.dynamicResolution = false;
      g.gfx.setRenderScaleMode(1);
      if (settle) window.__rig.frame(settle, 1000 / 30); // weather wetness builds up over time
      g.paused = true;
      window.__rig.frame(40, 1000 / 30);
    }, [sc.dist ?? null, sc.settle ?? 0, !!sc.fogOfWar]);
    const px = await s.page.evaluate(() => {
      const gl = window.__game.gfx.renderer.getContext();
      window.__rig.frame(1, 0.0001);
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const a = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a);
      // base64 in chunks (a string per frame would be too large for one apply)
      let bin = '';
      for (let i = 0; i < a.length; i += 0x8000) bin += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
      return { w, h, b64: btoa(bin) };
    });
    const raw = Buffer.from(px.b64, 'base64');
    const shot = `${out}/lookab-${name}-${q}-${label(base)}.png`;
    await s.page.screenshot({ path: shot });
    return { w: px.w, h: px.h, raw, shot, log: s.log.slice(0, 6) };
  } finally {
    await s.ctx.close();
  }
}

function compare(a, b) {
  const n = a.w * a.h;
  let sum = 0, off8 = 0, off24 = 0, se = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.raw[i * 4 + c] - b.raw[i * 4 + c]);
      sum += d; se += d * d;
      if (d > m) m = d;
    }
    if (m > 8) off8++;
    if (m > 24) off24++;
  }
  const mse = se / (n * 3);
  return { mad: +(sum / (n * 3)).toFixed(2), off8: +(off8 / n * 100).toFixed(2), off24: +(off24 / n * 100).toFixed(2), psnr: mse ? +(10 * Math.log10(255 * 255 / mse)).toFixed(1) : 99 };
}

/** A | B | |A-B| x4 for the crop, drawn on a blank page and saved as PNG (readPixels rows are bottom-up). */
async function composite(a, b, file) {
  const ctx = await browser.newContext({ viewport: { width: CROP.w * 3, height: CROP.h } });
  const page = await ctx.newPage();
  const cut = (img) => {
    const o = Buffer.alloc(CROP.w * CROP.h * 4);
    for (let y = 0; y < CROP.h; y++) {
      const sy = img.h - 1 - (CROP.y + y);
      img.raw.copy(o, y * CROP.w * 4, (sy * img.w + CROP.x) * 4, (sy * img.w + CROP.x + CROP.w) * 4);
    }
    return o.toString('base64');
  };
  await page.evaluate(([A, B, w, h]) => {
    const c = document.createElement('canvas');
    c.width = w * 3; c.height = h;
    document.body.style.margin = '0';
    document.body.appendChild(c);
    const g = c.getContext('2d');
    const dec = (s) => Uint8ClampedArray.from(atob(s), (ch) => ch.charCodeAt(0));
    const pa = dec(A), pb = dec(B), pd = new Uint8ClampedArray(pa.length);
    for (let i = 0; i < pa.length; i += 4) {
      for (let k = 0; k < 3; k++) pd[i + k] = Math.min(255, Math.abs(pa[i + k] - pb[i + k]) * 4);
      pa[i + 3] = pb[i + 3] = pd[i + 3] = 255;
    }
    g.putImageData(new ImageData(pa, w, h), 0, 0);
    g.putImageData(new ImageData(pb, w, h), w, 0);
    g.putImageData(new ImageData(pd, w, h), w * 2, 0);
  }, [cut(a), cut(b), CROP.w, CROP.h]);
  await page.screenshot({ path: file });
  await ctx.close();
}

const rows = [];
for (const q of presetArg.split(',')) {
  for (const name of scenes) {
    const caps = [];
    for (const base of builds) {
      try {
        caps.push(await capture(base, q, name));
      } catch (e) {
        caps.push(null);
        log(name, q, label(base), 'FAILED', String(e).split('\n')[0]);
      }
    }
    if (!caps[0]) continue;
    for (let k = 1; k < caps.length; k++) {
      if (!caps[k]) continue;
      const st = compare(caps[0], caps[k]);
      const file = `${out}/lookab-${name}-${q}-${label(builds[0])}-vs-${label(builds[k])}.png`;
      await composite(caps[0], caps[k], file);
      const row = { scene: name, q, a: label(builds[0]), b: label(builds[k]), ...st, logA: caps[0].log, logB: caps[k].log };
      rows.push(row);
      log(name.padEnd(7), q.padEnd(6), `${row.a} vs ${row.b}`.padEnd(20), `mad ${st.mad}`.padEnd(10), `>8 ${st.off8}%`.padEnd(11), `>24 ${st.off24}%`.padEnd(12), `psnr ${st.psnr}`, caps[k].log.length ? JSON.stringify(caps[k].log) : '');
    }
  }
}
fs.appendFileSync(`${out}/lookab.jsonl`, rows.map((r) => JSON.stringify({ ...r, at: new Date().toISOString() })).join('\n') + '\n');
await browser.close();
