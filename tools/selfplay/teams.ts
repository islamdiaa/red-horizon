/**
 * Team play and navies at every AI level (scripted scenarios with the probes of tools/selfplay/probes.ts):
 *
 *  - 2v2:   a human stand-in (slot 0) and an AI teammate against two AIs, all AIs at the level under test (the
 *           multiplayer 2v2 lobby with AI seats): the team's win share, whether the AI teammate comes to the human's
 *           base when it is attacked, joins the human's pushes, sits idle, or mines next to the human's refinery.
 *  - ffa:   a human stand-in and three AIs, each on its own team: whom the AIs' waves go for (a third each would be
 *           even-handed), and when each player falls.
 *  - naval: two AIs of the level on a sea map (generated, water 1): ships built and lost, and what the ships destroyed.
 *
 *   node --import tsx tools/selfplay/teams.ts [--mode 2v2,ffa,naval] [--games 24] [--diff recruit,easy,normal,hard,brutal]
 *        [--vs casual] [--rules commander,classic] [--size 96] [--minutes 45] [--json out.json]
 */
import { writeFileSync } from 'node:fs';
import type { Faction } from '../../src/data/rules';
import type { AIDifficulty } from '../../src/sim/ai';
import { runPool } from './pool';
import type { MatchResult, MatchSpec, PlayerSpec, SkirmishSetup } from './lib';
import type { StandInLevel } from './standin';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const modes = opt('mode', '2v2,ffa,naval').split(',');
const games = +opt('games', '24');
const diffs = opt('diff', 'recruit,easy,normal,hard,brutal').split(',') as AIDifficulty[];
const vs = opt('vs', 'casual') as StandInLevel;
const rulesSets = opt('rules', 'commander,classic').split(',');
const size = +opt('size', '96');
const minutes = +opt('minutes', '45');
const jsonOut = opt('json', '');
// (naval: a curated naval map instead of a generated sea map, e.g. --map archipelago)
const navalMap = opt('map', '');

function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}
const pct = (k: number, n: number) => { const [lo, hi] = wilson(k, n); return `${n ? Math.round((100 * k) / n) : 0}% [${Math.round(lo * 100)}–${Math.round(hi * 100)}]`; };
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = xs.slice().sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

interface Tag { mode: string; rules: string; diff: AIDifficulty }
const specs: MatchSpec[] = [];
const tags: Tag[] = [];
let id = 0;
const other = (f: Faction): Faction => (f === 'allies' ? 'soviet' : 'allies');
for (const mode of modes) for (const rules of rulesSets) for (const diff of diffs) for (let g = 0; g < games; g++) {
  const seed = 9001 + g * 7919 + (rules === 'classic' ? 31 : 0);
  const human: Faction = g % 2 ? 'soviet' : 'allies';
  const base = { mapSize: size, trees: 0.5, ore: 0.6, credits: 10000, startUnits: 'mcv' as const, fog: true, timeOfDay: 'day' as const, seed, climate: 'temperate' as const, rules: rules === 'commander' ? 'commander' as const : undefined, events: true };
  let setup: SkirmishSetup, players: PlayerSpec[], teams: number[] | undefined, probe: MatchSpec['probe'];
  if (mode === '2v2') {
    // (the 2v2 lobby: slots 0+1 against 2+3; the teammate mixes factions as random seats do)
    const mate: Faction = g % 4 < 2 ? human : other(human);
    setup = { ...base, faction: human, water: 0.4, opponents: [{ faction: mate, difficulty: diff }, { faction: other(human), difficulty: diff }, { faction: g % 3 ? other(human) : human, difficulty: diff }] };
    teams = [0, 0, 1, 1];
    probe = 'teams';
  } else if (mode === 'ffa') {
    setup = { ...base, faction: human, water: 0.4, opponents: [0, 1, 2].map((i) => ({ faction: (g + i) % 2 ? 'allies' as Faction : 'soviet' as Faction, difficulty: diff })) };
    probe = 'teams';
  } else {
    setup = { ...base, faction: human, water: 1, opponents: [{ faction: other(human), difficulty: diff }], mapId: navalMap || undefined };
    probe = 'naval';
  }
  players = [{ faction: human, difficulty: 'normal', standin: vs, label: vs },
    ...setup.opponents.map((o, i): PlayerSpec => ({ faction: o.faction as Faction, difficulty: diff, label: `ai${i + 1}` }))];
  // (naval: both sides AI; a plain AI spec in slot 0 makes buildFromSetup seat an AI there)
  if (mode === 'naval') players[0] = { faction: human, difficulty: diff, label: 'ai0' };
  specs.push({ id: id++, seed, map: 'land', setup, teams, players, maxMinutes: minutes, probe });
  tags.push({ mode, rules, diff });
}

