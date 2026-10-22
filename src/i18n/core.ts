/**
 * Interface translation, dependency-free.
 *
 *  - English is the source and the fallback. Its strings live in namespace modules (src/i18n/en/<ns>.ts) that
 *    register themselves when first imported, so each chunk carries the English it uses.
 *  - Every other language is one flat JSON catalogue (src/i18n/locales/<lang>.json), lazy-loaded: only the active
 *    language is downloaded. A key missing from it falls back to English.
 *  - The preference is 'auto' (the browser's languages) or a fixed language, stored in localStorage.
 *  - Translations are plain text. Insert them with textContent, or through esc() / the `.html()` variants, which
 *    escape everything and turn the safe markers [b] [i] [em] [strong] [kbd] [small] (and their closers) and [br]
 *    into tags. Translations never contain raw HTML (tests/i18n.test.ts).
 *  - Never translate at module scope: look strings up when rendering, so a language change applies.
 */
import { formatMessage, numberFormat, type Params } from './format';
import { detectLang, isLang, type Lang, type LangPref } from './langs';

export type { Lang, LangPref, Params };
export { LANGS, LANG_NAMES, detectLang, matchLang, isLang } from './langs';

export type Catalog = Record<string, string>;

/** The dotted leaf keys of a nested string table. */
export type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** A nested table of English strings. */
export interface StringTree { [k: string]: string | StringTree }

const PREF_KEY = 'rh.lang';
/** All English strings registered so far (flat, "ns.a.b"). */
const EN: Catalog = Object.create(null);
let lang: Lang = 'en';
/** The active non-English catalogue (null for English). */
let table: Catalog | null = null;
const loaded = new Map<Lang, Catalog>();
const listeners = new Set<(l: Lang) => void>();
const warned = new Set<string>();

const DEV = (() => { try { return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV; } catch { return false; } })();

function flattenInto(obj: StringTree, prefix: string, out: Catalog) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'string') out[prefix + k] = v;
    else if (v && typeof v === 'object') flattenInto(v, `${prefix}${k}.`, out);
  }
}

/** Flatten a nested table into dotted keys. */
export function flatten(obj: StringTree, prefix = ''): Catalog {
  const out: Catalog = {};
  flattenInto(obj, prefix ? `${prefix}.` : '', out);
  return out;
}

/** (`&apos;`, not `&#39;`: a # inside a plural branch is the number.) */
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const MARKUP = /\[(\/?)(b|i|em|strong|kbd|small)\]|\[br\]/g;
/** Escape a translated message and turn its safe markers into tags. */
function markup(s: string): string {
  return escHtml(s).replace(MARKUP, (m, close: string, tag: string) => (m === '[br]' ? '<br>' : `<${close}${tag}>`));
}
/** Drop the safe markers (plain-text contexts: title attributes, aria labels, canvas text). */
const unmark = (s: string) => (s.indexOf('[') < 0 ? s : s.replace(MARKUP, (m) => (m === '[br]' ? ' ' : '')));

function raw(key: string): string | undefined {
  return (table && table[key]) ?? EN[key];
}

function missing(key: string): string {
  if (DEV && !warned.has(key)) { warned.add(key); console.warn(`[i18n] missing key ${key}`); }
  return key;
}

/** Translate a dynamic key (built at run time). `fallback` is used (formatted) when no catalogue has the key. */
export function tx(key: string, params?: Params, fallback?: string): string {
  const m = raw(key) ?? fallback;
  return m === undefined ? missing(key) : formatMessage(unmark(m), params, lang);
}

/** HTML-safe variant of tx(): everything escaped, [b]…[/b] style markers turned into tags. */
export function txHtml(key: string, params?: Params, fallback?: string): string {
  const m = raw(key) ?? fallback;
  return m === undefined ? escHtml(missing(key)) : formatMessage(markup(m), params, lang, escHtml);
}

/** Whether English (the source) has this key. */
export const hasKey = (key: string): boolean => key in EN;

export interface Translator<K extends string> {
  /** The translated plain text (markers stripped): for textContent, attributes, or esc() into HTML. */
  (key: K, params?: Params): string;
  /** The translated text as safe HTML: escaped, with [b] [i] [kbd] ... markers turned into tags. */
  html(key: K, params?: Params): string;
  /** The namespace prefix ("hud"), for dynamic keys with tx(). */
  readonly ns: string;
}

/**
 * Register a namespace of English strings (src/i18n/en/<ns>.ts) and get its typed translator:
 *   const T = strings('hud', { build: { cost: '{n} credits' } });  T('build.cost', { n: 5 })
 */
