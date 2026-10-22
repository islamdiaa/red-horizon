// First launch on a fresh profile: the title screen and main menu, Quick Battle (a new profile starts on Recruit),
// the opening fly-over, then a whole match won through the UI: deploy the MCV, build power, a refinery, a barracks
// and a war factory from the build bar (placed with the mouse), train units, box-select, set a control group,
// attack-move, use a commander power, win, check the results screen, then Play again.
import { sleep } from '../lib.mjs';
import { usePower, playToWin } from '../profiles.mjs';

export default async function firstLaunch(bot) {
  const t0 = Date.now();
  await bot.goto();
  const fresh = await bot.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('rh.')));
  await bot.waitMenu();
  bot.log(`menu up after ${((Date.now() - t0) / 1000).toFixed(1)}s; storage before the menu: ${fresh.join(',') || 'empty'}`);
  bot.check(await bot.sees('.main-screen .game-title'), 'the title is on the main menu');
  bot.check(await bot.sees('.main-screen .mm-nav-btn', 'Boot Camp'), 'a fresh profile is offered Boot Camp ("start here")');
  await bot.shot('menu');
  await bot.noErrors('main menu');

  // ---- Quick Battle (one click)
  await bot.nav('Quick Battle');
  await bot.page.waitForSelector('#loading .qb-card', { state: 'visible', timeout: 20000 * bot.o.slow }).then(() => bot.shot('quick-battle-roll'), () => bot.log('no Quick Battle card on the loading screen (fast load)'));
  await bot.waitMatch({ skipIntro: false });
  const setup = await bot.g((g) => ({ quick: !!g.setup.quick, opp: g.setup.opponents.map((o) => o.difficulty), units: g.setup.startUnits, rules: g.setup.rules, size: g.world.map.w, mut: g.setup.mutators ?? [], intro: !!g.setup.intro, faction: g.local.faction }));
  bot.log('quick battle:', JSON.stringify(setup));
  bot.check(setup.quick, 'Quick Battle started a rolled skirmish');
  bot.check(setup.opp.length >= 1 && setup.opp.every((d) => d === 'recruit'), 'a new profile\'s Quick Battle is on Recruit', setup.opp);
  // the opening fly-over plays, and any key skips it
  const cine = await bot.page.evaluate(() => document.body.classList.contains('cine-active'));
  if (cine) {
    await sleep(1500);
    await bot.shot('intro');
    await bot.key('Space', 600);
    const ended = await bot.page.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 30000 * bot.o.slow, polling: 300 }).then(() => true, () => false);
    bot.check(ended, 'a key press skips the opening fly-over');
  } else bot.log('no opening fly-over (intro off)');
  await bot.settleCamera();
  await bot.shot('start');
  await bot.noErrors('match start');

  // ---- deploy the MCV: it is selected at the start; clicking it again deploys it (D also works)
  let me = await bot.mine();
  const mcv = me.units.find((u) => u.t === 'mcv');
  if (mcv) {
    await bot.lookAt(mcv.x, mcv.y);
    const sel = await bot.g((g, id) => g.selection.has(id), mcv.id);
    const p = await bot.toScreen(mcv.x, mcv.y, 0.4);
    if (!sel) { await bot.page.mouse.click(p.x, p.y); await sleep(300); }
    await bot.page.mouse.click(p.x, p.y);
    await bot.wait(3);
    me = await bot.mine();
    if (!me.blds.some((b) => b.t === 'fact')) {
      bot.log('clicking the MCV did not deploy it: pressing D');
      await bot.page.mouse.click(p.x, p.y); await sleep(200);
      await bot.key('d');
      await bot.wait(3);
      me = await bot.mine();
    }
  }
  bot.check(me.blds.some((b) => b.t === 'fact'), 'the MCV deployed into a construction yard', me.blds.map((b) => b.t));

  // ---- the base, from the build bar, placed with the mouse
  const barracks = me.faction === 'soviet' ? 'barr' : 'tent';
  for (const t of ['powr', 'proc', barracks, 'powr', 'weap']) {
    const ok = await bot.build(t);
    bot.check(ok, `built and placed ${t} with the mouse`);
  }
  me = await bot.mine();
  bot.log('base:', me.blds.map((b) => b.t).join(' '), 'credits', me.credits, 'power', me.power.join('/'));
  await bot.shot('base');
  bot.check(me.units.some((u) => u.harv), 'the refinery came with an ore truck', me.units.map((u) => u.t));
  await bot.noErrors('base building');

  // ---- an army: riflemen and tanks (repeat-queued with clicks on the cards)
  const tank = me.faction === 'soviet' ? '3tnk' : '2tnk';
  await bot.train('e1', 5);
  await bot.train(tank, 5);
  await bot.shot('queues');
  await bot.wait(90);

  // ---- box-select the army near the base, make it group 1, attack-move on the enemy base
  const fact = (await bot.mine()).blds.find((b) => b.t === 'fact');
  const n = await bot.boxSelectAround(fact.x, fact.y, 14);
  me = await bot.mine();
  const armed = me.units.filter((u) => u.armed).length;
  bot.check(n > 0, 'box selection picks up the army', `${n} selected of ${armed} armed units`);
  await bot.key('Control+1');
  const grp = await bot.g((g) => g.input?.groups?.get(1)?.length ?? 0);
  bot.check(grp > 0, 'Ctrl+1 assigns control group 1', grp);
  await bot.shot('selected');
  await bot.page.mouse.click((await bot.playArea()).x0 + 40, (await bot.playArea()).y0 + 40); // click away: deselect
  await sleep(300);
  await bot.key('1');
  const recalled = await bot.g((g) => g.selection.size);
  bot.check(recalled === n, 'pressing 1 recalls the group', `${recalled}/${n}`);

  // ---- a commander power (Commander rules): unlock one with command points, use it
  await usePower(bot);

  // ---- waves until the enemy is gone
  const won = await playToWin(bot, tank, barracks);
  await bot.shot('end-of-battle');
  bot.check(won, 'the match was won through the UI');
  await bot.noErrors('battle');
  if (!won) return;

  // ---- the results screen, then Play again
  const res = await bot.waitResults();
  bot.check(res, 'the results screen appears after the victory');
  await sleep(1500);
  await bot.shot('results');
  const resInfo = await bot.page.evaluate(() => ({ win: !!document.querySelector('.end-screen.win'), text: document.querySelector('.end-screen')?.innerText.replace(/\s+/g, ' ').slice(0, 300) }));
  bot.check(resInfo.win, 'the results screen shows a victory', resInfo.text);
  const seed0 = await bot.g((g) => g.setup.seed);
  await bot.click('.end-screen:not(.leaving) .rr-again');
  await bot.page.waitForFunction((s) => window.__game && !window.__game.setup.demo && window.__game.setup.seed !== s && window.__game.world.time < 30, seed0, { timeout: 180000 * bot.o.slow, polling: 500 }).catch(() => {});
  await bot.waitMatch();
  const again = await bot.g((g) => ({ quick: !!g.setup.quick, t: g.world.time, over: g.world.gameOver, seed: g.setup.seed }));
  bot.check(again.quick && !again.over && again.seed !== seed0, 'Play again starts a new Quick Battle', again);
  await bot.shot('play-again');
}

// (moved to tools/e2e/profiles.mjs, the experienced player's play; re-exported for the campaign journey)
export { usePower, playToWin } from '../profiles.mjs';
