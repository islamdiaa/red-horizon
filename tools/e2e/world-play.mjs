// World Conquest for the play matrix (tools/e2e/matrix.mjs cells world:<level>:<profile>): the skill profiles play a
// few world turns through the real UI and fight one RTS battle, the way each kind of player would.
//
//  newcomer  follows the Field Manual coach and the screen's suggestions: places everything on the territory it was
//            told to, takes the first suggested attack and, as the coach recommends, fights it (the battle is played
//            by the newcomer battle profile); afterwards rolls the dice on suggested attacks it is likely to win.
//  casual    places on the border of its best attack, blitzes suggestions at good odds (60%+), fights one battle on
//            turn 2 (the casual battle profile), fortifies its biggest stack forward, ends the turn.
//
// What the cell records: turns played, territories held at the start and the end, the battle's result and length,
// wall time to the first battle, frictions (taps that did nothing, a missing button, a softlock).
import { sleep } from './lib.mjs';
import { PLAY, over } from './profiles.mjs';
import { Wd, runState, tapTerritory, skipAnim } from './journeys/world.mjs';

const SIDE = '.wc-side';

/** Open World Conquest from the menu and begin a Blitz run at `level` from the default homeland. */
export async function startWorld(bot, cell) {
  await bot.click('.main-screen:not(.leaving) .mm-nav-btn[data-nav="world"]');
  if (!await bot.waitFor(`${SIDE} [data-act="begin"]`, undefined, 90000)) { bot.friction('missing', 'the world setup did not open'); return false; }
  if (await bot.sees(`${SIDE} [data-act="opts"]`)) await bot.click(`${SIDE} [data-act="opts"]`);
  if (await bot.waitFor(`${SIDE} [data-size="blitz"]`, undefined, 10000)) {
    await bot.click(`${SIDE} [data-size="blitz"]`);
    if (await bot.sees(`${SIDE} [data-diff="${cell.level}"]`)) await bot.click(`${SIDE} [data-diff="${cell.level}"]`);
    else bot.friction('missing', `no ${cell.level} difficulty on the world setup`);
  }
  await bot.shot('world-setup');
  await bot.click(`${SIDE} [data-act="begin"]`);
  return bot.waitFor('.wc-top', undefined, 60000);
}

async function answer(bot) {
  for (let k = 0; k < 16; k++) {
    await skipAnim(bot);
    const st = await runState(bot);
    if (!st || st.status !== 'active' || (st.current === 0 && !st.defence)) return st;
    if (await bot.sees('.wc-modal [data-no]')) { await bot.click('.wc-modal [data-no]'); continue; }
    if (await bot.sees('[data-act="dice"]')) { await bot.click('[data-act="dice"]'); continue; }
    await sleep(700);
  }
  return runState(bot);
}

const suggestions = (bot) => Wd(bot, () => (window.__world.view?.suggestions?.(6) ?? []).map((s) => ({ from: s.from, to: s.to, win: s.odds?.win ?? 0 })));
const coachText = (bot) => bot.page.textContent('.wc-coach').then((t) => (t ?? '').replace(/\s+/g, ' ').trim()).catch(() => '');

async function selectAttack(bot, s) {
  const b = bot.page.locator(`[data-sugg="${s.from}|${s.to}"]`).first();
  if (await b.count() && await b.isVisible().catch(() => false)) { await b.click(); await sleep(400); }
  else { await tapTerritory(bot, s.from, 'attack source'); await tapTerritory(bot, s.to, 'attack target'); }
  const st = await runState(bot);
  return st.sel?.src === s.from && st.sel?.dst === s.to;
}

