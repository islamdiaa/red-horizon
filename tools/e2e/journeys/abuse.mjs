// Abuse: what an impatient or distracted player does. Rapid clicks and double-submits on menu entries, Deploy, build
// cards, Save and Quit; Esc spam in menus and in a match; the window losing focus (another tab, alt-tab) and coming
// back; the window resized mid-match (down to a phone in portrait and back).
import { sleep } from '../lib.mjs';

/** Screens and overlays that should exist at most once. */
const screens = (bot) => bot.page.evaluate(() => ({
  screens: [...document.querySelectorAll('.screen:not(.leaving)')].map((s) => s.className.replace(/\s+/g, '.')),
  canvases: document.querySelectorAll('body > canvas, #game canvas, canvas.webgl').length,
  game: window.__game ? { demo: !!window.__game.setup.demo, seed: window.__game.setup.seed, paused: !!window.__game.paused } : null,
}));

/** Click a selector n times as fast as the mouse allows. */
async function hammer(bot, selector, n = 6) {
  const l = bot.el(selector);
  const box = await l.boundingBox().catch(() => null);
  if (!box) return false;
  for (let i = 0; i < n; i++) await bot.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 0 });
  return true;
}

export default async function abuse(bot) {
  await bot.goto();
  await bot.waitMenu();

  // ---- menu: entries in quick succession, Esc spam back to the main menu
  for (const e of ['Settings', 'Replays', 'Controls', 'Commander']) {
    await bot.el('.main-screen:not(.leaving) .mm-nav-btn', e).click({ noWaitAfter: true, timeout: 5000 }).catch(() => {});
    await sleep(120);
    for (let i = 0; i < 3; i++) await bot.page.keyboard.press('Escape');
  }
  await sleep(1500);
  for (let i = 0; i < 5 && !await bot.sees('.main-screen:not(.leaving) .mm-nav-btn'); i++) await bot.key('Escape', 500);
  let s = await screens(bot);
  bot.check(s.screens.length === 1 && /main-screen/.test(s.screens[0]), 'menu entries and Esc spam end on one main menu', s.screens);
  await bot.noErrors('menu spam');

  // ---- the browser's Back (Android Back, a mouse's back button) on a menu screen returns to the main menu
  for (const e of ['Settings', 'Campaign', 'Replays']) {
    await bot.nav(e);
    await sleep(1200);
    await bot.page.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => {}); // (no navigation when the game keeps it)
    const back = await bot.page.waitForSelector('.main-screen:not(.leaving) .mm-nav-btn', { state: 'visible', timeout: 15000 }).then(() => true, () => false);
    const still = await bot.page.evaluate(() => !!document.getElementById('ui')).catch(() => false);
    bot.check(back && still, `Back on ${e} returns to the main menu (and stays on the page)`, await bot.page.url());
    await sleep(500);
  }

  // ---- double-submit: Deploy clicked six times starts one match
  await bot.click('.main-screen .mm-panel .seg button[data-v="64"]');
  await bot.click('.main-screen .mm-panel .seg button[data-v="heavy"]');
  await hammer(bot, '.main-screen .mm-panel .deploy', 6);
  await bot.waitMatch();
  await sleep(3000);
  s = await screens(bot);
  const seed = s.game?.seed;
  await sleep(3000);
  const s2 = await screens(bot);
  bot.check(s2.game && !s2.game.demo && s2.game.seed === seed && s2.screens.length === 0, 'Deploy hammered six times starts exactly one match', s2);
  await bot.noErrors('deploy x6');

  // ---- build-card spam: 25 clicks queue what the money and the queue allow, never negative credits
  const mcv = (await bot.mine()).units.find((u) => u.t === 'mcv');
  if (mcv) { await bot.lookAt(mcv.x, mcv.y); const p = await bot.toScreen(mcv.x, mcv.y, 0.4); await bot.page.mouse.click(p.x, p.y); await bot.key('d'); await bot.wait(3); }
  if (await bot.findCard('powr')) {
    const box = await bot.card('powr').boundingBox();
    for (let i = 0; i < 25 && box; i++) await bot.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 0 });
    await sleep(500);
    const q = await bot.g((g) => ({ items: g.local.queues.structure.items.length, credits: g.local.credits }));
    bot.check(q.items <= 1 && q.credits >= 0, 'clicking a structure card 25 times queues one structure', q);
    // ---- a quick click on a slow frame: hover one spot, then click another before the next frame is drawn; the
    // structure goes where the click is (the ghost still shows the old spot)
    await bot.wait(60, { until: '(() => window.__game?.local.queues.structure.ready === "powr")()' });
    await bot.clickCard('powr');
    await sleep(300);
    const spots = await bot.g((g) => {
      const f = g.world.buildings.find((b) => b.alive && b.owner === g.local && b.bt.id === 'fact');
      const ok = (cx, cy) => g.world.canPlace(g.local, 'powr', cx, cy);
      const out = [];
      for (let r = 3; r <= 7 && out.length < 12; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
        const cx = Math.round(f.x + dx - 1), cy = Math.round(f.y + dy - 1);
        if (ok(cx, cy)) out.push({ cx, cy, x: cx + 1, y: cy + 1 });
      }
      return out;
    });
    let pa = null, pb = null;
    for (const a of spots) for (const b of spots) {
      if (pa || Math.hypot(a.cx - b.cx, a.cy - b.cy) < 3) continue;
      const sa = await bot.toScreen(a.x, a.y), sb = await bot.toScreen(b.x, b.y);
      if (await bot.inPlay(sa) && await bot.inPlay(sb)) { pa = { ...a, s: sa }; pb = { ...b, s: sb }; }
    }
    if (pa && pb && await bot.g((g) => g.input.mode) === 'place') {
      await bot.page.mouse.move(pa.s.x, pa.s.y, { steps: 2 });
      await bot.frames(3);
      await bot.page.mouse.click(pb.s.x, pb.s.y); // (move + press + release in one go: no frame in between on a slow renderer)
      await bot.wait(1);
      const placed = await bot.g((g) => g.world.buildings.filter((b) => b.owner === g.local && b.bt.id === 'powr').map((b) => [b.cx, b.cy]));
      bot.check(placed.some(([x, y]) => x === pb.cx && y === pb.cy), 'a quick click places the structure where it was clicked, not where the last frame saw the pointer', `clicked ${pb.cx},${pb.cy} after hovering ${pa.cx},${pa.cy}; placed ${JSON.stringify(placed)}`);
    } else {
      bot.log('quick-click placement: no two visible spots');
      await bot.key('Escape');
      await bot.clickCard('powr', { button: 'right' }); // cancel it
    }
  }
  await bot.key('e');
  const infantry = await bot.findCard('e1') && !await bot.card('e1').evaluate((e) => e.classList.contains('locked')).catch(() => true);
  if (infantry) {
    const box = await bot.card('e1').boundingBox();
    for (let i = 0; i < 40 && box; i++) await bot.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 0 });
    await sleep(500);
    const q = await bot.g((g) => ({ items: g.local.queues.infantry?.items.length ?? 0, credits: g.local.credits }));
    bot.check(q.credits >= 0, 'clicking a unit card 40 times never overdraws', q);
  }

  // ---- Esc spam in the match: the pause menu and the game's paused state agree, one pause screen at most
  for (let n of [7, 8]) {
    for (let i = 0; i < n; i++) await bot.page.keyboard.press('Escape');
    await sleep(1200);
    s = await screens(bot);
    const pauses = s.screens.filter((c) => /pause-screen/.test(c)).length;
    const consistent = pauses <= 1 && (pauses === 1) === !!s.game?.paused;
    bot.check(consistent, `Esc pressed ${n} times: the pause menu and the paused game agree`, s);
  }
  if ((await screens(bot)).screens.some((c) => /pause-screen/.test(c))) await bot.key('Escape', 800);

  // ---- Save hammered: one save, a sane label
  await bot.pause();
  await hammer(bot, '.pause-screen .pp-btn[data-act="save game"]', 5);
  await sleep(500);
  const saved = await bot.page.evaluate(() => { try { return !!JSON.parse(localStorage.getItem('rh.save.manual')).savedAt; } catch { return false; } });
  bot.check(saved, 'Save hammered five times leaves a valid save');
  await bot.click('.pause-screen .pp-btn[data-act="resume"]');
  await bot.noErrors('in-match spam');

  // ---- focus: another tab in front for a while, then back; a synthetic alt-tab (blur / focus)
  const t0 = await bot.simTime();
  const other = await bot.context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await sleep(4000);
  await bot.page.bringToFront();
  await sleep(1500);
  await bot.page.evaluate(() => { window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(1500);
  await bot.page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await other.close();
  await sleep(2000);
  s = await screens(bot);
  const t1 = await bot.simTime();
  const pausedNoMenu = s.game?.paused && !s.screens.length;
  bot.check(!pausedNoMenu, 'after leaving and coming back the game is running, or paused with its menu shown', { ...s, t0, t1 });
  if (s.screens.some((c) => /pause-screen/.test(c))) await bot.key('Escape', 800);
  await bot.wait(2);
  bot.check((await bot.simTime()) > t1, 'the match goes on after coming back');

  // ---- the mouse wheel in page mode (Windows' "one screen at a time" setting) zooms as much as a few notches
  // (Playwright's wheel sends pixels, so this one event is synthetic)
  const zoom = await bot.page.evaluate(() => {
    const c = window.__game.gfx.cam, before = c.targetDist;
    const canvas = document.querySelector('#game-canvas') ?? [...document.querySelectorAll('canvas')].sort((a, b) => b.width - a.width)[0];
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, deltaMode: 2, bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    const after = c.targetDist;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, deltaMode: 2, bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    return { before, after };
  });
  bot.check(zoom.after / zoom.before > 1.3 || zoom.after >= 60, 'one page-mode wheel step zooms out noticeably', zoom);

  // ---- resize mid-match: smaller, bigger, phone portrait, back. Deploy went fullscreen (the default): leave it with
  // the HUD's fullscreen button first, as a player resizing a window would
  if (await bot.page.evaluate(() => !!document.fullscreenElement)) {
    await bot.clickEl(bot.page.locator('#ui .tb-fs').first());
    await sleep(800);
    bot.check(await bot.page.evaluate(() => !document.fullscreenElement), 'the HUD fullscreen button leaves fullscreen');
  }
  for (const [w, h] of [[800, 600], [1920, 1080], [390, 844], [1280, 720]]) {
    await bot.page.setViewportSize({ width: w, height: h });
    await sleep(2500);
    await bot.frames(2);
    const r = await bot.page.evaluate(() => {
      const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const cr = c?.getBoundingClientRect();
      const off = [...document.querySelectorAll('#ui > *, #ui :is(#buildbar, #sidebar, #topbar, #topright, #dock)')].filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 4 && b.height > 4 && getComputedStyle(e).display !== 'none' && (b.right > innerWidth + 2 || b.bottom > innerHeight + 2 || b.left < -2 || b.top < -2);
      }).map((e) => `${e.id || e.className.split(' ')[0]}`);
      return { css: cr ? [Math.round(cr.width), Math.round(cr.height)] : null, vp: [innerWidth, innerHeight], off: [...new Set(off)].slice(0, 6) };
    });
    bot.check(r.css && Math.abs(r.css[0] - w) <= 2 && Math.abs(r.css[1] - h) <= 2, `resized to ${w}x${h}: the 3D view fills the window`, r);
    bot.check(!r.off.length, `resized to ${w}x${h}: the HUD stays on screen`, r.off);
    if (w === 390) await bot.shot('phone-portrait');
  }
  await bot.wait(3);
  await bot.noErrors('focus and resize');

  // ---- Quit hammered: one main menu, the backdrop comes back
  await bot.pause();
  await hammer(bot, '.pause-screen .pp-btn[data-act="quit to menu"]', 4);
  await bot.waitMenu();
  await sleep(3000);
  s = await screens(bot);
  bot.check(s.screens.length === 1 && /main-screen/.test(s.screens[0]) && (!s.game || s.game.demo), 'Quit hammered: one main menu', s);

  // ---- Quick Battle double-click: one match
  await hammer(bot, '.main-screen:not(.leaving) .mm-nav-btn:has(.nb-idx:text-is("»"))', 3);
  await bot.waitMatch();
  const q1 = (await screens(bot)).game?.seed;
  await sleep(4000);
  const q2 = await screens(bot);
  bot.check(q2.game && !q2.game.demo && q2.game.seed === q1, 'Quick Battle clicked three times starts one match', q2);
  await bot.quitToMenu();
  // ---- a touch screen (a phone in landscape): the intro and the Field Manual speak of taps, not keys and clicks
  if (!bot.o.cdp && bot.o.browser === 'chromium') {
    await bot.page.goto('about:blank'); // (one game at a time on a software GPU)
    const ctx = await bot.browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: bot.o.locale });
    const tp = await ctx.newPage();
    bot.attach(tp);
    await tp.goto(bot.url({ autostart: 1, intro: 1, units: 'mcv', size: 64 }), { waitUntil: 'load' });
    const coarse = await tp.evaluate(() => matchMedia('(pointer: coarse)').matches);
    let skip = null;
    for (let i = 0; i < 120 && !skip; i++) { skip = await tp.evaluate(() => document.querySelector('.cine-skip')?.textContent ?? null).catch(() => null); if (!skip) await sleep(1000 * bot.o.slow); }
    await tp.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 60000 * bot.o.slow }).catch(() => {});
    const hint = await tp.waitForSelector('.hint.on .hint-t', { timeout: 30000 * bot.o.slow }).then((e) => e.textContent(), () => null);
    bot.check(!coarse || (/tap/i.test(skip ?? '') && !/key/i.test(skip ?? '')), 'on a touch screen the intro says "tap to skip"', `${skip} (coarse pointer ${coarse})`);
    bot.check(!coarse || (!!hint && /\btap|\bhold/i.test(hint) && !/click|\bkey/i.test(hint)), 'on a touch screen the Field Manual speaks of taps', hint);
    await ctx.close();
  }

}
