// What the scene and fog passes spend their GPU time on: per-pass timer queries with layers hidden one at a time,
// and at half render resolution (fragment-bound work scales with the pixel count, vertex-bound work does not).
//   node tools/gpu-rig/profile.mjs <base-url> [presets=low,medium] [units=150] [outDir=/out]
import fs from 'node:fs';
import { launchGpu, openMatch, setupBattle } from './lib.mjs';

const [base = 'http://127.0.0.1:5291/', presetArg = 'low,medium', unitsArg = '150', out = '/out'] = process.argv.slice(2);
const W = +(process.env.W ?? 1920), H = +(process.env.H ?? 1080);
const hd = process.env.HD ?? '1';
const outFile = `${out}/profile-${presetArg.replace(/,/g, '-')}-hd${hd}${process.env.TAG ?? ''}.jsonl`;
fs.writeFileSync(outFile, '');
const browser = await launchGpu();

for (const q of presetArg.split(',')) for (const n of unitsArg.split(',').map(Number)) {
  const url = `${base}?autostart=1&intro=0&scenario=battle&fog=0&size=64&seed=11&tod=dusk&q=${q}&hd=${hd}${process.env.EXTRA ? '&' + process.env.EXTRA : ''}`;
  const s = await openMatch(browser, url, { width: W, height: H });
  const setup = await setupBattle(s.page, n);
  const res = await s.page.evaluate(async () => {
    const g = window.__game, gfx = g.gfx;
    g.paused = true; // the same frame over and over: only the rendering varies
    const t = async () => (await window.__rig.timers(16));
    const vis = (o) => { if (!o) return null; const v = o.visible; o.visible = false; return () => { o.visible = v; }; };
    const out = { base: await t() };
    const known = new Set([gfx.terrain?.mesh, gfx.skirt?.mesh, gfx.vegetation?.group, gfx.water?.mesh, g.props?.group].filter(Boolean));
    const many = (list) => { const und = list.map(vis).filter(Boolean); return und.length ? () => und.forEach((u) => u()) : null; };
    const items = {
      terrain: () => many([gfx.terrain?.mesh, gfx.skirt?.mesh]),
      vegetation: () => vis(gfx.vegetation?.group),
      water: () => vis(gfx.water?.mesh),
      props: () => vis(g.props?.group),
      // units, structures, effects, ore, decals... (everything else in the scene)
      rest: () => many(gfx.scene.children.filter((c) => !known.has(c) && c.visible)),
    };
    for (const [k, f] of Object.entries(items)) {
      const undo = f();
      if (!undo) { out[k] = 'n/a'; continue; }
      out[k] = await t();
      undo();
    }
    // dynamic lights per screen tile (the atmosphere pass loops over them per pixel)
    const dl = gfx.dynLights, mpt = dl.maxPerTile;
    for (const k of [0, 4, 8]) { if (k >= mpt) continue; dl.maxPerTile = k; out['dynTile' + k] = await t(); }
    dl.maxPerTile = mpt;
    out.dynStats = { ...dl.stats, maxPerTile: mpt, cap: dl.cap };
    // image-based lighting (the environment map every standard material samples)
    const env = gfx.scene.environment;
    gfx.scene.environment = null;
    gfx.scene.traverse((o) => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
    out.noEnv = await t();
    gfx.scene.environment = env;
    gfx.scene.traverse((o) => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
    // the terrain's own colour code against a plain standard material (lighting only)
    const tm = gfx.terrain.mesh, tmat = tm.material;
    tm.material = new tmat.constructor({ color: 0x667744, roughness: 0.93 });
    out.terrainPlain = await t();
    tm.material.dispose();
    tm.material = tmat;
    // half resolution (the existing dynamic-resolution path for presets without TAA)
    const r = gfx.renderer, pr = r.getPixelRatio();
    r.setPixelRatio(pr * 0.5); gfx.composer.setPixelRatio(pr * 0.5); gfx.resize();
    out.half = await t();
    r.setPixelRatio(pr); gfx.composer.setPixelRatio(pr); gfx.resize();
    // what the scene contains
    let meshes = 0, tris = 0;
    const byTop = {};
    for (const c of gfx.scene.children) {
      let m = 0, tr = 0;
      c.traverseVisible((o) => { if (o.isMesh || o.isInstancedMesh) { m++; const gi = o.geometry; const n = gi.index ? gi.index.count / 3 : (gi.attributes.position?.count ?? 0) / 3; tr += n * (o.isInstancedMesh ? o.count : 1); } });
      meshes += m; tris += tr;
      const k = c.name || c.type;
      byTop[k] = (byTop[k] ?? 0) + Math.round(tr);
    }
    out.sceneTris = Math.round(tris);
    out.top = Object.fromEntries(Object.entries(byTop).sort((a, b) => b[1] - a[1]).slice(0, 10));
    out.passCalls = { ...gfx.passCalls };
    return out;
  });
  const rec = { q, hd, units: setup.units, W, H, ...res, log: s.log.slice(0, 5) };
  fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
  console.log(JSON.stringify(rec));
  await s.ctx.close();
}
await browser.close();
