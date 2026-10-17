// [JUICE] Screenshot scenes for the game-feel pass (deterministic frame stepping, so effects are caught mid-air).
//   QA_BASE=http://localhost:5264/ node tools/qa/juice_shots.mjs <scene> <outDir> [juice=1] [q=high]
// scenes: battle · columns · tesla · flak · promotion · death · all
import { launch, sleep, BASE } from './browser.mjs';
import fs from 'node:fs';

const [scene = 'all', out = '/tmp/rh-engage/juice', juice = '1', q = 'high'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1600), H = +(process.env.H ?? 900);
const url = `${BASE}?autostart=1&scenario=battle&fog=0&size=64&seed=11&tod=${process.env.TOD ?? 'day'}&q=${q}&juice=${juice}&hd=1&speed=0.1`;
const { browser, page, errors } = await launch({ width: W, height: H });
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 240000 }); // started (main.ts exposes the game before start())
// take over the clock: Game.frame driven with a fixed step (both A/B runs line up on the same tick), hints hidden
await page.evaluate(() => {
  const g = window.__game;
  g.running = false;
  cancelAnimationFrame(g.raf);
  g.speed = 1;
  while (g.world.tick < 8) { g.world.step(); g.processEvents(); }
  window.__clock = performance.now();
  g.last = window.__clock;
  window.__step = (n = 1, dtMs = 1000 / 30) => { for (let i = 0; i < n; i++) { window.__clock += dtMs; g.frame(window.__clock); } };
  // the same without drawing (everything but the GPU work: fast on SwiftShader); stops early once __hit is set
  window.__fast = (n = 1, dtMs = 1000 / 30, stopOnHit = false) => {
    const r = g.gfx.render;
    g.gfx.render = () => {};
    try { for (let i = 0; i < n && !(stopOnHit && window.__hit); i++) { window.__clock += dtMs; g.frame(window.__clock); } } finally { g.gfx.render = r; }
    return window.__hit;
  };
  const st = document.createElement('style');
  st.textContent = '.hint.panel { display: none !important; }';
  document.head.appendChild(st);
  g.audio.unlock?.();
});
const step = (n, dt) => page.evaluate(([n, dt]) => window.__step(n, dt), [n, dt]);
const cam = (x, y, d, yaw) => page.evaluate(([x, y, d, yaw]) => { const c = window.__game.gfx.cam; c.jumpTo(x, y); c.dist = c.targetDist = d; if (yaw !== undefined) c.yaw = c.targetYaw = yaw; }, [x, y, d, yaw]);
const shot = async (name) => { const p = `${out}/${name}.png`; await page.screenshot({ path: p, timeout: 180000 }); console.log('shot', p); };

/** Arm a one-shot flag when an Effects method is called (to catch a bolt / flak burst in the act). */
const arm = (method) => page.evaluate((m) => {
  const fx = window.__game.effects;
  window.__hit = null;
  if (!fx['__orig_' + m]) fx['__orig_' + m] = fx[m];
  fx[m] = function (...a) { if (!window.__hit) window.__hit = a.map((v) => (v && typeof v === 'object' && 'x' in v ? { x: v.x, y: v.y, z: v.z } : v)); return fx['__orig_' + m].apply(this, a); };
}, method);
const waitHit = (maxFrames, dt = 1000 / 30) => page.evaluate(([n, dt]) => window.__fast(n, dt, true), [maxFrames, dt]);
const fast = (n, dt = 1000 / 30) => page.evaluate(([n, dt]) => window.__fast(n, dt, false), [n, dt]);

async function battle() {
  // armies charge; fast-forward to contact and frame the thick of it
  const c = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const mid = { x: w.map.w / 2, y: w.map.h / 2 };
    for (const p of w.players) {
      const ids = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
      w.issue({ c: 'move', player: p.id, units: ids, x: mid.x, y: mid.y, attackMove: true });
    }
    g.fastForward(12);
    return 0;
  });
  await fast(60); // 2 s more with the effects clock running (no drawing)
  const c2 = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const mid = { x: w.map.w / 2, y: w.map.h / 2 };
    const f = w.units.filter((u) => u.alive && w.tick - u.lastFireTick < 60);
    const cx = f.reduce((s, u) => s + u.x, 0) / Math.max(1, f.length), cy = f.reduce((s, u) => s + u.y, 0) / Math.max(1, f.length);
    return [cx || mid.x, cy || mid.y];
  });
  void c;
  await cam(c2[0], c2[1] + 1.5, 20);
  await step(6);
  await shot(`battle-juice${juice}`);
  await step(10);
  await shot(`battle-juice${juice}-b`);
}

async function columns() {
  // damage the enemy (Soviet) base: smoke columns rise from the burning structures
  const c = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const enemy = w.players.find((p) => p !== g.local);
    const bs = w.buildings.filter((b) => b.alive && b.owner === enemy && !b.bt.wall);
    bs.forEach((b, i) => { if (i % 2 === 0) b.hp = Math.max(1, b.maxHp * (i % 4 === 0 ? 0.18 : 0.4)); });
    const cx = bs.reduce((s, b) => s + b.x, 0) / bs.length, cy = bs.reduce((s, b) => s + b.y, 0) / bs.length;
    return [cx, cy];
  });
  await cam(c[0], c[1] + 4, 44);
  await step(2);
  // let ~12 s of smoke build up without drawing every frame (the particles are analytic in time)
  await fast(360);
  await step(3);
  await shot('columns-base');
  await cam(c[0], c[1] + 9, 70);
  await step(3);
  await shot('columns-far');
}

