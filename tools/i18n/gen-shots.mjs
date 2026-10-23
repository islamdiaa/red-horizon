// Generated names on screen: opens the Conquest map, army and battle preview (a mid-campaign run) and the Rivals
// board in one language, screenshots them and lists the Latin-script words left on screen (for ru / zh-CN, where
// generated English stands out).
//
//   node --import tsx tools/i18n/gen-shots.mjs [--url http://127.0.0.1:5316/] [--lang ru] [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import { openBrowser, ROOT, sleep } from '../e2e/lib.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const url = opt('url', 'http://127.0.0.1:5316/');
const lang = opt('lang', 'ru');
const out = path.join(opt('out', path.join(ROOT, 'screenshots/l10n-gen')), lang);
fs.mkdirSync(out, { recursive: true });

const browser = await openBrowser({ browser: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript((l) => { try { localStorage.setItem('rh.lang', l); localStorage.setItem('rh.seenIntro', '1'); } catch { /* */ } }, lang);
const page = await ctx.newPage();
const report = [];
const latin = async (name) => {
  const text = await page.evaluate(() => document.body.innerText);
  const words = [...new Set((text.match(/[A-Za-z][A-Za-z'.-]+(?: [A-Za-z][A-Za-z'.-]+)*/g) ?? []).filter((w) => w.length > 2))];
  report.push(`[${name}] ${words.join(' | ')}`);
};
const shot = async (name) => { await page.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => {}); await latin(name); };

for (const [name, q] of [['conquest-map', '?conquest=mid&turns=8&seed=1953'], ['conquest-army', '?conquest=mid&turns=8&seed=1953&cqdemo=army'], ['conquest-preview', '?conquest=mid&turns=8&seed=1953&cqdemo=preview'], ['conquest-map-soviet', '?conquest=mid&turns=5&seed=77&faction=soviet']]) {
  await page.goto(url + q, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cq-ttl, .cq-big, .cq-modal, .cq-root', { timeout: 120000 }).catch(() => {});
  await sleep(4000);
  await shot(name);
}
// the Rivals board (a roster is generated on first open)
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.mm-nav-btn', { timeout: 120000 }).catch(() => {});
await sleep(2000);
await page.evaluate(async () => { const m = await import('/src/ui/rivals.ts'); m.showRivals({ onBack() {} }); }).catch((e) => report.push(`rivals: ${e}`));
await sleep(2500);
await shot('rivals');
fs.writeFileSync(path.join(out, 'latin.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
await browser.close();
