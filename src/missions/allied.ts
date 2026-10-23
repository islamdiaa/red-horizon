/**
 * Allied campaign: OPERATION DAWNBREAK.
 * Spring 1953. Operation Red Horizon has carried the Red Army across the inner German border. Field Marshal Rourke,
 * Major Brandt of Allied Intelligence, the commando Kestrel and Dr. Saarinen of Project LOOKING GLASS fight the
 * counteroffensive that ends in the closed city of Gorizont-9.
 */
import type { MissionDef, MissionRuntime } from '../sim/mission';
import type { Building, Unit } from '../sim/entities';
import { BUILDINGS, UNITS } from '../data/rules';
import {
  CAST, say, wave, hunt, huntWave, addHunters, structures, layout, squad, edgeNear, ground, ids, unitsOf, entity,
  whereIs, escort, centroid, aiProfile, compass,
  quietSetup,
} from './common';

const C = CAST;

// Tech levels (cumulative)
const AT1 = ['powr', 'tent', 'proc', 'silo', 'sbag', 'pbox', 'e1', 'e3', 'e6'];
const AT2 = [...AT1, 'weap', 'gun', 'harv', 'medi', '1tnk', 'jeep'];
const AT5 = [...AT2, 'dome', 'apwr', 'fix', 'hpad', 'agun', 'brik', 'arty', '2tnk', 'apc', 'heli'];
const AT6 = [...AT5, 'atek', 'e7'];
const AT7 = [...AT6, 'pdox'];

const SOVIET_RED = 0xd23a2c;
const ALLIED_BLUE = 0x3d7be0;

/** Every structure and unit id except the listed ones (AI tech restrictions). */
function allExcept(...no: string[]): Set<string> {
  return new Set([...Object.keys(BUILDINGS), ...Object.keys(UNITS)].filter((t) => !no.includes(t)));
}

// =====================================================================================================
// 1. GREY DAWN — establish a base, destroy the forward outpost
// =====================================================================================================
const GREY_DAWN: MissionDef = {
  id: 'allied-01',
  campaign: 'allies',
  index: 1,
  title: 'Grey Dawn',
  codename: 'GREY DAWN',
  location: 'Fulda Gap, West Germany',
  date: '14 April 1953 · 06:40',
  briefing: [
    'Three days ago the Red Army launched Operation Red Horizon. Forty divisions crossed the inner German border before sunrise, and at midnight the Fulda line broke.',
    'You are what is left between their spearhead and Frankfurt. Land your construction vehicle in the valley, get a base running and put the ore trucks to work.',
    'A Soviet forward outpost on the north-east ridge is shelling the refugee roads. When you are strong enough, wipe it off the map.',
  ],
  tips: [
    'Deploy the MCV first: select it and press D or click it again (on a touch screen, press and hold it and pick Deploy). Then build a Power Plant.',
    'An Ore Refinery comes with a free Ore Truck. Ore is money.',
    'Rocket Soldiers kill tanks, Riflemen kill infantry. Flame towers roast anything on foot.',
    'You cannot build tanks yet. Keep your two Light Tanks alive: flame towers hardly scratch them, so they lead the assault.',
    'Engineers capture enemy structures that are below a quarter of their strength.',
  ],
  map: { size: 72, seed: 7203, players: 2, water: 0.3, trees: 0.6, ore: 0.7, climate: 'temperate', hour: 6.7, dayCycle: true, weather: 'fog' },
  players: [
    { name: 'Allied Expeditionary Force', faction: 'allies', color: ALLIED_BLUE },
    { name: 'Soviet Forward Group', faction: 'soviet', color: SOVIET_RED, ai: 'defensive', credits: 1200 },
  ],
  credits: 4000,
  parTime: 840,
  allowedBuild: AT1,
  debrief: {
    speaker: C.rourke.name, portrait: C.rourke.portrait,
    win: 'First blood to us. Morozov will have noticed you, Commander. Good. I want him looking at you while we look at him.',
    lose: 'We have lost the valley. Pull back, regroup, and we go again. Frankfurt cannot afford a second failure.',
  },
  setup(m) {
    const s = m.start(0), e = m.start(1);
    m.spawnUnit(0, 'mcv', s.x, s.y, Math.atan2(e.y - s.y, e.x - s.x));
    squad(m, 0, ['1tnk', '1tnk', 'jeep'], s, e, 3.5, 0);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e3', 'e3', 'e6'], s, e, 2, 3.5);
    // the outpost (campaign difficulty: the easy levels face one flame tower, Recruit a smaller garrison, with less money for recruits;
    // Brutal one flame tower too, and the light tank platoon below: with two towers no autopilot took the ridge)
    const towers: [string, number, number][] = m.eased || m.level === 'brutal' ? [['ftur', 6.5, 0]] : [['ftur', 6.5, 2.5], ['ftur', 6.5, -2.5]];
    const [barr] = layout(m, 1, e, s, [['barr', 1, 0], ['powr', -2, 3.5], ['powr', -2.5, -3], ['kenn', 2, 4], ...towers]);
    const [w1x, w1y] = m.toward(e, s, 9, -5), [w2x, w2y] = m.toward(e, s, 9, -1.5);
    m.wall(1, 'barb', Math.round(w1x), Math.round(w1y), Math.round(w2x), Math.round(w2y));
    squad(m, 1, ['3tnk'], e, s, 4.5, 0);
    squad(m, 1, ['e1', 'e1', 'e2', 'e2'], e, s, 3.5, -3);
    if (m.level !== 'recruit') squad(m, 1, ['e1', 'e1', 'dog', 'dog'], e, s, 3.5, 3);
    if (m.eased) m.player(1).cash = 300;
    m.flags.barracks = barr?.id;
    m.objective('deploy', 'Deploy the MCV to establish a base');
    m.objective('refinery', 'Build an Ore Refinery');
    m.objective('outpost', 'Destroy the Soviet forward outpost');
    m.objective('capture', 'Capture the Soviet barracks with an Engineer', false);
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    if (m.after(1, 'hello')) say(m, C.rourke, 'Morning, Commander. Rourke here. The Fulda line broke at midnight and you are what is left of it. Deploy that MCV and dig in.');
    if (!m.isDone('deploy') && m.buildings(0, 'fact').length) {
      m.complete('deploy');
      say(m, C.rourke, 'Good. Power plant first, then barracks and a refinery. Ore pays for this war.');
    }
    if (!m.isDone('refinery') && m.buildings(0, 'proc').length) {
      m.complete('refinery');
      say(m, C.brandt, m.eased ? 'Major Brandt, Intelligence. Their outpost sits on the north-east ridge: a flame tower on the approach, one heavy tank. Rockets for the tank, and keep your riflemen out of the fire.' : 'Major Brandt, Intelligence. Their outpost sits on the north-east ridge: two flame towers on the approach, one heavy tank. Rockets for the tank, and keep your riflemen out of the fire.');
      m.reveal(0, e.x, e.y, 8);
      m.beacon(e.x, e.y); // (a marker on the objective: where to send everything)
    }
    if (m.after(150, 'morozov')) {
      say(m, C.morozov, 'To the Allied commander in the valley: this is Arkady Morozov. I will be in Paris by summer. Do try to make it interesting.');
      say(m, C.brandt, 'That was Morozov himself, on an open channel. He likes an audience. Let us not give him one.');
    }
    if (m.after(m.byLevel(210, { recruit: 300, easy: 240 }), 'raid1')) {
      huntWave(m, 1, m.byLevel(['e1', 'e1', 'e1', 'dog', 'dog'], { recruit: ['e1', 'e1', 'dog'], easy: ['e1', 'e1', 'e1', 'dog'] }), ground(m, e.x, e.y), [s.x, s.y]);
      say(m, C.brandt, 'Dogs and riflemen coming down the ridge road. A pillbox or two will discourage them.');
    }
    // --- the supply column (new optional objective)
    if (m.after(290, 'convoy')) {
      const from = edgeNear(m, 0, m.mapH * 0.25);
      const trucks = m.spawnGroup(1, ['harv', 'harv'], from[0], from[1]);
      trucks.forEach((t) => m.setHealth(t, 0.5));
      const guard = m.spawnGroup(1, ['3tnk'], from[0] + 1, from[1]);
      const to = m.toward(e, s, 2);
      const via = ground(m, m.mapW * 0.42, m.mapH * 0.48);
      m.move([...trucks, ...guard], via[0], via[1], false);
      m.world.issue({ c: 'move', player: 1, units: ids([...trucks, ...guard]), x: to[0], y: to[1], queue: true });
      m.flags.trucks = ids(trucks);
      addHunters(m, guard);
      m.objective('convoy', 'Destroy the Soviet supply column before it reaches the outpost', false);
      m.reveal(0, from[0], from[1], 5);
      say(m, C.brandt, 'Intercept: a supply column is coming in from the west, through the middle of the valley, bound for the outpost. Catch it before it gets there.');
    }
    if (m.flags.trucks && m.isDone('convoy') === false && m.objectives.find((o) => o.id === 'convoy')?.state === 'active') {
      const trucks = unitsOf(m, 'trucks');
      const goal = m.toward(e, s, 2);
      for (const t of trucks) {
        if (Math.hypot(t.x - goal[0], t.y - goal[1]) < 4.5) {
          m.remove(t);
          if (m.once('convoyArrived')) {
            m.fail('convoy');
            m.give(1, m.eased ? 300 : 1500);
            squad(m, 1, m.eased ? ['e1', 'e1'] : ['e1', 'e1', 'e2', '3tnk'], e, s, 3);
            say(m, C.brandt, 'The column made it through. Their outpost just got fresh men and fuel.');
          }
        } else if (t.order.type !== 'move' && !t.orderQueue.length) {
          m.move([t], goal[0], goal[1], false);
        }
      }
      if (!unitsOf(m, 'trucks').length && m.objectives.find((o) => o.id === 'convoy')?.state === 'active') {
        m.complete('convoy');
        say(m, C.rourke, 'Lovely shooting. That was their breakfast.');
      }
    }
    if (m.after(450, 'raid2')) {
      // (the easy levels: infantry only; the heavy tanks come at Normal)
      if (m.eased) {
        huntWave(m, 1, ['e1', 'e1', 'e1', 'e2'], edgeNear(m, e.x, 0), [s.x, s.y]);
        say(m, C.brandt, 'Infantry moving on your base from the north road!');
      } else {
        huntWave(m, 1, ['3tnk', 'e1', 'e1', 'e1', 'e2', 'e2'], edgeNear(m, e.x, 0), [s.x, s.y]);
        say(m, C.brandt, 'Heavy tank and infantry moving on your base from the north road!');
      }
    }
    if (m.eased) {
      // the easy levels: a small raid every four minutes from 15:00, a heavy tank with it from 25:00
      if (m.time > 900 && m.every(240, 'raidN') && structures(m, 1).length) huntWave(m, 1, ['e1', 'e1', 'dog', ...(m.time > 1500 ? ['3tnk'] : [])], edgeNear(m, e.x, 0), [s.x, s.y]);
    } else if (m.time > 600 && m.every(170, 'raidN') && structures(m, 1).length) {
      const n = Math.min(4, Math.floor((m.time - 600) / 170));
      huntWave(m, 1, ['e1', 'e1', 'e2', 'dog', ...(n >= 1 ? ['3tnk'] : []), ...(n >= 3 ? ['3tnk', 'e2'] : [])], edgeNear(m, e.x, 0), [s.x, s.y]);
    }
    // up to Normal (and at Brutal) a light tank platoon joins (tanks are what burns down flame towers; measured, a casual
    // player's infantry won Normal in about half the runs without it, every run with it)
    if (m.level !== 'hard' && m.after(m.byLevel(330, { recruit: 270, normal: 360, brutal: 360 }), 'platoon')) {
      m.reinforce(0, m.byLevel(['1tnk', '1tnk'], { recruit: ['1tnk', '1tnk', '1tnk'] }), edgeNear(m, s.x, s.y), m.toward(s, e, 4), false);
      say(m, C.rourke, 'Commander, a light tank platoon got through to you. Tanks shrug off those flame towers: put them in front of your infantry.');
    }
    hunt(m);
    // optional capture
    const b = entity<Building>(m, m.flags.barracks);
    if (m.flags.barracks && m.objectives.find((o) => o.id === 'capture')?.state === 'active') {
      if (b && b.owner === m.human) {
        m.complete('capture');
        say(m, C.rourke, 'Their own barracks! Cheeky. I approve.');
      } else if (!b) m.fail('capture');
    }
    const left = structures(m, 1).length;
    m.progress('outpost', `${left} left`);
    if (!left && m.once('won')) {
      m.complete('outpost');
      say(m, C.rourke, 'The ridge is ours. Frankfurt sleeps another night. Well done, Commander.');
      m.win();
    }
  },
};

