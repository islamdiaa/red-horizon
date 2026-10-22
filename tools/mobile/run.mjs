// Android Chrome test matrix for the mobile lab (README.md). Needs `tools/mobile/mobile.sh up` running and a
// game server the device reaches as http://localhost:<port> (RH_MOBILE_GAME).
//
//   node tools/mobile/run.mjs [--url http://localhost:5305/] [--profiles phone-land,phone,tablet-land,tablet]
//        [--only menus,match,gestures,build,perf,lifecycle,rotate,keyboard,pwa] [--out <dir>] [--restart-gb 8.5]
//
// Each scenario starts Chrome fresh (Playwright force-stops it), so one failure doesn't cascade. Writes
// <out>/report.json and screenshots; exits 1 if a check failed.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]?.startsWith('--') ? '1' : all[i + 1] ?? '1']] : a), []));
const URL0 = args.url ?? 'http://localhost:5305/';
const PROFILES = (args.profiles ?? 'phone-land,phone,tablet-land,tablet').split(',');
const ONLY = new Set((args.only ?? 'menus,match,gestures,build,perf,lifecycle,rotate,keyboard,pwa').split(','));
const OUT = path.resolve(args.out ?? path.join(os.tmpdir(), 'rh-mobile'));
fs.mkdirSync(OUT, { recursive: true });
const gameUrl = (q = '') => { const u = new URL(URL0); u.searchParams.set('debug', '1'); for (const [k, v] of new URLSearchParams(q)) u.searchParams.set(k, v); return u.href; };

