// Lab smoke test: for each browser, load the game's menu, start a skirmish (?autostart=1),
// screenshot both, and record the WebGL renderer, the frame rate and any console errors.
// Run inside a lab VM:  tools/lab/lab.sh run <vm> tools/lab/smoke.mjs [browsers]
//   browsers: comma list of chromium, chrome, msedge, firefox (Playwright's build),
//             moz-firefox (the installed stock Firefox, over WebDriver BiDi), webkit
//   env: GAME_URL, OUT_DIR, HEADED=1, CHROME_ARGS="--use-angle=d3d11 ...", FIREFOX_PREFS='{"k":v}'
import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL_BASE = process.env.GAME_URL ?? 'http://localhost:8091/';
const OUT = process.env.OUT_DIR ?? 'out';
const win = process.platform === 'win32';
const which = (process.argv[2] ?? (win ? 'chrome,msedge,firefox,moz-firefox' : 'chromium,chrome,firefox,moz-firefox,webkit')).split(',');
const headless = process.env.HEADED !== '1';
const chromeArgs = (process.env.CHROME_ARGS ?? (win ? '--use-angle=d3d11 --ignore-gpu-blocklist' : '--ignore-gpu-blocklist --enable-unsafe-swiftshader')).split(' ').filter(Boolean);
const firefoxPrefs = JSON.parse(process.env.FIREFOX_PREFS ?? (win ? '{"webgl.force-enabled":true}' : '{}'));
fs.mkdirSync(OUT, { recursive: true });

const engines = {
  chromium: () => chromium.launch({ headless, args: chromeArgs }),
  chrome: () => chromium.launch({ headless, channel: 'chrome', args: chromeArgs }),
  msedge: () => chromium.launch({ headless, channel: 'msedge', args: chromeArgs }),
  firefox: () => firefox.launch({ headless, firefoxUserPrefs: firefoxPrefs }),
  // -wait-for-browser: on Windows the stock firefox.exe is a launcher that hands off and exits.
  'moz-firefox': () => firefox.launch({ headless, channel: 'moz-firefox', firefoxUserPrefs: firefoxPrefs, args: win ? ['-wait-for-browser'] : [],
    ...(win ? {} : { executablePath: '/usr/bin/firefox' }) }),
  webkit: () => webkit.launch({ headless }),
};

const glInfo = () => {
  const out = {};
  for (const kind of ['webgl2', 'webgl']) {
    const gl = document.createElement('canvas').getContext(kind);
    if (!gl) { out[kind] = null; continue; }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    out[kind] = {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
  }
  return out;
};

const fps = (ms) => new Promise((resolve) => {
  let n = 0, worst = 0, last = performance.now();
  const t0 = last;
  const tick = (t) => {
    n++; worst = Math.max(worst, t - last); last = t;
    if (t - t0 < ms) requestAnimationFrame(tick);
    else resolve({ fps: +(n * 1000 / (t - t0)).toFixed(1), worstFrameMs: Math.round(worst) });
  };
  requestAnimationFrame(tick);
});

const results = [];
for (const name of which) {
  const r = { browser: name, ok: false, errors: [] };
  results.push(r);
  let browser;
  try {
    browser = await engines[name]();
    r.version = browser.version();
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('console', (m) => { if (m.type() === 'error') r.errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => r.errors.push(`pageerror: ${e.message}`.slice(0, 300)));
    const t0 = Date.now();
    await page.goto(URL_BASE, { waitUntil: 'load', timeout: 180000 });
    await page.waitForTimeout(8000);
    r.menuLoadMs = Date.now() - t0;
    r.gl = await page.evaluate(glInfo);
    await page.screenshot({ path: path.join(OUT, `${name}-menu.png`) });

    const sep = URL_BASE.includes('?') ? '&' : '?';
    const t1 = Date.now();
    await page.goto(`${URL_BASE}${sep}autostart=1&seed=1234`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__game?.world?.tick > 40, null, { timeout: 300000, polling: 1000 });
    r.matchStartMs = Date.now() - t1;
    await page.waitForTimeout(5000);
    r.frames = await page.evaluate(fps, 10000);
    r.game = await page.evaluate(() => {
      const g = window.__game;
      const info = g?.gfx?.renderer?.info?.render;
      return { tick: g?.world?.tick, quality: g?.setup?.quality, drawCalls: info?.calls, triangles: info?.triangles,
        canvas: (() => { const c = document.querySelector('canvas'); return c ? `${c.width}x${c.height}` : null; })() };
    });
    await page.screenshot({ path: path.join(OUT, `${name}-skirmish.png`) });
    r.ok = true;
  } catch (e) {
    r.failure = String(e?.message ?? e).split('\n')[0];
  } finally {
    await browser?.close().catch(() => {});
  }
  console.log(JSON.stringify(r));
}
fs.writeFileSync(path.join(OUT, 'smoke.json'), JSON.stringify({ url: URL_BASE, platform: process.platform, headless, chromeArgs, firefoxPrefs, results }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