// =====================================================================================================
// 2. LAST TRAIN FROM KASSEL — hold until dawn
// =====================================================================================================
const KASSEL_HOLD = 630; // 16:30 to 06:30 on the in-game clock (45 s per hour)
const KASSEL_WAVES: { t: number; types: string[]; from: number }[] = [
  { t: 40, types: ['dog', 'dog', 'dog', 'e1', 'e1'], from: 0 },
  { t: 100, types: ['e1', 'e1', 'e1', 'e2', 'e2', '3tnk'], from: 1 },
  { t: 165, types: ['3tnk', '3tnk', 'e1', 'e1', 'e3', 'e3'], from: 2 },
  { t: 230, types: ['e1', 'e1', 'e1', 'e1', 'e2', 'e2', 'dog', 'dog', '3tnk'], from: 0 },
  { t: 300, types: ['3tnk', '3tnk', 'v2rl', 'e1', 'e1', 'e1', 'e4'], from: 1 },
  { t: 380, types: ['3tnk', '3tnk', '3tnk', 'e2', 'e2', 'e1', 'e1', 'e4'], from: 2 },
  { t: 395, types: ['dog', 'dog', 'e1', 'e1', 'e1'], from: 1 },
  { t: 470, types: ['4tnk', '3tnk', '3tnk', 'e1', 'e1', 'e1', 'e1'], from: 0 },
  { t: 545, types: ['3tnk', '3tnk', 'v2rl', 'e1', 'e1', 'e2', 'e2'], from: 1 },
  { t: 560, types: ['3tnk', '3tnk', 'e1', 'e1', 'e4', 'e4'], from: 2 },
];

const KASSEL: MissionDef = {
  id: 'allied-02',
  campaign: 'allies',
  index: 2,
  title: 'Last Train from Kassel',
  codename: 'NIGHT EXPRESS',
  location: 'Kassel Rail Junction, Hesse',
  date: '17 April 1953 · 16:30',
  briefing: [
    'Kassel is the last rail junction still running west. All night, trains will carry the city out: soldiers, wounded, ten thousand civilians at a time.',
    'Morozov knows it. His columns are converging on the rail yard from the north and east. If the yard falls, the trains stop.',
    'Hold Kassel until first light. You have a base, a war factory licence and whatever courage the night leaves you.',
  ],
  tips: [
    'The Service Depot marked as the rail yard must survive until dawn.',
    'Build a War Factory: Light Tanks and Rangers can plug gaps fast.',
    'Turrets stop armour, Pillboxes stop infantry. Sandbags funnel attackers into both.',
    'Medics keep your infantry on their feet between waves.',
  ],
  map: { size: 72, seed: 3301, players: 2, water: 0.35, trees: 0.6, ore: 0.7, climate: 'temperate', hour: 16.5, dayCycle: true, weather: 'rain' },
  players: [
    { name: 'Kassel Garrison', faction: 'allies', color: ALLIED_BLUE },
    { name: 'Soviet 8th Guards Army', faction: 'soviet', color: SOVIET_RED, ai: 'passive', credits: 0 },
  ],
  credits: 3500,
  parTime: KASSEL_HOLD + 30,
  allowedBuild: AT2,
  debrief: {
    speaker: C.rourke.name, portrait: C.rourke.portrait,
    win: 'Every train got through. Ninety thousand people are west of the Weser because you would not move. Get some sleep, Commander. That is an order.',
    lose: 'The rail yard is burning and the last trains never left. We will remember Kassel, Commander. So will Morozov.',
  },
  setup(m) {
    const s = m.start(0), e = m.start(1);
    const [fact, , , , proc, yard] = layout(m, 0, s, e, [
      ['fact', 0, 0], ['powr', -3.5, 3], ['powr', -3.5, -2.5], ['tent', 3, -4], ['proc', 0.5, 5.5], ['fix', 2, -9],
      ['pbox', 7.5, 2], ['pbox', 7, -5], ['gun', 8, -1.5],
    ]);
    void fact;
    if (proc) m.spawnUnit(0, 'harv', proc.x, proc.cy + proc.h + 0.6);
    m.flags.yard = yard?.id;
    const [a0, a1] = [m.toward(s, e, 9.5, -7), m.toward(s, e, 9.5, -3)];
    m.wall(0, 'sbag', Math.round(a0[0]), Math.round(a0[1]), Math.round(a1[0]), Math.round(a1[1]));
    squad(m, 0, ['1tnk', '1tnk'], s, e, 5, 0);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e3', 'e3', 'medi'], s, e, 4.5, -3);
    // the Soviet staging camp and the artillery spotter on the hill
    layout(m, 1, e, s, [['barr', 0, 0], ['powr', -2, 3], ['ftur', 4, 0]]);
    squad(m, 1, ['e1', 'e1', 'e2'], e, s, 3, 2);
    const [sx, sy] = m.between(s, e, 0.6, 7);
    const spot = m.placeNear(1, 'dome', sx, sy);
    m.flags.spotter = spot?.id;
    if (spot) {
      squad(m, 1, ['e1', 'e1', 'e1', 'e2'], [spot.x, spot.y], s, 2.5, 0);
      squad(m, 1, ['3tnk'], [spot.x, spot.y], s, 2.5, 2);
    }
    m.objective('hold', 'Hold the Kassel rail yard until dawn');
    m.objective('yard', 'The rail yard (Service Depot) must survive');
    m.progress('hold', '0 / 7 trains');
    m.startTimer('dawn', KASSEL_HOLD, 'First light');
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    const yard = entity<Building>(m, m.flags.yard);
    if (m.after(1, 'hello')) {
      say(m, C.rourke, 'Commander, the Kassel junction is the last line running west. Every train out carries ten thousand people. Hold until first light.');
      say(m, C.brandt, 'Columns converging from the north and east. They will come in waves, and they will get heavier as the night goes on.');
    }
    const spawns = [ground(m, e.x, e.y), edgeNear(m, m.mapW * 0.45, 0), edgeNear(m, m.mapW, m.mapH * 0.5)];
    // (campaign difficulty: at Hard and Brutal every wave from the third on brings one more heavy tank, Brutal one more again)
    for (const w of KASSEL_WAVES) {
      if (m.after(w.t, 'wave' + w.t)) {
        const target = yard ?? s;
        // (campaign difficulty: at Hard a heavy tank more from the third wave on; not at Brutal, where the handicaps make
        // every wave about twice as deadly already: with one or two more the expert autopilot never held the yard)
        const extra = m.level === 'hard' && w.t >= 165 ? ['3tnk'] : [];
        const units = huntWave(m, 1, [...w.types, ...extra], spawns[w.from], [target.x, target.y]);
        if (w.types.includes('4tnk')) {
          m.flags.mammoth = units.find((u) => u.ut.id === '4tnk')?.id;
          m.objective('mammoth', 'Destroy the Mammoth Tank', false);
          say(m, C.brandt, 'Good God. That is a Mammoth tank: twin cannons, missile pods, and it mends itself. Kill it before it reaches the yard.');
        }
      }
    }
    if (m.after(101, 'w2talk')) say(m, C.brandt, 'Infantry and a heavy tank from the north road.');
    if (m.after(166, 'w3talk')) say(m, C.brandt, 'Armour from the east. Turrets, Commander, turrets.');
    hunt(m, 'hunters', 8);
    // the artillery spotter
    const spot = entity<Building>(m, m.flags.spotter);
    if (m.after(140, 'artyIntro') && spot) {
      m.objective('spotter', 'Destroy the artillery spotter on the north-east hill', false);
      m.reveal(0, spot.x, spot.y, 4);
      say(m, C.brandt, 'Incoming artillery! Their spotter is a radar mast on the hill to the north-east. Knock it out and the guns go blind.');
    }
    if (m.time > 145 && spot && m.every(26, 'barrage')) {
      const targets = structures(m, 0);
      if (targets.length) {
        const t = targets[m.world.rng.int(0, targets.length - 1)];
        for (let k = 0; k < 3; k++) m.shell(1, t.x, t.y, { from: edgeNear(m, e.x, e.y), scatter: 1.6 });
      }
    }
    if (m.flags.spotter && !spot && m.once('spotterDown')) {
      m.complete('spotter');
      say(m, C.rourke, 'The guns have gone quiet. Nicely done.');
    }
    if (m.after(300, 'morozov')) say(m, C.morozov, 'The trains will not save them, Commander. There is nowhere in Europe the rails can go that I cannot follow.');
    if (m.after(360, 'reinforce')) {
      const from = edgeNear(m, s.x, m.mapH);
      m.reinforce(0, ['2tnk', '2tnk', '2tnk', 'jeep'], from, m.toward(s, e, 4), false);
      say(m, C.rourke, 'Commander, the 7th Armoured broke through to you. Three Mediums and a Ranger coming up the south road. Use them well.');
    }
    // Mammoth optional
    if (m.flags.mammoth && !m.alive(m.flags.mammoth) && m.once('mammothDead')) {
      m.complete('mammoth');
      say(m, C.rourke, 'The Mammoth is scrap. Somebody buy that crew a drink.');
    }
    // trains
    const left = m.timeLeft('dawn') ?? 0;
    const trains = Math.min(7, Math.floor((KASSEL_HOLD - left) / (KASSEL_HOLD / 7)));
    if (trains > (m.flags.trains ?? 0)) {
      m.flags.trains = trains;
      m.progress('hold', `${trains} / 7 trains`);
      if (trains < 7) say(m, C.eva, `Train ${trains} is clear of the yard.`);
    }
    if (!yard && m.once('yardLost')) {
      m.fail('yard');
      m.lose('The rail yard has been destroyed.');
      return;
    }
    if (m.timerDone('dawn') && m.once('dawn')) {
      if (m.flags.mammoth && m.alive(m.flags.mammoth)) m.fail('mammoth');
      if (m.objectives.find((o) => o.id === 'spotter')?.state === 'active') m.fail('spotter');
      m.complete('yard');
      m.complete('hold');
      say(m, C.rourke, 'That is the last train. Every one of them got through, Commander. Fall back west. You have earned the ride.');
      m.win();
    }
  },
};

