// Drives Chrome on the Android emulator (tools/mobile/mobile.sh up) through Playwright's Android support:
// the adb server inside the container is published on the host's loopback :5037, Playwright starts Chrome with
// remote debugging and talks CDP over adb. Touch goes two ways:
//  - CDP Input.dispatchTouchEvent (multi-touch: pinch, twist; each event waits for the page to take it, so slow
//    frames stretch a gesture: use it where timing does not matter), and
//  - adb `input` (the real Android input pipeline: single-finger tap, swipe, long press), mapped from CSS pixels
//    to screen pixels by a calibration tap.
import { _android } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const CONTAINER = process.env.RH_MOBILE_CONTAINER || 'rh-lab-mobile';

/** adb inside the emulator container. */
export function adb(...args) {
  return execFileSync('docker', ['exec', CONTAINER, 'adb', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 }).replace(/\r/g, '');
}
export const shell = (cmd) => adb('shell', cmd);

/** Screen profiles: physical size and density give the CSS viewport (size / (dpi / 160)), rotation 0 or 1. */
export const PROFILES = {
  phone: { size: '1170x2532', dpi: 480, rot: 0 }, // 390 x 844 CSS
  'phone-land': { size: '1170x2532', dpi: 480, rot: 1 }, // 844 x 390
  tablet: { size: '1600x2560', dpi: 320, rot: 0 }, // 800 x 1280
  'tablet-land': { size: '1600x2560', dpi: 320, rot: 1 }, // 1280 x 800
};

export function setProfile(name) {
  const p = PROFILES[name];
  if (!p) throw new Error(`unknown profile ${name}`);
  shell(`wm size ${p.size} && wm density ${p.dpi} && settings put system accelerometer_rotation 0 && settings put system user_rotation ${p.rot}`);
}
export function rotate(rot) { shell(`settings put system accelerometer_rotation 0 && settings put system user_rotation ${rot}`); }

/** Wait until the page's viewport matches a predicate (rotation and resizes are asynchronous). */
export async function waitViewport(page, pred, timeout = 20000) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < timeout) {
    v = await page.evaluate(() => ({ w: innerWidth, h: innerHeight })).catch(() => null);
    if (v && pred(v)) return v;
    await sleep(300);
  }
  return v;
}

/**
 * An overloaded emulator now and then shows "Application Not Responding" for a background app (the launcher), and
 * the dialog takes the taps: answer it.
 */
export function dismissSystemDialogs() {
  for (let i = 0; i < 3; i++) {
    let focus = '';
    try { focus = shell('dumpsys window 2>/dev/null | grep -m1 mCurrentFocus'); } catch { return; }
    if (!/Not Responding/i.test(focus)) return;
    shell('uiautomator dump /sdcard/ui.xml >/dev/null');
    const b = shell('cat /sdcard/ui.xml').match(/text="(Wait|Close app)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (b) shell(`input tap ${(+b[2] + +b[4]) >> 1} ${(+b[3] + +b[5]) >> 1}`); else shell('input keyevent KEYCODE_BACK');
    execFileSync('sleep', ['2']);
  }
}

/** Connect to the emulator and start Chrome. Returns { device, context, page, log }. */
export async function launch({ outDir } = {}) {
  const [device] = await _android.devices({ host: '127.0.0.1', port: 5037, omitDriverInstall: true });
  if (!device) throw new Error('no Android device: is tools/mobile/mobile.sh up running?');
  // Chrome's "notifications make things easier" sheet swallows the first taps; granting the permission skips it
  try { shell('pm grant com.android.chrome android.permission.POST_NOTIFICATIONS'); } catch { /* older Android */ }
  // and Android's one-time "Viewing full screen" sheet (the game goes full screen on touch devices) would too
  try { shell('settings put secure immersive_mode_confirmations confirmed'); } catch { /* ignore */ }
  // the screen must not sleep during long waits: Chrome stops rendering a page whose screen is off
  try { shell('svc power stayon true; settings put system screen_off_timeout 2147483647; input keyevent KEYCODE_WAKEUP'); } catch { /* ignore */ }
  dismissSystemDialogs();
  const context = await device.launchBrowser();
  // the about:blank tab Chrome starts with can be closed under us while it settles: use a tab of our own
  await sleep(1500);
  const page = await context.newPage();
  for (const p of context.pages()) if (p !== page) await p.close().catch(() => {});
  const log = { errors: [], warnings: [], csp: [] };
  page.on('pageerror', (e) => log.errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    const t = m.text().slice(0, 400);
    if (/Content.Security.Policy|Refused to (load|execute|connect|apply|create|frame)/i.test(t)) log.csp.push(t);
    if (m.type() === 'error') log.errors.push(t);
    else if (m.type() === 'warning') log.warnings.push(t);
  });
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  return { device, context, page, log };
}

