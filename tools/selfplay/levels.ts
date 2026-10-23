/**
 * The AI levels in the conditions players meet them: every level against the human stand-ins (tools/selfplay/standin.ts)
 * in Quick Battle rolls and in the custom skirmish defaults, with 95% Wilson intervals, how long the human's wins take,
 * and whether the easy levels look alive (scouting, a first wave, reaching the human's base).
 *
 *   node --import tsx tools/selfplay/levels.ts [--games 40] [--cond qb,custom] [--rules commander,classic]
 *        [--pairs targets|all] [--diff ...] [--vs newcomer,novice,casual,experienced] [--size 96] [--minutes 45]
 *        [--seed 1] [--rivals 0.35] [--patch '[["DIFF.recruit.firstAttack",600]]'] [--json out.json]
 *
 * Conditions:
 *  - qb:      a Quick Battle roll per game (src/modes/quickbattle.ts: generated 80-112 maps with water, or a curated
 *             two-player map; climate, time of day, a personality or, in `--rivals` of the games, a rival with a
 *             newcomer's counter-plan; one mutator, newcomer-safe below Normal; battlefield events; dynamic difficulty
 *             on below Normal) at the AI level under test. Quick Battle is Commander rules; `--rules classic` plays the
 *             same rolls under Classic rules (no events) as a check of the bigger maps.
 *  - custom:  the skirmish menu's defaults (src/ui/menu.ts loadPrefs): a generated 96x96 map (--size), water 0.5,
 *             ore 0.6, $10,000, light start units, battlefield events (Commander), balanced personality, dynamic
 *             difficulty at its default (on below Normal), per --rules.
 * --pairs targets plays only the stand-ins each level is measured against (docs/BALANCE.md): Recruit and Easy against
 * the newcomer and the novice (Easy also the casual player), Normal against the casual player, Hard against the casual
 * and the experienced player, Brutal against the experienced player. Factions alternate (the human is slot 0 as in the
 * game); a match still running at the time limit goes to the side ahead on material. Workers: WORKERS env (default 8).
 */
import { writeFileSync } from 'node:fs';
import { BUILDINGS, UNITS, type Faction } from '../../src/data/rules';
import type { AIDifficulty } from '../../src/sim/ai';
import { rollQuickBattle } from '../../src/modes/quickbattle';
import { dynamicDefault } from '../../src/modes/difficulty';
import { PERSONALITIES, resolvePersonality, withTweaks } from '../../src/sim/ai-personality';
import { Rng } from '../../src/core/rng';
import { runPool } from './pool';
import type { MatchResult, MatchSpec, SkirmishSetup } from './lib';
import type { StandInLevel } from './standin';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const games = +opt('games', '40');
const conds = opt('cond', 'qb,custom').split(',');
const rulesSets = opt('rules', 'commander,classic').split(',');
const pairsArg = opt('pairs', 'targets');
const diffs = opt('diff', 'recruit,easy,normal,hard,brutal').split(',') as AIDifficulty[];
const vsArg = opt('vs', 'newcomer,novice,casual,experienced').split(',') as StandInLevel[];
const size = +opt('size', '96');
const minutes = +opt('minutes', '45');
const seed0 = +opt('seed', '1');
const rivalShare = +opt('rivals', '0.35');
const jsonOut = opt('json', '');
// (experiments: rule / Commander / difficulty patches for every match, e.g. '[["DIFF.recruit.firstAttack",600]]')
const patches = JSON.parse(opt('patch', '[]')) as [string, unknown][];
// (experiments: AITuning overrides for the AI, e.g. --tune proSiege=2,proWhole=1)
const tuneArg = opt('tune', '');
// (diagnosis: --probe ai records what the AI thinks and does, tools/selfplay/probes.ts, and prints a summary per cell)
const probeArg = opt('probe', '');
const tuning = Object.fromEntries(tuneArg.split(',').filter(Boolean).map((kv: string) => { const [k, v] = kv.split('='); return [k, +v]; }));

