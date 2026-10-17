// Screenshots of the share flow: the editor's "Copy link" dialog, then opening that link (the import
// confirmation), plus a hostile link's refusal.
//   node tools/release/share-shots.mjs <baseUrl> <outPrefix>
import { chromium } from 'playwright';
import path from 'node:path';
import { root } from './relative-build.mjs';

const [base = 'http://127.0.0.1:5278/', prefix = '/tmp/rh-share'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
});
const ok = (c, m) => console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?demo=0`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('.mm-layout', { timeout: 180000 });
  // open the map editor from the menu, then Copy link
  await page.getByText('Map editor', { exact: false }).first().click();
  await page.waitForSelector('.ed', { timeout: 180000 });
  await page.waitForTimeout(3000);
  await page.getByText('Copy link', { exact: true }).first().click();
  await page.waitForSelector('.sh-panel input', { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${prefix}-dialog.png`, timeout: 180000 });
  const link = await page.$eval('.sh-panel input', (i) => i.value);
  const status = await page.$eval('.sh-status', (e) => e.textContent);
  ok(/#share=1\./.test(link), `link built (${link.length} chars): ${link.slice(0, 80)}…`);
  ok(/copied/i.test(status ?? ''), `copied to the clipboard (${status})`);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok(clip === link, 'clipboard holds the link');
  // open the link in a fresh tab: confirmation dialog
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(link.replace(/^[^#]*/, `${base}?demo=0`), { waitUntil: 'load', timeout: 120000 });
  await p2.waitForSelector('.sh-panel .sh-facts', { timeout: 180000 });
  await p2.waitForTimeout(800);
  await p2.screenshot({ path: `${prefix}-open.png`, timeout: 180000 });
  ok(!(await p2.evaluate(() => location.hash)), 'the fragment is removed from the address bar');
  await p2.getByText('Import', { exact: true }).click();
  await p2.waitForFunction(() => /Imported/.test(document.querySelector('.sh-status')?.textContent ?? ''), null, { timeout: 30000 });
  ok(true, 'imported into the map library');
  // a hostile link
  const p3 = await ctx.newPage();
  await p3.goto(`${base}?demo=0#share=1.PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg`, { waitUntil: 'load', timeout: 120000 });
  await p3.waitForSelector('.sh-panel .mx-note.bad', { timeout: 180000 });
  await p3.screenshot({ path: `${prefix}-hostile.png`, timeout: 180000 });
  ok(true, `hostile link refused: ${await p3.$eval('.sh-panel .mx-note.bad', (e) => e.textContent)}`);
  ok(errors.length === 0, `no page errors ${JSON.stringify(errors.slice(0, 3))}`);
} finally {
  await browser.close();
}
