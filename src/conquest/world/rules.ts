/**
 * World Conquest rules, the same for the human and every rival: reinforcements (territories, zones, capitals,
 * wonders, cards), card sets on a capped escalating scale, attacks with Risk dice (sea lanes need a port at one end
 * or a navy wonder), conquest and the troops moved in, elimination (the victim's cards pass to the victor),
 * fortifying through connected territories, and the end of the game.
 */
import { atlas } from './atlas';
import { rollOnce } from './dice';
import { worldScore } from './score';
import {
  HUMAN, NEUTRAL, atCeasefire, ix, logEvent, ownedCount, tIndex, terr, withRng,
  type DiceRoll, type WTerritory, type WorldEvent, type WorldRun,
} from './state';
import type { CardKind, WonderEffect } from './types';

export const CARD_KINDS: CardKind[] = ['infantry', 'armour', 'air'];
/**
 * Troops for the 1st, 2nd... set traded by anyone; capped at the last value so it never runs away. (Risk's open-ended
 * 4, 6, 8, 10, 12, 15, 20... and a cap of 15 both let whoever eliminated a rival snowball on its cards: one rival held
 * 76-99% of the map in the slowest tenth of the games, tools/world/strat-bench.ts.)
 */
export const SET_VALUES = [4, 5, 6, 8, 10];
/** Holding this many cards at the start of a turn forces a trade; this many after taking a rival's, immediately. */
export const FORCE_TRADE = 5;
export const FORCE_TRADE_ELIM = 6;
/** Each capital held: troops a turn. */
export const CAPITAL_TROOPS = 2;
/** A Brutal rival's extra troops a turn (the only AI bonus; Normal and below have none). */
export const BRUTAL_TROOPS = 1;
/** The world sues for peace after this many turns (stalemate guard; the strongest power wins). */
export const TURN_LIMIT = { world: 150, blitz: 80 } as const;

// =====================================================================================================
// Wonders
// =====================================================================================================
export interface HeldWonder { t: WTerritory; effect: WonderEffect }
export function wondersHeld(run: WorldRun, p: number): HeldWonder[] {
  if (p === NEUTRAL) return [];
  const out: HeldWonder[] = [];
  const A = atlas();
  for (const t of run.territories) {
    if (t.owner !== p || !t.landmark) continue;
    const effect = A.wonder(t.landmark);
    if (effect) out.push({ t, effect });
  }
  return out;
}

/** Sum of one kind of wonder effect a power holds (optionally only wonders in one zone). */
export function wonderSum(run: WorldRun, p: number, kind: WonderEffect['kind'], zone?: string): number {
  let n = 0;
  for (const w of wondersHeld(run, p)) {
    const e = w.effect;
    if (e.kind !== kind || (zone !== undefined && w.t.zone !== zone)) continue;
    switch (e.kind) {
      case 'troops': case 'fortify': case 'navy': n += e.add; break;
      case 'income': case 'diplomacy': n += e.pct; break;
      case 'attack': case 'defence': n += e.dice; break;
      case 'card': n += 1; break;
      case 'intel': n += e.turns; break;
    }
  }
  return n;
}

/** Dice modifiers for an attack: the attacker's wonders in the zone it attacks from, the defender's in its own zone. */
export function diceMods(run: WorldRun, from: WTerritory, to: WTerritory): { att: number; def: number } {
  return {
    att: Math.min(2, wonderSum(run, from.owner, 'attack', from.zone)),
    def: to.owner === NEUTRAL ? 0 : Math.min(2, wonderSum(run, to.owner, 'defence', to.zone)),
  };
}

// =====================================================================================================
// Reinforcements
// =====================================================================================================
export interface Reinforcements { total: number; lines: { key: string; n: number; zone?: string }[] }

export function reinforcements(run: WorldRun, p = HUMAN): Reinforcements {
  const lines: Reinforcements['lines'] = [];
  const n = ownedCount(run, p);
  if (!n) return { total: 0, lines };
  lines.push({ key: 'territories', n: Math.max(3, Math.floor(n / 3)) });
  const X = ix(run);
  X.zoneT.forEach((ts, z) => {
    if (ts.length && ts.every((i) => run.territories[i].owner === p)) lines.push({ key: 'zone', n: run.zones[z].bonus, zone: run.zones[z].id });
  });
  const caps = run.territories.filter((t) => t.capital !== undefined && t.owner === p).length;
  if (caps) lines.push({ key: 'capitals', n: CAPITAL_TROOPS * caps });
  const w = wonderSum(run, p, 'troops');
  if (w) lines.push({ key: 'wonders', n: w });
  if (p !== HUMAN && run.difficulty === 'brutal') lines.push({ key: 'brutal', n: BRUTAL_TROOPS });
  return { total: lines.reduce((s, l) => s + l.n, 0), lines };
}

