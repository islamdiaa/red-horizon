// Long all-AI matches with simulation invariants and a tick-time budget check (REVIEW round 4).
//   node --import tsx tools/qa/longrun.ts [--minutes 60] [--only <regex>] [--seeds 1] [-v]     (WORKERS=n in parallel)
// Every case is a whole match between AI players (2-4, the game's limit; every level, Classic and Commander, teams, sea maps, curated
// maps). Checked as it runs: the fuzzer's world invariants (NaN, off-map, negative money, tech counts, entity map
// leaks, dead references), units that hold a move / attack / enter order for 3 minutes without getting anywhere or
// firing, harvesters that stop working for 3 minutes while their side has a refinery and ore is left, the step time
// (worst tick and p99 against the 50 ms budget of a 20 Hz tick), and whether the match ends.
import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import type { GameSetup } from '../../src/game';
import { headlessGame } from '../../src/modes/headless';
import type { AIDifficulty } from '../../src/sim/ai';
import { Unit } from '../../src/sim/entities';
import type { World } from '../../src/sim/world';
import type { NetPlayer } from '../../src/net/roster';
import { CURATED_MAPS } from '../../src/maps';
import { invariants } from './fuzz';

const TICK_HZ = 20;
const argOf = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const VERBOSE = process.argv.includes('-v');
const DIFFS: AIDifficulty[] = ['recruit', 'easy', 'normal', 'hard', 'brutal'];
const COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d, 0xe07b2a, 0x8e4fd0, 0x2aa8a8, 0x9aa0aa];
const BASE = { faction: 'allies', color: 0x3d7be0, opponents: [], mapSize: 128, water: 0.4, trees: 0.5, ore: 0.6, credits: 10000, startUnits: 'mcv', fog: true, timeOfDay: 'day', quality: 'low', seed: 1, intro: false } as unknown as GameSetup;

/** An all-AI roster (the multiplayer roster path: any teams, nobody human). */
function allAI(base: Partial<GameSetup>, roster: { team: number; ai: AIDifficulty; faction?: 'allies' | 'soviet' }[]): GameSetup {
  const players: NetPlayer[] = roster.map((r, i) => ({ name: `AI${i}`, faction: r.faction ?? (i % 2 ? 'soviet' : 'allies'), color: COLORS[i], team: r.team, human: false, ai: r.ai, slot: i }));
  // (opponents as net/roster.ts matchSetup fills them: the generated map has a start position per player)
  return { ...BASE, ...base, opponents: players.slice(1).map((p) => ({ faction: p.faction, difficulty: p.ai ?? 'normal' })), net: { room: 'qa', mode: 'ffa', players, local: -1 } } as GameSetup;
}

interface Case { name: string; setup: GameSetup }
export function cases(seed: number): Case[] {
  const out: Case[] = [];
  const lv = (i: number) => DIFFS[(i + seed) % DIFFS.length];
  for (const rules of ['classic', 'commander'] as const) {
    // (2-4 players: the game's limit, src/net/protocol.ts MAX_SLOTS, the skirmish menu, mapgen)
    out.push({ name: `${rules} 4p ffa 128`, setup: allAI({ rules, seed: 1000 + seed, mapSize: 128 }, Array.from({ length: 4 }, (_, i) => ({ team: i, ai: lv(i) }))) });
    out.push({ name: `${rules} 2v2 128`, setup: allAI({ rules, seed: 2000 + seed, mapSize: 128 }, Array.from({ length: 4 }, (_, i) => ({ team: i % 2, ai: lv(i) }))) });
    out.push({ name: `${rules} 2v2 sea 128`, setup: allAI({ rules, seed: 3000 + seed, mapSize: 128, water: 0.9 }, Array.from({ length: 4 }, (_, i) => ({ team: i % 2, ai: lv(i + 2) }))) });
    out.push({ name: `${rules} 1v1 hard-hard 96`, setup: allAI({ rules, seed: 4000 + seed, mapSize: 96 }, [{ team: 0, ai: 'hard' }, { team: 1, ai: 'hard' }]) });
    out.push({ name: `${rules} 4p ffa naval 96`, setup: allAI({ rules, seed: 5000 + seed, mapSize: 96, water: 0.7 }, Array.from({ length: 4 }, (_, i) => ({ team: i, ai: lv(i + 1) }))) });
    out.push({ name: `${rules} 3p ffa 192`, setup: allAI({ rules, seed: 7000 + seed, mapSize: 192 }, Array.from({ length: 3 }, (_, i) => ({ team: i, ai: lv(i + 4) }))) });
    const m = CURATED_MAPS[(seed + (rules === 'classic' ? 0 : 3)) % CURATED_MAPS.length] as { id: string; players?: number };
    const n = Math.max(2, Math.min(4, m.players ?? 2));
    out.push({ name: `${rules} curated ${m.id} ${n}p`, setup: allAI({ rules, seed: 6000 + seed, mapId: m.id } as Partial<GameSetup>, Array.from({ length: n }, (_, i) => ({ team: i, ai: lv(i + 3) }))) });
  }
  return out;
}

