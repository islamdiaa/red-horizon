// First launch on a fresh profile: the title screen and main menu, Quick Battle (a new profile starts on Recruit),
// the opening fly-over, then a whole match won through the UI: deploy the MCV, build power, a refinery, a barracks
// and a war factory from the build bar (placed with the mouse), train units, box-select, set a control group,
// attack-move, use a commander power, win, check the results screen, then Play again.
import { sleep } from '../lib.mjs';

export default async function firstLaunch(bot) {
  const t0 = Date.now();
  await bot.goto();
  const fresh = await bot.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('rh.')));
  await bot.waitMenu();
  bot.log(`menu up after ${((Date.now() - t0) / 1000).toFixed(1)}s; storage before the menu: ${fresh.join(',') || 'empty'}`);
  bot.check(await bot.sees('.main-screen .game-title'), 'the title is on the main menu');
  bot.check(await bot.sees('.main-screen .mm-nav-btn', 'Boot Camp'), 'a fresh profile is offered Boot Camp ("start here")');
  await bot.shot('menu');
  await bot.noErrors('main menu');

  // ---- Quick Battle (one click)
  await bot.nav('Quick Battle');
  await bot.page.waitForSelector('#loading .qb-card', { state: 'visible', timeout: 20000 * bot.o.slow }).then(() => bot.shot('quick-battle-roll'), () => bot.log('no Quick Battle card on the loading screen (fast load)'));
  await bot.waitMatch({ skipIntro: false });
  const setup = await bot.g((g) => ({ quick: !!g.setup.quick, opp: g.setup.opponents.map((o) => o.difficulty), units: g.setup.startUnits, rules: g.setup.rules, size: g.world.map.w, mut: g.setup.mutators ?? [], intro: !!g.setup.intro, faction: g.local.faction }));
  bot.log('quick battle:', JSON.stringify(setup));
  bot.check(setup.quick, 'Quick Battle started a rolled skirmish');
  bot.check(setup.opp.length >= 1 && setup.opp.every((d) => d === 'recruit'), 'a new profile\'s Quick Battle is on Recruit', setup.opp);
  // the opening fly-over plays, and any key skips it
  const cine = await bot.page.evaluate(() => document.body.classList.contains('cine-active'));
  if (cine) {
    await sleep(1500);
    await bot.shot('intro');
    await bot.key('Space', 600);
    const ended = await bot.page.waitForFunction(() => !document.body.classList.contains('cine-active'), null, { timeout: 30000 * bot.o.slow, polling: 300 }).then(() => true, () => false);
    bot.check(ended, 'a key press skips the opening fly-over');
  } else bot.log('no opening fly-over (intro off)');
  await bot.settleCamera();
  await bot.shot('start');
  await bot.noErrors('match start');

  // ---- deploy the MCV: it is selected at the start; clicking it again deploys it (D also works)
  let me = await bot.mine();
  const mcv = me.units.find((u) => u.t === 'mcv');
  if (mcv) {
    await bot.lookAt(mcv.x, mcv.y);
    const sel = await bot.g((g, id) => g.selection.has(id), mcv.id);
    const p = await bot.toScreen(mcv.x, mcv.y, 0.4);
    if (!sel) { await bot.page.mouse.click(p.x, p.y); await sleep(300); }
    await bot.page.mouse.click(p.x, p.y);
    await bot.wait(3);
    me = await bot.mine();
    if (!me.blds.some((b) => b.t === 'fact')) {
      bot.log('clicking the MCV did not deploy it: pressing D');
      await bot.page.mouse.click(p.x, p.y); await sleep(200);
      await bot.key('d');
      await bot.wait(3);
      me = await bot.mine();
    }
  }
  bot.check(me.blds.some((b) => b.t === 'fact'), 'the MCV deployed into a construction yard', me.blds.map((b) => b.t));

  // ---- the base, from the build bar, placed with the mouse
  const barracks = me.faction === 'soviet' ? 'barr' : 'tent';
  for (const t of ['powr', 'proc', barracks, 'powr', 'weap']) {
    const ok = await bot.build(t);
    bot.check(ok, `built and placed ${t} with the mouse`);
  }
  me = await bot.mine();
  bot.log('base:', me.blds.map((b) => b.t).join(' '), 'credits', me.credits, 'power', me.power.join('/'));
  await bot.shot('base');
  bot.check(me.units.some((u) => u.harv), 'the refinery came with an ore truck', me.units.map((u) => u.t));
  await bot.noErrors('base building');

  // ---- an army: riflemen and tanks (repeat-queued with clicks on the cards)
  const tank = me.faction === 'soviet' ? '3tnk' : '2tnk';
  await bot.train('e1', 5);
  await bot.train(tank, 5);
  await bot.shot('queues');
  await bot.wait(90);

  // ---- box-select the army near the base, make it group 1, attack-move on the enemy base
  const fact = (await bot.mine()).blds.find((b) => b.t === 'fact');
  const n = await bot.boxSelectAround(fact.x, fact.y, 14);
  me = await bot.mine();
  const armed = me.units.filter((u) => u.armed).length;
  bot.check(n > 0, 'box selection picks up the army', `${n} selected of ${armed} armed units`);
  await bot.key('Control+1');
  const grp = await bot.g((g) => g.input?.groups?.get(1)?.length ?? 0);
  bot.check(grp > 0, 'Ctrl+1 assigns control group 1', grp);
  await bot.shot('selected');
  await bot.page.mouse.click((await bot.playArea()).x0 + 40, (await bot.playArea()).y0 + 40); // click away: deselect
  await sleep(300);
  await bot.key('1');
  const recalled = await bot.g((g) => g.selection.size);
  bot.check(recalled === n, 'pressing 1 recalls the group', `${recalled}/${n}`);

  // ---- a commander power (Commander rules): unlock one with command points, use it
  await usePower(bot);

  // ---- waves until the enemy is gone
  const won = await playToWin(bot, tank, barracks);
  await bot.shot('end-of-battle');
  bot.check(won, 'the match was won through the UI');
  await bot.noErrors('battle');
  if (!won) return;

  // ---- the results screen, then Play again
  const res = await bot.waitResults();
  bot.check(res, 'the results screen appears after the victory');
  await sleep(1500);
  await bot.shot('results');
  const resInfo = await bot.page.evaluate(() => ({ win: !!document.querySelector('.end-screen.win'), text: document.querySelector('.end-screen')?.innerText.replace(/\s+/g, ' ').slice(0, 300) }));
  bot.check(resInfo.win, 'the results screen shows a victory', resInfo.text);
  const seed0 = await bot.g((g) => g.setup.seed);
  await bot.click('.end-screen:not(.leaving) .rr-again');
  await bot.page.waitForFunction((s) => window.__game && !window.__game.setup.demo && window.__game.setup.seed !== s && window.__game.world.time < 30, seed0, { timeout: 180000 * bot.o.slow, polling: 500 }).catch(() => {});
  await bot.waitMatch();
  const again = await bot.g((g) => ({ quick: !!g.setup.quick, t: g.world.time, over: g.world.gameOver, seed: g.setup.seed }));
  bot.check(again.quick && !again.over && again.seed !== seed0, 'Play again starts a new Quick Battle', again);
  await bot.shot('play-again');
}

