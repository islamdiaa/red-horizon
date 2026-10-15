// QA repro: start a skirmish from the real main menu (default settings) and check the first frames render.
// node tools/qa/menu_start.mjs [extra query string]
import { launch, shot, sleep, BASE } from './browser.mjs';
const { browser, page, errors } = await launch();
await page.goto(BASE + (process.argv[2] ?? ''), { waitUntil: 'load' });
await page.waitForSelector('.main-screen .deploy', { timeout: 120000 });
await sleep(2000);
console.log('errors on menu:', errors.length, errors.slice(0, 3));
await page.click('.main-screen .deploy');
await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo, null, { timeout: 180000 });
await sleep(4000);
await page.keyboard.press('Space');
await sleep(5000);
const info = await page.evaluate(() => {
  const g = window.__game;
  return { t: g.world.time, wx: g.gfx.weather.kind, hours: g.hours, setup: { q: g.setup.quality, wx: g.setup.weather, cyc: g.setup.dayCycle, clim: g.setup.climate, tod: g.setup.timeOfDay, seed: g.setup.seed }, cards: document.querySelectorAll('.bitem').length, glLost: g.gfx.renderer.getContext().isContextLost(), clock: document.querySelector('.tb-time')?.textContent };
});
console.log(JSON.stringify(info));
await shot(page, 'menu-start');
console.log('errors:', errors.length);
for (const e of [...new Set(errors)].slice(0, 8)) console.log('  ', e.slice(0, 700));
await browser.close();
