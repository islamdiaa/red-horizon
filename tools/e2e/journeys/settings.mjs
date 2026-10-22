// Settings: every control on the Settings screen changes something; the changes survive a reload; a rebound key
// works in a match (and the old one doesn't); the language switches from the menu and carries into a match; reduce
// motion, team-colour palettes, interface scale and render resolution reach the battle.
import { sleep } from '../lib.mjs';

const S = '.screen:not(.leaving) .settings-panel';

/** Everything a setting can change: stored settings, body / root classes and styles, the page language. */
const state = (bot) => bot.page.evaluate(() => ({
  ls: Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('rh.') && !k.startsWith('rh.save'))),
  body: document.body.className.split(/\s+/).filter((c) => !/^(cur-|hud-|faction-)/.test(c)).sort().join(' '),
  root: document.documentElement.getAttribute('style') ?? '',
  lang: document.documentElement.lang,
}));
const diff = (a, b) => {
  const out = [];
  for (const k of new Set([...Object.keys(a.ls), ...Object.keys(b.ls)])) if (a.ls[k] !== b.ls[k]) out.push(k);
  if (a.body !== b.body) out.push('body');
  if (a.root !== b.root) out.push('root');
  if (a.lang !== b.lang) out.push('lang');
  return out;
};

/** The state of every control, to compare after a reload. */
const controls = (bot) => bot.page.evaluate((S) => [...document.querySelectorAll(`${S} .set-row`)].map((r) => {
  const name = r.querySelector('.set-l b')?.textContent.trim();
  const seg = r.querySelector('.seg button.on')?.dataset.v;
  const tg = r.querySelector('.toggle');
  const sl = r.querySelector('input.slider');
  return `${name}=${seg ?? (tg ? tg.classList.contains('on') : sl ? sl.value : '')}`;
}), S);

async function openSettings(bot) {
  await bot.nav('Settings');
  await bot.waitFor(`${S} .set-row`);
  await sleep(400);
}

