/**
 * Commander economy sanity check (src/sim/economy.ts): AI-vs-AI matches under Commander rules.
 *
 *   node --import tsx tools/selfplay/economy.ts [--games 12] [--minutes 40] [--size 96] [--diff hard] [--only usage,ablation,greed,pace]
 *
 *   usage     which tiers, upgrades, research and structures each personality reaches (both factions)
 *   ablation  an AI using the economy against the same AI ignoring it (tuning econOn=0): the systems should help,
 *             not decide the match on their own
 *   greed     an economy-only commander (max economy and tech, minimal aggression) against a rusher and a
 *             balanced commander: greed must not be a sure win
 *   pace      the same matches with the economy on and off: games must still end, at a similar length
 *
 * Seeds alternate which slot each faction takes. Workers: WORKERS env (keep it low on a busy machine).
 */
import { runPool } from './pool';
import type { MatchResult, MatchSpec, PlayerSpec } from './lib';
import type { AIDifficulty } from '../../src/sim/ai';
import { resolvePersonality, type Personality } from '../../src/sim/ai-personality';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const games = +opt('games', '12');
const minutes = +opt('minutes', '40');
const size = +opt('size', '96');
const diff = opt('diff', 'hard') as AIDifficulty;
const only = opt('only', 'usage,ablation,greed,pace').split(',');

const noEcon = (id: string): Personality => ({ ...resolvePersonality(id), tuning: { econOn: 0 }, id });
const greedy: Personality = { ...resolvePersonality('tycoon'), id: 'greedy', name: 'Greedy', economy: 1, tech: 1, aggression: 0.05, harass: 0.1, defence: 0.6 };

