/**
 * Difficulty curve: how hard each AI level hits, how soon, and whether any mutator turns into a sure win.
 *
 *   node --import tsx tools/selfplay/difficulty.ts [--games 8] [--size 96] [--only passive,ceasefire,novice,mutators] [--rules classic,commander]
 *
 *  - passive:   one AI against a passive player (deployed yard, starting squad, never gives an order): the AI's first
 *               wave (time and value), first contact, first structure lost and when the passive player is wiped out;
 *  - ceasefire: the same after a 10-minute build-up time (the grand first wave: its value and when it lands);
 *  - novice:    each level against a stand-in for a new player (the frozen legacy AI on easy, which builds and attacks
 *               in the plain classic way): win share of the level (timeouts go to the material leader);
 *  - mutators:  economy-first (tycoon) against a rusher with and without Golden Ore and the other economy / speed
 *               mutators: none of them may turn one plan into a sure win.
 *
 * Seeds alternate the factions and start positions. Workers: WORKERS env.
 */
import { TICK_HZ } from '../../src/sim/types';
import type { AIDifficulty } from '../../src/sim/ai';
import { buildMatch, type MatchResult, type MatchSpec, type PlayerSpec } from './lib';
import { runPool } from './pool';
import type { Faction } from '../../src/data/rules';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const games = +opt('games', '8');
const size = +opt('size', '96');
const only = opt('only', 'passive,ceasefire,novice,mutators').split(',');
const rulesSets = opt('rules', 'classic,commander').split(',');
const DIFFS: AIDifficulty[] = ['easy', 'normal', 'hard', 'brutal'];
const fmt = (s: number) => (s < 0 ? '  —  ' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : -1);
const med = (xs: number[]) => (xs.length ? xs.slice().sort((a, b) => a - b)[xs.length >> 1] : -1);

/** One AI against a passive player (slot 0: never acts, its MCV deployed at once). */
function passiveGame(seed: number, diff: AIDifficulty, commander: boolean, ceasefire: number, maxMin = 40) {
  const fac: Faction = seed % 2 ? 'soviet' : 'allies';
  const ai: PlayerSpec = { faction: fac === 'allies' ? 'soviet' : 'allies', difficulty: diff };
  const spec: MatchSpec = { id: 0, seed, map: 'land', size, players: [{ faction: fac, difficulty: 'easy' }, ai], maxMinutes: maxMin, commander: commander ? {} : undefined, ceasefire };
  const w = buildMatch(spec);
  const h = w.players[0];
  // the passive player: no AI controller, its MCV deployed where it stands
  w.ais = w.ais.filter((a) => a.player !== h);
  h.isHuman = true;
  const mcv = w.units.find((u) => u.owner === h && u.ut.deploysInto);
  if (mcv) w.issue({ c: 'deploy', player: 0, units: [mcv.id] });
  const aiCtl = w.ais[0] as unknown as { waves: number; waveValueStart: number; chatter: { tick: number; kind: string }[] };
  let firstWave = -1, waveValue = 0, contact = -1, structLost = -1;
  for (let t = 0; t < maxMin * 60 * TICK_HZ; t++) {
    w.step();
    for (const ev of w.events) {
      if (ev.e === 'announce' && ev.player === 0 && (ev.key === 'base_under_attack' || ev.key === 'unit_lost') && contact < 0) contact = w.time;
      if (ev.e === 'announce' && ev.player === 0 && ev.key === 'structure_lost' && structLost < 0) structLost = w.time;
    }
    w.events.length = 0;
    if (firstWave < 0 && aiCtl.waves > 0) { firstWave = w.time; waveValue = aiCtl.waveValueStart; }
    if (h.defeated) break;
  }
  return { firstWave, waveValue, contact, structLost, dead: h.defeated ? w.time : -1 };
}

