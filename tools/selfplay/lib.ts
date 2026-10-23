/**
 * Self-play harness core: build a headless skirmish exactly like the game does (src/game.ts), let AIs play
 * it out and collect what happened (winner, length, unit usage, value killed / lost, economy).
 *
 * Used by run.ts (batches of matches over a worker pool), optimize.ts (hill-climbing of AI parameters) and the
 * worker. Everything is deterministic for a given MatchSpec.
 */
import { BUILDINGS, UNITS, WEAPONS, WARHEADS, type Faction } from '../../src/data/rules';
import { RESEARCH, TIER_OF, UPGRADES } from '../../src/sim/economy-data';
import { DOCTRINES } from '../../src/sim/doctrine';
import { POWERS } from '../../src/sim/commander';
import { generateMap } from '../../src/sim/mapgen';
import { GameMap } from '../../src/sim/map';
import { World, type PlayerSetup } from '../../src/sim/world';
import { TICK_HZ } from '../../src/sim/types';
import { Building, Unit, type Entity } from '../../src/sim/entities';
import type { Player } from '../../src/sim/player';
import { AI_DIFFICULTIES, difficultyParams, type AIDifficulty } from '../../src/sim/ai';
import type { Personality } from '../../src/sim/ai-personality';
import { loadCuratedMap, getMapDef } from '../../src/maps';
import { LegacyAIController } from './legacy/ai';
import { AIController as FrozenAIController } from './frozen/ai';
import { StandIn, type StandInLevel } from './standin';
import { pickAIDoctrine } from '../../src/sim/commander';
import { resolvePersonality } from '../../src/sim/ai-personality';
import { ceasefireTicks } from '../../src/sim/ceasefire';
import { applyModSet } from '../../src/mods/engine';
import { mutateSetup, varietyOptions, withEconFlag, withMutatorMods } from '../../src/modes/mutators';
import { Probe, type AIProbe, type NavalProbe, type TeamsProbe } from './probes';
import { ceasefireForSetup } from '../../src/sim/ceasefire';
import { arrangeStarts } from '../../src/sim/starts';
import type { GameSetup } from '../../src/game';

export type MapKind = 'land' | 'sea' | 'curated';

export interface PlayerSpec {
  faction: Faction;
  difficulty: AIDifficulty;
  /** Personality id or a full personality object (src/sim/ai-personality.ts); undefined = default. */
  personality?: string | Personality;
  /** Play this slot with the frozen legacy AI (tools/selfplay/legacy) instead of the current one. */
  legacy?: boolean;
  /**
   * Play this slot as a human stand-in (tools/selfplay/standin.ts): a scripted novice or casual player, or the frozen
   * version-2 Normal AI with a human's economy ("experienced"). The slot counts as a human player.
   */
  standin?: StandInLevel;
  /** Label used in reports (defaults to personality id / "legacy"). */
  label?: string;
}

export interface MatchSpec {
  id: number;
  seed: number;
  map: MapKind;
  /** Generated maps: edge length (default 96). */
  size?: number;
  /** Curated map id (map = 'curated'). */
  curated?: string;
  players: PlayerSpec[];
  /** Hard stop in simulated minutes (default 45). */
  maxMinutes?: number;
  credits?: number;
  startUnits?: 'mcv' | 'light' | 'heavy';
  /**
   * Rule experiments: field overrides applied to the rules tables for this match only (restored afterwards), e.g.
   * { units: { '4tnk': { cost: 1900 } }, weapons: { TeslaZap: { damage: 90 } }, buildings: { afld: { powers: [] } } }.
   */
  rules?: RuleOverrides;
  /** Generated map knobs (defaults as the skirmish menu: 0.5 / 0.5 / 0.6). */
  water?: number;
  trees?: number;
  ore?: number;
  /**
   * Commander rules (src/sim/commander.ts): doctrine per slot (an id, 'none', or undefined = the AI picks
   * its own from personality and seed); `noPowers`: slots that never use commander powers (they still earn points).
   */
  commander?: { doctrines?: (string | null)[]; noPowers?: number[]; econ?: boolean };
  /** Build-up time in minutes (sim/ceasefire.ts; -1 = unlimited), skirmish mutators (modes/mutators.ts: rules and world). */
  ceasefire?: number;
  mutators?: string[];
  /** Battlefield events (default: on under Commander rules). */
  events?: boolean;
  /** Dynamic difficulty (src/sim/events.ts). */
  dynamic?: boolean;
  /**
   * A skirmish exactly as the game sets it up (a Quick Battle roll, the skirmish menu, a multiplayer roster): the map,
   * climate, mutators, events, dynamic difficulty, build-up time and the opponents' levels and personalities come from
   * here (the map / size / water / ore / trees / credits / startUnits / commander / ceasefire / mutators / events /
   * dynamic fields above are ignored). Slot 0 is the human, played by `players[0]` (a stand-in); `players[i]` for the
   * other slots only label them, unless they are stand-ins too (a human teammate or opponent).
   */
  setup?: SkirmishSetup;
  /** Team per slot (2v2, co-op); default: every player on its own team (as a skirmish). */
  teams?: number[];
  /** Simulated minutes at which to record a snapshot of every player (MatchResult.trace). */
  trace?: number[];
  /**
   * Endgame scenarios (tools/selfplay/endgame.ts): at `atMin` the side in `slot` is crushed: every structure gone and
   * every unit but `keep` (the ones farthest from its enemies, an Ore Truck among them when it has one), which head for
   * the far corners of the map and wait there; its stand-in stops playing (a beaten player hiding his last units).
   */
  crush?: { slot: number; atMin: number; keep: number };
  /** Extra measurements while the match plays (tools/selfplay/probes.ts): 'teams', 'naval' or 'ai'. */
  probe?: 'teams' | 'naval' | 'ai';
}

