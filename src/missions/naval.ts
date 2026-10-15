/**
 * Naval special operations. They run on sea maps (water >= 0.9: a central sea with a bay towards each
 * start) and showcase the fleets: submarines, destroyers, transports and shore bombardment.
 */
import type { MissionDef, MissionRuntime } from '../sim/mission';
import type { Unit } from '../sim/entities';
import { BUILDINGS } from '../data/rules';
import { CAST, ids, layout, say, type Speaker } from './common';

const ALLIED_BLUE = 0x3d7be0;
const SOVIET_RED = 0xd23a2c;
const ADMIRAL: Speaker = { name: 'Admiral Volkov', portrait: 'enemy' };
const CONVOY_CMD: Speaker = { name: 'Convoy Commodore', portrait: 'commander' };

/** Nearest spot to (x, y) where a water structure fits: footprint and launch lane all open water. */
function waterSpot(m: MissionRuntime, type: string, x: number, y: number, maxR = 20): [number, number] | null {
  const map = m.world.map;
  const [w, h] = BUILDINGS[type].size;
  let best: [number, number] | null = null, bd = Infinity;
  for (let cy = Math.floor(y - maxR); cy <= y + maxR; cy++) for (let cx = Math.floor(x - maxR); cx <= x + maxR; cx++) {
    let ok = true, lane = 0;
    for (let dy = -1; dy <= h && ok; dy++) for (let dx = -1; dx <= w; dx++) {
      const px = cx + dx, py = cy + dy;
      const inner = dx >= 0 && dy >= 0 && dx < w && dy < h;
      const wet = map.inBounds(px, py) && map.navalPassable(px, py) && !map.occupant[map.idx(px, py)];
      if (inner && !wet) { ok = false; break; }
      if (!inner && wet) lane++;
    }
    if (!ok || lane < 4) continue;
    const d = Math.hypot(cx + w / 2 - x, cy + h / 2 - y);
    if (d < bd) { bd = d; best = [cx, cy]; }
  }
  return best;
}

/** Navigable water cell nearest to (x, y). */
function waterNear(m: MissionRuntime, x: number, y: number): [number, number] {
  const map = m.world.map;
  for (let r = 0; r < 30; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const cx = Math.floor(x) + dx, cy = Math.floor(y) + dy;
    if (map.inBounds(cx, cy) && map.navalPassable(cx, cy)) return [cx + 0.5, cy + 0.5];
  }
  return [x, y];
}

// =====================================================================================================
// WOLFPACK: Soviet submarines against an Arctic convoy
// =====================================================================================================
const WAVES: string[][] = [
  ['lst', 'lst', 'lst', 'pt'],
  ['lst', 'lst', 'lst', 'pt', 'pt'],
  ['lst', 'lst', 'lst', 'dd'],
  ['lst', 'lst', 'lst', 'pt', 'dd'],
  ['lst', 'lst', 'lst', 'dd', 'dd'],
  ['lst', 'lst', 'lst', 'dd', 'dd', 'pt'],
];
const WAVE_GAP = 95;
const SINK_GOAL = 12;
const LEAK_LIMIT = 5;
const DOCK_SECONDS = 25;
/** Convoys sail at a laden pace (cells/s) so the flotilla can intercept them. */
const CONVOY_SPEED = 1.15;

