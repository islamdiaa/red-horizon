/**
 * Light diplomacy: a ceasefire between the human and one rival for a few turns. Neither side may attack the other
 * while it holds. A rival accepts or refuses by its strength and personality (and a diplomacy wonder); it may break a
 * ceasefire later, which costs it with everyone: other powers hold a grudge and nobody signs with it for a while.
 * Breaking one yourself costs the same: no rival signs with you for BETRAYAL_TURNS.
 * Rivals under pressure may offer a ceasefire themselves; the offer waits for your answer during your turn.
 */
import { wonderSum, emit } from './rules';
import { HUMAN, ix, ownedCount, troopsOf, withRng, type PowerPersonality, type WorldEvent, type WorldRun } from './state';

export const CEASEFIRE_TURNS = 5;
export const BETRAYAL_TURNS = 8;
/** One proposal to a rival every this many turns. */
export const OFFER_COOLDOWN = 3;

const WILLING: Record<PowerPersonality, number> = { turtle: 0.7, holder: 0.55, naval: 0.5, opportunist: 0.35, aggressor: 0.2 };
const BREAKS: Record<PowerPersonality, number> = { turtle: 0.02, holder: 0.05, naval: 0.08, opportunist: 0.18, aggressor: 0.25 };

function strength(run: WorldRun, p: number): number {
  return ownedCount(run, p) * 2 + troopsOf(run, p);
}

/** Do the two powers share a border (or a usable sea lane)? */
function neighbours(run: WorldRun, p: number, q: number): boolean {
  const X = ix(run), T = run.territories;
  for (let a = 0; a < T.length; a++) if (T[a].owner === p && X.adj[a].some((n) => T[n].owner === q)) return true;
  return false;
}

/** Why a rival would refuse outright (null: it may accept). */
export function ceasefireBlock(run: WorldRun, power: number): string | null {
  const P = run.powers[power];
  if (run.status !== 'active' || !P || power === HUMAN || !P.alive) return 'unknown';
  if (P.ceasefire >= run.turn) return 'already';
  if (run.powers[HUMAN].distrust > run.turn) return 'distrust';
  if (P.offered && run.turn - P.offered < OFFER_COOLDOWN) return 'cooldown';
  return null;
}

/** The chance a rival accepts a ceasefire now (shown before you ask). */
export function ceasefireChance(run: WorldRun, power: number): number {
  if (ceasefireBlock(run, power)) return 0;
  const P = run.powers[power];
  const pers = P.personality === 'human' ? 'holder' : P.personality;
  const ratio = strength(run, power) / Math.max(1, strength(run, HUMAN));
  // weaker rivals want peace; stronger ones see weakness
  let c = WILLING[pers] * Math.max(0.25, Math.min(1.8, 1.4 - 0.6 * ratio));
  // a rival at war elsewhere (it borders other powers) welcomes quiet on one front
  const busy = run.powers.some((q) => q.id !== HUMAN && q.id !== power && q.alive && neighbours(run, power, q.id));
  if (busy) c *= 1.15;
  // grudges: it remembers what you took
  c *= 1 - Math.min(0.5, (P.grudge[HUMAN] ?? 0) / 40);
  c += wonderSum(run, HUMAN, 'diplomacy') / 100;
  // the board leader is distrusted by everyone
  const share = ownedCount(run, HUMAN) / run.territories.length;
  if (share > 0.4) c *= 0.6;
  return Math.max(0, Math.min(0.95, c));
}

/** Propose a ceasefire for `turns` turns (3-8). The rival accepts or refuses (the run's random generator). */
export function offerCeasefire(run: WorldRun, power: number, turns = CEASEFIRE_TURNS, events?: WorldEvent[]): { accepted: boolean; turns: number; why: string } {
  const block = ceasefireBlock(run, power);
  if (block) return { accepted: false, turns: 0, why: block };
  turns = Math.max(3, Math.min(8, Math.round(turns)));
  const chance = ceasefireChance(run, power) * (turns > CEASEFIRE_TURNS ? 0.85 : 1);
  const P = run.powers[power];
  P.offered = run.turn;
  const yes = withRng(run, (rng) => rng.chance(chance));
  if (!yes) {
    emit(run, events, { kind: 'refused', power, with: HUMAN });
    return { accepted: false, turns: 0, why: 'refused' };
  }
  sign(run, power, turns, events);
  return { accepted: true, turns, why: 'accepted' };
}

