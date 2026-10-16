/**
 * Mod engine: validates mod files against the rule types and applies them to the module-level rule
 * tables (UNITS, BUILDINGS, WEAPONS, WARHEADS in src/data/rules.ts) — and restores them exactly.
 *
 * Safety model
 *  - The first time anything is applied, a deep copy of every pristine entry is taken.
 *  - restoreRules() puts every entry back *in place* (same object identity: entities and modules
 *    hold references to the type objects) and deletes the entries mods added.
 *  - applyModSet() always restores first, so the rules are a pure function of the active set.
 *  - Applying is all-or-nothing: the set is validated against a scratch copy before the live tables
 *    are touched, so an invalid mod can never leave the rules half-modded.
 *
 * No DOM / three.js here: the simulation tests use this module directly. The browser registers
 * `onTypesChanged` (src/mods/index.ts) to give cloned variants their base type's 3D model.
 */
import { BUILDINGS, UNITS, WARHEADS, WEAPONS } from '../data/rules';
import { MOD_FORMAT, MOD_VERSION, TABLE_NAMES, makeModSet, modSetHash, type ModChange, type ModFile, type ModSet, type ScaleRule, type TableName, type TypePatch } from './format';

type Entry = Record<string, unknown> & { id: string };
type Tables = Record<TableName, Record<string, Entry>>;

const LIVE: Tables = {
  units: UNITS as unknown as Record<string, Entry>,
  buildings: BUILDINGS as unknown as Record<string, Entry>,
  weapons: WEAPONS as unknown as Record<string, Entry>,
  warheads: WARHEADS as unknown as Record<string, Entry>,
};

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// =====================================================================================================
// Field schema (from the rule interfaces in rules.ts)
// =====================================================================================================
type FieldSpec =
  | { t: 'num'; min?: number; max?: number; int?: boolean }
  | { t: 'str'; max?: number }
  | { t: 'bool' }
  | { t: 'enum'; values: readonly string[] }
  | { t: 'ref'; table: TableName; nullable?: boolean }
  | { t: 'refs'; table: TableName | 'types'; alt?: boolean }
  | { t: 'factions' }
  | { t: 'verses' }
  | { t: 'cell' }
  | { t: 'sfx' }
  | { t: 'ro'; why?: string };

const ARMORS = ['none', 'wood', 'light', 'heavy', 'concrete'] as const;
const PROJECTILES = ['bullet', 'flak', 'cannon', 'ballistic', 'lobbed', 'missile', 'scud', 'tesla', 'flame', 'fireball', 'melee', 'heal', 'torpedo', 'depthcharge', 'bomb'] as const;
const EXPLOSIONS = ['none', 'piff', 'small', 'medium', 'large', 'huge', 'fire', 'electric', 'nuke', 'building'] as const;
const INF_DEATHS = ['normal', 'blown', 'burn', 'electro', 'bite'] as const;

const MODEL = 'models and animations are built for the original type';
const BEHAVIOUR = 'it selects hard-coded behaviour';

const BASE_FIELDS: Record<string, FieldSpec> = {
  id: { t: 'ro', why: 'the id is the key of the entry' },
  name: { t: 'str', max: 60 },
  description: { t: 'str', max: 400 },
  cost: { t: 'num', min: 0, max: 100000, int: true },
  strength: { t: 'num', min: 1, max: 100000, int: true },
  armor: { t: 'enum', values: ARMORS },
  sight: { t: 'num', min: 0, max: 40 },
  owner: { t: 'factions' },
  prereq: { t: 'refs', table: 'buildings', alt: true },
  buildable: { t: 'bool' },
  category: { t: 'ro', why: 'production queues and the sidebar depend on it' },
  gapRadius: { t: 'num', min: 0, max: 40 },
  jamRadius: { t: 'num', min: 0, max: 40 },
};

