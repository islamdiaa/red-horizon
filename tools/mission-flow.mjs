// Browser check of a mission's start → win → debrief flow.
// Usage: node tools/mission-flow.mjs <baseUrl> <missionId> <outPrefix> [win|lose]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [base, id, out, outcome = 'win'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(here, 'nsslibs/lib') },
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}/?autostart=1&mission=${id}&intro=0&q=medium`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.hud, null, { timeout: 240000 });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}-start.png` });
console.log('objective chip:', await page.evaluate(() => document.querySelector('.tb-obj .obj-txt b')?.textContent));
await page.evaluate((o) => { const m = window.__game.world.mission; if (o === 'win') m.win(); else m.lose('Test defeat'); }, outcome);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}-finale.png` });
// the 4.5 s finale counts real frames; software rendering crawls, so cut it short
await page.evaluate(() => { const g = window.__game; if (g.endTimer > 0.05) g.endTimer = 0.05; });
await page.waitForFunction(() => document.querySelector('.dbf'), null, { timeout: 120000 }).catch(() => console.log('no debrief element found'));
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}-debrief.png` });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
