// World Conquest through the real UI: the menu entry, the homeland picker and options, the seeded challenge link,
// a whole first turn (reinforce, attack with one roll and with a blitz, move in, fortify, end the turn and watch the
// rivals' playback), the cards drawer, diplomacy (a ceasefire offer), the war diary, an RTS battle fought from the
// odds panel and played to its end, the battle report and the way back to the turn screen, the share card (a PNG
// download), save and resume from the main menu, and the accessible list view driven by the keyboard. Every screen
// is audited (Bot.audit: clipped, off-screen or untranslated text) and checked for console errors and CSP violations.
//
// Orders are clicks, taps and key presses. window.__world (the screen's own object) is read only: for aiming at a
// territory on the globe (its screen position) and for assertions.
//
//   node tools/e2e/run.mjs world [--size 390x844 --touch --mobile] [--lang de]
//   E2E_WORLD_BATTLE=play|win (default play: the newcomer profile fights the battle; win: a forced win, quicker)
import { sleep } from '../lib.mjs';
import { PLAY, over } from '../profiles.mjs';

const MAIN = '.main-screen:not(.leaving)';
const SIDE = '.wc-side';

/** Read the world screen (window.__world) in the page. */
export const Wd = (bot, fn, arg) => bot.page.evaluate(fn, arg);
export const runState = (bot) => Wd(bot, () => {
  const w = window.__world, r = w?.run;
  if (!r) return null;
  return {
    id: r.id, seed: r.seed, home: r.home, size: r.size, difficulty: r.difficulty, turn: r.turn, phase: r.phase, toPlace: r.toPlace, status: r.status,
    current: r.current, pending: !!r.pending, defence: !!r.defence, conquest: r.conquest, fortifiesLeft: r.fortifiesLeft,
    mine: r.territories.filter((t) => t.owner === r.player).length, troops: r.territories.filter((t) => t.owner === r.player).reduce((s, t) => s + t.troops, 0),
    cards: r.powers[r.player].cards.length, ceasefires: r.powers.filter((p) => p.ceasefire >= r.turn).length, log: r.log.length,
    sel: w.view?.sel ? { ...w.view.sel } : null,
  };
});

/** Where a territory is on screen now (null: on the far side of the globe or off screen). */
async function terrPoint(bot, id) {
  return Wd(bot, (id) => {
    const w = window.__world, i = w.siteOf(id);
    const p = i >= 0 ? w.globe.screenOf(i) : null;
    if (!p) return null;
    const r = w.stage.getBoundingClientRect();
    const x = p.x + r.left, y = p.y + r.top;
    if (x < 4 || y < 4 || x > innerWidth - 4 || y > innerHeight - 4) return null;
    const top = document.elementFromPoint(x, y);
    return { x, y, covered: !!top && !w.globe.el.contains(top) && top !== w.globe.el ? `${top.tagName.toLowerCase()}.${[...top.classList].join('.')}` : null };
  }, id);
}

/** Tap a territory on the globe like a player (a tap, or a mouse click); falls back to the list view's row. */
export async function tapTerritory(bot, id, what) {
  let p = await terrPoint(bot, id);
  if (!p || p.covered) {
    // a player turns the globe to find it: the screen's own framing (Space / its suggestion buttons) is not a tap, so
    // the bot drags the globe a little towards the centre a few times, then uses the list view
    for (let k = 0; k < 3 && (!p || p.covered); k++) {
      const box = await bot.page.locator('.wc-stage canvas').first().boundingBox().catch(() => null);
      if (!box) break;
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      await bot.page.mouse.move(cx, cy); await bot.page.mouse.down(); await bot.page.mouse.move(cx + 80, cy, { steps: 6 }); await bot.page.mouse.up();
      await sleep(500);
      p = await terrPoint(bot, id);
    }
  }
  if (!p || p.covered) {
    bot.friction('globe', `${what}: ${id} not tappable on the globe (${p ? `covered by ${p.covered}` : 'not on screen'}); used the list view`);
    await bot.key('l', 500);
    const row = bot.page.locator(`.wc-list .wc-row[data-id="${id}"]`).first();
    if (!await row.count()) return false;
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click();
    await sleep(400);
    await bot.key('l', 400); // (back to the globe)
    return true;
  }
  if (bot.o.touch) await bot.page.touchscreen.tap(p.x, p.y); else await bot.page.mouse.click(p.x, p.y);
  await sleep(450);
  return true;
}