// =====================================================================================================
// Cards
// =====================================================================================================
export function isSet(cards: readonly CardKind[]): boolean {
  if (cards.length !== 3) return false;
  const [a, b, c] = cards;
  return (a === b && b === c) || (a !== b && b !== c && a !== c);
}

/** Troops the next set is worth. */
export function setValue(run: WorldRun): number {
  return SET_VALUES[Math.min(run.trades, SET_VALUES.length - 1)];
}

/** A valid set in a power's hand (card indices, ascending), or null. Prefers one of each, then the commonest kind. */
export function bestSet(run: WorldRun, p = HUMAN): number[] | null {
  const hand = run.powers[p]?.cards ?? [];
  const pos = (k: CardKind) => hand.map((c, i) => (c === k ? i : -1)).filter((i) => i >= 0);
  const per = CARD_KINDS.map(pos);
  if (per.every((l) => l.length)) return per.map((l) => l[0]).sort((a, b) => a - b);
  let best: number[] | null = null;
  for (const l of per) if (l.length >= 3 && (!best || l.length > best.length)) best = l;
  return best ? best.slice(0, 3) : null;
}

export function mustTrade(run: WorldRun, p = run.current): boolean {
  const hand = run.powers[p]?.cards ?? [];
  if (run.phase === 'reinforce') return hand.length >= FORCE_TRADE && !!bestSet(run, p);
  if (run.phase === 'attack') return hand.length >= FORCE_TRADE_ELIM && !!bestSet(run, p);
  return false;
}

/** Trade a set (card indices) for troops to place now. Returns the troops (0: not allowed / not a set). */
export function tradeSet(run: WorldRun, p: number, idx: readonly number[], events?: WorldEvent[]): number {
  if (run.status !== 'active' || run.current !== p) return 0;
  const P = run.powers[p];
  const ok = run.phase === 'reinforce' || (run.phase === 'attack' && P.cards.length >= FORCE_TRADE_ELIM);
  if (!ok) return 0;
  const uniq = [...new Set(idx)].sort((a, b) => b - a);
  if (uniq.length !== 3 || uniq.some((i) => i < 0 || i >= P.cards.length || !Number.isInteger(i))) return 0;
  const cards = uniq.map((i) => P.cards[i]);
  if (!isSet(cards)) return 0;
  const n = setValue(run);
  for (const i of uniq) P.cards.splice(i, 1);
  run.trades++;
  run.toPlace += n;
  if (p === HUMAN) run.stats.cardsTraded++;
  emit(run, events, { kind: 'trade', power: p, cards, n });
  return n;
}

export function drawCard(run: WorldRun, p: number, events?: WorldEvent[]): CardKind {
  const card = withRng(run, (rng) => rng.pick(CARD_KINDS));
  run.powers[p].cards.push(card);
  emit(run, events, { kind: 'card', power: p, card });
  return card;
}

// =====================================================================================================
// Placement
// =====================================================================================================
export function place(run: WorldRun, p: number, id: string, n: number, events?: WorldEvent[]): boolean {
  if (run.status !== 'active' || run.current !== p || run.pending) return false;
  if (run.phase !== 'reinforce' && !(run.phase === 'attack' && run.toPlace > 0)) return false;
  if (mustTrade(run, p)) return false;
  n = Math.floor(n);
  if (!(n >= 1) || n > run.toPlace) return false;
  const i = ix(run).byId.get(id);
  if (i === undefined) return false;
  const t = run.territories[i];
  if (t.owner !== p) return false;
  t.troops += n;
  run.toPlace -= n;
  emit(run, events, { kind: 'reinforce', power: p, to: id, n });
  return true;
}

// =====================================================================================================
// Attacks
// =====================================================================================================
/** The link between two territories (index-level), or null. */
export function linkOf(run: WorldRun, a: number, b: number): { sea: boolean } | null {
  const X = ix(run);
  const k = X.adj[a].indexOf(b);
  return k < 0 ? null : { sea: X.sea[a][k] };
}

