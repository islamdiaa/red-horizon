// Save / load and replay determinism across every mode (REVIEW round 4).
//   node --import tsx tools/qa/modesave.ts [--only <regex>] [--quick] [-v]      (WORKERS=n runs scenarios in parallel)
//   node --import tsx tools/qa/modesave.ts --list
// For each scenario: play world A to the save point with its driver (a scripted human, a campaign / Conquest
// autopilot, or nobody), JSON round-trip serializeWorld(A), build world B the way src/game.ts builds a resumed game,
// then step A and B side by side with fresh drivers. Checked: worldHash right after the load and every 10 ticks, the
// whole serialised state (every saved field, AI and mission state included) at the load and at the end, each side's
// campaign handicap (Player.hc is not serialised: it is re-derived from the level), and for the scenarios that record
// replays (everything but scripted missions) the command log replayed into a fresh world reproduces A's hashes.
// Skirmish scenarios cover Classic and Commander, 2-4 players (the game's limit), teams (multiplayer rosters with humans), AI allies,
// sea maps, surrender with and without a human team-mate (AI takeover); also KOTH, every built-in challenge, co-op
// survival, every campaign / special mission at every level, every Conquest battle kind and a replay branch.
import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import type { GameSetup } from '../../src/game';
import { headlessGame } from '../../src/modes/headless';
import { serializeWorld, deserializeWorld } from '../../src/sim/save';
import { worldHash } from '../../src/replay/hash';
import { AIController, type AIDifficulty } from '../../src/sim/ai';
import { campaignMissions } from '../../src/missions';
import { setDailyDay } from '../../src/missions/special';
import { BUILTIN_LIST } from '../../src/modes/builtins';
import { challengeGameSetup } from '../../src/modes/author';
import { makeBranch, branchSetup } from '../../src/replay/branch';
import { REPLAY_VERSION, type ReplayData } from '../../src/replay/format';
import { BATTLE_KINDS, type BattleKind } from '../../src/conquest/battle';
import { runWithBattle } from '../../src/conquest/testing';
import { createConquestWorld, PILOTS as CONQ_PILOTS } from '../conquest-harness';
import { PILOTS, genericPilot, type Pilot } from '../campaign-pilots';
import '../campaign-pilots-allied';
import '../campaign-pilots-soviet';
import '../campaign-pilots-special';
import { MISSION_LEVELS, type MissionLevel } from '../../src/sim/handicap';
import { BUILDINGS } from '../../src/data/rules';
import type { MissionRuntime } from '../../src/sim/mission';
import type { World } from '../../src/sim/world';
import type { Command } from '../../src/sim/types';
import type { NetPlayer } from '../../src/net/roster';
import { invariants } from './fuzz';

const TICK_HZ = 20;
type Json = any;
const VERBOSE = process.argv.includes('-v');
const QUICK = process.argv.includes('--quick');
/** --seed n: another set of skirmish / Conquest seeds (missions keep their own maps). */
const SEED = (() => { const i = process.argv.indexOf('--seed'); return i > 0 ? +process.argv[i + 1] : 0; })();

// a minimal localStorage (mission progress / levels read it)
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
};
setDailyDay('2026-10-23');

// ------------------------------------------------------------------------------------------------ drivers
/** Per-tick input for one world (fresh state each call); issues through `issue` so a replay can record it. */
type Driver = (w: World, issue: (c: Command) => void) => () => void;

