/**
 * Rival powers: a Risk AI with personalities, playing exactly the human's rules (rules.ts).
 *
 *   holder       the continent-holder: completes zones and walls their borders
 *   aggressor    one big stack, attacks at fair odds, trades cards at once
 *   turtle       defends every border, attacks only at long odds, hoards cards
 *   opportunist  hits the weakest, hunts eliminations (their cards), breaks others' zones
 *   naval        coasts, ports and sea lanes; island zones
 *
 * Each decision scores options: a target's value (zone completion, breaking a rival's zone, an elimination and its
 * cards, capitals, wonders, the turn's card, the leader, grudges) times the exact conquest chance (dice.ts), minus
 * expected losses and the exposure it leaves. Reinforcements go to the best front and to borders that are short of
 * the threat facing them; fortify moves interior troops to where they are needed.
 *
 * Difficulty is judgement, never troops, below Hard: Recruit and Easy rivals see the same board but weigh it badly
 * (noise, poor odds, spread-out placement, few attacks, forced card trades only). Brutal alone gets a bonus
 * (BRUTAL_TROOPS a turn, shown in its reinforcements). Fog (Hard+, optional) applies to rivals too: they plan with
 * the last troop counts they saw.
 */
import { blitzOdds, winChance } from './dice';
import { aiDiplomacy } from './diplomacy';
import {
  attackBlock, bestSet, connectedOwn, diceMods, doAttack, doFortify, emit, laneUsable, mustTrade, place, setValue, tradeSet,
} from './rules';
import { HUMAN, NEUTRAL, atCeasefire, ix, withRng, type PowerPersonality, type WorldDifficulty, type WorldEvent, type WorldRun } from './state';

export interface AIProfile {
  /** Smallest conquest chance worth starting an attack at, and worth continuing one at. */
  minP: number;
  contP: number;
  zoneW: number;
  breakW: number;
  elimW: number;
  /** Preference for weakly held targets. */
  weakW: number;
  seaW: number;
  /** Share of reinforcements kept for threatened borders. */
  defShare: number;
  /** 1 = everything on the best front; 0 = spread. */
  concentrate: number;
  /** Penalty per hostile troop next to a new conquest. */
  exposureW: number;
  /** Multiplier on targets held by the human (difficulty). */
  humanW: number;
  /** Decision noise (0 = exact). */
  noise: number;
  /** Chance a placement goes to a random border instead of the plan. */
  randomPlace: number;
  maxAttacks: number;
  /** Chance it bothers to fortify. */
  fortifyP: number;
  /** Trade sets before being forced. */
  tradeEarly: boolean;
  /** Gangs up on a runaway leader. */
  leaderFocus: number;
  /** Most attacks on the human per turn (low levels use less of their options against you). */
  humanAttacks: number;
  /** Most attacks on the human by all rivals together per round (a homeland next to every rival is not hit by all). */
  roundAttacks: number;
  /** How much a neighbour's stack frightens it. */
  caution: number;
  /** Value of a troop lost, and of an enemy troop destroyed (troops). */
  lossW: number;
  killW: number;
}

export const AI_BASE: Record<PowerPersonality, Omit<AIProfile, 'humanW' | 'noise' | 'randomPlace' | 'maxAttacks' | 'fortifyP' | 'leaderFocus' | 'humanAttacks' | 'roundAttacks'>> = {
  holder: { minP: 0.6, contP: 0.42, zoneW: 1.3, breakW: 1.0, elimW: 1.0, weakW: 0.3, seaW: 1, defShare: 0.4, concentrate: 0.6, exposureW: 0.8, tradeEarly: false, caution: 1.1, lossW: 1, killW: 0.6 },
  aggressor: { minP: 0.45, contP: 0.3, zoneW: 0.8, breakW: 1.0, elimW: 1.5, weakW: 0.2, seaW: 1, defShare: 0.15, concentrate: 1, exposureW: 0.4, tradeEarly: true, caution: 0.7, lossW: 0.75, killW: 0.85 },
  turtle: { minP: 0.72, contP: 0.55, zoneW: 1.0, breakW: 0.6, elimW: 0.8, weakW: 0.3, seaW: 1, defShare: 0.6, concentrate: 0.4, exposureW: 1, tradeEarly: false, caution: 1.4, lossW: 1.25, killW: 0.5 },
  opportunist: { minP: 0.55, contP: 0.4, zoneW: 0.9, breakW: 1.5, elimW: 2.0, weakW: 0.8, seaW: 1, defShare: 0.3, concentrate: 0.75, exposureW: 0.6, tradeEarly: true, caution: 0.9, lossW: 0.9, killW: 0.7 },
  naval: { minP: 0.58, contP: 0.42, zoneW: 1.2, breakW: 1.0, elimW: 1.0, weakW: 0.3, seaW: 1.5, defShare: 0.35, concentrate: 0.7, exposureW: 0.7, tradeEarly: false, caution: 1, lossW: 1, killW: 0.6 },
};

