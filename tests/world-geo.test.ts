/**
 * World Conquest geography (src/conquest/world/{regions,geo,names}.ts): the region data is complete and sane, every
 * region is on land and away from disputed areas, homelands / zones / landmarks are consistent, the territory graph
 * is connected for the full world, every World selection and every homeland's Blitz, generation is deterministic,
 * and the data stays within its size budget.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANDMARK_IDS, type MapFeature, type WorldResource } from '../src/conquest/world/types';
import { HOMELAND_BY_ID, LANDMARK_INFO, REGION_BY_ID, WORLD_HOMELANDS, WORLD_REGIONS, WORLD_ZONES, zoneBonus } from '../src/conquest/world/regions';
import {
  BLITZ_MAX, BLITZ_MIN, LONG_LANES, blitzRegions, buildWorld, clearGeoCaches, distanceKm, fromVec3, fullWorld, greatCircle, isLand, landRings,
  territoryAt, toVec3, worldLinks, worldMap, worldRegions, type WorldMap,
} from '../src/conquest/world/geo';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TERRAINS = ['plains', 'forest', 'mountain', 'lakes', 'river', 'coast', 'urban', 'steppe', 'islands'];
const CLIMATES = ['temperate', 'winter', 'desert', 'tropical'];
const CULTURES = ['western', 'nordic', 'slavic', 'mediterranean', 'middle-eastern', 'african', 'south-asian', 'east-asian', 'southeast-asian', 'north-american', 'latin-american', 'oceanian'];
const CONTINENTS = ['europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania'];
const FEATURES: MapFeature[] = ['river', 'coast', 'harbour', 'island', 'mountains', 'canyon', 'dunes', 'jungle', 'lakes', 'city', 'town', 'farmland', 'oasis', 'glacier', 'volcano'];
const RESOURCES: WorldResource[] = ['oil', 'ore', 'industry', 'grain', 'manpower', 'science', 'port'];

/** Connected over the links? */
function connected(ids: readonly string[], links: readonly { a: string; b: string }[]): boolean {
  const adj = new Map<string, string[]>();
  for (const l of links) { (adj.get(l.a) ?? adj.set(l.a, []).get(l.a)!).push(l.b); (adj.get(l.b) ?? adj.set(l.b, []).get(l.b)!).push(l.a); }
  const seen = new Set([ids[0]]);
  const stack = [ids[0]];
  while (stack.length) for (const v of adj.get(stack.pop()!) ?? []) if (!seen.has(v)) { seen.add(v); stack.push(v); }
  return ids.every((id) => seen.has(id));
}
const linked = (m: WorldMap, a: string, b: string) => m.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

