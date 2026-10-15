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
