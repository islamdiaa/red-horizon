// Shared helpers for the browser runs inside the test VMs (tools/lab/lab.sh run <vm> tools/xb/<script>.mjs): browser
// launch by name, page instrumentation (errors, CSP, event listeners), metric samples and the battle setup.
// Self-contained: lab.sh copies only the sibling files of the script.
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';

// KEY=value arguments become environment variables (lab.sh run forwards arguments, not the environment):
//   tools/lab/lab.sh run ubuntu tools/xb/lowend.mjs chromium 300 SCALE=0.5 "CHROME_ARGS=--use-angle=gl"
for (let i = process.argv.length - 1; i >= 2; i--) {
  const m = /^([A-Z][A-Z0-9_]*)=(.*)$/s.exec(process.argv[i]);
  if (m) { process.env[m[1]] = m[2]; process.argv.splice(i, 1); }
}
const pw = await import('playwright').catch(() => import('playwright-core'));
export const { chromium, firefox, webkit } = pw;
export const win = process.platform === 'win32';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const GAME_URL = process.env.GAME_URL ?? 'http://127.0.0.1:4173/'; // lab.sh run sets GAME_URL
export const OUT = process.env.OUT_DIR ?? 'out';
fs.mkdirSync(OUT, { recursive: true });

/**
 * Browsers by name: chromium (Playwright's), chrome, msedge, firefox (Playwright's), moz-firefox (the installed one),
 * webkit. CHROME_ARGS / FIREFOX_PREFS override the defaults (Windows: Direct3D 11 through ANGLE; WARP when the VM has
 * no GPU; Linux: SwiftShader / llvmpipe).
 */
export function launch(name, { headless = process.env.HEADED !== '1', args = [] } = {}) {
  const chromeArgs = [...(process.env.CHROME_ARGS ?? (win ? '--use-angle=d3d11 --ignore-gpu-blocklist' : '--ignore-gpu-blocklist --enable-unsafe-swiftshader')).split(' ').filter(Boolean), ...args];
  const prefs = JSON.parse(process.env.FIREFOX_PREFS ?? (win ? '{"webgl.force-enabled":true}' : '{}'));
  switch (name) {
    case 'chromium': return chromium.launch({ headless, args: chromeArgs });
    case 'chrome': return chromium.launch({ headless, channel: 'chrome', args: chromeArgs });
    case 'msedge': return chromium.launch({ headless, channel: 'msedge', args: chromeArgs });
    case 'firefox': return firefox.launch({ headless, firefoxUserPrefs: prefs });
    case 'moz-firefox': return firefox.launch({ headless, channel: 'moz-firefox', firefoxUserPrefs: prefs, args: win ? ['-wait-for-browser'] : [], ...(win ? {} : { executablePath: '/usr/bin/firefox' }) });
    case 'webkit': return webkit.launch({ headless });
    default: throw new Error('unknown browser ' + name);
  }
}

/**
 * Init script: CSP violations, live event listeners, long tasks where supported. window.__listenerCount() counts the
 * listeners on targets that are still alive and, for DOM nodes, still in the document (listeners on removed elements
 * go with them, so add-minus-remove alone would report every rebuilt HUD as a leak).
 */
