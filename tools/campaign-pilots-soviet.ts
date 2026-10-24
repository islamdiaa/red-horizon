// Soviet campaign autopilots (registered into PILOTS).
import type { Building, Unit } from '../src/sim/entities';
import { ground } from '../src/missions/common';
import { PILOTS, army, attack, attackMove, builder, commander, enemyThings, every, expertMicro, genericPilot, moveTo, nearestTo } from './campaign-pilots';
import { skillPilot } from './campaign-players';

const cen = (l: { x: number; y: number }[]) => ({ x: l.reduce((a, u) => a + u.x, 0) / Math.max(1, l.length), y: l.reduce((a, u) => a + u.y, 0) / Math.max(1, l.length) });
const enemyUnitsNear = (world: any, x: number, y: number, r: number): Unit[] =>
  world.units.filter((u: Unit) => u.alive && world.players[0].isEnemy(u.owner) && Math.hypot(u.x - x, u.y - y) < r);

// 1. strike: the group gathers out of the guns' reach, the V2 snipes from beyond their range (the dome first when it
//    can, before the uplink), the tanks and infantry stay together in front of it and meet whatever comes out (tanks
//    run infantry over), then everyone storms the hill
PILOTS['soviet-01'] = (world, rt, s, log) => {
  // (at Brutal the garrison is twice as deadly and twenty per cent faster: sniping from range gives it time to catch the
  // V2 alone, even with the screen sent ahead (0 of 16); what works is everything at once, the V2 just behind the tanks,
  // with an expert's hands: focus fire, and the heavy tanks run the riflemen over. Measured over 32 seeds: 16 wins
  // with them against 5 without, which is where the casual stand-in plays it)
  if (rt.level === 'brutal') { s.casual ??= skillPilot('casual'); s.casual(world, rt, s, log); expertMicro(world, s, army(world)); return; }
  if (!every(world, s, 'tick', 1)) return;
  const v2 = world.getEntity(rt.flags.v2) as Unit | undefined;
  const tanks = army(world).filter((u) => u.ut.id === '3tnk');
  const inf = army(world).filter((u) => u.kind === 'infantry');
  const group = [...tanks, ...inf];
  const st = rt.start(0), e = rt.start(1);
  const defences = world.buildings.filter((b) => b.alive && b.owner.id === 1 && b.weapons.length);
  const dome = world.getEntity(rt.flags.dome) as Building | undefined;
  const safeFrom = (x: number, y: number, margin: number) => defences.every((b) => b.distTo(x, y) > b.weapons[0].def.range + margin);
  /** A firing spot for the V2: within its reach of the target, clear of every gun, nearest our side. */
  // (on our side of it, and reachable in a straight line from where the V2 is without passing a gun)
  const lineSafe = (ax: number, ay: number, bx: number, by: number) => { for (let k = 1; k <= 8; k++) { const f = k / 8; if (!safeFrom(ax + (bx - ax) * f, ay + (by - ay) * f, 0.6)) return false; } return true; };
  const spotFor = (t: Building): [number, number] | null => {
    let best: [number, number] | null = null, bd = Infinity;
    const from = v2 ?? tanks[0];
    for (let r = 8.6; r <= 9.6; r += 0.5) for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const x = t.x + Math.cos(a) * r, y = t.y + Math.sin(a) * r;
      const cx = Math.floor(x), cy = Math.floor(y);
      if (!world.map.inBounds(cx, cy) || !world.map.passable(cx, cy) || !safeFrom(x, y, 1.2)) continue;
      if (Math.hypot(x - st.x, y - st.y) > Math.hypot(t.x - st.x, t.y - st.y) || (from && !lineSafe(from.x, from.y, x, y))) continue;
      const d = Math.hypot(x - st.x, y - st.y);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    return best;
  };
  const threats = enemyUnitsNear(world, (v2 ?? tanks[0] ?? st).x, (v2 ?? tanks[0] ?? st).y, 10);
  if (threats.length) attackMove(world, group.filter((u) => Math.hypot(u.x - threats[0].x, u.y - threats[0].y) < 12), threats[0].x, threats[0].y);
  // gather first: the infantry is slower than the armour
  const stage = rt.toward(e, st, 20);
  if (!s.gathered) {
    const far = group.filter((u) => Math.hypot(u.x - stage[0], u.y - stage[1]) > 4);
    // (the V2 rides with the infantry, behind the stage)
    const back = inf.length ? cen(inf) : { x: st.x, y: st.y };
    const v2At = Math.hypot(back.x - e.x, back.y - e.y) > 22 ? [back.x, back.y] as [number, number] : rt.toward(e, st, 22);
    if (!threats.length) { if (far.length) attackMove(world, far, stage[0], stage[1]); if (v2?.alive && Math.hypot(v2.x - v2At[0], v2.y - v2At[1]) > 2) moveTo(world, [v2], v2At[0], v2At[1]); }
    if (far.length <= 1 || world.time > 75) { s.gathered = true; log('pilot: gathered'); }
    return;
  }
  if (v2?.alive && (defences.length || dome?.alive)) {
    // the dome first if there is a spot for it, else the nearest gun
    const order = [...(dome?.alive ? [dome] : []), ...defences.sort((a, b) => Math.hypot(a.x - v2.x, a.y - v2.y) - Math.hypot(b.x - v2.x, b.y - v2.y))];
    let tgt: Building | null = null, spot: [number, number] | null = null;
    for (const b of order) { const p = spotFor(b); if (p) { tgt = b; spot = p; break; } }
    if (!tgt) { tgt = defences.length ? order.find((b) => b !== dome) ?? order[0] : order[0]; spot = null; }
    if (tgt) {
      const inReach = Math.hypot(v2.x - tgt.x, v2.y - tgt.y) <= 9.8;
      if (inReach && (!spot || safeFrom(v2.x, v2.y, 0.5))) { if (v2.order.type !== 'attack' || (v2.order as { target: number }).target !== tgt.id) attack(world, [v2], tgt); }
      else if (spot) moveTo(world, [v2], spot[0], spot[1]);
      else attack(world, [v2], tgt);
    }
    if (!threats.length) {
      // the screen: two cells in front of the V2, clear of the guns
      const scr = rt.toward(v2, tgt ?? e, 2.5);
      const ok = safeFrom(scr[0], scr[1], 0.5) ? scr : [v2.x, v2.y];
      const lag = group.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - ok[0], u.y - ok[1]) > 3);
      if (lag.length) attackMove(world, lag, ok[0], ok[1]);
    }
    return;
  }
  // the storm: the tanks take out the anti-tank gun first (machine-gun bunkers barely scratch them, and the infantry
  // waits until the bunkers are down: they shred riflemen)
  const atGuns = defences.filter((b) => b.weapons.some((w) => w.def.warhead === 'AP'));
  const t = atGuns.length ? nearestTo(atGuns, (tanks[0] ?? st).x, (tanks[0] ?? st).y) : dome?.alive ? dome : nearestTo(defences, st.x, st.y) ?? nearestTo(enemyThings(world).filter((x) => x.kind === 'building'), st.x, st.y) ?? nearestTo(enemyThings(world), st.x, st.y);
  if (t && !threats.length && every(world, s, 'storm', 4)) {
    if (t.kind === 'building' && tanks.length) attack(world, tanks, t);
    else attackMove(world, tanks, t.x, t.y);
    const bunkers = defences.filter((b) => !b.weapons.some((w) => w.def.warhead === 'AP'));
    if (!bunkers.length || !tanks.length) attackMove(world, inf, t.x, t.y);
    else { const hold = rt.toward(nearestTo(bunkers, st.x, st.y)!, st, 8); const lag = inf.filter((u) => Math.hypot(u.x - hold[0], u.y - hold[1]) > 3); if (lag.length) attackMove(world, lag, hold[0], hold[1]); }
  }
  if (!s.stormLogged) { s.stormLogged = true; log('pilot: storming the hill'); }
};