/** A scripted commander for player `pid`: deploy, build a base, train, attack-move at an enemy start (world state only). */
function scripted(pid: number): Driver {
  return (world, issue) => {
    const order = ['powr', 'proc', 'tent', 'barr', 'powr', 'weap', 'proc', 'dome'];
    let built = 0;
    return () => {
      const p = world.players[pid];
      if (!p || p.defeated || p.resigned || !p.isHuman) return;
      const t = world.tick;
      if (t % 40 === 1) {
        const mcv = world.units.find((u) => u.alive && u.owner === p && u.ut.deploysInto);
        if (mcv) issue({ c: 'deploy', player: pid, units: [mcv.id] });
      }
      const q = p.queues.structure;
      while (built < order.length && !p.canBuild(order[built])) built++;
      if (p.has('fact') && !q.items.length && !q.ready && built < order.length) issue({ c: 'build', player: pid, type: order[built] });
      if (q.ready) {
        const fact = world.buildings.find((b) => b.alive && b.owner === p && b.bt.id === 'fact');
        const bt = BUILDINGS[q.ready];
        if (fact && bt) {
          search: for (let r = 2; r < 12; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const cx = fact.cx + dx * 2, cy = fact.cy + dy * 2;
              if (world.canPlace(p, bt.id, cx, cy)) { issue({ c: 'place', player: pid, type: bt.id, cx, cy }); built++; break search; }
            }
          }
        }
      }
      if (t % (TICK_HZ * 8) === pid % 7) for (const u of ['e1', 'e3', '2tnk', '3tnk', 'jeep', 'apc']) if (p.canBuild(u)) issue({ c: 'build', player: pid, type: u });
      if (t % (TICK_HZ * 25) === 3 + pid) {
        const foes = world.players.filter((o) => p.isEnemy(o) && !o.defeated);
        const foe = foes.length ? foes[(t / (TICK_HZ * 25)) % foes.length | 0] : null;
        const s = foe ? world.map.startPositions[foe.id % world.map.startPositions.length] : null;
        const army = world.units.filter((u) => u.owner === p && u.alive && u.weapons.length && !u.ut.harvester).map((u) => u.id);
        if (s && army.length) issue({ c: 'move', player: pid, units: army, x: s.x, y: s.y, attackMove: true });
      }
    };
  };
}

/** Several drivers at once, plus commands at fixed ticks (surrenders). */
function combine(drivers: Driver[], at: [number, Command][] = []): Driver {
  return (w, issue) => {
    const fs = drivers.map((d) => d(w, issue));
    return () => {
      for (const f of fs) f();
      for (const [t, c] of at) if (w.tick === t) issue(JSON.parse(JSON.stringify(c)));
    };
  };
}

/** A campaign / Conquest autopilot, called every 10 ticks like the harnesses do. Post-save it starts with fresh state,
 *  except that its base-building brain is the world's AI for player 0 (saved with the world). */
let pilotState: Record<string, any> | null = null; // the last pre-save pilot's memory (one scenario per process)
let pilotCarry: Record<string, any> = {};
/** The plain-data part of a pilot's memory (numbers, strings, flags, coordinates; not entities or AI controllers). */
function plainPart(s: Record<string, any> | null): Record<string, any> {
  const plain = (v: any): boolean => v === null || ['number', 'string', 'boolean', 'undefined'].includes(typeof v)
    || (Array.isArray(v) && v.every(plain)) || (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(plain));
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(s ?? {})) if (plain(v)) out[k] = JSON.parse(JSON.stringify(v ?? null));
  return out;
}
function pilotDriver(pilot: (w: World, rt: MissionRuntime, s: Record<string, any>) => void, carry: Record<string, any> = {}): Driver {
  return (w) => {
    // post-save: the pre-save pilot's plain memory (phases, timers, spots) on both worlds, so it carries on as it was
    const s: Record<string, any> = w.tick > 0 ? { ...JSON.parse(JSON.stringify(pilotCarry)), ...carry } : {};
    if (w.tick === 0) pilotState = s;
    const brain = w.ais.find((a) => a.player.id === 0);
    if (brain) s.brain = brain;
    return () => { if (w.tick % 10 === 1 && w.mission && !w.gameOver) pilot(w, w.mission, s); }; // (as the harnesses: after ticks 1, 11, 21...)
  };
}

// ------------------------------------------------------------------------------------------------ scenarios
interface Scenario {
  name: string;
  /** A fresh world, or the world src/game.ts builds to resume `load`. */
  make(load?: Json): World;
  driver?: Driver;
  saveAt: number; after: number;
  /** The game records replays of this mode (not scripted missions); pilots that consume world.rng can't be replayed. */
  replay: boolean;
  /** Also take a branch at the save point (replay → take command of `branchAs`) and save / load inside it. */
  branchAs?: number;
  setup?: GameSetup;
}

