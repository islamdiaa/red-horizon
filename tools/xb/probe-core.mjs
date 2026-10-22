// In-page instrumentation for the real-GPU checks, shared by the rig (tools/gpu-rig, Linux containers) and the
// cross-browser runs in the test VMs (tools/xb, copied there by tools/lab/lab.sh): no imports, page functions only.

/**
 * Masks WebGL extensions before the page creates a context (mobile-like GPUs: no float colour buffers,
 * no linear filtering of 32-bit float textures). Pass as an init script.
 */
export function maskExtensionsScript(names) {
  return `(() => {
    const hide = new Set(${JSON.stringify(names)});
    for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
      const ge = C.prototype.getExtension, gs = C.prototype.getSupportedExtensions;
      C.prototype.getExtension = function (n) { return hide.has(n) ? null : ge.call(this, n); };
      C.prototype.getSupportedExtensions = function () { return (gs.call(this) || []).filter((n) => !hide.has(n)); };
    }
  })();`;
}

/**
 * In-page instrumentation, installed with page.evaluate(installProbe). Adds window.__rig with:
 *  - frame(n, dtMs): advance n frames of the (stopped) game loop, GPU-synced
 *  - scan(): render one frame and scan every half/float render target as each pass finishes with it
 *    (non-finite values, values above the half-float range, maximum), plus gl errors and the canvas
 *  - canvasStats(), diff(): black / white frames and frame-to-frame flicker of a paused scene
 *  - timers(): per-pass GPU time with EXT_disjoint_timer_query_webgl2
 */
