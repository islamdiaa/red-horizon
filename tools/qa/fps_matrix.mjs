// QA probe: render cost by setup (autostart variants). node tools/qa/fps_matrix.mjs
import { launch, sleep, BASE } from './browser.mjs';
const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['size=64&wx=clear', 'size=96&wx=clear', 'size=64&wx=auto&cycle=1', 'size=96&wx=auto&cycle=1', 'size=96&wx=clear&q=low', 'size=96&wx=rain', 'size=96&wx=snow'];
for (const v of variants) {
  const { browser, page, errors } = await launch();
  await page.goto(BASE + '?autostart=1&units=light&fog=1&' + v, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.hud, null, { timeout: 180000 });
  await sleep(6000);
  const r = await page.evaluate(() => new Promise((res) => {
    const g = window.__game; const t0 = performance.now(), w0 = g.world.time; let n = 0;
    const f = () => { n++; if (performance.now() - t0 < 8000) requestAnimationFrame(f); else res({ fps: (n / 8).toFixed(1), simRate: ((g.world.time - w0) / 8).toFixed(2), wx: g.gfx.weather.kind, calls: g.gfx.stats.calls, tris: g.gfx.stats.tris }); };
    requestAnimationFrame(f);
  }));
  console.log(v.padEnd(28), JSON.stringify(r), errors.length ? errors[0] : '');
  await browser.close();
}
