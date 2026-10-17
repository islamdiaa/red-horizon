/**
 * Boot Camp: the interactive tutorial. Nine drills, each unlocking the next: move, fight, deploy,
 * power, ore, infantry, defence, armour and a final assault. Progress is read from the simulation
 * (positions, structures, units), never from UI state, so the drills survive save / load.
 */
import type { MissionDef, MissionRuntime } from '../sim/mission';
import { CAST, centroid, ground, hunt, huntWave, ids, layout, say, squad, type Speaker } from './common';

const ALLIED_BLUE = 0x3d7be0;
const SOVIET_RED = 0xd23a2c;
const SGT: Speaker = { name: 'Sgt. Major Harlan', portrait: 'commander' };

type Step = 'move' | 'fight' | 'deploy' | 'power' | 'ore' | 'infantry' | 'defend' | 'armour' | 'assault' | 'done';

/** Structures and units the player may build, growing drill by drill. */
const UNLOCKS: Partial<Record<Step, string[]>> = {
  power: ['powr'],
  ore: ['proc', 'silo'],
  infantry: ['tent', 'e1', 'e3'],
  defend: ['pbox', 'sbag'],
  armour: ['weap', '1tnk', 'harv'],
  assault: ['2tnk', 'jeep', 'gun'],
};

/**
 * Interface elements the Modern HUD makes glow during each drill (CSS selectors inside #ui): the build
 * cards, their tabs and the order buttons the Sergeant Major is talking about. Purely visual: the drills
 * themselves are still judged from the simulation.
 */
export const BOOT_CAMP_HUD: Partial<Record<string, string[]>> = {
  deploy: ['.cmd[data-key="D"]'],
  power: ['.bitem[data-id="powr"]', '.tab[data-tab="building"]'],
  ore: ['.bitem[data-id="proc"]', '.tab[data-tab="building"]'],
  infantry: ['.bitem[data-id="tent"]', '.bitem[data-id="e1"]', '.tab[data-tab="infantry"]'],
  defend: ['.bitem[data-id="pbox"]', '.tab[data-tab="defense"]'],
  armour: ['.bitem[data-id="weap"]', '.bitem[data-id="1tnk"]', '.tab[data-tab="vehicle"]'],
  assault: ['.cmd[data-key="A"]'],
} satisfies Partial<Record<Step, string[]>>;

function goTo(m: MissionRuntime, step: Step) {
  m.flags.step = step;
  const allowed: string[] = (m.flags.allowed ??= []);
  for (const t of UNLOCKS[step] ?? []) if (!allowed.includes(t)) allowed.push(t);
  m.allowBuild([...allowed]);
}