export function installProbe() {
  const g = window.__game;
  const r = g.gfx.renderer;
  const gl = r.getContext();
  g.running = false;
  cancelAnimationFrame(g.raf);
  window.__clock = performance.now();
  g.last = window.__clock;
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const composer = g.gfx.composer;
  let curPass = 'outside';
  // pass names from the renderer's own fields (production builds minify class names)
  const nameOf = (p) => Object.keys(g.gfx).find((k) => g.gfx[k] === p) ?? p.constructor.name;
  for (const p of composer.passes) {
    const name = nameOf(p);
    const orig = p.render.bind(p);
    p.render = (...a) => { const prev = curPass; curPass = name; try { return orig(...a); } finally { curPass = prev; } };
  }
  const HALF = 1016, FLOAT = 1015; // THREE.HalfFloatType, THREE.FloatType
  let scanning = false;
  const results = new Map();
  let buf = new Float32Array(4);
  const scanTarget = (rt, when) => {
    if (!rt || rt.isWebGLCubeRenderTarget || rt.isWebGL3DRenderTarget || rt.isWebGLArrayRenderTarget) return;
    const tex = rt.texture;
    if (!tex || (tex.type !== HALF && tex.type !== FLOAT)) return;
    const props = r.properties.get(rt);
    const fb = props.__webglFramebuffer;
    if (!fb || Array.isArray(fb)) return;
    const w = rt.width, h = rt.height;
    if (buf.length < w * h * 4) buf = new Float32Array(w * h * 4);
    r.state.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, buf);
    let nonFinite = 0, over = 0, neg = 0, max = 0, firstBad = -1;
    const ch = tex.format === 1028 ? 1 : tex.format === 1030 ? 2 : 4; // RedFormat / RGFormat / RGBA
    const n = w * h;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const v = buf[i * 4 + c];
        if (v !== v || v === Infinity || v === -Infinity) { nonFinite++; if (firstBad < 0) firstBad = i; }
        else {
          if (v > 60000 || v < -60000) over++;
          if (v < -1e-3 && tex.type === HALF) neg++;
          if (v > max) max = v;
        }
      }
    }
    const key = `${curPass}:${tex.name || ''}:${w}x${h}:${tex.type === HALF ? 'h' : 'f'}${ch}`;
    const prev = results.get(key) ?? { nonFinite: 0, over: 0, neg: 0, max: 0, scans: 0, when };
    prev.nonFinite += nonFinite; prev.over += over; prev.neg += neg; prev.max = Math.max(prev.max, max); prev.scans++;
    if (firstBad >= 0 && prev.firstBad === undefined) prev.firstBad = [firstBad % w, Math.floor(firstBad / w)];
    results.set(key, prev);
  };
  const setRT = r.setRenderTarget.bind(r);
  r.setRenderTarget = (target, ...a) => {
    if (scanning) {
      const cur = r.getRenderTarget();
      if (cur && cur !== target) scanTarget(cur, "switch");
    }
    return setRT(target, ...a);
  };
  const glErrors = () => { const e = []; for (let k = 0; k < 16; k++) { const c = gl.getError(); if (!c) break; e.push(c); } return e; };
  const canvasPixels = () => {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const out = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return { w, h, out };
  };
  const stats = ({ w, h, out }) => {
    let sum = 0, black = 0, white = 0;
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const l = (out[i * 4] * 0.2126 + out[i * 4 + 1] * 0.7152 + out[i * 4 + 2] * 0.0722);
      sum += l;
      if (l < 3) black++;
      if (l > 252) white++;
    }
    return { mean: +(sum / n).toFixed(1), black: +(black / n).toFixed(4), white: +(white / n).toFixed(4) };
  };
  // timer queries around every composer pass
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  let timing = false;
  const pending = [];
  const sums = {};
  if (tq) {
    for (const p of composer.passes) {
      const name = nameOf(p);
      const orig = p.render.bind(p);
      p.render = (...a) => {
        if (!timing) return orig(...a);
        const q = gl.createQuery();
        gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
        try { return orig(...a); } finally { gl.endQuery(tq.TIME_ELAPSED_EXT); pending.push([name, q]); }
      };
    }
  }
  const collect = () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const [name, q] = pending[i];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        (sums[name] ??= []).push(ns / 1e6);
      }
      gl.deleteQuery(q);
      pending.splice(i, 1);
    }
  };
  let prevPixels = null;
  window.__rig = {
    frame(n = 1, dtMs = 1000 / 30) {
      for (let i = 0; i < n; i++) { window.__clock += dtMs; g.frame(window.__clock); sync(); if (timing) collect(); }
    },
    scan() {
      results.clear();
      glErrors();
      scanning = true;
      try { window.__clock += 1000 / 30; g.frame(window.__clock); } finally { scanning = false; }
      const cur = r.getRenderTarget();
      if (cur) scanTarget(cur, 'end');
      setRT(null);
      const errs = glErrors();
      const targets = [...results.entries()].map(([k, v]) => ({ k, ...v, max: +v.max.toFixed(1) }));
      return { glErrors: errs, bad: targets.filter((t) => t.nonFinite || t.over), targets: targets.length, maxHdr: Math.max(0, ...targets.map((t) => t.max)), canvas: stats(canvasPixels()) };
    },
    /** Fraction of pixels that changed by more than `thr` (0..255, any channel) since the previous call. */
    diff(thr = 40) {
      const cur = canvasPixels();
      let changed = 0;
      if (prevPixels && prevPixels.out.length === cur.out.length) {
        const a = prevPixels.out, b = cur.out;
        for (let i = 0; i < a.length; i += 4) {
          if (Math.abs(a[i] - b[i]) > thr || Math.abs(a[i + 1] - b[i + 1]) > thr || Math.abs(a[i + 2] - b[i + 2]) > thr) changed++;
        }
      }
      prevPixels = cur;
      return +(changed / (cur.w * cur.h)).toFixed(5);
    },
    async timers(frames = 30) {
      if (!tq) return null;
      for (const k of Object.keys(sums)) delete sums[k];
      timing = true;
      const t = [];
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        window.__clock += 1000 / 60;
        g.frame(window.__clock);
        sync();
        t.push(performance.now() - t0);
        collect();
        await new Promise((res) => setTimeout(res, 0));
      }
      for (let k = 0; k < 20 && pending.length; k++) { await new Promise((res) => setTimeout(res, 20)); collect(); }
      timing = false;
      const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1] ?? 0; };
      const passes = {};
      for (const [k, v] of Object.entries(sums)) passes[k] = +med(v).toFixed(2);
      return { frameMs: +med(t).toFixed(2), gpuTotal: +Object.values(passes).reduce((s, v) => s + v, 0).toFixed(2), passes };
    },
    glErrors,
  };
  return { timer: !!tq, renderer: (() => { const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })() };
}

