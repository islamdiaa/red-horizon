// Allied campaign autopilots (registered into PILOTS).
import type { Building, Unit } from '../src/sim/entities';
import { ground } from '../src/missions/common';
import { skillPilot } from './campaign-players';
import { PILOTS, army, attack, attackMove, brain, builder, commander, enemyThings, every, expertMicro, genericPilot, moveTo, nearestTo } from './campaign-pilots';

const cen = (l: { x: number; y: number }[]) => ({ x: l.reduce((a, u) => a + u.x, 0) / Math.max(1, l.length), y: l.reduce((a, u) => a + u.y, 0) / Math.max(1, l.length) });
const enemyUnitsNear = (world: any, x: number, y: number, r: number): Unit[] =>
  world.units.filter((u: Unit) => u.alive && world.players[0].isEnemy(u.owner) && Math.hypot(u.x - x, u.y - y) < r);

// 1. base + outpost; intercept the convoy with the fast units
PILOTS['allied-01'] = (world, rt, s, log) => {
  genericPilot(world, rt, s, log);
  const trucks = rt.livingUnits(rt.flags.trucks);
  if (trucks.length && every(world, s, 'convoy', 3)) {
    const fast = world.units.filter((u) => u.alive && u.owner.id === 0 && (u.ut.id === '1tnk' || u.ut.id === 'jeep' || u.ut.id === 'e3'));
    attack(world, fast, nearestTo(trucks, cen(fast).x, cen(fast).y)!);
  }
};

// 2. defend: defensive brain, army holds a line in front of the rail yard
PILOTS['allied-02'] = (world, rt, s) => {
  brain(world, s, 'defensive');
  expertMicro(world, s, army(world));
  if (every(world, s, 'hold', 5)) {
    const yard = world.getEntity(rt.flags.yard) as Building | undefined;
    const st = rt.start(0), e = rt.start(1);
    const hold = yard ? rt.between(st, e, 0.12, -3) : [st.x, st.y];
    const threats = enemyThings(world).filter((t) => t.kind !== 'building' && Math.hypot(t.x - st.x, t.y - st.y) < 22);
    const a = army(world);
    if (threats.length) {
      const t = nearestTo(threats, yard?.x ?? st.x, yard?.y ?? st.y)!;
      attackMove(world, a.filter((u) => u.order.type === 'idle' || u.order.type === 'guard'), t.x, t.y);
    } else {
      const far = a.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - hold[0], u.y - hold[1]) > 7);
      attackMove(world, far, hold[0], hold[1]);
    }
  }
};