describe('world regions', () => {
  test('about 120 regions on every continent, every field filled', () => {
    assert.ok(WORLD_REGIONS.length >= 110 && WORLD_REGIONS.length <= 135, `${WORLD_REGIONS.length} regions`);
    const ids = new Set<string>();
    for (const r of WORLD_REGIONS) {
      const at = `region ${r.id}`;
      assert.ok(/^[a-z][a-z-]*$/.test(r.id) && !ids.has(r.id), `${at}: id unique and plain`);
      ids.add(r.id);
      assert.ok(r.name.trim().length > 1, `${at}: name`);
      assert.ok(r.lon >= -180 && r.lon <= 180 && r.lat > -60 && r.lat < 80, `${at}: lon/lat`);
      assert.ok(CONTINENTS.includes(r.continent), `${at}: continent`);
      const zone = WORLD_ZONES.find((z) => z.id === r.zone);
      assert.ok(zone, `${at}: zone ${r.zone} exists`);
      assert.equal(zone!.continent, r.continent, `${at}: on its zone's continent`);
      assert.ok(TERRAINS.includes(r.terrain) && CLIMATES.includes(r.climate) && CULTURES.includes(r.culture), `${at}: terrain/climate/culture`);
      assert.ok(r.features.length >= 2 && r.features.length <= 5 && new Set(r.features).size === r.features.length && r.features.every((f) => FEATURES.includes(f)), `${at}: features`);
      assert.ok(r.resources.length >= 1 && r.resources.every((x) => RESOURCES.includes(x)), `${at}: resources`);
      if (r.iso) assert.ok(/^[A-Z]{2}$/.test(r.iso), `${at}: iso code`);
    }
    for (const c of CONTINENTS) assert.ok(WORLD_REGIONS.filter((r) => r.continent === c).length >= 6, `continent ${c} has regions`);
    for (const c of CLIMATES) assert.ok(WORLD_REGIONS.some((r) => r.climate === c), `climate ${c} used`);
    for (const c of CULTURES) assert.ok(WORLD_REGIONS.some((r) => r.culture === c), `culture ${c} used`);
  });

  test('every region is on land, and harbours are on the coast', () => {
    const off = WORLD_REGIONS.filter((r) => !isLand(r.lon, r.lat)).map((r) => r.id);
    assert.deepEqual(off, [], `regions in the sea: ${off.join(', ')}`);
    const m = fullWorld();
    const inland = WORLD_REGIONS.filter((r) => r.features.includes('harbour') && !m.territories.find((t) => t.id === r.id)!.coastal).map((r) => r.id);
    assert.deepEqual(inland, [], `harbours without a coast: ${inland.join(', ')}`);
  });

  test('nothing named for, or placed in, an area disputed today; no holy site', () => {
    const BANNED = /taiwan|formosa|kashmir|crimea|tibet|western sahara|kosovo|falkland|malvinas|jerusalem|mecca|medina|vatican|palestin|israel|golan|abkhaz|ossetia|karabakh|transnistria/i;
    const names = [...WORLD_REGIONS.map((r) => r.name), ...WORLD_HOMELANDS.map((h) => h.name), ...WORLD_ZONES.map((z) => z.name), ...Object.values(LANDMARK_INFO).map((l) => l.name)];
    const bad = names.filter((n) => BANNED.test(n));
    assert.deepEqual(bad, [], `disputed or holy names: ${bad.join(', ')}`);
    // [west, south, east, north] boxes around areas disputed today
    const AREAS: Record<string, [number, number, number, number]> = {
      Taiwan: [119.9, 21.8, 122.1, 25.4], Kashmir: [72.5, 32.2, 80.5, 37.1], Crimea: [32.4, 44.3, 36.7, 46.2], Tibet: [78.4, 28.5, 99.1, 36.5],
      'Western Sahara': [-17.2, 20.8, -8.6, 27.7], Kosovo: [20.0, 41.85, 21.8, 43.27], Falklands: [-61.5, -52.5, -57.6, -51.0],
      'Jerusalem and the West Bank': [34.2, 31.2, 35.6, 32.6], Transnistria: [28.5, 46.5, 30.1, 48.2], 'Abkhazia and South Ossetia': [40.0, 42.0, 44.6, 43.6],
      'Nagorno-Karabakh': [46.0, 39.4, 47.2, 40.4],
    };
    for (const r of WORLD_REGIONS) for (const [name, [w, s, e, n]] of Object.entries(AREAS)) {
      assert.ok(!(r.lon >= w && r.lon <= e && r.lat >= s && r.lat <= n), `region ${r.id} is placed in ${name}`);
    }
    // no region is centred on a holy city (Rome's own landmark is the Colosseum, the Vatican is no objective)
    for (const [name, ll] of Object.entries({ Mecca: [39.83, 21.42], Medina: [39.61, 24.47], Jerusalem: [35.23, 31.78] } as Record<string, [number, number]>)) {
      for (const r of WORLD_REGIONS) assert.ok(distanceKm([r.lon, r.lat], ll) > 120, `region ${r.id} sits on ${name}`);
    }
  });

  test('disputed islands and peninsulas are folded into a neighbouring region', () => {
    const m = fullWorld();
    const owner = (lon: number, lat: number) => territoryAt(m, lon, lat);
    assert.ok(owner(121.0, 23.7), 'the island off Fujian belongs to a coastal region');
    assert.equal(owner(-59.0, -51.7), 'patagonia', 'the South Atlantic islands are part of Patagonia');
    assert.equal(owner(34.1, 45.0), 'odessa', 'the Black Sea peninsula is part of the steppe region around Odessa');
    assert.ok(owner(75.0, 34.0), 'the Kashmir valley belongs to a mountain region around it');
    assert.ok(owner(91.0, 31.0), 'the high plateau belongs to a region around it');
  });
});

