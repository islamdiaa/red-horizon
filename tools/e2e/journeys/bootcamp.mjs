// Boot Camp as a newcomer plays it (a fresh profile; English): "Boot Camp · Start here" on the main menu, then each of
// the nine drills done the way the Sergeant Major's radio and the objectives list say, through the real UI (box
// selections, right clicks, the build bar, D, Shift-click, Ctrl+1, A then a click). For each drill: what was on screen
// (objective, radio line, clipped text), how long it took in game time, and friction where the game did not answer the
// way the text said it would. At the end: the debrief, and the main menu no longer offering Boot Camp as "Start here".
//
// Aiming reads window.__game (where the beacon, the scouts and the camp are, as a player sees them on screen); every
// order is a click or a key press.
import { sleep } from '../lib.mjs';
import { deployMcv, rightClickAt } from '../profiles.mjs';

/** What the drill screen shows: the open objectives (in order) and the latest radio line. */
const screen = (bot) => bot.page.evaluate(() => {
  const rows = [...document.querySelectorAll('.mh-obj .mh-row')].filter((r) => r.getBoundingClientRect().width > 4).map((r) => ({ text: (r.querySelector('.tx, span:not(.ck)') ?? r).textContent.replace(/\s+/g, ' ').trim(), done: r.classList.contains('done') || r.classList.contains('ok'), failed: r.classList.contains('failed') }));
  const radio = document.querySelector('.mh-tx.on .tt')?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  const g = window.__game, m = g?.world.mission;
  return { rows, radio, step: m?.flags?.step ?? null, over: !!g?.world.gameOver };
}).catch(() => ({ rows: [], radio: '', step: null, over: false }));

/** Wait (fast-forwarding) until the drill moves on from `step`, up to `secs` of game time. */
async function until(bot, step, secs) {
  return bot.wait(secs, { until: `(() => { const g = window.__game; return !g || g.world.gameOver || g.world.mission?.flags?.step !== ${JSON.stringify(step)}; })()` });
}

/** My armed units near a point (all of them when no point). */
const army = async (bot, near = null, r = 14) => (await bot.mine()).units.filter((u) => u.armed && (!near || Math.hypot(u.x - near.x, u.y - near.y) <= r));
const centre = (l) => ({ x: l.reduce((s, u) => s + u.x, 0) / l.length, y: l.reduce((s, u) => s + u.y, 0) / l.length });

