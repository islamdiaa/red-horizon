// Reduced motion and colour-blind palettes. With the browser asking for reduced motion (prefers-reduced-motion), the
// main menu, a battle and the results screen run no CSS animation or transition with a duration (friction 'motion'
// lists any that do), the menu embers stay still, and the Reduce motion setting turns up switched on in the pause
// menu's Settings. Then each team palette (Default, Colour-blind safe, You vs enemies) is picked in the pause menu's
// Settings and the battle redrawn in it (body class, a screenshot of each for review).
import { sleep } from '../lib.mjs';

/** Running animations and transitions with a duration (CSS and Web Animations). */
const moving = (bot) => bot.page.evaluate(() => document.getAnimations()
  .filter((a) => a.playState === 'running' && (a.effect?.getComputedTiming?.().duration ?? 0) > 0)
  .map((a) => { const t = a.effect?.target; return `${a.animationName ?? a.transitionProperty ?? a.constructor.name} on ${t?.id ? `#${t.id}` : t?.className ? `.${String(t.className).split(' ')[0]}` : t?.tagName ?? '?'}`; }));

export default async function motion(bot) {
  await bot.page.emulateMedia({ reducedMotion: 'reduce' });
  await bot.goto();
  await bot.waitMenu();
  await sleep(2500);
  const menu = await moving(bot);
  for (const m of [...new Set(menu)].slice(0, 10)) bot.friction('motion', `main menu: ${m}`);
  bot.check(menu.length === 0, 'reduced motion: nothing animates on the main menu', [...new Set(menu)].slice(0, 6).join('; '));
  const embers = await bot.page.evaluate(async () => {
    const c = document.querySelector('.mm-embers');
    if (!c) return 'none';
    const a = c.toDataURL();
    await new Promise((r) => setTimeout(r, 800));
    return a === c.toDataURL() ? 'still' : 'moving';
  });
  bot.check(embers !== 'moving', 'reduced motion: the menu embers stay still', embers);

  // a battle
  await bot.click('.main-screen:not(.leaving) .mm-panel .deploy');
  await bot.waitMatch();
  await bot.wait(20);
  await sleep(1500);
  const battle = await moving(bot);
  for (const m of [...new Set(battle)].slice(0, 10)) bot.friction('motion', `battle: ${m}`);
  bot.check(battle.length === 0, 'reduced motion: no HUD animation in a battle', [...new Set(battle)].slice(0, 6).join('; '));

  // the palettes, picked in the pause menu's Settings
  for (const pal of ['cvd', 'vs', 'default']) {
    if (!await bot.pause()) bot.fail('the pause menu opens');
    await bot.click('.pause-screen:not(.leaving) .pp-btn[data-act="settings"]');
    await sleep(1200);
    if (pal === 'cvd') {
      const rm = await bot.page.evaluate(() => [...document.querySelectorAll('.settings-panel .set-row')].map((r) => r.querySelector('[role="switch"]')?.getAttribute('aria-checked')));
      bot.log(`settings switches: ${rm.join(',')}`);
    }
    const seg = bot.page.locator(`.screen:not(.leaving) .settings-panel .seg button[data-v="${pal}"]`).first();
    if (!await seg.count()) { bot.check(false, `the palette "${pal}" is in Settings`); break; }
    await seg.scrollIntoViewIfNeeded().catch(() => {});
    await seg.click();
    await sleep(500);
    await bot.key('Escape', 900);
    await bot.click('.pause-screen:not(.leaving) .pp-btn[data-act="resume"]').catch(() => bot.key('Escape'));
    await bot.wait(1);
    await sleep(800);
    const cls = await bot.page.evaluate(() => [...document.body.classList].filter((c) => c.startsWith('pal-')).join(' '));
    bot.check(cls === `pal-${pal}`, `palette ${pal} reaches the battle`, cls);
    await bot.shot(`palette-${pal}`);
  }

  // the results screen with reduced motion: the numbers are there at once
  bot.check(await bot.forceEnd(true), 'the results screen appears (a victory)');
  await sleep(1200);
  const res = await moving(bot);
  for (const m of [...new Set(res)].slice(0, 10)) bot.friction('motion', `results: ${m}`);
  bot.check(res.length === 0, 'reduced motion: the results screen does not animate', [...new Set(res)].slice(0, 6).join('; '));
  await bot.shot('results');
  await bot.noErrors('reduced motion and palettes');
}
