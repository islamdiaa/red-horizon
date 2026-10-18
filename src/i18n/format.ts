/**
 * ICU-lite message formatting (no dependencies, no eval):
 *
 *   {name}                                    a parameter (numbers are locale-formatted: 12,500 · 12 500 · 12.500)
 *   {n, number}                               a number, always grouped
 *   {n, plural, =0 {none} one {# unit} other {# units}}
 *                                             plural categories from Intl.PluralRules (one, few, many, other...),
 *                                             exact matches (=N) first; # is the formatted number
 *   {side, select, allies {...} other {...}}  pick a branch by a string value
 *
 * Branches nest. An unknown parameter is left as written ("{name}"), so other placeholder syntaxes such as the
 * key-binding ones ({key:attackMove}, see ui/keymap.ts fillKeys) pass through untouched.
 */
export type ParamValue = string | number | null | undefined;
export type Params = Record<string, ParamValue>;

interface Ctx {
  lang: string;
  params: Params | undefined;
  /** Applied to parameter values (HTML-safe output). */
  esc: ((s: string) => string) | undefined;
}

const numFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

/** A cached number format: `group` 'min2' groups from 10,000 up (so 1500 stays "1500"), 'always' groups 1,500 too. */
export function numberFormat(lang: string, group: 'min2' | 'always' = 'min2', maxFrac = 2): Intl.NumberFormat {
  const k = `${lang}|${group}|${maxFrac}`;
  let f = numFormats.get(k);
  if (!f) {
    try {
      f = new Intl.NumberFormat(lang, { maximumFractionDigits: maxFrac, useGrouping: group === 'always' ? true : 'min2' } as Intl.NumberFormatOptions);
    } catch {
      f = new Intl.NumberFormat('en', { maximumFractionDigits: maxFrac });
    }
    numFormats.set(k, f);
  }
  return f;
}

function plural(lang: string, n: number): string {
  let r = pluralRules.get(lang);
  if (!r) {
    try { r = new Intl.PluralRules(lang); } catch { r = new Intl.PluralRules('en'); }
    pluralRules.set(lang, r);
  }
  return r.select(n);
}

/** Index of the brace that closes the one at `open` (or -1). */
function findClose(s: string, open: number, end: number): number {
  let depth = 0;
  for (let i = open; i < end; i++) {
    const c = s.charCodeAt(i);
    if (c === 123) depth++;
    else if (c === 125 && --depth === 0) return i;
  }
  return -1;
}

function value(v: ParamValue, ctx: Ctx): string {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? numberFormat(ctx.lang).format(v) : String(v)) : String(v ?? '');
  return ctx.esc ? ctx.esc(s) : s;
}

function render(s: string, start: number, end: number, ctx: Ctx, hash: string | null): string {
  let out = '';
  let last = start;
  for (let i = start; i < end; i++) {
    const c = s.charCodeAt(i);
    if (c === 123) {
      const close = findClose(s, i, end);
      if (close < 0) break; // unbalanced: the rest stays as written
      out += s.slice(last, i) + arg(s, i + 1, close, ctx, hash);
      i = close;
      last = close + 1;
    } else if (c === 35 && hash !== null) {
      out += s.slice(last, i) + hash;
      last = i + 1;
    }
  }
  return out + s.slice(last, end);
}

function arg(s: string, start: number, end: number, ctx: Ctx, hash: string | null): string {
  let c1 = s.indexOf(',', start);
  if (c1 >= end) c1 = -1;
  const name = s.slice(start, c1 < 0 ? end : c1).trim();
  const v = ctx.params ? ctx.params[name] : undefined;
  const has = !!ctx.params && Object.prototype.hasOwnProperty.call(ctx.params, name) && v !== undefined && v !== null;
  if (c1 < 0) return has ? value(v, ctx) : `{${s.slice(start, end)}}`;
  let c2 = s.indexOf(',', c1 + 1);
  if (c2 >= end) c2 = -1;
  const type = s.slice(c1 + 1, c2 < 0 ? end : c2).trim();
  if (type === 'number') return has && typeof v === 'number' ? numberFormat(ctx.lang, 'always').format(v) : has ? value(v, ctx) : '';
  if ((type !== 'plural' && type !== 'select') || c2 < 0) return has ? value(v, ctx) : '';
  const n = typeof v === 'number' ? v : Number(v);
  const want = type === 'plural' ? (Number.isFinite(n) ? plural(ctx.lang, n) : 'other') : String(v ?? '');
  let exact: [number, number] | null = null;
  let match: [number, number] | null = null;
  let other: [number, number] | null = null;
  let i = c2 + 1;
  while (i < end) {
    const b = s.indexOf('{', i);
    if (b < 0 || b >= end) break;
    const sel = s.slice(i, b).trim();
    const close = findClose(s, b, end);
    if (close < 0) break;
    const body: [number, number] = [b + 1, close];
    if (sel === 'other') other = body;
    if (type === 'plural' && sel.startsWith('=')) { if (!exact && Number(sel.slice(1)) === n) exact = body; }
    else if (!match && sel === want) match = body;
    i = close + 1;
  }
  const pick = exact ?? match ?? other;
  if (!pick) return '';
  return render(s, pick[0], pick[1], ctx, type === 'plural' ? (Number.isFinite(n) ? numberFormat(ctx.lang).format(n) : String(v ?? '')) : hash);
}

/** Format an ICU-lite message. `esc` (optional) is applied to every parameter value. */
export function formatMessage(msg: string, params: Params | undefined, lang: string, esc?: (s: string) => string): string {
  if (msg.indexOf('{') < 0) return msg;
  return render(msg, 0, msg.length, { lang, params, esc }, null);
}

/** The parameter names a message uses (for the catalogue tests). */
export function messageParams(msg: string): string[] {
  const out = new Set<string>();
  const walk = (start: number, end: number) => {
    for (let i = start; i < end; i++) {
      if (msg.charCodeAt(i) !== 123) continue;
      const close = findClose(msg, i, end);
      if (close < 0) return;
      const inner = msg.slice(i + 1, close);
      const c1 = inner.indexOf(',');
      const name = (c1 < 0 ? inner : inner.slice(0, c1)).trim();
      if (/^[A-Za-z_][\w]*$/.test(name)) out.add(name);
      const c2 = c1 < 0 ? -1 : inner.indexOf(',', c1 + 1);
      // plural / select: the parameters used inside each branch
      for (let j = c2 < 0 ? close : i + 1 + c2 + 1; j < close;) {
        const b = msg.indexOf('{', j);
        if (b < 0 || b >= close) break;
        const bc = findClose(msg, b, close);
        if (bc < 0) break;
        walk(b + 1, bc);
        j = bc + 1;
      }
      i = close;
    }
  };
  walk(0, msg.length);
  return [...out].sort();
}