/** The GameSetup fields a skirmish World is built from (src/game.ts). */
export type SkirmishSetup = Pick<GameSetup, 'faction' | 'opponents' | 'mapSize' | 'water' | 'trees' | 'ore' | 'credits' | 'startUnits' | 'fog' | 'seed' | 'timeOfDay'> &
  Partial<Pick<GameSetup, 'climate' | 'mapId' | 'rules' | 'econ' | 'events' | 'mutators' | 'dynamicDifficulty' | 'ceasefire' | 'doctrines' | 'weather' | 'dayCycle'>>;

/** One player at one moment (MatchSpec.trace). */
export interface TraceSnap {
  min: number;
  credits: number;
  harvested: number;
  spent: number;
  /** Credits from anything but ore (events, crates, mutators, powers, derricks): income - harvest. */
  otherIncome: number;
  /** Combat land army value (as the AI's army cap counts it) and unit count; aircraft and ships apart. */
  army: number;
  armyN: number;
  air: number;
  naval: number;
  units: Record<string, number>;
  structures: Record<string, number>;
  defences: number;
  buildSpeed: number;
  incomeBias: number;
  /** AI slots: waves launched so far, its state, dynamic difficulty level. */
  waves?: number;
  state?: string;
  dyn?: number;
}

export interface PlayerResult {
  slot: number;
  faction: Faction;
  difficulty: AIDifficulty;
  label: string;
  won: boolean;
  defeated: boolean;
  /** Units built by type (first time each unit id was seen). */
  built: Record<string, number>;
  /** Structures placed by type. */
  structures: Record<string, number>;
  /** Value (cost) of enemy units / structures this player destroyed, and of its own it lost. */
  killedValue: number;
  lostValue: number;
  /** Destroyed enemy value by the killer's unit type (cost-effectiveness in real games). */
  killsByType: Record<string, number>;
  /** Own value lost by unit type. */
  lostByType: Record<string, number>;
  harvested: number;
  spent: number;
  /** End-of-game (or timeout) material score: army + structures + bank. */
  score: number;
  /** Minute this player first destroyed an enemy unit or structure (-1 = never). */
  firstKillMin: number;
  /** Superweapon / support power commands issued. */
  powers: Record<string, number>;
  /** Commander rules: doctrine played, command points earned, commander powers used. */
  doctrine?: string | null;
  cmdEarned?: number;
  cmdUses?: Record<string, number>;
  /** Commander economy (src/sim/economy.ts): tier reached, research levels, upgrades installed, minute Tier 2 / 3 arrived. */
  econ?: { tier: number; levels: Record<string, number>; upgrades: Record<string, number>; t2: number; t3: number; garrisoned: number };
  /** AI slots: minute of its first attack wave and its first scout (-1 = never), waves launched, structures rebuilt. */
  firstWaveMin?: number;
  firstScoutMin?: number;
  waves?: number;
  /** Minute its first unit reached the enemy's base area (within 16 cells of an enemy construction yard; -1 = never). */
  firstAtEnemyMin?: number;
  /** Snapshots at MatchSpec.trace minutes. */
  trace?: TraceSnap[];
  /** AI slots: its radio chatter by kind (attack, fallback, broken, flank, harass, expand...). */
  chatter?: Record<string, number>;
}

export interface MatchResult {
  id: number;
  seed: number;
  map: string;
  /** Winning team, or -1 when the game timed out (see `leader`). */
  winnerTeam: number;
  /** Team with the best material score at the end (decides timed-out games in the optimizer). */
  leader: number;
  minutes: number;
  timedOut: boolean;
  players: PlayerResult[];
  /** Wall time of the run (ms) and simulation cost (ms per tick). */
  wallMs: number;
  msPerTick: number;
  /** Material score per player every 5 simulated minutes (comeback analysis). */
  samples?: { min: number; score: number[] }[];
  /** MatchSpec.crush: minute the side was crushed (-1 = the match ended before). */
  crushedMin?: number;
  /** Dynamic difficulty: the lowest and highest level it reached (sampled every 30 s; absent when off). */
  dynRange?: [number, number];
  /** MatchSpec.probe results. */
  teams?: TeamsProbe;
  naval?: NavalProbe;
  ai?: AIProbe;
}

