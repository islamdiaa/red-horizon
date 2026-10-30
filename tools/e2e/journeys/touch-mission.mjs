// Touch, the mission UI (Chromium with touch emulation; run with --touch --mobile --size 844x390): the Campaign
// screen and Allied mission 1 started with taps; in the mission, landscape (844x390) then portrait (390x844): the
// objectives, the Field Manual panel, the mission radio, the build bar, the minimap and the top-right panel fit the
// window and don't cover each other, no text is clipped (Bot.audit), the Field Manual's x closes it, a press and hold
// on open map opens the radial menu inside the window, and the pause menu opens with a tap. Then the debrief after the
// mission (won, set directly: the screens are under test), in both shapes: the XP strip and the medal toasts off its
// title, stars and buttons, which fit and answer taps.
import { sleep } from '../lib.mjs';

/** HUD and mission panels on show: off-window and overlapping boxes (hudshot's test plus the mission panels). */
const layout = (bot) => bot.page.evaluate(() => {
  const vis = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 4 && b.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 ? b : null; };
  const names = { '#buildbar': 'buildbar', '#sidebar': 'sidebar', '#minimap-panel': 'minimap', '#topright': 'topright', '#topbar': 'topbar', '#selpanel': 'selpanel', '.mh-obj': 'objectives', '.hint.on': 'fieldManual', '.mh-tx.on': 'radio', '.mh-timer.on': 'timer', '#cmdpanel': 'commander', '.touch-bar, #touchbar, .tbar': 'touchbar' };
  const boxes = [], off = [];
  for (const [sel, name] of Object.entries(names)) {
    for (const e of document.querySelectorAll(sel)) {
      const b = vis(e);
      if (!b) continue;
      boxes.push({ name, b });
      if (b.right > innerWidth + 2 || b.bottom > innerHeight + 2 || b.left < -2 || b.top < -2) off.push(`${name} [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`);
    }
  }
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].b, c = boxes[j].b;
    const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left), oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
    if (ox > 6 && oy > 6) overlaps.push(`${boxes[i].name} x ${boxes[j].name} ${Math.round(ox)}x${Math.round(oy)}`);
  }
  return { off, overlaps, shown: boxes.map((b) => b.name) };
});

async function tapSel(bot, sel) {
  const l = bot.page.locator(sel).locator('visible=true').first();
  await l.waitFor({ state: 'visible', timeout: 30000 * bot.o.slow });
  await l.tap({ timeout: 15000 * bot.o.slow });
  await sleep(500);
}

/** A finger held still on a screen point for `ms` (CDP touch events: the radial menu's press and hold). */
async function hold(bot, x, y, ms = 900) {
  const cdp = bot.cdp ?? (bot.cdp = await bot.context.newCDPSession(bot.page));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
}

