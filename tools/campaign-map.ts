// ASCII preview of a mission map: node --import tsx tools/campaign-map.ts <missionId | seed> [size players water trees ore climate]
// With a mission id the mission setup runs and structures/units are overlaid:
//   structures: first letter of the id in upper case for enemies, lower case for the human (walls '#')
//   units: digits = owner id. STEP=2 halves the rows.
import { generateMap } from '../src/sim/mapgen';
import { getMission } from '../src/missions';
import { createMissionWorld } from './campaigntest';
import type { GameMap } from '../src/sim/map';

const arg = process.argv[2] ?? '1';
const base = getMission(arg);
const def = base && process.env.SEED ? { ...base, map: { ...base.map, seed: +process.env.SEED, ...(process.env.TREES ? { trees: +process.env.TREES } : {}) } } : base;
let map: GameMap;
const marks = new Map<number, string>();
if (def) {
  const { world } = createMissionWorld(def);
  map = world.map;
  for (const b of world.buildings) {
    if (!b.alive) continue;
    const id = b.bt.id === 'tsla' ? 'z' : b.bt.id === 'ftur' ? 'f' : b.bt.id;
    const ch = b.bt.wall ? '#' : b.owner.id === 0 ? id[0].toLowerCase() : id[0].toUpperCase();
    for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) marks.set(map.idx(b.cx + dx, b.cy + dy), ch);
  }
  for (const u of world.units) if (u.alive) marks.set(map.idx(Math.floor(u.x), Math.floor(u.y)), String(u.owner.id));
} else {
  const seed = +arg;
  const [size, players, water, trees, ore] = [+(process.argv[3] ?? 80), +(process.argv[4] ?? 2), +(process.argv[5] ?? 0.4), +(process.argv[6] ?? 0.5), +(process.argv[7] ?? 0.6)];
  const climate = process.argv[8] ?? 'temperate';
  map = generateMap({
    size, players, seed, ore,
    water: climate === 'desert' ? Math.min(water, 0.2) : water,
    trees: climate === 'desert' ? trees * 0.35 : climate === 'winter' ? Math.min(1, trees * 1.2) : trees,
  });
  map.startPositions.forEach((s, k) => marks.set(map.idx(Math.floor(s.x), Math.floor(s.y)), '@' + k));
}
const ch = (i: number) => marks.get(i)?.[0] ?? (map.ore[i] ? (map.gems[i] ? '*' : '$') : map.tree[i] ? 'T' : ['.', '~', '^', ':', ','][map.terrain[i]]);
const step = +(process.env.STEP ?? 1);
let hdr = '    ';
for (let x = 0; x < map.w; x++) hdr += x % 10 === 0 ? String((x / 10) % 10) : ' ';
console.log(hdr);
for (let y = 0; y < map.h; y += step) {
  let row = String(y).padStart(3) + ' ';
  for (let x = 0; x < map.w; x++) {
    let c = ch(map.idx(x, y));
    if (step > 1 && y + 1 < map.h && marks.has(map.idx(x, y + 1)) && !marks.has(map.idx(x, y))) c = ch(map.idx(x, y + 1));
    row += c;
  }
  console.log(row);
}
console.log('starts', map.startPositions.map((s) => `(${s.x},${s.y})`).join(' '));
let water_ = 0, rock = 0, tree = 0, ore_ = 0;
for (let i = 0; i < map.w * map.h; i++) { if (map.terrain[i] === 1) water_++; if (map.terrain[i] === 2) rock++; if (map.tree[i]) tree++; if (map.ore[i]) ore_++; }
const n = map.w * map.h;
console.log(`water ${(water_ / n * 100).toFixed(0)}% rock ${(rock / n * 100).toFixed(0)}% trees ${(tree / n * 100).toFixed(0)}% ore ${(ore_ / n * 100).toFixed(0)}%`);
