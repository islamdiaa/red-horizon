// Screenshots and short frame sequences for the effects director's cut (heat haze, lit smoke, lens rain,
// persistent battlefield damage). Deterministic frame stepping, so before / after runs line up.
//   QA_BASE=http://localhost:5274/ node tools/qa/fxdc_shots.mjs <scene|all> <outDir> [q=high] [extra query]
// scenes: base (burning base, 3-frame haze sequence) · night (lit smoke at night) · storm (storm intro, lens rain)
//         · scarred (the battlefield after a long fight) · photo (photo mode in the rain)
import { launch, BASE } from './browser.mjs';
import fs from 'node:fs';

const [scene = 'all', out = '/tmp/rh-fxdc', q = 'high', extra = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1600), H = +(process.env.H ?? 900);
const tag = process.env.TAG ?? '';

async function open(query) {
  const url = `${BASE}?autostart=1&scenario=battle&fog=0&size=64&seed=11&q=${q}&hd=1&speed=0.1&${query}${extra ? '&' + extra : ''}`;
  const s = await launch({ width: W, height: H });
  await s.page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await s.page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 240000 });
  await s.page.evaluate(() => {
    const g = window.__game;
    g.running = false;
    cancelAnimationFrame(g.raf);
    g.speed = 1;
    while (g.world.tick < 8) { g.world.step(); g.processEvents(); }
    window.__clock = performance.now();
    g.last = window.__clock;
    window.__step = (n = 1, dtMs = 1000 / 30) => { for (let i = 0; i < n; i++) { window.__clock += dtMs; g.frame(window.__clock); } };
    // everything but the drawing (fast on SwiftShader)
    window.__fast = (n = 1, dtMs = 1000 / 30) => {
      const r = g.gfx.render;
      g.gfx.render = () => {};
      try { for (let i = 0; i < n; i++) { window.__clock += dtMs; g.frame(window.__clock); } } finally { g.gfx.render = r; }
    };
    const st = document.createElement('style');
    st.textContent = '.hint.panel { display: none !important; }';
    document.head.appendChild(st);
  });
  return s;
}

const helpers = (page) => ({
  step: (n, dt) => page.evaluate(([n, dt]) => window.__step(n, dt), [n, dt]),
  fast: (n, dt = 1000 / 30) => page.evaluate(([n, dt]) => window.__fast(n, dt), [n, dt]),
  cam: (x, y, d, yaw) => page.evaluate(([x, y, d, yaw]) => { const c = window.__game.gfx.cam; c.jumpTo(x, y); c.dist = c.targetDist = d; if (yaw !== undefined) c.yaw = c.targetYaw = yaw; }, [x, y, d, yaw]),
  shot: async (name) => { const p = `${out}/${name}${tag}.png`; await page.screenshot({ path: p, timeout: 180000 }); console.log('shot', p); },
});

/** Set the enemy (Soviet) base on fire: half its structures badly damaged, two destroyed, wrecks in front. */
async function burnBase(page) {
  return page.evaluate(() => {
    const g = window.__game, w = g.world;
    const enemy = w.players.find((p) => p !== g.local);
    const bs = w.buildings.filter((b) => b.alive && b.owner === enemy && !b.bt.wall);
    bs.forEach((b, i) => { if (i % 2 === 0) b.hp = Math.max(1, b.maxHp * (i % 4 === 0 ? 0.16 : 0.4)); });
    const cx = bs.reduce((s, b) => s + b.x, 0) / bs.length, cy = bs.reduce((s, b) => s + b.y, 0) / bs.length;
    // two structures destroyed (collapse, rubble, smoking ruins) and a few burning wrecks
    const dead = bs.filter((b, i) => i % 2 === 1).slice(0, 2);
    for (const b of dead) w.kill(b, 'normal');
    const tanks = w.units.filter((u) => u.alive && u.owner === enemy && u.kind === 'vehicle').slice(0, 3);
    for (const u of tanks) w.kill(u, 'normal');
    g.processEvents();
    return [cx, cy];
  });
}

async function base(night) {
  const { browser, page, errors } = await open(`tod=${night ? 'night' : 'day'}&climate=winter`);
  const h = helpers(page);
  const c = await burnBase(page);
  await h.cam(c[0], c[1] + 3, night ? 26 : 22);
  await h.step(2);
  await h.fast(300); // 10 s: smoke columns build up, collapses settle
  await h.step(3);
  const name = night ? 'smoke-night' : 'haze-base';
  for (let k = 0; k < (night ? 1 : 3); k++) {
    await h.shot(`${name}-${k}`);
    await h.step(1);
  }
  // closer: the default-zoom view right over the fires
  await h.cam(c[0], c[1] + 1.5, 14);
  await h.step(4);
  await h.shot(`${name}-close`);
  console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
  await browser.close();
}

