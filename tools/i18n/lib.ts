/** Shared by tools/i18n/catalog.ts and tests/i18n.test.ts: the full English catalogue and the locale files. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { englishCatalog } from '../../src/i18n/core';
import { messageParams } from '../../src/i18n/format';
import { LANGS, type Lang } from '../../src/i18n/langs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const EN_DIR = path.join(ROOT, 'src/i18n/en');
export const LOCALE_DIR = path.join(ROOT, 'src/i18n/locales');
export const DATA_EN = path.join(ROOT, 'src/i18n/source/data.en.json');
export const OTHER_LANGS = LANGS.filter((l) => l !== 'en') as Exclude<Lang, 'en'>[];

/** The interface strings: every src/i18n/en/<ns>.ts module, registered. */
export async function loadUiEnglish(): Promise<Record<string, string>> {
  for (const f of fs.readdirSync(EN_DIR).filter((f) => f.endsWith('.ts')).sort()) await import(pathToFileURL(path.join(EN_DIR, f)).href);
  return { ...englishCatalog() };
}

/** The game-data strings as last synced (src/i18n/source/data.en.json). */
export function loadDataEnglish(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(DATA_EN, 'utf8')); } catch { return {}; }
}

/** Every English key: interface plus game data. */
export async function loadEnglish(): Promise<Record<string, string>> {
  return { ...(await loadUiEnglish()), ...loadDataEnglish() };
}

export function loadLocale(l: Exclude<Lang, 'en'>): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, `${l}.json`), 'utf8'));
}

/** The safe markup markers a message uses, in order ([b], [/b], [br]...). */
export const markers = (s: string): string[] => s.match(/\[\/?(?:b|i|em|strong|kbd|small)\]|\[br\]/g) ?? [];
/** Key-binding placeholders ({key:attackMove}, {mod:assign}). */
export const keyHoles = (s: string): string[] => (s.match(/\{(?:key|mod):\w+\}/g) ?? []).sort();

/** Problems with one translation against its English source. */
export function checkTranslation(en: string, tr: string): string[] {
  const out: string[] = [];
  if (/<\/?[a-z][^>]*>|&[a-z#0-9]+;/i.test(tr)) out.push('raw HTML');
  const pe = messageParams(en), pt = messageParams(tr);
  for (const p of pt) if (!pe.includes(p)) out.push(`unknown parameter {${p}}`);
  for (const p of pe) if (!pt.includes(p) && !/plural|select/.test(en)) out.push(`missing parameter {${p}}`);
  if ([...new Set(keyHoles(en))].join() !== [...new Set(keyHoles(tr))].join()) out.push('key placeholders differ');
  // the same kinds of markers (plural branches may repeat them a different number of times), each one closed
  const kinds = (s: string) => [...new Set(markers(s))].sort().join();
  if (kinds(en) !== kinds(tr)) out.push('markup markers differ');
  for (const tag of ['b', 'i', 'em', 'strong', 'kbd', 'small']) {
    const m = markers(tr);
    if (m.filter((x) => x === `[${tag}]`).length !== m.filter((x) => x === `[/${tag}]`).length) out.push(`unclosed [${tag}]`);
  }
  let depth = 0;
  for (const c of tr) { if (c === '{') depth++; else if (c === '}' && --depth < 0) break; }
  if (depth !== 0) out.push('unbalanced braces');
  return out;
}
