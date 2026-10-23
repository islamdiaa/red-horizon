// Skill profiles for the E2E bot: three scripted players who play a whole match through the real UI (mouse,
// keyboard, the build bar, the minimap), the way people of different experience play. They are deterministic for a
// given game (no randomness of their own) and are NOT tuned to the AI: they model players, and the matrix
// (tools/e2e/matrix.mjs) measures how the game treats each of them.
//
//  newcomer     reads the Field Manual and does what it says (once per hint), otherwise plays naively: power, a
//               refinery and a barracks, then keeps clicking infantry cards and sends every group of six it has at
//               home straight at the enemy base with a right-click. No defences, no second refinery, no care for
//               its Ore Trucks, unless a hint tells it to.
//  casual       a sensible build (power ahead of need, two refineries, a radar, two defences), tanks plus rocket
//               soldiers, attack-moves the whole army at the nearest enemy structure once it has a dozen units after
//               six minutes; brings everyone home for a raid on the base.
//  experienced  tools/e2e/journeys/first-launch.mjs's original winning play: an extra Ore Truck, a commander power,
//               pushes only with 20+ units after nine minutes, focuses the enemy's defences, regroups when a push is
//               spent.
//
// Every order is a click or a key press; window.__game is read for aiming and for the clock only (lib.mjs).
import { sleep } from './lib.mjs';

export const PROFILES = ['newcomer', 'casual', 'experienced'];

const DEFENCES = new Set(['ftur', 'tsla', 'gun', 'pbox', 'hbox', 'agun', 'sam', 'bnkr']);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (l) => ({ x: l.reduce((s, u) => s + u.x, 0) / l.length, y: l.reduce((s, u) => s + u.y, 0) / l.length });

/** Deploy the MCV the way a player does: click it to select it, click it again (D as the fallback). */
export async function deployMcv(bot) {
  const mcv = (await bot.mine()).units.find((u) => u.t === 'mcv');
  if (!mcv) return (await bot.mine()).blds.some((b) => b.t === 'fact');
  await bot.lookAt(mcv.x, mcv.y);
  const p = await bot.toScreen(mcv.x, mcv.y, 0.4);
  if (!await bot.g((g, id) => g.selection.has(id), mcv.id)) { await bot.page.mouse.click(p.x, p.y); await sleep(300); }
  await bot.page.mouse.click(p.x, p.y);
  await bot.wait(3);
  if (!(await bot.mine()).blds.some((b) => b.t === 'fact')) {
    bot.friction('deploy', 'clicking the selected MCV did not deploy it; pressed D');
    await bot.page.mouse.click(p.x, p.y); await sleep(200); await bot.key('d'); await bot.wait(3);
  }
  return (await bot.mine()).blds.some((b) => b.t === 'fact');
}

/** Is the match over? null while it runs, else { won }. */
export async function over(bot) {
  return bot.g((g) => (g.world.gameOver ? { won: g.world.winnerTeam === g.local.team } : g.local.defeated ? { won: false } : null));
}

/** Right-click a map point (on a structure there: an attack order; on the ground: a move order). */
export async function rightClickAt(bot, x, y) {
  await bot.lookAt(x, y);
  const p = await bot.toScreen(x, y, 0.6);
  const a = await bot.playArea();
  const tx = Math.max(a.x0, Math.min(a.x1, p.x)), ty = Math.max(a.y0, Math.min(a.y1, p.y));
  await bot.page.mouse.click(tx, ty, { button: 'right' });
  await sleep(250);
}

// ------------------------------------------------------------------------------------------------ newcomer

/**
 * What a newcomer does with a Field Manual hint (its English text: the matrix runs in English). Each hint is acted
 * on once. The words are what a person would pick out of the sentence; any new hint that names a structure, a unit
 * or an order gets the same treatment.
 */
