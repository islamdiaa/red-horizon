/**
 * Mass self-play: thousands of headless AI-vs-AI matches with a statistical report.
 *
 *   node --import tsx tools/selfplay/run.ts [options]
 *
 *   --mode faction        Allies vs Soviets, same difficulty and personality (balance check; default)
 *   --mode legacy         current AI vs the frozen legacy AI (both factions, both sides)
 *   --mode personalities  round-robin of every personality pair (both factions, both sides)
 *   --mode gauntlet       every personality against the legacy AI (both factions, both sides)
 *   --mode diff           difficulty ladder: each difficulty against the next one up (same faction mix)
 *   --games N             matches per configuration cell (default 40)
 *   --maps land,sea,curated   map kinds (curated = the 2-player curated maps in rotation)
 *   --diff normal         difficulty (comma list allowed)
 *   --size 96             generated map size (comma list allowed)
 *   --minutes 45          time limit per match (timed-out matches go to the material leader in "decided" stats)
 *   --personality id      personality for both sides in faction mode (default: none)
 *   --tune k=v,k=v        AITuning overrides for the current AI (e.g. harassOn=0, retreatHp=0.4); ablation studies
 *   --rules JSON          rule overrides for every match (see RuleOverrides in lib.ts), e.g. '{"units":{"4tnk":{"cost":1900}}}'
 *   --faction f           legacy / gauntlet modes: mirror matches of this faction only
 *   --prefer JSON         unit weight multipliers for the current AI's personality, e.g. '{"2tnk":2}'
 *   --adiff d             faction mode: the Allies play at this difficulty instead (how big is the faction gap?)
 *   --apers JSON          faction mode: personality fields for the Allied side only (experiments)
 *   --ai legacy           faction / diff modes: play both sides with the frozen legacy AI (the "before" numbers)
 *   --seed 1              first seed
 *   --workers N           worker threads (default: cores - 4, max 12; env WORKERS)
 *   --json file           dump every MatchResult
 *
 * Seeds alternate which slot each faction takes and (through the game's seed & 2 rule) the start positions,
 * so side and spawn advantages cancel out over a batch.
 */
import { writeFileSync } from 'node:fs';
import { UNITS, type Faction } from '../../src/data/rules';
import type { AIDifficulty } from '../../src/sim/ai';
import { PERSONALITIES, resolvePersonality, type AITuning, type Personality } from '../../src/sim/ai-personality';
import { runPool } from './pool';
import type { MapKind, MatchResult, MatchSpec, PlayerSpec } from './lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};
const mode = opt('mode', 'faction');
const games = +opt('games', '40');
const maps = opt('maps', 'land').split(',') as MapKind[];
const diffs = opt('diff', 'normal').split(',') as AIDifficulty[];
const sizes = opt('size', '96').split(',').map(Number);
const minutes = +opt('minutes', '45');
const personality = opt('personality', '');
const legacyAll = opt('ai', '') === 'legacy';
const onlyFaction = opt('faction', '') as Faction | '';
const rulesArg = opt('rules', '');
const rules = rulesArg ? JSON.parse(rulesArg) : undefined;
const tuneArg = opt('tune', '');
const preferArg = opt('prefer', '');
const alliesDiff = opt('adiff', '') as AIDifficulty | '';
const alliesPers = opt('apers', '');
const tuning: Partial<AITuning> = Object.fromEntries(tuneArg.split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, +v]; }));
/** Personality for the current AI: id (or default) plus any --tune overrides. */
function pers(id?: string): string | Personality | undefined {
  if (!tuneArg && !preferArg) return id || undefined;
  const p = resolvePersonality(id || undefined);
  return { ...p, tuning: { ...(p.tuning ?? {}), ...tuning }, prefer: { ...(p.prefer ?? {}), ...(preferArg ? JSON.parse(preferArg) : {}) } };
}
const seed0 = +opt('seed', '1');
const workers = +opt('workers', '0') || undefined;
const jsonOut = opt('json', '');

const CURATED_2P = ['proving-grounds', 'bridgewater', 'frozen-lakes', 'red-canyon', 'pocket-valley', 'archipelago'];

function mapFields(kind: MapKind, k: number, size: number): Pick<MatchSpec, 'map' | 'size' | 'curated'> {
  if (kind === 'curated') return { map: 'curated', curated: CURATED_2P[k % CURATED_2P.length] };
  return { map: kind, size };
}

