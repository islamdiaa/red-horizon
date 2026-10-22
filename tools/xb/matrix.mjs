// Cross-browser checks on a production build, per engine (in the cross-browser rig: tools/xb/rig.sh, XB_DISPLAY=weston
// so Firefox and WebKit render on the GPU; or anywhere Playwright runs, e.g. the test VMs).
//   node tools/xb/matrix.mjs <base-url> <boot|input|battle|look|all> [engines=chromium,firefox,webkit] [outDir=/out]
// boot:   fresh profile, the browser's own autoplay policy: time to the main menu, CSP violations, console errors,
//         Quick Battle by a real click (audio unlock, time to a running match, FPS), Alt+Enter fullscreen, the
//         service worker (registered, controls a reload) and an offline reload.
// input:  in a running match, real mouse and keyboard: wheel zoom both ways, right click (context menu suppressed,
//         an order), left click and box select, arrow-key scrolling, Esc pause, a control group (Ctrl+1, 1).
// battle: the 150-unit battle at 1280x720 per preset: GPU-synced frame time, free-running FPS, HDR scan, screenshot.
// look:   fixed paused scenes (the battle, a winter base, a night scene) read back as an 80x45 colour grid
//         (look-<engine>.json) and a screenshot, for tools/xb/compare.mjs.
// One JSON line per check goes to <outDir>/xb-<mode>.jsonl; BAD lines are printed in full.
import fs from 'node:fs';
import { launchGpu, installProbe, setupBattle } from '../gpu-rig/lib.mjs';
import { runLook } from './look-core.mjs';

const [base = 'http://127.0.0.1:5303/', modeArg = 'all', engArg = 'chromium,firefox,webkit', out = '/out'] = process.argv.slice(2);
const MODES = modeArg === 'all' ? ['boot', 'input', 'battle', 'look'] : modeArg.split(',');
const ENGINES = engArg.split(',');
const PRESETS = (process.env.PRESETS ?? 'low,medium,high').split(',');
const T0 = Date.now();
let problems = 0;

function emitter(mode) {
  const file = `${out}/xb-${mode}${process.env.TAG ?? ''}.jsonl`;
  return (o, bad = false) => {
    if (bad) problems++;
    const line = JSON.stringify({ mode, ...o });
    fs.appendFileSync(file, line + '\n');
    console.log((bad ? 'BAD ' : 'ok  ') + line.slice(0, bad ? 2000 : 400));
  };
}
for (const m of MODES) fs.writeFileSync(`${out}/xb-${m}${process.env.TAG ?? ''}.jsonl`, '');

