/**
 * Mission text for translators: the English the campaign, special-operations, naval and co-op mission scripts show
 * (briefings, tips, debriefs, objectives, radio lines, timer and score labels, defeat reasons, player and code names)
 * stays in the scripts (it runs in the simulation: saved, lockstep, hashed). This tool collects it from the source
 * and writes src/i18n/en/missions.ts, which registers it (sourceStrings) so trSource() translates it where it is
 * shown, and which the locale files translate (keys missions.<file>.<slug>).
 *
 *   node --import tsx tools/i18n/mission-text.ts          write src/i18n/en/missions.ts (keeps the keys of text that
 *                                                          did not change; new text gets new keys)
 *   node --import tsx tools/i18n/mission-text.ts check    list text the scripts show that nothing registers
 *
 * tests/i18n-missions.test.ts runs the check: a script line added or reworded without re-running this tool fails it.
 * `${expr}` parts of template strings become {placeholders} named after the expression ("${left} left" -> "{left}
 * left"); trSource() matches any text there and translates names it knows (structure and unit names, compass
 * directions, registered source text).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DAILY_MODIFIERS } from '../../src/meta/daily';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'src/i18n/en/missions.ts');

/** The scripts, by group (the key prefix). Boot Camp is src/i18n/en/tutorial.ts already. */
export const SOURCES: Record<string, string> = {
  allied: 'src/missions/allied.ts',
  soviet: 'src/missions/soviet.ts',
  special: 'src/missions/special.ts',
  naval: 'src/missions/naval.ts',
  common: 'src/missions/common.ts',
  index: 'src/missions/index.ts',
};

/** Calls whose string arguments are shown. */
const SHOWN_CALLS = new Set(['say', 'objective', 'lose', 'startTimer', 'addScore', 'progress', 'retext', 'hint', 'toast', 'message', 'reinforce']);
/** Object properties whose string values are shown (MissionDef, players, debriefs, survival fronts). */
const SHOWN_PROPS = new Set(['briefing', 'tips', 'name', 'title', 'location', 'date', 'codename', 'win', 'lose', 'hordeName', 'blurb', 'text', 'label', 'reason', 'speaker', 'line', 'lines']);
/** Calls whose string arguments are never shown (look-ups, comparisons). */
const HIDDEN_CALLS = new Set(['has', 'includes', 'replace', 'toLocaleString', 'get', 'set', 'startsWith', 'endsWith', 'indexOf', 'split', 'join', 'warn', 'log', 'error', 'test', 'match']);

export interface Found { group: string; file: string; line: number; text: string; how: string }

type Node = { type: string; start: number; [k: string]: unknown };

const prose = (s: string) => /\p{L}{2,}[^\p{L}]+\p{L}{2,}/u.test(s) || /^[A-Z][a-z]{2,}/.test(s);

/** A placeholder name for a template part: the variable, property or function it reads. */
function holeName(n: Node): string {
  if (n.type === 'Identifier') return String(n.name);
  if (n.type === 'MemberExpression') { const p = n.property as Node; return p.type === 'Identifier' ? String(p.name) : holeName(n.object as Node); }
  if (n.type === 'CallExpression') {
    const c = n.callee as Node;
    const name = c.type === 'Identifier' ? String(c.name) : c.type === 'MemberExpression' ? holeName(c) : 'x';
    return name === 'compass' ? 'direction' : name === 'mmss' || name === 'fmt' ? 'time' : name === 'toLocaleString' || name === 'fmtMoney' ? 'money'
      : /^(round|floor|ceil|max|min|toFixed)$/.test(name) ? 'n' : name;
  }
  if (n.type === 'ConditionalExpression') {
    // `${/^[aeiou]/.test(x) ? 'an' : 'a'} ${name}`: an English article
    const a = n.consequent as Node, b = n.alternate as Node;
    if (a.type === 'Literal' && b.type === 'Literal' && /^an?$/.test(String(a.value)) && /^an?$/.test(String(b.value))) return 'article';
    return 'x';
  }
  if (n.type === 'LogicalExpression') return 'x';
  if (n.type === 'BinaryExpression') return 'n';
  return 'x';
}

/**
 * A template's text with {placeholders}; a part that picks between strings (`${n === 1 ? 'a base' : 'bases'}`)
 * gives one whole text per choice instead (they translate as sentences), at most 8 in all.
 */
