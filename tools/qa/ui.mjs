// QA: UI/UX checks with real input. node tools/qa/ui.mjs   (server on :5192)
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
await shot(page, 'ui-01-base');

// scenario=base is under-powered (400/815, see debug.ts BASES): add Advanced Power Plants so radar works
await evalG(() => {
  const g = window.__game, w = g.world, p = g.local, f = w.buildings.find((b) => b.owner === p && b.bt.id === 'fact');
  let n = 0;
  for (let r = 3; r < 20 && n < 4; r++) for (let dy = -r; dy <= r && n < 4; dy++) for (let dx = -r; dx <= r && n < 4; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (w.canPlace(p, 'apwr', f.cx + dx, f.cy + dy)) { w.addBuilding('apwr', p, f.cx + dx, f.cy + dy, true); n++; }
  }
});
async function settle() {
  const t0 = await page.evaluate(() => window.__game.world.tick);
  await page.waitForFunction((t) => window.__game.world.tick >= t + 2, t0, { timeout: 90000, polling: 50 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
await settle();
log('power now', await evalG(() => `${window.__game.local.powerOut}/${window.__game.local.powerUse} radar=${window.__game.local.radar}`));
// structure busy
await tab(0);
await card('Power Plant').click();
await settle();
const busy = await card('Barracks').getAttribute('data-state').catch(() => null);
const otherState = await page.locator('.bitem[data-state]').evaluateAll((els) => els.map((e) => `${e.querySelector('.bi-name')?.textContent}:${e.dataset.state}`).slice(0, 6));
log('structure cards while building a power plant:', otherState.join(' '));
// clicking another structure while busy
await card('Ore Silo').click().catch(() => {});
await settle();
log('toasts after clicking Ore Silo while busy:', (await toasts(page)).join(' | '));
for (let k = 0; k < 10 && !(await evalG(() => window.__game.local.queues.structure.ready === 'powr')); k++) { await evalG(() => window.__game.fastForward(2)); await settle(); }
let s = await card('Power Plant').getAttribute('data-state');
report('Structure card shows "ready"', s === 'ready', s);
// cancel the ready structure via right-click
const c0 = await evalG(() => window.__game.local.credits);
await card('Power Plant').click({ button: 'right' });
await settle();
const c1 = await evalG(() => window.__game.local.credits);
report('Right-click on a ready structure cancels it with full refund', c1 - c0 === 300, `refund ${c1 - c0}`);

// ---------------------------------------------------------------- tooltips
log('--- tooltips');
await card('War Factory').hover().catch(() => {});
await card('Ore Silo').hover();
await sleep(700);
const tip = await evalG(() => { const t = document.getElementById('tooltip'); return t ? { vis: getComputedStyle(t).opacity, text: t.innerText.replace(/\s+/g, ' ').slice(0, 300) } : null; });
report('Hovering a build card shows a tooltip with cost/build time', !!tip && +tip.vis > 0.5 && /\$/.test(tip.text) && /build/i.test(tip.text), JSON.stringify(tip));
await shot(page, 'ui-04-tooltip');
// locked card tooltip
await tab(1);
const lockedTip = await page.locator('.bitem.locked').first().count() ? (await page.locator('.bitem.locked').first().hover(), await sleep(600), await evalG(() => document.getElementById('tooltip')?.innerText.replace(/\s+/g, ' ').slice(0, 200))) : 'no locked cards';
log('locked card tooltip:', lockedTip);
await page.mouse.move(600, 400);

// ---------------------------------------------------------------- selection panel
log('--- selection panel');
const myUnits = await evalG(() => { const g = window.__game; return g.world.units.filter((u) => u.owner === g.local && u.weapons.length && !u.ut.harvester).map((u) => ({ id: u.id, x: u.x, y: u.y, t: u.ut.id })); });
log('my combat units', myUnits.length);
// fly camera to the first unit and click it
if (myUnits.length) {
  await evalG(([x, y]) => window.__game.gfx.cam.jumpTo(x, y), [myUnits[0].x, myUnits[0].y]);
  await sleep(1500);
  const p = await toScreen(page, myUnits[0].x, myUnits[0].y, 0.3);
  await page.mouse.click(p.x, p.y);
  await settle();
  const sel = await state(page);
  const panel = await evalG(() => document.getElementById('selpanel')?.className);
  report('Clicking a unit selects it and opens the selection panel', sel.sel.length === 1 && /on/.test(panel), `${JSON.stringify(sel.sel)} ${panel}`);
  await shot(page, 'ui-05-single-select');
}
// ctrl+A selects all combat units
await page.keyboard.press('Control+a');
await sleep(500);
let st = await state(page);
report('Ctrl+A selects all combat units', st.sel.length === myUnits.length, `${st.sel.length}/${myUnits.length}`);
await shot(page, 'ui-06-multi-select');
// control groups
await page.keyboard.press('Control+1');
await sleep(400);
const grpBar = await evalG(() => document.querySelectorAll('#groups .grp').length);
report('Ctrl+1 assigns group 1 (group bar shows it)', grpBar >= 1, `${grpBar} group buttons`);
await page.mouse.click(700, 120); // click empty ground to deselect
await sleep(400);
st = await state(page);
log('after clicking empty ground, selection =', st.sel.length);
await page.keyboard.press('1');
await sleep(400);
st = await state(page);
report('Pressing 1 recalls group 1', st.sel.length === myUnits.length, `${st.sel.length}`);
const camBefore = await evalG(() => [window.__game.gfx.cam.x, window.__game.gfx.cam.y]);
await evalG(() => window.__game.gfx.cam.jumpTo(5, 5));
await page.keyboard.press('1'); await sleep(80); await page.keyboard.press('1');
await sleep(300);
await page.waitForFunction(() => !window.__game.gfx.cam.flyTo, null, { timeout: 60000, polling: 200 }).catch(() => {});
const camAfter = await evalG(() => [window.__game.gfx.cam.x, window.__game.gfx.cam.y]);
report('Double-tapping 1 jumps the camera to the group', Math.hypot(camAfter[0] - 5, camAfter[1] - 5) > 5, `cam ${camAfter.map((v) => v.toFixed(1))}`);
void camBefore;
// group with a dead unit; group assign with buildings selected
// ---------------------------------------------------------------- hotkeys and focus traps
log('--- focus traps');
await page.locator('#topbar .speed-ctl button').nth(1).click(); // fast speed
await sleep(200);
const speed1 = await evalG(() => window.__game.speed);
await page.keyboard.press('Space');
await page.keyboard.press('Enter');
await sleep(300);
const speed2 = await evalG(() => window.__game.speed);
const focused = await evalG(() => document.activeElement?.tagName + '.' + document.activeElement?.className);
report('Space/Enter after clicking a speed button does not re-trigger it', speed1 === speed2, `speed ${speed1} -> ${speed2}, focus on ${focused}`);
// click the Menu button, resume, press Space
await page.locator('#topbar .tb-menu').click();
await sleep(1200);
const paused = await evalG(() => window.__game.paused);
report('Menu button opens the pause menu', paused && (await page.locator('.pause-screen').count()) > 0);
await shot(page, 'ui-07-pause');
await page.locator('.pause-screen .pp-btn.primary').click();
await sleep(800);
await page.keyboard.press('Space');
await page.keyboard.press('Enter');
await sleep(800);
const reopened = await page.locator('.pause-screen').count();
report('Space/Enter after Resume does not reopen the pause menu', reopened === 0 && !(await evalG(() => window.__game.paused)), `pause screens ${reopened}`);
// Esc opens pause, Esc resumes
await page.keyboard.press('Escape');
await sleep(800);
const p1 = await evalG(() => window.__game.paused);
await page.keyboard.press('Escape');
await sleep(800);
const p2 = await evalG(() => window.__game.paused);
report('Esc toggles the pause menu', p1 && !p2, `${p1} ${p2}`);
// Settings inside pause, change something with keyboard, return
await page.keyboard.press('Escape');
await sleep(800);
await page.locator('.pause-screen .pp-btn', { hasText: 'Settings' }).click();
await sleep(800);
await shot(page, 'ui-08-settings');
const settingsText = await evalG(() => document.querySelector('.settings-panel')?.innerText.replace(/\s+/g, ' ').slice(0, 500));
log('settings panel:', settingsText);
await page.keyboard.press('Escape');
await sleep(800);
const backToPause = await page.locator('.pause-screen').count();
report('Esc in Settings returns to the pause menu', backToPause > 0);
await page.keyboard.press('Escape');
await sleep(800);

// hotkeys A / Esc / Z / R / H / Q / U / Alt
log('--- hotkeys');
await page.keyboard.press('1');
await page.keyboard.press('a');
await sleep(200);
report('A enters attack-move mode with units selected', (await evalG(() => window.__game.input.mode)) === 'attackMove');
await page.keyboard.press('Escape');
await sleep(200);
report('Esc cancels a targeting mode (without opening the pause menu)', (await evalG(() => window.__game.input.mode)) === 'normal' && !(await evalG(() => window.__game.paused)));
await page.keyboard.press('z');
await sleep(200);
const sellMode = await evalG(() => window.__game.input.mode);
await page.keyboard.press('z');
report('Z toggles sell mode', sellMode === 'sell' && (await evalG(() => window.__game.input.mode)) === 'normal');
await page.keyboard.press('h');
await sleep(1200);
st = await state(page);
report('H selects the Construction Yard and jumps to base', st.sel.includes('fact'), JSON.stringify(st.sel));
await page.keyboard.press('u');
await sleep(500);
await shot(page, 'ui-09-photo-mode');
const uiHidden = await evalG(() => document.body.classList.contains('photo-mode'));
await page.keyboard.press('u');
report('U toggles photo mode', uiHidden);
await page.keyboard.down('Alt');
await sleep(400);
await shot(page, 'ui-10-alt-healthbars');
await page.keyboard.up('Alt');

// ---------------------------------------------------------------- minimap
log('--- minimap');
const radar = await evalG(() => window.__game.local.radar);
log('radar online:', radar);
const mm = await page.locator('.radar canvas').first().boundingBox();
if (mm) {
  await page.mouse.click(mm.x + mm.width * 0.8, mm.y + mm.height * 0.2);
  await sleep(1200);
  const cam = await evalG(() => [window.__game.gfx.cam.x, window.__game.gfx.cam.y, window.__game.world.map.w]);
  report('Left-click on the minimap moves the camera', Math.abs(cam[0] - cam[2] * 0.8) < 4 && Math.abs(cam[1] - cam[2] * 0.2) < 4, `cam ${cam[0].toFixed(1)},${cam[1].toFixed(1)}`);
  await page.keyboard.press('1');
  await sleep(300);
  await page.mouse.click(mm.x + mm.width * 0.5, mm.y + mm.height * 0.5, { button: 'right' });
  await settle();
  const orders = await evalG(() => { const g = window.__game; return [...g.selection].map((id) => g.world.getEntity(id)?.order).filter(Boolean).map((o) => o.type + (o.x ? `@${o.x.toFixed(0)},${o.y.toFixed(0)}` : '')); });
  report('Right-click on the minimap orders selected units to move', orders.some((o) => o.startsWith('move')), orders.slice(0, 4).join(' '));
  await shot(page, 'ui-11-minimap');
}


// ---------------------------------------------------------------- superweapons UI
log('--- superweapons');
await page.evaluate(() => window.__game.fastForward(12));
await sleep(1500);
const supers = await evalG(() => [...document.querySelectorAll('.supers .super')].map((b) => `${b.dataset.kind}:${b.classList.contains('ready') ? 'ready' : 'charging'}`));
log('superweapon buttons:', supers.join(' '));
await shot(page, 'ui-11b-supers');
// chrono with nothing selected
await page.mouse.click(600, 150); await sleep(300);
await evalG(() => window.__game.selection.clear());
await page.locator('.supers .sw-chrono').click().catch(() => log('  no chrono button'));
await sleep(500);
log('toasts after chrono with no selection:', (await toasts(page)).slice(-2).join(' | '));
report('Chronoshift without a selected vehicle explains what to do', (await toasts(page)).some((t) => /vehicle/i.test(t)));
// select a tank and chrono it into the unexplored shroud
const tank = await evalG(() => { const g = window.__game; const t = g.world.units.find((u) => u.owner === g.local && u.kind === 'vehicle' && !u.ut.harvester); if (t) { g.selection.clear(); g.selection.add(t.id); } return t && { id: t.id, x: t.x, y: t.y }; });
if (tank) {
  await page.locator('.supers .sw-chrono').click();
  await sleep(500);
  const mode = await evalG(() => window.__game.input.mode);
  report('Clicking a ready Chronoshift enters targeting mode', mode === 'super', mode);
  const tgt = await evalG(() => { const g = window.__game; const m = g.world.map; for (let y = 4; y < m.h - 4; y += 3) for (let x = 4; x < m.w - 4; x += 3) { const i = m.idx(x, y); if (!g.local.explored[i] && m.passable(x, y)) return [x + 0.5, y + 0.5]; } return null; });
  await evalG(([x, y]) => window.__game.gfx.cam.jumpTo(x, y), tgt);
  await sleep(1500);
  const sp = await toScreen(page, tgt[0], tgt[1]);
  await page.mouse.move(sp.x, sp.y, { steps: 3 });
  await sleep(500);
  await shot(page, 'ui-11c-chrono-target-shroud');
  await page.mouse.click(sp.x, sp.y);
  await sleep(800);
  const moved = await evalG((id) => { const u = window.__game.world.getEntity(id); return u && [u.x, u.y]; }, tank.id);
  log(`chrono into unexplored shroud: tank now at ${moved?.map((v) => v.toFixed(1))} (target ${tgt})`);
}
// nuke at an unexplored enemy base
const enemyFact = await evalG(() => { const g = window.__game; const b = g.world.buildings.find((b) => g.local.isEnemy(b.owner) && b.bt.id === 'fact'); return b && [b.x, b.y, !!g.local.explored[g.world.map.idx(Math.floor(b.x), Math.floor(b.y))]]; });
const nukeBtn = page.locator('.supers .sw-nuke');
if (enemyFact && await nukeBtn.count()) {
  log('enemy yard explored by player:', enemyFact[2]);
  await nukeBtn.click();
  await sleep(400);
  await evalG(([x, y]) => window.__game.gfx.cam.jumpTo(x, y), enemyFact);
  await sleep(1500);
  const sp = await toScreen(page, enemyFact[0], enemyFact[1]);
  await page.mouse.move(sp.x, sp.y, { steps: 3 });
  await sleep(500);
  await shot(page, 'ui-11d-nuke-target');
  await page.mouse.click(sp.x, sp.y);
  await sleep(1500);
  const launched = await evalG(() => window.__game.world.projectiles.some((p) => p.special === 'nuke'));
  report('Nuke can be launched at an unexplored enemy base', launched);
  await page.evaluate(() => window.__game.fastForward(8));
  await sleep(1500);
  await shot(page, 'ui-11e-nuke-impact');
}

// ---------------------------------------------------------------- fog: building ghosts
log('--- fog ghosts');
const ghost = await evalG(() => {
  const g = window.__game, w = g.world, me = g.local, m = w.map;
  const foe = w.players.find((p) => me.isEnemy(p));
  // find an explored-but-not-visible clear 2x2 spot
  let spot = null;
  for (let y = 2; y < m.h - 3 && !spot; y++) for (let x = 2; x < m.w - 3 && !spot; x++) {
    let ok = true;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const i = m.idx(x + dx, y + dy); if (!m.buildable(x + dx, y + dy) || me.visible[i] || !me.explored[i]) ok = false; }
    if (ok) spot = [x, y];
  }
  if (!spot) return null;
  const b = w.addBuilding('powr', foe, spot[0], spot[1], true);
  return { id: b.id, spot };
});
if (ghost) {
  await sleep(2500);
  const shown = await evalG((id) => window.__game.ents.isShown(id), ghost.id);
  report('A NEW enemy structure built in explored-but-fogged terrain stays hidden until re-scouted (ghosting)', !shown, `shown immediately=${shown}`);
  await evalG(([x, y]) => window.__game.gfx.cam.jumpTo(x + 1, y + 1), ghost.spot);
  await sleep(1500);
  await shot(page, 'ui-11f-fog-new-building');
  await evalG((id) => { const g = window.__game; g.world.kill(g.world.getEntity(id)); }, ghost.id);
  await sleep(2500);
  await shot(page, 'ui-11g-fog-destroyed-building');
  const stillShown = await evalG((id) => window.__game.ents.isShown(id), ghost.id);
  report('A structure destroyed out of sight keeps its last-seen ghost until re-scouted', stillShown, `ghost shown=${stillShown}`);
}

// ---------------------------------------------------------------- toasts & event log
log('--- toasts / event log');
const bell = page.locator('#topright button').last();
await bell.click().catch(() => {});
await sleep(700);
await shot(page, 'ui-12-eventlog');
const logText = await evalG(() => document.querySelector('.toast-log, .event-log, .log-panel, [class*="log"]')?.innerText?.replace(/\s+/g, ' ').slice(0, 400) ?? null);
log('event log:', logText);
await bell.click().catch(() => {});

// ---------------------------------------------------------------- resize
log('--- resize');
for (const [w, h] of [[1024, 640], [1280, 720], [1920, 1080]]) {
  await page.setViewportSize({ width: w, height: h });
  await sleep(2500);
  const lay = await evalG(() => {
    const sb = document.getElementById('sidebar')?.getBoundingClientRect();
    const sel = document.getElementById('selpanel')?.getBoundingClientRect();
    const c = document.getElementById('game-canvas');
    const grid = document.querySelector('.build-grid');
    return { sidebar: sb && [Math.round(sb.x), Math.round(sb.width), Math.round(sb.height)], canvas: c && [c.width, c.height, c.clientWidth, c.clientHeight], selpanel: sel && [Math.round(sel.x), Math.round(sel.right)], gridOverflow: grid ? grid.scrollHeight > grid.clientHeight : null, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight };
  });
  log(`viewport ${w}x${h}:`, JSON.stringify(lay));
  report(`No page scrollbars at ${w}x${h}`, lay.docW <= w && lay.docH <= h, `doc ${lay.docW}x${lay.docH}`);
  report(`Selection panel does not overlap the sidebar at ${w}x${h}`, !lay.selpanel || !lay.sidebar || lay.selpanel[1] <= lay.sidebar[0] + 1, JSON.stringify(lay.selpanel));
  await shot(page, `ui-13-resize-${w}x${h}`);
}
await page.setViewportSize({ width: 1280, height: 720 });
await sleep(1500);
// viewPolygon assumes a 312px sidebar
const vp = await evalG(() => document.getElementById('sidebar')?.getBoundingClientRect().width);
log('sidebar width at 1280x720:', vp, '(InputController.viewPolygon & selectSameTypeOnScreen hard-code 312px)');

// ---------------------------------------------------------------- end screen, menu, restart, re-start
log('--- end screen & lifecycle');
await evalG(() => { const g = window.__game; for (const e of [...g.world.units, ...g.world.buildings]) if (g.local.isEnemy(e.owner)) g.world.kill(e); });
await page.waitForSelector('.end-screen', { timeout: 300000 });
await sleep(3000);
await shot(page, 'ui-14-victory');
const endText = await evalG(() => document.querySelector('.end-screen')?.innerText.replace(/\s+/g, ' ').slice(0, 400));
log('end screen:', endText);
report('Destroying all enemies shows the VICTORY screen', /VICTORY/.test(endText ?? ''));
const contexts0 = await evalG(() => document.querySelectorAll('canvas').length);
await page.locator('.end-screen .btn', { hasText: 'Main menu' }).click();
await page.waitForSelector('.main-screen .deploy', { timeout: 120000 });
await sleep(3000);
await shot(page, 'ui-15-back-to-menu');
const afterQuit = await evalG(() => ({ canvases: document.querySelectorAll('canvas').length, ui: document.getElementById('ui')?.children.length, tooltip: !!document.getElementById('tooltip'), bodyCls: document.body.className, hint: !!document.querySelector('.hint') }));
log('after quit to menu:', JSON.stringify(afterQuit), 'canvases before', contexts0);
// start a new game from the menu
await page.click('.main-screen .deploy');
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
await page.locator('.pause-screen .pp-btn', { hasText: 'Restart' }).click();
await page.waitForFunction((s) => window.__game && window.__game.setup.seed !== s && window.__game.hud, seedBefore, { timeout: 180000 });
await sleep(1500);
const seedAfter = await evalG(() => window.__game.setup.seed);
log(`Restart: seed ${seedBefore} -> ${seedAfter} (map ${seedBefore === seedAfter ? 'same' : 'DIFFERENT'})`);
await sleep(2000);
// defeat path
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 60000 });
await evalG(() => { const g = window.__game; for (const e of [...g.world.units, ...g.world.buildings]) if (e.owner === g.local) g.world.kill(e); });
await page.waitForSelector('.end-screen', { timeout: 300000 });
await sleep(3000);
await shot(page, 'ui-17-defeat');
const defeatText = await evalG(() => document.querySelector('.end-screen')?.innerText.replace(/\s+/g, ' ').slice(0, 300));
report('Losing everything shows the DEFEAT screen', /DEFEAT/.test(defeatText ?? ''), defeatText);
// "Keep watching" after defeat
await page.locator('.end-screen .btn', { hasText: 'Keep watching' }).click();
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
