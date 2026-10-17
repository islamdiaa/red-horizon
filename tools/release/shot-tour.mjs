// Tour a camera director's program (attract mode / trailer) and screenshot every shot, for review.
//   node tools/release/shot-tour.mjs <url> <outPrefix> [simSpeed=3] [settleMs=9000] [w=1280] [h=720] [hideUi=1] [only=a,b]
// Each shot is entered in order (so its staging runs), the simulation runs `simSpeed`× faster while it settles
// (SwiftShader renders slowly), then the frame is captured at the shot's midpoint pose.
import { chromium } from 'playwright';
import path from 'node:path';
import { root } from './relative-build.mjs';

const [url, prefix, simSpeed = '3', settle = '9000', w = '1280', h = '720', hideUi = '1', only = ''] = process.argv.slice(2);
if (!url || !prefix) { console.error('usage: shot-tour.mjs <url> <outPrefix> [simSpeed] [settleMs] [w] [h] [hideUi] [only]'); process.exit(1); }
const want = only ? new Set(only.split(',')) : null;
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
});
try {
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /director|attract|share|clip|trailer/i.test(m.text()))) console.log(`[${m.type()}] ${m.text()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  if (hideUi === '1') await page.addStyleTag({ content: '.sub-screen, .mm, .mm-layout, #ui, .tr-gate, body > .screen { visibility: hidden !important; }' });
  await page.waitForFunction(() => !!window.__game?.cameraDirector, null, { timeout: 180000 });
  const n = await page.evaluate(() => window.__game.cameraDirector.shots.length);
  for (let i = 0; i < n; i++) {
    // enter shot i (runs its begin and the next shot's staging), hold it at the midpoint while the battle runs
    const name = await page.evaluate(([i, sp]) => {
      const d = window.__game.cameraDirector;
      d.baseSpeed = sp;
      if (d.index !== i) { d.index = i - 1; d.shotTime = 1e9; d.update(0.016); }
      return d.current?.name ?? '-';
    }, [i, +simSpeed]);
    if (want && !want.has(name)) continue;
    await page.waitForTimeout(+settle);
    const info = await page.evaluate(() => {
      const g = window.__game, d = g.cameraDirector;
      d.shotTime = Math.min(d.shotTime, (d.current?.dur ?? 2) * 0.5);
      return `${d.current?.name} index=${d.index} t=${d.shotTime.toFixed(1)} units=${g.world.units.filter((u) => u.alive).length} ships=${g.world.units.filter((u) => u.alive && u.kind === 'naval').length} calls=${g.gfx.stats.calls}`;
    });
    await page.waitForTimeout(1500);
    const out = `${prefix}-${String(i).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: out, timeout: 180000 });
    console.log(out, info);
  }
} finally {
  await browser.close();
}