export function hintActions(text, faction) {
  const t = text.toLowerCase();
  const acts = [];
  if (/\bmcv\b|deploy/.test(t)) acts.push(['deploy']);
  if (/power plant/.test(t)) acts.push(['build', 'powr']);
  if (/ore refiner/.test(t)) acts.push(['build', 'proc', /two|another|second|more/.test(t) ? 2 : 1]);
  if (/ore truck/.test(t) && /more|another|extra|second|replace|lost|no ore trucks|new one/.test(t)) acts.push(['truck']);
  // (one structure per hint: "a second War Factory or Barracks" gets the first one named)
  const second = /\bsecond\b|another/.test(t);
  if (/barracks/.test(t) && !/war factory[^.]*\bor barracks/.test(t)) acts.push(['build', faction === 'soviet' ? 'barr' : 'tent', 1]);
  if (/war factory/.test(t)) acts.push(['build', 'weap', second ? 2 : 1]);
  if (/\btanks?\b/.test(t)) acts.push(['tanks']);
  if (/radar dome/.test(t)) acts.push(['build', 'dome', 1]);
  // (a hint about the ENEMY's defences is not a reason to build one)
  if (/pillbox|turret|flame tower|tesla coil|defen[cs]e/.test(t) && !/no defences.*enemy|shuts down defences|dying to|enemy defences/.test(t)) acts.push(['defence']);
  if (/ore silo/.test(t)) acts.push(['build', 'silo', 1]);
  if (/service depot/.test(t)) acts.push(['build', 'fix', 1]);
  else if (/repair/.test(t)) acts.push(['repair']);
  if (/attack-move|attack move/.test(t)) acts.push(['amove']);
  if (/control group|together|bigger|regroup|wait until|larger/.test(t)) acts.push(['bigger']);
  if (/every combat unit|all (your )?combat units/.test(t)) acts.push(['selectAll']);
  if (/queue|idle/.test(t)) acts.push(['queue']);
  // round 4: the bank reminder (loop a unit card) and the close-out alert (finish the enemy with everything)
  if (/keep building|non-stop/.test(t)) acts.push(['loop']);
  if (/explore the dark/.test(t)) acts.push(['explore']);
  else if (/nearly beaten|far stronger/.test(t)) acts.push(['finish']);
  return acts;
}

/**
 * The newcomer: see the file header. Returns { result, notes } (result: 'win' | 'loss' | 'timeout').
 * `readHints: false` makes it ignore the Field Manual (the same play without the coaching).
 */
