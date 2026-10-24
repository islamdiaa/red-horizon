// World Conquest region battlefields (MAPS): every battle kind on a sweep of region looks generates a fair map within
// the time budget, deterministically; landmarks are scenery that blocks like terrain; civilian buildings are empty,
// neutral, destructible Buildings that survive save and load.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRegion, normaliseRegion, regionBattlefield, regionMapFor, REGION_KINDS, type RegionOptions } from '../src/sim/mapgen-region';
import { LANDMARK_FOOTPRINTS, LANDMARK_HEIGHTS, LANDMARK_SETTING, landmarkAt } from '../src/sim/landmarks';
import { CIVILIAN_TYPES, isCivilian } from '../src/sim/civilian';
import { LANDMARK_IDS, type Culture, type MapFeature, type WorldClimate } from '../src/conquest/world/types';
import type { Terrain } from '../src/conquest/geo';
import { T } from '../src/sim/map';
import { World, type PlayerSetup } from '../src/sim/world';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { worldHash } from '../src/replay/hash';
import { BUILDINGS } from '../src/data/rules';
import { TICK_HZ } from '../src/sim/types';

/** Region looks: the kinds of places GEO's regions describe (until its table lands, then every region of it). */
const LOOKS: Omit<RegionOptions, 'seed' | 'kind' | 'players' | 'strength'>[] = [
  { terrain: 'river', climate: 'desert', culture: 'middle-eastern', features: ['river', 'farmland', 'town'], landmark: 'pyramids', region: 'giza' },
  { terrain: 'urban', climate: 'temperate', culture: 'western', features: ['city', 'river'], landmark: 'eiffel-tower', region: 'paris' },
  { terrain: 'coast', climate: 'temperate', culture: 'oceanian', features: ['harbour', 'city'], landmark: 'harbour-bridge', region: 'sydney' },
  { terrain: 'mountain', climate: 'temperate', culture: 'latin-american', features: ['mountains', 'town'], landmark: 'machu-picchu', region: 'cusco' },
  { terrain: 'forest', climate: 'tropical', culture: 'southeast-asian', features: ['jungle', 'river'], landmark: 'angkor-wat', region: 'angkor' },
  { terrain: 'steppe', climate: 'desert', culture: 'middle-eastern', features: ['dunes', 'oasis'], landmark: 'petra', region: 'petra' },
  { terrain: 'mountain', climate: 'winter', culture: 'nordic', features: ['glacier', 'mountains', 'coast'], region: 'fjords' },
  { terrain: 'plains', climate: 'temperate', culture: 'east-asian', features: ['volcano', 'farmland', 'town'], landmark: 'mount-fuji', region: 'kanto' },
  { terrain: 'river', climate: 'temperate', culture: 'western', features: ['river', 'city'], landmark: 'tower-bridge', region: 'london' },
  { terrain: 'islands', climate: 'temperate', culture: 'north-american', features: ['island', 'harbour'], landmark: 'statue-of-liberty', region: 'new-york' },
  { terrain: 'mountain', climate: 'desert', culture: 'north-american', features: ['canyon'], landmark: 'mount-rushmore', region: 'dakota' },
  { terrain: 'lakes', climate: 'winter', culture: 'slavic', features: ['lakes', 'town'], landmark: 'st-basils', region: 'moscow' },
  { terrain: 'plains', climate: 'temperate', culture: 'african', features: ['farmland'], landmark: 'kilimanjaro', region: 'kilimanjaro' },
  { terrain: 'river', climate: 'tropical', culture: 'african', features: ['river', 'jungle'], landmark: 'victoria-falls', region: 'zambezi' },
  { terrain: 'coast', climate: 'tropical', culture: 'latin-american', features: ['harbour', 'city'], landmark: 'sugarloaf', region: 'rio' },
  { terrain: 'steppe', climate: 'temperate', culture: 'east-asian', features: ['mountains'], landmark: 'great-wall', region: 'great-wall' },
];