export function strings<T extends StringTree>(ns: string, tree: T): Translator<Leaves<T>> {
  flattenInto(tree, `${ns}.`, EN);
  const fn = ((key: string, params?: Params) => tx(`${ns}.${key}`, params)) as Translator<Leaves<T>>;
  fn.html = (key: string, params?: Params) => txHtml(`${ns}.${key}`, params);
  Object.defineProperty(fn, 'ns', { value: ns });
  return fn;
}

const live = new WeakMap<object, object>();
function liveView<T extends object>(obj: T, prefix: string): T {
  let p = live.get(obj) as T | undefined;
  if (!p) {
    p = new Proxy(obj, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof prop !== 'string') return v;
        if (typeof v === 'string') return (table && table[prefix + prop]) ?? v;
        return v && typeof v === 'object' ? liveView(v, `${prefix}${prop}.`) : v;
      },
    });
    live.set(obj, p);
  }
  return p;
}

/**
 * Register English like strings(), but get the table itself back, translating on every read: for modules that
 * expose `TEXT.key` tables or arrays (tips, labels by id). Values are the raw templates (placeholders intact, no
 * formatting), so callers that fill `{name}` themselves keep working; formatMessage() handles plurals.
 */
export function liveStrings<T extends object>(ns: string, tree: T): T {
  flattenInto(tree as unknown as StringTree, `${ns}.`, EN);
  return liveView(tree, `${ns}.`);
}

// Text produced in English by code that must not depend on the language (mission scripts, the simulation: it
// runs in lockstep and is saved) is translated where it is displayed, by matching the English it produced.
const sourceExact = new Map<string, string>();
const sourcePatterns: { key: string; re: RegExp; names: string[]; literal: number }[] = [];
const sourceCache = new Map<string, string>();

/**
 * Register English that other code emits verbatim, and get the same English tree back for that code to use
 * (one source of truth). trSource(text) at the display site then finds the translation. `{name}` placeholders
 * match any text: 'Destroy {n} tanks' translates "Destroy 5 tanks".
 */
export function sourceStrings<T extends StringTree>(ns: string, tree: T): T {
  const flat = flatten(tree, ns);
  for (const [k, v] of Object.entries(flat)) {
    EN[k] = v;
    if (!/\{\w+\}/.test(v)) { if (!sourceExact.has(v)) sourceExact.set(v, k); continue; }
    const names: string[] = [];
    const re = new RegExp(`^${v.split(/(\{\w+\})/).map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (m) { names.push(m[1]); return '(.+?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('')}$`, 's');
    sourcePatterns.push({ key: k, re, names, literal: v.replace(/\{\w+\}/g, '').length });
  }
  // the most specific template first: 'took the {structure} from {from}.' before 'took the {structure}.'
  sourcePatterns.sort((a, b) => b.literal - a.literal);
  sourceCache.clear();
  return tree;
}

/** Translators for the variable parts a template captured (names inside sentences): see addSourceResolver. */
const sourceResolvers: ((english: string) => string | null)[] = [];
/**
 * Translate captured parameters too: 'Destroy the {building}' with "Power Plant" → the translated structure name.
 * A resolver returns the translation of an English name, or null when it doesn't know it.
 */
export function addSourceResolver(fn: (english: string) => string | null) {
  sourceResolvers.push(fn);
  sourceCache.clear();
}
function resolveParam(v: string): string {
  if (!table || !v || /^[\d\s.,:%$+−-]*$/.test(v)) return v;
  const k = sourceExact.get(v);
  if (k && table[k]) return unmark(table[k]);
  for (const r of sourceResolvers) { const t = r(v); if (t != null) return t; }
  // a list the source joined ("Double Ore, Fast Production"): each name on its own
  for (const sep of [', ', ' · ', ' and ']) {
    if (!v.includes(sep)) continue;
    const parts = v.split(sep);
    const tr = parts.map(resolveParam);
    if (tr.some((t, i) => t !== parts[i])) return sep === ' and ' ? fmtList(tr) : tr.join(sep);
  }
  return v;
}

/** Whether `text` is English a registered source emits (tests keep the simulation's templates in sync). */
export const isSourceText = (text: string): boolean => sourceExact.has(text) || sourcePatterns.some((p) => p.re.test(text));