/**
 * An attack open to me now (read from the screen's run, for aiming): over a land border unless `sea`, optionally on a
 * landmark territory; the biggest stack first. Null when there is none.
 */
export async function findAttack(bot, { landmark = false, sea = false } = {}) {
  return Wd(bot, ([landmark, sea]) => {
    const w = window.__world, r = w.run, v = w.view;
    const T = r.territories, byId = new Map(T.map((t) => [t.id, t]));
    const seaLink = (a, b) => r.links.some((l) => ((l.a === a && l.b === b) || (l.a === b && l.b === a)) && l.sea);
    const out = [];
    for (const t of T.filter((x) => x.owner === r.player && x.troops > 1).sort((a, b) => b.troops - a.troops)) {
      for (const to of v?.targets?.(t.id) ?? []) {
        const d = byId.get(to);
        if (!d || (landmark && !d.landmark) || seaLink(t.id, to) !== sea) continue;
        out.push({ from: t.id, to, landmark: d.landmark ?? null });
      }
    }
    return out[0] ?? null;
  }, [landmark, sea]);
}

/**
 * End the battle in progress as a win (a test shortcut, after the profile has played): clear the enemy out
 * (Bot.forceEnd); a hold battle still wants its zone held, so then the mission's own win, as the UI's flow does.
 */
export async function forceWin(bot) {
  if (await bot.forceEnd(true, 30)) return true;
  bot.log('no end after clearing the enemy (a hold battle wants its zone held): the mission\'s win');
  await bot.page.evaluate(() => { const g = window.__game; if (!g.world.gameOver && !g.world.mission?.ended) { g.world.mission.won = true; g.paused = true; g.cb.onEnd(g, true); } });
  return bot.page.waitForSelector('.wc-modal [data-go]', { state: 'visible', timeout: 120000 * bot.o.slow }).then(() => true, () => false);
}

/** Skip an animation (the dice, the rivals' playback) the way the screen offers: a key press. */
export async function skipAnim(bot) {
  for (let k = 0; k < 40; k++) {
    const busy = await Wd(bot, () => { const v = window.__world?.view; return !!(v && (v.playing || v.busy)) || !!document.querySelector('.wc-dice'); });
    if (!busy) return true;
    await bot.key(k % 3 === 2 ? 'Escape' : 'Space', 400);
  }
  return false;
}

/** Answer whatever a rival's turn left waiting: a defence choice (dice) or a ceasefire offer (decline). */
async function answerPrompts(bot) {
  for (let k = 0; k < 12; k++) {
    await skipAnim(bot);
    const st = await runState(bot);
    if (!st || st.status !== 'active' || (st.current === 0 && !st.defence)) return st;
    if (await bot.sees('.wc-modal [data-no]')) { await bot.click('.wc-modal [data-no]'); continue; }
    if (await bot.sees('[data-act="dice"]')) { await bot.click('[data-act="dice"]'); continue; }
    await sleep(800);
  }
  return runState(bot);
}

