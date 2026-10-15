// Procedural skirmish maps: determinism, symmetry, fairness, buildable starts, connectivity.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, floodReach } from '../src/sim/mapgen';
import { GameMap, T } from '../src/sim/map';
import { PathFinder } from '../src/sim/pathfinding';
import { skirmish } from './helpers';

const SEEDS = [1, 2, 3, 77, 1234, 9999, 424242, 31337];
const SIZES = [64, 96, 128];
const gen = (players: number, size: number, seed: number) => generateMap({ size, players, seed, water: 0.5, trees: 0.5, ore: 0.6 });

/** Partner cells under the map's symmetry: 180° rotation (2p) or 4-way mirror (3-4p). */
function mirrors(m: GameMap, players: number, x: number, y: number): [number, number][] {
  const N = m.w;
  return players > 2 ? [[N - 1 - x, y], [x, N - 1 - y], [N - 1 - x, N - 1 - y]] : [[N - 1 - x, N - 1 - y]];
}

function asymmetry(m: GameMap, players: number) {
  let terrain = 0, ore = 0, tree = 0, pairs = 0;
  // 3 players: nobody starts in the bottom-right corner, which gets no ore fields (so it differs by design)
  const empty = (x: number, y: number) => players === 3 && x >= m.w / 2 && y >= m.h / 2;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = m.idx(x, y);
    if (empty(x, y)) continue;
    for (const [mx, my] of mirrors(m, players, x, y)) {
      if (empty(mx, my)) continue;
      const j = m.idx(mx, my);
      pairs++;
      if (m.terrain[i] !== m.terrain[j]) terrain++;
      if (m.ore[i] !== m.ore[j] || m.gems[i] !== m.gems[j]) ore++;
      if (!m.tree[i] !== !m.tree[j]) tree++;
    }
  }
  return { terrain: terrain / pairs, ore: ore / pairs, tree: tree / pairs, counts: { terrain, ore, tree } };
}

/** Credits of ore closest to each start (Voronoi split, ties shared). */
function oreByStart(m: GameMap): number[] {
  const tot = m.startPositions.map(() => 0);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = m.idx(x, y);
    if (!m.ore[i]) continue;
    const ds = m.startPositions.map((s) => Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y));
    const min = Math.min(...ds);
    const near = ds.flatMap((d, k) => (d - min < 1e-6 ? [k] : []));
    for (const k of near) tot[k] += (m.ore[i] * (m.gems[i] ? 50 : 25)) / near.length;
  }
  return tot;
}

/** Credits of ore within `r` cells of each start (the "home" fields). */
function homeOre(m: GameMap, r = 18): number[] {
  return m.startPositions.map((s) => {
    let v = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const i = m.idx(x, y);
      if (m.ore[i] && Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) < r) v += m.ore[i] * (m.gems[i] ? 50 : 25);
    }
    return v;
  });
}

const spread = (v: number[]) => (Math.max(...v) - Math.min(...v)) / Math.max(...v);