// =====================================================================================================
// 3. KESTREL'S NEST — commando raid
// =====================================================================================================
const KESTREL_NEST: MissionDef = {
  id: 'allied-03',
  campaign: 'allies',
  index: 3,
  title: "Kestrel's Nest",
  codename: 'BLACKOUT',
  location: 'Brocken Summit, Harz Mountains',
  date: '23 April 1953 · 01:10',
  briefing: [
    'The Tesla weapons tearing through our lines come from the Horizon Directorate, Moscow\'s secret science bureau. One of its field laboratories sits on the Brocken, behind Soviet lines.',
    'Kestrel goes in tonight with two engineers. Cut the lab\'s power so its Tesla Coils go dark, let an engineer take the laboratory and copy everything, then get out.',
    'There is a thunderstorm over the Harz. Use it. Nobody looks up in the rain.',
  ],
  tips: [
    'Tesla Coils need power. Destroy the power station and they fall silent.',
    'Right-click a structure with Kestrel to plant C4. She cannot hurt vehicles.',
    'Kestrel outranges every infantryman on the hill. Let her lead; keep the engineers behind her.',
    'A flame tower fireball kills Kestrel outright. Go around them.',
  ],
  map: { size: 64, seed: 1404, players: 2, water: 0.25, trees: 0.85, ore: 0.3, climate: 'temperate', hour: 1.2, dayCycle: false, weather: 'storm' },
  players: [
    { name: 'Kestrel Team', faction: 'allies', color: ALLIED_BLUE },
    { name: 'Horizon Directorate', faction: 'soviet', color: SOVIET_RED, ai: 'passive', credits: 0 },
  ],
  credits: 0,
  parTime: 420,
  allowedBuild: [],
  debrief: {
    speaker: C.kestrel.name, portrait: C.kestrel.portrait,
    win: 'Lab\'s copied, lights are out, and I still have both eyebrows. Tell Saarinen he owes me a drink.',
    lose: 'Kestrel\'s team has gone silent on the mountain. Command will not get another chance at that lab.',
  },
  setup(m) {
    m.world.cratesEnabled = false;
    const s = m.start(0), e = m.start(1);
    const team = squad(m, 0, ['e7'], s, e, 1, 0);
    const eng = squad(m, 0, ['e6', 'e6'], s, e, -1, 1.2);
    const medic = squad(m, 0, ['medi'], s, e, -1.5, -1.2);
    m.flags.kestrel = team[0].id;
    m.flags.engineers = ids(eng);
    void medic;
    // the compound: lab forward of the corner, power station on the eastern flank, stockade by the road
    const [hq, lab, t1, t2] = layout(m, 1, e, s, [['fact', 2, 6], ['stek', 9, 0], ['tsla', 12.5, 3], ['tsla', 12.5, -3]]);
    const ps = layout(m, 1, e, s, [['apwr', 10, -18], ['apwr', 14, -15.5], ['powr', 9, -14.5]]);
    const [stockade] = layout(m, 1, e, s, [['barr', 15.5, -9]]);
    const [f1, f2] = layout(m, 1, e, s, [['ftur', 19, 2.5], ['ftur', 19, -2.5]]);
    void hq; void f1; void f2;
    m.setHealth(lab, 0.2);
    m.flags.lab = lab?.id;
    m.flags.coils = ids([t1, t2].filter((b): b is Building => !!b));
    m.flags.stockade = stockade?.id;
    m.flags.plants = ids(ps.filter((b): b is Building => !!b));
    // garrison (campaign difficulty: the easy levels post fewer guards and no dogs, which kill Kestrel in one bite)
    const psC = centroid(ps.filter((b): b is Building => !!b));
    squad(m, 1, m.byLevel(['e1', 'e1', 'e1', 'dog', 'dog'], { recruit: ['e1', 'e1'], easy: ['e1', 'e1', 'e1'], brutal: ['e1', 'e1', 'e1', 'e1', 'dog', 'dog', 'dog'] }), psC, s, 3.5, 0);
    if (m.level !== 'recruit') squad(m, 1, m.byLevel(['e2', 'e2'], { easy: ['e2'] }), psC, s, 1, 4);
    squad(m, 1, ['3tnk'], e, s, 22, 8);
    squad(m, 1, m.byLevel(['e1', 'e1', 'e2', 'e2', 'e4'], { recruit: ['e1', 'e1'], easy: ['e1', 'e1', 'e2'] }), e, s, 11, 0);
    if (stockade) squad(m, 1, m.byLevel(['e1', 'e1', 'dog'], { recruit: ['e1'], easy: ['e1', 'e1'] }), [stockade.x, stockade.y], s, 2.5, 0);
    const pat = squad(m, 1, m.byLevel(['e1', 'e1', 'dog'], { recruit: ['e1'], easy: ['e1', 'e1'], brutal: ['e1', 'e1', 'e1', 'dog', 'dog'] }), e, s, 18, 5);
    m.flags.patrol = ids(pat);
    const [b1, b2] = [m.toward(e, s, 21.5, -5), m.toward(e, s, 21.5, 5)];
    m.wall(1, 'barb', Math.round(b1[0]), Math.round(b1[1]), Math.round(b2[0]), Math.round(b2[1]));
    m.reveal(0, psC.x, psC.y, 3);
    if (lab) m.reveal(0, lab.x, lab.y, 3);
    m.objective('power', 'Destroy the power station so the Tesla Coils go dark');
    m.objective('lab', 'Capture the Directorate laboratory with an Engineer');
    m.objective('kestrel', 'Kestrel must survive');
    m.objective('prisoners', 'Free the Allied prisoners in the stockade', false);
    m.objective('coils', 'Demolish both Tesla Coils', false);
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    const kestrel = entity<Unit>(m, m.flags.kestrel);
    if (m.after(1, 'hello')) {
      say(m, C.kestrel, 'Kestrel in position. Lovely weather for it.');
      const lab0 = entity<Building>(m, m.flags.lab), pc = centroid(m.living(m.flags.plants));
      const dir = lab0 ? compass(lab0, pc) : 'far';
      say(m, C.brandt, `The power station sits on the ${dir} side of the compound, well clear of the coils. Kill the power, then let an engineer into the lab. Leave the Tesla Coils alone while they are live.`);
    }
    if (!kestrel && m.once('kestrelDead')) {
      m.fail('kestrel');
      m.lose('Kestrel is down.');
      return;
    }
    // patrol on the road
    if (m.every(2, 'patrolTick')) {
      const p = m.livingUnits(m.flags.patrol);
      m.patrol(p, [m.toward(e, s, 18, 5), m.toward(e, s, 19, -7), m.toward(e, s, 14, -14)]);
    }
    // power
    const plantsLeft = m.living(m.flags.plants).length;
    if (!m.isDone('power')) m.progress('power', `${3 - plantsLeft} / 3`);
    if (!m.isDone('power') && plantsLeft < 3 && m.once('flicker')) say(m, C.kestrel, 'Coils are flickering. Finish the station before somebody reroutes the grid.');
    if (!m.isDone('power') && plantsLeft === 0) {
      m.complete('power');
      say(m, C.belinskyEnemy, '(intercepted) Who turned off the lights? Who turned off my lights?! Technicians! Start the backup generator!');
      say(m, C.brandt, 'Kestrel, three technicians are heading for a backup generator behind the lab. If it spins up, the coils come back. You have one minute.');
      const lab0 = entity<Building>(m, m.flags.lab);
      const site = lab0 ? m.toward(lab0, e, 3.5, 4) : m.toward(e, s, 5, 4);
      const techs = m.spawnGroup(1, ['e6', 'e6', 'e6'], ...ground(m, site[0], site[1], 4));
      m.flags.techs = ids(techs);
      m.flags.site = site;
      m.reveal(0, site[0], site[1], 3);
      m.objective('techs', 'Kill the technicians before the backup generator starts');
      m.startTimer('backup', m.byLevel(60, { recruit: 120, easy: 90, brutal: 45 }), 'Backup generator');
    }
    if (m.flags.techs && m.objectives.find((o) => o.id === 'techs')?.state === 'active') {
      if (!m.livingUnits(m.flags.techs).length) {
        m.complete('techs');
        m.clearTimer('backup');
        say(m, C.kestrel, 'Technicians are down. Nobody is switching anything on tonight.');
      } else if (m.timerDone('backup')) {
        m.fail('techs');
        m.clearTimer('backup');
        const [x, y] = m.flags.site as [number, number];
        const gen = m.placeNear(1, 'apwr', x, y);
        m.flags.generator = gen?.id;
        for (const t of m.livingUnits(m.flags.techs)) m.remove(t);
        m.objective('generator', 'Destroy the backup generator');
        say(m, C.belinskyEnemy, '(intercepted) Ha! Power restored! Let them come now!');
        say(m, C.brandt, 'The coils are live again. Kestrel, that generator has to go.');
      }
    }
    if (m.flags.generator && !m.alive(m.flags.generator) && m.once('genDown')) {
      m.complete('generator');
      say(m, C.kestrel, 'Generator is scrap. Lights out, for real this time.');
    }
    // the lab
    const lab = entity<Building>(m, m.flags.lab);
    // (its blast doors hold until an engineer is inside: stray fire from an attack-move can't wreck the objective)
    if (lab && lab.owner !== m.human) lab.invulnerable = 1;
    if (!m.isDone('lab')) {
      if (lab && lab.owner === m.human) {
        m.complete('lab');
        say(m, C.saarinen, 'These are... my equations. My own work, copied out in Russian. They know about Looking Glass.');
        say(m, C.brandt, 'Then Norway is next. Kestrel, the whole mountain is waking up. Get out.');
        say(m, C.hollander, 'Hollander here. I can put down in the clearing past the power station. Under three minutes, then I am gone.');
        const plants = m.living(m.flags.plants);
        const pc = plants.length ? centroid(plants) : { x: s.x, y: s.y };
        const corners: [number, number][] = [[6, m.mapH - 6], [m.mapW - 6, 6]];
        corners.sort((a, b) => Math.hypot(a[0] - pc.x, a[1] - pc.y) - Math.hypot(b[0] - pc.x, b[1] - pc.y));
        const lz = ground(m, corners[0][0], corners[0][1]);
        m.flags.lz = lz;
        m.reveal(0, lz[0], lz[1], 4);
        m.objective('extract', 'Get Kestrel to the extraction clearing');
        m.startTimer('lz', m.byLevel(165, { recruit: 240, easy: 200 }), 'Helicopter leaves');
        // the alarm: armour rolls in behind the compound and gives chase
        const behind = m.toward({ x: lz[0], y: lz[1] }, lab, m.dist(lz, lab) + 14);
        huntWave(m, 1, m.byLevel(['3tnk', '3tnk', 'e1', 'e1', 'e1', 'dog', 'dog'], { recruit: ['e1', 'e1', 'e1'], easy: ['3tnk', 'e1', 'e1', 'e1'] }), edgeNear(m, behind[0], behind[1]), [lab.x, lab.y]);
        m.camera(lab.x, lab.y);
      } else if (!lab) {
        m.fail('lab');
        m.lose('The laboratory was destroyed before it could be copied.');
        return;
      } else if (!m.livingUnits(m.flags.engineers).length) {
        m.fail('lab');
        m.lose('Both engineers are dead. Nobody is left to copy the lab.');
        return;
      }
    }
    hunt(m, 'hunters', 6);
    // prisoners
    if (m.flags.stockade && !m.alive(m.flags.stockade) && m.once('freed')) {
      const st = m.flags.stockadePos as [number, number] | undefined;
      const at = st ?? m.toward(e, s, 7, -13);
      m.spawnGroup(0, ['e1', 'e1', 'e3', 'e3'], at[0], at[1]);
      m.complete('prisoners');
      say(m, C.kestrel, 'Stockade is open. Four very angry pilots just joined the party.');
    }
    if (m.alive(m.flags.stockade)) {
      const b = entity<Building>(m, m.flags.stockade)!;
      m.flags.stockadePos = [b.x, b.y + b.h / 2 + 0.6];
    }
    // coils
    const coilsLeft = m.living(m.flags.coils).length;
    if (coilsLeft === 0 && m.once('coilsDown')) {
      m.complete('coils');
      say(m, C.belinskyEnemy, '(intercepted) My coils! Six years of work! You barbarians!');
    }
    // extraction
    if (m.flags.lz && kestrel) {
      const [lx, ly] = m.flags.lz as [number, number];
      if (Math.hypot(kestrel.x - lx, kestrel.y - ly) < 3 && m.once('extracted')) {
        m.complete('extract');
        m.complete('kestrel');
        if (coilsLeft > 0) m.fail('coils');
        if (m.alive(m.flags.stockade)) m.fail('prisoners');
        say(m, C.hollander, 'Got her! Hold on to something, we are going out low.');
        m.win();
        return;
      }
      if (m.timerDone('lz') && m.once('lzGone')) {
        m.fail('extract');
        m.lose('The helicopter had to leave without Kestrel.');
      }
    }
  },
};

