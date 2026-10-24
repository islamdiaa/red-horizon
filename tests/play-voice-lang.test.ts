// Settings › Gameplay › Voice language: in a translated interface the voices speak the interface language (when the
// browser has a voice for it, the default) or keep to English ('en'); the captions stay translated either way.
import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadLocale, OTHER_LANGS } from '../tools/i18n/lib';
import { registerLocale, setLanguage } from '../src/i18n/core';
import { ANNOUNCER_TEXT, UNIT_LINES } from '../src/i18n/en/speech';
import { Speech, setVoiceLanguage, spokenLang, spokenTranslation, type VoiceLike } from '../src/audio/speech';

type V = VoiceLike;
const v = (name: string, lang: string): V => ({ name, lang, localService: true, default: false });

describe('voice language setting', () => {
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
        cancel: () => {}, resume: () => {}, addEventListener: () => {},
      },
    };
    for (const l of OTHER_LANGS) registerLocale(l, loadLocale(l));
  });
  afterEach(() => setVoiceLanguage(undefined));
  after(async () => {
    delete g.window;
    delete g.SpeechSynthesisUtterance;
    await setLanguage('auto');
  });
  const say = (s: Speech, text: string, gender: 'male' | 'female') => {
    spoken.length = 0;
    assert.ok(s.speak(text, { voice: s.voiceFor(gender), pitch: 1, rate: 1, volume: 1 }, () => {}), 'speech available');
    return spoken[0];
  };

  test('default (unset): the interface language speaks', async () => {
    voices = [v('Microsoft Zira - English (United States)', 'en-US'), v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Hedda - German (Germany)', 'de-DE'), v('Microsoft Stefan - German (Germany)', 'de-DE')];
    await setLanguage('de');
    setVoiceLanguage(undefined);
    assert.equal(spokenLang(), 'de', 'unset = the interface language');
    const u = say(new Speech(), ANNOUNCER_TEXT.unit_ready, 'female');
    assert.equal(u.text, 'Einheit bereit.', 'German line');
    assert.equal(u.voice?.name, 'Microsoft Hedda - German (Germany)', 'German voice');
  });

  test('English: the English line in an English voice, the caption still translated', async () => {
    voices = [v('Microsoft Zira - English (United States)', 'en-US'), v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Hedda - German (Germany)', 'de-DE'), v('Microsoft Stefan - German (Germany)', 'de-DE')];
    await setLanguage('de');
    setVoiceLanguage('en');
    assert.equal(spokenLang(), 'en', 'English voices');
    const s = new Speech();
    let u = say(s, ANNOUNCER_TEXT.base_under_attack, 'female');
    assert.equal(u.text, 'Our base is under attack.', 'English announcer line');
    assert.equal(u.voice?.name, 'Microsoft Zira - English (United States)', 'English woman\'s voice');
    assert.equal(u.lang, 'en-US', 'English utterance');
    u = say(s, UNIT_LINES.yesSir, 'male');
    assert.equal(u.text, UNIT_LINES.yesSir, 'English unit line');
    assert.equal(u.voice?.name, 'Microsoft David - English (United States)', 'English man\'s voice');
    assert.ok(spokenTranslation(ANNOUNCER_TEXT.base_under_attack)?.length, 'the caption keeps its German translation');
    // and back: the change applies at once (no reload)
    setVoiceLanguage('ui');
    u = say(s, ANNOUNCER_TEXT.unit_ready, 'female');
    assert.equal(u.text, 'Einheit bereit.', 'back to German');
  });

  test('every language: English voices on request', async () => {
    voices = [v('Microsoft Zira - English (United States)', 'en-US'), v('Anna', 'de-DE'), v('Milena', 'ru-RU'), v('Monica', 'es-ES'), v('Thomas', 'fr-FR'), v('Luciana', 'pt-BR'), v('Tingting', 'zh-CN')];
    setVoiceLanguage('en');
    for (const l of OTHER_LANGS) {
      await setLanguage(l);
      const u = say(new Speech(), ANNOUNCER_TEXT.mission_accomplished, 'female');
      assert.equal(u.text, 'Mission accomplished.', `${l}: English line`);
      assert.ok(u.lang.startsWith('en'), `${l}: spoken in English (${u.lang})`);
    }
  });

  test('the setting\'s labels are translated in every language', () => {
    for (const l of OTHER_LANGS) {
      const loc = loadLocale(l);
      for (const k of ['voiceLang', 'voiceLangSub', 'voiceLangUi', 'voiceLangEn']) assert.ok(loc[`settings.${k}`], `${l}: settings.${k}`);
    }
  });
});
