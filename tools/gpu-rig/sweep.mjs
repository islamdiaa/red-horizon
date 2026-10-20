// Real-GPU correctness sweep: scans every half/float render target after each pass for non-finite and
// out-of-range values, checks gl errors, shader warnings, black / white frames and flicker of a paused scene.
//   node tools/gpu-rig/sweep.mjs <base-url> <env|fx|models|ctxloss> [presets=low,medium,high] [outDir=/out]
// env:     preset x climate x time of day x weather x zoom
// fx:      superweapons, Tesla, fire, smoke, haze, explosions, destruction, photo mode, the nuke cinematic
// models:  every unit and structure type on screen, HD on and off
// ctxloss: WEBGL_lose_context mid-match, then restore: the match must come back rendering
// MASK=1 hides EXT_color_buffer_float and OES_texture_float_linear (mobile-like). One JSON line per check.
import fs from 'node:fs';
import { launchGpu, openMatch, maskExtensionsScript } from './lib.mjs';

const [base = 'http://127.0.0.1:5291/', mode = 'env', presetArg = 'low,medium,high', out = '/out'] = process.argv.slice(2);
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 720);
const presets = presetArg.split(',');
const mask = process.env.MASK ? [maskExtensionsScript(['EXT_color_buffer_float', 'OES_texture_float_linear'])] : [];
const HDQ = process.env.HD ?? '1';
const tag = (process.env.TAG ?? '') + (process.env.MASK ? '-mask' : '') + (HDQ === '1' ? '' : '-hd' + HDQ);
const outFile = `${out}/sweep-${mode}${tag}.jsonl`;
fs.writeFileSync(outFile, '');
let problems = 0;
const emit = (o) => {
  const bad = (o.scan && (o.scan.bad.length || o.scan.glErrors.length || o.scan.canvas.black > 0.6 || o.scan.canvas.white > 0.3)) || (o.log && o.log.length) || o.fail;
  if (bad) problems++;
  const line = JSON.stringify(o);
  fs.appendFileSync(outFile, line + '\n');
  console.log((bad ? 'BAD ' : 'ok  ') + line.slice(0, bad ? 1600 : 220));
};

const browser = await launchGpu();
const url = (q, extra) => `${base}?autostart=1&intro=0&scenario=battle&fog=0&size=64&seed=11&speed=0.1&q=${q}${extra}`;

async function open(q, extra) {
  const s = await openMatch(browser, url(q, extra), { width: W, height: H, init: mask });
  await s.page.evaluate(() => { const g = window.__game; g.speed = 1; while (g.world.tick < 8) { g.world.step(); g.processEvents(); } window.__rig.frame(4); });
  s.info.mem = await s.page.evaluate(() => { const h = window.__hdStatus?.(); return { heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, hdTexMB: h?.textureMB, hdCpuBitmapMB: h?.cpuBitmapMB, hdTier: h?.tier }; });
  return s;
}
const takeLog = (s) => s.log.splice(0);
const cam = (page, x, y, d, pitch) => page.evaluate(([x, y, d, pitch]) => {
  const c = window.__game.gfx.cam;
  if (x != null) c.jumpTo(x, y);
  c.dist = c.targetDist = d;
  if (pitch != null && 'pitch' in c) c.pitch = c.targetPitch = pitch;
}, [x, y, d, pitch]);

async function shot(page, name) {
  const p = `${out}/${name}${tag}.png`;
  await page.screenshot({ path: p });
  return p;
}