describe('world zones', () => {
  test('14-18 zones of 4-9 regions, bonuses from their size and borders', () => {
    assert.ok(WORLD_ZONES.length >= 14 && WORLD_ZONES.length <= 18, `${WORLD_ZONES.length} zones`);
    const m = fullWorld();
    for (const z of WORLD_ZONES) {
      const n = WORLD_REGIONS.filter((r) => r.zone === z.id).length;
      assert.ok(n >= 4 && n <= 9, `zone ${z.id}: ${n} regions`);
      const info = m.zones.find((x) => x.id === z.id)!;
      assert.equal(z.bonus, info.bonus, `zone ${z.id}: bonus ${z.bonus} matches zoneBonus(${info.territories.length}, ${info.borders}) = ${info.bonus}`);
      assert.ok(z.bonus >= 1 && z.bonus <= 7, `zone ${z.id}: bonus ${z.bonus} sane`);
    }
    for (const c of CONTINENTS) assert.ok(WORLD_ZONES.some((z) => z.continent === c), `continent ${c} has a zone`);
    // Risk's own board, for scale
    assert.deepEqual([zoneBonus(4, 1), zoneBonus(4, 2), zoneBonus(6, 3)], [2, 2, 3], 'Australia, South America, Africa as in Risk');
    const perTerritory = m.zones.reduce((s, z) => s + z.bonus, 0) / m.territories.length;
    assert.ok(perTerritory > 0.45 && perTerritory < 0.8, `zone bonus per territory ${perTerritory.toFixed(2)} (Risk: 0.57)`);
  });
});

describe('world homelands', () => {
  test('about 40 homelands on every continent, each valid', () => {
    assert.ok(WORLD_HOMELANDS.length >= 36 && WORLD_HOMELANDS.length <= 48, `${WORLD_HOMELANDS.length} homelands`);
    const taken = new Map<string, string>();
    for (const h of WORLD_HOMELANDS) {
      const at = `homeland ${h.id}`;
      assert.equal(HOMELAND_BY_ID[h.id], h, `${at}: id unique`);
      assert.ok(h.name.trim() && h.blurb.trim().length > 20 && h.blurb.length <= 160, `${at}: name and one-line blurb`);
      assert.ok(h.regions.length >= 1 && h.regions.length <= 3, `${at}: 1-3 starting regions`);
      assert.ok(h.regions.includes(h.capital), `${at}: capital among its regions`);
      assert.ok(h.faction === 'allies' || h.faction === 'soviet', `${at}: faction`);
      for (const id of h.regions) {
        const r = REGION_BY_ID[id];
        assert.ok(r, `${at}: region ${id} exists`);
        assert.equal(r.homeland, h.id, `${at}: region ${id} points back`);
        assert.ok(r.core, `${at}: region ${id} is core (always on the map)`);
        assert.ok(!taken.has(id), `${at}: region ${id} also belongs to ${taken.get(id)}`);
        taken.set(id, h.id);
      }
    }
    for (const r of WORLD_REGIONS) if (r.homeland) assert.ok(HOMELAND_BY_ID[r.homeland]?.regions.includes(r.id), `region ${r.id}: homeland ${r.homeland} lists it`);
    for (const c of CONTINENTS) assert.ok(WORLD_HOMELANDS.filter((h) => REGION_BY_ID[h.capital].continent === c).length >= 2, `continent ${c} has homelands`);
    assert.ok(WORLD_HOMELANDS.some((h) => h.faction === 'soviet') && WORLD_HOMELANDS.filter((h) => h.faction === 'soviet').length >= 8, 'both doctrines are defaults somewhere');
    assert.ok(HOMELAND_BY_ID.iceland, 'Iceland is a homeland (the share card example)');
  });
});