const TEAM_COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d];

export interface RuleOverrides {
  units?: Record<string, Record<string, unknown>>;
  weapons?: Record<string, Record<string, unknown>>;
  warheads?: Record<string, Record<string, unknown>>;
  buildings?: Record<string, Record<string, unknown>>;
  /**
   * Commander data experiments: [path, value] pairs into the Commander tables, e.g.
   * ['RESEARCH.precision_optics.levels.1.cost', 3000], ['DOCTRINES.armouredfist.effects.0.mul', 1.05],
   * ['POWERS.funds.cooldown', 300], ['UPGRADES.weap_assembly.cost', 2000], ['TIER_OF.stek', 1].
   */
  patches?: [string, unknown][];
}

// (DIFF: the live difficulty tables of src/sim/ai.ts, e.g. ['DIFF.recruit.firstAttack', 600]; MISSION.* the mission levels)
const DIFF_LIVE = Object.fromEntries(AI_DIFFICULTIES.map((d) => [d, difficultyParams(d) as unknown as Record<string, unknown>]));
const MISSION_LIVE = Object.fromEntries(AI_DIFFICULTIES.map((d) => [d, difficultyParams(d, true) as unknown as Record<string, unknown>]));
const PATCH_ROOTS: Record<string, Record<string, any>> = { RESEARCH, UPGRADES, DOCTRINES, POWERS, TIER_OF, DIFF: DIFF_LIVE, MISSION: MISSION_LIVE };

/** Apply rule overrides in place; returns a function that restores the originals. */
export function applyRules(r?: RuleOverrides): () => void {
  const undo: (() => void)[] = [];
  const patch = (table: Record<string, any>, o?: Record<string, Record<string, unknown>>) => {
    for (const [id, fields] of Object.entries(o ?? {})) {
      const t = table[id];
      if (!t) throw new Error(`rules override: unknown id ${id}`);
      for (const [k, v] of Object.entries(fields)) {
        const had = k in t, old = t[k];
        t[k] = v;
        undo.push(() => { if (had) t[k] = old; else delete t[k]; });
      }
    }
  };
  patch(UNITS, r?.units);
  patch(WEAPONS, r?.weapons);
  patch(WARHEADS, r?.warheads);
  patch(BUILDINGS, r?.buildings);
  for (const [path, v] of r?.patches ?? []) {
    const keys = path.split('.');
    let o: any = PATCH_ROOTS[keys[0]];
    for (const k of keys.slice(1, -1)) o = o?.[k];
    const last = keys[keys.length - 1];
    if (!o || typeof o !== 'object') throw new Error(`rules patch: bad path ${path}`);
    const had = last in o, old = o[last];
    o[last] = v;
    undo.push(() => { if (had) o[last] = old; else delete o[last]; });
  }
  return () => { for (const f of undo.reverse()) f(); };
}

/** Build the world for a match, mirroring Game's skirmish setup (map, start shuffle, climate tweaks). */
export function buildMatch(spec: MatchSpec): World {
  if (spec.setup) return buildFromSetup(spec);
  const n = spec.players.length;
  let map;
  if (spec.map === 'curated') {
    map = loadCuratedMap(spec.curated!);
    if (!map) throw new Error(`unknown curated map ${spec.curated}`);
    const def = getMapDef(spec.curated!)!;
    if (def.players !== n) throw new Error(`${spec.curated} is a ${def.players}-player map`);
  } else {
    map = generateMap({
      size: spec.size ?? 96, players: n, seed: spec.seed, ore: spec.ore ?? 0.6, trees: spec.trees ?? 0.5,
      water: spec.map === 'sea' ? 1 : spec.water ?? 0.5,
    });
    // (as the game: start positions are shuffled by the seed)
    if (spec.seed & 2) map.startPositions.reverse();
  }
  // (as the game: teammates share a side; free-for-alls and 1v1 unchanged)
  if (spec.teams) map.startPositions = arrangeStarts(map.startPositions, spec.players.map((_, i) => spec.teams![i] ?? i));
  const players: PlayerSetup[] = spec.players.map((ps, i) => ({
    name: `P${i}`, faction: ps.faction, color: TEAM_COLORS[i], team: spec.teams?.[i] ?? i, isHuman: !!ps.standin,
    ai: ps.legacy || ps.standin ? undefined : ps.difficulty,
    personality: ps.legacy || ps.standin ? undefined : ps.personality,
  } as PlayerSetup));
  // (stand-ins: no doctrine for the scripted players, as a human who never opened the picker; the experienced one
  // picks the way the AI it is a copy of would)
  let doctrines = spec.commander?.doctrines;
  if (spec.commander && spec.players.some((ps) => ps.standin)) {
    doctrines = spec.players.map((ps, i) => doctrines?.[i] !== undefined ? doctrines[i]
      : ps.standin === 'experienced' ? pickAIDoctrine(ps.faction, resolvePersonality(ps.personality), spec.seed, i)
      : ps.standin ? 'none' : undefined) as (string | null)[];
  }
  const world = new World({
    map, players, credits: spec.credits ?? 10000, startUnits: spec.startUnits ?? 'light', fog: true, seed: spec.seed,
    rules: spec.commander ? 'commander' : undefined, doctrines, econ: spec.commander?.econ,
    ceasefireUntil: ceasefireTicks(spec.ceasefire), mutators: spec.mutators, events: spec.events, dynamicDifficulty: spec.dynamic,
  });
  for (const i of spec.commander?.noPowers ?? []) { const c = world.players[i]?.cmd; if (c) c.disabled = true; }
  attachSlots(spec, world);
  return world;
}