export const AI_LEVEL: Record<WorldDifficulty, { noise: number; minP: number; contP: number; zone: number; conc: number; randomPlace: number; maxAttacks: number; fortifyP: number; humanW: number; leaderFocus: number; def: number; trade: boolean; humanAttacks: number; roundAttacks: number }> = {
  recruit: { noise: 1.2, minP: -0.25, contP: -0.15, zone: 0.2, conc: 0.2, randomPlace: 0.85, maxAttacks: 2, fortifyP: 0.2, humanW: 0.45, leaderFocus: 0, def: 0.2, trade: false, humanAttacks: 0, roundAttacks: 1 },
  easy: { noise: 0.6, minP: -0.12, contP: -0.08, zone: 0.5, conc: 0.5, randomPlace: 0.5, maxAttacks: 6, fortifyP: 0.5, humanW: 0.7, leaderFocus: 0.15, def: 0.6, trade: false, humanAttacks: 1, roundAttacks: 3 },
  normal: { noise: 0.35, minP: -0.04, contP: -0.03, zone: 0.8, conc: 0.8, randomPlace: 0.15, maxAttacks: 12, fortifyP: 0.85, humanW: 0.9, leaderFocus: 0.3, def: 0.85, trade: true, humanAttacks: 2, roundAttacks: 6 },
  hard: { noise: 0.1, minP: 0, contP: 0, zone: 1, conc: 1, randomPlace: 0, maxAttacks: 40, fortifyP: 1, humanW: 1.1, leaderFocus: 0.5, def: 1, trade: true, humanAttacks: 5, roundAttacks: 12 },
  brutal: { noise: 0.05, minP: 0, contP: 0, zone: 1, conc: 1, randomPlace: 0, maxAttacks: 50, fortifyP: 1, humanW: 1.2, leaderFocus: 0.6, def: 1, trade: true, humanAttacks: 99, roundAttacks: 99 },
};

export function aiProfile(run: WorldRun, p: number): AIProfile {
  const pers = run.powers[p].personality;
  const b = AI_BASE[pers === 'human' ? 'holder' : pers];
  const L = AI_LEVEL[run.difficulty];
  return {
    ...b,
    minP: Math.max(0.2, b.minP + L.minP),
    contP: Math.max(0.15, b.contP + L.contP),
    zoneW: b.zoneW * L.zone,
    breakW: b.breakW * L.zone,
    defShare: b.defShare * L.def,
    concentrate: b.concentrate * L.conc,
    tradeEarly: b.tradeEarly && L.trade,
    humanW: L.humanW,
    noise: L.noise,
    randomPlace: L.randomPlace,
    maxAttacks: L.maxAttacks,
    fortifyP: L.fortifyP,
    leaderFocus: L.leaderFocus,
    humanAttacks: L.humanAttacks,
    roundAttacks: L.roundAttacks,
  };
}

// =====================================================================================================
// Board evaluation
// =====================================================================================================
interface Ctx {
  run: WorldRun;
  p: number;
  prof: AIProfile;
  /** Troops as this power believes them (fog: last seen). */
  known: (i: number) => number;
  zoneMine: number[];
  zoneHolder: number[];
  terrCount: number[];
  leader: number;
  leaderShare: number;
  conquered: boolean;
  /** No more attacks on the human this turn (its quota is used). */
  spareHuman: boolean;
}

