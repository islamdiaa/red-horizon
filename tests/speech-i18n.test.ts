// Speech in the player's language: every spoken line (announcer and unit acknowledgements) is translated in every
// interface language, and src/audio/speech.ts picks a voice for that language (the best-sounding one: natural voices,
// gender, region) or falls back to English speech. The voice lists are mocks shaped like real browsers' (Windows, Edge, macOS, Chrome, Android).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadLocale, OTHER_LANGS } from '../tools/i18n/lib';
import { registerLocale, setLanguage } from '../src/i18n/core';
import { ANNOUNCER_TEXT, UNIT_LINES } from '../src/i18n/en/speech';
import { ANNOUNCER_PRIORITY, ANNOUNCER_THROTTLE, RESPONSE_LINES, Speech, langFit, pickVoice, spokenTranslation, type VoiceLike } from '../src/audio/speech';

type V = VoiceLike & { voiceURI?: string };
const v = (name: string, lang: string, localService: boolean, isDefault = false): V => ({ name, lang, localService, default: isDefault });

// ---------------------------------------------------------------------------------------------------------------
describe('spoken lines are translated in every language', () => {
  const keys = [
    ...Object.keys(ANNOUNCER_TEXT).map((k) => `speech.announcer.${k}`),
    ...Object.keys(UNIT_LINES).map((k) => `speech.unit.${k}`),
  ];
  test('every unit voice says registered lines, and every registered line is said', () => {
    const said = new Set<string>();
    for (const [voice, kinds] of Object.entries(RESPONSE_LINES)) {
      for (const [kind, lines] of Object.entries(kinds)) {
        assert.ok(lines.length > 0, `${voice}.${kind} has lines`);
        for (const l of lines) said.add(l);
      }
    }
    const known = new Set(Object.values(UNIT_LINES));
    assert.deepEqual([...said].filter((l) => !known.has(l)), [], 'lines spoken but not in src/i18n/en/speech.ts (they would stay English)');
    assert.deepEqual([...known].filter((l) => !said.has(l)), [], 'lines in src/i18n/en/speech.ts no unit says');
    assert.equal(new Set(Object.values(UNIT_LINES)).size, Object.keys(UNIT_LINES).length, 'each unit line appears once (shared lines are shared by key)');
  });
  for (const l of OTHER_LANGS) {
    test(`${l}: every announcer and unit line has a short spoken translation`, () => {
      const loc = loadLocale(l);
      const missing = keys.filter((k) => !loc[k]);
      assert.deepEqual(missing, [], `${l}: spoken lines without a translation`);
      for (const k of keys) {
        const t = loc[k];
        assert.ok(!/[{}[\]<>]/.test(t), `${l} ${k}: plain text only ("${t}")`);
        // punchy: no longer than the announcer's longest English line says it
        const max = l === 'zh-CN' ? 20 : 60;
        assert.ok(t.length <= max, `${l} ${k}: "${t}" is too long to say quickly (${t.length} > ${max})`);
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
describe('voice choice', () => {
  test('language fit: main region, other regions, stand-ins and no match', () => {
    assert.equal(langFit('de-DE', 'de'), 3, 'de-DE for German');
    assert.equal(langFit('de_AT', 'de'), 2, 'de_AT (underscore tag) for German');
    assert.equal(langFit('en-US', 'de'), 0, 'English never speaks German');
    assert.equal(langFit('es-MX', 'es'), 2, 'es-MX for Spanish');
    assert.equal(langFit('fr-CA', 'fr'), 2, 'fr-CA for French');
    assert.equal(langFit('pt-BR', 'pt-BR'), 3, 'pt-BR for Brazilian Portuguese');
    assert.equal(langFit('pt-PT', 'pt-BR'), 1, 'pt-PT only stands in for Brazilian Portuguese');
    assert.equal(langFit('zh-CN', 'zh-CN'), 3, 'zh-CN for Simplified Chinese');
    assert.equal(langFit('cmn-Hans-CN', 'zh-CN'), 3, 'cmn-Hans-CN (Android) for Simplified Chinese');
    assert.equal(langFit('zh-TW', 'zh-CN'), 1, 'zh-TW (Mandarin) only stands in');
    assert.equal(langFit('zh-HK', 'zh-CN'), 0, 'zh-HK (Cantonese) does not read Mandarin');
    assert.equal(langFit('yue-HK', 'zh-CN'), 0, 'yue-HK (Cantonese) does not read Mandarin');
    assert.equal(langFit('ru-RU', 'ru'), 3, 'ru-RU for Russian');
    assert.equal(langFit('en-GB', 'en'), 3, 'en-GB for English');
    assert.equal(langFit('en-IN', 'en'), 1, 'en-IN for English, after US/UK');
  });

  test('no voice for the language: null (English speech is the fallback)', () => {
    const list = [v('Microsoft Zira - English (United States)', 'en-US', true), v('Google US English', 'en-US', false)];
    for (const l of OTHER_LANGS) assert.equal(pickVoice(list, 'female', l), null, `${l}: no voice in an English-only list`);
    assert.equal(pickVoice([], 'male', 'de'), null, 'empty list');
  });

  test('quality first within the language: a natural online voice beats a local robotic one', () => {
    const de = [
      v('Google Deutsch', 'de-DE', false),
      v('Microsoft Katja Online (Natural) - German (Germany)', 'de-DE', false),
      v('Microsoft Hedda - German (Germany)', 'de-DE', true),
    ];
    assert.equal(pickVoice(de, 'female', 'de')?.name, 'Microsoft Katja Online (Natural) - German (Germany)', 'Edge: online Natural Katja over local Hedda');
    // Chrome on Windows: the Google voices again; Edge: its Natural voices
    const chrome = [v('Microsoft Zira - English (United States)', 'en-US', true, true), v('Microsoft David - English (United States)', 'en-US', true), v('Google US English', 'en-US', false), v('Google UK English Female', 'en-GB', false), v('Google UK English Male', 'en-GB', false)];
    assert.equal(pickVoice(chrome, 'female', 'en')?.name, 'Google UK English Female', 'Chrome: Google UK English Female');
    assert.equal(pickVoice(chrome, 'male', 'en')?.name, 'Google UK English Male', 'Chrome: Google UK English Male');
    const edge = [v('Microsoft Zira - English (United States)', 'en-US', true), v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false)];
    assert.equal(pickVoice(edge, 'female', 'en')?.name, 'Microsoft Aria Online (Natural) - English (United States)', 'Edge: Aria Natural');
    // all else equal, the voice on the device wins the tie
    assert.equal(pickVoice([v('Anna', 'de-DE', false), v('Anna', 'de-DE', true)], 'female', 'de')?.localService, true, 'tie: on-device');
  });

  test('a local voice of the interface language beats any voice of another language', () => {
    const list = [v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false), v('Google UK English Female', 'en-GB', false), v('Microsoft Hedda - German (Germany)', 'de-DE', true)];
    assert.equal(pickVoice(list, 'female', 'de')?.name, 'Microsoft Hedda - German (Germany)', 'German UI: robotic local Hedda over natural English voices');
    assert.equal(pickVoice(list, 'female', 'en')?.name, 'Microsoft Aria Online (Natural) - English (United States)', 'English UI: the English voices');
    // only online voices of the language: used (the browser has them)
    const online = [v('Google español', 'es-ES', false), v('Google español de Estados Unidos', 'es-US', false)];
    assert.equal(pickVoice(online, 'male', 'es')?.name, 'Google español', 'online es-ES, the main region');
  });

  test('gender: a man\'s voice for male speakers, a woman\'s for female ones (names in every language)', () => {
    const de = [v('Microsoft Hedda - German (Germany)', 'de-DE', true), v('Microsoft Stefan - German (Germany)', 'de-DE', true)];
    assert.equal(pickVoice(de, 'male', 'de')?.name, 'Microsoft Stefan - German (Germany)', 'Stefan for a man');
    assert.equal(pickVoice(de, 'female', 'de')?.name, 'Microsoft Hedda - German (Germany)', 'Hedda for a woman');
    const ru = [v('Milena', 'ru-RU', true), v('Yuri', 'ru-RU', true)];
    assert.equal(pickVoice(ru, 'male', 'ru')?.name, 'Yuri', 'Yuri (macOS) for a man');
    const fr = [v('Amélie', 'fr-CA', true), v('Thomas', 'fr-FR', true)];
    assert.equal(pickVoice(fr, 'female', 'fr')?.name, 'Amélie', 'Amélie (accent in the name) for a woman, though fr-CA');
    assert.equal(pickVoice(fr, 'male', 'fr')?.name, 'Thomas', 'Thomas (fr-FR) for a man');
    // only a woman's voice: it speaks for the men too
    assert.equal(pickVoice([v('Microsoft Irina - Russian (Russia)', 'ru-RU', true)], 'male', 'ru')?.name, 'Microsoft Irina - Russian (Russia)', 'the only Russian voice');
    // novelty voices only when nothing else is there
    const mac = [v('Bells', 'en-US', true), v('Google US English', 'en-US', false)];
    assert.equal(pickVoice(mac, 'female', 'en')?.name, 'Google US English', 'not the singing "Bells" voice');
  });

  test('zh-CN over zh-TW, and zh-TW stands in when it is the only Mandarin voice; never Cantonese', () => {
    const mac = [v('Mei-Jia', 'zh-TW', true), v('Sin-ji', 'zh-HK', true), v('Ting-Ting', 'zh-CN', true)];
    assert.equal(pickVoice(mac, 'female', 'zh-CN')?.name, 'Ting-Ting', 'zh-CN Ting-Ting');
    const win = [v('Microsoft Hanhan - Chinese (Traditional, Taiwan)', 'zh-TW', true), v('Microsoft Huihui - Chinese (Simplified, PRC)', 'zh-CN', true), v('Microsoft Kangkang - Chinese (Simplified, PRC)', 'zh-CN', true)];
    assert.equal(pickVoice(win, 'male', 'zh-CN')?.name, 'Microsoft Kangkang - Chinese (Simplified, PRC)', 'Kangkang for a man');
    assert.equal(pickVoice(win, 'female', 'zh-CN')?.name, 'Microsoft Huihui - Chinese (Simplified, PRC)', 'Huihui for a woman');
    assert.equal(pickVoice([v('Mei-Jia', 'zh-TW', true), v('Sin-ji', 'zh-HK', true)], 'female', 'zh-CN')?.name, 'Mei-Jia', 'Mandarin zh-TW stands in');
    assert.equal(pickVoice([v('Sin-ji', 'zh-HK', true), v('Google 粤語（香港）', 'zh-HK', false)], 'female', 'zh-CN'), null, 'Cantonese only: no Chinese voice (English speech)');
    // the stand-in loses even to an online voice: zh-CN text in zh-CN Mandarin
    assert.equal(pickVoice([v('Mei-Jia', 'zh-TW', true), v('Google 普通话（中国大陆）', 'zh-CN', false)], 'female', 'zh-CN')?.name, 'Google 普通话（中国大陆）', 'online zh-CN over local zh-TW');
    assert.equal(pickVoice([v('Google 國語（臺灣）', 'zh-TW', false), v('Google 普通话（中国大陆）', 'zh-CN', false)], 'female', 'zh-CN')?.name, 'Google 普通话（中国大陆）', 'online zh-CN over online zh-TW');
  });

  test('pt-BR over pt-PT, and pt-PT stands in when it is the only Portuguese voice', () => {
    const list = [v('Joana', 'pt-PT', true), v('Luciana', 'pt-BR', true), v('Microsoft Daniel - Portuguese (Brazil)', 'pt-BR', true)];
    assert.equal(pickVoice(list, 'female', 'pt-BR')?.name, 'Luciana', 'Luciana (pt-BR) for a woman');
    assert.equal(pickVoice(list, 'male', 'pt-BR')?.name, 'Microsoft Daniel - Portuguese (Brazil)', 'Daniel (pt-BR) for a man');
    assert.equal(pickVoice([v('Joana', 'pt-PT', true), v('Microsoft Zira - English (United States)', 'en-US', true)], 'female', 'pt-BR')?.name, 'Joana', 'pt-PT stands in');
    assert.equal(pickVoice([v('Joana', 'pt-PT', true), v('Microsoft Daniel - Portuguese (Brazil)', 'pt-BR', true)], 'female', 'pt-BR')?.name, 'Microsoft Daniel - Portuguese (Brazil)', 'a pt-BR man rather than a pt-PT woman');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('Speech says the translated line with a voice of the interface language, else English', () => {
  const spoken: { text: string; voice: V | null; lang: string }[] = [];
  let voices: V[] = [];
  const g = globalThis as Record<string, unknown>;
  before(() => {
    class Utterance {
      voice: V | null = null; lang = ''; pitch = 1; rate = 1; volume = 1;
      onend: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    g.SpeechSynthesisUtterance = Utterance;
    g.window = {
      speechSynthesis: {
        paused: false,
        getVoices: () => voices,
        speak: (u: Utterance) => { spoken.push({ text: u.text, voice: u.voice, lang: u.lang }); setTimeout(() => u.onend?.(), 0); },
        cancel: () => {},
        resume: () => {},
        addEventListener: () => {},
      },
    };
    for (const l of OTHER_LANGS) registerLocale(l, loadLocale(l));
  });
  after(async () => {
    delete g.window;
    delete g.SpeechSynthesisUtterance;
    await setLanguage('auto');
  });
  const opts = (voice: SpeechSynthesisVoice | null) => ({ voice, pitch: 1, rate: 1, volume: 1 });
  const say = (s: Speech, text: string, gender: 'male' | 'female') => {
    spoken.length = 0;
    assert.ok(s.speak(text, opts(s.voiceFor(gender)), () => {}), 'speech available');
    return spoken[0];
  };

  test('German voice present: German line, German voice', async () => {
    voices = [v('Microsoft Zira - English (United States)', 'en-US', true, true), v('Microsoft David - English (United States)', 'en-US', true), v('Microsoft Hedda - German (Germany)', 'de-DE', true), v('Microsoft Stefan - German (Germany)', 'de-DE', true)];
    await setLanguage('de');
    const s = new Speech();
    let u = say(s, ANNOUNCER_TEXT.unit_ready, 'female');
    assert.equal(u.text, 'Einheit bereit.', 'announcer line in German');
    assert.equal(u.voice?.name, 'Microsoft Hedda - German (Germany)', 'with the German woman\'s voice');
    assert.equal(u.lang, 'de-DE', 'utterance language');
    u = say(s, UNIT_LINES.yesSir, 'male');
    assert.equal(u.text, 'Jawohl!', 'unit line in German');
    assert.equal(u.voice?.name, 'Microsoft Stefan - German (Germany)', 'with the German man\'s voice');
    // the Locker's two-line preview
    u = say(s, `${ANNOUNCER_TEXT.reinforcements} ${ANNOUNCER_TEXT.construction_complete}`, 'female');
    assert.equal(u.text, 'Verstärkung ist eingetroffen. Bau abgeschlossen.', 'both preview lines in German');
    // text that is not a game line stays English, in an English voice of the same gender
    u = say(s, 'Some other text.', 'male');
    assert.equal(u.text, 'Some other text.', 'unknown text unchanged');
    assert.equal(u.voice?.name, 'Microsoft David - English (United States)', 'English man\'s voice for English text');
  });

  test('no voice for the language: English line, English voice (the captions translate)', async () => {
    voices = [v('Microsoft Zira - English (United States)', 'en-US', true), v('Microsoft David - English (United States)', 'en-US', true)];
    await setLanguage('ru');
    const s = new Speech();
    const u = say(s, ANNOUNCER_TEXT.base_under_attack, 'female');
    assert.equal(u.text, 'Our base is under attack.', 'English line');
    assert.equal(u.voice?.name, 'Microsoft Zira - English (United States)', 'English voice');
    assert.equal(spokenTranslation(ANNOUNCER_TEXT.base_under_attack), 'Наша база атакована.', 'the caption text exists in Russian');
  });

  test('only a foreign voice and no English one: the interface language still speaks', async () => {
    voices = [v('Microsoft Huihui - Chinese (Simplified, PRC)', 'zh-CN', true)];
    await setLanguage('zh-CN');
    const s = new Speech();
    const u = say(s, UNIT_LINES.targetLocked, 'male');
    assert.equal(u.text, '目标锁定。', 'Chinese line');
    assert.equal(u.lang, 'zh-CN', 'Chinese utterance');
  });

  test('every language: each line goes out translated with that language\'s voice', async () => {
    voices = [
      v('Microsoft Zira - English (United States)', 'en-US', true),
      v('Anna', 'de-DE', true), v('Milena', 'ru-RU', true), v('Monica', 'es-ES', true), v('Thomas', 'fr-FR', true),
      v('Luciana', 'pt-BR', true), v('Tingting', 'zh-CN', true),
    ];
    for (const l of OTHER_LANGS) {
      await setLanguage(l);
      const s = new Speech();
      const loc = loadLocale(l);
      for (const [k, en] of [...Object.entries(ANNOUNCER_TEXT).map(([k, t]) => [`speech.announcer.${k}`, t]), ...Object.entries(UNIT_LINES).map(([k, t]) => [`speech.unit.${k}`, t])]) {
        const u = say(s, en, 'male');
        assert.equal(u.text, loc[k], `${l} ${k}`);
        assert.ok(langFit(u.lang, l) > 0, `${l} ${k}: spoken in ${u.lang}`);
      }
    }
  });

  test('English interface: unchanged English speech', async () => {
    voices = [v('Microsoft Zira - English (United States)', 'en-US', true), v('Microsoft Hedda - German (Germany)', 'de-DE', true)];
    await setLanguage('en');
    const s = new Speech();
    const u = say(s, ANNOUNCER_TEXT.mission_accomplished, 'female');
    assert.equal(u.text, 'Mission accomplished.', 'English line');
    assert.equal(u.voice?.name, 'Microsoft Zira - English (United States)', 'English voice');
  });

  test('throttle and priority tables still name real announcer lines', () => {
    for (const k of [...Object.keys(ANNOUNCER_THROTTLE), ...Object.keys(ANNOUNCER_PRIORITY)]) assert.ok(k in ANNOUNCER_TEXT, `${k} is an announcer line`);
    assert.ok((ANNOUNCER_PRIORITY.nuke_warning ?? 0) > (ANNOUNCER_PRIORITY.unit_ready ?? 0), 'a nuke warning outranks a unit-ready call');
  });
});