export default async function bootcamp(bot) {
  await bot.goto();
  await bot.waitMenu();
  bot.check(await bot.sees('.main-screen .mm-nav-btn[data-nav="bootcamp"]', 'Start here'), 'a fresh profile is offered Boot Camp ("Start here")');
  await bot.click('.main-screen:not(.leaving) .mm-nav-btn[data-nav="bootcamp"]');
  await bot.waitMatch();
  const t0 = await bot.simTime();
  const times = {};
  let step = null, stepT = t0, shots = 0;
  const seenRadio = new Set();
  const look = async () => {
    const s = await screen(bot);
    if (s.radio && !seenRadio.has(s.radio)) { seenRadio.add(s.radio); bot.log(`radio: ${s.radio}`); }
    return s;
  };
  // the drills, in order; each runs until the mission moves on (or its time is up)
  for (let guard = 0; guard < 40; guard++) {
    await bot.wait(2);
    const s = await look();
    if (s.over || s.step === 'done') break;
    if (s.step !== step) {
      if (step) { times[step] = Math.round((await bot.simTime()) - stepT); bot.log(`drill ${step} done in ${times[step]} s`); }
      step = s.step; stepT = await bot.simTime();
      const open = s.rows.filter((r) => !r.done).map((r) => r.text);
      bot.log(`drill ${step}: objective "${open[0] ?? '?'}"`);
      await bot.audit(`drill ${step}`);
      // what the drill points at (the beacon, the scouts, the MCV, the camp): on screen when the drill starts?
      const tgt = await bot.g((g) => {
        const m = g.world.mission, f = m?.flags ?? {}, st = f.step;
        const alive = (ids) => (ids ?? []).map((id) => g.world.getEntity(id)).filter((e) => e?.alive);
        const c = (l) => (l.length ? { x: l.reduce((s, e) => s + e.x, 0) / l.length, y: l.reduce((s, e) => s + e.y, 0) / l.length } : null);
        const t = st === 'move' ? { x: f.bx, y: f.by } : st === 'fight' ? c(alive(f.scouts)) : st === 'deploy' ? c(alive([f.mcv])) : st === 'assault' ? c(alive(f.camp)) : null;
        // (uncovered: the shroud lifted there, as Mission.reveal does; the fog may still dim it)
        return t ? { ...t, lit: !!g.local.explored[Math.floor(t.y) * g.world.map.w + Math.floor(t.x)] } : null;
      });
      if (tgt && Number.isFinite(tgt.x)) {
        await sleep(1500); // (a camera the drill moves flies there in about a second)
        await bot.settleCamera();
        const [p] = await bot.toScreenMany([[tgt.x, tgt.y]], 0.3);
        const seen = !!p?.inPlay;
        bot.log(`drill ${step}: its target (${tgt.x.toFixed(0)},${tgt.y.toFixed(0)}) is ${seen ? '' : 'NOT '}on screen and ${tgt.lit ? '' : 'NOT '}uncovered when the drill starts`);
        if (!seen) bot.friction('find', `drill ${step}: what the radio points at is off screen when the drill starts`);
        if (!tgt.lit) bot.friction('find', `drill ${step}: what the radio points at is under the fog when the drill starts`);
      }
      if (shots++ < 12) await bot.shot(`drill-${step}`);
    }
    const before = step;
    switch (step) {
      case 'move': { // "Drag a box around them with the left mouse button ... right-click near the flashing beacon"
        const sq = await army(bot);
        const n = sq.length ? await bot.boxSelectAround(centre(sq).x, centre(sq).y, 10) : 0;
        if (!n) bot.friction('select', `move drill: the box around the squad selected nothing (${JSON.stringify(bot.lastBox ?? null)})`);
        const b = await bot.g((g) => { const f = g.world.mission?.flags ?? {}; return { x: f.bx, y: f.by }; });
        await rightClickAt(bot, b.x, b.y);
        await until(bot, 'move', 60);
        break;
      }
      case 'fight': { // "Select your squad and right-click one of them to attack"
        const sq = await army(bot);
        if (sq.length) await bot.boxSelectAround(centre(sq).x, centre(sq).y, 12);
        const foes = (await bot.enemies()).units;
        const c = sq.length ? centre(sq) : { x: 0, y: 0 };
        const tgt = [...foes].sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
        if (tgt) await rightClickAt(bot, tgt.x, tgt.y);
        await until(bot, 'fight', 45);
        break;
      }
      case 'deploy': { // "Select it and press D, or click it a second time"
        if (!await deployMcv(bot)) bot.friction('deploy', 'the MCV did not deploy with a click on it nor with D');
        await until(bot, 'deploy', 10);
        break;
      }
      case 'power': // "Click the Power Plant card ... when it reads READY, click the ground next to your yard"
      case 'ore': {
        const t = step === 'power' ? 'powr' : 'proc';
        if (!await bot.build(t)) bot.friction('placement', `${step} drill: could not build and place ${t} from the build bar`);
        await until(bot, step, 20);
        break;
      }
      case 'infantry': { // "a Barracks ... click the Rifleman card five times; Shift-click queues five at once"
        if (!(await bot.mine()).blds.some((b) => b.t === 'tent') && !await bot.build('tent')) bot.friction('placement', 'infantry drill: could not build the Barracks');
        if (await bot.findCard('e1') && !await bot.locked('e1')) {
          const q0 = await bot.g((g) => g.local.queues.infantry?.items.length ?? 0);
          await bot.clickCard('e1', { modifiers: ['Shift'] });
          await sleep(300);
          const q1 = await bot.g((g) => g.local.queues.infantry?.items.reduce((s, it) => s + (it.count ?? 1), 0) ?? 0);
          bot.log(`infantry drill: Shift-click on the Rifleman card: queue ${q0} -> ${q1}`);
          if (q1 - q0 < 5) { bot.friction('queue', `Shift-click on the Rifleman card queued ${q1 - q0}, the radio says five`); await bot.train('e1', 5); }
        } else bot.friction('locked', 'infantry drill: the Rifleman card is locked or missing after the Barracks');
        await until(bot, 'infantry', 120);
        break;
      }
      case 'defend': { // "Pillboxes are unlocked. Tip: select your riflemen and press Ctrl+1, then press 1"
        const fact = (await bot.mine()).blds.find((b) => b.t === 'fact');
        if (fact && !(await bot.mine()).blds.some((b) => b.t === 'pbox')) { if (!await bot.build('pbox')) bot.friction('placement', 'defend drill: could not place a Pillbox'); }
        if (fact) {
          const n = await bot.boxSelectAround(fact.x, fact.y, 12);
          await bot.key('Control+1');
          const grp = await bot.g((g) => g.input?.groups?.get(1)?.length ?? 0);
          if (n && !grp) bot.friction('group', 'defend drill: Ctrl+1 did not make group 1');
        }
        await until(bot, 'defend', 150);
        break;
      }
      case 'armour': { // "build a War Factory and roll out a Light Tank"
        if (!(await bot.mine()).blds.some((b) => b.t === 'weap') && !await bot.build('weap')) bot.friction('placement', 'armour drill: could not build the War Factory');
        if (!await bot.train('1tnk', 1)) bot.friction('locked', 'armour drill: the Light Tank card could not be clicked');
        await until(bot, 'armour', 90);
        break;
      }
      case 'assault': { // "Gather your army, press A, then click near the camp: an attack-move fights everything on the way"
        const foes = (await bot.enemies()).blds;
        if (!foes.length) { await bot.wait(5); break; }
        // (gathering: the factories keep training, by clicks on the cards, until the army is a dozen strong)
        const mine = await bot.mine();
        const fact = mine.blds.find((b) => b.t === 'fact');
        const home = fact ?? centre(await army(bot));
        const q = await bot.g((g) => ({ inf: g.local.queues.infantry?.items.length ?? 0, veh: g.local.queues.vehicle?.items.length ?? 0 }));
        if (q.veh < 2 && mine.credits >= 800) await bot.train(mine.credits >= 1600 ? '2tnk' : '1tnk', 1).catch(() => false);
        if (q.inf < 3 && mine.credits >= 300) await bot.train('e1', 3).catch(() => false);
        const atHome = await army(bot, home, 16);
        // (each push waits for a fresh dozen at home: small groups sent one after another melt on the pillboxes)
        if (atHome.length < 12) { await bot.wait(15); break; }
        const n = await bot.boxSelectAround(home.x, home.y, 16);
        const c = centre(foes);
        if (n) { await bot.attackMove(c.x, c.y); bot.log(`assault: ${n} selected, attack-move on the camp`); }
        await until(bot, 'assault', 60);
        break;
      }
      default: await bot.wait(3);
    }
    const now = await bot.simTime();
    if (before === step && now - stepT > (step === 'assault' ? 900 : 420)) { bot.friction('softlock', `drill ${step} not done after ${Math.round(now - stepT)} s`); break; }
  }
  const total = Math.round((await bot.simTime()) - t0);
  if (step && !times[step]) times[step] = Math.round((await bot.simTime()) - stepT);
  bot.log(`drill times (game s): ${JSON.stringify(times)}; total ${total} s`);
  const won = await bot.g((g) => g.world.gameOver && g.world.winnerTeam === g.local.team);
  bot.check(won, 'Boot Camp completed (every drill)', `${total} s`);
  await bot.noErrors('Boot Camp');
  if (!won) return;
  const deb = await bot.page.waitForSelector('.dbf:not(.leaving)', { state: 'visible', timeout: 60000 * bot.o.slow }).then(() => true, () => false);
  bot.check(deb, 'the Boot Camp debrief appears');
  await sleep(1500);
  await bot.audit('debrief');
  await bot.shot('debrief');
  const acts = await bot.page.$$eval('.dbf [data-act]', (l) => l.map((b) => `${b.dataset.act}:${b.textContent.trim()}`));
  bot.log(`debrief buttons: ${acts.join(' | ')}`);
  // what a newcomer does next: back to the menu, where Boot Camp is no longer "Start here"
  const menu = bot.page.locator('.dbf [data-act="menu"]').first();
  if (await menu.isVisible().catch(() => false)) {
    await menu.click();
    // (the debrief's first button leads to the campaign screen: Allied mission 1, the next step; Esc goes back)
    const where = await bot.page.waitForSelector(':is(.main-screen:not(.leaving) .mm-nav-btn, .cmp .cmp-tab)', { state: 'visible', timeout: 30000 * bot.o.slow })
      .then(() => bot.page.evaluate(() => (document.querySelector('.main-screen:not(.leaving) .mm-nav-btn') ? 'main menu' : 'campaign screen')), () => 'nothing');
    const next = await bot.page.evaluate(() => document.querySelector('.cmp .cmp-brief h1, .cmp h1, .cmp h2')?.textContent?.trim() ?? '');
    bot.log(`the debrief's ${acts.find((a) => a.startsWith('menu:'))} led to the ${where}${next ? ` (${next})` : ''}`);
    bot.check(where !== 'nothing', 'the debrief leads on to a screen');
    if (where === 'campaign screen') { await bot.shot('campaign-after'); await bot.key('Escape', 1500); }
    const up = await bot.waitMenu(30000).then(() => true, () => false);
    bot.check(up, 'Esc from the campaign screen returns to the main menu');
    if (up) {
      bot.check(!await bot.sees('.main-screen .mm-nav-btn[data-nav="bootcamp"]', 'Start here'), 'after Boot Camp the main menu no longer says "Start here" on it');
      await bot.shot('menu-after');
    }
  }
}
