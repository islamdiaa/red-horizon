/**
 * Custom missions made in the editor: a data-only description (no code, no eval) that turns into a
 * regular MissionDef running on MissionRuntime (src/sim/mission.ts).
 *
 *  - players: index 0 is the human; each player starts at the map start of the same index with an
 *    optional kit (MCV / squad / company), credits, a faction, a team and an AI mode;
 *  - placements: pre-built structures and units per player, optionally tagged ("radar", "convoy");
 *  - objectives: destroy all (of one player or every enemy), destroy a tagged target, survive N
 *    seconds, reach an area, protect a tagged unit / structure, build N structures of a type;
 *  - triggers: when (start | time | objective done / failed | tagged thing destroyed | a player
 *    enters an area) then (radio message | reinforcements | credits | reveal | show a hidden
 *    objective | set an AI mode | send an AI to attack | win | lose), each firing once.
 *
 * Victory: every primary objective done (hidden ones must be revealed first). Defeat: a primary
 * objective failed, or the human has nothing left. Everything runs in the deterministic simulation
 * tick and keeps its state in MissionRuntime flags / timers, so saves restore it exactly.
 */
import { BUILDINGS, UNITS, type Faction } from '../data/rules';
import type { MapDef } from '../maps/format';
import type { AIMode, MissionDef, MissionRuntime, Portrait } from '../sim/mission';
import type { Entity } from '../sim/entities';
import { CAST } from '../i18n/en/campaign-cast';
import { CM, english, tDefault } from '../i18n/en/editor-mission';
import { tx } from '../i18n/core';

export type StartKit = 'none' | 'mcv' | 'light' | 'heavy';

export interface MissionPlayer {
  name: string;
  faction: Faction;
  team: number;
  /** AI behaviour for players 1+ (ignored for the human, index 0). */
  ai: AIMode;
  credits: number;
  startUnits: StartKit;
}

export interface Placement {
  kind: 'unit' | 'structure';
  type: string;
  player: number;
  /** Units: map position (cell centre = x.5). Structures: top-left cell of the footprint. */
  x: number;
  y: number;
  /** Optional name objectives and triggers refer to. */
  tag?: string;
  /** Starting health 0..1 (default 1). */
  health?: number;
}

export type ObjectiveKind = 'destroyAll' | 'destroy' | 'survive' | 'reach' | 'protect' | 'build';

export interface ObjectiveSpec {
  id: string;
  kind: ObjectiveKind;
  text: string;
  primary: boolean;
  /** Not shown (and not required) until a trigger reveals it. */
  hidden?: boolean;
  /** destroy / protect: tag of a placement. */
  tag?: string;
  /** destroyAll: only this player (default: every enemy of the human). */
  player?: number;
  /** survive: seconds. */
  seconds?: number;
  /** reach: area centre and radius (cells). */
  x?: number;
  y?: number;
  r?: number;
  /** build: structure type and count. */
  type?: string;
  count?: number;
}

export type TriggerWhen = 'start' | 'time' | 'objectiveDone' | 'objectiveFailed' | 'destroyed' | 'area';
export type TriggerDo = 'message' | 'reinforce' | 'credits' | 'reveal' | 'objective' | 'ai' | 'attack' | 'win' | 'lose';

export interface TriggerAction {
  kind: TriggerDo;
  /** message */
  speaker?: string;
  portrait?: Portrait;
  text?: string;
  /** reinforce / credits / ai / attack: player index. */
  player?: number;
  /** reinforce: unit types; arrive at (x, y) (use a map edge) and move to (tx, ty). */
  units?: string[];
  x?: number;
  y?: number;
  tx?: number;
  ty?: number;
  /** credits */
  amount?: number;
  /** reveal: radius */
  r?: number;
  /** objective: id of a hidden objective to reveal */
  objective?: string;
  /** ai */
  mode?: AIMode;
}

export interface TriggerSpec {
  id: string;
  when: TriggerWhen;
  /** time: seconds */
  seconds?: number;
  /** objectiveDone / objectiveFailed */
  objective?: string;
  /** destroyed */
  tag?: string;
  /** area: centre, radius and whose units (default the human) */
  x?: number;
  y?: number;
  r?: number;
  player?: number;
  actions: TriggerAction[];
}