function renderTemplate(node: Node, used: Map<string, number>): string[] {
  const quasis = node.quasis as { value: { cooked: string } }[];
  const exprs = node.expressions as Node[];
  let out = [''];
  quasis.forEach((q, i) => {
    out = out.map((t) => t + q.value.cooked);
    if (i >= exprs.length) return;
    const e = exprs[i];
    const branch = (b: Node): string[] | null => (b.type === 'Literal' && typeof b.value === 'string' ? [b.value] : b.type === 'TemplateLiteral' ? renderTemplate(b, used) : null);
    const choices = e.type === 'ConditionalExpression' && holeName(e) !== 'article' ? [branch(e.consequent as Node), branch(e.alternate as Node)] : null;
    if (choices && choices[0] && choices[1] && out.length * (choices[0].length + choices[1].length) <= 8) {
      out = out.flatMap((t) => [...choices[0]!, ...choices[1]!].map((c) => t + c));
      return;
    }
    let h = holeName(e);
    const k = (used.get(h) ?? 0) + 1;
    used.set(h, k);
    if (k > 1) h += k;
    out = out.map((t) => `${t}{${h}}`);
  });
  return out;
}

export async function collect(): Promise<Found[]> {
  const { parseAst } = await import(pathToFileURL(path.join(ROOT, 'node_modules/rolldown/dist/parse-ast-index.mjs')).href) as { parseAst: (c: string, o: object) => unknown };
  const out: Found[] = [];
  for (const [group, rel] of Object.entries(SOURCES)) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const code = fs.readFileSync(file, 'utf8');
    const lineOf = (pos: number) => code.slice(0, pos).split('\n').length;
    const visit = (n: unknown, parents: Node[]) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { for (const c of n) visit(c, parents); return; }
      const node = n as Node;
      if (typeof node.type !== 'string') return;
      let texts: string[] | null = null;
      if (node.type === 'Literal' && typeof node.value === 'string') texts = [node.value];
      else if (node.type === 'TemplateLiteral') texts = renderTemplate(node, new Map());
      for (const text of texts ?? []) {
        const words = text.replace(/\{\w+\}/g, ' ');
        // prose anywhere; in a place that shows text, a single word too ("BLACKOUT", "0 / 7 trains")
        if (prose(words) || /\p{L}{3,}/u.test(words)) {
          const how = context(parents, node) ?? (process.env.L10N_DEBUG && prose(words) ? 'REJECTED' : null);
          if (how && (prose(words) || /^(codename|title|name|label|hordeName):$|^(progress|startTimer|addScore|objective|lose)\(\)$/.test(how))) out.push({ group, file: rel, line: lineOf(node.start), text, how });
        }
      }
      if (texts !== null && node.type === 'TemplateLiteral') return; // (its parts were read as one text)
      const next = [...parents, node];
      for (const [k, v] of Object.entries(node)) if (k !== 'type' && v && typeof v === 'object') visit(v, next);
    };
    visit(parseAst(code, { lang: 'ts' }), []);
  }
  return out;
}

/** Why a literal is shown text (or null when it is a look-up, an id, a log line...). */
/** The argument that carries the text, for calls whose other arguments are ids (objective('outpost', 'Destroy...')). */
const TEXT_ARG: Record<string, number> = { objective: 1, progress: 1, retext: 1, startTimer: 2, addScore: 0, lose: 0 };

