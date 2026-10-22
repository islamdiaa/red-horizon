/**
 * Soviet campaign: OPERATION RED HORIZON.
 * The same war from the other side of the line. General Arkady Morozov, Commissar Lidiya Orlova of the political
 * directorate, the Tesla engineer Dr. Yakov Belinsky and the dog handler Senior Sergeant Oksana Gromova drive west
 * from the first snow on the border to the Channel coast, while Orlova plays her own game.
 */
import type { MissionDef } from '../sim/mission';
import type { Building, Unit } from '../sim/entities';
import { BUILDINGS, UNITS } from '../data/rules';
import {
  CAST, say, hunt, huntWave, addHunters, structures, layout, squad, edgeNear, ground, ids, entity, centroid, aiProfile,
  quietSetup,
} from './common';

const C = CAST;
const SOVIET_RED = 0xd23a2c;
const ALLIED_BLUE = 0x3d7be0;

// Tech levels (cumulative)
const ST2 = ['powr', 'barr', 'kenn', 'proc', 'silo', 'barb', 'ftur', 'e1', 'e2', 'dog', 'e6', 'e4'];
const ST4 = [...ST2, 'weap', 'harv', '3tnk', 'dome', 'v2rl', 'fix', 'sam', 'e3'];
const ST5 = [...ST4, 'tsla', 'apwr', 'afld', 'yak', 'mig', 'hpad', 'hind', 'brik'];
const ST6 = [...ST5, 'stek', '4tnk'];
const ST7 = [...ST6, 'iron', 'mslo'];

function allExcept(...no: string[]): Set<string> {
  return new Set([...Object.keys(BUILDINGS), ...Object.keys(UNITS)].filter((t) => !no.includes(t)));
}

// Allied voices heard from the other side
const ROURKE_ENEMY = { name: 'Field Marshal Rourke', portrait: 'commander' as const };

// =====================================================================================================
// 1. FIRST SNOW — armoured strike on a border radar post before it raises the alarm
// =====================================================================================================
const FIRST_SNOW: MissionDef = {
  id: 'soviet-01',
  campaign: 'soviet',
  index: 1,
  title: 'First Snow',
  codename: 'FIRST SNOW',
  location: 'Hof Corridor, Bavarian Border',
  date: '13 April 1953 · 23:40',
  briefing: [
    'Comrade, in six hours Operation Red Horizon begins. Forty divisions will cross into the West at dawn, and history will remember the date.',
    'One thing stands in the way: an Allied radar post on the heights above the Hof corridor. It sees every column we move. If it reports what it sees, the West wakes up early.',
    'Your strike group is three heavy tanks, an infantry company and a V2 launcher. No base, no reinforcements. Blind the radar before it can transmit, then wipe out the garrison.',
  ],
  tips: [
    'The radar will transmit its warning when the countdown ends. Destroy the Radar Dome first.',
    'The V2 launcher outranges every Allied gun on the hill, but it is fragile. Keep the tanks in front of it.',
    'Heavy tanks crush infantry. Drive over them.',
  ],
  map: { size: 64, seed: 4804, players: 2, water: 0.3, trees: 0.7, ore: 0.4, climate: 'winter', hour: 23.6, dayCycle: false, weather: 'snow' },
  players: [
    { name: 'Strike Group Vostok', faction: 'soviet', color: SOVIET_RED },
    { name: 'Allied Border Watch', faction: 'allies', color: ALLIED_BLUE, ai: 'passive', credits: 0 },
  ],
  credits: 0,
  parTime: 300,
  allowedBuild: [],
  debrief: {
    speaker: C.morozov.name, portrait: C.morozov.portrait,
    win: 'The West sleeps on. At dawn it will wake to the sound of our engines. You have made a fine first move, Comrade. I like players who open well.',
    lose: 'The radar post still stands and the West is awake. Red Horizon begins with a stumble. Do not make me regret choosing you.',
  },
  setup(m) {
    m.world.cratesEnabled = false;
    const s = m.start(0), e = m.start(1);
    squad(m, 0, ['3tnk', '3tnk', '3tnk'], s, e, 3, 0);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e1', 'e1', 'e2', 'e2', 'e3'], s, e, 1, 3);
    const v2 = squad(m, 0, ['v2rl'], s, e, -0.5, -2.5);
    m.flags.v2 = v2[0].id;
    // (campaign difficulty: on the easy levels one pillbox and a lighter garrison hold the heights)
    const guns: [string, number, number][] = m.eased ? [['pbox', 5.5, 0], ['gun', 4.5, -5]] : [['pbox', 5.5, 2], ['pbox', 5.5, -2], ['gun', 4.5, -5]];
    const [dome] = layout(m, 1, e, s, [['dome', 0, 0], ['powr', -2.5, 3], ['powr', -2.5, -3], ['tent', 2.5, 3.5], ...guns]);
    m.flags.dome = dome?.id;
    const [w1, w2] = [m.toward(e, s, 7.5, -4), m.toward(e, s, 7.5, 4)];
    m.wall(1, 'sbag', Math.round(w1[0]), Math.round(w1[1]), Math.round(w2[0]), Math.round(w2[1]));
    squad(m, 1, m.eased ? ['e1', 'e1', 'e3'] : ['e1', 'e1', 'e1', 'e3', 'e3'], e, s, 3.5, 0);
    squad(m, 1, m.eased ? ['jeep'] : ['1tnk', 'jeep'], e, s, 4, 5);
    squad(m, 1, ['e1', 'e1'], e, s, 1, -5);
    m.reveal(0, e.x, e.y, 4);
    m.objective('dome', 'Destroy the Allied radar dome');
    m.objective('garrison', 'Destroy every Allied structure on the heights');
    m.objective('silence', 'Destroy the radar before it transmits', false);
    m.objective('v2', 'Keep the V2 launcher alive', false);
    m.startTimer('uplink', 330, 'Radar uplink');
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    if (m.after(1, 'hello')) {
      say(m, C.morozov, 'General Morozov. The snow will cover your approach and the radar will not. Take it down before it talks, Comrade.');
      say(m, C.orlova, 'Commissar Orlova, political directorate. I will be observing your conduct tonight. The Party takes an interest in promising officers.');
    }
    if (!m.isDone('dome') && !m.alive(m.flags.dome)) {
      m.complete('dome');
      m.clearTimer('uplink');
      if (m.state('silence') === 'active') m.complete('silence');
      say(m, C.morozov, 'Their eyes are put out! Now finish the garrison. Nobody walks off that hill to tell the tale.');
    }
    if (m.timerDone('uplink') && m.alive(m.flags.dome) && m.once('alarm')) {
      m.fail('silence');
      m.clearTimer('uplink');
      say(m, C.orlova, 'The radar has transmitted. That will be noted, Comrade.');
      say(m, C.morozov, 'Then we fight them awake. Allied armour is coming down the valley road. Meet it.');
      huntWave(m, 1, ['2tnk', '2tnk', '1tnk', '1tnk', 'e3', 'e3', 'e1', 'e1'], edgeNear(m, e.x, e.y + 20), [s.x, s.y]);
    }
    if (m.after(150, 'flank')) {
      huntWave(m, 1, m.eased ? ['jeep', 'e1', 'e1'] : ['jeep', 'jeep', 'e1', 'e1', 'e1'], edgeNear(m, ...m.toward(s, e, 20, 18)), [s.x, s.y]);
      say(m, C.orlova, 'Allied scouts on your flank. Your V2 is exposed, Comrade.');
    }
    hunt(m, 'hunters', 8);
    if (!m.alive(m.flags.v2) && m.state('v2') === 'active') {
      m.fail('v2');
      say(m, C.morozov, 'We have lost the V2. A pity. It was the only one on this sector.');
    }
    const left = structures(m, 1).length;
    m.progress('garrison', `${left} left`);
    if (m.isDone('dome') && left === 0 && m.once('won')) {
      m.complete('garrison');
      if (m.alive(m.flags.v2)) m.complete('v2');
      say(m, C.morozov, 'The heights are ours. In six hours the world changes. Get some sleep, Comrade. You will not get much after that.');
      m.win();
    }
  },
};

