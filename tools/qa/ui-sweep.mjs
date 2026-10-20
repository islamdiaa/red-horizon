// UI sweep: every menu screen, the battle HUD and the results screen, in every interface language and a range of
// viewports, with automated layout checks (clipped or overflowing text, controls off-screen or covered by other
// elements, text running into text, untranslated strings, small touch targets, keyboard focus).
//
//   node tools/qa/ui-sweep.mjs [--base http://localhost:5192/] [--out screenshots/ui-sweep]
//        [--phase menus,scale,match] [--locales all|en,de] [--viewports all|1280x720,390x844]
//        [--screens all|main,settings,...] [--focus 1] [--shots flagged|all|none] [--max-shots 60]
//
// Needs a running dev server (tools/qa/vite.qa.config.ts on :5192, or --base). It runs one headless Chromium,
// so run tools/assets/memguard.sh first on a shared machine. The report goes to <out>/report.json; screenshots
// of the flagged cases (and one representative per screen) go next to it.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const BASE = arg('base', process.env.QA_BASE ?? 'http://localhost:5192/');
const OUT = arg('out', ROOT + 'screenshots/ui-sweep');
const LOCALES = ['en', 'ru', 'de', 'es', 'pt-BR', 'fr', 'zh-CN'];
const VIEWPORTS = ['1280x720', '1366x768', '1920x1080', '2560x1440', '3440x1440', '1024x768', '768x1024', '390x844', '844x390'];
const pick = (v, all) => (v === 'all' ? all : v.split(','));
const locales = pick(arg('locales', 'all'), LOCALES);
const viewports = pick(arg('viewports', 'all'), VIEWPORTS).map((s) => { const [w, h] = s.split('x').map(Number); return { w, h, id: s }; });
const phases = arg('phase', 'menus').split(',');
const SCREENS = ['main', 'mappicker', 'campaign', 'conquest', 'multiplayer', 'challenges', 'replays', 'profile', 'locker', 'rivals', 'settings', 'keys', 'controls', 'editor', 'mods'];
const screens = pick(arg('screens', 'all'), SCREENS);
const doFocus = arg('focus', '1') === '1';
const shotsMode = arg('shots', 'flagged');
let shotBudget = Number(arg('max-shots', '60'));
/** Screenshots always taken (comma-separated case names such as menus-main-ru-1280x720 or match-results-won-de-1280x720). */
const forceNames = new Set(arg('force', '').split(',').filter(Boolean));
mkdirSync(OUT, { recursive: true });

const t00 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t00) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { base: BASE, started: new Date().toISOString(), cases: [], focus: [], esc: [], errors: [], texts: {} };