/** Build the match list for the chosen mode. */
function buildSpecs(): MatchSpec[] {
  const specs: MatchSpec[] = [];
  let id = 0;
  const add = (seed: number, kind: MapKind, size: number, k: number, players: PlayerSpec[]) => {
    specs.push({ id: id++, seed, ...mapFields(kind, k, size), players, maxMinutes: minutes, rules });
  };
  for (const kind of maps) for (const size of kind === 'curated' ? [0] : sizes) for (const diff of diffs) {
    for (let g = 0; g < games; g++) {
      const seed = seed0 + g * 7919 + size * 13 + (kind === 'sea' ? 100003 : kind === 'curated' ? 200003 : 0);
      const swap = g % 2 === 1;
      if (mode === 'faction') {
        const a: PlayerSpec = { faction: 'allies', difficulty: alliesDiff || diff, personality: alliesPers ? { ...resolvePersonality('balanced'), ...JSON.parse(alliesPers) } : pers(personality), legacy: legacyAll, label: personality || undefined };
        const s: PlayerSpec = { faction: 'soviet', difficulty: diff, personality: pers(personality), legacy: legacyAll, label: personality || undefined };
        add(seed, kind, size, g, swap ? [s, a] : [a, s]);
      } else if (mode === 'legacy') {
        // mirror match-ups (the faction imbalance would drown the AI-quality signal), new AI on both sides of the map
        const fa: Faction = onlyFaction || ((g >> 1) % 2 ? 'soviet' : 'allies');
        const fb: Faction = fa;
        const nu: PlayerSpec = { faction: fa, difficulty: diff, personality: pers(personality), label: 'new' };
        const old: PlayerSpec = { faction: fb, difficulty: diff, legacy: true, label: 'legacy' };
        add(seed, kind, size, g, swap ? [old, nu] : [nu, old]);
      } else if (mode === 'diff') {
        const ladder: AIDifficulty[] = ['easy', 'normal', 'hard', 'brutal'];
        for (let d = 0; d + 1 < ladder.length; d++) {
          const f: Faction = g % 4 < 2 ? 'allies' : 'soviet';
          const lo: PlayerSpec = { faction: f, difficulty: ladder[d], label: ladder[d], legacy: legacyAll };
          const hi: PlayerSpec = { faction: f === 'allies' ? 'soviet' : 'allies', difficulty: ladder[d + 1], label: ladder[d + 1], legacy: legacyAll };
          add(seed + d, kind, size, g, swap ? [hi, lo] : [lo, hi]);
        }
      } else if (mode === 'gauntlet') {
        Object.keys(PERSONALITIES).forEach((id, i) => {
          const fa: Faction = onlyFaction || ((g >> 1) % 2 ? 'soviet' : 'allies');
          const fb: Faction = fa;
          const nu: PlayerSpec = { faction: fa, difficulty: diff, personality: pers(id), label: id };
          const old: PlayerSpec = { faction: fb, difficulty: diff, legacy: true, label: 'legacy' };
          add(seed + i * 101, kind, size, g, swap ? [old, nu] : [nu, old]);
        });
      } else if (mode === 'personalities') {
        const ids = Object.keys(PERSONALITIES);
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
          const f: Faction = g % 4 < 2 ? 'allies' : 'soviet';
          const o: Faction = f === 'allies' ? 'soviet' : 'allies';
          const a: PlayerSpec = { faction: f, difficulty: diff, personality: ids[i] };
          const b: PlayerSpec = { faction: o, difficulty: diff, personality: ids[j] };
          add(seed + i * 31 + j, kind, size, g, swap ? [b, a] : [a, b]);
        }
      } else throw new Error(`unknown mode ${mode}`);
    }
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
/** 95% Wilson score interval for k successes in n trials. */
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}
function rate(k: number, n: number): string {
  const [lo, hi] = wilson(k, n);
  return `${pct(n ? k / n : 0)} (${k}/${n}, 95% CI ${pct(lo)}–${pct(hi)})`;
}

/** Win share of `pred` players: decided = actual wins; timed-out games go to the material leader. */
function winShare(results: MatchResult[], pred: (r: MatchResult, slot: number) => boolean) {
  let wins = 0, n = 0, timeouts = 0, leadWins = 0;
  for (const r of results) {
    const slots = r.players.map((p) => p.slot).filter((s) => pred(r, s));
    if (slots.length !== 1) continue;
    const s = slots[0];
    n++;
    if (r.timedOut) { timeouts++; if (r.leader === s) leadWins++; }
    else if (r.winnerTeam === s) wins++;
  }
  return { wins, n, timeouts, leadWins, total: wins + leadWins };
}