interface Track { ax: number; ay: number; since: number; key: string; hp: number }
interface Result { name: string; minutes: number; ended: string; issues: string[]; worstMs: number; worstAt: string; p99: number; meanMs: number; units: number; maxUnits: number; ms: number }

const orderKey = (u: Unit) => { const o = u.order as any; return `${o.type}:${o.target ?? ''}:${Math.round(o.x ?? 0)}:${Math.round(o.y ?? 0)}`; };

export function runCase(c: Case, minutes: number): Result {
  const t0 = performance.now();
  const w: World = headlessGame(c.setup).world;
  const issues = new Map<string, string>();
  const add = (k: string, msg: string) => { const key = k + ':' + msg.replace(/#\d+/g, '#').replace(/-?\d+(\.\d+)?/g, 'N').slice(0, 90); if (!issues.has(key)) issues.set(key, `t=${(w.tick / TICK_HZ / 60).toFixed(1)}m ${msg}`); };
  const stale = new Map<number, number>();
  const track = new Map<number, Track>();
  const harv = new Map<number, { cargo: number; x: number; y: number; since: number }>();
  const times: number[] = [];
  let worst = 0, worstAt = '', maxUnits = 0;
  const end = minutes * 60 * TICK_HZ;
  while (w.tick < end && !w.gameOver) {
    const s = performance.now();
    try { w.step(); } catch (e) { add('exception', String((e as Error)?.stack ?? e).split('\n').slice(0, 5).join(' | ')); break; }
    const dt = performance.now() - s;
    times.push(dt);
    if (dt > worst) { worst = dt; worstAt = `${(w.tick / TICK_HZ / 60).toFixed(1)}m ${w.units.length}u ${w.buildings.length}b ${w.projectiles.length}p`; }
    maxUnits = Math.max(maxUnits, w.units.length);
    w.events.length = 0;
    if (w.mission) w.mission.events.length = 0;
    if (w.tick % 20 === 0) for (const v of invariants(w, stale)) add('invariant', v);
    if (w.tick % 20 !== 0) continue;
    // units that hold an order for 3 minutes without getting anywhere or firing
    const now = w.tick;
    const seen = new Set<number>();
    for (const u of w.units) {
      if (!u.alive || u.transport || u.kind === 'aircraft' || u.ut.harvester) continue;
      const t = u.order.type;
      if (t !== 'move' && t !== 'attack' && t !== 'enter') { track.delete(u.id); continue; }
      seen.add(u.id);
      const key = orderKey(u);
      let tr = track.get(u.id);
      const fired = u.weapons.some((sl) => sl.cooldown > 0);
      // (progress: moving on, firing, or being repaired on a Service Depot pad)
      if (!tr || tr.key !== key || fired || u.hp > tr.hp || Math.hypot(u.x - tr.ax, u.y - tr.ay) > 1.5) { track.set(u.id, { ax: u.x, ay: u.y, since: now, key, hp: u.hp }); continue; }
      if (now - tr.since === 180 * TICK_HZ) {
        const o = u.order as any;
        const tgt = o.target ? w.entities.get(o.target) : null;
        add('stuck', `${u.owner.isHuman ? 'human' : 'ai'} ${u.ut.id} ${t}${tgt ? ' ' + tgt.type.id : ''} at (${u.x.toFixed(1)},${u.y.toFixed(1)}) to (${(o.x ?? tgt?.x ?? 0).toFixed?.(1)},${(o.y ?? tgt?.y ?? 0).toFixed?.(1)}) path=${u.path ? u.path.length : 'none'} pending=${u.pathPending} goal=${u.hasGoal} stuck=${u.stuckCount}`);
      }
    }
    for (const id of [...track.keys()]) if (!seen.has(id)) track.delete(id);
    // harvesters that stop working while there is work
    let oreLeft = false;
    for (let i = 0; i < w.map.ore.length && !oreLeft; i++) if (w.map.ore[i] || w.map.gems[i]) oreLeft = true;
    for (const u of w.units) {
      if (!u.alive || !u.ut.harvester || u.transport) continue;
      const hasRef = w.buildings.some((b) => b.alive && b.owner === u.owner && b.bt.id === 'proc' && b.active);
      let h = harv.get(u.id);
      if (!h || h.cargo !== u.cargo || Math.hypot(u.x - h.x, u.y - h.y) > 1 || !hasRef || !oreLeft) { harv.set(u.id, { cargo: u.cargo, x: u.x, y: u.y, since: now }); continue; }
      if (now - h.since === 180 * TICK_HZ) add('harvester', `${u.owner.name} truck idle 3 min at (${u.x.toFixed(1)},${u.y.toFixed(1)}) cargo=${u.cargo} hstate=${u.hstate} order=${u.order.type} dock=${u.dockAt}`);
    }
  }
  times.sort((a, b) => a - b);
  const p99 = times.length ? times[Math.floor(times.length * 0.99)] : 0;
  const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
  if (worst > 50) add('perf', `worst tick ${worst.toFixed(1)} ms (${worstAt})`);
  const alive = w.players.filter((p) => !p.defeated);
  const ended = w.gameOver ? `won by team ${w.winnerTeam} at ${(w.tick / TICK_HZ / 60).toFixed(1)}m` : `TIMEOUT ${alive.length} alive: ${alive.map((p) => `${p.name}[t${p.team}] ${w.buildings.filter((b) => b.alive && b.owner === p).length}b/${w.units.filter((u) => u.alive && u.owner === p).length}u`).join(' ')}`;
  return { name: c.name, minutes: w.tick / TICK_HZ / 60, ended, issues: [...issues.values()], worstMs: worst, worstAt, p99, meanMs: mean, units: w.units.length, maxUnits, ms: performance.now() - t0 };
}

if (process.argv[1]?.endsWith('longrun.ts')) {
  const minutes = +argOf('minutes', '60');
  const seeds = +argOf('seeds', '1');
  const one = process.argv.indexOf('--one');
  const all: Case[] = [];
  for (let sd = 1; sd <= seeds; sd++) for (const c of cases(sd)) all.push({ ...c, name: `${c.name} s${sd}` });
  if (one > 0) {
    const r = runCase(all[+process.argv[one + 1]], minutes);
    process.send?.(r);
    if (!process.send) console.log(JSON.stringify(r, null, 1));
    process.exit(0);
  }
  const only = argOf('only', '');
  const pick = all.map((c, i) => [c, i] as const).filter(([c]) => !only || new RegExp(only).test(c.name));
  const workers = Math.max(1, Math.min(+(process.env.WORKERS ?? 2), availableParallelism()));
  let next = 0, done = 0, flagged = 0;
  const launch = () => {
    if (next >= pick.length) return;
    const [c, i] = pick[next++];
    const child = fork(process.argv[1], ['--one', String(i), '--minutes', String(minutes), '--seeds', String(seeds)], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let got = false;
    child.on('message', (r: Result) => {
      got = true;
      if (r.issues.length) flagged++;
      console.log(`${r.issues.length ? 'FLAG' : 'ok  '} ${r.name.padEnd(36)} ${r.ended.slice(0, 150)}`);
      console.log(`      ticks: mean ${r.meanMs.toFixed(2)} ms, p99 ${r.p99.toFixed(2)} ms, worst ${r.worstMs.toFixed(1)} ms (${r.worstAt}); max ${r.maxUnits} units; ${(r.ms / 1000).toFixed(0)} s`);
      for (const s of r.issues.slice(0, VERBOSE ? 30 : 8)) console.log('      ', s.slice(0, 300));
    });
    child.on('exit', () => {
      if (!got) { flagged++; console.log(`FLAG ${c.name} (worker crashed)`); }
      if (++done === pick.length) { console.log(`\n${pick.length - flagged}/${pick.length} cases clean`); process.exit(0); }
      launch();
    });
  };
  for (let k = 0; k < workers; k++) launch();
}
