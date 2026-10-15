import type { MissionDef } from '../sim/mission';

/** Endless survival: escalating waves from the map edges. Score = waves survived and kills. */
export const SURVIVAL: MissionDef = {
  id: 'survival',
  campaign: 'special',
  index: 1,
  title: 'Last Stand',
  codename: 'LAST STAND',
  location: 'Unknown Sector',
  briefing: ['Hold the line for as long as you can. Every wave is stronger than the last.'],
  map: { size: 72, seed: 4242, players: 2, water: 0.3, trees: 0.6, ore: 0.9, climate: 'temperate', hour: 15, dayCycle: true, weather: 'auto' },
  players: [
    { name: 'Commander', faction: 'allies', color: 0x3d7be0 },
    { name: 'The Horde', faction: 'soviet', color: 0xd23a2c, ai: 'passive' },
  ],
  startUnits: 'light',
  credits: 8000,
  scored: true,
  setup(m) {
    m.objective('survive', 'Survive the waves');
    m.flags.wave = 0;
    m.startTimer('wave', 120, 'First wave');
  },
  update(m) {
    if (m.timerDone('wave')) {
      const n = ++m.flags.wave;
      const f = m.player(1).faction;
      const inf = f === 'soviet' ? ['e1', 'e2', 'e3', 'e4', 'dog'] : ['e1', 'e3', 'e1'];
      const veh = f === 'soviet' ? ['3tnk', 'v2rl', '3tnk', '4tnk'] : ['1tnk', '2tnk', 'jeep', 'arty'];
      const types: string[] = [];
      for (let k = 0; k < 3 + n * 2; k++) types.push(inf[m.world.rng.int(0, inf.length - 1)]);
      for (let k = 0; k < Math.floor(n * 0.8); k++) types.push(veh[Math.min(veh.length - 1, m.world.rng.int(0, Math.min(veh.length - 1, Math.floor(n / 3))))]);
      const sides = ['n', 's', 'e', 'w'] as const;
      const side = sides[m.world.rng.int(0, 3)];
      const s = m.start(0);
      const from = m.edgePoint(side, side === 'n' || side === 's' ? m.world.rng.range(8, m.mapW - 8) : m.world.rng.range(8, m.mapH - 8));
      m.reinforce(1, types, from, [s.x, s.y], true);
      m.say('Intelligence', `Wave ${n} incoming from the ${{ n: 'north', s: 'south', e: 'east', w: 'west' }[side]}!`, 'intel');
      m.addScore('Score', 100 * n);
      m.progress('survive', `Wave ${n}`);
      m.startTimer('wave', Math.max(45, 100 - n * 4), `Wave ${n + 1}`);
    }
    // keep stragglers moving at the base
    if (m.every(20, 'push')) {
      const idle = m.units(1).filter((u) => u.order.type === 'idle');
      const s = m.start(0);
      if (idle.length) m.move(idle, s.x, s.y, true);
    }
    if (m.every(1, 'kills')) {
      const kills = m.human.stats.unitsKilled;
      if (kills !== m.flags.lastKills) {
        m.addScore('Score', (kills - (m.flags.lastKills ?? 0)) * 10);
        m.flags.lastKills = kills;
      }
    }
  },
};

export const SPECIAL_MISSIONS: MissionDef[] = [SURVIVAL];
