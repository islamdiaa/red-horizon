/** Tech-tree helpers for the sidebar: which items are locked and what they need. */
import { BUILDINGS, UNITS, WEAPONS, getType, isBuildingType, mphToCellsPerSecond, RA_TICKS_PER_SECOND, type Category, type Faction, type TypeDef } from '../data/rules';
import { DISABLED_TYPES, type Player } from '../sim/player';

/** Every type this faction could ever build in a sidebar category (cheapest first). */
export function factionTypes(faction: Faction, cat: Category): string[] {
  const out: string[] = [];
  for (const t of [...Object.values(BUILDINGS), ...Object.values(UNITS)]) {
    if (t.category !== cat || !t.buildable || DISABLED_TYPES.has(t.id) || !t.owner.includes(faction)) continue;
    out.push(t.id);
  }
  return out.sort((a, b) => getType(a).cost - getType(b).cost);
}

const nameOf = (id: string) => BUILDINGS[id]?.name ?? UNITS[id]?.name ?? id;

/** Factories able to produce a type for this faction. */
function factoryNames(faction: Faction, t: TypeDef): string[] {
  if (isBuildingType(t)) return [BUILDINGS.fact.name];
  const names: string[] = [];
  for (const b of Object.values(BUILDINGS)) {
    if (b.factory !== t.kind || !b.owner.includes(faction)) continue;
    if (b.factoryOnly && !b.factoryOnly.includes(t.id)) continue;
    if (!b.factoryOnly && t.id === 'dog') continue;
    if (!names.includes(b.name)) names.push(b.name);
  }
  return names;
}

/** Human-readable list of what is missing before `id` can be built ([] = nothing). */
export function missingRequirements(p: Player, id: string): string[] {
  const t = getType(id);
  const out: string[] = [];
  for (const req of t.prereq) {
    const alts = req.split('|');
    if (alts.some((a) => p.has(a))) continue;
    const mine = alts.filter((a) => BUILDINGS[a]?.owner.includes(p.faction));
    const names = [...new Set((mine.length ? mine : alts).map(nameOf))];
    out.push(names.join(' or '));
  }
  if (!p.hasFactoryFor(id)) {
    const f = factoryNames(p.faction, t);
    const s = f.join(' or ');
    if (s && !out.includes(s)) out.unshift(s);
  }
  return out;
}

export interface StatLine { label: string; value: string; frac?: number }

const dps = (wid?: string) => {
  if (!wid) return 0;
  const w = WEAPONS[wid];
  return (Math.abs(w.damage) * w.burst) / Math.max(0.2, w.rof / RA_TICKS_PER_SECOND);
};

let maxCache: { str: number; speed: number; dps: number; range: number } | null = null;
function maxima() {
  if (maxCache) return maxCache;
  let str = 0, speed = 0, d = 0, range = 0;
  for (const u of Object.values(UNITS)) {
    str = Math.max(str, u.strength);
    speed = Math.max(speed, mphToCellsPerSecond(u.speed));
    d = Math.max(d, dps(u.primary) + (u.secondary && u.secondary !== u.primary ? dps(u.secondary) : 0));
  }
  for (const b of Object.values(BUILDINGS)) if (b.primary) d = Math.max(d, dps(b.primary));
  for (const w of Object.values(WEAPONS)) if (w.range < 50) range = Math.max(range, w.range);
  maxCache = { str: Math.max(str, 1000), speed, dps: d, range };
  return maxCache;
}

export function weaponLabel(wid: string): string {
  const w = WEAPONS[wid];
  return `${w.id} · R${+w.range.toFixed(2)}`;
}

/** Stat lines with 0..1 bars for tooltips. */
export function statLines(t: TypeDef): StatLine[] {
  const m = maxima();
  const lines: StatLine[] = [];
  lines.push({ label: 'Durability', value: `${t.strength} · ${t.armor}`, frac: Math.sqrt(t.strength / m.str) });
  if (isBuildingType(t)) {
    if (t.power) lines.push({ label: 'Power', value: `${t.power > 0 ? '+' : ''}${t.power}`, frac: Math.min(1, Math.abs(t.power) / 200) });
    if (t.primary) {
      lines.push({ label: 'Firepower', value: WEAPONS[t.primary].id, frac: Math.min(1, dps(t.primary) / m.dps) });
      lines.push({ label: 'Range', value: `${+WEAPONS[t.primary].range.toFixed(2)} cells`, frac: WEAPONS[t.primary].range / m.range });
    }
    if (t.storage) lines.push({ label: 'Storage', value: `$${t.storage}` });
  } else {
    const spd = mphToCellsPerSecond(t.speed);
    lines.push({ label: 'Speed', value: `${spd.toFixed(1)} cells/s`, frac: spd / m.speed });
    const wps = [t.primary, t.secondary && t.secondary !== t.primary ? t.secondary : undefined].filter(Boolean) as string[];
    if (wps.length) {
      const d = wps.reduce((s, w) => s + dps(w), 0);
      lines.push({ label: 'Firepower', value: wps.map((w) => WEAPONS[w].id).join(' + '), frac: Math.min(1, Math.sqrt(d / m.dps)) });
      const r = Math.max(...wps.map((w) => WEAPONS[w].range));
      lines.push({ label: 'Range', value: `${+r.toFixed(2)} cells`, frac: r / m.range });
    }
    if (t.passengers) lines.push({ label: 'Capacity', value: `${t.passengers} infantry` });
  }
  return lines;
}

/** XP thresholds (mirrors World.grantXp): veteran at its own cost destroyed, elite at three times. */
export function xpThresholds(t: TypeDef): [number, number] {
  return [Math.max(300, t.cost), Math.max(900, t.cost * 3)];
}

export const RANK_NAMES = ['Rookie', 'Veteran', 'Elite'];
