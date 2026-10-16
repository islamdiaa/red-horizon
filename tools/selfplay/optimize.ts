/**
 * Hill-climbing optimizer for the AI's numeric parameters (AITuning in src/sim/ai-personality.ts).
 *
 *   node --import tsx tools/selfplay/optimize.ts [--iters 20] [--games 96] [--diff normal] [--maps land]
 *        [--minutes 45] [--keys a,b,c] [--start JSON] [--out file.json] [--vs best|legacy]
 *
 * Each iteration mutates 1-3 parameters of the current best and plays the candidate head-to-head against it
 * (--vs best, default) or both against the legacy AI (--vs legacy), on fresh seeds, both factions on both sides.
 * The candidate replaces the best when it wins at least 55% (timed-out games go to the material leader).
 * The log lists every trial; the final best tuning is printed (and written to --out) as a JSON object to paste
 * into DEFAULT_TUNING.
 */
import { writeFileSync } from 'node:fs';
import type { AIDifficulty } from '../../src/sim/ai';
import { DEFAULT_TUNING, resolvePersonality, type AITuning } from '../../src/sim/ai-personality';
import type { Faction } from '../../src/data/rules';
import { runPool } from './pool';
import type { MapKind, MatchResult, MatchSpec, PlayerSpec } from './lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};
const iters = +opt('iters', '20');
const games = +opt('games', '96');
const diff = opt('diff', 'normal') as AIDifficulty;
const maps = opt('maps', 'land').split(',') as MapKind[];
const minutes = +opt('minutes', '45');
const vs = opt('vs', 'best');
const out = opt('out', '');
const accept = +opt('accept', '0.55');

interface Param { key: keyof AITuning; min: number; max: number; step: number; int?: boolean }
const SPACE: Param[] = [
  { key: 'retreatHp', min: 0.1, max: 0.6, step: 0.08 },
  { key: 'fallbackRatio', min: 0.2, max: 1.2, step: 0.15 },
  { key: 'counterStrength', min: 0, max: 1.5, step: 0.2 },
  { key: 'harassEvery', min: 60, max: 400, step: 40 },
  { key: 'harassValue', min: 600, max: 3500, step: 400 },
  { key: 'flankFrac', min: 0.1, max: 0.45, step: 0.07 },
  { key: 'expandAfter', min: 300, max: 1200, step: 120 },
  { key: 'expandCredits', min: 1500, max: 6000, step: 600 },
  { key: 'attackRatio', min: 0.3, max: 1.6, step: 0.15 },
  { key: 'harvPerRef', min: 1.5, max: 3, step: 0.25 },
  { key: 'harvExtra', min: 1, max: 4, step: 1, int: true },
  { key: 'minRefs', min: 2, max: 4, step: 1, int: true },
  { key: 'refAt', min: 120, max: 600, step: 60 },
  { key: 'advantage', min: 1, max: 2.2, step: 0.15 },
  { key: 'holdRatio', min: 0.3, max: 1.2, step: 0.12 },
  { key: 'waveMul', min: 0.6, max: 1.5, step: 0.1 },
  { key: 'reactionMul', min: 0.7, max: 1.5, step: 0.1 },
  { key: 'medicCap', min: 0, max: 0.25, step: 0.05 },
];
const keys = opt('keys', '');
const space = keys ? SPACE.filter((p) => keys.split(',').includes(p.key)) : SPACE;

// deterministic PRNG for mutations (reproducible runs)
let rs = +opt('seed', '12345') >>> 0 || 1;
const rnd = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };

function mutate(t: AITuning): [AITuning, string] {
  const c = { ...t };
  const n = 1 + Math.floor(rnd() * 3);
  const notes: string[] = [];
  for (let k = 0; k < n; k++) {
    const p = space[Math.floor(rnd() * space.length)];
    const dir = rnd() < 0.5 ? -1 : 1;
    const mag = 1 + Math.floor(rnd() * 2);
    let v = (c[p.key] as number) + dir * mag * p.step;
    v = Math.max(p.min, Math.min(p.max, v));
    if (p.int) v = Math.round(v); else v = Math.round(v * 1000) / 1000;
    (c[p.key] as number) = v;
    notes.push(`${p.key}=${v}`);
  }
  return [c, notes.join(' ')];
}

