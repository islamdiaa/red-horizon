// QA: new-player experience -- the first ~5 game minutes from the real main menu, real mouse/keyboard for every action.
// node tools/qa/npe.mjs   (server on :5192)
// Harness notes:
//  * QA_SHIM (default on) clamps rAF timestamps to performance.now(), so a slow renderer never hands
//    Game.frame a timestamp older than the one it started from (QA_SHIM=0 runs without it).
//  * Waiting periods are skipped with __game.fastForward(2) chunks (events still processed) because SwiftShader runs at ~1-10 FPS.
import { launch, shot, state, toScreen, toasts, sleep, BASE, report } from './browser.mjs';

const W = 1280, H = 720;
const { browser, page, errors, warnings } = await launch({ width: W, height: H });
if (process.env.QA_SHIM !== '0') {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((ts) => cb(Math.max(ts, performance.now())));
  });
}
const t00 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t00) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const simTime = () => page.evaluate(() => window.__game?.world.time ?? 0);
const hint = () => page.evaluate(() => document.querySelector('.hint.on .hint-t')?.textContent ?? null);
const seenToasts = new Set();
async function pollToasts() { for (const t of await toasts(page)) if (!seenToasts.has(t)) { seenToasts.add(t); log('  toast:', t); } }
const card = (name) => page.locator('.bitem').filter({ has: page.locator('.bi-name', { hasText: new RegExp(`^${name}$`) }) }).first();
async function tab(i) { await page.locator('#sidebar .tab').nth(i).click(); await sleep(500); }
async function advance(simSec) { for (let s = 0; s < simSec; s += 2) { await page.evaluate(() => window.__game.fastForward(2)); await sleep(150); await pollToasts(); } }
async function settleCamera() { await page.waitForFunction(() => { const c = window.__game.gfx.cam; return !c.flyTo && Math.abs(c.dist - c.targetDist) < 0.5; }, null, { timeout: 60000, polling: 300 }).catch(() => {}); await sleep(500); }
const sidebarX = () => page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().x);

// 1. main menu
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.main-screen .deploy', { timeout: 120000 });
await sleep(2500);
await shot(page, 'npe-01-menu');

// 2. deploy with default settings (as a new player would)
await page.locator('.main-screen .deploy').click({ noWaitAfter: true, timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.hud && !window.__game.setup.demo, null, { timeout: 180000 });
log('game loaded');
await sleep(2500);
await shot(page, 'npe-02-intro');
const introT0 = Date.now();
await page.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 30000 }).catch(async () => { log('intro still running after 30s wall -> pressing Space'); await page.keyboard.press('Space'); });
log(`intro ended after ${((Date.now() - introT0) / 1000 + 2.5).toFixed(0)}s wall`);
await settleCamera();
await shot(page, 'npe-03-start');
log('hint:', await hint());
let st = await state(page);
log('state:', JSON.stringify(st));
const setup = await page.evaluate(() => { const g = window.__game; return { size: g.world.map.w, opp: g.setup.opponents, units: g.setup.startUnits, faction: g.local.faction, weather: g.gfx.weather.kind }; });
log('setup', JSON.stringify(setup));

// 3. deploy MCV by clicking it (it is pre-selected): classic click-again deploy
const mcvPos = await page.evaluate(() => { const g = window.__game; const u = g.world.units.find((u) => u.owner === g.local && u.ut.deploysInto); return [u.x, u.y]; });
const mp = await toScreen(page, mcvPos[0], mcvPos[1], 0.4);
log('MCV on screen at', JSON.stringify(mp));
report('MCV is visible on screen at game start', mp.onScreen && mp.x < (await sidebarX()));
await page.mouse.move(mp.x, mp.y, { steps: 5 });
await sleep(600);
log('cursor class hovering the selected MCV:', await page.evaluate(() => [...document.body.classList].filter((c) => c.startsWith('cur-')).join(',')));
await page.mouse.click(mp.x, mp.y);
await advance(2);
st = await state(page);
if (!report('Clicking the pre-selected MCV deploys it', st.blds.some((b) => b.startsWith('fact')), JSON.stringify(st.blds))) {
  await page.keyboard.press('d');
  await advance(2);
  st = await state(page);
  report('Pressing D deploys the MCV', st.blds.some((b) => b.startsWith('fact')), JSON.stringify(st.blds));
}
await sleep(800);
await shot(page, 'npe-04-deployed');
log('hint:', await hint());