// ---------------------------------------------------------------------------------------------------------------
// The in-page audit. Returns issues for what is on screen now.
const AUDIT = (o) => {
  const vw = innerWidth, vh = innerHeight;
  const issues = [];
  const desc = (el) => {
    if (!el || el.nodeType !== 1) return String(el);
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = (typeof el.className === 'string' ? el.className : el.className?.baseVal || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (c.length) s += '.' + c.join('.');
    return s;
  };
  const path = (el) => { const p = []; for (let e = el; e && e !== document.body && p.length < 4; e = e.parentElement) p.unshift(desc(e)); return p.join(' > '); };
  const visible = (el) => (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true);
  const scrolls = (v) => v === 'auto' || v === 'scroll';
  const R = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  // the modal layer on top (a menu screen, the map picker, a dialog): what lies under it is not the user's concern
  let layer = null;
  const hit0 = document.elementFromPoint(vw / 2, vh / 2);
  if (hit0 && hit0.tagName !== 'CANVAS') {
    for (let a = hit0; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a), r = a.getBoundingClientRect();
      if ((cs.position === 'fixed' || cs.position === 'absolute') && r.width >= vw * 0.9 && r.height >= vh * 0.9 && a.tagName !== 'CANVAS') { layer = a; break; }
    }
  }
  const under = (el) => layer && !layer.contains(el);
  const range = document.createRange();
  const texts = [];
  const textRects = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode());) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const p = n.parentElement;
    if (!p || p.closest('script, style, noscript, template, .sr-only, title') || under(p)) continue;
    if (!visible(p)) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs0 = getComputedStyle(p);
    if (parseFloat(cs0.fontSize) < 1) continue;
    texts.push(t);
    let clip = null, inScroll = false, scX = false, scY = false;
    for (let a = p; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      const sx = scrolls(cs.overflowX), sy = scrolls(cs.overflowY);
      if (sx || sy) inScroll = true;
      const dx = Math.max(ar.left - r.left, r.right - ar.right);
      const dy = Math.max(ar.top - r.top, r.bottom - ar.bottom);
      // a scroller clips along its scrolling axis by design (the text is reachable), and so do its ancestors
      if (!sx && !scX && dx > 1.5 && r.width > 2) { clip = { axis: 'x', by: a, d: Math.round(dx) }; break; }
      if (!sy && !scY && dy > 3 && r.height > 2 && dy < r.height + 20) { clip = { axis: 'y', by: a, d: Math.round(dy) }; break; }
      if ((sy && (r.bottom < ar.top || r.top > ar.bottom)) || (sx && (r.right < ar.left || r.left > ar.right))) break; // scrolled out of view
      scX ||= sx; scY ||= sy;
    }
    if (clip) {
      const csb = getComputedStyle(clip.by), cst = getComputedStyle(p);
      const ell = csb.textOverflow === 'ellipsis' || cst.textOverflow === 'ellipsis';
      const clamp = csb.webkitLineClamp !== 'none' && csb.webkitLineClamp || cst.webkitLineClamp !== 'none' && cst.webkitLineClamp;
      // fully hidden text (a closed drawer, a ticker) is not "clipped"
      const br = clip.by.getBoundingClientRect();
      const fullyOut = r.right <= br.left || r.left >= br.right || r.bottom <= br.top || r.top >= br.bottom;
      if (!fullyOut) issues.push({ kind: ell ? 'ellipsis' : clamp ? 'line-clamp' : 'clip-' + clip.axis, text: t.slice(0, 80), el: path(p), by: desc(clip.by), d: clip.d, rect: R(r) });
    } else if (!inScroll && (r.right > vw + 1.5 || r.left < -1.5 || r.bottom > vh + 1.5 || r.top < -1.5)) {
      const fullyOut = r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh;
      if (!fullyOut) issues.push({ kind: 'offscreen-text', text: t.slice(0, 80), el: path(p), rect: R(r) });
    }
    if (!inScroll || true) for (const lr of range.getClientRects()) if (lr.width > 2 && lr.height > 2) textRects.push({ r: lr, p, t });
  }
  // text running into other text (both hit-testable at the overlap)
  const seenPairs = new Set();
  for (let i = 0; i < textRects.length && i < 900; i++) {
    for (let j = i + 1; j < textRects.length && j < 900; j++) {
      const A = textRects[i], B = textRects[j];
      if (A.p === B.p || A.p.contains(B.p) || B.p.contains(A.p)) continue;
      if (A.p.closest('.game-title') && B.p.closest('.game-title')) continue; // (the stacked title lines touch by design)
      const x0 = Math.max(A.r.left, B.r.left), x1 = Math.min(A.r.right, B.r.right), y0 = Math.max(A.r.top, B.r.top), y1 = Math.min(A.r.bottom, B.r.bottom);
      if (x1 - x0 < 3 || y1 - y0 < 3) continue;
      const area = (x1 - x0) * (y1 - y0), small = Math.min(A.r.width * A.r.height, B.r.width * B.r.height);
      if (area < 0.25 * small) continue;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
      const stack = document.elementsFromPoint(cx, cy).slice(0, 6);
      const ia = stack.findIndex((e) => e === A.p || A.p.contains(e)), ib = stack.findIndex((e) => e === B.p || B.p.contains(e));
      if (ia < 0 || ib < 0) continue;
      const key = A.t + '|' + B.t;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      issues.push({ kind: 'text-overlap', text: `${A.t.slice(0, 40)} ⟷ ${B.t.slice(0, 40)}`, el: path(A.p), other: path(B.p), rect: R({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }) });
    }
  }
  // controls: off-screen, covered by something else, too small for a finger
  const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="slider"], [tabindex]:not([tabindex="-1"])';
  let controls = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (!visible(el) || el.closest('.sr-only') || under(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none' || el.closest('[inert]')) continue;
    let view = { left: 0, top: 0, right: vw, bottom: vh }, inScroll = false;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const c = getComputedStyle(a);
      if (scrolls(c.overflowX) || scrolls(c.overflowY)) {
        inScroll = true;
        const ar = a.getBoundingClientRect();
        view = { left: Math.max(view.left, ar.left), top: Math.max(view.top, ar.top), right: Math.min(view.right, ar.right), bottom: Math.min(view.bottom, ar.bottom) };
      }
    }
    controls++;
    const label = (el.getAttribute('aria-label') || el.title || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    if (!inScroll && (r.right > vw + 1.5 || r.bottom > vh + 1.5 || r.left < -1.5 || r.top < -1.5)) {
      const fullyOut = r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh;
      if (!fullyOut || o.strictOff) issues.push({ kind: fullyOut ? 'control-hidden-offscreen' : 'control-offscreen', text: label, el: path(el), rect: R(r) });
      continue;
    }
    // the centre of the visible part must hit the control
    const vx0 = Math.max(r.left, view.left), vx1 = Math.min(r.right, view.right), vy0 = Math.max(r.top, view.top), vy1 = Math.min(r.bottom, view.bottom);
    if (vx1 - vx0 < 2 || vy1 - vy0 < 2) continue; // scrolled away
    const pts = [[(vx0 + vx1) / 2, (vy0 + vy1) / 2]];
    let blocked = null;
    for (const [x, y] of pts) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === el || el.contains(hit)) continue;
      if (hit.closest('label')?.contains(el) || (hit.tagName === 'LABEL' && hit.control === el)) continue;
      if (hit.contains(el)) continue; // (the control's own wrapper takes the hit: pointer-events quirks)
      blocked = hit;
    }
    if (blocked) issues.push({ kind: 'control-covered', text: label, el: path(el), by: path(blocked), rect: R(r) });
    if (o.touch && (r.width < 44 || r.height < 44) && !el.disabled) issues.push({ kind: 'small-target', text: label, el: path(el), size: [Math.round(r.width), Math.round(r.height)] });
  }
  return { issues, texts: [...new Set(texts)], controls };
};