const BASE: GameSetup = {
  faction: 'allies', color: 0x3d7be0, opponents: [], mapSize: 64, water: 0.4, trees: 0.5, ore: 0.6,
  credits: 10000, startUnits: 'light', fog: true, timeOfDay: 'day', quality: 'low', seed: 4711, intro: false,
} as GameSetup;
const DIFFS: AIDifficulty[] = ['recruit', 'easy', 'normal', 'hard', 'brutal'];
const sec = (s: number) => Math.round(s * TICK_HZ);

/** Resume the way src/game.ts does, plus: AI controllers that joined during play (a pilot's base brain, an AI takeover)
 *  are created first, so the load restores them (the game itself never saves a multiplayer match). */
function resumeExtraAIs(w: World, load: Json, again: () => void) {
  let added = false;
  for (const as of load.ais ?? []) {
    if (w.ais.some((a) => a.player.id === as.player)) continue;
    w.ais.push(new AIController(w, w.players[as.player], as.difficulty));
    added = true;
  }
  if (added) again();
}

function skirmish(name: string, setup0: GameSetup, o: { driver?: Driver; saveAt?: number; after?: number; branchAs?: number } = {}): Scenario {
  const setup = SEED && !setup0.challenge ? { ...setup0, seed: setup0.seed + SEED * 7919 } : setup0;
  return {
    name, replay: true, branchAs: o.branchAs, setup,
    make(load) {
      if (!load) return headlessGame(setup).world;
      const s = { ...setup, load: { version: 1, savedAt: 0, world: load, game: {} } };
      const w = headlessGame(s).world;
      resumeExtraAIs(w, load, () => deserializeWorld(w, load, w.mission));
      return w;
    },
    driver: o.driver ?? scripted(0), saveAt: o.saveAt ?? sec(QUICK ? 120 : 240), after: o.after ?? sec(QUICK ? 90 : 180),
  };
}

function netSetup(base: Partial<GameSetup>, roster: { team: number; human?: boolean; ai?: AIDifficulty; faction?: 'allies' | 'soviet' }[]): GameSetup {
  const COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d, 0xe07b2a, 0x8e4fd0, 0x2aa8a8, 0x9aa0aa];
  const players: NetPlayer[] = roster.map((r, i) => ({ name: `P${i}`, faction: r.faction ?? (i % 2 ? 'soviet' : 'allies'), color: COLORS[i], team: r.team, human: !!r.human, ai: r.human ? undefined : r.ai ?? 'normal', seat: r.human ? i + 1 : undefined, slot: i }));
  // (opponents as net/roster.ts matchSetup fills them: the generated map has a start position per player)
  return { ...BASE, ...base, opponents: players.slice(1).map((p) => ({ faction: p.faction, difficulty: p.ai ?? 'normal' })), net: { room: 'qa', mode: 'ffa', players, local: 0 } } as GameSetup;
}

function missionScenario(id: string, level: MissionLevel): Scenario {
  const pilot = PILOTS[id] ?? genericPilot;
  const setup = { ...BASE, mission: id, missionLevel: level } as GameSetup;
  return {
    name: `mission ${id} ${level}`, replay: false,
    make(load) {
      if (!load) return headlessGame(setup).world;
      const w = headlessGame({ ...setup, load: { version: 1, savedAt: 0, world: load, game: {} } }).world;
      resumeExtraAIs(w, load, () => deserializeWorld(w, load, w.mission));
      return w;
    },
    driver: pilotDriver((w, rt, s) => (pilot as Pilot)(w, rt, s, () => {})),
    saveAt: sec(QUICK ? 90 : 180), after: sec(QUICK ? 90 : 150),
  };
}

