// QA: balance duels. node --import tsx tools/qa/balance.ts [budget=3000]
// Equal-cost groups attack-move into each other on open ground; reports cost efficiency.
import { UNITS, BUILDINGS, WEAPONS, WARHEADS, ARMOR_INDEX, mphToCellsPerSecond, RA_TICKS_PER_SECOND } from '../../src/data/rules';
import { building, flatMap, makeWorld, unit, type Unit, type World } from './lib';
import { TICK_HZ } from '../../src/sim/types';

const BUDGET = +(process.argv[2] ?? 3000);
const allies = ['e1', 'e3', 'medi', 'e7', 'jeep', 'apc', '1tnk', '2tnk', 'arty'];
const soviet = ['e1', 'e2', 'e3', 'e4', 'dog', '3tnk', '4tnk', 'v2rl'];

interface Res { aLeft: number; bLeft: number; aCost: number; bCost: number; t: number; aN: number; bN: number }

function spawnGroup(w: World, pid: number, type: string, n: number, x: number, y: number, face: number): Unit[] {
  const out: Unit[] = [];
  const isInf = UNITS[type].kind === 'infantry';
  const step = isInf ? 0.6 : 1.1;
  const cols = Math.ceil(Math.sqrt(n * 2));
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / cols), c = k % cols;
    out.push(unit(w, w.players[pid], type, x + (pid === 0 ? -r : r) * step, y + (c - cols / 2) * step, face));
  }
  return out;
}

function duel(a: string, b: string, seed = 1, sameCount = 0): Res {
  const w = makeWorld(flatMap(60, 40), [{ faction: 'allies', human: true }, { faction: 'soviet' }], { seed });
  const aN = sameCount || Math.max(1, Math.round(BUDGET / UNITS[a].cost));
  const bN = sameCount || Math.max(1, Math.round(BUDGET / UNITS[b].cost));
  // alternate creation order: entities created first are updated first and win exact ties (see misc.ts)
  let A: Unit[], B: Unit[];
  if (seed % 2) { A = spawnGroup(w, 0, a, aN, 20.5, 20.5, 0); B = spawnGroup(w, 1, b, bN, 40.5, 20.5, Math.PI); }
  else { B = spawnGroup(w, 1, b, bN, 40.5, 20.5, Math.PI); A = spawnGroup(w, 0, a, aN, 20.5, 20.5, 0); }
  w.issue({ c: 'move', player: 0, units: A.map((u) => u.id), x: 45.5, y: 20.5, attackMove: true });
  w.issue({ c: 'move', player: 1, units: B.map((u) => u.id), x: 15.5, y: 20.5, attackMove: true });
  let t = 0;
  const max = 240 * TICK_HZ;
  let quiet = 0;
  for (; t < max; t++) {
    w.step();
    const fired = w.events.some((e) => e.e === 'fire');
    w.events.length = 0;
    const aAlive = A.some((u) => u.alive), bAlive = B.some((u) => u.alive);
    if (!aAlive || !bAlive) break;
    quiet = fired ? 0 : quiet + 1;
    if (quiet > 30 * TICK_HZ && t > 40 * TICK_HZ) break; // nobody can hurt anybody
    // re-issue attack-move to idle units so they keep engaging
    if (t % (TICK_HZ * 5) === 0) {
      const ia = A.filter((u) => u.alive && u.order.type === 'idle').map((u) => u.id);
      const ib = B.filter((u) => u.alive && u.order.type === 'idle').map((u) => u.id);
      const ca = B.find((u) => u.alive), cb = A.find((u) => u.alive);
      if (ia.length && ca) w.issue({ c: 'move', player: 0, units: ia, x: ca.x, y: ca.y, attackMove: true });
      if (ib.length && cb) w.issue({ c: 'move', player: 1, units: ib, x: cb.x, y: cb.y, attackMove: true });
    }
  }
  const val = (us: Unit[]) => us.reduce((s, u) => s + (u.alive ? u.ut.cost * u.hp / u.maxHp : 0), 0);
  return { aLeft: val(A), bLeft: val(B), aCost: aN * UNITS[a].cost, bCost: bN * UNITS[b].cost, t: t / TICK_HZ, aN, bN };
}

/** Exchange ratio for A: value of B destroyed / value of A lost (>1 = A cost-effective). */
function ratio(r: Res) {
  const aLost = r.aCost - r.aLeft, bLost = r.bCost - r.bLeft;
  return bLost / Math.max(1, aLost);
}

