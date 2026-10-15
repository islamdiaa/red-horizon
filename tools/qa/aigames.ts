// QA: batch of headless AI-vs-AI games with anomaly detection.
// node --import tsx tools/qa/aigames.ts [maxMinutes=60] [filter]
import { generateMap } from '../../src/sim/mapgen';
import { World } from '../../src/sim/world';
import { TICK_HZ } from '../../src/sim/types';
import type { AIDifficulty } from '../../src/sim/ai';
import { invariants, fmtTime } from './lib';

const MAX_MIN = +(process.argv[2] ?? 60);
const FILTER = process.argv[3] ?? '';

interface GameSpec { seed: number; size: number; players: number; diffs: AIDifficulty[]; factions?: ('allies' | 'soviet')[] }
const SPECS: GameSpec[] = [
  { seed: 1, size: 64, players: 2, diffs: ['normal', 'normal'] },
  { seed: 2, size: 96, players: 2, diffs: ['normal', 'normal'] },
  { seed: 3, size: 128, players: 2, diffs: ['normal', 'normal'] },
  { seed: 4, size: 96, players: 2, diffs: ['hard', 'easy'] },
  { seed: 5, size: 96, players: 2, diffs: ['brutal', 'normal'] },
  { seed: 6, size: 64, players: 2, diffs: ['easy', 'easy'] },
  { seed: 7, size: 96, players: 3, diffs: ['normal', 'normal', 'normal'] },
  { seed: 8, size: 128, players: 4, diffs: ['normal', 'hard', 'easy', 'normal'] },
  { seed: 9, size: 96, players: 4, diffs: ['hard', 'hard', 'hard', 'hard'] },
  { seed: 10, size: 64, players: 2, diffs: ['brutal', 'brutal'] },
  { seed: 11, size: 96, players: 2, diffs: ['normal', 'normal'], factions: ['allies', 'allies'] },
  { seed: 12, size: 96, players: 2, diffs: ['normal', 'normal'], factions: ['soviet', 'soviet'] },
  { seed: 13, size: 128, players: 2, diffs: ['hard', 'hard'] },
  { seed: 14, size: 64, players: 3, diffs: ['easy', 'normal', 'hard'] },
  { seed: 777, size: 96, players: 2, diffs: ['brutal', 'easy'] },
  { seed: 4242, size: 96, players: 2, diffs: ['soviet' as any, 'x' as any].map(() => 'normal') as AIDifficulty[], factions: ['soviet', 'allies'] },
];

interface PStats {
  fact: number; proc: number; weap: number; firstTank: number; firstWave: number; waves: number; firstHit: number; defeatedAt: number;
  placeCancels: number; maxCredits: number; idleProdSec: number; richIdleSec: number;
}

