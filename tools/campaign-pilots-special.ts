// Autopilot for the Boot Camp tutorial: performs each drill the way a new player would.
import { PILOTS, army, attack, attackMove, builder, every, moveTo, nearestTo, enemyThings } from './campaign-pilots';

PILOTS['bootcamp'] = (world, rt, s) => {
  const step = rt.flags.step as string;
  const a = army(world);
  switch (step) {
    case 'move':
      if (every(world, s, 'move', 4)) moveTo(world, a, rt.flags.bx, rt.flags.by);
      break;
    case 'fight': {
      const scouts = rt.livingUnits(rt.flags.scouts);
      if (scouts.length && every(world, s, 'fight', 3)) attack(world, a, scouts[0]);
      break;
    }
    case 'defend': {
      const raid = rt.livingUnits(rt.flags.raid);
      if (raid.length && every(world, s, 'defend', 3)) attackMove(world, a, raid[0].x, raid[0].y);
      break;
    }
    case 'assault': {
      if (every(world, s, 'assault', 15) && a.length >= 8) {
        const t = nearestTo(enemyThings(world), a[0].x, a[0].y);
        if (t) attackMove(world, a, t.x, t.y);
      }
      break;
    }
  }
  if (step !== 'move' && step !== 'fight') builder(world, s, ['powr', 'proc', 'tent', 'pbox', 'weap', 'powr'], ['e1', 'e1', 'e3'], ['1tnk', '2tnk']);
};

// Wolfpack: keep the submarines on the transports, replace losses at the sub pen.
PILOTS['wolfpack'] = (world, rt, s) => {
  const p = world.players[0];
  const subs = world.units.filter((u) => u.alive && u.owner === p && u.ut.id === 'ss');
  const transports = world.units.filter((u) => u.alive && u.owner.id === 1 && u.ut.id === 'lst');
  if (every(world, s, 'hunt', 3)) {
    for (const sub of subs) {
      if (sub.order.type === 'attack' && world.getEntity((sub.order as any).target)?.alive) continue;
      // ambush on the convoy route (mid-sea), strike transports that come within reach
      const t = nearestTo(transports, sub.x, sub.y);
      if (t && Math.hypot(t.x - sub.x, t.y - sub.y) < (process.env.REACH ? +process.env.REACH : 14)) attack(world, [sub], t);
      else {
        // follow the beacon: wait on the lane the current convoy group is taking
        const lx = rt.flags.laneX ?? rt.flags.midX, ly = rt.flags.laneY ?? rt.flags.midY;
        if (Math.hypot(sub.x - lx, sub.y - ly) > 4) moveTo(world, [sub], lx, ly);
      }
    }
  }
  if (every(world, s, 'build', 2) && p.canBuild('ss') && !p.queues.naval.items.length && p.credits > 1100) world.issue({ c: 'build', player: 0, type: 'ss' });
};

// Iron Coast: the cruiser shells the objectives in order while destroyers and gunboats screen it.
PILOTS['ironcoast'] = (world, rt, s) => {
  const p = world.players[0], foe = world.players[1];
  const ships = world.units.filter((u) => u.alive && u.owner === p && u.kind === 'naval');
  const cruisers = ships.filter((u) => u.ut.id === 'ca');
  const escorts = ships.filter((u) => u.ut.id !== 'ca');
  const target = ['pen', 'afld', 'fact'].map((k) => world.getEntity(rt.flags[k])).find((e) => e?.alive);
  if (every(world, s, 'fleet', 3)) {
    if (target) for (const ca of cruisers) if (ca.order.type !== 'attack') attack(world, [ca], target);
    const lead = cruisers[0] ?? null;
    const subs = world.units.filter((u) => u.alive && u.owner === foe && (u.ut.id === 'ss' || u.kind === 'aircraft') && world.canSee(p, u));
    for (const e of escorts) {
      const t = nearestTo(subs, e.x, e.y);
      if (t && Math.hypot(t.x - e.x, t.y - e.y) < 12) { if (e.order.type !== 'attack') attack(world, [e], t); }
      else if (lead && Math.hypot(e.x - lead.x, e.y - lead.y) > 4) attackMove(world, [e], lead.x + (e.id % 3) - 1, lead.y + ((e.id >> 1) % 3) - 1);
    }
  }
  if (every(world, s, 'build', 2) && !p.queues.naval.items.length) {
    const want = cruisers.length < 1 && p.canBuild('ca') ? 'ca' : escorts.length < 6 && p.canBuild('dd') ? 'dd' : null;
    if (want && p.credits > (want === 'ca' ? 2100 : 1100)) world.issue({ c: 'build', player: 0, type: want });
  }
};