// =====================================================================================================
// 4. LOOKING GLASS — evacuate Dr. Saarinen (winter), betrayal at the harbour
// =====================================================================================================
const LOOKING_GLASS: MissionDef = {
  id: 'allied-04',
  campaign: 'allies',
  index: 4,
  title: 'Through the Looking Glass',
  codename: 'GLASS SLIPPER',
  location: 'Hardanger Plateau, Norway',
  date: '2 May 1953 · 10:30',
  briefing: [
    'The Brocken files were clear: Moscow knows about Project LOOKING GLASS, Dr. Emil Saarinen\'s machine that moves matter from one place to another without crossing the space between.',
    'An hour ago Soviet paratroopers dropped on the Hardanger plateau. Saarinen and two of his researchers are trapped in the research station.',
    'Load them into your APCs and drive for the harbour, where Colonel Lindqvist\'s Home Guard is holding a boat. Saarinen must not be taken alive, and he must not die.',
  ],
  tips: [
    'Select the three Engineers (the research team) and right-click an APC to board. D unloads.',
    'If an APC is destroyed, everyone inside dies with it. Escort them.',
    'The prototype on the base is the only Chronosphere in the world. It cannot be allowed to fall into Soviet hands.',
  ],
  map: { size: 80, seed: 5120, players: 2, water: 0.45, trees: 0.7, ore: 0.4, climate: 'winter', hour: 10.5, dayCycle: true, weather: 'snow' },
  players: [
    { name: 'Allied Task Force Norway', faction: 'allies', color: ALLIED_BLUE },
    { name: 'Soviet Airborne', faction: 'soviet', color: SOVIET_RED, ai: 'passive', credits: 0 },
    { name: 'Norwegian Home Guard', faction: 'allies', color: 0xe0b030, team: 0, ai: 'passive', credits: 0 },
  ],
  credits: 0,
  parTime: 330,
  allowedBuild: [],
  debrief: {
    speaker: C.saarinen.name, portrait: C.saarinen.portrait,
    win: 'I have my notebooks and my head, Commander, which is more than I expected this morning. Give me a hangar and a year and I will build Looking Glass again.',
    lose: 'Saarinen is lost. Without him there is no Looking Glass, and without Looking Glass there may be no way to end this war.',
  },
  setup(m) {
    m.world.cratesEnabled = false;
    const s = m.start(0), e = m.start(1);
    // research station
    const [, pdox] = layout(m, 0, s, e, [['atek', 0, -3], ['pdox', -1.5, 1.5], ['powr', -4, -4], ['powr', -4.5, 1], ['dome', 1.5, 5]]);
    m.flags.pdox = pdox?.id;
    const team = squad(m, 0, ['e6', 'e6', 'e6'], s, e, 2.5, -0.5);
    m.flags.saarinen = team[0].id;
    m.flags.team = ids(team);
    const apcs = squad(m, 0, ['apc', 'apc'], s, e, 5, -2);
    m.flags.apcs = ids(apcs);
    // (campaign difficulty: up to Normal a fourth Medium Tank rides with the escort; measured, the casual pilot lost
    // Saarinen in five runs of eight at Normal with three, two heavy tanks wait on the road)
    squad(m, 0, m.tightened ? ['2tnk', '2tnk', '2tnk', 'jeep'] : ['2tnk', '2tnk', '2tnk', '2tnk', 'jeep'], s, e, 7, 2);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e3', 'e3'], s, e, 5, 4.5);
    // Home Guard harbour
    const hg = layout(m, 2, e, s, [['tent', 0, 0], ['powr', -2.5, 3], ['pbox', 6, 2.5], ['pbox', 6, -2.5], ['gun', 5, 5.5], ['gun', 5, -5.5]]);
    m.flags.homeguard = ids(hg.filter((b): b is Building => !!b));
    squad(m, 2, ['e1', 'e1', 'e1', 'e1', 'e3', 'e3', 'jeep'], e, s, 3.5, 0);
    // Soviet drop zone on the flank, and ambushes along the road
    const dz = m.between(s, e, 0.55, 18);
    layout(m, 1, ground(m, dz[0], dz[1]), s, [['barr', 0, 0], ['powr', -2, 3], ['ftur', 3, 0]]);
    squad(m, 1, ['e1', 'e1', 'e2'], ground(m, dz[0], dz[1]), s, 2, 2);
    const a1 = m.between(s, e, 0.33, 5), a2 = m.between(s, e, 0.58, -5), a3 = m.between(s, e, 0.62, 6);
    squad(m, 1, ['e1', 'e1', 'e3', 'e3', 'e2'], ground(m, a1[0], a1[1]), s);
    squad(m, 1, ['e3', 'e3', 'e1', 'e1', '3tnk'], ground(m, a2[0], a2[1]), s);
    squad(m, 1, ['3tnk', 'e2', 'e2', 'e3', 'dog', 'dog'], ground(m, a3[0], a3[1]), s);
    m.flags.lz = ground(m, e.x, e.y + 3);
    m.objective('board', 'Load Dr. Saarinen\'s team into the APCs');
    m.objective('harbour', 'Bring Dr. Saarinen to the harbour');
    m.objective('team', 'Evacuate all three researchers', false);
    m.objective('scuttle', 'Scuttle the Chronosphere prototype (sell it or force-fire on it)', false);
    m.progress('board', '0 / 3');
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    if (m.after(1, 'hello')) {
      say(m, C.brandt, 'Soviet paratroopers are all over the plateau. Get Saarinen and his people into the APCs and run for the harbour. The Home Guard is holding a boat.');
      say(m, C.saarinen, 'We are ready, Commander. I have my notebooks... Ah. They are in my coat. Good.');
    }
    // research team status
    const team: number[] = m.flags.team;
    const alive = team.filter((id) => m.alive(id));
    const aboard = alive.filter((id) => (m.world.getEntity(id) as Unit).transport).length;
    if (!m.isDone('board')) {
      m.progress('board', `${aboard} / ${alive.length}`);
      if (alive.length && aboard === alive.length) {
        m.complete('board');
        say(m, C.saarinen, 'Everyone is aboard. Please drive... sensibly.');
      }
    }
    if (!m.alive(m.flags.saarinen) && m.once('saarinenDead')) {
      m.fail('harbour');
      m.lose('Dr. Saarinen has been killed.');
      return;
    }
    if (alive.length < 3 && m.objectives.find((o) => o.id === 'team')?.state === 'active') {
      m.fail('team');
      if (m.once('lostOne')) say(m, C.saarinen, 'Henrik! No... Commander, please, keep the others alive.');
    }
    // paratroopers on the station
    if (m.after(25, 'drop1')) {
      const [x, y] = m.toward(s, e, 13, 7);
      huntWave(m, 1, ['e1', 'e1', 'e1', 'e2', 'e2', 'dog', 'dog'], ground(m, x, y), [s.x, s.y]);
      say(m, C.brandt, 'Paratroopers landing north of the station!');
    }
    const sPos = whereIs(m, m.flags.saarinen);
    if (m.time > 70 && m.every(55, 'waves') && sPos && !m.flags.betrayed) {
      const n = Math.floor(m.time / 55);
      const from = edgeNear(m, ...m.toward(sPos, e, 12, n % 2 ? 18 : -18));
      huntWave(m, 1, ['e1', 'e1', 'e3', 'e3', 'e2', ...(n >= 2 ? ['3tnk'] : []), ...(n >= 4 ? ['3tnk', 'e2'] : [])], from, [sPos.x, sPos.y]);
    }
    hunt(m, 'hunters', 8);
    // the Chronosphere prototype: scuttle (optional) or, if charged, the easter egg
    const pdox = entity<Building>(m, m.flags.pdox);
    if (m.flags.pdox && !pdox && m.once('scuttled')) {
      m.complete('scuttle');
      say(m, C.saarinen, 'The prototype is gone. Good. Whatever happens to us now, they will not have it.');
    }
    if (pdox && pdox.owner === m.human && m.superState(0, 'chrono')?.ready && m.once('chronoHint')) {
      say(m, C.saarinen, 'Commander! The prototype is charged. It can carry one vehicle anywhere you can see. An APC, for instance...');
    }
    // the betrayal
    if (!m.flags.betrayed && sPos && (m.dist(sPos, e) < 21 || m.time > 540)) {
      m.flags.betrayed = true;
      m.setTeam(2, 1);
      addHunters(m, m.army(2).filter((u) => u.kind !== 'aircraft'));
      huntWave(m, 1, ['3tnk', '3tnk', '3tnk', 'e1', 'e1', 'e3', 'e3'], edgeNear(m, e.x, e.y), [sPos.x, sPos.y]);
      say(m, C.brandt, 'Commander, abort the harbour! Colonel Lindqvist sold the route to Moscow. The Home Guard guns are turning on you!');
      say(m, C.morozov, 'Every man has a price, Commander. The colonel\'s was disappointingly low.');
      const corners: [number, number][] = [[6, 6], [m.mapW - 6, m.mapH - 6]];
      const alt = corners.sort((a, b) => Math.hypot(a[0] - e.x, a[1] - e.y) - Math.hypot(b[0] - e.x, b[1] - e.y))
        .find((c) => Math.hypot(c[0] - s.x, c[1] - s.y) > 30) ?? corners[0];
      m.flags.lz = ground(m, alt[0], alt[1]);
      m.retext('harbour', 'Get Dr. Saarinen to Hollander\'s seaplane at the inlet');
      m.reveal(0, m.flags.lz[0], m.flags.lz[1], 5);
      say(m, C.hollander, 'Hollander here. I can set the seaplane down in the inlet. Get the doctor to me and I will do the rest.');
    }
    // extraction
    const lz = m.flags.lz as [number, number];
    if (sPos && Math.hypot(sPos.x - lz[0], sPos.y - lz[1]) < 3.5 && m.once('out')) {
      if (m.objectives.find((o) => o.id === 'team')?.state === 'active') m.complete('team');
      if (m.objectives.find((o) => o.id === 'scuttle')?.state === 'active' && pdox) m.fail('scuttle');
      m.complete('harbour');
      m.complete('board');
      say(m, C.hollander, 'The doctor is aboard. Hold on to your notebooks, sir. We are going low and fast.');
      m.win();
    }
  },
};