if (mode === 'env') {
  const TOD = { day: 10.5, dusk: 17.9, night: 22.5 };
  for (const q of presets) for (const climate of (process.env.CLIMATES ?? 'temperate,winter,desert').split(',')) {
    const s = await open(q, `&hd=${HDQ}&climate=${climate}&tod=day`);
    emit({ q, climate, load: true, info: s.info, log: takeLog(s) });
    const center = await s.page.evaluate(() => { const m = window.__game.world.map; return [m.w / 2, m.h / 2 + 2]; });
    for (const wx of (process.env.WX ?? 'clear,rain,snow,fog,storm').split(',')) {
      await s.page.evaluate((wx) => window.__game.gfx.weather.set(wx, 0), wx);
      for (const tod of Object.keys(TOD)) {
        await s.page.evaluate((h) => { window.__game.hours = h; }, TOD[tod]);
        // every weather and time at the default zoom; close and far for clear day and night
        const zooms = wx === 'clear' && tod !== 'dusk' ? [['close', 9], ['default', 26], ['far', 64]] : [['default', 26]];
        for (const [zoom, d] of zooms) {
          await cam(s.page, center[0], center[1], d);
          await s.page.evaluate(() => window.__rig.frame(12));
          const scan = await s.page.evaluate(() => window.__rig.scan());
          // flicker: the paused scene, two frames apart (TAA jitter settles in a few frames)
          const flick = await s.page.evaluate(() => { const g = window.__game; const p = g.paused; g.paused = true; window.__rig.frame(8); window.__rig.diff(); window.__rig.frame(1); const a = window.__rig.diff(); window.__rig.frame(1); const b = window.__rig.diff(); g.paused = p; return Math.max(a, b); });
          const rec = { q, climate, wx, tod, zoom, scan, flicker: flick, log: takeLog(s) };
          emit(rec);
          if (scan.bad.length || flick > 0.02 || process.env.SHOTS === 'all') rec.shot = await shot(s.page, `env-${q}-${climate}-${wx}-${tod}-${zoom}`);
        }
      }
    }
    await s.ctx.close();
  }
}

