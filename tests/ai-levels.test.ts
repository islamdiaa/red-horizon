// AI levels in the conditions players meet them (simulation version 5): Recruit and Easy grow their army over the
// match instead of spending the starting bank on riflemen in the first minutes, count aircraft and ships in their army
// cap, build one of each factory whatever the personality asks for; AI teammates help a human's base, join his pushes
// and leave his ore alone; save / load keeps the new state.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { AIController, difficultyParams, type AIDifficulty } from '../src/sim/ai';
import { TICK_HZ } from '../src/sim/types';
import { worldHash } from '../src/replay/hash';
import { AIIntel, type KnownStructure } from '../src/sim/ai-intel';
import { powerTargets } from '../src/sim/ai-engage';
import { Rng } from '../src/core/rng';

const seconds = (s: number) => Math.round(s * TICK_HZ);

function match(levels: (AIDifficulty | undefined)[], o: { seed?: number; teams?: number[]; personality?: string; rules?: 'commander'; size?: number } = {}): World {
  const seed = o.seed ?? 21;
  const map = generateMap({ size: o.size ?? 64, players: levels.length, seed, water: 0.3, trees: 0.5, ore: 0.6 });
  const players: PlayerSetup[] = levels.map((d, i) => ({ name: `P${i}`, faction: i % 2 ? 'soviet' : 'allies', color: 0, team: o.teams?.[i] ?? i, isHuman: !d, ai: d, personality: d ? o.personality : undefined }));
  return new World({ map, players, credits: 10000, startUnits: 'light', fog: true, seed, rules: o.rules, econ: o.rules === 'commander' ? true : undefined });
}

function run(w: World, ticks: number, each?: (w: World) => void) {
  for (let t = 0; t < ticks; t++) { w.step(); w.events.length = 0; each?.(w); }
}

const aiOf = (w: World, i: number) => w.ais.find((a) => a.player === w.players[i]) as AIController;