const t0 = Date.now();
console.log(`running ${specs.length} matches…`);
const res: MatchResult[] = await runPool(specs, { workers: +(process.env.WORKERS ?? 8) });

const by = new Map<string, number[]>();
res.forEach((_, i) => { const k = `${tags[i].mode} ${tags[i].rules} ${tags[i].diff}`; by.set(k, [...(by.get(k) ?? []), i]); });
for (const mode of modes) {
  console.log(`\n## ${mode}`);
  if (mode === '2v2') {
    console.log('| cell | n | human team wins | timeouts | base attacks: help sent / arrived in 150 s (median s) | pushes joined | teammate idle at home | teammate mining by the human | waves at each enemy |');
    console.log('|---|---|---|---|---|---|---|---|---|');
  } else if (mode === 'ffa') {
    console.log('| cell | n | human wins | AI waves at the human | human defeated (median min) | AIs defeated by 45 min |');
    console.log('|---|---|---|---|---|---|');
  } else {
    console.log('| cell | n | ships built (median) | had a naval yard | ships lost | ship kills: ships / shore ($, mean) | timeouts |');
    console.log('|---|---|---|---|---|---|---|');
  }
  for (const [k, idx] of by) {
    if (!k.startsWith(mode + ' ')) continue;
    const rs = idx.map((i) => res[i]);
    const n = rs.length;
    if (mode === '2v2') {
      const won = rs.filter((r) => r.winnerTeam === 0 || (r.winnerTeam < 0 && (r.leader === 0 || r.leader === 1))).length;
      let att = 0, sent = 0, helped = 0, pushes = 0, joined = 0, idle = 0, samples = 0, ore = 0, oreS = 0;
      const secs: number[] = [];
      const targets: Record<number, number> = {};
      for (const r of rs) {
        const t = r.teams!;
        att += t.baseAttacks; sent += t.helpSent ?? 0; helped += t.helped; secs.push(...t.helpSeconds); pushes += t.pushes; joined += t.joined;
        idle += t.allyIdle; samples += t.allySamples; ore += t.allyOreNearHuman; oreS += t.allyOreSamples;
        for (const [a, tg, c] of t.waveTargets) if (a >= 2) targets[tg] = (targets[tg] ?? 0) + c;
      }
      console.log(`| ${k} | ${n} | ${pct(won, n)} | ${rs.filter((r) => r.timedOut).length} | ${pct(sent, att)} / ${pct(helped, att)} of ${att} (${median(secs).toFixed(0)}) | ${pct(joined, pushes)} of ${pushes} | ${pct(idle, samples)} | ${pct(ore, oreS)} | human ${targets[0] ?? 0}, AI mate ${targets[1] ?? 0} |`);
    } else if (mode === 'ffa') {
      const won = rs.filter((r) => r.winnerTeam === 0 || (r.winnerTeam < 0 && r.leader === 0)).length;
      let atHuman = 0, all = 0, aiDown = 0;
      const down: number[] = [];
      for (const r of rs) {
        for (const [, tg, c] of r.teams!.waveTargets) { all += c; if (tg === 0) atHuman += c; }
        if (r.teams!.defeatedAt[0] >= 0) down.push(r.teams!.defeatedAt[0]);
        aiDown += r.teams!.defeatedAt.slice(1).filter((m) => m >= 0).length;
      }
      console.log(`| ${k} | ${n} | ${pct(won, n)} | ${pct(atHuman, all)} of ${all} | ${down.length ? median(down).toFixed(1) : '—'} (${down.length}/${n}) | ${(aiDown / n).toFixed(2)} of 3 |`);
    } else {
      const built = rs.flatMap((r) => r.naval!.built);
      const yard = rs.reduce((s, r) => s + r.naval!.yard.filter(Boolean).length, 0);
      const lost = rs.reduce((s, r) => s + r.naval!.lost.reduce((a, b) => a + b, 0), 0);
      const ks = rs.reduce((s, r) => s + r.naval!.killedShips.reduce((a, b) => a + b, 0), 0), ko = rs.reduce((s, r) => s + r.naval!.killedOther.reduce((a, b) => a + b, 0), 0);
      console.log(`| ${k} | ${n} | ${median(built)} | ${yard}/${2 * n} | ${(lost / (2 * n)).toFixed(1)} per side | ${Math.round(ks / (2 * n))} / ${Math.round(ko / (2 * n))} | ${rs.filter((r) => r.timedOut).length} |`);
    }
  }
}
console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s)`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(res.map((r, i) => ({ ...r, tag: tags[i] }))));