export default async function world(bot) {
  await bot.goto();
  await bot.waitMenu();
  const entry = `${MAIN} .mm-nav-btn[data-nav="world"]`;
  if (!bot.check(await bot.sees(entry), 'the main menu has a World Conquest entry')) return;
  await bot.audit('main menu');
  await bot.click(entry);

  // ---------------------------------------------------------------------------------------------------- setup
  const t0 = Date.now();
  bot.check(await bot.waitFor(`${SIDE} [data-home]`, undefined, 90000), 'the homeland picker opens');
  await sleep(1200);
  const homes = await bot.page.$$eval(`${SIDE} [data-home]`, (l) => l.map((b) => b.dataset.home));
  bot.check(homes.length >= 30, 'about 40 homelands to start from', `${homes.length}`);
  await bot.audit('homeland picker');
  await bot.shot('picker');
  // pick one by click (the 4th: not the default)
  const pickHome = homes[Math.min(3, homes.length - 1)];
  await bot.click(`${SIDE} [data-home="${pickHome}"]`);
  const sel = await bot.page.$eval(`${SIDE} [data-home="${pickHome}"]`, (b) => b.getAttribute('aria-selected')).catch(() => null);
  bot.check(sel === 'true', 'a tapped homeland is selected', `${pickHome}: aria-selected ${sel}`);
  // keyboard: arrows move the selection in the list (a listbox)
  await bot.page.locator(`${SIDE} [data-home="${pickHome}"]`).focus().catch(() => {});
  await bot.key('ArrowDown', 400);
  const focused = await bot.page.evaluate(() => document.activeElement?.getAttribute('data-home'));
  bot.check(!!focused && focused !== pickHome, 'ArrowDown moves through the homelands', `${pickHome} -> ${focused}`);
  if (focused) await bot.key('Enter', 400);
  const chosen = focused ?? pickHome;
  // the options step: Blitz, Easy
  if (await bot.sees(`${SIDE} [data-act="opts"]`)) await bot.click(`${SIDE} [data-act="opts"]`);
  else if (await bot.sees(`${SIDE} [data-act="begin"]`)) { /* (the picker's Begin goes on with the defaults) */ }
  if (await bot.waitFor(`${SIDE} [data-size="blitz"]`, undefined, 10000)) {
    await bot.click(`${SIDE} [data-size="blitz"]`);
    await bot.click(`${SIDE} [data-diff="easy"]`);
    await bot.audit('world options');
    await bot.shot('options');
  } else bot.friction('missing', 'no size / difficulty options before Begin');
  // the challenge link (copied to the clipboard)
  let link = null;
  if (await bot.sees(`${SIDE} [data-act="link"]`)) {
    await bot.click(`${SIDE} [data-act="link"]`);
    await sleep(600);
    link = await bot.page.evaluate(() => navigator.clipboard?.readText?.().catch(() => null) ?? null).catch(() => null);
    if (bot.o.browser === 'chromium' && !bot.o.cdp) bot.check(!!link && /#world=[0-9a-z]+&home=/.test(link), 'Copy link puts a #world= challenge link on the clipboard', String(link).slice(0, 160));
  }
  await bot.click(`${SIDE} [data-act="begin"]`);
  bot.check(await bot.waitFor('.wc-top', undefined, 60000), 'Begin opens the turn screen');
  let st = await runState(bot);
  bot.check(st && st.home === chosen && st.size === 'blitz' && st.difficulty === 'easy', 'the run starts from the homeland and options chosen', JSON.stringify(st && { home: st.home, size: st.size, diff: st.difficulty, chosen }));
  bot.log(`run ${st?.id} from ${st?.home}: turn ${st?.turn} ${st?.phase}, ${st?.mine} territories, ${st?.toPlace} to place`);
  await sleep(1000);
  await bot.audit('turn screen (reinforce)');
  await bot.shot('turn-1');
  await bot.noErrors('setup');

  // ---------------------------------------------------------------------------------------------------- reinforce
  const coach = await bot.sees('.wc-coach');
  bot.log(`coach ${coach ? 'shown: ' + (await bot.page.textContent('.wc-coach').catch(() => '')).replace(/\s+/g, ' ').slice(0, 120) : 'not shown'}`);
  const myBest = () => Wd(bot, () => { const r = window.__world.run; return r.territories.filter((t) => t.owner === r.player).sort((a, b) => b.troops - a.troops || (a.capital === r.player ? -1 : 1))[0]?.id; });
  const cap = await myBest();
  await tapTerritory(bot, cap, 'reinforce');
  st = await runState(bot);
  bot.check(st.sel?.src === cap, 'tapping my territory selects it for reinforcements', JSON.stringify(st.sel));
  if (await bot.sees('[data-act="plus"]')) { await bot.click('[data-act="plus"]'); await bot.click('[data-act="minus"]'); }
  if (await bot.sees('[data-act="place"]')) { const before = st.toPlace; await bot.click('[data-act="place"]'); st = await runState(bot); bot.check(st.toPlace < before, 'Place puts troops down', `${before} -> ${st.toPlace}`); }
  if (st.toPlace > 0) { await bot.click('[data-act="all"]'); st = await runState(bot); }
  bot.check(st.toPlace === 0, 'every reinforcement placed (Place all)', `toPlace ${st.toPlace}`);
  await bot.click('[data-act="next"]');
  st = await runState(bot);
  bot.check(st.phase === 'attack', 'Next moves to the attack phase', st.phase);
  await bot.audit('turn screen (attack)');

  // ---------------------------------------------------------------------------------------------------- attack: one roll, then a blitz
  const pickAttack = (avoid = []) => Wd(bot, (avoid) => {
    const w = window.__world, v = w.view, r = w.run;
    const s = (v.suggestions?.(6) ?? []).filter((x) => !avoid.includes(x.to));
    return s[0] ? { from: s[0].from, to: s[0].to, win: s[0].odds?.win ?? null } : null;
  }, avoid);
  let a = await pickAttack();
  bot.check(!!a, 'the attack phase offers attacks (suggestions)');
  if (a) {
    await tapTerritory(bot, a.from, 'attack source');
    await tapTerritory(bot, a.to, 'attack target');
    st = await runState(bot);
    if (st.sel?.dst !== a.to) { bot.friction('select', `tapping ${a.from} then ${a.to} selected ${JSON.stringify(st.sel)}; using the suggestion button`); const b = bot.page.locator(`[data-sugg="${a.from}|${a.to}"]`).first(); if (await b.count()) { await b.click(); await sleep(500); } }
    const odds = (await bot.page.textContent(SIDE).catch(() => '')) ?? '';
    bot.check(/\d+\s?%/.test(odds), 'the odds are shown before committing', odds.replace(/\s+/g, ' ').slice(0, 160));
    await bot.shot('odds');
    await bot.audit('odds panel');
    const before = await Wd(bot, ([f, t]) => { const r = window.__world.run; return [r.territories.find((x) => x.id === f).troops, r.territories.find((x) => x.id === t).troops]; }, [a.from, a.to]);
    await bot.click('[data-act="roll"]');
    await sleep(600);
    const diceShown = await bot.sees('.wc-dice');
    await skipAnim(bot);
    const after = await Wd(bot, ([f, t]) => { const r = window.__world.run; return [r.territories.find((x) => x.id === f).troops, r.territories.find((x) => x.id === t).troops, r.territories.find((x) => x.id === t).owner === r.player]; }, [a.from, a.to]);
    bot.check(after[2] || after[0] + after[1] < before[0] + before[1], 'one roll costs troops on one side or the other', `${before} -> ${after}${diceShown ? ' (dice shown)' : ''}`);
    if (await bot.sees('[data-act="done"]')) await bot.click('[data-act="done"]');
    // blitz on the best attack now
    a = await pickAttack();
    if (a) {
      const b = bot.page.locator(`[data-sugg="${a.from}|${a.to}"]`).first();
      if (await b.count() && await b.isVisible()) { await b.click(); await sleep(500); } else { await tapTerritory(bot, a.from, 'blitz source'); await tapTerritory(bot, a.to, 'blitz target'); }
      const mineBefore = (await runState(bot)).mine;
      if (await bot.sees('[data-act="blitz"]')) {
        await bot.click('[data-act="blitz"]');
        await skipAnim(bot);
        st = await runState(bot);
        bot.log(`blitz ${a.from} -> ${a.to} (${a.win}): ${st.mine > mineBefore ? 'conquered' : 'failed'}`);
        if (st.conquest && await bot.sees('[data-act="mplus"]')) {
          await bot.shot('move-in');
          await bot.audit('move-in panel');
          await bot.click(st.conquest.moved < st.conquest.max ? '[data-act="mplus"]' : '[data-act="mminus"]');
          const st2 = await runState(bot);
          bot.check(st2.conquest && st2.conquest.moved !== st.conquest.moved, 'the move-in buttons change the troops moved in', `${st.conquest.moved} -> ${st2.conquest?.moved}`);
          await bot.click('[data-act="done"]');
        }
      } else bot.friction('missing', 'no Blitz button on the odds panel');
    }
  }
  await bot.noErrors('attack');

  // ---------------------------------------------------------------------------------------------------- cards, rivals (diplomacy), war diary
  await bot.click('[data-tool="cards"]');
  bot.check(await bot.waitFor('.wc-modal, .wc-drawer', undefined, 8000), 'the cards drawer opens');
  await bot.audit('cards');
  await bot.shot('cards');
  await bot.key('Escape', 600);
  await bot.click('[data-tool="rivals"]');
  bot.check(await bot.waitFor('.wc-modal, .wc-drawer', undefined, 8000), 'the rivals drawer opens');
  await bot.audit('rivals');
  await bot.shot('rivals');
  const offer = bot.page.locator('[data-offer]').locator('visible=true').first();
  if (await offer.count()) {
    const cf0 = (await runState(bot)).ceasefires, log0 = (await runState(bot)).log;
    await offer.click();
    await sleep(900);
    const s1 = await runState(bot);
    bot.check(s1.ceasefires > cf0 || s1.log > log0, 'a ceasefire offer gets an answer (accepted or refused)', `ceasefires ${cf0} -> ${s1.ceasefires}, diary ${log0} -> ${s1.log}`);
    await bot.audit('diplomacy answer');
    await bot.shot('diplomacy');
  } else bot.friction('missing', 'no ceasefire offer button in the rivals drawer');
  await bot.key('Escape', 600);
  if (await bot.sees('.wc-modal')) await bot.key('Escape', 600);
  await bot.click('[data-tool="log"]');
  bot.check(await bot.waitFor('.wc-modal, .wc-drawer', undefined, 8000), 'the war diary opens');
  await bot.audit('war diary');
  await bot.key('Escape', 600);
  await bot.noErrors('drawers');

  // ---------------------------------------------------------------------------------------------------- fortify, end the turn
  st = await runState(bot);
  if (st.phase === 'attack' && await bot.sees('[data-act="fortify"]')) await bot.click('[data-act="fortify"]');
  st = await runState(bot);
  bot.check(st.phase === 'fortify', 'To fortify moves to the fortify phase', st.phase);
  const fsrc = await Wd(bot, () => { const w = window.__world, r = w.run; return r.territories.filter((t) => t.owner === r.player && t.troops > 1 && (w.view.fortifyTargets?.(t.id) ?? []).length).sort((a, b) => b.troops - a.troops)[0]?.id ?? null; });
  if (fsrc) {
    await tapTerritory(bot, fsrc, 'fortify source');
    const tgt = bot.page.locator(`${SIDE} [data-tgt]`).first();
    if (await tgt.count()) { await tgt.click(); await sleep(400); }
    if (await bot.sees('[data-act="move"]')) {
      const tr0 = await runState(bot);
      await bot.audit('fortify panel');
      await bot.click('[data-act="move"]');
      const tr1 = await runState(bot);
      bot.check(tr1.fortifiesLeft < tr0.fortifiesLeft && tr1.troops === tr0.troops, 'a fortify move moves troops (none lost)', `left ${tr0.fortifiesLeft} -> ${tr1.fortifiesLeft}, troops ${tr0.troops} -> ${tr1.troops}`);
    } else bot.friction('missing', `fortify: no Move button after picking ${fsrc} and a destination`);
  } else bot.log('fortify: nothing to move');
  const turn1 = st.turn;
  await bot.click('[data-act="end"]');
  st = await answerPrompts(bot);
  bot.check(st.status !== 'active' || (st.turn === turn1 + 1 && st.phase === 'reinforce'), 'ending the turn plays the rivals and comes back for my next reinforcements', JSON.stringify({ turn: st.turn, phase: st.phase, status: st.status }));
  await bot.audit('turn 2');
  await bot.shot('turn-2');
  await bot.noErrors('end turn');
  if (st.status !== 'active') { bot.log(`run over at turn ${st.turn}: ${st.status}`); return; }

  // ---------------------------------------------------------------------------------------------------- an RTS battle
  if (st.toPlace > 0) { await tapTerritory(bot, await myBest(), 'reinforce 2'); if (await bot.sees('[data-act="all"]')) await bot.click('[data-act="all"]'); }
  if (await bot.sees('[data-act="trade"]')) await bot.click('[data-act="trade"]');
  if ((await runState(bot)).toPlace > 0 && await bot.sees('[data-act="all"]')) await bot.click('[data-act="all"]');
  await bot.click('[data-act="next"]');
  a = await pickAttack();
  if (!bot.check(!!a, 'turn 2 offers an attack to fight')) return;
  const b2 = bot.page.locator(`[data-sugg="${a.from}|${a.to}"]`).first();
  if (await b2.count() && await b2.isVisible()) { await b2.click(); await sleep(500); } else { await tapTerritory(bot, a.from, 'fight source'); await tapTerritory(bot, a.to, 'fight target'); }
  if (!bot.check(await bot.sees('[data-act="fight"]'), 'the odds panel offers Fight it')) return;
  await bot.audit('fight preview');
  await bot.click('[data-act="fight"]');
  if (await bot.sees('.wc-modal [data-yes]')) await bot.click('.wc-modal [data-yes]'); // (a confirmation, if the screen asks)
  const tB = Date.now();
  await bot.waitMatch();
  const spec = await bot.g((g) => ({ world: !!g.setup.conquest?.battle?.world, kind: g.setup.conquest?.battle?.kind, map: g.setup.conquest?.battle?.map?.label, landmark: g.world.map.landmarks?.[0]?.id ?? null, size: g.world.map.w }));
  bot.check(spec.world, 'Fight it starts an RTS battle on the region battlefield', JSON.stringify(spec));
  bot.log(`camera ${JSON.stringify(await bot.g((g) => ({ cam: [+g.gfx.cam.x.toFixed(1), +g.gfx.cam.y.toFixed(1), +g.gfx.cam.dist.toFixed(1), g.gfx.cam.targetDist], focus: g.world.map.startFocus, start: g.world.map.startPositions[0] })))}`);
  bot.log(`battle ${JSON.stringify(spec)} after ${Math.round((Date.now() - tB) / 1000)} s; first battle ${Math.round((Date.now() - t0) / 1000)} s after the picker opened`);
  if (spec.landmark) {
    // the landmark in the opening view: on screen inside the play area
    const lm = await bot.g((g) => { const l = g.world.map.landmarks[0]; return { x: l.cx + l.w / 2, y: l.cy + l.h / 2 }; });
    const p = await bot.toScreen(lm.x, lm.y, 2);
    const open = p && await bot.page.evaluate((p) => p.x >= 0 && p.y >= 0 && p.x < innerWidth && p.y < innerHeight && document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS', p);
    bot.check(open, 'the landmark is in the opening view (uncovered by the HUD)', `${spec.landmark} at ${JSON.stringify(p)}`);
  }
  await bot.shot('battle-start');
  await bot.audit('battle HUD');
  await bot.noErrors('battle start');
  const mode = process.env.E2E_WORLD_BATTLE ?? 'play';
  if (mode === 'play') {
    const r = await PLAY.newcomer(bot, { maxSim: 1500 });
    bot.log(`newcomer played the battle: ${r.result} ${r.notes ?? ''}`);
  }
  let fin = await over(bot);
  if (!fin) { bot.log('battle still running: forcing a win to go on'); await forceWin(bot); fin = { won: true }; }
  bot.check(await bot.page.waitForSelector('.wc-modal [data-go]', { state: 'visible', timeout: 420000 * bot.o.slow }).then(() => true, () => false), 'the battle ends with the World Conquest battle report');
  await sleep(1200);
  await bot.audit('battle report');
  await bot.shot('report');
  await bot.click('.wc-modal [data-go]');
  bot.check(await bot.waitFor('.wc-top', undefined, 90000), 'Continue goes back to the turn screen');
  st = await answerPrompts(bot);
  bot.check(st && !st.pending, 'the battle result is applied to the run', JSON.stringify({ pending: st?.pending, turn: st?.turn, phase: st?.phase, mine: st?.mine }));
  if (st?.conquest && await bot.sees('[data-act="done"]')) { await bot.audit('move-in after the battle'); await bot.click('[data-act="done"]'); } // (a won battle moves troops in)
  await sleep(1500);
  await bot.audit('turn screen after the battle');
  await bot.shot('after-battle');
  await bot.noErrors('battle');
  if (st.status !== 'active') return;

  // ---------------------------------------------------------------------------------------------------- the list view by keyboard
  await bot.page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
  await bot.key('l', 700);
  const listOn = await bot.sees('.wc-list .wc-row');
  bot.check(listOn, 'L opens the list view of the territories');
  if (listOn) {
    await bot.page.locator('.wc-list .wc-row').first().focus();
    // arrow down to the first row of mine that can attack (Enter on it picks it as the attack's source, as a tap does)
    const want = await Wd(bot, () => { const r = window.__world.run; const rows = [...document.querySelectorAll('.wc-list .wc-row')].map((b) => b.dataset.id); const i = rows.findIndex((id) => { const t = r.territories.find((x) => x.id === id); return t && t.owner === r.player && t.troops > 1; }); return { i, id: rows[i] ?? null }; });
    for (let k = 0; k < Math.max(3, want.i); k++) await bot.key('ArrowDown', 120);
    if (want.i >= 0 && want.i < 3) for (let k = 0; k < 3 - want.i; k++) await bot.key('ArrowUp', 120);
    const f = await bot.page.evaluate(() => ({ id: document.activeElement?.dataset?.id, label: document.activeElement?.getAttribute('aria-label') }));
    bot.check(!!f.id && !!f.label && f.label.length > 6, 'arrows move through rows that read out territory, owner and troops', JSON.stringify(f));
    await bot.key('Enter', 600);
    const s2 = await runState(bot);
    if (want.id) bot.check(f.id === want.id && (s2.sel?.src === f.id || s2.sel?.dst === f.id), 'Enter on a row of mine picks it as the source, as a tap on the globe does', JSON.stringify({ row: f.id, want: want.id, sel: s2.sel, phase: s2.phase }));
    await bot.audit('list view');
    await bot.shot('list');
    await bot.key('Escape', 500);
    if (await bot.sees('.wc-list .wc-row')) await bot.key('Escape', 500);
    bot.check(!await bot.sees('.wc-list .wc-row'), 'Esc closes the list view');
  }

  // ---------------------------------------------------------------------------------------------------- the share card
  await bot.key('Escape', 700);
  if (!await bot.sees('[data-m="share"]')) await bot.click('[data-tool="menu"]').catch(() => {});
  if (bot.check(await bot.waitFor('[data-m="share"]', undefined, 8000), 'the menu offers Share')) {
    await bot.audit('world menu');
    await bot.click('[data-m="share"]');
    bot.check(await bot.waitFor('[data-s="dl"]', undefined, 15000), 'the share card opens');
    await sleep(800);
    await bot.audit('share card');
    await bot.shot('share');
    const dl = bot.page.waitForEvent('download', { timeout: 20000 * bot.o.slow }).catch(() => null);
    await bot.click('[data-s="dl"]');
    const d = await dl;
    let png = null;
    if (d) { const p = await d.path().catch(() => null); if (p) { const fs = await import('node:fs'); const b = fs.readFileSync(p); png = { bytes: b.length, sig: b.subarray(1, 4).toString(), name: d.suggestedFilename() }; } }
    bot.check(png && png.sig === 'PNG' && png.bytes > 20000, 'Download saves the share card as a PNG', JSON.stringify(png));
    await bot.key('Escape', 600);
  }

  // ---------------------------------------------------------------------------------------------------- save, back to the menu, resume
  if (await bot.sees('.wc-modal')) await bot.key('Escape', 600);
  const saved = await runState(bot);
  await bot.key('Escape', 700);
  if (await bot.waitFor('[data-m="save"]', undefined, 8000)) await bot.click('[data-m="save"]');
  else bot.friction('missing', 'no Save and quit in the world menu');
  bot.check(await bot.waitFor(`${MAIN} .mm-nav-btn`, undefined, 60000), 'Save and quit goes back to the main menu');
  await bot.waitMenu();
  const pill = (await bot.page.textContent(entry).catch(() => '')).replace(/\s+/g, ' ');
  bot.check(new RegExp(String(saved.turn)).test(pill), 'the menu entry shows the run in progress (its turn)', pill);
  await bot.click(entry);
  if (await bot.waitFor(`${SIDE} [data-act="resume"]`, undefined, 20000)) await bot.click(`${SIDE} [data-act="resume"]`);
  bot.check(await bot.waitFor('.wc-top', undefined, 60000), 'the run resumes on the turn screen');
  const back = await runState(bot);
  bot.check(back && back.id === saved.id && back.turn === saved.turn && back.troops === saved.troops && back.mine === saved.mine, 'the resumed run is the saved one', `${JSON.stringify({ id: back?.id, turn: back?.turn, troops: back?.troops })} vs ${JSON.stringify({ id: saved.id, turn: saved.turn, troops: saved.troops })}`);
  await bot.noErrors('resume');

  // ---------------------------------------------------------------------------------------------------- the challenge link, in a fresh profile
  if (link) {
    const hash = link.slice(link.indexOf('#'));
    await bot.open();
    await bot.goto({}, hash);
    bot.check(await bot.waitFor(`${SIDE} [data-act="begin"]`, undefined, 120000), 'a challenge link opens the world setup');
    await sleep(800);
    await bot.audit('challenge link setup');
    await bot.shot('link');
    await bot.click(`${SIDE} [data-act="begin"]`);
    await bot.waitFor('.wc-top', undefined, 60000);
    const L = await runState(bot);
    const want = await bot.page.evaluate((h) => { const q = new URLSearchParams(h.slice(1)); return { seed: parseInt(q.get('world'), 36), home: q.get('home'), size: q.get('size'), diff: q.get('diff') }; }, hash);
    bot.check(L && L.seed === want.seed && L.home === want.home && L.size === want.size && L.difficulty === want.diff, 'the link starts the same world (seed, homeland, size, difficulty)', `${JSON.stringify(L && { seed: L.seed, home: L.home, size: L.size, diff: L.difficulty })} vs ${JSON.stringify(want)}`);
    await bot.noErrors('challenge link');
  }
}