console.log(`\n## Cost-equal duels (budget ≈ $${BUDGET} per side, attack-move into each other, avg of 2 seeds)`);
console.log('Cell = exchange ratio for the ROW unit (value it destroyed / value it lost); >1 favours row. "=" means nobody could damage the other.');
const rowsA = allies, colsB = soviet;
let header = 'Allies \\ Soviet'.padEnd(16) + colsB.map((c) => c.padStart(8)).join('');
console.log(header);
const rowScore: Record<string, number[]> = {}, colScore: Record<string, number[]> = {};
for (const a of rowsA) {
  let line = a.padEnd(16);
  for (const b of colsB) {
    const r1 = duel(a, b, 1), r2 = duel(a, b, 2);
    const aLost = (r1.aCost - r1.aLeft) + (r2.aCost - r2.aLeft), bLost = (r1.bCost - r1.bLeft) + (r2.bCost - r2.bLeft);
    let cell: string;
    if (aLost < 1 && bLost < 1) cell = '=';
    else {
      const k = bLost / Math.max(1, aLost);
      cell = k > 99 ? '>99' : k.toFixed(2);
      (rowScore[a] ??= []).push(Math.log(Math.max(0.01, Math.min(100, k))));
      (colScore[b] ??= []).push(-Math.log(Math.max(0.01, Math.min(100, k))));
    }
    line += cell.padStart(8);
  }
  console.log(line);
}
const gmean = (xs: number[]) => Math.exp(xs.reduce((s, x) => s + x, 0) / xs.length);
console.log('\nGeometric-mean exchange ratio across the opposing roster:');
for (const [k, v] of Object.entries(rowScore)) console.log(`  allies ${k.padEnd(5)} ${gmean(v).toFixed(2)}`);
for (const [k, v] of Object.entries(colScore)) console.log(`  soviet ${k.padEnd(5)} ${gmean(v).toFixed(2)}`);

console.log('\n## Mirror tank duels (cost-equal)');
for (const [a, b] of [['2tnk', '3tnk'], ['1tnk', '3tnk'], ['2tnk', '4tnk'], ['1tnk', '2tnk'], ['jeep', '1tnk']] as const) {
  const r = duel(a, b, 2);
  console.log(`  ${r.aN}x ${a} ($${r.aCost}) vs ${r.bN}x ${b} ($${r.bCost}): ${a} kept $${r.aLeft.toFixed(0)}, ${b} kept $${r.bLeft.toFixed(0)} after ${r.t.toFixed(0)}s, ratio ${ratio(r).toFixed(2)}`);
}

console.log('\n## Same-count 1v1 time-to-kill');
for (const [a, b] of [['2tnk', '3tnk'], ['1tnk', '3tnk'], ['2tnk', '1tnk'], ['e1', 'e1'], ['e3', '3tnk'], ['e1', 'dog'], ['e7', 'e1'], ['4tnk', '2tnk']] as const) {
  const r = duel(a, b, 1, 1);
  const winner = r.aLeft > 0 && r.bLeft <= 0 ? a : r.bLeft > 0 && r.aLeft <= 0 ? b : 'none';
  console.log(`  1 ${a} vs 1 ${b}: winner ${winner} in ${r.t.toFixed(1)}s (hp left: ${a} ${(r.aLeft / UNITS[a].cost * 100).toFixed(0)}%, ${b} ${(r.bLeft / UNITS[b].cost * 100).toFixed(0)}%)`);
}

console.log('\n## Units vs static defences (how many to kill one; defender powered)');
for (const def of ['pbox', 'gun', 'ftur', 'tsla']) {
  const owner = BUILDINGS[def].owner[0];
  for (const att of owner === 'allies' ? ['3tnk', '4tnk', 'v2rl', 'e1', 'e2', 'e3'] : ['2tnk', '1tnk', 'arty', 'e1', 'e3', 'e7']) {
    let need = -1, lostCost = 0;
    for (let n = 1; n <= 12; n++) {
      const w = makeWorld(flatMap(48, 32), [{ faction: owner === 'allies' ? 'soviet' : 'allies', human: true }, { faction: owner as any }]);
      building(w, w.players[1], 'apwr', 40, 2); building(w, w.players[1], 'apwr', 40, 6);
      const d = building(w, w.players[1], def, 30, 15);
      const us = spawnGroup(w, 0, att, n, 14.5, 15.5, 0);
      w.issue({ c: 'attack', player: 0, units: us.map((u) => u.id), target: d.id });
      for (let t = 0; t < 120 * TICK_HZ && d.alive && us.some((u) => u.alive); t++) { w.step(); w.events.length = 0; }
      if (!d.alive) { need = n; lostCost = us.filter((u) => !u.alive).length * UNITS[att].cost; break; }
    }
    console.log(`  ${BUILDINGS[def].name.padEnd(12)} ($${BUILDINGS[def].cost}) vs ${att.padEnd(4)}: ${need < 0 ? '>12 needed' : `${need} needed ($${need * UNITS[att].cost}), lost $${lostCost}`}`);
  }
}

console.log('\n## Static DPS reference (damage/sec vs armour none/wood/light/heavy/concrete)');
for (const u of [...new Set([...allies, ...soviet, 'heli', 'hind', 'mig', 'yak'])]) {
  const t = UNITS[u];
  const wd = t.primary ? WEAPONS[t.primary] : null;
  if (!wd) continue;
  const mult = t.twinShot ? 2 : 1;
  const dps = (wd.damage * wd.burst * mult) / (wd.rof / RA_TICKS_PER_SECOND);
  const v = WARHEADS[wd.warhead].verses.map((x) => (dps * x).toFixed(0)).join('/');
  console.log(`  ${u.padEnd(5)} $${String(t.cost).padEnd(5)} hp ${String(t.strength).padEnd(4)} ${t.armor.padEnd(6)} speed ${mphToCellsPerSecond(t.speed).toFixed(2)} c/s  ${wd.id.padEnd(16)} range ${wd.range}  dps ${v}  (per $1000: ${(dps / t.cost * 1000).toFixed(1)})`);
}
void ARMOR_INDEX;