export default async function settings(bot) {
  await bot.goto();
  await bot.waitMenu();
  await openSettings(bot);
  await bot.shot('settings');

  // ================================================================ every control changes something
  const rows = await bot.page.locator(`${S} .set-row`).count();
  const dead = [];
  let tested = 0;
  for (let i = 0; i < rows; i++) {
    const row = bot.page.locator(`${S} .set-row`).nth(i);
    const name = ((await row.locator('.set-l b').first().textContent().catch(() => '')) ?? '').trim();
    if (await row.locator('[data-setting="language"]').count()) continue; // (the language: below)
    const before = await state(bot);
    let did = '';
    if (await row.locator('.seg').count()) {
      const btn = row.locator('.seg button:not(.on)').first();
      did = `seg ${await btn.getAttribute('data-v')}`;
      await btn.click();
    } else if (await row.locator('.toggle').count()) {
      did = 'toggle'; await row.locator('.toggle').first().click();
    } else if (await row.locator('input.slider').count()) {
      const s = row.locator('input.slider').first();
      did = 'slider';
      await s.focus();
      for (let k = 0; k < 4; k++) await bot.page.keyboard.press('ArrowLeft');
      await s.press('Tab'); // commit-on-release sliders apply on change
    } else if (/\bkey/i.test(name) || await row.locator("button").count() === 0) {
      continue; // the key bindings screen is tested below
    } else {
      const b = row.locator('button').first();
      did = `button "${(await b.textContent()).trim()}"`;
      // (what a button changes may show in the row, the button itself, or the status line under the row)
      const look = () => row.evaluate((r) => `${r.textContent.trim()}|${r.querySelector('button')?.disabled}|${r.nextElementSibling?.matches('.set-status, .acc-status') ? r.nextElementSibling.textContent : ''}`).catch(() => '');
      const t0 = await look();
      await b.click();
      let t1 = t0;
      for (let k = 0; k < 20 && t1 === t0; k++) { await sleep(500); t1 = await look(); }
      tested++;
      if (t0 === t1) dead.push(`${name} (${did}: nothing visible)`);
      continue;
    }
    await sleep(500);
    const ch = diff(before, await state(bot));
    tested++;
    if (!ch.length) dead.push(`${name} (${did})`);
  }
  bot.check(tested >= 15 && !dead.length, 'every Settings control changes something', dead.length ? dead.join('; ') : `${tested} controls`);
  const changed = await controls(bot);
  await bot.shot('settings-changed');

  // ---- persistence: reload, the screen shows the same values
  await bot.click(`${S} .btn-back, ${S} button:has-text("Back")`).catch(() => bot.key('Escape'));
  await bot.reload();
  await bot.waitMenu();
  await openSettings(bot);
  const reloaded = await controls(bot);
  const lost = changed.filter((c, i) => c !== reloaded[i]);
  bot.check(!lost.length, 'settings persist across a reload', lost.length ? `${lost.join(', ')} -> ${lost.map((c) => reloaded[changed.indexOf(c)]).join(', ')}` : `${changed.length} values`);
  // back to a playable baseline for the rest: defaults (clear stored settings except the auto quality)
  await bot.page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k === 'rh.settings' || k === 'rh.audio') localStorage.removeItem(k); });
  await bot.reload();
  await bot.waitMenu();
  await bot.noErrors('settings controls');

  // ================================================================ key rebinding: Attack-move on K
  await openSettings(bot);
  await bot.click(`${S} .set-row:has-text("Customise") button, ${S} .btn-sm:has-text("Customise")`).catch(async () => {
    const r = bot.page.locator(`${S} .set-row`).filter({ hasText: /key/i }).locator('button').first();
    await r.click();
  });
  await bot.waitFor('.kb-row');
  const row = bot.page.locator('.kb-row').filter({ has: bot.page.locator('.kb-name', { hasText: /^Attack.move/i }) }).first();
  await row.locator('.kb-key').first().click();
  await bot.key('k');
  const label = (await row.locator('.kb-key').first().textContent()).trim();
  bot.check(/^k$/i.test(label), 'Attack-move rebound to K in the key list', label);
  await bot.shot('keys');
  await bot.key('Escape', 500);
  if (await bot.sees(S)) await bot.key('Escape', 500);
  await bot.waitMenu();
  // a match: the new key works, the old one doesn't, the order buttons show it
  await bot.click('.main-screen .mm-panel .seg button[data-v="64"]');
  await bot.click('.main-screen .mm-panel .seg button[data-v="heavy"]');
  await bot.click('.main-screen .mm-panel .deploy');
  await bot.waitMatch();
  await bot.key('e');
  await bot.key('a', 300);
  const modeA = await bot.g((g) => g.input.mode);
  await bot.key('Escape', 300);
  if (await bot.sees('.pause-screen')) await bot.key('Escape', 400);
  await bot.key('e');
  await bot.key('k', 300);
  const modeK = await bot.g((g) => g.input.mode);
  const hudKey = await bot.page.evaluate(() => [...document.querySelectorAll('#ui kbd, #ui .ob-key, #ui [class*="key"]')].map((k) => k.textContent.trim()).filter((t) => /^k$/i.test(t)).length);
  bot.check(modeK === 'attackMove' && modeA !== 'attackMove', 'in a match K starts attack-move and A no longer does', `A -> ${modeA}, K -> ${modeK}`);
  bot.check(hudKey > 0, 'the HUD order buttons show the new key');
  await bot.key('Escape', 300);
  await bot.quitToMenu();
  // reset all to defaults
  await openSettings(bot);
  await bot.page.locator(`${S} .set-row`).filter({ hasText: /key/i }).locator('button').first().click();
  await bot.waitFor('.kb-foot .btn');
  await bot.click('.kb-foot .btn');
  const back = (await bot.page.locator('.kb-row').filter({ has: bot.page.locator('.kb-name', { hasText: /^Attack.move/i }) }).first().locator('.kb-key').first().textContent()).trim();
  bot.check(/^a$/i.test(back), 'Reset all to defaults restores A', back);
  await bot.key('Escape', 500);
  if (await bot.sees(S)) await bot.key('Escape', 500);
  await bot.waitMenu();
  await bot.noErrors('key rebinding');

  // ================================================================ language: Deutsch from the menu, then a match
  const navEn = (await bot.el('.mm-nav-btn', /Settings/).textContent()).trim();
  await openSettings(bot);
  const lang = `${S} [data-setting="language"]`;
  for (let i = 0; i < 12; i++) {
    const v = (await bot.page.locator(`${lang} .st-val b`).textContent()).trim();
    if (/deutsch/i.test(v)) break;
    await bot.click(`${lang} .st-arrow >> nth=1`, undefined, { after: 150 });
  }
  await bot.page.waitForFunction(() => document.documentElement.lang === 'de', null, { timeout: 30000 * bot.o.slow }).catch(() => {});
  await sleep(800);
  const de = await bot.page.evaluate(() => ({ lang: document.documentElement.lang, title: document.querySelector('.settings-panel h2')?.textContent }));
  bot.check(de.lang === 'de', 'the language switches to German from the menu', de);
  await bot.shot('settings-de');
  await bot.key('Escape', 600);
  await bot.waitMenu();
  const navDe = await bot.page.evaluate(() => [...document.querySelectorAll('.mm-nav-btn .nb-label')].map((e) => e.textContent.trim()).join(' | '));
  bot.check(!navDe.includes(navEn.replace(/^\d+/, '').trim()) && /Einstellungen/i.test(navDe), 'the main menu is in German', navDe.slice(0, 160));
  await bot.click('.main-screen .mm-panel .deploy');
  await bot.waitMatch();
  const hud = await bot.page.evaluate(() => ({ tabs: [...document.querySelectorAll('#ui .tab .tab-l')].map((e) => e.textContent.trim()).join(' | '), lang: document.documentElement.lang }));
  bot.check(hud.lang === 'de' && /Gebäude|Infanterie|Fahrzeuge/i.test(hud.tabs), 'the match HUD is in German', hud);
  await bot.shot('match-de');
  await bot.pause();
  await bot.click('.pause-screen .pp-btn[data-act="settings"]');
  await bot.waitFor(`${S} [data-setting="language"]`);
  const locked = await bot.page.locator(`${S} [data-setting="language"]`).getAttribute('aria-disabled');
  bot.check(locked === 'true', 'the language is locked during a battle (explained in the row)');
  await bot.key('Escape', 500);
  await bot.pauseAct('quit to menu');
  await bot.waitMenu();
  // back to English (the menu is in German now)
  await bot.click('.main-screen:not(.leaving) .mm-nav-btn', /Einstellungen/);
  await bot.waitFor(`${S} .set-row`);
  for (let i = 0; i < 12; i++) {
    const v = (await bot.page.locator(`${lang} .st-val b`).textContent()).trim();
    if (/^english$/i.test(v)) break;
    await bot.click(`${lang} .st-arrow >> nth=1`, undefined, { after: 150 });
  }
  await bot.page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 30000 * bot.o.slow }).catch(() => {});
  await sleep(600);
  await bot.key('Escape', 600);
  await bot.waitMenu();
  bot.check(await bot.page.evaluate(() => document.documentElement.lang) === 'en', 'and back to English');
  await bot.noErrors('language');

  // ================================================================ reduce motion, palette, interface scale, render scale in a match
  await openSettings(bot);
  const rowOf = (re) => bot.page.locator(`${S} .set-row`).filter({ has: bot.page.locator('.set-l b', { hasText: re }) }).first();
  await rowOf(/reduce motion/i).locator('.toggle').click();
  await rowOf(/team colou?rs/i).locator('.seg button[data-v="vs"]').click();
  await rowOf(/render/i).locator('.seg button[data-v="0.5"]').click();
  const scale = rowOf(/interface size|ui scale/i).locator('input.slider');
  await scale.focus();
  await bot.page.keyboard.press('End');
  await scale.press('Tab');
  await sleep(400);
  await bot.key('Escape', 600);
  await bot.waitMenu();
  await bot.click('.main-screen .mm-panel .deploy');
  await bot.waitMatch();
  const m = await bot.page.evaluate(() => {
    const g = window.__game, me = g.local;
    const foes = g.world.players.filter((p) => me.isEnemy(p));
    const col = (p) => g.ents.teamColors?.get(p.id)?.getHexString?.() ?? null;
    return {
      reduce: document.body.classList.contains('reduce-motion'), pal: document.body.classList.contains('pal-vs'),
      ui: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(), rs: g.gfx.currentRenderScale,
      foe: foes.map(col), own: col(me),
    };
  });
  bot.log('in the match:', JSON.stringify(m));
  bot.check(m.reduce, 'reduce motion is on in the match');
  bot.check(m.pal, 'the "You vs enemies" palette is on in the match', m.foe);
  bot.check(+m.ui >= 1.45, 'the interface scale reaches the match', m.ui);
  bot.check(m.rs <= 0.65, 'render resolution 50% applies to the 3D view', m.rs);
  await bot.shot('match-a11y');
  await bot.quitToMenu();
  await bot.page.evaluate(() => localStorage.removeItem('rh.settings'));
}