if (mode === 'fx') {
  for (const q of presets) for (const tod of ['day', 'night']) {
    const s = await open(q, `&hd=${HDQ}&climate=temperate&tod=${tod}`);
    emit({ q, tod, load: true, info: s.info, log: takeLog(s) });
    // a burning enemy base, wrecks, a silo, a chronosphere and an iron curtain, all charged
    const c = await s.page.evaluate(() => {
      const g = window.__game, w = g.world;
      const me = g.local, enemy = w.players.find((p) => p !== me);
      const bs = w.buildings.filter((b) => b.alive && b.owner === enemy && !b.bt.wall);
      const cx = bs.reduce((s2, b) => s2 + b.x, 0) / bs.length, cy = bs.reduce((s2, b) => s2 + b.y, 0) / bs.length;
      bs.forEach((b, i) => { if (i % 2 === 0) b.hp = Math.max(1, b.maxHp * 0.2); });
      for (const b of bs.filter((b, i) => i % 2 === 1).slice(0, 2)) w.kill(b, 'normal');
      g.processEvents();
      return [cx, cy];
    });
    await cam(s.page, c[0], c[1] + 2, 26);
    await s.page.evaluate(() => window.__rig.frame(60));
    emit({ q, tod, fx: 'burning-base', scan: await s.page.evaluate(() => window.__rig.scan()), log: takeLog(s) });
    // superweapons fired by both sides through the simulation
    const fire = async (name, js, frames = [3, 15, 40, 90]) => {
      // (a function given as a string is only evaluated, not called: call it in the expression)
      const okFire = await s.page.evaluate(`(${js})(${JSON.stringify(c)})`).catch((e) => 'error: ' + String(e).slice(0, 200));
      let f0 = 0;
      for (const f of frames) {
        await s.page.evaluate((n) => window.__rig.frame(n), f - f0);
        f0 = f;
        const scan = await s.page.evaluate(() => window.__rig.scan());
        const rec = { q, tod, fx: name, frame: f, fired: okFire, scan, log: takeLog(s) };
        emit(rec);
        if (scan.bad.length || f === frames[1]) await shot(s.page, `fx-${q}-${tod}-${name}-${f}`);
      }
    };
    const SW = (kind, building) => `([cx, cy]) => {
      const g = window.__game, w = g.world;
      const p = w.players.find((pl) => pl.faction === '${building === 'mslo' || building === 'iron' ? 'soviet' : 'allies'}') ?? g.local;
      const own = w.buildings.find((b) => b.alive && b.owner === p);
      let b = null;
      for (let k = 0; k < 12 && !b; k++) { try { b = w.addBuilding('${building}', p, Math.round(own.x) + 3 + (k % 4) * 3, Math.round(own.y) + 3 + Math.floor(k / 4) * 3, true); } catch { /* occupied */ } }
      p.superCharge['${kind}'] = 1e6;
      const tgt = ${kind === 'nuke' ? '[cx, cy]' : '[own.x + 2, own.y - 4]'};
      const unit = w.units.find((u) => u.alive && u.owner === p && u.kind === 'vehicle');
      w.issue({ c: 'superweapon', player: p.id, kind: '${kind}', x: tgt[0], y: tgt[1], unit: unit?.id });
      ${kind === 'nuke' ? '' : 'g.gfx.cam.jumpTo(own.x + 2, own.y - 2);'}
      return !!b;
    }`;
    await fire('nuke', SW('nuke', 'mslo'), [3, 20, 60, 120, 200]);
    await cam(s.page, c[0], c[1] + 2, 26);
    await s.page.evaluate(() => window.__rig.frame(30));
    await fire('ironcurtain', SW('ironcurtain', 'iron'));
    await fire('chrono', SW('chrono', 'pdox'));
    // direct effect calls: Tesla, flame, explosions of every size, at the view centre
    await fire('tesla+flame+explosions', `([cx, cy]) => {
      const g = window.__game, fx = g.effects;
      const T = window.__game.gfx.cam.camera.position.constructor;
      const at = (dx, dz, y = 0.3) => new T(cx + dx, y + (g.gfx.terrain?.renderHeight?.(cx + dx, cy + dz) ?? 0), cy + dz);
      if (!fx) return 'no-fx-handle';
      for (let k = 0; k < 6; k++) fx.teslaBolt(at(-3, k * 0.6, 1.5), at(2, k * 0.4, 0.2));
      fx.flameStream(at(-2, -2, 0.4), at(1, -1, 0.2));
      ['piff', 'small', 'medium', 'large', 'huge', 'building', 'fire', 'electric', 'mad', 'seismic', 'demo', 'mininuke'].forEach((kind, k) => { try { fx.explosion(at((k % 4) * 2 - 3, Math.floor(k / 4) * 2 - 2), kind, 1.5); } catch {} });
      fx.chronoFlash(at(0, 2, 0.5)); fx.ironCurtainPulse(at(1, 1, 0.3), 3); fx.heavyDeath(at(-1, 1, 0.3), 2);
      return true;
    }`, [2, 8, 30]);
    // photo mode (depth of field) and the cinematic lens
    await s.page.evaluate(() => { document.body.classList.add('photo-mode'); window.__game.gfx.setPhotoMode(true); window.__game.gfx.photoDof = 1; });
    await s.page.evaluate(() => window.__rig.frame(10));
    emit({ q, tod, fx: 'photo', scan: await s.page.evaluate(() => window.__rig.scan()), log: takeLog(s) });
    await shot(s.page, `fx-${q}-${tod}-photo`);
    await s.page.evaluate(() => { window.__game.gfx.setPhotoMode(false); document.body.classList.remove('photo-mode'); window.__game.gfx.cinematicDof = 1; window.__game.gfx.cinematicBlur = 1; });
    await s.page.evaluate(() => window.__rig.frame(10));
    emit({ q, tod, fx: 'cinematic-lens', scan: await s.page.evaluate(() => window.__rig.scan()), log: takeLog(s) });
    await s.page.evaluate(() => { window.__game.gfx.cinematicDof = 0; window.__game.gfx.cinematicBlur = 0; });
    await s.ctx.close();
  }
}

