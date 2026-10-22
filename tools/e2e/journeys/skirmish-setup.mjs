// Skirmish setup: every option on the skirmish panel round-trips into the match. Two deployments:
//  A. a generated map (size, terrain, climate, weather, time of day, credits, start units, day cycle, fog), Soviet
//     with a team colour, two opponents (side and level each), Classic rules with build-up time (ceasefire);
//     the map code shown in the menu is the one the pause menu shows in the match.
//  B. a curated map from the map picker, Commander rules, two mutators from the mutator picker, King of the Hill.
// Each time: back to the menu, where the panel still shows the choices.
import { sleep } from '../lib.mjs';

const P = '.main-screen:not(.leaving) .mm-panel';

/** A segmented control's button by its value (language independent). */
const seg = (v, scope = P) => `${scope} .seg button[data-v="${v}"]`;

async function stepTo(bot, field, wantRe, max = 12) {
  // click the stepper's "next" arrow until its label matches (`field`: a Locator)
  for (let i = 0; i < max; i++) {
    const label = (await field.locator('.st-val b').first().textContent().catch(() => '')) ?? '';
    if (wantRe.test(label)) return label;
    await field.locator('.st-arrow').nth(1).click();
    await sleep(250);
  }
  return null;
}

async function rulesTab(bot, on) {
  await bot.click(`${P} .vr-tab >> nth=${on ? 1 : 0}`, undefined, { after: 400 });
}

