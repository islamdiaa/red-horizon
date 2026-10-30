/**
 * Static sweep for hard-coded English in src: string and template literals that read like player-facing prose
 * (a capitalised phrase or sentence, text between HTML tags, title / aria-label / placeholder attributes) and that
 * no catalogue registers (no English key has that text, no source template matches it). Developer text is skipped
 * (console, Error / throw arguments, import paths, CSS, ids). It is a review list, not a test: tests/i18n.test.ts
 * enforces the UI files; this covers the rest of src (simulation, missions, modes, net, render...).
 *
 *   node --import tsx tools/i18n/scan.ts [--root dir] [--json out.json] [--baseline old.json]
 *
 * --root scans another checkout (e.g. an earlier commit, `git archive <rev> src | tar -x -C dir`);
 * --baseline lists only hits that old.json (a previous --json) does not have (matched by file and text).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseAst } from 'rolldown/parseAst';
import { isSourceText } from '../../src/i18n/core';
import { loadEnglish } from './lib';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const ROOT = path.resolve(opt('--root') ?? path.join(import.meta.dirname, '../..'));

/** Not prose: key names, brand and technical words that stay as they are. */
const ALLOW = new Set(['Escape', 'Enter', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Ctrl', 'Dead', 'Unidentified', 'Process', 'Delete', 'Backspace',
  'Red Horizon', 'RED HORIZON', 'Commander', 'Error', 'HD', 'XP', 'FPS', 'OK', 'Esc', 'AI', 'MP', 'GPU', 'WebGL', 'WebGL 2', 'Chrome', 'Firefox', 'Safari',
  'Edge', 'Windows', 'Linux', 'Android', 'iOS', 'Mac', 'Rajdhani', 'Segoe UI', 'Tektur', 'Noto Sans SC', 'RH Cyrillic', 'RH CJK', 'Microsoft']);
/** Call arguments that are developer-facing. */
const DEV_CALLS = /^(console\.\w+|reportError|assert\w*|Error|TypeError|RangeError|SyntaxError|UntrustedInputError|warn|debug|log|require|import|querySelector\w*|getElementById|closest|matches|addEventListener|removeEventListener|setAttribute|getAttribute|removeAttribute|createElement\w*|fetch|postMessage|dispatchEvent|CustomEvent|Event|localStorage\.\w+|getItem|setItem|removeItem|define\w*|test|it|describe)$/;

type Node = { type?: string; start: number; end: number; value?: unknown; [k: string]: unknown };
interface Hit { file: string; line: number; text: string; kind: string }

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['i18n', 'node_modules'].includes(e.name)) out.push(...files(p)); } else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const calleeName = (n: Node | undefined): string => {
  if (!n) return '';
  if (n.type === 'Identifier') return String(n.name);
  if (n.type === 'MemberExpression' || n.type === 'StaticMemberExpression') return `${calleeName(n.object as Node)}.${calleeName(n.property as Node)}`.replace(/^\./, '');
  if (n.type === 'NewExpression' || n.type === 'CallExpression') return calleeName(n.callee as Node);
  return '';
};

async function main() {
  const en = await loadEnglish();
  const known = new Set(Object.values(en).map((v) => v.trim()));
  const registered = (t: string) => known.has(t) || isSourceText(t);
  const hits: Hit[] = [];
  const srcDir = path.join(ROOT, 'src');
  for (const file of files(srcDir)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const code = fs.readFileSync(file, 'utf8');
    const line = (pos: number) => code.slice(0, pos).split('\n').length;
    let ast: unknown;
    try { ast = parseAst(code, { lang: 'ts' }); } catch { continue; }
    const add = (text: string, at: number, kind: string) => {
      const t = text.replace(/\u0001/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
      if (!/[A-Za-z]{2,}/.test(t) || ALLOW.has(t) || registered(t)) return;
      hits.push({ file: rel, line: line(at), text: t, kind });
    };
    const prose = (v: string) => /^[A-Z][a-z]+(?:[ '’-][A-Za-z]+)+[.!?…:]?$/.test(v) || /^[A-Z][a-z]{2,}[.!?…]$/.test(v) || /^[A-Z][^{}<>=;]*[a-z][^{}<>=;]*[.!?]$/.test(v) && v.includes(' ');
    const visit = (n: unknown, dev: boolean) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { for (const c of n) visit(c, dev); return; }
      const node = n as Node;
      let isDev = dev;
      if (node.type === 'CallExpression' || node.type === 'NewExpression') {
        if (DEV_CALLS.test(calleeName(node)) || /\b(console|reportError)\b/.test(calleeName(node))) isDev = true;
      }
      if (node.type === 'ThrowStatement' || node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' && node.source || node.type === 'ExportAllDeclaration' || node.type === 'TSLiteralType' || node.type === 'ImportExpression') isDev = true;
      if (!isDev) {
        if (node.type === 'TemplateLiteral') {
          const quasis = node.quasis as { value: { cooked?: string; raw: string } }[];
          const s = quasis.map((q) => q.value.cooked ?? q.value.raw).join('\u0001');
          if (/\b(vec[234]|gl_\w+|uniform|varying|#include|texture2?D?)\b/.test(s)) { /* GLSL */ return; }
          // a template a catalogue registers with {placeholders}: its holes match anything
          if (quasis.length > 1 && registered(quasis.map((q) => q.value.cooked ?? q.value.raw).join('X').trim())) return;
          for (const m of s.matchAll(/>([^<>]*)</g)) add(m[1], node.start, 'html');
          for (const m of s.matchAll(/\b(?:title|aria-label|placeholder|alt|data-tip)="([^"]*)"/g)) add(m[1], node.start, 'attr');
          const plain = s.replace(/\u0001/g, ' ').trim();
          if (!/[<>]/.test(s) && prose(plain.replace(/\s+/g, ' '))) add(plain, node.start, 'template');
        } else if (node.type === 'Literal' && typeof node.value === 'string') {
          const v = node.value.trim();
          if (/[<>]/.test(v)) { for (const m of v.matchAll(/>([^<>]*)</g)) add(m[1], node.start, 'html'); }
          else if (prose(v)) add(v, node.start, 'literal');
        }
      }
      for (const [k, v] of Object.entries(node)) if (k !== 'type' && v && typeof v === 'object') visit(v, isDev);
    };
    visit(ast, false);
  }
  const base = opt('--baseline');
  let out = hits;
  if (base) {
    const old = new Set((JSON.parse(fs.readFileSync(base, 'utf8')) as Hit[]).map((h) => `${h.file}|${h.text}`));
    out = hits.filter((h) => !old.has(`${h.file}|${h.text}`));
  }
  const json = opt('--json');
  if (json) fs.writeFileSync(json, JSON.stringify(hits, null, 1));
  const byFile = new Map<string, Hit[]>();
  for (const h of out) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h]);
  for (const [f, hs] of [...byFile].sort()) {
    console.log(f);
    for (const h of hs) console.log(`  ${h.line}  [${h.kind}] ${h.text.slice(0, 140)}`);
  }
  console.log(`${out.length} ${base ? 'new ' : ''}unregistered English-looking strings in ${byFile.size} files (${hits.length} in total)`);
}
await main();
