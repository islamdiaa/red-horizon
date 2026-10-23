// Where the loading time goes on a slow machine: the time to the menu, then a match started from the menu (Quick
// Battle) with every loading-screen stage timestamped (the label and bar of #loading, watched from inside the page) and
// the long tasks in between. A stage that holds the main thread for a long time freezes the loading bar, and a browser
// may offer to close a page that does not answer for that long.
//   node tools/xb/vmload.mjs <browser> [runs=1]          (tools/lab/lab.sh run <vm> tools/xb/vmload.mjs chrome)
import fs from 'node:fs';
import { launch, sleep, GAME_URL, OUT, watch } from './vmlib.mjs';

const [name = 'chromium', runsArg = '1'] = process.argv.slice(2);
const browser = await launch(name);
const out = { browser: name, version: browser.version(), runs: [] };
for (let k = 0; k < +runsArg; k++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('rh.settings', JSON.stringify({ quality: 'low', skipIntro: true, fullscreen: false }));
    const t0 = performance.now();
    window.__ld = { stages: [], long: [] };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ld.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch { /* not supported */ }
    let last = '';
    const poll = () => {
      const l = document.getElementById('loading');
      const s = l ? `${getComputedStyle(l).display === 'none' ? 'hidden' : 'shown'} | ${l.querySelector('.label')?.textContent ?? ''} | ${(l.querySelector('.bar div'))?.style.width ?? ''}` : 'none';
      if (s !== last) { window.__ld.stages.push([Math.round(performance.now() - t0), s]); last = s; }
    };
    // a MutationObserver fires as soon as the main thread is free again: the gap between two records is the freeze
    new MutationObserver(poll).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    setInterval(poll, 250);
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(900000);
  const log = watch(page);
  const t0 = Date.now();
  await page.goto(GAME_URL, { waitUntil: 'load', timeout: 900000 });
  await page.waitForSelector('.mm-nav-btn', { state: 'visible', timeout: 900000 });
  const menuMs = Date.now() - t0;
  await sleep(3000);
  const t1 = Date.now();
  await page.locator('.mm-nav-btn[data-nav="quick"]').click();
  await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo && getComputedStyle(document.getElementById('loading')).display === 'none', null, { timeout: 900000, polling: 500 });
  const matchMs = Date.now() - t1;
  const ld = await page.evaluate(() => window.__ld);
  const run = { menuMs, matchMs, stages: ld.stages.slice(-40), longest: [...ld.long].sort((a, b) => b[1] - a[1]).slice(0, 8), longTotalMs: ld.long.reduce((a, l) => a + l[1], 0), errors: log.slice(0, 5) };
  out.runs.push(run);
  console.log(JSON.stringify({ menuMs, matchMs, longest: run.longest.slice(0, 4) }));
  await ctx.close();
}
fs.writeFileSync(`${OUT}/vmload-${name}.json`, JSON.stringify(out, null, 1));
await browser.close();