const SCHEMA: Record<TableName, Record<string, FieldSpec>> = {
  units: {
    ...BASE_FIELDS,
    kind: { t: 'ro', why: MODEL },
    speed: { t: 'num', min: 0, max: 100 },
    rot: { t: 'num', min: 1, max: 255 },
    primary: { t: 'ref', table: 'weapons', nullable: true },
    secondary: { t: 'ref', table: 'weapons', nullable: true },
    twinShot: { t: 'bool' },
    turret: { t: 'ro', why: MODEL },
    tracked: { t: 'bool' },
    crusher: { t: 'bool' },
    crushable: { t: 'bool' },
    radius: { t: 'num', min: 0.05, max: 1.5 },
    selfHealing: { t: 'bool' },
    harvester: { t: 'ro', why: BEHAVIOUR },
    deploysInto: { t: 'ro', why: BEHAVIOUR },
    noMovingFire: { t: 'bool' },
    passengers: { t: 'num', min: 0, max: 20, int: true },
    engineer: { t: 'ro', why: BEHAVIOUR },
    medic: { t: 'ro', why: BEHAVIOUR },
    dog: { t: 'ro', why: BEHAVIOUR },
    c4: { t: 'ro', why: BEHAVIOUR },
    hero: { t: 'bool' },
    spy: { t: 'ro', why: BEHAVIOUR },
    thief: { t: 'ro', why: BEHAVIOUR },
    minelayer: { t: 'ro', why: BEHAVIOUR },
    supportPlane: { t: 'ro', why: BEHAVIOUR },
    vtol: { t: 'ro', why: MODEL },
    ammo: { t: 'num', min: 1, max: 100, int: true },
    cloakable: { t: 'ro', why: BEHAVIOUR },
    sensors: { t: 'num', min: 0, max: 30 },
  },
  buildings: {
    ...BASE_FIELDS,
    kind: { t: 'ro', why: MODEL },
    size: { t: 'ro', why: 'the 3D model is built for the original footprint' },
    power: { t: 'num', min: -2000, max: 2000, int: true },
    storage: { t: 'num', min: 0, max: 100000, int: true },
    primary: { t: 'ref', table: 'weapons', nullable: true },
    turret: { t: 'ro', why: MODEL },
    freeUnit: { t: 'ref', table: 'units', nullable: true },
    factory: { t: 'ro', why: BEHAVIOUR },
    water: { t: 'ro', why: BEHAVIOUR },
    factoryOnly: { t: 'refs', table: 'units' },
    requiresPower: { t: 'bool' },
    dock: { t: 'ro', why: MODEL },
    exit: { t: 'ro', why: MODEL },
    passable: { t: 'ro', why: MODEL },
    repairPad: { t: 'ro', why: BEHAVIOUR },
    radar: { t: 'bool' },
    superweapon: { t: 'ro', why: BEHAVIOUR },
    superCharge: { t: 'num', min: 5, max: 3600 },
    wall: { t: 'ro', why: BEHAVIOUR },
    mine: { t: 'ro', why: BEHAVIOUR },
    camo: { t: 'ro', why: BEHAVIOUR },
    fakeOf: { t: 'ro', why: BEHAVIOUR },
    powers: { t: 'ro', why: BEHAVIOUR },
  },
  weapons: {
    id: { t: 'ro', why: 'the id is the key of the entry' },
    damage: { t: 'num', min: -10000, max: 100000 },
    rof: { t: 'num', min: 1, max: 2000, int: true },
    range: { t: 'num', min: 0.5, max: 99 },
    minRange: { t: 'num', min: 0, max: 40 },
    projectile: { t: 'enum', values: PROJECTILES },
    speed: { t: 'num', min: 1, max: 100 },
    warhead: { t: 'ref', table: 'warheads' },
    burst: { t: 'num', min: 1, max: 20, int: true },
    report: { t: 'sfx' },
    antiAir: { t: 'bool' },
    antiGround: { t: 'bool' },
    inaccuracy: { t: 'num', min: 0, max: 10 },
    charge: { t: 'num', min: 0, max: 200, int: true },
  },
  warheads: {
    id: { t: 'ro', why: 'the id is the key of the entry' },
    spread: { t: 'num', min: 0, max: 20 },
    verses: { t: 'verses' },
    wall: { t: 'bool' },
    wood: { t: 'bool' },
    ore: { t: 'bool' },
    explosion: { t: 'enum', values: EXPLOSIONS },
    infDeath: { t: 'enum', values: INF_DEATHS },
  },
};