export function instrument() {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`.slice(0, 200)));
  const reg = new WeakMap(); // target -> Map(listener -> Set(key))
  const counts = new WeakMap(); // target -> live listener count
  const targets = new Set(); // WeakRefs to targets with listeners
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const key = (t, o) => `${t}|${typeof o === 'boolean' ? o : !!o?.capture}`;
  EventTarget.prototype.addEventListener = function (t, f, o) {
    if (f) {
      let m = reg.get(this); if (!m) { reg.set(this, (m = new Map())); targets.add(new WeakRef(this)); }
      let s = m.get(f); if (!s) m.set(f, (s = new Set()));
      const k = key(t, o); if (!s.has(k)) { s.add(k); counts.set(this, (counts.get(this) ?? 0) + 1); }
    }
    return add.call(this, t, f, o);
  };
  EventTarget.prototype.removeEventListener = function (t, f, o) {
    const s = f && reg.get(this)?.get(f); const k = key(t, o);
    if (s?.has(k)) { s.delete(k); counts.set(this, (counts.get(this) ?? 1) - 1); }
    return rem.call(this, t, f, o);
  };
  window.__listenerCount = () => {
    let n = 0, detached = 0;
    for (const r of targets) {
      const t = r.deref();
      if (!t) { targets.delete(r); continue; }
      const c = counts.get(t) ?? 0;
      if (typeof Node !== 'undefined' && t instanceof Node && t !== document && !t.isConnected) detached += c; else n += c;
    }
    return { live: n, detached };
  };
  window.__long = { n: 0, ms: 0, max: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__long.n++; window.__long.ms += e.duration; window.__long.max = Math.max(window.__long.max, e.duration); } }).observe({ type: 'longtask', buffered: true }); } catch { /* not supported */ }
}

/** Page errors and console errors / relevant warnings of a page. */
export function watch(page) {
  const log = [];
  page.on('pageerror', (e) => log.push(['pageerror', e.message.slice(0, 300)]));
  page.on('console', (m) => {
    const t = m.type(), s = m.text();
    if (/Cross-Origin-Opener-Policy header has been ignored/.test(s)) return; // plain HTTP from a VM (lab-ready.json)
    if (t === 'error' || (t === 'warning' && /THREE|WebGL|GL_|shader|program|INVALID|framebuffer|Content Security/i.test(s))) log.push([t, s.slice(0, 300)]);
  });
  return log;
}

/** Real-loop frame times over `ms`. */
export const frameStats = (page, ms = 3000) => page.evaluate(async (MS) => {
  const t = [];
  let prev = performance.now();
  await new Promise((res) => { const end = prev + MS; const f = (now) => { t.push(now - prev); prev = now; if (now < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  t.shift();
  const s = [...t].sort((a, b) => a - b);
  const mean = t.reduce((a, b) => a + b, 0) / Math.max(1, t.length);
  return { fps: +(1000 / mean).toFixed(2), p50ms: +(s[s.length >> 1] ?? 0).toFixed(0), p95ms: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(0), maxMs: +(s[s.length - 1] ?? 0).toFixed(0), frames: t.length };
}, ms);

/** Memory, renderer, DOM and listener counts of the running match. */
export const sample = (page) => page.evaluate(() => {
  const g = window.__game, w = g?.world;
  const ri = g?.gfx.renderer.info;
  return {
    gameT: w ? Math.round(w.time) : null, tick: w?.tick, over: !!w?.gameOver, speed: g?.speed, paused: g?.paused,
    units: w?.units.filter((u) => u.alive).length, unitsArr: w?.units.length, blds: w?.buildings.length,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    heapLimitMB: performance.memory ? Math.round(performance.memory.jsHeapSizeLimit / 1048576) : null,
    geo: ri?.memory.geometries, tex: ri?.memory.textures, prog: ri?.programs?.length, calls: ri?.render.calls,
    views: g?.ents?.views?.size, scene: g?.gfx.scene.children.length,
    dom: document.getElementsByTagName('*').length, listeners: window.__listenerCount?.().live, detachedListeners: window.__listenerCount?.().detached, long: window.__long,
    csp: window.__csp?.length ?? 0,
  };
});

/** Resident memory (MB) of the browser's processes on this machine, by process name pattern. */
export function browserRssMB(name) {
  const pat = /firefox/.test(name) ? /firefox|Web Content|WebExtensions|Isolated|RDD|Socket|Utility|GPU Process|Privileged/i
    : name === 'webkit' ? /WebKit|MiniBrowser|pw_run/i : /chrome|chromium|msedge|headless_shell/i;
  try {
    if (win) {
      const exe = /firefox/.test(name) ? 'firefox.exe' : name === 'msedge' ? 'msedge.exe' : 'chrome.exe';
      const rows = execSync(`tasklist /FO CSV /NH /FI "IMAGENAME eq ${exe}"`, { encoding: 'utf8' }).trim().split(/\r?\n/);
      let kb = 0, n = 0;
      for (const r of rows) { const m = /"([\d.,\s]+) K"$/.exec(r.trim()); if (m) { kb += +m[1].replace(/[^\d]/g, ''); n++; } }
      return { mb: Math.round(kb / 1024), procs: n };
    }
    let kb = 0, n = 0, max = 0;
    for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try {
        const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').slice(0, 300);
        if (!pat.test(comm) && !pat.test(cmd)) continue;
        if (/node/.test(comm)) continue;
        const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
        if (m) { kb += +m[1]; n++; max = Math.max(max, +m[1]); }
      } catch { /* exited */ }
    }
    return { mb: Math.round(kb / 1024), procs: n, maxProcMB: Math.round(max / 1024), freeMB: Math.round(os.freemem() / 1048576) };
  } catch (e) { return { err: String(e).slice(0, 100) }; }
}

/** n units fighting into a half-burning Soviet base (tools/gpu-rig/lib.mjs setupBattle, without the rig). */
export const setupBattle = (page, n) => page.evaluate((N) => {
  const g = window.__game, w = g.world;
  while (w.tick < 8) { w.step(); g.processEvents(); }
  const sov = w.players.find((p) => p.faction === 'soviet') ?? w.players[1];
  const bs = w.buildings.filter((b) => b.alive && b.owner === sov && !b.bt.wall);
  const cx = bs.reduce((a, b) => a + b.x, 0) / bs.length, cy = bs.reduce((a, b) => a + b.y, 0) / bs.length;
  const mix = {
    allies: ['2tnk', '2tnk', '1tnk', 'jeep', 'apc', 'arty', 'e1', 'e1', 'e1', 'e3', 'e3', 'e1', 'e1', 'e3', '2tnk', '1tnk', 'e1', 'e1', 'e3', 'heli'],
    soviet: ['3tnk', '3tnk', '4tnk', 'v2rl', 'e1', 'e1', 'e2', 'e2', 'e4', 'e1', 'e1', 'e3', '3tnk', 'e1', 'e2', 'dog', 'e1', 'e3', 'ftrk', 'hind'],
  };
  const alive = () => w.units.filter((u) => u.alive).length;
  for (let k = 0; alive() < N && k < 900; k++) {
    const p = w.players[k % 2];
    const own = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length);
    const ox = own.reduce((a, u) => a + u.x, 0) / Math.max(1, own.length), oy = own.reduce((a, u) => a + u.y, 0) / Math.max(1, own.length);
    const list = mix[p.faction] ?? mix.allies;
    const j = Math.floor(k / 2);
    try {
      const [x, y] = w.findFreeSpot(ox + (j % 14) * 1.0 - 6.5, oy + Math.floor(j / 14) * 1.0 - 5, 10);
      const u = w.addUnit(list[j % list.length], p, x, y);
      if (u.kind === 'aircraft') u.altitude = u.ut.vtol ? 1.55 : 2.3;
    } catch { /* no room */ }
  }
  w.dirtyLists = true;
  for (const p of w.players) {
    const ids = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
    w.issue({ c: 'move', player: p.id, units: ids, x: cx + (w.map.w / 2 - cx) * 0.3, y: cy + (w.map.h / 2 - cy) * 0.3, attackMove: true });
  }
  g.processEvents();
  g.gfx.cam.jumpTo(cx + (w.map.w / 2 - cx) * 0.2, cy + (w.map.h / 2 - cy) * 0.2 + 1);
  g.gfx.cam.dist = g.gfx.cam.targetDist = 26;
  return { units: alive() };
}, n);

export function writeJsonl(file, o) {
  fs.appendFileSync(`${OUT}/${file}`, JSON.stringify(o) + '\n');
  console.log(JSON.stringify(o).slice(0, 600));
}