export const BOOT_CAMP: MissionDef = {
  id: 'bootcamp',
  campaign: 'special',
  index: 0,
  title: 'Boot Camp',
  codename: 'FIRST STEPS',
  location: 'Training Ground Delta, England',
  date: 'March 1953',
  briefing: [
    'Before you take a command at the front, Sergeant Major Harlan will walk you through the basics on the training ground.',
    'Nine short drills: moving and fighting, building a base, earning money from ore, training troops, defending, and leading an assault. Each drill unlocks the next.',
    'Take your time. Nobody is grading the first one, except the Sergeant Major.',
  ],
  tips: [
    'Left-drag to box-select, right-click to move or attack.',
    'Arrow keys, the screen edge or right-drag scroll the map; the mouse wheel zooms.',
    'The build bar at the bottom (the sidebar on the right in the Classic layout) builds structures and trains units.',
  ],
  map: { size: 56, seed: 1201, players: 2, water: 0.2, trees: 0.45, ore: 0.8, climate: 'temperate', hour: 10.5, dayCycle: false, weather: 'clear' },
  players: [
    { name: 'Training Company', faction: 'allies', color: ALLIED_BLUE },
    { name: 'Opposing Force', faction: 'soviet', color: SOVIET_RED, ai: 'passive', credits: 0 },
  ],
  credits: 6000,
  parTime: 900,
  allowedBuild: [],
  debrief: {
    speaker: SGT.name, portrait: SGT.portrait,
    win: 'Not bad at all, Commander. You move, you build, you fight. The front is waiting. Try not to make me regret signing your papers.',
    lose: 'Everybody loses a drill once. Shake it off and run it again. That is what a training ground is for.',
  },
  setup(m) {
    const s = m.start(0), e = m.start(1);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'jeep'], s, e, 0, 0);
    const [bx, by] = ground(m, ...m.toward(s, e, 11));
    m.flags.bx = bx;
    m.flags.by = by;
    m.flags.scouts = ids(squad(m, 1, ['e1', 'e1', 'e1'], s, e, 19, 1));
    // the training camp the player assaults at the end
    const camp = layout(m, 1, e, s, [['barr', 1, 0], ['powr', -2.5, 3.5], ['powr', -2.5, -3.5], ['pbox', 5, 2.5], ['pbox', 5, -2.5]]);
    m.flags.camp = camp.filter(Boolean).map((b) => b!.id);
    squad(m, 1, ['e1', 'e1', 'e1', 'e2'], e, s, 3, 0);
    goTo(m, 'move');
    m.objective('move', 'Move your squad to the flashing beacon');
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    const step = m.flags.step as Step;
    hunt(m);
    if (m.after(1, 'hello')) {
      say(m, SGT, 'Morning, Commander. Sergeant Major Harlan. Today you learn to run a battle. First things first: your squad. Drag a box around them with the left mouse button.');
      say(m, SGT, 'Now right-click near the flashing beacon to move them there. Scroll with the arrow keys or the screen edge, zoom with the wheel.');
    }
    // keep the drills going if the player spends everything
    const me = m.player(0);
    if (step !== 'done' && me.credits < 400 && m.every(20, 'stipend')) {
      m.give(0, 1200);
      say(m, CAST.eva, 'Training funds transferred: $1,200.');
    }
    // losing everything ends the drill
    if (step !== 'move' && step !== 'fight' && step !== 'done' && !m.units(0).length && !m.buildings(0).length) {
      m.lose('Your training company was wiped out.');
      return;
    }

    switch (step) {
      case 'move': {
        if (m.every(2, 'beacon')) m.beacon(m.flags.bx, m.flags.by);
        if (m.unitsNear(0, m.flags.bx, m.flags.by, 3.5).length >= 3) {
          m.complete('move');
          goTo(m, 'fight');
          m.objective('fight', 'Destroy the enemy scouts');
          say(m, SGT, 'Good. Enemy scouts up ahead. Select your squad and right-click one of them to attack. Your men pick the next target on their own.');
        }
        break;
      }
      case 'fight': {
        const scouts = m.livingUnits(m.flags.scouts);
        if (scouts.length && m.every(2, 'beacon')) { const c = centroid(scouts); m.beacon(c.x, c.y); }
        if (!scouts.length) {
          m.complete('fight');
          goTo(m, 'deploy');
          const [x, y] = ground(m, ...m.toward(s, e, -2));
          const mcv = m.spawnUnit(0, 'mcv', x, y, Math.atan2(e.y - s.y, e.x - s.x));
          m.flags.mcv = mcv.id;
          m.camera(x, y);
          m.objective('deploy', 'Deploy the MCV into a Construction Yard');
          say(m, SGT, 'Scouts down. Here comes your MCV, a base on wheels. Select it and press D, or click it a second time, to unpack the Construction Yard.');
        }
        break;
      }
      case 'deploy': {
        const mcv = m.world.getEntity(m.flags.mcv);
        if (mcv?.alive && m.every(2, 'beacon')) m.beacon(mcv.x, mcv.y);
        if (m.buildings(0, 'fact').length) {
          m.complete('deploy');
          goTo(m, 'power');
          m.objective('power', 'Build a Power Plant');
          say(m, SGT, 'That is your Construction Yard. Everything else needs power. Click the Power Plant card in the build panel; when it reads READY, click the ground next to your yard to place it.'); // either layout
        }
        break;
      }
      case 'power': {
        if (me.has('powr')) {
          m.complete('power');
          goTo(m, 'ore');
          m.objective('ore', 'Build an Ore Refinery');
          say(m, SGT, 'Lights on. Now money. An Ore Refinery comes with a free Ore Truck that harvests the gold fields on its own. Gems are worth double.');
        }
        break;
      }
      case 'ore': {
        if (me.has('proc')) {
          m.complete('ore');
          goTo(m, 'infantry');
          m.flags.e1Base = ids(m.units(0, 'e1'));
          m.objective('infantry', 'Build a Barracks and train 5 Riflemen');
          say(m, SGT, 'Ore is flowing. Next, a Barracks. Once it stands, click the Rifleman card five times; Shift-click queues five at once.');
        }
        break;
      }
      case 'infantry': {
        const base: number[] = m.flags.e1Base ?? [];
        const fresh = m.units(0, 'e1').filter((u) => !base.includes(u.id)).length;
        if (m.every(1, 'e1progress')) m.progress('infantry', `${Math.min(5, fresh)} / 5`);
        if (fresh >= 5) {
          m.progress('infantry', '5 / 5');
          m.complete('infantry');
          goTo(m, 'defend');
          m.flags.waveAt = m.time + 30;
          m.objective('defend', 'Hold the base against the attack');
          say(m, SGT, 'Heads up: the opposing force is sending a raid in about thirty seconds. Pillboxes are unlocked. Tip: select your riflemen and press Ctrl+1, then press 1 any time to call them back up.');
        }
        break;
      }
      case 'defend': {
        if (!m.flags.waveSent && m.time >= m.flags.waveAt) {
          m.flags.waveSent = true;
          const from = ground(m, ...m.toward(e, s, 4));
          m.flags.raid = ids(huntWave(m, 1, ['e1', 'e1', 'e1', 'e1', 'dog', 'dog'], from, [s.x, s.y]));
          say(m, SGT, 'Here they come! Dogs in front: they kill infantry in one bite, so shoot them first.');
        }
        if (m.flags.waveSent && !m.livingUnits(m.flags.raid).length) {
          m.complete('defend');
          goTo(m, 'armour');
          m.objective('armour', 'Build a War Factory and a Light Tank');
          say(m, SGT, 'Raid repelled. Infantry alone will not crack a defended camp, so build a War Factory and roll out a Light Tank.');
        }
        break;
      }
      case 'armour': {
        if (m.units(0, '1tnk').length) {
          m.complete('armour');
          goTo(m, 'assault');
          m.objective('assault', 'Destroy the enemy training camp');
          m.reveal(0, e.x, e.y, 9);
          m.camera(e.x, e.y);
          say(m, SGT, 'There is their camp: barracks, two power plants, two pillboxes. Gather your army, press A, then click near the camp: an attack-move fights everything on the way.');
          say(m, SGT, 'Rocket Soldiers make short work of armour; tanks and riflemen handle pillboxes. Medium Tanks are unlocked too.');
        }
        break;
      }
      case 'assault': {
        const camp = m.living(m.flags.camp);
        if (camp.length && m.every(3, 'beacon')) { const c = centroid(camp); m.beacon(c.x, c.y); }
        if (!m.buildings(1).filter((b) => !b.bt.wall).length) {
          m.complete('assault');
          m.flags.step = 'done';
          say(m, SGT, 'Camp destroyed. That is the whole job, Commander: build, harvest, train, fight. Dismissed.');
          m.win();
        }
        break;
      }
    }
  },
};
