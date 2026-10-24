/**
 * Risk dice: the attacker rolls up to 3 dice (one fewer than the troops on the attacking territory), the defender up
 * to 2; the highest dice are compared pair by pair and the defender wins ties. Wonders may add to a side's best die
 * (capped at 6, so a tie still goes to the defender).
 *
 * Exact odds: the single-roll outcome distributions are enumerated (6^5 combinations at most), and the chance of
 * a blitz conquest plus the expected losses come from a dynamic programme over (attacking troops, defenders),
 * memoised per modifier pair. Pure maths, no randomness: previews never touch the run's random generator.
 */
import type { Rng } from '../../core/rng';
import type { DiceRoll } from './state';

/** One roll of the dice from the run's generator: sorted high to low, compared pair by pair. */
export function rollOnce(rng: Rng, attDice: number, defDice: number, attMod = 0, defMod = 0): DiceRoll {
  const att: number[] = [], def: number[] = [];
  for (let k = 0; k < attDice; k++) att.push(1 + Math.floor(rng.next() * 6));
  for (let k = 0; k < defDice; k++) def.push(1 + Math.floor(rng.next() * 6));
  att.sort((a, b) => b - a);
  def.sort((a, b) => b - a);
  const { attLoss, defLoss } = compare(att, def, attMod, defMod);
  return { att, def, attLoss, defLoss };
}

/** Compare sorted dice (best die modifiers applied, capped at 6). */
export function compare(att: readonly number[], def: readonly number[], attMod = 0, defMod = 0): { attLoss: number; defLoss: number } {
  let attLoss = 0, defLoss = 0;
  const n = Math.min(att.length, def.length);
  for (let k = 0; k < n; k++) {
    const a = k === 0 ? Math.min(6, att[k] + attMod) : att[k];
    const d = k === 0 ? Math.min(6, def[k] + defMod) : def[k];
    if (a > d) defLoss++; else attLoss++;
  }
  return { attLoss, defLoss };
}

/**
 * Single-roll outcome distribution: probs[i] = chance the attacker loses i troops (the defender loses
 * min(attDice, defDice) - i).
 */
const rollCache = new Map<string, number[]>();
export function rollDistribution(attDice: number, defDice: number, attMod = 0, defMod = 0): number[] {
  const key = `${attDice}${defDice}${attMod}${defMod}`;
  const hit = rollCache.get(key);
  if (hit) return hit;
  const k = Math.min(attDice, defDice);
  const counts = new Array(k + 1).fill(0);
  let total = 1;
  for (let k = 0; k < attDice + defDice; k++) total *= 6;
  const dice = new Array(attDice + defDice).fill(1);
  for (let c = 0; c < total; c++) {
    let x = c;
    for (let j = 0; j < dice.length; j++) { dice[j] = 1 + (x % 6); x = Math.floor(x / 6); }
    const att = dice.slice(0, attDice).sort((a, b) => b - a), def = dice.slice(attDice).sort((a, b) => b - a);
    counts[compare(att, def, attMod, defMod).attLoss]++;
  }
  const probs = counts.map((n) => n / total);
  rollCache.set(key, probs);
  return probs;
}

/** Chances of the next roll: the attacker wins every pair (att), the defender does (def), or they split. */
export function rollOdds(attDice: number, defDice: number, attMod = 0, defMod = 0): { att: number; def: number; split: number } {
  const p = rollDistribution(attDice, defDice, attMod, defMod);
  const k = p.length - 1;
  return { att: p[0], def: p[k], split: k >= 2 ? p.slice(1, k).reduce((s, x) => s + x, 0) : 0 };
}

// =====================================================================================================
// Blitz odds: x attacking troops (the territory's troops minus the one that stays) against y defenders
// =====================================================================================================
interface Table { n: number; win: Float64Array; attLoss: Float64Array; defLoss: Float64Array }
const tables = new Map<number, Table>();
const MAX_N = 1024;

function table(attMod: number, defMod: number, need: number): Table {
  const key = attMod * 8 + defMod;
  let t = tables.get(key);
  if (t && t.n >= need) return t;
  let n = Math.max(32, t?.n ?? 0);
  while (n < need) n *= 2;
  n = Math.min(MAX_N, n);
  const N = n + 1;
  const win = new Float64Array(N * N), attLoss = new Float64Array(N * N), defLoss = new Float64Array(N * N);
  const dist: number[][][] = [];
  for (let a = 1; a <= 3; a++) { dist[a] = []; for (let d = 1; d <= 2; d++) dist[a][d] = rollDistribution(a, d, attMod, defMod); }
  // win[x][y]: chance to take the territory rolling until it falls or x = 0
  for (let x = 0; x <= n; x++) {
    for (let y = 0; y <= n; y++) {
      const i = x * N + y;
      if (y === 0) { win[i] = 1; continue; }
      if (x === 0) { win[i] = 0; continue; }
      const a = Math.min(3, x), d = Math.min(2, y), k = Math.min(a, d);
      const p = dist[a][d];
      let w = 0, la = 0, ld = 0;
      for (let l = 0; l <= k; l++) {
        const nx = x - l, ny = y - (k - l), j = nx * N + ny;
        w += p[l] * win[j];
        la += p[l] * (l + attLoss[j]);
        ld += p[l] * (k - l + defLoss[j]);
      }
      win[i] = w; attLoss[i] = la; defLoss[i] = ld;
    }
  }
  t = { n, win, attLoss, defLoss };
  tables.set(key, t);
  return t;
}

export interface BlitzOdds {
  /** Chance the territory falls before the attacker is down to one troop. */
  win: number;
  /** Expected troops lost by each side over the blitz. */
  attLoss: number;
  defLoss: number;
}

/**
 * Blitz odds for x attacking troops (excluding the one that stays behind) against y defenders. Beyond the table
 * (1,024 troops a side) the stacks are scaled down together, which keeps the ratio and is close enough.
 */
export function blitzOdds(x: number, y: number, attMod = 0, defMod = 0): BlitzOdds {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  let scale = 1;
  if (x > MAX_N || y > MAX_N) { scale = Math.max(x, y) / MAX_N; x = Math.floor(x / scale); y = Math.floor(y / scale); }
  const t = table(attMod, defMod, Math.max(x, y));
  const i = x * (t.n + 1) + y;
  return { win: t.win[i], attLoss: t.attLoss[i] * scale, defLoss: t.defLoss[i] * scale };
}

/** Just the conquest chance (the AI's hot path). */
export function winChance(x: number, y: number, attMod = 0, defMod = 0): number {
  if (y <= 0) return 1;
  if (x <= 0) return 0;
  if (x > MAX_N || y > MAX_N) return blitzOdds(x, y, attMod, defMod).win;
  const t = table(attMod, defMod, Math.max(x, y));
  return t.win[x * (t.n + 1) + y];
}