/** Collects page errors, console errors / warnings and CSP violations of a page. */
async function watch(page) {
  const log = [];
  page.on('pageerror', (e) => log.push(['pageerror', e.message.slice(0, 300)]));
  page.on('console', (m) => {
    const t = m.type(), s = m.text();
    // Firefox notices that need no action: our own loseContext() of throwaway contexts, its note on depth-compare
    // filtering, zero-filling of a target before its first write, the debug-renderer extension (gpu.ts avoids it)
    if (/WebGL context was lost|Depth texture comparison requests|incurring lazy initialization|WEBGL_debug_renderer_info is deprecated/.test(s)) { (log.benign ??= []).push(s.slice(0, 160)); return; }
    if (t === 'error' || (t === 'warning' && /THREE|WebGL|GL_|shader|program|INVALID|framebuffer|Content Security|CSP|audio|deprecated/i.test(s))) log.push([t, s.slice(0, 400)]);
  });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`.slice(0, 200)));
    // every AudioContext the page creates, to check the unlock on the first gesture
    window.__acs = [];
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (AC) {
      const Wrapped = function (...a) { const c = new AC(...a); window.__acs.push(c); return c; };
      Wrapped.prototype = AC.prototype;
      window.AudioContext = Wrapped;
      if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
    }
    const poll = () => {
      const l = document.getElementById('loading');
      if (!window.__menuAt && document.querySelector('.mm-layout') && (!l || l.style.opacity === '0' || l.style.display === 'none')) window.__menuAt = performance.now();
      if (!window.__menuAt) requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  return log;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const audioStates = (page) => page.evaluate(() => (window.__acs ?? []).map((c) => c.state));
/** Real-loop frame times over `ms` (rAF deltas) and the game's own frame cost. */
const frameStats = (page, ms = 3000) => page.evaluate(async (MS) => {
  const t = [];
  let prev = performance.now();
  await new Promise((res) => { const end = prev + MS; const f = (now) => { t.push(now - prev); prev = now; if (now < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  t.shift();
  const s = [...t].sort((a, b) => a - b);
  const mean = t.reduce((a, b) => a + b, 0) / Math.max(1, t.length);
  return { fps: +(1000 / mean).toFixed(1), p95ms: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(1), maxMs: +(s[s.length - 1] ?? 0).toFixed(1), frames: t.length };
}, ms);

async function newPage(browser, w = 1280, h = 720) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const log = await watch(page);
  return { ctx, page, log };
}

// ---------------------------------------------------------------------------------------------------------------
async function boot(engine) {
  const emit = emitter('boot');
  const browser = await launchGpu(undefined, [], engine, { autoplay: false });
  const { ctx, page, log } = await newPage(browser);
  const rec = { engine, version: browser.version() };
  try {
    const t0 = Date.now();
    await page.goto(`${base}?debug=1`, { waitUntil: 'commit', timeout: 120000 });
    await page.waitForFunction(() => window.__menuAt, null, { timeout: 180000, polling: 200 });
    rec.menuMs = await page.evaluate(() => Math.round(window.__menuAt));
    rec.menuWallMs = Date.now() - t0;
    await sleep(1500);
    rec.audioBeforeGesture = await audioStates(page);
    // Quick Battle by a real click on the main menu
    const qb = page.locator('.mm-layout').getByText(/Quick Battle/i).first();
    const t1 = Date.now();
    await qb.click({ timeout: 20000 });
    await sleep(300);
    rec.audioAfterClick = await audioStates(page);
    await page.waitForFunction(() => window.__game?.running && window.__game.world?.tick > 0, null, { timeout: 240000, polling: 250 });
    rec.matchMs = Date.now() - t1;
    await sleep(4000);
    rec.audioInMatch = await audioStates(page);
    rec.unlocked = await page.evaluate(() => window.__game?.audio?.isUnlocked ?? null);
    rec.frames = await frameStats(page, 3000);
    rec.info = await page.evaluate(() => {
      const g = window.__game, gl = g.gfx.renderer.getContext();
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER), quality: g.setup?.quality, scale: g.gfx.currentRenderScale ?? null, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, dom: document.getElementsByTagName('*').length, calls: g.gfx.stats?.calls };
    });
    // fullscreen: Alt+Enter is a user gesture
    await page.mouse.move(640, 360);
    await page.evaluate(() => { window.__fs = []; document.addEventListener('fullscreenerror', () => window.__fs.push('error')); document.addEventListener('fullscreenchange', () => window.__fs.push('change')); window.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__fs.push(`key alt=${e.altKey} prevented=${e.defaultPrevented}`); }); });
    // Deploy enters fullscreen by itself (Settings > Display), so Alt+Enter toggles out of it and back in
    const fsState = () => page.evaluate(() => !!document.fullscreenElement);
    const fs0 = await fsState();
    await page.keyboard.press('Alt+Enter'); await sleep(800);
    const fs1 = await fsState();
    await page.keyboard.press('Alt+Enter'); await sleep(800);
    const fs2 = await fsState();
    rec.fullscreen = { atDeploy: fs0, afterAltEnter: fs1, afterSecond: fs2, toggles: fs0 !== fs1 && fs1 !== fs2 };
    rec.fullscreenEvents = await page.evaluate(() => [document.fullscreenEnabled, ...window.__fs]);
    await page.screenshot({ path: `${out}/boot-${engine}.png` });
    // service worker: registered and controlling after a reload; then an offline reload must reach the menu
    rec.sw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const r = await Promise.race([navigator.serviceWorker.ready.then((reg) => reg.active?.state ?? 'ready'), new Promise((res) => setTimeout(() => res('timeout'), 45000))]);
      return r;
    });
    await page.goto(`${base}?debug=1`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__menuAt, null, { timeout: 180000, polling: 200 });
    rec.swControls = await page.evaluate(() => !!navigator.serviceWorker?.controller);
    await sleep(3000);
    await ctx.setOffline(true);
    const t2 = Date.now();
    try {
      await page.goto(`${base}`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.__menuAt, null, { timeout: 90000, polling: 200 });
      rec.offlineMenuMs = Date.now() - t2;
      rec.offlineBanner = await page.evaluate(() => document.body.innerText.match(/offline[^\n]{0,60}/i)?.[0] ?? null);
    } catch (e) { rec.offline = 'FAILED ' + String(e).split('\n')[0].slice(0, 200); }
    await page.screenshot({ path: `${out}/boot-offline-${engine}.png` });
    await ctx.setOffline(false);
  } catch (e) {
    rec.fail = String(e).split('\n').slice(0, 3).join(' | ').slice(0, 600);
    await page.screenshot({ path: `${out}/boot-fail-${engine}.png` }).catch(() => {});
  }
  rec.csp = await page.evaluate(() => window.__csp).catch(() => null);
  rec.log = log.slice(0, 20);
  const bad = !!rec.fail || !!rec.offline || (rec.csp && rec.csp.length) || rec.log.length > 0 || rec.swControls === false || rec.unlocked === false;
  emit(rec, bad);
  await ctx.close();
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------------------
/** Screen position of a world point (x, y on the map). */
const toScreen = (page, x, y) => page.evaluate(([x, y]) => {
  const g = window.__game, cam = g.gfx.cam.camera;
  const V = cam.position.constructor;
  const h = g.gfx.terrain?.renderHeight?.(x, y) ?? 0;
  const v = new V(x, h + 0.3, y).project(cam);
  const r = g.gfx.renderer.domElement.getBoundingClientRect();
  return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
}, [x, y]);

async function input(engine) {
  const emit = emitter('input');
  const browser = await launchGpu(undefined, [], engine);
  const { ctx, page, log } = await newPage(browser);
  const res = { engine };
  try {
    await page.goto(`${base}?autostart=1&intro=0&fog=0&size=64&seed=11&q=medium&units=heavy`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__game?.running && window.__game.world.tick > 5, null, { timeout: 240000, polling: 250 });
    await sleep(1500);
    // centre the camera on our army
    const army = await page.evaluate(() => {
      const g = window.__game, w = g.world;
      const own = w.units.filter((u) => u.alive && u.owner === g.local && u.weapons.length && u.kind !== 'aircraft');
      const x = own.reduce((a, u) => a + u.x, 0) / own.length, y = own.reduce((a, u) => a + u.y, 0) / own.length;
      g.gfx.cam.jumpTo(x, y);
      g.gfx.cam.dist = g.gfx.cam.targetDist = 26;
      g.selection.clear();
      return { n: own.length, x, y, ids: own.map((u) => u.id), first: [own[0].x, own[0].y, own[0].id] };
    });
    await sleep(600);
    const dist = () => page.evaluate(() => +window.__game.gfx.cam.targetDist.toFixed(2));
    // wheel
    await page.mouse.move(640, 300);
    const d0 = await dist();
    await page.mouse.wheel(0, 300); await sleep(300);
    const d1 = await dist();
    await page.mouse.wheel(0, -600); await sleep(300);
    const d2 = await dist();
    res.wheel = { d0, out: d1, in: d2, ok: d1 > d0 && d2 < d1 };
    await page.evaluate(() => { window.__game.gfx.cam.dist = window.__game.gfx.cam.targetDist = 26; });
    await sleep(400);
    // left click on one unit selects it
    const [ux, uy] = await toScreen(page, army.first[0], army.first[1]);
    await page.mouse.click(ux, uy); await sleep(300);
    res.click = await page.evaluate((id) => ({ n: window.__game.selection.size, has: window.__game.selection.has(id) }), army.first[2]);
    // box select around the army
    await page.evaluate(() => window.__game.selection.clear());
    const pts = [];
    for (const id of army.ids.slice(0, 40)) {
      const u = await page.evaluate((id) => { const u = window.__game.world.units.find((v) => v.id === id); return u ? [u.x, u.y] : null; }, id);
      if (u) pts.push(await toScreen(page, u[0], u[1]));
    }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const box = [Math.max(5, Math.min(...xs) - 20), Math.max(60, Math.min(...ys) - 20), Math.min(1275, Math.max(...xs) + 20), Math.min(640, Math.max(...ys) + 20)];
    await page.mouse.move(box[0], box[1]); await page.mouse.down();
    await page.mouse.move((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, { steps: 4 });
    await page.mouse.move(box[2], box[3], { steps: 4 }); await page.mouse.up(); await sleep(300);
    res.box = { selected: await page.evaluate(() => window.__game.selection.size), onScreen: pts.length };
    // right click: the browser's context menu must be suppressed, and the selection gets a move order
    await page.evaluate(() => { window.__cm = []; window.addEventListener('contextmenu', (e) => window.__cm.push(e.defaultPrevented)); });
    const tgt = [army.x + 6, army.y - 4];
    const [tx, ty] = await toScreen(page, tgt[0], tgt[1]);
    const cmd0 = await page.evaluate(() => window.__game.world.tick);
    await page.mouse.click(tx, ty, { button: 'right' }); await sleep(1500);
    res.rightClick = await page.evaluate(([T0, tx, ty]) => {
      const g = window.__game;
      const moving = [...g.selection].map((id) => g.world.units.find((u) => u.id === id)).filter((u) => u && (u.order?.type === 'move' || u.order?.type === 'attackMove' || u.path?.length || u.moveTarget));
      return { contextmenu: window.__cm, moving: moving.length, sel: g.selection.size, ticks: g.world.tick - T0, near: moving.length ? Math.min(...moving.map((u) => Math.hypot(u.x - tx, u.y - ty))).toFixed(1) : null };
    }, [cmd0, tgt[0], tgt[1]]);
    // control group: Ctrl+1, deselect, 1 reselects
    const selN = await page.evaluate(() => window.__game.selection.size);
    await page.keyboard.press('Control+1'); await sleep(200);
    await page.evaluate(() => window.__game.selection.clear());
    await page.keyboard.press('Digit1'); await sleep(300);
    res.group = { before: selN, after: await page.evaluate(() => window.__game.selection.size) };
    // arrow-key scrolling
    const c0 = await page.evaluate(() => [window.__game.gfx.cam.x, window.__game.gfx.cam.y]);
    await page.keyboard.down('ArrowRight'); await sleep(700); await page.keyboard.up('ArrowRight'); await sleep(200);
    const c1 = await page.evaluate(() => [window.__game.gfx.cam.x, window.__game.gfx.cam.y]);
    res.arrows = { moved: +Math.hypot(c1[0] - c0[0], c1[1] - c0[1]).toFixed(2) };
    // Esc pauses (the pause menu), Esc again resumes
    await page.keyboard.press('Escape'); await sleep(500);
    const p1 = await page.evaluate(() => window.__game.paused);
    await page.keyboard.press('Escape'); await sleep(500);
    const p2 = await page.evaluate(() => window.__game.paused);
    res.esc = { paused: p1, resumed: !p2 };
    // blur / focus (alt-tab)
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(300);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    res.keysStuck = await page.evaluate(() => [...(window.__game.input?.keys ?? [])].length);
    await page.screenshot({ path: `${out}/input-${engine}.png` });
  } catch (e) {
    res.fail = String(e).split('\n').slice(0, 3).join(' | ').slice(0, 600);
  }
  res.csp = await page.evaluate(() => window.__csp).catch(() => null);
  res.log = log.slice(0, 20);
  const bad = !!res.fail || !res.wheel?.ok || !res.click?.has || (res.box?.selected ?? 0) < Math.min(5, res.box?.onScreen ?? 0)
    || !(res.rightClick?.contextmenu?.length && res.rightClick.contextmenu.every(Boolean)) || !(res.rightClick?.moving > 0)
    || res.group?.after !== res.group?.before || !(res.arrows?.moved > 0.5) || !res.esc?.paused || !res.esc?.resumed || res.log.length > 0 || (res.csp?.length ?? 0) > 0;
  emit(res, bad);
  await ctx.close();
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------------------
async function openRig(browser, url, w = 1280, h = 720) {
  const { ctx, page, log } = await newPage(browser, w, h);
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 240000, polling: 200 });
  const info = await page.evaluate(installProbe);
  return { ctx, page, log, info };
}

async function battle(engine) {
  const emit = emitter('battle');
  const browser = await launchGpu(undefined, [], engine);
  for (const q of PRESETS) {
    const t0 = Date.now();
    let s;
    try {
      s = await openRig(browser, `${base}?autostart=1&intro=0&scenario=battle&fog=0&size=64&seed=11&tod=dusk&q=${q}&hd=1`);
      const loadMs = Date.now() - t0;
      const setup = await setupBattle(s.page, +(process.env.UNITS ?? 150));
      // GPU-synced frame time (each frame waits for a 1-pixel readback): comparable across engines
      const synced = await s.page.evaluate(() => {
        const t = [];
        for (let i = 0; i < 40; i++) { const a = performance.now(); window.__rig.frame(1, 1000 / 60); t.push(performance.now() - a); }
        t.sort((a, b) => a - b);
        return { med: +t[t.length >> 1].toFixed(1), p90: +t[Math.floor(t.length * 0.9)].toFixed(1) };
      });
      const scan = await s.page.evaluate(() => window.__rig.scan());
      // free-running: restart the game's loop for 5 s
      await s.page.evaluate(() => { const g = window.__game; g.running = true; g.last = performance.now(); const loop = (t) => { if (!g.running) return; g.raf = requestAnimationFrame(loop); g.frame(t); }; g.raf = requestAnimationFrame(loop); });
      await sleep(1000);
      const free = await frameStats(s.page, 5000);
      const extra = await s.page.evaluate(() => { const g = window.__game; g.running = false; cancelAnimationFrame(g.raf); return { calls: g.gfx.stats?.calls, tris: g.gfx.stats?.tris, scale: g.gfx.currentRenderScale ?? null, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }; });
      await s.page.screenshot({ path: `${out}/battle-${q}-${engine}.png` });
      const rec = { engine, q, units: setup.units, loadMs, renderer: s.info.renderer, synced, free, ...extra, scan: { bad: scan.bad, glErrors: scan.glErrors, maxHdr: scan.maxHdr, canvas: scan.canvas }, log: s.log.slice(0, 10) };
      emit(rec, scan.bad.length > 0 || scan.glErrors.length > 0 || scan.canvas.black > 0.6 || s.log.length > 0);
    } catch (e) {
      emit({ engine, q, fail: String(e).split('\n').slice(0, 3).join(' | ').slice(0, 600), log: s?.log.slice(0, 10) }, true);
    }
    await s?.ctx.close();
  }
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------------------
async function look(engine) {
  const emit = emitter('look');
  const browser = await launchGpu(undefined, [], engine);
  const res = await runLook({ browser, base, label: engine, out, emit: (o, bad) => emit({ engine, ...o }, bad) });
  fs.writeFileSync(`${out}/look-${engine}${process.env.TAG ?? ''}.json`, JSON.stringify(res));
  await browser.close();
}

const RUN = { boot, input, battle, look };
for (const mode of MODES) for (const engine of ENGINES) {
  try { await RUN[mode](engine); } catch (e) { emitter(mode)({ engine, fail: 'crash: ' + String(e).split('\n')[0].slice(0, 400) }, true); }
}
console.log(`xb matrix ${MODES.join(',')} x ${ENGINES.join(',')}: ${problems} problem record(s) in ${Math.round((Date.now() - T0) / 1000)} s`);