// 2. base + garrison
PILOTS['soviet-02'] = (world, rt, s, log) => {
  // (at Hard and Brutal the riflemen-and-grenadiers plan in waves beats the AI brain's mix: 3/8 against 1/8 before tuning)
  if (rt.tightened) { s.cas ??= skillPilot('casual'); s.cas(world, rt, s, log); return; }
  genericPilot(world, rt, s, log);
  // dogs hunt the commando
  const k = world.getEntity(rt.flags.kestrel) as Unit | undefined;
  if (k?.alive && every(world, s, 'dogs', 2)) {
    const dogs = world.units.filter((u) => u.alive && u.owner.id === 0 && u.ut.dog);
    attack(world, dogs, k);
  }
};

// 3. raid: capture the station, hold the ridge with the coil, repair, then clear the camp
PILOTS['soviet-03'] = (world, rt, s, log) => {
  if (!every(world, s, 'tick', 1)) return;
  const station = world.getEntity(rt.flags.station) as Building | undefined;
  const coil = world.getEntity(rt.flags.coil) as Building | undefined;
  const engs = rt.livingUnits(rt.flags.engineers);
  const fighters = army(world);
  const st = rt.start(0);
  if (rt.isDone('hold') || !station?.alive) { commander(world, rt, s, log, { noBrain: true, threshold: 6000 }); return; }
  if (station.owner.id !== 0) {
    const guards = enemyUnitsNear(world, station.x, station.y, 11);
    const dogs = fighters.filter((u) => u.ut.dog);
    const rest = fighters.filter((u) => !u.ut.dog);
    const hold = rt.toward(station, st, 10);
    if (guards.length && fighters.length) {
      // the dogs go in first; flamers would roast them in the melee
      const splash = rest.filter((u) => u.ut.id === 'e4' || u.ut.id === 'e2');
      const front = fighters.filter((u) => !splash.includes(u));
      // (once the dogs and riflemen are gone, the flamers and grenadiers go in themselves)
      attackMove(world, front.length ? front : splash, guards[0].x, guards[0].y);
      const lagR = front.length ? splash.filter((u) => Math.hypot(u.x - hold[0], u.y - hold[1]) > 3) : [];
      if (lagR.length) moveTo(world, lagR, hold[0], hold[1]);
      void dogs;
      const lag = engs.filter((u) => Math.hypot(u.x - hold[0], u.y - hold[1]) > 2);
      if (lag.length) moveTo(world, lag, hold[0], hold[1]);
    } else if (engs.length) {
      attack(world, [engs[0]], station);
      const splash = fighters.filter((u) => u.ut.id === 'e4' || u.ut.id === 'e2');
      world.issue({ c: 'stop', player: 0, units: splash.map((u) => u.id) });
    }
    return;
  }
  // holding: repair the station, fight near the station/coil
  if (station.hp < station.maxHp && !station.repairing && world.players[0].credits > 20) world.issue({ c: 'repair', player: 0, building: station.id });
  const anchor = coil?.alive ? coil : station;
  const threats = enemyUnitsNear(world, anchor.x, anchor.y, 12);
  if (!rt.isDone('hold')) {
    if (threats.length) attackMove(world, fighters.filter((u) => u.order.type === 'idle' || Math.hypot(u.x - threats[0].x, u.y - threats[0].y) < 10), threats[0].x, threats[0].y);
    else {
      const lag = fighters.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - station.x, u.y - station.y) > 5);
      if (lag.length) attackMove(world, lag, station.x, station.y);
    }
    return;
  }
  commander(world, rt, s, log, { noBrain: true, threshold: 6000 });
};