// =====================================================================================================
// 5. DRY SEASON — destroy every Soviet ore truck in the desert before the reserve arrives
// =====================================================================================================
const DRY_SEASON: MissionDef = {
  id: 'allied-05',
  campaign: 'allies',
  index: 5,
  title: 'Dry Season',
  codename: 'EMPTY BELLY',
  location: 'Konya Plain, Anatolia',
  date: '19 May 1953 · 12:40',
  briefing: [
    'Morozov\'s southern army has pushed through the Caucasus into Turkey, and it runs on Anatolian ore. Its refineries on the Konya plain are fed by a fleet of ore trucks.',
    'Kill the trucks and the southern offensive starves. You have until their armoured reserve arrives to escort them: fifteen minutes, less if the front is hotter than we think.',
    'New equipment has reached the theatre: Medium Tanks, artillery and Longbow helicopters. Ore trucks are tough. Bring enough guns.',
  ],
  tips: [
    'Longbow helicopters are ideal truck hunters, but they need a Helipad to rearm and fear SAM sites.',
    'Ore trucks are heavily armoured. Medium Tanks and Longbows kill them fastest.',
    'Trucks travel between the refineries and the ore fields. Wait for them in the open.',
  ],
  map: { size: 88, seed: 2207, players: 2, water: 0.15, trees: 0.4, ore: 0.9, climate: 'desert', hour: 12.6, dayCycle: true, weather: 'dust' },
  players: [
    { name: 'Allied Southern Command', faction: 'allies', color: ALLIED_BLUE },
    { name: 'Soviet Southern Front', faction: 'soviet', color: SOVIET_RED, ai: 'defensive', credits: 1000 },
  ],
  credits: 7500,
  parTime: 600,
  allowedBuild: AT5,
  debrief: {
    speaker: C.brandt.name, portrait: C.brandt.portrait,
    win: 'Without the Konya ore, the southern front has stopped dead. Their tanks are sitting in the sand waiting for fuel that is not coming. Elegant work.',
    lose: 'The armoured reserve arrived and the trucks are rolling again. The southern front will be in Ankara within the month.',
  },
  setup(m) {
    const s = m.start(0), e = m.start(1);
    m.spawnUnit(0, 'mcv', s.x, s.y, Math.atan2(e.y - s.y, e.x - s.x));
    squad(m, 0, ['jeep', 'jeep', '1tnk', '1tnk', '2tnk', '2tnk'], s, e, 4, 0);
    squad(m, 0, ['e1', 'e1', 'e1', 'e3', 'e3', 'e6'], s, e, 2.5, 4);
    // Soviet southern base in the corner; it cannot replace trucks, refineries, heavy armour or aircraft
    m.player(1).allowedTypes = allExcept('harv', 'proc', 'mslo', 'iron', '4tnk', 'v2rl', 'stek', 'afld', 'hpad', 'mig', 'yak', 'hind');
    aiProfile(m, 1, 'easy', 'defensive');
    m.player(1).incomeBias = 0.3; // most of the ore is shipped south to the front
    layout(m, 1, e, s, [
      ['fact', 0, 0], ['powr', -3.5, 3], ['powr', -3.5, -3], ['powr', -1, 6], ['powr', -1, -6], ['barr', 4, 2], ['weap', 2, -2.5], ['dome', -4, 0],
      ['ftur', 9, 3], ['ftur', 9, -3], ['tsla', 8, 0], ['sam', 6, 7], ['sam', 6, -7],
    ]);
    // the mining camp in the middle of the plain
    const mid = ground(m, m.mapW / 2 + (e.x - s.x) * 0.06, m.mapH / 2 + (e.y - s.y) * 0.06, 6);
    const camp = layout(m, 1, mid, e, [['proc', 0, 4], ['proc', 0, -4], ['ftur', -4, 0], ['sam', 3, 0], ['silo', 1.5, 7], ['silo', 1.5, -7]]);
    const procs = camp.filter((b): b is Building => !!b && b.bt.id === 'proc');
    m.flags.procs = ids(procs);
    m.flags.camp = mid;
    const harvs: Unit[] = [];
    const escorts: [number, number][] = [];
    for (const p of procs) {
      for (let k = 0; k < 3; k++) harvs.push(m.spawnUnit(1, 'harv', p.x + k - 1, p.cy + p.h + 1));
      const g = m.spawnUnit(1, '3tnk', p.x, p.cy + p.h + 2.5);
      escorts.push([g.id, harvs[harvs.length - 2].id]);
    }
    m.flags.harvs = ids(harvs);
    m.flags.escorts = escorts;
    m.flags.total = harvs.length;
    squad(m, 1, ['e1', 'e1', 'e1', 'e2', 'e2', 'e3', '3tnk', '3tnk'], e, s, 6, 0);
    squad(m, 1, ['e1', 'e1', 'e3', 'e3'], mid, s, 3, 0);
    m.objective('trucks', 'Destroy every Soviet ore truck');
    m.objective('refineries', 'Destroy both refineries at the mining camp', false);
    // (campaign difficulty: the reserve comes sooner at Hard and Brutal; with the trucks kept in the open, fifteen
    // minutes left Brutal to the casual stand-in in eight runs of eight)
    m.startTimer('reserve', m.byLevel(900, { hard: 780, brutal: 600 }), 'Armoured reserve');
    m.reveal(0, mid[0], mid[1], 8);
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    if (m.after(1, 'hello')) {
      say(m, C.brandt, 'Six ore trucks working a mining camp in the middle of the plain, two heavy tanks riding shotgun. Their main base is in the far corner and well defended. You do not need the base. You need the trucks.');
      say(m, C.rourke, m.byLevel('Fifteen minutes, Commander. After that their reserve arrives and this becomes a very different fight.', {
        hard: 'Thirteen minutes, Commander: the reserve is moving early. After that this becomes a very different fight.',
        brutal: 'Ten minutes, Commander: the reserve is already on the road. After that this becomes a very different fight.',
      }));
    }
    // track all harvesters of the southern front (convoy trucks included)
    const all = m.units(1, 'harv');
    const known: number[] = m.flags.harvs;
    for (const h of all) if (!known.includes(h.id)) { known.push(h.id); m.flags.total++; }
    const left = m.livingUnits(known).length;
    const killed = m.flags.total - left;
    m.progress('trucks', `${killed} / ${m.flags.total}`);
    // escorts shadow their trucks
    if (m.every(3, 'escort')) {
      for (const [g, h] of m.flags.escorts as [number, number][]) {
        const guard = entity<Unit>(m, g);
        let ward = entity<Unit>(m, h);
        if (!ward) ward = m.nearest(m.livingUnits(known), guard?.x ?? 0, guard?.y ?? 0);
        if (guard && ward) escort(m, [guard], ward, 3.5);
      }
    }
    // the trucks work the plain, as the briefing says: one that drifts onto the ore under the main base's guns is sent
    // back to the camp's fields (a last truck parked in the base made the mission a base assault after all)
    if (m.every(5, 'plain')) {
      const [cx, cy] = m.flags.camp as [number, number];
      for (const h of m.livingUnits(known)) {
        if (m.dist(h, e) < 16 && Math.hypot(h.x - cx, h.y - cy) > 12) m.world.issue({ c: 'harvest', player: 1, units: [h.id], x: cx, y: cy });
      }
    }
    // the convoy twist
    const convoyNow = m.time > 330 || (left === 0 && !m.flags.convoy);
    if (convoyNow && !m.flags.convoy) {
      m.flags.convoy = true;
      const from = edgeNear(m, m.mapW, e.y + m.mapH * 0.35);
      const trucks = m.spawnGroup(1, ['harv', 'harv', 'harv'], from[0], from[1]);
      const guards = m.spawnGroup(1, ['3tnk', '3tnk'], from[0] - 1, from[1] - 1);
      const proc = m.nearest(m.living(m.flags.procs) as Building[], from[0], from[1]);
      const camp = m.flags.camp as [number, number];
      const to = proc ? [proc.x, proc.y + 2] : camp;
      m.move(trucks, to[0], to[1], false);
      m.move(guards, to[0], to[1], true);
      for (let k = 0; k < guards.length; k++) (m.flags.escorts as [number, number][]).push([guards[k].id, trucks[k].id]);
      m.reveal(0, from[0], from[1], 6);
      m.camera(from[0], from[1]);
      say(m, C.brandt, 'Wait. Three more trucks coming in from the eastern road with an escort. Somebody in Moscow is nervous. Good.');
    }
    if (killed >= 5 && m.once('counter')) {
      say(m, C.morozov, 'You are starving my army, Commander? Then I will come and eat yours.');
      m.flags.sortieAt = m.time + 25;
    }
    if (m.flags.sortieAt && m.time >= m.flags.sortieAt && m.once('sortie')) {
      say(m, C.brandt, 'The garrison is sortieing from their base, heading for yours. Brace!');
      const sortie = m.army(1).filter((u) => u.kind !== 'aircraft' && m.dist(u, e) < 16).slice(0, 5);
      addHunters(m, sortie);
      m.move(sortie, s.x, s.y, true);
      huntWave(m, 1, ['3tnk', 'e1', 'e1', 'e2', 'e2', 'e3'], edgeNear(m, e.x, m.mapH * 0.5), [s.x, s.y]);
    }
    hunt(m, 'hunters', 10);
    if (m.after(420, 'hint') && killed < 3) say(m, C.rourke, 'The clock is running, Commander. Medium Tanks and Longbows. Go hunting.');
    // refineries optional
    if (!m.living(m.flags.procs).length && m.once('procsDown')) {
      m.complete('refineries');
      say(m, C.rourke, 'Both refineries burning. They will not be mining anything for a while.');
    }
    if (m.flags.convoy && left === 0 && m.once('won')) {
      m.complete('trucks');
      if (m.living(m.flags.procs).length) m.fail('refineries');
      say(m, C.brandt, 'That was the last truck. The southern front has just run out of breakfast, lunch and dinner.');
      m.win();
      return;
    }
    if (m.timerDone('reserve') && m.once('late')) {
      m.fail('trucks');
      m.lose('The Soviet armoured reserve has arrived. The trucks are rolling again.');
    }
  },
};