const checks = [];
const t0 = Date.now();
let cur = '';
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s ${cur}]`, ...a);
function check(ok, what, detail = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  checks.push({ at: cur, ok: !!ok, what, detail: d.slice(0, 1500) });
  log(`${ok ? 'PASS' : 'FAIL'} ${what}${d ? `  -- ${d.slice(0, 400)}` : ''}`);
  return !!ok;
}

/**
 * The emulator's host process keeps about 1 GB of GPU memory from every Chrome that is killed while it ran the
 * game (SwiftShader / gfxstream, not the page), so reboot the emulator once it has grown past --restart-gb.
 */
function freshEmulatorIfBloated() {
  const gb = +(args['restart-gb'] ?? 8.5);
  const m = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', L.CONTAINER], { encoding: 'utf8' }).match(/([\d.]+)GiB/);
  if (!m || +m[1] < gb) return;
  log(`emulator at ${m[1]} GB: rebooting it`);
  const sh = path.join(path.dirname(new URL(import.meta.url).pathname), 'mobile.sh');
  execFileSync(sh, ['down'], { stdio: 'inherit' });
  execFileSync(sh, ['up'], { stdio: 'inherit', env: process.env });
}

/** Fresh Chrome on a profile, the game's main menu up. */
async function boot(profile, { query = '', clear = true } = {}) {
  freshEmulatorIfBloated();
  L.setProfile(profile);
  await L.sleep(3000);
  const s = await L.launch();
  if (clear) {
    // a fresh profile on the game's origin: no settings, saves or service worker from earlier runs
    await s.page.goto(new URL(URL0).origin + '/manifest.webmanifest', { timeout: 120000 }).catch(() => {});
    await s.page.evaluate(async () => {
      localStorage.clear(); sessionStorage.clear();
      for (const r of (await navigator.serviceWorker?.getRegistrations?.()) ?? []) await r.unregister();
      for (const k of (await caches?.keys?.()) ?? []) await caches.delete(k);
      for (const d of (await indexedDB.databases?.()) ?? []) indexedDB.deleteDatabase(d.name);
    }).catch(() => {});
  }
  await s.page.goto(gameUrl(query), { waitUntil: 'load', timeout: 240000 });
  // the launcher can put the display back to portrait while Chrome starts: make sure the profile's orientation holds
  const land = L.PROFILES[profile].rot === 1;
  let v = await L.waitViewport(s.page, (v) => (v.w > v.h) === land, 8000);
  if ((v.w > v.h) !== land) { L.rotate(L.PROFILES[profile].rot); v = await L.waitViewport(s.page, (v) => (v.w > v.h) === land, 30000); }
  if ((v.w > v.h) !== land) throw new Error(`could not get ${profile} orientation (viewport ${v.w}x${v.h})`);
  await L.waitMenu(s.page);
  s.touch = new L.Touch(s.page);
  s.at = new L.AdbTouch(s.page);
  await s.at.calibrate();
  return s;
}
async function close(s) { await s?.context.close().catch(() => {}); await s?.device.close().catch(() => {}); }
const shot = (s, name) => L.shot(s.page, OUT, `${cur.replace(/[^\w-]+/g, '_')}-${name}`);
/**
 * Console noise that isn't the game's: Chrome's own WebAPK message on a device without the Play Store (it falls back
 * to a home-screen shortcut), and the multiplayer lobby probing the relay on a static test server (405; production
 * proxies /relay).
 */
const NOT_THE_GAME = [/Failed to install WebAPK/, /status of 405 \(Method Not Allowed\)/];
function errorsCheck(s, where) {
  const errs = s.log.errors.filter((t) => !NOT_THE_GAME.some((r) => r.test(t)));
  if (errs.length !== s.log.errors.length) log(`(ignored: ${s.log.errors.filter((t) => !errs.includes(t)).join(' | ').slice(0, 200)})`);
  check(!errs.length, `no console or page errors (${where})`, errs.slice(0, 4).join(' || '));
  check(!s.log.csp.length, `no CSP violations (${where})`, s.log.csp.slice(0, 3).join(' || '));
  s.log.errors.length = 0; s.log.csp.length = 0;
}

/** Quick Battle from the menu with a real tap, intro skipped with a tap. */
async function quickBattle(s) {
  const qb = await L.centerOf(s.page, '.main-screen:not(.leaving) .mm-nav-btn', /quick battle/i);
  if (!check(qb, 'Quick Battle entry visible')) throw new Error('no Quick Battle');
  await s.at.tap(qb.x, qb.y);
  const tq = Date.now();
  await L.waitMatch(s.page);
  log(`match up after ${((Date.now() - tq) / 1000).toFixed(0)} s`);
  if (await s.page.evaluate(() => document.body.classList.contains('cine-active'))) {
    const skipText = await s.page.evaluate(() => (document.querySelector('.cine-skip, [class*="skip"]')?.textContent ?? '').trim());
    check(!/press any key/i.test(skipText), 'intro skip prompt speaks to touch players', skipText);
    await L.sleep(1500);
    await s.at.tap(200, 200);
    const ok = await s.page.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 60000, polling: 500 }).then(() => true, () => false);
    check(ok, 'a tap skips the intro');
  }
  await s.page.waitForFunction(() => { const c = window.__game?.gfx?.cam; return !c || (!c.flyTo && Math.abs(c.dist - c.targetDist) < 0.5); }, null, { timeout: 60000, polling: 500 }).catch(() => {});
  await L.sleep(1500);
  // the match goes full screen (Chrome's toolbar hides): the screen-to-page offset changed
  s.fullscreen = await s.page.evaluate(() => !!document.fullscreenElement);
  await s.at.calibrate();
}

/**
 * A screen point where two fingers `r` apart, at every angle from a0 to a1, all land on the 3D canvas (closest to
 * the middle of the screen first).
 */
async function twoFingerSpot(s, r, a0 = 0, a1 = 0) {
  return s.page.evaluate(([r, a0, a1]) => {
    const onCanvas = (x, y) => document.elementFromPoint(x, y)?.id === 'game-canvas';
    const pts = [];
    for (let y = 10; y < innerHeight; y += 10) for (let x = 10; x < innerWidth; x += 10) pts.push([x, y]);
    pts.sort((p, q) => Math.hypot(p[0] - innerWidth / 2, p[1] - innerHeight / 2) - Math.hypot(q[0] - innerWidth / 2, q[1] - innerHeight / 2));
    for (const [cx, cy] of pts) {
      let ok = true;
      for (let k = 0; k <= 4 && ok; k++) {
        const a = a0 + ((a1 - a0) * k) / 4;
        for (const rr of [r * 0.4, r]) {
          const dx = rr * Math.cos(a), dy = rr * Math.sin(a);
          if (!onCanvas(cx + dx, cy + dy) || !onCanvas(cx - dx, cy - dy)) { ok = false; break; }
        }
      }
      if (ok) return { x: cx, y: cy };
    }
    return null;
  }, [r, a0, a1]);
}

/** Close the field-manual hint and anything modal so the map is free (as a player would). */
async function clearHud(s) {
  // (closing a page of the Field Manual shows the next one: close them all)
  for (let i = 0; i < 10; i++) {
    const x = await L.centerOf(s.page, '.hint.on .hint-x');
    if (!x) break;
    await s.at.tap(x.x, x.y);
    await L.sleep(1200);
  }
}

/** A point on open ground near map point (gx, gy) that the canvas owns (not under a HUD panel). */
async function freeSpotNear(s, gx, gy, maxR = 6) {
  return s.page.evaluate(([gx, gy, maxR]) => {
    const g = window.__game, cam = g.gfx.cam.camera;
    let best = null;
    for (let r = 0; r <= maxR && !best; r++) for (let a = 0; a < 8 && !best; a++) {
      const x = gx + r * Math.cos(a * Math.PI / 4), y = gy + r * Math.sin(a * Math.PI / 4);
      const v = cam.position.clone(); v.set(x, g.world.map.heightAt(x, y), y).project(cam);
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      if (sx < 20 || sy < 20 || sx > innerWidth - 20 || sy > innerHeight - 20) continue;
      // a finger's width of open map around it, not the very edge of a HUD panel
      if ([[0, 0], [-14, 0], [14, 0], [0, -14], [0, 14]].some(([dx, dy]) => document.elementFromPoint(sx + dx, sy + dy)?.id !== 'game-canvas')) continue;
      if (g.input.pickAt(sx, sy, 1.6)) continue;
      best = { x: sx, y: sy, gx: x, gy: y };
    }
    return best;
  }, [gx, gy, maxR]);
}

async function mustSpot(s, gx, gy, maxR) {
  const p = await freeSpotNear(s, gx, gy, maxR);
  if (!p) throw new Error(`no open map (clear of the HUD) near ${gx.toFixed(1)},${gy.toFixed(1)}`);
  return p;
}

/** Point the camera at map point (x, y) (test setup: aiming, not an order). */
async function lookAt(s, x, y, dist = 18) {
  await s.page.evaluate(([x, y, d]) => { const c = window.__game.gfx.cam; c.x = x; c.y = y + 1; c.targetDist = d; c.dist = d; c.targetYaw = 0; c.yaw = 0; window.__game.input.follow = false; }, [x, y, dist]);
  await L.sleep(2500);
}

/** Point the camera so map point (x, y) shows on the canvas, not under a HUD panel; its screen point or null. */
async function aimAt(s, x, y) {
  for (const [dx, dy] of [[0, 0], [0, 3], [0, -3], [4, 0], [-4, 0], [4, 3], [-4, 3], [4, -3], [-4, -3], [0, 6], [8, 0], [-8, 0]]) {
    await lookAt(s, x + dx, y + dy);
    const p = await L.project(s.page, x, y);
    if (p.on && await s.page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id === 'game-canvas', [p.x, p.y])) return p;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ scenarios

async function menus(profile) {
  const s = await boot(profile);
  try {
    const vp = await s.page.evaluate(() => ({ w: innerWidth, h: innerHeight, coarse: matchMedia('(pointer: coarse)').matches }));
    check(vp.coarse, 'coarse pointer detected', vp);
    let a = await L.layoutAudit(s.page, '.main-screen');
    check(a.overflowX <= 0, 'main menu: no sideways scrolling', a.overflowX);
    check(!a.offscreen.length, 'main menu: no controls off screen', a.offscreen.slice(0, 5));
    check(a.small.length <= 4, 'main menu: tap targets at least 32 px', a.small.slice(0, 8));
    await shot(s, 'menu');
    for (const [entry, name] of [[/skirmish/i, 'skirmish'], [/settings/i, 'settings'], [/campaign/i, 'campaign']]) {
      const b = await L.centerOf(s.page, '.main-screen:not(.leaving) .mm-nav-btn', entry);
      if (!b) { check(false, `menu entry ${name} visible`); continue; }
      await s.at.tap(b.x, b.y);
      await L.sleep(3500);
      a = await L.layoutAudit(s.page, 'body');
      check(a.overflowX <= 0, `${name}: no sideways scrolling`, a.overflowX);
      check(!a.offscreen.length, `${name}: no controls off screen`, a.offscreen.slice(0, 6));
      check(a.small.length <= 6, `${name}: tap targets at least 32 px`, a.small.slice(0, 8));
      await shot(s, name);
      // back to the menu (the Android back button: the game should handle it like Esc / Back)
      L.shell('input keyevent KEYCODE_BACK');
      await L.sleep(2500);
      const back = await s.page.evaluate(() => !!document.querySelector('.main-screen:not(.leaving) .mm-nav-btn') && location.href).catch(() => null);
      if (!check(back && /localhost/.test(back), `Android Back from ${name} stays in the game`, back ?? 'page gone')) {
        await s.page.goto(gameUrl(), { waitUntil: 'load', timeout: 240000 }); await L.waitMenu(s.page);
      }
      if (!(await s.page.locator('.main-screen:not(.leaving) .mm-nav-btn').first().isVisible().catch(() => false))) {
        const bb = await L.centerOf(s.page, '.screen .btn-back, .btn-back');
        if (bb) { await s.at.tap(bb.x, bb.y); await L.sleep(2500); }
      }
      await L.waitMenu(s.page, 60000).catch(() => {});
    }
    errorsCheck(s, 'menus');
  } finally { await close(s); }
}

async function match(profile) {
  const s = await boot(profile);
  try {
    await quickBattle(s);
    await shot(s, 'hud');
    let a = await L.hudAudit(s.page);
    check(!a.overlaps.length, 'HUD panels do not overlap (first frame, Field Manual open)', a.overlaps);
    await clearHud(s);
    await L.sleep(1500);
    a = await L.hudAudit(s.page);
    check(!a.overlaps.length, 'HUD panels do not overlap', a.overlaps);
    check(!a.offscreen.length, 'HUD panels on screen', a.offscreen);
    check(!Object.keys(a.invisibleBlockers).length, 'no invisible element swallows taps on the map', a.invisibleBlockers);
    check(a.coverage < 0.66, `HUD leaves the map at least a third of the screen (covers ${Math.round(a.coverage * 100)}%)`, a.coverage);
    const lit = await L.battlefieldLit(s.page);
    check(lit.lit > 0.5, 'the battlefield is rendered (not black)', lit);
    // the build bar: cards visible and finger-sized
    const cards = await s.page.evaluate(() => [...document.querySelectorAll('#buildbar .bitem')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), r.right <= innerWidth && r.bottom <= innerHeight]; }));
    check(cards.length > 0, 'build bar shows cards', cards.length);
    check(cards.every((c) => c[0] >= 40 && c[1] >= 40), 'build cards at least 40 px', cards.slice(0, 4));
    const tb = await s.page.evaluate(() => [...document.querySelectorAll('#touch-bar button')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top), Math.round(r.bottom)]; }));
    check(tb.length >= 8 && tb.every((b) => b[0] >= 38 && b[1] >= 38 && b[2] >= 0 && b[3] <= (a.vh + 1)), 'touch toolbar on screen, buttons at least 38 px', tb);
    const top = await s.page.evaluate(() => [...document.querySelectorAll('#topright .rb-btns .tb-btn')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    check(top.every((b) => b[0] >= 36 && b[1] >= 34), 'resource-bar buttons finger-sized (36 px)', top);
    errorsCheck(s, 'match');
  } finally { await close(s); }
}

async function gestures(profile) {
  const s = await boot(profile);
  const P = s.page;
  try {
    await quickBattle(s);
    await clearHud(s);
    const units = await L.ownUnits(P);
    const mcv = units.find((u) => u.t === 'mcv') ?? units[0];
    await lookAt(s, mcv.x, mcv.y);
    // one-finger drag pans (real Android input; quick, so it is a pan, not a box)
    let c0 = await L.camState(P);
    const free = await mustSpot(s, mcv.x + 2, mcv.y - 3);
    await s.at.swipe(free.x, free.y, free.x - 120, free.y + 40, 350);
    await L.sleep(2500);
    let c1 = await L.camState(P);
    check(Math.hypot(c1.x - c0.x, c1.y - c0.y) > 1, 'drag pans the map', { from: [c0.x, c0.y], to: [c1.x, c1.y] });
    // a drag on a struggling device (every frame ~1.5 s: the browser hands the page the moves late, in one coalesced
    // event) must still pan, not turn into a box select; three tries, since where the finger lands in the slow frame
    // decides how late the moves arrive
    await lookAt(s, mcv.x, mcv.y);
    const lane = await twoFingerSpot(s, 150); // 300 px of open map, side to side
    await P.evaluate(() => { window.__slow = true; const spin = () => { if (!window.__slow) return; const t = performance.now(); while (performance.now() - t < 1500) { /* busy */ } requestAnimationFrame(spin); }; requestAnimationFrame(spin);
      window.__drag = []; const t = window.__game.input.touch, mv = t.move.bind(t); t.move = (e) => { const r = mv(e); window.__drag.push(t.state); return r; }; });
    const slowTries = [];
    for (let i = 0; i < 3 && lane; i++) {
      await P.evaluate(() => { window.__drag = []; });
      // a long, steady drag: the finger leaves the tap circle in a few ms, the page sees the moves only after the frame
      await s.at.swipe(lane.x + 150, lane.y, lane.x - 150, lane.y, 900);
      await L.sleep(5000);
      slowTries.push(await P.evaluate(() => [...new Set(window.__drag)].join('>')));
    }
    await P.evaluate(() => { window.__slow = false; });
    await L.sleep(2000);
    check(lane && slowTries.every((t) => t.includes('pan') && !t.includes('box')), 'a drag pans even when frames are slow', lane ? slowTries : 'no 300 px of open map');
    await lookAt(s, mcv.x, mcv.y);
    // a tap on a unit selects it (start from the army selected with the toolbar's All: a second tap on an already
    // selected MCV would deploy it, as a second click does)
    let g;
    let p = await aimAt(s, mcv.x, mcv.y);
    const allBtn = await L.centerOf(P, '#touch-bar button[aria-label]:last-child');
    if (allBtn) { await s.at.tap(allBtn.x, allBtn.y); await L.sleep(2000); }
    const s0 = await L.selection(P);
    if (!check(p, 'the MCV can be brought into the open part of the screen')) return;
    await s.at.tap(p.x, p.y);
    await L.sleep(2500);
    let sel = await L.selection(P);
    check(sel.includes(mcv.id), 'tap selects a unit', { before: s0, sel, want: mcv.id, at: [Math.round(p.x), Math.round(p.y)] });
    // tap on open ground orders a move
    g = await mustSpot(s, mcv.x + 3, mcv.y - 2);
    await s.at.tap(g.x, g.y);
    await L.sleep(3000);
    const ord = await P.evaluate((id) => { const u = [...window.__game.world.units].find((x) => x.id === id); return { o: u.order?.type, goal: u.hasGoal ? [+u.goalX.toFixed(1), +u.goalY.toFixed(1)] : null }; }, mcv.id);
    check(ord.goal || /move/.test(ord.o ?? ''), 'tap on ground moves the selection', { ...ord, to: [g.gx, g.gy] });
    // press and hold: the radial order menu
    const h = await mustSpot(s, mcv.x - 2, mcv.y - 3);
    await s.at.hold(h.x, h.y, 1100);
    await L.sleep(2500);
    const radial = await P.evaluate(() => { const r = window.__game.input.touch.radial; const el = document.getElementById('rh-radial'); return { open: r.isOpen, items: el ? [...el.querySelectorAll('.rr-item')].map((b) => b.getAttribute('aria-label') || b.textContent.trim().slice(0, 16)) : [] }; });
    check(radial.open && radial.items.length >= 4, 'press and hold opens the order ring', radial);
    await shot(s, 'radial');
    if (radial.open) {
      const stop = await L.centerOf(P, '#rh-radial .rr-item', /stop/i) ?? await L.centerOf(P, '#rh-radial .rr-item');
      if (stop) { await s.at.tap(stop.x, stop.y); await L.sleep(2500); }
      const after = await P.evaluate(() => window.__game.input.touch.radial.isOpen);
      check(stop && !after, 'tapping an order in the ring runs it and closes the ring', { stop: !!stop, open: after });
    }
    // pinch zoom (two fingers, CDP), somewhere both fingers land on the map
    const mid = await twoFingerSpot(s, 100);
    if (check(mid, 'room on the map for a pinch')) {
      c0 = await L.camState(P);
      await s.touch.twoFinger(mid.x, mid.y, { r0: 40, r1: 100, steps: 8 });
      await L.sleep(2000);
      c1 = await L.camState(P);
      check(c1.dist < c0.dist - 1, 'pinch out zooms in', { from: c0.dist, to: c1.dist });
      await s.touch.twoFinger(mid.x, mid.y, { r0: 100, r1: 40, steps: 8 });
      await L.sleep(2000);
      const c2 = await L.camState(P);
      check(c2.dist > c1.dist + 1, 'pinch in zooms out', { from: c1.dist, to: c2.dist });
    }
    const tw = await twoFingerSpot(s, 55, 0, 0.8);
    if (check(tw, 'room on the map for a twist')) {
      const c2 = await L.camState(P);
      await s.touch.twoFinger(tw.x, tw.y, { r0: 55, r1: 55, a0: 0, a1: 0.8, steps: 8 });
      await L.sleep(2000);
      const c3 = await L.camState(P);
      check(Math.abs(c3.yaw - c2.yaw) > 0.4, 'two-finger twist rotates the camera', { from: c2.yaw, to: c3.yaw });
    }
    await lookAt(s, mcv.x, mcv.y);
    const m2 = (await L.ownUnits(P)).find((u) => u.id === mcv.id);
    await aimAt(s, m2.x, m2.y);
    // start from a different selection: the touch toolbar's All, then the box picks a subset (or, alone, the MCV)
    const all = await L.centerOf(P, '#touch-bar button[aria-label]:last-child');
    if (all) { await s.at.tap(all.x, all.y); await L.sleep(2000); }
    const before = await L.selection(P);
    await clearHud(s); // (the Field Manual shows its next page on top of the map)
    const a = await L.project(P, m2.x - 2, m2.y - 2), b = await L.project(P, m2.x + 2, m2.y + 2);
    // (with a finger's margin: Chrome's touch adjustment moves a touch near a panel's edge onto the panel)
    const open = await P.evaluate(([a, b]) => [a, b].every((p) => [[0, 0], [-14, 0], [14, 0], [0, -14], [0, 14]].every(([dx, dy]) => document.elementFromPoint(p.x + dx, p.y + dy)?.id === 'game-canvas')), [a, b]);
    check(open, 'both corners of the box are on the open map', { a: [Math.round(a.x), Math.round(a.y)], b: [Math.round(b.x), Math.round(b.y)] });
    await s.touch.drag(a.x, a.y, b.x, b.y, { wait: 500, steps: 6 });
    await L.sleep(2500);
    sel = await L.selection(P);
    const inside = await P.evaluate(([a, b]) => {
      const g = window.__game, cam = g.gfx.cam.camera, out = [];
      for (const u of g.world.units) {
        if (u.owner !== g.local) continue;
        const v = cam.position.clone(); v.set(u.x, g.world.map.heightAt(u.x, u.y), u.y).project(cam);
        const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
        if (x >= Math.min(a.x, b.x) - 8 && x <= Math.max(a.x, b.x) + 8 && y >= Math.min(a.y, b.y) - 8 && y <= Math.max(a.y, b.y) + 8) out.push(u.id);
      }
      return out;
    }, [a, b]);
    // (a box with soldiers in it takes the soldiers and leaves the MCV out, as in Red Alert)
    check(sel.length > 0 && sel.every((id) => inside.includes(id)) && (sel.join() !== before.join() || inside.length === before.length), 'hold, then drag box-selects what is in the box', { before, sel, inside, box: [a, b].map((q) => [Math.round(q.x), Math.round(q.y)]) });
    errorsCheck(s, 'gestures');
  } finally { await close(s); }
}

async function build(profile) {
  const s = await boot(profile);
  const P = s.page;
  const ff = async (sec) => { for (let t = 0; t < sec; t += 2) { await P.evaluate(() => window.__game.fastForward(2)); await L.sleep(150); } };
  try {
    await quickBattle(s);
    await clearHud(s);
    const mcv = (await L.ownUnits(P)).find((u) => u.t === 'mcv');
    const p = await aimAt(s, mcv.x, mcv.y);
    if (!check(p, 'the MCV can be brought into the open part of the screen')) return;
    await s.at.tap(p.x, p.y);
    await L.sleep(2500);
    // deploy from the selection panel's Deploy order (a finger on the HUD)
    const target = await P.evaluate(() => { const b = [...document.querySelectorAll('#selpanel .cmds .cmd')].find((e) => e.dataset.key === 'D' || /deploy/i.test(e.getAttribute('aria-label') ?? '')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (!check(target, 'Deploy order button found in the selection panel', { sel: await L.selection(P) })) return;
    await s.at.tap(target.x, target.y);
    await ff(8);
    const fact = await P.evaluate(() => { const g = window.__game; return [...g.world.buildings.values()].some((b) => b.owner === g.local && b.type.id === 'fact'); });
    check(fact, 'MCV deploys from the touch HUD');
    // power plant from the build bar
    await L.sleep(2000);
    const card = await P.evaluate(() => { const c = [...document.querySelectorAll('#buildbar .bitem')].find((e) => /power plant/i.test(e.textContent) && !e.classList.contains('locked')); if (!c) return null; c.scrollIntoView({ inline: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (!check(card, 'Power Plant card available')) return;
    await L.sleep(800);
    await s.at.tap(card.x, card.y);
    await L.sleep(1500);
    await ff(30);
    const ready = await P.evaluate(() => { const g = window.__game; return JSON.stringify(g.local.queues ?? g.local.production ?? {}).slice(0, 300); });
    await L.sleep(1500);
    await s.at.tap(card.x, card.y);
    await L.sleep(2500);
    const mode = await P.evaluate(() => window.__game.input.mode);
    check(mode === 'place', 'tapping a ready structure starts placement', { mode, ready });
    const yard = await P.evaluate(() => { const g = window.__game; const b = [...g.world.buildings.values()].find((b) => b.owner === g.local && b.type.id === 'fact'); return b ? { x: b.x ?? b.cx, y: b.y ?? b.cy } : null; });
    let placed = false;
    const tries = [];
    await clearHud(s); // (the Field Manual's next page)
    await lookAt(s, yard.x, yard.y + 3);
    // cells where a Power Plant may go (the game's own rule), shown in the open part of the screen (aiming only)
    const spots = await P.evaluate(() => {
      const g = window.__game, cam = g.gfx.cam.camera, out = [];
      const yard = [...g.world.buildings].find((b) => b.owner === g.local && b.type.id === 'fact');
      const free = (x, y) => [[0, 0], [-14, 0], [14, 0], [0, -14], [0, 14]].every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy)?.id === 'game-canvas');
      for (let cy = yard.cy - 4; cy <= yard.cy + 5; cy++) for (let cx = yard.cx - 4; cx <= yard.cx + 5; cx++) {
        if (g.world.placementIssue(g.local, 'powr', cx, cy)) continue;
        const x = cx + 1, y = cy + 1, v = cam.position.clone(); v.set(x, g.world.map.heightAt(x, y), y).project(cam);
        const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
        if (free(sx, sy)) out.push({ x: sx, y: sy, cx, cy });
      }
      return out.slice(0, 6);
    });
    if (!spots.length) tries.push('no valid cell in the open part of the screen');
    for (const spot of spots) {
      const dx = spot.cx, dy = spot.cy;
      await s.at.tap(spot.x, spot.y);
      await L.sleep(3000);
      placed = await P.evaluate(() => { const g = window.__game; return [...g.world.buildings.values()].some((b) => b.owner === g.local && /powr|apwr/.test(b.type.id)); });
      const mode = await P.evaluate(() => window.__game.input.mode);
      tries.push(`${dx},${dy}: tap ${Math.round(spot.x)},${Math.round(spot.y)} -> ${placed ? 'placed' : mode}`);
      if (placed) break;
      if (mode !== 'place') { await s.at.tap(card.x, card.y); await L.sleep(2500); } // back into placement
    }
    check(placed, 'tap places the structure', tries);
    await shot(s, 'placed');
    errorsCheck(s, 'build');
  } finally { await close(s); }
}

async function perf(profile) {
  const s = await boot(profile);
  try {
    const q = await s.page.evaluate(() => JSON.parse(localStorage.getItem('rh.settings') ?? '{}'));
    check(q.quality === 'low', 'first launch picks the Low preset on this GPU', q.quality);
    check(q.renderScale === undefined || q.renderScale === 'auto', 'render scale is Auto', q.renderScale);
    await quickBattle(s);
    await clearHud(s);
    const first = await L.measureFps(s.page, 6000);
    await L.sleep(15000); // let dynamic resolution settle
    const settled = await L.measureFps(s.page, 10000);
    const sim = await s.page.evaluate(async () => { const g = window.__game, a = g.world.time, t = performance.now(); await new Promise((r) => setTimeout(r, 8000)); return +((g.world.time - a) / ((performance.now() - t) / 1000)).toFixed(2); });
    check(true, 'frame rate (SwiftShader in the emulator: relative numbers only)', { first, settled, simSpeedVsRealTime: sim });
    check(settled.renderScale === null || settled.renderScale <= 0.75, 'Auto render scale steps down on a slow GPU', settled.renderScale);
  } finally { await close(s); }
}

async function lifecycle(profile) {
  const s = await boot(profile);
  const P = s.page;
  try {
    await P.evaluate(() => { window.__marker = 1; });
    await quickBattle(s);
    await clearHud(s);
    await P.evaluate(() => { window.__lc = { lost: 0, restored: 0, hidden: 0, visible: 0 }; const c = window.__game.gfx.renderer.domElement;
      c.addEventListener('webglcontextlost', () => window.__lc.lost++); c.addEventListener('webglcontextrestored', () => window.__lc.restored++);
      document.addEventListener('visibilitychange', () => window.__lc[document.hidden ? 'hidden' : 'visible']++); });
    const tBefore = await P.evaluate(() => window.__game.world.time);
    // Home, wait, back to Chrome
    L.shell('input keyevent KEYCODE_HOME');
    await L.sleep(5000);
    // (Playwright's focus emulation keeps document.visibilityState "visible", so count frames instead: none while
    // Chrome is in the background)
    const bgFrames = await P.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(() => r(n), 3000); }));
    await L.sleep(25000);
    L.shell('monkey -p com.android.chrome -c android.intent.category.LAUNCHER 1');
    await L.sleep(8000);
    const st = await P.evaluate(() => ({ lc: window.__lc, marker: window.__marker, t: window.__game.world.time, paused: window.__game.paused, lost: window.__game.gfx.renderer.getContext().isContextLost() })).catch((e) => ({ err: e.message }));
    check(st.marker === 1, 'backgrounding for 30 s keeps the match (no reload)', st);
    check(bgFrames <= 1, 'the game stops drawing while Chrome is in the background', { bgFrames });
    await L.sleep(4000);
    let lit = await L.battlefieldLit(P);
    check(lit.lit > 0.5, 'battlefield renders after resuming', lit);
    const fps = await L.measureFps(P, 4000);
    check(fps.fps > 0.5, 'frames keep coming after resuming', fps);
    // WebGL context loss and restore (what Android does to background tabs under memory pressure)
    const lost = await P.evaluate(async () => {
      const gl = window.__game.gfx.renderer.getContext();
      const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) return 'no WEBGL_lose_context';
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 3000));
      ext.restoreContext();
      await new Promise((r) => setTimeout(r, 15000));
      return { lc: window.__lc, lost: gl.isContextLost(), body: document.body.className.slice(0, 120) };
    });
    check(lost?.lc?.restored >= 1 && lost.lost === false, 'WebGL context comes back after a loss', lost);
    await L.sleep(8000);
    lit = await L.battlefieldLit(P);
    check(lit.lit > 0.5, 'battlefield renders after a context loss', lit);
    const t2 = await P.evaluate(() => window.__game.world.time);
    await L.sleep(8000);
    const t3 = await P.evaluate(() => ({ t: window.__game.world.time, paused: window.__game.paused }));
    check(t3.t > t2 || t3.paused, 'the match carries on (or waits paused) after a context loss', { before: tBefore, t2, t3 });
    await shot(s, 'after-loss');
    // Android Back in a match: like Esc (the pause menu), never leaving the page (full screen eats the first press)
    const backOnce = async () => { L.shell('input keyevent KEYCODE_BACK'); await L.sleep(3000); };
    const st0 = await P.evaluate(() => ({ fs: !!document.fullscreenElement }));
    if (st0.fs) await backOnce();
    await backOnce();
    const b1 = await P.evaluate(() => ({ url: location.href, marker: window.__marker, paused: window.__game?.paused, pauseMenu: !!document.querySelector('.pause-panel') })).catch((e) => ({ err: e.message }));
    check(b1.marker === 1 && /localhost/.test(b1.url ?? ''), 'Android Back in a match keeps the page', b1);
    check(b1.pauseMenu, 'Android Back in a match opens the pause menu', b1);
    await shot(s, 'back-pause');
    await backOnce();
    const b2 = await P.evaluate(() => ({ marker: window.__marker, paused: window.__game?.paused, pauseMenu: !!document.querySelector('.pause-panel') })).catch((e) => ({ err: e.message }));
    check(b2.marker === 1 && !b2.pauseMenu && b2.paused === false, 'Android Back again closes the pause menu', b2);
    errorsCheck(s, 'lifecycle');
  } finally { await close(s); }
}

async function rotate(profile) {
  const s = await boot(profile);
  const P = s.page;
  try {
    await P.evaluate(() => { window.__marker = 1; });
    await quickBattle(s);
    await clearHud(s);
    const before = await P.evaluate(() => ({ w: innerWidth, h: innerHeight, t: window.__game.world.time }));
    const rot = before.w > before.h ? 0 : 1;
    L.rotate(rot);
    const v = await L.waitViewport(P, (v) => (v.w > v.h) === (rot === 1), 30000);
    await L.sleep(6000);
    const after = await P.evaluate(() => { const g = window.__game, c = document.getElementById('game-canvas'); return { marker: window.__marker, t: g.world.time, vw: innerWidth, vh: innerHeight, css: [c.clientWidth, c.clientHeight], buf: [c.width, c.height] }; });
    check(after.marker === 1 && after.t >= before.t, 'rotating keeps the match running', { before, after });
    check(after.css[0] === after.vw && after.css[1] === after.vh, 'canvas follows the new viewport', after);
    const ratio = after.buf[0] / after.buf[1], want = after.vw / after.vh;
    check(Math.abs(ratio - want) < 0.05, 'canvas buffer has the new aspect (no stretching)', { ratio, want });
    const a = await L.hudAudit(P);
    check(!a.offscreen.length, 'HUD on screen after rotating', a.offscreen);
    const lit = await L.battlefieldLit(P);
    check(lit.lit > 0.5, 'battlefield renders after rotating', lit);
    await shot(s, 'rotated');
    // and back
    L.rotate(1 - rot);
    await L.waitViewport(P, (v) => (v.w > v.h) === (rot === 0), 30000);
    await L.sleep(5000);
    const back = await P.evaluate(() => { const c = document.getElementById('game-canvas'); return { vw: innerWidth, vh: innerHeight, css: [c.clientWidth, c.clientHeight] }; });
    check(back.css[0] === back.vw && back.css[1] === back.vh, 'canvas follows the rotation back', back);
    errorsCheck(s, 'rotate');
    void v;
  } finally { await close(s); }
}

async function keyboard(profile) {
  const s = await boot(profile);
  const P = s.page;
  try {
    // text fields a player types into: the multiplayer name / room code, and the skirmish seed
    const found = [];
    for (const [entry, sel] of [[/multiplayer/i, 'input[type=text], input:not([type])'], [/skirmish/i, 'input[type=text], input[type=number], input:not([type])']]) {
      const b = await L.centerOf(P, '.main-screen:not(.leaving) .mm-nav-btn', entry);
      if (!b) continue;
      await s.at.tap(b.x, b.y);
      await L.sleep(3500);
      const inputs = await P.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 20 && getComputedStyle(e).visibility !== 'hidden').map((e, i) => { e.dataset.kbTest = String(i); return i; }), sel);
      for (const i of inputs.slice(0, 2)) {
        const c = await L.centerOf(P, `[data-kb-test="${i}"]`);
        if (!c) continue;
        await s.at.tap(c.x, c.y);
        await L.sleep(3500);
        const st = await P.evaluate((i) => { const e = document.querySelector(`[data-kb-test="${i}"]`), r = e.getBoundingClientRect(), vv = visualViewport; return { focused: document.activeElement === e, vvH: Math.round(vv.height), vvTop: Math.round(vv.offsetTop), ih: innerHeight, top: Math.round(r.top), bottom: Math.round(r.bottom), name: e.name || e.id || e.placeholder || e.className }; }, i);
        const kb = /mInputShown=true/.test(L.shell('dumpsys input_method | grep -m1 mInputShown'));
        found.push({ entry: String(entry), ...st, kb });
        check(st.focused && kb, `on-screen keyboard opens for ${st.name}`, st);
        check(st.bottom <= st.vvTop + st.vvH && st.top >= st.vvTop, `${st.name} stays visible above the keyboard`, st);
        await L.shot(P, OUT, `${cur.replace(/[^\w-]+/g, "_")}-kb-${found.length}`, { device: true });
        L.shell('input keyevent KEYCODE_BACK'); // hides the keyboard
        await L.sleep(1500);
      }
      L.shell('input keyevent KEYCODE_BACK');
      await L.sleep(2500);
      if (!(await P.locator('.main-screen:not(.leaving) .mm-nav-btn').first().isVisible().catch(() => false))) { await P.goto(gameUrl(), { waitUntil: 'load', timeout: 240000 }); }
      await L.waitMenu(P, 120000).catch(() => {});
    }
    check(found.length > 0, 'found text fields to test', found.length);
    errorsCheck(s, 'keyboard');
  } finally { await close(s); }
}

async function pwa(profile) {
  // a home screen without an earlier run's icon (resets the launcher's layout)
  try { L.shell('pm clear com.google.android.apps.nexuslauncher >/dev/null'); } catch { /* another launcher */ }
  const s = await boot(profile);
  const P = s.page;
  const port = new URL(URL0).port || '80';
  try {
    const cdp = await s.context.newCDPSession(P);
    const inst = await cdp.send('Page.getInstallabilityErrors').catch((e) => ({ err: e.message }));
    check(!inst.err && !(inst.installabilityErrors ?? []).length, 'installable (no installability errors)', inst);
    await P.reload({ waitUntil: 'load', timeout: 240000 });
    await L.waitMenu(P);
    const sw = await P.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 120000, polling: 1000 }).then(() => true, () => false);
    check(sw, 'service worker controls the page after a reload');
    // let it cache what a match needs, then go offline (drop the device's route to the server) and start one
    await L.sleep(20000);
    L.adb('reverse', '--remove', `tcp:${port}`);
    try {
      await P.reload({ waitUntil: 'load', timeout: 240000 });
      await L.waitMenu(P);
      check(true, 'the menu loads offline');
      const off = await P.evaluate(() => navigator.onLine);
      log(`navigator.onLine=${off} (the device itself stays online; only the game server is unreachable)`);
      await quickBattle(s);
      check(await L.inMatch(P), 'Quick Battle starts offline');
      const lit = await L.battlefieldLit(P);
      check(lit.lit > 0.5, 'offline match renders', lit);
      await shot(s, 'offline-match');
    } finally {
      L.adb('reverse', `tcp:${port}`, `tcp:${port}`);
    }
    // Add to Home screen from Chrome's menu, then start the game from the home screen
    await P.goto(gameUrl(), { waitUntil: 'load', timeout: 240000 });
    await L.waitMenu(P);
    const added = await addToHomeScreen();
    check(added.ok, 'Add to Home screen from Chrome\'s menu', added);
    if (added.ok) {
      const launched = await launchFromHome(s, added.label);
      check(launched.ok, 'the home-screen icon opens the game full screen (standalone)', launched);
    }
    errorsCheck(s, 'pwa');
  } finally { await close(s); }
}

/** Chrome menu > Add to Home screen / Install app, confirmed. Driven with uiautomator, as a person taps. */
async function addToHomeScreen() {
  const dump = () => { L.shell('uiautomator dump /sdcard/ui.xml >/dev/null'); return L.shell('cat /sdcard/ui.xml'); };
  const nodes = (xml) => [...xml.matchAll(/<node [^>]*>/g)].map((m) => {
    const n = m[0], b = n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    return { text: n.match(/ text="([^"]*)"/)?.[1] ?? '', desc: n.match(/content-desc="([^"]*)"/)?.[1] ?? '', id: n.match(/resource-id="([^"]*)"/)?.[1] ?? '',
      b: b ? b.slice(1).map(Number) : null };
  }).filter((n) => n.b);
  const find = (xml, re, field = 'text') => { const n = nodes(xml).find((n) => re.test(n[field])); return n ? { t: n[field], x: (n.b[0] + n.b[2]) >> 1, y: (n.b[1] + n.b[3]) >> 1, b: n.b } : null; };
  const tap = (n) => L.shell(`input tap ${n.x} ${n.y}`);
  const steps = [];
  let x = dump(), n = find(x, /menu_button$/, 'id');
  if (!n) return { ok: false, steps, why: 'no Chrome menu button' };
  tap(n); steps.push('menu'); await L.sleep(2500);
  // the item can be below the fold of the menu on a short (landscape) screen: scroll the list
  x = dump();
  for (let i = 0; i < 4 && !(n = find(x, /^(Install app|Add to (H|h)ome screen)$/)); i++) {
    const list = find(x, /app_menu_list$/, 'id');
    if (!list) break;
    L.shell(`input swipe ${list.x} ${list.b[3] - 40} ${list.x} ${list.b[1] + 40} 400`);
    await L.sleep(1500); x = dump();
  }
  if (!n) { L.shell('input keyevent KEYCODE_BACK'); return { ok: false, steps, why: 'no Install app / Add to Home screen item' }; }
  const label = n.t;
  tap(n); steps.push(n.t); await L.sleep(4000);
  // Chrome's dialog (Install / Add), then the launcher's pin dialog when Chrome adds a shortcut instead of a WebAPK
  x = dump(); n = find(x, /^(Install|Add)$/);
  if (n) { tap(n); steps.push(n.t); await L.sleep(8000); }
  x = dump(); n = find(x, /^(Add to home screen|Add automatically)$/i);
  if (n) { tap(n); steps.push(`launcher: ${n.t}`); await L.sleep(4000); }
  return { ok: steps.length >= 3, steps, label };
}

async function launchFromHome(s) {
  L.shell('input keyevent KEYCODE_HOME');
  await L.sleep(3000);
  const dump = () => { L.shell('uiautomator dump /sdcard/ui.xml >/dev/null'); return L.shell('cat /sdcard/ui.xml'); };
  let xml = dump();
  let m = [...xml.matchAll(/<node [^>]*(text|content-desc)="(Red Horizon[^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)][0];
  if (!m) { // maybe on the second home page or in the app drawer
    L.shell('input swipe 500 1800 500 400 300'); await L.sleep(2500); xml = dump();
    m = [...xml.matchAll(/<node [^>]*(text|content-desc)="(Red Horizon[^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)][0];
  }
  if (!m) return { ok: false, why: 'icon not found on the home screen' };
  const pagesBefore = s.context.pages().length;
  L.shell(`input tap ${(+m[3] + +m[5]) >> 1} ${(+m[4] + +m[6]) >> 1}`);
  await L.sleep(15000);
  const activity = L.shell('dumpsys activity activities | grep -m2 -E "topResumedActivity|mResumedActivity"').trim();
  const pages = s.context.pages();
  let standalone = null;
  for (const p of pages) standalone ??= await p.evaluate(() => (location.href.includes('localhost') ? matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches : null)).catch(() => null);
  return { ok: /webapp|WebApk|webapk/i.test(activity) || standalone === true, activity: activity.slice(0, 300), standalone, pages: [pagesBefore, pages.length] };
}

// ------------------------------------------------------------------------------------------------ run
const SCEN = { menus, match, gestures, build, perf, lifecycle, rotate, keyboard, pwa };
// gestures, build and the app-level checks need one profile each; layout checks run on every profile
const PER_PROFILE = new Set(['menus', 'match', 'rotate']);
for (const name of Object.keys(SCEN)) {
  if (!ONLY.has(name)) continue;
  const profs = PER_PROFILE.has(name) ? PROFILES : [PROFILES[0]];
  for (const prof of profs) {
    cur = `${name}/${prof}`;
    log('start');
    try { await SCEN[name](prof); } catch (e) { check(false, `${name} ran to the end`, e.stack?.split('\n').slice(0, 3).join(' | ') ?? String(e)); }
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ url: URL0, at: new Date().toISOString(), checks }, null, 1));
  }
}
const bad = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - bad.length}/${checks.length} checks passed; report in ${path.join(OUT, 'report.json')}`);
for (const c of bad) console.log(`FAIL [${c.at}] ${c.what}  -- ${c.detail.slice(0, 300)}`);
process.exit(bad.length ? 1 : 0);