/** The stand-ins each level is measured against (docs/BALANCE.md targets). */
const TARGETS: Record<AIDifficulty, StandInLevel[]> = {
  recruit: ['newcomer', 'novice'],
  easy: ['newcomer', 'novice', 'casual'],
  normal: ['casual'],
  hard: ['casual', 'experienced'],
  brutal: ['experienced'],
};

function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}
const pct = (k: number, n: number) => {
  const [lo, hi] = wilson(k, n);
  return `${n ? Math.round((100 * k) / n) : 0}% [${Math.round(lo * 100)}–${Math.round(hi * 100)}]`;
};
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fm = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');

/** A rival in a Quick Battle: a personality with the counter-plan a newcomer's habits draw (infantry-heavy, no rush). */
function rivalOpponent(rng: Rng, diff: AIDifficulty): SkirmishSetup['opponents'][number] {
  const ids = Object.keys(PERSONALITIES);
  const base = PERSONALITIES[ids[rng.int(0, ids.length - 1)]];
  const faction: Faction = rng.chance(0.5) ? 'allies' : 'soviet';
  const sov = faction === 'soviet';
  // (rivals.ts counterPlan for a player whose army is mostly infantry: anti-infantry units and a little artillery)
  const prefer: Record<string, number> = {};
  for (const id of sov ? ['e2', 'e4', 'ftur', 'v2rl'] : ['pbox', 'arty', 'jeep']) prefer[id] = 1.6;
  const personality = withTweaks(base, { traits: { artillery: 0.15 }, prefer, tags: ['rival:sim'] });
  // (a rival of rank 0-1 is Easy or Normal, never above the commander's level)
  return { faction, difficulty: diff, personality };
}

interface Tag { cond: string; rules: string; diff: AIDifficulty; vs: StandInLevel; map: string; mut: string; pers: string; size: number }
const specs: MatchSpec[] = [];
const tags: Tag[] = [];
let id = 0;
for (const cond of conds) for (const rules of rulesSets) for (const diff of diffs) {
  const vsList = (pairsArg === 'all' ? vsArg : TARGETS[diff].filter((v) => vsArg.includes(v)));
  for (const vs of vsList) for (let g = 0; g < games; g++) {
    const human: Faction = g % 2 ? 'soviet' : 'allies';
    let setup: SkirmishSetup;
    if (cond === 'qb') {
      const qbSeed = seed0 * 100003 + g * 7919 + 17;
      const rng = new Rng((qbSeed ^ 0x6a09e667) >>> 0 || 1);
      const rival = rng.chance(rivalShare) ? { name: 'Rival', opponent: rivalOpponent(rng, diff) } : undefined;
      setup = rollQuickBattle(qbSeed, { faction: human, color: 0, quality: 'low' as never, skill: diff, rival }) as SkirmishSetup;
      if (rules === 'classic') setup = { ...setup, rules: undefined, events: undefined, econ: undefined };
    } else {
      const opponents: SkirmishSetup['opponents'] = [{ faction: human === 'allies' ? 'soviet' : 'allies', difficulty: diff }];
      setup = {
        faction: human, opponents, mapSize: size, water: 0.5, trees: 0.5, ore: 0.6, credits: 10000, startUnits: 'light', fog: true,
        timeOfDay: 'day', seed: seed0 * 7 + g * 7919 + 101, climate: 'temperate', rules: rules === 'commander' ? 'commander' : undefined,
        events: true, dynamicDifficulty: dynamicDefault([diff]),
      };
    }
    if (tuneArg) setup = { ...setup, opponents: setup.opponents.map((o) => { const p = resolvePersonality(o.personality); return { ...o, personality: { ...p, tuning: { ...(p.tuning ?? {}), ...tuning } } }; }) };
    const opp = setup.opponents[0];
    specs.push({
      id: id++, seed: setup.seed, map: 'land', setup, maxMinutes: minutes, rules: patches.length ? { patches } : undefined, probe: probeArg === 'ai' ? 'ai' : undefined,
      players: [{ faction: human, difficulty: 'normal', standin: vs, label: vs }, { faction: (opp.faction === 'random' ? 'allies' : opp.faction) as Faction, difficulty: diff, label: 'ai' }],
    });
    const pers = typeof opp.personality === 'string' ? opp.personality : opp.personality?.tags?.includes('rival:sim') ? `rival:${opp.personality.id}` : opp.personality?.id ?? 'balanced';
    tags.push({ cond, rules, diff, vs, map: setup.mapId ?? `gen${setup.mapSize}${setup.water >= 0.4 ? 'w' : ''}`, mut: (setup.mutators ?? []).join('+') || '-', pers, size: setup.mapSize });
  }
}
// (multiplayer-style slot faction: opponents' 'random' is resolved by buildFromSetup from the seed; label only)