/** The setup a MatchSpec.setup match plays (mutators' conditions and the Commander economy flag, as game.ts). */
function matchSetup(spec: MatchSpec): SkirmishSetup {
  return withEconFlag(mutateSetup({ ...spec.setup! } as GameSetup));
}

/**
 * A skirmish World built from a GameSetup step for step as src/game.ts builds it (map and climate, the player list
 * with the opponents' levels and personalities, start shuffle, credits, build-up time, rules, mutators, events,
 * dynamic difficulty, doctrines). Slot 0 is the human.
 */
function buildFromSetup(spec: MatchSpec): World {
  const setup = matchSetup(spec);
  const nPlayers = 1 + setup.opponents.length;
  const curated = setup.mapId ? loadCuratedMap(setup.mapId) : null;
  if (setup.mapId && !curated) throw new Error(`unknown curated map ${setup.mapId}`);
  const climate = curated?.climate ?? (setup.climate === 'winter' || setup.climate === 'desert' ? setup.climate : 'temperate') as 'temperate' | 'winter' | 'desert';
  const map = curated ?? generateMap({
    size: setup.mapSize, players: nPlayers, seed: setup.seed, ore: setup.ore,
    water: climate === 'desert' && setup.water < 0.9 ? Math.min(setup.water, 0.2) : setup.water,
    trees: climate === 'desert' ? setup.trees * 0.35 : climate === 'winter' ? Math.min(1, setup.trees * 1.2) : setup.trees,
  });
  map.climate = climate;
  const rngFaction = (i: number): Faction => ((setup.seed >> i) & 1 ? 'allies' : 'soviet');
  // (slot 0 is the human, unless players[0] is a plain AI spec: AI-only scenarios on a skirmish setup)
  const p0 = spec.players[0], human0 = !p0 || !!p0.standin;
  const players: PlayerSetup[] = [{ name: 'Commander', faction: setup.faction, color: TEAM_COLORS[0], team: spec.teams?.[0] ?? 0, isHuman: human0, ai: human0 ? undefined : p0.difficulty, personality: human0 ? undefined : p0.personality } as PlayerSetup];
  setup.opponents.forEach((o, i) => {
    const ps = spec.players[i + 1];
    const human = !!ps?.standin;
    const faction = ps?.faction ?? (o.faction === 'random' ? rngFaction(i + 1) : o.faction);
    players.push({ name: `P${i + 1}`, faction, color: TEAM_COLORS[(i + 1) % TEAM_COLORS.length], team: spec.teams?.[i + 1] ?? (o.ally ? 0 : i + 1), isHuman: human, ai: human ? undefined : o.difficulty, personality: human ? undefined : o.personality } as PlayerSetup);
  });
  if (setup.seed & 2) map.startPositions.reverse(); // (as game.ts: curated maps too)
  map.startPositions = arrangeStarts(map.startPositions, players.map((p) => p.team)); // teammates share a side (as game.ts)
  // (stand-ins never open the doctrine picker; the experienced one picks the way the AI it is a copy of would)
  const doctrines = setup.rules === 'commander' && spec.players.some((ps) => ps.standin)
    ? players.map((pl, i) => spec.players[i]?.standin === 'experienced' ? pickAIDoctrine(pl.faction, resolvePersonality(spec.players[i].personality), setup.seed, i) : spec.players[i]?.standin ? 'none' : setup.doctrines?.[i])
    : setup.doctrines;
  const world = new World({
    map, players, credits: setup.credits, startUnits: setup.startUnits, fog: setup.fog, seed: setup.seed,
    ceasefireUntil: ceasefireForSetup(setup, false),
    ...varietyOptions(setup, false),
    doctrines: doctrines as (string | null)[] | undefined,
  });
  attachSlots(spec, world);
  return world;
}

