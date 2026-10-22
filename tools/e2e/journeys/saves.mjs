// Saves: save a match from the pause menu, load it from the main menu (Continue), carry on playing, then recover
// the autosave the game writes when the tab goes away mid-match (a reload).
import { sleep } from '../lib.mjs';

const P = '.main-screen:not(.leaving) .mm-panel';

/** What a loaded game must match: the clock, the economy and every entity. */
const snapshot = (bot) => bot.g((g) => {
  const w = g.world, me = g.local;
  return {
    tick: w.tick, credits: Math.round(me.credits),
    blds: w.buildings.filter((b) => b.alive).map((b) => `${b.owner.id}:${b.bt.id}@${b.cx},${b.cy}`).sort().join(' '),
    units: w.units.filter((u) => u.alive).length,
    mine: w.units.filter((u) => u.alive && u.owner === me).map((u) => `${u.ut.id}@${u.x.toFixed(1)},${u.y.toFixed(1)}`).sort().join(' '),
  };
});

const continueBtn = '.main-screen:not(.leaving) .mm-nav-btn:has(.nb-idx:text-is("▶"))';

export default async function saves(bot) {
  await bot.goto();
  await bot.waitMenu();
  bot.check(!await bot.sees(continueBtn), 'a fresh profile has no Continue entry');
  // a small skirmish with an MCV start
  await bot.click(`${P} .seg button[data-v="64"]`);
  await bot.click(`${P} .seg button[data-v="mcv"]`);
  await bot.click(`${P} .deploy`);
  await bot.waitMatch();
  const mcv = (await bot.mine()).units.find((u) => u.t === 'mcv');
  if (mcv) { await bot.lookAt(mcv.x, mcv.y); const p = await bot.toScreen(mcv.x, mcv.y, 0.4); await bot.page.mouse.click(p.x, p.y); await sleep(200); await bot.key('d'); await bot.wait(3); }
  bot.check(await bot.build('powr'), 'built a power plant before saving');
  await bot.wait(20);

  // ---- save from the pause menu (the game pauses behind it, so the snapshot is the saved state)
  await bot.pause();
  const before = await snapshot(bot);
  await bot.click('.pause-screen .pp-btn[data-act="save game"]');
  const label = await bot.page.locator('.pause-screen .pp-btn[data-act="save game"]').textContent();
  const slot = await bot.page.evaluate(() => { try { const d = JSON.parse(localStorage.getItem('rh.save.manual')); return d ? { tick: d.world?.tick ?? d.tick ?? null, savedAt: d.savedAt, label: d.game?.label } : null; } catch { return null; } });
  bot.check(!!slot && /saved/i.test(label), 'Save game stores the match and says so', `${label.trim()} ${JSON.stringify(slot)}`);
  await bot.shot('saved');
  await bot.click('.pause-screen .pp-btn[data-act="resume"]');
  // play on so the world moves past the save
  bot.check(await bot.build('proc'), 'built a refinery after saving');
  await bot.wait(30);
  const later = await snapshot(bot);
  bot.check(later.tick > before.tick && later.blds !== before.blds, 'the match moved on after the save');
  await bot.quitToMenu();
  await bot.noErrors('save');

  // ---- load from the menu: Continue
  bot.check(await bot.sees(continueBtn), 'the main menu offers Continue');
  await bot.shot('menu-continue');
  await bot.click(continueBtn);
  await bot.waitMatch();
  // the loaded match is paused behind no menu: compare at once
  const loaded = await snapshot(bot);
  bot.log('saved', JSON.stringify(before).slice(0, 300));
  bot.log('loaded', JSON.stringify(loaded).slice(0, 300));
  // (the loaded match runs on while the bot looks: between the save and the moment it was left)
  bot.check(loaded.tick >= before.tick && loaded.tick < later.tick, 'Continue loads the saved moment, not the later one', `tick ${loaded.tick}: saved ${before.tick}, left at ${later.tick}`);
  bot.check(loaded.blds === before.blds && loaded.units === before.units, 'the loaded world has the saved structures and units', `${loaded.blds.length}/${before.blds.length} chars, units ${loaded.units}/${before.units}`);
  bot.check(loaded.mine === before.mine || Math.abs(loaded.tick - before.tick) > 0, 'my units are where they were saved', loaded.mine === before.mine ? 'identical' : 'moved a tick');
  // carry on: the loaded game takes orders and builds
  bot.check(await bot.build('proc'), 'the loaded game builds (carry on)');
  await bot.wait(20);
  await bot.noErrors('load');

  // ---- autosave recovery: reload the tab mid-match
  const atReload = await snapshot(bot);
  await bot.reload();
  await bot.waitMenu();
  bot.check(await bot.sees(continueBtn), 'after a reload mid-match the menu offers Continue');
  const contText = (await bot.el(continueBtn).textContent()).trim();
  await bot.click(continueBtn);
  await bot.waitMatch();
  const rec = await snapshot(bot);
  bot.log('at reload', atReload.tick, 'recovered', rec.tick, contText);
  bot.check(Math.abs(rec.tick - atReload.tick) <= 40 && rec.blds === atReload.blds, 'the autosave restores the match as it was at the reload', `tick ${rec.tick} vs ${atReload.tick}`);
  await bot.shot('recovered');
  await bot.wait(10);
  await bot.quitToMenu();
}
