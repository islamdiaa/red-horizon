/**
 * Unit cost-effectiveness: every armed unit against every other in cost-equal battles (groups worth the same
 * budget attack-move into each other on open ground, both creation orders), run on the self-play worker pool.
 *
 *   node --import tsx tools/selfplay/balance.ts [--budget 3000] [--seeds 2] [--workers N] [--emit] [--rules JSON]
 *
 * Prints the exchange matrix (value destroyed / value lost for the row unit), each unit's geometric-mean exchange
 * against the other faction and against everything, units without a cost-equal counter ("dominant") and units
 * that beat nothing ("dead weight"). --emit regenerates src/sim/ai-matchups.ts, the table the AI's
 * counter-composition uses (ai-counter.ts), so balance changes flow into the AI's judgement.
 */
import { writeFileSync } from 'node:fs';
import { UNITS, WEAPONS } from '../../src/data/rules';
import { runPool } from './pool';
import type { DuelResult, DuelSpec } from './lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};
const budget = +opt('budget', '3000');
const seeds = +opt('seeds', '2');
const workers = +opt('workers', '0') || undefined;
const emit = args.includes('--emit');
const rulesArg = opt('rules', '');
const rules = rulesArg ? JSON.parse(rulesArg) : undefined;

/** Armed land and air units a player can build (special demolition / quake units excluded). */
export function armedUnits(): string[] {
  return Object.values(UNITS).filter((u) => {
    if (!u.buildable || u.kind === 'naval' || u.harvester || u.deploysInto || u.quake || u.demolition) return false;
    const ws = [u.primary, u.secondary].map((w) => (w ? WEAPONS[w] : null)).filter(Boolean);
    return ws.some((w) => w!.damage > 0);
  }).map((u) => u.id);
}

const ids = armedUnits();
const specs: DuelSpec[] = [];
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) for (let s = 1; s <= seeds; s++) specs.push({ a: ids[i], b: ids[j], seed: s, budget, rules });
console.log(`${ids.length} units, ${specs.length} duels (budget $${budget})…`);
const t0 = performance.now();
const res: DuelResult[] = await runPool(specs, { workers });
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(0)} s\n`);

// exchange[a][b] = value of b destroyed / value of a lost (row unit's point of view)
const lostA = new Map<string, number>(), lostB = new Map<string, number>();
const key = (a: string, b: string) => `${a}|${b}`;
for (const r of res) {
  lostA.set(key(r.a, r.b), (lostA.get(key(r.a, r.b)) ?? 0) + (r.aCost - r.aLeft));
  lostB.set(key(r.a, r.b), (lostB.get(key(r.a, r.b)) ?? 0) + (r.bCost - r.bLeft));
}
const X: Record<string, Record<string, number | null>> = {};
for (const a of ids) X[a] = {};
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
  const a = ids[i], b = ids[j];
  const la = lostA.get(key(a, b)) ?? 0, lb = lostB.get(key(a, b)) ?? 0;
  if (la < 1 && lb < 1) { X[a][b] = X[b][a] = null; continue; } // nobody could hurt anybody
  const x = Math.max(0.01, Math.min(100, lb / Math.max(1, la)));
  X[a][b] = x;
  X[b][a] = 1 / x;
}
const side = (id: string) => (UNITS[id].owner.length > 1 ? 'both' : UNITS[id].owner[0]);
const fmt = (x: number | null | undefined) => (x === null || x === undefined ? '   =' : x >= 99 ? ' >99' : x < 0.01 ? '  0' : x >= 10 ? x.toFixed(0).padStart(4) : x.toFixed(2).padStart(4).slice(-4));
console.log(`## Exchange matrix (row unit: value destroyed / value lost; "=" = neither can hurt the other)`);
console.log('      ' + ids.map((b) => b.padStart(5)).join(''));
for (const a of ids) console.log(a.padEnd(6) + ids.map((b) => (a === b ? '    -' : ' ' + fmt(X[a][b]))).join(''));

const gmean = (xs: number[]) => (xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) : NaN);
console.log(`\n## Cost-effectiveness (geometric-mean exchange; >1 = good value)`);
console.log('unit   side    $     vs other faction   vs all   best counter (exchange for the counter)');
const rows: [string, number, number, string][] = [];
for (const a of ids) {
  const fa = side(a);
  const other = ids.filter((b) => b !== a && X[a][b] !== null && (fa === 'both' || side(b) !== fa)).map((b) => X[a][b]!);
  const all = ids.filter((b) => b !== a && X[a][b] !== null).map((b) => X[a][b]!);
  let best = '', bx = 0;
  for (const b of ids) { const x = X[b][a]; if (b !== a && x !== null && x !== undefined && x > bx) { bx = x; best = b; } }
  rows.push([a, gmean(other), gmean(all), `${best} (${bx.toFixed(2)})`]);
}
rows.sort((p, q) => q[2] - p[2]);
for (const [a, o, all, c] of rows) console.log(`${a.padEnd(6)} ${side(a).padEnd(6)} ${String(UNITS[a].cost).padStart(5)}   ${o.toFixed(2).padStart(8)}          ${all.toFixed(2).padStart(6)}   ${c}`);
const dominant = rows.filter(([a]) => !ids.some((b) => b !== a && (X[b][a] ?? 0) >= 1.4));
const deadWeight = rows.filter(([a]) => !ids.some((b) => b !== a && (X[a][b] ?? 0) >= 1.4));
console.log(`\nno cost-equal counter (nothing beats it by 1.4x): ${dominant.map(([a]) => a).join(', ') || 'none'}`);
console.log(`beats nothing by 1.4x (dead weight in a straight fight): ${deadWeight.map(([a]) => a).join(', ') || 'none'}`);

if (emit) {
  const table: Record<string, Record<string, number>> = {};
  for (const a of ids) {
    table[a] = {};
    for (const b of ids) if (a !== b && X[a][b] !== null && X[a][b] !== undefined) table[a][b] = Math.round(Math.log2(X[a][b]!) * 10) / 10;
  }
  const body = ids.map((a) => `  ${JSON.stringify(a)}: ${JSON.stringify(table[a])},`).join('\n');
  writeFileSync(new URL('../../src/sim/ai-matchups.ts', import.meta.url), `/**
 * Cost-equal battle results between armed units (generated by tools/selfplay/balance.ts --emit; budget $${budget},
 * ${seeds} seeds per pair): log2 of the row unit's exchange ratio (value destroyed / value lost) against the column
 * unit. The AI's counter-composition (ai-counter.ts) prefers this measured table over its analytic estimate.
 * Regenerate after balance changes: node --import tsx tools/selfplay/balance.ts --emit
 */
export const MATCHUPS: Record<string, Record<string, number>> = {
${body}
};
`);
  console.log('\nwrote src/sim/ai-matchups.ts');
}
