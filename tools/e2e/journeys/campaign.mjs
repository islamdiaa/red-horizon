// Campaign: Boot Camp drills 1–3 (move, fight, deploy), mission 1 of each side from the campaign screen (the
// Allied one played to the end when practical, then Next mission), a special operation lost and retried from its
// debrief, and the first Conquest battle, all started and played through the UI.
import { sleep } from '../lib.mjs';
import { playToWin } from './first-launch.mjs';

const objectives = (bot) => bot.g((g) => (g.world.mission?.objectives ?? []).map((o) => `${o.id}:${o.state}`));
const objDone = (bot, id) => bot.g((g, id) => g.world.mission?.objectives.find((o) => o.id === id)?.state === 'done', id);

/** Wait (fast-forwarding) until an objective is done. */
async function untilDone(bot, id, simSeconds) {
  await bot.wait(simSeconds, { until: `(() => window.__game?.world.mission?.objectives.find((o) => o.id === '${id}')?.state === 'done')()` });
  return objDone(bot, id);
}

/** Select every unit of mine near a point by dragging a box around them. */
async function selectNear(bot, x, y, r = 8, filter = (u) => u.armed) {
  await bot.lookAt(x, y);
  const units = (await bot.mine()).units.filter((u) => filter(u) && Math.hypot(u.x - x, u.y - y) <= r);
  const pts = [];
  for (const u of units) { const p = await bot.toScreen(u.x, u.y); if (await bot.inPlay(p)) pts.push(p); }
  if (!pts.length) return 0;
  const a = await bot.playArea();
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  await bot.drag({ x: cl(Math.min(...pts.map((p) => p.x)) - 25, a.x0, a.x1), y: cl(Math.min(...pts.map((p) => p.y)) - 25, a.y0, a.y1) },
    { x: cl(Math.max(...pts.map((p) => p.x)) + 25, a.x0, a.x1), y: cl(Math.max(...pts.map((p) => p.y)) + 25, a.y0, a.y1) });
  return bot.g((g) => g.selection.size);
}

/** Right-click the ground at a map point (a move order for the selection). */
async function rightClickAt(bot, x, y) {
  await bot.lookAt(x, y);
  const p = await bot.toScreen(x, y);
  await bot.page.mouse.click(p.x, p.y, { button: 'right' });
  await sleep(300);
}

/** Deploy the MCV: click it to select, click again to deploy (D as the fallback). */
async function deployMcv(bot) {
  const mcv = (await bot.mine()).units.find((u) => u.t === 'mcv');
  if (!mcv) return false;
  await bot.lookAt(mcv.x, mcv.y);
  const p = await bot.toScreen(mcv.x, mcv.y, 0.4);
  if (!await bot.g((g, id) => g.selection.has(id), mcv.id)) { await bot.page.mouse.click(p.x, p.y); await sleep(300); }
  await bot.page.mouse.click(p.x, p.y);
  await bot.wait(3);
  if (!(await bot.mine()).blds.some((b) => b.t === 'fact')) { await bot.page.mouse.click(p.x, p.y); await sleep(200); await bot.key('d'); await bot.wait(3); }
  return (await bot.mine()).blds.some((b) => b.t === 'fact');
}

/** The debrief after a mission: wait for it, return { won }. */
async function debrief(bot, timeout = 120000) {
  const ok = await bot.page.waitForSelector('.dbf [data-act="menu"]', { state: 'visible', timeout: timeout * bot.o.slow }).then(() => true, () => false);
  if (!ok) return null;
  await sleep(1200);
  return bot.page.evaluate(() => ({ won: document.querySelector('.dbf')?.classList.contains('win'), text: document.querySelector('.dbf h1')?.textContent }));
}