// 3. commando: sneak along the south edge, C4 the power station, kill the technicians, take the lab, run for the LZ
PILOTS['allied-03'] = (world, rt, s, log) => {
  const k = world.getEntity(rt.flags.kestrel) as Unit | undefined;
  if (!k?.alive) return;
  const followers = world.units.filter((u) => u.alive && u.owner.id === 0 && u !== k);
  const engs = rt.livingUnits(rt.flags.engineers);
  const st = rt.start(0);
  const plants = rt.living(rt.flags.plants) as Building[];
  s.ps ??= plants.length ? cen(plants) : null;
  const ps = s.ps;
  const lab = world.getEntity(rt.flags.lab) as Building | undefined;
  s.phase ??= 'approach';
  if (!every(world, s, 'tick', 1)) return;
  if (process.env.TRACE && every(world, s, 'trace', 5)) log(`kestrel ${k.x.toFixed(1)},${k.y.toFixed(1)} hp ${k.hp} phase ${s.phase} wp ${s.wp} order ${k.order.type} p1pow ${world.players[1].powerOut}/${world.players[1].powerUse}`);
  const route: [number, number][] = [ground(rt, st.x, ps.y + 2), ground(rt, ps.x - 9, ps.y + 1)];
  const follow = (dist = 2.5) => {
    const back = Math.atan2(st.y - k.y, st.x - k.x);
    const fx = k.x + Math.cos(back) * dist, fy = k.y + Math.sin(back) * dist;
    const lag = followers.filter((u) => Math.hypot(u.x - fx, u.y - fy) > 1.5 && u.order.type !== 'enter');
    if (lag.length) moveTo(world, lag, fx, fy);
  };
  const stage = () => {
    const at = route[1];
    const lag = followers.filter((u) => Math.hypot(u.x - at[0], u.y - at[1]) > 2 && u.order.type !== 'enter');
    if (lag.length) moveTo(world, lag, at[0], at[1]);
  };
  const fts = world.buildings.filter((b) => b.alive && b.owner.id === 1 && b.bt.id === 'ftur');
  const safe = (x: number, y: number) => fts.every((f) => f.distTo(x, y) > 5.2);
  const near = enemyUnitsNear(world, k.x, k.y, 6.5).filter((u) => u.kind === 'infantry' && safe(u.x, u.y));
  const tank = enemyUnitsNear(world, k.x, k.y, 5.5).find((u) => u.kind === 'vehicle');
  const techs = rt.livingUnits(rt.flags.techs);
  const gen = world.getEntity(rt.flags.generator) as Building | undefined;
  if (s.phase === 'approach' && ps) {
    s.wp ??= 0;
    const w = route[Math.min(s.wp, route.length - 1)];
    if (Math.hypot(k.x - w[0], k.y - w[1]) < 2 || (k.order.type === 'idle' && Math.hypot(k.x - w[0], k.y - w[1]) < 5)) s.wp++;
    if (s.wp >= route.length) { s.phase = 'power'; log('pilot: at power station'); }
    else if (near.length) attack(world, [k], near[0]);
    else attackMove(world, [k], w[0], w[1]);
    follow();
  } else if (s.phase === 'power') {
    if (!plants.length) { s.phase = 'techs'; log('pilot: power down'); return; }
    if (near.length && !tank) attack(world, [k], near[0]);
    else if (k.order.type !== 'enter' && k.c4Timer <= 0) attack(world, [k], nearestTo(plants, k.x, k.y)!);
    stage();
  } else if (s.phase === 'techs') {
    if (gen?.alive) { if (k.order.type !== 'enter' && k.c4Timer <= 0) attack(world, [k], gen); stage(); return; }
    if (process.env.SKIPTECHS && techs.length) { stage(); return; }
    if (!techs.length && !(rt.flags.generator && gen?.alive)) { s.phase = process.env.EXTRAS ? 'extras' : 'lab'; return; }
    if (tank) { const a = Math.atan2(k.y - tank.y, k.x - tank.x); moveTo(world, [k], k.x + Math.cos(a) * 4, k.y + Math.sin(a) * 4); }
    else if (near.length && !near.some((u) => u.ut.engineer)) attack(world, [k], near[0]);
    else if (techs.length) attack(world, [k], nearestTo(techs, k.x, k.y)!);
    stage();
  } else if (s.phase === 'extras') {
    const stock = rt.living([rt.flags.stockade]) as Building[];
    const extra = stock.length ? stock : rt.living(rt.flags.coils) as Building[];
    if (!extra.length) { s.phase = 'lab'; return; }
    if (tank) { const a = Math.atan2(k.y - tank.y, k.x - tank.x); moveTo(world, [k], k.x + Math.cos(a) * 5, k.y + Math.sin(a) * 5); }
    else if (near.length) attack(world, [k], near[0]);
    else if (k.order.type !== 'enter' && k.c4Timer <= 0) attack(world, [k], nearestTo(extra, k.x, k.y)!);
    stage();
  } else if (s.phase === 'lab' && lab) {
    if (lab.owner.id === 0) { s.phase = 'extract'; return; }
    const guards = enemyUnitsNear(world, lab.x, lab.y, 8).filter((u) => safe(u.x, u.y));
    if (!safe(k.x, k.y)) moveTo(world, [k], lab.x, lab.y + 3);
    else if (near.length) attack(world, [k], near[0]);
    else if (guards.length) attackMove(world, [k], guards[0].x, guards[0].y);
    else attackMove(world, [k], lab.x - 2, lab.y + 2);
    if (!guards.length && engs.length) attack(world, [engs[0]], lab);
    else stage();
  } else if (s.phase === 'lab' && !lab) {
    s.phase = 'extract';
  } else if (s.phase === 'extract' && rt.flags.lz) {
    const [lx, ly] = rt.flags.lz as [number, number];
    if (near.length && Math.hypot(near[0].x - k.x, near[0].y - k.y) < 4) attack(world, [k], near[0]);
    else moveTo(world, [k], lx, ly);
    moveTo(world, followers, lx, ly);
  }
};