/** Multi-touch through CDP (CSS pixels). */
export class Touch {
  constructor(page) { this.page = page; this.cdp = null; }
  async ev(type, pts) {
    this.cdp ??= await this.page.context().newCDPSession(this.page);
    await this.cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id ?? i, radiusX: 6, radiusY: 6, force: 1 })),
    });
  }
  async tap(x, y, ms = 70) { await this.ev('touchStart', [{ x, y }]); await sleep(ms); await this.ev('touchEnd', []); }
  async hold(x, y, ms = 900) { await this.tap(x, y, ms); }
  /** One finger from a to b; `wait` ms still before moving (hold-then-drag = box select). */
  async drag(ax, ay, bx, by, { steps = 14, stepMs = 25, wait = 0 } = {}) {
    await this.ev('touchStart', [{ x: ax, y: ay }]);
    if (wait) await sleep(wait);
    for (let i = 1; i <= steps; i++) { await this.ev('touchMove', [{ x: ax + ((bx - ax) * i) / steps, y: ay + ((by - ay) * i) / steps }]); await sleep(stepMs); }
    await sleep(40);
    await this.ev('touchEnd', []);
  }
  /** Two fingers around (cx, cy): radius r0 -> r1 and angle a0 -> a1 (radians). Pinch and twist. */
  async twoFinger(cx, cy, { r0 = 80, r1 = 80, a0 = 0, a1 = 0, steps = 16, stepMs = 30 } = {}) {
    const at = (r, a) => [{ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), id: 0 }, { x: cx - r * Math.cos(a), y: cy - r * Math.sin(a), id: 1 }];
    const p0 = at(r0, a0);
    await this.ev('touchStart', [p0[0]]);
    await sleep(15);
    await this.ev('touchStart', p0);
    for (let i = 1; i <= steps; i++) { await this.ev('touchMove', at(r0 + ((r1 - r0) * i) / steps, a0 + ((a1 - a0) * i) / steps)); await sleep(stepMs); }
    const pe = at(r1, a1);
    await this.ev('touchEnd', [pe[0]]);
    await sleep(15);
    await this.ev('touchEnd', []);
  }
}

/**
 * Real Android input (adb `input`). Maps CSS pixels to screen pixels with a calibration tap: taps a known screen
 * point and reads where the page saw it.
 */