// =====================================================================================================
// 2. BRIDGEHEAD — build a base across the Weser, destroy the town garrison; Kestrel pays a visit
// =====================================================================================================
const BRIDGEHEAD: MissionDef = {
  id: 'soviet-02',
  campaign: 'soviet',
  index: 2,
  title: 'Bridgehead',
  codename: 'IRON BRIDGE',
  location: 'Weser Crossing, Lower Saxony',
  date: '20 April 1953 · 08:10',
  briefing: [
    'Red Horizon is a week old and the front is on the Weser. Our engineers have thrown a pontoon bridge across the river; your construction vehicle is the first thing over it.',
    'Build a bridgehead on the west bank, put the ore to work and train an army. An Allied garrison holds the market town to the north-east. When you are ready, remove it.',
    'Intelligence reports an Allied commando operating in the sector. They call her Kestrel. Commissar Orlova would very much like to meet her.',
  ],
  tips: [
    'Build Power, then Barracks and an Ore Refinery. Flame Towers unlock Flamethrowers.',
    'Attack dogs kill infantry with one bite, and they are faster than any commando.',
    'Barbed wire slows attackers down in front of your Flame Towers.',
  ],
  map: { size: 80, seed: 4242, players: 2, water: 0.4, trees: 0.6, ore: 0.7, climate: 'temperate', hour: 8.1, dayCycle: true, weather: 'rain' },
  players: [
    { name: 'Soviet 3rd Shock Army', faction: 'soviet', color: SOVIET_RED },
    { name: 'Allied Weser Garrison', faction: 'allies', color: ALLIED_BLUE, ai: 'defensive', credits: 1200 },
  ],
  credits: 4000,
  parTime: 900,
  allowedBuild: ST2,
  debrief: {
    speaker: C.orlova.name, portrait: C.orlova.portrait,
    win: 'The Weser is ours, and the West has learned your name. So has the Party. I have written a very favourable report, Comrade. Try to deserve it.',
    lose: 'The bridgehead has collapsed into the river. General Morozov will need a new commander for the Weser, and I will need a new report.',
  },
  setup(m) {
    const s = m.start(0), e = m.start(1);
    m.spawnUnit(0, 'mcv', s.x, s.y, Math.atan2(e.y - s.y, e.x - s.x));
    squad(m, 0, ['3tnk', '3tnk'], s, e, 3.5, 0);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e2', 'e2', 'dog', 'dog', 'e6'], s, e, 2, 3.5);
    m.player(1).allowedTypes = new Set(['e1', 'e3', '1tnk', 'jeep']);
    // (campaign difficulty: the easy levels face one pillbox and one turret, a smaller garrison with less money)
    const guns: [string, number, number][] = m.eased ? [['pbox', 7, 0], ['gun', 6.5, 6]] : [['pbox', 7, 2], ['pbox', 7, -2.5], ['gun', 6.5, 6], ['gun', 6.5, -7]];
    layout(m, 1, e, s, [
      ['tent', 1, 3], ['weap', 1, -3.5], ['powr', -3, 1], ['powr', -2.5, -6], ['dome', -3.5, 5.5], ['fix', 4, -8],
      ...guns,
    ]);
    const [w1, w2] = [m.toward(e, s, 9, -3), m.toward(e, s, 9, 3)];
    m.wall(1, 'sbag', Math.round(w1[0]), Math.round(w1[1]), Math.round(w2[0]), Math.round(w2[1]));
    squad(m, 1, m.eased ? ['1tnk', 'jeep'] : ['2tnk', '1tnk', '1tnk', 'jeep'], e, s, 4, 0);
    squad(m, 1, m.eased ? ['e1', 'e1', 'e3'] : ['e1', 'e1', 'e1', 'e1', 'e3', 'e3'], e, s, 5, 4);
    if (m.eased) m.player(1).cash = 300;
    m.objective('deploy', 'Deploy the MCV on the west bank');
    m.objective('army', 'Build a Barracks and an Ore Refinery');
    m.objective('town', 'Destroy the Allied garrison');
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    if (m.after(1, 'hello')) say(m, C.morozov, 'You are across, Comrade. Dig in before they notice. A bridgehead is a promise: keep it.');
    if (!m.isDone('deploy') && m.buildings(0, 'fact').length) {
      m.complete('deploy');
      say(m, C.morozov, 'Good. Power, barracks, refinery. The ore here is rich. Use it.');
    }
    if (!m.isDone('army') && m.buildings(0, 'barr').length && m.buildings(0, 'proc').length) {
      m.complete('army');
      say(m, C.orlova, 'The garrison is in the market town to the north-east: pillboxes, turrets and a tank platoon. Do not underestimate them.');
      m.reveal(0, e.x, e.y, 9);
    }
    // Allied raids from the town
    if (m.after(240, 'raid1')) huntWave(m, 1, m.eased ? ['e1', 'e1'] : ['e1', 'e1', 'e1', 'jeep'], ground(m, ...m.toward(e, s, 10)), [s.x, s.y]);
    if (m.after(480, 'raid2')) {
      huntWave(m, 1, m.eased ? ['1tnk', 'e1', 'e1'] : ['1tnk', '1tnk', 'e1', 'e1', 'e3'], edgeNear(m, ...m.toward(e, s, 20, -22)), [s.x, s.y]);
      say(m, C.orlova, 'Allied tanks moving on your flank.');
    }
    if (m.eased) {
      if (m.time > 900 && m.every(300, 'raidN') && structures(m, 1).length) huntWave(m, 1, ['1tnk', 'e1', 'e1', 'e3'], ground(m, ...m.toward(e, s, 10)), [s.x, s.y]);
    } else if (m.time > 600 && m.every(200, 'raidN') && structures(m, 1).length) huntWave(m, 1, ['2tnk', '1tnk', 'e1', 'e1', 'e3', 'e3'], ground(m, ...m.toward(e, s, 10)), [s.x, s.y]);
    // the easy levels: two more heavy tanks come over the pontoon bridge
    if (m.eased && m.after(360, 'platoon')) {
      m.reinforce(0, ['3tnk', '3tnk'], edgeNear(m, s.x, s.y), m.toward(s, e, 4), false);
      say(m, C.morozov, 'Two more heavy tanks are across the bridge, Comrade. Armour first, infantry behind it: their pillboxes eat riflemen.');
    }
    hunt(m, 'hunters', 10);
    // Kestrel
    const ready = (m.buildings(0).filter((b) => !b.bt.wall).length >= 6 && m.time > 300) || m.time > 480;
    if (ready && !m.flags.kestrel) {
      const pp = m.buildings(0, ['powr', 'proc', 'barr']);
      const target = pp.find((b) => b.bt.id === 'powr') ?? pp[0];
      if (target) {
        const side = m.toward(target, e, 4, 30);
        const from = edgeNear(m, side[0], side[1]);
        const k = m.spawnUnit(1, 'e7', from[0], from[1]);
        const esc = m.spawnGroup(1, ['e1', 'e1'], from[0], from[1]);
        m.attack([k], target);
        m.move(esc, target.x, target.y, true);
        m.flags.kestrel = k.id;
        m.flags.kTarget = target.id;
        m.objective('kestrel', 'Kill the Allied commando Kestrel', false);
        say(m, C.orlova, 'Comrade! The Allied commando is in your sector, heading for your base. The one they call Kestrel. I want her dead.');
        say(m, C.kestrel, 'Morning, Ivan. Nice little base. Shame about the power plant.');
        say(m, C.gromova, 'Senior Sergeant Gromova. Let my dogs have her, Comrade. They have not eaten today.');
        m.spawnGroup(0, ['dog', 'dog', 'dog'], ...ground(m, ...m.toward(s, e, 3, -3)));
      }
    }
    const k = entity<Unit>(m, m.flags.kestrel);
    if (m.flags.kestrel && m.state('kestrel') === 'active') {
      if (!k) {
        m.complete('kestrel');
        m.give(0, 1000);
        say(m, C.gromova, 'The bird is down. Good girls.');
        say(m, C.orlova, 'Excellent. A bounty of one thousand credits has been transferred to your account. The Party pays its debts.');
      } else if (!m.flags.kRun && (!m.alive(m.flags.kTarget) || k.hp < k.maxHp * 0.45)) {
        m.flags.kRun = true;
        const out = edgeNear(m, ...m.toward(k, s, -30));
        m.flags.kOut = out;
        m.move([k], out[0], out[1], false);
        say(m, C.kestrel, k.hp < k.maxHp * 0.45 ? 'Too hot. I am out of here.' : 'Job done. Toodle-oo.');
      } else if (m.flags.kRun) {
        const out = m.flags.kOut as [number, number];
        if (m.dist(k, out) < 2.5) {
          m.remove(k);
          m.fail('kestrel');
          say(m, C.orlova, 'She escaped. That is twice now the Allies have embarrassed this sector. There will not be a third time.');
        } else if (k.order.type !== 'move') m.move([k], out[0], out[1], false);
      }
    }
    const left = structures(m, 1).length;
    m.progress('town', `${left} left`);
    if (!left && m.once('won')) {
      m.complete('town');
      if (m.state('kestrel') === 'active') m.fail('kestrel');
      say(m, C.morozov, 'The town is ours and the bridgehead is secure. Twelve divisions will cross behind you tonight, Comrade.');
      m.win();
    }
  },
};