const TABLE_LABEL: Record<TableName, string> = { units: 'unit', buildings: 'structure', weapons: 'weapon', warheads: 'warhead' };

/** Field spec, falling back to the type of the value other entries already have (fields added later). */
function fieldSpec(tables: Tables, table: TableName, field: string): FieldSpec | null {
  const s = SCHEMA[table][field];
  if (s) return s;
  for (const e of Object.values(tables[table])) {
    const v = e[field];
    if (v === undefined) continue;
    if (typeof v === 'number') return { t: 'num', min: -1e6, max: 1e6 };
    if (typeof v === 'boolean') return { t: 'bool' };
    if (typeof v === 'string') return { t: 'str', max: 400 };
    return { t: 'ro', why: 'structured fields added after this mod format can only be changed by code' };
  }
  return null;
}

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

function suggest(word: string, options: Iterable<string>): string {
  let best = '', bd = Infinity;
  for (const o of options) {
    const d = levenshtein(word.toLowerCase(), o.toLowerCase());
    if (d < bd) { bd = d; best = o; }
  }
  return best && bd <= Math.max(2, Math.floor(word.length / 3)) ? ` (did you mean "${best}"?)` : '';
}

const show = (v: unknown) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

// =====================================================================================================
// Validation + application (one pass over a set of tables: scratch copy or the live rules)
// =====================================================================================================
export interface ModIssue {
  /** Where: e.g. `units.2tnk.cost`. */
  path: string;
  message: string;
}

export interface ModReport {
  ok: boolean;
  errors: ModIssue[];
  warnings: ModIssue[];
  changes: ModChange[];
  /** New entries (variants) per table. */
  added: { table: TableName; id: string; base: string; mod: string; name?: string }[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TYPE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;

/** Structural checks of the file itself (not the rules it refers to). */
function checkHeader(mod: ModFile, errors: ModIssue[], warnings: ModIssue[]): boolean {
  const m = mod as unknown as Record<string, unknown>;
  if (!m || typeof m !== 'object' || Array.isArray(m)) { errors.push({ path: '', message: 'a mod must be a JSON object' }); return false; }
  if (m.format !== undefined && m.format !== MOD_FORMAT) errors.push({ path: 'format', message: `expected "${MOD_FORMAT}", got ${show(m.format)}` });
  if (m.version !== undefined && m.version !== MOD_VERSION) errors.push({ path: 'version', message: `unsupported version ${show(m.version)} (this build reads version ${MOD_VERSION})` });
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) errors.push({ path: 'id', message: 'required: lower-case letters, digits and dashes (e.g. "tank-rush")' });
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 60) errors.push({ path: 'name', message: 'required: a display name of up to 60 characters' });
  for (const k of ['description', 'author', 'modVersion'] as const) {
    if (m[k] !== undefined && typeof m[k] !== 'string') errors.push({ path: k, message: 'must be a string' });
  }
  const known = new Set(['format', 'version', 'id', 'name', 'description', 'author', 'modVersion', 'scale', ...TABLE_NAMES]);
  for (const k of Object.keys(m)) if (!known.has(k)) warnings.push({ path: k, message: `unknown section ignored${suggest(k, known)}` });
  for (const t of TABLE_NAMES) {
    const sec = m[t];
    if (sec !== undefined && (typeof sec !== 'object' || sec === null || Array.isArray(sec))) errors.push({ path: t, message: 'must be an object of id -> fields' });
  }
  if (m.scale !== undefined && !Array.isArray(m.scale)) errors.push({ path: 'scale', message: 'must be an array of scale rules' });
  return true;
}