export interface MissionSpec {
  title: string;
  codename: string;
  location: string;
  /** Briefing paragraphs. */
  briefing: string[];
  tips?: string[];
  timeOfDay: 'day' | 'dusk' | 'night';
  weather: string;
  dayCycle: boolean;
  fog: boolean;
  /** Seconds for the speed star (0 = none). */
  parTime: number;
  players: MissionPlayer[];
  placements: Placement[];
  objectives: ObjectiveSpec[];
  triggers: TriggerSpec[];
}

/** What GameSetup.customMission carries: the spec plus its id (the map travels in GameSetup.customMap). */
export interface CustomMissionSetup extends MissionSpec {
  id: string;
}

export const AI_MODES: AIMode[] = ['recruit', 'easy', 'normal', 'hard', 'brutal', 'defensive', 'passive'];
// the kinds in editor order (their labels: src/i18n/en/editor.ts objective.kind / trigger.when / action.kind)
export const OBJECTIVE_KINDS: ObjectiveKind[] = ['destroyAll', 'destroy', 'survive', 'reach', 'protect', 'build'];
export const TRIGGER_WHENS: TriggerWhen[] = ['start', 'time', 'objectiveDone', 'objectiveFailed', 'destroyed', 'area'];
export const TRIGGER_DOS: TriggerDo[] = ['message', 'reinforce', 'credits', 'reveal', 'objective', 'ai', 'attack', 'win', 'lose'];
export const PORTRAITS: Portrait[] = ['commander', 'intel', 'commando', 'enemy', 'eva', 'scientist', 'pilot'];

/**
 * A fresh mission for a map with `starts` start positions: you against one normal AI. Its text is written in the
 * interface language (it is the author's to edit: src/i18n/en/editor-mission.ts DEFAULTS).
 */
export function defaultMission(starts: number, mapName = ''): MissionSpec {
  const players: MissionPlayer[] = [
    { name: tDefault('human'), faction: 'allies', team: 0, ai: 'normal', credits: 5000, startUnits: 'mcv' },
    { name: tDefault('enemy'), faction: 'soviet', team: 1, ai: 'normal', credits: 5000, startUnits: 'mcv' },
  ].slice(0, Math.max(1, Math.min(2, starts))) as MissionPlayer[];
  return {
    title: (mapName ? tDefault('title', { map: mapName }) : tx('editorMission.run.title')).slice(0, 60), codename: tDefault('codename'), location: '',
    briefing: [tDefault('briefing1'), tDefault('briefing2')],
    tips: [], timeOfDay: 'day', weather: 'auto', dayCycle: true, fog: true, parTime: 0,
    players, placements: [],
    objectives: [{ id: 'o1', kind: 'destroyAll', text: tDefault('objective.destroyAll'), primary: true }],
    triggers: [],
  };
}

// =====================================================================================================
// Runtime: MissionSpec -> MissionDef
// =====================================================================================================
const TAGS = 'cm.tags';
const KITS: Record<Faction, { light: string[]; heavy: string[] }> = {
  allies: { light: ['e1', 'e1', 'e1', 'e3', '2tnk'], heavy: ['e1', 'e1', 'e1', 'e3', '2tnk', 'e1', 'e1', 'e3', '2tnk', '1tnk', 'jeep'] },
  soviet: { light: ['e1', 'e1', 'e1', 'e3', '3tnk'], heavy: ['e1', 'e1', 'e1', 'e3', '3tnk', 'e1', 'e1', 'e3', '3tnk', '3tnk', 'v2rl'] },
};

function tagged(m: MissionRuntime, tag: string | undefined): Entity | null {
  if (!tag) return null;
  const id = (m.flags[TAGS] as Record<string, number> | undefined)?.[tag];
  if (!id) return null;
  const e = m.world.getEntity(id);
  return e && e.alive ? e : null;
}

/** Remaining units + structures (no walls / mines) of a player. */
function forcesOf(m: MissionRuntime, p: number): number {
  return m.units(p).length + m.buildings(p).filter((b) => !b.bt.wall && !b.bt.mine).length;
}

