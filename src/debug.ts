import { BUILDINGS } from './data/rules';
import type { Player } from './sim/player';
import type { World } from './sim/world';

let debugUnderConstruction = false;

/** Debug: start constructing a structure for the player near (x, y) (shows the build animation). */
export function debugConstruct(world: World, p: Player, type: string, x: number, y: number) {
  debugUnderConstruction = true;
  const ok = placeNear(world, p, type, x, y, true);
  debugUnderConstruction = false;
  return ok;
}

/** Place a structure near (x, y) for player p using a spiral search (debug / scenarios). */
function placeNear(world: World, p: Player, type: string, x: number, y: number, needAdjacent: boolean): boolean {
  const bt = BUILDINGS[type];
  for (let r = 0; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cx = Math.round(x - bt.size[0] / 2) + dx, cy = Math.round(y - bt.size[1] / 2) + dy;
      if (needAdjacent ? !world.canPlace(p, type, cx, cy) : !footprintFree(world, type, cx, cy)) continue;
      // keep a walkway around non-defenses
      if (bt.category !== 'defense' && !margin(world, type, cx, cy)) continue;
      const b = world.addBuilding(type, p, cx, cy, !debugUnderConstruction);
      if (debugUnderConstruction) world.events.push({ e: 'placed', id: b.id });
      return true;
    }
  }
  return false;
}

function footprintFree(world: World, type: string, cx: number, cy: number) {
  const bt = BUILDINGS[type];
  for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) if (!world.map.buildable(cx + dx, cy + dy)) return false;
  return true;
}

function margin(world: World, type: string, cx: number, cy: number) {
  const bt = BUILDINGS[type];
  const m = world.map;
  for (let y = cy - 1; y <= cy + bt.size[1]; y++) for (let x = cx - 1; x <= cx + bt.size[0]; x++) {
    if (x >= cx && x < cx + bt.size[0] && y >= cy && y < cy + bt.size[1]) continue;
    if (m.inBounds(x, y) && m.occupant[m.idx(x, y)]) return false;
  }
  return true;
}

const BASES: Record<string, string[]> = {
  // enough power plants for everything to be online (Allies 1000/815, Soviets 1000/900)
  allies: ['fact', 'powr', 'powr', 'proc', 'tent', 'weap', 'dome', 'apwr', 'apwr', 'apwr', 'apwr', 'gun', 'pbox', 'gun', 'atek', 'fix', 'silo', 'hpad', 'agun', 'pdox', 'mslo'],
  soviet: ['fact', 'powr', 'powr', 'proc', 'barr', 'weap', 'dome', 'apwr', 'apwr', 'apwr', 'tsla', 'ftur', 'kenn', 'stek', 'sam', 'tsla', 'afld', 'apwr', 'iron', 'mslo'],
};
const ARMIES: Record<string, string[]> = {
  allies: ['2tnk', '2tnk', '2tnk', '1tnk', '1tnk', 'jeep', 'arty', 'arty', 'apc', 'e1', 'e1', 'e1', 'e1', 'e3', 'e3', 'e3', 'medi', 'e6', 'e7', 'heli', 'heli'],
  soviet: ['3tnk', '3tnk', '3tnk', '4tnk', '4tnk', 'v2rl', 'v2rl', 'e1', 'e1', 'e1', 'e1', 'e2', 'e2', 'e3', 'e4', 'e4', 'dog', 'dog', 'hind', 'mig', 'yak'],
};

/** Debug scenarios: 'base' = developed bases, 'battle' = bases + armies clashing in the middle. */
export function setupScenario(world: World, name: string) {
  const starts = world.map.startPositions;
  world.players.forEach((p, i) => {
    const s = starts[i % starts.length];
    // remove the MCV, build a base instead
    for (const u of world.units) if (u.owner === p && u.ut.deploysInto) { u.alive = false; }
    const list = BASES[p.faction];
    const toward = Math.atan2(world.map.h / 2 - s.y, world.map.w / 2 - s.x);
    list.forEach((t, k) => {
      if (k === 0) placeNear(world, p, t, s.x, s.y, false);
      else {
        const isDef = BUILDINGS[t].category === 'defense';
        const r = isDef ? 7 : 3 + k * 0.25;
        const a = isDef ? toward + (k % 3 - 1) * 0.6 : toward + Math.PI + k * 1.3;
        placeNear(world, p, t, s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, true);
      }
    });
    p.superCharge.nuke = 290;
    p.superCharge.ironcurtain = 235;
    p.superCharge.chrono = 235;
    if (name === 'battle') {
      const mid = { x: world.map.w / 2, y: world.map.h / 2 };
      const ax = s.x + (mid.x - s.x) * 0.62, ay = s.y + (mid.y - s.y) * 0.62;
      ARMIES[p.faction].forEach((t, k) => {
        const [x, y] = world.findFreeSpot(ax + (k % 6) * 0.9 - 2.5, ay + Math.floor(k / 6) * 0.9 - 1, 4);
        const u = world.addUnit(t, p, x, y);
        u.heading = u.prevHeading = u.turret = u.prevTurret = toward;
        if (u.kind === 'aircraft') u.altitude = u.ut.vtol ? 1.55 : 2.3;
      });
    }
  });
  (world as any).dirtyLists = true;
  for (const p of world.players) {
    world.updateVisibility(p);
    for (const o of p.buildOptions()) p.knownOptions.add(o);
  }
}

/** Order every army unit of every player to attack-move to the map centre. */
export function chargeArmies(world: World) {
  const mid = { x: world.map.w / 2, y: world.map.h / 2 };
  for (const p of world.players) {
    const ids = world.units.filter((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
    world.issue({ c: 'move', player: p.id, units: ids, x: mid.x, y: mid.y, attackMove: true });
  }
}