// =====================================================================================================
// 3. THUNDERHEAD — Tesla raid: seize a power station to wake Belinsky's coil, then hold the ridge
// =====================================================================================================
const THUNDERHEAD: MissionDef = {
  id: 'soviet-03',
  campaign: 'soviet',
  index: 3,
  title: 'Thunderhead',
  codename: 'THUNDERHEAD',
  location: 'Lahn Valley Power Station, Hesse',
  date: '28 April 1953 · 02:30',
  briefing: [
    'Dr. Belinsky of the Horizon Directorate has airdropped a Tesla Coil onto the ridge above the Lahn valley. It is the most dangerous weapon in Europe, and right now it is a very expensive lightning rod: it has no power.',
    'The Allied power station below the ridge does. Senior Sergeant Gromova\'s raiders will escort two engineers down the valley. Capture the station, wake the coil, and hold the ridge until our armour arrives.',
    'The Allies will want their station back. Let them come. That is rather the point.',
  ],
  tips: [
    'The power station has been damaged by Belinsky\'s test strike and its breakers are locked. One engineer will capture it.',
    'A damaged power station makes less power. Repair it (R) to keep the coil fed.',
    'Dogs and flamethrowers shred infantry, but cannot hurt tanks. Let the coil handle armour.',
    'Flames and grenades splash. Keep your dogs and riflemen out of the fire.',
  ],
  map: { size: 64, seed: 6006, players: 2, water: 0.3, trees: 0.8, ore: 0.3, climate: 'temperate', hour: 2.5, dayCycle: false, weather: 'storm' },
  players: [
    { name: 'Gromova Raiders', faction: 'soviet', color: SOVIET_RED },
    { name: 'Allied Valley Command', faction: 'allies', color: ALLIED_BLUE, ai: 'passive', credits: 0 },
  ],
  credits: 0,
  parTime: 600,
  allowedBuild: [],
  debrief: {
    speaker: C.belinsky.name, portrait: C.belinsky.portrait,
    win: 'Did you see it? Did you SEE it? Forty-one confirmed. My coil, Comrade, my beautiful coil. I am going to write a paper. I am going to write ten papers.',
    lose: 'The coil sat dark on the ridge while they took it apart. Six years of my life, Comrade. Six years.',
  },
  setup(m) {
    m.world.cratesEnabled = false;
    const s = m.start(0), e = m.start(1);
    // the raiders
    squad(m, 0, ['dog', 'dog', 'dog', 'dog'], s, e, 3, 1);
    // (campaign difficulty: a raid with no factory feels the enemy's handicap in full; at Hard a second section rides along)
    if (m.level === 'hard') squad(m, 0, ['dog', 'dog', 'e1', 'e1', 'e1'], s, e, 1, 4);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e1', 'e4', 'e4', 'e4', 'e2'], s, e, 1.5, -1);
    const eng = squad(m, 0, ['e6', 'e6'], s, e, 0, 2);
    m.flags.engineers = ids(eng);
    // the power station, halfway down the valley; Belinsky's coil on the ridge above it
    const mid = ground(m, ...m.between(s, e, 0.5, 4), 6);
    const [station] = layout(m, 1, mid, e, [['apwr', 0, 0]]);
    m.setHealth(station, 0.2);
    m.flags.station = station?.id;
    const [coil] = layout(m, 0, mid, s, [['tsla', 8, 2]]);
    m.flags.coil = coil?.id;
    squad(m, 1, ['e1', 'e1', 'e1', 'e3'], mid, s, 3, -3.5);
    // the Allied valley camp
    layout(m, 1, e, s, [['fact', -1, 0], ['tent', 2.5, 3], ['weap', 2, -3.5], ['powr', -3.5, 4], ['powr', -2, -6], ['dome', 1, 7], ['pbox', 7, 1.5], ['pbox', 7, -3], ['gun', 6, 5]]);
    squad(m, 1, ['1tnk', '1tnk', 'e1', 'e1', 'e3'], e, s, 4, 0);
    m.reveal(0, mid[0], mid[1], 5);
    m.objective('capture', 'Capture the power station with an Engineer');
    m.objective('coilAlive', 'Keep Belinsky\'s Tesla Coil standing', false);
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    const station = entity<Building>(m, m.flags.station);
    const coil = entity<Building>(m, m.flags.coil);
    if (m.after(1, 'hello')) {
      say(m, C.gromova, 'Gromova. The rain is on our side tonight: they will not hear the dogs until the dogs are on them.');
      say(m, C.belinsky, 'The station is half a kilometre down the valley. Please do not break it any further. I need every watt.');
    }
    // until it is captured, the station's breakers are tripped and it cannot be wrecked by accident
    if (station && station.owner !== m.human) station.invulnerable = 1;
    if (!station && !m.isDone('hold') && m.once('stationLost')) {
      if (m.isDone('capture')) m.fail('keep'); else m.fail('capture');
      m.lose('The power station has been destroyed.');
      return;
    }
    if (!m.isDone('capture')) {
      if (station && station.owner === m.human) {
        m.complete('capture');
        station.invulnerable = 0;
        m.setHealth(station, 0.5);
        m.give(0, 1200);
        say(m, C.belinsky, 'Rerouting... there! The coil is breathing! It is barely enough. Repair that station, Comrade, and keep them away from it.');
        say(m, C.gromova, 'Here they come. Every Allied soldier in the valley heard that.');
        m.objective('hold', 'Hold the ridge until the armoured column arrives');
        m.objective('keep', 'Do not lose the power station');
        m.startTimer('hold', 300, 'Armoured column');
        m.flags.holdStart = m.time;
      } else if (!m.livingUnits(m.flags.engineers).length) {
        m.fail('capture');
        m.lose('Both engineers are dead. Nobody can take the station.');
        return;
      }
    }
    // the Allied counterattack while holding
    if (m.flags.holdStart && !m.isDone('hold')) {
      const t = m.time - m.flags.holdStart;
      const target = station ?? coil;
      const waves: [number, string[], number][] = m.level === 'hard' ? [
        // (campaign difficulty: at Hard each armoured wave brings one tank fewer, against the enemy's handicap)
        [10, ['e1', 'e1', 'e1', 'e1', 'e3', 'jeep'], 0], [70, ['1tnk', 'e1', 'e1', 'e3', 'e6'], 1], [140, ['jeep', 'jeep', 'e1', 'e1', 'e1', 'e3', 'e3'], 2],
        [200, ['2tnk', 'e1', 'e1', 'e6'], 0], [250, ['1tnk', 'e3', 'e3', 'e1'], 1],
      ] : [
        [10, ['e1', 'e1', 'e1', 'e1', 'e3', 'jeep'], 0], [70, ['1tnk', '1tnk', 'e1', 'e1', 'e3', 'e6'], 1], [140, ['jeep', 'jeep', 'e1', 'e1', 'e1', 'e3', 'e3'], 2],
        [200, ['2tnk', '1tnk', 'e1', 'e1', 'e6'], 0], [250, ['2tnk', '1tnk', 'e3', 'e3', 'e1'], 1],
      ];
      for (const [at, types, side] of waves) {
        if (t >= at && m.once('hold' + at) && target) {
          const from = side === 0 ? ground(m, ...m.toward(e, s, 6)) : edgeNear(m, ...m.toward(target, e, 6, side === 1 ? 22 : -22));
          const units = huntWave(m, 1, types, from, [target.x, target.y]);
          // engineers go for the station
          const eng = units.filter((u) => u.ut.engineer);
          if (eng.length && station) m.attack(eng, station);
        }
      }
      if (t > 75 && m.once('engWarn')) say(m, C.belinsky, 'Allied engineers! If they get inside the station while it is badly damaged, they will take it back. Repair it!');
      if (t > 150 && m.once('second')) {
        const [x, y] = ground(m, ...m.toward(s, e, 4));
        m.spawnGroup(0, ['dog', 'dog', 'dog', 'e4', 'e4', 'e1', 'e1', 'e1', 'e3'], x, y);
        say(m, C.gromova, 'Second section has caught up with us. Fresh dogs, fresh flamers. Now we are a party.');
      }
      if (m.timerDone('hold')) {
        m.complete('hold');
        m.complete('keep');
        m.clearTimer('hold');
        const from = edgeNear(m, s.x, s.y);
        m.reinforce(0, ['4tnk', '4tnk', '3tnk', '3tnk', '3tnk', '3tnk', 'v2rl', 'v2rl', 'e1', 'e1', 'e1', 'e3', 'e3'], from, m.toward(s, e, 12), false);
        say(m, C.morozov, 'The column is here, Comrade, and I have lent you two of the new Mammoth tanks. You have held. Now go down into that valley and finish their camp.');
        say(m, C.belinsky, 'Mammoths! Be gentle with them, they are prototypes.');
        m.objective('camp', 'Destroy the Allied valley camp');
      }
    }
    hunt(m, 'hunters', 6);
    if (station && station.owner !== m.human && m.isDone('capture') && !m.isDone('hold') && m.once('retaken')) {
      m.fail('keep');
      m.lose('The Allies have retaken the power station.');
      return;
    }
    if (m.flags.coil && !coil && m.state('coilAlive') === 'active') {
      m.fail('coilAlive');
      say(m, C.belinsky, 'NO! My coil! Do you have any idea what that cost?');
    }
    if (m.isDone('hold')) {
      const left = structures(m, 1).length;
      m.progress('camp', `${left} left`);
      if (!left && m.once('won')) {
        m.complete('camp');
        if (coil) m.complete('coilAlive');
        say(m, C.gromova, 'Valley is clear. The dogs are tired and so am I.');
        m.win();
      }
    }
  },
};

