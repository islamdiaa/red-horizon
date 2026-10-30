/**
 * World Conquest: the strategic layer's public API (pure functions over the WorldRun JSON).
 *
 *   newWorldRun      a seed + homeland + size + difficulty -> a run, the human's first reinforce phase
 *   legalActions/act the actions open now, and a generic dispatcher (the QA tools' random policies)
 *   placeTroops, tradeCards, rollAttack (+ attackOdds), moveIn, fortify, endPhase, endTurn (the rivals' playback)
 *   resolveDefence   a rival's attack on a capital or wonder waits for your choice: dice, or startDefenceBattle
 *   diplomacy.ts     ceasefires · resolve.ts the RTS route · score.ts · link.ts · storage.ts
 *
 * Deterministic: the run's own random generator only (state.ts withRng). A run replays identically from its
 * options and the sequence of calls; saving and loading the JSON at any point gives the same continuation.
 */
import { Rng } from '../../core/rng';
import type { Faction } from '../../data/rules';
import { CALLSIGNS, COMMANDERS, DOCTRINES } from '../data';
import { atlas, buildRunMap, homelandById } from './atlas';
import { aiAttack, aiTurn } from './powers';
import {
  TURN_LIMIT, adjustMove, attackBlock, beginPowerTurn, bestSet, connectedOwn, doAttack, doFortify, emit, endGame, finishPowerTurn, fortifyBlock,
  mustTrade, place, tradeSet, type AttackResult,
} from './rules';
import { pickWorldPerk, withdrawBattle } from './resolve';
import {
  HUMAN, NEUTRAL, PERSONALITY_IDS, WORLD_DIFFICULTIES, WORLD_RUN_VERSION, emptyWorldStats, hashStr, ix, mix, ownedCount, terr, withRng,
  type PowerPersonality, type WPower, type WorldDifficulty, type WorldEvent, type WorldRun, type WorldSize,
} from './state';
import type { Veteran } from '../state';

export * from './state';
export { attackOdds, type AttackOdds } from './odds';
export {
  CARD_KINDS, SET_VALUES, CAPITAL_TROOPS, BRUTAL_TROOPS, TURN_LIMIT, reinforcements, setValue, bestSet, mustTrade, isSet, wondersHeld, wonderSum,
  diceMods, attackBlock, fortifyBlock, connectedOwn, type AttackResult, type Reinforcements,
} from './rules';
export { ceasefireChance, offerCeasefire, answerOffer, breakCeasefire, ceasefireBlock, CEASEFIRE_TURNS, BETRAYAL_TURNS } from './diplomacy';
export {
  startBattle, startDefenceBattle, applyBattle, withdrawBattle, battlePreview, pendingSetup, battleLosses, garrisonStrength, attackKind,
  pickWorldPerk, buyWorldResearch, worldCoreCapacity, worldDate,
} from './resolve';
export { rivalIntentions, aiProfile } from './powers';
export { atlas, setAtlas, regionById, homelandById, zoneById, STUB_ATLAS, GEO_ATLAS } from './atlas';

export interface NewWorldOptions {
  seed: number;
  home: string;
  size: WorldSize;
  difficulty: WorldDifficulty;
  /** Doctrine side (default: the homeland's). */
  faction?: Faction;
  ironman?: boolean;
  /** Fog of war on rivals' troop counts (Hard and Brutal only). */
  fog?: boolean;
  /** Europe Conquest doctrine for the battles you fight (default Combined Arms). */
  doctrine?: string;
  /** Number of rival powers (2-6; default World 5, Blitz 3). */
  rivals?: number;
  /** Rival attacks on your capitals and wonders ask you to fight them (default true). */
  askDefence?: boolean;
  /** Weekly World key ("2026-W43"), recorded with the score. */
  weekly?: string;
  /** Makes the run id unique (the UI passes a timestamp; it affects nothing else). */
  nonce?: number;
}

