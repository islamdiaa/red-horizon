// World Conquest: no leak across visits. Opens the world screen from the menu and goes back, eight times, then fights
// three battles from the globe and returns (forced wins), measuring the JS heap after a forced garbage collection
// (Chromium DevTools protocol) and watching the console for WebGL context warnings (a globe renderer that is never
// released shows up as "Too many active WebGL contexts" and a lost context).
import { sleep } from '../lib.mjs';
import { findAttack, forceWin, tapTerritory, Wd } from './world.mjs';

async function heapMB(bot) {
  if (bot.o.browser !== 'chromium') return null;
  const s = bot.cdp ??= await bot.context.newCDPSession(bot.page);
  await s.send('HeapProfiler.collectGarbage').catch(() => {});
  await sleep(300);
  await s.send('HeapProfiler.collectGarbage').catch(() => {});
  const m = await s.send('Runtime.getHeapUsage').catch(() => null);
  return m ? +(m.usedSize / 1048576).toFixed(1) : null;
}

export default async function worldMemory(bot) {
  const warn = [];
  bot.page.on('console', (m) => { if (/WebGL context|Too many active WebGL/i.test(m.text())) warn.push(m.text().slice(0, 160)); });
  await bot.goto({}, '#world=1&home=germany&size=blitz&diff=easy');
  await bot.waitFor('.wc-side [data-act="begin"]', undefined, 120000);
  await bot.click('.wc-side [data-act="begin"]');
  await bot.waitFor('.wc-top', undefined, 60000);
  const heaps = [];
  for (let k = 0; k < 8; k++) {
    // back to the menu (the world menu's Save and quit), then in again
    await bot.key('Escape', 700);
    if (await bot.sees('[data-m="save"]')) await bot.click('[data-m="save"]');
    await bot.waitMenu();
    heaps.push(await heapMB(bot));
    await bot.click('.main-screen:not(.leaving) .mm-nav-btn[data-nav="world"]');
    if (await bot.waitFor('.wc-side [data-act="resume"]', undefined, 30000)) await bot.click('.wc-side [data-act="resume"]');
    await bot.waitFor('.wc-top', undefined, 60000);
    await sleep(800);
  }
  bot.log(`heap at the menu after each visit (MB): ${heaps.join(' ')}`);
  const growth = heaps[heaps.length - 1] - heaps[1];
  bot.check(heaps[1] === null || growth < 8, 'eight visits to the world screen do not grow the heap (under 8 MB from visit 2 to 8)', `${heaps.join(' ')} (+${growth?.toFixed(1)} MB)`);
  const contexts = await Wd(bot, () => document.querySelectorAll('canvas').length);
  bot.log(`canvases on the page: ${contexts}`);
  // battles: fight, win, back to the globe
  const bh = [];
  for (let k = 0; k < 3; k++) {
    const st = await Wd(bot, () => window.__world?.run?.phase);
    if (st === 'reinforce') { if (await bot.sees('[data-act="all"]')) await bot.click('[data-act="all"]'); else { const id = await Wd(bot, () => { const r = window.__world.run; return r.territories.find((t) => t.owner === r.player).id; }); const p = await Wd(bot, (id) => { const w = window.__world, q = w.globe.screenOf(w.siteOf(id)), r = w.stage.getBoundingClientRect(); return q && { x: q.x + r.left, y: q.y + r.top }; }, id); if (p) await bot.page.mouse.click(p.x, p.y); await sleep(300); if (await bot.sees('[data-act="all"]')) await bot.click('[data-act="all"]'); } await bot.click('[data-act="next"]'); }
    const a = await findAttack(bot);
    if (!a) break;
    await tapTerritory(bot, a.from, 'battle source');
    await tapTerritory(bot, a.to, 'battle target');
    if (!await bot.sees('[data-act="fight"]')) break;
    await bot.click('[data-act="fight"]');
    if (await bot.sees('.wc-modal [data-yes]')) await bot.click('.wc-modal [data-yes]');
    await bot.waitMatch();
    await bot.wait(5);
    await forceWin(bot);
    await bot.page.waitForSelector('.wc-modal [data-go]', { state: 'visible', timeout: 300000 }).catch(() => {});
    await bot.click('.wc-modal [data-go]');
    await bot.waitFor('.wc-top', undefined, 90000);
    if (await bot.sees('[data-act="done"]')) await bot.click('[data-act="done"]');
    bh.push(await heapMB(bot));
  }
  bot.log(`heap on the globe after each battle (MB): ${bh.join(' ')}`);
  bot.check(bh.length < 2 || bh[bh.length - 1] - bh[0] < 25, 'three battles and back do not keep growing the heap (under 25 MB)', bh.join(' '));
  bot.check(!warn.length, 'no WebGL context warnings', warn.slice(0, 3).join(' | '));
  await bot.noErrors('memory');
}