// 4. escort: board the APCs; the APCs stay back while the army clears the paratroopers at the station, then the
//    tanks lead and the APCs trail behind them, backing off from any fight (an APC's machine gun loses to infantry)
PILOTS['allied-04'] = (world, rt, s, log) => {
  if (!every(world, s, 'tick', 1.5)) return;
  const team = rt.livingUnits(rt.flags.team);
  const apcs = rt.livingUnits(rt.flags.apcs);
  const st = rt.start(0), e = rt.start(1);
  const esc = army(world).filter((u) => !u.ut.passengers);
  /** APCs move away from any enemy within r of them; returns true if one had to. */
  const backOff = (r: number) => {
    let any = false;
    for (const apc of apcs) {
      const near = enemyUnitsNear(world, apc.x, apc.y, r);
      if (!near.length) continue;
      any = true;
      const c = cen(near);
      const away = Math.atan2(apc.y - c.y, apc.x - c.x);
      const [x, y] = ground(rt, apc.x + Math.cos(away) * 6, apc.y + Math.sin(away) * 6, 4);
      moveTo(world, [apc], x, y);
    }
    return any;
  };
  if (!s.sold) {
    // the station is short of power: sell the Tech Center and the radar so the prototype charges in four minutes
    s.sold = true;
    for (const b of world.buildings) if (b.alive && b.owner.id === 0 && (b.bt.id === 'atek' || b.bt.id === 'dome')) world.issue({ c: 'sell', player: 0, building: b.id });
  }
  if (!s.boarded) {
    team.forEach((u, i) => {
      if (u.transport || u.order.type === 'enter') return;
      const apc = apcs[i === 0 ? 0 : Math.min(1, apcs.length - 1)] ?? apcs[0];
      if (apc) world.issue({ c: 'enter', player: 0, units: [u.id], target: apc.id });
    });
    if (team.every((u) => u.transport)) { s.boarded = true; log('pilot: boarded'); }
    return;
  }
  // the station: hold until the paratroopers (they drop at 0:25) are dead; the APCs wait behind the station
  if (!s.cleared) {
    const threats = enemyUnitsNear(world, st.x, st.y, 18);
    if (threats.length) attackMove(world, esc, threats[0].x, threats[0].y);
    if (!backOff(9)) {
      const [hx, hy] = ground(rt, ...rt.toward(st, e, -4), 4);
      const lag = apcs.filter((a) => Math.hypot(a.x - hx, a.y - hy) > 2.5);
      if (lag.length) moveTo(world, lag, hx, hy);
    }
    if (world.time > 32 && !threats.length) { s.cleared = true; log('pilot: station clear, moving out'); }
    return;
  }
  const lz = rt.flags.lz as [number, number];
  // after the betrayal the Chronosphere prototype (charged by then, as Saarinen points out) carries the doctor's APC
  // straight to the seaplane
  const doc = apcs.find((a) => a.passengers.some((p) => p.id === rt.flags.saarinen));
  if (rt.flags.betrayed && doc && rt.superState(0, 'chrono')?.ready) {
    world.issue({ c: 'superweapon', player: 0, kind: 'chrono', x: lz[0], y: lz[1], unit: doc.id });
    log('pilot: chronoshift to the seaplane');
  }
  const veh = esc.filter((u) => u.kind === 'vehicle');
  const lead = veh.length ? cen(veh) : esc.length ? cen(esc) : cen(apcs);
  const threats = enemyThings(world).filter((t) => Math.hypot(t.x - lead.x, t.y - lead.y) < 9 && (t.kind !== 'building' || (t as Building).weapons.length));
  const toLz = Math.hypot(lz[0] - lead.x, lz[1] - lead.y);
  if (!esc.length) { moveTo(world, apcs, lz[0], lz[1]); return; } // nothing left to hide behind: run for it
  if (threats.length) {
    attackMove(world, esc, nearestTo(threats, lead.x, lead.y)!.x, nearestTo(threats, lead.x, lead.y)!.y);
    if (rt.flags.betrayed && toLz < 10) moveTo(world, apcs, lz[0], lz[1]);
    else backOff(10);
    return;
  }
  const step = Math.min(8, toLz);
  attackMove(world, esc, lead.x + ((lz[0] - lead.x) / (toLz || 1)) * step, lead.y + ((lz[1] - lead.y) / (toLz || 1)) * step);
  if (backOff(8)) return;
  if (toLz < 7) { moveTo(world, apcs, lz[0], lz[1]); return; }
  // trail the army by a few cells (never in front of it)
  const [tx, ty] = ground(rt, lead.x - ((lz[0] - lead.x) / (toLz || 1)) * 5, lead.y - ((lz[1] - lead.y) / (toLz || 1)) * 5, 4);
  const lag = apcs.filter((a) => Math.hypot(a.x - tx, a.y - ty) > 2.5);
  if (lag.length) moveTo(world, lag, tx, ty);
};

