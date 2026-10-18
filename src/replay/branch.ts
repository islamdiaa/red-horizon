/**
 * Branching timelines ("rewind & take command"): from any moment of a replay, start a live game from
 * that exact state as any player. The branch stores the serialized world at the branch tick plus the
 * parent replay id, so it replays on its own (src/modes/runtime.ts loads it) and links into a tree.
 *
 * Roster at the branch point: the chosen player is human; players who were human in the parent are
 * played by the AI (at the chosen difficulty) from then on; AI players stay AI.
 */
import type { GameSetup } from '../game';
import type { AIDifficulty } from '../sim/ai';
import { serializeWorld } from '../sim/save';
import type { World } from '../sim/world';
import type { BranchInfo, StartView } from '../modes/types';
import type { ReplayData, ReplaySetup } from './format';
import { worldHash } from './hash';
import { SIM_VERSION } from '../sim/version';

const DIFFS: AIDifficulty[] = ['easy', 'normal', 'hard', 'brutal'];

/** A deep, JSON-only copy of the world (a save game's world part). */
export function snapshotWorld(world: World): unknown {
  return JSON.parse(JSON.stringify(serializeWorld(world)));
}

/** A recorded setup without mode and per-device fields: the base a branch or challenge builds on. */
export function baseSetup<T extends Partial<GameSetup>>(setup: T): Omit<T, 'load' | 'replay' | 'quality' | 'branch' | 'challenge' | 'demo' | 'intro'> {
  const { load: _l, replay: _r, quality: _q, branch: _b, challenge: _c, demo: _d, intro: _i, ...rest } = setup as Partial<GameSetup>;
  delete (rest as Record<string, unknown>).conquest; // a what-if of a conquest battle is a plain skirmish (never reports to the campaign)
  return rest as Omit<T, 'load' | 'replay' | 'quality' | 'branch' | 'challenge' | 'demo' | 'intro'>;
}

/** Default difficulty for the AI that takes over the recording's commander: the previous choice, else the hardest opponent. */
export function defaultTakeoverAI(data: ReplayData): AIDifficulty {
  if (data.setup.branch?.ai) return data.setup.branch.ai;
  let best: AIDifficulty = 'normal';
  for (const o of data.setup.opponents ?? []) if (DIFFS.indexOf(o.difficulty) > DIFFS.indexOf(best)) best = o.difficulty;
  return best;
}

/** Branch info for taking command of `local` in a replay's world at its current tick. */
export function makeBranch(data: ReplayData, world: World, local: number, ai: AIDifficulty, view?: StartView): BranchInfo {
  const parentBranch = data.setup.branch;
  return {
    parent: data.id,
    root: parentBranch?.root ?? data.id,
    depth: (parentBranch?.depth ?? 0) + 1,
    tick: world.tick,
    local,
    ai,
    start: snapshotWorld(world),
    hash: worldHash(world),
    view,
    name: world.players[local]?.name,
    sim: SIM_VERSION,
  };
}

/** The GameSetup that plays a branch live. */
export function branchSetup(setup: ReplaySetup | GameSetup, branch: BranchInfo, quality: GameSetup['quality']): GameSetup {
  return { ...baseSetup(setup as GameSetup), branch, quality, intro: false };
}

/** Tick a replay starts at (a branch replay begins at its branch point). */
export function replayStartTick(data: Pick<ReplayData, 'setup'>): number {
  return data.setup.branch?.tick ?? 0;
}

export interface ReplayNode {
  data: ReplayData;
  children: ReplayNode[];
  depth: number;
  /** Its parent is no longer stored (deleted or pruned). */
  orphan: boolean;
}

/** Replays arranged as trees: originals (newest first), each followed by its branches (in branch order). */
export function replayTree(list: ReplayData[]): ReplayNode[] {
  const byId = new Map(list.map((r) => [r.id, r]));
  const nodes = new Map<string, ReplayNode>(list.map((r) => [r.id, { data: r, children: [], depth: 0, orphan: false }]));
  const roots: ReplayNode[] = [];
  for (const r of list) {
    const n = nodes.get(r.id)!;
    const parent = r.setup.branch?.parent;
    const p = parent ? nodes.get(parent) : undefined;
    if (p && p !== n) p.children.push(n);
    else {
      n.orphan = !!parent && !byId.has(parent);
      roots.push(n);
    }
  }
  const order = (a: ReplayNode, b: ReplayNode) => (a.data.setup.branch?.tick ?? 0) - (b.data.setup.branch?.tick ?? 0) || a.data.createdAt - b.data.createdAt;
  const setDepth = (n: ReplayNode, d: number, seen: Set<string>) => {
    if (seen.has(n.data.id)) return;
    seen.add(n.data.id);
    n.depth = d;
    n.children.sort(order);
    for (const c of n.children) setDepth(c, d + 1, seen);
  };
  for (const r of roots) setDepth(r, 0, new Set());
  return roots.sort((a, b) => newest(b) - newest(a));
}

/** Most recent activity in a tree (sorting / pruning). */
export function newest(n: ReplayNode): number {
  let t = n.data.storedAt ?? n.data.createdAt;
  for (const c of n.children) t = Math.max(t, newest(c));
  return t;
}

/** Depth-first list of a tree (for rendering rows). */
export function flattenTree(roots: ReplayNode[]): ReplayNode[] {
  const out: ReplayNode[] = [];
  const walk = (n: ReplayNode) => { out.push(n); for (const c of n.children) walk(c); };
  for (const r of roots) walk(r);
  return out;
}

/** Replays to keep: whole trees, most recently active first, until `max` replays (the newest tree always stays). */
export function pruneTrees(list: ReplayData[], max: number): { keep: ReplayData[]; drop: ReplayData[] } {
  const roots = replayTree(list);
  const keep: ReplayData[] = [], drop: ReplayData[] = [];
  roots.forEach((r, i) => {
    const all = flattenTree([r]).map((n) => n.data);
    if (i === 0 || keep.length + all.length <= max) keep.push(...all);
    else drop.push(...all);
  });
  return { keep, drop };
}