/** Regime name keys (src/i18n/en/world.ts `regime.*`): fictional 1950s regimes, never real states. */
export const REGIMES = [
  'ironDirectorate', 'crimsonUnion', 'northernCompact', 'coastalFederation', 'steelRepublic', 'dawnCoalition', 'southernJunta', 'azureConcord',
  'granitePact', 'emberCommonwealth', 'frontierLeague', 'thunderHegemony',
] as const;
const COLORS = [0xd23a2c, 0xe0b030, 0x3fa34d, 0x9b59d0, 0xe07b2a, 0x2bb3c0, 0xc8487e];
const HUMAN_COLOR: Record<Faction, number> = { allies: 0x3d7be0, soviet: 0xd23a2c };

/** Starting territories per power (homeland regions, topped up from neighbours so every start is the same size). */
export const START_TERRITORIES = 3;
/** Starting troops on the capital and on each other starting territory. */
export const START_CAPITAL = 8;
export const START_OTHER = 4;

export function newWorldRun(opts: NewWorldOptions): WorldRun {
  const A = atlas();
  const seed = opts.seed >>> 0;
  const home = homelandById(opts.home) ?? A.homelands[0];
  const size: WorldSize = opts.size === 'blitz' ? 'blitz' : 'world';
  const difficulty: WorldDifficulty = WORLD_DIFFICULTIES.includes(opts.difficulty) ? opts.difficulty : 'normal';
  const rng = new Rng(mix(seed, hashStr(home.id)) ^ 0x2545f491);
  const map = buildRunMap(A, size, home, seed);
  const faction: Faction = opts.faction === 'soviet' || opts.faction === 'allies' ? opts.faction : home.faction;
  // (the default doctrine is Vanguard, a core army of five veterans: the old Conquest battle curve was measured with it)
  const doctrine = DOCTRINES.find((d) => d.id === (opts.doctrine ?? 'vanguard')) ?? DOCTRINES[0];
  const diffCredits = difficulty === 'recruit' || difficulty === 'easy' ? 2000 : difficulty === 'hard' || difficulty === 'brutal' ? -1000 : 0;
  const run: WorldRun = {
    v: WORLD_RUN_VERSION, mode: 'world',
    id: `w-${seed.toString(36)}-${home.id}-${size}-${difficulty}${opts.nonce !== undefined ? `-${Math.abs(Math.floor(opts.nonce)).toString(36)}` : ''}`,
    seed, size, difficulty, ironman: !!opts.ironman, fog: !!opts.fog && (difficulty === 'hard' || difficulty === 'brutal'), home: home.id, faction, atlas: A.version,
    turn: 1, phase: 'reinforce', player: HUMAN, current: HUMAN, toPlace: 0, status: 'active', rng: 0,
    territories: map.territories, links: map.links, zones: map.zones, powers: [], trades: 0, conqueredThisTurn: false, fortifiesLeft: 1, navyLeft: 0,
    askDefence: opts.askDefence !== false, conquest: null, pending: null, defence: null, offers: [],
    army: {
      warChest: 6000 + diffCredits + (doctrine.credits ?? 0), rp: 2 + (doctrine.rp ?? 0), core: [], nextVet: 1, perks: [...doctrine.perks], research: [...doctrine.research],
      perkChoice: null, doctrine: doctrine.id,
    },
    stats: emptyWorldStats(), medals: [], log: [], quiet: 0, battleScore: 0, report: null,
    ...(opts.weekly ? { weekly: String(opts.weekly).slice(0, 12) } : {}),
  };
  const X = ix(run);
  const T = run.territories;
  // ---- the human
  const capIdx = X.byId.get(home.capital) ?? home.regions.map((r) => X.byId.get(r)).find((i) => i !== undefined) ?? 0;
  const powers: WPower[] = [];
  const mk = (id: number, name: string, commander: string, f: Faction, personality: WPower['personality'], homeId: string, capital: number, color: number): WPower => ({
    id, name, commander, faction: f, personality, home: homeId, capital: T[capital].id, cards: [], alive: true, color, ceasefire: 0, distrust: 0, offered: 0, grudge: [],
  });
  powers.push(mk(HUMAN, 'player', '', faction, 'human', home.id, capIdx, HUMAN_COLOR[faction]));
  // ---- rivals: homelands far from every capital so far (graph distance), on other continents in a World run
  // (Blitz: 3 rivals on its ~30 territories; with 4 the human, who starts in the middle of the map, was wiped out in the
  // first turns in most Easy games: tools/world/strat-bench.ts. World: 5 rivals)
  const nRivals = Math.max(2, Math.min(6, opts.rivals ?? (size === 'world' ? 5 : 3)));
  const caps = [capIdx];
  const homes = [home.id];
  const dist = (from: number) => {
    const d = T.map(() => Infinity);
    d[from] = 0;
    const q = [from];
    while (q.length) { const c = q.shift()!; for (const n of X.adj[c]) if (d[n] === Infinity) { d[n] = d[c] + 1; q.push(n); } }
    return d;
  };
  const dists: number[][] = [dist(capIdx)];
  // (rival capitals at least 3 links from every other capital, 2 where a small map leaves no room)
  let minDist = 3;
  const candidates = A.homelands.filter((h) => h.id !== home.id && X.byId.has(h.capital));
  const rivalHomes: { id: string; capital: number; faction: Faction }[] = [];
  for (let k = 0; k < nRivals; k++) {
    const scored = candidates
      .filter((h) => !homes.includes(h.id))
      .map((h) => {
        const ci = X.byId.get(h.capital)!;
        const dmin = Math.min(...dists.map((d) => d[ci]));
        const same = caps.filter((c) => T[c].continent === T[ci].continent).length;
        // (as central as your capital: spreading the rivals as far apart as possible put them on the map's edges,
        // with 4 foreign neighbours at the start to your 6, tools/world/strat-bench.ts)
        const edge = Math.max(0, X.adj[capIdx].length - X.adj[ci].length);
        return { h, ci, dmin, score: Math.min(dmin, 6) - (size === 'world' ? 1.5 * same : 0) - 0.8 * edge + rng.next() * 1.5 };
      })
      .filter((x) => x.dmin !== Infinity)
      .sort((a, b) => b.score - a.score || (a.h.id < b.h.id ? -1 : 1));
    while (minDist > 2 && !scored.some((x) => x.dmin >= minDist)) minDist--;
    for (let i = scored.length - 1; i >= 0; i--) if (scored[i].dmin < minDist) scored.splice(i, 1);
    let ci: number, hid: string, hf: Faction;
    if (scored.length) {
      ci = scored[0].ci; hid = scored[0].h.id; hf = scored[0].h.faction;
    } else {
      // not enough homelands in reach: the farthest free territory becomes a capital
      let best = -1, bd = -1;
      T.forEach((t, i) => { const d = Math.min(...dists.map((dd) => dd[i])); if (t.owner === NEUTRAL && d !== Infinity && d > bd && !caps.includes(i)) { bd = d; best = i; } });
      if (best < 0 || bd < 2) break;
      ci = best; hid = ''; hf = rng.chance(0.5) ? 'allies' : 'soviet';
    }
    caps.push(ci);
    homes.push(hid);
    dists.push(dist(ci));
    rivalHomes.push({ id: hid, capital: ci, faction: hf });
  }
  // personalities: each once (shuffled), the naval power on the most coastal capital
  const pers: PowerPersonality[] = rng.shuffle([...PERSONALITY_IDS]);
  while (pers.length < rivalHomes.length) pers.push(rng.pick(PERSONALITY_IDS));
  pers.length = rivalHomes.length;
  const lanes = (i: number) => X.sea[i].filter(Boolean).length + (T[i].port ? 1 : 0);
  const navalAt = pers.indexOf('naval');
  if (navalAt >= 0) {
    let best = navalAt;
    rivalHomes.forEach((r, k) => { if (lanes(r.capital) > lanes(rivalHomes[best].capital)) best = k; });
    [pers[navalAt], pers[best]] = [pers[best], pers[navalAt]];
  }
  const regimes = rng.shuffle([...REGIMES]);
  const used = new Set<string>();
  const colors = COLORS.filter((c) => c !== HUMAN_COLOR[faction]);
  rivalHomes.forEach((r, k) => {
    const list = COMMANDERS[r.faction];
    const cmd = list.find((c) => !used.has(c.name)) ?? list[k % list.length];
    used.add(cmd.name);
    powers.push(mk(k + 1, regimes[k], cmd.name, r.faction, pers[k], r.id, r.capital, colors[k % colors.length]));
  });
  for (const P of powers) P.grudge = powers.map(() => 0);
  run.powers = powers;
  // ---- starting territories: the homeland's regions, topped up (or trimmed) to the same size for everyone
  const placed: number[][] = [];
  /** Would taking n leave an earlier start without a neutral neighbour (nothing to attack in turn 1)? */
  const lastExit = (n: number, mine: number[]) => placed.some((S) => {
    const exits = new Set(S.flatMap((i) => X.adj[i]).filter((x) => T[x].owner === NEUTRAL && !caps.includes(x) && !mine.includes(x)));
    return exits.size === 1 && exits.has(n);
  });
  powers.forEach((P) => {
    const ci = X.byId.get(P.capital)!;
    const want: number[] = [ci];
    const h = homelandById(P.home);
    const homeRegions = new Set((h?.regions ?? []).map((r) => X.byId.get(r)).filter((i): i is number => i !== undefined));
    // top up from the free neighbours that keep the start's frontier smallest (land first), the same for everyone
    const frontier = (set: number[]) => new Set(set.flatMap((i) => X.adj[i]).filter((i) => !set.includes(i))).size;
    for (let guard = 0; want.length < START_TERRITORIES && guard < 20; guard++) {
      let pick = -1, pickSea = true, pickF = Infinity;
      for (const w of want) X.adj[w].forEach((n, k) => {
        if (want.includes(n) || T[n].owner !== NEUTRAL || caps.includes(n)) return;
        const sea = X.sea[w][k];
        // (the homeland's own regions are preferred, but not at the price of a wider front; and never another start's
        // last way out: an island homeland must have something to attack in turn 1)
        const f = frontier([...want, n]) - (homeRegions.has(n) ? 0.5 : 0) + (lastExit(n, want) ? 100 : 0);
        if (pick < 0 || (pickSea && !sea) || (pickSea === sea && (f < pickF || (f === pickF && T[n].id < T[pick].id)))) { pick = n; pickSea = sea; pickF = f; }
      });
      if (pick < 0) break;
      want.push(pick);
    }
    want.forEach((i, k) => { T[i].owner = P.id; T[i].troops = k === 0 ? START_CAPITAL : START_OTHER; });
    T[ci].capital = P.id;
    placed.push(want);
    // mobilisation: an exposed start (more than 4 foreign neighbours) gets a troop for each one more, on its borders
    const extra = Math.min(3, Math.max(0, frontier(want) - 4));
    for (let k = 0; k < extra; k++) {
      const b = want.filter((i) => X.adj[i].some((n) => !want.includes(n))).sort((a, c) => X.adj[c].filter((n) => !want.includes(n)).length - X.adj[a].filter((n) => !want.includes(n)).length || a - c)[k % want.length] ?? ci;
      T[b].troops++;
    }
  });
  // ---- neutrals: weak next to a start (the first easy battle), stronger far away and at wonders
  const near = T.map((_, i) => Math.min(...dists.map((d) => d[i])));
  T.forEach((t, i) => {
    if (t.owner !== NEUTRAL) return;
    let n = rng.int(2, 4) + (t.landmark ? 1 : 0);
    if (near[i] <= 1) n = Math.min(n, 3);
    else if (near[i] >= 4 && size === 'world') n += 1;
    t.troops = n;
  });
  // every start has at least one neutral neighbour held by a single troop (the first battle is an easy one)
  for (const P of powers) {
    const mine = T.map((t, i) => (t.owner === P.id ? i : -1)).filter((i) => i >= 0);
    const ns = [...new Set(mine.flatMap((i) => X.adj[i]))].filter((n) => T[n].owner === NEUTRAL).sort((a, b) => T[a].troops - T[b].troops || a - b);
    if (ns.length && T[ns[0]].troops > 1) T[ns[0]].troops = 1;
  }
  // ---- the human's battle army (doctrine)
  for (const c of doctrine.core ?? []) {
    const free = CALLSIGNS.filter((n) => !run.army.core.some((v) => v.name === n));
    const v: Veteran = { id: run.army.nextVet++, type: c[faction], rank: c.rank, xp: 0, name: rng.pick(free), battles: 0, joined: 1 };
    run.army.core.push(v);
  }
  if (run.fog) run.seen = powers.map(() => T.map(() => -1));
  run.rng = (rng as unknown as { s: number }).s >>> 0;
  beginPowerTurn(run, HUMAN);
  run.stats.peakTerritories = ownedCount(run, HUMAN);
  return run;
}