/** A sea lane is usable: a port at one end, or a navy wonder crossing left this turn (or already used on it). */
export function laneUsable(run: WorldRun, a: number, b: number): boolean {
  const ta = run.territories[a], tb = run.territories[b];
  if (ta.port || tb.port) return true;
  return run.navyLeft > 0 || (run.lanes ?? []).includes(laneKey(ta.id, tb.id));
}
const laneKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Why an attack is not allowed (null: it is). */
export function attackBlock(run: WorldRun, fromId: string, toId: string, p = run.current): string | null {
  if (run.status !== 'active') return 'over';
  if (run.current !== p) return 'turn';
  if (run.pending || run.defence) return 'busy';
  if (run.phase !== 'attack') return 'phase';
  if (run.toPlace > 0 || mustTrade(run, p)) return 'place';
  const X = ix(run);
  const a = X.byId.get(fromId), b = X.byId.get(toId);
  if (a === undefined || b === undefined) return 'unknown';
  const from = run.territories[a], to = run.territories[b];
  if (from.owner !== p) return 'notYours';
  if (to.owner === p) return 'own';
  if (from.troops < 2) return 'troops';
  const l = linkOf(run, a, b);
  if (!l) return 'notAdjacent';
  if (l.sea && !laneUsable(run, a, b)) return 'port';
  if (atCeasefire(run, p, to.owner)) return 'ceasefire';
  // (the opening month: every power expands into neutral land before the powers clash)
  if (run.turn === 1 && to.owner !== NEUTRAL) return 'firstTurn';
  return null;
}

export interface AttackResult {
  rolls: DiceRoll[];
  conquered: boolean;
  attLoss: number;
  defLoss: number;
  moveMin: number;
  moveMax: number;
  moved: number;
  /** The defender was eliminated. */
  eliminated: boolean;
}

export interface RollOpts {
  blitz?: boolean;
  /** Attacker dice (1-3, capped by troops). */
  dice?: number;
  /** Stop a blitz when the conquest chance from here falls below this (the AI's judgement). */
  stopBelow?: (x: number, y: number) => boolean;
  /** Troops to move in after a conquest (default: a sensible split, see defaultMove). */
  move?: (min: number, max: number) => number;
  /** Keep the dice in the result (the human's animation); the rivals' playback keeps only totals. */
  keepDice?: boolean;
}

/** Roll an attack (one roll, or a blitz). Assumes attackBlock() is null. */
export function doAttack(run: WorldRun, fromId: string, toId: string, opts: RollOpts, events?: WorldEvent[]): AttackResult {
  const p = run.current;
  const a = tIndex(run, fromId), b = tIndex(run, toId);
  const from = run.territories[a], to = run.territories[b];
  const defender = to.owner;
  const l = linkOf(run, a, b)!;
  if (l.sea && !from.port && !to.port) {
    const key = laneKey(from.id, to.id);
    run.lanes ??= [];
    if (!run.lanes.includes(key)) { run.lanes.push(key); run.navyLeft--; }
  }
  run.conquest = null;
  const mods = diceMods(run, from, to);
  const rolls: DiceRoll[] = [];
  let attLoss = 0, defLoss = 0;
  withRng(run, (rng) => {
    for (let guard = 0; guard < 2000; guard++) {
      const ad = Math.max(1, Math.min(3, from.troops - 1, opts.dice ?? 3));
      const dd = Math.min(2, to.troops);
      const r = rollOnce(rng, ad, dd, mods.att, mods.def);
      rolls.push(r);
      from.troops -= r.attLoss;
      to.troops -= r.defLoss;
      attLoss += r.attLoss;
      defLoss += r.defLoss;
      if (to.troops <= 0 || from.troops <= 1 || !opts.blitz) break;
      if (opts.stopBelow?.(from.troops - 1, to.troops)) break;
    }
  });
  bookLosses(run, p, defender, attLoss, defLoss);
  const conquered = to.troops <= 0;
  let moveMin = 0, moveMax = 0, moved = 0, eliminated = false;
  if (conquered) {
    const lastDice = rolls[rolls.length - 1].att.length;
    moveMax = from.troops - 1;
    moveMin = Math.min(moveMax, lastDice);
    moved = Math.max(moveMin, Math.min(moveMax, Math.round(opts.move ? opts.move(moveMin, moveMax) : defaultMove(run, a, moveMin, moveMax))));
    emit(run, events, { kind: 'attack', power: p, from: fromId, to: toId, defender, attLoss, defLoss, rolls: rolls.length, conquered: true, ...(opts.keepDice ? { dice: rolls } : {}) });
    eliminated = conquer(run, a, b, moved, events);
    run.conquest = { from: fromId, to: toId, min: moveMin, max: moveMax, moved };
  } else {
    emit(run, events, { kind: 'attack', power: p, from: fromId, to: toId, defender, attLoss, defLoss, rolls: rolls.length, conquered: false, ...(opts.keepDice ? { dice: rolls } : {}) });
  }
  return { rolls, conquered, attLoss, defLoss, moveMin, moveMax, moved, eliminated };
}