// 4. escort, deploy, build, destroy the airbase
PILOTS['soviet-04'] = (world, rt, s, log) => {
  // (at Hard and Brutal the patient plan wins: flame towers at home, waves kept together; measured 7/8 and 8/8 against
  // 4/8 and 0/8 for the early 9000 push below)
  if (rt.tightened) { s.cas ??= skillPilot('casual'); s.cas(world, rt, s, log); return; }
  const mcv = world.getEntity(rt.flags.mcv) as Unit | undefined;
  const oasis = rt.flags.oasis as [number, number];
  if (mcv?.alive && !world.players[0].has('fact')) {
    if (!every(world, s, 'esc', 1.5)) return;
    const esc = army(world);
    const threats = enemyThings(world).filter((t) => Math.hypot(t.x - mcv.x, t.y - mcv.y) < 9);
    if (threats.length) { attackMove(world, esc, threats[0].x, threats[0].y); return; }
    if (Math.hypot(mcv.x - oasis[0], mcv.y - oasis[1]) < 3) {
      if (world.canDeploy(mcv)) world.issue({ c: 'deploy', player: 0, units: [mcv.id] });
      else moveTo(world, [mcv], mcv.x + 1, mcv.y + 1);
      return;
    }
    const lead = rt.toward(mcv, { x: oasis[0], y: oasis[1] }, 4);
    attackMove(world, esc, lead[0], lead[1]);
    moveTo(world, [mcv], oasis[0], oasis[1]);
    return;
  }
  // (a bigger base with flame towers and a third refinery was measured worse: 4/8 at Normal against 8/8)
  builder(world, s, ['powr', 'proc', 'barr', 'weap', 'powr', 'proc', 'dome', 'sam', 'powr', 'sam'], ['e3', 'e1'], ['3tnk', '3tnk', '3tnk', 'v2rl']);
  commander(world, rt, s, log, { noBrain: true, threshold: 9000, maxThreshold: 14000 });
};