// =====================================================================================================
// The human's actions
// =====================================================================================================
const myTurn = (run: WorldRun) => run.status === 'active' && run.current === HUMAN && !run.pending && !run.defence;

export function placeTroops(run: WorldRun, id: string, n: number, events?: WorldEvent[]): boolean {
  return myTurn(run) && place(run, HUMAN, id, n, events);
}

/** Place every troop in hand the way a sensible commander would (the rivals' placement logic). */
export function autoPlace(run: WorldRun): boolean {
  if (!myTurn(run) || run.toPlace <= 0 || mustTrade(run, HUMAN)) return false;
  // the borders facing the strongest neighbours, then the best attack: one troop at a time, deterministic
  const X = ix(run), T = run.territories;
  for (let guard = 0; run.toPlace > 0 && guard < 500; guard++) {
    let best = -1, bs = -Infinity;
    T.forEach((t, i) => {
      if (t.owner !== HUMAN) return;
      let threat = 0, weak = Infinity;
      for (const n of X.adj[i]) {
        const o = T[n].owner;
        if (o === HUMAN) continue;
        if (o !== NEUTRAL) threat = Math.max(threat, T[n].troops);
        weak = Math.min(weak, T[n].troops);
      }
      if (!threat && weak === Infinity) return;
      const s = (threat - t.troops) * (t.capital !== undefined ? 1.5 : 1) + (weak !== Infinity ? 3 - weak * 0.5 : 0) - t.troops * 0.05;
      if (s > bs) { bs = s; best = i; }
    });
    if (best < 0) best = T.findIndex((t) => t.owner === HUMAN);
    if (!place(run, HUMAN, T[best].id, 1)) return false;
  }
  return true;
}

