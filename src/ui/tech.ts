/** Tech-tree helpers for the sidebar: which items are locked and what they need. */
import { BUILDINGS, UNITS, WEAPONS, getType, isBuildingType, mphToCellsPerSecond, RA_TICKS_PER_SECOND, type Category, type Faction, type TypeDef } from '../data/rules';
import { DISABLED_TYPES, type Player } from '../sim/player';
import { tierOf } from '../sim/economy-data';
import { fmtList, fmtMoney } from '../i18n/core';
import { typeName } from '../i18n/names';
import tHud from '../i18n/en/hud';

/** Every type this faction could ever build in a sidebar category (cheapest first); `commander`: with the Commander economy's structures. */
export function factionTypes(faction: Faction, cat: Category, commander = false): string[] {
  const out: string[] = [];
  for (const t of [...Object.values(BUILDINGS), ...Object.values(UNITS)]) {
    if (t.category !== cat || !(t.buildable || (commander && isBuildingType(t) && t.commander)) || DISABLED_TYPES.has(t.id) || !t.owner.includes(faction)) continue;
    out.push(t.id);
  }
  return out.sort((a, b) => getType(a).cost - getType(b).cost);
}

const nameOf = (id: string) => { const t = BUILDINGS[id] ?? UNITS[id]; return t ? typeName(t) : id; };

/** Factories able to produce a type for this faction. */
function factoryNames(faction: Faction, t: TypeDef): string[] {
  if (isBuildingType(t)) return [typeName(BUILDINGS.fact)];
  const names: string[] = [];
  for (const b of Object.values(BUILDINGS)) {
    if (b.factory !== t.kind || !b.owner.includes(faction)) continue;
    if (b.factoryOnly && !b.factoryOnly.includes(t.id)) continue;
    if (!b.factoryOnly && t.id === 'dog') continue;
    const n = typeName(b);
    if (!names.includes(n)) names.push(n);
  }
  return names;
}

/** Human-readable list of what is missing before `id` can be built ([] = nothing), in the interface language. */
export function missingRequirements(p: Player, id: string): string[] {
  const t = getType(id);
  const out: string[] = [];
  if (p.econ && p.econ.tier < tierOf(id)) out.push(tHud('req.tier', { n: tierOf(id) })); // Commander tech tiers
  for (const req of t.prereq) {
    const alts = req.split('|');
    if (alts.some((a) => p.has(a))) continue;
    const mine = alts.filter((a) => BUILDINGS[a]?.owner.includes(p.faction));
    const names = [...new Set((mine.length ? mine : alts).map(nameOf))];
    out.push(fmtList(names, 'disjunction'));
  }
  if (!p.hasFactoryFor(id)) {
    const f = factoryNames(p.faction, t);
    const s = f.length ? fmtList(f, 'disjunction') : '';
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

/** Stat lines with 0..1 bars for tooltips (labels and values in the interface language). */
export function statLines(t: TypeDef): StatLine[] {
  const m = maxima();
  const lines: StatLine[] = [];
  lines.push({ label: tHud('stat.durability'), value: tHud('stat.durabilityValue', { hp: t.strength, armor: tHud(`armorLc.${t.armor}`) }), frac: Math.sqrt(t.strength / m.str) });
  if (isBuildingType(t)) {
    if (t.power) lines.push({ label: tHud('stat.power'), value: `${t.power > 0 ? '+' : ''}${t.power}`, frac: Math.min(1, Math.abs(t.power) / 200) });
    if (t.primary) {
      lines.push({ label: tHud('stat.firepower'), value: WEAPONS[t.primary].id, frac: Math.min(1, dps(t.primary) / m.dps) });
      lines.push({ label: tHud('stat.range'), value: tHud('stat.cells', { n: +WEAPONS[t.primary].range.toFixed(2) }), frac: WEAPONS[t.primary].range / m.range });
    }
    if (t.storage) lines.push({ label: tHud('stat.storage'), value: fmtMoney(t.storage) });
  } else {
    const spd = mphToCellsPerSecond(t.speed);
    lines.push({ label: tHud('stat.speed'), value: tHud('stat.cellsPerSec', { n: spd.toFixed(1) }), frac: spd / m.speed });
    const wps = [t.primary, t.secondary && t.secondary !== t.primary ? t.secondary : undefined].filter(Boolean) as string[];
    if (wps.length) {
      const d = wps.reduce((s, w) => s + dps(w), 0);
      lines.push({ label: tHud('stat.firepower'), value: wps.map((w) => WEAPONS[w].id).join(' + '), frac: Math.min(1, Math.sqrt(d / m.dps)) });
      const r = Math.max(...wps.map((w) => WEAPONS[w].range));
      lines.push({ label: tHud('stat.range'), value: tHud('stat.cells', { n: +r.toFixed(2) }), frac: r / m.range });
    }
    if (t.passengers) lines.push({ label: tHud('stat.capacity'), value: tHud('stat.infantry', { n: t.passengers }) });
  }
  return lines;
}

/** XP thresholds (mirrors World.grantXp): veteran at its own cost destroyed, elite at three times. */
export function xpThresholds(t: TypeDef): [number, number] {
  return [Math.max(300, t.cost), Math.max(900, t.cost * 3)];
}

/** A veterancy rank's name (0 rookie, 1 veteran, 2 elite). */
export function rankName(rank: number): string {
  return rank >= 2 ? tHud('rank.elite') : rank === 1 ? tHud('rank.veteran') : tHud('rank.rookie');
}
