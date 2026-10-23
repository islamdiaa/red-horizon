// Every menu screen: each main-menu entry opens a screen that fits the window (no clipped or off-screen text, no
// catalogue keys or unfilled {placeholders}: Bot.audit), with its tabs, and Esc (or its Back button) returns to the
// main menu without console errors. Then the skirmish panel's tabs and map picker, and in a match the pause menu,
// its Settings and Controls screens, and the results screen.
//
// Findings are friction ('overflow', 'offscreen', 'text'); checks fail on a screen that doesn't open or close, or on
// errors. Run it per language and window size (tools/e2e/run.mjs menus --size 800x600, E2E_LANG=de).
import { sleep } from '../lib.mjs';

const MAIN = '.main-screen:not(.leaving)';
/** Main-menu entries (data-nav) that start something instead of opening a screen (played by other journeys). */
const SKIP = new Set(['quick', 'bootcamp', 'skirmish', 'continue']);

/** The tabs a screen offers (its own tab strips), as locators to click one by one. */
async function tabsOf(bot) {
  return bot.page.evaluate(() => {
    const scr = [...document.querySelectorAll('.screen:not(.leaving), .cmp, .chl, .cq, .prof, .mods, .lobby, .help-panel')].filter((e) => e.getBoundingClientRect().width > 50).pop();
    if (!scr) return [];
    const tabs = [...scr.querySelectorAll('[role="tab"], .cmp-tab, .help-tab, .prof-tab, .chl-sbtn, .vr-tab')].filter((t) => t.getBoundingClientRect().width > 4);
    return tabs.map((t, i) => ({ i, text: (t.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30) }));
  });
}

async function backToMain(bot, what) {
  for (let k = 0; k < 3; k++) {
    if (await bot.sees(`${MAIN} .mm-nav-btn`)) return true;
    await bot.key('Escape', 900);
    if (await bot.sees(`${MAIN} .mm-nav-btn`)) return true;
    const back = bot.page.locator('[data-act="back"], button.back, .sub-back, button:has-text("Back"), button:has-text("Close")').locator('visible=true').first();
    if (await back.count()) await back.click({ timeout: 5000 }).catch(() => {});
    await sleep(900);
  }
  return bot.check(await bot.sees(`${MAIN} .mm-nav-btn`), `back to the main menu from ${what}`);
}

export default async function menus(bot) {
  await bot.goto();
  await bot.waitMenu();
  await sleep(1500);
  await bot.audit('main menu');
  await bot.shot('main');
  await bot.noErrors('main menu');

  // ---- the skirmish panel (on the main menu): its tabs, the map picker
  for (const t of [1, 0]) {
    await bot.click(`${MAIN} .mm-panel .vr-tab >> nth=${t}`, undefined, { after: 600 }).catch(() => {});
    await bot.audit(`skirmish panel tab ${t}`);
  }
  if (await bot.sees(`${MAIN} .mm-panel .mr-thumb`)) {
    await bot.click(`${MAIN} .mm-panel .mr-thumb`, undefined, { after: 1200 });
    await bot.audit('map picker');
    await bot.shot('map-picker');
    await bot.key('Escape', 900);
    await bot.check(await bot.sees(`${MAIN} .mm-nav-btn`), 'the map picker closes with Esc');
  }

  // ---- every main-menu entry
  const ids = await bot.page.$$eval(`${MAIN} .mm-nav-btn`, (l) => l.map((e) => e.dataset.nav ?? ''));
  bot.log(`main menu: ${ids.join(' | ')}`);
  for (const label of ids) {
    if (!label || SKIP.has(label)) continue;
    // (a static test server has no multiplayer relay: the lobby's request to it fails, as it should)
    if (label === 'multiplayer') bot.expect.push(/status of 40[45]|status of 50[234]/);
    await bot.click(`${MAIN} .mm-nav-btn[data-nav="${label}"]`);
    await sleep(1800);
    const opened = !await bot.sees(`${MAIN} .mm-nav-btn`) || await bot.page.evaluate(() => document.querySelectorAll('.screen:not(.leaving)').length > 1);
    if (!bot.check(opened, `"${label}" opens a screen`)) continue;
    await bot.audit(label);
    await bot.shot(label);
    const tabs = await tabsOf(bot);
    for (const t of tabs.slice(0, 8)) {
      const loc = bot.page.locator('[role="tab"], .cmp-tab, .help-tab, .prof-tab, .chl-sbtn, .vr-tab').locator('visible=true').nth(t.i);
      await loc.click({ timeout: 5000 }).catch(() => {});
      await sleep(900);
      await bot.audit(`${label} › ${t.text}`);
    }
    if (tabs.length) await bot.shot(`${label}-tabs`);
    await backToMain(bot, label);
    await bot.noErrors(label);
    bot.expect = [];
  }

  // ---- in a match: the pause menu and its screens, then the results screen
  await bot.click(`${MAIN} .mm-panel .deploy`);
  await bot.waitMatch();
  await bot.wait(5);
  await bot.audit('battle HUD');
  if (!await bot.pause()) bot.fail('the pause menu opens');
  await sleep(700);
  await bot.audit('pause menu');
  await bot.shot('pause');
  for (const act of ['settings', 'controls']) {
    const b = bot.page.locator(`.pause-screen:not(.leaving) .pp-btn[data-act="${act}"]`);
    if (!await b.count()) { bot.log(`no pause entry ${act}`); continue; }
    await b.first().click();
    await sleep(1200);
    await bot.audit(`pause › ${act}`);
    await bot.shot(`pause-${act}`);
    await bot.key('Escape', 900);
    bot.check(await bot.sees('.pause-screen:not(.leaving) .pp-btn'), `Esc from the pause menu's ${act} returns to the pause menu`);
  }
  await bot.click('.pause-screen:not(.leaving) .pp-btn[data-act="resume"]').catch(() => bot.key('Escape'));
  await sleep(600);
  // the results screen (a defeat, set directly: the screen is what is under test, not the battle)
  bot.check(await bot.forceEnd(false), 'the results screen appears (a defeat)');
  await sleep(2500);
  await bot.audit('results');
  await bot.shot('results');
  for (const t of (await tabsOf(bot)).slice(0, 6)) {
    await bot.page.locator('[role="tab"], .vr-tab').locator('visible=true').nth(t.i).click({ timeout: 5000 }).catch(() => {});
    await sleep(800);
    await bot.audit(`results › ${t.text}`);
  }
  await bot.noErrors('in a match');
}