describe('world landmarks', () => {
  test('every landmark is placed exactly once, with a fitting wonder', () => {
    for (const id of LANDMARK_IDS) {
      const at = REGION_BY_ID[LANDMARK_INFO[id]?.region];
      assert.ok(at, `landmark ${id}: its region exists`);
      assert.equal(at.landmark, id, `landmark ${id}: region ${at.id} carries it`);
      assert.equal(WORLD_REGIONS.filter((r) => r.landmark === id).length, 1, `landmark ${id}: placed exactly once`);
      assert.ok(at.core, `landmark ${id}: region ${at.id} is core (always on the map)`);
      const info = LANDMARK_INFO[id];
      assert.ok(info.name.trim() && info.blurb.trim().length > 20, `landmark ${id}: name and blurb`);
      const w = info.wonder;
      const v = 'add' in w ? w.add : 'pct' in w ? w.pct : 'every' in w ? w.every : 'dice' in w ? w.dice : w.turns;
      const ok = { troops: [1, 3], income: [10, 30], card: [3, 5], defence: [1, 1], attack: [1, 1], fortify: [1, 2], navy: [1, 2], intel: [1, 2], diplomacy: [10, 30] }[w.kind];
      assert.ok(v >= ok[0] && v <= ok[1], `landmark ${id}: wonder ${w.kind} ${v} in range`);
    }
    assert.equal(Object.keys(LANDMARK_INFO).length, LANDMARK_IDS.length, 'no extra landmark entries');
    const kinds = new Set(Object.values(LANDMARK_INFO).map((l) => l.wonder.kind));
    assert.ok(kinds.size >= 8, `wonders vary (${[...kinds].join(', ')})`);
  });
});