async function reinforce(bot, profile) {
  let st = await runState(bot);
  if (await bot.sees('[data-act="trade"]')) await bot.click('[data-act="trade"]');
  st = await runState(bot);
  if (st.toPlace > 0) {
    // newcomer: where the coach / screen points (its capital, else its biggest stack); casual: behind its best attack
    const where = await Wd(bot, (profile) => {
      const w = window.__world, r = w.run, mine = r.territories.filter((t) => t.owner === r.player);
      if (profile === 'casual') { const s = w.view?.suggestions?.(1)?.[0]; if (s) return s.from; }
      return (mine.find((t) => t.capital === r.player) ?? mine.sort((a, b) => b.troops - a.troops)[0]).id;
    }, profile);
    await tapTerritory(bot, where, 'reinforce');
    if (await bot.sees('[data-act="all"]')) await bot.click('[data-act="all"]');
    else bot.friction('missing', 'no Place all after tapping my territory');
  }
  st = await runState(bot);
  if (st.toPlace > 0) bot.friction('stuck', `still ${st.toPlace} troops to place`);
  if (await bot.sees('[data-act="next"]')) await bot.click('[data-act="next"]');
}

/** Fight the selected attack as an RTS battle, played by the profile; back on the turn screen afterwards. */
async function fight(bot, cell, rec, startMetrics, readMetrics) {
  if (!await bot.sees('[data-act="fight"]')) { bot.friction('missing', 'no Fight it button'); return false; }
  await bot.click('[data-act="fight"]');
  if (await bot.sees('.wc-modal [data-yes]')) await bot.click('.wc-modal [data-yes]');
  await bot.waitMatch();
  rec.battle = await bot.g((g) => ({ kind: g.setup.conquest?.battle?.kind, label: g.setup.conquest?.battle?.mapLabel ?? g.setup.conquest?.battle?.map?.label, landmark: g.world.map.landmarks?.[0]?.id ?? null, climate: g.setup.conquest?.battle?.map?.climate, size: g.world.map.w, strength: g.setup.conquest?.battle?.strength, ai: g.setup.conquest?.battle?.ai }));
  rec.firstBattleWall = rec.firstBattleWall ?? Math.round((Date.now() - rec.t0) / 1000);
  bot.log(`battle ${JSON.stringify(rec.battle)}`);
  await startMetrics(bot);
  const r = await PLAY[cell.profile](bot, { maxSim: cell.profile === 'newcomer' ? 1800 : 2400 });
  const fin = await over(bot);
  rec.result = fin ? (fin.won ? 'win' : 'loss') : r.result === 'timeout' ? 'timeout' : 'gave up';
  Object.assign(rec, (await readMetrics(bot)) ?? {});
  await bot.shot('battle-end');
  if (!fin) {
    bot.log('battle still running at the limit: forcing the end to go on');
    if (!await bot.forceEnd(false, 60)) {
      // (diagnostics: what of mine is still alive after clearing my side out, then the mission's own defeat)
      const left = await bot.g((g) => { const me = g.local; const u = g.world.units.filter((x) => x.alive && x.owner.team === me.team).map((x) => `${x.ut.id}${x.owner === me ? '' : '@' + x.owner.id}`); const b = g.world.buildings.filter((x) => x.alive && x.owner.team === me.team).map((x) => x.bt.id); return { units: u.slice(0, 12), n: u.length, blds: b.slice(0, 8), over: g.world.gameOver, ended: g.world.mission?.ended }; });
      if (!left.over && !left.ended) bot.friction('stuck', `clearing my side out did not end the battle: ${JSON.stringify(left)}`);
      await bot.page.evaluate(() => { const m = window.__game.world.mission; if (m && !m.ended) m.lose('All forces lost'); });
      await bot.wait(2);
    }
  }
  const ok = await bot.page.waitForSelector('.wc-modal [data-go]', { state: 'visible', timeout: 420000 * bot.o.slow }).then(() => true, () => false);
  if (!ok) {
    const st = await bot.g((g) => ({ over: g.world.gameOver, defeated: g.local.defeated, ended: g.world.mission?.ended, won: g.world.mission?.won, reason: g.world.mission?.endReason, paused: g.paused, endTimer: g.endTimer, running: g.running, screens: [...document.querySelectorAll('.end-screen, .dbf, .wc-modal, .cq-modal, .pause-screen')].map((e) => e.className).join(' | ') })).catch((e) => String(e));
    bot.friction('softlock', `the battle ended but no World Conquest report appeared: ${JSON.stringify(st)}`);
    return false;
  }
  await sleep(1000);
  rec.endText = await bot.page.evaluate(() => document.querySelector('.wc-modal .wc-dlg')?.innerText.replace(/\s+/g, ' ').slice(0, 300));
  await bot.shot('report');
  await bot.click('.wc-modal [data-go]');
  if (!await bot.waitFor('.wc-top', undefined, 90000)) { bot.friction('softlock', 'no way back to the turn screen after the report'); return false; }
  const st = await answer(bot);
  if (st?.conquest && await bot.sees('[data-act="done"]')) await bot.click('[data-act="done"]');
  return true;
}

