// Interface translation: the ICU-lite formatter, the language setting, catalogue completeness and safety, fonts,
// and a guard against new hard-coded player-facing strings in the UI.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatMessage, messageParams } from '../src/i18n/format';
import { detectLang, matchLang, LANGS } from '../src/i18n/langs';
import {
  currentLang, dt, fmtMoney, languagePref, liveStrings, registerLocale, setLanguage, sourceStrings, strings, trSource, tx, txHtml,
} from '../src/i18n/core';
import { collectDataEnglish } from '../tools/i18n/data-sources';
import { DATA_EN, OTHER_LANGS, ROOT, checkTranslation, loadDataEnglish, loadEnglish, loadLocale } from '../tools/i18n/lib';

/** A minimal localStorage for the language-setting tests. */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

describe('ICU-lite formatting', () => {
  test('parameters, numbers and missing parameters', () => {
    assert.equal(formatMessage('Hello {name}', { name: 'Commander' }, 'en'), 'Hello Commander', 'simple parameter');
    assert.equal(formatMessage('{n} credits', { n: 12500 }, 'en'), '12,500 credits', 'numbers grouped from 10,000');
    assert.equal(formatMessage('{n} credits', { n: 1500 }, 'en'), '1500 credits', 'four digits stay ungrouped');
    assert.equal(formatMessage('{n, number}', { n: 1500 }, 'de'), '1.500', 'explicit number format groups always');
    assert.equal(formatMessage('{n}', { n: 12500 }, 'de'), '12.500', 'German grouping');
    assert.equal(formatMessage('{n}', { n: 2.5 }, 'fr'), '2,5', 'French decimal comma');
    assert.equal(formatMessage('Press {key:attackMove} {unknown}', {}, 'en'), 'Press {key:attackMove} {unknown}', 'unknown placeholders pass through');
  });
  test('plurals per language, exact matches and #', () => {
    const en = '{n, plural, =0 {no units} one {# unit} other {# units}}';
    assert.deepEqual([0, 1, 2, 12500].map((n) => formatMessage(en, { n }, 'en')), ['no units', '1 unit', '2 units', '12,500 units'], 'English plurals');
    const ru = '{n, plural, one {# танк} few {# танка} many {# танков} other {# танка}}';
    assert.deepEqual([1, 3, 5, 21, 22, 11].map((n) => formatMessage(ru, { n }, 'ru')), ['1 танк', '3 танка', '5 танков', '21 танк', '22 танка', '11 танков'], 'Russian one/few/many');
    assert.equal(formatMessage('{n, plural, one {# char} other {# chars}}', { n: 0 }, 'fr'), '0 char', 'French: 0 is singular');
    assert.equal(formatMessage('{n, plural, other {#辆坦克}}', { n: 3 }, 'zh-CN'), '3辆坦克', 'Chinese: other only');
    assert.equal(formatMessage('{side, select, allies {Allied {n}} other {Soviet}}', { side: 'allies', n: 2 }, 'en'), 'Allied 2', 'select with a nested parameter');
    assert.equal(formatMessage('{side, select, allies {A} other {B}}', { side: 'x' }, 'en'), 'B', 'select falls back to other');
    assert.equal(formatMessage('{n, plural, one {{who} has # tank} other {{who} has # tanks}}', { n: 2, who: 'Ivan' }, 'en'), 'Ivan has 2 tanks', 'parameters inside branches');
    assert.deepEqual(messageParams('{a} {n, plural, one {{b} #} other {{c}}} {key:x}'), ['a', 'b', 'c', 'n'], 'parameter names, nested ones included');
  });
  test('HTML variant escapes everything and only turns safe markers into tags', () => {
    const T = strings('i18ntest', { rich: '[b]{name}[/b] destroyed <x> & it\'s [kbd]Esc[/kbd]', count: '{n, plural, one {l\'unité #} other {# l\'unités}}' });
    assert.equal(T.html('rich', { name: '<img onerror=x>' }), '<b>&lt;img onerror=x&gt;</b> destroyed &lt;x&gt; &amp; it&apos;s <kbd>Esc</kbd>', 'escaped, markers converted');
    assert.equal(T('rich', { name: 'Ivan' }), "Ivan destroyed <x> & it's Esc", 'plain text drops the markers');
    assert.equal(T.html('count', { n: 1 }), 'l&apos;unité 1', 'an escaped apostrophe is not mistaken for #');
    assert.equal(T.html('rich', { name: '[b]x' }).includes('<b>x'), false, 'markers inside parameters stay text');
  });
});