const players = (o: RegionOptions) => (o.kind === 'boss' ? 3 : 2);
const cell = (s: { x: number; y: number }, w: number) => Math.floor(s.y) * w + Math.floor(s.x);

/** Ground reach from a start (bridges excluded, buildings standing are the civilian sites). */
function reach(map: ReturnType<typeof generateRegion>['map'], from: { x: number; y: number }, sites: { cx: number; cy: number; type: string }[]): Uint8Array {
  const N = map.w;
  const occ = new Uint8Array(N * N);
  for (const s of sites) for (let y = s.cy; y < s.cy + +s.type[3]; y++) for (let x = s.cx; x < s.cx + +s.type[2]; x++) occ[y * N + x] = 1;
  const ok = (i: number) => map.terrain[i] !== T.Water && map.terrain[i] !== T.Rock && map.tree[i] === 0 && !occ[i];
  const seen = new Uint8Array(N * N);
  const q = [cell(from, N)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % N, y = (i / N) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      // (8 neighbours, no squeezing between two blocked corners: as the pathfinder moves)
      if (dx && dy && !ok(y * N + nx) && !ok(ny * N + x)) continue;
      if (!seen[j] && ok(j)) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}

function mapHash(r: ReturnType<typeof generateRegion>): string {
  const m = r.map;
  let h = 0x811c9dc5;
  const mix = (v: number) => { h ^= v & 0xff; h = Math.imul(h, 0x01000193); };
  for (let i = 0; i < m.w * m.h; i++) { mix(m.terrain[i]); mix(m.ore[i]); mix(m.tree[i]); }
  for (let i = 0; i < m.heights.length; i++) mix(Math.round(m.heights[i] * 1000));
  for (const s of r.sites) { mix(s.cx); mix(s.cy); mix(s.seed); }
  for (const b of m.bridges) for (const [x, y] of b.cells) { mix(x); mix(y); }
  return `${h >>> 0}:${JSON.stringify(r.landmark)}:${JSON.stringify(m.startPositions)}`;
}

describe('World Conquest region battlefields', () => {
  test('every look x every battle kind: fair, fast and deterministic', () => {
    let worst = 0;
    for (const look of LOOKS) for (const kind of REGION_KINDS) for (const [seed, strength] of [[11, 2], [90210, 5]] as const) {
      const o = normaliseRegion({ ...look, kind, seed, strength, players: 0 });
      o.players = players(o);
      const t0 = performance.now();
      const r = generateRegion(o);
      const ms = performance.now() - t0;
      worst = Math.max(worst, ms);
      const tag = `${look.region} ${kind} seed ${seed}`;
      const m = r.map, N = m.w, p = r.report;
      assert.ok(ms < 1500, `${tag}: generated in ${ms.toFixed(0)} ms (budget 1.5 s)`);
      assert.equal(m.startPositions.length, o.players, `${tag}: one start per player`);
      // starts: open, flat, apart
      m.startPositions.forEach((s, k) => {
        assert.ok(m.buildable(Math.floor(s.x), Math.floor(s.y)), `${tag}: start ${k} is buildable ground`);
        assert.ok(p.room[k] >= 120, `${tag}: start ${k} has room to build (${p.room[k]} cells within 9)`);
        for (let j = 0; j < k; j++) assert.ok(Math.hypot(s.x - m.startPositions[j].x, s.y - m.startPositions[j].y) > 30, `${tag}: starts ${j} and ${k} apart`);
      });
      // the human starts at the bottom, the enemy up-screen
      assert.ok(m.startPositions[0].y > m.startPositions[1].y + N * 0.4, `${tag}: the enemy is up-screen of the human`);
      // ground routes (not through bridges); naval island battles need the sea route instead
      const islandSea = kind === 'naval' && r.report.features.includes('island');
      const fromA = reach(m, m.startPositions[0], r.sites);
      if (!islandSea) for (const s of m.startPositions.slice(1)) assert.ok(fromA[cell(s, N)], `${tag}: a ground route from the human start to ${JSON.stringify(s)}`);
      if (kind === 'naval') assert.ok(p.seaPath, `${tag}: a sea route between the harbours`);
      // ore: every field reachable (from some start), every side has its own
      const reaches = m.startPositions.map((s) => reach(m, s, r.sites));
      for (let i = 0; i < N * N; i++) if (m.ore[i]) {
        const x = i % N, y = (i / N) | 0;
        assert.ok(reaches.some((rc) => rc[i]), `${tag}: ore at ${x},${y} is reachable`);
      }
      p.oreNear.forEach((n, k) => assert.ok(n >= 25, `${tag}: start ${k} has ore near home (${n} cells)`));
      // the landmark: placed, visible from the start camera, never on a start, never sealing a route
      if (o.landmark) {
        assert.ok(r.landmark, `${tag}: the landmark stands`);
        const l = r.landmark!;
        assert.equal(l.id, o.landmark, `${tag}: the right landmark`);
        assert.ok(p.landmark?.visible, `${tag}: the landmark shows on the starting screen`);
        for (const s of m.startPositions) assert.ok(!landmarkAt(m, Math.floor(s.x), Math.floor(s.y)), `${tag}: not on a start`);
        for (let y = l.cy; y < l.cy + l.h; y++) for (let x = l.cx; x < l.cx + l.w; x++) {
          const i = y * N + x;
          assert.ok(!m.terrainPassable(i), `${tag}: the landmark blocks ground units (${x},${y})`);
          assert.ok(!m.ore[i] && !m.tree[i], `${tag}: nothing grows under the landmark`);
        }
      }
      // civilian buildings: on open land, never on a corridor's cells or a start
      for (const s of r.sites) {
        assert.ok((CIVILIAN_TYPES as readonly string[]).includes(s.type), `${tag}: civilian type ${s.type}`);
        for (const st of m.startPositions) assert.ok(Math.hypot(st.x - s.cx, st.y - s.cy) > 7, `${tag}: civilian building clear of the starts`);
      }
      // deterministic
      assert.equal(mapHash(generateRegion(o)), mapHash(r), `${tag}: the same options give the same battlefield`);
    }
    assert.ok(worst < 1500, `worst ${worst.toFixed(0)} ms`);
  });

  test('every GEO region x every battle kind: fair and fast (the regions of src/conquest/world/regions.ts)', async () => {
    const { WORLD_REGIONS } = await import('../src/conquest/world/regions');
    assert.ok(WORLD_REGIONS.length >= 100, `${WORLD_REGIONS.length} regions`);
    let worst = 0, n = 0;
    WORLD_REGIONS.forEach((reg, k) => {
      for (const kind of REGION_KINDS) {
        const o: RegionOptions = { kind, terrain: reg.terrain, climate: reg.climate, culture: reg.culture, features: [...reg.features], landmark: reg.landmark, seed: 4001 + k * 97, strength: 1 + (k % 6), players: kind === 'boss' ? 3 : 2, region: reg.id };
        const t0 = performance.now();
        const r = generateRegion(o);
        worst = Math.max(worst, performance.now() - t0);
        n++;
        const p = r.report, tag = `${reg.id} ${kind}`;
        assert.ok(p.paths, `${tag}: ground routes`);
        if (kind === 'naval') assert.ok(p.seaPath && !p.ponds, `${tag}: one sea, joined (sea ${p.seaPath}, ponds ${p.ponds})`);
        assert.ok(p.oreNear.every((x) => x >= 25), `${tag}: ore near every start (${p.oreNear})`);
        assert.ok(p.room.every((x) => x >= 120), `${tag}: room at every start (${p.room})`);
        if (reg.landmark) assert.ok(p.landmark?.visible, `${tag}: ${reg.landmark} on the start screen (${JSON.stringify(p.landmark)})`);
        if (k % 9 === 0) assert.equal(mapHash(generateRegion(o)), mapHash(r), `${tag}: deterministic`);
      }
    });
    assert.ok(worst < 1500, `${n} battlefields, worst ${worst.toFixed(0)} ms (budget 1.5 s)`);
  });

  test('every landmark stands visibly on its region-like battlefield, for every kind', () => {
    for (const id of LANDMARK_IDS) {
      const set = LANDMARK_SETTING[id];
      const terrain: Terrain = set === 'span' || set === 'river' ? 'river' : set === 'shore' ? 'coast' : set === 'peak' ? 'mountain' : set === 'plaza' ? 'urban' : 'plains';
      for (const kind of REGION_KINDS) {
        const r = generateRegion({ kind, terrain, climate: 'temperate', culture: 'western', features: [], landmark: id, seed: 7 + id.length, strength: 3, players: kind === 'boss' ? 3 : 2 });
        assert.ok(r.landmark && r.report.landmark?.visible, `${id} ${kind}: placed and visible (${JSON.stringify(r.report.landmark)})`);
        assert.ok(r.report.paths && r.report.seaPath, `${id} ${kind}: routes stay open`);
      }
    }
  });

  test('same region, same look; another seed, another layout', () => {
    const base = { kind: 'attack' as const, terrain: 'river' as Terrain, climate: 'desert' as WorldClimate, culture: 'middle-eastern' as Culture, features: ['river'] as MapFeature[], strength: 3, players: 2, region: 'giza' };
    const a = generateRegion({ ...base, seed: 1 }), b = generateRegion({ ...base, seed: 2 });
    assert.notEqual(mapHash(a), mapHash(b), 'different seeds: different layouts');
    assert.deepEqual(a.report.honoured, b.report.honoured, 'the same features drawn');
    assert.equal(a.map.climate, b.map.climate, 'the same climate');
  });

  test('regionBattlefield is a JSON map spec that builds the map', () => {
    const spec = regionBattlefield({ kind: 'naval', terrain: 'coast', climate: 'temperate', culture: 'western', features: ['harbour'], seed: 5, strength: 2, players: 2 });
    const json = JSON.parse(JSON.stringify(spec));
    assert.deepEqual(json, spec, 'plain JSON');
    assert.ok(spec.water >= 0.9, 'a naval battle is a sea battle for the script');
    assert.ok(typeof spec.label === 'string' && spec.label.length > 0, 'labelled');
    const m = regionMapFor(json)!;
    assert.ok(m && m.w === spec.size, 'regionMapFor builds the map');
    assert.equal(regionMapFor({ size: 64 } as never), null, 'null for other specs');
    // untrusted input normalises safely
    const n = normaliseRegion({ kind: 'x' as never, features: ['nope' as never, 'river'], strength: 99, seed: -3, landmark: 'atlantis' as never });
    assert.equal(n.kind, 'attack', 'unknown kind');
    assert.deepEqual(n.features, ['river'], 'unknown features dropped');
    assert.equal(n.strength, 6, 'strength clamped');
    assert.equal(n.landmark, undefined, 'unknown landmark dropped');
  });

  test('footprints and heights for all 37 landmarks', () => {
    assert.equal(LANDMARK_IDS.length, 37, '37 landmarks');
    for (const id of LANDMARK_IDS) {
      const f = LANDMARK_FOOTPRINTS[id];
      assert.ok(f && f.w >= 2 && f.h >= 2 && f.w <= 16 && f.h <= 16, `${id}: footprint ${JSON.stringify(f)}`);
      assert.ok(LANDMARK_HEIGHTS[id] > 0, `${id}: height`);
      assert.ok(LANDMARK_SETTING[id], `${id}: setting`);
    }
  });
});

describe('Region battlefield in the World', () => {
  const opts: RegionOptions = { kind: 'attack', terrain: 'urban', climate: 'temperate', culture: 'western', features: ['city', 'river'], landmark: 'big-ben', seed: 77, strength: 3, players: 2 };
  const build = () => {
    const r = generateRegion(opts);
    const ps: PlayerSetup[] = [
      { name: 'You', faction: 'allies', color: 0, team: 0, isHuman: true },
      { name: 'Foe', faction: 'soviet', color: 1, team: 1, isHuman: false, ai: 'easy' },
    ];
    return { r, w: new World({ map: r.map, players: ps, credits: 5000, startUnits: 'light', fog: true, seed: 77 }) };
  };

  test('civilian buildings stand: empty, neutral, styled, destructible without survivors', () => {
    const { r, w } = build();
    const civ = w.buildings.filter((b) => isCivilian(b));
    assert.ok(r.sites.length > 10, `a city (${r.sites.length} sites)`);
    assert.equal(civ.length, r.sites.length, 'every site raised');
    for (const b of civ) {
      assert.equal(b.owner.id, -1, 'owned by the civic pseudo-player');
      assert.ok(!w.players[0].isEnemy(b.owner) && !w.players[1].isEnemy(b.owner), 'nobody\'s enemy');
      assert.ok(b.scenery && b.scenery.culture === 'western' && typeof b.scenery.seed === 'number', 'carries its style');
      assert.equal(b.weapons.length, 0, 'unarmed');
      assert.equal(BUILDINGS[b.bt.id].cost, 0, 'worth nothing');
    }
    const units = w.units.length;
    const b = civ[0];
    w.kill(b, 'normal', undefined);
    assert.equal(w.units.length, units, 'no survivors run out');
    assert.ok(w.events.some((e) => e.e === 'death' && (e as { id: number }).id === b.id), 'the destruction path (death event: debris, rubble)');
    assert.equal(w.map.occupant[w.map.idx(b.cx, b.cy)], 0, 'its cells are free again');
  });

  test('the landmark is explored for everyone, blocks, and is no entity', () => {
    const { r, w } = build();
    const l = r.landmark!;
    assert.ok(l, 'big-ben stands');
    for (const p of w.players) assert.equal(p.explored[w.map.idx(l.cx, l.cy)], 1, `${p.name} has the landmark explored`);
    for (const e of w.entities.values()) {
      const inside = e.x >= l.cx && e.x < l.cx + l.w && e.y >= l.cy && e.y < l.cy + l.h;
      assert.ok(!inside || e.kind === 'aircraft', 'nothing stands inside the landmark');
    }
    assert.ok(!w.map.passable(l.cx, l.cy), 'blocked like terrain');
  });

  test('save and load keep the civilian buildings and continue identically', () => {
    const { w } = build();
    for (let t = 0; t < TICK_HZ * 20; t++) { w.step(); w.events.length = 0; }
    const civ = w.buildings.filter((b) => isCivilian(b));
    w.kill(civ[1], 'normal');
    w.step(); w.events.length = 0; // (saves are taken between ticks, after the dead are cleared)
    const json = JSON.parse(JSON.stringify(serializeWorld(w)));
    const { w: back } = build();
    deserializeWorld(back, json);
    const civB = back.buildings.filter((b) => isCivilian(b));
    assert.equal(civB.length, w.buildings.filter((b) => isCivilian(b)).length, 'the same civilian buildings');
    assert.equal(back.variety, null, 'no Commander state appears on load');
    assert.ok(civB.every((b) => b.owner.id === -1 && !!b.scenery), 'owner and style restored');
    for (let t = 0; t < TICK_HZ * 30; t++) { w.step(); w.events.length = 0; back.step(); back.events.length = 0; }
    assert.equal(worldHash(back), worldHash(w), 'the loaded game continues identically');
  });
});

describe('The tropical climate (World Conquest)', () => {
  test('recombines the existing terrain scans (no new downloads) and has every renderer table', async () => {
    const TM = await import('../src/render/terrain-materials');
    const others = new Set([...TM.climateMaterials('temperate'), ...TM.climateMaterials('winter'), ...TM.climateMaterials('desert')]);
    const trop = TM.climateMaterials('tropical');
    assert.equal(trop.length, TM.LAYER_COUNT, 'every layer slot filled');
    for (const m of trop) assert.ok(others.has(m), `tropical layer ${m} is an existing scan`);
    const TL = await import('../src/render/terrain-low');
    assert.ok(TL.PALETTES.tropical && TL.DRESS.tropical && TL.ROAD_LOW.tropical, 'Low preset palettes');
  });

  test('monsoon weather: rain and storms, never snow or dust', async () => {
    const { randomWeatherSequence } = await import('../src/render/weather/sequence');
    let rain = 0, total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const st of randomWeatherSequence(seed, 'tropical', 7200)) {
        assert.ok(st.kind !== 'snow' && st.kind !== 'dust', `seed ${seed}: no ${st.kind} in the tropics`);
        total += st.duration;
        if (st.kind === 'rain' || st.kind === 'storm') rain += st.duration;
      }
    }
    assert.ok(rain / total > 0.35, `a wet climate (${Math.round((100 * rain) / total)}% of the time raining)`);
  });

  test('a tropical region battlefield carries its climate to the map', () => {
    const r = generateRegion({ kind: 'attack', terrain: 'forest', climate: 'tropical', culture: 'southeast-asian', features: ['jungle', 'river'], seed: 3, strength: 2, players: 2 });
    assert.equal(r.map.climate, 'tropical', 'map climate');
    let trees = 0, land = 0;
    for (let i = 0; i < r.map.w * r.map.h; i++) { if (r.map.tree[i]) trees++; if (r.map.terrain[i] !== T.Water && r.map.terrain[i] !== T.Rock) land++; }
    assert.ok(trees / land > 0.25, `a jungle is mostly forest (${Math.round((100 * trees) / land)}% of the land)`);
    assert.ok(r.report.paths, 'and still has its routes');
  });
});

