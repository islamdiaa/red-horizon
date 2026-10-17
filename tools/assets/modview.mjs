#!/usr/bin/env node
// In-game check of structures and their upgrade modules (headless Chromium + SwiftShader): places the listed
// structures in a tidy row for the local player, screenshots them at the default zoom before and after their
// upgrades complete (the modules build in), and prints draw calls / triangles / console warnings.
//
//   node tools/assets/modview.mjs --port 5276 --faction soviet --types fact,proc,powr --up 'fact=cy_t2+cy_t3,proc=proc_processor' --out /tmp/x
//   options: --hd 0|1   --dist 20 (camera distance; 20 = default zoom)   --yaw 0   --climate temperate|winter|desert
//            --tod day|night   --hour 11   --wait 6000 (settle ms per shot)   --gap 1 (cells between structures)
//            --mid 'js on g' (run between the before and after shots, e.g. damage)   --rows 'fact,proc;powr,weap' (several rows)
//            --pending 'fact=cy_t3:0.5' (an upgrade in progress: building.task)   --size 1600x900
//            --post 'js' --post-wait 1500 (a third shot, <out>-post.png, after more script: e.g. a kill)
//            --focus N (centre on the Nth placed structure)   --settle 10000 (ms before the first shot)
//            --js '<code>' (run after placing: g = game, w = world, B = the placed structures, e.g. walls next to a gate)
// Writes <out>-before.png and <out>-after.png (only -after when --up is empty: --no-before). Types missing from the
// rules (structures still being designed) get a placeholder definition so they can be placed.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const flag = (f) => args.includes(f);
const port = opt('--port', '5276');
const faction = opt('--faction', 'soviet');
const rows = (opt('--rows', null) ?? opt('--types', 'fact')).split(';').map((r) => r.split(',').filter(Boolean));
const ups = Object.fromEntries((opt('--up', '') || '').split(',').filter(Boolean).map((s) => { const [t, l] = s.split('='); return [t, (l ?? '').split('+').filter(Boolean)]; }));
const pending = Object.fromEntries((opt('--pending', '') || '').split(',').filter(Boolean).map((s) => { const [t, l] = s.split('='); const [id, p] = l.split(':'); return [t, { id, progress: Number(p) }]; }));
const out = opt('--out', '/tmp/modview');
const dist = Number(opt('--dist', '20'));
const yaw = Number(opt('--yaw', '0'));
const wait = Number(opt('--wait', '6000'));
const gap = Number(opt('--gap', '1'));
const hd = opt('--hd', '1');
const mid = opt('--mid', null);
const [W, H] = opt('--size', '1600x900').split('x').map(Number);
const url = `http://localhost:${port}/?autostart=1&faction=${faction}&climate=${opt('--climate', 'temperate')}&tod=${opt('--tod', 'day')}&hour=${opt('--hour', '11')}&wx=clear&size=${opt('--map', '96')}&seed=${opt('--seed', '1234')}&fog=0&intro=0&hd=${hd}&credits=50000`;

// placeholder definitions for structures whose rules may not exist yet: [size, owner]
const PLACEHOLDER = {
  purf: [[2, 2], ['allies']], smlt: [[2, 2], ['soviet']], mout: [[2, 2], null], lgst: [[3, 2], null],
  bnkr: [[2, 2], null], gate: [[1, 1], null], rlab: [[3, 2], null],
};

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(here, '..', 'nsslibs/lib') },
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
await page.goto(url, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 600000 });
await page.waitForTimeout(1000);

