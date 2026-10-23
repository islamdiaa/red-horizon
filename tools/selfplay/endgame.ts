/**
 * Endgames: does a beaten side's last stand end the match? (round 4)
 *
 *  - stragglers: an AI of each level against the casual stand-in on the skirmish menu's defaults; at `--at` minutes the
 *                human is crushed (lib.ts MatchSpec.crush): every structure gone, every unit but `--keep` (the ones
 *                farthest from the AI, an Ore Truck among them), which drive to the far corners of the map and wait
 *                there. How long the AI takes to find and finish them (a human reduced to two hidden units once kept a
 *                Classic Brutal match running for 41 minutes).
 *
 *   node --import tsx tools/selfplay/endgame.ts [--games 16] [--diff recruit,easy,normal,hard,brutal] [--rules classic,commander]
 *        [--at 15] [--keep 2] [--after 30] [--size 96] [--tune k=v] [--json out.json]
 */
import { writeFileSync } from 'node:fs';
import type { Faction } from '../../src/data/rules';
import type { AIDifficulty } from '../../src/sim/ai';
import { dynamicDefault } from '../../src/modes/difficulty';
import { resolvePersonality } from '../../src/sim/ai-personality';
import { runPool } from './pool';
import type { MatchResult, MatchSpec, SkirmishSetup } from './lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const games = +opt('games', '16');
const diffs = opt('diff', 'recruit,easy,normal,hard,brutal').split(',') as AIDifficulty[];
const rulesSets = opt('rules', 'classic,commander').split(',');
const at = +opt('at', '15');
const keep = +opt('keep', '2');
const after = +opt('after', '30');
const size = +opt('size', '96');
const jsonOut = opt('json', '');
const tuneArg = opt('tune', '');
const tuning = Object.fromEntries(tuneArg.split(',').filter(Boolean).map((kv: string) => { const [k, v] = kv.split('='); return [k, +v]; }));

const median = (xs: number[]) => { if (!xs.length) return NaN; const s = xs.slice().sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

interface Tag { rules: string; diff: AIDifficulty }
const specs: MatchSpec[] = [];
const tags: Tag[] = [];
let id = 0;
for (const rules of rulesSets) for (const diff of diffs) for (let g = 0; g < games; g++) {
  const human: Faction = g % 2 ? 'soviet' : 'allies';
  let setup: SkirmishSetup = {
    faction: human, opponents: [{ faction: human === 'allies' ? 'soviet' : 'allies', difficulty: diff }], mapSize: size, water: 0.5, trees: 0.5, ore: 0.6,
    credits: 10000, startUnits: 'light', fog: true, timeOfDay: 'day', seed: 4242 + g * 7919, climate: 'temperate',
    rules: rules === 'commander' ? 'commander' : undefined, events: true, dynamicDifficulty: dynamicDefault([diff]),
  };
  if (tuneArg) setup = { ...setup, opponents: setup.opponents.map((o) => { const p = resolvePersonality(o.personality); return { ...o, personality: { ...p, tuning: { ...(p.tuning ?? {}), ...tuning } } }; }) };
  specs.push({
    id: id++, seed: setup.seed, map: 'land', setup, maxMinutes: at + after, crush: { slot: 0, atMin: at, keep },
    players: [{ faction: human, difficulty: 'normal', standin: 'casual', label: 'casual' }, { faction: setup.opponents[0].faction as Faction, difficulty: diff, label: 'ai' }],
  });
  tags.push({ rules, diff });
}

const t0 = Date.now();
console.log(`running ${specs.length} matches (crush at ${at} min, ${keep} units kept, ${after} min to find them)…`);
const res: MatchResult[] = await runPool(specs, { workers: +(process.env.WORKERS ?? 8) });

console.log('\n| cell | n | crushed | found and finished: median min after | within 3 / 5 / 10 min | not found in ' + after + ' min |');
console.log('|---|---|---|---|---|---|');
const keys = [...new Set(tags.map((t) => `${t.rules} ${t.diff}`))];
for (const k of keys) {
  const idx = tags.map((t, i) => (`${t.rules} ${t.diff}` === k ? i : -1)).filter((i) => i >= 0);
  const crushed = idx.filter((i) => (res[i].crushedMin ?? -1) >= 0);
  const took = crushed.filter((i) => !res[i].timedOut && res[i].winnerTeam === 1).map((i) => res[i].minutes - res[i].crushedMin!);
  const n = crushed.length;
  const w = (m: number) => `${Math.round((100 * took.filter((x) => x <= m).length) / Math.max(1, n))}%`;
  console.log(`| ${k} | ${idx.length} | ${n} | ${Number.isFinite(median(took)) ? median(took).toFixed(1) : '—'} | ${w(3)} / ${w(5)} / ${w(10)} | ${Math.round((100 * (n - took.length)) / Math.max(1, n))}% |`);
}
console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s)`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(res.map((r, i) => ({ ...r, tag: tags[i], players: r.players.map((p) => ({ ...p, trace: undefined })) }))));