export function tradeCards(run: WorldRun, idx: number[], events?: WorldEvent[]): number {
  return myTurn(run) ? tradeSet(run, HUMAN, idx, events) : 0;
}

export interface RollResult extends AttackResult {}

/** Attack with the dice: one roll, or a blitz (until the territory falls or you are down to one troop). */
export function rollAttack(run: WorldRun, fromId: string, toId: string, blitz = false, dice?: number, events?: WorldEvent[]): RollResult | null {
  if (!myTurn(run) || attackBlock(run, fromId, toId, HUMAN)) return null;
  return doAttack(run, fromId, toId, { blitz, dice, keepDice: true }, events);
}

/** Change how many troops moved into the last conquest. */
export function moveIn(run: WorldRun, n: number): boolean {
  return myTurn(run) && adjustMove(run, n);
}

export function fortify(run: WorldRun, fromId: string, toId: string, n: number, events?: WorldEvent[]): boolean {
  if (!myTurn(run) || fortifyBlock(run, fromId, toId, n, HUMAN)) return false;
  doFortify(run, fromId, toId, n, events);
  return true;
}

/** Own territories troops can move to from a territory (fortify). */
export function fortifyTargets(run: WorldRun, fromId: string): string[] {
  const i = ix(run).byId.get(fromId);
  if (i === undefined || run.territories[i].owner !== HUMAN) return [];
  return connectedOwn(run, i).map((n) => run.territories[n].id);
}