async function storm() {
  // the real opening cinematic in a storm, stepped frame by frame once it has started; its timers (briefing
  // text, the end of the intro) move to a queue that advances with the frames, so the dive, the text and the
  // lens rain line up however slow the software renderer is
  const url = `${BASE}?autostart=1&size=64&seed=11&q=${q}&hd=1&fog=0&wx=storm&intro=1&tod=day${extra ? '&' + extra : ''}`;
  const { browser, page, errors } = await launch({ width: W, height: H });
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__game.gfx && document.body.classList.contains('cine-active'), null, { timeout: 240000 });
  await page.evaluate(() => {
    const g = window.__game;
    const q = [];
    let now = 0;
    window.setTimeout = (fn, ms = 0, ...a) => { q.push({ at: now + (+ms || 0), fn, a }); return 0x7f000000 + q.length; };
    const tick = (ms) => {
      now += ms;
      for (let i = 0; i < q.length; i++) {
        const t = q[i];
        if (t && t.at <= now) { q[i] = null; try { typeof t.fn === 'function' && t.fn(...t.a); } catch { /* */ } }
      }
    };
    g.running = false;
    cancelAnimationFrame(g.raf);
    window.__clock = performance.now();
    g.last = window.__clock;
    // each frame waits for the GPU (SwiftShader would otherwise queue minutes of work)
    const gl = g.gfx.renderer.getContext(), px = new Uint8Array(4);
    window.__step = (n = 1, dtMs = 1000 / 30) => { for (let i = 0; i < n; i++) { tick(dtMs); window.__clock += dtMs; g.frame(window.__clock); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } };
  });
  for (const [k, n] of [[0, 24], [1, 30], [2, 36], [3, 45]]) {
    await page.evaluate((n) => window.__step(n), n);
    const st = await page.evaluate(() => ({ dof: +window.__game.gfx.cinematicDof.toFixed(2), cine: document.body.classList.contains('cine-on'), lens: window.__game.gfx.fxStats().lensRain }));
    console.log('intro', k, JSON.stringify(st));
    const p = `${out}/lensrain-storm-intro-${k}${tag}.png`;
    await page.screenshot({ path: p, timeout: 600000 });
    console.log('shot', p);
  }
  console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
  await browser.close();
}

async function photo() {
  const { browser, page, errors } = await open('tod=day&wx=storm');
  const h = helpers(page);
  const c = await burnBase(page);
  await h.cam(c[0], c[1] + 2, 16);
  await h.fast(120);
  await page.evaluate(() => { const g = window.__game; g.gfx.setPhotoMode(true); document.body.classList.add('photo-mode'); });
  await h.step(45);
  await h.shot('lensrain-photo');
  await h.step(30);
  await h.shot('lensrain-photo-b');
  console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
  await browser.close();
}