function enemyForces(m: MissionRuntime): number {
  const human = m.human;
  let n = 0;
  m.world.players.forEach((p, i) => { if (i > 0 && human.isEnemy(p)) n += forcesOf(m, i); });
  return n;
}

function activate(m: MissionRuntime, o: ObjectiveSpec) {
  m.objective(o.id, o.text || o.id, o.primary);
  if (o.kind === 'survive' && o.seconds) m.startTimer('cm.obj.' + o.id, o.seconds, o.text || CM.holdOut);
  if (o.kind === 'reach' && o.x !== undefined && o.y !== undefined) m.beacon(o.x, o.y);
}

function runAction(m: MissionRuntime, spec: MissionSpec, a: TriggerAction) {
  switch (a.kind) {
    case 'message':
      m.say(a.speaker || CAST.eva, a.text ?? '', a.portrait ?? 'eva');
      break;
    case 'reinforce': {
      const p = a.player ?? 0;
      if (!a.units?.length || !m.world.players[p]) break;
      const from: [number, number] = m.clampPt(a.x ?? 1.5, a.y ?? 1.5, 1);
      const to: [number, number] = m.clampPt(a.tx ?? a.x ?? 1.5, a.ty ?? a.y ?? 1.5, 1);
      m.reinforce(p, a.units.filter((u) => UNITS[u]), from, to, p !== 0);
      if (p === 0) { m.reveal(0, to[0], to[1], 6); m.beacon(to[0], to[1]); }
      break;
    }
    case 'credits':
      if (m.world.players[a.player ?? 0]) m.give(a.player ?? 0, a.amount ?? 0);
      break;
    case 'reveal':
      m.reveal(0, a.x ?? 0, a.y ?? 0, a.r ?? 8);
      if (a.x !== undefined && a.y !== undefined) m.camera(a.x, a.y);
      break;
    case 'objective': {
      const o = spec.objectives.find((x) => x.id === a.objective);
      if (o && !m.flags['cm.shown.' + o.id]) { m.flags['cm.shown.' + o.id] = true; activate(m, o); }
      break;
    }
    case 'ai':
      if (a.player && a.mode) m.setAI(a.player, a.mode);
      break;
    case 'attack': {
      const p = a.player ?? 1;
      if (!m.world.players[p] || p === 0) break;
      const army = m.army(p);
      const pool: Entity[] = m.buildings(0).length ? m.buildings(0) : m.units(0);
      const target = m.nearest(pool, m.start(p).x, m.start(p).y);
      if (army.length && target) m.move(army, target.x, target.y, true);
      break;
    }
    case 'win':
      m.win();
      break;
    case 'lose':
      m.lose(a.text || CM.failed);
      break;
  }
}

function triggerFires(m: MissionRuntime, t: TriggerSpec): boolean {
  switch (t.when) {
    case 'start': return true;
    case 'time': return m.time >= (t.seconds ?? 0);
    case 'objectiveDone': return m.state(t.objective ?? '') === 'done';
    case 'objectiveFailed': return m.state(t.objective ?? '') === 'failed';
    case 'destroyed': {
      const ids = m.flags[TAGS] as Record<string, number> | undefined;
      return !!ids?.[t.tag ?? ''] && !tagged(m, t.tag);
    }
    case 'area': return m.unitsNear(t.player ?? 0, t.x ?? 0, t.y ?? 0, t.r ?? 4).length > 0;
  }
}

