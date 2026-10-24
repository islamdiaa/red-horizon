// World Conquest: a landmark battle opens with the landmark in view. A fixed challenge link (seed 1, Germany, Blitz,
// Easy: neutral landmark territories border Germany on turn 1) -> Begin -> place everything -> attack one of them over
// a land border (found on the screen's run) -> Fight it. Twice: once letting the opening fly-over play out, once skipping it with a key (the two
// ways a player meets the battlefield). The landmark's middle (half its height) must land inside the play area
// (between the HUD bars), and at least half of its height must show.
//
//   node tools/e2e/run.mjs world-landmark [--size 844x390 --touch --mobile]
import { sleep } from '../lib.mjs';
import { Wd, findAttack, runState, tapTerritory } from './world.mjs';

const SIDE = '.wc-side';
const LINK = '#world=1&home=germany&size=blitz&diff=easy';
const HEIGHT = { 'eiffel-tower': 10, 'big-ben': 7, 'empire-state': 9, matterhorn: 8, neuschwanstein: 6, 'statue-of-liberty': 6, 'st-basils': 5, 'mount-fuji': 5.5, 'dutch-windmills': 3, 'brandenburg-gate': 2.6 };

async function toBattle(bot, skipIntro) {
  await bot.open();
  await bot.goto({}, LINK);
  if (!bot.check(await bot.waitFor(`${SIDE} [data-act="begin"]`, undefined, 120000), 'the challenge link opens the setup')) return false;
  await bot.click(`${SIDE} [data-act="begin"]`);
  await bot.waitFor('.wc-top', undefined, 60000);
  const mine = await Wd(bot, () => { const r = window.__world.run; return r.territories.filter((t) => t.owner === r.player).sort((a, b) => b.troops - a.troops)[0].id; });
  await tapTerritory(bot, mine, 'reinforce');
  if (await bot.sees('[data-act="all"]')) await bot.click('[data-act="all"]');
  await bot.click('[data-act="next"]');
  const a = await findAttack(bot, { landmark: true });
  if (!bot.check(!!a, 'a landmark territory can be attacked over a land border on turn 1')) return false;
  bot.log(`attack ${a.from} -> ${a.to} (${a.landmark})`);
  await tapTerritory(bot, a.from, 'attack source');
  await tapTerritory(bot, a.to, 'attack target');
  const st = await runState(bot);
  if (!bot.check(st.sel?.src === a.from && st.sel?.dst === a.to, `${a.from} -> ${a.to} selected by taps on the globe`, JSON.stringify(st.sel))) return false;
  await bot.click('[data-act="fight"]');
  if (await bot.sees('.wc-modal [data-yes]')) await bot.click('.wc-modal [data-yes]');
  await bot.waitMatch({ skipIntro });
  if (!skipIntro) {
    // let the fly-over play out by itself
    await bot.page.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 120000 * bot.o.slow, polling: 300 }).catch(() => bot.log('intro still on after 2 min'));
    await bot.settleCamera();
  }
  return true;
}

async function inView(bot, how) {
  const g = await bot.g((g) => { const l = g.world.map.landmarks[0]; return l && { id: l.id, x: l.cx + l.w / 2, y: l.cy + l.h / 2, cam: [+g.gfx.cam.x.toFixed(1), +g.gfx.cam.y.toFixed(1), +g.gfx.cam.dist.toFixed(1)], focus: g.world.map.startFocus }; });
  if (!bot.check(!!g, `${how}: the battlefield has its landmark`)) return;
  const H = HEIGHT[g.id] ?? 4;
  // a height counts as shown when its point is on screen and nothing of the HUD covers it (the top element there is
  // the game's canvas)
  const pts = [];
  for (let j = 0; j <= 10; j++) pts.push(await bot.toScreen(g.x, g.y, (H * j) / 10));
  const open = await bot.page.evaluate((pts) => pts.map((p) => { if (!p || p.x < 0 || p.y < 0 || p.x >= innerWidth || p.y >= innerHeight) return false; const e = document.elementFromPoint(p.x, p.y); return !!e && e.tagName === 'CANVAS'; }), pts);
  const shown = open.filter(Boolean).length, mid = pts[5];
  bot.log(`${how}: ${g.id} camera ${JSON.stringify(g.cam)} focus ${JSON.stringify(g.focus)}; middle at ${mid && `${Math.round(mid.x)},${Math.round(mid.y)}`}; heights shown ${open.map((o) => (o ? 1 : 0)).join('')}`);
  bot.check(open[5] && shown >= 6, `${how}: the landmark is in the opening view (its middle, and at least half its height, uncovered on screen)`, `${shown}/11 heights, middle ${mid && `${Math.round(mid.x)},${Math.round(mid.y)}`}`);
  await bot.shot(`${how}-${g.id}`);
}

export default async function worldLandmark(bot) {
  for (const [skip, how] of [[false, 'fly-over played'], [true, 'fly-over skipped']]) {
    if (!await toBattle(bot, skip)) continue;
    await sleep(500);
    await inView(bot, how);
    await bot.noErrors(how);
  }
}