/** The board as power p sees it. `look` updates its fog memory (a real turn); display calls never change the run. */
function ctx(run: WorldRun, p: number, prof: AIProfile, look = true): Ctx {
  const X = ix(run), T = run.territories;
  if (look && run.fog && run.seen) {
    const seen = run.seen[p];
    T.forEach((t, i) => { if (t.owner === p || X.adj[i].some((n) => T[n].owner === p)) seen[i] = t.troops; });
  }
  const seenRow = run.fog ? run.seen?.[p] : undefined;
  const known = seenRow ? (i: number) => (T[i].owner === p ? T[i].troops : seenRow[i] >= 0 ? seenRow[i] : 3) : (i: number) => T[i].troops;
  const zoneMine = X.zoneT.map((ts) => ts.filter((i) => T[i].owner === p).length);
  const zoneHolder = X.zoneT.map((ts) => {
    if (!ts.length) return NEUTRAL;
    const o = T[ts[0]].owner;
    return o !== NEUTRAL && ts.every((i) => T[i].owner === o) ? o : NEUTRAL;
  });
  const terrCount = run.powers.map(() => 0);
  for (const t of T) if (t.owner >= 0) terrCount[t.owner]++;
  let leader = -1, leaderShare = 0;
  terrCount.forEach((n, q) => { if (q !== p && n / T.length > leaderShare) { leader = q; leaderShare = n / T.length; } });
  // the human's quota this turn: low levels leave you alone until you attack them (then a little more)
  const provoked = (run.powers[p].grudge[HUMAN] ?? 0) > 0;
  const quota = prof.humanAttacks + (provoked && (run.difficulty === 'recruit' || run.difficulty === 'normal') ? 1 : 0);
  return { run, p, prof, known, zoneMine, zoneHolder, terrCount, leader, leaderShare, conquered: run.conqueredThisTurn, spareHuman: (run.humanHits ?? 0) >= quota || (run.roundHits ?? 0) >= prof.roundAttacks };
}

const hostile = (run: WorldRun, p: number, o: number) => o !== p && !atCeasefire(run, p, o);

/**
 * What taking territory b is worth to power p, in troops: the territory itself (a third of a troop a turn for the
 * rest of the game), the turn's card, zone completion and denial, an elimination and its cards, capitals, wonders;
 * scaled by the leader, grudges and the difficulty's view of the human.
 */
function targetValue(c: Ctx, b: number): number {
  const { run, p, prof } = c;
  const X = ix(run), T = run.territories;
  const t = T[b];
  const q = t.owner;
  let v = 2;
  // one more territory crosses a multiple of three: a whole extra troop every turn
  if ((c.terrCount[p] + 1) % 3 === 0 && c.terrCount[p] >= 8) v += 1.5;
  const z = X.zoneOf[b];
  if (z >= 0) {
    const total = X.zoneT[z].length, mine = c.zoneMine[z];
    const left = total - mine - 1;
    const bonus = run.zones[z].bonus;
    // completing a zone is worth a few turns of its bonus; progress towards it, a share of that
    v += prof.zoneW * bonus * (left === 0 ? 3 : (1.2 * (mine + 1)) / total / (1 + 0.5 * left));
    // denying someone's zone
    if (c.zoneHolder[z] === q && q !== NEUTRAL) v += prof.breakW * bonus * 2 * (q === c.leader && c.leaderShare > 0.25 ? 1.5 : 1);
  }
  if (q !== NEUTRAL) {
    const left = c.terrCount[q];
    if (left === 1) v += prof.elimW * (3 + 3 * run.powers[q].cards.length);
    else if (left <= 3) v += prof.elimW * (4 - left);
  }
  if (t.capital !== undefined) v += 5 + (run.size === 'blitz' && t.capital !== p ? 6 : 0);
  if (t.landmark) v += 3;
  if (!c.conquered) v += 3; // the turn's card
  if (t.coastal && prof.seaW > 1) v *= 1 + (prof.seaW - 1) * (t.port ? 1 : 0.6);
  if (q === HUMAN) v *= prof.humanW * (c.leader === HUMAN && c.leaderShare > 0.3 ? 1 + prof.leaderFocus : 1);
  // a runaway rival: everyone turns on it, more the bigger it gets (at every level: rivals must not snowball)
  else if (q !== NEUTRAL && q === c.leader && c.leaderShare > 0.3) v *= 1 + Math.max(0.5, prof.leaderFocus) + 3 * (c.leaderShare - 0.3);
  if (q !== NEUTRAL) {
    const g = run.powers[p].grudge[q] ?? 0;
    v *= 1 + Math.min(0.5, g / 25);
    if (run.powers[q].distrust > run.turn) v *= 1.25;
  }
  return v;
}