/** The translation of English text emitted by registered sources (sourceStrings); anything else unchanged. */
export function trSource(text: string): string {
  if (!table || !text) return text;
  const hit = sourceCache.get(text);
  if (hit !== undefined) return hit;
  let out = text;
  const k = sourceExact.get(text);
  if (k) out = table[k] ? unmark(table[k]) : text;
  else {
    let matched = false;
    for (const p of sourcePatterns) {
      const m = p.re.exec(text);
      if (!m) continue;
      matched = true;
      const tr = table[p.key];
      if (tr) out = formatMessage(unmark(tr), Object.fromEntries(p.names.map((n, i) => [n, resolveParam(m[i + 1])])), lang);
      break;
    }
    // a bare name the resolvers know (a structure type, a Conquest territory used as a code name...)
    if (!matched) for (const r of sourceResolvers) { const t = r(text); if (t != null) { out = t; break; } }
  }
  if (sourceCache.size > 500) sourceCache.clear();
  sourceCache.set(text, out);
  return out;
}

/** Format an ICU-lite template (from a liveStrings() table) in the active language. */
export const format = (template: string, params?: Params): string => formatMessage(template, params, lang);

/**
 * Game-data text (unit names, power descriptions, ...): the translation of `${table}.${id}.${field}`, else the
 * data's own English, which stays the source of truth (tools/i18n/sync-data.ts lists it for translators).
 */
export function dt(tableName: string, id: string, field: string, english: string, params?: Params): string {
  const m = (table && table[`${tableName}.${id}.${field}`]) ?? english;
  return formatMessage(unmark(m), params, lang);
}

let reverse: Map<string, string> | null = null;
/**
 * The English a translated interface string came from (exact matches of the active catalogue; anything else is
 * returned as is): for code that inspects text, such as the toast styling that looks for words like "ready".
 */
export function englishOf(text: string): string {
  if (!table) return text;
  if (!reverse) {
    reverse = new Map();
    for (const k in table) if (!reverse.has(table[k])) reverse.set(table[k], k);
  }
  const k = reverse.get(text);
  return (k && EN[k]) || text;
}

/** All registered English strings (flat). */
export const englishCatalog = (): Readonly<Catalog> => EN;
/** The active language. */
export const currentLang = (): Lang => lang;

// ---------------------------------------------------------------------------
// language preference and loading

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** The stored preference ('auto' when unset). */
export function languagePref(): LangPref {
  const v = storage()?.getItem(PREF_KEY);
  return isLang(v) ? v : 'auto';
}

/** The browser's preferred languages (empty outside a browser). */
function browserLangs(): string[] {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return [];
  const n = navigator as Navigator & { languages?: readonly string[] };
  return [...(n.languages ?? []), n.language].filter(Boolean) as string[];
}

/** The language a preference resolves to. */
export const resolvePref = (pref: LangPref, tags: readonly string[] = browserLangs()): Lang => (pref === 'auto' ? detectLang(tags) : pref);

/**
 * The locale catalogues: Vite turns the glob into one lazy chunk per file, so only the active language downloads.
 * Other bundlers (the multiplayer server's) see no import at all, and outside Vite (Node tests) there is nothing
 * to load: English, or what registerLocale() provided.
 */
function localeLoader(l: Lang): (() => Promise<{ default: unknown }>) | undefined {
  try {
    return import.meta.glob<{ default: unknown }>('./locales/*.json')[`./locales/${l}.json`];
  } catch {
    return undefined;
  }
}

/** Keep only string values with string keys (the catalogue is ours, but a broken file must not break the UI). */
function sanitize(data: unknown): Catalog {
  const out: Catalog = Object.create(null);
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

/** Make a catalogue available without loading it (tests, tools). */
export function registerLocale(l: Lang, data: unknown) {
  if (l !== 'en') loaded.set(l, sanitize(data));
}

async function load(l: Lang): Promise<Catalog | null> {
  if (l === 'en') return null;
  const have = loaded.get(l);
  if (have) return have;
  const timeout = new Promise<null>((res) => setTimeout(() => res(null), 8000));
  const loader = localeLoader(l);
  if (!loader) return null;
  const got = await Promise.race([loader().then((m) => sanitize(m.default)), timeout]);
  if (got) loaded.set(l, got);
  return got;
}

function activate(l: Lang, cat: Catalog | null) {
  lang = cat || l === 'en' ? l : 'en';
  table = lang === 'en' ? null : cat;
  sourceCache.clear();
  reverse = null;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const fn of listeners) { try { fn(lang); } catch { /* a listener must not break the switch */ } }
}