/** Bookkeeping of troop losses: the human's stats and the rivals' grudges. */
export function bookLosses(run: WorldRun, att: number, def: number, attLoss: number, defLoss: number) {
  if (att === HUMAN) { run.stats.troopsLost += attLoss; run.stats.troopsKilled += defLoss; run.stats.diceAttacks++; }
  if (def === HUMAN) { run.stats.troopsLost += defLoss; run.stats.troopsKilled += attLoss; }
  if (def !== NEUTRAL && run.powers[def]) run.powers[def].grudge[att] = (run.powers[def].grudge[att] ?? 0) + defLoss + 1;
}

/** Default troops moved in: everything when the territory left behind faces no enemy, else about two thirds. */
export function defaultMove(run: WorldRun, fromIdx: number, min: number, max: number): number {
  const p = run.territories[fromIdx].owner;
  const X = ix(run);
  const exposed = X.adj[fromIdx].some((n) => { const o = run.territories[n].owner; return o !== p && o !== NEUTRAL && !atCeasefire(run, p, o); });
  return exposed ? Math.max(min, Math.ceil(max * 0.67)) : max;
}

/** A territory changes hands. Returns true if its old owner was eliminated. */
export function conquer(run: WorldRun, a: number, b: number, moved: number, events?: WorldEvent[]): boolean {
  const from = run.territories[a], to = run.territories[b];
  const p = from.owner, prev = to.owner;
  to.owner = p;
  to.troops = moved;
  from.troops -= moved;
  run.conqueredThisTurn = true;
  run.quiet = 0;
  emit(run, events, { kind: 'conquer', power: p, from: from.id, to: to.id, n: moved, prev });
  if (p === HUMAN) {
    run.stats.conquered++;
    run.stats.peakTerritories = Math.max(run.stats.peakTerritories, ownedCount(run, HUMAN));
    if (to.capital !== undefined && to.capital !== HUMAN) run.stats.capitals++;
    checkMedals(run, events);
  }
  if (prev === HUMAN) run.stats.lost++;
  // zone completed
  const z = ix(run).zoneIdx.get(to.zone);
  if (z !== undefined && ix(run).zoneT[z].every((i) => run.territories[i].owner === p)) emit(run, events, { kind: 'zone', power: p, zone: to.zone });
  let eliminated = false;
  if (prev !== NEUTRAL && ownedCount(run, prev) === 0) {
    eliminated = true;
    const victim = run.powers[prev];
    victim.alive = false;
    victim.eliminatedBy = p;
    victim.eliminatedTurn = run.turn;
    victim.ceasefire = 0;
    const cards = victim.cards.splice(0);
    run.powers[p].cards.push(...cards);
    if (p === HUMAN) run.stats.eliminated++;
    emit(run, events, { kind: 'eliminated', power: prev, by: p, cards: cards.length });
  }
  checkEnd(run, events);
  return eliminated;
}

/** Change the number of troops moved in by the last conquest (within its range, until the next action). */
export function adjustMove(run: WorldRun, n: number): boolean {
  const c = run.conquest;
  if (!c || run.status !== 'active') return false;
  n = Math.round(n);
  if (!(n >= c.min && n <= c.max)) return false;
  const from = terr(run, c.from), to = terr(run, c.to);
  if (from.owner !== to.owner || from.owner !== run.current) return false;
  const delta = n - c.moved;
  if (from.troops - delta < 1 || to.troops + delta < 1) return false;
  from.troops -= delta;
  to.troops += delta;
  c.moved = n;
  return true;
}

// =====================================================================================================
// Fortify
// =====================================================================================================
/** Own territories reachable from a territory through own territories (usable sea lanes included). */
export function connectedOwn(run: WorldRun, fromIdx: number): number[] {
  const p = run.territories[fromIdx].owner;
  const X = ix(run);
  const seen = new Set<number>([fromIdx]);
  const q = [fromIdx], out: number[] = [];
  while (q.length) {
    const c = q.shift()!;
    X.adj[c].forEach((n, k) => {
      if (seen.has(n) || run.territories[n].owner !== p) return;
      if (X.sea[c][k] && !run.territories[c].port && !run.territories[n].port) return;
      seen.add(n);
      out.push(n);
      q.push(n);
    });
  }
  return out;
}