function report(results: MatchResult[]) {
  const lines: string[] = [];
  const log = (s = '') => { lines.push(s); console.log(s); };
  const mins = results.map((r) => r.minutes).sort((a, b) => a - b);
  const med = mins[Math.floor(mins.length / 2)] ?? 0;
  const timeouts = results.filter((r) => r.timedOut).length;
  log(`\n# Self-play report: mode=${mode} games=${results.length} maps=${maps.join(',')} diff=${diffs.join(',')} sizes=${sizes.join(',')} limit=${minutes}min`);
  log(`median length ${med.toFixed(1)} min, mean ${(mins.reduce((s, x) => s + x, 0) / Math.max(1, mins.length)).toFixed(1)} min, timeouts ${timeouts} (${pct(timeouts / Math.max(1, results.length))})`);
  const tick = results.reduce((s, r) => s + r.msPerTick, 0) / Math.max(1, results.length);
  log(`simulation cost ${tick.toFixed(3)} ms/tick (mean over matches, wall time incl. AI)`);

  const groups = new Map<string, MatchResult[]>();
  for (const r of results) {
    const k = r.map.replace(/\d+$/, '');
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const keyOf = (r: MatchResult) => r.map.replace(/\d+$/, '');
  const byKind = (kind: string) => results.filter((r) => keyOf(r) === kind || (kind === 'curated' && !/^(land|sea)/.test(r.map)));

  if (mode === 'faction' || mode === 'personalities') {
    log('\n## Faction win rate (Allies share; decided games, then incl. timeouts resolved by material)');
    for (const kind of ['land', 'sea', 'curated']) {
      const rs = byKind(kind);
      if (!rs.length) continue;
      const w = winShare(rs, (r, s) => r.players[s].faction === 'allies');
      log(`  ${kind.padEnd(8)} decided: ${rate(w.wins, w.n - w.timeouts)}   with timeouts: ${rate(w.total, w.n)}`);
    }
    if (results.some((r) => !/^(land|sea)/.test(r.map))) {
      for (const [map, rs] of [...groups].filter(([k]) => !/^(land|sea)/.test(k))) {
        const w = winShare(rs, (r, s) => r.players[s].faction === 'allies');
        log(`    ${map.padEnd(16)} allies ${rate(w.total, w.n)}`);
      }
    }
  }
  if (mode === 'legacy') {
    log('\n## New AI vs legacy AI');
    for (const kind of ['land', 'sea', 'curated']) {
      const rs = byKind(kind);
      if (!rs.length) continue;
      const w = winShare(rs, (r, s) => r.players[s].label === 'new');
      log(`  ${kind.padEnd(8)} new wins ${rate(w.total, w.n)} (timeouts ${w.timeouts})`);
      for (const f of ['allies', 'soviet']) {
        const wf = winShare(rs, (r, s) => r.players[s].label === 'new' && r.players[s].faction === f);
        log(`     as ${f.padEnd(7)} ${rate(wf.total, wf.n)}`);
      }
    }
  }
  if (mode === 'diff') {
    log('\n## Difficulty ladder (higher difficulty win share)');
    for (const pair of ['normal', 'hard', 'brutal']) {
      const rs = results.filter((r) => r.players.some((p) => p.label === pair) && r.players.every((p) => p.label === pair || p.label === ({ normal: 'easy', hard: 'normal', brutal: 'hard' } as Record<string, string>)[pair]));
      const w = winShare(rs, (r, s) => r.players[s].label === pair);
      log(`  ${pair.padEnd(7)} vs one below: ${rate(w.total, w.n)}`);
    }
  }
  if (mode === 'gauntlet') {
    log('\n## Personalities against the legacy AI (win share incl. timeouts by material)');
    const rows: [string, number, number, number][] = [];
    for (const id of Object.keys(PERSONALITIES)) {
      const w = winShare(results, (r, s) => r.players[s].label === id);
      const mins = results.filter((r) => r.players.some((p) => p.label === id)).map((r) => r.minutes);
      rows.push([id, w.total, w.n, mins.reduce((s, x) => s + x, 0) / Math.max(1, mins.length)]);
    }
    rows.sort((a, b) => b[1] / Math.max(1, b[2]) - a[1] / Math.max(1, a[2]));
    for (const [id, k, n, m] of rows) log(`  ${id.padEnd(12)} ${rate(k, n)}  mean length ${m.toFixed(1)} min`);
  }
  if (mode === 'personalities') {
    log('\n## Personality win rates (all pairings, both factions)');
    const ids = Object.keys(PERSONALITIES);
    const rows: [string, number, number][] = [];
    for (const id of ids) {
      const w = winShare(results, (r, s) => r.players[s].label === id);
      rows.push([id, w.total, w.n]);
    }
    rows.sort((a, b) => b[1] / Math.max(1, b[2]) - a[1] / Math.max(1, a[2]));
    for (const [id, k, n] of rows) log(`  ${id.padEnd(14)} ${rate(k, n)}`);
    log('\n  head-to-head (row win share vs column):');
    log('  ' + ''.padEnd(14) + ids.map((i) => i.slice(0, 7).padStart(8)).join(''));
    for (const a of ids) {
      let line = '  ' + a.padEnd(14);
      for (const b of ids) {
        if (a === b) { line += '       -'; continue; }
        const rs = results.filter((r) => r.players.some((p) => p.label === a) && r.players.some((p) => p.label === b));
        const w = winShare(rs, (r, s) => r.players[s].label === a);
        line += (w.n ? pct(w.total / w.n) : '').padStart(8);
      }
      log(line);
    }
  }

  // unit usage and real-game cost effectiveness per faction
  log('\n## Unit usage per match (mean built) and in-game exchange (value destroyed / value lost) per unit type');
  for (const f of ['allies', 'soviet'] as Faction[]) {
    const ps = results.flatMap((r) => r.players.filter((p) => p.faction === f));
    if (!ps.length) continue;
    const built: Record<string, number> = {}, kills: Record<string, number> = {}, lost: Record<string, number> = {};
    for (const p of ps) {
      for (const [k, v] of Object.entries(p.built)) built[k] = (built[k] ?? 0) + v;
      for (const [k, v] of Object.entries(p.killsByType)) kills[k] = (kills[k] ?? 0) + v;
      for (const [k, v] of Object.entries(p.lostByType)) lost[k] = (lost[k] ?? 0) + v;
    }
    const kv = ps.reduce((s, p) => s + p.killedValue, 0), lv = ps.reduce((s, p) => s + p.lostValue, 0);
    log(`  ${f}: ${ps.length} player-games, exchange ${(kv / Math.max(1, lv)).toFixed(2)}, harvested ${Math.round(ps.reduce((s, p) => s + p.harvested, 0) / ps.length)}/game`);
    const ids = Object.keys(built).filter((k) => UNITS[k] && !UNITS[k].harvester).sort((a, b) => built[b] * UNITS[b].cost - built[a] * UNITS[a].cost);
    for (const id of ids) {
      const spend = (built[id] * UNITS[id].cost) / ps.length;
      const ex = (kills[id] ?? 0) / Math.max(1, lost[id] ?? 0);
      log(`    ${id.padEnd(5)} ${(built[id] / ps.length).toFixed(1).padStart(5)} built  $${Math.round(spend).toString().padStart(6)}/game  destroyed $${Math.round((kills[id] ?? 0) / ps.length).toString().padStart(6)}  lost $${Math.round((lost[id] ?? 0) / ps.length).toString().padStart(6)}  exch ${ex.toFixed(2)}`);
    }
    const defs: Record<string, number> = {};
    for (const p of ps) for (const [k, v] of Object.entries(p.killsByType)) if (!UNITS[k]) defs[k] = (defs[k] ?? 0) + v;
    log(`    structures destroyed value/game: ${Object.entries(defs).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} $${Math.round(v / ps.length)}`).join(', ')}`);
    const pw: Record<string, number> = {};
    for (const p of ps) for (const [k, v] of Object.entries(p.powers)) pw[k] = (pw[k] ?? 0) + v;
    log(`    powers per game: ${Object.entries(pw).map(([k, v]) => `${k} ${(v / ps.length).toFixed(2)}`).join(', ') || 'none'}`);
  }
  return lines;
}

const specs = buildSpecs();
console.log(`running ${specs.length} matches…`);
const t0 = performance.now();
let lastPrint = 0;
const results = await runPool(specs, {
  workers,
  progress: (done, total) => {
    const now = performance.now();
    if (now - lastPrint > 15000 || done === total) {
      lastPrint = now;
      console.log(`  ${done}/${total} matches (${((now - t0) / 1000).toFixed(0)} s)`);
    }
  },
});
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
report(results);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results));
