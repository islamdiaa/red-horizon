// Capture a sequence of frames from a page (attract mode, trailer, clips) with headless Chromium.
//   node tools/release/frames.mjs <url> <outPrefix> [count=6] [everyMs=4000] [startMs=8000] [w=1280] [h=720] [hideUi=1]
// Prints the director's current shot with each frame (window.__game.cameraDirector).
import { chromium } from 'playwright';
import path from 'node:path';
import { root } from './relative-build.mjs';

const [url, prefix, count = '6', every = '4000', start = '8000', w = '1280', h = '720', hideUi = '1'] = process.argv.slice(2);
if (!url || !prefix) { console.error('usage: frames.mjs <url> <outPrefix> [count] [everyMs] [startMs] [w] [h] [hideUi]'); process.exit(1); }
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
});
try {
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /director|attract|share|clip|trailer/i.test(m.text()))) console.log(`[${m.type()}] ${m.text()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  if (hideUi === '1') await page.addStyleTag({ content: '.sub-screen, .mm, .mm-layout, #ui, .menu-root, body > .screen { visibility: hidden !important; }' });
  await page.waitForTimeout(+start);
  for (let i = 0; i < +count; i++) {
    const info = await page.evaluate(() => {
      const g = window.__game;
      const d = g?.cameraDirector;
      return d ? `${d.current?.name ?? '-'} t=${d.shotTime?.toFixed(1)} loops=${d.loops} fade=${d.fade?.toFixed(2)} units=${g.world.units.filter((u) => u.alive).length} calls=${g.gfx.stats.calls}` : (g ? 'no director' : 'no game');
    }).catch((e) => `eval failed: ${e.message}`);
    const out = `${prefix}-${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: out, timeout: 180000 });
    console.log(out, info);
    if (i + 1 < +count) await page.waitForTimeout(+every);
  }
} finally {
  await browser.close();
}
