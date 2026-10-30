// World Conquest QA: the RTS battles of a world run, played headless by the human-like pilots (tools/campaign-players.ts
// newcomer / casual, no head start) and the strike-force autopilot ('auto', tools/conquest-harness.ts), region by
// region and climate by climate, to compare with the old (Europe) Conquest curve (tools/campaign-conquest.ts).
//
// Each job builds a World run, gives the human a territory next to the target region (attackers) and the target to a
// rival (defenders), commits to fighting it (startBattle: the region battlefield, the battle kind the run picks:
// assault / capture / hold for a landmark / naval across a sea lane / boss for a capital), and plays the battle.
//
//   node --import tsx tools/world/qa-battles.ts [--per-climate 6] [--diffs recruit,easy,normal,hard] [--pilots newcomer,casual,auto]
//        [--seeds 2] [--minutes 30] [--troops 6v4] [--out file]        (WORKERS=n, default 6)
import { QA_OUT } from './qa-pool'; // (results default to screenshots/world-qa/ in the repo: git-ignored)
import { Rng } from '../../src/core/rng';

export interface BattleJob { region: string; climate: string; difficulty: string; pilot: 'newcomer' | 'casual' | 'auto'; seed: number; attackers: number; defenders: number; minutes: number; kind?: string }
export interface BattleRun extends BattleJob { kind: string; won: boolean; ended: boolean; time: number; reason: string | null; strength: number; ai: string; mapSize: number; landmark: string | null; blocked?: string; error?: string; ms: number }

/** One world battle, set up and played (the worker entry point). */
export async function battleOne(j: BattleJob): Promise<BattleRun> {
  const t0 = performance.now();
  const W = await import('../../src/conquest/world/index'); // (the barrel registers the real geography)
  const { runConquestBattle } = await import('../conquest-harness');
  const out: BattleRun = { ...j, kind: '', won: false, ended: false, time: 0, reason: null, strength: 0, ai: '', mapSize: 0, landmark: null, ms: 0 };
  try {
    const homes = W.atlas().homelands;
    const run = W.newWorldRun({ seed: j.seed, home: homes[j.seed % homes.length].id, size: 'world', difficulty: j.difficulty as never });
    const T = run.territories;
    const ti = T.findIndex((t) => t.id === j.region);
    if (ti < 0) { out.blocked = 'region not in this run'; return out; }
    const X = W.ix(run);
    // the neighbour to attack from: a land border if there is one (a sea lane makes it a naval battle)
    const nbs = X.adj[ti].map((n, k) => ({ n, sea: X.sea[ti][k] }));
    const want = j.kind === 'naval';
    const pick = nbs.find((x) => x.sea === want && T[x.n].capital === undefined) ?? nbs.find((x) => T[x.n].capital === undefined) ?? nbs[0];
    if (!pick) { out.blocked = 'no neighbour'; return out; }
    const from = T[pick.n], to = T[ti];
    const rival = run.powers.find((p) => p.id !== 0 && p.alive)!;
    // hand the territories over (troops as asked), keep every power alive
    from.owner = 0; from.troops = j.attackers + 1;
    to.owner = to.capital !== undefined ? to.capital : rival.id; to.troops = j.defenders;
    if (pick.sea && !from.port && !to.port) from.port = true;
    for (const p of run.powers) if (!T.some((t) => t.owner === p.id)) { const spare = T.find((t) => t.owner === -1); if (spare) { spare.owner = p.id; p.alive = true; } }
    run.turn = Math.max(2, run.turn); run.current = 0; run.phase = 'attack'; run.toPlace = 0; run.pending = null; run.defence = null; // (turn 1 is the opening month: no attacks on powers) run.conquest = null;
    const block = W.attackBlock(run, from.id, to.id, 0);
    if (block) { out.blocked = `attackBlock ${block}`; return out; }
    const setup = W.startBattle(run, from.id, to.id);
    if (!setup) { out.blocked = 'startBattle gave nothing'; return out; }
    const S = setup.battle;
    out.kind = S.kind; out.strength = S.strength; out.ai = S.ai; out.landmark = to.landmark ?? null;
    out.mapSize = (S.map as { size: number }).size;
    const r = runConquestBattle(setup, j.minutes, j.pilot);
    out.won = r.won; out.ended = r.ended; out.time = Math.round(r.time); out.reason = r.reason; if (r.error) out.error = r.error.split('\n').slice(0, 3).join(' | ');
  } catch (e) {
    out.error = e instanceof Error ? `${e.message} | ${(e.stack ?? '').split('\n').slice(1, 4).join(' | ')}` : String(e);
  }
  out.ms = Math.round(performance.now() - t0);
  return out;
}

