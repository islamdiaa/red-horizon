// Curated skirmish maps (src/maps): every map loads into a valid, fair GameMap; plus map codes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CURATED_MAPS, buildMap, getMapDef, loadCuratedMap } from '../src/maps';
import { bridgeCells, landReach, nearestStart, oreValue, symmetryGroup } from '../src/maps/build';
import { decodeMapCode, encodeMapCode, generatorOptions, normaliseParams } from '../src/maps/code';
import { generateMap } from '../src/sim/mapgen';
import { T, WATER_LEVEL, type GameMap } from '../src/sim/map';
import { World } from '../src/sim/world';
import { checkInvariants, run, seconds } from './helpers';

const maps = CURATED_MAPS.map((def) => ({ def, map: buildMap(def) }));
const cell = (s: { x: number; y: number }) => [Math.floor(s.x), Math.floor(s.y)] as const;

/** Sea reach over water cells (4-neighbour) from a set of seeds. */
function seaReach(map: GameMap, seeds: number[]): Uint8Array {
  const seen = new Uint8Array(map.w * map.h);
  const q = [...seeds];
  for (const i of q) seen[i] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % map.w, y = (i / map.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const j = map.idx(nx, ny);
      if (seen[j] || map.terrain[j] !== T.Water) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

/** Water cells near a start where a 3x3 shipyard fits fully on water next to land the base can reach. */
function shipyardSpots(map: GameMap, s: { x: number; y: number }, radius: number): number[] {
  const reach = landReach(map, ...cell(s));
  const out: number[] = [];
  for (let y = Math.floor(s.y - radius); y <= s.y + radius; y++) for (let x = Math.floor(s.x - radius); x <= s.x + radius; x++) {
    if (Math.hypot(x + 1.5 - s.x, y + 1.5 - s.y) > radius) continue;
    let water = true;
    for (let dy = 0; dy < 3 && water; dy++) for (let dx = 0; dx < 3; dx++) {
      if (!map.inBounds(x + dx, y + dy) || map.terrain[map.idx(x + dx, y + dy)] !== T.Water) { water = false; break; }
    }
    if (!water) continue;
    let shore = false;
    for (let dy = -1; dy <= 3 && !shore; dy++) for (let dx = -1; dx <= 3; dx++) {
      if (dx >= 0 && dx < 3 && dy >= 0 && dy < 3) continue;
      if (map.inBounds(x + dx, y + dy) && reach[map.idx(x + dx, y + dy)]) { shore = true; break; }
    }
    if (shore) out.push(map.idx(x + 1, y + 1));
  }
  return out;
}

describe('curated maps', () => {
  test('there are at least 8 maps with unique ids and complete descriptions', () => {
    assert.ok(CURATED_MAPS.length >= 8, `only ${CURATED_MAPS.length} maps`);
    assert.equal(new Set(CURATED_MAPS.map((d) => d.id)).size, CURATED_MAPS.length, 'duplicate map id');
    for (const d of CURATED_MAPS) {
      assert.ok(d.name && d.desc.length > 20, `${d.id}: name / description`);
      assert.ok(getMapDef(d.id) === d, `${d.id}: lookup`);
    }
    const players = new Set(CURATED_MAPS.map((d) => d.players));
    assert.ok(players.has(2) && players.has(3) && players.has(4), 'maps for 2, 3 and 4 players');
    assert.ok(CURATED_MAPS.filter((d) => d.naval).length >= 2, 'naval maps');
    assert.ok(new Set(CURATED_MAPS.map((d) => d.climate)).size === 3, 'every climate');
  });

  for (const { def, map } of maps) {
    describe(def.name, () => {
      test('loads into a valid GameMap', () => {
        assert.equal(map.w, def.size, 'width');
        assert.equal(map.h, def.size, 'height');
        assert.equal(map.climate, def.climate, 'climate');
        assert.equal(map.startPositions.length, def.players, 'one start per player');
        for (const h of map.heights) assert.ok(Number.isFinite(h), 'finite heights');
        const fieldCells = [];
        for (let i = 0; i < map.w * map.h; i++) {
          if (map.oreField[i]) fieldCells.push(i);
          if (map.ore[i]) assert.ok(map.oreField[i] && map.ore[i] <= 9, `ore cell ${i} belongs to a field`);
          if (map.gems[i]) assert.ok(map.ore[i] > 0 && map.oreField[i] === 2, `gem cell ${i} is a gem field`);
          if (map.ore[i] || map.tree[i]) assert.ok(map.terrain[i] !== T.Water && map.terrain[i] !== T.Rock, `ore / tree ${i} on land`);
        }
        assert.deepEqual([...map.oreFieldCells].sort((a, b) => a - b), fieldCells, 'oreFieldCells lists every ore-field cell');
        // deterministic: the same id always builds the identical map (saves and replays rebuild it)
        const again = loadCuratedMap(def.id)!;
        assert.deepEqual(again.terrain, map.terrain, 'terrain deterministic');
        assert.deepEqual(again.ore, map.ore, 'ore deterministic');
        assert.deepEqual(again.heights, map.heights, 'heights deterministic');
      });

      if (def.symmetry !== 'rot3') {
        test('is exactly symmetric', () => {
          const G = symmetryGroup(def);
          for (const g of G.slice(1)) {
            for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
              const [fx, fy] = g.f(x + 0.5, y + 0.5);
              const i = map.idx(x, y), j = map.idx(Math.floor(fx), Math.floor(fy));
              if (map.terrain[i] !== map.terrain[j] || map.ore[i] !== map.ore[j] || map.gems[i] !== map.gems[j] || !map.tree[i] !== !map.tree[j]) {
                assert.fail(`${def.id}: cell (${x}, ${y}) differs from its image (${Math.floor(fx)}, ${Math.floor(fy)})`);
              }
            }
          }
        });
      }

      test('every start has room for a full base', () => {
        for (const s of map.startPositions) {
          const [sx, sy] = cell(s);
          let free = 0, total = 0;
          for (let y = sy - 8; y <= sy + 8; y++) for (let x = sx - 8; x <= sx + 8; x++) {
            if (Math.hypot(x - sx, y - sy) > 8) continue;
            total++;
            if (map.buildable(x, y)) free++;
          }
          assert.ok(free / total > 0.92, `start (${sx}, ${sy}): ${free}/${total} cells buildable`);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert.ok(map.buildable(sx + dx, sy + dy), 'MCV deploy footprint');
          assert.ok(sx >= 8 && sy >= 8 && sx < map.w - 8 && sy < map.h - 8, 'start away from the map edge');
        }
      });

      test('starts are reachable from each other by land (fords alone, without the bridges)', () => {
        const reach = landReach(map, ...cell(map.startPositions[0]), new Set());
        for (const s of map.startPositions) assert.ok(reach[map.idx(...cell(s))], `start ${s.x},${s.y} reachable`);
      });

      if (def.naval) {
        test('naval: every base has shipyard water within 12 cells, and the bases are linked by sea', () => {
          const spots = map.startPositions.map((s) => shipyardSpots(map, s, 12.5));
          spots.forEach((sp, k) => assert.ok(sp.length > 0, `start ${k} has no shipyard spot within 12 cells`));
          const sea = seaReach(map, spots[0]);
          spots.forEach((sp, k) => assert.ok(sp.some((i) => sea[i]), `start ${k} is linked to start 0 by sea`));
        });
      }

      test('ore is fair: every player gets the same ore within 3%', () => {
        const val = new Array(map.startPositions.length).fill(0);
        const near = new Array(map.startPositions.length).fill(0);
        for (let i = 0; i < map.w * map.h; i++) {
          if (!map.ore[i]) continue;
          const k = nearestStart(map, i);
          if (k >= 0) val[k] += oreValue(map, i);
          const x = (i % map.w) + 0.5, y = Math.floor(i / map.w) + 0.5;
          map.startPositions.forEach((s, n) => { if (Math.hypot(s.x - x, s.y - y) < 17) near[n] += oreValue(map, i); });
        }
        const lo = Math.min(...val), hi = Math.max(...val);
        assert.ok(lo > 700, `enough ore per player (${val.join(', ')})`);
        assert.ok((hi - lo) / hi <= 0.03, `ore per player ${val.join(', ')}`);
        for (const v of near) assert.ok(v >= 250, `own ore near every base (${near.join(', ')})`);
      });

      test('bridges sit on water cells and connect land to land', () => {
        if (def.bridges?.length) assert.ok(map.bridges.length >= def.bridges.length, 'bridges built');
        for (const b of map.bridges) {
          assert.ok(b.cells.length >= 2, 'bridge spans water');
          for (const [x, y] of b.cells) assert.equal(map.terrain[map.idx(x, y)], T.Water, `bridge cell (${x}, ${y}) is water`);
          const [x0, y0] = b.cells[0], [x1, y1] = b.cells[b.cells.length - 1];
          const d = b.axis === 'x' ? [1, 0] : [0, 1];
          b.cells.forEach(([x, y], k) => assert.ok(x === x0 + d[0] * k && y === y0 + d[1] * k, 'straight along its axis'));
          assert.ok(map.terrainPassable(map.idx(x0 - d[0], y0 - d[1])) && map.terrainPassable(map.idx(x1 + d[0], y1 + d[1])), 'land at both ends');
        }
        const br = bridgeCells(map);
        if (map.bridges.length) {
          // with the bridges the land route between bases only gets shorter
          const withB = landReach(map, ...cell(map.startPositions[0]), br);
          for (const s of map.startPositions) assert.ok(withB[map.idx(...cell(s))], 'reachable over bridges');
        }
      });

      test('water is below the waterline', () => {
        let wet = 0, ok = 0;
        for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
          if (map.terrain[map.idx(x, y)] !== T.Water) continue;
          wet++;
          if (map.heightAt(x + 0.5, y + 0.5) < WATER_LEVEL) ok++;
        }
        assert.ok(!wet || ok / wet > 0.97, `${ok}/${wet} water cells under the surface`);
      });
    });
  }

  test('AI opponents build and fight on a curated map', () => {
    const def = getMapDef('pocket-valley')!;
    const map = buildMap(def);
    const world = new World({
      map, credits: 10000, startUnits: 'mcv', fog: true, seed: 5,
      players: [
        { name: 'A', faction: 'allies', color: 0, team: 0, isHuman: false, ai: 'hard' },
        { name: 'B', faction: 'soviet', color: 0, team: 1, isHuman: false, ai: 'hard' },
      ],
    });
    run(world, seconds(240));
    assert.deepEqual(checkInvariants(world), [], 'invariants hold');
    for (const p of world.players) {
      assert.ok(p.has('fact') || world.buildings.some((b) => b.owner === p), `${p.name} deployed`);
      assert.ok(p.has('proc'), `${p.name} built a refinery`);
    }
  });
});