export class AdbTouch {
  constructor(page) { this.page = page; this.k = null; }
  async calibrate() {
    const dpr = await this.page.evaluate(() => devicePixelRatio);
    const size = shell('wm size').match(/(Override|Physical) size: (\d+)x(\d+)/g).pop().match(/(\d+)x(\d+)/);
    const rot = +shell('settings get system user_rotation').trim() || 0;
    const [W, H] = rot % 2 ? [+size[2], +size[1]] : [+size[1], +size[2]];
    const sx = Math.round(W / 2), sy = Math.round(H * 0.6);
    // a full-screen shield takes the calibration tap, so it never presses whatever is under it
    await this.page.evaluate(() => {
      window.__cal = null;
      const d = document.createElement('div');
      d.id = '__rh_cal';
      d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent;touch-action:none';
      const done = (e) => { window.__cal ??= [e.clientX, e.clientY]; e.stopPropagation(); e.preventDefault(); };
      d.addEventListener('pointerdown', done);
      d.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); d.remove(); });
      document.body.appendChild(d);
    });
    // (a busy host can starve the emulator for many seconds: wait, and tap once more before giving up)
    let c = null;
    for (let k = 0; k < 3 && !c; k++) {
      // the page must be drawing (a match start compiles shaders for many seconds on a software GPU)
      await this.page.evaluate(() => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 60000); })).catch(() => {});
      shell(`input tap ${sx} ${sy}`);
      for (let i = 0; i < 120 && !c; i++) { await sleep(250); c = await this.page.evaluate(() => window.__cal).catch(() => null); }
    }
    await sleep(400);
    await this.page.evaluate(() => document.getElementById('__rh_cal')?.remove());
    if (!c) throw new Error('adb calibration tap not seen by the page');
    this.k = { dpr, ox: sx - c[0] * dpr, oy: sy - c[1] * dpr, vp: await this.viewport() };
    return this.k;
  }
  /** What moves the page on the screen: the viewport size (Chrome's toolbar hiding or showing, a rotation, full screen). */
  viewport() { return this.page.evaluate(() => `${innerWidth}x${innerHeight}:${!!document.fullscreenElement}`).catch(() => ''); }
  /** Recalibrate when the page moved on the screen since the last calibration (a scroll hid Chrome's toolbar...). */
  async ensure() { if (!this.k || (await this.viewport()) !== this.k.vp) await this.calibrate(); }
  /**
   * A tap in the middle of the physical screen, without calibration: for overlays that take any tap on the window
   * (the intro cinematic's skip listens in the capture phase, so a calibration tap would only skip it).
   */
  centreTap() {
    const size = shell('wm size').match(/(Override|Physical) size: (\d+)x(\d+)/g).pop().match(/(\d+)x(\d+)/);
    shell(`input tap ${Math.round(+size[1] / 2)} ${Math.round(+size[2] / 2)}`); // (the middle is the middle in both orientations)
  }
  px(x, y) { const k = this.k; return [Math.round(x * k.dpr + k.ox), Math.round(y * k.dpr + k.oy)]; }
  async tap(x, y) { await this.ensure(); const [a, b] = this.px(x, y); shell(`input tap ${a} ${b}`); await sleep(250); }
  async swipe(ax, ay, bx, by, ms = 400) { await this.ensure(); const [a, b] = this.px(ax, ay), [c, d] = this.px(bx, by); shell(`input swipe ${a} ${b} ${c} ${d} ${ms}`); await sleep(250); }
  async hold(x, y, ms = 900) { await this.ensure(); const [a, b] = this.px(x, y); shell(`input swipe ${a} ${b} ${a} ${b} ${ms}`); await sleep(250); }
}

