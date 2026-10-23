// Keyboard only (no mouse at all): from a fresh profile, Tab through the main menu to Settings (a toggle switched with
// Space and back, Esc out), to the Campaign (a side picked with the keyboard, Esc out), then a Quick Battle started
// with Enter; in the match Esc opens the pause menu, Tab stays inside it (focus trap), Enter on Resume closes it, and
// Esc, Tab, Enter on Quit to menu leaves. Every element focused on the way must show the focus ring and lie inside
// the window (friction 'focus' otherwise).
import { sleep } from '../lib.mjs';

const focusInfo = (bot) => bot.page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return null;
  const cs = getComputedStyle(a);
  const b = a.getBoundingClientRect();
  return {
    tag: a.tagName.toLowerCase(), cls: String(a.className).trim().split(/\s+/).slice(0, 2).join('.'),
    text: (a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    nav: a.dataset?.nav ?? '', act: a.dataset?.act ?? '', tab: a.dataset?.tab ?? '', role: a.getAttribute('role') ?? '',
    on: a.classList.contains('on') || a.getAttribute('aria-checked') === 'true' || a.getAttribute('aria-pressed') === 'true',
    ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (!!cs.boxShadow && cs.boxShadow !== 'none'),
    inside: b.width > 1 && b.height > 1 && b.right > 0 && b.bottom > 0 && b.left < innerWidth && b.top < innerHeight,
    screen: a.closest('.screen') ? String(a.closest('.screen').className) : a.closest('#ui') ? '#ui' : '',
  };
});

export default async function keyboard(bot) {
  const noted = new Set();
  const look = (f, what) => {
    const id = `${f.tag}.${f.cls} "${f.text}"`;
    if (!f.ring && !noted.has(`r${id}`)) { noted.add(`r${id}`); bot.friction('focus', `${what}: ${id} shows no focus ring`); }
    if (!f.inside && !noted.has(`i${id}`)) { noted.add(`i${id}`); bot.friction('focus', `${what}: ${id} is focused outside the window`); }
  };
  /** Tab (Shift+Tab with back) until the focused element matches; null (and a failed check) if it never does. */
  const tabTo = async (pred, what, { n = 70, back = false } = {}) => {
    for (let i = 0; i < n; i++) {
      await bot.page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
      await sleep(110);
      const f = await focusInfo(bot);
      if (!f) continue;
      look(f, what);
      if (pred(f)) { bot.log(`${what}: reached after ${i + 1} Tab presses`); return f; }
    }
    bot.check(false, `Tab reaches ${what}`);
    return null;
  };

  await bot.goto();
  await bot.waitMenu();
  await sleep(1500);

  // ---- Settings: a toggle with Space, then back with Esc
  if (await tabTo((f) => f.nav === 'settings', 'the Settings entry')) {
    await bot.key('Enter', 1500);
    bot.check(await bot.sees('.screen:not(.leaving) .settings-panel .set-row'), 'Enter opens Settings');
    const t = await tabTo((f) => /toggle/.test(f.cls) || f.role === 'switch', 'a toggle in Settings');
    if (t) {
      await bot.key('Space', 500);
      const t2 = await focusInfo(bot);
      bot.check(t2 && t2.on !== t.on, 'Space switches the focused toggle', `${t.on} -> ${t2?.on}`);
      await bot.key('Space', 500);
    }
    const inside = await focusInfo(bot);
    bot.check(inside && /settings|sub-screen/.test(inside.screen), 'focus stays inside the Settings screen', inside?.screen);
    await bot.key('Escape', 1200);
    bot.check(await bot.sees('.main-screen:not(.leaving) .mm-nav-btn'), 'Esc returns to the main menu');
  }

  // ---- Campaign: pick the Soviet side with the keyboard
  if (await tabTo((f) => f.nav === 'campaign', 'the Campaign entry')) {
    await bot.key('Enter', 2000);
    bot.check(await bot.waitFor('.cmp .cmp-tab', undefined, 20000), 'Enter opens the Campaign');
    const s = await tabTo((f) => f.tab === 'soviet', 'the Soviet tab');
    if (s) {
      await bot.key('Enter', 1200);
      const on = await bot.page.evaluate(() => document.querySelector('.cmp .cmp-tab[data-tab="soviet"]')?.classList.contains('on') || document.querySelector('.cmp .cmp-tab[data-tab="soviet"]')?.getAttribute('aria-selected') === 'true');
      bot.check(on, 'Enter on the Soviet tab shows the Soviet campaign');
    }
    await bot.shot('campaign-keyboard');
    await bot.key('Escape', 1500);
    bot.check(await bot.sees('.main-screen:not(.leaving) .mm-nav-btn'), 'Esc leaves the Campaign');
  }
  await bot.noErrors('menus by keyboard');

  // ---- a Quick Battle with Enter
  if (!await tabTo((f) => f.nav === 'quick', 'the Quick Battle entry')) return;
  await bot.key('Enter', 500);
  await bot.waitMatch();
  await bot.wait(3);

  // ---- the pause menu: Esc, Tab stays inside, Enter on Resume; then Quit to menu
  await bot.key('Escape', 900);
  bot.check(await bot.sees('.pause-screen:not(.leaving) .pp-btn'), 'Esc opens the pause menu');
  const seen = new Set();
  for (let i = 0; i < 24; i++) {
    await bot.page.keyboard.press('Tab');
    await sleep(100);
    const f = await focusInfo(bot);
    if (f) { look(f, 'pause menu'); seen.add(/pause-screen/.test(f.screen) ? 'in' : `out: ${f.tag}.${f.cls} (${f.screen})`); }
  }
  bot.check(seen.size === 1 && seen.has('in'), 'Tab stays inside the pause menu', [...seen].join('; '));
  if (await tabTo((f) => f.act === 'resume', 'Resume')) {
    await bot.key('Enter', 900);
    bot.check(!await bot.sees('.pause-screen:not(.leaving) .pp-btn'), 'Enter on Resume closes the pause menu');
  }
  const t0 = await bot.simTime();
  await bot.wait(2);
  bot.check(await bot.simTime() > t0, 'the battle runs again');
  await bot.key('Escape', 900);
  if (await tabTo((f) => f.act === 'quit to menu', 'Quit to menu')) {
    await bot.key('Enter', 1500);
    // (a confirmation, if any, is answered with the keyboard too)
    if (!await bot.sees('.main-screen:not(.leaving) .mm-nav-btn')) {
      const c = await tabTo((f) => /confirm|yes|quit/i.test(`${f.act} ${f.cls}`), 'the confirmation', { n: 12 });
      if (c) await bot.key('Enter', 1500);
    }
    await bot.waitMenu(60000);
    bot.check(await bot.sees('.main-screen:not(.leaving) .mm-nav-btn'), 'Quit to menu by keyboard reaches the main menu');
  }
  await bot.noErrors('a battle by keyboard');
}
