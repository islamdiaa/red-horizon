/**
 * Conquest text for display: the run (saved) and its battles (simulated) keep the English of
 * src/i18n/en/conquest-run.ts and conquest-battle.ts; the screens translate it here, names inside included.
 * Also the translated names of the Conquest game data (tools/i18n/data-sources.ts, tables conquest*).
 * Display only: never call this from run or battle logic.
 */
import { BUILDINGS, UNITS } from '../data/rules';
import { addSourceResolver, currentLang, dt, flatten, fmtDate, fmtMoney, resolveParamOf, trSource, tx, type Params } from '../i18n/core';
import { typeName } from '../i18n/names';
import { RUN } from '../i18n/en/conquest-run';
import { BATTLE, BATTLE_LOCAL } from '../i18n/en/conquest-battle';
import { DOCTRINES, MONTHS, PERKS, PERSONALITIES, RESEARCH, RESOURCES, TITLES, type PerkDef, type PersonalityId, type ResearchDef, type ResourceKind, type TitleDef } from './data';
import { KIND_INFO, type BattleKind } from './battle';
import { EVENT_BY_ID } from './events';
import { dateOf } from './state';
import { REGIONS } from './geo';

// =====================================================================================================
// Game data names (tools/i18n/data-sources.ts, tables conquest*)
// =====================================================================================================
/** Perks with a faction variant share an id: their catalogue key is <id>.<faction>. */
export const perkKey = (p: PerkDef) => (p.faction ? `${p.id}.${p.faction}` : p.id);
export const perkName = (p: PerkDef) => dt('conquestPerk', perkKey(p), 'name', p.name);
export const perkDesc = (p: PerkDef) => dt('conquestPerk', perkKey(p), 'desc', p.desc);
export const doctrineName = (d: { id: string; name: string }) => dt('conquestDoctrine', d.id, 'name', d.name);
export const doctrineDesc = (d: { id: string; desc: string }) => dt('conquestDoctrine', d.id, 'desc', d.desc);
export const researchName = (r: ResearchDef) => dt('conquestResearch', r.id, 'name', r.name);
export const researchDesc = (r: ResearchDef) => dt('conquestResearch', r.id, 'desc', r.desc);
export const resourceName = (k: ResourceKind) => dt('conquestResource', k, 'name', RESOURCES[k].name);
export const resourceDesc = (k: ResourceKind) => dt('conquestResource', k, 'desc', RESOURCES[k].desc);
export const personalityName = (id: PersonalityId) => dt('conquestPersonality', id, 'name', PERSONALITIES[id].name);
export const personalityDesc = (id: PersonalityId) => dt('conquestPersonality', id, 'desc', PERSONALITIES[id].desc);
export const titleName = (t: TitleDef) => dt('conquestTitle', t.id, 'name', t.name);
export const titleDesc = (t: TitleDef) => dt('conquestTitle', t.id, 'desc', t.desc);
/** A territory's name (a run's territory keeps its region id: tools/i18n/data-sources.ts, table conquestRegion). */
export const territoryName = (t: { id: string; name: string }) => dt('conquestRegion', t.id, 'name', t.name);
// a {territory} inside emitted English ("Destroy the garrison of Normandy") is translated too
// (battles use the territory in capitals as their codename: "NORMANDY")
addSourceResolver((en) => {
  const r = REGIONS.find((x) => x.name === en || x.name.toUpperCase() === en);
  if (!r) return null;
  const t = dt('conquestRegion', r.id, 'name', r.name);
  return en === r.name ? t : t.toLocaleUpperCase(currentLang());
});
export const kindName = (k: BattleKind) => trRun(KIND_INFO[k].name);
export const kindDesc = (k: BattleKind) => trRun(KIND_INFO[k].desc);
/** The month of a turn ("March 1953"), in the active language. */
export function monthYear(turn: number): string {
  const d = dateOf(turn);
  return currentLang() === 'en' ? d.label : fmtDate(Date.UTC(d.year, d.month, 1), { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// =====================================================================================================
// The run's English, translated for display
// =====================================================================================================
// The run (saved) and its battles (simulated) store English built from src/i18n/en/conquest-run.ts and
// conquest-battle.ts. trRun() finds the template a text came from and translates it, names inside included
// (perks, research, doctrines, titles, structures and units, battlefields, months); anything else goes through
// trSource(), and unknown text stays as it is.
interface Compiled { exact: Map<string, string>; lowerMap: Map<string, string>; patterns: { key: string; re: RegExp; names: string[] }[] }
let compiled: Compiled | null = null;
function compile(): Compiled {
  if (compiled) return compiled;
  const c: Compiled = { exact: new Map(), lowerMap: new Map(), patterns: [] };
  const trees: [object, string][] = [[BATTLE, 'conquest.battle'], [BATTLE_LOCAL, 'conquest.battle.local'], [RUN, 'conquest.run']];
  for (const [tree, prefix] of trees) {
    for (const [key, v] of Object.entries(flatten(tree as Record<string, string>, prefix))) {
      if (key === 'conquest.run.eventLog') continue; // "{title}: {text}" would match anything (see trLog)
      if (key.startsWith('conquest.battle.map.')) c.lowerMap.set(v.toLowerCase(), key);
      if (!/\{\w+\}/.test(v)) { if (!c.exact.has(v)) c.exact.set(v, key); continue; }
      const names: string[] = [];
      const re = new RegExp(`^${v.split(/(\{\w+\})/).map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m) { names.push(m[1]); return '(.+?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('')}$`, 's');
      c.patterns.push({ key, re, names });
    }
  }
  return (compiled = c);
}

let dataNames: Map<string, () => string> | null = null;
/** English names of game data that run texts embed, with their translation. */
function dataName(v: string): string | null {
  if (!dataNames) {
    const m = new Map<string, () => string>();
    for (const u of [...Object.values(UNITS), ...Object.values(BUILDINGS)]) if (!m.has(u.name)) m.set(u.name, () => typeName(u));
    for (const r of RESEARCH) m.set(r.name, () => researchName(r));
    for (const t of TITLES) m.set(t.name, () => titleName(t));
    for (const d of DOCTRINES) m.set(d.name, () => doctrineName(d));
    for (const p of PERKS) m.set(p.name, () => perkName(p));
    dataNames = m;
  }
  return dataNames.get(v)?.() ?? null;
}

const MONTH_YEAR = new RegExp(`^(${MONTHS.join('|')}) (\\d{4})$`);
/** A value captured from a run text: numbers and money re-formatted, names translated. */
function trParam(v: string): string | number {
  if (/^\d+$/.test(v)) return Number(v);
  if (/^\$[\d,]+$/.test(v)) return fmtMoney(Number(v.replace(/[$,]/g, '')));
  const c = compile();
  const k = c.exact.get(v);
  if (k) return tx(k);
  const named = dataName(v);
  if (named !== null) return named;
  const my = MONTH_YEAR.exec(v);
  if (my) return fmtDate(Date.UTC(Number(my[2]), MONTHS.indexOf(my[1]), 1), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const lower = c.lowerMap.get(v);
  if (lower) { const t = tx(lower); return currentLang() === 'de' ? t : t.charAt(0).toLocaleLowerCase(currentLang()) + t.slice(1); } // "(dense forest, strength 3)"
  return trSource(v);
}

const runCache = new Map<string, string>();
/** Translate English stored by the run or emitted by its battles (unchanged in English, and when unknown). */
export function trRun(text: string): string {
  if (!text || currentLang() === 'en') return text;
  const ck = `${currentLang()}|${text}`;
  const hit = runCache.get(ck);
  if (hit !== undefined) return hit;
  const c = compile();
  let out: string | null = null;
  const k = c.exact.get(text);
  if (k) out = tx(k);
  else {
    for (const p of c.patterns) {
      const m = p.re.exec(text);
      if (!m) continue;
      const params: Params = {};
      p.names.forEach((n, i) => { params[n] = resolveParamOf(p.key, n, m[i + 1]) ?? trParam(m[i + 1]); }); // (call signs in {vet} {a} {b} {c})
      out = tx(p.key, params);
      break;
    }
  }
  out ??= dataName(text) ?? trSource(text);
  if (runCache.size > 600) runCache.clear();
  runCache.set(ck, out);
  return out;
}

/** A war diary entry: events are logged as "<event title>: <outcome>". */
export function trLog(l: { kind: string; text: string }): string {
  if (l.kind === 'event' && currentLang() !== 'en') {
    for (const id of Object.keys(EVENT_BY_ID)) {
      const title = EVENT_BY_ID[id].title;
      if (l.text.startsWith(`${title}: `)) return tx('conquest.run.eventLog', { title: trRun(title), text: trRun(l.text.slice(title.length + 2)) });
    }
  }
  return trRun(l.text);
}