// 5. truck hunt: lean base with Longbows, and a hunter group of tanks and helicopters
PILOTS['allied-05'] = (world, rt, s, log) => {
  // (at Brutal, against a ten-minute clock, the casual plan's Longbows and kept-together waves measured 3/8 against 0/8;
  // at Hard 16/16 against 11/16 for the hunter packs below)
  if (rt.tightened) { s.cas ??= skillPilot('casual'); s.cas(world, rt, s, log); return; }
  builder(world, s, ['powr', 'proc', 'weap', 'powr', 'proc', 'tent', 'dome', 'powr', 'hpad', 'hpad', 'fix'], ['e3'], ['2tnk', '2tnk', '1tnk'], ['heli']);
  if (!every(world, s, 'hunt', 3)) return;
  const harvs = world.units.filter((u) => u.alive && u.owner.id === 1 && u.ut.harvester);
  const st = rt.start(0);
  const hunters = world.units.filter((u) => u.alive && u.owner.id === 0 && (['1tnk', '2tnk', 'jeep', 'heli'] as string[]).includes(u.ut.id));
  // keep a home guard of infantry; tanks and helicopters hunt
  const threat = enemyThings(world).find((e) => e.kind !== 'building' && Math.hypot(e.x - st.x, e.y - st.y) < 14);
  if (threat) attackMove(world, army(world).filter((u) => u.kind === 'infantry'), threat.x, threat.y);
  if (!harvs.length) return;
  // only chase trucks away from the camp flame tower and the main base; strike as a pack
  const e = rt.start(1);
  const fts = world.buildings.filter((b) => b.alive && b.owner.id === 1 && (b.bt.id === 'ftur' || b.bt.id === 'tsla'));
  // the last few trucks hide by the base: past ten minutes (or with three left) go in after them anyway
  const late = harvs.length <= 3 || world.time > 600;
  const exposed = late ? harvs : harvs.filter((h) => Math.hypot(h.x - e.x, h.y - e.y) > 12 && fts.every((f) => f.distTo(h.x, h.y) > 6));
  const ready = hunters.filter((h) => h.kind !== 'aircraft' || h.ammo > 0);
  const c = ready.length ? cen(ready) : st;
  if (exposed.length && ready.length >= (late ? 6 : 8)) {
    const t = nearestTo(exposed, c.x, c.y)!;
    attack(world, ready, t);
  } else {
    const idle = ready.filter((h) => h.order.type === 'idle' && Math.hypot(h.x - st.x, h.y - st.y) > 8);
    if (idle.length) attackMove(world, idle, st.x + (e.x - st.x) * 0.2, st.y + (e.y - st.y) * 0.2);
  }
  if (every(world, s, 'hlog', 60)) log(`pilot: ${hunters.length} hunters, ${harvs.length} trucks left`);
};