// ---------------------------------------------------------------------------------------------------------------
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none'],
  env: { ...process.env, LD_LIBRARY_PATH: ROOT + 'tools/nsslibs/lib' },
});

async function newPage(lang, vp, { scale = 1, settings = {}, raf = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: 'reduce', hasTouch: vp.w < 900 || vp.h < 500, deviceScaleFactor: 1 });
  await ctx.addInitScript(([lang, s]) => {
    try {
      if (!sessionStorage.getItem('rh.sweep')) { // only before the first load: the sweep may change them later
        sessionStorage.setItem('rh.sweep', '1');
        localStorage.setItem('rh.lang', lang);
        localStorage.setItem('rh.settings', JSON.stringify({ quality: 'low', edgeScroll: true, unitVoices: true, hints: true, showFps: false, reduceMotion: true, fullscreen: false, ...s }));
      }
    } catch { /* storage off */ }
  }, [lang, { uiScale: scale, ...settings }]);
  if (raf) await ctx.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now()))); });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000); // (SwiftShader: a battle frame can take seconds)
  page.on('pageerror', (e) => report.errors.push(`[${lang}] pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource.*relay/i.test(m.text())) report.errors.push(`[${lang}] console ${m.text().slice(0, 300)}`); });
  return { ctx, page };
}

const isTouchVp = (vp) => vp.w < 900 || vp.h < 500;
async function audit(page, ctxInfo, vp, { strictOff = false } = {}) {
  const res = await page.evaluate(AUDIT, { touch: isTouchVp(vp), strictOff });
  const key = `${ctxInfo.phase}|${ctxInfo.screen}`;
  (report.texts[key] ??= {})[ctxInfo.lang] = [...new Set([...(report.texts[key]?.[ctxInfo.lang] ?? []), ...res.texts])];
  const counted = res.issues.filter((i) => i.kind !== 'small-target' && i.kind !== 'ellipsis');
  const c = { ...ctxInfo, vp: vp.id, controls: res.controls, issues: res.issues };
  report.cases.push(c);
  const name = `${ctxInfo.phase}-${ctxInfo.screen}-${ctxInfo.lang}-${vp.id}${ctxInfo.scale && ctxInfo.scale !== 1 ? '-s' + ctxInfo.scale : ''}`;
  const want = shotsMode === 'all' || (shotsMode === 'flagged' && counted.length > 0) || ctxInfo.forceShot;
  if (forceNames.has(name) || (want && shotBudget > 0)) { if (!forceNames.has(name)) shotBudget--; await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 }); c.shot = `${name}.png`; }
  const kinds = {};
  for (const i of res.issues) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
  log(`${name}: ${res.controls} controls, ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ') || 'clean'}`);
  return res;
}

/** Walk the keyboard focus through the screen: every stop must be visible, on screen and show a focus ring. */
async function focusWalk(page, info, max = 45) {
  await page.evaluate(() => { document.activeElement?.blur?.(); window.focus(); });
  const stops = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return { none: true };
      const r = a.getBoundingClientRect(), cs = getComputedStyle(a);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
      const on = r.width > 1 && r.height > 1 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
      const top = [...document.querySelectorAll('.screen:not(.leaving), [role=dialog], [aria-modal=true]')].pop();
      let d = a.tagName.toLowerCase() + (a.className && typeof a.className === 'string' ? '.' + a.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
      const label = (a.getAttribute('aria-label') || a.title || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
      return { d, label, ring, on, inTop: top ? top.contains(a) : true, y: Math.round(r.top), x: Math.round(r.left), vis: a.checkVisibility ? a.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true };
    });
    stops.push(s);
    if (i > 2 && stops.length > 3 && s.d === stops[0].d && s.label === stops[0].label && s.x === stops[0].x && s.y === stops[0].y) break; // wrapped around
  }
  const bad = stops.filter((s) => !s.none && (!s.ring || !s.on || !s.vis || !s.inTop));
  const lost = stops.filter((s) => s.none).length;
  report.focus.push({ ...info, stops: stops.length, bad, lost });
  log(`  focus ${info.screen}: ${stops.length} stops, ${bad.length} bad, ${lost} lost${bad.length ? ' -- ' + bad.slice(0, 4).map((b) => `${b.d}"${b.label}"${b.ring ? '' : ' no-ring'}${b.on ? '' : ' offscreen'}${b.vis ? '' : ' invisible'}${b.inTop ? '' : ' outside-screen'}`).join('; ') : ''}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Menu screens. Each opener starts from the main menu; Escape must bring the main menu back.
const navBtn = (page, idx) => page.locator('.main-screen:not(.leaving) .mm-nav-btn').filter({ has: page.locator('.nb-idx', { hasText: new RegExp(`^${idx.replace(/[★»▶]/g, '\\$&')}$`) }) }).first();
const settled = async (page, ms = 900) => { await sleep(ms); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); };
const OPEN = {
  main: async () => true,
  mappicker: async (page) => { await page.locator('.main-screen .mr-change').click(); await settled(page); return page.locator('.mpk-card').first().isVisible(); },
  campaign: async (page) => { await navBtn(page, '01').click(); await settled(page, 1500); return true; },
  conquest: async (page) => { await navBtn(page, '★').click(); await settled(page, 1500); return true; },
  multiplayer: async (page) => { await navBtn(page, 'MP').click(); await settled(page, 1500); return true; },
  challenges: async (page) => { await navBtn(page, '03').click(); await settled(page, 1500); return true; },
  replays: async (page) => { await navBtn(page, '04').click(); await settled(page, 1200); return true; },
  profile: async (page) => { await navBtn(page, '05').click(); await settled(page, 1500); return true; },
  locker: async (page) => { await OPEN.profile(page); const b = page.locator('.pf-locker, [data-act=locker], button:has-text("Locker")').first(); if (!(await b.count())) return false; await b.click(); await settled(page, 1200); return true; },
  rivals: async (page) => { await OPEN.profile(page); const b = page.locator('.pf-rivals, [data-act=rivals], button:has-text("Rivals")').first(); if (!(await b.count())) return false; await b.click(); await settled(page, 1200); return true; },
  settings: async (page) => { await navBtn(page, '06').click(); await settled(page); return true; },
  keys: async (page) => { await OPEN.settings(page); await page.locator('.settings-panel .btn.btn-sm:visible').nth(-2).click(); await settled(page); return true; },
  controls: async (page) => { await navBtn(page, '07').click(); await settled(page); return true; },
  editor: async (page) => { await page.locator('.main-screen .mm-nav-btn').nth(-2).click(); await page.waitForFunction(() => document.querySelectorAll('button:not([disabled])').length > 10 && !document.querySelector('.main-screen:not(.leaving)'), null, { timeout: 60000 }).catch(() => {}); await settled(page, 2500); return true; },
  mods: async (page) => { await page.locator('.main-screen .mm-nav-btn').last().click(); await settled(page, 1500); return true; },
};

/** The main menu is up and on top (nothing covers the middle of the screen). */
const atMain = (page) => page.evaluate(() => {
  const m = document.querySelector('.main-screen:not(.leaving)');
  if (!m || document.querySelector('.map-picker:not(.leaving)')) return false;
  const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  return !!hit && m.contains(hit);
}).catch(() => false);
async function toMain(page, lang) {
  if (await atMain(page)) return 'already';
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await sleep(700);
    if (await atMain(page)) return i === 0 ? 'esc' : `esc×${i + 1}`;
  }
  // no Escape route: a back button?
  const back = page.locator('.screen:not(.leaving) .back-btn, .screen:not(.leaving) [data-back], button.back, .ed-back, .mods-back').first();
  if (await back.count()) { await back.click().catch(() => {}); await sleep(800); if (await atMain(page)) return 'back-button'; }
  await page.goto(BASE + '?demo=0', { waitUntil: 'load' });
  await page.waitForSelector('.main-screen .mm-nav-btn', { timeout: 120000 });
  await settled(page, 1500);
  return 'reload';
}

async function menusPhase(lang, { scale = 1, vps = viewports, scr = screens, phase = 'menus', focus = doFocus } = {}) {
  const v0 = vps[0];
  const { ctx, page } = await newPage(lang, v0, { scale });
  await page.goto(BASE + '?demo=0', { waitUntil: 'load' });
  await page.waitForSelector('.main-screen .mm-nav-btn', { timeout: 120000 });
  await settled(page, 2000);
  for (const screen of scr) {
    try {
      const ok = await OPEN[screen](page);
      if (!ok) { log(`${lang} ${screen}: could not open`); report.cases.push({ phase, screen, lang, scale, vp: v0.id, error: 'could not open' }); await toMain(page, lang); continue; }
      let first = true;
      for (const vp of vps) {
        if (vp !== v0 || !first) { await page.setViewportSize({ width: vp.w, height: vp.h }); await settled(page, 450); }
        await audit(page, { phase, screen, lang, scale, forceShot: first && lang === 'en' && scale === 1 && shotsMode !== 'none' }, vp);
        first = false;
      }
      if (focus && lang === 'en' && scale === 1) { await page.setViewportSize({ width: 1280, height: 720 }); await settled(page, 300); await focusWalk(page, { screen, lang }); }
      await page.setViewportSize({ width: v0.w, height: v0.h });
      const how = await toMain(page, lang);
      if (screen !== 'main') report.esc.push({ screen, lang, how });
      if (screen !== 'main' && how !== 'esc' && how !== 'already') log(`  back from ${screen}: ${how}`);
    } catch (e) {
      log(`${lang} ${screen}: ERROR ${e.message.split('\n')[0]}`);
      report.cases.push({ phase, screen, lang, scale, error: e.message.split('\n')[0] });
      await toMain(page, lang).catch(() => {});
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------
// The battle HUD: build-bar tabs, selections, the pause menu, the results screen.
async function matchPhase(lang, { vps = viewports, rules = 'commander', scale = 1 } = {}) {
  const v0 = vps[0];
  const { ctx, page } = await newPage(lang, v0, { scale });
  const url = `${BASE}?autostart=1&q=low&hd=0&size=64&units=light&fog=0&scenario=base&seed=4321&demo=0${rules === 'commander' ? '&rules=commander&doctrine=' : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.hud, null, { timeout: 180000 });
  await page.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 60000 }).catch(() => page.keyboard.press('Escape'));
  // the calm opening (hints on): the commander panel is quiet at first, then introduces itself once
  const cmdState = () => page.evaluate(() => ({ t: +window.__game.world.time.toFixed(1), cmd: document.getElementById('cmdpanel')?.className ?? null, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)) }));
  const open0 = await cmdState();
  await page.evaluate(() => window.__game.fastForward(8));
  await settled(page, 2500);
  const open1 = await cmdState();
  report.opening = { ...(report.opening ?? {}), [lang]: [open0, open1] };
  log(`opening ${lang}: ${JSON.stringify(open0)} -> ${JSON.stringify(open1)}`);
  const phase = 'match' + (scale !== 1 ? '@' + scale : '');
  const sel = async (kind) => page.evaluate((kind) => {
    const g = window.__game, me = g.local;
    const units = g.world.units.filter((u) => u.owner === me && u.alive);
    const ids = kind === 'one' ? units.filter((u) => u.weapons.length).slice(0, 1).map((u) => u.id)
      : kind === 'many' ? units.slice(0, 12).map((u) => u.id)
      : kind === 'building' ? g.world.buildings.filter((b) => b.owner === me && b.alive && b.bt.id === 'weap').slice(0, 1).map((b) => b.id) : [];
    g.input.select(ids);
    return ids.length;
  }, kind);
  const states = [
    ['hud', async () => { await sel('none'); }],
    ...[0, 1, 2, 3, 4].map((i) => [`tab${i}`, async () => { const t = page.locator('#sidebar .tab, .tab').nth(i); if (await t.count()) await t.click({ timeout: 5000 }).catch(() => {}); }]),
    ['sel-one', async () => sel('one')],
    ['sel-many', async () => sel('many')],
    ['sel-building', async () => sel('building')],
    ['pause', async () => { await sel('none'); await page.keyboard.press('Escape'); await sleep(600); }],
    ['pause-settings', async () => { await page.locator('.pause-screen .pp-btn[data-act=settings]').click(); await sleep(600); }],
  ];
  for (const [name, prep] of states) {
    await page.setViewportSize({ width: v0.w, height: v0.h });
    await settled(page, 200);
    await prep();
    await settled(page, 700);
    let first = true;
    for (const vp of vps) {
      if (!first) { await page.setViewportSize({ width: vp.w, height: vp.h }); await settled(page, 500); }
      await audit(page, { phase, screen: name, lang, scale, forceShot: first && lang === 'en' && shotsMode !== 'none' }, vp);
      first = false;
    }
  }
  // back to the battle, then win it
  await page.setViewportSize({ width: v0.w, height: v0.h });
  for (let i = 0; i < 3 && (await page.locator('.screen:not(.leaving)').count()); i++) { await page.keyboard.press('Escape'); await sleep(600); }
  await page.evaluate(() => { const g = window.__game; for (let k = 0; k < 5; k++) for (const e of [...g.world.units, ...g.world.buildings]) if (g.local.isEnemy(e.owner) && e.alive) g.world.kill(e); });
  await page.waitForSelector('.end-screen', { timeout: 240000 });
  await settled(page, 4000);
  let first = true;
  for (const vp of vps) {
    if (!first) { await page.setViewportSize({ width: vp.w, height: vp.h }); await settled(page, 600); }
    await audit(page, { phase, screen: 'results-won', lang, scale, forceShot: first && shotsMode !== 'none' }, vp);
    first = false;
  }
  if (doFocus && lang === 'en') { await page.setViewportSize({ width: 1280, height: 720 }); await settled(page, 300); await focusWalk(page, { screen: 'results-won', lang }); }
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------
// First-time experience: a fresh profile from the first menu to the first battle and its result (real defaults).
async function ftuePhase(lang, entry = '»') {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(([lang]) => {
    if (sessionStorage.getItem('rh.sweep')) return;
    sessionStorage.setItem('rh.sweep', '1');
    localStorage.setItem('rh.lang', lang);
    localStorage.setItem('rh.settings', JSON.stringify({ quality: 'low', fullscreen: false })); // (everything else: the defaults)
  }, [lang]);
  await ctx.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now()))); });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => report.errors.push(`[ftue] pageerror ${e.message}`));
  await page.goto(BASE + '?demo=0', { waitUntil: 'load' });
  await page.waitForSelector('.main-screen .mm-nav-btn', { timeout: 120000 });
  await settled(page, 2500);
  await page.screenshot({ path: `${OUT}/ftue-${entry === '»' ? 'quick' : 'skirmish'}-01-menu.png` });
  if (entry === '»') await navBtn(page, '»').click(); else await page.locator('.main-screen .deploy').click();
  await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo, null, { timeout: 180000 });
  const setup = await page.evaluate(() => { const g = window.__game, s = g.setup; return { rules: s.rules ?? 'classic', opp: s.opponents.map((o) => o.difficulty), hints: JSON.parse(localStorage.getItem('rh.settings') || '{}').hints, intro: s.intro, quick: !!s.quick, dyn: s.dynamicDifficulty }; });
  log('ftue setup', JSON.stringify(setup));
  const tl = [];
  const t0 = Date.now();
  let shots = 0, introOver = -1;
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => {
      const g = window.__game;
      const vis = (el) => !!el && el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true });
      const hint = document.querySelector('.hint.on');
      return {
        sim: +g.world.time.toFixed(1), cine: document.body.classList.contains('cine-active'),
        hint: vis(hint) ? hint.textContent.replace(/\s+/g, ' ').trim().slice(0, 70) : null,
        toasts: [...document.querySelectorAll('.toast')].filter(vis).map((t) => t.textContent.replace(/\s+/g, ' ').trim().slice(0, 70)),
        cmd: document.getElementById('cmdpanel')?.className ?? null,
        overlays: [...document.querySelectorAll('.qb-card, .dp-banner, .doc-banner, .vh-card, .ev-card, .moment, .rv-tx, .mh-tx, .subs .line, .cine-title, .intro-card, .obj-card')].filter(vis).map((e) => e.className.split(' ')[0]),
      };
    });
    st.wall = +((Date.now() - t0) / 1000).toFixed(1);
    tl.push(st);
    const key = JSON.stringify([st.cine, st.hint, st.toasts, st.cmd, st.overlays]);
    if (i === 0 || key !== JSON.stringify([tl[i - 1]?.cine, tl[i - 1]?.hint, tl[i - 1]?.toasts, tl[i - 1]?.cmd, tl[i - 1]?.overlays])) log('  ftue', JSON.stringify(st));
    if (!st.cine && introOver < 0) introOver = i;
    if (shots < 6 && (i === 2 || (introOver >= 0 && [introOver, introOver + 2, introOver + 5, introOver + 9, introOver + 14].includes(i)))) {
      shots++;
      await page.screenshot({ path: `${OUT}/ftue-${entry === '»' ? 'quick' : 'skirmish'}-${String(shots + 1).padStart(2, '0')}-sim${Math.round(st.sim)}.png` });
    }
    if (introOver >= 0 && i > introOver + 10) break;
    await sleep(1500);
  }
  report.ftue = { ...(report.ftue ?? {}), [entry]: { setup, tl } };
  // the first result: win it
  await page.evaluate(() => { const g = window.__game; for (let k = 0; k < 5; k++) for (const e of [...g.world.units, ...g.world.buildings]) if (g.local.isEnemy(e.owner) && e.alive) g.world.kill(e); });
  await page.waitForSelector('.end-screen', { timeout: 240000 }).catch(() => {});
  await settled(page, 3000);
  await page.screenshot({ path: `${OUT}/ftue-${entry === '»' ? 'quick' : 'skirmish'}-09-result.png` });
  await settled(page, 4000);
  await page.screenshot({ path: `${OUT}/ftue-${entry === '»' ? 'quick' : 'skirmish'}-10-result-later.png` });
  await audit(page, { phase: 'ftue', screen: 'first-result', lang }, { w: 1366, h: 768, id: '1366x768' });
  await ctx.close();
}

