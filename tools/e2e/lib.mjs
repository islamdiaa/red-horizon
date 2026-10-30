// The E2E bot's core: a browser session that plays like a person, through the mouse, the keyboard and what is on
// screen.
//
// Rules the journeys follow:
//  - Orders, clicks and key presses go through Playwright's real input (page.mouse, page.keyboard, locator.click),
//    never through the game's API.
//  - window.__game (exposed by ?debug=1) is read only: for assertions and for aiming (where on screen a unit or a
//    free building spot is).
//  - The one exception is the clock. On a software GPU a match runs at a few frames a second, so waiting for the
//    build bar or for a battle to play out uses `bot.wait(simSeconds)`, which fast-forwards the simulation (time
//    passes, nothing is ordered). With --realtime it waits for the game clock instead (real GPUs, phones).
//
// Every page collects page errors, console errors and Content-Security-Policy violations; journeys assert none
// appeared (bot.noErrors()).
import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Command-line options shared by run.mjs and the journeys. */
export function parseArgs(argv = process.argv.slice(2)) {
  const o = {
    // (GAME_URL / OUT_DIR: what tools/lab/lab.sh sets inside the test VMs)
    url: process.env.E2E_URL ?? process.env.GAME_URL ?? 'http://127.0.0.1:5302/',
    browser: 'chromium', cdp: null, out: process.env.E2E_OUT ?? process.env.OUT_DIR ?? path.join(ROOT, 'screenshots/e2e'), journeys: [], headed: !!process.env.HEADED,
    channel: process.env.E2E_CHANNEL ?? null, executable: process.env.E2E_EXECUTABLE ?? null,
    width: 1280, height: 720, slow: 1, realtime: false, locale: 'en-US', shots: true, serve: null, serveB: null, list: false,
    touch: false, mobile: false, lang: process.env.E2E_LANG ?? null, classic: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--url') o.url = v();
    else if (a === '--browser') o.browser = v();
    else if (a === '--channel') o.channel = v(); // chrome, msedge (Chromium) or moz-firefox (the installed Firefox)
    else if (a === '--executable') o.executable = v();
    else if (a === '--cdp') o.cdp = v(); // e.g. http://127.0.0.1:9222 (Android Chrome through adb forward)
    else if (a === '--out') o.out = v();
    else if (a === '--size') { const [w, h] = v().split('x').map(Number); o.width = w; o.height = h; }
    else if (a === '--slow') o.slow = +v(); // multiplies every timeout (slow CPUs, software GPUs)
    else if (a === '--realtime') o.realtime = true;
    else if (a === '--headed') o.headed = true;
    else if (a === '--locale') o.locale = v();
    else if (a === '--no-shots') o.shots = false;
    else if (a === '--serve') o.serve = v(); // serve this build directory (production headers) instead of --url
    else if (a === '--serve-b') o.serveB = v(); // later builds (comma-separated), for the PWA update journey
    else if (a === '--touch') o.touch = true;
    else if (a === '--mobile') o.mobile = true;
    else if (a === '--lang') o.lang = v(); // the interface language for a fresh profile (rh.lang): de, ru, zh-CN...
    else if (a === '--classic') o.classic = true; // the Classic interface layout setting for a fresh profile
    else if (a === '--list') o.list = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.journeys.push(...a.split(',').filter(Boolean));
  }
  if (!o.url.endsWith('/') && !new URL(o.url).pathname.endsWith('.html')) o.url += '/';
  return o;
}