describe('map codes', () => {
  test('round trip', () => {
    for (const p of [
      { size: 96, players: 2, water: 0.5, trees: 0.5, ore: 0.6, climate: 'temperate' as const, seed: 123456789 },
      { size: 64, players: 4, water: 0, trees: 1, ore: 0.35, climate: 'winter' as const, seed: 0 },
      { size: 128, players: 3, water: 1, trees: 0.05, ore: 1, climate: 'desert' as const, seed: 0x7ffffffe },
    ]) {
      const code = encodeMapCode(p);
      assert.ok(code.length <= 16, `short code ${code}`);
      assert.deepEqual(decodeMapCode(code), normaliseParams(p), code);
      assert.deepEqual(decodeMapCode(code.toLowerCase().replace('-', ' ')), normaliseParams(p), 'case / separator insensitive');
    }
  });

  test('menu values survive the code exactly (k / 20)', () => {
    for (const v of [0, 0.05, 0.35, 0.5, 0.6, 1]) assert.equal(normaliseParams({ size: 96, players: 2, water: v, trees: v, ore: v, climate: 'temperate', seed: 1 }).water, v, String(v));
  });

  test('typos are rejected by the check digit', () => {
    const code = encodeMapCode({ size: 96, players: 2, water: 0.5, trees: 0.5, ore: 0.6, climate: 'temperate', seed: 987654 });
    const body = code.replace('-', '');
    let rejected = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body[i] === 'A' ? 'B' : 'A';
      if (!decodeMapCode(body.slice(0, i) + c + body.slice(i + 1))) rejected++;
    }
    assert.ok(rejected >= body.length - 2, `single-character typos rejected (${rejected}/${body.length})`);
    assert.equal(decodeMapCode('hello'), null, 'garbage rejected');
  });

  test('a decoded code reproduces the same generated map', () => {
    const p = { size: 64, players: 2, water: 0.5, trees: 0.5, ore: 0.6, climate: 'winter' as const, seed: 4242 };
    const a = generateMap(generatorOptions(p));
    const b = generateMap(generatorOptions(decodeMapCode(encodeMapCode(p))!));
    assert.deepEqual(b.terrain, a.terrain, 'terrain');
    assert.deepEqual(b.ore, a.ore, 'ore');
    assert.deepEqual(b.startPositions, a.startPositions, 'starts');
  });
});
