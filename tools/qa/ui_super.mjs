// QA: superweapon targeting UI (A-Bomb, Chronoshift as Allies; Iron Curtain as Soviets) with real clicks.
// scenario=base is under-powered (debug.ts BASES), so extra Advanced Power Plants are added first.
// node tools/qa/ui_super.mjs [allies|soviet]
import { launch, shot, sleep, BASE, report, waitGame, toasts, toScreen } from './browser.mjs';
const faction = process.argv[2] ?? 'allies';
const { browser, page, errors } = await launch({ width: 1280, height: 720 });
await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now()))); });
await page.goto(BASE + `?autostart=1&size=64&units=light&fog=1&scenario=base&seed=4321&faction=${faction}`, { waitUntil: 'load' });
await waitGame(page);
await sleep(2000);
const evalG = (fn, a) => page.evaluate(fn, a);
async function settle() {
  const t0 = await page.evaluate(() => window.__game.world.tick);
  await page.waitForFunction((t) => window.__game.world.tick >= t + 2, t0, { timeout: 90000, polling: 50 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
const power0 = await evalG(() => `${window.__game.local.powerOut}/${window.__game.local.powerUse}`);
await evalG(() => {
  const g = window.__game, w = g.world, p = g.local, f = w.buildings.find((b) => b.owner === p && b.bt.id === 'fact');
  let n = 0;
  for (let r = 3; r < 20 && n < 4; r++) for (let dy = -r; dy <= r && n < 4; dy++) for (let dx = -r; dx <= r && n < 4; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (w.canPlace(p, 'apwr', f.cx + dx, f.cy + dy)) { w.addBuilding('apwr', p, f.cx + dx, f.cy + dy, true); n++; }
  }
});
await evalG(() => window.__game.fastForward(15));
await settle(); await settle(); await sleep(3000);
const info = await evalG(() => { const g = window.__game; return { power: `${g.local.powerOut}/${g.local.powerUse}`, supers: [...document.querySelectorAll('.supers .super')].map((b) => `${b.dataset.kind}:${b.querySelector('small')?.textContent}`) }; });
console.log(`power ${power0} -> ${info.power}; superweapons: ${info.supers.join(' | ')}`);
await shot(page, `super-${faction}-panel`);
const clickMap = async (x, y, name) => {
  await evalG(([x, y]) => window.__game.gfx.cam.jumpTo(x, y), [x, y]);
  await sleep(1500);
  const sp = await toScreen(page, x, y);
  await page.mouse.move(sp.x, sp.y, { steps: 3 });
  await sleep(700);
  if (name) await shot(page, name);
  await page.mouse.click(sp.x, sp.y);
  await settle();
};
if (faction === 'allies') {
  await evalG(() => window.__game.selection.clear());
  await page.locator('.supers .sw-chrono').click();
  await sleep(600);
  const t1 = await toasts(page);
  report('Chronoshift with nothing selected tells the player to select a vehicle', t1.some((t) => /vehicle/i.test(t)), t1.slice(-2).join(' | '));
  const tank = await evalG(() => { const g = window.__game; const t = g.world.units.find((u) => u.owner === g.local && u.kind === 'vehicle' && !u.ut.harvester); g.selection.clear(); g.selection.add(t.id); return { id: t.id, x: t.x, y: t.y }; });
  await page.locator('.supers .sw-chrono').click();
  await sleep(500);
  report('Ready Chronoshift enters targeting mode', (await evalG(() => window.__game.input.mode)) === 'super');
  const tgt = await evalG(() => { const g = window.__game; const m = g.world.map; for (let y = 4; y < m.h - 4; y += 2) for (let x = 4; x < m.w - 4; x += 2) if (!g.local.explored[m.idx(x, y)] && m.passable(x, y)) return [x + 0.5, y + 0.5]; return null; });
  await clickMap(tgt[0], tgt[1], 'super-chrono-target-shroud');
  const pos = await evalG((id) => { const u = window.__game.world.getEntity(id); return [u.x, u.y]; }, tank.id);
  console.log(`chrono into never-explored shroud ${tgt}: tank now at ${pos.map((v) => v.toFixed(1))} (allowed=${Math.hypot(pos[0] - tgt[0], pos[1] - tgt[1]) < 1})`);
  await shot(page, 'super-chrono-after');
}
// nuke (both factions have a Missile Silo in scenario=base)
const foe = await evalG(() => { const g = window.__game; const b = g.world.buildings.find((b) => g.local.isEnemy(b.owner) && b.bt.id === 'fact'); return [b.x, b.y, !!g.local.explored[g.world.map.idx(Math.floor(b.x), Math.floor(b.y))]]; });
console.log('enemy yard explored:', foe[2]);
await page.locator('.supers .sw-nuke').click();
await sleep(500);
await clickMap(foe[0], foe[1], 'super-nuke-target');
report('Nuke launches at an unexplored enemy base', await evalG(() => window.__game.world.projectiles.some((p) => p.special === 'nuke')));
await evalG(() => window.__game.fastForward(9));
await sleep(2500);
await shot(page, 'super-nuke-impact');
if (faction === 'soviet') {
  await page.locator('.supers .sw-ironcurtain').click();
  await sleep(500);
  const own = await evalG(() => { const g = window.__game; const b = g.world.buildings.find((b) => b.owner === g.local && b.bt.id === 'fact'); return [b.x + 6, b.y + 6]; });
  const ch0 = await evalG(() => window.__game.local.superCharge.ironcurtain);
  await clickMap(own[0], own[1], 'super-iron-empty');
  const ch1 = await evalG(() => window.__game.local.superCharge.ironcurtain);
  console.log(`Iron Curtain clicked on empty ground: charge ${ch0.toFixed(0)} -> ${ch1.toFixed(0)}; toasts: ${(await toasts(page)).slice(-2).join(' | ')}`);
}
// targeting outside the map (horizon)
console.log('errors', errors);
await browser.close();