function context(parents: Node[], node: Node): string | null {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i];
    if (p.type === 'CallExpression') {
      const c = p.callee as Node;
      const name = c.type === 'MemberExpression' ? String((c.property as Node).name ?? '') : c.type === 'Identifier' ? String(c.name) : '';
      if (HIDDEN_CALLS.has(name)) return null;
      const child = i === parents.length - 1 ? node : parents[i + 1];
      const arg = (p.arguments as Node[]).indexOf(child);
      if (name in TEXT_ARG && arg >= 0 && arg !== TEXT_ARG[name]) return null;
      if (SHOWN_CALLS.has(name)) return `${name}()`;
      // a helper that forwards text (say(m, C.x, `...`) etc.): keep looking outwards only through conditionals
      continue;
    }
    if (p.type === 'Property') {
      const k = p.key as Node;
      const key = k.type === 'Identifier' ? String(k.name) : String(k.value ?? '');
      if (key === 'id' || key === 'mapId' || key === 'weather' || key === 'climate') return null;
      if (SHOWN_PROPS.has(key)) return `${key}:`;
      continue;
    }
    if (p.type === 'ConditionalExpression' || p.type === 'LogicalExpression' || p.type === 'ArrayExpression' || p.type === 'TemplateLiteral' || p.type === 'SpreadElement' || p.type === 'ObjectExpression' || p.type === 'ParenthesizedExpression' || p.type === 'TSAsExpression') continue;
    if (p.type === 'VariableDeclarator' || (p.type === 'AssignmentExpression' && (p.left as Node).type === 'Identifier')) {
      const id = (p.type === 'VariableDeclarator' ? p.id : p.left) as Node;
      const name = id.type === 'Identifier' ? String(id.name) : '';
      // text kept in a variable first: names that say so (line, text, msg, reason, label, title, objective...)
      return /^(line|lines|text|texts|msg|message|reason|label|title|objective|obj|radio|warn|warning|taunt|taunts|say|said|hint|hints|brief|briefing|tips?|name|names|speech|quote|quotes)\w*$/i.test(name) ? `${name} =` : null;
    }
    if (p.type === 'ReturnStatement') continue;
    if (p.type === 'ArrowFunctionExpression' || p.type === 'FunctionExpression' || p.type === 'FunctionDeclaration') return null;
    if (p.type === 'BinaryExpression' || p.type === 'SwitchCase' || p.type === 'IfStatement' || p.type === 'AssignmentExpression') return null;
  }
  return null;
}

/** A readable key for a text: its first words, camelCased ("threeDaysAgoThe"). */
function slug(text: string): string {
  const words = text.replace(/\{\w+\}/g, ' ').normalize('NFKD').replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5);
  const s = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('');
  return /^[a-z]/.test(s) ? s : `t${s}`;
}

const tsString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

/** group + text -> key in the current file, so unchanged text keeps its key (and its translations). Read as text: importing it would register it. */
function existingKeys(): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(OUT)) return map;
  let group = '';
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    const g = /^ {2}(\w+): \{$/.exec(line);
    if (g) { group = g[1]; continue; }
    const e = /^ {4}(\w+): '((?:[^'\\]|\\.)*)',$/.exec(line);
    if (e && group) map.set(`${group}\u0000${e[2].replace(/\\n/g, '\n').replace(/\\(.)/g, '$1')}`, e[1]);
  }
  return map;
}

/**
 * Text the scripts assemble from parts at run time, where a template would not translate well: whole sentences
 * instead. Mirrors the scripts (src/missions/special.ts survival waves, allied.ts compass()); the coverage tool
 * (tools/i18n/mission-coverage.ts) shows when they drift.
 */