async function tesla() {
  // allied tanks drive into a Soviet tesla coil
  const c = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const enemy = w.players.find((p) => p.faction === 'soviet');
    const ally = w.players.find((p) => p.faction === 'allies');
    const coil = w.buildings.find((b) => b.alive && b.owner === enemy && b.bt.id === 'tsla');
    const toward = Math.atan2(w.map.h / 2 - coil.y, w.map.w / 2 - coil.x);
    const ids = [];
    for (let k = 0; k < 5; k++) {
      const [x, y] = w.findFreeSpot(coil.x + Math.cos(toward) * 4.2 + (k - 2) * 0.9, coil.y + Math.sin(toward) * 4.2, 3);
      const u = w.addUnit(k % 2 ? '2tnk' : '1tnk', ally, x, y);
      ids.push(u.id);
    }
    w.dirtyLists = true;
    w.issue({ c: 'attack', player: ally.id, units: ids, target: coil.id });
    return [coil.x + Math.cos(toward) * 2, coil.y + Math.sin(toward) * 2];
  });
  await cam(c[0], c[1] + 1.5, 15);
  for (let k = 0; k < 3; k++) {
    await arm('teslaBolt');
    const h = await waitHit(240);
    if (!h) { console.log('no tesla shot'); return; }
    console.log('tesla hit', JSON.stringify(h), 'coil', JSON.stringify(c));
    await cam((h[0].x + h[1].x) / 2, (h[0].z + h[1].z) / 2 + 1.2, 12);
    await step(k === 2 ? 8 : 2);
    await shot(`tesla-${k}`);
    await step(20);
  }
}

async function flak() {
  // Soviet aircraft over the Allied AA guns
  const c = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const allies = w.players.find((p) => p.faction === 'allies');
    const sov = w.players.find((p) => p.faction === 'soviet');
    const guns = w.buildings.filter((b) => b.alive && b.owner === allies && b.bt.id === 'agun');
    const gun = guns[0];
    const target = w.buildings.filter((b) => b.alive && b.owner === allies && !b.bt.wall).sort((a, b) => Math.hypot(a.x - gun.x, a.y - gun.y) - Math.hypot(b.x - gun.x, b.y - gun.y))[1] ?? gun;
    const ids = [];
    for (let k = 0; k < 6; k++) {
      const u = w.addUnit(k % 3 === 0 ? 'hind' : k % 3 === 1 ? 'yak' : 'mig', sov, gun.x + 7 + (k % 3), gun.y - 2 + Math.floor(k / 3));
      u.altitude = u.ut.vtol ? 1.55 : 2.3;
      ids.push(u.id);
    }
    // a second gun next to the first for a denser barrage
    w.dirtyLists = true;
    w.issue({ c: 'attack', player: sov.id, units: ids, target: target.id });
    return [gun.x + 2, gun.y];
  });
  await cam(c[0], c[1] + 1.5, 17);
  await arm('flakBurst');
  const h = await waitHit(300);
  if (!h) { console.log('no flak'); return; }
  await cam(h[0].x, h[0].z + 2, 15);
  await step(4);
  await shot('flak-0');
  await step(20);
  await shot('flak-1');
  await step(20);
  await shot('flak-2');
}

async function promotion() {
  const c = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const mid = { x: w.map.w / 2, y: w.map.h / 2 };
    const u = w.units.filter((u) => u.alive && u.owner === g.local && u.kind === 'vehicle' && u.ut.turret)
      .sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y))[0];
    window.__promo = u.id;
    return [u.x, u.y];
  });
  await cam(c[0], c[1] + 1, 9);
  await step(2);
  await page.evaluate(() => { const g = window.__game; g.world.events.push({ e: 'promoted', id: window.__promo, rank: 2 }); g.processEvents(); });
  for (let k = 0; k < 5; k++) {
    await step(k === 0 ? 2 : 4);
    await shot(`promotion-${k}`);
  }
}

async function death() {
  // a Mammoth is destroyed: cook-off, hatch fire jet, fuel fireball, then a burning wreck with a smoke column
  const c = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const u = w.units.find((u) => u.alive && u.type.id === '4tnk');
    window.__victim = u.id;
    return [u.x, u.y];
  });
  await cam(c[0], c[1] + 1, 12);
  await step(2);
  await page.evaluate(() => { const g = window.__game, w = g.world; const u = w.getEntity(window.__victim); w.kill(u, 'blown'); g.processEvents(); });
  const at = [3, 6, 6, 9, 15, 30];
  for (let k = 0; k < at.length; k++) {
    await step(at[k]);
    await shot(`death-${k}`);
  }
}

const scenes = { battle, columns, tesla, flak, promotion, death };
const list = scene === 'all' ? Object.keys(scenes) : scene.split(',');
for (const s of list) {
  try { await scenes[s](); } catch (e) { console.log('scene failed', s, e.message); }
}
console.log('mix', JSON.stringify(await page.evaluate(() => window.__game.audio.mixStats)));
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
await browser.close();
