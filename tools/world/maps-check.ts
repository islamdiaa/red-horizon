// World Conquest region battlefields: generate and check them headlessly (MAPS).
//   node --import tsx tools/world/maps-check.ts [--seeds 4] [--ascii] [--only <labelFilter>] [--case k=v,...]
// Prints one line per battlefield (time, honoured features, paths, ore, room, landmark visibility) and, with
// --ascii, the map as characters (. clear  , dirt  : sand  ~ water  # rock  T tree  $ ore  B civilian  L landmark
// = bridge  A/D/E starts).
import { generateRegion, REGION_KINDS, type RegionOptions } from '../../src/sim/mapgen-region';
import { T } from '../../src/sim/map';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const seeds = +arg('seeds', '2');
const ascii = process.argv.includes('--ascii');
const CASES: Omit<RegionOptions, 'seed' | 'kind' | 'players'>[] = [
  { terrain: 'river', climate: 'desert', culture: 'middle-eastern', features: ['river', 'farmland', 'town'], landmark: 'pyramids', strength: 3, region: 'cairo' },
  { terrain: 'urban', climate: 'temperate', culture: 'western', features: ['city', 'river'], landmark: 'eiffel-tower', strength: 4, region: 'paris' },
  { terrain: 'coast', climate: 'temperate', culture: 'oceanian', features: ['harbour', 'city'], landmark: 'harbour-bridge', strength: 3, region: 'sydney' },
  { terrain: 'mountain', climate: 'temperate', culture: 'latin-american', features: ['mountains', 'town'], landmark: 'machu-picchu', strength: 2, region: 'andes' },
  { terrain: 'forest', climate: 'temperate', culture: 'southeast-asian', features: ['jungle', 'river'], landmark: 'angkor-wat', strength: 2, region: 'angkor' },
  { terrain: 'steppe', climate: 'desert', culture: 'middle-eastern', features: ['dunes', 'oasis'], landmark: 'petra', strength: 2, region: 'petra' },
  { terrain: 'mountain', climate: 'winter', culture: 'nordic', features: ['glacier', 'mountains'], strength: 3, region: 'norway' },
  { terrain: 'plains', climate: 'temperate', culture: 'east-asian', features: ['volcano', 'farmland', 'town'], landmark: 'mount-fuji', strength: 3, region: 'fuji' },
  { terrain: 'river', climate: 'temperate', culture: 'western', features: ['river', 'city'], landmark: 'tower-bridge', strength: 5, region: 'london' },
  { terrain: 'islands', climate: 'temperate', culture: 'north-american', features: ['island', 'harbour'], landmark: 'statue-of-liberty', strength: 3, region: 'nyc' },
  { terrain: 'mountain', climate: 'desert', culture: 'north-american', features: ['canyon'], landmark: 'mount-rushmore', strength: 2, region: 'dakota' },
];
const filter = arg('only', '');
if (process.argv.includes('--geo')) {
  // every GEO region (src/conquest/world/regions.ts) instead of the sample looks
  const { WORLD_REGIONS } = await import('../../src/conquest/world/regions');
  CASES.length = 0;
  for (const r of WORLD_REGIONS) CASES.push({ terrain: r.terrain, climate: r.climate, culture: r.culture, features: [...r.features], landmark: r.landmark, strength: +arg('strength', '3'), region: r.id });
}
const fmt = (n: number) => n.toFixed(0).padStart(4);
let bad = 0, worst = 0;
for (const cs of CASES) {
  if (filter && !(cs.region ?? '').includes(filter)) continue;
  for (const kind of REGION_KINDS) for (let s = 0; s < seeds; s++) {
    const o: RegionOptions = { ...cs, kind, seed: 1000 + s * 7919, players: kind === 'boss' ? 3 : 2 };
    const t0 = performance.now();
    const r = generateRegion(o);
    const p = r.report;
    p.ms = performance.now() - t0;
    worst = Math.max(worst, p.ms);
    const ok = p.paths && p.seaPath && !p.ponds && p.ore.every((n) => n > 20) && p.room.every((n) => n > 120) && (!o.landmark || (p.landmark?.visible ?? false));
    if (!ok) bad++;
    if (!ok || !process.argv.includes('--quiet')) console.log(`${ok ? 'ok ' : 'BAD'} ${(cs.region ?? '').padEnd(7)} ${kind.padEnd(6)} s${s} ${fmt(p.ms)}ms N${p.size} paths=${+p.paths}${kind === 'naval' ? ` sea=${+p.seaPath}` : ''} ore=${p.ore.join('/')} near=${p.oreNear.join('/')} room=${p.room.join('/')} lm=${p.landmark ? `${p.landmark.id}:${p.landmark.visible ? 'vis' : 'HIDDEN'}@${p.landmark.distance.toFixed(0)}` : '-'} civ=${p.civilians}${p.dropped ? `(-${p.dropped})` : ''} br=${p.bridges}${p.ponds ? ` PONDS=${p.ponds}` : ''} rep=${p.repairs} feat=${p.honoured.join(',')}/${p.features.join(',')}`);
    if (ascii && (s === +arg("seed", "0")) && kind === arg("kind", "attack")) {
      const m = r.map;
      const occ = new Map<number, string>();
      for (const st of r.sites) for (let y = st.cy; y < st.cy + +st.type[3]; y++) for (let x = st.cx; x < st.cx + +st.type[2]; x++) occ.set(y * m.w + x, 'B');
      if (r.landmark) for (let y = r.landmark.cy; y < r.landmark.cy + r.landmark.h; y++) for (let x = r.landmark.cx; x < r.landmark.cx + r.landmark.w; x++) occ.set(y * m.w + x, 'L');
      for (const b of m.bridges) for (const [x, y] of b.cells) occ.set(y * m.w + x, '=');
      m.startPositions.forEach((st, k) => occ.set(Math.floor(st.y) * m.w + Math.floor(st.x), 'ADEF'[k]));
      for (let y = 0; y < m.h; y++) {
        let line = '';
        for (let x = 0; x < m.w; x++) {
          const i = y * m.w + x;
          const o2 = occ.get(i);
          if (o2) { line += o2; continue; }
          const t = m.terrain[i];
          line += m.ore[i] ? '$' : m.tree[i] ? 'T' : t === T.Water ? '~' : t === T.Rock ? '#' : t === T.Sand ? ':' : t === T.Dirt ? ',' : '.';
        }
        console.log(line);
      }
    }
  }
}
console.log(`${bad} bad, worst ${worst.toFixed(0)} ms`);