let switches = 0;
/** Switch to a language (or 'auto'), loading its catalogue; resolves to the language in effect. */
export async function setLanguage(pref: LangPref): Promise<Lang> {
  try {
    const s = storage();
    if (pref === 'auto') s?.removeItem(PREF_KEY);
    else s?.setItem(PREF_KEY, pref);
  } catch { /* private mode: this session only */ }
  const l = resolvePref(pref);
  const seq = ++switches;
  let cat: Catalog | null = null;
  try { cat = await load(l); } catch { cat = null; } // offline and not cached: English
  if (seq === switches) activate(l, cat); // a later switch that finished first wins
  return lang;
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLanguageChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Started at load: the saved (or browser) language. main.ts awaits it before building the menus. */
export const i18nReady: Promise<Lang> = (async () => {
  const l = resolvePref(languagePref());
  if (l === 'en') return 'en';
  const seq = switches;
  try { const cat = await load(l); if (seq === switches) activate(l, cat); } catch { /* English */ }
  return lang;
})();

// ---------------------------------------------------------------------------
// numbers, money, times and dates (Intl, in the active language)

/** A number in the active language: 1500 · 12,500 · 12 500 · 12.500 (grouped from 10,000 up). */
export const fmtNum = (n: number, maxFrac = 0): string => numberFormat(lang, 'min2', maxFrac).format(n);
/** A grouped integer: 1,500 · 1 500 · 1.500. */
export const fmtInt = (n: number): string => numberFormat(lang, 'always', 0).format(Math.round(n));
/** The thousands separator of the active language ("," "." or a narrow space), for digit-by-digit displays. */
export function groupSeparator(): string {
  try { return new Intl.NumberFormat(lang, { useGrouping: true }).formatToParts(10000).find((p) => p.type === 'group')?.value ?? ','; } catch { return ','; }
}
/** Credits: "$1,500" (the game's credit sign, with the active language's grouping). */
export const fmtMoney = (n: number): string => `${n < 0 ? '−' : ''}$${fmtInt(Math.abs(n))}`;
/** A ratio as a percentage: 0.25 → "25%" (or "25 %"). */
export function fmtPct(ratio: number, maxFrac = 0): string {
  try { return new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: maxFrac }).format(ratio); } catch { return `${Math.round(ratio * 100)}%`; }
}
/** A game clock: 03:07 or 1:02:03 (the same in every language). */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
/** A unit-formatted amount: fmtUnit(25, 'second') → "25 s" · "25 с" · "25秒". */
export function fmtUnit(n: number, unit: 'second' | 'minute' | 'hour' | 'day', display: 'narrow' | 'short' | 'long' = 'short'): string {
  try { return new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: display, maximumFractionDigits: 1 }).format(n); } catch { return `${n} ${unit[0]}`; }
}
/** A short duration: "45 s", "12 min", "1 h 5 min". */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return fmtUnit(s, 'second');
  const m = Math.round(s / 60);
  if (m < 60) return fmtUnit(m, 'minute');
  const h = Math.floor(m / 60);
  return m % 60 ? `${fmtUnit(h, 'hour')} ${fmtUnit(m % 60, 'minute')}` : fmtUnit(h, 'hour');
}
/** A calendar date ("18 Oct 2026", "18.10.2026", "2026年10月18日"). */
export function fmtDate(ts: number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  try { return new Intl.DateTimeFormat(lang, opts).format(ts); } catch { return new Date(ts).toDateString(); }
}
/** Date and time. */
export const fmtDateTime = (ts: number | Date): string => fmtDate(ts, { dateStyle: 'medium', timeStyle: 'short' });
/** Time of day ("14:05", "2:05 PM"). */
export const fmtTimeOfDay = (ts: number | Date): string => fmtDate(ts, { timeStyle: 'short' });
/** "5 min ago", "yesterday", "in 3 days". */
export function fmtRelative(ts: number, now = Date.now()): string {
  const s = (ts - now) / 1000;
  const a = Math.abs(s);
  const [v, u]: [number, Intl.RelativeTimeFormatUnit] = a < 45 ? [s, 'second'] : a < 2700 ? [s / 60, 'minute'] : a < 79200 ? [s / 3600, 'hour'] : [s / 86400, 'day'];
  try { return new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' }).format(Math.round(v), u); } catch { return `${Math.round(Math.abs(v))}${u[0]}`; }
}
/** "A, B and C" in the active language. */
export function fmtList(items: string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
  try { return new (Intl as unknown as { ListFormat: new (l: string, o: object) => { format(a: string[]): string } }).ListFormat(lang, { style: 'long', type }).format(items); } catch { return items.join(', '); }
}