/** Screenshot of the page (CSS viewport) and, optionally, the whole device screen (Android UI included). */
export async function shot(page, dir, name, { device = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  if (device) fs.writeFileSync(file, execFileSync('docker', ['exec', CONTAINER, 'adb', 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
  else await page.screenshot({ path: file, timeout: 120000 }).catch((e) => console.log(`screenshot ${name} failed: ${e.message.split('\n')[0]}`));
  return file;
}

/** Layout problems a player would see: horizontal overflow, controls off screen, small tap targets, overlaps. */
export async function layoutAudit(page, scope = 'body') {
  return page.evaluate((scope) => {
    const vw = innerWidth, vh = innerHeight, out = { vw, vh, overflowX: document.scrollingElement.scrollWidth - vw, offscreen: [], small: [], clipped: [] };
    const name = (e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].slice(0, 2).join('.')}:"${(e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"`;
    for (const e of document.querySelectorAll(`${scope} button, ${scope} [role=button], ${scope} a[href], ${scope} input, ${scope} select, ${scope} .bitem`)) {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
      // inside a scroller it may be scrolled away legitimately; only flag what sticks out sideways
      if (r.right > vw + 1 || r.left < -1) out.offscreen.push(`${name(e)} x=${Math.round(r.left)}..${Math.round(r.right)}`);
      if (Math.min(r.width, r.height) < 32) out.small.push(`${name(e)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (e.scrollWidth > e.clientWidth + 2 && cs.overflow === 'hidden' && cs.textOverflow !== 'ellipsis') out.clipped.push(name(e));
    }
    return out;
  }, scope);
}

// ------------------------------------------------------------------------------------------------ the game

/** Wait for the main menu (its entries fade in). */
export async function waitMenu(page, timeout = 240000) {
  await page.waitForSelector('.main-screen:not(.leaving) .mm-nav-btn', { state: 'visible', timeout });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('.main-screen:not(.leaving) .mm-nav-btn')].pop(); return b && +getComputedStyle(b).opacity > 0.95; }, null, { timeout: 30000, polling: 500 }).catch(() => {});
  await sleep(800);
}

/** Centre of a visible element (CSS pixels), or null. */
export async function centerOf(page, selector, text) {
  let l = page.locator(selector);
  if (text) l = l.filter({ hasText: text });
  l = l.locator('visible=true').first();
  if (!(await l.count())) return null;
  await l.scrollIntoViewIfNeeded().catch(() => {});
  const b = await l.boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height } : null;
}

/** A real match (not the menu backdrop) with its HUD, loading screen gone. */
export const inMatch = (page) => page.evaluate(() => {
  const g = window.__game, l = document.getElementById('loading');
  return !!(g && g.hud && !g.setup.demo && (!l || getComputedStyle(l).display === 'none'));
}).catch(() => false);

export async function waitMatch(page, timeout = 600000) {
  await page.waitForFunction(() => {
    const g = window.__game, l = document.getElementById('loading');
    return !!(g && g.hud && !g.setup.demo && (!l || getComputedStyle(l).display === 'none'));
  }, null, { timeout, polling: 1000 });
}

/** Map point -> CSS pixels. */
export const project = (page, x, y) => page.evaluate(([x, y]) => {
  const g = window.__game, cam = g.gfx.cam.camera;
  const v = cam.position.clone();
  v.set(x, g.world.map.heightAt(x, y), y).project(cam);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, on: Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.98 && v.z < 1 };
}, [x, y]);

export const ownUnits = (page) => page.evaluate(() => {
  const g = window.__game;
  return [...g.world.units.values()].filter((u) => u.owner === g.local && u.hp > 0).map((u) => ({ id: u.id, t: u.type.id, kind: u.type.kind, x: u.x, y: u.y }));
});
export const selection = (page) => page.evaluate(() => [...window.__game.selection]);
export const camState = (page) => page.evaluate(() => { const c = window.__game.gfx.cam; return { x: c.x, y: c.y, dist: c.targetDist, yaw: c.targetYaw }; });

/** Frames per second over `ms` (requestAnimationFrame count) plus the game's own render scale and quality. */
export const measureFps = (page, ms = 8000) => page.evaluate((ms) => new Promise((res) => {
  let n = 0, worst = 0, last = performance.now();
  const t0 = last;
  const f = (t) => { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else {
    const g = window.__game, r = g?.gfx;
    res({ fps: +(n / ((t - t0) / 1000)).toFixed(1), worstMs: Math.round(worst), renderScale: r?.currentRenderScale ?? null, quality: g?.setup?.quality ?? null,
      canvas: g?.canvas ? [g.canvas.width, g.canvas.height] : null, simSpeed: null });
  } };
  requestAnimationFrame(f);
}), ms);

/**
 * HUD audit in a match: pairwise overlaps of the visible HUD panels, invisible elements that still take taps, and how
 * much of the screen the HUD covers (sampled with elementFromPoint).
 */