/** The strongest hostile stack next to b (other than p's own and the territory we attack from). */
function hostileNext(c: Ctx, b: number, skip = -1): number {
  const { run, p } = c;
  const X = ix(run), T = run.territories;
  let m = 0;
  X.adj[b].forEach((n, k) => {
    if (n === skip) return;
    const o = T[n].owner;
    if (o === p || o === NEUTRAL || o === T[b].owner || !hostile(run, p, o)) return;
    if (X.sea[b][k] && !T[b].port && !T[n].port) return;
    m = Math.max(m, c.known(n) - 1);
  });
  return m;
}

/** Troops a territory keeps at home when it attacks: a capital (and a wonder) holds against the stacks next to it. */
function reserveFor(c: Ctx, a: number): number {
  const { run, p } = c;
  const t = run.territories[a];
  const key = t.capital === p ? 0.4 : t.landmark ? 0.25 : 0;
  if (!key) return 0;
  const h = Math.round(hostileNext(c, a) * c.prof.caution);
  if (h <= 0) return 0;
  // enough that the strongest neighbour's blitz would more likely fail than not... but never more than half the stack:
  // a capital that never attacks is a capital that falls later
  let k = 1;
  while (k < t.troops && winChance(h, k) > key) k++;
  return Math.max(0, Math.min(k, Math.floor((t.troops - 1) / 2)));
}

/** Hostile pressure on an own territory: the biggest adjacent stack and the total, scaled by caution. */
function threat(c: Ctx, i: number): { max: number; sum: number } {
  const { run, p } = c;
  const X = ix(run), T = run.territories;
  let max = 0, sum = 0;
  X.adj[i].forEach((n, k) => {
    const o = T[n].owner;
    if (o === p || o === NEUTRAL) return;
    if (X.sea[i][k] && !T[i].port && !T[n].port) return;
    const w = atCeasefire(run, p, o) ? 0.25 : 1;
    const s = Math.max(0, c.known(n) - 1) * w;
    max = Math.max(max, s);
    sum += s;
  });
  return { max: max * c.prof.caution, sum: sum * c.prof.caution };
}

function importance(c: Ctx, i: number): number {
  const t = c.run.territories[i];
  const z = ix(c.run).zoneOf[i];
  let w = 1;
  if (t.capital !== undefined) w += t.capital === c.p ? 1.5 : 0.8;
  if (z >= 0 && c.zoneHolder[z] === c.p) w += 0.4 * c.run.zones[z].bonus;
  if (t.landmark) w += 0.5;
  return w;
}

interface Option { from: number; to: number; p: number; score: number }

function noise(run: WorldRun, amount: number): number {
  return amount ? withRng(run, (rng) => 1 + amount * (rng.next() * 2 - 1)) : 1;
}

/** The best attack now (or null): expected gain in troops, after losses, enemy troops destroyed and the risk of losing it again. */
function bestAttack(c: Ctx, budget = 0): Option | null {
  const { run, p, prof } = c;
  const X = ix(run), T = run.territories;
  // a quiet board makes everyone bolder (stalemate breaker), and with few powers left an enemy troop destroyed is
  // worth nearly a troop of our own (in a crowd, a third party gains from our fight)
  const bold = Math.min(0.8, (run.quiet / Math.max(1, run.powers.length)) * 0.2);
  const alive = run.powers.filter((q) => q.alive).length;
  const endgame = Math.max(0, Math.min(1, (5 - alive) / 3));
  let best: Option | null = null;
  for (let a = 0; a < T.length; a++) {
    if (T[a].owner !== p || T[a].troops + budget < 2) continue;
    const x = T[a].troops - 1 + budget - (budget ? 0 : reserveFor(c, a));
    if (x < 1) continue;
    for (const b of X.adj[a]) {
      if (budget === 0 ? attackBlock(run, T[a].id, T[b].id, p) : !attackableLater(run, p, a, b)) continue;
      if (c.spareHuman && T[b].owner === HUMAN) continue;
      const mods = diceMods(run, T[a], T[b]);
      const y = c.known(b);
      const pw = winChance(x, y, mods.att, mods.def);
      if (pw < prof.minP - bold * 0.3 && pw < 0.9) continue;
      const odds = blitzOdds(x, y, mods.att, mods.def);
      const v = targetValue(c, b) * (1 + prof.weakW / (1 + y)) * noise(run, prof.noise);
      // holding it: the biggest hostile stack next to it against what we would move in
      const moved = Math.max(1, x - odds.attLoss);
      const h = hostileNext(c, b, a);
      const risk = h > 0 ? winChance(h, Math.round(moved)) : 0;
      const keep = 1 - risk * prof.exposureW;
      const kill = (T[b].owner === NEUTRAL ? 0.15 : prof.killW + (1.05 - prof.killW) * endgame + bold) * (T[b].owner === HUMAN ? Math.min(1, prof.humanW) : 1);
      const score = pw * v * keep - prof.lossW * odds.attLoss + kill * odds.defLoss - (1 - pw) * 0.25 * v;
      if (score > 0 && (!best || score > best.score)) best = { from: a, to: b, p: pw, score };
    }
  }
  return best;
}

