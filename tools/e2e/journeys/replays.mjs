// Replays: a match left early is kept as a replay; watch it from the Replays screen at 8×, switch the player view
// (another player, then the observer), take command at a moment and play the branch, which the Replays screen
// then lists under its original.
import { sleep } from '../lib.mjs';

const P = '.main-screen:not(.leaving) .mm-panel';

export default async function replays(bot) {
  await bot.goto();
  await bot.waitMenu();
  // ---- a short match to record: small map, a Company start, one attack-move
  await bot.click(`${P} .seg button[data-v="64"]`);
  await bot.click(`${P} .seg button[data-v="heavy"]`);
  await bot.click(`${P} .deploy`);
  await bot.waitMatch();
  const seed = await bot.g((g) => g.setup.seed);
  await bot.key('e');
  const foe = (await bot.enemies()).units[0];
  if (foe) await bot.attackMove(foe.x, foe.y);
  await bot.wait(60);
  const recorded = await bot.g((g) => ({ tick: g.world.tick, rec: !!g.recorder }));
  bot.check(recorded.rec, 'the match is being recorded');
  await bot.quitToMenu();

  // ---- the Replays screen lists it
  await bot.nav('Replays');
  const listed = await bot.waitFor('.rpl-list .rpl-btn.watch', undefined, 30000);
  const rows = await bot.page.locator('.rpl-list .rpl-btn.watch').count();
  bot.check(listed && rows === 1, 'the match left early is listed in Replays', `${rows} rows`);
  await bot.shot('replays-list');
  await bot.click('.rpl-list .rpl-btn.watch >> nth=0');
  await bot.waitMatch();
  const pb = await bot.g((g) => ({ replay: !!g.setup.replay, seed: g.setup.seed, players: g.world.players.length, local: g.local.id }));
  bot.check(pb.replay && pb.seed === seed, 'Watch plays the replay of that match', pb);
  bot.check(await bot.sees('.rp-speed'), 'the replay controls are shown');

  // ---- 8×: the clock runs eight times faster than at 1×
  await bot.click('.rp-speed[data-speed="8"]');
  const sp = await bot.g((g) => g.speed);
  const t0 = await bot.simTime(), w0 = Date.now();
  await bot.page.waitForFunction((t) => window.__game.world.time > t + 6, t0, { timeout: 120000 * bot.o.slow, polling: 250 }).catch(() => {});
  const rate = ((await bot.simTime()) - t0) / ((Date.now() - w0) / 1000);
  bot.check(sp === 8, 'the 8× button sets the replay speed', `speed ${sp}, ${rate.toFixed(1)} game s per s (frame-bound on a software GPU)`);
  await bot.shot('replay-8x');

  // ---- player view: the other player, then the observer
  const pls = await bot.page.locator('.rp-pl:not(.rp-obs)').count();
  if (pls >= 2) {
    await bot.click('.rp-pl:not(.rp-obs) >> nth=1');
    const v = await bot.g((g) => g.local.id);
    bot.check(v !== pb.local, 'switching the player view looks through the other player', `local ${pb.local} -> ${v}`);
    await bot.shot('view-other');
  } else bot.check(false, 'the replay lists both players', pls);
  await bot.click('.rp-pl.rp-obs');
  const fogOff = await bot.g((g) => g.gfx.fog.enabled === false);
  bot.check(fogOff, 'the observer view has no fog of war');
  await bot.click('.rp-pl:not(.rp-obs) >> nth=0');
  await bot.click('.rp-speed[data-speed="1"]');

  // ---- take command at this moment: the replay becomes a playable branch
  const at = await bot.g((g) => g.world.tick);
  await bot.click('.rp-take');
  await bot.waitFor('[data-a="take"]');
  await bot.shot('take-command');
  await bot.click('[data-a="take"]');
  await bot.page.waitForFunction(() => window.__game && window.__game.setup.branch && !window.__game.setup.replay, null, { timeout: 180000 * bot.o.slow, polling: 500 }).catch(() => {});
  await bot.waitMatch();
  const br = await bot.g((g) => ({ branch: !!g.setup.branch, replay: !!g.setup.replay, tick: g.world.tick, hud: !!document.querySelector('#ui :is(#buildbar, #sidebar)') }));
  bot.check(br.branch && !br.replay && Math.abs(br.tick - at) < 200, 'Take command continues from that moment as a playable branch', { ...br, at });
  // play the branch for a bit with real orders
  await bot.key('e');
  const sel = await bot.g((g) => g.selection.size);
  const f2 = (await bot.enemies()).units[0];
  if (f2) await bot.attackMove(f2.x, f2.y);
  await bot.wait(40); // (a branch is kept once it is 30 s long: src/replay/recorder.ts MIN_TICKS)
  bot.check(sel > 0, 'the branch takes orders', `${sel} selected`);
  await bot.shot('branch');
  await bot.quitToMenu();

  // ---- the branch is listed under its original
  await bot.nav('Replays');
  await bot.waitFor('.rpl-list .rpl-btn.watch');
  await sleep(500);
  const tree = await bot.page.evaluate(() => [...document.querySelectorAll('.rpl-list .rpl-row, .rpl-list > *')].map((r) => ({ d: r.style.getPropertyValue('--d'), t: r.textContent.replace(/\s+/g, ' ').slice(0, 60) })));
  bot.check(tree.filter((r) => r.d !== '').length >= 2 && tree.some((r) => +r.d > 0), 'Replays shows the branch under the original', tree);
  await bot.shot('replays-tree');
  await bot.key('Escape', 600);
  await bot.waitMenu();
}