describe('languages and the setting', () => {
  test('browser languages map to the supported set', () => {
    assert.equal(matchLang('de-AT'), 'de', 'regional German');
    assert.equal(matchLang('pt-PT'), 'pt-BR', 'any Portuguese → pt-BR');
    assert.equal(matchLang('zh-TW'), 'zh-CN', 'any Chinese → zh-CN');
    assert.equal(matchLang('uk-UA'), null, 'Ukrainian is not mapped to Russian');
    assert.equal(detectLang(['uk', 'fr-CA', 'en']), 'fr', 'first supported language wins');
    assert.equal(detectLang([]), 'en', 'English by default');
    assert.equal(LANGS[0], 'en', 'English is the source');
  });
  test('the choice persists and missing keys fall back to English', async () => {
    const g = globalThis as unknown as { localStorage?: Storage };
    const saved = g.localStorage;
    g.localStorage = new MemStorage() as unknown as Storage;
    try {
      const T = strings('i18ntest2', { hello: 'Hello {name}', only: 'English only' });
      registerLocale('de', { 'i18ntest2.hello': 'Hallo {name}', 'unit.e1.name': 'Schütze' });
      assert.equal(await setLanguage('de'), 'de', 'switched to German');
      assert.equal(g.localStorage!.getItem('rh.lang'), 'de', 'stored');
      assert.equal(languagePref(), 'de', 'read back');
      assert.equal(currentLang(), 'de', 'active');
      assert.equal(T('hello', { name: 'Ivan' }), 'Hallo Ivan', 'translated');
      assert.equal(T('only'), 'English only', 'missing key falls back to English');
      assert.equal(tx('i18ntest2.nothing', undefined, 'fallback'), 'fallback', 'unknown key uses the fallback');
      assert.equal(dt('unit', 'e1', 'name', 'Rifle Infantry'), 'Schütze', 'game data translated');
      assert.equal(dt('unit', 'zzz', 'name', 'Modded Tank'), 'Modded Tank', 'untranslated (modded) data keeps its English');
      assert.equal(fmtMoney(12500), '$12.500', 'money grouped the German way');
      g.localStorage!.setItem('rh.lang', 'xx-invalid');
      assert.equal(languagePref(), 'auto', 'an invalid stored value means auto');
      await setLanguage('auto');
      assert.equal(g.localStorage!.getItem('rh.lang'), null, 'auto clears the stored choice');
      assert.equal(currentLang(), 'en', 'auto outside a browser is English');
      assert.equal(T('hello', { name: 'Ivan' }), 'Hello Ivan', 'back to English');
    } finally {
      if (saved) g.localStorage = saved; else delete g.localStorage;
    }
  });
  test('live tables and display-time translation of emitted English', async () => {
    const LIVE = liveStrings('i18ntest3', { tips: ['First tip', 'Second tip'], label: { a: 'Alpha' } });
    const SRC = sourceStrings('i18ntest3src', { a: 'Build a Power Plant.', b: 'Destroy {n} tanks' });
    registerLocale('ru', { 'i18ntest3.tips.1': 'Второй совет', 'i18ntest3.label.a': 'Альфа', 'i18ntest3src.a': 'Постройте электростанцию.', 'i18ntest3src.b': 'Уничтожьте {n, plural, one {# танк} few {# танка} other {# танков}}' });
    await setLanguage('ru');
    try {
      assert.deepEqual([...LIVE.tips], ['First tip', 'Второй совет'], 'arrays translate on read, falling back per entry');
      assert.equal(LIVE.label.a, 'Альфа', 'nested tables');
      assert.equal(SRC.a, 'Build a Power Plant.', 'the emitting code keeps the English');
      assert.equal(trSource(SRC.a), 'Постройте электростанцию.', 'exact match');
      assert.equal(trSource('Destroy 3 tanks'), 'Уничтожьте 3 танка', 'template match with a plural');
      assert.equal(trSource('Something else'), 'Something else', 'unknown text unchanged');
      assert.equal(txHtml('i18ntest3.label.a'), 'Альфа', 'html variant');
    } finally {
      await setLanguage('auto');
    }
  });
});

