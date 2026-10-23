/**
 * Mission text coverage, measured by playing: runs every scripted mission headlessly (the campaign autopilots of
 * tools/campaigntest.ts) and records every text the mission shows (briefing, tips, debrief, player names, radio
 * lines, objectives and their progress, timer and score labels, the end reason), then checks that each one is
 * registered source English (trSource can find it) and translated in every language.
 *
 *   WORKERS=2 node --import tsx tools/i18n/mission-coverage.ts [missionId|all] [minutes=25]
 *
 * The static check (tools/i18n/mission-text.ts check, run by tests/i18n-missions.test.ts) reads the scripts; this
 * one also sees text the scripts assemble at run time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MissionRuntime, type MissionDef } from '../../src/sim/mission';
import { MISSIONS } from '../../src/missions';
import { runMission } from '../campaigntest';
import { englishCatalog, isSourceText, registerLocale, setLanguage, trSource } from '../../src/i18n/core';
import { loadEnglish, loadLocale, OTHER_LANGS, ROOT } from './lib';

const [which = 'all', minutesArg = '25'] = process.argv.slice(2);
const minutes = Number(minutesArg) || 25;

const seen = new Map<string, Set<string>>(); // text -> where
const note = (text: string | undefined | null, where: string) => {
  const t = (text ?? '').trim();
  if (!t || !/\p{L}{2,}/u.test(t)) return;
  (seen.get(t) ?? seen.set(t, new Set()).get(t)!).add(where);
};

// every text a mission script hands to the runtime
let current = '';
const P = MissionRuntime.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
const wrap = (name: string, pick: (a: unknown[]) => (string | undefined)[]) => {
  const orig = P[name];
  P[name] = function (this: unknown, ...a: unknown[]) { for (const t of pick(a)) note(t, `${current} ${name}()`); return orig.apply(this, a); };
};
wrap('say', (a) => [a[0] as string, a[1] as string]);
wrap('objective', (a) => [a[1] as string]);
wrap('progress', (a) => [a[1] as string]);
wrap('startTimer', (a) => [a[2] as string]);
wrap('addScore', (a) => [a[0] as string]);
wrap('lose', (a) => [a[0] as string]);

function statics(def: MissionDef) {
  const w = `${def.id} def`;
  for (const t of [def.title, def.codename, def.location, (def as { date?: string }).date]) note(t, w);
  for (const t of def.briefing ?? []) note(t, w);
  for (const t of def.tips ?? []) note(t, w);
  const d = (def as { debrief?: { win?: string; lose?: string; speaker?: string } }).debrief;
  if (d) for (const t of [d.win, d.lose, d.speaker]) note(t, w);
  for (const p of def.players ?? []) note(p.name, w);
}

const defs = Object.values(MISSIONS).filter((d) => (which === 'all' ? d.id !== 'daily' && d.id !== 'bootcamp' : d.id === which));
for (const def of defs) {
  current = def.id;
  statics(def);
  const t0 = Date.now();
  try {
    const r = runMission(def, minutes, 'auto', false);
    note(r.reason, `${def.id} end`);
    console.log(`${def.id}: ${r.won ? 'won' : r.ended ? 'lost' : 'timeout'} in ${Math.round(r.time / 60)} min (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  } catch (e) {
    console.log(`${def.id}: failed ${(e as Error).message}`);
  }
}

await loadEnglish();
await import('../../src/i18n/en/players');
const en = englishCatalog();
const unregistered = [...seen].filter(([t]) => !isSourceText(t));
const untranslated: string[] = [];
// translated only in part: a shorter template swallowed an unregistered line ("Daily Challenge #{n}" + the rest), or a
// name inside stayed English; English words left in a Russian or Chinese result show it
const partial: string[] = [];
for (const l of OTHER_LANGS) {
  registerLocale(l, loadLocale(l));
  await setLanguage(l);
  for (const [t] of seen) {
    const tr = trSource(t);
    if (isSourceText(t) && tr === t && !/^[\p{Lu}\d\s.·:/-]{1,12}$/u.test(t)) untranslated.push(`${l}: ${t}`);
    else if ((l === 'ru' || l === 'zh-CN') && tr !== t && /[A-Za-z]{3,}[\s,.:;!?-]+[A-Za-z]{3,}/.test(tr)) partial.push(`${l}: ${t}  ->  ${tr}`);
  }
}
await setLanguage('auto');
const out = path.join(ROOT, 'screenshots/l10n/mission-coverage.txt');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, [
  `${seen.size} texts seen in ${defs.length} missions; ${unregistered.length} not registered; ${untranslated.length} registered but shown untranslated`,
  '', '# not registered (add to the scripts\' text module / re-run tools/i18n/mission-text.ts)',
  ...unregistered.map(([t, w]) => `${t}    <- ${[...w].slice(0, 3).join(', ')}`),
  '', '# registered, but trSource leaves them in English',
  ...untranslated,
  '', '# translated only in part (English words left in the Russian / Chinese text)',
  ...partial,
].join('\n') + '\n');
console.log(`${seen.size} texts seen; ${unregistered.length} not registered; ${untranslated.length} untranslated; ${partial.length} partly translated -> ${path.relative(ROOT, out)} (${Object.keys(en).length} English keys)`);