export async function newcomer(bot, { maxSim = 1800, readHints = true } = {}) {
  const start = await bot.simTime();
  const notes = { followed: [], waves: 0 };
  // (a mission may start with a strike team and no MCV: play on with the army)
  if (!await deployMcv(bot) && !(await bot.mine()).units.some((u) => u.armed)) return { result: 'loss', notes: { ...notes, why: 'no MCV and no army' } };
  const faction = (await bot.mine()).faction;
  const barracks = faction === 'soviet' ? 'barr' : 'tent';
  const tank = faction === 'soviet' ? '3tnk' : '2tnk';
  const basic = faction === 'soviet' ? 'ftur' : 'pbox';
  const want = new Map([['powr', 1], ['proc', 1], [barracks, 1]]); // what it means to have (grows with hints)
  let waveSize = 6, tanks = false, amove = false, queueMore = false, selectAll = false, lastPower = -1e9;
  // round 4: loops wanted (Alt-click; the tank card once there is a War Factory), the close-out target
  let loops = false, finish = null, lastSeq = '';
  const seen = new Set(), failed = new Map();
  const count = (me, t) => me.blds.filter((b) => b.t === t).length;
  for (let loop = 0; (await bot.simTime()) - start < maxSim; loop++) {
    const o = await over(bot);
    if (o) return { result: o.won ? 'win' : 'loss', notes };
    let me = await bot.mine();
    if (!me.blds.length && !me.units.length) return { result: 'loss', notes };
    // ---- read the Field Manual
    if (readHints) {
      const { hint, seq } = await bot.page.evaluate(() => { const e = document.querySelector('.hint.on'); return { hint: e?.querySelector('.hint-t')?.textContent?.trim() ?? '', seq: e?.dataset.seq ?? '' }; }).catch(() => ({ hint: '', seq: '' }));
      // (a reminder that comes back, the bank or close-out alert, is acted on again each time it appears)
      const again = seq !== lastSeq && /keep building|non-stop|nearly beaten|far stronger/.test(hint.toLowerCase());
      if (seq) lastSeq = seq;
      if (hint && (!seen.has(hint) || again)) {
        seen.add(hint);
        const acts = hintActions(hint, faction);
        notes.followed.push(`${Math.round(await bot.simTime())}s: ${acts.map((a) => a.join(' ')).join(', ') || '(nothing to do)'} <- ${hint.slice(0, 90)}`);
        for (const [a, t, n] of acts) {
          if (a === 'build') want.set(t, Math.max(want.get(t) ?? 0, n ?? 1));
          else if (a === 'deploy') await deployMcv(bot);
          else if (a === 'defence') want.set(basic, Math.max(want.get(basic) ?? 0, 1));
          else if (a === 'tanks') { tanks = true; if (!want.has('weap')) want.set('weap', 1); }
          else if (a === 'amove') amove = true;
          else if (a === 'bigger') waveSize = 10;
          else if (a === 'queue') queueMore = true;
          else if (a === 'selectAll') selectAll = true;
          else if (a === 'repair') await repairWorst(bot);
          else if (a === 'truck' && count(me, 'weap')) await bot.train('harv', 1);
          else if (a === 'loop') loops = true;
          else if (a === 'finish') { selectAll = true; amove = true; finish = (await finishOff(bot)) ?? finish; if (finish) notes.finish = (notes.finish ?? 0) + 1; }
          else if (a === 'explore') await explore(bot, me);
        }
      }
    }
    // ---- loops (Alt-click on a unit card, as the bank reminder says): riflemen, then tanks once there is a factory
    if (loops) {
      const on = await bot.g((g) => g.local.repeat.slice());
      for (const t of ['e1', ...(count(me, 'weap') ? [tank] : [])]) {
        if (on.includes(t) || (failed.get(`loop:${t}`) ?? 0) >= 2) continue;
        // (a card that is locked or gone, its factory lost: nothing to loop yet; not a failed click)
        if (!await bot.findCard(t) || await bot.locked(t)) continue;
        const ok = await bot.clickCard(t, { modifiers: ['Alt'] });
        await bot.wait(0.3);
        if (!ok || !(await bot.g((g, t) => g.local.repeat.includes(t), t))) { failed.set(`loop:${t}`, (failed.get(`loop:${t}`) ?? 0) + 1); bot.friction('loop', `Alt-click on the ${t} card did not start a loop`); }
        else bot.log(`newcomer: looping ${t} (Alt-click)`);
      }
    }
    // ---- the base: what it wants, in the order it learnt about it; power when the game complains
    if (count(me, 'fact')) {
      const lowPower = me.power[1] > me.power[0];
      if (lowPower && (await bot.simTime()) - lastPower > 60 && me.credits >= 300) { lastPower = await bot.simTime(); await bot.build('powr'); }
      else {
        const next = [...want].find(([t, n]) => count(me, t) < n && (failed.get(t) ?? 0) < 2);
        if (next && me.credits >= 300 && !await bot.build(next[0])) failed.set(next[0], (failed.get(next[0]) ?? 0) + 1);
      }
    }
    // ---- production: clicks on infantry cards (and on a tank card once it knows tanks matter)
    me = await bot.mine();
    const q = await bot.g((g) => ({ inf: g.local.queues.infantry?.items.length ?? 0, veh: g.local.queues.vehicle?.items.length ?? 0 }));
    // (told that tanks matter, it keeps the money for them: infantry only with plenty in the bank)
    if (count(me, barracks) && q.inf < 2 && me.credits >= (tanks && count(me, 'weap') ? 1200 : 100)) {
      await bot.train(loop % 3 === 2 ? 'e3' : 'e1', queueMore ? 3 : 2);
    }
    if (count(me, 'weap') && q.veh < (tanks ? 2 : 1) && me.credits >= 600) await bot.train(tank, 1);
    await bot.wait(20);
    // ---- a wave: every armed unit standing around at home, box-selected, right-clicked onto the enemy base
    me = await bot.mine();
    // (no base at all, a strike team: "home" is where the army stands)
    const home = me.blds.find((b) => b.t === 'fact') ?? me.blds[0] ?? (me.units.some((u) => u.armed) ? centre(me.units.filter((u) => u.armed)) : null);
    if (!home) continue;
    const idle = new Set(await bot.g((g) => g.world.units.filter((u) => u.alive && u.owner === g.local && u.order.type === 'idle').map((u) => u.id)));
    // (one who learnt "select every combat unit" counts the whole idle army, wherever it stands)
    const atHome = me.units.filter((u) => u.armed && idle.has(u.id) && (selectAll || dist(u, home) < 14));
    if (atHome.length < waveSize) continue;
    const foes = await bot.enemies();
    const targets = foes.blds.length ? foes.blds : foes.units;
    if (!targets.length) continue;
    // (told to finish the enemy, it keeps going for the structures the alert showed it, nearest to that place first)
    const from = finish ?? home;
    const tgt = [...targets].sort((a, b) => dist(a, from) - dist(b, from))[0];
    // (told about the "select every combat unit" key, it uses that instead of a box around the base)
    let n;
    if (selectAll) { const a = await bot.playArea(); await bot.page.mouse.move((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2); await bot.key('e'); n = await bot.g((g) => g.selection.size); }
    else n = await bot.boxSelectAround(home.x, home.y, 14);
    if (!n) { bot.friction('select', `box selection around the base picked up nothing (${atHome.length} armed there; ${JSON.stringify(bot.lastBox ?? null)})`); continue; }
    if (amove) await bot.attackMove(tgt.x, tgt.y);
    else await rightClickAt(bot, tgt.x, tgt.y);
    notes.waves++;
    bot.log(`newcomer wave ${notes.waves} at ${(await bot.simTime()).toFixed(0)}s: ${n} selected, ${amove ? 'attack-move' : 'right-click'} on ${tgt.t} at ${tgt.x.toFixed(0)},${tgt.y.toFixed(0)}`);
  }
  return { result: 'timeout', notes };
}

/**
 * The close-out alert, done as it says: select every combat unit (E), Show (the camera goes to the enemy structure it
 * points at), then A and a click on that structure. Returns the place, or null when the alert had no Show button.
 */
async function finishOff(bot) {
  const spot = await bot.page.evaluate(() => { const b = document.querySelector('.hint.on .hint-go'); return b ? { x: +b.dataset.x, y: +b.dataset.y } : null; }).catch(() => null);
  if (!spot) return null;
  const a = await bot.playArea();
  await bot.page.mouse.move((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2);
  await bot.key('e');
  const n = await bot.g((g) => g.selection.size);
  if (!await bot.click('.hint.on .hint-go').then(() => true, () => false)) { bot.friction('finish', 'the Show button on the close-out alert could not be clicked'); return null; }
  await sleep(700);
  await bot.settleCamera();
  const p = await bot.toScreen(spot.x, spot.y, 0.6);
  const tx = Math.max(a.x0, Math.min(a.x1, p.x)), ty = Math.max(a.y0, Math.min(a.y1, p.y));
  if (!p.onScreen || tx !== p.x || ty !== p.y) bot.friction('finish', `after Show the target ${spot.x.toFixed(0)},${spot.y.toFixed(0)} is not in the play area`);
  await bot.key('a', 200);
  await bot.page.mouse.click(tx, ty);
  await sleep(250);
  bot.log(`newcomer: close-out: ${n} selected (E), Show, attack-move at ${spot.x.toFixed(0)},${spot.y.toFixed(0)}`);
  return spot;
}

/** "Send a few units to explore the dark parts of the map": one unit at home, attack-moved to the far side of the map. */
async function explore(bot, me) {
  const home = me.blds.find((b) => b.t === 'fact') ?? me.blds[0];
  const u = me.units.find((u) => u.armed && (!home || dist(u, home) < 14));
  if (!home || !u) return false;
  const m = await bot.g((g) => ({ w: g.world.map.w, h: g.world.map.h }));
  await bot.lookAt(u.x, u.y);
  const p = await bot.toScreen(u.x, u.y, 0.4);
  await bot.page.mouse.click(p.x, p.y);
  await sleep(250);
  if (!await bot.g((g, id) => g.selection.has(id), u.id)) { bot.friction('select', 'clicking a unit to send it exploring did not select it'); return false; }
  await bot.attackMove(m.w - home.x, m.h - home.y);
  bot.log(`newcomer: exploring with ${u.t} towards ${(m.w - home.x).toFixed(0)},${(m.h - home.y).toFixed(0)}`);
  return true;
}

/** Repair mode (R), then a click on the most damaged structure, as the repair hint says. */
async function repairWorst(bot) {
  const b = await bot.g((g) => { const l = g.world.buildings.filter((b) => b.alive && b.owner === g.local && !b.bt.wall && b.healthFrac < 0.9).sort((a, b) => a.healthFrac - b.healthFrac); return l[0] ? { x: l[0].x, y: l[0].y } : null; });
  if (!b) return false;
  await bot.lookAt(b.x, b.y);
  await bot.key('r', 200);
  const p = await bot.toScreen(b.x, b.y, 0.6);
  await bot.page.mouse.click(p.x, p.y);
  await sleep(250);
  if (await bot.g((g) => g.input.mode) === 'repair') await bot.key('Escape', 200); // (leave repair mode; Esc otherwise opens the pause menu)
  return true;
}

// ------------------------------------------------------------------------------------------------ casual / experienced

/** The opening the casual and experienced players share (first-launch.mjs's): base, then a first army. */
export async function opener(bot) {
  if (!await deployMcv(bot)) return (await bot.mine()).units.some((u) => u.armed); // (a strike team without an MCV plays on)
  const me = await bot.mine();
  const barracks = me.faction === 'soviet' ? 'barr' : 'tent';
  // a card still locked (its requirement is still under construction: tech counts when a structure is finished) goes
  // back in the list and is tried again after the next one, up to four times, as a player would come back to it
  const list = ['powr', 'proc', barracks, 'powr', 'weap'];
  const tries = new Map();
  while (list.length) {
    const t = list.shift();
    if (await bot.build(t)) continue;
    const n = (tries.get(t) ?? 0) + 1;
    tries.set(t, n);
    if (n < 4 && await bot.locked(t)) list.push(t);
  }
  return true;
}

/**
 * The army loop (formerly first-launch.mjs's playToWin; the defaults are the experienced player's): an economy and
 * base list, busy factories, raids on the base answered by the whole army, pushes with a big army.
 *  minArmy / firstAttack  start a push with this many armed units, not before this sim second
 *  focus                  during a push, attack the nearest enemy defence first
 *  regroup                fall back home when a push is spent (below 35% of its size)
 *  trucks                 extra Ore Trucks to buy
 *  wants                  structures to build, in order ([type, count]; defences by role: 'def1', 'def2')
 * Returns true on a win, false on a defeat or at maxSim.
 */
export async function playToWin(bot, tank, barracks, {
  maxSim = 2400, minArmy = 20, firstAttack = 540, focus = true, regroup = true, trucks: extraTrucks = 1, notes = null,
  wants: wantsSpec = [['proc', 2], ['dome', 1], ['def1', 1], ['def2', 1], ['def2', 2]],
} = {}) {
  const start = await bot.simTime();
  const faction = (await bot.mine()).faction;
  const defence = faction === 'soviet' ? ['ftur', 'tsla'] : ['pbox', 'gun'];
  // (the opener's barracks and War Factory first: one the opener could not build is built later, not dropped)
  const wants = [[barracks, 1], ['weap', 1], ...wantsSpec].map(([t, n]) => [t === 'def1' ? defence[0] : t === 'def2' ? defence[1] : t, n]);
  let wave = 0, pushSize = 0, pushing = false, lastOrder = -1e9, trucks = 0, lastLost = '', shot = false;
  const failed = new Map(); // structure -> failed attempts (not allowed in a mission, no room...)
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
    if (notes) notes.orders = (notes.orders ?? 0) + 1;
    return r.text;
  };
  while ((await bot.simTime()) - start < maxSim) {
    const o = await over(bot);
    if (o) return o.won;
    let me = await bot.mine();
    if (!me.blds.length && !me.units.length) return false;
    const count = (t) => me.blds.filter((b) => b.t === t).length;
    const home = me.blds.find((b) => b.t === 'fact') ?? me.blds[0];
    // ---- economy and base: power ahead of need, then the next structure on the list
    if (count('fact')) {
      if (me.power[0] < me.power[1] + 40 && me.credits > 300) await bot.build('powr');
      else {
        // (what the build bar offers right now: a card whose requirement is still being built waits its turn)
        const can = new Set(await bot.g((g) => g.local.buildOptions()));
        const next = wants.find(([t, n]) => count(t) < n && (failed.get(t) ?? 0) < 2 && can.has(t));
        if (next && me.credits > 700 && !await bot.build(next[0])) failed.set(next[0], (failed.get(next[0]) ?? 0) + 1);
      }
    }
    // ---- factories: extra Ore Trucks early, then tanks; rocket soldiers from the barracks
    const q = await bot.g((g) => ({ inf: g.local.queues.infantry?.items.length ?? 0, veh: g.local.queues.vehicle?.items.length ?? 0 }));
    me = await bot.mine();
    if (count('weap') && trucks < extraTrucks && me.credits > 1400 && me.units.filter((u) => u.harv).length < count('proc') * 2) { if (await bot.train('harv', 1)) trucks++; }
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
    // (a strike team with no base to build from attacks with what it has)
    const noBase = !me.blds.length;
    if (!pushing && ((army.length >= minArmy && now >= firstAttack) || noBase)) { pushing = true; pushSize = army.length; wave++; if (notes) notes.waves = wave; }
    if (pushing && regroup && army.length < Math.max(6, pushSize * 0.35)) {
      pushing = false;
      bot.log(`wave ${wave} spent (${army.length}/${pushSize} left): regrouping at home; ${home ? await order(home) : ''}`);
      continue;
    }
    if (pushing && !regroup && army.length < 4) { pushing = false; continue; } // (nothing left to push with: build up again)
    if (!pushing) continue;
    const front = centre(army.filter((u) => !home || dist(u, home) > 15).length >= 4 ? army.filter((u) => !home || dist(u, home) > 15) : army);
    const defences = focus ? foes.blds.filter((b) => DEFENCES.has(b.t) && dist(b, front) < 16) : [];
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

/** Unlock a commander power and use it (aimed powers: on the enemy's nearest structure, or our own army). */
export async function usePower(bot, { check = true } = {}) {
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
    if (used) { if (check) bot.check(true, `commander power ${p.id} unlocked and used through the panel`, cmd1); await bot.shot('power'); return true; }
  }
  if (check) bot.check(false, 'a commander power could be unlocked and used');
  else bot.friction('power', 'no commander power could be unlocked and used through the panel');
  return false;
}

/** The casual player: the opener, a sensible base, attack-moves with a dozen units from six minutes on. */
export async function casual(bot, { maxSim = 2400 } = {}) {
  const notes = {};
  if (!await opener(bot)) return { result: 'loss', notes: { why: 'no MCV and no army' } };
  const me = await bot.mine();
  const tank = me.faction === 'soviet' ? '3tnk' : '2tnk';
  const barracks = me.faction === 'soviet' ? 'barr' : 'tent';
  await bot.train('e1', 3);
  await bot.train(tank, 2);
  const won = await playToWin(bot, tank, barracks, {
    maxSim, minArmy: 12, firstAttack: 360, focus: false, regroup: false, trucks: 0, notes,
    wants: [['proc', 2], ['def1', 1], ['def2', 1], ['dome', 1]],
  });
  return { result: won ? 'win' : (await over(bot)) ? 'loss' : 'timeout', notes };
}

/** The experienced player: first-launch.mjs's winning play (the opener, a first army, a commander power, playToWin). */
export async function experienced(bot, { maxSim = 2400 } = {}) {
  const notes = {};
  if (!await opener(bot)) return { result: 'loss', notes: { why: 'no MCV and no army' } };
  const me = await bot.mine();
  const tank = me.faction === 'soviet' ? '3tnk' : '2tnk';
  const barracks = me.faction === 'soviet' ? 'barr' : 'tent';
  await bot.train('e1', 5);
  await bot.train(tank, 5);
  await bot.wait(90);
  await usePower(bot, { check: false });
  const won = await playToWin(bot, tank, barracks, { maxSim, notes });
  return { result: won ? 'win' : (await over(bot)) ? 'loss' : 'timeout', notes };
}

export const PLAY = { newcomer, casual, experienced };
