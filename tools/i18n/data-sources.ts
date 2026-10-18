/**
 * Game-data text that the interface shows through dt() (src/i18n/core.ts): unit and structure names, Commander
 * powers, doctrines, upgrades, research, AI personalities, mutators, achievements, contracts, cosmetics, ranks...
 *
 * The data modules stay the English source of truth (English is read from them at run time). This list collects
 * that English into src/i18n/source/data.en.json (`node --import tsx tools/i18n/catalog.ts sync`), the reference
 * translators work from and the key set tests/i18n.test.ts checks every locale against. Tools and tests only:
 * the app never imports this file.
 *
 * A field path may use `*` for every index of an array: 'levels.*.effect' → research.<id>.levels.0.effect, ...
 */
import { UNITS, BUILDINGS } from '../../src/data/rules';
import { POWERS } from '../../src/sim/commander';
import { DOCTRINES } from '../../src/sim/doctrine';
import { UPGRADES, RESEARCH, TIER_NAMES } from '../../src/sim/economy-data';
import { PERSONALITIES } from '../../src/sim/ai-personality';
import { MUTATORS } from '../../src/modes/mutators';
import { ACHIEVEMENTS } from '../../src/meta/achievements';
import { CONTRACTS } from '../../src/meta/contracts';
import { COSMETICS } from '../../src/meta/unlocks';
import { RANKS } from '../../src/meta/ranks';
import { DAILY_MODIFIERS, DAILY_PLACES } from '../../src/meta/daily';
import { SURVIVAL_VARIANTS } from '../../src/missions/special';
import { MISSIONS } from '../../src/missions';
import { MAP_DEFS } from '../../src/maps/defs';
import { MODES } from '../../src/net/settings';
import { BUILTINS } from '../../src/modes/builtins';
import * as CQ from '../../src/conquest/data';

export interface DataSource {
  /** The key prefix (dt()'s table argument). */
  table: string;
  /** [id, record] pairs. */
  rows: () => Iterable<[string, unknown]>;
  /** Text fields to collect (dot paths, `*` = every array index). */
  fields: string[];
}

const byId = <T extends { id: string }>(list: Iterable<T>) => () => [...list].map((x) => [x.id, x] as [string, unknown]);
const entries = (rec: Record<string, unknown>) => () => Object.entries(rec);

export const DATA_SOURCES: DataSource[] = [
  { table: 'unit', rows: entries(UNITS), fields: ['name', 'description'] },
  { table: 'building', rows: entries(BUILDINGS), fields: ['name', 'description'] },
  { table: 'power', rows: entries(POWERS), fields: ['name', 'desc'] },
  { table: 'doctrine', rows: entries(DOCTRINES), fields: ['name', 'blurb', 'bonuses.*', 'drawback'] },
  { table: 'upgrade', rows: entries(UPGRADES), fields: ['name', 'effect', 'blurb'] },
  { table: 'research', rows: entries(RESEARCH), fields: ['name', 'blurb', 'levels.*.effect'] },
  { table: 'techTier', rows: () => TIER_NAMES.map((name, i) => [String(i), { name }] as [string, unknown]), fields: ['name'] },
  { table: 'personality', rows: entries(PERSONALITIES), fields: ['name', 'blurb'] },
  { table: 'mutator', rows: byId(MUTATORS), fields: ['name', 'desc'] },
  { table: 'achievement', rows: byId(ACHIEVEMENTS), fields: ['title', 'desc'] },
  { table: 'contract', rows: byId(CONTRACTS), fields: ['title', 'desc'] },
  { table: 'cosmetic', rows: byId(COSMETICS), fields: ['name', 'desc'] },
  { table: 'rank', rows: () => RANKS.map((r) => [String(r.index), r] as [string, unknown]), fields: ['allied', 'soviet', 'short'] },
  // Daily Challenge (src/meta/daily.ts): modifier descriptions (their names are the mutator names) and battlefield
  // places (dailyPlace.<climate>.<index>); the generated operation code names (IRON HAMMER) stay as they are
  { table: 'dailyModifier', rows: byId(DAILY_MODIFIERS), fields: ['desc'] },
  { table: 'dailyPlace', rows: entries(DAILY_PLACES as unknown as Record<string, unknown>), fields: ['*'] },
  // Survival fronts: the enemy force (titles and places are in the mission table)
  { table: 'survival', rows: byId(SURVIVAL_VARIANTS), fields: ['hordeName'] },
  // campaign / special-ops missions shown on the campaign screen (briefings and radio stay English for now; Boot
  // Camp is in the tutorial namespace; the daily challenge is generated, so it has no fixed text)
  { table: 'mission', rows: () => Object.entries(MISSIONS).filter(([id]) => id !== 'bootcamp' && id !== 'daily'), fields: ['title', 'location', 'date'] },
  // curated skirmish maps (map picker, lobby, results); editor maps are the player's own text and stay as written
  { table: 'map', rows: byId(MAP_DEFS), fields: ['name', 'desc', 'tags.*'] },
  // multiplayer modes (lobby: 1 vs 1, 2 vs 2, free for all, co-op)
  { table: 'netmode', rows: byId(MODES), fields: ['name', 'desc'] },
  // built-in scenario challenges (leaderboard board titles; the def's id is the key)
  { table: 'builtin', rows: () => Object.values(BUILTINS).map((b) => [b.def.id, b.def] as [string, unknown]), fields: ['title'] },
  // Conquest (src/conquest/data.ts). Perks with a faction variant are keyed <id>.<faction> (ui/conquest.ts perkKey)
  { table: 'conquestPerk', rows: () => CQ.PERKS.map((p) => [p.faction ? `${p.id}.${p.faction}` : p.id, p] as [string, unknown]), fields: ['name', 'desc'] },
  { table: 'conquestDoctrine', rows: byId(CQ.DOCTRINES), fields: ['name', 'desc'] },
  { table: 'conquestResearch', rows: byId(CQ.RESEARCH), fields: ['name', 'desc'] },
  { table: 'conquestResource', rows: entries(CQ.RESOURCES), fields: ['name', 'desc'] },
  { table: 'conquestPersonality', rows: entries(CQ.PERSONALITIES), fields: ['name', 'desc'] },
  { table: 'conquestTitle', rows: byId(CQ.TITLES), fields: ['name', 'desc'] },
];

/** Every [key, English] pair of one field path in a record. */
function collect(rec: unknown, path: string[], prefix: string, out: Record<string, string>) {
  if (!path.length) {
    if (typeof rec === 'string' && rec.trim()) out[prefix] = rec;
    return;
  }
  if (!rec || typeof rec !== 'object') return;
  const [head, ...rest] = path;
  if (head === '*') {
    if (Array.isArray(rec)) rec.forEach((v, i) => collect(v, rest, `${prefix}.${i}`, out));
    return;
  }
  collect((rec as Record<string, unknown>)[head], rest, `${prefix}.${head}`, out);
}

/** The English game-data catalogue, sorted by key. */
export function collectDataEnglish(sources: DataSource[] = DATA_SOURCES): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sources) {
    for (const [id, rec] of s.rows()) for (const f of s.fields) collect(rec, f.split('.'), `${s.table}.${id}`, out);
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}
