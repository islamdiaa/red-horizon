/**
 * Translation catalogue tool.
 *
 *   node --import tsx tools/i18n/catalog.ts sync              regenerate src/i18n/source/data.en.json from the game data
 *   node --import tsx tools/i18n/catalog.ts en [out.json]     the full English catalogue (flat), for translators
 *   node --import tsx tools/i18n/catalog.ts missing <lang> [out.json] [keyRegex]   English entries a locale lacks
 *   node --import tsx tools/i18n/catalog.ts coverage          keys translated per locale
 *   node --import tsx tools/i18n/catalog.ts check [lang]      placeholder / markup / HTML problems in translations
 *   node --import tsx tools/i18n/catalog.ts prune <lang>      drop keys English no longer has
 *   node --import tsx tools/i18n/catalog.ts merge <lang> <batch.json>...   merge translated batches into a locale
 */
import fs from 'node:fs';
import { collectDataEnglish } from './data-sources';
import { DATA_EN, LOCALE_DIR, OTHER_LANGS, checkTranslation, loadEnglish, loadLocale } from './lib';
import { isLang } from '../../src/i18n/langs';
import path from 'node:path';

const [cmd, a1, a2] = process.argv.slice(2);
const write = (out: string | undefined, data: unknown) => {
  const s = JSON.stringify(data, null, 1) + '\n';
  if (out) fs.writeFileSync(out, s); else process.stdout.write(s);
};
const lang = (v: string | undefined) => {
  if (!v || v === 'en' || !isLang(v)) throw new Error(`unknown language "${v}" (one of ${OTHER_LANGS.join(', ')})`);
  return v as (typeof OTHER_LANGS)[number];
};

if (cmd === 'sync') {
  const data = collectDataEnglish();
  fs.mkdirSync(path.dirname(DATA_EN), { recursive: true });
  fs.writeFileSync(DATA_EN, JSON.stringify(data, null, 1) + '\n');
  console.log(`${Object.keys(data).length} game-data strings → ${path.relative(process.cwd(), DATA_EN)}`);
} else if (cmd === 'en') {
  write(a1, await loadEnglish());
} else if (cmd === 'missing') {
  const en = await loadEnglish();
  const loc = loadLocale(lang(a1));
  const only = process.argv[5] ? new RegExp(process.argv[5]) : null; // optional key filter, e.g. '^hud\\.'
  write(a2, Object.fromEntries(Object.entries(en).filter(([k]) => !loc[k] && (!only || only.test(k)))));
} else if (cmd === 'coverage') {
  const en = await loadEnglish();
  const n = Object.keys(en).length;
  console.log(`English: ${n} keys`);
  for (const l of OTHER_LANGS) {
    const loc = loadLocale(l);
    const have = Object.keys(en).filter((k) => loc[k]).length;
    const extra = Object.keys(loc).filter((k) => !(k in en)).length;
    console.log(`${l.padEnd(6)} ${((100 * have) / n).toFixed(1).padStart(5)}%  ${have}/${n}${extra ? `  (${extra} stale keys)` : ''}`);
  }
} else if (cmd === 'check') {
  const en = await loadEnglish();
  let bad = 0;
  for (const l of a1 ? [lang(a1)] : OTHER_LANGS) {
    const loc = loadLocale(l);
    for (const [k, v] of Object.entries(loc)) {
      if (!(k in en)) continue;
      const p = checkTranslation(en[k], v);
      if (p.length) { bad++; console.log(`${l} ${k}: ${p.join(', ')}\n   en: ${en[k]}\n   ${l}: ${v}`); }
    }
  }
  console.log(bad ? `${bad} problem(s)` : 'no problems');
  process.exitCode = bad ? 1 : 0;
} else if (cmd === 'merge') {
  // merge translated batch files (flat JSON) into a locale; only keys English has, values must be strings
  const l = lang(a1);
  const en = await loadEnglish();
  const loc = loadLocale(l);
  let added = 0, skipped = 0;
  for (const f of process.argv.slice(4)) {
    const batch = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown>;
    for (const [k, v] of Object.entries(batch)) {
      if (!(k in en) || typeof v !== 'string' || !v.trim()) { skipped++; continue; }
      loc[k] = v;
      added++;
    }
  }
  const sorted = Object.fromEntries(Object.keys(loc).sort().map((k) => [k, loc[k]]));
  fs.writeFileSync(path.join(LOCALE_DIR, `${l}.json`), JSON.stringify(sorted, null, 1) + '\n');
  console.log(`${l}: merged ${added}, skipped ${skipped} (unknown keys or empty), now ${Object.keys(sorted).length} keys`);
} else if (cmd === 'prune') {
  const l = lang(a1);
  const en = await loadEnglish();
  const loc = loadLocale(l);
  const kept = Object.fromEntries(Object.keys(loc).filter((k) => k in en).sort().map((k) => [k, loc[k]]));
  fs.writeFileSync(path.join(LOCALE_DIR, `${l}.json`), JSON.stringify(kept, null, 1) + '\n');
  console.log(`${l}: kept ${Object.keys(kept).length}, dropped ${Object.keys(loc).length - Object.keys(kept).length}`);
} else {
  console.log('usage: catalog.ts sync | en [out] | missing <lang> [out] | coverage | check [lang] | prune <lang>');
}
