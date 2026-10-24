// World Conquest: a lost RTS battle comes back to the turn screen. A Blitz run from the challenge link of
// world-landmark.mjs, the attack on Paris fought and lost (the bot's own side is cleared out: Bot.forceEnd(false)),
// then the World Conquest battle report says so and Continue leads back to the turn screen with the run updated.
import { sleep } from '../lib.mjs';
import { Wd, findAttack, runState, tapTerritory } from './world.mjs';

const SIDE = '.wc-side';

// E2E_WORLD_DEFEAT=<link>|<land|sea> picks another battle (e.g. a naval one: '#world=1&home=britain&size=blitz&diff=easy|sea')
const [LINK, KIND = 'land'] = (process.env.E2E_WORLD_DEFEAT ?? '#world=1&home=germany&size=blitz&diff=easy|land').split('|');

export default async function worldDefeat(bot) {
  await bot.goto({}, LINK);
  if (!bot.check(await bot.waitFor(`${SIDE} [data-act="begin"]`, undefined, 120000), 'the challenge link opens the setup')) return;
  await bot.click(`${SIDE} [data-act="begin"]`);
  await bot.waitFor('.wc-top', undefined, 60000);
  const mine = await Wd(bot, () => { const r = window.__world.run; return r.territories.filter((t) => t.owner === r.player).sort((a, b) => b.troops - a.troops)[0].id; });
  await tapTerritory(bot, mine, 'reinforce');
  if (await bot.sees('[data-act="all"]')) await bot.click('[data-act="all"]');
  await bot.click('[data-act="next"]');
  const a = await findAttack(bot, { sea: KIND === 'sea' });
  if (!bot.check(!!a, `a ${KIND} attack is open on turn 1`)) return;
  await tapTerritory(bot, a.from, 'attack source');
  await tapTerritory(bot, a.to, 'attack target');
  const before = await runState(bot);
  await bot.click('[data-act="fight"]');
  if (await bot.sees('.wc-modal [data-yes]')) await bot.click('.wc-modal [data-yes]');
  await bot.waitMatch();
  await bot.wait(Number(process.env.E2E_WORLD_DEFEAT_SECS) || 20);
  const t = Date.now();
  await bot.forceEnd(false);
  const ok = await bot.page.waitForSelector('.wc-modal [data-go]', { state: 'visible', timeout: 300000 * bot.o.slow }).then(() => true, () => false);
  const state = await bot.g((g) => ({ over: g.world.gameOver, defeated: g.local.defeated, ended: g.world.mission?.ended, won: g.world.mission?.won, reason: g.world.mission?.endReason, mine: g.world.units.filter((u) => u.alive && u.owner === g.local).length + g.world.buildings.filter((b) => b.alive && b.owner === g.local).length }));
  bot.log(`after the forced loss (${Math.round((Date.now() - t) / 1000)} s): ${JSON.stringify(state)}; screens: ${await bot.page.evaluate(() => [...document.querySelectorAll('.end-screen, .dbf, .wc-modal, .cq-modal, .pause-screen')].map((e) => e.className).join(' | '))}`);
  await bot.shot('after-loss');
  if (!bot.check(ok, 'a lost battle shows the World Conquest battle report')) return;
  await sleep(800);
  await bot.audit('defeat report');
  await bot.click('.wc-modal [data-go]');
  bot.check(await bot.waitFor('.wc-top', undefined, 90000), 'Continue after a defeat goes back to the turn screen');
  const after = await runState(bot);
  bot.check(after && !after.pending && after.troops < before.troops + 20, 'the defeat is applied to the run (no battle pending, troops lost)', JSON.stringify({ before: before.troops, after: after?.troops, pending: after?.pending }));
  await bot.noErrors('defeat');
}