// =====================================================================================================
// 4. IRON ROAD — escort the MCV through the desert passes, build, destroy the Allied airbase
// =====================================================================================================
const IRON_ROAD: MissionDef = {
  id: 'soviet-04',
  campaign: 'soviet',
  index: 4,
  title: 'Iron Road',
  codename: 'IRON ROAD',
  location: 'Zagros Passes, Persia',
  date: '9 May 1953 · 06:30',
  briefing: [
    'While the West watches the Rhine, Red Horizon opens a southern road. The Persian oil fields feed half the Allied war machine, and an Allied airbase guards them.',
    'Escort a construction vehicle through the Zagros passes to the oasis at the head of the valley, deploy it, and build a base strong enough to wipe out the airbase.',
    'You have heavy armour and your first V2 rockets. The Allies have Longbow helicopters. Keep your rocket soldiers close to the MCV.',
  ],
  tips: [
    'If the MCV is destroyed before it deploys, the mission is lost.',
    'Rocket Soldiers and SAM Sites shoot down helicopters.',
    'V2 rockets wreck structures from long range, but they are fragile up close.',
  ],
  map: { size: 88, seed: 1414, players: 2, water: 0.1, trees: 0.3, ore: 0.8, climate: 'desert', hour: 6.4, dayCycle: true, weather: 'clear' },
  players: [
    { name: 'Southern Front', faction: 'soviet', color: SOVIET_RED },
    { name: 'Allied Persian Command', faction: 'allies', color: ALLIED_BLUE, ai: 'normal', credits: 2000 },
  ],
  credits: 5000,
  parTime: 900,
  allowedBuild: ST4,
  debrief: {
    speaker: C.morozov.name, portrait: C.morozov.portrait,
    win: 'The southern road is open and their oil is ours. The Allies will feel this in every engine they own. Well played, Comrade.',
    lose: 'The convoy burned in the passes. The southern road stays closed, and the Allies keep their oil.',
  },
  setup(m) {
    const s = m.start(0), e = m.start(1);
    const mcv = m.spawnUnit(0, 'mcv', s.x, s.y, Math.atan2(e.y - s.y, e.x - s.x));
    m.flags.mcv = mcv.id;
    squad(m, 0, ['3tnk', '3tnk', '3tnk'], s, e, 3, 0);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e3', 'e3', 'e3', 'dog', 'dog'], s, e, 1, 3);
    // the oasis deployment zone
    const oasis = ground(m, ...m.between(s, e, 0.42, -6), 8);
    m.flags.oasis = oasis;
    // ambushes in the passes
    const a1 = m.between(s, oasis, 0.45, 6), a2 = m.between(s, oasis, 0.8, -5);
    squad(m, 1, m.eased ? ['e1', 'e1', 'e3'] : ['e1', 'e1', 'e3', 'e3', 'jeep'], ground(m, a1[0], a1[1]), s);
    squad(m, 1, m.eased ? ['e1', 'e1', 'e3'] : ['e1', 'e1', 'e1', 'e3', '1tnk'], ground(m, a2[0], a2[1]), s);
    layout(m, 1, ground(m, a2[0], a2[1]), s, [['pbox', 2, 2]]);
    // the airbase (campaign difficulty: on the easy levels its commander plays at Recruit, behind fewer guns)
    aiProfile(m, 1, m.eased ? 'recruit' : 'easy');
    m.player(1).allowedTypes = allExcept('mslo', 'pdox', 'atek', 'e7', 'proc', 'harv', 'arty');
    const ab = layout(m, 1, e, s, [
      ['fact', 0, 0], ['powr', -3.5, 3], ['powr', -3.5, -3], ...(m.eased ? [] : [['powr', -1, 6.5]] as [string, number, number][]), ['tent', 3.5, 3], ['weap', 3.5, -2.5], ['proc', 0, -7.5], ['dome', -3.5, -7.5],
      ['hpad', -0.5, 10], ...(m.eased ? [] : [['hpad', 3, 10.5]] as [string, number, number][]), ...(m.eased ? [['gun', 8, 0], ['agun', 5, -6]] as [string, number, number][] : [['gun', 8, 2], ['gun', 8, -3], ['pbox', 7, 6], ['agun', 5, -6], ['agun', 4, 8]] as [string, number, number][]),
    ]);
    for (const p of ab) if (p?.bt.id === 'proc') m.spawnUnit(1, 'harv', p.x, p.cy + p.h + 1);
    squad(m, 1, m.eased ? ['1tnk', 'jeep', 'e1', 'e1', 'e3'] : ['2tnk', '1tnk', '1tnk', 'jeep', 'e1', 'e1', 'e1', 'e3', 'e3'], e, s, 5, 0);
    if (m.eased) m.player(1).cash = 600;
    m.reveal(0, oasis[0], oasis[1], 5);
    m.objective('escort', 'Escort the MCV to the oasis');
    m.objective('deploy', 'Deploy the MCV');
    m.objective('airbase', 'Destroy the Allied airbase');
    m.objective('fast', 'Reach the oasis within four minutes', false);
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    const mcv = entity<Unit>(m, m.flags.mcv);
    const oasis = m.flags.oasis as [number, number];
    if (m.after(1, 'hello')) {
      say(m, C.morozov, 'The oasis is at the head of the valley, Comrade. The passes are narrow and the Allies know it. Keep that construction vehicle alive.');
      say(m, C.orlova, 'Belinsky\'s equipment is aboard the MCV. Lose it and you will be explaining yourself to me, not to the General.');
    }
    const fact = m.buildings(0, 'fact');
    if (!m.isDone('deploy') && fact.length) {
      m.complete('deploy');
      const near = fact.some((f) => m.dist(f, oasis) < 9);
      if (!m.isDone('escort')) m.complete('escort');
      if (m.state('fast') === 'active') m.complete('fast');
      say(m, C.morozov, near ? 'The base stands at the oasis. Build quickly: the airbase will have seen you.' : 'Not where I asked, but it will do. Build quickly: the airbase will have seen you.');
      m.setAI(1, m.eased ? 'recruit' : 'easy');
    }
    if (!m.isDone('deploy') && !mcv && m.once('mcvLost')) {
      m.fail('escort');
      m.lose('The MCV has been destroyed.');
      return;
    }
    if (!m.isDone('escort') && mcv && m.dist(mcv, oasis) < 5) {
      m.complete('escort');
      if (m.state('fast') === 'active') m.complete('fast');
      say(m, C.morozov, 'You are at the oasis. Deploy.');
    }
    if (m.time > 240 && m.state('fast') === 'active') m.fail('fast');
    // Longbow strike on the convoy
    if (m.after(80, 'longbows') && mcv) {
      const from = edgeNear(m, e.x, e.y);
      const helis = m.spawnGroup(1, ['heli', 'heli'], from[0], from[1]);
      m.attack(helis, mcv);
      say(m, C.orlova, 'Helicopters! Longbows coming for the MCV. Rocket soldiers, Comrade!');
    }
    // keep the airbase passive until the base is down
    if (!m.isDone('deploy') && m.every(5, 'calm')) m.setAI(1, 'defensive');
    if (m.after(600, 'rourke')) say(m, ROURKE_ENEMY, 'To the Soviet commander at the oasis: Field Marshal Rourke. You are a long way from home. I suggest you go back there.');
    hunt(m, 'hunters', 10);
    const left = structures(m, 1).length;
    m.progress('airbase', `${left} left`);
    if (m.isDone('deploy') && !left && m.once('won')) {
      m.complete('airbase');
      say(m, C.morozov, 'The airbase is burning and the road to the Gulf is open. Moscow is very pleased, Comrade. I am merely impressed.');
      m.win();
    }
  },
};