/**
 * allied-06 opening: the generator yard's outer plants stand beyond its flame towers' reach from the west. The
 * starting army goes round to the open ground west of the yard (moving, not attack-moving past the fortress),
 * then shoots the nearest plant from there, from the side away from the towers. One plant down puts the grid
 * under its load for good (the fortress cannot build power), the coils go dark and the countdown crawls; the
 * sappers go home and the main plan takes over (a second plant cost the sappers: measured 0/8 at Brutal against 4/8
 * for one). Returns true while the sappers are busy.
 */
function sapYard(world: any, rt: any, s: Record<string, any>, log: (t: string) => void, yard: Building[]): boolean {
  if (s.sap === 'done') return false;
  const foe = world.players[1];
  const towers = world.buildings.filter((b: Building) => b.alive && b.owner === foe && b.weapons.length && b.bt.id !== 'sam');
  if (!s.sap) {
    s.sappers = new Set(army(world).filter((u) => u.ut.id !== 'e6' && !u.ut.hero).map((u) => u.id));
    // the plant on our side of the yard, and a spot beyond it, away from the nearest tower
    const st = rt.start(0);
    const best = nearestTo(yard, st.x, st.y) as Building | null;
    if (!best) { s.sap = 'done'; return false; }
    const t = nearestTo(towers, best.x, best.y)!;
    const d = Math.hypot(best.x - t.x, best.y - t.y) || 1;
    s.stage = ground(rt, best.x + (best.x - t.x) / d * 6, best.y + (best.y - t.y) / d * 6);
    s.sap = 'go';
    s.sapT = world.time;
    log(`pilot: sappers (${s.sappers.size}) to ${s.stage[0].toFixed(0)},${s.stage[1].toFixed(0)}`);
  }
  const units = (world.units as Unit[]).filter((u) => u.alive && (s.sappers as Set<number>).has(u.id));
  const low = foe.powerOut < foe.powerUse;
  const plantsDown = 4 - yard.length;
  if (!units.length || plantsDown >= 1 || world.time - s.sapT > 600) {
    s.sap = 'done';
    log(`pilot: sapping over (${units.length} left, ${plantsDown} plants down, grid ${foe.powerOut}/${foe.powerUse})`);
    // (back home: with the grid down the clock crawls, so the army that comes next can be a big one)
    if (low) { const st = rt.start(0), e = rt.start(1); moveTo(world, units, ...rt.toward(st, e, 9) as [number, number]); }
    return false;
  }
  if (!every(world, s, 'sap', 1)) return true;
  const [sx, sy] = s.stage as [number, number];
  if (s.sap === 'go') {
    const lag = units.filter((u) => Math.hypot(u.x - sx, u.y - sy) > 4);
    if (lag.length <= units.length * 0.3 || world.time - s.sapT > 150) { s.sap = 'hit'; log('pilot: sappers in place'); }
    else { if (every(world, s, 'sapmove', 4)) moveTo(world, lag.filter((u) => u.order.type !== 'move'), sx, sy); return true; }
  }
  // hit: anything armed coming at us first (out of the towers' reach), else the nearest plant; nobody chases a
  // fleeing enemy back under the towers (a leash round the spot)
  const plant = nearestTo(yard, sx, sy) as Building | null;
  if (!plant) return true;
  const far = units.filter((u) => Math.hypot(u.x - sx, u.y - sy) > 9);
  if (far.length) moveTo(world, far.filter((u) => u.order.type !== 'move'), sx, sy);
  const near = units.filter((u) => Math.hypot(u.x - sx, u.y - sy) <= 9);
  expertMicro(world, s, near);
  const busy = (u: Unit) => u.order.type === 'attack' && world.getEntity((u.order as { target: number }).target)?.alive;
  const free = near.filter((u) => !busy(u));
  if (free.length) attack(world, free, plant);
  return true;
}