describe('AI levels (version 5)', () => {
  test('recruit and easy start with a small army cap that grows over the match; normal and up keep theirs', () => {
    for (const d of ['recruit', 'easy'] as const) {
      const p = difficultyParams(d);
      assert.ok(p.armyStart < p.armyCap / 2 && p.armyRamp > 0, `${d}: the cap starts small and grows (${p.armyStart} + ${p.armyRamp}/min, up to ${p.armyCap})`);
      assert.ok(p.capAll && p.infOpening <= 8 && p.maxOf?.weap === 1, `${d}: aircraft count, few riflemen before the war factory, one war factory`);
    }
    for (const d of ['normal', 'hard', 'brutal'] as const) {
      const p = difficultyParams(d);
      assert.ok(p.armyStart >= p.armyCap && !p.capAll && p.maxOf === null && p.infOpening > 1000, `${d}: no new caps`);
    }
    const w = match(['recruit', undefined]);
    const ai = aiOf(w, 0);
    assert.equal(ai.armyCapNow(), difficultyParams('recruit').armyStart, 'recruit cap at the start');
    run(w, seconds(120));
    assert.ok(Math.abs(ai.armyCapNow() - (difficultyParams('recruit').armyStart + 2 * difficultyParams('recruit').armyRamp)) < 1, 'two minutes later it has grown by two minutes of ramp');
  });

  test('a recruit AI does not turn its starting bank into a crowd of riflemen', () => {
    for (const rules of [undefined, 'commander'] as const) {
      const w = match([undefined, 'recruit'], { rules, seed: 77 });
      const ai = aiOf(w, 1);
      let most = 0, infBefore = 0;
      run(w, seconds(300), (w) => {
        if (w.tick % 20) return;
        most = Math.max(most, ai.capValue() - ai.armyCapNow());
        if (!w.players[1].has('weap')) infBefore = Math.max(infBefore, w.units.filter((u) => u.alive && u.owner === w.players[1] && u.kind === 'infantry').length);
      });
      // (the starting squad and the unit in production can carry it a little past the cap)
      assert.ok(most <= 1500, `${rules ?? 'classic'}: the army stays near its cap (over by ${most})`);
      assert.ok(infBefore <= difficultyParams('recruit').infOpening + 4, `${rules ?? 'classic'}: ${infBefore} infantry before the war factory (starting squad included)`);
    }
  });

  test('a recruit Air Marshal builds one airfield and one helipad at most, and its aircraft count in its cap', () => {
    const w = match([undefined, 'recruit'], { personality: 'airmarshal', seed: 5 });
    const ai = aiOf(w, 1);
    let over = 0;
    run(w, seconds(900), (w) => { if (w.tick % 100 === 0) over = Math.max(over, ai.capValue() - ai.armyCapNow()); });
    const n = (t: string) => w.buildings.filter((b) => b.alive && b.owner === w.players[1] && b.bt.id === t).length;
    assert.ok(n('afld') <= 1 && n('hpad') <= 1 && n('weap') <= 1, `afld ${n('afld')} hpad ${n('hpad')} weap ${n('weap')}`);
    assert.ok(over <= 2000, `aircraft and army together stay near the cap (over by ${over})`);
  });

  test('an AI teammate comes to a human\'s base when it is attacked', () => {
    // P0 human + P1 AI (team 0) against P2 AI (team 1)
    const w = match([undefined, 'normal', 'normal'], { teams: [0, 0, 1], seed: 12, size: 80 });
    const human = w.players[0], foe = w.players[2];
    const mcv = w.units.find((u) => u.alive && u.owner === human && u.ut.deploysInto)!;
    w.issue({ c: 'deploy', player: 0, units: [mcv.id] });
    run(w, seconds(360));
    const yard = w.buildings.find((b) => b.alive && b.owner === human && b.bt.id === 'fact');
    assert.ok(yard, 'the human deployed his yard');
    const [hx, hy] = [yard!.x, yard!.y];
    // a raiding party appears at the human's base
    for (let k = 0; k < 6; k++) w.addUnit(k % 2 ? 'e1' : '3tnk', foe, hx + 4 + (k % 3), hy + 4 + Math.floor(k / 3));
    // (this map puts the teammates in opposite corners, ~85 cells apart: the help is sent at once and takes its time)
    let came = -1, sent = -1;
    const t0 = w.time, ally = aiOf(w, 1);
    run(w, seconds(120), (w) => {
      if (sent < 0 && ally.lastMateHelp >= 0) sent = w.time - t0;
      if (came < 0 && w.units.some((u) => u.alive && u.owner === w.players[1] && u.weapons.length && !u.ut.harvester && Math.hypot(u.x - hx, u.y - hy) < 14)) came = w.time - t0;
    });
    assert.ok(sent >= 0 && sent <= 10, `the AI teammate sent help within the level's reaction time (${sent} s)`);
    assert.ok(came >= 0, 'the AI teammate\'s army reached the human\'s base within two minutes');
  });

  test('an AI teammate\'s Ore Trucks leave the fields by a human teammate\'s refinery while another field has ore', () => {
    const w = match([undefined, 'normal', 'recruit'], { teams: [0, 0, 1], seed: 31, size: 80 });
    const human = w.players[0], ai = w.players[1];
    // (until one of the AI's trucks is at work on a field)
    const working = () => w.units.find((u) => u.alive && u.owner === ai && u.ut.harvester && u.hstate === 'harvesting');
    for (let t = 0; t < seconds(400) && !working(); t++) { w.step(); w.events.length = 0; }
    // the human builds a refinery on the field the AI's trucks work
    const truck = working();
    assert.ok(truck, 'an AI truck is at work');
    let ref = null;
    for (let r = 2; r < 10 && !ref; r++) for (let dy = -r; dy <= r && !ref; dy++) for (let dx = -r; dx <= r && !ref; dx++) {
      const cx = Math.floor(truck!.x) + dx, cy = Math.floor(truck!.y) + dy;
      let free = true;
      for (let y = cy; y < cy + 3 && free; y++) for (let x = cx; x < cx + 3 && free; x++) free = w.map.inBounds(x, y) && w.map.passable(x, y) && !w.map.occupant[w.map.idx(x, y)] && !w.map.ore[w.map.idx(x, y)];
      if (free) ref = w.addBuilding('proc', human, cx, cy, true);
    }
    assert.ok(ref, 'a spot for the human refinery');
    let near = 0, samples = 0;
    run(w, seconds(90), (w) => {
      if (w.tick % 40) return;
      for (const u of w.units) if (u.alive && u.owner === ai && u.ut.harvester && u.hstate === 'harvesting') { samples++; if (Math.hypot(u.x - ref!.x, u.y - ref!.y) < 12) near++; }
    });
    assert.ok(samples > 0 && near / samples < 0.25, `AI trucks mostly elsewhere (${near}/${samples} samples by the human refinery)`);
  });

  test('free-for-all: equally far enemy starts are scouted in turn order, not all at the first seat (the human)', () => {
    const w = match([undefined, 'recruit', 'recruit', 'recruit'], { seed: 9001, size: 96 });
    const firsts = (w.ais as AIController[]).map((ai) => {
      const s = w.map.startPositions[ai.player.id];
      const c = ai.intel.candidateStarts(s.x, s.y)[0];
      return w.map.startPositions.findIndex((q) => Math.hypot(q.x - c[0], q.y - c[1]) < 1);
    });
    const atHuman = firsts.filter((k) => k === 0).length;
    assert.ok(atHuman <= 1, `at most one AI scouts the human's seat first (${firsts.join(',')})`);
  });

  test('Classic power play: the plant a Tesla Coil base cannot spare is a target, the others are not', () => {
    const w = match(['hard', 'hard'], { seed: 6 });
    const ai = aiOf(w, 0);
    const k = (id: number, type: string, x: number): KnownStructure => ({ id, type, owner: 1, x, y: 40, cx: x, cy: 40, w: 2, h: 2, cost: 0, armed: type === 'tsla', aa: false } as KnownStructure);
    // made 400 (two plants, one advanced), used 300 (two coils): only the advanced plant's loss leaves the coils dark
    const known = [k(1, 'tsla', 10), k(2, 'tsla', 14), k(3, 'powr', 20), k(4, 'powr', 24), k(5, 'apwr', 28)];
    assert.deepEqual([...powerTargets(ai, known)], [5], 'the advanced power plant');
    assert.equal(powerTargets(ai, known.filter((s) => s.type !== 'tsla')).size, 0, 'no coils, no power targets');
  });

  test('hunting: with nothing left that it knows of, an AI searches the square it has gone longest without seeing', () => {
    const w = match(['normal', undefined], { seed: 8 });
    const ai = aiOf(w, 0);
    run(w, seconds(30));
    const [bx, by] = ai.baseCenter();
    const h = ai.intel.huntPoint(bx, by);
    assert.ok(h, 'a point to search');
    const m = w.map, i = m.idx(Math.floor(h![0]), Math.floor(h![1]));
    assert.ok(!w.players[0].visible[i] && m.passable(Math.floor(h![0]), Math.floor(h![1])), 'out of sight, on land');
  });

  test('without a human teammate nothing changes: team play keeps its state idle', () => {
    const w = match(['normal', 'normal'], { seed: 3 });
    run(w, seconds(300));
    for (const ai of w.ais as AIController[]) assert.ok(ai.mateThreat === -1 && ai.lastMateHelp < 0, 'no teammate, no team play');
  });

  test('the enemy-base guess counts clusters exactly as comparing every pair did (bucketed, version 5)', () => {
    const w = match(['normal', 'normal', 'normal', 'normal'], { seed: 4, size: 96 });
    const intel = new AIIntel(w, w.players[0]);
    const rng = new Rng(99);
    for (let k = 0; k < 160; k++) {
      const owner = 1 + rng.int(0, 2), x = rng.range(2, 94), y = rng.range(2, 94);
      intel.structures.set(1000 + k, { id: 1000 + k, type: k % 9 ? 'powr' : 'fact', owner, x, y, cx: Math.floor(x), cy: Math.floor(y), w: 2, h: 2, cost: 300, armed: false, aa: false } as KnownStructure);
    }
    // the brute-force answer (the version-4 code)
    const brute = (fx: number, fy: number) => {
      let best: KnownStructure | null = null, bestScore = Infinity;
      for (const s of intel.structures.values()) {
        let near = 0;
        for (const o of intel.structures.values()) if (o.owner === s.owner && Math.hypot(o.x - s.x, o.y - s.y) < 8) near++;
        const score = Math.hypot(s.x - fx, s.y - fy) - near * 3 - (s.type === 'fact' ? 10 : 0);
        if (score < bestScore) { bestScore = score; best = s; }
      }
      return best ? [best.x, best.y] : null;
    };
    for (const [fx, fy] of [[5, 5], [90, 10], [48, 48], [10, 90], [70, 70]]) assert.deepEqual(intel.enemyBase(fx, fy), brute(fx, fy), `same guess from ${fx},${fy}`);
  });

  test('short of money ($2,500, Lean Times), the opening puts the refinery right after the first power plant', () => {
    for (const rules of [undefined, 'commander'] as const) for (const d of ['recruit', 'normal', 'hard'] as const) {
      const map = generateMap({ size: 64, players: 2, seed: 7, water: 0.3, trees: 0.5, ore: 0.6 });
      const players: PlayerSetup[] = [undefined, d].map((x, i) => ({ name: `P${i}`, faction: i ? 'soviet' : 'allies', color: 0, team: i, isHuman: !x, ai: x }));
      const w = new World({ map, players, credits: 2500, startUnits: 'mcv', fog: true, seed: 7, rules, econ: rules ? true : undefined });
      const order: string[] = [];
      run(w, seconds(240), (w) => {
        for (const id of w.buildings.filter((b) => b.owner === w.players[1]).map((b) => b.bt.id)) if (!order.includes(id)) order.push(id);
      });
      const label = `${rules ?? 'classic'} ${d}`;
      assert.deepEqual(order.slice(0, 3), ['fact', 'powr', 'proc'], `${label}: yard, power, refinery first (${order.join(' ')})`);
      assert.ok(w.players[1].stats.harvested > 0, `${label}: the refinery is paid for and working`);
    }
  });

  test('save / load mid-match continues identically with the version-5 AI state (2v2 with a human, recruit and easy)', () => {
    const make = () => match([undefined, 'easy', 'recruit', 'easy'], { teams: [0, 0, 1, 1], seed: 9, rules: 'commander', size: 80 });
    const a = make();
    run(a, seconds(420));
    const b = make();
    deserializeWorld(b, JSON.parse(JSON.stringify(serializeWorld(a))));
    run(a, seconds(120));
    run(b, seconds(120));
    assert.equal(worldHash(b), worldHash(a), 'loaded game continues identically');
  });
});