function sign(run: WorldRun, power: number, turns: number, events?: WorldEvent[]) {
  const P = run.powers[power];
  // it lasts through `turns` of your turns (the rival's turns in between included)
  P.ceasefire = run.turn + turns - 1;
  run.offers = run.offers.filter((o) => o.power !== power);
  emit(run, events, { kind: 'ceasefire', power, with: HUMAN, turns });
}

/** Answer a rival's offer (during your turn). */
export function answerOffer(run: WorldRun, power: number, yes: boolean, events?: WorldEvent[]): boolean {
  const o = run.offers.find((x) => x.power === power);
  if (!o || run.status !== 'active' || run.current !== HUMAN) return false;
  run.offers = run.offers.filter((x) => x !== o);
  if (yes && run.powers[power].alive) sign(run, power, o.turns, events);
  return true;
}

/** Break a ceasefire (you): it ends now, and no rival signs with you for BETRAYAL_TURNS turns. */
export function breakCeasefire(run: WorldRun, power: number, events?: WorldEvent[]): boolean {
  const P = run.powers[power];
  if (!P || power === HUMAN || P.ceasefire < run.turn || run.status !== 'active') return false;
  P.ceasefire = 0;
  run.powers[HUMAN].distrust = run.turn + BETRAYAL_TURNS;
  for (const q of run.powers) if (q.id !== HUMAN && q.alive) q.grudge[HUMAN] = (q.grudge[HUMAN] ?? 0) + (q.id === power ? 12 : 4);
  emit(run, events, { kind: 'break', power: HUMAN, with: power });
  return true;
}

/** A rival's diplomacy at the start of its turn: break a ceasefire for a juicy target, or offer one when pressed. */
export function aiDiplomacy(run: WorldRun, p: number, events: WorldEvent[]) {
  const P = run.powers[p];
  const pers = P.personality === 'human' ? 'holder' : P.personality;
  const low = run.difficulty === 'recruit' || run.difficulty === 'easy';
  if (P.ceasefire >= run.turn) {
    if (low) return; // low levels keep their word
    // a weak, valuable human border next to a big stack of ours tempts it
    const X = ix(run), T = run.territories;
    let tempt = 0;
    for (let a = 0; a < T.length; a++) {
      if (T[a].owner !== p) continue;
      for (const b of X.adj[a]) if (T[b].owner === HUMAN && T[a].troops >= 3 * T[b].troops + 3) tempt = Math.max(tempt, T[b].capital !== undefined || T[b].landmark ? 2 : 1);
    }
    if (!tempt) return;
    if (!withRng(run, (rng) => rng.chance(BREAKS[pers] * tempt))) return;
    P.ceasefire = 0;
    P.distrust = run.turn + BETRAYAL_TURNS;
    for (const q of run.powers) if (q.id !== p && q.alive) q.grudge[p] = (q.grudge[p] ?? 0) + 6;
    emit(run, events, { kind: 'break', power: p, with: HUMAN });
    return;
  }
  // an offer to the human: pressed by the human (grudge), weaker, not too recently
  if (P.distrust > run.turn || run.powers[HUMAN].distrust > run.turn) return;
  if (P.offered && run.turn - P.offered < OFFER_COOLDOWN + 2) return;
  const pressed = (P.grudge[HUMAN] ?? 0) >= 6;
  const weaker = strength(run, p) < 0.7 * strength(run, HUMAN);
  if (!pressed || !weaker || !neighbours(run, p, HUMAN)) return;
  if (!withRng(run, (rng) => rng.chance(WILLING[pers] * 0.5))) return;
  P.offered = run.turn;
  run.offers = [...run.offers.filter((o) => o.power !== p), { power: p, turns: CEASEFIRE_TURNS }];
  emit(run, events, { kind: 'offer', power: p, turns: CEASEFIRE_TURNS });
}

