// Conquest UI screenshots (CDP capture; SwiftShader paints the SVG map slowly, so allow a minute or two per shot).
//   node tools/conq-shot.mjs <url> <out.png> [waitMs=7000] [w=1600] [h=900] [action ...]
// actions: a CSS selector to click, wait:<ms>, key:<Key>, eval:<js>, waitfor:<selector>, noanim (jump CSS animations to their end)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [url, out, waitMs = '7000', w = '1600', h = '900', ...actions] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(here, 'nsslibs/lib') },
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => { if (m.type() === 'error' || process.env.ALLLOG) console.log(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForTimeout(+waitMs);
for (const a of actions) {
  if (a.startsWith('wait:')) await page.waitForTimeout(+a.slice(5));
  else if (a.startsWith('key:')) { await page.keyboard.press(a.slice(4)); await page.waitForTimeout(800); }
  else if (a.startsWith('eval:')) console.log('eval:', await page.evaluate(a.slice(5)));
  else if (a.startsWith('waitfor:')) await page.waitForSelector(a.slice(8), { timeout: 120000, state: 'attached' });
  else if (a === 'noanim') await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}' });
  else { await page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, a); await page.waitForTimeout(1200); }
}
const cdp = await page.context().newCDPSession(page);
const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
console.log('saved', out, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
await browser.close();