// =====================================================================================================
// 5. STOLEN FIRE — capture the Allied Chronosphere intact (Norway, night, fog)
// =====================================================================================================
const STOLEN_FIRE: MissionDef = {
  id: 'soviet-05',
  campaign: 'soviet',
  index: 5,
  title: 'Stolen Fire',
  codename: 'PROMETHEUS',
  location: 'Hardanger Fjord, Norway',
  date: '24 May 1953 · 01:20',
  briefing: [
    'The Directorate\'s agent in Allied command has delivered the location of Project LOOKING GLASS: a research base on the Hardanger fjord. The Allies have built a machine that moves matter through space. They call it the Chronosphere.',
    'Dr. Belinsky wants it. Intact. Batter the device until it is critical, then send in an engineer before the Allies can scuttle it.',
    'V2 rockets would vaporise it, so Moscow has withdrawn them from your group. Tanks and infantry only, and stop shooting the moment it is critical. Then hold it until Belinsky\'s team can fly in and take it apart.',
  ],
  tips: [
    'Engineers capture structures that are below a quarter of their strength.',
    'Once the Chronosphere is critical its housing locks down: it cannot be destroyed, only captured. Before that, it can.',
    'Tesla Coils and SAM Sites are now available. Air units need an Airfield or Helipad to rearm.',
  ],
  map: { size: 88, seed: 5353, players: 2, water: 0.4, trees: 0.65, ore: 0.7, climate: 'winter', hour: 1.3, dayCycle: false, weather: 'fog' },
  players: [
    { name: 'Northern Fleet Group', faction: 'soviet', color: SOVIET_RED },
    { name: 'Project Looking Glass', faction: 'allies', color: ALLIED_BLUE, ai: 'defensive', credits: 600 },
  ],
  credits: 7000,
  parTime: 1200,
  allowedBuild: ST5.filter((t) => t !== 'v2rl'),
  debrief: {
    speaker: C.belinsky.name, portrait: C.belinsky.portrait,
    win: 'It is beautiful. It is impossible and it is beautiful. Saarinen is a genius and I hate him. Give me a month, Comrade, and the Chronosphere will work for the Party.',
    lose: 'The Chronosphere is lost to us. Somewhere in London, Saarinen is laughing.',
  },
  setup(m) {
    const s = m.start(0), e = m.start(1);
    m.spawnUnit(0, 'mcv', s.x, s.y, Math.atan2(e.y - s.y, e.x - s.x));
    squad(m, 0, ['3tnk', '3tnk', '3tnk', '3tnk', '3tnk', '3tnk', '3tnk'], s, e, 4, 0);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e1', 'e1', 'e2', 'e2', 'e3', 'e3', 'e6', 'e6', 'e6'], s, e, 2, 4);
    aiProfile(m, 1, 'easy', 'defensive');
    // the research base trains infantry; its armour is what you see
    m.player(1).allowedTypes = allExcept('mslo', 'pdox', 'proc', 'harv', '1tnk', '2tnk', 'jeep', 'apc', 'arty', 'heli', 'hpad', 'e7', 'mcv');
    const lg = layout(m, 1, e, s, [
      ['fact', 2, 0], ['pdox', -3, 1], ['atek', -3, -3.5], ['powr', -0.5, 5.5], ['powr', -0.5, -7], ['apwr', -5.5, 6], ['apwr', 2.5, -10], ['apwr', 3, 9],
      ['tent', 5.5, 3], ['weap', 5.5, -3], ['proc', 6, -9], ['dome', -5.5, -7.5],
      ['gun', 10, -1], ['gun', 9, 6], ['pbox', 11, 3], ['agun', 6, 9.5], ['agun', 7, -12],
    ]);
    for (const p of lg) if (p?.bt.id === 'proc') m.spawnUnit(1, 'harv', p.x, p.cy + p.h + 1);
    m.flags.pdox = lg.find((b) => b?.bt.id === 'pdox')?.id;
    squad(m, 1, ['1tnk', '1tnk', '2tnk', 'jeep'], e, s, 7, 0);
    squad(m, 1, ['e1', 'e1', 'e1', 'e1', 'e3', 'e3', 'medi'], e, s, 8, 4);
    const pd = entity<Building>(m, m.flags.pdox);
    if (pd) m.reveal(0, pd.x, pd.y, 3);
    m.objective('capture', 'Capture the Chronosphere with an Engineer');
    m.objective('intact', 'The Chronosphere must not be destroyed');
    m.objective('atek', 'Destroy the Allied Tech Center', false);
    m.objective('kestrel', 'Kill Kestrel before she reaches the Chronosphere', false);
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    const pd = entity<Building>(m, m.flags.pdox);
    if (m.after(1, 'hello')) {
      say(m, C.orlova, 'The Chronosphere is at the back of their base, by the fjord. The Party requires it in one piece, Comrade.');
      say(m, C.belinsky, 'Intact! Critical, but intact! No rockets, I beg you. Not even one.');
    }
    if (!pd && !m.flags.lost) {
      m.flags.lost = true;
      m.fail('intact');
      m.fail('capture');
      m.lose('The Chronosphere has been destroyed.');
      return;
    }
    if (pd && pd.owner !== m.human) {
      // the Allies have evacuated their engineers: no repairs; the housing absorbs light fire at the end
      pd.repairing = false;
      if (pd.healthFrac <= 0.25) pd.invulnerable = 1; // critical: the housing locks down, waiting for an engineer
      if (pd.healthFrac <= 0.25 && m.once('critical')) say(m, C.belinsky, 'It is critical! Cease fire, cease fire! Send in an engineer, quickly!');
    }
    // raids
    for (const [t, types] of [[300, ['1tnk', '1tnk', 'e1', 'e1', 'e3']], [600, ['1tnk', '1tnk', 'jeep', 'e1', 'e1', 'e3', 'e3']]] as [number, string[]][]) {
      if (m.after(t, 'raid' + t) && !m.isDone('capture')) huntWave(m, 1, types, ground(m, ...m.toward(e, s, 12)), [s.x, s.y]);
    }
    hunt(m, 'hunters', 10);
    if (!m.isDone('capture') && pd && pd.owner === m.human) {
      m.complete('capture');
      pd.invulnerable = 0;
      m.setHealth(pd, m.eased ? 1 : 0.7); // (campaign difficulty: on the easy levels Belinsky's team patches it up at once)
      say(m, C.belinsky, 'We have it! We HAVE it! My technicians are patching the housing. Now keep it. My team is four minutes out.');
      say(m, ROURKE_ENEMY, 'All units, this is Rourke. That device does not leave Norway. Retake it or destroy it.');
      m.objective('hold', 'Hold the Chronosphere until Belinsky\'s team arrives');
      m.startTimer('hold', 240, 'Belinsky\'s team');
      m.flags.holdStart = m.time;
    }
    if (m.flags.holdStart) {
      const t = m.time - m.flags.holdStart;
      if (t > 30 && m.once('counter') && pd) {
        // the counterattack comes in from the fjord road
        huntWave(m, 1, m.eased ? ['2tnk', '1tnk', 'e1', 'e1', 'e3'] : ['2tnk', '2tnk', '1tnk', '1tnk', 'e1', 'e1', 'e3', 'e3'], edgeNear(m, ...m.toward(pd, s, 26, 24)), [pd.x, pd.y]);
        say(m, C.orlova, 'Allied armour on the fjord road, heading for the device.');
      }
      if (t > m.byLevel(60, { recruit: 150, easy: 110 }) && m.once('kestrelIn') && pd) {
        const from = edgeNear(m, ...m.toward(pd, s, -14, -12));
        const k = m.spawnUnit(1, 'e7', from[0], from[1]);
        m.attack([k], pd);
        m.flags.kestrel = k.id;
        say(m, C.kestrel, 'Hello again, Ivan. You have something that does not belong to you.');
        say(m, C.gromova, 'The bird is back. Release the dogs!');
        m.spawnGroup(0, ['dog', 'dog', 'dog', 'dog'], ...ground(m, pd.x, pd.y + 2));
      }
      if (t > 140 && m.once('wave2') && pd) huntWave(m, 1, m.eased ? ['2tnk', '2tnk', 'e1', 'e1'] : ['2tnk', '2tnk', '2tnk', 'e1', 'e1', 'e1', 'e3'], edgeNear(m, ...m.toward(pd, s, 26, -24)), [pd.x, pd.y]);
      if (m.flags.kestrel && !m.alive(m.flags.kestrel) && m.state('kestrel') === 'active') {
        m.complete('kestrel');
        say(m, C.gromova, 'Got her! Well... the dogs got her. I will write them up for a medal.');
      }
      if (m.timerDone('hold') && m.once('held')) {
        m.complete('hold');
        m.complete('intact');
        if (m.state('kestrel') === 'active') m.fail('kestrel');
        if (m.state('atek') === 'active' && m.alive(m.flags.atek)) m.fail('atek');
        say(m, C.belinsky, 'We are here, we are here! Oh. Oh, look at it. Careful with that coupling! Comrade, you have changed the war tonight.');
        m.win();
        return;
      }
    }
    if (pd && pd.owner !== m.human && m.isDone('capture') && m.once('lostIt')) {
      m.lose('The Allies have retaken the Chronosphere.');
      return;
    }
    if (!m.flags.atek) m.flags.atek = m.buildings(1, 'atek')[0]?.id ?? -1;
    if (m.flags.atek > 0 && !m.alive(m.flags.atek) && m.state('atek') === 'active') {
      m.complete('atek');
      say(m, C.orlova, 'Their Tech Center is rubble. Whatever else they were building here is lost to them.');
    }
  },
};

