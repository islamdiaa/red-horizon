// King of the Hill against each AI level, played by the human stand-ins (tools/selfplay/standin.ts, used as they are)
// plus the one thing the mode asks of a player: send idle troops to the hill.
//   node --import tsx tools/campaign-koth.ts [--levels recruit,easy,normal,hard,brutal] [--players newcomer,casual] [--seeds 8]
//        [--size 64,96] [--minutes 5] [--rules commander|classic] [--out file.json]
// Prints the human's win share per AI level (by holding the hill or by wiping the enemy out).
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { headlessGame } from '../src/modes/headless';
import { StandIn, type ScriptedLevel } from './selfplay/standin';
import type { AIDifficulty } from '../src/sim/ai';
import { TICK_HZ } from '../src/sim/types';
import type { KothState } from '../src/modes/types';
import { kothStandings } from '../src/modes/koth';

export interface KothJob { kind: 'koth'; level: AIDifficulty; player: ScriptedLevel; seed: number; size: number; minutes: number; rules: 'commander' | 'classic' }
export interface KothRun extends KothJob { won: boolean; ended: boolean; time: number; byHill: boolean; held: number; theirs: number; error?: string }

export function runKoth(j: KothJob): KothRun {
  const g = headlessGame({
    faction: j.seed % 2 ? 'soviet' : 'allies', color: 0x3d7be0, opponents: [{ faction: j.seed % 2 ? 'allies' : 'soviet', difficulty: j.level }],
    mapSize: j.size, water: 0.3, trees: 0.5, ore: 0.6, credits: 5000, startUnits: 'mcv', fog: true, timeOfDay: 'day', quality: 'low',
    seed: 1000 + j.seed, koth: true, kothMinutes: j.minutes, rules: j.rules,
  });
  const w = g.world;
  const me = w.players[0];
  const si = new StandIn(w, me, j.player, 1000 + j.seed);
  const rt = w.mission!;
  let error: string | undefined;
  let nextHill = 60 * TICK_HZ;
  try {
    for (let t = 0; t < 45 * 60 * TICK_HZ && !w.gameOver; t++) {
      si.tick();
      // the hill: every 15 s (the newcomer every 30 s), idle troops are sent to it
      if (w.tick >= nextHill) {
        nextHill = w.tick + (j.player === 'casual' ? 15 : 30) * TICK_HZ;
        const st = rt.flags.koth as KothState | undefined;
        const idle = w.units.filter((u) => u.alive && u.owner === me && u.weapons.length && !u.ut.harvester && !u.ut.deploysInto && u.kind !== 'aircraft' && u.kind !== 'naval' && u.order.type === 'idle' && !u.target);
        if (st && idle.length >= (j.player === 'casual' ? 3 : 2)) w.issue({ c: 'move', player: me.id, units: idle.map((u) => u.id), x: st.x, y: st.y, attackMove: true });
      }
      w.step();
      w.events.length = 0;
      rt.events.length = 0;
    }
  } catch (e) {
    error = (e as Error).stack ?? String(e);
  }
  const st = rt.flags.koth as KothState | undefined;
  const stand = st ? kothStandings(w, st) : [];
  const mine = stand.find((x) => x.team === me.team), theirs = stand.find((x) => x.team !== me.team);
  const won = w.gameOver && w.winnerTeam === me.team;
  return { ...j, won, ended: w.gameOver, time: w.time, byHill: won && (mine?.frac ?? 0) >= 1, held: mine?.seconds ?? 0, theirs: theirs?.seconds ?? 0, error };
}

if (process.argv[1]?.endsWith('campaign-koth.ts')) {
  const { runAll } = await import('./campaign-levels');
  const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const levels = arg('levels', 'recruit,easy,normal,hard,brutal').split(',') as AIDifficulty[];
  const players = arg('players', 'newcomer,casual').split(',') as ScriptedLevel[];
  const seeds = +arg('seeds', '8');
  const sizes = arg('size', '64,96').split(',').map(Number);
  const minutes = +arg('minutes', '5');
  const rules = arg('rules', 'commander') as 'commander' | 'classic';
  const jobs: KothJob[] = [];
  for (const level of levels) for (const player of players) for (const size of sizes) for (let seed = 0; seed < seeds; seed++) jobs.push({ kind: 'koth', level, player, seed, size, minutes, rules });
  const workers = +(process.env.WORKERS ?? 0) || Math.max(1, Math.min(6, availableParallelism() - 4));
  console.error(`${jobs.length} KOTH games on ${workers} workers`);
  const runs = (await runAll(jobs as never[], workers, (done) => { if (done % 20 === 0) console.error(`  ${done}/${jobs.length}`); })) as unknown as KothRun[];
  const out = arg('out', '');
  if (out) writeFileSync(out, JSON.stringify(runs));
  console.log(`| AI level | ${players.join(' | ')} |\n|---|${players.map(() => '---').join('|')}|`);
  for (const level of levels) {
    console.log(`| ${level} | ${players.map((p) => {
      const rs = runs.filter((r) => r.level === level && r.player === p);
      const w = rs.filter((r) => r.won).length, hill = rs.filter((r) => r.byHill).length;
      const med = rs.map((r) => r.time).sort((a, b) => a - b)[rs.length >> 1] ?? 0;
      return `${w}/${rs.length} won (${hill} on the hill), median ${Math.floor(med / 60)} min`;
    }).join(' | ')} |`);
  }
  for (const r of runs) if (r.error) console.error('ERROR', r.level, r.player, r.seed, r.error.split('\n')[0]);
}