// 5. capture: break the defences, beat the device down with tanks, send an engineer, hold
PILOTS['soviet-05'] = (world, rt, s, log) => {
  // (at Hard and Brutal the patient plan wins: the starting tanks wait for a bigger army; measured 8/8 at Hard against
  // 1/8 for the early push below)
  if (rt.tightened) { s.cas ??= skillPilot('casual'); s.cas(world, rt, s, log); return; }
  const pd = world.getEntity(rt.flags.pdox) as Building | undefined;
  builder(world, s, ['powr', 'proc', 'barr', 'weap', 'powr', 'proc', 'dome', 'apwr', 'weap'], ['e1', 'e3'], ['3tnk', '3tnk']);
  if (!pd?.alive) return;
  if (pd.owner.id === 0) {
    // hold around the device; the dogs hunt Kestrel
    if (!every(world, s, 'hold', 2)) return;
    const k = world.getEntity(rt.flags.kestrel) as Unit | undefined;
    if (k?.alive) attack(world, world.units.filter((u) => u.alive && u.owner.id === 0 && (u.ut.dog || u.kind === 'infantry')), k);
    const a = army(world);
    const threats = enemyThings(world).filter((t) => t.kind !== 'building' && Math.hypot(t.x - pd.x, t.y - pd.y) < 14);
    if (threats.length) attackMove(world, a.filter((u) => Math.hypot(u.x - pd.x, u.y - pd.y) < 25), threats[0].x, threats[0].y);
    else attackMove(world, a.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - pd.x, u.y - pd.y) > 6), pd.x, pd.y);
    return;
  }
  const critical = pd.healthFrac <= 0.25;
  commander(world, rt, s, log, {
    noBrain: true,
    threshold: 9000,
    pickTarget: (from) => {
      const defs = world.buildings.filter((b) => b.alive && b.owner.id === 1 && b.weapons.length);
      const d = nearestTo(defs, from.x, from.y);
      if (d && Math.hypot(d.x - pd.x, d.y - pd.y) < 16) return d;
      return critical ? (nearestTo(enemyThings(world).filter((x) => x.kind !== 'building'), pd.x, pd.y) ?? null) : pd;
    },
  });
  if (critical && every(world, s, 'cease', 1)) {
    // cease fire on the device, send the engineers
    for (const u of army(world)) if (u.target === pd || (u.order.type === 'attack' && (u.order as any).target === pd.id)) world.issue({ c: 'stop', player: 0, units: [u.id] });
    const engs = world.units.filter((u) => u.alive && u.owner.id === 0 && u.ut.engineer);
    const guards = enemyUnitsNear(world, pd.x, pd.y, 7);
    if (engs.length && guards.length < 3) attack(world, engs.slice(0, 2), pd);
    // the engineers were lost: train new ones (otherwise the device sits locked down forever)
    const p0 = world.players[0];
    if (!engs.length && p0.canBuild('e6') && !p0.queues.infantry.items.some((i) => i.type === 'e6')) world.issue({ c: 'build', player: 0, type: 'e6' });
  }
};

