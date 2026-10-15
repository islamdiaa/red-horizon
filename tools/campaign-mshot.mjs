// Same as shot.mjs with a long screenshot timeout (storm scenes under SwiftShader). Usage: node tools/campaign-mshot.mjs <url> <out.png> [waitMs=4000] [width=1600] [height=900] [evalJs]
// Takes a screenshot of a page with headless Chromium (SwiftShader WebGL) and prints console errors.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [url, out, waitMs = '4000', w = '1600', h = '900', evalJs] = process.argv.slice(2);
if (!url || !out) { console.error('usage: shot.mjs <url> <out.png> [waitMs] [w] [h] [evalJs]'); process.exit(1); }
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(here, 'nsslibs/lib') },
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || process.env.ALLLOG) console.log(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
if (evalJs) { await page.waitForTimeout(500); console.log('eval:', await page.evaluate(evalJs)); }
await page.waitForTimeout(+waitMs);
await page.screenshot({ path: out, timeout: 240000 });
console.log('saved', out);
await browser.close();
