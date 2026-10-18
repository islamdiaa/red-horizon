// Startup audit (headless Chromium + SwiftShader): time to the main menu and to the menu's backdrop battle, and the
// script bytes downloaded before the menu, on an unthrottled link and on emulated 4G / 3G connections. Point it at
// production builds (`vite preview`, or any static server); several builds are measured interleaved, REPS times.
//   node tests/perf/startup.mjs <url[,url2...]> [profiles=none,4g,3g] [reps=3]
// Time to menu: navigation start -> the main menu is built and the loading screen is gone. Backdrop: the menu's
// battle canvas exists. Run tools/assets/memguard.sh first: one headless browser at a time.
import { launch } from './lib.mjs';

const [urlArg = 'http://localhost:5282/', profArg = 'none,4g,3g', repsArg = '3'] = process.argv.slice(2);
const PROFILES = {
  none: null,
  // Chrome DevTools' presets (throughput in bytes/s, latency in ms)
  '4g': { latency: 20, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (9 * 1024 * 1024) / 8 },
  '3g': { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
};

const browser = await launch();
try {
  for (const prof of profArg.split(',')) for (let rep = 0; rep < +repsArg; rep++) for (const url of urlArg.split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const poll = () => {
        const l = document.getElementById('loading');
        if (!window.__menuAt && document.querySelector('.mm-layout') && (!l || l.style.opacity === '0' || l.style.display === 'none')) window.__menuAt = performance.now();
        if (!window.__backdropAt && document.getElementById('game-canvas')) window.__backdropAt = performance.now();
        if (!window.__menuAt || !window.__backdropAt) requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (PROFILES[prof]) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...PROFILES[prof] });
    await page.goto(url, { waitUntil: 'commit', timeout: 240000 });
    await page.waitForFunction(() => window.__menuAt, null, { timeout: 240000, polling: 200 });
    const menu = await page.evaluate(() => {
      const at = window.__menuAt;
      const js = performance.getEntriesByType('resource').filter((e) => /\.m?js(\?|$)/.test(e.name));
      const before = js.filter((e) => e.responseEnd <= at);
      return { menuMs: Math.round(at), jsBeforeMenuKB: Math.round(before.reduce((s, e) => s + (e.transferSize || e.encodedBodySize), 0) / 1024), jsFilesBeforeMenu: before.length };
    });
    const backdropMs = await page.waitForFunction(() => window.__backdropAt, null, { timeout: 240000, polling: 200 }).then(() => page.evaluate(() => Math.round(window.__backdropAt)), () => null);
    console.log(JSON.stringify({ build: url, profile: prof, rep, ...menu, backdropMs, errors: errors.length ? errors.slice(0, 3) : undefined }));
    await ctx.close();
  }
} finally {
  await browser.close();
}