export default async function campaign(bot) {
  await bot.goto();
  await bot.waitMenu();

  // ================================================================ Boot Camp: drills 1-3
  await bot.nav('Boot Camp');
  await bot.waitMatch();
  bot.check(await bot.g((g) => g.setup.mission) === 'bootcamp', 'Boot Camp starts from the main menu');
  await bot.shot('bootcamp');
  // the radio panel (the Sergeant talking) is display-only: clicks over it, shown or faded, reach the battlefield
  await bot.wait(3, { until: '(() => !!document.querySelector("#ui .mh-tx.on"))()' });
  const radio = await bot.page.evaluate(() => {
    const t = document.querySelector('#ui .mh-tx');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { on: t.classList.contains('on'), through: !!hit && !t.contains(hit), hit: hit ? `${hit.tagName}.${hit.className}` : null };
  });
  bot.check(!radio || radio.through, 'clicks pass through the mission radio panel', radio);
  // drill 1: move to the beacon
  const flags = await bot.g((g) => ({ bx: g.world.mission.flags.bx, by: g.world.mission.flags.by }));
  const me0 = await bot.mine();
  const c0 = { x: me0.units.reduce((s, u) => s + u.x, 0) / me0.units.length, y: me0.units.reduce((s, u) => s + u.y, 0) / me0.units.length };
  const n = await selectNear(bot, c0.x, c0.y, 10, () => true);
  await rightClickAt(bot, flags.bx, flags.by);
  bot.check(await untilDone(bot, 'move', 60), 'drill 1: box-select and move to the beacon', `${n} selected; ${await objectives(bot)}`);
  // drill 2: fight the scouts (attack-move at them)
  const scouts = await bot.g((g) => g.world.mission.flags.scouts.map((id) => g.world.getEntity(id)).filter((u) => u?.alive).map((u) => ({ x: u.x, y: u.y })));
  if (scouts.length) {
    const sx = scouts.reduce((s, u) => s + u.x, 0) / scouts.length, sy = scouts.reduce((s, u) => s + u.y, 0) / scouts.length;
    await bot.key('e'); // all combat units
    await bot.attackMove(sx, sy);
  }
  bot.check(await untilDone(bot, 'fight', 90), 'drill 2: attack-move wipes out the scouts', await objectives(bot));
  // drill 3: deploy the MCV that arrives
  await bot.wait(2);
  bot.check(await deployMcv(bot) && await untilDone(bot, 'deploy', 10), 'drill 3: the MCV deploys', await objectives(bot));
  await bot.shot('bootcamp-drill3');
  await bot.noErrors('Boot Camp');
  await bot.quitToMenu();

  // ================================================================ Allied mission 1, from the campaign screen
  await bot.nav('Campaign');
  await bot.waitFor('.cmp .cmp-tab');
  await bot.click('.cmp .cmp-tab[data-tab="allies"]');
  await bot.waitFor('.cmp [data-act="deploy"]');
  await bot.shot('campaign-allies');
  await bot.click('.cmp [data-act="deploy"]');
  await bot.waitMatch();
  bot.check(await bot.g((g) => g.setup.mission) === 'allied-01', 'Allied mission 1 starts from the campaign screen', await bot.g((g) => g.setup.mission));
  bot.check(await deployMcv(bot), 'allied-01: the MCV deploys');
  for (const t of ['powr', 'proc', 'tent']) bot.check(await bot.build(t), `allied-01: built ${t}`);
  bot.check(await objDone(bot, 'refinery'), 'allied-01: the refinery objective completes', await objectives(bot));
  await bot.train('e3', 4);
  await bot.train('e1', 4);
  await bot.wait(60);
  const won = await playToWin(bot, null, 'tent', { maxSim: 1500 });
  const d1 = await debrief(bot);
  bot.log('allied-01:', won, JSON.stringify(d1), await objectives(bot));
  await bot.shot('allied-01-debrief');
  if (won && d1?.won) {
    bot.check(true, 'allied-01 won through the UI; the debrief shows the victory');
    await bot.click('.dbf [data-act="next"]');
    await bot.waitMatch();
    bot.check(await bot.g((g) => g.setup.mission) === 'allied-02', 'Next mission starts Allied mission 2');
    await bot.quitToMenu();
  } else {
    bot.check(!!d1 || !won, 'allied-01 played as far as practical', `won ${won}, objectives ${await objectives(bot)}`);
    if (d1) await bot.click('.dbf [data-act="menu"]'); // (the debrief's menu button opens the campaign screen)
    else await bot.pauseAct('quit to menu');
    await bot.page.waitForSelector('.cmp [data-act="back"], .main-screen:not(.leaving) .mm-nav-btn', { state: 'visible', timeout: 60000 * bot.o.slow }).catch(() => {});
    if (await bot.sees('.cmp [data-act="back"]')) await bot.click('.cmp [data-act="back"]');
    await bot.waitMenu();
  }
  await bot.noErrors('Allied mission 1');

  // ================================================================ Soviet mission 1
  await bot.nav('Campaign');
  await bot.click('.cmp .cmp-tab[data-tab="soviet"]');
  await bot.waitFor('.cmp [data-act="deploy"]');
  await bot.click('.cmp [data-act="deploy"]');
  await bot.waitMatch();
  const sv = await bot.g((g) => ({ id: g.setup.mission, faction: g.local.faction, obj: (g.world.mission?.objectives ?? []).length }));
  bot.check(sv.id === 'soviet-01' && sv.faction === 'soviet' && sv.obj > 0, 'Soviet mission 1 starts as the Soviets with objectives', sv);
  const myS = await bot.mine();
  if (myS.units.some((u) => u.t === 'mcv')) bot.check(await deployMcv(bot), 'soviet-01: the MCV deploys');
  else {
    // a strike team: move it toward the first enemy structure
    const e = (await bot.enemies()).blds[0];
    await bot.key('e');
    if (e) await bot.attackMove(e.x, e.y);
    await bot.wait(20);
    bot.check((await bot.mine()).units.length > 0, 'soviet-01: the strike team takes orders');
  }
  await bot.shot('soviet-01');
  await bot.noErrors('Soviet mission 1');
  await bot.quitToMenu();

  // ================================================================ a special operation: lose it, retry from the debrief
  await bot.nav('Campaign');
  await bot.click('.cmp .cmp-tab[data-tab="special"]');
  await bot.waitFor('.cmp .cmp-sp');
  await bot.click('.cmp .cmp-sp[data-id="survival"]');
  await bot.click('.cmp [data-act="deploy"]');
  await bot.waitMatch();
  bot.check(await bot.g((g) => g.setup.mission) === 'survival', 'the special operation Last Stand starts');
  // a commander who sells their base and leaves the army idle loses
  await bot.key('e');
  await bot.wait(1500, { until: '(() => window.__game?.world.gameOver)()' });
  const lost = await debrief(bot);
  bot.check(lost && !lost.won, 'the special operation is lost and the debrief says so', lost);
  await bot.shot('survival-lost');
  if (lost) {
    const seed0 = await bot.g((g) => g.world.tick);
    await bot.click('.dbf [data-act="retry"]');
    await bot.page.waitForFunction((t) => window.__game && window.__game.setup.mission === 'survival' && !window.__game.world.gameOver && window.__game.world.tick < t, seed0, { timeout: 180000 * bot.o.slow, polling: 500 }).catch(() => {});
    await bot.waitMatch();
    const retry = await bot.g((g) => ({ id: g.setup.mission, over: g.world.gameOver, t: g.world.time }));
    bot.check(retry.id === 'survival' && !retry.over && retry.t < 60, 'Retry restarts the operation', retry);
    await bot.quitToMenu();
  }
  await bot.noErrors('special operation');

  // ================================================================ the first Conquest battle
  await bot.click('.main-screen:not(.leaving) .mm-nav-btn[data-nav="conquest"]'); // (Europe Conquest: 'Conquest' alone also matches World Conquest)
  await bot.waitFor('.cq-root [data-act="begin"], [data-act="begin"]', undefined, 30000);
  await bot.shot('conquest-new');
  await bot.click('[data-act="begin"]');
  // the opening flow may show briefings: dismiss them as a player would
  for (let i = 0; i < 6; i++) {
    await sleep(800);
    if (await bot.sees('.ter.target')) break;
    for (const act of ['ok', 'go', 'continue', 'close']) if (await bot.sees(`[data-act="${act}"]`)) { await bot.click(`[data-act="${act}"]`); break; }
  }
  await bot.shot('conquest-map');
  const target = bot.page.locator('.ter.target').first();
  bot.check(await target.count() > 0, 'the Conquest map offers a territory to attack');
  await target.dispatchEvent('click'); // (an SVG path under labels: Playwright's click would hit the label on top)
  await sleep(600);
  await bot.click('[data-act="attack"]');
  await bot.waitFor('[data-act="deploy"]');
  await bot.click('[data-act="deploy"]');
  await bot.waitMatch();
  const cq = await bot.g((g) => ({ mission: g.setup.mission, conquest: !!g.setup.conquest, kind: g.setup.conquest?.battle?.kind }));
  bot.check(cq.conquest && cq.mission === 'conquest', 'the first Conquest battle starts', cq);
  if ((await bot.mine()).units.some((u) => u.t === 'mcv')) bot.check(await deployMcv(bot), 'Conquest: the MCV deploys');
  await bot.wait(30);
  await bot.shot('conquest-battle');
  await bot.noErrors('Conquest battle');
  await bot.quitToMenu();
  // (the Europe entry by its data-nav: World Conquest's entry carries a pill too)
  const resumable = await bot.page.evaluate(() => [...document.querySelectorAll('.mm-nav-btn[data-nav="conquest"]')].some((b) => b.querySelector('.rh-daily-pill')));
  bot.check(resumable, 'the main menu shows the Conquest campaign in progress');
}
