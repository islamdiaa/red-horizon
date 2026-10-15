import type { MissionDef } from '../sim/mission';

export const ALLIED_MISSIONS: MissionDef[] = [
  {
    id: 'allied-01',
    campaign: 'allies',
    index: 1,
    title: 'First Light',
    codename: 'FIRST LIGHT',
    location: 'Vistula Basin',
    date: 'April 1953 · 05:40',
    briefing: [
      'Commander, Soviet forces have crossed the Vistula and dug in a forward outpost on the eastern bank.',
      'Land your Mobile Construction Vehicle, establish a base and secure the ore fields before their main force arrives.',
      'Once your base is operational, destroy the Soviet outpost. Expect light resistance — and flame towers.',
    ],
    tips: ['Deploy the MCV with D or by clicking it again.', 'An Ore Refinery comes with a free Ore Truck.', 'Rocket soldiers are effective against tanks.'],
    map: { size: 80, seed: 9101, players: 2, water: 0.4, trees: 0.6, ore: 0.7, climate: 'temperate', hour: 6.1, dayCycle: true, weather: 'clear' },
    players: [
      { name: 'Allied Expeditionary Force', faction: 'allies', color: 0x3d7be0 },
      { name: 'Soviet Forward Command', faction: 'soviet', color: 0xd23a2c, ai: 'defensive', credits: 3000 },
    ],
    credits: 6000,
    parTime: 900,
    setup(m) {
      const s = m.start(0), e = m.start(1);
      const toward = Math.atan2(e.y - s.y, e.x - s.x);
      m.spawnGroup(0, ['mcv'], s.x, s.y, toward);
      m.spawnGroup(0, ['1tnk', '1tnk', 'jeep'], s.x + Math.cos(toward) * 3, s.y + Math.sin(toward) * 3, toward);
      m.spawnGroup(0, ['e1', 'e1', 'e1', 'e3', 'e3', 'e6'], s.x + Math.cos(toward + 1.2) * 3, s.y + Math.sin(toward + 1.2) * 3, toward);
      // Soviet outpost
      m.placeNear(1, 'barr', e.x, e.y);
      m.placeNear(1, 'powr', e.x - 3, e.y + 1);
      m.placeNear(1, 'powr', e.x + 3, e.y - 1);
      const back = Math.atan2(s.y - e.y, s.x - e.x);
      m.placeNear(1, 'ftur', e.x + Math.cos(back) * 5, e.y + Math.sin(back) * 5);
      m.placeNear(1, 'ftur', e.x + Math.cos(back + 0.6) * 5, e.y + Math.sin(back + 0.6) * 5);
      m.spawnGroup(1, ['3tnk', 'e1', 'e1', 'e2', 'e2', 'dog'], e.x + Math.cos(back) * 3, e.y + Math.sin(back) * 3, back);
      m.objective('deploy', 'Deploy the MCV to establish a base');
      m.objective('refinery', 'Build an Ore Refinery');
      m.objective('outpost', 'Destroy the Soviet forward outpost');
      m.objective('capture', 'Capture the Soviet barracks with an Engineer', false);
      m.flags.barracks = m.buildings(1, 'barr')[0]?.id;
    },
    update(m) {
      if (m.after(2, 'hello')) m.say('Field Marshal Bradley', 'Commander, you have the field. Get that MCV deployed — the clock is ticking.', 'commander');
      if (!m.isDone('deploy') && m.buildings(0, 'fact').length) {
        m.complete('deploy');
        m.say('Field Marshal Bradley', 'Base established. Build power, then an ore refinery. We need that ore.', 'commander');
      }
      if (!m.isDone('refinery') && m.buildings(0, 'proc').length) {
        m.complete('refinery');
        m.say('Intelligence', 'Recon confirms a Soviet outpost to the east. Flame towers guard the approach — use artillery or rockets.', 'intel');
        m.reveal(0, m.start(1).x, m.start(1).y, 6);
      }
      const b = m.flags.barracks;
      if (b && m.world.getEntity(b)?.owner === m.human) m.complete('capture');
      // a probing raid after a few minutes
      if (m.after(240, 'raid')) {
        const e = m.start(1), s = m.start(0);
        m.reinforce(1, ['e1', 'e1', 'e2', '3tnk'], [e.x, e.y], [s.x, s.y], true);
        m.say('Intelligence', 'Soviet raiding party inbound. Defend the base!', 'intel');
      }
      const outpost = m.buildings(1).filter((x) => !x.bt.wall);
      m.progress('outpost', `${outpost.length} left`);
      if (!outpost.length && m.once('won')) {
        m.complete('outpost');
        m.say('Field Marshal Bradley', 'Outstanding work, Commander. The basin is ours.', 'commander');
        m.win();
      }
    },
  },
];