export const WOLFPACK: MissionDef = {
  id: 'wolfpack',
  campaign: 'special',
  index: 5,
  title: 'Wolfpack',
  codename: 'WOLFPACK',
  location: 'Barents Sea',
  date: 'December 1953 · 18:40',
  briefing: [
    'An Allied convoy is running the Arctic route to the fortified port across the bay: eighteen transports loaded with tanks for the northern front, in six groups.',
    'You command the Northern Fleet\'s submarine flotilla. Submerged, your boats are invisible; they surface for a moment to fire torpedoes. Destroyers and gunboats carry sonar and depth charges: keep your distance from them.',
    'Sink twelve transports. A transport needs twenty-five seconds at the docks to unload; if five manage it, the northern front collapses.',
  ],
  tips: [
    'Submarines only hit ships. Pick off the transports (the boxy LSTs) and avoid the escorts.',
    'Your Sub Pen builds more boats and repairs damaged ones moored alongside it.',
    'Ships detect submarines within about two and a half cells. Attack from range.',
  ],
  // four bays: yours, the Allied port, and two empty ones the convoy groups come in from
  map: { size: 96, seed: 8081, players: 4, water: 0.95, trees: 0.5, ore: 0.6, climate: 'winter', hour: 18.6, dayCycle: false, weather: 'snow' },
  players: [
    { name: 'Northern Fleet', faction: 'soviet', color: SOVIET_RED },
    { name: 'Allied Convoy Command', faction: 'allies', color: ALLIED_BLUE, ai: 'defensive', credits: 3000 },
  ],
  credits: 3500,
  parTime: 540,
  allowedBuild: ['powr', 'apwr', 'spen', 'ss', 'silo', 'sam', 'barr', 'e1', 'e3'],
  debrief: {
    speaker: ADMIRAL.name, portrait: ADMIRAL.portrait,
    win: 'The convoy is on the seabed and the northern front holds. Drinks are on the flotilla tonight, Captain.',
    lose: 'Too many got through. The tanks are already rolling off the docks. We will pay for this on land.',
  },
  setup(m) {
    const s = m.start(0), e = m.start(1);
    // home base: a sub pen in the bay plus power and an ore economy
    layout(m, 0, s, e, [['fact', -2, 0], ['powr', -1, 4], ['powr', -1, -4], ['proc', -5, 3]]);
    const pen = waterSpot(m, 'spen', s.x + (e.x - s.x) * 0.15, s.y + (e.y - s.y) * 0.15);
    if (pen) {
      const b = m.placeBuilding(0, 'spen', pen[0], pen[1]);
      m.flags.pen = b?.id;
      const subs = m.spawnGroup(0, ['ss', 'ss', 'ss', 'ss'], pen[0] + 1.5, pen[1] + 1.5);
      m.flags.subs = ids(subs);
    }
    // the Allied port: shipyard, defences and a destroyer screen
    layout(m, 1, e, s, [['fact', -2, 0], ['powr', -1, 4], ['powr', -1, -4], ['dome', -5, 0], ['gun', 3, 3], ['gun', 3, -3], ['agun', 1, 6]]);
    const yard = waterSpot(m, 'syrd', e.x + (s.x - e.x) * 0.15, e.y + (s.y - e.y) * 0.15);
    if (yard) {
      const b = m.placeBuilding(1, 'syrd', yard[0], yard[1]);
      m.flags.yard = b?.id;
      m.flags.portX = yard[0] + 1.5;
      m.flags.portY = yard[1] + 1.5;
      m.spawnGroup(1, ['dd', 'pt'], yard[0] + 1.5, yard[1] + 1.5);
    } else {
      m.flags.portX = e.x;
      m.flags.portY = e.y;
    }
    // convoy groups enter from the two empty bays and sail through mid-sea to the port
    const c = { x: m.mapW / 2, y: m.mapH / 2 };
    m.flags.origins = [2, 3].map((k) => {
      const b = m.start(k);
      return waterNear(m, b.x + (c.x - b.x) * 0.25, b.y + (c.y - b.y) * 0.25);
    });
    const mid = waterNear(m, c.x, c.y);
    m.flags.midX = mid[0];
    m.flags.midY = mid[1];
    // each group takes one of three lanes through the sea: straight through mid-sea, or swinging wide
    const port = { x: m.flags.portX, y: m.flags.portY };
    m.flags.lanes = [0, 13, -13].map((side) => waterNear(m, ...m.toward(c, port, 0, side)));
    m.flags.docking = {};
    m.flags.convoys = [];
    m.flags.sunk = 0;
    m.flags.arrived = 0;
    m.flags.wave = 0;
    m.objective('sink', `Sink ${SINK_GOAL} convoy transports`);
    m.progress('sink', `0 / ${SINK_GOAL}`);
    m.objective('blockade', `Let fewer than ${LEAK_LIMIT} transports reach the port`);
    m.objective('yard', 'Destroy the Allied Shipyard', false);
  },
  update(m) {
    const f = m.flags;
    if (m.after(1, 'hello')) {
      say(m, ADMIRAL, 'Volkov here. Your boats are in the water, Captain. Convoy groups come in from the north-west and south-east bays and cross mid-sea to their port. Lie in wait out there and hit the transports; leave the destroyers alone unless they leave you no choice.');
    }
    if (f.wave === 0 && m.every(3, 'ambush')) m.beacon(f.midX, f.midY);
    // --- convoy waves
    if (f.wave < WAVES.length && m.time >= 75 + f.wave * WAVE_GAP) {
      const types = WAVES[f.wave];
      const [ox, oy] = f.origins[f.wave % 2];
      const units = m.spawnGroup(1, types, ox, oy);
      const transports = units.filter((u) => u.type.id === 'lst');
      f.convoys.push(...ids(transports));
      f.escorts = [...(f.escorts ?? []), ...ids(units.filter((u) => u.type.id !== 'lst'))];
      const [lx, ly] = f.lanes[(f.wave * 2 + (f.wave >> 1)) % 3];
      f.laneX = lx;
      f.laneY = ly;
      m.move(units, lx, ly, false);
      m.world.issue({ c: 'move', player: 1, units: ids(units), x: f.portX, y: f.portY, queue: true });
      f.wave++;
      m.reveal(0, ox, oy, 6);
      m.beacon(ox, oy);
      if (f.wave === 1) say(m, CONVOY_CMD, 'Convoy RH-12 to port control: first group through the ice, three hulls, escort in company. Keep the kettle on.');
      else say(m, CAST.eva, `Convoy group ${f.wave} detected entering the bay.`);
      m.beacon(lx, ly);
    }
    // --- transports that reach port deliver their cargo and leave the board
    const alive: number[] = [];
    for (const id of f.convoys as number[]) {
      const u = m.world.getEntity(id) as Unit | undefined;
      if (!u || !u.alive) { f.sunk++; continue; }
      if (Math.hypot(u.x - f.portX, u.y - f.portY) < 6) {
        // docked: it unloads for a while, still in torpedo range
        if (f.docking[id] === undefined) {
          f.docking[id] = m.time;
          say(m, CAST.eva, 'A transport is docking. Sink it before it unloads!');
          m.beacon(u.x, u.y);
        }
        if (m.time - f.docking[id] >= DOCK_SECONDS) {
          m.remove(u);
          f.arrived++;
          say(m, CAST.eva, `A transport has unloaded at the port: ${f.arrived} of ${LEAK_LIMIT - 1} allowed.`);
          continue;
        }
        alive.push(id);
        continue;
      }
      // keep them moving if a fight knocked them off course
      if (u.order.type === 'idle' && m.every(4, 'nudge' + id)) m.move([u], f.portX, f.portY, false);
      alive.push(id);
    }
    f.convoys = alive;
    // keep the group together at convoy pace (escorts break formation to fight)
    for (const u of m.livingUnits([...alive, ...(f.escorts ?? [])])) if (u.order.type === 'move') u.speedCap = CONVOY_SPEED;
    if (m.every(10, 'escorts')) f.escorts = ids(m.livingUnits(f.escorts));
    // escorts break off to hunt any submarine they can see (surfaced to fire, or inside sonar range)
    if (m.every(2, 'escortHunt')) {
      const allies = m.player(1);
      const subs = m.units(0, 'ss').filter((sub) => m.world.canSee(allies, sub));
      for (const esc of m.livingUnits(f.escorts)) {
        const t = m.nearest(subs, esc.x, esc.y);
        if (t && Math.hypot(t.x - esc.x, t.y - esc.y) < 12) { if (esc.order.type !== 'attack') m.attack([esc], t); }
        else if (esc.order.type === 'idle') m.move([esc], f.portX, f.portY, true);
      }
    }
    m.progress('sink', `${Math.min(f.sunk, SINK_GOAL)} / ${SINK_GOAL}`);
    m.progress('blockade', `${f.arrived} reached port`);
    // --- hunter-killer groups sweep towards the sub pen once the Allies know you are there
    if (m.time > 260 && m.every(150, 'hunters')) {
      const yard = m.world.getEntity(f.yard);
      if (yard?.alive) {
        const dd = m.spawnGroup(1, ['dd', 'dd'], f.portX, f.portY);
        const pen = m.world.getEntity(f.pen);
        const tx = pen?.alive ? pen.x : m.start(0).x, ty = pen?.alive ? pen.y : m.start(0).y;
        m.move(dd, tx, ty, true);
        say(m, ADMIRAL, 'Sonar hears a destroyer group leaving their port. They are hunting us. Pull back or meet them deep.');
      }
    }
    if (!m.isDone('yard') && f.yard && !m.world.getEntity(f.yard)?.alive) {
      m.complete('yard');
      say(m, ADMIRAL, 'Their shipyard is burning! No more hunter groups from that harbour.');
    }
    // --- outcome
    if (f.sunk >= SINK_GOAL && !m.isDone('sink')) {
      m.complete('sink');
      m.complete('blockade');
      say(m, ADMIRAL, 'Twelve! The convoy is broken. Bring the boats home.');
      m.win();
      return;
    }
    if (f.arrived >= LEAK_LIMIT) {
      m.fail('blockade');
      m.lose('Too many transports reached the port.');
      return;
    }
    if (f.wave >= WAVES.length && !f.convoys.length && f.sunk < SINK_GOAL) {
      m.fail('sink');
      m.lose('The last convoy group is gone and the blockade fell short.');
      return;
    }
    if (!m.units(0, 'ss').length && !m.buildings(0, 'spen').length) {
      m.lose('The flotilla has been destroyed.');
    }
  },
};