async function checkMission(bot, where) {
  await bot.frames(3);
  const l = await layout(bot);
  bot.log(`${where}: panels ${l.shown.join(', ')}`);
  bot.check(l.off.length === 0, `${where}: the mission's panels stay inside the window`, l.off.join('; '));
  for (const o of l.overlaps) bot.friction('overlap', `${where}: ${o}`);
  await bot.audit(where);
  await bot.shot(where);
  // the Field Manual: with no alert up by itself, one is put up (the panel's own render, a close-out alert's length
  // with its Show button) so its place is tested: its x finger-sized and uncovered, the panel off the build bar,
  // the minimap and the toolbar
  if (!await bot.sees('.hint.on')) {
    await bot.page.evaluate(() => { const h = window.__game.hints; h?.render?.('<span class="hint-k">Field report</span><span class="hint-t"><b>The enemy is nearly beaten.</b> Finish it: select every combat unit (E) and attack-move (A) to its last structures, marked on the radar. <b>Show</b> takes you there.</span><button type="button" class="hint-go">Show</button>'); });
    await sleep(800);
  }
  const x = await bot.page.evaluate(() => {
    const e = document.querySelector('.hint.on .hint-x'); if (!e) return null;
    const b = e.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    const p = document.querySelector('.hint.on').getBoundingClientRect();
    const hits = ['#buildbar', '#minimap-panel', '#touch-bar', '#selpanel.on'].filter((s) => { const o = document.querySelector(s)?.getBoundingClientRect(); return o && o.width > 4 && Math.min(p.right, o.right) - Math.max(p.left, o.left) > 4 && Math.min(p.bottom, o.bottom) - Math.max(p.top, o.top) > 4; });
    return { w: Math.round(b.width), h: Math.round(b.height), free: !!top && (e === top || e.contains(top)), panel: [p.left, p.top, p.right, p.bottom].map(Math.round), over: hits };
  });
  if (x) {
    bot.check(x.w >= 40 && x.h >= 40 && x.free, `${where}: the Field Manual's x is finger-sized and uncovered`, JSON.stringify(x));
    // (a big selection on a landscape phone fills the right-hand column: the Field Manual is drawn over its top, its
    // x free, and scrolls; noted as friction, not a failure)
    const hard = x.over.filter((s) => s !== '#selpanel.on');
    bot.check(!hard.length, `${where}: the Field Manual is off the build bar, minimap and toolbar`, JSON.stringify(x));
    if (x.over.includes('#selpanel.on')) bot.friction('overlap', `${where}: the Field Manual over the top of the selection panel`);
    await bot.shot(`${where}-alert`);
    await bot.page.evaluate(() => document.querySelector('.hint.on .hint-x')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await sleep(300);
    bot.check(!await bot.sees('.hint.on'), `${where}: the Field Manual's x closes it`);
  }
  // press and hold on the battlefield (with the army selected: E is the radial's "all units" too), on a point where
  // the map is on top: earlier portrait failures were holds on the Field Manual panel, which covers the middle of a
  // portrait screen (the forced panel above stayed up: hints.ts ignored its x when no tutorial step was showing)
  await bot.page.evaluate(() => { const g = window.__game; g.input?.select(g.world.units.filter((u) => u.alive && u.owner === g.local && u.weapons.length).map((u) => u.id)); });
  await sleep(500);
  const a = await bot.playArea();
  const spot = await bot.page.evaluate((a) => {
    const onMap = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && e.tagName === 'CANVAS' && !e.closest('#ui'); };
    const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
    const under = document.elementFromPoint(cx, cy);
    const what = under ? `${under.tagName.toLowerCase()}${under.id ? `#${under.id}` : ''}${typeof under.className === 'string' && under.className ? `.${under.className.split(' ')[0]}` : ''}` : 'nothing';
    for (let r = 0; r <= 6; r++) for (let k = 0; k < Math.max(1, 8 * r); k++) {
      const ang = (k / Math.max(1, 8 * r)) * Math.PI * 2;
      const x = cx + Math.cos(ang) * r * (a.x1 - a.x0) / 14, y = cy + Math.sin(ang) * r * (a.y1 - a.y0) / 14;
      if (x > a.x0 && x < a.x1 && y > a.y0 && y < a.y1 && onMap(x, y)) return { x, y, centre: r === 0, what };
    }
    return { x: cx, y: cy, centre: true, none: true, what };
  }, a);
  if (!spot.centre) bot.log(`${where}: the middle of the play area is under ${spot.what}; holding on the map beside it`);
  if (spot.none) bot.log(`${where}: no open map in the play area (${spot.what})`);
  await hold(bot, spot.x, spot.y);
  const r = await bot.page.evaluate(() => {
    const m = document.getElementById('rh-radial');
    if (!m?.classList.contains('on')) return null;
    const items = [...m.querySelectorAll('button, .rr-item')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 2);
    const out = items.filter((b) => b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1).length;
    return { n: items.length, out };
  });
  if (bot.check(!!r, `${where}: press and hold opens the radial menu`)) bot.check(r.out === 0, `${where}: every radial item is inside the window`, `${r.out} of ${r.n} outside`);
  await bot.shot(`${where}-radial`);
  await bot.page.evaluate(() => document.querySelector('#rh-radial .rr-back')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await sleep(400);
  // the pause menu with a tap on the menu button
  await tapSel(bot, '#ui .tb-menu').catch(() => bot.check(false, `${where}: the menu button can be tapped`));
  bot.check(await bot.waitFor('.pause-screen:not(.leaving) .pp-btn', undefined, 10000), `${where}: a tap on the menu button pauses`);
  await bot.audit(`${where} pause`);
  await tapSel(bot, '.pause-screen:not(.leaving) .pp-btn[data-act="resume"]').catch(() => {});
  await sleep(600);
}

export default async function touchMission(bot) {
  if (!bot.o.touch) bot.log('(run with --touch --mobile for touch emulation)');
  await bot.goto();
  await bot.waitMenu();
  // a phone's one-column main menu: tapping Skirmish brings its panel into view (it opened below the fold)
  await tapSel(bot, '.main-screen:not(.leaving) .mm-nav-btn[data-nav="skirmish"]');
  // (a smooth scroll: wait for it to settle, up to 6 s on a slow renderer)
  let top = -1;
  for (let i = 0; i < 12; i++) { await sleep(500); top = await bot.page.evaluate(() => Math.round(document.querySelector('.main-screen:not(.leaving) .mm-panel')?.getBoundingClientRect().top ?? -1)); if (top >= 0 && top < 200) break; }
  bot.check(top >= 0 && top < (await bot.page.evaluate(() => innerHeight)) * 0.6, 'tapping Skirmish brings the skirmish panel into view', `panel top ${top}`);
  await bot.page.evaluate(() => document.querySelector('.main-screen:not(.leaving)')?.scrollTo?.(0, 0));
  await tapSel(bot, '.main-screen:not(.leaving) .mm-nav-btn[data-nav="campaign"]');
  await bot.waitFor('.cmp .cmp-tab', undefined, 30000);
  await tapSel(bot, '.cmp .cmp-tab[data-tab="allies"]');
  await bot.audit('campaign (touch)');
  await bot.shot('campaign');
  await bot.page.locator('.cmp .node[data-id="allied-01"]').first().dispatchEvent('click');
  await sleep(600);
  await tapSel(bot, '.cmp [data-act="deploy"]');
  await bot.waitMatch();
  await bot.wait(25); // (the opening radio and the objectives)
  const shape = () => bot.page.evaluate(() => (innerWidth > innerHeight ? 'landscape' : 'portrait'));
  await checkMission(bot, await shape());
  // (a phone browser enters fullscreen with the mission; the emulated window can only be resized out of it)
  const unfull = () => bot.page.evaluate(() => document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : null);
  await unfull();
  await bot.page.setViewportSize({ width: bot.o.height, height: bot.o.width });
  await sleep(2500);
  await checkMission(bot, await shape());
  await bot.noErrors('the mission by touch');

  // the debrief, in this shape and then the other: the XP strip and a medal toast off its title (the mission line and
  // the heading), its stars and its buttons; the buttons inside the window and finger-sized
  await bot.page.evaluate(() => window.__game.world.mission?.win());
  const ok = await bot.page.waitForSelector('.dbf:not(.leaving), .end-screen:not(.leaving)', { state: 'visible', timeout: 120000 * bot.o.slow }).then(() => true, () => false) || await bot.forceEnd(true, 120000);
  if (!bot.check(ok, 'the debrief appears after the mission')) return;
  const debrief = async (where) => {
    await bot.audit(`debrief ${where}`);
    await bot.shot(`debrief-${where}`);
    const cover = await bot.page.evaluate(() => {
      const parts = { kicker: '.dbf-top .kick', title: '.dbf-top h1', stars: '.dbf-stars', buttons: '.dbf-actions' };
      // (the text's own extent: the heading and the mission line are blocks as wide as the screen)
      // (and the glyphs' height, not the line box's: a big heading's line box reaches well above its letters)
      const box = (sel) => {
        const e = document.querySelector(sel); if (!e) return null;
        const rg = document.createRange(); rg.selectNodeContents(e); const b = rg.getBoundingClientRect();
        const inset = Math.max(0, (b.height - parseFloat(getComputedStyle(e).fontSize)) / 2);
        return b.width > 4 && b.height > 4 ? { left: b.left, right: b.right, top: b.top + inset, bottom: b.bottom - inset } : null;
      };
      const hit = (a, b) => !!(a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 6 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 6);
      const over = (sel) => { const o = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 4); return Object.keys(parts).filter((k) => o.some((b) => hit(box(parts[k]), b))); };
      return { xpShown: !!document.querySelector('.rhx-sum:not(.out)'), xpCompact: !!document.querySelector('.rhx-sum.compact'), xp: over('.rhx-sum:not(.out)'), medalShown: !!document.querySelector('.rhx-t:not(.out)'), medal: over('.rhx-toasts .rhx-t:not(.out)') };
    });
    bot.log(`debrief ${where}: XP strip ${cover.xpShown ? `shown (compact ${cover.xpCompact}) over [${cover.xp}]` : 'gone'}, medal toast ${cover.medalShown ? `shown over [${cover.medal}]` : 'none'}`);
    if (cover.xpShown) bot.check(!cover.xp.length, `debrief ${where}: the XP strip is off the title, the stars and the buttons`, cover.xp.join(', '));
    if (cover.medalShown) bot.check(!cover.medal.length, `debrief ${where}: the medal toast is off the title, the stars and the buttons`, cover.medal.join(', '));
    const btns = await bot.page.evaluate(() => [...document.querySelectorAll('.dbf [data-act]')].map((b) => { const r = b.getBoundingClientRect(); return { act: b.dataset.act, ok: r.width >= 40 && r.height >= 36 && r.bottom <= innerHeight && r.right <= innerWidth && r.top >= 0 }; }));
    bot.check(btns.length > 0 && btns.every((b) => b.ok), `debrief ${where}: the buttons are inside the window and big enough to tap`, JSON.stringify(btns));
  };
  await sleep(1800);
  await debrief(await shape());
  await unfull();
  await bot.page.setViewportSize({ width: bot.o.width, height: bot.o.height });
  await sleep(1200);
  await debrief(await shape());
  await tapSel(bot, '.dbf [data-act="menu"]');
  // (a campaign mission's "Main menu" leads to the campaign screen: src/main.ts onMenu -> openCampaign)
  const back = await bot.page.waitForSelector(':is(.main-screen:not(.leaving) .mm-nav-btn, .cmp .cmp-tab)', { state: 'visible', timeout: 60000 * bot.o.slow }).then(() => true, () => false);
  bot.check(back, 'leaving the debrief by touch (Main menu: the campaign screen)');
  await bot.noErrors('the debrief by touch');
}