if (mode === 'models') {
  // every unit and structure id from the rules table (read as text: the production build exposes no modules)
  const src = fs.readFileSync(new URL('../../src/data/rules.ts', import.meta.url), 'utf8');
  const block = (name) => { const a = src.indexOf(`export const ${name}:`); const b = src.indexOf('\n};', a); return [...src.slice(a, b).matchAll(/^  ([a-z0-9]+): +[A-Z]+\(/gm)].map((m) => m[1]); };
  const TYPES = [block('UNITS'), block('BUILDINGS')];
  console.log('types', TYPES[0].length, TYPES[1].length);
  for (const q of presets) for (const hd of ['1', '0']) {
    const s = await open(q, `&hd=${hd}&climate=temperate&tod=dusk`);
    emit({ q, hd, load: true, info: s.info, log: takeLog(s) });
    const placed = await s.page.evaluate(async ([uts, bts]) => {
      const g = window.__game, w = g.world;
      const [p0, p1] = w.players;
      let n = 0, failed = [];
      const ox = 6, oy = 6;
      bts.forEach((t, i) => {
        try { w.addBuilding(t, i % 2 ? p1 : p0, ox + (i % 10) * 5, oy + Math.floor(i / 10) * 5, true); n++; } catch (e) { failed.push(t + ':' + String(e).slice(0, 40)); }
      });
      uts.forEach((t, i) => {
        try {
          const [x, y] = w.findFreeSpot(ox + (i % 12) * 2.2, oy + 32 + Math.floor(i / 12) * 2.5, 4);
          const u = w.addUnit(t, i % 2 ? p1 : p0, x, y);
          if (u.kind === 'aircraft') u.altitude = u.ut.vtol ? 1.55 : 2.3;
          n++;
        } catch (e) { failed.push(t + ':' + String(e).slice(0, 40)); }
      });
      w.dirtyLists = true;
      g.processEvents();
      window.__rig.frame(6);
      return { n, buildings: bts.length, units: uts.length, failed, oy };
    }, TYPES);
    emit({ q, hd, placed, log: takeLog(s) });
    for (const [label, x, y, d] of [['structs', 28, 14, 30], ['structs-close', 14, 10, 12], ['units', 18, 42, 22], ['units-close', 12, 40, 10], ['units-far', 18, 42, 60]]) {
      await cam(s.page, x, y, d);
      await s.page.evaluate(() => window.__rig.frame(10));
      const scan = await s.page.evaluate(() => window.__rig.scan());
      const flick = await s.page.evaluate(() => { const g = window.__game; g.paused = true; window.__rig.frame(8); window.__rig.diff(); window.__rig.frame(1); const a = window.__rig.diff(); g.paused = false; return a; });
      emit({ q, hd, view: label, scan, flicker: flick, log: takeLog(s) });
      await shot(s.page, `models-${q}-hd${hd}-${label}`);
    }
    await s.ctx.close();
  }
}

if (mode === 'ctxloss') {
  for (const q of presets) {
    const s = await open(q, `&hd=${HDQ}&climate=temperate&tod=day`);
    // the real loop this time: restart it, lose the context, wait, restore, check the match renders again
    await s.page.evaluate(() => { const g = window.__game; g.running = true; g.last = performance.now(); const loop = (t) => { if (!g.running) return; g.raf = requestAnimationFrame(loop); g.frame(t); }; g.raf = requestAnimationFrame(loop); });
    await s.page.waitForTimeout(1000);
    const before = await s.page.evaluate(() => window.__game.world.tick);
    await s.page.evaluate(() => { window.__lc = window.__game.gfx.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
    await s.page.waitForTimeout(1500);
    const during = await s.page.evaluate(() => ({ tick: window.__game.world.tick, paused: window.__game.paused, overlay: !!document.querySelector('[role=status][aria-live=assertive]'), lost: window.__game.gfx.renderer.getContext().isContextLost() }));
    await shot(s.page, `ctxloss-${q}-lost`);
    await s.page.waitForTimeout(500);
    await s.page.evaluate(() => window.__lc.restoreContext());
    await s.page.waitForTimeout(4000);
    const after = await s.page.evaluate(() => ({ tick: window.__game.world.tick, paused: window.__game.paused, overlay: !!document.querySelector('[role=status][aria-live=assertive]'), lost: window.__game.gfx.renderer.getContext().isContextLost() }));
    const p = await shot(s.page, `ctxloss-${q}-restored`);
    // stop the loop again and scan a restored frame (render targets, shadows, environment map re-created)
    const scan = await s.page.evaluate(() => { const g = window.__game; g.running = false; cancelAnimationFrame(g.raf); window.__rig.frame(6); return window.__rig.scan(); });
    emit({ q, ctxloss: true, before, during, after, scan, shot: p, fail: during.overlay !== true || after.lost || after.overlay || after.tick <= during.tick || scan.canvas.mean < 8 ? 'not restored' : undefined, log: takeLog(s) });
    await s.ctx.close();
  }
}

await browser.close();
console.log(`${mode}: ${problems} problem record(s) -> ${outFile}`);