// helpers for placement using the real mouse
async function factCenter() { return page.evaluate(() => { const g = window.__game; const f = g.world.buildings.find((b) => b.owner === g.local && b.bt.id === 'fact'); return f ? { x: f.x, y: f.y } : null; }); }
async function placeByMouse(type, label) {
  const f = await factCenter();
  const sbx = await sidebarX();
  const cands = await page.evaluate(([type, fx, fy]) => {
    const g = window.__game; const w = g.world; const sz = { powr: [2, 2], proc: [3, 3], tent: [2, 2], barr: [2, 2], weap: [3, 3], dome: [2, 2] }[type] ?? [2, 2];
    const out = [];
    // a new player clicks "next to the yard": right, below, left, above, then further out
    for (let r = 3; r <= 8; r++) for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, r]]) {
      const cx = Math.round(fx + dx - sz[0] / 2), cy = Math.round(fy + dy - sz[1] / 2);
      out.push({ cx, cy, ok: w.canPlace(g.local, type, cx, cy), gx: cx + sz[0] / 2 + 0.1, gy: cy + sz[1] / 2 + 0.1 });
    }
    return out;
  }, [type, f.x, f.y]);
  const attempts = [];
  for (const c of cands) {
    const p = await toScreen(page, c.gx, c.gy);
    if (!p.onScreen || p.x > sbx - 10 || p.y < 60 || p.y > H - 140) continue;
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await sleep(500);
    const ghostOk = await page.evaluate(() => { const g = window.__game; return g.input.mode === 'place'; });
    await page.mouse.click(p.x, p.y);
    await sleep(500);
    await advance(2);
    const placed = await page.evaluate((t) => window.__game.world.buildings.filter((b) => b.owner === window.__game.local && b.bt.id === t).length, type);
    attempts.push(`${c.ok ? 'valid' : 'INVALID'}`);
    if (placed) { log(`  ${label}: placed after ${attempts.length} click(s) [${attempts.join(', ')}]`); return attempts.length; }
    if (!ghostOk || (await page.evaluate(() => window.__game.input.mode)) !== 'place') { await card(label).click(); await sleep(400); }
    if (attempts.length >= 6) break;
  }
  log(`  ${label}: NOT placed after [${attempts.join(', ')}]`);
  return -1;
}
async function buildStructure(label, type, shotName) {
  await tab(0);
  const c = card(label);
  const s0 = await c.getAttribute('data-state');
  await c.click();
  await sleep(500);
  log(`clicked ${label} (card state ${s0} -> ${await c.getAttribute('data-state')}) at sim ${(await simTime()).toFixed(0)}s`);
  for (let k = 0; k < 40 && (await c.getAttribute('data-state')) !== 'ready'; k++) await advance(2);
  log(`  ${label} ready at sim ${(await simTime()).toFixed(0)}s; tab badge: ${await page.locator('#sidebar .tab').first().locator('.badge').textContent()}`);
  if (shotName) await shot(page, shotName + '-ready');
  await c.click(); // enter placement
  await sleep(600);
  if (shotName) {
    const f = await factCenter();
    const p = await toScreen(page, f.x + 3.5, f.y + 0.5);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await sleep(600);
    await shot(page, shotName + '-ghost');
  }
  const r = await placeByMouse(type, label);
  await advance(2);
  if (shotName) await shot(page, shotName);
  return r;
}

