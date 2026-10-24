/**
 * Boot Camp: the interactive tutorial. Nine drills, each unlocking the next: move, fight, deploy,
 * power, ore, infantry, defence, armour and a final assault. Progress is read from the simulation
 * (positions, structures, units), never from UI state, so the drills survive save / load.
 */
import type { MissionDef, MissionRuntime } from '../sim/mission';
import { CAST, centroid, ground, hunt, huntWave, ids, layout, say, squad, type Speaker } from './common';
import EN from '../i18n/en/tutorial'; // the English this script emits (translated where it is shown)

const ALLIED_BLUE = 0x3d7be0;
const SOVIET_RED = 0xd23a2c;
const SGT: Speaker = { name: EN.sergeant, portrait: 'commander' };

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
  title: EN.title,
  codename: 'FIRST STEPS', // operation codenames are names (not translated)
  location: EN.location,
  date: EN.date,
  briefing: [EN.briefing.intro, EN.briefing.drills, EN.briefing.grading],
  tips: [EN.tips.select, EN.tips.scroll, EN.tips.build],
  map: { size: 56, seed: 1201, players: 2, water: 0.2, trees: 0.45, ore: 0.8, climate: 'temperate', hour: 10.5, dayCycle: false, weather: 'clear' },
  players: [
    { name: EN.player.you, faction: 'allies', color: ALLIED_BLUE },
    { name: EN.player.enemy, faction: 'soviet', color: SOVIET_RED, ai: 'passive', credits: 0 },
  ],
  credits: 6000,
  parTime: 900,
  allowedBuild: [],
  debrief: {
    speaker: SGT.name, portrait: SGT.portrait,
    win: EN.debrief.win,
    lose: EN.debrief.lose,
  },
  setup(m) {
    const s = m.start(0), e = m.start(1);
    squad(m, 0, ['e1', 'e1', 'e1', 'e1', 'jeep'], s, e, 0, 0);
    const [bx, by] = ground(m, ...m.toward(s, e, 11));
    m.flags.bx = bx;
    m.flags.by = by;
    // (the first drill's beacon in plain sight: uncovered here, framed with the squad once the opening fly-over is done;
    // it sat in the black shroud, off screen, with the radar offline)
    m.reveal(0, bx, by, 3);
    m.flags.scouts = ids(squad(m, 1, ['e1', 'e1', 'e1'], s, e, 19, 1));
    // the training camp the player assaults at the end
    const camp = layout(m, 1, e, s, [['barr', 1, 0], ['powr', -2.5, 3.5], ['powr', -2.5, -3.5], ['pbox', 5, 2.5], ['pbox', 5, -2.5]]);
    m.flags.camp = camp.filter(Boolean).map((b) => b!.id);
    squad(m, 1, ['e1', 'e1', 'e1', 'e2'], e, s, 3, 0);
    goTo(m, 'move');
    m.objective('move', EN.objective.move);
  },
  update(m) {
    const s = m.start(0), e = m.start(1);
    const step = m.flags.step as Step;
    hunt(m);
    if (m.after(1, 'hello')) {
      // (the squad and the beacon on screen, weighted towards the beacon so the bottom bar doesn't cover it)
      m.camera(s.x + (m.flags.bx - s.x) * 0.6, s.y + (m.flags.by - s.y) * 0.6);
      say(m, SGT, EN.radio.hello);
      say(m, SGT, EN.radio.move);
    }
    // keep the drills going if the player spends everything
    const me = m.player(0);
    if (step !== 'done' && me.credits < 400 && m.every(20, 'stipend')) {
      m.give(0, 1200);
      say(m, CAST.eva, EN.stipend);
    }
    // losing everything ends the drill
    if (step !== 'move' && step !== 'fight' && step !== 'done' && !m.units(0).length && !m.buildings(0).length) {
      m.lose(EN.wipedOut);
      return;
    }

    switch (step) {
      case 'move': {
        if (m.every(2, 'beacon')) m.beacon(m.flags.bx, m.flags.by);
        if (m.unitsNear(0, m.flags.bx, m.flags.by, 3.5).length >= 3) {
          m.complete('move');
          goTo(m, 'fight');
          m.objective('fight', EN.objective.fight);
          say(m, SGT, EN.radio.fight);
          // (the scouts in sight too, and on screen)
          const scouts = m.livingUnits(m.flags.scouts);
          if (scouts.length) { const c = centroid(scouts); m.reveal(0, c.x, c.y, 4); m.camera((m.flags.bx + c.x) / 2, (m.flags.by + c.y) / 2); }
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
          m.objective('deploy', EN.objective.deploy);
          say(m, SGT, EN.radio.deploy);
        }
        break;
      }
      case 'deploy': {
        const mcv = m.world.getEntity(m.flags.mcv);
        if (mcv?.alive && m.every(2, 'beacon')) m.beacon(mcv.x, mcv.y);
        if (m.buildings(0, 'fact').length) {
          m.complete('deploy');
          goTo(m, 'power');
          m.objective('power', EN.objective.power);
          say(m, SGT, EN.radio.power); // either layout
        }
        break;
      }
      case 'power': {
        if (me.has('powr')) {
          m.complete('power');
          goTo(m, 'ore');
          m.objective('ore', EN.objective.ore);
          say(m, SGT, EN.radio.ore);
        }
        break;
      }
      case 'ore': {
        if (me.has('proc')) {
          m.complete('ore');
          goTo(m, 'infantry');
          m.flags.e1Base = ids(m.units(0, 'e1'));
          m.objective('infantry', EN.objective.infantry);
          say(m, SGT, EN.radio.infantry);
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
          m.objective('defend', EN.objective.defend);
          say(m, SGT, EN.radio.defend);
        }
        break;
      }
      case 'defend': {
        if (!m.flags.waveSent && m.time >= m.flags.waveAt) {
          m.flags.waveSent = true;
          const from = ground(m, ...m.toward(e, s, 4));
          m.flags.raid = ids(huntWave(m, 1, ['e1', 'e1', 'e1', 'e1', 'dog', 'dog'], from, [s.x, s.y]));
          say(m, SGT, EN.radio.raid);
        }
        if (m.flags.waveSent && !m.livingUnits(m.flags.raid).length) {
          m.complete('defend');
          goTo(m, 'armour');
          m.objective('armour', EN.objective.armour);
          say(m, SGT, EN.radio.armour);
        }
        break;
      }
      case 'armour': {
        if (m.units(0, '1tnk').length) {
          m.complete('armour');
          goTo(m, 'assault');
          m.objective('assault', EN.objective.assault);
          m.reveal(0, e.x, e.y, 9);
          m.camera(e.x, e.y);
          say(m, SGT, EN.radio.assault);
          say(m, SGT, EN.radio.counters);
        }
        break;
      }
      case 'assault': {
        const camp = m.living(m.flags.camp);
        if (camp.length && m.every(3, 'beacon')) { const c = centroid(camp); m.beacon(c.x, c.y); }
        if (!m.buildings(1).filter((b) => !b.bt.wall).length) {
          m.complete('assault');
          m.flags.step = 'done';
          say(m, SGT, EN.radio.done);
          m.win();
        }
        break;
      }
    }
  },
};