export function customMissionDef(cm: CustomMissionSetup, map: MapDef): MissionDef {
  const spec = cm;
  const objectives = spec.objectives;
  return {
    id: cm.id,
    campaign: 'special',
    index: 900,
    title: spec.title || CM.title,
    codename: (spec.codename || CM.codename).toUpperCase(),
    location: spec.location || english(CM.location, { map: map.name }),
    briefing: spec.briefing.length ? spec.briefing : [CM.noBriefing],
    tips: spec.tips?.filter((t) => t.trim()),
    map: {
      size: map.size, seed: map.seed, players: spec.players.length, climate: map.climate,
      timeOfDay: spec.timeOfDay, weather: spec.weather || 'auto', dayCycle: spec.dayCycle,
    },
    players: spec.players.map((p, i) => ({ name: p.name, faction: p.faction, team: p.team, credits: p.credits, ai: i === 0 ? undefined : p.ai })),
    fog: spec.fog,
    startUnits: spec.players[0]?.startUnits ?? 'none',
    credits: spec.players[0]?.credits ?? 5000,
    parTime: spec.parTime > 0 ? spec.parTime : undefined,
    setup(m) {
      // start kits for the AI players (the World hands the human theirs)
      spec.players.forEach((p, i) => {
        if (i === 0 || p.startUnits === 'none') return;
        const s = m.start(i);
        m.spawnUnit(i, 'mcv', s.x, s.y);
        if (p.startUnits !== 'mcv') m.spawnGroup(i, KITS[p.faction][p.startUnits], s.x + 2.5, s.y + 2.5);
      });
      const tags: Record<string, number> = {};
      for (const pl of spec.placements) {
        if (!m.world.players[pl.player]) continue;
        let e: Entity | null = null;
        if (pl.kind === 'structure' && BUILDINGS[pl.type]) e = m.placeBuilding(pl.player, pl.type, Math.round(pl.x), Math.round(pl.y));
        else if (pl.kind === 'unit' && UNITS[pl.type]) e = m.spawnUnit(pl.player, pl.type, pl.x, pl.y);
        if (!e) continue;
        if (pl.health !== undefined && pl.health < 1) m.setHealth(e, pl.health);
        if (pl.tag) tags[pl.tag] = e.id;
      }
      m.flags[TAGS] = tags;
      for (const o of objectives) if (!o.hidden) activate(m, o);
    },
    update(m) {
      // ---- triggers (each fires once)
      for (const t of spec.triggers) {
        if (m.flags['cm.trg.' + t.id]) continue;
        if (!triggerFires(m, t)) continue;
        m.flags['cm.trg.' + t.id] = true;
        for (const a of t.actions) runAction(m, spec, a);
        if (m.ended) return;
      }
      // ---- objectives
      const shown = (o: ObjectiveSpec) => !o.hidden || !!m.flags['cm.shown.' + o.id];
      for (const o of objectives) {
        if (!shown(o) || m.state(o.id) !== 'active') continue;
        switch (o.kind) {
          case 'destroyAll': {
            // enemies that only arrive later (reinforcement triggers) must show up before this can be done
            const left = o.player !== undefined ? forcesOf(m, o.player) : enemyForces(m);
            if (left > 0) m.flags['cm.seen.' + o.id] = true;
            if (m.every(2, 'cm.p.' + o.id)) m.progress(o.id, english(CM.left, { n: left }));
            if (left === 0 && m.flags['cm.seen.' + o.id]) m.complete(o.id);
            break;
          }
          case 'destroy':
            if (!tagged(m, o.tag)) m.complete(o.id);
            break;
          case 'survive': {
            const left = m.timeLeft('cm.obj.' + o.id);
            if (left !== null && left <= 0) { m.clearTimer('cm.obj.' + o.id); m.complete(o.id); }
            break;
          }
          case 'reach':
            if (m.unitsNear(0, o.x ?? 0, o.y ?? 0, o.r ?? 3).length) m.complete(o.id);
            else if (m.every(10, 'cm.b.' + o.id)) m.beacon(o.x ?? 0, o.y ?? 0);
            break;
          case 'protect':
            if ((m.flags[TAGS] as Record<string, number>)?.[o.tag ?? ''] && !tagged(m, o.tag)) m.fail(o.id);
            break;
          case 'build': {
            const have = m.buildings(0, o.type ?? '').filter((b) => b.counted).length;
            m.progress(o.id, `${Math.min(have, o.count ?? 1)} / ${o.count ?? 1}`);
            if (have >= (o.count ?? 1)) m.complete(o.id);
            break;
          }
        }
      }
      // ---- outcome
      const prim = objectives.filter((o) => o.primary);
      const failed = prim.find((o) => m.state(o.id) === 'failed');
      if (failed) { m.lose(english(CM.objectiveFailed, { text: failed.text })); return; }
      const open = prim.filter((o) => o.kind !== 'protect');
      if (open.length && open.every((o) => shown(o) && m.state(o.id) === 'done')) {
        for (const o of prim) if (o.kind === 'protect') m.complete(o.id);
        m.win();
      }
    },
  };
}