/** Could p attack b from a later this turn (ignoring troop counts and phase)? */
function attackableLater(run: WorldRun, p: number, a: number, b: number): boolean {
  const T = run.territories;
  if (T[a].owner !== p || T[b].owner === p || atCeasefire(run, p, T[b].owner)) return false;
  const X = ix(run);
  const k = X.adj[a].indexOf(b);
  return k >= 0 && (!X.sea[a][k] || laneUsable(run, a, b));
}

// =====================================================================================================
// A rival's turn (resumable: it continues from run.phase after a defence choice)
// =====================================================================================================
/** Hooks for the headless pilots that play the human's side with this AI (tools/world/strat-*.ts). */
export interface AIHooks {
  profile?: AIProfile;
  /** Called before an attack it chose; return true when the hook resolved it itself (an RTS battle). */
  attack?: (run: WorldRun, from: string, to: string, events: WorldEvent[]) => boolean;
}

/** Play power p's turn. 'paused': it waits on the human's defence choice (run.defence). */
export function aiTurn(run: WorldRun, p: number, events: WorldEvent[], hooks: AIHooks = {}): 'done' | 'paused' {
  const prof = hooks.profile ?? aiProfile(run, p);
  if (run.phase === 'reinforce') {
    if (p !== HUMAN) aiDiplomacy(run, p, events);
    aiTrade(run, p, prof, events, true);
    aiPlace(run, p, prof, events);
    run.phase = 'attack';
  }
  if (run.phase === 'attack') {
    let attacks = (run.asked ?? []).length;
    const cap = withRng(run, (rng) => prof.maxAttacks + (prof.maxAttacks < 10 ? rng.int(0, 2) : 0));
    for (let guard = 0; guard < 80 && run.status === 'active' && attacks < cap; guard++) {
      if (run.toPlace > 0 || mustTrade(run, p)) { aiTrade(run, p, prof, events, false); aiPlace(run, p, prof, events); continue; }
      const c = ctx(run, p, prof);
      const o = bestAttack(c);
      if (!o) break;
      const from = run.territories[o.from], to = run.territories[o.to];
      if (shouldAsk(run, o.from, o.to)) {
        run.humanHits = (run.humanHits ?? 0) + 1;
        run.roundHits = (run.roundHits ?? 0) + 1;
        run.defence = { power: p, from: from.id, to: to.id, attackers: from.troops - 1 };
        run.asked!.push(to.id);
        emit(run, events, { kind: 'defence', power: p, from: from.id, to: to.id, n: from.troops - 1 });
        return 'paused';
      }
      if (to.owner === HUMAN) { run.humanHits = (run.humanHits ?? 0) + 1; run.roundHits = (run.roundHits ?? 0) + 1; }
      if (!hooks.attack?.(run, from.id, to.id, events)) aiAttack(run, p, from.id, to.id, events, prof);
      attacks++;
    }
    if (run.status !== 'active') return 'done';
    if (run.toPlace > 0) aiPlace(run, p, prof, events);
    run.phase = 'fortify';
  }
  if (run.phase === 'fortify') {
    if (withRng(run, (rng) => rng.chance(prof.fortifyP))) aiFortify(run, p, prof, events);
  }
  return 'done';
}

function shouldAsk(run: WorldRun, a: number, b: number): boolean {
  const from = run.territories[a], to = run.territories[b];
  return run.askDefence && to.owner === HUMAN && (to.capital !== undefined || !!to.landmark) && from.troops - 1 >= 3 && !(run.asked ?? []).includes(to.id);
}