// =====================================================================================================
// 6. IRON CURTAIN — defend the device while it charges; Orlova's coup
// =====================================================================================================
const IC_CHARGE = 600;
const IRON_CURTAIN: MissionDef = {
  id: 'soviet-06',
  campaign: 'soviet',
  index: 6,
  title: 'The Iron Curtain',
  codename: 'AEGIS',
  location: 'Ruhr Valley, West Germany',
  date: '14 June 1953 · 19:40',
  briefing: [
    'The Directorate\'s greatest device has reached the front: the Iron Curtain, a field that makes armour invulnerable for a short time. With it, General Morozov will punch through the Rhine defences in a single night.',
    'It needs ten minutes to charge to full strength, and it needs power. The Allies know it is here. They will throw everything they have at your base.',
    'Commissar Orlova\'s NKVD division is camped on your flank to provide security. Keep the device alive and keep the lights on.',
  ],
  tips: [
    'The Iron Curtain only charges while your base has enough power.',
    'Once charged, use it on a group of tanks: they cannot be damaged for a short time.',
    'Tesla Coils, Mammoth Tanks and the Tech Center are now available.',
  ],
  map: { size: 96, seed: 5050, players: 4, water: 0.35, trees: 0.6, ore: 0.8, climate: 'temperate', hour: 19.6, dayCycle: true, weather: 'rain' },
  players: [
    { name: 'Western Front', faction: 'soviet', color: SOVIET_RED },
    { name: 'Allied Rhine Army', faction: 'allies', color: ALLIED_BLUE, ai: 'normal', credits: 2000 },
    { name: 'NKVD Security Division', faction: 'soviet', color: 0x8e4fd0, team: 0, ai: 'defensive', credits: 2000 },
  ],
  credits: 6000,
  parTime: 900,
  allowedBuild: ST6,
  debrief: {
    speaker: C.morozov.name, portrait: C.morozov.portrait,
    win: 'Orlova is finished, the device is ours, and tomorrow the Rhine. I owe you my command, Comrade, and perhaps my life. I do not forget debts.',
    lose: 'The Iron Curtain is gone, and Orlova has what she wanted: chaos. The offensive will not survive this.',
  },
  setup(m) {
    const s = m.start(0), al = m.start(1), nk = m.start(2);
    const center = { x: m.mapW / 2, y: m.mapH / 2 };
    const base = layout(m, 0, s, center, [
      ['fact', 0, 0], ['iron', -5, 1.5], ['apwr', -3, -4], ['apwr', -1, -7.5], ['apwr', -8, -2.5], ['powr', 1, 6.5], ['powr', -2.5, 6],
      ['barr', 3.5, -3], ['weap', 4, 3], ['proc', 1, -11], ['dome', -5, -8], ['stek', -5.5, 7],
      ['tsla', 9, 0], ['tsla', 8, -6], ['ftur', 9, 5], ['ftur', 7.5, -10],
    ]);
    m.flags.iron = base.find((b) => b?.bt.id === 'iron')?.id;
    for (const p of base) if (p?.bt.id === 'proc') for (let k = 0; k < 2; k++) m.spawnUnit(0, 'harv', p.x + k, p.cy + p.h + 1);
    squad(m, 0, ['3tnk', '3tnk', '3tnk', '3tnk', 'v2rl'], s, center, 8, 3);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e2', 'e2', 'e3', 'e3', 'dog', 'dog'], s, center, 6, -3);
    m.setSuperCharge(0, 'ironcurtain', 240 - IC_CHARGE);
    // the Allied Rhine Army
    aiProfile(m, 1, 'easy');
    m.player(1).allowedTypes = allExcept('mslo', 'pdox', 'proc', 'harv', 'e7');
    const ab = layout(m, 1, al, center, [
      ['fact', 0, 0], ['powr', -3.5, 3], ['powr', -3.5, -3], ['powr', -1, 6.5], ['apwr', -1, -7.5], ['tent', 3.5, 3], ['weap', 3.5, -2.5], ['proc', 0, 10.5],
      ['dome', -5, 7], ['hpad', -4.5, -10], ['gun', 8, 2], ['gun', 8, -3], ['pbox', 7, 6], ['agun', 5, -7],
    ]);
    for (const p of ab) if (p?.bt.id === 'proc') m.spawnUnit(1, 'harv', p.x, p.cy + p.h + 1);
    squad(m, 1, ['2tnk', '2tnk', '1tnk', 'arty', 'e1', 'e1', 'e3', 'e3'], al, center, 6, 0);
    // Orlova's NKVD division on the flank
    m.player(2).allowedTypes = allExcept('mslo', 'iron', 'proc', 'harv', '4tnk', 'stek');
    const nb = layout(m, 2, nk, s, [
      ['fact', 0, 0], ['powr', -3, 3], ['powr', -3, -3], ['apwr', -1, 7], ['barr', 3.5, 2.5], ['weap', 3, -3], ['kenn', 5.5, 5], ['dome', -1, -7.5],
      ['tsla', 8, 0], ['tsla', 7, 5.5], ['ftur', 8.5, -4],
      // (campaign difficulty: at Hard and Brutal Orlova has fortified her headquarters further)
      ...(m.tightened ? [['tsla', 7, -6.5], ['ftur', 9, 3]] as [string, number, number][] : []),
    ]);
    m.flags.nkvdStart = nb.filter((b) => !!b).length;
    squad(m, 2, [...['3tnk', '3tnk', '3tnk', 'v2rl', 'e1', 'e1', 'e1', 'e2', 'e2', 'dog', 'dog'], ...(m.tightened ? ['3tnk', '3tnk', 'v2rl'] : [])], nk, s, 6, 0);
    m.objective('protect', 'Protect the Iron Curtain while it charges');
    m.objective('use', 'Use the Iron Curtain on your armour', false);
    m.objective('allies', 'Destroy the Allied Rhine Army base', false);
    m.startTimer('charge', IC_CHARGE, 'Iron Curtain charge');
  },
  update(m) {
    const s = m.start(0), al = m.start(1), nk = m.start(2);
    const iron = entity<Building>(m, m.flags.iron);
    if (m.after(1, 'hello')) {
      say(m, C.morozov, 'The device is in your hands, Comrade. Ten minutes. Keep the power on and keep the Allies off it.');
      say(m, C.belinsky, 'Please do not let anything happen to it. There is only one.');
    }
    if (!iron && m.once('ironLost')) {
      m.fail('protect');
      m.lose('The Iron Curtain has been destroyed.');
      return;
    }
    // sync the countdown with the real charge (pauses on low power)
    const st = m.superState(0, 'ironcurtain');
    if (st && !m.flags.charged) {
      if (m.every(1, 'sync')) m.setTimeLeft('charge', st.left);
      if (m.human.lowPower && m.every(20, 'lowWarn')) say(m, C.belinsky, 'The device is starving! Low power, Comrade. It has stopped charging!');
      if (st.ready) {
        m.flags.charged = true;
        m.clearTimer('charge');
        say(m, C.belinsky, 'The Iron Curtain is charged! Select it and touch it to your tanks. They will be untouchable.');
      }
    }
    if (m.flags.charged && !m.flags.used && st && !st.ready && m.once('used')) {
      m.flags.used = true;
      m.complete('use');
      say(m, C.morozov, 'Look at them. Shells bouncing off like hail. Drive them into the enemy, Comrade!');
    }
    // Allied pressure
    for (const [t, types] of [[75, ['1tnk', 'jeep', 'e1', 'e1', 'e3']], [200, ['2tnk', '2tnk', 'arty', 'e1', 'e1', 'e3']], [400, ['2tnk', '2tnk', '1tnk', 'arty', 'e1', 'e1', 'e1', 'e3']], [540, ['2tnk', '2tnk', '2tnk', 'jeep', 'e3', 'e3', 'e1']]] as [number, string[]][]) {
      // (campaign difficulty: at Hard and Brutal each wave brings one more Medium Tank)
      if (m.after(t, 'wave' + t) && structures(m, 1).length) huntWave(m, 1, m.tightened ? [...types, '2tnk'] : types, edgeNear(m, ...m.toward(al, s, 8, t % 360 > 100 ? 25 : -25)), iron ? [iron.x, iron.y] : [s.x, s.y]);
    }
    if (m.after(150, 'heli') && structures(m, 1, ['hpad']).length && iron) {
      const helis = m.spawnGroup(1, m.tightened ? ['heli', 'heli'] : ['heli'], ...edgeNear(m, al.x, al.y));
      m.attack(helis, iron);
      say(m, C.orlova, 'Longbows inbound on the device. I suggest SAM sites, Comrade.');
    }
    // the coup
    if (!m.flags.coup && m.time > 300) {
      m.flags.coup = true;
      m.setTeam(2, 2);
      m.setAI(2, 'normal');
      const army = m.army(2).filter((u) => u.kind !== 'aircraft');
      addHunters(m, army, 'nkvd');
      if (iron) m.move(army, iron.x, iron.y, true);
      say(m, C.orlova, 'Attention, Western Front. By order of the Horizon Directorate, General Morozov is relieved of command. The Iron Curtain is now Directorate property.');
      say(m, C.belinsky, 'Commissar? What are you doing? Those are our own men!');
      say(m, C.morozov, 'Traitor! Commander, Orlova has turned her guns on us. Hold the device and kill the serpent.');
      m.objective('nkvd', 'Destroy Orlova\'s NKVD headquarters');
      m.camera(nk.x, nk.y);
    }
    if (m.flags.coup && m.time > 330 && m.every(m.tightened ? 70 : 90, 'nkvdWave') && structures(m, 2).length) {
      huntWave(m, 2, m.level === 'brutal' ? ['3tnk', '3tnk', 'e1', 'e1', 'e2', 'dog', 'dog'] : ['3tnk', 'e1', 'e1', 'e2', 'dog', 'dog'], ground(m, ...m.toward(nk, s, 8)), iron ? [iron.x, iron.y] : [s.x, s.y], 'nkvd');
    }
    hunt(m, 'hunters', 10);
    hunt(m, 'nkvd', 8);
    const nkLeft = structures(m, 2).length;
    if (m.flags.coup) m.progress('nkvd', `${nkLeft} left`);
    if (m.flags.coup && !nkLeft && m.once('nkvdDown')) {
      m.complete('nkvd');
      say(m, C.gromova, 'The NKVD headquarters is rubble. The commissar\'s staff car was seen heading east. Fast.');
      say(m, C.morozov, 'Let her run. There is nowhere in this army she can hide from me now.');
    }
    if (!structures(m, 1).length && m.once('alliesDown')) {
      m.complete('allies');
      say(m, C.morozov, 'The Allied bridgehead is gone too. The Rhine is open.');
    }
    if (m.flags.charged && m.isDone('nkvd') && m.once('won')) {
      m.complete('protect');
      if (!m.flags.used) m.fail('use');
      if (m.state('allies') === 'active') m.fail('allies');
      m.win();
    }
  },
};

