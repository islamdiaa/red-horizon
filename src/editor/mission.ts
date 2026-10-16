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

export const AI_MODES: AIMode[] = ['easy', 'normal', 'hard', 'brutal', 'defensive', 'passive'];
export const OBJECTIVE_KINDS: { kind: ObjectiveKind; label: string }[] = [
  { kind: 'destroyAll', label: 'Destroy all enemies' },
  { kind: 'destroy', label: 'Destroy a target' },
  { kind: 'survive', label: 'Survive' },
  { kind: 'reach', label: 'Reach an area' },
  { kind: 'protect', label: 'Protect' },
  { kind: 'build', label: 'Build' },
];
export const TRIGGER_WHENS: { kind: TriggerWhen; label: string }[] = [
  { kind: 'start', label: 'Mission start' },
  { kind: 'time', label: 'After time' },
  { kind: 'objectiveDone', label: 'Objective done' },
  { kind: 'objectiveFailed', label: 'Objective failed' },
  { kind: 'destroyed', label: 'Tagged thing destroyed' },
  { kind: 'area', label: 'Units enter area' },
];
export const TRIGGER_DOS: { kind: TriggerDo; label: string }[] = [
  { kind: 'message', label: 'Radio message' },
  { kind: 'reinforce', label: 'Reinforcements' },
  { kind: 'credits', label: 'Give credits' },
  { kind: 'reveal', label: 'Reveal area' },
  { kind: 'objective', label: 'Show objective' },
  { kind: 'ai', label: 'Set AI mode' },
  { kind: 'attack', label: 'AI attacks' },
  { kind: 'win', label: 'Victory' },
  { kind: 'lose', label: 'Defeat' },
];
export const PORTRAITS: Portrait[] = ['commander', 'intel', 'commando', 'enemy', 'eva', 'scientist', 'pilot'];

/** A fresh mission for a map with `starts` start positions: you against one normal AI. */
export function defaultMission(starts: number, mapName = ''): MissionSpec {
  const players: MissionPlayer[] = [
    { name: 'Commander', faction: 'allies', team: 0, ai: 'normal', credits: 5000, startUnits: 'mcv' },
    { name: 'Gen. Volkov', faction: 'soviet', team: 1, ai: 'normal', credits: 5000, startUnits: 'mcv' },
  ].slice(0, Math.max(1, Math.min(2, starts))) as MissionPlayer[];
  return {
    title: mapName ? `Operation ${mapName}` : 'Custom Operation', codename: 'NIGHTFALL', location: '',
    briefing: ['Commander, enemy forces have dug in across the valley.', 'Establish a base and destroy them.'],
    tips: [], timeOfDay: 'day', weather: 'auto', dayCycle: true, fog: true, parTime: 0,
    players, placements: [],
    objectives: [{ id: 'o1', kind: 'destroyAll', text: 'Destroy all enemy forces', primary: true }],
    triggers: [],
  };
}