describe('catalogues', async () => {
  const en = await loadEnglish();
  const enKeys = Object.keys(en).filter((k) => !k.startsWith('i18ntest'));
  test('the English catalogue is substantial and the game-data list is in sync', () => {
    assert.ok(enKeys.length > 1000, `English has ${enKeys.length} keys`);
    assert.deepEqual(loadDataEnglish(), collectDataEnglish(), `game-data English changed: run node --import tsx tools/i18n/catalog.ts sync (${path.relative(ROOT, DATA_EN)})`);
  });
  test('English itself is well-formed (balanced braces, known markers, no raw HTML)', () => {
    const bad = enKeys.filter((k) => checkTranslation(en[k], en[k]).length);
    assert.deepEqual(bad, [], `malformed English: ${bad.slice(0, 10).join(', ')}`);
  });
  for (const l of OTHER_LANGS) {
    test(`${l}: every key translated, with the right placeholders and no raw HTML`, () => {
      const loc = loadLocale(l);
      const missing = enKeys.filter((k) => !loc[k]);
      const pct = (100 * (enKeys.length - missing.length)) / enKeys.length;
      if (missing.length) console.log(`# ${l}: ${pct.toFixed(1)}% translated, ${missing.length} missing (falling back to English): ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}`);
      assert.equal(missing.length, 0, `${l} lacks ${missing.length} keys (they show in English): node --import tsx tools/i18n/catalog.ts missing ${l}`);
      const problems: string[] = [];
      for (const [k, v] of Object.entries(loc)) {
        if (typeof v !== 'string') { problems.push(`${k}: not a string`); continue; }
        if (!(k in en)) continue; // stale keys are harmless (tools/i18n/catalog.ts prune drops them)
        for (const p of checkTranslation(en[k], v)) problems.push(`${k}: ${p}`);
      }
      assert.deepEqual(problems, [], `${l}: ${problems.slice(0, 8).join(' | ')}`);
    });
  }
});

describe('game-data translations are current', async () => {
  // a balance change edits the data's English ("take 10% less damage" → 8%): its translations must follow
  const data = loadDataEnglish();
  const ZH: Record<string, string> = { 一: '1', 两: '2', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };
  const nums = (s: string, l: string) => {
    let t = s.replace(/\{\w+\}/g, ' ');
    if (l === 'zh-CN') t = t.replace(/[一两二三四五六七八九十]/g, (c) => ` ${ZH[c]} `);
    return new Set((t.match(/\d+(?:[.,\u00a0\u202f ]\d{3})*(?:[.,]\d+)?/g) ?? []).map((x) => x.replace(/[,.\u00a0\u202f ](?=\d{3}(?!\d))/g, '').replace(',', '.')));
  };
  for (const l of OTHER_LANGS) {
    test(`${l}: the numbers in game-data text match the English`, () => {
      const loc = loadLocale(l);
      const stale = Object.keys(data).filter((k) => loc[k] && !/^rank\.\d+\.short$/.test(k)).filter((k) => { const have = nums(loc[k], l); return [...nums(data[k], 'en')].some((n) => !have.has(n)); });
      assert.deepEqual(stale, [], `${l}: translations whose numbers differ from the English (update them): ${stale.map((k) => `${k}: "${data[k]}" / "${loc[k]}"`).join(' | ')}`);
    });
  }
});