/** Check one value against its spec; returns the (normalised) value or an error message. */
function checkValue(tables: Tables, spec: FieldSpec, v: unknown, sfx: Set<string>): { ok: true; v: unknown } | { ok: false; msg: string } {
  switch (spec.t) {
    case 'ro':
      return { ok: false, msg: `this field can't be modded (${spec.why ?? 'read-only'})` };
    case 'num': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, msg: `expected a number, got ${show(v)}` };
      if (spec.int && !Number.isInteger(v)) return { ok: false, msg: `expected a whole number, got ${v}` };
      if (spec.min !== undefined && v < spec.min) return { ok: false, msg: `must be at least ${spec.min}, got ${v}` };
      if (spec.max !== undefined && v > spec.max) return { ok: false, msg: `must be at most ${spec.max}, got ${v}` };
      return { ok: true, v };
    }
    case 'str':
      if (typeof v !== 'string') return { ok: false, msg: `expected a string, got ${show(v)}` };
      if (spec.max && v.length > spec.max) return { ok: false, msg: `at most ${spec.max} characters` };
      return { ok: true, v };
    case 'bool':
      return typeof v === 'boolean' ? { ok: true, v } : { ok: false, msg: `expected true or false, got ${show(v)}` };
    case 'enum':
      return typeof v === 'string' && spec.values.includes(v) ? { ok: true, v } : { ok: false, msg: `expected one of ${spec.values.join(', ')}; got ${show(v)}${typeof v === 'string' ? suggest(v, spec.values) : ''}` };
    case 'sfx':
      return typeof v === 'string' && sfx.has(v) ? { ok: true, v } : { ok: false, msg: `expected a weapon sound (${[...sfx].sort().join(', ')}); got ${show(v)}` };
    case 'ref': {
      if (v === null && spec.nullable) return { ok: true, v: undefined };
      if (typeof v !== 'string') return { ok: false, msg: `expected a ${TABLE_LABEL[spec.table]} id, got ${show(v)}` };
      if (!tables[spec.table][v]) return { ok: false, msg: `unknown ${TABLE_LABEL[spec.table]} "${v}"${suggest(v, Object.keys(tables[spec.table]))}` };
      return { ok: true, v };
    }
    case 'refs': {
      if (!Array.isArray(v)) return { ok: false, msg: `expected an array of ids, got ${show(v)}` };
      const pool = spec.table === 'types' ? { ...tables.units, ...tables.buildings } : tables[spec.table];
      for (const x of v) {
        if (typeof x !== 'string') return { ok: false, msg: `expected ids (strings), got ${show(x)}` };
        for (const part of spec.alt ? x.split('|') : [x]) {
          if (!pool[part]) return { ok: false, msg: `unknown ${spec.table === 'types' ? 'type' : TABLE_LABEL[spec.table as TableName]} "${part}"${suggest(part, Object.keys(pool))}` };
        }
      }
      return { ok: true, v: [...v] };
    }
    case 'factions': {
      if (!Array.isArray(v) || !v.length || !v.every((x) => x === 'allies' || x === 'soviet')) return { ok: false, msg: `expected ["allies"], ["soviet"] or ["allies", "soviet"]; got ${show(v)}` };
      return { ok: true, v: [...new Set(v)] };
    }
    case 'verses': {
      if (!Array.isArray(v) || v.length !== 5 || !v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 10)) {
        return { ok: false, msg: `expected 5 multipliers (vs none, wood, light, heavy, concrete armour), each 0..10; got ${show(v)}` };
      }
      return { ok: true, v: [...v] };
    }
    case 'cell':
      return { ok: false, msg: 'read-only' };
  }
}

function matchesWhere(e: Entry, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [k, want] of Object.entries(where)) {
    const have = e[k];
    const list = Array.isArray(want) ? want : [want];
    if (Array.isArray(have)) { if (!list.some((w) => have.includes(w))) return false; } else if (!list.some((w) => w === have || (w === false && have === undefined))) return false;
  }
  return true;
}

/** Root id a cloned entry renders as (follows clone chains back to a base entry). */
function rootOf(table: TableName, id: string, bases: Map<string, string>): string {
  let cur = id;
  for (let i = 0; i < 16 && bases.has(table + ':' + cur); i++) cur = bases.get(table + ':' + cur)!;
  return cur;
}

/**
 * Validate `mods` and apply them, in order, to `tables` (mutated in place). Stops changing the tables
 * at the first mod with errors, but keeps validating the rest so every problem is reported.
 */