async function scarred() {
  // a long fight in the middle: both armies (plus reinforcements every 40 s) attack-move to the centre
  const { browser, page, errors } = await open('tod=day&climate=temperate');
  const h = helpers(page);
  const reinforce = () => page.evaluate(() => {
    const g = window.__game, w = g.world;
    const mid = { x: w.map.w / 2, y: w.map.h / 2 };
    // no superweapons in this one (a nuke on the camera would white the shot out)
    for (const p of w.players) for (const k of Object.keys(p.superCharge ?? {})) p.superCharge[k] = 0;
    const extra = { allies: ['2tnk', '2tnk', '1tnk', 'arty', 'e1', 'e1', 'e3', 'e3'], soviet: ['3tnk', '3tnk', '4tnk', 'v2rl', 'e1', 'e1', 'e4', 'e2'] };
    for (const p of w.players) {
      const own = w.buildings.filter((b) => b.alive && b.owner === p);
      if (!own.length) continue;
      const cx = own.reduce((s, b) => s + b.x, 0) / own.length, cy = own.reduce((s, b) => s + b.y, 0) / own.length;
      (extra[p.faction] ?? extra.allies).forEach((t, k) => {
        try { const [x, y] = w.findFreeSpot(cx + (k % 4) - 1.5 + (mid.x - cx) * 0.3, cy + Math.floor(k / 4) + (mid.y - cy) * 0.3, 6); w.addUnit(t, p, x, y); } catch { /* */ }
      });
      w.dirtyLists = true;
      const ids = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
      w.issue({ c: 'move', player: p.id, units: ids, x: mid.x, y: mid.y, attackMove: true });
    }
    return [mid.x, mid.y];
  });
  const mid = await reinforce();
  // the camera watches the middle all along (impacts only scar the ground where the player can see)
  await h.cam(mid[0], mid[1] + 2, 30);
  const minutes = +(process.env.MINUTES ?? 4);
  for (let s = 0; s < minutes * 60; s += 20) {
    await h.fast(600, 1000 / 30);
    if (s % 40 === 20) await reinforce();
  }
  // the fight is over: the survivors leave the field (removed quietly), the dust settles
  await page.evaluate(([mx, my]) => {
    const w = window.__game.world;
    for (const u of [...w.units]) if (u.alive && !u.ut.harvester && Math.hypot(u.x - mx, u.y - my) < 16) w.despawn(u);
    w.dirtyLists = true;
  }, mid);
  await h.fast(900);
  // the shelling also caught a wood near the front: its trees burn down
  const wood = await page.evaluate(([mx, my]) => {
    const g = window.__game, w = g.world, m = w.map;
    const trees = [];
    for (let i = 0; i < m.w * m.h; i++) if (m.tree[i]) trees.push(i);
    let best = -1, bestS = -1;
    for (const i of trees) {
      const x = i % m.w, y = Math.floor(i / m.w);
      if (Math.hypot(x - mx, y - my) > 22) continue;
      let n = 0;
      for (const j of trees) if (Math.abs((j % m.w) - x) <= 2 && Math.abs(Math.floor(j / m.w) - y) <= 2) n++;
      if (n > bestS) { bestS = n; best = i; }
    }
    if (best < 0) return [mx, my, 0];
    const bx = best % m.w, by = Math.floor(best / m.w);
    const hit = trees.filter((j) => Math.hypot((j % m.w) - bx, Math.floor(j / m.w) - by) < 2.6).slice(0, 14);
    for (const i of hit) m.removeTree(i);
    for (let k = 0; k < 4; k++) {
      const i = hit[(k * 3) % hit.length], x = (i % m.w) + 0.5, y = Math.floor(i / m.w) + 0.5;
      g.ents.destruction.onImpact(x, y, m.heightAt(x, y) + 0.1, 'large', 1);
      g.effects.explosion({ x, y: m.heightAt(x, y) + 0.1, z: y, clone() { return this; } }, 'large', 1);
    }
    return [bx + 0.5, by + 0.5, hit.length];
  }, mid);
  await h.fast(240);
  await h.step(3);
  const st = await page.evaluate(() => ({ t: window.__game.world.time, d: window.__game.ents.destruction.stats(), trees: window.__game.ents.destruction.burntTreeCount, scars: window.__game.effects.scars?.slots.liveCount }));
  console.log('scarred', JSON.stringify(st));
  await h.shot('scarred-battlefield');
  await h.cam(mid[0], mid[1] + 1, 18);
  await h.step(3);
  await h.shot('scarred-battlefield-close');
  if (wood[2] > 0) {
    await h.cam(wood[0], wood[1] + 1.5, 13);
    await h.step(3);
    await h.shot('scarred-burnt-trees');
  }
  console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
  await browser.close();
}

const all = { base: () => base(false), night: () => base(true), storm, photo, scarred };
for (const [k, f] of Object.entries(all)) if (scene === 'all' || scene === k) await f();

// diagnostics: haze / soft-depth / lens-rain state, and a frame with the shimmer exaggerated 15x
if (scene === 'diag') {
  const { browser, page, errors } = await open('tod=day&climate=winter');
  const h = helpers(page);
  const c = await burnBase(page);
  await h.cam(c[0], c[1] + 1.5, 14);
  await h.fast(150);
  await h.step(3);
  console.log(JSON.stringify(await page.evaluate(() => window.__game.gfx.fxStats()), null, 0));
  await page.evaluate(() => { const g = window.__game; g.gfx.final.hazeOn = () => (g.gfx.haze.active ? 15 : 0); });
  await h.step(1);
  await h.shot('diag-haze-x15');
  console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
  await browser.close();
}
