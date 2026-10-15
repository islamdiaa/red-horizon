/**
 * Shareable map codes for generated skirmish maps.
 *
 * A code packs every input of the map generator plus the seed, so pasting it reproduces the exact
 * battlefield (terrain, ore, start positions):
 *
 *     C2TAAC-3W5KQ1Z
 *     │││││└ ore     ┐ amount × 20, one base-36 digit each (0 … K)
 *     ││││└─ trees   │
 *     │││└── water   ┘
 *     ││└─── climate T(emperate) / W(inter) / D(esert)
 *     │└──── players 2-4
 *     └───── size / 8 in base 36 (8 = 64, C = 96, G = 128)
 *            -3W5KQ1  seed in base 36, then one check digit (Z)
 *
 * Codes are case-insensitive; spaces and dashes are ignored when reading.
 */
import type { Climate } from './format';
import type { MapGenOptions } from '../sim/mapgen';

export interface GenParams {
  size: number;
  players: number;
  water: number;
  trees: number;
  ore: number;
  climate: Climate;
  seed: number;
}

const CLIMATE_CH: Record<Climate, string> = { temperate: 'T', winter: 'W', desert: 'D' };
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Amounts are stored in steps of 1/20; k / 20 is the double the menu would produce for that value. */
export const quantize = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 20) / 20;

function check(body: string): string {
  let h = 7;
  for (let i = 0; i < body.length; i++) h = (h * 31 + B36.indexOf(body[i]) * (i + 3)) % 1000003;
  return B36[h % 36];
}

/** Normalise the parameters exactly as the code stores them (use these to start the game). */
export function normaliseParams(p: GenParams): GenParams {
  return {
    size: Math.max(32, Math.min(280, Math.round(p.size / 8) * 8)),
    players: Math.max(2, Math.min(4, Math.round(p.players))),
    water: quantize(p.water), trees: quantize(p.trees), ore: quantize(p.ore),
    climate: p.climate in CLIMATE_CH ? p.climate : 'temperate',
    seed: Math.abs(Math.trunc(p.seed)) % 0x7fffffff,
  };
}

export function encodeMapCode(params: GenParams): string {
  const p = normaliseParams(params);
  const head = B36[p.size / 8] + p.players + CLIMATE_CH[p.climate] + B36[Math.round(p.water * 20)] + B36[Math.round(p.trees * 20)] + B36[Math.round(p.ore * 20)];
  const seed = p.seed.toString(36).toUpperCase();
  return `${head}-${seed}${check(head + seed)}`;
}

export function decodeMapCode(code: string): GenParams | null {
  const s = code.toUpperCase().replace(/[\s-]/g, '');
  const m = /^([4-9A-Z])([2-4])([TWD])([0-9A-K])([0-9A-K])([0-9A-K])([0-9A-Z]{1,7})([0-9A-Z])$/.exec(s);
  if (!m) return null;
  const [, sz, pl, cl, w, t, o, seed, chk] = m;
  if (check(sz + pl + cl + w + t + o + seed) !== chk) return null;
  const seedN = parseInt(seed, 36);
  if (!Number.isFinite(seedN) || seedN >= 0x7fffffff) return null;
  const climate = (Object.keys(CLIMATE_CH) as Climate[]).find((c) => CLIMATE_CH[c] === cl)!;
  return {
    size: B36.indexOf(sz) * 8, players: +pl, climate,
    water: B36.indexOf(w) / 20, trees: B36.indexOf(t) / 20, ore: B36.indexOf(o) / 20, seed: seedN,
  };
}

/**
 * The generator options a skirmish uses for these parameters (climate adjusts water and forests).
 * Mirrors the Game constructor so previews show the real map.
 */
export function generatorOptions(p: GenParams): MapGenOptions {
  return {
    size: p.size, players: p.players, seed: p.seed, ore: p.ore,
    // deserts are dry, except that a sea map (water >= 0.9) becomes a desert coastline
    water: p.climate === 'desert' && p.water < 0.9 ? Math.min(p.water, 0.2) : p.water,
    trees: p.climate === 'desert' ? p.trees * 0.35 : p.climate === 'winter' ? Math.min(1, p.trees * 1.2) : p.trees,
  };
}

/** The map code of a skirmish setup on a generated map (null for curated maps and missions). */
export function mapCodeForSetup(setup: { mapSize: number; opponents: unknown[]; water: number; trees: number; ore: number; climate?: string; seed: number; mapId?: string; mission?: string }): string | null {
  if (setup.mapId || setup.mission) return null;
  const climate = (setup.climate === 'winter' || setup.climate === 'desert' ? setup.climate : 'temperate') as Climate;
  return encodeMapCode({ size: setup.mapSize, players: 1 + setup.opponents.length, water: setup.water, trees: setup.trees, ore: setup.ore, climate, seed: setup.seed });
}