// =====================================================================================================
// Validation (structure + references; the editor adds map-dependent checks)
// =====================================================================================================
export interface MissionIssue {
  level: 'error' | 'warning';
  text: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function checkMission(spec: MissionSpec, starts: number): MissionIssue[] {
  const out: MissionIssue[] = [];
  const err = (text: string) => out.push({ level: 'error', text });
  const warn = (text: string) => out.push({ level: 'warning', text });
  if (!spec.title?.trim()) err('The mission needs a title.');
  if (!spec.players?.length) { err('The mission needs at least the human player.'); return out; }
  if (spec.players.length > starts) err(`${spec.players.length} players but the map has only ${starts} start position${starts === 1 ? '' : 's'}.`);
  if (spec.players.length > 6) err('At most 6 players.');
  const p0 = spec.players[0];
  if (!spec.players.slice(1).some((p) => p.team !== p0.team) && !spec.objectives.some((o) => o.kind === 'survive' || o.kind === 'reach' || o.kind === 'build')) {
    warn('Nobody is on another team than the human: add an enemy player or a survive / reach / build objective.');
  }
  const tags = new Map<string, Placement>();
  spec.placements.forEach((pl, i) => {
    const t = pl.kind === 'unit' ? UNITS[pl.type] : BUILDINGS[pl.type];
    if (!t) err(`Placement ${i + 1}: unknown ${pl.kind} "${pl.type}".`);
    if (!(pl.player >= 0 && pl.player < spec.players.length)) err(`Placement ${i + 1} (${t?.name ?? pl.type}): player ${pl.player + 1} doesn't exist.`);
    if (pl.tag) {
      if (tags.has(pl.tag)) err(`Tag "${pl.tag}" is used twice.`);
      tags.set(pl.tag, pl);
    }
    if (pl.health !== undefined && !(pl.health > 0 && pl.health <= 1)) err(`Placement ${i + 1}: health must be between 0 and 100%.`);
  });
  const hasForces = spec.placements.some((p) => p.player === 0) || p0.startUnits !== 'none';
  if (!hasForces && !spec.triggers.some((t) => t.when === 'start' && t.actions.some((a) => a.kind === 'reinforce' && (a.player ?? 0) === 0))) {
    err('The human player has no units, structures or start kit: the mission would be lost at once.');
  }
  const objIds = new Set<string>();
  for (const o of spec.objectives) {
    const name = `Objective "${o.text || o.id}"`;
    if (objIds.has(o.id)) err(`Objective id "${o.id}" is used twice.`);
    objIds.add(o.id);
    if (!o.text?.trim()) warn(`${name} has no text.`);
    switch (o.kind) {
      case 'destroy':
      case 'protect': {
        const pl = o.tag ? tags.get(o.tag) : undefined;
        if (!pl) { err(`${name}: choose a tagged unit or structure.`); break; }
        if (o.kind === 'destroy' && pl.player === 0) err(`${name}: the target belongs to the human player.`);
        if (o.kind === 'protect' && spec.players[pl.player] && spec.players[pl.player].team !== p0.team) warn(`${name}: the protected thing belongs to an enemy.`);
        break;
      }
      case 'destroyAll':
        if (o.player !== undefined && !(o.player > 0 && o.player < spec.players.length)) err(`${name}: player ${o.player + 1} doesn't exist.`);
        break;
      case 'survive':
        if (!isNum(o.seconds) || o.seconds < 10) err(`${name}: survive for at least 10 seconds.`);
        break;
      case 'reach':
        if (!isNum(o.x) || !isNum(o.y) || !isNum(o.r) || o.r < 1) err(`${name}: place the area on the map.`);
        break;
      case 'build':
        if (!o.type || !BUILDINGS[o.type]) err(`${name}: choose a structure type.`);
        if (!isNum(o.count) || o.count < 1) err(`${name}: build at least one.`);
        break;
    }
  }
  const primaries = spec.objectives.filter((o) => o.primary);
  if (!primaries.length) err('Add at least one primary objective (it decides victory).');
  if (primaries.length && primaries.every((o) => o.kind === 'protect')) warn('Only "protect" objectives: the mission is won as soon as it starts.');
  for (const t of spec.triggers) {
    const name = `Trigger "${t.id}"`;
    if ((t.when === 'objectiveDone' || t.when === 'objectiveFailed') && !objIds.has(t.objective ?? '')) err(`${name}: unknown objective.`);
    if (t.when === 'destroyed' && !tags.has(t.tag ?? '')) err(`${name}: unknown tag "${t.tag ?? ''}".`);
    if (t.when === 'time' && (!isNum(t.seconds) || t.seconds < 0)) err(`${name}: set the time.`);
    if (t.when === 'area' && (!isNum(t.x) || !isNum(t.y) || !isNum(t.r))) err(`${name}: place the area on the map.`);
    if (!t.actions.length) warn(`${name} does nothing.`);
    for (const a of t.actions) {
      if ((a.kind === 'reinforce' || a.kind === 'credits' || a.kind === 'ai' || a.kind === 'attack') && !(isNum(a.player) && a.player >= 0 && a.player < spec.players.length)) err(`${name}: choose a player.`);
      if (a.kind === 'reinforce') {
        if (!a.units?.length || a.units.some((u) => !UNITS[u])) err(`${name}: reinforcements need valid unit types.`);
        if (!isNum(a.x) || !isNum(a.y)) err(`${name}: set where the reinforcements arrive.`);
      }
      if (a.kind === 'objective' && !spec.objectives.some((o) => o.id === a.objective && o.hidden)) err(`${name}: "${a.objective ?? ''}" is not a hidden objective.`);
      if (a.kind === 'message' && !a.text?.trim()) warn(`${name}: empty radio message.`);
    }
  }
  for (const o of spec.objectives) {
    if (o.hidden && !spec.triggers.some((t) => t.actions.some((a) => a.kind === 'objective' && a.objective === o.id))) warn(`Hidden objective "${o.text || o.id}" is never revealed by a trigger.`);
  }
  return out;
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
  if (o.kind === 'survive' && o.seconds) m.startTimer('cm.obj.' + o.id, o.seconds, o.text || 'Hold out');
  if (o.kind === 'reach' && o.x !== undefined && o.y !== undefined) m.beacon(o.x, o.y);
}

function runAction(m: MissionRuntime, spec: MissionSpec, a: TriggerAction) {
  switch (a.kind) {
    case 'message':
      m.say(a.speaker || 'Battle Control', a.text ?? '', a.portrait ?? 'eva');
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
      m.lose(a.text || 'Mission failed');
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
    title: spec.title || 'Custom Operation',
    codename: (spec.codename || 'CUSTOM').toUpperCase(),
    location: spec.location || `Custom map · ${map.name}`,
    briefing: spec.briefing.length ? spec.briefing : ['No briefing.'],
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
            if (m.every(2, 'cm.p.' + o.id)) m.progress(o.id, `${left} left`);
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
      if (failed) { m.lose(`Objective failed: ${failed.text}`); return; }
      const open = prim.filter((o) => o.kind !== 'protect');
      if (open.length && open.every((o) => shown(o) && m.state(o.id) === 'done')) {
        for (const o of prim) if (o.kind === 'protect') m.complete(o.id);
        m.win();
      }
    },
  };
}