async function main() {
  const t0 = Date.now();
  if (only.includes('passive') || only.includes('ceasefire')) {
    for (const rules of rulesSets) {
      const cmd = rules === 'commander';
      for (const cf of [only.includes('passive') ? 0 : -2, only.includes('ceasefire') ? 10 : -2].filter((x) => x >= 0)) {
        console.log(`\n== ${cf ? `after a ${cf}-minute build-up time` : 'no build-up time'}: one AI vs a passive player (${rules} rules, ${size}x${size}, ${games} seeds; medians)`);
        console.log('| level | first wave | its value | first contact | first structure lost | passive player wiped out |');
        console.log('|---|---|---|---|---|---|');
        for (const d of DIFFS) {
          const rs = Array.from({ length: games }, (_, k) => passiveGame(1 + k * 101, d, cmd, cf));
          const dead = rs.filter((r) => r.dead >= 0).map((r) => r.dead);
          console.log(`| ${d} | ${fmt(med(rs.map((r) => r.firstWave).filter((x) => x >= 0)))} | $${Math.round(med(rs.map((r) => r.waveValue)))} | ${fmt(med(rs.map((r) => r.contact).filter((x) => x >= 0)))} | ${fmt(med(rs.map((r) => r.structLost).filter((x) => x >= 0)))} | ${fmt(med(dead))} (${dead.length}/${rs.length}) |`);
        }
      }
    }
  }
  if (only.includes('novice')) {
    const specs: MatchSpec[] = [];
    const tag: string[] = [];
    let id = 0;
    for (const rules of rulesSets) for (const d of DIFFS) for (let g = 0; g < games * 2; g++) {
      const f: Faction = g % 2 ? 'soviet' : 'allies';
      const lvl: PlayerSpec = { faction: f, difficulty: d, label: 'level' };
      const nov: PlayerSpec = { faction: f === 'allies' ? 'soviet' : 'allies', difficulty: 'easy', legacy: true, label: 'novice' };
      // (the legacy AI plays Classic logic: under Commander rules it gets the rules but no powers, and no battlefield events)
      specs.push({ id: id++, seed: 500 + g * 37 + DIFFS.indexOf(d), map: 'land', size, players: g % 4 < 2 ? [lvl, nov] : [nov, lvl], maxMinutes: 40, commander: rules === 'commander' ? { noPowers: [g % 4 < 2 ? 1 : 0] } : undefined, events: rules === 'commander' ? false : undefined });
      tag.push(`${rules}|${d}`);
    }
    const res: MatchResult[] = await runPool(specs, { workers: +(process.env.WORKERS ?? 8) });
    console.log(`\n== each level vs a new-player stand-in (the legacy AI on easy), ${size}x${size}, ${games * 2} games per cell`);
    console.log('| rules | level | level wins | timeouts | mean length |');
    console.log('|---|---|---|---|---|');
    const cells = new Map<string, MatchResult[]>();
    res.forEach((r, i) => cells.set(tag[i], [...(cells.get(tag[i]) ?? []), r]));
    for (const [k, rs] of cells) {
      const [rules, d] = k.split('|');
      let w = 0;
      for (const r of rs) { const i = r.players.findIndex((p) => p.label === 'level'); if (r.leader === i) w++; }
      console.log(`| ${rules} | ${d} | ${Math.round((100 * w) / rs.length)}% (${w}/${rs.length}) | ${rs.filter((r) => r.timedOut).length} | ${avg(rs.map((r) => r.minutes)).toFixed(1)} min |`);
    }
  }
  if (only.includes('mutators')) {
    const specs: MatchSpec[] = [];
    const tag: string[] = [];
    let id = 0;
    const muts = ['', 'golden-ore', 'lightning-war', 'mega-crates', 'tank-rush', 'golden-ore,lightning-war'];
    for (const m of muts) for (let g = 0; g < games * 2; g++) {
      const f: Faction = g % 2 ? 'soviet' : 'allies';
      const eco: PlayerSpec = { faction: f, difficulty: 'hard', personality: 'tycoon', label: 'eco' };
      const rush: PlayerSpec = { faction: f === 'allies' ? 'soviet' : 'allies', difficulty: 'hard', personality: 'rusher', label: 'rush' };
      specs.push({ id: id++, seed: 900 + g * 53, map: 'land', size, players: g % 4 < 2 ? [eco, rush] : [rush, eco], maxMinutes: 40, commander: {}, mutators: m ? m.split(',') : undefined });
      tag.push(m || 'none');
    }
    const res: MatchResult[] = await runPool(specs, { workers: +(process.env.WORKERS ?? 8) });
    console.log(`\n== mutators: economy-first (tycoon) vs rusher, hard, Commander rules, ${games * 2} games each`);
    console.log('| mutators | eco wins | mean length | timeouts |');
    console.log('|---|---|---|---|');
    const cells = new Map<string, MatchResult[]>();
    res.forEach((r, i) => cells.set(tag[i], [...(cells.get(tag[i]) ?? []), r]));
    for (const [k, rs] of cells) {
      let w = 0;
      for (const r of rs) { const i = r.players.findIndex((p) => p.label === 'eco'); if (r.leader === i) w++; }
      console.log(`| ${k} | ${Math.round((100 * w) / rs.length)}% (${w}/${rs.length}) | ${avg(rs.map((r) => r.minutes)).toFixed(1)} min | ${rs.filter((r) => r.timedOut).length} |`);
    }
  }
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

void main();
