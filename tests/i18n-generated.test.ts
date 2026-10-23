// Generated names translate where they are shown: Daily Challenge and Conquest operation code names, Conquest call
// signs and enemy commanders, and the rivals' names (Russian and Chinese script). The generators keep the English
// (seeded, saved, shared in multiplayer); src/i18n/en/codenames.ts and players.ts translate it for display.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadLocale, OTHER_LANGS } from '../tools/i18n/lib';
import { hasKey, registerLocale, setLanguage, trSource } from '../src/i18n/core';
import { CONQUEST_CODE_WORDS, DAILY_CODE_WORDS, callSignName, codeName } from '../src/i18n/en/codenames';
import { personName, isPersonName, playerName } from '../src/i18n/en/players';
import '../src/i18n/en/menu';
import '../src/i18n/en/rivals';
import { dailyConfig, shiftDay } from '../src/meta/daily';
import { CALLSIGNS, COMMANDERS, SUPREME } from '../src/conquest/data';
import { generateRun } from '../src/conquest/generate';
import { addVeteran } from '../src/conquest/run';
import { trRun } from '../src/conquest/i18n';
import { callSign, defaultRivals, generateRival, rivalDisplayName } from '../src/meta/rivals';

const ROOT = path.resolve(import.meta.dirname, '..');
/** The quoted words of `const NAME = [...]` (or a Record of arrays) in a source file. */
function wordsOf(file: string, name: string): string[] {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const at = src.indexOf(`const ${name}`);
  assert.ok(at >= 0, `${file} defines ${name}`);
  const end = src.indexOf(name === 'FIRST' || name === 'LAST' ? '};' : '];', at);
  return [...src.slice(at, end).matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((w) => w !== 'soviet' && w !== 'allies');
}
const title = (w: string) => w.charAt(0) + w.slice(1).toLowerCase();

describe('the word lists match the generators', () => {
  test('Daily Challenge (src/meta/daily.ts ADJ x NOUN)', () => {
    assert.deepEqual(wordsOf('src/meta/daily.ts', 'ADJ').map(title), DAILY_CODE_WORDS.adj, 'adjectives');
    assert.deepEqual(wordsOf('src/meta/daily.ts', 'NOUN').map(title), DAILY_CODE_WORDS.noun, 'nouns');
  });
  test('Conquest (src/conquest/generate.ts CODE_A x CODE_B, data.ts CALLSIGNS)', () => {
    assert.deepEqual(wordsOf('src/conquest/generate.ts', 'CODE_A'), CONQUEST_CODE_WORDS.adj, 'adjectives');
    assert.deepEqual(wordsOf('src/conquest/generate.ts', 'CODE_B'), CONQUEST_CODE_WORDS.noun, 'nouns');
    for (const c of CALLSIGNS) assert.ok(hasKey(`codename.callsign.${c.toLowerCase()}`), `call sign ${c} registered`);
  });
  test('Rivals (src/meta/rivals.ts FIRST, LAST and the -a surnames)', () => {
    const first = wordsOf('src/meta/rivals.ts', 'FIRST');
    const last = wordsOf('src/meta/rivals.ts', 'LAST');
    assert.ok(first.length >= 30 && last.length >= 30, 'name lists parsed');
    for (const n of [...first, ...last]) assert.ok(isPersonName(n), `${n} registered`);
    for (const n of last.filter((l) => /(ov|ev|in)$/.test(l))) assert.ok(isPersonName(`${n}a`), `${n}a registered`);
  });
});

describe('generated names in every language', () => {
  before(() => { for (const l of OTHER_LANGS) registerLocale(l, loadLocale(l)); });
  after(async () => { await setLanguage('auto'); });

  test('English is unchanged', async () => {
    await setLanguage('en');
    assert.equal(trSource('IRON HAMMER'), 'IRON HAMMER', 'daily code name');
    assert.equal(trSource('Operation Iron Tide'), 'Operation Iron Tide', 'conquest operation');
    assert.equal(callSignName('Cobra 47'), 'Cobra 47', 'call sign');
    assert.equal(personName('Volkov'), 'Volkov', 'rival name');
  });

  for (const l of OTHER_LANGS) {
    test(`${l}: every code name, call sign and commander translates`, async () => {
      await setLanguage(l);
      const loc = loadLocale(l);
      for (const w of [DAILY_CODE_WORDS, CONQUEST_CODE_WORDS]) {
        for (const a of w.adj) for (const n of w.noun) {
          const t = codeName(`${a} ${n}`);
          assert.equal(t, loc[`codename.op.${a.toLowerCase()}.${n.toLowerCase()}`], `${l}: ${a} ${n}`);
          assert.equal(codeName(`${a} ${n}`.toUpperCase()), t!.toLocaleUpperCase(l), `${l}: capitals stay capitals`);
        }
      }
      for (const c of CALLSIGNS) assert.ok(callSignName(c) && /\S/.test(callSignName(c)), `${l}: ${c}`);
      for (const c of [...Object.values(COMMANDERS).flat(), ...Object.values(SUPREME)]) {
        if (l === 'ru' || l === 'zh-CN') assert.notEqual(trRun(c.name), c.name, `${l}: commander ${c.name}`);
        assert.notEqual(trSource(c.name), undefined, 'translated');
      }
    });
  }

  test('real generator output translates (Daily Challenge, a Conquest run and its veterans)', async () => {
    await setLanguage('ru');
    let day = '2026-10-23';
    for (let i = 0; i < 60; i++, day = shiftDay(day, 1)) {
      const cfg = dailyConfig(day);
      assert.match(trSource(cfg.codename), /^[А-ЯЁ -]+$/, `${day}: ${cfg.codename} in Russian capitals`);
    }
    const run = generateRun({ seed: 1234, faction: 'allies' });
    assert.match(trSource(run.name), /^Операция «[А-ЯЁа-яё -]+»$/, `${run.name} -> ${trSource(run.name)}`);
    for (let i = 0; i < 5; i++) addVeteran(run, '2tnk', 1);
    for (const v of run.core) assert.match(callSignName(v.name), /^[А-ЯЁа-яё -]+( \d+)?$/, `${v.name} -> ${callSignName(v.name)}`);
    // call signs inside run text, and only there
    const [a, b] = run.core.map((v) => v.name);
    const promoted = trRun(`${a} is promoted to elite.`);
    assert.ok(promoted.includes(callSignName(a)) && !promoted.includes(a), `a {vet} in a run text: ${promoted}`);
    const joined = trRun(`The defectors drive their tanks across the line: ${a} and ${b} join the core army.`);
    assert.ok(joined.includes(callSignName(a)) && joined.includes(callSignName(b)), `{a} and {b} translated: ${joined}`);
    // a call-sign word elsewhere is not a call sign: the Ranger is a unit
    assert.notEqual(trSource('Ranger'), callSignName('Ranger'), 'Ranger (unit) is not translated as the call sign');
    await setLanguage('de');
    assert.equal(trSource('IRON HAMMER'), 'EISERNER HAMMER', 'German capitals');
    assert.equal(trSource('Operation Iron Tide'), 'Operation Eiserne Flut', 'German operation name');
    await setLanguage('zh-CN');
    assert.equal(trSource('Operation Iron Dawn'), '钢铁黎明行动', 'Chinese operation name');
  });

  test('rivals: names in Russian and Chinese script, unchanged in Latin-script languages', async () => {
    const store = defaultRivals();
    const r = generateRival(store, { faction: 'soviet', now: 0 });
    await setLanguage('ru');
    assert.ok(!/[A-Za-z]/.test(rivalDisplayName(r)), `ru: ${rivalDisplayName(r)}`);
    assert.ok(!/[A-Za-z]/.test(playerName(callSign(r))), `ru in-match name: ${callSign(r)} -> ${playerName(callSign(r))}`);
    await setLanguage('zh-CN');
    assert.ok(!/[A-Za-z]/.test(rivalDisplayName(r)), `zh-CN: ${rivalDisplayName(r)}`);
    assert.ok(rivalDisplayName(r, false).includes('·') || r.nick, `zh-CN: Chinese name separator in ${rivalDisplayName(r, false)}`);
    await setLanguage('de');
    assert.ok(rivalDisplayName(r).includes(r.last), `de keeps ${r.last}`);
    assert.equal(playerName('Gen. Volkov'), 'Gen. Volkov', 'built-in AI names keep their own keys');
  });
});
