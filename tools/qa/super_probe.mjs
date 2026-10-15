// QA probe: superweapon state in the soviet base scenario after adding power.
import { launch, sleep, BASE, waitGame } from './browser.mjs';
const { browser, page } = await launch({ width: 1280, height: 720 });
await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now()))); });
await page.goto(BASE + '?autostart=1&size=64&units=light&fog=1&scenario=base&seed=4321&faction=soviet', { waitUntil: 'load' });
await waitGame(page);
await sleep(1500);
const snap = (l) => page.evaluate((l) => { const g = window.__game, p = g.local; return `${l}: faction=${p.faction} power ${p.powerOut}/${p.powerUse} low=${p.lowPower} charge=${JSON.stringify(Object.fromEntries(Object.entries(p.superCharge).map(([k, v]) => [k, +v.toFixed(1)])))} supersDom=${[...document.querySelectorAll('.supers .super')].map((b) => b.dataset.kind + ':' + b.querySelector('small')?.textContent).join(',')} t=${g.world.time.toFixed(1)}`; }, l);
console.log(await snap('start'));
const added = await page.evaluate(() => {
  const g = window.__game, w = g.world, p = g.local, f = w.buildings.find((b) => b.owner === p && b.bt.id === 'fact');
  const out = [];
  for (let r = 3; r < 20 && out.length < 4; r++) for (let dy = -r; dy <= r && out.length < 4; dy++) for (let dx = -r; dx <= r && out.length < 4; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (w.canPlace(p, 'apwr', f.cx + dx, f.cy + dy)) { const b = w.addBuilding('apwr', p, f.cx + dx, f.cy + dy, true); out.push(b.id); }
  }
  return out;
});
console.log('added apwr', added);
console.log(await snap('after add'));
await page.evaluate(() => window.__game.fastForward(15));
console.log(await snap('after ff15'));
await sleep(3000);
console.log(await snap('3s later'));
await browser.close();