export function fortifyBlock(run: WorldRun, fromId: string, toId: string, n: number, p = run.current): string | null {
  if (run.status !== 'active') return 'over';
  if (run.current !== p) return 'turn';
  if (run.pending || run.defence) return 'busy';
  if (run.phase !== 'attack' && run.phase !== 'fortify') return 'phase';
  if (run.toPlace > 0 || mustTrade(run, p)) return 'place';
  if (run.fortifiesLeft <= 0) return 'used';
  const X = ix(run);
  const a = X.byId.get(fromId), b = X.byId.get(toId);
  if (a === undefined || b === undefined || a === b) return 'unknown';
  if (run.territories[a].owner !== p || run.territories[b].owner !== p) return 'notYours';
  if (!(Number.isInteger(n) && n >= 1 && n <= run.territories[a].troops - 1)) return 'troops';
  if (!connectedOwn(run, a).includes(b)) return 'notConnected';
  return null;
}

export function doFortify(run: WorldRun, fromId: string, toId: string, n: number, events?: WorldEvent[]) {
  const from = terr(run, fromId), to = terr(run, toId);
  from.troops -= n;
  to.troops += n;
  run.fortifiesLeft--;
  run.phase = 'fortify';
  run.conquest = null;
  emit(run, events, { kind: 'fortify', power: run.current, from: fromId, to: toId, n });
}

// =====================================================================================================
// Turns and the end of the game
// =====================================================================================================
/** Set up a power's turn: reinforcements, fortify moves, navy crossings, the card wonder. */
export function beginPowerTurn(run: WorldRun, p: number, events?: WorldEvent[]) {
  run.current = p;
  run.phase = 'reinforce';
  run.conqueredThisTurn = false;
  run.conquest = null;
  run.fortifiesLeft = 1 + wonderSum(run, p, 'fortify');
  run.navyLeft = wonderSum(run, p, 'navy');
  run.lanes = [];
  run.asked = [];
  run.humanHits = 0;
  emit(run, events, { kind: 'turn', power: p, turn: run.turn });
  for (const w of wondersHeld(run, p)) if (w.effect.kind === 'card' && run.turn % Math.max(1, w.effect.every) === 0) drawCard(run, p, events);
  run.toPlace = reinforcements(run, p).total;
}

/** Close a power's turn: a card for a conquest. */
export function finishPowerTurn(run: WorldRun, p: number, events?: WorldEvent[]) {
  if (run.conqueredThisTurn && run.powers[p].alive) drawCard(run, p, events);
  run.conqueredThisTurn = false;
  run.conquest = null;
  run.toPlace = 0;
  run.fortifiesLeft = 0;
}

export function endGame(run: WorldRun, status: 'won' | 'lost', ending: string, events?: WorldEvent[]) {
  if (run.status !== 'active') return;
  run.status = status;
  run.ending = ending;
  run.pending = null;
  run.defence = null;
  run.offers = [];
  run.score = worldScore(run);
  emit(run, events, { kind: status, power: HUMAN, ending });
}

/** Victory and defeat: World, every rival eliminated; Blitz, every rival capital held. */
export function checkEnd(run: WorldRun, events?: WorldEvent[]) {
  if (run.status !== 'active') return;
  const human = run.powers[HUMAN];
  if (ownedCount(run, HUMAN) === 0) { human.alive = false; endGame(run, 'lost', 'wiped', events); return; }
  if (run.ironman) {
    const cap = run.territories.find((t) => t.capital === HUMAN);
    if (cap && cap.owner !== HUMAN) { endGame(run, 'lost', 'capital', events); return; }
  }
  const rivals = run.powers.filter((p) => p.id !== HUMAN);
  if (rivals.every((p) => !p.alive)) { endGame(run, 'won', 'world', events); return; }
  if (run.size === 'blitz') {
    const caps = run.territories.filter((t) => t.capital !== undefined && t.capital !== HUMAN);
    if (caps.length && caps.every((t) => t.owner === HUMAN)) endGame(run, 'won', 'capitals', events);
  }
}

/** Medals earned while playing: a whole continent held, a wonder held. */
export function checkMedals(run: WorldRun, events?: WorldEvent[]) {
  const add = (m: string) => {
    if (run.medals.includes(m)) return;
    run.medals.push(m);
    emit(run, events, { kind: 'medal', power: HUMAN, medal: m });
  };
  for (const t of run.territories) if (t.owner === HUMAN && t.landmark) add(`wonder:${t.landmark}`);
  const conts: string[] = [];
  for (const t of run.territories) if (!conts.includes(t.continent)) conts.push(t.continent);
  for (const c of conts) {
    const ts = run.territories.filter((t) => t.continent === c);
    if (ts.length >= 4 && ts.every((t) => t.owner === HUMAN)) add(`continent:${c}`);
  }
}

export function emit(run: WorldRun, events: WorldEvent[] | undefined, e: WorldEvent) {
  logEvent(run, e);
  events?.push(e);
}