/** Play `turns` world turns with one battle (the matrix cell's whole game). */
export async function playWorld(bot, cell, rec, { startMetrics, readMetrics, turns = 3 } = {}) {
  rec.t0 = Date.now();
  let st = await runState(bot);
  rec.world = { home: st.home, startTerritories: st.mine, turns: 0 };
  let fought = false;
  for (let k = 0; k < turns && st.status === 'active'; k++) {
    await reinforce(bot, cell.profile);
    st = await runState(bot);
    if (st.phase !== 'attack') { bot.friction('stuck', `turn ${st.turn}: not in the attack phase after reinforcing (${st.phase})`); break; }
    const fightNow = !fought && (cell.profile === 'newcomer' ? k === 0 : k >= 1);
    if (cell.profile === 'newcomer' && k === 0) bot.log(`coach: ${(await coachText(bot)).slice(0, 140)}`);
    let attacks = 0;
    for (let a = 0; a < 6; a++) {
      const sugg = (await suggestions(bot)).filter((s) => fightNow || s.win >= (cell.profile === 'casual' ? 0.6 : 0.75));
      if (!sugg.length) break;
      if (!await selectAttack(bot, sugg[0])) { bot.friction('select', `could not select ${sugg[0].from} -> ${sugg[0].to}`); break; }
      if (fightNow && !fought) { fought = true; if (!await fight(bot, cell, rec, startMetrics, readMetrics)) return rec; st = await runState(bot); if (st.status !== 'active') break; continue; }
      const mineBefore = (await runState(bot)).mine;
      await bot.click(cell.profile === 'casual' ? '[data-act="blitz"]' : '[data-act="roll"]');
      await skipAnim(bot);
      if (cell.profile === 'newcomer') for (let r = 0; r < 4 && (await runState(bot)).sel?.dst && await bot.sees('[data-act="roll"]'); r++) { await bot.click('[data-act="roll"]'); await skipAnim(bot); } // (rolls again until it falls or gives up)
      st = await runState(bot);
      if (st.conquest && await bot.sees('[data-act="done"]')) await bot.click('[data-act="done"]');
      attacks++;
      if (st.mine <= mineBefore && cell.profile === 'newcomer') break;
    }
    // fortify (casual): the biggest stack towards a border
    if (cell.profile === 'casual' && await bot.sees('[data-act="fortify"]')) {
      await bot.click('[data-act="fortify"]');
      const src = await Wd(bot, () => { const w = window.__world, r = w.run; return r.territories.filter((t) => t.owner === r.player && t.troops > 2 && (w.view.fortifyTargets?.(t.id) ?? []).length).sort((a, b) => b.troops - a.troops)[0]?.id ?? null; });
      if (src) { await tapTerritory(bot, src, 'fortify'); const t = bot.page.locator(`${SIDE} [data-tgt]`).first(); if (await t.count()) { await t.click(); await sleep(300); if (await bot.sees('[data-act="move"]')) await bot.click('[data-act="move"]'); } }
    }
    const turn = (await runState(bot)).turn;
    if (await bot.sees('[data-act="end"]')) await bot.click('[data-act="end"]');
    else if (await bot.sees('[data-act="next"]')) await bot.click('[data-act="next"]');
    st = await answer(bot);
    if (st.status === 'active' && st.turn === turn) { bot.friction('stuck', `End turn left the run on turn ${turn} (${st.phase})`); break; }
    rec.world.turns++;
    bot.log(`turn ${turn} done: ${attacks} attacks, ${st.mine} territories`);
  }
  st = await runState(bot);
  rec.world.endTerritories = st.mine;
  rec.world.status = st.status;
  rec.world.turn = st.turn;
  if (!fought) bot.friction('missing', 'no battle was fought in the world turns played');
  await bot.shot('world-end');
  return rec;
}
