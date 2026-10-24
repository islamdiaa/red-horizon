// World Conquest for a first-time player: a fresh profile opens the mode from the menu and begins with the defaults.
// It starts at home (the homeland of the browser's language region: en-US -> the USA, en-GB -> Britain, de-DE ->
// Germany...; unknown -> France), and the Field Manual's first target is a land attack whose battle is not a naval one
// (QA UI-2, UI-3). Then it fights that battle (a forced win) and comes back to the globe.
//   node tools/e2e/run.mjs world-newcomer --locale en-GB
import { sleep } from '../lib.mjs';
import { Wd, forceWin, runState, tapTerritory } from './world.mjs';

const EXPECT = { US: 'usa', GB: 'britain', DE: 'germany', FR: 'france', ES: 'spain', BR: 'brazil', RU: 'soviet-union', CN: 'china', JP: 'japan', IN: 'india', AU: 'australia' };

export default async function worldNewcomer(bot) {
  await bot.goto();
  await bot.waitMenu();
  await bot.click('.main-screen:not(.leaving) .mm-nav-btn[data-nav="world"]');
  bot.check(await bot.waitFor('.wc-side [data-act="begin"]', undefined, 90000), 'the world setup opens');
  await sleep(800);
  const region = await bot.page.evaluate(() => { try { return new Intl.Locale(navigator.language).maximize().region; } catch { return null; } });
  await bot.click('.wc-side [data-act="begin"]');
  await bot.waitFor('.wc-top', undefined, 60000);
  const st = await runState(bot);
  const want = EXPECT[region] ?? 'france';
  bot.check(st.home === want, `a ${region} browser starts at home (${want})`, `${st.home}`);
  // reinforce where the coach points, then the first target
  if (await bot.sees('[data-act="all"]')) await bot.click('[data-act="all"]');
  else { const cap = await Wd(bot, () => { const r = window.__world.run; return r.territories.find((t) => t.capital === r.player)?.id; }); const p = await Wd(bot, (id) => { const w = window.__world, q = w.globe.screenOf(w.siteOf(id)), r = w.stage.getBoundingClientRect(); return q && { x: q.x + r.left, y: q.y + r.top }; }, cap); if (p) await bot.page.mouse.click(p.x, p.y); await sleep(400); if (await bot.sees('[data-act="all"]')) await bot.click('[data-act="all"]'); }
  if (await bot.sees('[data-act="next"]')) await bot.click('[data-act="next"]');
  await sleep(800);
  const coach = (await bot.page.textContent('.wc-coach').catch(() => '') ?? '').replace(/\s+/g, ' ').slice(0, 160);
  // the coach marks its "easy target" (view.coachTarget) and selects where it starts from: tap the target, as told
  const first = await Wd(bot, () => {
    const w = window.__world, r = w.run, v = w.view;
    const to = v?.coachTarget ?? null, from = v?.sel?.src ?? null;
    if (!to || !from) return null;
    const sea = r.links.some((l) => ((l.a === from && l.b === to) || (l.a === to && l.b === from)) && l.sea);
    return { from, to, sea };
  });
  bot.log(`coach: ${coach}; marked target ${JSON.stringify(first)}`);
  if (!bot.check(first && !first.sea, 'the coach marks a first target over land', JSON.stringify(first))) return;
  await tapTerritory(bot, first.to, 'the marked target');
  const sel = (await runState(bot)).sel;
  bot.check(sel?.src === first.from && sel?.dst === first.to, 'tapping the marked target selects the attack', JSON.stringify(sel));
  if (!bot.check(await bot.sees('[data-act="fight"]'), 'Fight it is offered for it')) return;
  await bot.click('[data-act="fight"]');
  if (await bot.sees('.wc-modal [data-yes]')) await bot.click('.wc-modal [data-yes]');
  await bot.waitMatch();
  const kind = await bot.g((g) => g.setup.conquest?.battle?.kind);
  bot.check(kind && kind !== 'naval', 'the first battle is not a naval one', kind);
  await bot.shot('first-battle');
  await forceWin(bot);
  bot.check(await bot.page.waitForSelector('.wc-modal [data-go]', { state: 'visible', timeout: 300000 * bot.o.slow }).then(() => true, () => false), 'the battle report follows');
  await bot.click('.wc-modal [data-go]');
  bot.check(await bot.waitFor('.wc-top', undefined, 90000), 'back on the globe');
  await bot.noErrors('newcomer');
}