// =====================================================================================================
// 6. MIDNIGHT LAUNCH — stop the missile silo before the countdown ends
// =====================================================================================================
const LAUNCH_SECONDS = 1200;
const MIDNIGHT: MissionDef = {
  id: 'allied-06',
  campaign: 'allies',
  index: 6,
  title: 'Midnight Launch',
  codename: 'BROKEN ARROW',
  location: 'Rügen Island, Baltic Coast',
  date: '6 June 1953 · 23:30',
  briefing: [
    'Morozov\'s offensive has stalled on the Rhine, so Moscow has decided to end the argument. A missile silo on Rügen Island has been armed with an atomic warhead. The target is Hamburg.',
    'Launch is in twenty minutes. The silo sits at the back of a fortress ringed by Tesla Coils, flame towers and SAM sites.',
    'The island has no grid of its own: everything runs off a generator yard on the fortress flank. Knock it out and the coils go dark and the launch sequence crawls. It will not stop it. Only you can do that.',
  ],
  tips: [
    'While the fortress is low on power the countdown runs at a quarter of its speed and the Tesla Coils are silent.',
    'Tesla Coils outrange everything you have. Go for the generator yard first.',
    'Longbows should stay clear of SAM sites.',
    'Kestrel\'s C4 destroys any structure, the silo included. Get her there alive.',
  ],
  map: { size: 96, seed: 6061, players: 2, water: 0.35, trees: 0.55, ore: 0.75, climate: 'temperate', hour: 23.5, dayCycle: false, weather: 'fog' },
  players: [
    { name: 'Allied Strike Force', faction: 'allies', color: ALLIED_BLUE },
    { name: 'Soviet Baltic Fortress', faction: 'soviet', color: SOVIET_RED, ai: 'defensive', credits: 1500 },
  ],
  credits: 7000,
  parTime: 1080,
  allowedBuild: AT6,
  debrief: {
    speaker: C.rourke.name, portrait: C.rourke.portrait,
    win: 'Hamburg will never know how close it came. I would like it to stay that way. Officially, Commander, tonight did not happen.',
    lose: 'The missile is away. God help Hamburg.',
  },
  setup(m) {
    const s = m.start(0), e = m.start(1);
    m.spawnUnit(0, 'mcv', s.x, s.y, Math.atan2(e.y - s.y, e.x - s.x));
    squad(m, 0, ['2tnk', '2tnk', '2tnk', '2tnk', '1tnk', '1tnk', 'jeep'], s, e, 4.5, 0);
    squad(m, 0, ['arty', 'arty'], s, e, 1, -4);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e1', 'e1', 'e3', 'e3', 'e3', 'e6', 'medi'], s, e, 2.5, 4.5);
    // the fortress cannot build power, refineries, vehicles or aircraft: what it has is what you face (plus infantry)
    m.player(1).allowedTypes = allExcept('mslo', 'iron', '4tnk', '3tnk', 'v2rl', 'harv', 'mcv', 'afld', 'hpad', 'mig', 'yak', 'hind', 'powr', 'apwr', 'proc', 'silo', 'weap');
    aiProfile(m, 1, 'easy', 'defensive');
    // the fortress core (campaign difficulty: on the easy levels the coils were never finished, and one flame tower guards the gate)
    const coils: [string, number, number][] = m.eased ? [['ftur', 12, 0]] : [['tsla', 10, 0], ['tsla', 9, -5.5], ['ftur', 12, 3], ['ftur', 12, -3]];
    const built = layout(m, 1, e, s, [
      ['fact', 0, 0], ['mslo', -5, -1], ['proc', 3, -7.5], ['barr', 4, 2.5], ['weap', 3, -2.5], ['dome', -2, 3], ['stek', -2, -4], ['kenn', 6, 4.5],
      ...coils, ['sam', 7, -10], ['sam', 5, 8],
    ]);
    // the generator yard on the flank
    const yard = layout(m, 1, e, s, [['apwr', 3, 13], ['apwr', 6.5, 16.5], ['apwr', -0.5, 16.5], ['apwr', 3, 20], ['ftur', 9.5, 13], ['ftur', 8, 20]]);
    const silo = built.find((b) => b?.bt.id === 'mslo') ?? null;
    m.flags.silo = silo?.id;
    m.flags.yard = ids(yard.filter((b): b is Building => !!b && b.bt.id !== 'ftur'));
    for (const p of built) if (p?.bt.id === 'proc') m.spawnUnit(1, 'harv', p.x, p.cy + p.h + 1);
    squad(m, 1, m.eased ? ['3tnk', 'v2rl'] : ['3tnk', '3tnk', '3tnk', 'v2rl'], e, s, 8, -2);
    if (!m.eased) squad(m, 1, ['3tnk', 'v2rl'], e, s, 3, -9);
    squad(m, 1, m.eased ? ['e1', 'e1', 'e2', 'e3'] : ['e1', 'e1', 'e1', 'e2', 'e2', 'e3', 'dog', 'dog'], e, s, 7, 4);
    squad(m, 1, ['e1', 'e1', 'e2', 'e4'], e, s, 8, 15);
    if (m.eased) m.player(1).cash = 500;
    m.setSuperCharge(1, 'nuke', -100000);
    m.flags.left = LAUNCH_SECONDS;
    m.objective('silo', 'Destroy the Missile Silo before launch');
    m.objective('power', 'Destroy every Soviet power plant', false);
    m.objective('kestrel', 'Keep Kestrel alive', false);
    m.startTimer('launch', LAUNCH_SECONDS, 'Missile launch');
    if (silo) m.reveal(0, silo.x, silo.y, 3);
    const yc = centroid(yard.filter((b): b is Building => !!b));
    m.reveal(0, yc.x, yc.y, 4);
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    if (m.after(1, 'hello')) {
      say(m, C.rourke, 'Twenty minutes, Commander. I will not insult you with a speech. Get to that silo.');
      say(m, C.brandt, m.eased
        ? 'One piece of luck: the fortress Tesla Coils were never finished, only a flame tower guards the gate. The generator yard is on the flank: kill the power and the launch sequence slows to a crawl.'
        : 'The generator yard is on the fortress flank. Kill the power and the coils go dark, and the launch sequence slows to a crawl.');
    }
    const silo = entity<Building>(m, m.flags.silo);
    // scripted launch countdown: a quarter speed while the fortress is low on power
    if (silo && !m.flags.launched) {
      const low = m.player(1).lowPower;
      m.flags.left -= (low ? 0.25 : 1) / 20;
      m.setTimeLeft('launch', Math.max(0, m.flags.left));
      if (low !== !!m.flags.paused) {
        m.flags.paused = low;
        // (once: a fortress grid at the edge of its power flickers in and out as plants take damage, and the line repeated)
        if (low && m.once('gridDown')) say(m, C.brandt, 'Their grid is down! The coils are dark and the launch sequence has slowed to a crawl. Keep it that way.');
      }
      if (m.flags.left <= 0 && m.once('launch')) {
        m.flags.launched = m.time;
        m.nuke(1, s.x, s.y, [silo.x, silo.y]);
        say(m, C.brandt, 'Launch detected! It is away...');
      }
    }
    if (m.flags.launched && m.time > m.flags.launched + 7 && m.once('lost')) {
      m.fail('silo');
      m.lose('The missile has launched.');
      return;
    }
    if (m.flags.silo && !silo && !m.flags.launched && m.once('siloDown')) {
      m.complete('silo');
      m.clearTimer('launch');
      if (m.state('power') === 'active') m.fail('power');
      if (m.flags.kestrel && m.alive(m.flags.kestrel)) m.complete('kestrel');
      else m.fail('kestrel');
      say(m, C.rourke, 'The silo is gone. Hamburg will never know how close it came, and I would like it to stay that way.');
      say(m, C.brandt, 'Officially, the explosion on Rügen was a gas main. I have already written the press release.');
      m.win();
      return;
    }
    // the easy levels: a second armoured column lands at eight minutes
    if (m.eased && m.after(480, 'column')) {
      m.reinforce(0, ['2tnk', '2tnk', '2tnk', 'arty'], edgeNear(m, s.x, s.y), m.toward(s, e, 5), false);
      say(m, C.rourke, 'Commander, a second armoured column has landed behind you: three Mediums and a gun. Use them on that silo.');
    }
    // Kestrel joins
    if (m.after(240, 'kestrel')) {
      const [x, y] = ground(m, ...m.toward(s, e, 6, -3));
      const k = m.spawnUnit(0, 'e7', x, y);
      m.flags.kestrel = k.id;
      say(m, C.kestrel, 'Miss me? I hear somebody needs a silo taken apart.');
    }
    if (m.flags.kestrel && !m.alive(m.flags.kestrel) && m.once('kestrelDown')) {
      m.fail('kestrel');
      say(m, C.brandt, 'We have lost Kestrel\'s signal.');
    }
    // raids from the fortress while the countdown runs
    const raids = m.byLevel<[number, string[]][]>([[240, ['e1', 'e1', 'e1', 'e2', 'e2', 'dog', 'dog']], [520, ['3tnk', 'v2rl', 'e1', 'e1', 'e1', 'e3']], [840, ['3tnk', '3tnk', 'e1', 'e1', 'e2', 'e4']]], {
      recruit: [[300, ['e1', 'e1', 'e2']], [600, ['e1', 'e1', 'e1', 'e3']], [900, ['3tnk', 'e1', 'e1']]],
      easy: [[270, ['e1', 'e1', 'e1', 'e2', 'dog']], [560, ['3tnk', 'e1', 'e1', 'e3']], [880, ['3tnk', 'e1', 'e1', 'e2', 'e4']]],
    });
    for (const [t, types] of raids) {
      if (m.after(t, 'raid' + t) && structures(m, 1).length) huntWave(m, 1, types, edgeNear(m, ...m.toward(e, s, 14, t === 450 ? 16 : -16)), [s.x, s.y]);
    }
    // counterattack when the silo is first hit or at ten minutes
    if (!m.flags.counter && silo && (silo.hp < silo.maxHp || m.time > 660)) {
      m.flags.counter = true;
      say(m, C.morozov, 'You want my missile, Commander? Then come and take it. I will send you an escort.');
      huntWave(m, 1, m.byLevel(['3tnk', '3tnk', 'v2rl', 'e1', 'e1', 'e1', 'e2', 'e2'], { recruit: ['3tnk', 'e1', 'e1', 'e1'], easy: ['3tnk', '3tnk', 'e1', 'e1', 'e2'] }), edgeNear(m, ...m.toward(e, s, 20, -24)), [s.x, s.y]);
    }
    hunt(m, 'hunters', 10);
    // power plants optional
    const plants = structures(m, 1, ['powr', 'apwr']).length;
    if (!plants && m.once('blackout')) {
      m.complete('power');
      say(m, C.kestrel, 'Lights out on Rügen. Nobody is launching anything tonight. Well, not quickly.');
    }

  },
};