/** Every attack open to you now (from, to, the dice you may roll). */
export function attackTargets(run: WorldRun, fromId?: string): { from: string; to: string; sea: boolean; dice: number }[] {
  if (!myTurn(run) || run.phase !== 'attack') return [];
  const X = ix(run), T = run.territories;
  const out: { from: string; to: string; sea: boolean; dice: number }[] = [];
  T.forEach((t, a) => {
    if (t.owner !== HUMAN || t.troops < 2 || (fromId && t.id !== fromId)) return;
    X.adj[a].forEach((b, k) => {
      if (!attackBlock(run, t.id, T[b].id, HUMAN)) out.push({ from: t.id, to: T[b].id, sea: X.sea[a][k], dice: Math.min(3, t.troops - 1) });
    });
  });
  return out;
}

/** Move on to the next phase (reinforce -> attack -> fortify -> the rivals' turns). */
export function endPhase(run: WorldRun): WorldEvent[] {
  if (!myTurn(run)) return [];
  if (run.phase === 'reinforce') {
    if (run.toPlace > 0 || mustTrade(run, HUMAN)) return [];
    run.phase = 'attack';
    return [];
  }
  if (run.phase === 'attack') {
    if (run.toPlace > 0 || mustTrade(run, HUMAN)) return [];
    run.phase = 'fortify';
    run.conquest = null;
    return [];
  }
  return endTurn(run);
}