export default async function skirmishSetup(bot) {
  await bot.goto();
  await bot.waitMenu();

  // ================================================================ A: generated map, Classic, ceasefire
  await bot.click(`${P} .faction-card.soviet`);
  await bot.click(`${P} .colors .sw >> nth=3`);
  const color = await bot.page.locator(`${P} .colors .sw.on`).first().getAttribute('data-c');
  // opponents: AI 1 Allies on Easy; add AI 2 on Normal
  await bot.click(`${P} .opponent >> nth=0 >> .op-fac button[data-v="allies"]`);
  await bot.click(`${P} .opponent >> nth=0 >> .op-diff button[data-v="easy"]`);
  await bot.click(`${P} .op-add`);
  await bot.click(`${P} .opponent >> nth=1 >> .op-diff button[data-v="normal"]`);
  await bot.click(`${P} .opponent >> nth=1 >> .op-fac button[data-v="soviet"]`);
  // battlefield and conditions
  await bot.click(seg(64)); await bot.click(seg(0)); await bot.click(seg('winter'));
  const weather = await stepTo(bot, bot.page.locator(`${P} .field:has(.st-val)`).first(), /clear/i);
  await bot.click(seg('dusk')); await bot.click(seg(20000)); await bot.click(seg('heavy'));
  // the two toggles: day / night cycle on, fog of war off (read their state first)
  const tg = await bot.page.evaluate((P) => [...document.querySelectorAll(`${P} .mp-grid:not(.vr-rules) .toggle`)].map((t) => t.classList.contains('on')), P);
  if (!tg[0]) await bot.click(`${P} .mp-grid:not(.vr-rules) .toggle >> nth=0`);
  if (tg[1]) await bot.click(`${P} .mp-grid:not(.vr-rules) .toggle >> nth=1`);
  // rules: Classic, build-up time
  await rulesTab(bot, true);
  await bot.click(seg('classic'));
  const buildup = await stepTo(bot, bot.page.locator(`${P} .f-buildup`).first(), /\d/);
  await rulesTab(bot, false);
  const codeMenu = (await bot.page.locator(`${P} .mr-code code`).textContent()).trim();
  await bot.shot('setup-a');
  bot.log(`A: weather ${weather}, build-up ${buildup}, colour ${color}, map code ${codeMenu}`);
  await bot.click(`${P} .deploy`);
  await bot.waitMatch();
  const a = await bot.g((g) => ({
    faction: g.local.faction, color: g.local.color, players: g.world.players.length, opp: g.setup.opponents.map((o) => `${o.faction}/${o.difficulty}`),
    oppFactions: g.world.players.filter((p) => p !== g.local).map((p) => p.faction), size: g.world.map.w, climate: g.world.map.climate, water: g.setup.water,
    weather: g.setup.weather, tod: g.setup.timeOfDay, credits: g.setup.credits, cash: g.local.credits, units: g.setup.startUnits, cycle: !!g.setup.dayCycle,
    fog: g.world.fog, rules: g.setup.rules ?? g.world.rules, ceasefire: g.world.ceasefireUntil, tick: g.world.tick,
    my: g.world.units.filter((u) => u.owner === g.local).length,
  }));
  bot.log('A in the match:', JSON.stringify(a));
  bot.check(a.faction === 'soviet', 'side: Soviet', a.faction);
  bot.check(String(a.color) === color, 'team colour', `${a.color} vs ${color}`);
  bot.check(a.players === 3 && a.opp[0] === 'allies/easy' && a.opp[1] === 'soviet/normal' && a.oppFactions.join() === 'allies,soviet', 'two opponents with their sides and levels', a.opp);
  bot.check(a.size === 64 && a.water === 0 && a.climate === 'winter', 'map: small, dry, winter', `${a.size} ${a.water} ${a.climate}`);
  bot.check(a.weather === 'clear' && a.tod === 'dusk', 'weather and time of day', `${a.weather} ${a.tod}`);
  bot.check(a.credits === 20000 && a.cash >= 19000, 'credits $20k', `${a.credits} (${a.cash} now)`);
  bot.check(a.units === 'heavy' && a.my > 5, 'start units: Company', `${a.units}, ${a.my} units`);
  bot.check(a.cycle === true && a.fog === false, 'day cycle on, fog of war off', `${a.cycle} ${a.fog}`);
  bot.check(a.rules === 'classic' && a.ceasefire > a.tick, 'Classic rules with build-up time', `${a.rules} ceasefire until tick ${a.ceasefire}`);
  bot.check(!await bot.sees('#cmdpanel'), 'Classic rules: no commander powers panel');
  bot.check(await bot.sees('#ui .tb-cf, #ui .cf-row'), 'the build-up countdown is on the HUD');
  await bot.shot('match-a');
  await bot.pause();
  const codeMatch = (await bot.page.locator('.pause-screen .pp-map code').textContent().catch(() => '')).trim();
  bot.check(codeMatch === codeMenu, 'the pause menu shows the map code chosen in the menu', `${codeMatch} vs ${codeMenu}`);
  await bot.pauseAct('quit to menu');
  await bot.waitMenu();
  // the panel remembers the choices
  const kept = await bot.page.evaluate((P) => ({
    soviet: !!document.querySelector(`${P} .faction-card.soviet.on`), opps: document.querySelectorAll(`${P} .opponent`).length,
    on: [...document.querySelectorAll(`${P} .mp-grid:not(.vr-rules) .seg button.on`)].map((b) => b.dataset.v),
  }), P);
  bot.check(kept.soviet && kept.opps === 2 && ['64', '0', 'winter', 'dusk', '20000', 'heavy'].every((v) => kept.on.includes(v)), 'the skirmish panel keeps the choices after the match', kept);
  await bot.noErrors('deployment A');

  // ================================================================ B: curated map, Commander, mutators, King of the Hill
  await bot.click(`${P} .mr-change`);
  await bot.waitFor('.map-picker .mpk-card.ready');
  const cards = await bot.page.locator('.map-picker .mpk-card').count();
  await bot.shot('map-picker');
  await bot.click('.map-picker .mpk-card >> nth=2');
  await sleep(500);
  const mapName = (await bot.page.locator(`${P} .map-row .mr-info b`).textContent()).trim();
  const curated = await bot.page.locator(`${P} .map-row.curated`).count();
  bot.check(cards > 3 && curated === 1, 'the map picker lists curated maps and picks one', `${cards} cards, picked "${mapName}"`);
  await rulesTab(bot, true);
  await bot.click(seg('commander'));
  const koth = await stepTo(bot, bot.page.locator(`${P} .vr-rules .field:not(.f-buildup):has(.stepper)`).first(), /\d/);
  const buildupOff = await bot.page.locator(`${P} .f-buildup.disabled`).count();
  bot.check(buildupOff === 1, 'King of the Hill turns build-up time off in the panel');
  // mutators: open the picker, pick the first two that this map allows, Done
  await bot.click(`${P} .vr-mut .vr-btn >> nth=0`);
  await bot.waitFor('.vr-picker .vr-card');
  await bot.shot('mutator-picker');
  // two that can go together: some are exclusive sets (two weathers...), where the picker swaps the earlier pick out
  let picked = [];
  for (let i = 0; i < 16 && picked.length < 2; i++) {
    const c = bot.page.locator('.vr-picker .vr-card').nth(i);
    if (await c.isDisabled()) continue;
    await c.click(); await sleep(250);
    picked = (await bot.page.locator('.vr-picker .vr-card.on b').allTextContents()).map((t) => t.trim());
  }
  await bot.click('.vr-picker .vr-btn.primary');
  await sleep(400);
  const chips = await bot.page.locator(`${P} .vr-mut .vr-chip`).count();
  bot.check(chips === 2, 'two mutators chosen in the picker show as chips', picked);
  await bot.shot('setup-b');
  await bot.click(`${P} .deploy`);
  await bot.waitMatch();
  const b = await bot.g((g) => ({ mapId: g.setup.mapId, koth: !!g.setup.koth, kothMin: g.setup.kothMinutes, rules: g.setup.rules, mut: g.setup.mutators ?? [], ceasefire: g.world.ceasefireUntil, worldMut: g.world.variety?.mutators ?? [] }));
  bot.log('B in the match:', JSON.stringify(b));
  bot.check(!!b.mapId, 'the curated map is the battlefield', b.mapId);
  bot.check(b.koth && b.kothMin > 0 && new RegExp(String(b.kothMin)).test(koth ?? ''), 'King of the Hill with the chosen minutes', `${b.kothMin} vs "${koth}"`);
  bot.check(!b.ceasefire, 'no build-up time with King of the Hill', b.ceasefire);
  bot.check(b.rules === 'commander' && await bot.sees('#cmdpanel'), 'Commander rules: the powers panel is up');
  bot.check(b.mut.length === 2 && b.worldMut.length === 2, 'both mutators are active in the match', b.mut);
  bot.check(await bot.page.evaluate(() => !!document.querySelector('#ui [class*="koth"]')), 'the King of the Hill HUD is shown');
  await bot.pause();
  const pmap = (await bot.page.locator('.pause-screen .pp-map b').textContent().catch(() => '')).trim();
  bot.check(pmap === mapName, 'the pause menu names the curated map', `${pmap} vs ${mapName}`);
  await bot.shot('match-b');
  await bot.pauseAct('quit to menu');
  await bot.waitMenu();
  const keptB = await bot.page.evaluate((P) => ({ chips: document.querySelectorAll(`${P} .vr-mut .vr-chip`).length, map: document.querySelector(`${P} .map-row .mr-info b`)?.textContent.trim() }), P);
  bot.check(keptB.chips === 2 && keptB.map === mapName, 'the panel keeps the map and mutators', keptB);
}