/** Launch (or connect to) a browser. Chromium on Linux without a GPU uses SwiftShader. */
export async function openBrowser(o) {
  if (o.cdp) return chromium.connectOverCDP(o.cdp);
  const nss = path.join(ROOT, 'tools/nsslibs/lib');
  const env = { ...process.env };
  if (process.platform === 'linux' && fs.existsSync(nss)) env.LD_LIBRARY_PATH = [nss, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  const type = { chromium, firefox, webkit }[o.browser];
  if (!type) throw new Error(`unknown browser ${o.browser}`);
  const args = o.browser === 'chromium' ? [
    // E2E_CHROME_ARGS replaces the GPU flags (e.g. "--use-angle=d3d11-warp" on Windows, "" for the real GPU)
    ...(process.env.E2E_CHROME_ARGS !== undefined ? process.env.E2E_CHROME_ARGS.split(' ').filter(Boolean) : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
  ] : [];
  // E2E_FIREFOX_PREFS: JSON, e.g. {"webgl.force-enabled":true} on GPU-less Windows (WebGL 2 on WARP)
  const prefs = o.browser === 'firefox' && process.env.E2E_FIREFOX_PREFS ? { firefoxUserPrefs: JSON.parse(process.env.E2E_FIREFOX_PREFS) } : {};
  if (o.browser === 'firefox' && o.channel === 'moz-firefox' && process.platform === 'win32') args.push('-wait-for-browser'); // (the stock launcher exits at once)
  return type.launch({ headless: !o.headed, args, env, ...prefs, ...(o.channel ? { channel: o.channel } : {}), ...(o.executable ? { executablePath: o.executable } : {}) });
}

/** Console noise that isn't a game bug (software-GPU performance chatter). Errors only; warnings are logged. */
const IGNORED = [
  /GPU stall due to ReadPixels/i,
  /GL_CLOSE_PATH_NV|Automatic fallback to software WebGL/i,
  // Chrome on plain HTTP from a non-localhost address (the test VMs): the COOP header needs a trustworthy origin.
  // Benign (players never see it); only this exact message is ignored.
  /^The Cross-Origin-Opener-Policy header has been ignored, because the URL's origin was untrustworthy\./,
];

/** Footprints of the structures the bot builds (src/data/rules.ts BUILDINGS[..].size). */
export const SIZES = {
  fact: [3, 3], powr: [2, 2], apwr: [3, 3], proc: [3, 3], silo: [1, 1], tent: [2, 2], barr: [2, 2], kenn: [1, 1], weap: [3, 3],
  dome: [2, 2], fix: [3, 3], atek: [2, 2], stek: [3, 3], hpad: [2, 2], afld: [3, 2], pbox: [1, 1], gun: [1, 1], ftur: [1, 1],
  tsla: [1, 2], sbag: [1, 1], barb: [1, 1], hbox: [1, 1], rlab: [3, 2], bnkr: [2, 2],
};

export class JourneyAbort extends Error {}

export class Bot {
  constructor(o, browser, name) {
    this.o = o; this.browser = browser; this.name = name;
    this.errors = []; this.warnings = []; this.csp = []; this.badResponses = [];
    this.checks = []; this.t0 = Date.now(); this.allErrors = [];
    this.dir = path.join(o.out, name);
    fs.mkdirSync(this.dir, { recursive: true });
    this.logLines = [];
    this.shotN = 0;
    /** Expected console errors (RegExps) a journey whitelists for a while, e.g. a deliberately broken import file. */
    this.expect = [];
    /** Friction a player would feel (clicks that did nothing, prompts that didn't help...): { t, kind, text }. */
    this.frictions = [];
  }

  /** Record friction (the matrix reports it): a click that did nothing, a prompt that didn't help, a softlock. */
  friction(kind, text) {
    this.frictions.push({ kind, text: String(text).slice(0, 300), t: Math.round(this.simT ?? 0) });
    this.log(`friction [${kind}] ${text}`);
  }

  /** A fresh profile (a new context: empty storage, no service worker) and one page. */
  async open({ width = this.o.width, height = this.o.height, hasTouch = this.o.touch, isMobile = this.o.mobile, keep = false } = {}) {
    if (this.context && !keep) await this.context.close().catch(() => {});
    if (this.o.cdp) {
      this.context = this.browser.contexts()[0] ?? await this.browser.newContext();
      if (!keep) await this.context.clearCookies().catch(() => {});
    } else {
      this.context = await this.browser.newContext({
        viewport: { width, height }, locale: this.o.locale, hasTouch, isMobile, acceptDownloads: true, serviceWorkers: 'allow',
        permissions: this.o.browser === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [],
      });
    }
    // (a language or the Classic layout for a fresh profile: set before the game reads its settings)
    if ((this.o.lang || this.o.classic) && !keep) {
      await this.context.addInitScript(([lang, classic]) => {
        try {
          if (lang && !localStorage.getItem('rh.lang')) localStorage.setItem('rh.lang', lang);
          if (classic && !localStorage.getItem('rh.e2e.classic')) { localStorage.setItem('rh.settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('rh.settings') ?? '{}'), hudLayout: 'classic' })); localStorage.setItem('rh.e2e.classic', '1'); }
        } catch { /* storage blocked */ }
      }, [this.o.lang, this.o.classic]).catch(() => {});
    }
    this.page = await this.context.newPage();
    this.attach(this.page);
    if (this.o.cdp && !keep) { // a shared real browser: start from empty storage on the game's origin
      await this.page.goto(new URL(this.o.url).origin + '/robots.txt').catch(() => {});
      await this.page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); indexedDB.databases?.().then((d) => d.forEach((x) => indexedDB.deleteDatabase(x.name))); } catch { /* ignore */ } }).catch(() => {});
    }
    return this.page;
  }

  attach(page) {
    page.setDefaultTimeout(30000 * this.o.slow);
    // CSP violations as the page sees them (a console message is also printed, but not by every engine)
    page.addInitScript(() => {
      window.__e2eCsp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__e2eCsp.push(`${e.violatedDirective} blocked ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}`));
      // rAF timestamps can be older than performance.now() on a slow renderer: keep them monotonic (as tools/qa does)
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now())));
    }).catch(() => {});
    page.on('pageerror', (e) => this.err(`[pageerror] ${e.message} ${(e.stack ?? '').split('\n').slice(1, 3).join(' | ')}`));
    page.on('console', (m) => {
      const t = m.text().slice(0, 600);
      if (/Content.Security.Policy|Refused to (load|execute|connect|apply|create|frame)/i.test(t)) this.csp.push(t);
      if (m.type() === 'error') { if (!IGNORED.some((r) => r.test(t))) this.err(`[console.error] ${t}`); }
      else if (m.type() === 'warning') this.warnings.push(t);
    });
    page.on('response', (r) => {
      try {
        if (r.status() >= 400 && new URL(r.url()).origin === new URL(this.o.url).origin) this.badResponses.push(`${r.status()} ${r.url()}`);
      } catch { /* ignore */ }
    });
    page.on('dialog', (d) => { this.log(`dialog: ${d.type()} "${d.message().slice(0, 120)}" -> accept`); d.accept().catch(() => {}); });
  }

  err(t) {
    if (this.expect.some((r) => r.test(t))) { this.log(`(expected) ${t.slice(0, 200)}`); return; }
    this.errors.push(t);
  }

  // ---------------------------------------------------------------- reporting

  log(...a) {
    const line = `[${this.name} ${((Date.now() - this.t0) / 1000).toFixed(0).padStart(4)}s] ${a.join(' ')}`;
    this.logLines.push(line);
    console.log(line);
  }

  /** Record a check. Returns `ok` so a journey can branch on it. */
  check(ok, what, detail = '') {
    const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
    this.checks.push({ ok: !!ok, what, detail: String(d ?? '').slice(0, 800) });
    this.log(`${ok ? 'PASS' : 'FAIL'} ${what}${d ? `  -- ${String(d).slice(0, 300)}` : ''}`);
    return !!ok;
  }

  /** Fail the journey now (after recording why). */
  fail(what, detail = '') { this.check(false, what, detail); throw new JourneyAbort(what); }

  /** Check there were no page errors, console errors or CSP violations since the last call (and reset the lists). */
  async noErrors(where) {
    let cspPage = [];
    try { cspPage = await this.page.evaluate(() => (window.__e2eCsp ?? []).splice(0)); } catch { /* navigating */ }
    const csp = [...new Set([...this.csp, ...cspPage])];
    const errs = [...new Set(this.errors)];
    this.check(errs.length === 0, `no console or page errors (${where})`, errs.slice(0, 4).join(' || '));
    this.check(csp.length === 0, `no CSP violations (${where})`, csp.slice(0, 4).join(' || '));
    this.allErrors.push(...errs);
    this.errors = []; this.csp = [];
    return errs.length === 0 && csp.length === 0;
  }

  /**
   * Text that doesn't fit and text that isn't text yet, on what is visible now (for example long German and Russian
   * strings): an element whose own text is clipped by its box (overflow hidden / clip, or cut with an ellipsis), text
   * that leaves the window (outside any scrolling or clipping container), and a catalogue key or an unfilled
   * {placeholder} on screen. Each finding is recorded as friction ('overflow', 'offscreen', 'text') once per element
   * and text; returns { clip, off, raw }.
   */
  async audit(where, { scope = 'body', ellipsis = true, record = true } = {}) {
    const r = await this.page.evaluate(([scope, ellipsis]) => {
      const out = { clip: [], off: [], raw: [] };
      const KEY = /^(a11y|army|campaign|challenges|cinematic|commander|common|conquest|controls|doctrine|economy|editor|errors|hints|hud|loading|lobby|locker|menu|meta|mission|missions|modes|mods|moment|net|players|profile|replay|research|results|rivals|settings|share|speech|toasts|tutorial|variety|world|worldUi|worldmap)\.[a-zA-Z0-9_.]+$/; // (world, worldUi, worldmap: World Conquest's namespaces)
      const PH = /\{[a-zA-Z_][\w:]*(, *(plural|select)[^}]*)?\}/;
      const seen = new Set();
      const root = document.querySelector(scope) ?? document.body;
      const clipped = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return true; } return false; };
      for (const e of root.querySelectorAll('*')) {
        if (e.closest('svg, canvas, script, style, noscript, template, [aria-hidden="true"], .tt, #tooltip')) continue;
        const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
        if (!own) continue;
        if (e.checkVisibility && !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const cs = getComputedStyle(e);
        const b = e.getBoundingClientRect();
        if (b.width < 2 || b.height < 2) continue;
        // (covered: a screen under another one, a panel behind a dialog; only what is on top is read)
        const cx = Math.min(innerWidth - 1, Math.max(0, b.left + Math.min(b.width, 40) / 2)), cy = Math.min(innerHeight - 1, Math.max(0, b.top + b.height / 2));
        const top = b.right > 0 && b.bottom > 0 && b.left < innerWidth && b.top < innerHeight ? document.elementFromPoint(cx, cy) : null;
        if (top && !e.contains(top) && !top.contains(e) && !top.closest('.tt, #tooltip')) continue;
        const text = own.slice(0, 60);
        const id = `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
        const key = `${id}|${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (KEY.test(own) || PH.test(own)) out.raw.push(`${id} "${text}"`);
        const hidesX = cs.overflowX === 'hidden' || cs.overflowX === 'clip' || (ellipsis && cs.textOverflow === 'ellipsis');
        // (scrollWidth misses text that overflows to the left, e.g. a centred flex label cut at both ends, and text in a
        // span clipped by its button: the own text's boxes against the padding box of the nearest box (itself or up to
        // three ancestors) that hides overflow; text cut part way, not text slid wholly out of view on purpose)
        let cutSides = false;
        if (cs.textOverflow !== 'ellipsis') {
          let c = e;
          for (let k = 0; c && k < 4; k++, c = c.parentElement) { const s = getComputedStyle(c); if (s.overflowX === 'hidden' || s.overflowX === 'clip') break; }
          if (c && c !== document.body) {
            const ccs = getComputedStyle(c), cb = c.getBoundingClientRect();
            const l = cb.left + (parseFloat(ccs.borderLeftWidth) || 0), r = cb.right - (parseFloat(ccs.borderRightWidth) || 0);
            for (const n of e.childNodes) {
              if (n.nodeType !== 3 || !n.textContent.trim()) continue;
              const rg = document.createRange(); rg.selectNodeContents(n);
              const tb = rg.getBoundingClientRect();
              if (tb.width > 0 && tb.right > l && tb.left < r && (tb.left < l - 1.5 || tb.right > r + 1.5)) { cutSides = true; break; }
            }
          }
        }
        const clipX = (hidesX && e.scrollWidth > e.clientWidth + 2) || cutSides;
        const clipY = (cs.overflowY === 'hidden' || cs.overflowY === 'clip') && cs.webkitLineClamp === 'none' && e.scrollHeight > e.clientHeight + 3;
        if (clipX || clipY) out.clip.push(`${id} "${text}"${clipX ? ` w ${e.scrollWidth}>${e.clientWidth}` : ''}${clipY ? ` h ${e.scrollHeight}>${e.clientHeight}` : ''}`);
        if ((b.right > innerWidth + 1 || b.left < -1 || b.bottom > innerHeight + 1 || b.top < -1) && !clipped(e)) out.off.push(`${id} "${text}" [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`);
      }
      return out;
    }, [scope, ellipsis]).catch((e) => ({ clip: [], off: [], raw: [], error: String(e).slice(0, 200) }));
    if (record) {
      for (const c of r.clip) this.friction('overflow', `${where}: ${c}`);
      for (const c of r.off) this.friction('offscreen', `${where}: ${c}`);
      for (const c of r.raw) this.friction('text', `${where}: ${c}`);
    }
    return r;
  }

  async shot(label) {
    if (!this.o.shots || !this.page) return null;
    const file = path.join(this.dir, `${String(++this.shotN).padStart(2, '0')}-${label.replace(/[^\w.-]+/g, '_')}.png`);
    await this.page.screenshot({ path: file, timeout: 60000 * this.o.slow }).catch((e) => this.log(`screenshot failed: ${e.message.split('\n')[0]}`));
    return file;
  }

  // ---------------------------------------------------------------- navigation and screens

  /** The game URL with extra query parameters (always ?debug=1, so window.__game is readable). */
  url(params = {}, hash = '') {
    const u = new URL(this.o.url);
    u.searchParams.set('debug', '1');
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    return u.href + hash;
  }

  async goto(params = {}, hash = '') {
    await this.page.goto(this.url(params, hash), { waitUntil: 'load', timeout: 120000 * this.o.slow });
  }

  async reload() { await this.page.reload({ waitUntil: 'load', timeout: 120000 * this.o.slow }); }

  /** Wait until the main menu is up and interactive (its entries fade in). */
  async waitMenu(timeout = 120000) {
    await this.page.waitForSelector('.main-screen:not(.leaving) .mm-nav-btn', { state: 'visible', timeout: timeout * this.o.slow });
    await this.page.waitForFunction(() => { const b = [...document.querySelectorAll('.main-screen:not(.leaving) .mm-nav-btn')].pop(); return b && +getComputedStyle(b).opacity > 0.95; }, null, { timeout: 15000 * this.o.slow, polling: 200 }).catch(() => {});
    await sleep(300);
  }

  /** A visible element by CSS selector, optionally with text (string = substring, RegExp). */
  el(selector, text) {
    let l = this.page.locator(selector);
    if (text !== undefined) l = l.filter({ hasText: text });
    return l.locator('visible=true').first();
  }

  /** Click a visible element (the real mouse: moves there, presses, releases). */
  async click(selector, text, opts = {}) {
    const l = this.el(selector, text);
    await l.waitFor({ state: 'visible', timeout: (opts.timeout ?? 30000) * this.o.slow });
    await l.scrollIntoViewIfNeeded().catch(() => {});
    await l.click({ timeout: (opts.timeout ?? 30000) * this.o.slow, button: opts.button, force: opts.force, modifiers: opts.modifiers, noWaitAfter: true, trial: false });
    await sleep(opts.after ?? 350);
  }

  /** Click a main-menu entry by its text. */
  async nav(text) { await this.click('.main-screen:not(.leaving) .mm-nav-btn', text); }

  /** Is a visible element there right now? */
  async sees(selector, text) {
    return this.el(selector, text).isVisible().catch(() => false);
  }

  /** Wait until a visible element appears; false on timeout. */
  async waitFor(selector, text, timeout = 30000) {
    return this.el(selector, text).waitFor({ state: 'visible', timeout: timeout * this.o.slow }).then(() => true, () => false);
  }

  /** The visible buttons, links and fields, as a person would scan them (for logs and for finding things). */
  async onScreen(scope = 'body') {
    return this.page.evaluate((scope) => {
      const out = [];
      for (const e of document.querySelectorAll(`${scope} button, ${scope} [role=button], ${scope} a[href], ${scope} input, ${scope} select`)) {
        const r = e.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || getComputedStyle(e).visibility === 'hidden') continue;
        out.push(`${e.tagName.toLowerCase()}.${[...e.classList].join('.')}:"${(e.textContent || e.value || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`);
      }
      return out;
    }, scope);
  }

  async key(k, after = 300) { await this.page.keyboard.press(k); await sleep(after); }

  /** Wait for `n` rendered frames (a slow renderer can take a while per frame). */
  async frames(n = 1) {
    await this.page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n).catch(() => {});
  }

  /** Text of the visible toasts / announcer messages (for logs and checks). */
  async toasts() {
    return this.page.evaluate(() => [...document.querySelectorAll('.toast, .msg, .notif')].map((t) => t.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(-8));
  }

  // ---------------------------------------------------------------- the running game (read-only)

  /** Evaluate a read-only function of window.__game (`g`). */
  async g(fn, arg) {
    return this.page.evaluate(([src, arg]) => {
      const g = window.__game;
      // eslint-disable-next-line no-new-func
      return new Function('g', 'arg', `return (${src})(g, arg);`)(g, arg);
    }, [fn.toString(), arg]);
  }

  /** Is a real match (not the menu backdrop) running and its loading screen gone? */
  async inMatch() {
    return this.page.evaluate(() => {
      const g = window.__game, l = document.getElementById('loading');
      return !!(g && g.hud && !g.setup.demo && (!l || getComputedStyle(l).display === 'none'));
    }).catch(() => false);
  }

  /** Wait for a match with its HUD, then for the opening fly-over to finish (or skip it with a key, as offered). */
  async waitMatch({ skipIntro = true, timeout = 240000 } = {}) {
    await this.page.waitForFunction(() => {
      const g = window.__game, l = document.getElementById('loading');
      return !!(g && g.hud && !g.setup.demo && (!l || getComputedStyle(l).display === 'none'));
    }, null, { timeout: timeout * this.o.slow, polling: 400 });
    if (skipIntro && await this.page.evaluate(() => document.body.classList.contains('cine-active'))) {
      await sleep(1200);
      await this.key('Space', 500); // "press any key to skip"
      const ok = await this.page.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 30000 * this.o.slow, polling: 300 }).then(() => true, () => false);
      if (!ok) this.log('intro still running after a key press');
    }
    await this.settleCamera();
  }

  async settleCamera() {
    await this.page.waitForFunction(() => { const c = window.__game?.gfx?.cam; return !c || (!c.flyTo && Math.abs(c.dist - c.targetDist) < 0.5); }, null, { timeout: 30000 * this.o.slow, polling: 300 }).catch(() => {});
    await sleep(300);
    await this.frames(2); // (the camera's matrices update when a frame renders: aiming before that projects with the old view)
  }

  /** Simulation time in seconds. */
  async simTime() { return this.page.evaluate(() => window.__game?.world.time ?? 0).catch(() => 0); }

  /**
   * Let `simSeconds` of game time pass. Fast-forwards in small chunks (the HUD, toasts and events keep up between
   * chunks; under 40 ticks a chunk so Game.fastForward processes every event) unless --realtime, which waits for the
   * game clock instead. `until` (a page function) stops early when it returns true.
   */
  async wait(simSeconds, { until = null, chunk = 1.9 } = {}) { // (chunk: under 40 ticks, so Game.fastForward processes every event)
    const end = (await this.simTime()) + simSeconds;
    for (let guard = 0; guard < 100000; guard++) {
      const st = await this.page.evaluate(() => { const g = window.__game; return g ? { t: g.world.time, over: g.world.gameOver, paused: g.paused } : null; }).catch(() => null);
      if (st) this.simT = st.t; // (the time friction notes are stamped with)
      if (!st || st.over || st.t >= end) break;
      if (until && await this.page.evaluate(until).catch(() => false)) return true;
      if (this.o.realtime) await sleep(400);
      else {
        // E2E_FF_BATCH chunks per round trip (each chunk still processes all its events): fewer rendered frames per
        // simulated second on a software GPU, where every round trip waits for a frame (the play matrix uses 4)
        const batch = Math.max(1, Number(process.env.E2E_FF_BATCH) || 1);
        await this.page.evaluate(([c, n, end]) => { const g = window.__game; for (let k = 0; k < n && g && !g.world.gameOver && g.world.time < end; k++) g.fastForward(Math.min(c, end - g.world.time + 0.05)); }, [chunk, batch, end]);
        await sleep(60);
      }
    }
    return until ? this.page.evaluate(until).catch(() => false) : true;
  }

  /** Project a map point to CSS pixels. */
  async toScreen(x, y, lift = 0) {
    return this.page.evaluate(([x, y, lift]) => {
      const g = window.__game, cam = g.gfx.cam.camera;
      const v = cam.position.clone();
      v.set(x, g.world.map.heightAt(x, y) + lift, y).project(cam);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, onScreen: Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.98 && v.z < 1 };
    }, [x, y, lift]);
  }

  /**
   * Project many map points at once (one round trip: on a software GPU every evaluate waits for a frame, so
   * aiming at fifty units one by one took a minute). Each result also says whether it is in the play area with the
   * game canvas under it (inPlay's test).
   */
  async toScreenMany(pts, lift = 0) {
    return this.page.evaluate(([pts, lift]) => {
      const g = window.__game, cam = g.gfx.cam.camera;
      const vis = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' ? b : null; };
      const r = { x0: 0, y0: 0, x1: innerWidth, y1: innerHeight };
      const tb = vis(document.getElementById('topbar')); if (tb) r.y0 = Math.max(r.y0, tb.bottom);
      const bb = vis(document.getElementById('buildbar')); if (bb) r.y1 = Math.min(r.y1, bb.top);
      const sb = vis(document.getElementById('sidebar')); if (sb) r.x1 = Math.min(r.x1, sb.left);
      const dock = vis(document.getElementById('dock')); if (dock && dock.top > innerHeight / 2) r.y1 = Math.min(r.y1, dock.top);
      const a = { x0: r.x0 + 12, y0: r.y0 + 12, x1: r.x1 - 12, y1: r.y1 - 12 };
      const v = cam.position.clone();
      return pts.map(([x, y]) => {
        v.set(x, g.world.map.heightAt(x, y) + lift, y).project(cam);
        const p = { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, onScreen: Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.98 && v.z < 1 };
        let ok = p.onScreen && p.x > a.x0 && p.x < a.x1 && p.y > a.y0 && p.y < a.y1;
        if (ok) { const e = document.elementFromPoint(p.x, p.y); ok = !!e && e.tagName === 'CANVAS' && !e.closest('#ui'); }
        return { ...p, inPlay: ok };
      });
    }, [pts, lift]);
  }

  /** The part of the screen that shows the battlefield (not covered by the HUD). */
  async playArea() {
    return this.page.evaluate(() => {
      const r = { x0: 0, y0: 0, x1: innerWidth, y1: innerHeight };
      const vis = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' ? b : null; };
      const tb = vis(document.getElementById('topbar')); if (tb) r.y0 = Math.max(r.y0, tb.bottom);
      const bb = vis(document.getElementById('buildbar')); if (bb) r.y1 = Math.min(r.y1, bb.top); // Modern: the bottom build bar
      const sb = vis(document.getElementById('sidebar')); if (sb) r.x1 = Math.min(r.x1, sb.left); // Classic: the right-hand column
      const dock = vis(document.getElementById('dock')); if (dock && dock.top > innerHeight / 2) r.y1 = Math.min(r.y1, dock.top);
      return { x0: r.x0 + 12, y0: r.y0 + 12, x1: r.x1 - 12, y1: r.y1 - 12 };
    });
  }

  /** Is a screen point in the play area, and is the element under it the game canvas? */
  async inPlay(p) {
    if (p.onScreen === false) return false;
    const a = await this.playArea();
    if (!(p.x > a.x0 && p.x < a.x1 && p.y > a.y0 && p.y < a.y1)) return false;
    return this.page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && e.tagName === 'CANVAS' && !e.closest('#ui'); }, [p.x, p.y]);
  }

  /** The minimap canvas rectangle. */
  async minimapRect() {
    return this.page.evaluate(() => { const c = document.querySelector('#ui .radar canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return r.width > 4 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; });
  }

  /** Centre the camera on a map point the way a player would: a click on the minimap (else the arrow keys). */
  async lookAt(x, y) {
    const r = await this.minimapRect();
    const m = await this.g((g) => ({ w: g.world.map.w, h: g.world.map.h }));
    const far = async () => { const c = await this.g((g) => [g.gfx.cam.x, g.gfx.cam.y]); return Math.hypot(c[0] - x, c[1] - y); };
    if (r) {
      await this.page.mouse.click(r.x + (x / m.w) * r.w, r.y + (y / m.h) * r.h);
      await sleep(250);
      await this.settleCamera();
      if (await far() < 4) return true;
    }
    // the minimap takes no clicks while the radar is offline (no Radar Dome yet, as in Red Alert): pan with right-drags
    // instead, the way a player scrolls (the map follows the mouse; a drag from the target towards the middle)
    for (let i = 0; i < 8 && await far() >= 3; i++) {
      const a = await this.playArea();
      const c = { x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2 };
      const p = await this.toScreen(x, y);
      if (!Number.isFinite(p.x + p.y)) break;
      const k = Math.min(1, (Math.min(a.x1 - a.x0, a.y1 - a.y0) * 0.45) / Math.max(1, Math.hypot(p.x - c.x, p.y - c.y)));
      const from = { x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k };
      const before = await far();
      await this.drag(from, c, { button: 'right', steps: 6 });
      await this.settleCamera();
      if (await far() >= before - 0.5) { this.log(`lookAt ${x.toFixed(0)},${y.toFixed(0)}: right-drag panning got no closer`); break; }
    }
    return await far() < 6;
  }

  /** Drag between two screen points (a selection box with the left button). */
  async drag(a, b, { button = 'left', steps = 10 } = {}) {
    await this.page.mouse.move(a.x, a.y, { steps: 3 });
    await this.page.mouse.down({ button });
    await this.page.mouse.move(b.x, b.y, { steps });
    await this.page.mouse.up({ button });
    await sleep(350);
  }

  // ---------------------------------------------------------------- the battle HUD (by stable data attributes)

  /** The build card of a type in the open tab. */
  card(id) { return this.page.locator(`#ui :is(#buildbar, #sidebar) .bitem[data-id="${id}"]`).first(); }

  async cardState(id) { return this.card(id).getAttribute('data-state', { timeout: 2000 }).catch(() => null); }

  /** Open a build-bar tab: building, infantry, vehicle, defense, support, aircraft, naval. */
  async tab(id) {
    const t = this.page.locator(`#ui :is(#buildbar, #sidebar) .tab[data-tab="${id}"]`).first();
    if (!await t.isVisible().catch(() => false)) return false;
    if (!await this.clickEl(t)) return false;
    // the HUD rebuilds the cards on its next update: wait for the tab to show as active, then for two frames
    await this.page.waitForFunction((id) => document.querySelector(`#ui :is(#buildbar, #sidebar) .tab[data-tab="${id}"]`)?.classList.contains('active'), id, { timeout: 15000 * this.o.slow, polling: 100 }).catch(() => {});
    await this.frames(2);
    return true;
  }

  /** Which tab holds a card (the first tab whose grid shows it). */
  async findCard(id) {
    for (const t of ['building', 'infantry', 'vehicle', 'defense', 'support', 'aircraft', 'naval']) {
      if (!await this.tab(t)) continue;
      if (await this.card(id).isVisible().catch(() => false)) return t;
    }
    return null;
  }

  /** My player (index), structures and units, for aiming. */
  async mine() {
    return this.g((g) => {
      const me = g.local;
      return {
        credits: me.credits, power: [me.powerOut, me.powerUse], faction: me.faction, team: me.team,
        blds: g.world.buildings.filter((b) => b.alive && b.owner === me).map((b) => ({ id: b.id, t: b.bt.id, x: b.x, y: b.y, cx: b.cx, cy: b.cy, done: b.buildAnim >= 1 })),
        units: g.world.units.filter((u) => u.alive && u.owner === me).map((u) => ({ id: u.id, t: u.ut.id, x: u.x, y: u.y, armed: u.weapons.length > 0 && !u.ut.harvester, harv: !!u.ut.harvester, inf: !!u.ut.infantry })),
      };
    });
  }

  /** Living enemy structures and units (counted as the victory check counts them). */
  async enemies() {
    return this.g((g) => {
      const me = g.local;
      const blds = g.world.buildings.filter((b) => b.alive && me.isEnemy(b.owner) && !b.bt.wall && !b.bt.mine && !b.bt.tech).map((b) => ({ id: b.id, t: b.bt.id, x: b.x, y: b.y }));
      const units = g.world.units.filter((u) => u.alive && me.isEnemy(u.owner)).map((u) => ({ id: u.id, t: u.ut.id, x: u.x, y: u.y }));
      return { blds, units };
    });
  }

  /**
   * Build a structure from the build bar and place it with the mouse next to the base: click its card, let it
   * finish, click the card again to pick it up, then hover spots near `near` (default: the construction yard) until
   * the ghost is valid and click.
   */
  async build(type, { near = null, maxWait = 240, tries = 14 } = {}) {
    const tab = await this.findCard(type);
    if (!tab) { this.log(`build ${type}: no card`); return false; }
    if (await this.locked(type)) { // (a requirement may still be finishing: a structure placed a moment ago)
      await this.wait(10, { until: `(() => { const c = document.querySelector('#ui :is(#buildbar, #sidebar) .bitem[data-id="${type}"]'); return !!c && !c.classList.contains('locked'); })()` });
      if (await this.locked(type)) { this.friction('locked', `build ${type}: the card is locked`); return false; }
    }
    let st = await this.cardState(type);
    if (st !== 'ready') {
      if (!await this.clickCard(type)) return false;
      await sleep(200);
      // (a click that started nothing: no money, a busy yard, a mission that forbids it; the order lands on the next tick)
      const isOn = `(() => { const q = window.__game?.local.queues.structure; return !!q && (q.ready === '${type}' || q.items.some((i) => i.type === '${type}')); })()`;
      const started = await this.wait(2, { until: isOn });
      if (!started) { this.friction('no-op click', `build ${type}: the click started nothing (card ${await this.cardState(type)}, $${await this.g((g) => g.local.credits)})`); return false; }
      const ok = await this.wait(maxWait, { until: `(() => document.querySelector('#ui :is(#buildbar, #sidebar) .bitem[data-id="${type}"]')?.dataset.state === 'ready' || window.__game?.local.queues.structure.ready === '${type}' || window.__game?.local.queues.defense?.ready === '${type}')()` });
      if (!ok) { this.log(`build ${type}: not ready (card ${await this.cardState(type)})`); return false; }
    }
    await this.tab(tab);
    if (!await this.clickCard(type)) return false;
    await sleep(300);
    if (await this.g((g) => g.input.mode) !== 'place') { this.friction('no-op click', `build ${type}: not in place mode after clicking the ready card`); return false; }
    return this.place(type, { near, tries });
  }

  /** In placement mode: find a valid spot near the base and click it. */
  async place(type, { near = null, tries = 14 } = {}) {
    const [w, h] = SIZES[type] ?? [2, 2];
    const base = near ?? await this.g((g) => { const f = g.world.buildings.find((b) => b.alive && b.owner === g.local && b.bt.id === 'fact') ?? g.world.buildings.find((b) => b.alive && b.owner === g.local); return f ? { x: f.x, y: f.y } : null; });
    if (!base) return false;
    await this.lookAt(base.x, base.y);
    const cands = await this.g((g, a) => {
      const out = [];
      const w = g.world, me = g.local;
      for (let r = 2; r <= 9; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = Math.round(a.x + dx - a.w / 2), cy = Math.round(a.y + dy - a.h / 2);
        // leave a lane around the footprint so later structures and units still fit
        if (w.canPlace(me, a.type, cx, cy)) out.push({ cx, cy, gx: cx + a.w / 2, gy: cy + a.h / 2, r });
      }
      return out.slice(0, 160);
    }, { ...base, w, h, type });
    let n = 0;
    const scr = await this.toScreenMany(cands.map((c) => [c.gx, c.gy]));
    for (const [k, c] of cands.entries()) {
      const p = scr[k];
      if (!p.inPlay) continue;
      await this.page.mouse.move(p.x, p.y, { steps: 3 });
      await sleep(200);
      // the ghost follows the cursor: check the cell under it is the one we aimed at (and still valid)
      const ok = await this.g((g, a) => { const i = g.input; const cx = Math.round(i.groundX - a.w / 2), cy = Math.round(i.groundY - a.h / 2); return i.mode === 'place' && g.world.canPlace(g.local, a.type, cx, cy); }, { w, h, type });
      if (!ok) continue;
      const count0 = await this.g((g, t) => g.world.buildings.filter((b) => b.owner === g.local && b.bt.id === t).length, type);
      await this.page.mouse.click(p.x, p.y);
      await sleep(250);
      await this.wait(0.5);
      const count1 = await this.g((g, t) => g.world.buildings.filter((b) => b.owner === g.local && b.bt.id === t).length, type);
      if (count1 > count0) { this.log(`placed ${type} at ${c.cx},${c.cy}`); return true; }
      if (++n >= tries) break;
      if (await this.g((g) => g.input.mode) !== 'place') break;
    }
    this.friction('placement', `place ${type}: no spot worked (${cands.length} candidates)`);
    await this.key('Escape');
    return false;
  }

  /**
   * Click a build card with the real mouse, the way a person does: only when the card is on screen and nothing
   * covers it (a card can be mid-animation for a while on a slow renderer, which Playwright's own click waits out).
   */
  async clickCard(id, { button = 'left', modifiers = [] } = {}) {
    const c = this.card(id);
    for (let i = 0; i < 20; i++) {
      await c.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      const box = await c.boundingBox().catch(() => null);
      if (box && box.width > 4) {
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        const hit = await this.page.evaluate(([x, y, id]) => document.elementFromPoint(x, y)?.closest('.bitem')?.dataset.id === id, [x, y, id]);
        if (hit) {
          for (const m of modifiers) await this.page.keyboard.down(m);
          await this.page.mouse.click(x, y, { button });
          for (const m of modifiers) await this.page.keyboard.up(m);
          await sleep(120);
          return true;
        }
      }
      await sleep(250);
    }
    this.friction('no-op click', `card ${id}: not clickable`);
    return false;
  }

  /** Click a locator's centre with the real mouse once nothing covers it (no actionability wait on animations). */
  async clickEl(loc, { button = 'left', tries = 20 } = {}) {
    for (let i = 0; i < tries; i++) {
      const box = await loc.boundingBox().catch(() => null);
      if (box && box.width > 2) {
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        const hit = await loc.evaluate((e, [x, y]) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h)); }, [x, y]).catch(() => false);
        if (hit) { await this.page.mouse.click(x, y, { button }); await sleep(120); return true; }
      }
      await sleep(250);
    }
    const cover = await loc.evaluate((e) => { const b = e.getBoundingClientRect(); const h = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return h ? `${h.tagName}.${h.className}` : 'nothing'; }).catch(() => '?');
    this.log(`not clickable (covered by ${cover})`);
    return false;
  }

  /** Is a card shown locked (requirements missing, or not allowed here)? */
  async locked(id) { return this.card(id).evaluate((e) => e.classList.contains('locked')).catch(() => true); }

  /** Queue `n` of a unit from the build bar (left clicks on its card). */
  async train(type, n = 1) {
    const tab = await this.findCard(type);
    if (!tab) { this.log(`train ${type}: no card`); return false; }
    if (await this.locked(type)) return false;
    for (let i = 0; i < n; i++) if (!await this.clickCard(type)) return false;
    return true;
  }

  /** Box-select my units in view around a point (they must be on screen); returns the selection size. */
  async boxSelectAround(x, y, radius = 7) {
    await this.lookAt(x, y);
    const a = await this.playArea();
    const units = (await this.mine()).units.filter((u) => u.armed && Math.hypot(u.x - x, u.y - y) <= radius);
    let pts = (await this.toScreenMany(units.map((u) => [u.x, u.y]))).filter((p) => p.onScreen);
    if (units.length && !pts.some((p) => p.inPlay)) {
      // (on screen but behind the HUD, e.g. gathered south of a base at the map's edge: scroll to the group itself)
      await this.lookAt(units.reduce((t, u) => t + u.x, 0) / units.length, units.reduce((t, u) => t + u.y, 0) / units.length);
      pts = (await this.toScreenMany(units.map((u) => [u.x, u.y]))).filter((p) => p.onScreen);
    }
    this.lastBox = { near: units.length, onScreen: pts.length, inPlay: pts.filter((p) => p.inPlay).length, box: null }; // (diagnostics for a selection that picked nothing)
    if (!pts.length) return 0;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const p0 = { x: clamp(Math.min(...pts.map((p) => p.x)) - 30, a.x0, a.x1), y: clamp(Math.min(...pts.map((p) => p.y)) - 30, a.y0, a.y1) };
    const p1 = { x: clamp(Math.max(...pts.map((p) => p.x)) + 30, a.x0, a.x1), y: clamp(Math.max(...pts.map((p) => p.y)) + 30, a.y0, a.y1) };
    this.lastBox.box = [p0.x, p0.y, p1.x, p1.y].map(Math.round);
    await this.drag(p0, p1);
    return this.g((g) => g.selection.size);
  }

  /**
   * Attack-move the selection to a map point: centre it with the minimap, press A, click the ground there. Returns
   * the input mode A gave and where the camera ended up (so a journey can tell a missed minimap click).
   */
  async attackMove(x, y, key = 'a') {
    await this.lookAt(x, y);
    const cam = await this.g((g) => [g.gfx.cam.x, g.gfx.cam.y]);
    const p = await this.toScreen(x, y, 0.6); // (a little above the ground: on a structure, the click picks it)
    const a = await this.playArea();
    const tx = Math.max(a.x0, Math.min(a.x1, p.x)), ty = Math.max(a.y0, Math.min(a.y1, p.y));
    if (tx !== p.x || ty !== p.y) this.log(`attack-move: target ${x.toFixed(0)},${y.toFixed(0)} off the play area (camera at ${cam.map((v) => v.toFixed(0))}), clicking ${tx.toFixed(0)},${ty.toFixed(0)}`);
    await this.key(key, 200);
    const mode = await this.g((g) => g.input.mode);
    await this.page.mouse.click(tx, ty);
    await sleep(250);
    return mode;
  }

  /** Open the pause menu with Esc (the HUD's menu button when Esc is rebound or swallowed). */
  async pause() {
    for (let i = 0; i < 3; i++) {
      if (await this.sees('.pause-screen:not(.leaving) .pp-btn')) return true;
      if (i === 0) await this.key('Escape', 600);
      else await this.click('#ui .tb-menu', undefined, { after: 600 }).catch(() => {});
    }
    return this.waitFor('.pause-screen:not(.leaving) .pp-btn', undefined, 10000);
  }

  /** A pause-menu entry by its data-act: resume, save game, settings, controls, restart, quit to menu. */
  async pauseAct(act) {
    if (!await this.pause()) this.fail('the pause menu opens');
    await this.click(`.pause-screen:not(.leaving) .pp-btn[data-act="${act}"]`);
  }

  /** Leave the match for the main menu through the pause menu. */
  async quitToMenu() {
    await this.pauseAct('quit to menu');
    await this.waitMenu();
  }

  /**
   * End the match now (a test shortcut where the results screen, not the battle, is under test): every unit and
   * structure of the losing side is destroyed, so the simulation's own victory check ends it on the next tick.
   * `won`: the local player's side wins. Then waits for the results screen (or a mission's debrief).
   */
  async forceEnd(won, timeout = 240000) {
    // (twice: destroyed structures release survivors, as in Red Alert, and a side with a rifleman left is not beaten)
    for (let k = 0; k < 2; k++) {
      await this.page.evaluate((won) => {
        const g = window.__game, w = g.world;
        const lose = (p) => (won ? g.local.isEnemy(p) : p.team === g.local.team);
        for (const e of [...w.units, ...w.buildings]) if (e.alive && lose(e.owner)) w.kill(e);
      }, won);
      await this.wait(k ? 2 : 0.5);
    }
    return this.page.waitForSelector(':is(.end-screen, .dbf, .cq-modal .cq-dlg, .wc-modal .wc-dlg):not(.leaving)', { state: 'visible', timeout: timeout * this.o.slow }).then(() => true, () => false); // (.wc-modal: a World Conquest battle report)
  }

  /** Wait for the results screen after the end of a match (the finale runs a few seconds first). */
  async waitResults(timeout = 120000) {
    return this.page.waitForSelector('.end-screen:not(.leaving) .rr-again', { state: 'visible', timeout: timeout * this.o.slow }).then(() => true, () => false);
  }
}

/** Load a journey module. */
export async function loadJourney(name) {
  const file = path.join(ROOT, 'tools/e2e/journeys', `${name}.mjs`);
  if (!fs.existsSync(file)) throw new Error(`no journey ${name}`);
  return import(pathToFileURL(file).href); // (a file URL: a bare Windows path is not an import specifier)
}