function runGame(spec: GameSpec) {
  const map = generateMap({ size: spec.size, players: spec.players, seed: spec.seed, water: 0.5, trees: 0.5, ore: 0.6 });
  const factions = spec.factions ?? (['allies', 'soviet', 'allies', 'soviet'] as const).slice(0, spec.players);
  const w = new World({
    map, credits: 10000, startUnits: 'mcv', fog: true, seed: spec.seed,
    players: Array.from({ length: spec.players }, (_, i) => ({ name: `P${i}`, faction: factions[i], color: 0xffffff, team: i, isHuman: false, ai: spec.diffs[i] })),
  });
  const ps: PStats[] = w.players.map(() => ({ fact: -1, proc: -1, weap: -1, firstTank: -1, firstWave: -1, waves: 0, firstHit: -1, defeatedAt: -1, placeCancels: 0, maxCredits: 0, idleProdSec: 0, richIdleSec: 0 }));
  const anomalies: string[] = [];
  const invSeen = new Map<string, number>();
  const orig = w.issue.bind(w);
  const cmdCount: Record<string, number>[] = w.players.map(() => ({}));
  w.issue = (cmd: any) => {
    const p0 = w.players[cmd.player];
    let tag: string = cmd.c;
    if (cmd.c === 'attack') {
      const e0 = w.entities.get(cmd.units?.[0]) as any;
      if (e0?.kind === 'aircraft') tag = 'airstrike';
    }
    if (cmd.c === 'superweapon') tag = 'sw:' + cmd.kind;
    cmdCount[cmd.player][tag] = (cmdCount[cmd.player][tag] ?? 0) + 1;
    void p0;
    if (cmd.c === 'cancel') {
      const p = w.players[cmd.player];
      if (p.queues.structure.ready === cmd.type) {
        ps[cmd.player].placeCancels++;
        if (ps[cmd.player].placeCancels <= 3) anomalies.push(`${fmtTime(w.time)} P${cmd.player} could not place ${cmd.type} (cancelled)`);
      }
    }
    orig(cmd);
  };
  // harvester / mover stuck tracking
  const lastPos = new Map<number, { x: number; y: number; t: number; o: string }>();
  const stuckReported = new Set<number>();
  const ais = w.ais as any[];
  // QA_FIXAI=1 simulates the proposed fix: every AI thinks on ticks that are multiples of 10
  // (so its internal `w.tick % (TICK_HZ*N) === 0` gates can fire), instead of staggered ticks.
  const fixAi = process.env.QA_FIXAI === '1';
  if (fixAi) (w as any).ais = [];
  let lastState = ais.map((a) => a.state);
  const maxTicks = MAX_MIN * 60 * TICK_HZ;
  for (let t = 1; t <= maxTicks; t++) {
    w.step();
    if (fixAi && w.tick % 10 === 0) for (const a of ais) a.think();
    for (const ev of w.events) {
      if (ev.e === 'eliminated') ps[ev.player].defeatedAt = w.time;
    }
    w.events.length = 0;
    if (t % TICK_HZ === 0) {
      for (const p of w.players) {
        const s = ps[p.id];
        if (s.fact < 0 && p.has('fact')) s.fact = w.time;
        if (s.proc < 0 && p.has('proc')) s.proc = w.time;
        if (s.weap < 0 && p.has('weap')) s.weap = w.time;
        if (s.firstTank < 0 && w.units.some((u) => u.alive && u.owner === p && u.kind === 'vehicle' && u.weapons.length && !u.ut.harvester)) s.firstTank = w.time;
        s.maxCredits = Math.max(s.maxCredits, p.credits);
        if (!p.defeated && p.has('fact')) {
          const busy = Object.values(p.queues).some((q) => q.items.length || q.ready);
          if (!busy) s.idleProdSec++;
          if (!busy && p.credits > 3000) s.richIdleSec++;
        }
        // first enemy building damaged by this player
      }
      ais.forEach((a, k) => {
        if (a.state === 'attack' && lastState[k] !== 'attack') {
          const s = ps[a.p.id];
          s.waves++;
          if (s.firstWave < 0) s.firstWave = w.time;
        }
        lastState[k] = a.state;
      });
    }
    if (t % TICK_HZ === 0) {
      // accumulate per-second travel so units shuttling inside an ore field are not flagged
      for (const u of w.units) {
        if (!u.alive || u.kind === 'aircraft') continue;
        const o = u.ut.harvester ? `harv:${u.hstate}` : u.order.type;
        const lp = lastPos.get(u.id);
        if (!lp || lp.o !== o) { lastPos.set(u.id, { x: u.x, y: u.y, t: w.time, o, travel: 0 } as any); continue; }
        (lp as any).travel += Math.hypot(u.x - lp.x, u.y - lp.y);
        lp.x = u.x; lp.y = u.y;
        const movingOrder = o === 'move' || o === 'harv:toOre' || o === 'harv:toRefinery' || o === 'harv:seek';
        if (movingOrder && w.time - lp.t >= 30 && (lp as any).travel < 0.5 && !stuckReported.has(u.id)) {
          stuckReported.add(u.id);
          anomalies.push(`${fmtTime(w.time)} P${u.owner.id} ${u.ut.id}#${u.id} stuck ≥30s at (${u.x.toFixed(1)},${u.y.toFixed(1)}) with order ${o}`);
        }
        if (w.time - lp.t >= 30) { lp.t = w.time; (lp as any).travel = 0; }
      }
    }
    if (t % (TICK_HZ * 30) === 0) {
      for (const i of invariants(w)) {
        const n = (invSeen.get(i.kind) ?? 0) + 1;
        invSeen.set(i.kind, n);
        if (n <= 2) anomalies.push(`${fmtTime(w.time)} invariant ${i.kind}: ${i.detail}`);
      }
    }
    if (w.gameOver) break;
  }
  return { w, ps, anomalies, invSeen, ais, cmdCount };
}