// Buttons that do nothing: click every visible button of a screen and watch for any change (DOM, attributes, storage,
// focus). Buttons that start a battle, open file pickers or touch the clipboard are skipped.
const CLICK_SKIP = /deploy|quick battle|boot camp|launch|start|play|resume|continue|import|export|download|upload|delete|remove|reset|copy|share|link|fullscreen|connect|host|join|create room/i;
async function clicksPhase(lang) {
  const { ctx, page } = await newPage(lang, { w: 1280, h: 720, id: '1280x720' });
  await page.goto(BASE + '?demo=0', { waitUntil: 'load' });
  await page.waitForSelector('.main-screen .mm-nav-btn', { timeout: 120000 });
  await settled(page, 1500);
  const mark = () => page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    let layer = null;
    const hit0 = document.elementFromPoint(vw / 2, vh / 2);
    for (let a = hit0; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a), r = a.getBoundingClientRect();
      if ((cs.position === 'fixed' || cs.position === 'absolute') && r.width >= vw * 0.9 && r.height >= vh * 0.9) { layer = a; break; }
    }
    const list = [...(layer ?? document.body).querySelectorAll('button')].filter((b) => !b.disabled && b.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) && b.getBoundingClientRect().width > 2 && !b.closest('.mm-nav'));
    document.querySelectorAll('[data-sweep-btn]').forEach((b) => b.removeAttribute('data-sweep-btn'));
    list.forEach((b, i) => { b.dataset.sweepBtn = String(i); });
    return list.map((b) => (b.getAttribute('aria-label') || b.title || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) || b.className.toString().slice(0, 30));
  });
  const dead = [];
  for (const screen of ['main', 'settings', 'profile', 'challenges', 'controls', 'replays', 'mods', 'conquest', 'campaign']) {
    try {
      await OPEN[screen](page);
      let labels = await mark();
      let tested = 0;
      for (let i = 0; i < labels.length && i < 45; i++) {
        if (CLICK_SKIP.test(labels[i])) continue;
        const res = await page.evaluate(async (i) => {
          const b = document.querySelector(`[data-sweep-btn="${i}"]`);
          if (!b || !b.isConnected) return 'gone';
          let muts = 0;
          const mo = new MutationObserver((l) => { muts += l.filter((m) => !(m.type === 'attributes' && m.attributeName === 'data-sweep-btn')).length; });
          mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
          const ls0 = JSON.stringify(localStorage), a0 = document.activeElement;
          b.click();
          await new Promise((r) => setTimeout(r, 450));
          mo.disconnect();
          return muts > 0 || JSON.stringify(localStorage) !== ls0 || document.activeElement !== a0 ? (b.isConnected ? 'ok' : 'nav') : 'dead';
        }, i);
        tested++;
        if (res === 'dead') dead.push(`${screen}: "${labels[i]}"`);
        if (res !== 'ok') { await toMain(page, lang); await OPEN[screen](page); labels = await mark(); }
      }
      log(`clicks ${screen}: ${tested} buttons clicked`);
      await toMain(page, lang);
    } catch (e) { log(`clicks ${screen}: ERROR ${e.message.split('\n')[0]}`); await toMain(page, lang).catch(() => {}); }
  }
  report.deadButtons = dead;
  log(`buttons that did nothing: ${dead.length ? dead.join(' | ') : 'none'}`);
  await ctx.close();
}