function run(tables: Tables, mods: ModFile[]): ModReport {
  const errors: ModIssue[] = [], warnings: ModIssue[] = [], changes: ModChange[] = [];
  const added: ModReport['added'] = [];
  const bases = new Map<string, string>();
  const sfx = new Set(Object.values(tables.weapons).map((w) => String(w.report)));
  const ids = new Set<string>();
  for (let mi = 0; mi < mods.length; mi++) {
    const mod = mods[mi];
    const pre = mods.length > 1 ? `[${(mod as ModFile)?.id ?? mi}] ` : '';
    const e0 = errors.length;
    const err = (path: string, message: string) => errors.push({ path: pre + path, message });
    const warn = (path: string, message: string) => warnings.push({ path: pre + path, message });
    if (!checkHeader(mod, errors, warnings)) continue;
    if (ids.has(mod.id)) err('id', `the mod "${mod.id}" is in the set twice`);
    ids.add(mod.id);
    const record = (table: TableName, id: string, field: string, from: unknown, to: unknown) => {
      if (JSON.stringify(from) === JSON.stringify(to)) return;
      const prev = changes.find((c) => c.table === table && c.id === id && c.field === field);
      if (prev) { prev.to = clone(to); prev.mod = mod.name; } else changes.push({ table, id, field, from: clone(from), to: clone(to), mod: mod.name });
    };
    let empty = true;
    for (const table of TABLE_NAMES) {
      const sec = (mod as unknown as Record<string, Record<string, TypePatch> | undefined>)[table];
      if (!sec || typeof sec !== 'object' || Array.isArray(sec)) continue;
      for (const [id, patch] of Object.entries(sec)) {
        empty = false;
        const at = `${table}.${id}`;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) { err(at, 'must be an object of field -> value'); continue; }
        let entry = tables[table][id];
        const isNew = !entry;
        if (patch.clone !== undefined) {
          if (typeof patch.clone !== 'string' || !tables[table][patch.clone]) {
            err(`${at}.clone`, `unknown ${TABLE_LABEL[table]} "${String(patch.clone)}" to copy${typeof patch.clone === 'string' ? suggest(patch.clone, Object.keys(tables[table])) : ''}`);
            continue;
          }
          if (!isNew) { err(`${at}.clone`, `"${id}" already exists: drop "clone" to change it, or pick a new id for the variant`); continue; }
          if (!TYPE_ID_RE.test(id)) { err(at, 'a new id must be 1-32 letters, digits, "-", "_" or "."'); continue; }
          if ((table === 'units' && tables.buildings[id]) || (table === 'buildings' && tables.units[id])) { err(at, `"${id}" is already used by a ${table === 'units' ? 'structure' : 'unit'}`); continue; }
        } else if (isNew) {
          err(at, `unknown ${TABLE_LABEL[table]} "${id}"${suggest(id, Object.keys(tables[table]))}; to add a variant, set "clone" to the id it is based on`);
          continue;
        }
        // check every field before touching the entry
        const fields: [string, unknown][] = [];
        let bad = false;
        for (const [field, value] of Object.entries(patch)) {
          if (field === 'clone') continue;
          const spec = fieldSpec(tables, table, field);
          if (!spec) { err(`${at}.${field}`, `unknown field for a ${TABLE_LABEL[table]}${suggest(field, Object.keys(SCHEMA[table]))}`); bad = true; continue; }
          const r = checkValue(tables, spec, value, sfx);
          if (!r.ok) { err(`${at}.${field}`, r.msg); bad = true; continue; }
          fields.push([field, r.v]);
        }
        if (bad || errors.length > e0) continue;
        if (isNew) {
          const base = patch.clone as string;
          entry = clone(tables[table][base]);
          entry.id = id;
          tables[table][id] = entry;
          bases.set(table + ':' + id, base);
          added.push({ table, id, base: rootOf(table, id, bases), mod: mod.name });
          if (!fields.some(([f]) => f === 'name') && typeof entry.name === 'string') entry.name = `${entry.name} (${mod.name})`;
        }
        for (const [field, v] of fields) {
          const from = entry[field];
          if (v === undefined) delete entry[field]; else entry[field] = clone(v);
          if (!isNew) record(table, id, field, from, v);
        }
        if (isNew) added[added.length - 1].name = typeof entry.name === 'string' ? entry.name : undefined;
        // cross-field sanity
        if (table === 'weapons' && typeof entry.minRange === 'number' && entry.minRange >= (entry.range as number)) err(`${at}.minRange`, `must be less than the range (${entry.range})`);
        if ((table === 'units' || table === 'buildings') && Array.isArray(entry.owner) && entry.buildable && Array.isArray(entry.prereq) && (entry.prereq as string[]).includes(id)) err(`${at}.prereq`, 'a type cannot require itself');
      }
    }
    // ---- scale rules
    for (const [ri, rule] of (Array.isArray(mod.scale) ? mod.scale : []).entries()) {
      empty = false;
      const at = `scale[${ri}]`;
      const r = rule as ScaleRule;
      if (!r || typeof r !== 'object') { err(at, 'must be an object { table, fields, ids?, where? }'); continue; }
      if (!TABLE_NAMES.includes(r.table)) { err(`${at}.table`, `expected one of ${TABLE_NAMES.join(', ')}; got ${show(r.table)}`); continue; }
      if (!r.fields || typeof r.fields !== 'object' || !Object.keys(r.fields).length) { err(`${at}.fields`, 'expected { "field": multiplier, ... }'); continue; }
      let bad = false;
      for (const [f, k] of Object.entries(r.fields)) {
        const spec = fieldSpec(tables, r.table, f);
        if (!spec || spec.t !== 'num') { err(`${at}.fields.${f}`, spec ? 'only numeric fields can be scaled' : `unknown field for a ${TABLE_LABEL[r.table]}${suggest(f, Object.keys(SCHEMA[r.table]))}`); bad = true; }
        else if (typeof k !== 'number' || !Number.isFinite(k) || k < 0 || k > 100) { err(`${at}.fields.${f}`, `expected a multiplier between 0 and 100, got ${show(k)}`); bad = true; }
      }
      if (r.ids !== undefined && (!Array.isArray(r.ids) || !r.ids.every((x) => typeof x === 'string'))) { err(`${at}.ids`, 'expected an array of ids'); bad = true; }
      if (r.where !== undefined && (typeof r.where !== 'object' || r.where === null || Array.isArray(r.where))) { err(`${at}.where`, 'expected { "field": value, ... }'); bad = true; }
      if (bad || errors.length > e0) continue;
      for (const id of r.ids ?? []) if (!tables[r.table][id]) warn(`${at}.ids`, `no ${TABLE_LABEL[r.table]} "${id}" in this build (skipped)${suggest(id, Object.keys(tables[r.table]))}`);
      let n = 0;
      for (const [id, entry] of Object.entries(tables[r.table])) {
        if (r.ids && !r.ids.includes(id)) continue;
        if (!matchesWhere(entry, r.where)) continue;
        n++;
        for (const [f, k] of Object.entries(r.fields)) {
          const spec = fieldSpec(tables, r.table, f) as Extract<FieldSpec, { t: 'num' }>;
          const from = entry[f];
          if (typeof from !== 'number') continue;
          let v = from * k;
          if (spec.int) v = Math.round(v);
          if (spec.min !== undefined) v = Math.max(spec.min, v);
          if (spec.max !== undefined) v = Math.min(spec.max, v);
          entry[f] = v;
          if (!added.some((a) => a.table === r.table && a.id === id)) record(r.table, id, f, from, v);
        }
      }
      if (!n) warn(at, 'matches no entries');
    }
    if (empty) warn('', 'this mod changes nothing');
  }
  return { ok: errors.length === 0, errors, warnings, changes, added };
}