const rows: string[] = [];
for (const spec of SPECS) {
  const key = `seed${spec.seed}-${spec.size}-${spec.players}p-${spec.diffs.join('/')}`;
  if (FILTER && !key.includes(FILTER)) continue;
  const t0 = performance.now();
  const { w, ps, anomalies, invSeen, ais, cmdCount } = runGame(spec);
  const el = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== ${key}  (${el}s wall)`);
  const result = w.gameOver ? `winner team ${w.winnerTeam} at ${fmtTime(w.time)}` : `NO RESULT after ${fmtTime(w.time)} (stalemate)`;
  console.log(`  result: ${result}`);
  for (const p of w.players) {
    const s = ps[p.id];
    const bld = w.buildings.filter((b) => b.alive && b.owner === p).length;
    const units = w.units.filter((u) => u.alive && u.owner === p);
    const harv = units.filter((u) => u.ut.harvester).length;
    console.log(`  P${p.id} ${p.faction.padEnd(6)} ${(ais.find((a: any) => a.p === p) as any).difficulty.padEnd(6)} ${p.defeated ? `DEFEATED@${fmtTime(s.defeatedAt)}` : 'alive'} | yard ${fmtTime(s.fact)} ref ${fmtTime(s.proc)} WF ${fmtTime(s.weap)} 1st tank ${fmtTime(s.firstTank)} 1st wave ${fmtTime(s.firstWave)} waves ${s.waves} | bld ${bld} units ${units.length} harv ${harv} $${p.credits} max$${s.maxCredits} | harvested ${Math.round(p.stats.harvested)} kills ${p.stats.unitsKilled}/${p.stats.buildingsKilled} lost ${p.stats.unitsLost}/${p.stats.buildingsLost} | placeFail ${s.placeCancels} idleProd ${s.idleProdSec}s (rich&idle ${s.richIdleSec}s)`);
  }
  for (const p of w.players) {
    const c = cmdCount[p.id];
    const air = w.units.filter((u) => u.alive && u.owner === p && u.kind === 'aircraft').length;
    console.log(`    P${p.id} cmds: airstrikes ${c.airstrike ?? 0} (aircraft alive ${air}), nukes ${c['sw:nuke'] ?? 0}, iron ${c['sw:ironcurtain'] ?? 0}, chrono ${c['sw:chrono'] ?? 0}, repairs ${c.repair ?? 0}, rally ${c.rally ?? 0}, builds ${c.build ?? 0}, sells ${c.sell ?? 0}`);
  }
  for (const a of anomalies.slice(0, 14)) console.log('   ! ' + a);
  if (anomalies.length > 14) console.log(`   ! ... ${anomalies.length - 14} more anomalies`);
  if (invSeen.size) console.log(`   invariant kinds: ${[...invSeen.entries()].map(([k, v]) => `${k}x${v}`).join(', ')}`);
  rows.push(`${key.padEnd(44)} ${result}`);
}
console.log('\n=== SUMMARY');
for (const r of rows) console.log('  ' + r);