/** Legacy / experienced slots (frozen controllers, in the slot order the world would give them) and the scripted stand-ins. */
function attachSlots(spec: MatchSpec, world: World) {
  const n = world.players.length;
  if (spec.players.some((ps) => ps.legacy || ps.standin === 'experienced')) {
    const ais: any[] = [];
    for (let i = 0; i < n; i++) {
      const p = world.players[i], ps = spec.players[i];
      if (ps?.legacy) {
        const ai = new LegacyAIController(world, p, ps.difficulty as any);
        p.isHuman = false;
        ais.push(ai);
      } else if (ps?.standin === 'experienced') {
        const ai = new FrozenAIController(world, p, 'normal', ps.personality);
        p.buildSpeed = 1; // (a human's economy, not the AI difficulty's)
        p.incomeBias = 1;
        ais.push(ai);
      } else {
        ais.push(world.ais.find((a) => a.player === p));
      }
    }
    world.ais = ais.filter(Boolean);
  }
  standIns.set(world, spec.players.flatMap((ps, i) => (ps?.standin && ps.standin !== 'experienced' && world.players[i] ? [new StandIn(world, world.players[i], ps.standin, spec.seed)] : [])));
}

/** The scripted stand-ins of a world built by buildMatch (they act between world steps). */
const standIns = new WeakMap<World, StandIn[]>();

/** Step a match world: stand-in input first (as UI input arrives between ticks), then the simulation. */
export function stepMatch(world: World) {
  for (const s of standIns.get(world) ?? []) s.tick();
  world.step();
}

function labelOf(ps: PlayerSpec): string {
  if (ps.label) return ps.label;
  if (ps.legacy) return 'legacy';
  if (ps.standin) return ps.standin;
  if (!ps.personality) return 'default';
  return typeof ps.personality === 'string' ? ps.personality : ps.personality.id;
}

/** Material score: what a player still has (units, structures at half value, bank). */
function materialScore(world: World, pid: number): number {
  let s = 0;
  for (const u of world.units) if (u.alive && u.owner.id === pid && !u.ut.supportPlane) s += u.ut.cost * u.healthFrac;
  for (const b of world.buildings) if (b.alive && b.owner.id === pid && !b.bt.mine && !b.bt.wall) s += b.bt.cost * 0.5 * b.healthFrac;
  s += world.players[pid].credits * 0.5;
  return s;
}

/** Play one match to the end (or the time limit) and summarise it. */
export function playMatch(spec: MatchSpec): MatchResult {
  const restore = applyRules(spec.rules);
  const muts = spec.setup ? matchSetup(spec).mutators : spec.mutators;
  const mods = muts?.length ? withMutatorMods(undefined, muts) : undefined;
  if (mods) applyModSet(mods); // (the mutators' rule changes, as Game applies them)
  try {
    return playMatchInner(spec);
  } finally {
    if (mods) applyModSet(null);
    restore();
  }
}

