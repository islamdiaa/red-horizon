// Allied campaign autopilots (registered into PILOTS).
import type { Building, Unit } from '../src/sim/entities';
import { ground } from '../src/missions/common';
import { PILOTS, army, attack, attackMove, brain, builder, commander, enemyThings, every, genericPilot, moveTo, nearestTo } from './campaign-pilots';

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

// 4. escort: board the APCs, tanks lead, APCs follow behind
PILOTS['allied-04'] = (world, rt, s, log) => {
  if (!every(world, s, 'tick', 1.5)) return;
  const team = rt.livingUnits(rt.flags.team);
  const apcs = rt.livingUnits(rt.flags.apcs);
  if (!s.boarded) {
    team.forEach((u, i) => {
      if (u.transport || u.order.type === 'enter') return;
      const apc = apcs[i === 0 ? 0 : Math.min(1, apcs.length - 1)] ?? apcs[0];
      if (apc) world.issue({ c: 'enter', player: 0, units: [u.id], target: apc.id });
    });
    if (team.every((u) => u.transport)) { s.boarded = true; log('pilot: boarded'); }
    // hold position near the station until boarded, but fight paratroopers
    const st = rt.start(0);
    const threats = enemyUnitsNear(world, st.x, st.y, 14);
    if (threats.length) attackMove(world, army(world).filter((u) => !u.ut.passengers), threats[0].x, threats[0].y);
    return;
  }
  const lz = rt.flags.lz as [number, number];
  const esc = army(world).filter((u) => !u.ut.passengers);
  const veh = esc.filter((u) => u.kind === 'vehicle');
  const lead = veh.length ? cen(veh) : esc.length ? cen(esc) : cen(apcs);
  const threats = enemyThings(world).filter((t) => Math.hypot(t.x - lead.x, t.y - lead.y) < 9 && (t.kind !== 'building' || (t as Building).weapons.length));
  const toLz = Math.hypot(lz[0] - lead.x, lz[1] - lead.y);
  if (threats.length && esc.length) {
    const t = nearestTo(threats, lead.x, lead.y)!;
    attackMove(world, esc, t.x, t.y);
    const tc = cen(threats);
    if (rt.flags.betrayed) moveTo(world, apcs, lz[0], lz[1]);
    else for (const apc of apcs) {
      const away = Math.atan2(apc.y - tc.y, apc.x - tc.x);
      if (Math.hypot(apc.x - tc.x, apc.y - tc.y) < 10) moveTo(world, [apc], apc.x + Math.cos(away) * 5, apc.y + Math.sin(away) * 5);
    }
  } else {
    const step = Math.min(8, toLz);
    const nx = lead.x + ((lz[0] - lead.x) / (toLz || 1)) * step, ny = lead.y + ((lz[1] - lead.y) / (toLz || 1)) * step;
    attackMove(world, esc, nx, ny);
    if (toLz < 7 || !esc.length) moveTo(world, apcs, lz[0], lz[1]);
    else moveTo(world, apcs, lead.x, lead.y);
  }
};

// 5. truck hunt: lean base with Longbows, and a hunter group of tanks and helicopters
PILOTS['allied-05'] = (world, rt, s, log) => {
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
  const exposed = harvs.filter((h) => Math.hypot(h.x - e.x, h.y - e.y) > 12 && fts.every((f) => f.distTo(h.x, h.y) > 6));
  const ready = hunters.filter((h) => h.kind !== 'aircraft' || h.ammo > 0);
  const c = ready.length ? cen(ready) : st;
  if (exposed.length && ready.length >= 8) {
    const t = nearestTo(exposed, c.x, c.y)!;
    attack(world, ready, t);
  } else {
    const idle = ready.filter((h) => h.order.type === 'idle' && Math.hypot(h.x - st.x, h.y - st.y) > 8);
    if (idle.length) attackMove(world, idle, st.x + (e.x - st.x) * 0.2, st.y + (e.y - st.y) * 0.2);
  }
  if (every(world, s, 'hlog', 60)) log(`pilot: ${hunters.length} hunters, ${harvs.length} trucks left`);
};

// 6. silo: build up, hit the generator yard (coils go dark, countdown crawls), then the silo; Kestrel C4s it
PILOTS['allied-06'] = (world, rt, s, log) => {
  const silo = world.getEntity(rt.flags.silo) as Building | undefined;
  const left = rt.timeLeft('launch') ?? 999;
  const e = rt.start(1), st = rt.start(0);
  const yard = rt.living(rt.flags.yard) as Building[];
  s.yardC ??= cen(yard);
  builder(world, s, ['powr', 'tent', 'proc', 'weap', 'powr', 'gun', 'proc', 'pbox', 'dome', 'gun', 'powr', 'weap', 'fix'], ['e1', 'e3', 'e3'], ['2tnk', '2tnk', '2tnk', 'arty']);
  commander(world, rt, s, log, {
    noBrain: true,
    threshold: 11000,
    rally: rt.toward(s.yardC, st, 14),
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
  builder(world, s, ['proc', 'weap', 'apwr'], ['e3'], ['2tnk', '2tnk', '2tnk', 'arty']);
  const silo = world.getEntity(rt.flags.silo) as Building | undefined;
  commander(world, rt, s, log, {
    noBrain: true,
    threshold: 10000,
    pickTarget: (from) => (silo?.alive ? silo : nearestTo(enemyThings(world).filter((e) => e.kind === 'building'), from.x, from.y) ?? nearestTo(enemyThings(world), from.x, from.y)),
  });
  // the Chronosphere: drop a medium tank next to the target structure when charged
  if (every(world, s, 'chrono', 5) && rt.superState(0, 'chrono')?.ready) {
    const tank = army(world).find((u) => u.ut.id === '2tnk');
    const t = silo?.alive ? silo : nearestTo(enemyThings(world).filter((e) => e.kind === 'building'), tank?.x ?? 0, tank?.y ?? 0);
    if (tank && t) world.issue({ c: 'superweapon', player: 0, kind: 'chrono', x: t.x + 2, y: t.y + 2, unit: tank.id });
  }
};
