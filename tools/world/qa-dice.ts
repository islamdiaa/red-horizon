// World Conquest QA: the Risk dice, by exact enumeration (no sampling), as an independent reference for the
// strategic layer's dice (src/conquest/world). Used by tests/world-qa-dice.test.ts.
//
//   node --import tsx tools/world/qa-dice.ts          prints the per-roll table and a blitz table
//
// Rules (Risk, as World Conquest plays them): the attacker rolls up to 3 dice (at most troops - 1), the defender
// up to 2 (at most its troops); both sort high to low and the top dice are compared pair by pair; the defender wins
// ties; each lost comparison costs that side one troop. A wonder can add to a side's best die ('attack' / 'defence'
// WonderEffect: "the attacker's / defender's best die +N").

/** Outcome counts of one roll: key "attLoss,defLoss" -> number of the 6^(a+d) equally likely dice combinations. */
export interface RollTable { a: number; d: number; total: number; counts: Map<string, number> }

/** Compare sorted dice (high to low) pair by pair, ties to the defender. */
export function compareDice(att: readonly number[], def: readonly number[]): { attLoss: number; defLoss: number } {
  const A = [...att].sort((x, y) => y - x), D = [...def].sort((x, y) => y - x);
  let attLoss = 0, defLoss = 0;
  for (let i = 0; i < Math.min(A.length, D.length); i++) { if (A[i] > D[i]) defLoss++; else attLoss++; }
  return { attLoss, defLoss };
}

/** Every dice combination of `n` six-sided dice. */
export function* allDice(n: number): Generator<number[]> {
  const v = new Array(n).fill(1);
  if (n === 0) { yield []; return; }
  for (;;) {
    yield [...v];
    let k = n - 1;
    while (k >= 0 && v[k] === 6) { v[k] = 1; k--; }
    if (k < 0) return;
    v[k]++;
  }
}

/** Exact outcome counts of one roll of `a` attacking dice against `d` defending dice (bonuses on the best die). */
export function rollTable(a: number, d: number, bonus: { att?: number; def?: number; cap?: number } = {}, cmp = compareDice): RollTable {
  const counts = new Map<string, number>();
  let total = 0;
  for (const A of allDice(a)) for (const D of allDice(d)) {
    const As = [...A].sort((x, y) => y - x), Ds = [...D].sort((x, y) => y - x);
    // (a wonder's +N on the best die; `cap` bounds it, e.g. 6: a boosted die never beats a natural 6 on a tie)
    if (bonus.att && As.length) As[0] = Math.min(bonus.cap ?? Infinity, As[0] + bonus.att);
    if (bonus.def && Ds.length) Ds[0] = Math.min(bonus.cap ?? Infinity, Ds[0] + bonus.def);
    const r = cmp(As, Ds);
    const k = `${r.attLoss},${r.defLoss}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    total++;
  }
  return { a, d, total, counts };
}

/**
 * Risk's published per-roll table (counts out of 6^(a+d)), e.g. 3 v 2: the defender loses both 2890/7776 = 37.17%,
 * one each 2611/7776 = 33.58%, the attacker loses both 2275/7776 = 29.26%.
 */
export const RISK_TABLE: Record<string, { total: number; counts: Record<string, number> }> = {
  '1v1': { total: 36, counts: { '0,1': 15, '1,0': 21 } },
  '2v1': { total: 216, counts: { '0,1': 125, '1,0': 91 } },
  '3v1': { total: 1296, counts: { '0,1': 855, '1,0': 441 } },
  '1v2': { total: 216, counts: { '0,1': 55, '1,0': 161 } },
  '2v2': { total: 1296, counts: { '0,2': 295, '1,1': 420, '2,0': 581 } },
  '3v2': { total: 7776, counts: { '0,2': 2890, '1,1': 2611, '2,0': 2275 } },
};

/** Probability of each outcome of one roll (a v d), as numbers. */
export function rollProbs(a: number, d: number, bonus: { att?: number; def?: number; cap?: number } = {}): Map<string, number> {
  const t = rollTable(a, d, bonus);
  return new Map([...t.counts].map(([k, n]) => [k, n / t.total]));
}

/**
 * Exact probability that an attack from a territory with `attTroops` troops takes a territory held by `defTroops`
 * (blitz: roll until the defender has none left or the attacker is down to 1 troop). Also the expected troops the
 * attacker has left on the source territory in either case.
 */
export function blitzOdds(attTroops: number, defTroops: number, bonus: { att?: number; def?: number; cap?: number } = {}, maxAttDice = 3, maxDefDice = 2) {
  const tables = new Map<string, Map<string, number>>();
  const probs = (a: number, d: number) => {
    const k = `${a}v${d}`;
    let t = tables.get(k);
    if (!t) { t = rollProbs(a, d, bonus); tables.set(k, t); }
    return t;
  };
  // win[A][D]: A = troops that can still attack (troops on the source - 1), D = defenders left
  const memo = new Map<string, number>();
  const win = (A: number, D: number): number => {
    if (D <= 0) return 1;
    if (A <= 0) return 0;
    const key = `${A},${D}`;
    const m = memo.get(key);
    if (m !== undefined) return m;
    let p = 0;
    for (const [k, q] of probs(Math.min(maxAttDice, A), Math.min(maxDefDice, D))) {
      const [al, dl] = k.split(',').map(Number);
      p += q * win(A - al, D - dl);
    }
    memo.set(key, p);
    return p;
  };
  return { win: win(attTroops - 1, defTroops) };
}

/**
 * Known blitz win probabilities from the Risk literature (Osborne, "Markov chains for the RISK board game revisited",
 * 2003, table 3, three decimals; its A counts the attacking troops, i.e. the troops on the territory minus one).
 */
export const RISK_BLITZ: [number, number, number][] = [
  // [attacker troops on the territory, defenders, P(attacker conquers)] ±0.001
  [2, 1, 0.417], [3, 1, 0.754], [4, 1, 0.916], [2, 2, 0.106], [3, 2, 0.363], [4, 2, 0.656], [6, 5, 0.506], [11, 10, 0.568],
];

if (process.argv[1]?.endsWith('qa-dice.ts')) {
  console.log('| roll | outcomes (attacker loses, defender loses): count/total = % |');
  console.log('|---|---|');
  for (const [a, d] of [[3, 2], [3, 1], [2, 2], [2, 1], [1, 2], [1, 1]]) {
    const t = rollTable(a, d);
    console.log(`| ${a}v${d} | ${[...t.counts].sort().map(([k, n]) => `${k}: ${n}/${t.total} = ${(100 * n / t.total).toFixed(2)}%`).join(' · ')} |`);
  }
  console.log('\nblitz P(conquer), attacker troops (rows) x defender troops (cols):');
  console.log('    ' + Array.from({ length: 10 }, (_, j) => String(j + 1).padStart(6)).join(''));
  for (let A = 2; A <= 12; A++) console.log(String(A).padStart(3) + ' ' + Array.from({ length: 10 }, (_, j) => (blitzOdds(A, j + 1).win * 100).toFixed(1).padStart(6)).join(''));
}