/** Unlock a commander power and use it (aimed powers: on the enemy's nearest structure, or our own army). */
export async function usePower(bot) {
  const has = await bot.sees('#cmdpanel');
  if (!has) { bot.log('no commander panel (Classic rules)'); return false; }
  // command points come with time and fighting
  await bot.wait(90, { until: '(() => (window.__game?.local.cmd?.points ?? 0) >= 2)()' });
  const st = await bot.page.evaluate(() => [...document.querySelectorAll('#cmdpanel .cmdp-pw')].map((b) => ({ id: b.dataset.power, cls: b.className, dis: b.disabled })));
  bot.log('powers:', JSON.stringify(st.slice(0, 6)));
  const collapsed = await bot.page.evaluate(() => document.getElementById('cmdpanel')?.classList.contains('min'));
  if (collapsed) await bot.click('#cmdpanel .cmdp-head');
  // the first tier: click to unlock, then click again to use
  for (const p of st.filter((p) => !p.dis).slice(0, 3)) {
    const sel = `#cmdpanel .cmdp-pw[data-power="${p.id}"]`;
    const cmd0 = await bot.g((g) => JSON.stringify({ u: g.local.cmd?.unlocked, r: g.local.cmd?.ready }));
    await bot.click(sel);
    await bot.wait(1);
    await bot.click(sel).catch(() => {});
    await sleep(300);
    const mode = await bot.g((g) => g.input.mode);
    if (mode === 'aim') {
      const e = (await bot.enemies()).blds[0] ?? (await bot.mine()).blds[0];
      await bot.lookAt(e.x, e.y);
      const pt = await bot.toScreen(e.x, e.y);
      await bot.page.mouse.click(pt.x, pt.y);
      await sleep(300);
    }
    await bot.wait(2);
    const cmd1 = await bot.g((g) => JSON.stringify({ u: g.local.cmd?.unlocked, r: g.local.cmd?.ready }));
    const used = await bot.g((g, id) => (g.local.cmd?.ready?.[id] ?? 0) > g.world.tick, p.id);
    bot.log(`power ${p.id}: mode ${mode}; cmd ${cmd0.slice(0, 120)} -> ${cmd1.slice(0, 160)}`);
    if (used) { bot.check(true, `commander power ${p.id} unlocked and used through the panel`, cmd1); await bot.shot('power'); return true; }
  }
  bot.check(false, 'a commander power could be unlocked and used');
  return false;
}