function playMatchInner(spec: MatchSpec): MatchResult {
  const t0 = performance.now();
  const world = buildMatch(spec);
  const n = spec.players.length;
  const res: PlayerResult[] = spec.players.map((ps, i) => ({
    slot: i, faction: ps.faction, difficulty: ps.difficulty, label: labelOf(ps), won: false, defeated: false,
    built: {}, structures: {}, killedValue: 0, lostValue: 0, killsByType: {}, lostByType: {}, harvested: 0, spent: 0, score: 0,
    firstKillMin: -1, powers: {},
  }));
  const probe = spec.probe ? new Probe(world, spec.probe) : null;
  // losses / kills: wrap World.kill (every death goes through it)
  const kill = world.kill.bind(world);
  world.kill = (e: Entity, how = 'normal', killer?: Entity) => {
    if (probe && e.alive && how !== 'sold' && (e instanceof Unit || e instanceof Building)) probe.onKill(e, killer instanceof Unit || killer instanceof Building ? killer : undefined);
    if (e.alive && how !== 'sold' && !(e instanceof Building && (e.bt.mine || e.bt.wall)) && !(e instanceof Unit && e.ut.supportPlane)) {
      const cost = e.type.cost;
      const victim = res[e.owner.id];
      if (victim) {
        victim.lostValue += cost;
        victim.lostByType[e.type.id] = (victim.lostByType[e.type.id] ?? 0) + cost;
      }
      const k = killer?.owner.id;
      if (k !== undefined && k !== e.owner.id && res[k]) {
        res[k].killedValue += cost;
        res[k].killsByType[killer!.type.id] = (res[k].killsByType[killer!.type.id] ?? 0) + cost;
        if (res[k].firstKillMin < 0) res[k].firstKillMin = world.time / 60;
      }
    }
    kill(e, how, killer);
  };
  const issue = world.issue.bind(world);
  world.issue = (c) => {
    if (c.c === 'superweapon' && res[c.player]) res[c.player].powers[c.kind] = (res[c.player].powers[c.kind] ?? 0) + 1;
    issue(c);
  };
  const seen = new Set<number>();
  const samples: { min: number; score: number[] }[] = [];
  const maxTicks = (spec.maxMinutes ?? 45) * 60 * TICK_HZ;
  const credits0 = world.players.map((p) => p.credits);
  const traceAt = new Set((spec.trace ?? []).map((m) => Math.round(m * 60 * TICK_HZ)));
  const chatSeen: number[] = [];
  let dynRange: [number, number] | undefined;
  const crushAt = spec.crush ? Math.round(spec.crush.atMin * 60 * TICK_HZ) : -1;
  let crushedMin = -1;
  const yards = (pid: number) => world.buildings.filter((b) => b.alive && b.bt.id === 'fact' && world.players[pid].isEnemy(b.owner));
  for (let t = 1; t <= maxTicks; t++) {
    if (t === crushAt) { crushSide(world, spec.crush!); crushedMin = world.time / 60; }
    stepMatch(world);
    probe?.step();
    if (t % (5 * 60 * TICK_HZ) === 0) samples.push({ min: t / (60 * TICK_HZ), score: world.players.map((p) => Math.round(materialScore(world, p.id))) });
    if (t % (30 * TICK_HZ) === 1 && world.variety?.dyn) { const l = world.variety.dd.level; dynRange = dynRange ? [Math.min(dynRange[0], l), Math.max(dynRange[1], l)] : [l, l]; }
    if (traceAt.has(t)) for (const p of world.players) (res[p.id].trace ??= []).push(snapshot(world, p, credits0[p.id]));
    if (t % (5 * TICK_HZ) === 0) {
      for (const p of world.players) {
        const r = res[p.id];
        const ai: any = world.ais.find((a) => a.player === p);
        if (ai?.chatter) {
          const from = chatSeen[p.id] ?? -1;
          for (const c of ai.chatter) if (c.tick > from) (r.chatter ??= {})[c.kind] = ((r.chatter ??= {})[c.kind] ?? 0) + 1;
          if (ai.chatter.length) chatSeen[p.id] = ai.chatter[ai.chatter.length - 1].tick;
        }
        if (ai && typeof ai.waves === 'number') {
          if (ai.waves > 0 && r.firstWaveMin === undefined) r.firstWaveMin = world.time / 60;
          if (ai.scout && r.firstScoutMin === undefined) r.firstScoutMin = world.time / 60;
        }
        if (r.firstAtEnemyMin === undefined) {
          const ys = yards(p.id);
          if (ys.length && world.units.some((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester && u.kind !== 'aircraft' && ys.some((y) => Math.hypot(y.x - u.x, y.y - u.y) < 16))) r.firstAtEnemyMin = world.time / 60;
        }
      }
    }
    for (const ev of world.events) {
      if (ev.e === 'placed') {
        const b = world.entities.get(ev.id);
        if (b instanceof Building && res[b.owner.id] && !b.bt.mine) res[b.owner.id].structures[b.bt.id] = (res[b.owner.id].structures[b.bt.id] ?? 0) + 1;
        if (b instanceof Building && !b.bt.mine && !b.bt.wall) probe?.onPlaced(b);
      }
    }
    if (world.econ) for (const ev of world.events) {
      if (ev.e !== 'econ' || ev.stage !== 'done' || !res[ev.player]) continue;
      const e = (res[ev.player].econ ??= { tier: 1, levels: {}, upgrades: {}, t2: -1, t3: -1, garrisoned: 0 });
      if (ev.id === 'cy_t2') e.t2 = Math.round(world.time / 6) / 10;
      else if (ev.id === 'cy_t3') e.t3 = Math.round(world.time / 6) / 10;
      else if (ev.id in UPGRADES) e.upgrades[ev.id] = (e.upgrades[ev.id] ?? 0) + 1;
      else e.levels[ev.id] = ev.level;
    }
    world.events.length = 0;
    if (t % 10 === 0) {
      for (const u of world.units) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        if (u.ut.supportPlane || !res[u.owner.id]) continue;
        res[u.owner.id].built[u.ut.id] = (res[u.owner.id].built[u.ut.id] ?? 0) + 1;
      }
    }
    if (world.gameOver) break;
  }
  probe?.finish();
  const scores = world.players.map((p) => materialScore(world, p.id));
  for (const p of world.players) {
    const r = res[p.id];
    r.defeated = p.defeated;
    r.won = world.gameOver && world.winnerTeam === p.team;
    r.harvested = Math.round(p.stats.harvested);
    r.spent = Math.round(p.stats.spent);
    r.score = Math.round(scores[p.id]);
    const ai: any = world.ais.find((a) => a.player === p);
    if (ai && typeof ai.waves === 'number') r.waves = ai.waves;
    r.firstWaveMin ??= -1;
    r.firstScoutMin ??= -1;
    r.firstAtEnemyMin ??= -1;
    if (p.cmd) { r.doctrine = p.cmd.doctrine; r.cmdEarned = Math.round(p.cmd.earned * 10) / 10; r.cmdUses = { ...p.cmd.uses }; }
    if (p.econ) {
      const e = (r.econ ??= { tier: 1, levels: {}, upgrades: {}, t2: -1, t3: -1, garrisoned: 0 });
      e.tier = p.econ.tier;
      e.levels = { ...p.econ.levels };
      for (const b of world.buildings) if (b.alive && b.owner === p && b.garrison) e.garrisoned += b.garrison.length;
    }
  }
  let leader = 0;
  for (let i = 1; i < n; i++) if (scores[i] > scores[leader]) leader = i;
  const wallMs = performance.now() - t0;
  return {
    id: spec.id, seed: spec.seed, map: spec.map === 'curated' ? spec.curated! : `${spec.map}${spec.size ?? 96}`,
    winnerTeam: world.gameOver ? world.winnerTeam : -1, leader: world.gameOver && world.winnerTeam >= 0 ? world.winnerTeam : leader,
    minutes: world.time / 60, timedOut: !world.gameOver, players: res, wallMs, msPerTick: wallMs / Math.max(1, world.tick),
    samples, teams: probe?.teams, naval: probe?.naval, ai: probe?.ai, dynRange, crushedMin: spec.crush ? crushedMin : undefined,
  };
}

