/**
 * Making challenges: from a replay moment (the replay player's "Make challenge"), from an automatically
 * detected moment (end screen) or from a built-in. DOM-free.
 */
import { VERSION } from '../config';
import { BUILDINGS } from '../data/rules';
import type { GameSetup } from '../game';
import type { AIDifficulty } from '../sim/ai';
import type { World } from '../sim/world';
import { baseSetup } from '../replay/branch';
import { TICK_HZ } from '../sim/types';
import type { ChallengeDef, ChallengeGoal, ChallengeSetup, StartView } from './types';
import { momentGoal, type Moment } from './moments';

const DIFFS: AIDifficulty[] = ['easy', 'normal', 'hard', 'brutal'];

export function newChallengeId(): string {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

/** The setup fields a challenge keeps (mode, per-device and mission fields stripped). */
export function challengeBase(setup: Partial<GameSetup>): ChallengeSetup {
  const { mission: _m, customMission: _cm, allies: _a, ...rest } = baseSetup(setup as GameSetup) as GameSetup;
  delete (rest as Record<string, unknown>).conquest; // a conquest battle's challenge is a plain skirmish
  return rest as ChallengeSetup;
}

/** Difficulty for players that were human in the source match (the branch's choice, else the hardest opponent). */
export function sourceAI(setup: Partial<GameSetup>): AIDifficulty {
  if (setup.branch?.ai) return setup.branch.ai;
  let best: AIDifficulty = 'normal';
  for (const o of setup.opponents ?? []) if (DIFFS.indexOf(o.difficulty) > DIFFS.indexOf(best)) best = o.difficulty;
  return best;
}

export function challengeFromState(o: {
  setup: Partial<GameSetup>; state: unknown; view?: StartView; side: number; ai?: AIDifficulty; goal: ChallengeGoal; timeLimit: number;
  title: string; description?: string; par?: ChallengeDef['par']; source?: ChallengeDef['source'];
}): ChallengeDef {
  return {
    v: 1, id: newChallengeId(), title: o.title.trim() || 'Challenge', description: o.description, createdAt: Date.now(), gameVersion: VERSION,
    setup: challengeBase(o.setup), state: o.state, view: o.view, side: o.side, ai: o.ai ?? sourceAI(o.setup), goal: o.goal, timeLimit: o.timeLimit,
    par: o.par, source: o.source,
  };
}

/** A detected moment as a challenge for the local side. */
export function challengeFromMoment(m: Moment, setup: Partial<GameSetup>, side: number, mapName?: string): ChallengeDef {
  const state = JSON.parse(m.json);
  const g = momentGoal(m, side, state);
  return challengeFromState({
    setup, state, view: { ...m.view, cam: { x: m.x, y: m.y, dist: m.view.cam?.dist ?? 22, yaw: m.view.cam?.yaw } }, side, goal: g.goal, timeLimit: g.timeLimit,
    title: g.title, description: g.text, par: g.par, source: { kind: 'moment', moment: m.kind, tick: m.tick, map: mapName },
  });
}

/** The GameSetup that plays a challenge. */
export function challengeGameSetup(c: ChallengeDef, quality: GameSetup['quality']): GameSetup {
  return { ...(c.setup as GameSetup), quality, intro: false, challenge: c };
}

export interface TargetOption {
  key: string;
  label: string;
  ids: number[];
  x: number;
  y: number;
}

const NOTABLE = ['fact', 'weap', 'proc', 'mslo', 'iron', 'pdox', 'atek', 'stek', 'dome', 'afld', 'hpad', 'tent', 'barr', 'syrd', 'spen', 'tsla', 'powr', 'apwr'];

/** Structures worth destroying (enemies of `side`) or protecting (own), for the challenge form. */
export function notableTargets(world: World, side: number): { enemy: TargetOption[]; own: TargetOption[] } {
  const me = world.players[side];
  const enemy: TargetOption[] = [], own: TargetOption[] = [];
  if (!me) return { enemy, own };
  for (const p of world.players) {
    const mine = p === me;
    if (!mine && !me.isEnemy(p)) continue;
    const list = mine ? own : enemy;
    for (const type of NOTABLE) {
      const bs = world.buildings.filter((b) => b.alive && b.owner === p && b.bt.id === type);
      if (!bs.length) continue;
      const name = BUILDINGS[type]?.name ?? type;
      const b = bs[0];
      list.push({ key: `${p.id}:${type}`, label: `${bs.length > 1 ? `${name} (${bs.length})` : name}${mine ? '' : ` · ${p.name}`}`, ids: bs.map((x) => x.id), x: b.x, y: b.y });
    }
    if (!mine) {
      const all = world.buildings.filter((b) => b.alive && b.owner === p && !b.bt.wall && !b.bt.mine);
      if (all.length > 1) list.push({ key: `${p.id}:all`, label: `Every structure · ${p.name} (${all.length})`, ids: all.map((b) => b.id), x: all[0].x, y: all[0].y });
    }
  }
  return { enemy, own };
}

/** Default title for a challenge made at a replay moment. */
export function defaultTitle(mapName: string, tick: number, goal: ChallengeGoal['kind']): string {
  const s = Math.floor(tick / TICK_HZ);
  const word = goal === 'win' ? 'Win from here' : goal === 'survive' ? 'Hold on' : goal === 'destroy' ? 'Strike' : goal === 'protect' ? 'Defend' : 'Hold the ground';
  return `${word} · ${mapName} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
