// [META] Scripted browser screenshots (copy of modes-shot.mjs) plus --clip "<selector>" <out.png> (element shot) and --scale <n> (device scale, before the url).
// Usage: node tools/modes-shot.mjs <url> [steps...]
//   --wait <ms>            sleep
//   --waitfor "<js>"       wait (up to 10 min) until the expression is truthy
//   --eval "<js>"          evaluate in the page (print the result)
//   --click "<selector>"   click an element
//   --key "<key>"          press a key
//   --shot <out.png>       screenshot (up to 10 min)
//   --goto <url>           navigate (same browser context: IndexedDB / localStorage persist)
//   --size <w>x<h>         viewport (before the url loads: put it first)
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let w = 1600, h = 900, scale = 1;
if (args[0] === '--scale') { scale = +args[1]; args.splice(0, 2); }
if (args[0] === '--size') { [w, h] = args[1].split('x').map(Number); args.splice(0, 2); }
const url = args.shift();
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(here, 'nsslibs/lib') },
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message, (e.stack ?? '').split('\n').slice(0, 4).join(' | ')); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('[error]', m.text()); } });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
await page.goto(url, { waitUntil: 'load', timeout: 300000 });
log('loaded');
for (let i = 0; i < args.length; i++) {
  const a = args[i], v = args[i + 1];
  if (a === '--wait') { await page.waitForTimeout(+v); i++; }
  else if (a === '--waitfor') { await page.waitForFunction(v, null, { timeout: 600000, polling: 1000 }); log('ready:', v.slice(0, 60)); i++; }
  else if (a === '--eval') { log('eval:', JSON.stringify(await page.evaluate(v))?.slice(0, 400)); i++; }
  else if (a === '--click') { await page.click(v, { timeout: 120000 }); log('clicked', v); i++; }
  else if (a === '--key') { await page.keyboard.press(v); log('key', v); i++; }
  else if (a === '--goto') { await page.goto(v, { waitUntil: 'load', timeout: 300000 }); log('goto', v); i++; }
  else if (a === '--clip') { await page.locator(v).first().screenshot({ path: args[i + 2], timeout: 600000 }); log('clip', args[i + 2]); i += 2; }
  else if (a === '--shot') { await page.screenshot({ path: v, timeout: 600000 }); log('saved', v); i++; }
}
log('errors:', errors.length ? errors.slice(0, 6) : 'none');
await browser.close();
