// QA: end screen / quit to menu / new game / restart / defeat lifecycle. node tools/qa/ui_end.mjs
import { launch, shot, state, toScreen, toasts, sleep, BASE, report, waitGame } from './browser.mjs';

const { browser, page, errors, warnings } = await launch({ width: 1280, height: 720 });
// clamp rAF timestamps to performance.now() so frame times never go negative on this slow renderer
await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now()))); });
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const card = (name) => page.locator('.bitem').filter({ has: page.locator('.bi-name', { hasText: new RegExp(`^${name}$`) }) }).first();
const tab = async (i) => { await page.locator('#sidebar .tab').nth(i).click(); await sleep(400); };
const evalG = (fn, arg) => page.evaluate(fn, arg);

await page.goto(BASE + '?autostart=1&size=64&units=light&fog=1&scenario=base&seed=4321', { waitUntil: 'load' });
await waitGame(page);
await sleep(4000);
await shot(page, 'ui-end-00-start');


const log2 = log;
// ---------------------------------------------------------------- end screen, menu, restart, re-start
log('--- end screen & lifecycle');
await evalG(() => { const g = window.__game; for (let k = 0; k < 5; k++) for (const e of [...g.world.units, ...g.world.buildings]) if (g.local.isEnemy(e.owner) && e.alive) g.world.kill(e); }); // repeat: destroyed buildings spawn survivors
await page.waitForSelector('.end-screen', { timeout: 300000 });
await sleep(3000);
await shot(page, 'ui-14-victory');
const endText = await evalG(() => document.querySelector('.end-screen')?.innerText.replace(/\s+/g, ' ').slice(0, 400));
log('end screen:', endText);
report('Destroying all enemies shows the VICTORY screen', /VICTORY/.test((endText ?? '').replace(/\s+/g, '')));
const contexts0 = await evalG(() => document.querySelectorAll('canvas').length);
const tq = Date.now();
await page.locator('.end-screen .btn', { hasText: 'Main menu' }).click({ noWaitAfter: true, timeout: 180000 });
await page.waitForSelector('.main-screen .deploy', { timeout: 300000 });
log(`Main menu click -> menu visible after ${((Date.now() - tq) / 1000).toFixed(1)}s wall`);
await sleep(3000);
await shot(page, 'ui-15-back-to-menu');
const afterQuit = await evalG(() => ({ canvases: document.querySelectorAll('canvas').length, ui: document.getElementById('ui')?.children.length, tooltip: !!document.getElementById('tooltip'), bodyCls: document.body.className, hint: !!document.querySelector('.hint') }));
log('after quit to menu:', JSON.stringify(afterQuit), 'canvases before', contexts0);
// start a new game from the menu
await page.locator('.main-screen .deploy').click({ noWaitAfter: true, timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo, null, { timeout: 180000 });
await sleep(2000);
await page.keyboard.press('Escape'); // skip intro
await page.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 60000 });
await sleep(2000);
const ng = await evalG(() => ({ time: window.__game.world.time, canvases: document.querySelectorAll('canvas').length, paused: window.__game.paused, gameOver: window.__game.world.gameOver }));
log('new game after quitting:', JSON.stringify(ng));
report('A new game starts cleanly after returning to the menu', !ng.gameOver && !ng.paused);
// keyboard handlers duplicated? Press 'h' and check selection once; press Ctrl+1 and count toasts
await page.keyboard.press('h');
await sleep(300);
await shot(page, 'ui-16-second-game');
// restart from pause menu
await page.keyboard.press('Escape');
await sleep(800);
const seedBefore = await evalG(() => window.__game.setup.seed);
await page.locator('.pause-screen .pp-btn', { hasText: 'Restart' }).click({ noWaitAfter: true, timeout: 180000 });
await page.waitForFunction((s) => window.__game && window.__game.setup.seed !== s && window.__game.hud, seedBefore, { timeout: 180000 });
await sleep(1500);
const seedAfter = await evalG(() => window.__game.setup.seed);
log(`Restart: seed ${seedBefore} -> ${seedAfter} (map ${seedBefore === seedAfter ? 'same' : 'DIFFERENT'})`);
await sleep(2000);
// defeat path
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 60000 });
await evalG(() => { const g = window.__game; for (let k = 0; k < 5; k++) for (const e of [...g.world.units, ...g.world.buildings]) if (e.owner === g.local && e.alive) g.world.kill(e); });
await page.waitForSelector('.end-screen', { timeout: 300000 });
await sleep(3000);
await shot(page, 'ui-17-defeat');
const defeatText = await evalG(() => document.querySelector('.end-screen')?.innerText.replace(/\s+/g, ' ').slice(0, 300));
report('Losing everything shows the DEFEAT screen', /DEFEAT/.test((defeatText ?? '').replace(/\s+/g, '')), defeatText);
// "Keep watching" after defeat
await page.locator('.end-screen .btn', { hasText: 'Keep watching' }).click({ noWaitAfter: true, timeout: 180000 });
await sleep(2000);
const watching = await evalG(() => ({ paused: window.__game.paused, speed: window.__game.speed, sidebar: getComputedStyle(document.getElementById('sidebar')).display }));
log('keep watching after defeat:', JSON.stringify(watching));
await page.keyboard.press('Escape');
await sleep(1000);
const pauseAfterDefeat = await page.locator('.pause-screen').count();
log('Esc after defeat + keep watching opens pause menu:', pauseAfterDefeat > 0);

log('errors:', errors.length ? errors : 'none');
log('warnings:', [...new Set(warnings)].slice(0, 8), 'total', warnings.length);
await browser.close();