/**
 * End your turn (from the attack or fortify phase): your card, then every rival's turn as a playback list, then
 * your next reinforce phase. If a rival attacks one of your capitals or wonders, the playback stops with
 * run.defence set: answer it (resolveDefence, or startDefenceBattle + applyBattle) and call endTurn again.
 */
export function endTurn(run: WorldRun): WorldEvent[] {
  const events: WorldEvent[] = [];
  if (run.status !== 'active' || run.pending || run.defence) return events;
  let next: number;
  let resume = false;
  if (run.current === HUMAN) {
    if (run.phase === 'reinforce' || run.toPlace > 0 || mustTrade(run, HUMAN)) return events;
    finishPowerTurn(run, HUMAN, events);
    run.offers = [];
    run.roundHits = 0;
    next = 1;
  } else {
    next = run.current;
    resume = true;
  }
  for (let p = next; p < run.powers.length && run.status === 'active'; p++) {
    if (!run.powers[p].alive) continue;
    if (!(resume && p === next)) beginPowerTurn(run, p, events);
    const r = aiTurn(run, p, events);
    if (r === 'paused') return events;
    finishPowerTurn(run, p, events);
    if (!run.conqueredThisTurn) run.quiet++;
  }
  if (run.status !== 'active') return events;
  // a new turn
  run.turn++;
  for (const P of run.powers) P.grudge = P.grudge.map((g) => Math.floor(g * 0.85));
  if (run.turn > TURN_LIMIT[run.size]) {
    // the world sues for peace: the strongest power wins
    const counts = run.powers.map((P) => ownedCount(run, P.id));
    const best = Math.max(...counts);
    endGame(run, counts[HUMAN] === best ? 'won' : 'lost', 'armistice', events);
    return events;
  }
  beginPowerTurn(run, HUMAN, events);
  return events;
}

/** Answer a rival's attack on one of your capitals or wonders with the dice (the rival rolls as it would). */
export function resolveDefence(run: WorldRun, how: 'dice' = 'dice'): WorldEvent[] {
  const D = run.defence;
  const events: WorldEvent[] = [];
  if (!D || run.pending || how !== 'dice') return events;
  run.defence = null;
  const from = terr(run, D.from), to = terr(run, D.to);
  if (from.owner === D.power && to.owner === HUMAN && from.troops >= 2) aiAttack(run, D.power, D.from, D.to, events);
  return events;
}

// =====================================================================================================
// Legal actions + generic dispatcher
// =====================================================================================================
export type WorldAction =
  | { type: 'place'; to: string; max: number; n?: number }
  | { type: 'trade'; cards: number[] }
  | { type: 'attack'; from: string; to: string; dice: number; blitz?: boolean }
  | { type: 'move'; min: number; max: number; n?: number }
  | { type: 'fortify'; from: string; to: string; max: number; n?: number }
  | { type: 'endPhase' }
  | { type: 'endTurn' }
  | { type: 'defend'; how: 'dice' }
  | { type: 'withdraw' }
  | { type: 'perk'; id: string };