/** The tests/perf/presets.mjs battle: n units fighting into a half-burning Soviet base, camera at the default zoom. */
export async function setupBattle(page, n) {
  return page.evaluate((N) => {
    const g = window.__game, w = g.world;
    while (w.tick < 8) { w.step(); g.processEvents(); }
    const sov = w.players.find((p) => p.faction === 'soviet') ?? w.players[1];
    const bs = w.buildings.filter((b) => b.alive && b.owner === sov && !b.bt.wall);
    const cx = bs.reduce((a, b) => a + b.x, 0) / bs.length, cy = bs.reduce((a, b) => a + b.y, 0) / bs.length;
    bs.forEach((b, i) => { if (i % 2 === 0) b.hp = Math.max(1, b.maxHp * (i % 4 === 0 ? 0.2 : 0.42)); });
    const mix = {
      allies: ['2tnk', '2tnk', '1tnk', 'jeep', 'apc', 'arty', 'e1', 'e1', 'e1', 'e3', 'e3', 'e1', 'e1', 'e3', '2tnk', '1tnk', 'e1', 'e1', 'e3', 'heli'],
      soviet: ['3tnk', '3tnk', '4tnk', 'v2rl', 'e1', 'e1', 'e2', 'e2', 'e4', 'e1', 'e1', 'e3', '3tnk', 'e1', 'e2', 'dog', 'e1', 'e3', 'ftrk', 'hind'],
    };
    const alive = () => w.units.filter((u) => u.alive).length;
    for (let k = 0; alive() < N && k < 400; k++) {
      const p = w.players[k % 2];
      const own = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length);
      const ox = own.reduce((a, u) => a + u.x, 0) / Math.max(1, own.length), oy = own.reduce((a, u) => a + u.y, 0) / Math.max(1, own.length);
      const list = mix[p.faction] ?? mix.allies;
      const j = Math.floor(k / 2);
      try {
        const [x, y] = w.findFreeSpot(ox + (j % 10) * 1.0 - 4.5, oy + Math.floor(j / 10) * 1.0 - 4, 8);
        const u = w.addUnit(list[j % list.length], p, x, y);
        if (u.kind === 'aircraft') u.altitude = u.ut.vtol ? 1.55 : 2.3;
      } catch { /* no room */ }
    }
    w.dirtyLists = true;
    for (const p of w.players) {
      const ids = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
      w.issue({ c: 'move', player: p.id, units: ids, x: cx + (w.map.w / 2 - cx) * 0.3, y: cy + (w.map.h / 2 - cy) * 0.3, attackMove: true });
    }
    bs.filter((b, i) => i % 2 === 1).slice(0, 2).forEach((b) => w.kill(b, 'normal'));
    g.processEvents();
    g.fastForward(9);
    g.gfx.cam.jumpTo(cx + (w.map.w / 2 - cx) * 0.2, cy + (w.map.h / 2 - cy) * 0.2 + 1);
    g.gfx.cam.dist = g.gfx.cam.targetDist = 26;
    g.speed = 1;
    window.__rig.frame(20, 1000 / 60);
    return { units: alive() };
  }, n);
}

/** Open a match and stop its loop. Collects page errors and three/WebGL console warnings. */
export async function openMatch(browser, url, { width = 1280, height = 720, init = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const log = [];
  page.on('pageerror', (e) => log.push(['pageerror', e.message.slice(0, 400)]));
  page.on('console', (m) => {
    const t = m.type(), s = m.text();
    if (/Cross-Origin-Opener-Policy header has been ignored/.test(s)) return; // plain HTTP from a test VM: players never see it
    // Firefox notices that need no action (our own loseContext() of throwaway contexts, depth-compare filtering, the
    // zero-fill of a target before its first write) and FXC's constant-folding precision note on three.js's packing
    if (/WebGL context was lost|Depth texture comparison requests|incurring lazy initialization|WEBGL_debug_renderer_info is deprecated/.test(s)) return;
    if (/warning X4122: sum of .* cannot be represented accurately in double precision/.test(s) && !/error|X4000/.test(s)) return;
    if (t === 'error' || (t === 'warning' && /THREE|WebGL|GL_|shader|program|INVALID|framebuffer/i.test(s))) log.push([t, s.slice(0, 600)]);
  });
  for (const s of init) await page.addInitScript(s);
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.running, null, { timeout: 240000, polling: 200 });
  const info = await page.evaluate(installProbe);
  return { ctx, page, log, info };
}