/**
 * Play the rest of the match like a sensible casual player (after the "casual" stand-in of tools/selfplay/standin.ts):
 * a second refinery and Ore Truck, a radar, defences, power ahead of need and busy factories (tanks, and rocket
 * soldiers against armour); meet raids on the base with the whole army; attack only with a big army, focus the
 * enemy defences, fall back to regroup when the push is spent. Every order is a click or a key press.
 */
export async function playToWin(bot, tank, barracks, { maxSim = 2400, minArmy = 20, firstAttack = 540 } = {}) {
  const start = await bot.simTime();
  const faction = (await bot.mine()).faction;
  const defence = faction === 'soviet' ? ['ftur', 'tsla'] : ['pbox', 'gun'];
  const wants = [['proc', 2], ['dome', 1], [defence[0], 1], [defence[1], 1], [defence[1], 2]];
  const DEF = new Set(['ftur', 'tsla', 'gun', 'pbox', 'hbox', 'agun', 'sam', 'bnkr']);
  let wave = 0, pushSize = 0, pushing = false, lastOrder = -1e9, trucks = 0, lastLost = '', shot = false;
  const failed = new Map(); // structure -> failed attempts (not allowed in a mission, no room...)
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const centre = (l) => ({ x: l.reduce((s, u) => s + u.x, 0) / l.length, y: l.reduce((s, u) => s + u.y, 0) / l.length });
  const doing = (t) => bot.g((g, t) => {
    const out = {}, tg = {};
    let near = 0;
    for (const u of g.world.units) {
      if (!u.alive || u.owner !== g.local || !u.weapons.length || u.ut.harvester) continue;
      out[u.order.type] = (out[u.order.type] ?? 0) + 1;
      if (u.order.type === 'attack') { const e = g.world.getEntity(u.order.target); const k = e ? e.type.id : '?'; tg[k] = (tg[k] ?? 0) + 1; }
      if (Math.hypot(u.x - t.x, u.y - t.y) < 12) near++;
    }
    return { idle: out.idle ?? 0, text: `${Object.entries(out).map(([k, v]) => `${k} ${v}`).join(', ')}; targets ${Object.entries(tg).map(([k, v]) => `${k}x${v}`).join(' ') || '-'}; ${near} within 12` };
  }, t);
  /** Select the whole army ("select all combat units") and attack-move at a point or a structure; re-sent once if nobody took it. */
  const order = async (tgt) => {
    let r;
    for (let k = 0; k < 2; k++) {
      const a = await bot.playArea();
      await bot.page.mouse.move((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2);
      await bot.key('e');
      await bot.attackMove(tgt.x, tgt.y);
      await bot.wait(0.5);
      r = await doing(tgt);
      if (r.idle < 3) break;
    }
    return r.text;
  };
  while ((await bot.simTime()) - start < maxSim) {
    const over = await bot.g((g) => g.world.gameOver ? { won: g.world.winnerTeam === g.local.team } : null);
    if (over) return over.won;
    let me = await bot.mine();
    if (!me.blds.length && !me.units.length) return false;
    const count = (t) => me.blds.filter((b) => b.t === t).length;
    const home = me.blds.find((b) => b.t === 'fact') ?? me.blds[0];
    // ---- economy and base: power ahead of need, then the next structure on the list
    if (count('fact')) {
      if (me.power[0] < me.power[1] + 40 && me.credits > 300) await bot.build('powr');
      else {
        const next = wants.find(([t, n]) => count(t) < n && (failed.get(t) ?? 0) < 2);
        if (next && me.credits > 700 && !await bot.build(next[0])) failed.set(next[0], (failed.get(next[0]) ?? 0) + 1);
      }
    }
    // ---- factories: an extra Ore Truck early, then tanks; rocket soldiers from the barracks
    const q = await bot.g((g) => ({ inf: g.local.queues.infantry?.items.length ?? 0, veh: g.local.queues.vehicle?.items.length ?? 0 }));
    me = await bot.mine();
    if (count('weap') && trucks < 1 && me.credits > 1400 && me.units.filter((u) => u.harv).length < count('proc') * 2) { if (await bot.train('harv', 1)) trucks++; }
    else if (tank && count('weap') && q.veh < 2 && me.credits > 800) await bot.train(tank, 2);
    if (count(barracks) && q.inf < 2 && me.credits > 300) await bot.train(tank ? 'e3' : (q.inf % 2 ? 'e1' : 'e3'), 1);
    await bot.wait(25);
    const now = await bot.simTime();
    me = await bot.mine();
    const army = me.units.filter((u) => u.armed);
    const foes = await bot.enemies();
    if (!army.length) continue;
    // ---- a raid on the base: everyone home
    const raid = home ? foes.units.filter((u) => dist(u, home) < 18) : [];
    if (raid.length >= 3 && !pushing) {
      bot.log(`raid: ${raid.length} enemies near the base; ${await order(centre(raid))}`);
      continue;
    }
    const targets = foes.blds.length ? foes.blds : foes.units;
    if (!targets.length) { await bot.wait(5); continue; }
    // ---- a push: start it with a big army; while it lasts, focus the nearest defence, else the nearest structure
    if (!pushing && army.length >= minArmy && now >= firstAttack) { pushing = true; pushSize = army.length; wave++; }
    if (pushing && army.length < Math.max(6, pushSize * 0.35)) {
      pushing = false;
      bot.log(`wave ${wave} spent (${army.length}/${pushSize} left): regrouping at home; ${home ? await order(home) : ''}`);
      continue;
    }
    if (!pushing) continue;
    const front = centre(army.filter((u) => !home || dist(u, home) > 15).length >= 4 ? army.filter((u) => !home || dist(u, home) > 15) : army);
    const defences = foes.blds.filter((b) => DEF.has(b.t) && dist(b, front) < 16);
    const pool = defences.length ? defences : targets;
    const tgt = [...pool].sort((a, b) => dist(a, front) - dist(b, front))[0];
    const key = `${tgt.t}@${tgt.x},${tgt.y}`;
    if (key === lastLost && now - lastOrder < 50) continue; // (the same target: the army is on it)
    lastLost = key; lastOrder = now;
    const what = await order(tgt);
    bot.log(`wave ${wave} at ${now.toFixed(0)}s: ${army.length}/${pushSize} armed (front ${front.x.toFixed(0)},${front.y.toFixed(0)}), ${defences.length ? 'focus defence' : 'attack'} ${tgt.t} at ${tgt.x.toFixed(0)},${tgt.y.toFixed(0)}; enemy ${foes.blds.length} structures ${foes.units.length} units; $${me.credits}; army: ${what}`);
    if (wave === 1 && !shot) { shot = true; await bot.shot('first-wave'); }
  }
  return false;
}
