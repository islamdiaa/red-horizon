// ARCH contact sheets on the real-GPU rig: every landmark and every civilian style at the default RTS zoom (camera
// distance 26), per quality preset, in the real game renderer (lighting, shadows, post). Needs a Vite DEV server
// (the page imports the modules by path): `npx vite --config tools/vite.<id>.config.ts`.
//   node tools/world/arch-sheet.mjs <dev-url> <landmarks|civ|night|all> [presets=low,high] [outDir=/out] [only=id,id]
// Writes <out>/arch-<what>-<preset>.jpg (sheet; '-subset' with `only`), a half-size -preview.jpg, <out>/tiles/*.png (each
// tile), one JSON line per tile (triangles, height, and where the top lands with the base centred at zoom 26).
import fs from 'node:fs';
import { launchGpu, openMatch } from '../gpu-rig/lib.mjs';

const [base = 'http://127.0.0.1:5324/', what = 'all', presetArg = 'low,high', out = '/out', onlyArg = ''] = process.argv.slice(2);
const only = onlyArg ? new Set(onlyArg.split(',')) : null;
const W = 1280, H = 720;
const TW = 820, TH = 700; // tile: the centre of a 1280 x 720 frame, unscaled (what a player sees at default zoom)
fs.mkdirSync(`${out}/tiles`, { recursive: true });
const browser = await launchGpu();

async function open(q, tod = 'day', climate = 'temperate') {
  const url = `${base}?autostart=1&intro=0&scenario=battle&fog=0&size=64&seed=11&speed=0.1&q=${q}&hd=0&climate=${climate}&tod=${tod}`;
  const s = await openMatch(browser, url, { width: W, height: H });
  await s.page.evaluate(async () => {
    const g = window.__game;
    g.speed = 1;
    while (g.world.tick < 8) { g.world.step(); g.processEvents(); }
    g.paused = true;
    // the subject's spot: the open ground nearest the middle with the least ore and no structures
    const w = g.world, m = w.map;
    let best = [32, 32], bestCost = Infinity;
    for (let cy = 20; cy <= 44; cy += 2) for (let cx = 20; cx <= 44; cx += 2) {
      let cost = Math.hypot(cx - 32, cy - 32) * 0.5;
      for (let y = cy - 9; y < cy + 9; y++) for (let x = cx - 11; x < cx + 11; x++) {
        if (!m.inBounds(x, y)) { cost += 5; continue; }
        const i = m.idx(x, y);
        if (m.ore[i] || m.gems[i]) cost += 3;
        if (m.occupant[i]) cost += 50;
        if (m.terrain[i] !== m.terrain[m.idx(cx, cy)]) cost += 1;
      }
      if (cost < bestCost) { bestCost = cost; best = [cx, cy]; }
    }
    window.__spot = best;
    // clear it (units, trees) so the subject stands alone; hide the HUD (the 3D view only)
    for (const u of w.units) if (u.alive && Math.hypot(u.x - best[0], u.y - best[1]) < 18) w.despawn(u);
    const cells = [];
    for (let y = best[1] - 18; y < best[1] + 18; y++) for (let x = best[0] - 20; x < best[0] + 20; x++) if (m.inBounds(x, y)) cells.push(m.idx(x, y));
    g.gfx.vegetation?.hideCells?.(cells);
    const st = document.createElement('style');
    st.textContent = 'body *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }';
    document.head.appendChild(st);
    // centre the camera on an object: base and top half way up the screen (default distance 26)
    window.__frameOn = (x, z, h) => {
      const cam = g.gfx.cam;
      cam.dist = cam.targetDist = 26;
      let fz = z;
      for (let k = 0; k < 6; k++) {
        cam.jumpTo(x, fz);
        cam.apply();
        const c = cam.camera;
        c.updateMatrixWorld();
        const y0 = m.heightAt(x, z);
        const a = new c.position.constructor(x, y0, z).project(c), b = new c.position.constructor(x, y0 + h, z).project(c);
        const mid = (a.y + b.y) / 2;
        fz -= mid * 6; // NDC up = north (smaller z): look further north
      }
    };
    g.processEvents();
    window.__rig.frame(4);
  });
  return s;
}