describe('world geography', () => {
  test('the outline: Natural Earth 110m land and lakes decode, and isLand knows land from sea and lakes', () => {
    const rings = landRings();
    const holes = rings.filter((r) => r.hole).length;
    assert.ok(rings.length > 140 && holes === 25, `${rings.length} rings, ${holes} holes (the Caspian and 24 lakes)`);
    const pts = rings.reduce((s, r) => s + r.ring.length, 0);
    assert.ok(pts > 5000 && pts < 6500, `${pts} points`);
    const cases: [string, number, number, boolean][] = [
      ['Paris', 2.35, 48.86, true], ['the mid-Atlantic', -30, 30, false], ['the Caspian Sea', 50.5, 42, false], ['the Sahara', 10, 20, true],
      ['the Gulf of Guinea', 0, 0, false], ['Antarctica', 0, -85, true], ['the North Pacific', -150, 35, false], ['Siberia', 100, 62, true],
      ['the Amazon', -60, -5, true], ['the Tasman Sea', 160, -38, false], ['wrapped longitude', 362.35, 48.86, true],
      ['Lake Superior', -87.5, 47.6, false], ['Lake Michigan', -87, 44, false], ['Lake Victoria', 33, -1, false], ['Lake Baikal', 108.2, 53.3, false],
      ['Lake Ladoga', 31.5, 60.8, false], ['the land between Huron and Ontario', -80.5, 43.5, true],
    ];
    for (const [name, lon, lat, land] of cases) assert.equal(isLand(lon, lat), land, `${name} (${lon}, ${lat}) ${land ? 'is land' : 'is sea'}`);
  });

  test('projection helpers', () => {
    for (const [lon, lat] of [[0, 0], [90, 0], [-120, 45], [179.5, -33], [10, 89]] as [number, number][]) {
      const [x, y, z] = toVec3(lon, lat, 2);
      const [lo, la] = fromVec3(x, y, z);
      assert.ok(Math.abs(lo - lon) < 1e-9 && Math.abs(la - lat) < 1e-9, `round trip ${lon},${lat}`);
    }
    assert.deepEqual(toVec3(0, 0).map((v) => Math.round(v)), [0, 0, 1], '(0, 0) faces +z');
    assert.deepEqual(toVec3(90, 0).map((v) => Math.round(v)), [1, 0, 0], '90E is +x');
    assert.ok(Math.abs(distanceKm([-0.13, 51.51], [2.35, 48.86]) - 344) < 5, 'London-Paris is about 344 km');
    const gc = greatCircle([170, 0], [-170, 0], 4);
    assert.ok(gc.every((p, i) => i === 0 || Math.abs(p[0] - gc[i - 1][0]) < 10), 'great circles cross the date line continuously');
  });

  test('the full world: every territory has land, a label inside it and links; the graph is connected', () => {
    const m = fullWorld();
    assert.equal(m.territories.length, WORLD_REGIONS.length, 'one territory per region');
    for (const t of m.territories) {
      assert.ok(t.areaKm2 > 10000, `${t.id}: area ${t.areaKm2} km²`);
      assert.equal(territoryAt(m, t.anchor[0], t.anchor[1]), t.id, `${t.id}: its label anchor lies inside it`);
      const atSite = territoryAt(m, t.site[0], t.site[1]);
      assert.ok(atSite === t.id || atSite === null, `${t.id}: its site lies in it (got ${atSite})`);
      assert.ok(t.rings.length >= 1 && t.rings.every((r) => r.length >= 3), `${t.id}: outline rings`);
      assert.ok(m.links.some((l) => l.a === t.id || l.b === t.id), `${t.id}: has a neighbour`);
    }
    assert.ok(connected(m.regions, m.links), 'the full world is connected');
    for (const l of m.links) {
      assert.ok(l.a < l.b && REGION_BY_ID[l.a] && REGION_BY_ID[l.b], `link ${l.a}-${l.b} well-formed`);
      if (l.sea) {
        assert.ok(l.path && l.path.length >= 2, `sea lane ${l.a}-${l.b} has a route`);
        const [s0, s1] = [l.path![0], l.path![l.path!.length - 1]];
        assert.ok(distanceKm(s0, m.territories.find((t) => t.id === l.a)!.anchor) <= distanceKm(s1, m.territories.find((t) => t.id === l.a)!.anchor) + 1, `sea lane ${l.a}-${l.b} runs from ${l.a} to ${l.b}`);
      }
    }
    assert.equal(new Set(m.links.map((l) => `${l.a}|${l.b}`)).size, m.links.length, 'each pair once');
    const seaLanes = m.links.filter((l) => l.sea).length;
    assert.ok(seaLanes >= 35 && seaLanes <= 90, `${seaLanes} sea lanes`);
  });

  test('sea lanes cross the straits and the classic long routes', () => {
    const m = fullWorld();
    const want: [string, string, boolean][] = [
      ['kolyma', 'alaska', true], ['andalusia', 'casablanca', true], ['thames', 'flanders', true], ['scotland', 'ireland', true], ['washington', 'havana', true],
      ['istanbul', 'anatolia', true], ['korea', 'kansai', true], ['vladivostok', 'tokyo', true], ['iceland', 'greenland', true], ['arabia', 'khartoum', true],
      ['paris', 'flanders', false], ['berlin', 'warsaw', false], ['cairo', 'petra', false], ['panama', 'bogota', false],
    ];
    for (const [a, b, sea] of want) {
      const l = linked(m, a, b);
      assert.ok(l, `${a} and ${b} are linked`);
      assert.equal(l!.sea, sea, `${a}-${b} is ${sea ? 'a sea lane' : 'a land border'}`);
    }
    for (const [a, b] of LONG_LANES) {
      assert.ok(REGION_BY_ID[a] && REGION_BY_ID[b], `long lane ${a}-${b}: regions exist`);
      assert.ok(linked(m, a, b)?.sea, `long lane ${a}-${b} is on the full map`);
    }
    // no continent is an island in the graph: every continent links to another
    for (const c of CONTINENTS) {
      assert.ok(m.links.some((l) => (REGION_BY_ID[l.a].continent === c) !== (REGION_BY_ID[l.b].continent === c)), `${c} links to another continent`);
    }
  });

  test('World selections: ~100 territories, every core region, connected, seeded', () => {
    const core = WORLD_REGIONS.filter((r) => r.core).map((r) => r.id);
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 0xdeadbeef]) {
      const ids = worldRegions(seed);
      assert.deepEqual(ids, worldRegions(seed), `seed ${seed}: same selection twice`);
      assert.ok(ids.length >= 95 && ids.length <= 110, `seed ${seed}: ${ids.length} territories`);
      assert.ok(core.every((id) => ids.includes(id)), `seed ${seed}: every core region`);
      for (const z of WORLD_ZONES) assert.ok(ids.filter((id) => REGION_BY_ID[id].zone === z.id).length >= 4, `seed ${seed}: zone ${z.id} keeps 4+`);
      const m = buildWorld(ids);
      assert.ok(connected(ids, m.links), `seed ${seed}: connected`);
      seen.add(ids.join());
    }
    assert.ok(seen.size >= 3, 'different seeds pick different worlds');
  });

  test('Blitz: every homeland gets ~30 territories of whole zones around it, connected, with rivals to fight', () => {
    const capitals = new Set(WORLD_HOMELANDS.map((h) => h.capital));
    for (const seed of [1, 7]) {
      const world = worldRegions(seed);
      for (const h of WORLD_HOMELANDS) {
        const at = `seed ${seed} ${h.id}`;
        const ids = blitzRegions(seed, h.id);
        assert.ok(ids.length >= BLITZ_MIN && ids.length <= BLITZ_MAX, `${at}: ${ids.length} territories`);
        assert.ok(h.regions.every((r) => ids.includes(r)), `${at}: includes the homeland`);
        assert.ok(ids.every((id) => world.includes(id)), `${at}: cut from the World selection`);
        for (const z of new Set(ids.map((id) => REGION_BY_ID[id].zone))) {
          assert.ok(world.filter((id) => REGION_BY_ID[id].zone === z).every((id) => ids.includes(id)), `${at}: zone ${z} whole`);
        }
        assert.ok(ids.filter((id) => capitals.has(id)).length >= 5, `${at}: room for 4+ rival capitals`);
        const m = buildWorld(ids, world);
        assert.ok(connected(ids, m.links), `${at}: connected`);
      }
    }
  });

  test('no territory is split by a lake', () => {
    const m = fullWorld();
    const { w, h, label } = m.raster;
    const pieces = (k: number) => {
      const seen = new Uint8Array(w * h);
      const sizes: number[] = [];
      for (let p = 0; p < w * h; p++) {
        if (label[p] !== k || seen[p]) continue;
        let n = 0;
        const stack = [p];
        seen[p] = 1;
        while (stack.length) {
          const q = stack.pop()!, y = (q / w) | 0, x = q - y * w;
          n++;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (y + dy < 0 || y + dy >= h) continue;
            const r = (y + dy) * w + ((x + dx + w) % w);
            if (!seen[r] && label[r] === k) { seen[r] = 1; stack.push(r); }
          }
        }
        sizes.push(n);
      }
      return sizes.filter((n) => n >= 20).length;
    };
    for (const id of ['ontario', 'chicago', 'kilimanjaro', 'baikal', 'leningrad', 'prairies', 'congo', 'zambezi', 'finland', 'samarkand', 'cusco', 'panama']) {
      assert.equal(pieces(m.regions.indexOf(id)), 1, `${id} is one piece of land`);
    }
  });

  test('a Blitz map keeps its World shapes; land off the map is nobody\'s', () => {
    const seed = 11;
    const world = worldMap(seed, 'world', 'britain');
    const blitz = worldMap(seed, 'blitz', 'britain');
    assert.ok(blitz.regions.length < world.regions.length, 'Blitz is smaller');
    for (const t of blitz.territories) {
      const w = world.territories.find((x) => x.id === t.id)!;
      assert.equal(t.areaKm2, w.areaKm2, `${t.id}: same area as on the World map`);
    }
    assert.equal(territoryAt(blitz, 151.2, -33.8), null, 'Sydney is off a British Blitz map');
    assert.equal(territoryAt(blitz, -0.13, 51.51), 'london', 'London is on it');
    const wl = worldLinks(blitz.regions, world.regions);
    assert.ok(wl.every((l) => blitz.regions.includes(l.a) && blitz.regions.includes(l.b)), 'worldLinks stays within the map');
  });

  test('generation is deterministic (a fresh build is identical, and pinned)', () => {
    const digest = (m: WorldMap) => crypto.createHash('sha256')
      .update(JSON.stringify({ regions: m.regions, links: m.links, zones: m.zones, t: m.territories.map((t) => [t.id, t.anchor, t.areaKm2, t.rings.length]) }))
      .update(Buffer.from(m.raster.label.buffer)).digest('hex').slice(0, 16);
    const a = digest(fullWorld());
    const b = digest(worldMap(5, 'blitz', 'brazil'));
    clearGeoCaches();
    assert.equal(digest(fullWorld()), a, 'the full world rebuilds identically');
    assert.equal(digest(worldMap(5, 'blitz', 'brazil')), b, 'a Blitz map rebuilds identically');
    // pinned: a change here changes every seeded world (and its links): update deliberately
    assert.equal(a, FULL_WORLD_DIGEST, `full-world digest changed to ${a}: if the region data or geo.ts changed on purpose, update FULL_WORLD_DIGEST`);
  });

  test('performance: a cold World map builds quickly', () => {
    clearGeoCaches();
    const t0 = performance.now();
    worldMap(99, 'world', 'iceland');
    const ms = performance.now() - t0;
    assert.ok(ms < 4000, `World map built in ${ms.toFixed(0)} ms`);
  });

  test('size budget: the outline and the region data stay small', () => {
    const gz = (f: string) => zlib.gzipSync(fs.readFileSync(path.join(ROOT, f)), { level: 9 }).length;
    const land = gz('src/conquest/world/data/land110.ts'), regions = gz('src/conquest/world/regions.ts'), geo = gz('src/conquest/world/geo.ts');
    assert.ok(land <= 40 * 1024, `land outline ${land} B gzipped (budget 40 KB)`);
    assert.ok(land + regions + geo <= 70 * 1024, `geography data and code ${land + regions + geo} B gzipped`);
    const src = fs.readFileSync(path.join(ROOT, 'src/conquest/world/data/land110.ts'), 'utf8');
    assert.ok(/Natural Earth/.test(src) && /public domain/.test(src) && /sha256/.test(src), 'the data file records its provenance');
  });
});

