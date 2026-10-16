/**
 * Mod file format (`.rhmod.json`): JSON rule overrides for the four rule tables in src/data/rules.ts.
 *
 *   {
 *     "format": "rhmod", "version": 1,
 *     "id": "tank-rush", "name": "Tank Rush", "author": "…", "description": "…",
 *     "units":     { "2tnk": { "cost": 600, "speed": 10 },                 <- override fields of an existing type
 *                    "htnk": { "clone": "3tnk", "name": "Assault Tank" } }, <- new variant: copy of 3tnk + overrides
 *     "buildings": { … }, "weapons": { … }, "warheads": { … },
 *     "scale": [ { "table": "units", "where": { "kind": "vehicle" }, "fields": { "cost": 0.8 } } ]
 *   }
 *
 * Patches are applied in file order: warheads, weapons, units, buildings, then the `scale` rules
 * (multipliers on numeric fields of every matching entry; `ids` and / or `where` select entries).
 * A mod set (several mods, in order) is recorded in saves and replays as content + hash, so a modded
 * match always rebuilds with exactly the rules it was played with.
 */
export const MOD_FORMAT = 'rhmod';
export const MOD_VERSION = 1;

export type TableName = 'units' | 'buildings' | 'weapons' | 'warheads';
export const TABLE_NAMES: TableName[] = ['warheads', 'weapons', 'units', 'buildings'];

/** Field overrides for one rule entry. `clone` (new ids only) names the entry to copy first. */
export type TypePatch = { clone?: string } & Record<string, unknown>;

export interface ScaleRule {
  table: TableName;
  /** Only these ids (default: every entry of the table). */
  ids?: string[];
  /** Only entries whose fields equal these values (an array value matches any of its elements). */
  where?: Record<string, unknown>;
  /** Numeric field -> multiplier. */
  fields: Record<string, number>;
}

export interface ModFile {
  format?: string;
  version?: number;
  /** Stable identifier (lower-case letters, digits and dashes). */
  id: string;
  name: string;
  description?: string;
  author?: string;
  /** The mod's own version string, e.g. "1.2". */
  modVersion?: string;
  units?: Record<string, TypePatch>;
  buildings?: Record<string, TypePatch>;
  weapons?: Record<string, TypePatch>;
  warheads?: Record<string, TypePatch>;
  scale?: ScaleRule[];
}

/** The mods a match runs with, in application order (stored in GameSetup.mods, saves and replays). */
export interface ModSet {
  /** Hash of the canonical content (modSetHash). */
  hash: string;
  mods: ModFile[];
}

/** One field changed by a mod set (for summaries and the "Modded" markers). */
export interface ModChange {
  table: TableName;
  id: string;
  field: string;
  from: unknown;
  to: unknown;
  /** Name of the mod that made the (last) change. */
  mod: string;
}

/** Canonical JSON: object keys sorted, so equal content always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
}

/** 64-bit FNV-1a style hash (two lanes) of a string, as 16 hex digits. Browser- and node-safe. */
export function hashString(s: string): string {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ (c + 0x9e3779b9), 0x01000193) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function modSetHash(mods: ModFile[]): string {
  return hashString(canonicalJson(mods));
}

export function makeModSet(mods: ModFile[]): ModSet {
  const copy = JSON.parse(JSON.stringify(mods)) as ModFile[];
  return { hash: modSetHash(copy), mods: copy };
}