// =====================================================================================================
// IRON COAST: an Allied task force shells a Soviet coastal fortress
// =====================================================================================================
const COMMODORE: Speaker = { name: 'Commodore Ashby', portrait: 'commander' };

export const IRON_COAST: MissionDef = {
  id: 'ironcoast',
  campaign: 'special',
  index: 6,
  title: 'Iron Coast',
  codename: 'TRIDENT',
  location: 'Gulf of Finland',
  date: 'August 1953 · 07:00',
  briefing: [
    'The Soviet fortress across the gulf shelters a submarine pen and an airfield that have closed the sea lanes for a month. Command has given you a task force to open them again.',
    'Your cruiser out-ranges every gun they have: its 8-inch shells reach more than twenty cells. It is also slow, blind to submarines and helpless against aircraft. Keep destroyers close: their sonar finds submarines and their missiles hit planes.',
    'Destroy the Sub Pen, the Airfield and the Construction Yard.',
  ],
  tips: [
    'Destroyers detect submarines within about two and a half cells and kill them with depth charges.',
    'Gunboats are fast and cheap: good pickets and sub hunters.',
    'Damaged ships repair when moored alongside your Shipyard.',
  ],
  map: { size: 88, seed: 5309, players: 2, water: 0.95, trees: 0.55, ore: 0.7, climate: 'temperate', hour: 7.5, dayCycle: true, weather: 'clear' },
  players: [
    { name: 'Allied Task Force', faction: 'allies', color: ALLIED_BLUE },
    { name: 'Baltic Fortress', faction: 'soviet', color: SOVIET_RED, ai: 'defensive', credits: 4000 },
  ],
  credits: 5000,
  parTime: 480,
  allowedBuild: ['powr', 'apwr', 'proc', 'silo', 'syrd', 'pt', 'dd', 'ca', 'agun', 'tent', 'e1', 'e3', 'dome', 'gun'],
  debrief: {
    speaker: COMMODORE.name, portrait: COMMODORE.portrait,
    win: 'The fortress is silent and the lanes are open. The merchantmen sail at dawn. Splendid shooting, Commander.',
    lose: 'We have lost the task force. The gulf stays closed, and the convoys stay in harbour.',
  },
  setup(m) {
    const s = m.start(0), e = m.start(1);
    layout(m, 0, s, e, [['fact', -3, 0], ['powr', -2, 4], ['powr', -2, -4], ['apwr', -6, -7], ['proc', -6, 3], ['atek', -6, -3], ['dome', -1, 7]]);
    const yard = waterSpot(m, 'syrd', s.x + (e.x - s.x) * 0.15, s.y + (e.y - s.y) * 0.15);
    if (yard) {
      m.placeBuilding(0, 'syrd', yard[0], yard[1]);
      const fleet = m.spawnGroup(0, ['ca', 'dd', 'dd', 'pt', 'pt'], yard[0] + 1.5, yard[1] + 1.5);
      m.flags.cruiser = fleet[0]?.id;
    }
    // the fortress: sub pen, airfield, coastal guns and SAMs
    const fort = layout(m, 1, e, s, [['fact', -3, 0], ['powr', -2, 4], ['powr', -2, -4], ['powr', -6, 4], ['afld', -6, -2],
      ['dome', -9, 1], ['barr', 1, 5], ['weap', 1, -5], ['tsla', 4, 2], ['tsla', 4, -2], ['sam', 2, 7], ['sam', 2, -7], ['ftur', 6, 0]]);
    m.flags.fact = fort[0]?.id;
    m.flags.afld = fort[4]?.id;
    const pen = waterSpot(m, 'spen', e.x + (s.x - e.x) * 0.15, e.y + (s.y - e.y) * 0.15);
    if (pen) {
      const b = m.placeBuilding(1, 'spen', pen[0], pen[1]);
      m.flags.pen = b?.id;
      m.spawnGroup(1, ['ss', 'ss', 'ss'], pen[0] + 1.5, pen[1] + 1.5);
    }
    m.spawnGroup(1, ['3tnk', '3tnk', 'e1', 'e1', 'e1', 'e2'], ...m.toward(e, s, 3));
    const mid = waterNear(m, m.mapW / 2, m.mapH / 2);
    m.flags.midX = mid[0];
    m.flags.midY = mid[1];
    m.objective('pen', 'Destroy the Soviet Sub Pen');
    m.objective('afld', 'Destroy the Soviet Airfield');
    m.objective('fact', 'Destroy the Soviet Construction Yard');
    m.objective('cruiser', 'Keep the flagship cruiser afloat', false);
  },
  update(m) {
    const f = m.flags;
    if (m.after(1, 'hello')) {
      say(m, COMMODORE, 'Commodore Ashby, Task Force Trident. The fortress is across the gulf. Bring the cruiser within twenty cells of a target and she will do the rest; just keep the submarines and the MiGs off her.');
    }
    if (m.after(60, 'subs')) say(m, COMMODORE, 'Sonar contacts: submarines in the gulf. Destroyers forward, gunboats on the flanks.');
    // the fortress keeps sending boats and air raids while its sub pen and airfield stand
    if (m.time > 55 && m.every(90, 'packs')) {
      const pen = m.world.getEntity(f.pen);
      if (pen?.alive) {
        const subs = m.spawnGroup(1, m.time > 300 ? ['ss', 'ss', 'ss'] : ['ss', 'ss'], pen.x, pen.y);
        m.move(subs, f.midX, f.midY, true);
      }
    }
    if (m.time > 110 && m.every(100, 'raids')) {
      const af = m.world.getEntity(f.afld);
      const target = m.world.getEntity(f.cruiser) ?? m.nearest(m.army(0, false), af?.x ?? 0, af?.y ?? 0);
      if (af?.alive && target?.alive) {
        const jets = m.spawnGroup(1, ['mig', 'mig', 'mig'], af.x, af.y);
        m.attack(jets, target);
        say(m, CAST.eva, 'Enemy aircraft approaching.');
      }
    }
    for (const key of ['pen', 'afld', 'fact'] as const) {
      if (!m.isDone(key) && f[key] && !m.world.getEntity(f[key])?.alive) {
        m.complete(key);
        say(m, COMMODORE, key === 'pen' ? 'The sub pen is gone. That is the end of their wolfpacks.' : key === 'afld' ? 'Airfield destroyed. No more MiGs over the gulf.' : 'Their construction yard is rubble. They cannot rebuild.');
      }
    }
    const cruiser = m.world.getEntity(f.cruiser);
    if (!cruiser?.alive && f.cruiser && !m.isDone('cruiser') && m.objectives.find((o) => o.id === 'cruiser')?.state === 'active') {
      m.fail('cruiser');
      say(m, COMMODORE, 'The flagship is going down! Build another cruiser at the shipyard; you still need her guns.');
    }
    if (m.isDone('pen') && m.isDone('afld') && m.isDone('fact')) {
      if (cruiser?.alive) m.complete('cruiser');
      m.win();
      return;
    }
    if (!m.army(0, false).length && !m.buildings(0, 'syrd').length) m.lose('The task force has been destroyed.');
  },
};

export const NAVAL_MISSIONS: MissionDef[] = [WOLFPACK, IRON_COAST];
