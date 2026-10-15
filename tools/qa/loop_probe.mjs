// QA probe: is Game.frame running after a menu start? Reads Game internals over time.
import { launch, sleep, BASE } from './browser.mjs';
const { browser, page, errors } = await launch();
await page.goto(BASE + (process.argv[2] ?? ''), { waitUntil: 'load' });
await page.waitForSelector('.main-screen .deploy', { timeout: 120000 });
await sleep(1500);
await page.click('.main-screen .deploy');
await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo, null, { timeout: 180000 });
const snap = (label) => page.evaluate((label) => { const g = window.__game; return `${label}: time=${g.time.toFixed(2)} acc=${g.acc.toFixed(3)} last=${g.last.toFixed(0)} now=${performance.now().toFixed(0)} paused=${g.paused} running=${g.running} raf=${g.raf} world.t=${g.world.time.toFixed(2)} cine=${document.body.classList.contains('cine-active')} loadingDisplay=${getComputedStyle(document.getElementById('loading')).display} hidden=${document.hidden} vis=${document.visibilityState}`; }, label);
for (let k = 0; k < 4; k++) { console.log(await snap('intro ' + k)); await sleep(3000); }
await page.keyboard.press('Space');
for (let k = 0; k < 6; k++) { await sleep(3000); console.log(await snap('after skip ' + k)); }
console.log('errors', errors);
await browser.close();