// =====================================================================================================
// 7. RED HORIZON — final assault on Allied Supreme Headquarters, Antwerp
// =====================================================================================================
const RED_HORIZON: MissionDef = {
  id: 'soviet-07',
  campaign: 'soviet',
  index: 7,
  title: 'Red Horizon',
  codename: 'RED HORIZON',
  location: 'Allied Supreme Headquarters, Antwerp',
  date: '30 June 1953 · 18:50',
  briefing: [
    'This is the last line. Allied Supreme Headquarters sits in the port of Antwerp behind two fortified bases, and Field Marshal Rourke is inside it.',
    'Break both bases and the war in the West is over. You have everything the Union can give: Mammoth Tanks, the Iron Curtain and, for the first time, the atomic missile.',
    'Intelligence warns that the Allies have rebuilt their Chronosphere at headquarters. Whatever they intend to do with it, do not give them the time.',
  ],
  tips: [
    'The Missile Silo takes five minutes to charge. Aim it at their densest cluster of structures.',
    'Use the Iron Curtain on a group of Mammoth Tanks just before they hit the enemy line.',
    'If the Chronosphere overload countdown appears, destroy the Chronosphere before it ends.',
  ],
  map: { size: 112, seed: 2727, players: 4, water: 0.4, trees: 0.55, ore: 0.8, climate: 'temperate', hour: 18.8, dayCycle: true, weather: 'storm' },
  players: [
    { name: 'Western Front', faction: 'soviet', color: SOVIET_RED },
    { name: 'Allied Supreme HQ', faction: 'allies', color: ALLIED_BLUE, ai: 'normal', credits: 3000 },
    { name: 'Channel Guards', faction: 'allies', color: 0x3fa34d, team: 1, ai: 'easy', credits: 2500 },
  ],
  credits: 8000,
  parTime: 1200,
  allowedBuild: ST7,
  debrief: {
    speaker: C.belinsky.name, portrait: C.belinsky.portrait,
    win: 'Comrade... the Allied Chronosphere is still humming in the wreckage. It is not sending. It is receiving. Something is coming through, and it is not ours.',
    lose: 'Antwerp holds, and Rourke with it. The Red Horizon ends on the Scheldt.',
  },
  setup(m) {
    const s = m.start(0), hq = m.start(1), gd = m.start(2);
    const center = { x: m.mapW / 2, y: m.mapH / 2 };
    const base = layout(m, 0, s, center, [
      ['fact', 0, 0], ['apwr', -4, 3.5], ['apwr', -4, -3.5], ['apwr', -1, 7], ['powr', -1, -7], ['barr', 3.5, -3], ['weap', 4, 3], ['proc', 0, 11],
      ['dome', -6.5, 7.5], ['stek', -7, -2], ['tsla', 9, 0], ['tsla', 8, 6], ['sam', 7, -7], ['ftur', 9, -3],
    ]);
    for (const p of base) if (p?.bt.id === 'proc') for (let k = 0; k < 2; k++) m.spawnUnit(0, 'harv', p.x + k, p.cy + p.h + 1);
    squad(m, 0, ['4tnk', '4tnk', '3tnk', '3tnk', '3tnk', 'v2rl'], s, center, 9, 0);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e2', 'e2', 'e3', 'e3', 'e4', 'dog', 'dog', 'e6'], s, center, 7, 5);
    // Allied Supreme HQ
    for (const p of [1, 2]) m.player(p).allowedTypes = allExcept('mslo', 'proc', 'harv', 'pdox', 'e7');
    const hb = layout(m, 1, hq, center, [
      ['fact', 0, 0], ['pdox', -5, 1], ['atek', -2, -4], ['apwr', -4, 4.5], ['apwr', -1, 7.5], ['apwr', -6, -4], ['powr', 1.5, -8],
      ['tent', 3.5, 3], ['weap', 3.5, -3], ...(m.eased ? [] : [['weap', 6, -8]] as [string, number, number][]), ['proc', 0, 11.5], ['dome', -7, 7.5], ['hpad', 2, 10], ['fix', 5, 7.5],
      // (campaign difficulty: on the easy levels Supreme HQ has half its guns and one war factory, and its commander plays a level lower)
      ...(m.eased ? [['gun', 9, 1], ['pbox', 10, 3.5], ['agun', 6, -11]] : [['gun', 9, 1], ['gun', 9, -4], ['gun', 8, 5.5], ['pbox', 10, -1.5], ['pbox', 10, 3.5], ['agun', 6, -11], ['agun', 7, 10]]) as [string, number, number][],
    ]);
    if (m.eased) aiProfile(m, 1, m.level === 'recruit' ? 'recruit' : 'easy');
    for (const p of hb) if (p?.bt.id === 'proc') m.spawnUnit(1, 'harv', p.x, p.cy + p.h + 1);
    m.flags.pdox = hb.find((b) => b?.bt.id === 'pdox')?.id;
    m.flags.hqStart = hb.filter((b) => !!b).length;
    squad(m, 1, m.eased ? ['2tnk', '2tnk', '2tnk', 'arty', 'jeep'] : ['2tnk', '2tnk', '2tnk', '2tnk', '2tnk', '2tnk', 'arty', 'arty', 'arty', 'jeep'], hq, center, 7, 0);
    squad(m, 1, m.eased ? ['e1', 'e1', 'e3', 'e3', 'medi'] : ['e1', 'e1', 'e1', 'e1', 'e3', 'e3', 'e3', 'e3', 'medi', 'medi'], hq, center, 8, -4);
    // Channel Guards
    const gb = layout(m, 2, gd, s, [
      ['fact', 0, 0], ['powr', -3.5, 3], ['powr', -3.5, -3], ['powr', -1, 6.5], ['tent', 3.5, 3], ['weap', 3.5, -2.5], ['dome', -1, -7],
      ['gun', 8, 2], ['gun', 8, -3], ['pbox', 7, 6], ['pbox', 7, -6], ['agun', 5, 8],
    ]);
    void gb;
    squad(m, 2, ['2tnk', '2tnk', '2tnk', '1tnk', 'arty', 'arty', 'e1', 'e1', 'e1', 'e3', 'e3'], gd, s, 6, 0);
    m.objective('hq', 'Destroy Allied Supreme Headquarters');
    m.objective('guards', 'Destroy the Channel Guards base');
    m.objective('nuke', 'Launch an atomic missile', false);
    m.objective('mammoths', 'Keep at least one of your original Mammoth Tanks alive', false);
    m.flags.mammoths = ids(m.units(0, '4tnk'));
  },
  update(m) {
    const s = m.start(0), hq = m.start(1);
    if (m.after(1, 'hello')) {
      say(m, C.morozov, 'Antwerp, Comrade. The last port, the last line, the last of them. Everything we have is behind you. Take it.');
      say(m, C.belinsky, 'The Missile Silo is approved. The Party has authorised one atomic strike. Please, aim carefully.');
    }
    if (m.after(30, 'rourke')) say(m, ROURKE_ENEMY, 'This is Rourke. Whoever you are over there: you have come a very long way. It ends here.');
    // nuke optional: detect the human launching one
    if (!m.isDone('nuke') && m.flags.siloSeen) {
      const st = m.superState(0, 'nuke');
      if (st && m.flags.siloReady && !st.ready) {
        m.complete('nuke');
        say(m, C.morozov, 'The sky over Antwerp is on fire. God forgive us, it is beautiful.');
      }
      m.flags.siloReady = !!st?.ready;
    }
    if (m.buildings(0, 'mslo').length) m.flags.siloSeen = true;
    // Kestrel's last raid
    if (m.after(300, 'kestrel')) {
      const target = m.buildings(0, ['mslo', 'iron', 'apwr', 'powr'])[0];
      if (target) {
        const from = edgeNear(m, ...m.toward(target, hq, -25, 10));
        const k = m.spawnUnit(1, 'e7', from[0], from[1]);
        const esc = m.spawnGroup(1, ['e1', 'e1', 'e1', 'e3'], from[0], from[1]);
        m.attack([k], target);
        m.move(esc, target.x, target.y, true);
        m.flags.kestrel = k.id;
        say(m, C.kestrel, 'Hello, Ivan. Third time lucky.');
        say(m, C.gromova, 'Not this time, bird. Girls! Hunt!');
        m.spawnGroup(0, ['dog', 'dog', 'dog', 'dog'], ...ground(m, target.x, target.y + 3));
      }
    }
    if (m.flags.kestrel && !m.alive(m.flags.kestrel) && m.once('kestrelDead')) say(m, C.gromova, 'The Kestrel is down. For good this time. I almost miss her.');
    // Allied pressure
    if (m.time > 360 && m.every(260, 'pressure') && structures(m, 1).length) {
      huntWave(m, 1, ['2tnk', '2tnk', '2tnk', 'arty', 'e1', 'e1', 'e3', 'e3'], edgeNear(m, ...m.toward(hq, s, 30, 25)), [s.x, s.y]);
    }
    hunt(m, 'hunters', 10);
    // the Chronosphere overload
    const pd = entity<Building>(m, m.flags.pdox);
    const hqLeft = structures(m, 1).length, gdLeft = structures(m, 2).length;
    // (campaign difficulty: on the easy levels the overload starts only once the HQ is badly hit, never on a clock)
    if (pd && !m.flags.overload && (hqLeft <= m.flags.hqStart * 0.6 || (!m.eased && m.time > 1080))) {
      m.flags.overload = true;
      say(m, ROURKE_ENEMY, 'All Allied units: Operation Looking Glass is go. Saarinen, push it past the limit. Get the command staff out.');
      say(m, C.belinsky, 'They are overloading the Chronosphere! They mean to send their entire headquarters somewhere. If it fires, they escape and the war goes on!');
      m.objective('chrono', 'Destroy the Chronosphere before the overload completes');
      m.startTimer('overload', m.byLevel(210, { recruit: 420, easy: 330 }), 'Chronosphere overload'); // (campaign difficulty: the easy levels get more time)
      m.reveal(0, pd.x, pd.y, 4);
    }
    if (m.flags.overload && m.state('chrono') === 'active') {
      if (!pd) {
        m.complete('chrono');
        m.clearTimer('overload');
        say(m, C.morozov, 'The machine is dead and Rourke is still inside his headquarters. Finish it, Comrade.');
      } else if (m.timerDone('overload') && m.once('escaped')) {
        m.fail('chrono');
        m.lose('The Allied command escaped through the Chronosphere.');
        return;
      }
    }
    if (m.state('mammoths') === 'active' && !m.livingUnits(m.flags.mammoths).length) {
      m.fail('mammoths');
      say(m, C.morozov, 'The last of the old Mammoths has fallen. They came all the way from Kursk.');
    }
    m.progress('hq', `${hqLeft} left`);
    m.progress('guards', `${gdLeft} left`);
    if (!gdLeft && m.once('gdDown')) {
      m.complete('guards');
      say(m, C.morozov, 'The Channel Guards are gone. Only headquarters remains.');
    }
    if (!hqLeft && m.once('hqDown')) {
      m.complete('hq');
      say(m, ROURKE_ENEMY, 'This is Rourke. All Allied forces in Antwerp: cease fire. It is over. Commander... well fought. God help us all.');
    }
    if (!hqLeft && !gdLeft && m.once('won')) {
      if (m.state('chrono') === 'active') m.complete('chrono');
      if (m.livingUnits(m.flags.mammoths).length) m.complete('mammoths');
      if (m.state('nuke') === 'active') m.fail('nuke');
      say(m, C.morozov, 'Red Horizon is complete. From the Urals to the Atlantic. Comrade, the West is ours.');
      say(m, C.belinsky, 'General... the Allied Chronosphere is still humming in the rubble. It is not sending. It is receiving.');
      m.win();
    }
    void centroid;
  },
};

export const SOVIET_MISSIONS: MissionDef[] = ([FIRST_SNOW, BRIDGEHEAD, THUNDERHEAD, IRON_ROAD, STOLEN_FIRE, IRON_CURTAIN, RED_HORIZON]).map(quietSetup);
export const SOVIET_TECH = { ST2, ST4, ST5, ST6, ST7 };