// 6. silo: build up, hit the generator yard (coils go dark, countdown crawls), then the silo; Kestrel C4s it
PILOTS['allied-06'] = (world, rt, s, log) => {
  const silo = world.getEntity(rt.flags.silo) as Building | undefined;
  const left = rt.timeLeft('launch') ?? 999;
  const e = rt.start(1), st = rt.start(0);
  const yard = rt.living(rt.flags.yard) as Building[];
  s.yardC ??= cen(yard);
  builder(world, s, ['powr', 'tent', 'proc', 'weap', 'powr', 'gun', 'proc', 'pbox', 'dome', 'gun', 'powr', 'weap', 'fix'], ['e1', 'e3', 'e3'], ['2tnk', '2tnk', '2tnk', 'arty']);
  const sapping = sapYard(world, rt, s, log, yard);
  // (the grid down for good: the countdown crawls, the army builds up at home and goes once, big)
  // (measured at Brutal over 32 seeds: a bar of 15000 won 19, 12000 won 10; staying out at the yard instead, 3 of 16)
  const crawl = s.sap === 'done' && world.players[1].lowPower;
  if (crawl && !s.crawlBar) { s.crawlBar = true; s.threshold = Math.max(s.threshold ?? 0, 15000); }
  commander(world, rt, s, log, {
    noBrain: true,
    threshold: 8000,
    units: (u) => !sapping || !(s.sappers as Set<number>).has(u.id),
    rally: sapping || crawl ? rt.toward(st, e, 9) : rt.toward(s.yardC, st, 14),
    deadline: () => left < 300,
    pickTarget: (from) => {
      if (silo?.alive && (world.players[1].lowPower || !yard.length)) return silo;
      return nearestTo(yard, from.x, from.y) ?? (silo?.alive ? silo : nearestTo(enemyThings(world).filter((x) => x.kind === 'building'), from.x, from.y));
    },
  });
  const k = world.getEntity(rt.flags.kestrel) as Unit | undefined;
  if (k?.alive && silo?.alive && world.players[1].lowPower && every(world, s, 'kes', 3) && k.c4Timer <= 0 && k.order.type !== 'enter') attack(world, [k], silo);
  void e;
};

// 7. finale: big economy, push when strong; the silo first, then the nearest base
PILOTS['allied-07'] = (world, rt, s, log) => {
  builder(world, s, ['proc', 'weap', 'apwr', 'proc'], ['e3'], ['2tnk', '2tnk', '2tnk', 'arty']);
  const silo = world.getEntity(rt.flags.silo) as Building | undefined;
  commander(world, rt, s, log, {
    noBrain: true,
    threshold: 14000,
    maxThreshold: 16000, // (a broken wave raises the bar, but not past what the economy can field)
    pickTarget: (from) => (silo?.alive ? silo : nearestTo(enemyThings(world).filter((e) => e.kind === 'building'), from.x, from.y) ?? nearestTo(enemyThings(world), from.x, from.y)),
  });
  // the Chronosphere: drop a medium tank next to the target structure when charged
  if (every(world, s, 'chrono', 5) && rt.superState(0, 'chrono')?.ready) {
    const tank = army(world).find((u) => u.ut.id === '2tnk');
    const t = silo?.alive ? silo : nearestTo(enemyThings(world).filter((e) => e.kind === 'building'), tank?.x ?? 0, tank?.y ?? 0);
    if (tank && t) world.issue({ c: 'superweapon', player: 0, kind: 'chrono', x: t.x + 2, y: t.y + 2, unit: tank.id });
  }
};