function conquestScenario(kind: BattleKind, seed: number): Scenario {
  const { setup } = runWithBattle(seed, seed % 2 ? 'soviet' : 'allies', kind, 'vanguard');
  const frozen = JSON.parse(JSON.stringify(setup));
  return {
    name: `conquest ${kind} s${seed}`, replay: false,
    make(load) {
      const { world, rt } = createConquestWorld(JSON.parse(JSON.stringify(frozen)), !!load);
      if (load) {
        resumeExtraAIs(world, load, () => {});
        deserializeWorld(world, load, rt);
        for (const p of world.players) for (const o of p.buildOptions()) p.knownOptions.add(o); // (as game.ts)
      }
      return world;
    },
    // (the strike force is handed out once: spawned between ticks, a second one would land by the unit grid of the last
    // tick, which a just-loaded world has not built yet - a harness artefact, mission scripts spawn inside the tick)
    driver: pilotDriver((w, rt, s) => CONQ_PILOTS[kind](w, rt, s), { boosted: true }),
    saveAt: sec(QUICK ? 60 : 120), after: sec(QUICK ? 60 : 120),
  };
}

export function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  // --- skirmish: rulesets x player counts
  for (const rules of ['classic', 'commander'] as const) {
    out.push(skirmish(`skirmish ${rules} 1v1`, { ...BASE, rules, seed: 101, opponents: [{ faction: 'soviet', difficulty: 'hard' }] }));
    out.push(skirmish(`skirmish ${rules} 4p ffa`, { ...BASE, rules, seed: 202, mapSize: 96, opponents: DIFFS.slice(1).map((d, i) => ({ faction: i % 2 ? 'allies' : 'soviet', difficulty: d })) }));
    out.push(skirmish(`skirmish ${rules} 3p ffa 192`, { ...BASE, rules, seed: 303, mapSize: 192, opponents: [{ faction: 'soviet', difficulty: 'recruit' }, { faction: 'allies', difficulty: 'brutal' }] }));
    out.push(skirmish(`skirmish ${rules} 2v2 ai ally, human surrenders`, { ...BASE, rules, seed: 404, mapSize: 96, opponents: [{ faction: 'allies', difficulty: 'easy', ally: true }, { faction: 'soviet', difficulty: 'normal' }, { faction: 'soviet', difficulty: 'recruit' }] },
      { driver: combine([scripted(0)], [[sec(QUICK ? 150 : 300), { c: 'resign', player: 0 }]]) }));
    out.push(skirmish(`skirmish ${rules} sea 4p`, { ...BASE, rules, seed: 505, mapSize: 96, water: 0.9, opponents: [{ faction: 'soviet', difficulty: 'hard' }, { faction: 'allies', difficulty: 'normal' }, { faction: 'soviet', difficulty: 'brutal' }] }));
  }
  // --- multiplayer rosters (up to 4 seats, src/net/protocol.ts MAX_SLOTS): 2v2 with three humans; a surrender with a
  //     human team-mate (AI takeover) before the save and one whose team-mate is an AI (the side concedes) after it
  const team4 = (rules: 'classic' | 'commander') => netSetup({ rules, seed: 606, mapSize: 128 }, [
    { team: 0, human: true }, { team: 1, human: true }, { team: 0, human: true }, { team: 1, ai: 'hard' },
  ]);
  for (const rules of ['classic', 'commander'] as const) {
    out.push(skirmish(`mp ${rules} 2v2 humans, takeover + concede`, team4(rules), {
      driver: combine([scripted(0), scripted(1), scripted(2)], [[sec(QUICK ? 60 : 120), { c: 'resign', player: 2 }], [sec(QUICK ? 150 : 300), { c: 'resign', player: 1 }]]),
      branchAs: 3,
    }));
  }
  out.push(skirmish('mp classic 1v1 surrender', netSetup({ rules: 'classic', seed: 707 }, [{ team: 0, human: true }, { team: 1, human: true }]), {
    driver: combine([scripted(0), scripted(1)], [[sec(QUICK ? 150 : 300), { c: 'resign', player: 1 }]]),
  }));
  out.push(skirmish('mp commander 2v2 ffa 3 humans', netSetup({ rules: 'commander', seed: 808, mapSize: 96 }, [{ team: 0, human: true }, { team: 1, human: true }, { team: 2, human: true }, { team: 3, ai: 'hard' }]), {
    driver: combine([scripted(0), scripted(1), scripted(2)]), branchAs: 1,
  }));
  // --- modes
  out.push(skirmish('koth 3p', { ...BASE, seed: 31, koth: true, kothMinutes: 4, opponents: [{ faction: 'soviet', difficulty: 'hard' }, { faction: 'allies', difficulty: 'hard' }] }, { branchAs: 1 }));
  for (const c of BUILTIN_LIST) out.push(skirmish(`challenge ${c.id}`, challengeGameSetup(c, 'low'), { driver: scripted(c.side), saveAt: sec(40), after: sec(60) }));
  out.push(skirmish('co-op survival', { ...BASE, mission: 'survival', allies: [{ difficulty: 'hard' }, { difficulty: 'easy' }] } as GameSetup, { saveAt: sec(QUICK ? 120 : 200), after: sec(120) }));
  // --- campaign and special operations at every level (levels only matter where the mission takes one; scored ones once)
  for (const c of ['allies', 'soviet', 'special'] as const) {
    for (const def of campaignMissions(c)) {
      const levels = c === 'special' && (def.scored || def.id === 'bootcamp') ? ['normal' as MissionLevel] : MISSION_LEVELS;
      for (const l of levels) out.push(missionScenario(def.id, l));
    }
  }
  // --- Conquest: every battle kind
  for (const k of BATTLE_KINDS) out.push(conquestScenario(k, 7 + SEED));
  return out;
}