/** MatchSpec.crush: the side is reduced to its `keep` units farthest from its enemies, which go and hide. */
export function crushSide(world: World, c: NonNullable<MatchSpec['crush']>) {
  const p = world.players[c.slot];
  if (!p || p.defeated) return;
  standIns.set(world, (standIns.get(world) ?? []).filter((s) => s.p !== p));
  const enemyYards = world.buildings.filter((b) => b.alive && b.bt.id === 'fact' && p.isEnemy(b.owner));
  const far = (e: { x: number; y: number }) => enemyYards.reduce((m, y) => Math.min(m, Math.hypot(y.x - e.x, y.y - e.y)), Infinity);
  for (const b of world.buildings) if (b.alive && b.owner === p) world.kill(b, 'sold');
  const land = world.units.filter((u) => u.alive && u.owner === p && u.kind !== 'aircraft' && u.kind !== 'naval' && !u.ut.supportPlane)
    .sort((a, b) => far(b) - far(a) || a.id - b.id);
  const truck = land.find((u) => u.ut.harvester);
  const keep: Unit[] = [];
  if (truck && c.keep > 1) keep.push(truck);
  for (const u of land) if (keep.length < c.keep && !keep.includes(u)) keep.push(u);
  for (const u of world.units) if (u.alive && u.owner === p && !keep.includes(u)) world.kill(u, 'sold');
  // hiding spots: the passable cells nearest the map's corners, farthest from the enemies' yards first
  const m = world.map;
  const corners: [number, number][] = [];
  for (const [cx, cy] of [[2, 2], [m.w - 3, 2], [2, m.h - 3], [m.w - 3, m.h - 3]]) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let r = 0; r < 16 && !best; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!m.inBounds(x, y) || !m.passable(x, y)) continue;
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = [x + 0.5, y + 0.5]; }
    }
    if (best) corners.push(best);
  }
  corners.sort((a, b) => far({ x: b[0], y: b[1] }) - far({ x: a[0], y: a[1] }));
  keep.forEach((u, i) => {
    const [x, y] = corners[i % Math.max(1, corners.length)] ?? [u.x, u.y];
    world.issue({ c: 'move', player: p.id, units: [u.id], x, y });
  });
}

/** A player's state for MatchSpec.trace. */
function snapshot(world: World, p: Player, credits0: number): TraceSnap {
  const units: Record<string, number> = {}, structures: Record<string, number> = {};
  let army = 0, armyN = 0, air = 0, naval = 0, defences = 0;
  for (const u of world.units) {
    if (!u.alive || u.owner !== p) continue;
    units[u.ut.id] = (units[u.ut.id] ?? 0) + 1;
    if (!u.weapons.length || u.ut.harvester || u.ut.deploysInto || u.ut.supportPlane) continue;
    if (u.kind === 'aircraft') air += u.ut.cost;
    else if (u.kind === 'naval') naval += u.ut.cost;
    else if (!u.ut.medic) { army += u.ut.cost; armyN++; }
  }
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== p || b.bt.wall || b.bt.mine) continue;
    structures[b.bt.id] = (structures[b.bt.id] ?? 0) + 1;
    if (b.weapons.length) defences++;
  }
  const ai: any = world.ais.find((a) => a.player === p);
  const income = p.credits + p.stats.spent - credits0;
  return {
    min: Math.round(world.time / 6) / 10, credits: p.credits, harvested: Math.round(p.stats.harvested), spent: Math.round(p.stats.spent),
    otherIncome: Math.round(income - p.stats.harvested), army, armyN, air, naval, units, structures, defences,
    buildSpeed: Math.round(p.buildSpeed * 100) / 100, incomeBias: Math.round(p.incomeBias * 100) / 100,
    waves: ai?.waves, state: ai ? `${ai.state}/${ai.stage}` : undefined, dyn: world.variety?.dd?.level,
  };
}