// =====================================================================================================
// 7. DAWNBREAK — final assault on Gorizont-9 (snow, two Soviet bases, an ally, the Chronosphere)
// =====================================================================================================
const DAWNBREAK: MissionDef = {
  id: 'allied-07',
  campaign: 'allies',
  index: 7,
  title: 'Dawnbreak',
  codename: 'DAWNBREAK',
  location: 'Gorizont-9, Kola Peninsula, USSR',
  date: '4 November 1953 · 14:50',
  briefing: [
    'This is the end of it. Gorizont-9 is the closed city where the Horizon Directorate builds Moscow\'s miracles, and where Morozov has gathered what is left of his army.',
    'Two fortresses: Morozov\'s Northern Front in the far corner, the Directorate under Commissar Orlova on your flank. The Free Polish Armoured Brigade is attacking alongside you.',
    'Dr. Saarinen has rebuilt Looking Glass. Your forward base has a working Chronosphere. Use it. Polar night is falling; finish this before the dark does.',
  ],
  tips: [
    'The Chronosphere teleports one vehicle anywhere you have explored. Drop tanks behind their defences.',
    'The Directorate has an atomic missile. A countdown appears once it is rearming.',
    'Morozov will use his Iron Curtain on his armour. Fall back when his tanks glow, and come back when it fades.',
  ],
  map: { size: 112, seed: 1953, players: 4, water: 0.3, trees: 0.6, ore: 0.8, climate: 'winter', hour: 14.8, dayCycle: true, weather: 'snow' },
  players: [
    { name: 'Allied Northern Army', faction: 'allies', color: ALLIED_BLUE },
    { name: 'Soviet Northern Front', faction: 'soviet', color: SOVIET_RED, ai: 'normal', credits: 2000 },
    { name: 'Horizon Directorate', faction: 'soviet', color: 0x8e4fd0, team: 1, ai: 'defensive', credits: 2000 },
    { name: 'Free Polish Armoured Brigade', faction: 'allies', color: 0xe0b030, team: 0, ai: 'normal', credits: 4000 },
  ],
  credits: 8000,
  parTime: 1500,
  allowedBuild: AT7,
  debrief: {
    speaker: C.saarinen.name, portrait: C.saarinen.portrait,
    win: 'Field Marshal... the Chronosphere has registered an arrival. Not a departure, an arrival. Nothing of ours was sent. Something came through.',
    lose: 'Gorizont-9 still stands, and the Directorate still has its missile. We will not get another army this far north.',
  },
  setup(m) {
    const s = m.start(0), mo = m.start(1), di = m.start(2), pl = m.start(3);
    const center = { x: m.mapW / 2, y: m.mapH / 2 };
    // our forward base
    const ours = layout(m, 0, s, center, [
      ['fact', 0, 0], ['apwr', -4, 3], ['apwr', -4, -3.5], ['powr', -1, 6.5], ['powr', -1, -7], ['powr', -6.5, 0], ['tent', 3.5, -3.5], ['weap', 3.5, 3],
      ['proc', 0, 10], ['dome', 1, -10], ['atek', -3, -8.5], ['pdox', -3.5, 8.5], ['hpad', 6, -7.5], ['gun', 9, -2], ['gun', 9, 3], ['agun', 7, 7],
      ['gun', 4, 12], ['pbox', 7, 10], ['gun', 6, -12], ['pbox', 9, -8], ['apwr', -7, -5],
    ]);
    for (const p of ours) if (p?.bt.id === 'proc') for (let k = 0; k < 2; k++) m.spawnUnit(0, 'harv', p.x + k, p.cy + p.h + 1);
    squad(m, 0, ['2tnk', '2tnk', '2tnk', '2tnk', '2tnk', '2tnk', '1tnk', '1tnk', 'jeep', 'jeep'], s, center, 9, 0);
    squad(m, 0, ['arty', 'arty', 'arty'], s, center, 6, -6);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'e1', 'e1', 'e3', 'e3', 'e3', 'e3', 'medi', 'medi', 'e6', 'e6'], s, center, 7, 6);
    const kes = squad(m, 0, ['e7'], s, center, 5, 3);
    m.flags.kestrel = kes[0].id;
    m.setSuperCharge(0, 'chrono', 240); // Saarinen arrives with Looking Glass fully charged
    // Morozov's Northern Front
    const mb = layout(m, 1, mo, center, [
      ['fact', 0, 0], ['apwr', -4, 3.5], ['apwr', -4, -3.5], ['apwr', -1, 7], ['apwr', -1, -7], ['powr', -7, 0],
      ['proc', 3.5, 8], ['proc', 3.5, -8], ['barr', 4, 2.5], ['weap', 3.5, -2.5], ['weap', 1, -12], ['dome', -2, 2.5], ['stek', -3, -9.5], ['iron', -6.5, 5],
      ['afld', 0, 11], ['tsla', 10, 0], ['tsla', 9, 6], ['ftur', 11, 3.5], ['ftur', 11, -3.5], ['sam', 7, 9], ['sam', 7, -9],
    ]);
    for (const p of mb) if (p?.bt.id === 'proc') m.spawnUnit(1, 'harv', p.x, p.cy + p.h + 1);
    squad(m, 1, ['3tnk', '3tnk', '3tnk', '4tnk', '4tnk', 'v2rl'], mo, center, 9, 0);
    squad(m, 1, ['e1', 'e1', 'e1', 'e1', 'e2', 'e2', 'e3', 'e3', 'e4', 'dog', 'dog'], mo, center, 8, 5);
    m.flags.moStart = mb.filter((b) => !!b).length;
    // Horizon Directorate
    const db = layout(m, 2, di, center, [
      ['fact', 0, 0], ['apwr', -4, 3.5], ['apwr', -4, -3.5], ['apwr', -1, 7], ['powr', -1, -7], ['mslo', -6.5, 0],
      ['proc', 4, 7.5], ['barr', 4, 2.5], ['weap', 3.5, -2.5], ['dome', -1.5, -10], ['stek', -2, 2.5],
      ['tsla', 9, 0], ['tsla', 8, 5], ['tsla', 8, -5], ['sam', 6, 9], ['ftur', 10, -3],
    ]);
    for (const p of db) if (p?.bt.id === 'proc') for (let k = 0; k < 2; k++) m.spawnUnit(2, 'harv', p.x + k, p.cy + p.h + 1);
    m.flags.silo = db.find((b) => b?.bt.id === 'mslo')?.id;
    squad(m, 2, ['3tnk', '3tnk', '3tnk', 'v2rl'], di, center, 8, 0);
    squad(m, 2, ['e1', 'e1', 'e1', 'e2', 'e3', 'e4', 'e4'], di, center, 7, -4);
    m.setSuperCharge(2, 'nuke', 300 - 175);
    // Free Polish Brigade
    const pb = layout(m, 3, pl, center, [
      ['fact', 0, 0], ['powr', -3.5, 3], ['powr', -3.5, -3], ['powr', -1, 6.5], ['tent', 3.5, 2.5], ['weap', 3.5, -2.5], ['proc', 0, -8],
      ['pbox', 8, 2], ['gun', 8, -2], ['gun', 7, 5],
    ]);
    for (const p of pb) if (p?.bt.id === 'proc') for (let k = 0; k < 2; k++) m.spawnUnit(3, 'harv', p.x + k, p.cy + p.h + 1);
    m.flags.polishFact = pb[0]?.id;
    squad(m, 3, ['2tnk', '2tnk', '2tnk', '1tnk', 'e1', 'e1', 'e1', 'e3'], pl, center, 7, 0);
    // the Soviets are cut off: no new refineries or ore trucks, no new silos
    for (const p of [1, 2]) m.player(p).allowedTypes = allExcept('mslo', 'proc', 'harv', '4tnk');
    // (campaign difficulty: at Hard and Brutal Morozov plays at Recruit: with the enemy's handicap his Easy commander's
    // waves flattened the base while the army was away, the expert autopilot won 2 runs in 8 at Hard, none at Brutal)
    aiProfile(m, 1, m.tightened ? 'recruit' : 'easy');
    m.objective('morozov', 'Destroy Morozov\'s Northern Front');
    m.objective('directorate', 'Destroy the Horizon Directorate');
    m.objective('silo', 'Destroy the Directorate missile silo', false);
    m.objective('kestrel', 'Keep Kestrel alive', false);
    m.revealAll(0);
  },
  update(m) {
    const s = m.start(0);
    if (m.after(1, 'hello')) {
      say(m, C.rourke, 'This is it, Commander. Everything Morozov has left is in this valley. So is everything we have.');
      say(m, C.saarinen, 'Looking Glass is charged and stable. One vehicle at a time, anywhere you can see. Please bring them back in one piece.');
    }
    if (m.after(60, 'kes')) say(m, C.kestrel, 'Cold enough to freeze the C4. Point me at something expensive.');
    // the nuke on the Polish brigade
    const silo = entity<Building>(m, m.flags.silo);
    if (m.after(178, 'nukePoles') && silo) {
      const f = entity<Building>(m, m.flags.polishFact);
      const t = f ?? (structures(m, 3)[0] ?? null);
      if (t) {
        m.nuke(2, t.x, t.y);
        say(m, C.orlovaEnemy, 'This is Commissar Orlova of the Horizon Directorate. Consider this a demonstration.');
      }
    }
    if (m.after(186, 'nukeTalk') && silo) {
      say(m, C.brandt, 'Nuclear detonation on the Polish lines! The Directorate silo will be ready again in five minutes, and next time it will be us.');
      m.reveal(0, silo.x, silo.y, 4);
    }
    if (silo && m.time > 186) {
      const st = m.superState(2, 'nuke');
      if (st && !st.ready) {
        if (!m.flags.siloTimer) { m.flags.siloTimer = true; m.startTimer('silo', st.left, 'Directorate missile'); }
        if (m.every(1, 'siloSync')) m.setTimeLeft('silo', st.left);
      }
    }
    if (m.flags.silo && !silo && m.once('siloDown')) {
      m.complete('silo');
      m.clearTimer('silo');
      say(m, C.rourke, 'The silo is gone. No more demonstrations.');
    }
    // Orlova turns on Morozov
    const mo = structures(m, 1).length, di = structures(m, 2).length;
    if (!m.flags.diStart) m.flags.diStart = Math.max(1, di);
    if (!m.flags.coup && (mo <= m.flags.moStart * 0.6 || di <= m.flags.diStart * 0.6 || m.time > 720) && di > 0 && mo > 0) {
      m.flags.coup = true;
      m.setTeam(2, 2);
      m.setAI(2, 'normal');
      say(m, C.morozov, 'Orlova! Send the Directorate reserve to my sector, now!');
      say(m, C.orlovaEnemy, 'No, General. The reserve is mine. So is the Directorate. So, shortly, is your command.');
      say(m, C.brandt, 'Commander, the Directorate forces just opened fire on Morozov\'s tanks. They are tearing each other apart!');
    }
    if (mo === 0 && m.once('moDown')) {
      m.complete('morozov');
      say(m, C.morozov, 'Commander... you play the game well. Better than I did. Remember that Orlova is not finished with any of us.');
    }
    if (di === 0 && m.once('diDown')) {
      m.complete('directorate');
      say(m, C.brandt, 'The Directorate compound is burning. No sign of Orlova in the wreckage.');
    }
    if ((di === 0 || mo === 0 || m.time > 600) && m.once('lancers')) {
      const from = edgeNear(m, s.x, m.mapH);
      m.reinforce(0, ['2tnk', '2tnk', '2tnk', '2tnk', '2tnk', 'arty', 'arty', 'jeep'], from, m.toward(s, { x: m.mapW / 2, y: m.mapH / 2 }, 8), false);
      say(m, C.rourke, 'Commander, the 1st Armoured has come up the coast road. Five Mediums and two guns are yours. Finish it.');
    }
    m.progress('morozov', `${mo} left`);
    m.progress('directorate', `${di} left`);
    if (m.flags.kestrel && !m.alive(m.flags.kestrel) && m.once('kesDown')) {
      m.fail('kestrel');
      say(m, C.brandt, 'Kestrel is down. God rest her.');
    }
    if (m.time > 420 && m.time < 1300 && m.every(420, 'pressure') && di + mo > 0) {
      // the Directorate sends its reserves down the western road
      const from = edgeNear(m, 0, m.mapH * 0.45);
      huntWave(m, di > 0 ? 2 : 1, ['3tnk', '3tnk', 'e1', 'e1', 'e2', 'e2'], from, [s.x, s.y]);
    }
    hunt(m, 'hunters', 10);
    if (mo === 0 && di === 0 && m.once('won')) {
      if (m.alive(m.flags.kestrel)) m.complete('kestrel');
      if (m.objectives.find((o) => o.id === 'silo')?.state === 'active') m.complete('silo');
      say(m, C.rourke, 'Dawnbreak, Commander. It is over. Stand your people down.');
      say(m, C.saarinen, 'Field Marshal... the Chronosphere is registering something. An arrival. We did not send anything.');
      m.win();
    }
  },
};

export const ALLIED_MISSIONS: MissionDef[] = ([GREY_DAWN, KASSEL, KESTREL_NEST, LOOKING_GLASS, DRY_SEASON, MIDNIGHT, DAWNBREAK]).map(quietSetup);

/** Exposed for tools: tech per mission. */
export const ALLIED_TECH = { AT1, AT2, AT5, AT6, AT7 };
export type { MissionRuntime };