describe('display-time translations still match the English they translate', () => {
  test('battle-event templates (src/i18n/en/variety.ts) are still written by the simulation', async () => {
    // trSource() matches the exact English the simulation emits: when that text changes, the template must too
    // (otherwise the message simply shows in English). Messages the simulation assembles from parts are skipped.
    const en = await loadEnglish();
    const src = ['src/sim/events.ts', 'src/sim/neutral.ts', 'src/modes/quickbattle.ts'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n').replace(/\\'/g, "'");
    const COMPOSED = /^variety\.news\.(convoy\.endMany|reward\.)/;
    const gone = Object.keys(en).filter((k) => /^variety\.(news|quickSource)\./.test(k) && !COMPOSED.test(k))
      .filter((k) => en[k].split(/\{\w+\}/).map((x) => x.trim()).some((frag) => frag.length >= 6 && !src.includes(frag)));
    assert.deepEqual(gone, [], `templates the simulation no longer produces: ${gone.map((k) => `${k} "${en[k]}"`).join(' | ')}`);
  });
});

describe('fonts cover every character', async () => {
  // symbols the English interface already shows (arrows, check marks...) come from the system's fonts there too
  const english = new Set([...Object.values(await loadEnglish()).join('')]);
  /** Characters the self-hosted Latin fonts (Google's "latin" subset of Rajdhani / Share Tech Mono) have. */
  const latinOk = (c: string) => {
    const u = c.codePointAt(0)!;
    return u <= 0xff || u === 0x131 || u === 0x152 || u === 0x153 || (u >= 0x2000 && u <= 0x206f) || [0x2c6, 0x2da, 0x2dc, 0x20ac, 0x2122, 0x2191, 0x2193, 0x2212, 0x2215].includes(u);
  };
  const cyrillicOk = (c: string) => { const u = c.codePointAt(0)!; return (u >= 0x400 && u < 0x460) || [0x490, 0x491, 0x4b0, 0x4b1, 0x2116].includes(u); };
  const SYMBOLS = /[←→↑↓↺↻✓✔✕✖★☆•·…–—−×÷±°▲▼◆●○■□►◄⚑⚡✦✧♦]/u; // drawn by icons or the system symbol fonts on purpose
  const chars = (l: (typeof OTHER_LANGS)[number]) => new Set([...Object.values(loadLocale(l)).join('')].filter((c) => !/\s/.test(c)));
  for (const l of ['de', 'es', 'fr', 'pt-BR'] as const) {
    test(`${l}: Latin characters only`, () => {
      const bad = [...chars(l)].filter((c) => !latinOk(c) && !SYMBOLS.test(c) && !english.has(c));
      assert.deepEqual(bad, [], `${l} uses characters outside the Latin fonts: ${bad.join('')}`);
    });
  }
  test('ru: Latin or Cyrillic (RH Cyrillic subset) only', () => {
    const bad = [...chars('ru')].filter((c) => !latinOk(c) && !cyrillicOk(c) && !SYMBOLS.test(c) && !english.has(c));
    assert.deepEqual(bad, [], `ru uses characters outside the fonts: ${bad.join('')}`);
  });
  test('zh-CN: every Chinese character is in the RH CJK subset', () => {
    const file = path.join(ROOT, 'src/i18n/source/zh-CN.glyphs.txt');
    const have = new Set(fs.existsSync(file) ? [...fs.readFileSync(file, 'utf8').trim()] : []);
    const need = [...chars('zh-CN')].filter((c) => c.codePointAt(0)! >= 0x2e80);
    const bad = need.filter((c) => !have.has(c));
    assert.deepEqual(bad, [], `characters missing from public/fonts/noto-sans-sc-subset.woff2 (run tools/fonts/subset.py): ${bad.join('')}`);
    assert.ok(fs.existsSync(path.join(ROOT, 'public/fonts/noto-sans-sc-subset.woff2')) && fs.existsSync(path.join(ROOT, 'public/fonts/tektur-cyrillic.woff2')), 'fallback fonts built');
  });
});