// HD: load the structure types first (structures placed on screen stay procedural until their next instance)
if (hd !== '0') {
  const st = await page.evaluate(async ([types, fac]) => {
    const M = await import('/src/render/models/index.ts');
    const t0 = performance.now();
    let st = [];
    while (performance.now() - t0 < 240000) {
      st = types.map((t) => M.requestHdModel(t, fac));
      if (!st.includes('pending')) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    return types.map((t, i) => `${t}:${st[i]}`).join(' ');
  }, [[...new Set(rows.flat())], faction]);
  console.log('hd', st);
}

const placed = await page.evaluate(async ([rows, PH, gap]) => {
  const g = window.__game;
  const R = await import('/src/data/rules.ts');
  for (const [id, [size, owner]] of Object.entries(PH)) {
    if (R.BUILDINGS[id]) continue;
    R.BUILDINGS[id] = { ...R.BUILDINGS.powr, id, name: id, size, power: 0, ...(owner ? { owner } : {}), prereq: [], factory: undefined, dock: undefined, exit: undefined };
  }
  const w = g.world;
  const m = w.map;
  const p = g.local;
  // remove the local start units (the MCV would sit in the way)
  for (const u of w.units) if (u.owner === p) u.alive = false;
  const sizes = rows.map((r) => r.map((t) => R.BUILDINGS[t].size));
  const rowW = sizes.map((r) => r.reduce((a, s) => a + s[0] + gap, -gap));
  const rowH = sizes.map((r) => Math.max(...r.map((s) => s[1])));
  const W = Math.max(...rowW);
  const H = rowH.reduce((a, h) => a + h + gap + 1, -gap - 1);
  const free = (x0, y0) => {
    for (let y = y0; y < y0 + H; y++) for (let x = x0; x < x0 + W; x++) {
      if (!m.inBounds(x, y) || !m.buildable(x, y) || m.occupant[m.idx(x, y)]) return false;
    }
    return true;
  };
  const s = m.startPositions[0];
  let o = null;
  for (let r = 0; r < Math.max(m.w, m.h) && !o; r++) {
    for (let dy = -r; dy <= r && !o; dy++) for (let dx = -r; dx <= r && !o; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x0 = Math.round(m.w / 2 - W / 2) + dx, y0 = Math.round(m.h / 2 - H / 2) + dy;
      if (free(x0, y0)) o = [x0, y0];
    }
  }
  if (!o) return { error: 'no free area' };
  const ids = [];
  let y = o[1];
  rows.forEach((row, ri) => {
    let x = o[0] + Math.round((W - rowW[ri]) / 2);
    row.forEach((t, k) => {
      const sz = sizes[ri][k];
      const b = w.addBuilding(t, p, x, y + (rowH[ri] - sz[1]), true);
      ids.push(b.id);
      x += sz[0] + gap;
    });
    y += rowH[ri] + gap + 1;
  });
  w.dirtyLists = true;
  w.updateVisibility(p);
  // full power (lights on) and a clean frame (no HUD) for the screenshots
  Object.defineProperty(p, 'lowPower', { get: () => false, configurable: true });
  const st = document.createElement('style');
  st.textContent = '#ui { display: none !important; }';
  document.head.appendChild(st);
  const cx = o[0] + W / 2, cy = o[1] + H / 2;
  return { ids, center: [cx, cy], start: [s.x, s.y] };
}, [rows, PLACEHOLDER, gap]);
console.log('placed', JSON.stringify(placed));
if (placed.error) { await browser.close(); process.exit(1); }

if (opt('--js', null)) console.log('js:', await page.evaluate(`((ids) => { const g = window.__game; const w = g.world; const B = ids.map((i) => w.getEntity(i)); ${opt('--js', '')} })(${JSON.stringify(placed.ids)})`));

if (opt('--focus', null) !== null) {
  // centre on one of the placed structures (index into the placed list)
  placed.center = await page.evaluate(([id]) => { const b = window.__game.world.getEntity(id); return [b.x, b.y]; }, [placed.ids[Number(opt('--focus', '0'))]]);
}
const cam = async () => page.evaluate(([c, d, yw]) => {
  const k = window.__game.gfx.cam;
  k.jumpTo(c[0], c[1]);
  k.dist = k.targetDist = d;
  k.yaw = k.targetYaw = yw;
}, [placed.center, dist, yaw]);
const setUps = async (on) => page.evaluate(([ids, ups, pending, on]) => {
  const w = window.__game.world;
  for (const id of ids) {
    const b = w.getEntity(id);
    if (!b) continue;
    b.upgrades = on ? [...(ups[b.type.id] ?? [])] : [];
    const pe = pending[b.type.id];
    b.task = on && pe ? { kind: 'upgrade', id: pe.id, level: 1, progress: pe.progress, paid: 0, player: b.owner.id } : undefined;
  }
}, [placed.ids, ups, pending, on]);
const stats = async () => page.evaluate(() => { const g = window.__game; return { calls: g.gfx.stats.calls, tris: g.gfx.stats.tris }; });

await cam();
await page.waitForTimeout(Number(opt('--settle', '10000'))); // placement effects fade out
const hasUps = Object.keys(ups).length > 0 || Object.keys(pending).length > 0;
if (hasUps && !flag('--no-before')) {
  await setUps(false);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}-before.png`, timeout: 300000 });
  console.log('before', JSON.stringify(await stats()));
}
if (mid) console.log('mid:', await page.evaluate(`(() => { const g = window.__game; return ${mid}; })()`));
await setUps(true);
await page.waitForTimeout(wait);
await page.screenshot({ path: `${out}-after.png`, timeout: 300000 });
console.log('after', JSON.stringify(await stats()));
if (opt('--post', null)) {
  // a third shot after more script (e.g. destroy a structure: its modules break off with the collapse)
  console.log('post:', await page.evaluate(`(() => { const g = window.__game; return ${opt('--post', '')}; })()`));
  await page.waitForTimeout(Number(opt('--post-wait', '1500')));
  await page.screenshot({ path: `${out}-post.png`, timeout: 300000 });
  console.log('post', JSON.stringify(await stats()));
}
console.log(JSON.stringify({ errors: errors.slice(0, 10) }));
await browser.close();
