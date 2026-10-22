// Attack waves across the map: why do they stall?
//   node --import tsx tools/qa/waves.ts [--seed 77] [--faction allies] [--diff recruit] [--build 420] [--inf 24] [--veh 6]
//        [--secs 240] [--human casual|none] [-v]
// Rolls the Quick Battle for --seed (as the menu does), lets the build-up run --build seconds with the human slot played
// by the casual stand-in, then spawns an infantry-heavy army at the human base and attack-moves it, like a newcomer,
// at the enemy Construction Yard. Every second it checks each wave unit: a unit that moved less than a cell in the
// last 10 s without firing, while it still has an attack-move order, counts as stalled; the report breaks stalls down
// by cause (order, target, path state, formation) and gives the time to first contact, arrival and losses.
// --bot plays the whole match with stand-in economy and newcomer-style waves (see tools/README.md). Debugging:
// TRACE=<sec> [TID=<unit id> | FAR=<cells>] [GROUP=1] prints one unit's state (and its formation) for 12 s from then.
import { rollQuickBattle } from '../../src/modes/quickbattle';
import { headlessGame } from '../../src/modes/headless';
import { Building, Unit } from '../../src/sim/entities';
import { TICK_HZ } from '../../src/sim/types';
import { groupById } from '../../src/sim/formation';
import { StandIn } from '../selfplay/standin';
import type { AIDifficulty } from '../../src/sim/ai';
import type { Faction } from '../../src/data/rules';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const V = process.argv.includes('-v');
const seed = +arg('seed', '77'), faction = arg('faction', 'allies') as Faction, diff = arg('diff', 'recruit') as AIDifficulty;
const buildSecs = +arg('build', '420'), nInf = +arg('inf', '24'), nVeh = +arg('veh', '6'), secs = +arg('secs', '240');
const human = arg('human', 'casual');
/** --bot: the human slot plays like the UI bot's newcomer: a stand-in's base and factories, no defence, and every 32 s
 *  "select all combat units, attack-move" at the nearest enemy structure, from --first seconds on. */
const direct = process.argv.includes('--direct');
const once = process.argv.includes('--once'), minWave = +arg('wave', '12');
const seenSet = new Set<number>();
function seenBy(b: Building) { if (seenSet.has(b.id)) return true; if (w.canSee(me, b)) { seenSet.add(b.id); return true; } return false; }
const bot = process.argv.includes('--bot'), first = +arg('first', '280'), every = +arg('every', '32'), maxMin = +arg('minutes', '25');

// --autostart: main.ts ?autostart=1&seed=N&ai=<diff>&rules=commander (the UI bot's debug runs): 96x96 temperate, light start
const setup = process.argv.includes('--autostart')
  ? { faction, color: 0x3d7be0, opponents: [{ faction: (faction === 'allies' ? 'soviet' : 'allies') as Faction, difficulty: diff }], mapSize: 96, water: 0.5, trees: 0.5, ore: 0.6,
      credits: 10000, startUnits: 'light', fog: true, timeOfDay: 'day', seed, climate: 'temperate', rules: 'commander', events: true, quality: 'low' } as any
  : rollQuickBattle(seed, { faction, color: 0x3d7be0, quality: 'low' as never, skill: diff });
const { world: w, local: me } = headlessGame(setup);
const foe = w.players.find((p) => p !== me)!;
const stand = human === 'none' ? null : new StandIn(w, me, human as 'casual' | 'novice', seed);
const step = () => { stand?.tick(); w.step(); w.events.length = 0; if (w.mission) w.mission.events.length = 0; };
if (bot) { botGame(); process.exit(0); }
for (let t = 0; t < buildSecs * TICK_HZ && !w.gameOver; t++) step();