// 6. defend the Iron Curtain, then crush the NKVD
PILOTS['soviet-06'] = (world, rt, s, log) => {
  // (at Brutal holding everything right at the device, as the casual plan does, measured 3/8 against 0/8)
  if (rt.level === 'brutal') { s.cas ??= skillPilot('casual'); s.cas(world, rt, s, log); return; }
  builder(world, s, ['proc', 'sam', 'apwr', 'sam', 'tsla', 'apwr'], ['e1', 'e3', 'e2'], ['3tnk', '3tnk', '4tnk', 'v2rl']);
  const iron = world.getEntity(rt.flags.iron) as Building | undefined;
  const st = rt.start(0);
  commander(world, rt, s, log, {
    noBrain: true,
    threshold: rt.flags.coup ? 7000 : 99999,
    rally: iron ? [iron.x + 3, iron.y - 3] : [st.x, st.y],
    pickTarget: (from) => nearestTo(world.buildings.filter((b) => b.alive && b.owner.id === 2 && !b.bt.wall), from.x, from.y) ?? nearestTo(enemyThings(world).filter((x) => x.kind === 'building'), from.x, from.y),
  });
  // fire the Iron Curtain on a tank group when charged
  if (every(world, s, 'ic', 3) && rt.superState(0, 'ironcurtain')?.ready) {
    const t = army(world).find((u) => u.ut.id === '3tnk' || u.ut.id === '4tnk');
    if (t) world.issue({ c: 'superweapon', player: 0, kind: 'ironcurtain', x: t.x, y: t.y });
  }
};

// 7. finale
PILOTS['soviet-07'] = (world, rt, s, log) => {
  builder(world, s, ['proc', 'mslo', 'iron', 'apwr', 'weap', 'apwr', 'sam'], ['e3', 'e1'], ['4tnk', '3tnk', '3tnk', 'v2rl']);
  const pd = world.getEntity(rt.flags.pdox) as Building | undefined;
  commander(world, rt, s, log, {
    noBrain: true,
    // (the bar above the starting army: at 12000 it set out with what it was given at 0:30 and lost it at Hard; 18000
    // measured 10/16 at Hard against 2/8, Normal unchanged at 8/8)
    threshold: 18000, maxThreshold: 22000,
    deadline: () => (rt.timeLeft('overload') ?? 999) < 200,
    pickTarget: (from) => (rt.flags.overload && pd?.alive ? pd : nearestTo(enemyThings(world).filter((x) => x.kind === 'building'), from.x, from.y) ?? nearestTo(enemyThings(world), from.x, from.y)),
  });
  if (every(world, s, 'nuke', 3) && rt.superState(0, 'nuke')?.ready) {
    const t = nearestTo(world.buildings.filter((b) => b.alive && b.owner.id === 1), rt.start(1).x, rt.start(1).y);
    if (t) world.issue({ c: 'superweapon', player: 0, kind: 'nuke', x: t.x, y: t.y });
  }
  if (every(world, s, 'ic', 3) && rt.superState(0, 'ironcurtain')?.ready && s.mode === 'attack') {
    const t = army(world).find((u) => u.ut.id === '4tnk' || u.ut.id === '3tnk');
    if (t) world.issue({ c: 'superweapon', player: 0, kind: 'ironcurtain', x: t.x, y: t.y });
  }
  const k = world.getEntity(rt.flags.kestrel) as Unit | undefined;
  if (k?.alive && every(world, s, 'dogs', 2)) attack(world, world.units.filter((u) => u.alive && u.owner.id === 0 && u.ut.dog), k);
};

void ground;