/** Unit ids by category for reports. */
export function unitKind(id: string): string {
  return UNITS[id]?.kind ?? 'building';
}

// ---------------------------------------------------------------------------
// Cost-equal duels (tools/selfplay/balance.ts): equal-budget groups attack-move into each other on open ground
// ---------------------------------------------------------------------------

export interface DuelSpec { a: string; b: string; seed: number; budget: number; rules?: RuleOverrides }
export interface DuelResult extends DuelSpec { aCost: number; bCost: number; aLeft: number; bLeft: number; seconds: number; aN: number; bN: number }

function spawnGroup(w: World, pid: number, type: string, n: number, x: number, y: number, face: number): Unit[] {
  const out: Unit[] = [];
  const isInf = UNITS[type].kind === 'infantry';
  const step = isInf ? 0.6 : 1.1;
  const cols = Math.ceil(Math.sqrt(n * 2));
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / cols), c = k % cols;
    const u = w.addUnit(type, w.players[pid], x + (pid === 0 ? -r : r) * step, y + (c - cols / 2) * step);
    u.heading = u.prevHeading = u.turret = u.prevTurret = face;
    if (u.kind === 'aircraft') { u.altitude = 1; }
    out.push(u);
  }
  return out;
}

export function playDuel(d: DuelSpec): DuelResult {
  const restore = applyRules(d.rules);
  try {
    return playDuelInner(d);
  } finally {
    restore();
  }
}

function playDuelInner(d: DuelSpec): DuelResult {
  const map = new GameMap(60, 40);
  map.startPositions = [{ x: 8.5, y: 31.5 }, { x: 51.5, y: 8.5 }];
  const w = new World({
    map, credits: 0, startUnits: 'none', fog: false, seed: d.seed,
    players: [{ name: 'A', faction: UNITS[d.a].owner[0], color: 0, team: 0, isHuman: true }, { name: 'B', faction: UNITS[d.b].owner[0], color: 0, team: 1, isHuman: true }],
  });
  w.cratesEnabled = false;
  // equal budgets: pick the budget (between 1x and 2x the nominal one) at which both sides' unit counts cost the
  // closest to each other (Lanchester's square law punishes even a 5% rounding difference)
  let aN = 1, bN = 1, bestErr = Infinity;
  for (let B = d.budget; B <= d.budget * 2; B += 50) {
    const na = Math.max(1, Math.round(B / UNITS[d.a].cost)), nb = Math.max(1, Math.round(B / UNITS[d.b].cost));
    const ca = na * UNITS[d.a].cost, cb = nb * UNITS[d.b].cost;
    const err = Math.abs(ca - cb) / Math.max(ca, cb);
    if (err < bestErr - 0.005) { bestErr = err; aN = na; bN = nb; }
  }
  // alternate creation order (the first-created side would otherwise update first)
  let A: Unit[], B: Unit[];
  if (d.seed % 2) { A = spawnGroup(w, 0, d.a, aN, 20.5, 20.5, 0); B = spawnGroup(w, 1, d.b, bN, 40.5, 20.5, Math.PI); }
  else { B = spawnGroup(w, 1, d.b, bN, 40.5, 20.5, Math.PI); A = spawnGroup(w, 0, d.a, aN, 20.5, 20.5, 0); }
  w.issue({ c: 'move', player: 0, units: A.map((u) => u.id), x: 45.5, y: 20.5, attackMove: true });
  w.issue({ c: 'move', player: 1, units: B.map((u) => u.id), x: 15.5, y: 20.5, attackMove: true });
  let t = 0, quiet = 0;
  const max = 240 * TICK_HZ;
  for (; t < max; t++) {
    w.step();
    const fired = w.events.some((e) => e.e === 'fire');
    w.events.length = 0;
    if (!A.some((u) => u.alive) || !B.some((u) => u.alive)) break;
    quiet = fired ? 0 : quiet + 1;
    if (quiet > 30 * TICK_HZ && t > 40 * TICK_HZ) break;
    if (t % (TICK_HZ * 5) === 0) {
      const ia = A.filter((u) => u.alive && u.order.type === 'idle').map((u) => u.id);
      const ib = B.filter((u) => u.alive && u.order.type === 'idle').map((u) => u.id);
      const ca = B.find((u) => u.alive), cb = A.find((u) => u.alive);
      if (ia.length && ca) w.issue({ c: 'move', player: 0, units: ia, x: ca.x, y: ca.y, attackMove: true });
      if (ib.length && cb) w.issue({ c: 'move', player: 1, units: ib, x: cb.x, y: cb.y, attackMove: true });
    }
  }
  const val = (us: Unit[]) => us.reduce((s, u) => s + (u.alive ? u.ut.cost * u.hp / u.maxHp : 0), 0);
  return { ...d, aCost: aN * UNITS[d.a].cost, bCost: bN * UNITS[d.b].cost, aLeft: val(A), bLeft: val(B), seconds: t / TICK_HZ, aN, bN };
}