// ------------------------------------------------------------------------------------------------ checks
/** First few paths where two JSON values differ. */
function jsonDiff(a: Json, b: Json, path = '', out: string[] = [], max = 8): string[] {
  if (out.length >= max) return out;
  if (a === b) return out;
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return out;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    out.push(`${path || '<root>'}: ${JSON.stringify(a)?.slice(0, 120)} vs ${JSON.stringify(b)?.slice(0, 120)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: array vs object`); return out; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) jsonDiff(a[k], b[k], path ? `${path}.${k}` : k, out, max);
  return out;
}
/** Saved fields expected to differ after a load (bookkeeping, not game state). */
function normalise(s: Json): Json {
  if (s?.map) delete s.map.oreVersion; // (bumped on load so ore renderers refresh)
  return s;
}
const ser = (w: World) => normalise(JSON.parse(JSON.stringify(serializeWorld(w))));
const hcOf = (w: World) => w.players.map((p) => (p.hc ? p.hc.section : '-')).join('');

function step(w: World, drive?: () => void) {
  drive?.();
  w.step();
  w.events.length = 0;
  if (w.mission) w.mission.events.length = 0;
}

interface Result { name: string; ok: boolean; notes: string[]; ms: number; ticks: number; ended: string }

export function runScenario(sc: Scenario): Result {
  const t0 = performance.now();
  const notes: string[] = [];
  const bad = (s: string) => { if (notes.length < 12) notes.push(s); };
  const A = sc.make();
  const log: [number, Command][] = [];
  const issueA = (c: Command) => { log.push([A.tick, JSON.parse(JSON.stringify(c))]); A.issue(c); };
  const hashes = new Map<number, string>();
  let drive = sc.driver?.(A, issueA);
  const stale = new Map<number, number>();
  const inv = (w: World, tag: string) => { for (const v of invariants(w, stale)) bad(`invariant ${tag}: ${v}`); };
  while (A.tick < sc.saveAt && !A.gameOver) {
    step(A, drive);
    if (A.tick % 100 === 0) hashes.set(A.tick, worldHash(A));
    if (A.tick % 50 === 0) inv(A, 'A');
  }
  const saveTick = A.tick;
  pilotCarry = plainPart(pilotState);
  const save = JSON.parse(JSON.stringify(serializeWorld(A)));
  const B = sc.make(JSON.parse(JSON.stringify(save)));
  if (worldHash(A) !== worldHash(B)) bad(`hash differs right after the load (tick ${saveTick})`);
  for (const d of jsonDiff(ser(A), ser(B))) bad(`after load: ${d}`);
  if (hcOf(A) !== hcOf(B)) bad(`handicaps after load ${hcOf(A)} vs ${hcOf(B)}`);
  // both continue with fresh drivers (B's commands are its own: a resumed game's player decides afresh)
  drive = sc.driver?.(A, issueA);
  const driveB = sc.driver?.(B, (c) => B.issue(c));
  let diverged = -1;
  const end = saveTick + sc.after;
  while (A.tick < end && !(A.gameOver && B.gameOver)) {
    if (!A.gameOver) step(A, drive);
    if (!B.gameOver) step(B, driveB);
    if (A.tick % 100 === 0) hashes.set(A.tick, worldHash(A));
    if (A.tick % 50 === 0) inv(A, 'A');
    if (diverged < 0 && A.tick % 10 === 0 && worldHash(A) !== worldHash(B)) {
      diverged = A.tick;
      bad(`diverged ${((A.tick - saveTick) / TICK_HZ).toFixed(1)} s after the load: ${jsonDiff(ser(A), ser(B), '', [], 5).join(' ; ')}`);
    }
  }
  if (diverged < 0) {
    for (const d of jsonDiff(ser(A), ser(B))) bad(`at the end: ${d}`);
    if (hcOf(A) !== hcOf(B)) bad(`handicaps at the end ${hcOf(A)} vs ${hcOf(B)}`);
  }
  // replay round trip: the whole command log into a fresh world
  if (sc.replay) {
    const C = sc.make();
    let li = 0;
    while (C.tick < A.tick && !C.gameOver) {
      while (li < log.length && log[li][0] === C.tick) C.issue(JSON.parse(JSON.stringify(log[li++][1])));
      step(C);
      const h = hashes.get(C.tick);
      if (h && h !== worldHash(C)) { bad(`replay diverged at ${(C.tick / TICK_HZ).toFixed(1)} s`); break; }
    }
    if (C.tick === A.tick && worldHash(C) !== worldHash(A)) bad('replay final hash differs');
  }
  // branch: take command of another player at the save point, then save / load inside the branch
  if (sc.branchAs !== undefined && sc.setup) for (const n of runBranch(sc, save)) bad(`branch: ${n}`);
  const ended = A.gameOver ? `over@${(A.tick / TICK_HZ).toFixed(0)}s` : A.mission?.ended ? 'ended' : 'running';
  return { name: sc.name, ok: notes.length === 0, notes, ms: performance.now() - t0, ticks: A.tick, ended };
}

