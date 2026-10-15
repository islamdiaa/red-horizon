import type { MissionDef } from '../sim/mission';

export const SOVIET_MISSIONS: MissionDef[] = [
  {
    id: 'soviet-01',
    campaign: 'soviet',
    index: 1,
    title: 'Iron Fist',
    codename: 'IRON FIST',
    location: 'Thuringian Gap',
    date: 'March 1953 · 22:15',
    briefing: [
      'Comrade General, the imperialists have built a radar station overlooking the Thuringian Gap. It sees every column we send west.',
      'You command a strike group of heavy armour. There is no time to build a base — strike fast, strike hard.',
      'Destroy the radar dome and every Allied soldier guarding it. Do not let the V2 battery fall: it is our only artillery.',
    ],
    tips: ['Use the V2 rocket launcher to outrange the pillboxes.', 'Heavy tanks crush infantry — drive over them.', 'Select all with Ctrl+A, attack-move with A.'],
    map: { size: 64, seed: 7303, players: 2, water: 0.3, trees: 0.7, ore: 0.4, climate: 'winter', hour: 22.2, dayCycle: false, weather: 'snow' },
    players: [
      { name: 'Red Army Group Vostok', faction: 'soviet', color: 0xd23a2c },
      { name: 'Allied Garrison', faction: 'allies', color: 0x3d7be0, ai: 'passive' },
    ],
    credits: 0,
    parTime: 480,
    allowedBuild: [],
    setup(m) {
      const s = m.start(0), e = m.start(1);
      const toward = Math.atan2(e.y - s.y, e.x - s.x);
      m.spawnGroup(0, ['3tnk', '3tnk', '3tnk'], s.x, s.y, toward);
      m.spawnGroup(0, ['e1', 'e1', 'e1', 'e1', 'e2', 'e2', 'e3'], s.x - Math.cos(toward) * 2, s.y - Math.sin(toward) * 2, toward);
      const v2 = m.spawnUnit(0, 'v2rl', s.x - Math.cos(toward) * 4, s.y - Math.sin(toward) * 4, toward);
      m.flags.v2 = v2.id;
      const back = Math.atan2(s.y - e.y, s.x - e.x);
      const dome = m.placeNear(1, 'dome', e.x, e.y);
      m.flags.dome = dome?.id;
      m.placeNear(1, 'powr', e.x - 3, e.y - 2);
      m.placeNear(1, 'tent', e.x + 3, e.y + 1);
      m.placeNear(1, 'pbox', e.x + Math.cos(back) * 5, e.y + Math.sin(back) * 5);
      m.placeNear(1, 'pbox', e.x + Math.cos(back + 0.7) * 5, e.y + Math.sin(back + 0.7) * 5);
      m.placeNear(1, 'gun', e.x + Math.cos(back - 0.7) * 5, e.y + Math.sin(back - 0.7) * 5);
      m.spawnGroup(1, ['e1', 'e1', 'e1', 'e3', 'e3', '1tnk', 'jeep'], e.x + Math.cos(back) * 3, e.y + Math.sin(back) * 3, back);
      m.reveal(0, e.x, e.y, 4);
      m.objective('dome', 'Destroy the Allied radar dome');
      m.objective('clear', 'Eliminate the Allied garrison');
      m.objective('v2', 'Keep the V2 rocket launcher alive', false);
    },
    update(m) {
      if (m.after(2, 'hello')) m.say('General Volkov', 'The snow will hide our approach. Move out, Comrade.', 'enemy');
      if (!m.isDone('dome') && !m.alive(m.flags.dome)) {
        m.complete('dome');
        m.say('General Volkov', 'Their eyes are blind! Now finish them.', 'enemy');
      }
      if (!m.alive(m.flags.v2)) m.fail('v2');
      if (m.after(200, 'reinforce')) {
        const e = m.start(1);
        m.reinforce(1, ['1tnk', '1tnk', 'jeep', 'e3'], m.edgePoint(e.y < m.mapH / 2 ? 'n' : 's', e.x), [m.start(0).x, m.start(0).y], true);
        m.say('Intelligence', 'Allied armour approaching from the flank!', 'intel');
      }
      const left = m.enemiesRemaining(0);
      m.progress('clear', `${left} left`);
      if (m.isDone('dome') && left === 0 && m.once('won')) {
        m.complete('clear');
        m.win();
      }
    },
  },
];
