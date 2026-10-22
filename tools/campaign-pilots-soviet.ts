// Soviet campaign autopilots (registered into PILOTS).
import type { Building, Unit } from '../src/sim/entities';
import { ground } from '../src/missions/common';
import { PILOTS, army, attack, attackMove, builder, commander, enemyThings, every, genericPilot, moveTo, nearestTo } from './campaign-pilots';

const cen = (l: { x: number; y: number }[]) => ({ x: l.reduce((a, u) => a + u.x, 0) / Math.max(1, l.length), y: l.reduce((a, u) => a + u.y, 0) / Math.max(1, l.length) });
const enemyUnitsNear = (world: any, x: number, y: number, r: number): Unit[] =>
  world.units.filter((u: Unit) => u.alive && world.players[0].isEnemy(u.owner) && Math.hypot(u.x - x, u.y - y) < r);

// 1. strike: the V2 snipes the bunkers from range while the tanks screen it, then everyone storms the hill
PILOTS['soviet-01'] = (world, rt, s, log) => {
  if (!every(world, s, 'tick', 1)) return;
  const v2 = world.getEntity(rt.flags.v2) as Unit | undefined;
  const tanks = army(world).filter((u) => u.ut.id === '3tnk');
  const inf = army(world).filter((u) => u.kind === 'infantry');
  const st = rt.start(0), e = rt.start(1);
  const defences = world.buildings.filter((b) => b.alive && b.owner.id === 1 && b.weapons.length);
  const dome = world.getEntity(rt.flags.dome) as Building | undefined;
  const threats = enemyUnitsNear(world, (v2 ?? tanks[0] ?? st).x, (v2 ?? tanks[0] ?? st).y, 9);
  if (threats.length) {
    attackMove(world, [...tanks, ...inf.filter((u) => Math.hypot(u.x - threats[0].x, u.y - threats[0].y) < 8)], threats[0].x, threats[0].y);
  }
  const stage = rt.toward(e, st, 14.5);
  if (v2?.alive) {
    const tgt = defences.length ? nearestTo(defences, v2.x, v2.y) : dome?.alive ? dome : null;
    if (tgt && Math.hypot(v2.x - tgt.x, v2.y - tgt.y) < 11) { if (v2.order.type !== 'attack') attack(world, [v2], tgt); }
    else if (tgt) moveTo(world, [v2], stage[0], stage[1]);
    if (!threats.length) {
      const screen = rt.toward(v2, e, 3);
      const lag = tanks.filter((t) => Math.hypot(t.x - screen[0], t.y - screen[1]) > 3 && t.order.type === 'idle');
      if (lag.length) attackMove(world, lag, screen[0], screen[1]);
      const back = rt.toward(v2, st, 3);
      const il = inf.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - back[0], u.y - back[1]) > 3);
      if (il.length) attackMove(world, il, back[0], back[1]);
    }
  }
  if (!defences.length || !v2?.alive) {
    const t = dome?.alive ? dome : nearestTo(enemyThings(world).filter((x) => x.kind === 'building'), st.x, st.y) ?? nearestTo(enemyThings(world), st.x, st.y);
    if (t && !threats.length) attackMove(world, [...tanks, ...inf], t.x, t.y);
    if (!s.stormLogged) { s.stormLogged = true; log('pilot: storming the hill'); }
  }
};

// 2. base + garrison
PILOTS['soviet-02'] = (world, rt, s, log) => {
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
  builder(world, s, ['powr', 'proc', 'barr', 'weap', 'powr', 'proc', 'dome', 'sam', 'powr', 'sam'], ['e3', 'e1'], ['3tnk', '3tnk', '3tnk', 'v2rl']);
  commander(world, rt, s, log, { noBrain: true, threshold: 9000 });
};

// 5. capture: break the defences, beat the device down with tanks, send an engineer, hold
PILOTS['soviet-05'] = (world, rt, s, log) => {
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
    threshold: 12000,
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