/** 95% Wilson interval of k wins in n. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
export const fmtRate = (k: number, n: number) => { const [a, b] = wilson(k, n); return n ? `${k}/${n} (${Math.round(100 * k / n)}%, ${Math.round(100 * a)}-${Math.round(100 * b)})` : '-'; };

if (process.argv[1]?.endsWith('qa-battles.ts')) {
  const fs = await import('node:fs');
  const { runPool } = await import('./qa-pool');
  const { sweepRegions } = await import('./qa-battlefields');
  const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const per = +arg('per-climate', '6'), seeds = +arg('seeds', '2'), minutes = +arg('minutes', '30');
  const diffs = arg('diffs', 'recruit,easy,normal,hard').split(',');
  const pilots = arg('pilots', 'newcomer,casual,auto').split(',') as BattleJob['pilot'][];
  const [att, def] = arg('troops', '6v4').split('v').map(Number);
  const kindArg = arg('kind', '');
  const { regions } = await sweepRegions();
  const rng = new Rng(+arg('seed', '42'));
  const byClimate = new Map<string, string[]>();
  const only = arg('only', ''); // 'landmarks': regions with a landmark; or a comma list of region ids
  for (const r of regions) {
    if (only === 'landmarks' && !r.landmark) continue;
    if (only && only !== 'landmarks' && !only.split(',').includes(r.id)) continue;
    (byClimate.get(r.climate) ?? byClimate.set(r.climate, []).get(r.climate)!).push(r.id);
  }
  const jobs: BattleJob[] = [];
  for (const [climate, ids] of [...byClimate].sort()) {
    const pickIds = rng.shuffle([...ids]).slice(0, per);
    for (const region of pickIds) for (const difficulty of diffs) for (const pilot of pilots) for (let s = 0; s < seeds; s++) {
      jobs.push({ region, climate, difficulty, pilot, seed: 11 + s * 101 + jobs.length, attackers: att, defenders: def, minutes, ...(kindArg ? { kind: kindArg } : {}) });
    }
  }
  console.log(`${jobs.length} battles: ${[...byClimate.keys()].join('/')} x ${per} regions x ${diffs.join('/')} x ${pilots.join('/')} x ${seeds} seeds, ${att} v ${def} troops`);
  const t0 = Date.now();
  const outs = await runPool<BattleJob, BattleRun>('./qa-battles.ts', 'battleOne', jobs, { progress: (d, n, o) => { if (!o.ok) console.log(`ERR ${o.error.split('\n')[0]}`); else if (o.value.error) console.log(`ERR ${o.value.region} ${o.value.pilot}: ${o.value.error.slice(0, 200)}`); if (d % 20 === 0 || d === n) console.log(`${d}/${n} ${Math.round((Date.now() - t0) / 1000)} s`); } });
  const rs = outs.map((o) => (o.ok ? o.value : null)).filter(Boolean) as BattleRun[];
  const out = arg('out', `${QA_OUT}battles`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(`${out}/battles.json`, JSON.stringify(rs));
  const played = rs.filter((r) => !r.blocked && !r.error);
  const L = [`# World battles: ${played.length} played of ${rs.length} (${rs.filter((r) => r.blocked).length} not set up, ${rs.filter((r) => r.error).length} errors), ${att} v ${def} troops, ${minutes} min cap, ${Math.round((Date.now() - t0) / 60000)} min`, ''];
  const table = (rows: string[], key: (r: BattleRun) => string) => {
    L.push(`| ${rows[0]} | ${pilots.join(' | ')} |`, `|---|${pilots.map(() => '---').join('|')}|`);
    for (const k of [...new Set(played.map(key))].sort()) L.push(`| ${k} | ${pilots.map((p) => { const g = played.filter((r) => key(r) === k && r.pilot === p); return fmtRate(g.filter((r) => r.won).length, g.length); }).join(' | ')} |`);
    L.push('');
  };
  table(['difficulty'], (r) => r.difficulty);
  table(['difficulty / climate'], (r) => `${r.difficulty} ${r.climate}`);
  table(['difficulty / kind'], (r) => `${r.difficulty} ${r.kind}`);
  L.push('| region | climate | kind | results (pilot difficulty: won/time) |', '|---|---|---|---|');
  for (const reg of [...new Set(played.map((r) => r.region))].sort()) {
    const g = played.filter((r) => r.region === reg);
    L.push(`| ${reg} | ${g[0].climate} | ${[...new Set(g.map((r) => r.kind))].join(',')}${g[0].landmark ? ` (${g[0].landmark})` : ''} | ${g.map((r) => `${r.pilot[0]}${r.difficulty[0]}:${r.won ? 'W' : r.ended ? 'L' : 'T'}${Math.round(r.time / 60)}`).join(' ')} |`);
  }
  for (const r of rs.filter((r) => r.blocked || r.error).slice(0, 20)) L.push(`- ${r.region} ${r.difficulty} ${r.pilot}: ${r.blocked ?? r.error}`);
  fs.writeFileSync(`${out}/battles.md`, L.join('\n') + '\n');
  console.log(L.slice(0, 40).join('\n'));
}