async function sheet(name, tiles, cols = 5) {
  // compose in a blank page: tiles + labels, JPEG
  const page = await browser.newPage();
  const url = await page.evaluate(async ([tiles, cols, TW, TH]) => {
    const rows = Math.ceil(tiles.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * TW; c.height = rows * TH;
    const x = c.getContext('2d');
    x.fillStyle = '#111'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < tiles.length; i++) {
      const img = new Image();
      img.src = tiles[i].png;
      await img.decode();
      const tx = (i % cols) * TW, ty = Math.floor(i / cols) * TH;
      x.drawImage(img, tx, ty);
      x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(tx, ty, TW, 30);
      x.fillStyle = '#fff'; x.font = 'bold 20px sans-serif';
      x.fillText(tiles[i].label, tx + 10, ty + 22);
      x.strokeStyle = '#000'; x.strokeRect(tx + 0.5, ty + 0.5, TW - 1, TH - 1);
    }
    return c.toDataURL('image/jpeg', 0.86);
  }, [tiles, cols, TW, TH]);
  fs.writeFileSync(`${out}/${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  // a half-size preview for quick looks
  const small = await page.evaluate(async ([src]) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width / 2; c.height = img.height / 2;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  }, [url]);
  fs.writeFileSync(`${out}/${name}-preview.jpg`, Buffer.from(small.split(',')[1], 'base64'));
  await page.close();
  console.log('sheet', `${out}/${name}.jpg`, tiles.length, 'tiles');
}

async function shot(s, label, key) {
  const buf = await s.page.screenshot({ clip: { x: (W - TW) / 2, y: (H - TH) / 2, width: TW, height: TH } });
  fs.writeFileSync(`${out}/tiles/${key}.png`, buf);
  return { label, png: 'data:image/png;base64,' + buf.toString('base64') };
}

/** Day and night tiles of every landmark; checks that with its base centred at the default zoom its top stays on screen. */
async function landmarks(q) {
  const s = await open(q, 'day');
  const ids = await s.page.evaluate(async () => (await import('/src/conquest/world/types.ts')).LANDMARK_IDS);
  const tiles = [];
  for (const id of ids) {
    if (only && !only.has(id)) continue;
    const info = await s.page.evaluate(async ([id, q]) => {
      const L = await import('/src/render/landmarks/index.ts');
      const g = window.__game, w = g.world;
      window.__lm?.removeFromParent();
      const t0 = performance.now();
      const m = L.buildLandmark(id, q === 'low' ? 'low' : 'high');
      const ms = performance.now() - t0;
      const [x, z] = window.__spot;
      const y0 = w.map.heightAt(x, z);
      m.position.set(x, y0, z);
      g.gfx.scene.add(m);
      window.__lm = m;
      const h = m.userData.height;
      // base centred at the default zoom: where does the top land (NDC y, 1 = the top edge of the screen)?
      const cam = g.gfx.cam;
      cam.dist = cam.targetDist = 26;
      cam.jumpTo(x, z);
      cam.apply();
      const top = new cam.camera.position.constructor(x, y0 + h, z).project(cam.camera).y;
      g.hours = 10.5;
      L.setLandmarkLit(m, false);
      window.__frameOn(x, z, h);
      window.__rig.frame(8);
      return { tris: m.geometry.index.count / 3, h: +h.toFixed(2), topNdc: +top.toFixed(2), ms: Math.round(ms) };
    }, [id, q]);
    tiles.push(await shot(s, `${id}  ${info.tris} tris  h ${info.h}`, `landmarks-${q}-day-${id}`));
    await s.page.evaluate(() => { const g = window.__game; g.hours = 22.5; window.__rig.frame(12); });
    await s.page.evaluate(async () => { const L = await import('/src/render/landmarks/index.ts'); L.setLandmarkLit(window.__lm, true); window.__rig.frame(4); });
    tiles.push(await shot(s, `${info.topNdc <= 0.97 ? '' : 'TOP OFF SCREEN '}night`, `landmarks-${q}-night-${id}`));
    console.log(JSON.stringify({ q, id, ...info, log: s.log.splice(0) }));
  }
  await s.ctx.close();
  return tiles;
}

async function civ(q, tod = 'day') {
  const s = await open(q, tod);
  const styles = await s.page.evaluate(async () => Object.keys((await import('/src/render/civilian/styles.ts')).STYLES));
  const tiles = [];
  for (const style of styles) {
    if (only && !only.has(style)) continue;
    const info = await s.page.evaluate(async ([style]) => {
      const C = await import('/src/sim/civilian.ts');
      const S = await import('/src/render/scenery.ts');
      await S.loadScenery();
      const g = window.__game, w = g.world;
      for (const b of window.__civ ?? []) w.kill(b, 'sold');
      g.processEvents();
      window.__rig.frame(30);
      const owner = C.civicOwner(w);
      const kinds = ['house', 'apartment', 'shop', 'hall', 'tower', 'farm', 'warehouse'];
      const rows = [kinds.map((k) => [k, 0]), [['house', 1], ['house', 2], ['apartment', 1], ['house', 3], ['shop', 1], ['apartment', 2], ['house', 4], ['tower', 1], ['house', 5]]];
      const list = [];
      const [sx, sy] = window.__spot;
      rows.forEach((row, ri) => {
        let x = sx - 10;
        for (const [kind, seed] of row) {
          const fp = C.CIVILIAN_FOOTPRINTS[kind];
          const y = sy + (ri === 0 ? -3 : 1);
          try {
            const b = w.addBuilding(C.civilianType(fp.w, fp.h), owner, x, y, true);
            b.scenery = { culture: style, kind, seed, facing: 0 };
            list.push(b);
          } catch (e) { console.warn('place', kind, String(e)); }
          x += fp.w + 0.0 + 1;
        }
      });
      window.__civ = list;
      g.processEvents();
      window.__frameOn(sx + 0.5, sy, 1.5);
      window.__rig.frame(10);
      return { n: list.length };
    }, [style]);
    tiles.push(await shot(s, `${style}`, `civ-${q}-day-${style}`));
    await s.page.evaluate(() => { const g = window.__game; g.hours = 22.5; window.__rig.frame(16); });
    tiles.push(await shot(s, `${style} night`, `civ-${q}-night-${style}`));
    await s.page.evaluate(() => { const g = window.__game; g.hours = 10.5; window.__rig.frame(4); });
    console.log(JSON.stringify({ q, tod, style, ...info, log: s.log.splice(0) }));
  }
  await s.ctx.close();
  return tiles;
}

const sfx = only ? '-subset' : ''; // (a partial run never overwrites the full sheets)
for (const q of presetArg.split(',')) {
  if (what === 'landmarks' || what === 'all') await sheet(`arch-landmarks-${q}${sfx}`, await landmarks(q), 4);
  if (what === 'civ' || what === 'all') await sheet(`arch-civ-${q}${sfx}`, await civ(q), 4);
}
await browser.close();