let nextId = 0;
function spec(seed: number, a: string | Personality, b: string | Personality, econ = true, label: [string, string] = ['', '']): MatchSpec {
  const fa = seed % 2 ? 'soviet' : 'allies', fb = fa === 'allies' ? 'soviet' : 'allies';
  const pl: PlayerSpec[] = [
    { faction: fa, difficulty: diff, personality: a, label: label[0] || (typeof a === 'string' ? a : a.id) },
    { faction: fb, difficulty: diff, personality: b, label: label[1] || (typeof b === 'string' ? b : b.id) },
  ];
  return { id: nextId++, seed, map: 'land', size, players: pl, maxMinutes: minutes, credits: 10000, startUnits: 'mcv', commander: { econ } } as MatchSpec;
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Win share of the player labelled `who` across results (timeouts count for the material leader). */
function share(rs: MatchResult[], who: string) {
  let w = 0, n = 0, to = 0;
  for (const r of rs) {
    const i = r.players.findIndex((p) => p.label === who);
    if (i < 0) continue;
    n++;
    if (r.timedOut) to++;
    if ((r.winnerTeam >= 0 ? r.winnerTeam : r.leader) === i) w++;
  }
  return { w, n, to };
}

async function main() {
  const t0 = Date.now();
  const specs: MatchSpec[] = [];
  const groups: Record<string, number[]> = {};
  const add = (g: string, s: MatchSpec) => { (groups[g] ??= []).push(specs.length); specs.push(s); };
  for (let k = 0; k < games; k++) {
    const seed = 1000 + k;
    if (only.includes('usage')) {
      const pairs: [string, string][] = [['balanced', 'balanced'], ['tycoon', 'rusher'], ['turtle', 'ironfist'], ['horde', 'siege']];
      add('usage', spec(seed, ...pairs[k % pairs.length]));
    }
    if (only.includes('ablation')) add('ablation', spec(seed, 'balanced', noEcon('balanced'), true, ['econ', 'no-econ']));
    if (only.includes('greed')) add('greed', spec(seed, greedy, k % 2 ? 'rusher' : 'balanced', true, ['greedy', k % 2 ? 'rusher' : 'balanced']));
    if (only.includes('pace')) { add('pace-on', spec(seed, 'balanced', 'balanced', true)); add('pace-off', spec(seed, 'balanced', 'balanced', false)); }
  }
  let done = 0;
  const res = await runPool(specs, { workers: +(process.env.WORKERS ?? 3), progress: () => { if (++done % 10 === 0) process.stderr.write(`${done}/${specs.length}\n`); } });
  const pick = (g: string) => (groups[g] ?? []).map((i) => res[i]);

  if (groups.usage) {
    console.log('\n== usage: what each commander does with the economy (hard, Commander rules)');
    const by = new Map<string, MatchResult['players']>();
    for (const r of pick('usage')) for (const p of r.players) by.set(`${p.label}/${p.faction}`, [...(by.get(`${p.label}/${p.faction}`) ?? []), p]);
    for (const [k, ps] of [...by.entries()].sort()) {
      const e = ps.map((p) => p.econ).filter(Boolean) as NonNullable<MatchResult['players'][0]['econ']>[];
      const ups: Record<string, number> = {}, lv: Record<string, number> = {};
      for (const x of e) { for (const [u, n] of Object.entries(x.upgrades)) ups[u] = (ups[u] ?? 0) + n; for (const r of Object.keys(x.levels)) lv[r] = (lv[r] ?? 0) + 1; }
      const st: Record<string, number> = {};
      for (const p of ps) for (const id of ['rlab', 'lgst', 'purf', 'smlt', 'mout', 'bnkr', 'gate']) if (p.structures[id]) st[id] = (st[id] ?? 0) + p.structures[id];
      const t2 = e.map((x) => x.t2).filter((x) => x >= 0), t3 = e.map((x) => x.t3).filter((x) => x >= 0);
      console.log(`${k.padEnd(18)} n=${ps.length} T2 ${pct(t2.length, ps.length)} @${avg(t2).toFixed(1)}m · T3 ${pct(t3.length, ps.length)} @${avg(t3).toFixed(1)}m · wins ${pct(ps.filter((p) => p.won).length, ps.length)}`);
      console.log(`${''.padEnd(18)} upgrades ${JSON.stringify(ups)}`);
      console.log(`${''.padEnd(18)} research ${JSON.stringify(lv)} · structures ${JSON.stringify(st)} · garrisoned at end ${e.reduce((s, x) => s + x.garrisoned, 0)}`);
    }
  }
  const report = (title: string, g: string, who: string) => {
    const rs = pick(g);
    if (!rs.length) return;
    const s = share(rs, who);
    console.log(`\n== ${title}\n${who} wins ${s.w}/${s.n} (${pct(s.w, s.n)}), timeouts ${s.to}, average length ${avg(rs.map((r) => r.minutes)).toFixed(1)} min`);
  };
  report('ablation: AI using the economy vs the same AI ignoring it', 'ablation', 'econ');
  if (groups.greed) {
    const rs = pick('greed');
    const s = share(rs, 'greedy');
    console.log(`\n== greed: economy-only commander vs rusher / balanced\ngreedy wins ${s.w}/${s.n} (${pct(s.w, s.n)}), timeouts ${s.to}, average length ${avg(rs.map((r) => r.minutes)).toFixed(1)} min`);
    for (const opp of ['rusher', 'balanced']) {
      const sub = rs.filter((r) => r.players.some((p) => p.label === opp));
      const t = share(sub, 'greedy');
      console.log(`  vs ${opp}: ${t.w}/${t.n}`);
    }
  }
  if (groups['pace-on']) {
    for (const g of ['pace-on', 'pace-off']) {
      const rs = pick(g);
      console.log(`\n== pace, economy ${g === 'pace-on' ? 'ON' : 'OFF'}: ${rs.length} games, timeouts ${rs.filter((r) => r.timedOut).length}, length ${avg(rs.map((r) => r.minutes)).toFixed(1)} min (median ${rs.map((r) => r.minutes).sort((a, b) => a - b)[rs.length >> 1]?.toFixed(1)}), harvested ${Math.round(avg(rs.flatMap((r) => r.players.map((p) => p.harvested))))} per player, Allied wins ${pct(rs.filter((r) => r.winnerTeam >= 0 && r.players[r.winnerTeam].faction === 'allies').length, rs.filter((r) => r.winnerTeam >= 0).length)}`);
    }
  }
  console.log(`\n${specs.length} matches in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

void main();