// =====================================================================================================
// Live rules: snapshot, restore, apply
// =====================================================================================================
let pristine: Tables | null = null;
let applied: { set: ModSet; report: ModReport } | null = null;

/** Called after the live tables change (browser: model aliases for variants). */
let typesChanged: ((added: ModReport['added'], removed: string[]) => void) | null = null;
export function onTypesChanged(fn: typeof typesChanged) {
  typesChanged = fn;
}

function snapshot(): Tables {
  if (!pristine) pristine = { units: clone(LIVE.units), buildings: clone(LIVE.buildings), weapons: clone(LIVE.weapons), warheads: clone(LIVE.warheads) };
  return pristine;
}

/** A deep copy of the unmodded rules (for previews / summaries). */
export function pristineTables(): Tables {
  return clone(pristine ?? LIVE);
}

/** Put every rule entry back exactly as it was before any mod (object identity preserved). */
export function restoreRules() {
  if (!pristine) return;
  const removed: string[] = [];
  for (const t of TABLE_NAMES) {
    const live = LIVE[t], orig = pristine[t];
    for (const id of Object.keys(live)) {
      if (!(id in orig)) { delete live[id]; removed.push(id); continue; }
      const e = live[id], o = orig[id];
      for (const k of Object.keys(e)) if (!(k in o)) delete e[k];
      for (const k of Object.keys(o)) e[k] = clone(o[k]);
    }
    for (const id of Object.keys(orig)) if (!(id in live)) live[id] = clone(orig[id]);
  }
  applied = null;
  if (removed.length) typesChanged?.([], removed);
}