describe('no new hard-coded player-facing strings', async () => {
  const { parseAst } = await import('rolldown/parseAst'); // (vite's parser, oxc: TypeScript-aware)
  /** The main UI files: every player-facing string goes through src/i18n. */
  const FILES = [
    ...fs.readdirSync(path.join(ROOT, 'src/ui')).filter((f) => f.endsWith('.ts')).map((f) => `src/ui/${f}`),
    'src/platform/errors.ts', 'src/platform/webgl.ts', 'src/share/dialog.ts', 'src/share/open.ts', 'src/share/content.ts', 'src/mods/ui.ts', 'src/cinematic.ts',
  ];
  /** Literals that are not prose: KeyboardEvent.key / .code names, names and marks that stay as they are. */
  const ALLOW = new Set(['Escape', 'Enter', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Ctrl', 'Dead', 'Unidentified', 'Process', 'Key', 'Backquote',
    'Red Horizon', 'RED HORIZON', 'Commander' /* the default commander name (stored, sent to other players) */, 'Error' /* Error.name */,
    'HD', 'XP', 'FPS', 'OK', 'Esc', 'vs', 'AI', 'MP', 'GPU', 'WebGL', 'WebGL 2', 'LB', 'RB', 'LT', 'RT', 'zZ', '.rhmod.json']);
  /** Developer text: the copied diagnostics and error reports stay English, plus never-shown internals. */
  const ALLOW_IN: Record<string, string[]> = {
    'src/ui/a11y-diagnostics.ts': ['Version', 'Time', 'Browser', 'Platform', 'Screen', 'Device', 'Display', 'Settings'],
    'src/platform/errors.ts': ['Version', 'Time', 'User agent', 'Screen', 'Device', 'Context'],
    'src/platform/webgl.ts': ['No document', 'No WebGL implementation.'],
    'src/ui/hud.ts': ['Advanced Power Plant', 'Mobile Construction Vehicle', 'Allied Tech Center', 'Soviet Tech Center', 'V2 Rocket Launcher', 'Construction Yard'], // SHORT_NAMES keys
  };
  type Node = { type?: string; start: number; value?: unknown; quasis?: { value: { cooked?: string; raw: string } }[] };
  const walk = (n: unknown, fn: (n: Node) => void) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const c of n) walk(c, fn); return; }
    if (typeof (n as Node).type === 'string') fn(n as Node);
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, fn);
  };
  const prose = (s: string) => {
    const t = s.replace(/\u0001/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    return /[A-Za-z]{2,}/.test(t) && !ALLOW.has(t) ? t : null;
  };
  test('UI text, attributes and label-like literals go through the catalogue', () => {
    const found: string[] = [];
    for (const f of FILES) {
      const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const ok = new Set(ALLOW_IN[f] ?? []);
      const line = (pos: number) => code.slice(0, pos).split('\n').length;
      const html = (s: string, at: number) => {
        for (const m of s.matchAll(/>([^<>]*)</g)) { const p = prose(m[1]); if (p && !ok.has(p)) found.push(`${f}:${line(at)} text "${p}"`); }
        for (const m of s.matchAll(/\b(?:title|aria-label|placeholder|alt|data-tip)="([^"]*)"/g)) { const p = prose(m[1]); if (p && !ok.has(p)) found.push(`${f}:${line(at)} attribute "${p}"`); }
      };
      walk(parseAst(code, { lang: 'ts' }), (n) => {
        if (n.type === 'TemplateLiteral' && n.quasis) html(n.quasis.map((q) => q.value.cooked ?? q.value.raw).join('\u0001'), n.start);
        else if (n.type === 'Literal' && typeof n.value === 'string') {
          const v = n.value.trim();
          if (/[<>]/.test(v)) html(v, n.start);
          // a capitalised word or phrase: a label or a sentence ("Back", "Low power", "Select a map.")
          if ((/^[A-Z][a-z]+(?:[ '’-][A-Za-z]+)+[.!?…]?$/.test(v) || /^[A-Z][a-z]{2,}[.!?…]?$/.test(v)) && !ALLOW.has(v) && !ok.has(v)) found.push(`${f}:${line(n.start)} literal "${v}"`);
        }
      });
    }
    assert.deepEqual(found, [], `hard-coded player-facing strings (put them in src/i18n/en/<ns>.ts, or allowlist non-prose here):\n${found.join('\n')}`);
  });
});