const pers = (tuning: AITuning, label: string): string | object => ({ ...resolvePersonality('balanced'), tuning, id: 'balanced', name: label });

function specsFor(a: AITuning, b: AITuning | 'legacy', seed0: number): MatchSpec[] {
  const specs: MatchSpec[] = [];
  let id = 0;
  for (const kind of maps) for (let g = 0; g < games / maps.length; g++) {
    // mirror match-ups: the faction imbalance would drown the signal
    const fa: Faction = g % 4 < 2 ? 'allies' : 'soviet';
    const fb: Faction = fa;
    const A: PlayerSpec = { faction: fa, difficulty: diff, personality: pers(a, 'cand') as any, label: 'cand' };
    const B: PlayerSpec = b === 'legacy' ? { faction: fb, difficulty: diff, legacy: true, label: 'base' } : { faction: fb, difficulty: diff, personality: pers(b, 'base') as any, label: 'base' };
    const seed = seed0 + g * 7919;
    specs.push({ id: id++, seed, map: kind, curated: kind === 'curated' ? ['proving-grounds', 'bridgewater', 'frozen-lakes', 'red-canyon', 'pocket-valley'][g % 5] : undefined, players: g % 2 ? [B, A] : [A, B], maxMinutes: minutes });
  }
  return specs;
}

/** Candidate's score share: wins, with timed-out games going to the material leader. */
function share(rs: MatchResult[]): { share: number; timeouts: number } {
  let s = 0, timeouts = 0;
  for (const r of rs) {
    const slot = r.players.findIndex((p) => p.label === 'cand');
    if (r.timedOut) timeouts++;
    if ((r.timedOut ? r.leader : r.winnerTeam) === slot) s++;
  }
  return { share: s / rs.length, timeouts };
}

let best: AITuning = { ...DEFAULT_TUNING, ...(opt('start', '') ? JSON.parse(opt('start', '')) : {}) };
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(s); };
say(`optimizer: ${iters} iterations x ${games} games, ${diff}, maps ${maps.join(',')}, vs ${vs}, accept >= ${accept}`);
let bestVsLegacy = -1;
if (vs === 'legacy') {
  const r = share(await runPool(specsFor(best, 'legacy', 500000)));
  bestVsLegacy = r.share;
  say(`baseline vs legacy: ${(r.share * 100).toFixed(1)}% (timeouts ${r.timeouts})`);
}
for (let it = 1; it <= iters; it++) {
  const [cand, note] = mutate(best);
  const t0 = performance.now();
  const seed0 = 1000003 * it;
  let sc: number, to: number;
  if (vs === 'legacy') {
    const r = share(await runPool(specsFor(cand, 'legacy', 500000)));
    sc = r.share; to = r.timeouts;
    const better = sc >= bestVsLegacy + 0.04;
    say(`#${it} ${note}: vs legacy ${(sc * 100).toFixed(1)}% (best ${(bestVsLegacy * 100).toFixed(1)}%, timeouts ${to}) ${better ? 'ACCEPT' : 'reject'} [${((performance.now() - t0) / 1000).toFixed(0)} s]`);
    if (better) { best = cand; bestVsLegacy = sc; }
  } else {
    const r = share(await runPool(specsFor(cand, best, seed0)));
    sc = r.share; to = r.timeouts;
    const better = sc >= accept;
    say(`#${it} ${note}: head-to-head ${(sc * 100).toFixed(1)}% (timeouts ${to}) ${better ? 'ACCEPT' : 'reject'} [${((performance.now() - t0) / 1000).toFixed(0)} s]`);
    if (better) best = cand;
  }
}
const diffs = Object.fromEntries(Object.entries(best).filter(([k, v]) => (DEFAULT_TUNING as any)[k] !== v));
say(`best (changes vs DEFAULT_TUNING): ${JSON.stringify(diffs)}`);
if (out) writeFileSync(out, JSON.stringify({ best, diffs, log }, null, 1));