/** Validate a list of mods (in order) without touching the live rules. */
export function checkMods(mods: ModFile[]): ModReport {
  return run(pristineTables(), clone(mods));
}

/**
 * Make the live rules equal to the base rules plus `set` (null / empty = base rules). Throws an Error
 * with every problem listed when the set is invalid; the rules are then left unmodded.
 */
export function applyModSet(set: ModSet | null | undefined): ModReport | null {
  const mods = set?.mods ?? [];
  if (!mods.length) {
    restoreRules();
    return null;
  }
  const hash = modSetHash(mods);
  // the content is authoritative; a stale / edited hash in a save or replay is only worth a warning
  if (set?.hash && set.hash !== hash) console.warn(`mods: recorded hash ${set.hash} does not match the content (${hash}); using the content`);
  if (applied && applied.set.hash === hash) return applied.report;
  snapshot();
  restoreRules();
  const dry = checkMods(mods);
  if (!dry.ok) {
    throw new Error(`Mods could not be applied:\n${dry.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
  }
  const report = run(LIVE, clone(mods));
  applied = { set: { hash, mods: clone(mods) }, report };
  if (report.added.length) typesChanged?.(report.added, []);
  return report;
}

/** The mod set currently applied to the live rules (null = base rules). */
export function appliedModSet(): ModSet | null {
  return applied?.set ?? null;
}

/** Changes the applied set made to one unit / structure type (for "Modded" markers), or null. */
export function typeModInfo(id: string): { mods: string[]; lines: string[]; variant?: string } | null {
  if (!applied) return null;
  const r = applied.report;
  const add = r.added.find((a) => (a.table === 'units' || a.table === 'buildings') && a.id === id);
  const ch = r.changes.filter((c) => (c.table === 'units' || c.table === 'buildings') && c.id === id);
  // weapons used by the type changed too
  const t = (LIVE.units[id] ?? LIVE.buildings[id]) as Entry | undefined;
  const weps = [t?.primary, t?.secondary].filter((w): w is string => typeof w === 'string');
  const wch = r.changes.filter((c) => c.table === 'weapons' && weps.includes(c.id));
  if (!add && !ch.length && !wch.length) return null;
  const mods = [...new Set([...(add ? [add.mod] : []), ...ch.map((c) => c.mod), ...wch.map((c) => c.mod)])];
  const lines = [...ch, ...wch].map((c) => `${c.table === 'weapons' ? c.id + ' ' : ''}${c.field}: ${fmt(c.from)} → ${fmt(c.to)}`);
  return { mods, lines, variant: add ? add.base : undefined };
}

const fmt = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : v === undefined ? '—' : Array.isArray(v) ? v.join(', ') : String(v));
export { fmt as formatModValue };

/** Convenience for callers holding mod files: the canonical set with its hash. */
export { makeModSet };