export function legalActions(run: WorldRun): WorldAction[] {
  if (run.status !== 'active') return [];
  if (run.pending) return [{ type: 'withdraw' }];
  if (run.defence) return [{ type: 'defend', how: 'dice' }];
  if (run.current !== HUMAN) return [{ type: 'endTurn' }]; // (a rival's turn waiting to continue)
  const out: WorldAction[] = [];
  if (run.army.perkChoice) for (const id of run.army.perkChoice) out.push({ type: 'perk', id });
  const set = bestSet(run, HUMAN);
  const forced = mustTrade(run, HUMAN);
  if (set && (run.phase === 'reinforce' || forced)) out.push({ type: 'trade', cards: set });
  if (forced) return out;
  const T = run.territories;
  if (run.toPlace > 0 && (run.phase === 'reinforce' || run.phase === 'attack')) {
    for (const t of T) if (t.owner === HUMAN) out.push({ type: 'place', to: t.id, max: run.toPlace });
    return out;
  }
  if (run.phase === 'reinforce') { out.push({ type: 'endPhase' }); return out; }
  if (run.phase === 'attack') {
    for (const a of attackTargets(run)) out.push({ type: 'attack', from: a.from, to: a.to, dice: a.dice });
    if (run.conquest && run.conquest.max > run.conquest.min) out.push({ type: 'move', min: run.conquest.min, max: run.conquest.max });
  }
  if (run.fortifiesLeft > 0) {
    T.forEach((t, i) => {
      if (t.owner !== HUMAN || t.troops < 2) return;
      for (const n of connectedOwn(run, i)) out.push({ type: 'fortify', from: t.id, to: T[n].id, max: t.troops - 1 });
    });
  }
  if (run.phase === 'attack') out.push({ type: 'endPhase' });
  out.push({ type: 'endTurn' });
  return out;
}

/** Apply one action (as listed by legalActions). Returns the events it produced (the rivals' playback for endTurn). */
export function act(run: WorldRun, a: WorldAction): WorldEvent[] {
  const ev: WorldEvent[] = [];
  switch (a.type) {
    case 'place': placeTroops(run, a.to, a.n ?? a.max, ev); return ev;
    case 'trade': tradeCards(run, a.cards, ev); return ev;
    case 'attack': rollAttack(run, a.from, a.to, a.blitz ?? true, a.dice, ev); return ev;
    case 'move': moveIn(run, a.n ?? a.max); return ev;
    case 'fortify': fortify(run, a.from, a.to, a.n ?? a.max, ev); return ev;
    case 'endPhase': return endPhase(run);
    case 'endTurn': return endTurn(run);
    case 'defend': return resolveDefence(run, 'dice');
    case 'withdraw': withdrawBattle(run, ev); return ev;
    case 'perk': pickWorldPerk(run, a.id); return ev;
  }
}

/** Fog of war (Hard+ option): the human sees troop counts on its own territories and their neighbours. */
export function troopsVisible(run: WorldRun, id: string): boolean {
  if (!run.fog) return true;
  const X = ix(run);
  const i = X.byId.get(id);
  if (i === undefined) return false;
  return run.territories[i].owner === HUMAN || X.adj[i].some((n) => run.territories[n].owner === HUMAN);
}

/** An easy first RTS battle to suggest (the weakest neutral next to a big stack of yours), or null. */
export function suggestedBattle(run: WorldRun): { from: string; to: string } | null {
  let best: { from: string; to: string; s: number } | null = null;
  for (const a of attackTargets(run)) {
    const f = terr(run, a.from), t = terr(run, a.to);
    if (t.owner !== NEUTRAL || a.sea) continue;
    const s = (f.troops - 1) / Math.max(1, t.troops) + (t.landmark ? 2 : 0);
    if (!best || s > best.s) best = { from: a.from, to: a.to, s };
  }
  return best ? { from: best.from, to: best.to } : null;
}

/** Power names for display: the human is 'player'; rivals use their regime key (src/i18n/en/world.ts regime.*). */
export function powerName(run: WorldRun, p: number): string {
  return run.powers[p]?.name ?? 'neutral';
}

export { emit, withRng };