describe('Start framing per viewport (render only)', () => {
  test('desktop keeps startFocus; phones frame the landmark in the part of the screen the HUD leaves free', async () => {
    const { startView, freeScreen } = await import('../src/maps/start-view');
    const { WORLD_REGIONS } = await import('../src/conquest/world/regions');
    let n = 0, portrait = 0, short = 0;
    for (const reg of WORLD_REGIONS.filter((r) => r.landmark).slice(0, 18)) {
      const r = generateRegion({ kind: 'attack', terrain: reg.terrain, climate: reg.climate, culture: reg.culture, features: [...reg.features], landmark: reg.landmark, seed: 5, strength: 3, players: 2, region: reg.id });
      const f = r.map.startFocus!;
      const d = startView(r.map, 1280, 720);
      assert.deepEqual([d.x, d.y, d.dist], [f.x, f.y, f.dist], `${reg.id}: desktop keeps startFocus`);
      n++;
      if (startView(r.map, 390, 844).dist !== f.dist || startView(r.map, 390, 844).x !== f.x) portrait++;
      if (startView(r.map, 844, 390).x !== f.x || startView(r.map, 844, 390).dist !== f.dist) short++;
    }
    assert.equal(freeScreen(1280, 720), null, 'desktop: no reframing');
    assert.ok(portrait >= n * 0.8 && short >= n * 0.8, `phones reframe (portrait ${portrait}/${n}, short ${short}/${n})`);
    // a map without a landmark: the default start view
    const m = generateRegion({ kind: 'attack', terrain: 'plains', climate: 'temperate', culture: 'western', features: [], seed: 5, strength: 2, players: 2 }).map;
    const s0 = m.startPositions[0];
    assert.deepEqual(startView(m, 390, 844), { x: s0.x, y: s0.y + 1, dist: 20 }, 'no landmark: the start at 20');
  });
});