const myBase = w.buildings.find((b) => b.alive && b.owner === me && b.bt.id === 'fact') ?? w.buildings.find((b) => b.alive && b.owner === me);
const target = w.buildings.find((b) => b.alive && b.owner === foe && b.bt.id === 'fact') ?? w.buildings.find((b) => b.alive && b.owner === foe);
if (!myBase || !target) { console.log('no base / no target', !!myBase, !!target); process.exit(0); }
const inf = faction === 'allies' ? ['e1', 'e1', 'e1', 'e3'] : ['e1', 'e1', 'e3', 'e1'];
const veh = faction === 'allies' ? ['2tnk', '1tnk', 'jeep'] : ['3tnk', 'ftrk', '3tnk'];
const ids: number[] = [];
const toward = Math.atan2(target.y - myBase.y, target.x - myBase.x);
const ox = myBase.x + Math.cos(toward) * 6, oy = myBase.y + Math.sin(toward) * 6;
for (let k = 0; k < nInf + nVeh; k++) {
  const type = k < nInf ? inf[k % inf.length] : veh[(k - nInf) % veh.length];
  const [x, y] = w.findFreeSpot(ox + (k % 6) - 2.5, oy + Math.floor(k / 6) - 2.5, 10, k >= nInf);
  ids.push(w.addUnit(type, me, x, y).id);
}
function enemyArmy() { return w.units.filter((u) => u.alive && u.owner === foe && u.weapons.length && !u.ut.harvester).length; }
function enemyDef() { return w.buildings.filter((b) => b.alive && b.owner === foe && b.weapons.length).length; }
console.log(`seed ${seed} ${w.map.w}x${w.map.h} ${faction} vs ${foe.faction} ${diff} @${buildSecs}s: enemy army ${enemyArmy()}, defences ${enemyDef()}, ${w.bridges.length} bridges;`
  + ` wave ${nInf} inf + ${nVeh} veh from (${ox.toFixed(0)},${oy.toFixed(0)}) to ${target.bt.id} (${target.x.toFixed(0)},${target.y.toFixed(0)}) dist ${Math.hypot(target.x - ox, target.y - oy).toFixed(0)}`);
w.issue({ c: 'move', player: me.id, units: ids, x: target.x, y: target.y, attackMove: true });

