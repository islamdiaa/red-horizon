// Screenshots of the campaign UI: node tools/campaign-shot.mjs <baseUrl> <outPrefix> [tab=allies|soviet|special|debrief-win|debrief-lose] [w] [h]
// Opens the menu (?demo=0), clicks "Campaign", optionally seeds progress and switches tab. For the debrief it imports
// the module through Vite and renders showDebrief with a sample result.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [base = 'http://localhost:5193', out = 'screenshots/campaign', mode = 'allies', w = '1600', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  env: { ...process.env, LD_LIBRARY_PATH: path.join(here, 'nsslibs/lib') },
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log(`[console] ${m.text()}`); });
const progress = process.env.PROGRESS ?? '';
await page.goto(`${base}/?demo=0${process.env.UNLOCK ? '&unlockall=1' : ''}`, { waitUntil: 'load', timeout: 60000 });
if (progress) {
  await page.evaluate((p) => { localStorage.setItem('rh.campaign', p); }, progress);
}
if (mode.startsWith('debrief')) {
  await page.waitForTimeout(1500);
  const won = mode === 'debrief-win';
  await page.evaluate(async ({ won, id }) => {
    const ui = await import('/src/ui/campaign.ts');
    const ms = await import('/src/missions/index.ts');
    const mis = await import('/src/sim/mission.ts');
    const def = ms.getMission(id);
    // a fake runtime snapshot so the objective list renders
    mis.MissionRuntime.current = { def, endReason: won ? null : 'Kestrel is down.', objectives: [
      { id: 'a', text: 'Destroy the power station so the Tesla Coils go dark', primary: true, state: 'done', progress: '3 / 3' },
      { id: 'b', text: 'Capture the Directorate laboratory with an Engineer', primary: true, state: won ? 'done' : 'active' },
      { id: 'c', text: 'Kestrel must survive', primary: true, state: won ? 'done' : 'failed' },
      { id: 'd', text: 'Free the Allied prisoners in the stockade', primary: false, state: 'done' },
      { id: 'e', text: 'Demolish both Tesla Coils', primary: false, state: won ? 'failed' : 'active' },
    ] };
    ui.showDebrief({ won, stars: won ? 2 : 0, time: won ? 371 : 288, score: 0 }, def, { onNext: () => {}, onRetry: () => {}, onMenu: () => {} });
  }, { won, id: process.env.MISSION ?? 'allied-03' });
  await page.waitForTimeout(+(process.env.WAIT ?? 4500));
} else {
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /campaign/i.test(x.textContent ?? ''));
    b?.click();
  });
  await page.waitForTimeout(800);
  if (mode !== 'allies') {
    await page.evaluate((t) => { document.querySelector(`[data-tab="${t}"]`)?.click(); }, mode);
    await page.waitForTimeout(600);
  }
  if (process.env.SELECT) {
    await page.evaluate((id) => { document.querySelector(`.node[data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, process.env.SELECT);
  }
  await page.waitForTimeout(+(process.env.WAIT ?? 3500));
}
const file = `${out}-${mode}.png`;
await page.screenshot({ path: file });
console.log('saved', file);
await browser.close();