// 4..7: power plant, refinery, barracks, war factory (in the order the hints suggest)
await buildStructure('Power Plant', 'powr', 'npe-05-powerplant');
log('hint:', await hint());
await buildStructure('Ore Refinery', 'proc', 'npe-06-refinery');
log('hint:', await hint());
st = await state(page);
report('Refinery delivered a free Ore Truck', st.units.includes('harv'), JSON.stringify(st.units));
await buildStructure('Barracks', 'tent', 'npe-07-barracks');
log('hint:', await hint());
await tab(2);
await shot(page, 'npe-08-infantry-tab');
for (let k = 0; k < 3; k++) { await card('Rifle Infantry').click(); await sleep(250); }
log('queued riflemen; infantry queue =', await page.evaluate(() => window.__game.local.queues.infantry.items.length));
await buildStructure('War Factory', 'weap', 'npe-09-warfactory');
log('hint:', await hint());
await tab(3);
await card('Medium Tank').click().catch(() => log('  no Medium Tank card'));
await sleep(500);
await shot(page, 'npe-10-vehicle-tab');
await advance(14);

// 8. box-select the army and right-click to move it out
await settleCamera();
const f = await factCenter();
await page.evaluate(([x, y]) => window.__game.gfx.cam.jumpTo(x, y + 2), [f.x, f.y]);
await sleep(1500);
const arm = await page.evaluate(() => { const g = window.__game; return g.world.units.filter((u) => u.owner === g.local && u.weapons.length && !u.ut.harvester).map((u) => [u.x, u.y]); });
log('army units:', arm.length);
if (arm.length) {
  const pts = await Promise.all(arm.map(([x, y]) => toScreen(page, x, y)));
  const on = pts.filter((p) => p.onScreen);
  const x0 = Math.min(...on.map((p) => p.x)) - 25, y0 = Math.min(...on.map((p) => p.y)) - 25, x1 = Math.max(...on.map((p) => p.x)) + 25, y1 = Math.max(...on.map((p) => p.y)) + 25;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 10 });
  await shot(page, 'npe-11-boxselect-drag');
  await page.mouse.up();
  await sleep(600);
  st = await state(page);
  log(`box-selected ${st.sel.length}/${on.length} on-screen units:`, JSON.stringify(st.sel));
  await shot(page, 'npe-11-boxselect');
  const mid = await page.evaluate(() => [window.__game.world.map.w / 2, window.__game.world.map.h / 2]);
  const tgt = await toScreen(page, f.x + (mid[0] - f.x) * 0.2, f.y + (mid[1] - f.y) * 0.2);
  await page.mouse.click(Math.min(tgt.x, (await sidebarX()) - 20), Math.max(80, Math.min(tgt.y, H - 160)), { button: 'right' });
  await sleep(800);
  await shot(page, 'npe-12-move-order');
}

// 9. play on to ~5:00, watching toasts and hints
let lastHint = '';
while ((await simTime()) < 300) {
  await advance(6);
  const h = await hint();
  if (h && h !== lastHint) { lastHint = h; log(`hint @${(await simTime()).toFixed(0)}s:`, h); }
}
await settleCamera();
await shot(page, 'npe-13-5min');
st = await state(page);
log('state at 5:00:', JSON.stringify(st));
const enemy = await page.evaluate(() => { const g = window.__game; const ai = g.world.ais[0]; return { aiState: ai.state, aiWave: ai.wave.size, enemyUnits: g.world.units.filter((u) => g.local.isEnemy(u.owner)).length, enemyBlds: g.world.buildings.filter((b) => g.local.isEnemy(b.owner)).length, lastAttack: [g.local.lastAttackX, g.local.lastAttackY], stats: g.local.stats }; });
log('enemy:', JSON.stringify(enemy));
log('all toasts seen:', [...seenToasts].join(' | '));
log('errors:', errors.length ? errors : 'none');
log('warnings (unique):', [...new Set(warnings)].slice(0, 10), `total ${warnings.length}`);
await browser.close();