const t0 = Date.now();
console.log(`running ${specs.length} matches…`);
let last = 0;
const res: MatchResult[] = await runPool(specs, {
  workers: +(process.env.WORKERS ?? 8),
  progress: (done, total) => { if (Date.now() - last > 60000 || done === total) { last = Date.now(); console.log(`  ${done}/${total} (${Math.round((Date.now() - t0) / 1000)} s)`); } },
});

const aiWon = (r: MatchResult) => (r.winnerTeam >= 0 ? r.winnerTeam : r.leader) === 1;
interface Cell { k: number; n: number; to: number; humanWinMin: number[]; aiWinMin: number[]; wave: number[]; waveBy15: number; scoutBy5: number; atHuman: number[]; harvAI: number; harvH: number; mins: number }
function table(key: (t: Tag) => string, title: string, extra = true) {
  const cells = new Map<string, Cell>();
  res.forEach((r, i) => {
    const k = key(tags[i]);
    const c = cells.get(k) ?? { k: 0, n: 0, to: 0, humanWinMin: [], aiWinMin: [], wave: [], waveBy15: 0, scoutBy5: 0, atHuman: [], harvAI: 0, harvH: 0, mins: 0 };
    c.n++;
    const won = aiWon(r);
    if (won) c.k++;
    if (r.timedOut) c.to++;
    (won ? c.aiWinMin : c.humanWinMin).push(r.minutes);
    const ai = r.players[1], h = r.players[0];
    if ((ai.firstWaveMin ?? -1) >= 0) c.wave.push(ai.firstWaveMin!);
    if ((ai.firstWaveMin ?? -1) >= 0 && ai.firstWaveMin! <= 15) c.waveBy15++;
    if ((ai.firstScoutMin ?? -1) >= 0 && ai.firstScoutMin! <= 5) c.scoutBy5++;
    if ((ai.firstAtEnemyMin ?? -1) >= 0) c.atHuman.push(ai.firstAtEnemyMin!);
    c.harvAI += ai.harvested; c.harvH += h.harvested; c.mins += r.minutes;
    cells.set(k, c);
  });
  console.log(`\n## ${title}`);
  if (extra) {
    console.log('| cell | n | AI wins [95% CI] | timeouts | human wins: median min | AI first wave (median min, by 15 min) | AI scouted by 5 min | AI reached the human base (median min) | harvest $/min AI / human |');
    console.log('|---|---|---|---|---|---|---|---|---|');
  } else {
    console.log('| cell | n | AI wins [95% CI] | timeouts |');
    console.log('|---|---|---|---|');
  }
  for (const [k, c] of [...cells].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!extra) { console.log(`| ${k} | ${c.n} | ${pct(c.k, c.n)} | ${Math.round((100 * c.to) / c.n)}% |`); continue; }
    console.log(`| ${k} | ${c.n} | ${pct(c.k, c.n)} | ${Math.round((100 * c.to) / c.n)}% | ${fm(median(c.humanWinMin))} | ${fm(median(c.wave))} (${Math.round((100 * c.waveBy15) / c.n)}%) | ${Math.round((100 * c.scoutBy5) / c.n)}% | ${fm(median(c.atHuman))} | ${Math.round(c.harvAI / c.mins)} / ${Math.round(c.harvH / c.mins)} |`);
  }
}
const lvl = (t: Tag) => `${t.diff.padEnd(7)} vs ${t.vs}`;
table((t) => `${t.cond} ${t.rules} ${lvl(t)}`, 'Per condition and ruleset');
table((t) => `${lvl(t)}`, 'All conditions pooled');
if (conds.includes('qb')) {
  table((t) => `${t.cond} ${t.rules} ${lvl(t)} ${t.size >= 96 ? '96-112' : '<96'}`, 'Quick Battle by map size', false);
  table((t) => `${t.diff} ${t.mut}`, 'Per mutator (Quick Battle; all stand-ins)', false);
  table((t) => `${t.diff} ${t.pers.startsWith('rival') ? 'rival' : t.pers}`, 'Per personality (all stand-ins)', false);
  table((t) => `${t.diff} ${t.map.startsWith('gen') ? t.map : 'curated'}`, 'Per map kind (all stand-ins)', false);
}
// dynamic difficulty (on below Normal by default): assist-only means it never went above level 0 there
{
  const rows = new Map<string, { n: number; up: number; down: number; min: number }>();
  res.forEach((r, i) => {
    if (!r.dynRange) return;
    const k = tags[i].diff;
    const c = rows.get(k) ?? { n: 0, up: 0, down: 0, min: 0 };
    c.n++; if (r.dynRange[1] > 0) c.up++; if (r.dynRange[0] < 0) c.down++; c.min = Math.min(c.min, r.dynRange[0]);
    rows.set(k, c);
  });
  if (rows.size) {
    console.log('\n## Dynamic difficulty (games with it on)');
    for (const [k, c] of rows) console.log(`  ${k}: ${c.n} games, pushed harder in ${c.up}, eased off in ${c.down} (lowest level ${c.min})`);
  }
}
if (probeArg === 'ai') { diagnosis(); endgame(); }
console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s)`);

/** --probe ai: how the games end, and what keeps a beaten side alive (the AI's leftovers in the human's long games). */
function endgame() {
  const groups = new Map<string, number[]>();
  res.forEach((_, i) => { const t = tags[i]; const k = `${t.cond} ${t.rules} ${lvl(t)}`; groups.set(k, [...(groups.get(k) ?? []), i]); });
  console.log('\n## How games end (--probe ai)');
  console.log('| cell | n | human won by 20 / 25 / 30 min | undecided at 30 min | human ahead, undecided at 30 (n) | AI left then: structures / units (median) | yard alive | AI bank | AI spread structures / units (cells) | AI structures placed after 15 min | AI leftovers (types) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, idx] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const n = idx.length;
    let w20 = 0, w25 = 0, w30 = 0, und = 0, yard = 0;
    const st: number[] = [], un: number[] = [], bank: number[] = [], sb: number[] = [], su: number[] = [], late: number[] = [];
    const types = new Map<string, number>();
    let ahead = 0;
    for (const i of idx) {
      const r = res[i];
      const hw = r.winnerTeam === 0;
      if (hw && r.minutes <= 20) w20++;
      if (hw && r.minutes <= 25) w25++;
      if (hw && r.minutes <= 30) w30++;
      if (r.minutes > 30) und++;
      // (the human ahead at the end of a long game, or won only after 30 min: what was keeping the AI in it)
      if (r.minutes > 30 && (r.winnerTeam === 0 || (r.timedOut && r.leader === 0))) {
        ahead++;
        const e = r.ai?.end.find((x) => x.slot === 1);
        if (!e) continue;
        st.push(Object.values(e.structures).reduce((a, b) => a + b, 0));
        un.push(Object.values(e.units).reduce((a, b) => a + b, 0));
        bank.push(e.credits); sb.push(e.spreadB); su.push(e.spreadU); late.push(e.lateBuilt);
        if (e.yard) yard++;
        for (const [t, c] of [...Object.entries(e.structures), ...Object.entries(e.units)]) types.set(t, (types.get(t) ?? 0) + c);
      }
    }
    const top = [...types].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, c]) => `${t}×${(c / Math.max(1, ahead)).toFixed(1)}`).join(' ');
    const m = (xs: number[]) => fm(median(xs));
    console.log(`| ${k} | ${n} | ${Math.round(100 * w20 / n)}% / ${Math.round(100 * w25 / n)}% / ${Math.round(100 * w30 / n)}% | ${Math.round(100 * und / n)}% | ${ahead} | ${m(st)} / ${m(un)} | ${ahead ? Math.round(100 * yard / ahead) : 0}% | ${m(bank)} | ${m(sb)} / ${m(su)} | ${m(late)} | ${top} |`);
  }
}

/** --probe ai: why the AI wins or loses (waves, armies, its estimate of the enemy, Ore Trucks, spending). */
function diagnosis() {
  const cost = (id: string) => (UNITS[id]?.cost ?? BUILDINGS[id]?.cost ?? 0);
  const groups = new Map<string, number[]>();
  res.forEach((_, i) => { const t = tags[i]; const k = `${t.cond} ${t.rules} ${lvl(t)}`; groups.set(k, [...(groups.get(k) ?? []), i]); });
  console.log('\n## Diagnosis (--probe ai; per game means, AI = slot 1)');
  console.log('| cell | waves/game | broken / fallback / done | wave $ (median) | wave kill:loss | reached base | AI:enemy army at 8 / 12 / 20 min | est:true at 12 / 20 | build-state samples ready (idle >= need) | trucks lost home / mid / enemy | AI $ structures / units | human $ structures / units |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, idx] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const n = idx.length;
    let waves = 0, br = 0, fb = 0, dn = 0, kill = 0, loss = 0, reached = 0, ready = 0, buildS = 0, th = 0, tm = 0, te = 0, aS = 0, aU = 0, hS = 0, hU = 0;
    const wv: number[] = [], r8: number[] = [], r12: number[] = [], r20: number[] = [], e12: number[] = [], e20: number[] = [];
    for (const i of idx) {
      const r = res[i], pr = r.ai;
      if (!pr) continue;
      for (const x of pr.waves) if (x.slot === 1) { waves++; if (x.end === 'broken') br++; else if (x.end === 'fallback') fb++; else dn++; kill += x.killed; loss += x.lost; if (x.reached) reached++; wv.push(x.value); }
      for (const x of pr.series) {
        if (x.slot !== 1) continue;
        const ratio = x.enemyArmy > 0 ? x.army / x.enemyArmy : NaN;
        if (x.min === 8) r8.push(ratio);
        if (x.min === 12) { r12.push(ratio); if (x.enemyArmy > 0) e12.push(x.est / x.enemyArmy); }
        if (x.min === 20) { r20.push(ratio); if (x.enemyArmy > 0) e20.push(x.est / x.enemyArmy); }
        if (x.state.startsWith('build') && x.min >= 6) { buildS++; if (x.need > 0 && x.idle >= x.need) ready++; }
      }
      for (const h of pr.harvLost) if (h.slot === 1) { if (h.where === 'home') th++; else if (h.where === 'mid') tm++; else te++; }
      const ai = r.players[1], hu = r.players[0];
      for (const [t, c] of Object.entries(ai.structures)) aS += cost(t) * c;
      for (const [t, c] of Object.entries(ai.built)) aU += cost(t) * c;
      for (const [t, c] of Object.entries(hu.structures)) hS += cost(t) * c;
      for (const [t, c] of Object.entries(hu.built)) hU += cost(t) * c;
    }
    const m2 = (xs: number[]) => fm(median(xs.filter(Number.isFinite)));
    console.log(`| ${k} | ${(waves / n).toFixed(1)} | ${Math.round(100 * br / Math.max(1, waves))}% / ${Math.round(100 * fb / Math.max(1, waves))}% / ${Math.round(100 * dn / Math.max(1, waves))}% | ${Math.round(median(wv) || 0)} | ${(kill / Math.max(1, loss)).toFixed(2)} | ${Math.round(100 * reached / Math.max(1, waves))}% | ${m2(r8)} / ${m2(r12)} / ${m2(r20)} | ${m2(e12)} / ${m2(e20)} | ${Math.round(100 * ready / Math.max(1, buildS))}% of ${Math.round(buildS / n)} | ${(th / n).toFixed(1)} / ${(tm / n).toFixed(1)} / ${(te / n).toFixed(1)} | ${Math.round(aS / n)} / ${Math.round(aU / n)} | ${Math.round(hS / n)} / ${Math.round(hU / n)} |`);
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(res.map((r, i) => ({ ...r, tag: tags[i], players: r.players.map((p) => ({ ...p, trace: undefined })) }))));