// Esc, one press at a time, back out of nested screens (Locker over the profile, rivals over the profile, key bindings
// over Settings): what is on top after each press.
async function escPhase(lang) {
  const { ctx, page } = await newPage(lang, { w: 1280, h: 720, id: '1280x720' });
  await page.goto(BASE + '?demo=0', { waitUntil: 'load' });
  await page.waitForSelector('.main-screen .mm-nav-btn', { timeout: 120000 });
  await settled(page, 1500);
  const top = () => page.evaluate(() => {
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const names = ['.rh-locker', '.rv', '.pf', '.keys-panel', '.settings-panel', '.main-screen'];
    return { at: names.find((n) => hit?.closest(n)) ?? hit?.className?.toString().slice(0, 40), active: document.activeElement?.tagName + '.' + String(document.activeElement?.className ?? '').slice(0, 30), present: names.filter((n) => document.querySelector(n + ':not(.leaving)')) };
  });
  for (const screen of ['locker', 'rivals', 'keys']) {
    await OPEN[screen](page);
    const steps = [await top()];
    for (let i = 0; i < 3 && !(await atMain(page)); i++) { await page.keyboard.press('Escape'); await sleep(700); steps.push(await top()); }
    report.escSteps = { ...(report.escSteps ?? {}), [`${lang}:${screen}`]: steps };
    log(`esc ${lang} ${screen}: ${steps.map((x) => x.at).join(' -> ')}`);
    await toMain(page, lang);
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------
for (const ph of phases) {
  for (const lang of locales) {
    try {
      if (ph === 'menus') await menusPhase(lang);
      else if (ph === 'scale') for (const s of [0.8, 1.5]) await menusPhase(lang, { scale: s, phase: 'scale', focus: false });
      else if (ph === 'match') await matchPhase(lang);
      else if (ph === 'match-scale') for (const s of [0.8, 1.5]) await matchPhase(lang, { scale: s });
      else if (ph === 'ftue') await ftuePhase(lang);
      else if (ph === 'esc') await escPhase(lang);
      else if (ph === 'clicks') await clicksPhase(lang);
      else if (ph === 'ftue-skirmish') await ftuePhase(lang, 'deploy');
    } catch (e) {
      log(`${ph} ${lang}: FAILED ${e.message.split('\n')[0]}`);
      report.errors.push(`[${lang}] ${ph} failed: ${e.message.split('\n')[0]}`);
    }
  }
}

// untranslated: visible strings identical to the English ones on the same screen (words of 4+ Latin letters)
const SKIP = /^(Red Horizon|RED HORIZON|OK|HD|FPS|CP|MCV|AI|v\d|[A-Z]{1,3}\d*)$/;
report.untranslated = {};
for (const [key, byLang] of Object.entries(report.texts)) {
  const en = new Set(byLang.en ?? []);
  for (const [lang, list] of Object.entries(byLang)) {
    if (lang === 'en') continue;
    const same = list.filter((t) => en.has(t) && /[A-Za-z]{4,}/.test(t) && !SKIP.test(t));
    if (same.length) (report.untranslated[lang] ??= {})[key] = same;
  }
}
delete report.texts;
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
const tally = {};
for (const c of report.cases) for (const i of c.issues ?? []) tally[i.kind] = (tally[i.kind] ?? 0) + 1;
log('issue totals:', JSON.stringify(tally));
log('untranslated (strings per language):', JSON.stringify(Object.fromEntries(Object.entries(report.untranslated).map(([l, m]) => [l, Object.values(m).flat().length]))));
log('errors:', report.errors.length ? report.errors.slice(0, 10) : 'none');
log(`report: ${OUT}/report.json`);
await browser.close();