export const hudAudit = (page) => page.evaluate(() => {
  const vis = (e) => { for (let p = e; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; } return true; };
  const label = (e) => e.id ? `#${e.id}` : `.${[...e.classList].join('.')}`;
  const panels = [...document.querySelectorAll('#ui > *, #touch-bar, #ui #dock > *, .rv-tx.on, .mh-tx.on')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && vis(e) && e.id !== 'dock' && e.id !== 'toasts'; });
  const boxes = panels.map((e) => ({ n: label(e), r: e.getBoundingClientRect() }));
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].r, b = boxes[j].r;
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 3 && h > 3) overlaps.push(`${boxes[i].n} x ${boxes[j].n} (${Math.round(w)}x${Math.round(h)})`);
  }
  const off = boxes.filter((b) => b.r.left < -2 || b.r.top < -2 || b.r.right > innerWidth + 2 || b.r.bottom > innerHeight + 2).map((b) => `${b.n} [${Math.round(b.r.left)},${Math.round(b.r.top)},${Math.round(b.r.right)},${Math.round(b.r.bottom)}]`);
  let n = 0, hud = 0;
  const blockers = new Map();
  for (let y = 3; y < innerHeight; y += 8) for (let x = 3; x < innerWidth; x += 8) {
    n++;
    const e = document.elementFromPoint(x, y);
    if (!e || e.id === 'game-canvas') continue;
    if (!vis(e)) {
      let p = e;
      for (let q = e; q && q !== document.body; q = q.parentElement) { const cs = getComputedStyle(q); if (cs.visibility === 'hidden' || +cs.opacity < 0.05) p = q; }
      // (an invisible child of a visible control, e.g. a hotkey label, passes the tap on to its control; a panel
      // fading in or out is only invisible for a moment)
      if (p.parentElement?.id !== 'ui' && p.parentElement !== document.body) continue;
      if (p.getAnimations?.().some((a) => a.playState === 'running')) continue;
      const k = label(p);
      blockers.set(k, (blockers.get(k) ?? 0) + 64);
      continue;
    }
    hud++;
  }
  return { vw: innerWidth, vh: innerHeight, coverage: +(hud / n).toFixed(3), overlaps, offscreen: off, invisibleBlockers: Object.fromEntries([...blockers].filter(([, a]) => a > 600)) };
});

/** Points (CSS px) where the 3D canvas is the top element: where a screenshot must show the battlefield. */
export const canvasPoints = (page, step = 24) => page.evaluate((step) => {
  const pts = [];
  for (let y = step / 2; y < innerHeight; y += step) for (let x = step / 2; x < innerWidth; x += step) if (document.elementFromPoint(x, y)?.id === 'game-canvas') pts.push([x, y]);
  return pts;
}, step);

/** Decode an 8-bit RGB/RGBA PNG (what Chrome's screenshots are). */
export function decodePng(buf) {
  const zlib = globalThis.__rhZlib;
  let o = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12]) throw new Error('unsupported PNG'); }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`PNG colour type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride), prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[i] = v & 255;
    }
  }
  return { w, h, bpp, px };
}

/** Share of the canvas points that are not near-black in a page screenshot (0 = the 3D view is black). */
export async function battlefieldLit(page) {
  globalThis.__rhZlib ??= await import('node:zlib');
  const pts = await canvasPoints(page);
  if (!pts.length) return { lit: null, points: 0 };
  const img = decodePng(await page.screenshot({ timeout: 120000 }));
  const vw = await page.evaluate(() => innerWidth), k = img.w / vw;
  let lit = 0;
  for (const [x, y] of pts) {
    const i = (Math.min(img.h - 1, Math.round(y * k)) * img.w + Math.min(img.w - 1, Math.round(x * k))) * img.bpp;
    if (img.px[i] + img.px[i + 1] + img.px[i + 2] > 9) lit++; // (night maps are dark, a lost frame is black)
  }
  return { lit: +(lit / pts.length).toFixed(3), points: pts.length };
}