/** Rewind & take command at the save point as `sc.branchAs`, play on, save and load inside the branch, and replay it. */
function runBranch(sc: Scenario, save: Json): string[] {
  const out: string[] = [];
  const at = sc.make(JSON.parse(JSON.stringify(save))); // (the replay player's world at the branch moment)
  const { load: _l, ...base } = sc.setup!;
  const data = { v: REPLAY_VERSION, id: 'qa-parent', setup: base } as unknown as ReplayData;
  const branch = makeBranch(data, at, sc.branchAs!, 'hard');
  const bSetup = JSON.parse(JSON.stringify(branchSetup(data.setup, branch, 'low'))) as GameSetup;
  const mk = (load?: Json) => {
    if (!load) return headlessGame(bSetup).world;
    const w = headlessGame({ ...bSetup, load: { version: 1, savedAt: 0, world: load, game: {} } }).world;
    resumeExtraAIs(w, load, () => deserializeWorld(w, load, w.mission));
    return w;
  };
  const G = mk();
  if (worldHash(G) !== branch.hash) out.push('branch start hash differs from the moment');
  if (!G.players[sc.branchAs!].isHuman || G.players.some((p, i) => i !== sc.branchAs && p.isHuman)) out.push('branch roster: ' + G.players.map((p) => (p.isHuman ? 'H' : 'a')).join(''));
  const log: [number, Command][] = [];
  const issueG = (c: Command) => { log.push([G.tick, JSON.parse(JSON.stringify(c))]); G.issue(c); };
  const hashes = new Map<number, string>();
  let drive = scripted(sc.branchAs!)(G, issueG);
  const t0 = G.tick, mid = t0 + sec(60), end = t0 + sec(120);
  while (G.tick < mid && !G.gameOver) { step(G, drive); if (G.tick % 100 === 0) hashes.set(G.tick, worldHash(G)); }
  const s2 = JSON.parse(JSON.stringify(serializeWorld(G)));
  const H = mk(s2);
  if (worldHash(H) !== worldHash(G)) out.push('hash differs right after loading the branch');
  drive = scripted(sc.branchAs!)(G, issueG);
  const driveH = scripted(sc.branchAs!)(H, (c) => H.issue(c));
  while (G.tick < end && !(G.gameOver && H.gameOver)) {
    if (!G.gameOver) step(G, drive);
    if (!H.gameOver) step(H, driveH);
    if (G.tick % 100 === 0) hashes.set(G.tick, worldHash(G));
    if (G.tick % 10 === 0 && worldHash(G) !== worldHash(H)) { out.push(`loaded branch diverged at +${((G.tick - mid) / TICK_HZ).toFixed(1)} s: ${jsonDiff(ser(G), ser(H), '', [], 4).join(' ; ')}`); break; }
  }
  const R = mk();
  let li = 0;
  while (R.tick < G.tick && !R.gameOver) {
    while (li < log.length && log[li][0] === R.tick) R.issue(JSON.parse(JSON.stringify(log[li++][1])));
    step(R);
    const h = hashes.get(R.tick);
    if (h && h !== worldHash(R)) { out.push(`branch replay diverged at ${(R.tick / TICK_HZ).toFixed(1)} s`); break; }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ CLI
const argOf = (k: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
if (process.argv[1]?.endsWith('modesave.ts')) {
  const all = scenarios();
  const only = argOf('only');
  const one = argOf('one');
  if (process.argv.includes('--list')) { all.forEach((s, i) => console.log(i, s.name)); process.exit(0); }
  if (one !== undefined) {
    const sc = all[+one];
    let r: Result;
    try { r = runScenario(sc); } catch (e) { r = { name: sc.name, ok: false, notes: ['exception: ' + String((e as Error)?.stack ?? e).split('\n').slice(0, 6).join(' | ')], ms: 0, ticks: 0, ended: '?' }; }
    process.send?.(r);
    if (!process.send) console.log(JSON.stringify(r));
    process.exit(0);
  }
  const pick = all.map((s, i) => [s, i] as const).filter(([s]) => !only || new RegExp(only).test(s.name));
  const workers = Math.max(1, Math.min(+(process.env.WORKERS ?? 2), availableParallelism()));
  let next = 0, bad = 0, done = 0;
  const results: Result[] = [];
  const launch = () => {
    if (next >= pick.length) return;
    const [sc, i] = pick[next++];
    const child = fork(process.argv[1], ['--one', String(i), ...(QUICK ? ['--quick'] : []), ...(SEED ? ['--seed', String(SEED)] : [])], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let got = false;
    child.on('message', (r: Result) => {
      got = true;
      results.push(r);
      if (!r.ok) bad++;
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(48)} ${r.ended.padEnd(10)} ${(r.ms / 1000).toFixed(1)}s`);
      for (const n of r.ok ? [] : r.notes.slice(0, VERBOSE ? 12 : 4)) console.log('     ', n.slice(0, 400));
    });
    child.on('exit', () => {
      if (!got) { bad++; console.log(`FAIL ${sc.name} (worker crashed)`); }
      if (++done === pick.length) { console.log(`\n${pick.length - bad}/${pick.length} scenarios deterministic`); process.exit(bad ? 1 : 0); }
      launch();
    });
  };
  for (let k = 0; k < workers; k++) launch();
}
