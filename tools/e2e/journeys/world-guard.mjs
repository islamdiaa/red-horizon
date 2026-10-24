// World Conquest's test screens (?world=<state>) are for tests only: on a production build without ?debug=1 they must
// not open, and they must never record a result (XP, medals) or replace the player's saved run (QA UI-1).
import { sleep } from '../lib.mjs';

const profileXp = (bot) => bot.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('rh.profile') ?? '{}').xp ?? 0; } catch { return -1; } });

export default async function worldGuard(bot) {
  // no ?debug=1 here (Bot.goto always adds it): the address a player could be sent
  const base = new URL(bot.o.url);
  await bot.page.goto(`${base.origin}${base.pathname}?world=won&seed=3`, { waitUntil: 'load', timeout: 120000 * bot.o.slow });
  await bot.waitMenu().catch(() => {});
  await sleep(4000);
  const xp1 = await profileXp(bot);
  const won = await bot.page.evaluate(() => !!document.querySelector('.wc-end, .wc-modal .wc-end'));
  bot.check(xp1 === 0 && !won, '?world=won without ?debug=1 shows no ending and grants no XP', JSON.stringify({ xp: xp1, endingShown: won }));
  // a real run in progress, then a test screen with ?debug=1: the saved run must survive
  await bot.goto({}, '#world=1&home=germany&size=blitz&diff=easy');
  await bot.waitFor('.wc-side [data-act="begin"]', undefined, 120000);
  await bot.click('.wc-side [data-act="begin"]');
  await bot.waitFor('.wc-top', undefined, 60000);
  const id = await bot.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('rh.world.run')).id; } catch { return null; } });
  await bot.goto({ world: 'won', seed: 5 });
  await sleep(6000);
  const xp2 = await profileXp(bot);
  const id2 = await bot.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('rh.world.run')).id; } catch { return null; } });
  bot.check(xp2 === 0, 'a debug test ending records nothing (no XP)', `xp ${xp2}`);
  bot.check(!!id && id2 === id, 'a debug test screen leaves the saved run alone', `${id} -> ${id2}`);
  await bot.noErrors('guard');
}