describe('world names', () => {
  test('names in English, translated through the catalogue', async () => {
    const { regionName, zoneName, homelandName, homelandBlurb, landmarkName, landmarkBlurb } = await import('../src/conquest/world/names');
    assert.equal(regionName('kyiv'), 'Kyiv', 'English region name');
    assert.equal(zoneName('scandinavia'), 'Scandinavia', 'zone name');
    assert.equal(homelandName('iceland'), 'Iceland', 'homeland name');
    assert.ok(homelandBlurb('iceland').includes('North Atlantic'), 'homeland blurb');
    assert.equal(landmarkName('eiffel-tower'), 'Eiffel Tower', 'landmark name');
    assert.ok(landmarkBlurb('pyramids').length > 20, 'landmark blurb');
    assert.equal(regionName('atlantis'), 'atlantis', 'unknown ids come back as they are');
    const { registerLocale, setLanguage, trSource } = await import('../src/i18n/core');
    const g = globalThis as unknown as { localStorage?: Storage };
    const saved = g.localStorage;
    const mem = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage;
    try {
      for (const lang of ['ru', 'zh-CN'] as const) {
        registerLocale(lang, JSON.parse(fs.readFileSync(path.join(ROOT, `src/i18n/locales/${lang}.json`), 'utf8')));
        await setLanguage(lang);
        for (const r of WORLD_REGIONS) assert.notEqual(regionName(r.id), '', `${lang}: ${r.id} named`);
        assert.equal(regionName('kyiv'), lang === 'ru' ? 'Киев' : '基辅', `${lang}: Kyiv`);
        assert.equal(homelandName('iceland'), lang === 'ru' ? 'Исландия' : '冰岛', `${lang}: Iceland`);
        assert.equal(trSource('Iceland'), lang === 'ru' ? 'Исландия' : '冰岛', `${lang}: a name inside emitted English`);
      }
    } finally {
      await setLanguage('auto');
      if (saved) g.localStorage = saved; else delete g.localStorage;
    }
  });
});

/** sha256 prefix of the full world's regions, links, zones, territories and raster (see the determinism test). */
const FULL_WORLD_DIGEST = 'ecb3096c27d50baa';