const hist = new Map<number, [number, number][]>();
const lastFire = new Map<number, number>();
const causes = new Map<string, number>();
let stalledSecs = 0, firstContact = -1, firstShot = -1, arrived = -1;
const t0 = w.tick;
function cause(u: Unit): string {
  const o = u.order;
  let s = o.type;
  if (o.type === 'move') {
    s += o.attackMove ? '(am)' : '(mv)';
    if (o.formation) {
      const g = groupById(w, o.formation);
      s += g ? ` form f=${g.f.toFixed(2)} wait=${g.wait ?? 0}` : ' form-gone';
    }
  } else if (o.type === 'attack') {
    const t = w.entities.get(o.target);
    const d = t ? Math.hypot(t.x - u.x, t.y - u.y) : -1;
    s += ` ${t ? (t instanceof Building ? 'B:' + t.bt.id : 'U:' + (t as Unit).ut.id) : '?'} d=${d.toFixed(0)} seen=${t ? +w.canSee(me, t) : 0}`;
  }
  s += u.pathPending ? ' pending' : u.path ? ` path${u.pathIdx}/${u.path.length}` : ' nopath';
  if (u.hasGoal) s += ' goal';
  if (u.speedCap) s += ` cap${u.speedCap.toFixed(2)}`;
  return s;
}
for (let t = 1; t <= secs * TICK_HZ && !w.gameOver; t++) {
  step();
  for (const id of ids) { const u = w.entities.get(id); if (u && u.alive && u.lastFireTick === w.tick) { lastFire.set(id, w.tick); if (firstShot < 0) firstShot = (w.tick - t0) / TICK_HZ; } }
  if (t % TICK_HZ) continue;
  const sec = t / TICK_HZ;
  const alive = ids.map((id) => w.entities.get(id) as Unit).filter((u) => u && u.alive);
  if (!alive.length) break;
  if (firstContact < 0 && alive.some((u) => u.lastDamagedTick > t0)) firstContact = sec;
  const near = alive.filter((u) => target.distTo(u.x, u.y) < 8).length;
  if (arrived < 0 && near >= Math.max(1, alive.length * 0.5)) arrived = sec;
  for (const u of alive) {
    const h = hist.get(u.id) ?? [];
    h.push([u.x, u.y]);
    if (h.length > 11) h.shift();
    hist.set(u.id, h);
    if (h.length < 11) continue;
    const moved = Math.hypot(h[10][0] - h[0][0], h[10][1] - h[0][1]);
    const fired = (lastFire.get(u.id) ?? -1e9) > w.tick - 10 * TICK_HZ;
    const am = (u.order.type === 'move' && u.order.attackMove) || (u.order.type === 'attack' && !!u.order.resume);
    if (moved < 1 && !fired && am && target.distTo(u.x, u.y) > 6) {
      stalledSecs++;
      const c = `${u.kind[0]} ${cause(u).replace(/d=\d+/, 'd=..').replace(/path\d+\/\d+/, 'path').replace(/f=[\d.]+ wait=\d+/, 'f/wait').replace(/cap[\d.]+/, 'cap')}`;
      causes.set(c, (causes.get(c) ?? 0) + 1);
      if (V && sec % 10 === 0) console.log(`  t=${sec} #${u.id} ${u.ut.id} (${u.x.toFixed(1)},${u.y.toFixed(1)}) ${cause(u)}`);
    }
  }
  if (sec % 30 === 0) {
    const cx = alive.reduce((s, u) => s + u.x, 0) / alive.length, cy = alive.reduce((s, u) => s + u.y, 0) / alive.length;
    const ord = new Map<string, number>();
    for (const u of alive) { const k = u.order.type + (u.order.type === 'move' && u.order.formation ? 'F' : ''); ord.set(k, (ord.get(k) ?? 0) + 1); }
    console.log(`  t=${sec}s alive ${alive.length}/${ids.length} centre (${cx.toFixed(0)},${cy.toFixed(0)}) to target ${target.distTo(cx, cy).toFixed(0)}; near ${near}; orders ${[...ord].map(([k, v]) => k + ' ' + v).join(', ')}; enemy army ${enemyArmy()} def ${enemyDef()}`);
  }
}
const alive = ids.map((id) => w.entities.get(id) as Unit).filter((u) => u && u.alive);
console.log(`first shot ${firstShot}s, first hit taken ${firstContact}s, half arrived ${arrived}s; survivors ${alive.length}/${ids.length}; target ${target.alive ? 'standing' : 'destroyed'}; stalled unit-seconds ${stalledSecs}`);
for (const [c, n] of [...causes].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${String(n).padStart(5)}  ${c}`);

function botGame() {
  const deathsBy = new Map<string, number>(), deathsAt = new Map<string, number>();
  const kill0 = w.kill.bind(w);
  (w as any).kill = (e: any, how: any, killer?: any) => {
    if (e.alive && e.owner === me && e.kind !== 'building' && how !== 'sold') {
      const k = (killer ? (killer.kind === 'building' ? 'B:' : '') + killer.type.id : '') + (how !== 'normal' ? '(' + how + ')' : '');
      deathsBy.set(k, (deathsBy.get(k) ?? 0) + 1);
      const eb = w.buildings.filter((b) => b.alive && b.owner === foe);
      const de = Math.min(999, ...eb.map((b) => b.distTo(e.x, e.y)));
      const hb = w.buildings.filter((b) => b.alive && b.owner === me);
      const dh = Math.min(999, ...hb.map((b) => b.distTo(e.x, e.y)));
      const where = de < 8 ? 'at enemy base' : dh < 10 ? 'at home' : 'mid-map';
      deathsAt.set(where, (deathsAt.get(where) ?? 0) + 1);
    }
    return kill0(e, how, killer);
  };
  (stand as any).attack = () => {};
  (stand as any).defend = () => {};
  const causes = new Map<string, number>();
  const hist = new Map<number, [number, number][]>();
  const lastFire = new Map<number, number>();
  let stalled = 0, wave = 0, lastLoss = 0, kills = 0;
  const armed = () => w.units.filter((u) => u.alive && u.owner === me && u.weapons.length && !u.ut.harvester && !u.ut.deploysInto && u.kind !== 'aircraft' && u.kind !== 'naval' && !u.transport);
  const lost0 = () => me.stats?.unitsLost ?? 0;
  let tgt: Building | null = null;
  const sent = new Set<number>();
  let idleMid = 0, formSecs = 0, formWait = 0, formLong = 0;
  const busySince = new Map<number, number>();
  for (let t = 0; t < maxMin * 60 * TICK_HZ && !w.gameOver; t++) {
    step();
    for (const u of w.units) if (u.alive && u.owner === me && u.lastFireTick === w.tick) lastFire.set(u.id, w.tick);
    if (w.tick % TICK_HZ) continue;
    const sec = w.tick / TICK_HZ;
    const army = armed();
    const sendNow = sec >= first && (sec - first) % every === 0;
    const wave0 = once ? army.filter((u) => !sent.has(u.id)) : army;
    if (sendNow && wave0.length >= (once ? minWave : 1)) {
      const army = wave0;
      for (const u of army) sent.add(u.id);
      const cx = army.reduce((s, u) => s + u.x, 0) / army.length, cy = army.reduce((s, u) => s + u.y, 0) / army.length;
      let bd = Infinity;
      tgt = null;
      for (const b of w.buildings) if (b.alive && b.owner === foe && !b.bt.wall && !b.bt.mine) { const d = b.distTo(cx, cy); if (d < bd) { bd = d; tgt = b; } }
      if (!tgt) {
        // no structure left: hunt the nearest enemy unit
        let ud = Infinity, near: Unit | null = null;
        for (const u of w.units) if (u.alive && u.owner === foe && u.kind !== 'aircraft') { const d = Math.hypot(u.x - cx, u.y - cy); if (d < ud) { ud = d; near = u; } }
        if (near) w.issue({ c: 'move', player: me.id, units: army.map((u) => u.id), x: near.x, y: near.y, attackMove: true });
      }
      if (tgt) {
        wave++;
        const ord = new Map<string, number>();
        for (const u of army) { const k = u.order.type + (u.order.type === 'move' && u.order.formation ? 'F' : ''); ord.set(k, (ord.get(k) ?? 0) + 1); }
        const front = Math.min(...army.map((u) => tgt!.distTo(u.x, u.y)));
        if (V || wave % 3 === 1) console.log(`  wave ${wave} t=${sec}s army ${army.length} centre (${cx.toFixed(0)},${cy.toFixed(0)}) -> ${tgt.bt.id} (${tgt.x.toFixed(0)},${tgt.y.toFixed(0)}) d ${bd.toFixed(0)} front ${front.toFixed(0)}; orders ${[...ord].map(([k, v]) => k + ' ' + v).join(', ')}; enemy army ${enemyArmy()} def ${enemyDef()} blds ${w.buildings.filter((b) => b.alive && b.owner === foe).length}; my $${me.credits | 0}`);
        // --direct: the A-click lands on a structure the player has seen: the UI turns it into an attack on it (input.ts)
        if (direct && me.isEnemy(tgt.owner) && (!w.fog || seenBy(tgt))) w.issue({ c: 'attack', player: me.id, units: army.map((u) => u.id), target: tgt.id });
        else w.issue({ c: 'move', player: me.id, units: army.map((u) => u.id), x: tgt.x, y: tgt.y, attackMove: true });
      }
    }
    if (process.env.TRACE && sec >= +process.env.TRACE && sec < +process.env.TRACE + 12 && w.tick % 10 === 0) { const u = (process.env.TID ? w.entities.get(+process.env.TID) : armed().find((x) => x.order.type === 'attack' && Math.hypot(x.x - 19, x.y - 14) > +(process.env.FAR ?? 0))) as Unit; if (u?.alive) { const t = u.order.type === 'attack' ? w.entities.get(u.order.target) : null; if (t) console.log(`  TGT hp ${t.hp.toFixed(0)}/${(t as any).maxHp} alive ${t.alive} repairing ${(t as any).repairing} fired ${u.lastFireTick} now ${w.tick} visible ${w.canSee(me, t)}`); } { const fo = u.order.type === 'move' ? u.order.formation : u.order.type === 'attack' && u.order.resume?.type === 'move' ? u.order.resume.formation : undefined; const g = groupById(w, fo); if (g && process.env.GROUP) console.log('  GROUP c=' + g.x.toFixed(1) + ',' + g.y.toFixed(1) + ' idx ' + g.idx + '/' + g.path.length / 2 + ' ' + g.members.map((id, k) => { const m = w.entities.get(id) as Unit; const c = Math.cos(g.h), sn = Math.sin(g.h); const ox = g.offsets[2 * k], oy = g.offsets[2 * k + 1]; const sx = g.fixed ? g.x + ox : g.x + c * ox - sn * oy, sy = g.fixed ? g.y + oy : g.y + sn * ox + c * oy; return `${m.ut.id}#${id}:${m.order.type}${m.order.type === 'attack' ? '>' + (w.entities.get(m.order.target) as any)?.type.id : ''} lag ${Math.hypot(sx - m.x, sy - m.y).toFixed(1)}${m.path ? '' : ' nopath'}`; }).join(' | ')); } console.log(`TRACE q=${(w as any).pathQueue.length} ${sec} #${u.id} ${u.ut.id} (${u.x.toFixed(2)},${u.y.toFixed(2)}) ${cause(u)} goal(${u.goalX.toFixed(1)},${u.goalY.toFixed(1)}) wp ${u.path ? JSON.stringify(u.path[u.pathIdx]) : '-'} moving ${u.moving} yh ${u.yieldHold} stuck ${u.stuckCount} tgt ${u.target?.id}`); }
    if (direct && w.tick % (2 * TICK_HZ) === 0) for (const b of w.buildings) if (b.alive && b.owner === foe) seenBy(b);
    for (const g of w.ctrl.groups) { formSecs++; if ((g.wait ?? 0) > 60) formWait++; if ((g.wait ?? 0) > 200) formLong++; }
    // sent units standing idle well short of the enemy base (gave up on the way)
    const home = w.buildings.find((b) => b.alive && b.owner === me && b.bt.id === 'fact');
    if (tgt?.alive) for (const u of army) if (sent.has(u.id) || !once) {
      if (u.order.type === 'idle' && !u.target && tgt.distTo(u.x, u.y) > 20 && (!home || home.distTo(u.x, u.y) > 20)) { idleMid++; if (V && sec % 30 === 0) console.log(`    idle mid-map t=${sec} #${u.id} ${u.ut.id} (${u.x.toFixed(1)},${u.y.toFixed(1)})`); }
    }
    for (const u of army) {
      const h = hist.get(u.id) ?? [];
      h.push([u.x, u.y]);
      if (h.length > 11) h.shift();
      hist.set(u.id, h);
      if (h.length < 11) continue;
      const moved = Math.hypot(h[10][0] - h[0][0], h[10][1] - h[0][1]);
      const fired = (lastFire.get(u.id) ?? -1e9) > w.tick - 10 * TICK_HZ;
      const am = (u.order.type === 'move' && u.order.attackMove) || u.order.type === 'attack';
      if (!am) busySince.delete(u.id); else if (!busySince.has(u.id)) busySince.set(u.id, w.tick);
      if (moved < 1 && !fired && am && w.tick - busySince.get(u.id)! >= 10 * TICK_HZ) {
        stalled++;
        const c = `${u.kind[0]} ${cause(u).replace(/d=\d+/, 'd=..').replace(/path\d+\/\d+/, 'path').replace(/f=[\d.]+ wait=\d+/, 'f/wait').replace(/cap[\d.]+/, 'cap')}`;
        causes.set(c, (causes.get(c) ?? 0) + 1);
        if (V && sec % 15 === 0) console.log(`    t=${sec} #${u.id} ${u.ut.id} (${u.x.toFixed(1)},${u.y.toFixed(1)}) ${cause(u)}`);
      }
    }
  }
  const won = w.gameOver ? w.winnerTeam === me.team : null;
  const lost = me.stats.unitsLost, killed = me.stats.unitsKilled;
  console.log(`end t=${(w.tick / TICK_HZ).toFixed(0)}s ${won === null ? 'undecided' : won ? 'WON' : 'LOST'}; units lost ${lost} killed ${killed}; waves ${wave}; stalled unit-seconds ${stalled}; idle mid-map unit-s ${idleMid}; formation group-s ${formSecs} held back ${formWait} (>10 s ${formLong}); enemy blds ${w.buildings.filter((b) => b.alive && b.owner === foe).length}`);
  for (const [c, n] of [...causes].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`   ${String(n).padStart(5)}  ${c}`);
  console.log(`  deaths by killer: ${[...deathsBy].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(', ')}`);
  console.log(`  deaths where: ${[...deathsAt].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(', ')}`);
}