/** Execute an attack the AI chose (blitz while the odds hold), moving troops in sensibly. */
export function aiAttack(run: WorldRun, p: number, fromId: string, toId: string, events: WorldEvent[], prof = aiProfile(run, p)) {
  if (attackBlock(run, fromId, toId, p)) return null;
  const X = ix(run);
  const a = X.byId.get(fromId)!, b = X.byId.get(toId)!;
  const mods = diceMods(run, run.territories[a], run.territories[b]);
  const reserve = reserveFor(ctx(run, p, prof, false), a);
  return doAttack(run, fromId, toId, {
    blitz: true,
    stopBelow: (x, y) => x <= reserve || winChance(x - reserve, y, mods.att, mods.def) < prof.contP,
    move: (min, max) => Math.max(min, Math.min(max - reserve, aiMove(run, p, a, b, min, max, prof))),
  }, events);
}

/** Troops to move into a fresh conquest: forward when the old territory is safe, a split by pressure otherwise. */
function aiMove(run: WorldRun, p: number, a: number, b: number, min: number, max: number, prof: AIProfile): number {
  const c = ctx(run, p, prof);
  const X = ix(run), T = run.territories;
  // (b still belongs to the defender at this point: count its other neighbours)
  let back = 0, front = 0;
  for (const n of X.adj[a]) { if (n === b) continue; const o = T[n].owner; if (o !== p && o !== NEUTRAL && hostile(run, p, o)) back = Math.max(back, c.known(n)); }
  let frontier = false;
  for (const n of X.adj[b]) {
    if (n === a) continue;
    const o = T[n].owner;
    if (o === p) continue;
    frontier = true;
    if (o !== NEUTRAL && hostile(run, p, o)) front = Math.max(front, c.known(n));
  }
  if (!frontier) return min;
  if (back === 0) return max;
  const share = (front + 2) / (front + 2 + back * prof.caution);
  return Math.max(min, Math.min(max, Math.round(max * share)));
}

/** Trade sets: when forced, and (sharper rivals) when the value is worth it. */
function aiTrade(run: WorldRun, p: number, prof: AIProfile, events: WorldEvent[], turnStart: boolean) {
  for (let guard = 0; guard < 4; guard++) {
    const set = bestSet(run, p);
    if (!set) return;
    const hand = run.powers[p].cards.length;
    const forced = mustTrade(run, p);
    const want = forced || (turnStart && (prof.tradeEarly ? setValue(run) >= 6 : hand >= 4 && setValue(run) >= 8));
    if (!want) return;
    if (!tradeSet(run, p, set, events)) return;
  }
}

/** Place every troop in hand: the best front, borders short of the threat, a little randomness at low levels. */
function aiPlace(run: WorldRun, p: number, prof: AIProfile, events: WorldEvent[]) {
  const T = run.territories;
  const X = ix(run);
  let R = run.toPlace;
  if (R <= 0) return;
  const c = ctx(run, p, prof);
  const mine = T.map((t, i) => (t.owner === p ? i : -1)).filter((i) => i >= 0);
  if (!mine.length) return;
  const borders = mine.filter((i) => X.adj[i].some((n) => T[n].owner !== p));
  const pool = borders.length ? borders : mine;
  const put = (i: number, n: number) => { if (n > 0 && place(run, p, T[i].id, n, events)) R -= n; };
  // random placements (low levels)
  if (prof.randomPlace > 0) {
    const k = withRng(run, (rng) => { let r = 0; for (let j = 0; j < R; j++) if (rng.chance(prof.randomPlace)) r++; return r; });
    for (let j = 0; j < k && R > 0; j++) put(withRng(run, (rng) => rng.pick(pool)), 1);
  }
  if (R <= 0) return;
  // defence: borders short of the threat facing them, most important first
  const needs = pool.map((i) => {
    const th = threat(c, i);
    const want = Math.ceil(Math.max(th.max, th.sum * 0.6) * 0.9 + 1);
    return { i, need: Math.max(0, want - T[i].troops) * importance(c, i) };
  }).filter((x) => x.need > 0).sort((x, y) => y.need - x.need || x.i - y.i);
  let defBudget = Math.floor(R * prof.defShare);
  for (const n of needs) {
    if (defBudget <= 0) break;
    const k = Math.min(defBudget, Math.ceil(n.need / importance(c, n.i)));
    put(n.i, k);
    defBudget -= k;
  }
  if (R <= 0) return;
  // attack: the best front with the troops in hand
  const fronts: Option[] = [];
  for (let guard = 0; guard < 3 && fronts.length < 3; guard++) {
    const o = bestAttack(c, R);
    if (!o || fronts.some((f) => f.from === o.from)) break;
    fronts.push(o);
    break;
  }
  if (!fronts.length) {
    // nothing worth attacking: strengthen the most threatened border (or the capital)
    const top = needs[0]?.i ?? pool.reduce((b, i) => (threat(c, i).max > threat(c, b).max ? i : b), pool[0]);
    put(top, R);
    return;
  }
  const main = Math.max(1, Math.round(R * Math.max(0.3, prof.concentrate)));
  put(fronts[0].from, Math.min(R, main));
  if (R > 0) {
    // the rest: the next-best fronts, then the main one
    const second = bestSecondFront(c, fronts[0].from, R);
    put(second ?? fronts[0].from, R);
  }
}

