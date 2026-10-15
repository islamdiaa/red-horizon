// Screenshot after pointing the camera at something chosen in the running game.
// Usage: node tools/focus-shot.mjs <url> <out.png> "<js expression on g returning [x, y, dist] or null>" [waitMs=8000] [prepJs]
// Example: "(() => { const u = g.world.units.find((u) => u.kind === 'naval'); return u && [u.x, u.y, 14]; })()"
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [url, out, expr, waitMs = '8000', prep] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(here, 'nsslibs/lib') },
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.hud, null, { timeout: 240000 });
if (prep) console.log('prep:', await page.evaluate(`(() => { const g = window.__game; return ${prep}; })()`));
await page.waitForTimeout(2000);
const at = await page.evaluate(`(() => { const g = window.__game; return ${expr}; })()`);
console.log('focus', at);
if (at) await page.evaluate(([x, y, d]) => { const c = window.__game.gfx.cam; c.jumpTo(x, y); if (d) c.dist = c.targetDist = d; }, at);
await page.waitForTimeout(+waitMs);
await page.screenshot({ path: out });
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