describe('generateMap', () => {
  test('is deterministic per seed and varies between seeds', () => {
    const a = gen(2, 96, 4242), b = gen(2, 96, 4242), c = gen(2, 96, 4243);
    assert.deepEqual(a.terrain, b.terrain);
    assert.deepEqual(a.ore, b.ore);
    assert.deepEqual(a.tree, b.tree);
    assert.deepEqual(a.heights, b.heights);
    assert.deepEqual(a.startPositions, b.startPositions);
    assert.notDeepEqual(a.terrain, c.terrain);
  });

  test('produces sane content (water, rock, trees, ore, gems) and valid heights', () => {
    for (const seed of SEEDS) {
      const m = gen(2, 96, seed);
      const count = (pred: (i: number) => boolean) => { let n = 0; for (let i = 0; i < m.w * m.h; i++) if (pred(i)) n++; return n; };
      assert.ok(count((i) => m.ore[i] > 0) > 100, 'ore fields');
      assert.ok(count((i) => m.gems[i] > 0) > 0, 'gem field');
      assert.ok(count((i) => m.tree[i] > 0) > 50, 'forests');
      assert.ok(count((i) => m.terrain[i] === T.Clear) > m.w * m.h * 0.4, 'mostly open ground');
      for (const h of m.heights) assert.ok(Number.isFinite(h) && Math.abs(h) < 5, `height ${h}`);
      // ore never sits on water/rock or under trees
      assert.equal(count((i) => m.ore[i] > 0 && (m.terrain[i] === T.Water || m.terrain[i] === T.Rock || m.tree[i] > 0)), 0);
    }
  });

  for (const players of [2, 3, 4]) {
    test(`${players} players: the map is symmetric except at most one seam line`, () => {
      for (const size of SIZES) for (const seed of SEEDS) {
        const { counts } = asymmetry(gen(players, size, seed), players);
        // each mismatching pair is counted from both sides; a full diagonal seam is ~size cells
        const seam = 1.5 * size;
        assert.ok(counts.terrain <= seam && counts.ore <= seam && counts.tree <= seam, `size ${size} seed ${seed}: ${JSON.stringify(counts)}`);
      }
    });

    test(`${players} players: every start has identical home ore`, () => {
      for (const size of SIZES) for (const seed of SEEDS) {
        const home = homeOre(gen(players, size, seed));
        assert.ok(spread(home) < 0.01, `size ${size} seed ${seed}: ${home.join(', ')}`);
        assert.ok(Math.min(...home) > 5000, `enough ore near each base: ${home.join(', ')}`);
      }
    });

    test(`${players} players: start areas are buildable and the MCV can deploy`, () => {
      for (const size of SIZES) for (const seed of SEEDS.slice(0, 4)) {
        const m = gen(players, size, seed);
        assert.equal(m.startPositions.length, players);
        for (const s of m.startPositions) {
          const sx = Math.floor(s.x), sy = Math.floor(s.y);
          let ok = 0, total = 0;
          for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
            if (dx * dx + dy * dy > 25) continue;
            total++;
            if (m.buildable(sx + dx, sy + dy)) ok++;
          }
          assert.ok(ok / total >= 0.9, `size ${size} seed ${seed} start (${sx},${sy}): only ${ok}/${total} buildable`);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert.ok(m.buildable(sx + dx, sy + dy), 'MCV footprint');
        }
      }
      // in a real world every starting MCV can deploy where it stands
      for (const seed of SEEDS.slice(0, 3)) {
        const w = skirmish({ seed, players, size: 96 });
        const mcvs = w.units.filter((u) => u.ut.deploysInto);
        assert.equal(mcvs.length, players);
        for (const u of mcvs) assert.ok(w.canDeploy(u), `seed ${seed} ${u.owner.name} MCV can deploy`);
      }
    });

    test(`${players} players: all starts are mutually reachable by ground`, () => {
      for (const size of SIZES) for (const seed of SEEDS) {
        const m = gen(players, size, seed);
        const st = m.startPositions.map((s) => [Math.floor(s.x), Math.floor(s.y)] as const);
        for (const [ax, ay] of st) {
          const reach = floodReach(m, ax, ay);
          for (const [bx, by] of st) assert.ok(reach[m.idx(bx, by)], `size ${size} seed ${seed}: (${ax},${ay}) -> (${bx},${by})`);
        }
        // and the real pathfinder finds a complete route between the first two
        const path = new PathFinder(m).find(st[0][0], st[0][1], st[1][0], st[1][1], 1e6)!;
        const last = path[path.length - 1];
        assert.deepEqual([Math.floor(last.x), Math.floor(last.y)], [st[1][0], st[1][1]], `size ${size} seed ${seed} path`);
      }
    });

    test(`${players} players: every ore cell can be reached by harvesters`, () => {
      for (const size of SIZES) for (const seed of SEEDS) {
        const m = gen(players, size, seed);
        const reach = floodReach(m, Math.floor(m.startPositions[0].x), Math.floor(m.startPositions[0].y));
        for (let i = 0; i < m.w * m.h; i++) if (m.ore[i]) assert.ok(reach[i], `size ${size} seed ${seed}: ore cell ${i % m.w},${(i / m.w) | 0} unreachable`);
        assert.deepEqual(m.oreFieldCells.length, m.oreField.reduce((n, v) => n + (v ? 1 : 0), 0));
      }
    });
  }

  for (const players of [2, 4]) {
    test(`${players} players: total ore closest to each start is within 3%`, () => {
      for (const size of SIZES) for (const seed of SEEDS) {
        const tot = oreByStart(gen(players, size, seed));
        assert.ok(spread(tot) < 0.03, `size ${size} seed ${seed}: ${tot.map(Math.round).join(', ')}`);
      }
    });
  }

  test('3 players: total ore closest to each start is within 6%, and the empty corner has none', () => {
    for (const size of SIZES) for (const seed of SEEDS) {
      const m = gen(3, size, seed);
      const tot = oreByStart(m);
      // the odd corner borders two players rather than one empty corner, hence the looser bound
      assert.ok(spread(tot) < 0.06, `size ${size} seed ${seed}: ${tot.map(Math.round).join(', ')}`);
      const N = m.w, c = N - Math.max(8, Math.round(N * 0.11)) - 0.5;
      let near = 0;
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.ore[m.idx(x, y)] && Math.hypot(x + 0.5 - c, y + 0.5 - c) < 12) near++;
      assert.equal(near, 0, `size ${size} seed ${seed}: ore next to the empty corner`);
    }
  });

  test('2 players: map is exactly 180° symmetric', () => {
    for (const size of SIZES) for (const seed of SEEDS) {
      const a = asymmetry(gen(2, size, seed), 2);
      assert.deepEqual(a.counts, { terrain: 0, ore: 0, tree: 0 }, `size ${size} seed ${seed}`);
    }
  });

  test('generation is fast enough for the loading screen (< 250 ms for 128x128)', () => {
    const t0 = performance.now();
    gen(4, 128, 5);
    assert.ok(performance.now() - t0 < 250, "performance.now() - t0 < 250");
  });
});