function bestSecondFront(c: Ctx, skip: number, budget: number): number | null {
  const { run, p } = c;
  const X = ix(run), T = run.territories;
  let best: { i: number; s: number } | null = null;
  for (let a = 0; a < T.length; a++) {
    if (a === skip || T[a].owner !== p) continue;
    for (const b of X.adj[a]) {
      if (!attackableLater(run, p, a, b)) continue;
      const pw = winChance(T[a].troops - 1 + budget, c.known(b));
      const s = pw * targetValue(c, b);
      if (!best || s > best.s) best = { i: a, s };
    }
  }
  return best && best.s > 0 ? best.i : null;
}

/** One fortify move (more with a fortify wonder): interior troops to the border that needs them most. */
function aiFortify(run: WorldRun, p: number, prof: AIProfile, events: WorldEvent[]) {
  const T = run.territories;
  const X = ix(run);
  for (let guard = 0; guard < 4 && run.fortifiesLeft > 0; guard++) {
    const c = ctx(run, p, prof);
    // donors: own territories with spare troops beyond their own threat
    let best: { from: number; to: number; n: number; gain: number } | null = null;
    for (let a = 0; a < T.length; a++) {
      if (T[a].owner !== p || T[a].troops < 2) continue;
      const interior = X.adj[a].every((n) => T[n].owner === p);
      const th = threat(c, a);
      const spare = interior ? T[a].troops - 1 : Math.floor(T[a].troops - 1 - Math.max(th.max, th.sum * 0.6));
      if (spare < 1) continue;
      for (const b of connectedOwn(run, a)) {
        if (X.adj[b].every((n) => T[n].owner === p)) continue;
        const tb = threat(c, b);
        const deficit = Math.max(0, Math.max(tb.max, tb.sum * 0.6) - T[b].troops) * importance(c, b);
        // or a launch point for next turn
        let launch = 0;
        for (const n of X.adj[b]) if (T[n].owner !== p && attackableLater(run, p, b, n)) launch = Math.max(launch, targetValue(c, n) * 0.3);
        const gain = deficit + launch + (interior ? 0.5 : 0);
        if (!best || gain > best.gain) best = { from: a, to: b, n: spare, gain };
      }
    }
    if (!best || best.gain <= 0.4) return;
    doFortify(run, T[best.from].id, T[best.to].id, best.n, events);
  }
}

/** The human's intel wonder: the rivals' likeliest attacks next turn (no randomness used). */
export function rivalIntentions(run: WorldRun): { power: number; from: string; to: string; chance: number }[] {
  const out: { power: number; from: string; to: string; chance: number }[] = [];
  for (const P of run.powers) {
    if (P.id === HUMAN || !P.alive) continue;
    const prof = { ...aiProfile(run, P.id), noise: 0 };
    const c = { ...ctx(run, P.id, prof, false), conquered: false };
    const X = ix(run), T = run.territories;
    for (let a = 0; a < T.length; a++) {
      if (T[a].owner !== P.id) continue;
      for (const b of X.adj[a]) {
        if (T[b].owner !== HUMAN || !attackableLater(run, P.id, a, b)) continue;
        const pw = winChance(T[a].troops - 1, T[b].troops);
        if (pw >= prof.minP) out.push({ power: P.id, from: T[a].id, to: T[b].id, chance: pw });
      }
    }
  }
  return out.sort((x, y) => y.chance - x.chance).slice(0, 6);
}