function composed(found: Found[]): { extra: Found[]; skip: Set<string> } {
  const extra: Found[] = [], skip = new Set<string>();
  const add = (f: Found, text: string, how: string) => extra.push({ ...f, text, how });
  for (const f of found) {
    // a direction word inside a sentence ("on the north-east side"): one sentence per direction (grammar)
    if (/\{dir\}/.test(f.text)) {
      skip.add(f.text);
      for (const d of ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east', 'far']) add(f, f.text.replace('{dir}', d), 'per direction');
    }
    // "{article} {name}": the article and the name are one translated part (registered below with their article)
    if (f.text.includes('{article} {name}')) { skip.add(f.text); add(f, f.text.replace('{article} {name}', '{boss}'), 'boss'); }
    // survival waves in co-op: the line names the base the wave goes for (special.ts: `line.replace(/!$/, ...)`)
    if (f.group === 'special' && /^Wave \{n\}: /.test(f.text)) {
      if (/AIR RAID/.test(f.text)) add(f, `${f.text} Target: {name}'s base.`, 'co-op');
      else if (/!$/.test(f.text) && !/pincer/.test(f.text)) add(f, f.text.replace(/!$/, ", heading for {name}'s base!"), 'co-op');
    }
    // compass() names (common.ts): only used inside the per-direction sentences above
    if (f.group === 'common' && f.how === 'names =') skip.add(f.text);
    // the Daily Challenge's generated briefing is never shown (the challenge screen writes its own)
    if (/holds the field\. Destroy every enemy structure and unit\.$/.test(f.text)) skip.add(f.text);
  }
  const special = found.find((f) => f.group === 'special') ?? found[0];
  if (special) {
    // the sides waves come from ("...from the {side}!"): translators write them as they read after "from the"
    for (const w of ['north', 'south', 'east', 'west']) add({ ...special, group: 'words' }, w, 'side');
    // boss waves, with their article ("a Mammoth column")
    for (const b of ['a Mammoth column', 'a V2 rocket battery', 'an artillery battery', 'an armoured spearhead']) add({ ...special, group: 'words' }, b, 'boss');
    // the Daily Challenge's conditions, named in its opening radio line (special.ts: modifier names joined by ", ")
    for (const d of DAILY_MODIFIERS) add({ ...special, group: 'words' }, d.name, 'daily modifier');
  }
  return { extra, skip };
}

async function write() {
  const raw = await collect();
  const { extra, skip } = composed(raw);
  const found = [...raw.filter((f) => !skip.has(f.text)), ...extra];
  // already registered elsewhere (cast names, tutorial, conquest...): not repeated here
  const core = await import(pathToFileURL(path.join(ROOT, 'src/i18n/core.ts')).href) as typeof import('../../src/i18n/core');
  const keep = existingKeys();
  // an empty module while the other English registers (campaign-cast.ts imports this one): what is left is "elsewhere"
  fs.writeFileSync(OUT, "import { sourceStrings } from '../core';\n\nexport const MISSION_TEXT = sourceStrings('missions', {});\n");
  const others = new Set<string>();
  for (const f of fs.readdirSync(path.join(ROOT, 'src/i18n/en')).filter((x) => x.endsWith('.ts') && x !== 'missions.ts')) await import(pathToFileURL(path.join(ROOT, 'src/i18n/en', f)).href);
  // registered by another module (the cast, Boot Camp, Conquest...): the same English under a key outside missions.*
  // (templates compare without their placeholder names: "{left} left" is "{n} left")
  const norm = (t: string) => t.replace(/\{\w+\}/g, '{}');
  for (const f of found) if (core.isSourceText(f.text) || core.isSourceText(f.text.replace(/\{\w+\}/g, '1'))) others.add(f.text);
  const seenNorm = new Set<string>();
  const groups: Record<string, Map<string, string>> = {};
  for (const f of found) {
    if (others.has(f.text) || seenNorm.has(`${f.group}\u0000${norm(f.text)}`)) continue;
    seenNorm.add(`${f.group}\u0000${norm(f.text)}`);
    const g = (groups[f.group] ??= new Map());
    if ([...g.values()].includes(f.text)) continue;
    let k = keep.get(`${f.group}\u0000${f.text}`) ?? slug(f.text);
    if (g.has(k) && g.get(k) !== f.text) { let i = 2; while (g.has(`${k}${i}`)) i++; k = `${k}${i}`; }
    g.set(k, f.text);
  }
  const body = Object.entries(groups).map(([g, m]) => `  ${g}: {\n${[...m].map(([k, v]) => `    ${k}: ${tsString(v)},`).join('\n')}\n  },`).join('\n');
  const src = `/**
 * GENERATED by tools/i18n/mission-text.ts from the mission scripts (src/missions): do not edit by hand, re-run the
 * tool after changing mission text. The scripts emit this English (in the simulation); trSource() translates it where
 * it is shown, from the locale files (keys missions.<group>.<key>).
 */
import { sourceStrings } from '../core';

export const MISSION_TEXT = sourceStrings('missions', {
${body}
});
`;
  fs.writeFileSync(OUT, src);
  const n = Object.values(groups).reduce((a, m) => a + m.size, 0);
  console.log(`${n} mission texts -> ${path.relative(ROOT, OUT)} (${others.size} already registered elsewhere)`);
}

async function check(): Promise<Found[]> {
  const core = await import(pathToFileURL(path.join(ROOT, 'src/i18n/core.ts')).href) as typeof import('../../src/i18n/core');
  for (const f of fs.readdirSync(path.join(ROOT, 'src/i18n/en')).filter((x) => x.endsWith('.ts'))) await import(pathToFileURL(path.join(ROOT, 'src/i18n/en', f)).href);
  const raw = await collect();
  const { extra, skip } = composed(raw);
  return [...raw.filter((f) => !skip.has(f.text)), ...extra].filter((f) => !core.isSourceText(f.text));
}
export { check as unregisteredMissionText };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv[2] === 'check') {
    const bad = await check();
    for (const f of bad) console.log(`${f.file}:${f.line} (${f.how}) ${f.text}`);
    console.log(bad.length ? `${bad.length} unregistered` : 'all mission text registered');
    process.exitCode = bad.length ? 1 : 0;
  } else if (process.argv[2] === 'list') {
    for (const f of await collect()) console.log(`${f.file}:${f.line} (${f.how}) ${f.text}`);
  } else await write();
}
