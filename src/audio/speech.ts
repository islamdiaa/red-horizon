/**
 * Web Speech API wrapper: voice selection (with async `voiceschanged` handling), the EVA-style announcer queue's
 * voice and short unit acknowledgement lines. All texts are original.
 *
 * Language. The lines are English in code (src/i18n/en/speech.ts) and translated in every interface language.
 * When the browser has a voice for the interface language, voiceFor() returns it and speak() says the translated
 * line; otherwise the English line is spoken with an English voice and only the captions are translated.
 *
 * Privacy. speechSynthesis voices are either on the device (`localService`) or online: an online voice (Chrome's
 * "Google ..." voices, Edge's "... Online (Natural)") sends the text to the browser vendor to be synthesised. The
 * game itself makes no request for speech, ever (strict CSP, no third-party traffic); it only picks among the
 * browser's voices. Online voices are not penalised: they usually sound much better, and what they receive is only
 * the fixed game lines above ("Unit ready."), never a player's own text or data. An on-device voice wins a tie.
 */
import type { AnnouncerKey, ResponseKind, VoiceKind } from './types';
import { currentLang, translation, type Lang } from '../i18n/core';
import { ANNOUNCER_TEXT, UNIT_LINES } from '../i18n/en/speech';

/** The announcer's lines (English; translated with the voice, see above). Table: src/i18n/en/speech.ts. */
export { ANNOUNCER_TEXT };

/** Minimum ms between two announcements of the same key. */
export const ANNOUNCER_THROTTLE: Partial<Record<AnnouncerKey, number>> = {
  base_under_attack: 15000,
  harvester_under_attack: 15000,
  unit_lost: 6000,
  structure_lost: 5000,
  low_power: 8000,
  silos_needed: 10000,
  // promotions come in bursts during big fights: one call-out is enough
  unit_promoted: 6000,
  naval_unit_lost: 6000,
  enemy_aircraft: 15000,
  sub_detected: 12000,
  mine_detected: 15000,
  mines_laid: 10000,
  radar_jammed: 15000,
  // the director throttles these itself too (per moment and between moments)
  armour_neutralised: 45000,
  base_heavy_attack: 60000,
  sector_victorious: 90000,
  enemy_base_destroyed: 20000,
};
export const DEFAULT_THROTTLE = 4000;

/** Higher priority announcements may displace lower ones from a full queue. */
export const ANNOUNCER_PRIORITY: Partial<Record<AnnouncerKey, number>> = {
  nuke_warning: 10, mission_accomplished: 9, mission_failed: 9, nuke_launched: 8, ceasefire_over: 8, ceasefire_warning: 8, base_under_attack: 7,
  nuke_ready: 6, iron_curtain_ready: 6, chrono_ready: 6, harvester_under_attack: 5, structure_lost: 4,
  mission_start: 4, building_captured: 4, low_power: 3, construction_complete: 3, unit_ready: 3,
  unit_promoted: 2,
  base_heavy_attack: 7, enemy_base_destroyed: 6, sector_victorious: 5, armour_neutralised: 4, superweapon_online: 5, heavy_armour_ready: 3,
};

type Lines = Record<ResponseKind, string[]>;
const U = UNIT_LINES;
/** What each unit voice says (English; src/i18n/en/speech.ts holds the lines and their translations). */
export const RESPONSE_LINES: Record<Exclude<VoiceKind, 'dog'>, Lines> = {
  infantry: {
    select: [U.yesSir, U.reporting, U.awaitingOrders, U.ready],
    move: [U.acknowledged, U.movingOut, U.affirmative, U.onMyWay, U.yesSir],
    attack: [U.engaging, U.openFire, U.targetAcquired, U.attacking],
  },
  vehicle: {
    select: [U.vehicleReporting, U.standingBy, U.awaitingOrders],
    move: [U.rollingOut, U.moving, U.affirmative, U.underWay],
    attack: [U.firing, U.engagingTarget, U.targetLocked],
  },
  tanya: {
    select: [U.talkToMe, U.whatsTheJob, U.readyWhenYouAre],
    move: [U.onIt, U.leaveItToMe, U.moving],
    attack: [U.lightsOut, U.tooEasy, U.watchThis],
  },
  engineer: {
    select: [U.engineerReady, U.toolsReady],
    move: [U.moving, U.onMyWay],
    attack: [U.illTakeIt, U.securingIt, U.rightAway],
  },
  medic: {
    select: [U.medicHere, U.whosHurt],
    move: [U.onMyWay, U.moving],
    attack: [U.holdStill, U.patchingYouUp],
  },
  harvester: {
    select: [U.harvesterReady, U.oreTruckStandingBy],
    move: [U.headingOut, U.movingToOreField],
    attack: [U.harvesting, U.collectingOre],
  },
  aircraft: {
    select: [U.pilotStandingBy, U.airborne],
    move: [U.inbound, U.changingCourse, U.roger],
    attack: [U.attackRun, U.weaponsHot, U.targetInSight],
  },
  naval: {
    select: [U.bridgeHere, U.captainOnDeck, U.shipReady],
    move: [U.settingCourse, U.fullAhead, U.ayeCommander, U.helmAnswering],
    attack: [U.allGunsFire, U.targetBearingLocked, U.engagingCalm],
  },
  mechanic: {
    select: [U.mechanicHere, U.whatNeedsFixing, U.toolsReady],
    move: [U.onMyWay, U.moving, U.rightThere],
    attack: [U.iCanFixThat, U.patchingHerUp, U.goodAsNewSoon],
  },
  shock: {
    select: [U.fullyCharged, U.shockTrooperReady, U.powerIsOn],
    move: [U.movingOut, U.chargingForward, U.yesComrade],
    attack: [U.lightningStrikes, U.feelTheCurrent, U.discharge],
  },
  spy: {
    select: [U.yes, U.discreetly, U.atYourService],
    move: [U.quietlyNow, U.ofCourse, U.leaveItWithMe],
    attack: [U.consider, U.nobodyWillNotice, U.withPleasure],
  },
};

export interface VoiceParams { pitch: number; rate: number; gender: 'male' | 'female'; radio: boolean }
export const VOICE_PARAMS: Record<Exclude<VoiceKind, 'dog'>, VoiceParams> = {
  infantry: { pitch: 0.9, rate: 1.15, gender: 'male', radio: false },
  vehicle: { pitch: 0.5, rate: 0.98, gender: 'male', radio: true },
  tanya: { pitch: 1.15, rate: 1.1, gender: 'female', radio: false },
  engineer: { pitch: 1.05, rate: 1.05, gender: 'male', radio: false },
  medic: { pitch: 1.0, rate: 1.0, gender: 'male', radio: false },
  harvester: { pitch: 0.6, rate: 0.95, gender: 'male', radio: true },
  aircraft: { pitch: 0.8, rate: 1.15, gender: 'male', radio: true },
  naval: { pitch: 0.7, rate: 1.0, gender: 'male', radio: true },
  spy: { pitch: 1.0, rate: 0.95, gender: 'male', radio: false },
  mechanic: { pitch: 0.95, rate: 1.05, gender: 'male', radio: false },
  shock: { pitch: 0.75, rate: 1.15, gender: 'male', radio: false },
};

// Voice names that say which voice is a woman's or a man's, matched as words in the accent-stripped, lower-case name
// (Windows, Edge online, macOS / iOS, Android and Google names, for the seven interface languages).
const FEMALE = /\b(zira|aria|jenny|michelle|emma|sonia|libby|hazel|susan|samantha|karen|moira|tessa|fiona|serena|victoria|allison|ava|kate|female|woman|joanna|salli|kendra|kimberly|ivy|amy|natasha|clara|catherine|heather|linda|nicky|sara|ana|eva|emily|olivia|ashley|jane|elizabeth|nancy|maisie|mia|isla|hedda|katja|anna|petra|helena|marlene|vicki|amala|seraphina|louisa|tanja|irina|svetlana|milena|katya|ekaterina|dariya|alena|laura|elvira|ximena|monica|paulina|marisol|dalia|lucia|sabina|hortense|julie|denise|eloise|vivienne|amelie|audrey|aurelie|marie|celine|sylvie|brigitte|maria|francisca|luciana|joana|catarina|helia|raquel|thalita|fernanda|leila|huihui|yaoyao|xiaoxiao|xiaoyi|xiaohan|xiaomo|xiaorui|xiaobei|xiaoni|tingting|ting-ting|mei-jia|meijia|sin-ji|yu-shu|lili)\b/;
const MALE = /\b(david|mark|guy|ryan|george|daniel|alex|fred|tom|male|man|christopher|eric|roger|steffan|william|james|brian|thomas|oliver|arthur|aaron|gordon|lee|rishi|matthew|andrew|brandon|davis|tony|jason|liam|noah|ethan|elliot|stefan|conrad|killian|florian|markus|yannick|martin|pavel|dmitry|dmitri|yuri|maxim|pablo|alvaro|jorge|juan|diego|carlos|raul|paul|henri|remy|nicolas|antonio|felipe|duarte|kangkang|yunxi|yunyang|yunjian|yunze|li-mu|limu)\b/;
const NOVELTY = /(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|grandpa|grandma|rocko|shelley|reed|sandy|flo|eddy)/;

/** The parts of a SpeechSynthesisVoice the choice looks at (tests pass plain objects). */
export type VoiceLike = Pick<SpeechSynthesisVoice, 'name' | 'lang'> & Partial<Pick<SpeechSynthesisVoice, 'localService' | 'default'>>;

/**
 * How well a voice's language speaks text in an interface language: 0 = not at all (never used), 1 = a stand-in
 * (European Portuguese for Brazilian, Taiwan Mandarin for Simplified Chinese), 2 = another region, 3 = the
 * language's main region. Cantonese (zh-HK, yue) does not read Simplified Chinese text as Mandarin: 0.
 */
export function langFit(voiceLang: string, ui: Lang): number {
  const tag = (voiceLang || '').toLowerCase().replace(/_/g, '-');
  const [p, ...rest] = tag.split('-');
  const sub = rest.join('-');
  const has = (...xs: string[]) => rest.some((r) => xs.includes(r));
  switch (ui) {
    case 'en':
      if (p !== 'en') return 0;
      return !sub || has('us', 'gb') ? 3 : has('au', 'ie', 'ca', 'nz') ? 2 : 1;
    case 'zh-CN':
      if (p !== 'zh' && p !== 'cmn') return 0;
      if (has('hk', 'mo', 'yue')) return 0;
      if (has('hans', 'cn')) return 3;
      if (has('hant', 'tw')) return 1;
      return 2; // bare zh / cmn, zh-SG
    case 'pt-BR':
      if (p !== 'pt') return 0;
      return has('br') ? 3 : !sub ? 2 : 1;
    default: {
      // de, ru, es, fr: the main region first (de-DE, ru-RU, es-ES, fr-FR), then any other
      if (p !== ui) return 0;
      return !sub || has(ui) ? 3 : 2;
    }
  }
}

/** A voice name for matching: lower case, accents dropped ("Amélie" -> "amelie"). */
const plainName = (name: string) => (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Whether a voice is on the device (an online voice sends the text to the browser vendor: see the header). */
const isLocal = (v: VoiceLike) => v.localService === true;

/**
 * A voice's score for speaking `ui` text in a `want` voice; -Infinity when it can't speak that language, so only
 * voices of the interface language compete (a stand-in such as pt-PT for pt-BR or zh-TW for zh-CN only when nothing
 * better is there). Among them: a matching gender (+6, the other gender -4), quality hints (natural / neural / online
 * / premium / enhanced +4, Google +2), the region (the main one +3, another +1), then an on-device voice (+1) and the
 * system default (+0.5). Novelty voices (macOS "Bells", "Zarvox"...) only when nothing else is there.
 */
export function scoreVoice(v: VoiceLike, want: 'male' | 'female', ui: Lang = 'en'): number {
  const fit = langFit(v.lang, ui);
  if (!fit) return -Infinity;
  const name = plainName(v.name);
  // English: fit 1 is another English (en-IN, en-ZA...); elsewhere it is a stand-in language, last resort
  let s = fit === 3 ? 3 : fit === 2 ? 1 : ui === 'en' ? 0 : -100;
  if (NOVELTY.test(name)) s -= 40;
  const isF = FEMALE.test(name);
  const isM = MALE.test(name);
  if (want === 'female') s += isF ? 6 : isM ? -4 : 0;
  else s += isM ? 6 : isF ? -4 : 0;
  if (/natural|neural|online|premium|enhanced/.test(name)) s += 4;
  if (/google/.test(name)) s += 2;
  if (isLocal(v)) s += 1;
  if (v.default) s += 0.5;
  return s;
}

/** The best voice for `ui` text in a `want` voice, or null when no voice speaks that language. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], want: 'male' | 'female', ui: Lang = 'en'): V | null {
  let best: V | null = null;
  let bs = -Infinity;
  for (const v of voices) {
    const s = scoreVoice(v, want, ui);
    if (s > bs) { bs = s; best = v; }
  }
  return best;
}

const KEY_OF = new Map<string, string>();
/** English line -> its catalogue key (the announcer and the unit lines; both are unique per text). */
function keyOf(text: string): string | undefined {
  if (!KEY_OF.size) {
    for (const [k, v] of Object.entries(ANNOUNCER_TEXT)) KEY_OF.set(v, `speech.announcer.${k}`);
    for (const [k, v] of Object.entries(UNIT_LINES)) if (!KEY_OF.has(v)) KEY_OF.set(v, `speech.unit.${k}`);
  }
  return KEY_OF.get(text);
}

/**
 * The interface language's translation of a spoken English line, or null when there is none (English, a missing
 * key, text that isn't a game line). Several lines in one text ("Reinforcements have arrived. Construction
 * complete.", the Locker's preview) are translated one by one.
 */
export function spokenTranslation(text: string): string | null {
  const ui = currentLang();
  if (ui === 'en') return null;
  const one = (t: string) => { const k = keyOf(t); return k ? translation(k) : null; };
  const whole = one(text.trim());
  if (whole) return whole;
  const parts = text.trim().split(/(?<=[.!?])\s+/);
  if (parts.length < 2) return null;
  const tr = parts.map(one);
  if (tr.some((t) => !t)) return null;
  return tr.join(ui === 'zh-CN' ? '' : ' ');
}

/** Rough time to say `text`, for the safety timeout: Chinese characters take longer each than Latin letters. */
const sayLength = (text: string) => text.length + 1.5 * (text.match(/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/g)?.length ?? 0);

interface Pair { male: SpeechSynthesisVoice | null; female: SpeechSynthesisVoice | null }

/** Thin, exception-safe wrapper around window.speechSynthesis. */
export class Speech {
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  /** The English voices (the fallback, and the voices of an English interface). */
  female: SpeechSynthesisVoice | null = null;
  male: SpeechSynthesisVoice | null = null;
  /** The voices for each interface language (null: the browser has none), picked when first needed. */
  private byLang = new Map<Lang, Pair | null>();
  /** Keep a reference to the live utterance (Chrome can GC it and drop `end` events otherwise). */
  private current: SpeechSynthesisUtterance | null = null;
  private currentDone: (() => void) | null = null;

  constructor() {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
        this.synth = window.speechSynthesis;
        this.loadVoices();
        const onChange = () => this.loadVoices();
        if (typeof this.synth.addEventListener === 'function') this.synth.addEventListener('voiceschanged', onChange);
        else (this.synth as SpeechSynthesis).onvoiceschanged = onChange;
      }
    } catch {
      this.synth = null;
    }
  }

  get supported(): boolean { return this.synth !== null; }
  get hasVoices(): boolean {
    if (this.synth && this.voices.length === 0) this.loadVoices();
    return this.voices.length > 0;
  }
  get speaking(): boolean { return this.current !== null; }

  private loadVoices(): void {
    try {
      const list = this.synth?.getVoices() ?? [];
      this.voices = list;
      this.byLang.clear();
      if (!list.length) return;
      // no English voice installed: null lets the engine pick one for lang=en-US instead of a foreign voice
      this.female = pickVoice(list, 'female', 'en');
      this.male = pickVoice(list, 'male', 'en');
    } catch { /* ignore */ }
  }

  /** The voices for an interface language (null when the browser has none for it). */
  private pair(ui: Lang): Pair | null {
    if (ui === 'en') return this.female || this.male ? { female: this.female, male: this.male } : null;
    if (!this.byLang.has(ui)) {
      const female = pickVoice(this.voices, 'female', ui);
      const male = pickVoice(this.voices, 'male', ui);
      this.byLang.set(ui, female || male ? { female, male } : null);
    }
    return this.byLang.get(ui) ?? null;
  }

  /** The voice for a speaker: the interface language's when the browser has one, else English (null: the engine's). */
  voiceFor(gender: 'male' | 'female'): SpeechSynthesisVoice | null {
    if (this.synth && this.voices.length === 0) this.loadVoices();
    const ui = currentLang();
    const p = (ui !== 'en' && this.pair(ui)) || { female: this.female, male: this.male };
    return gender === 'female' ? p.female ?? p.male : p.male ?? p.female;
  }

  /**
   * What to say with which voice: the translated line when the voice speaks the interface language, else the
   * English line (a line without a translation switches to the English voice of the same gender).
   */
  plan(text: string, voice: SpeechSynthesisVoice | null): { text: string; voice: SpeechSynthesisVoice | null; lang: string } {
    const ui = currentLang();
    if (ui !== 'en' && voice && langFit(voice.lang, ui) > 0) {
      const tr = spokenTranslation(text);
      if (tr) return { text: tr, voice, lang: voice.lang };
      const p = this.pair(ui);
      const female = p && p.female !== p.male && (voice === p.female || voice === p.male) ? voice === p.female : FEMALE.test(plainName(voice.name));
      const en = female ? this.female ?? this.male : this.male ?? this.female;
      return { text, voice: en, lang: en?.lang || 'en-US' };
    }
    return { text, voice, lang: voice?.lang || 'en-US' };
  }

  /** Warm up (iOS requires the first utterance inside a user gesture). */
  prime(): void {
    try {
      if (!this.synth) return;
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      this.synth.speak(u);
    } catch { /* ignore */ }
  }

  /**
   * Speak `text` (an English game line; see plan() for the language); `done` is called exactly once (end, error,
   * cancel or safety timeout). Returns false if speech is unavailable (done is NOT called in that case).
   */
  speak(text: string, o: { voice: SpeechSynthesisVoice | null; pitch: number; rate: number; volume: number }, done: () => void): boolean {
    const synth = this.synth;
    if (!synth || !this.hasVoices) return false;
    try {
      const say = this.plan(text, o.voice);
      const u = new SpeechSynthesisUtterance(say.text);
      if (say.voice) u.voice = say.voice;
      u.lang = say.lang;
      u.pitch = o.pitch;
      u.rate = o.rate;
      u.volume = Math.max(0, Math.min(1, o.volume));
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(safety);
        if (this.current === u) { this.current = null; this.currentDone = null; }
        done();
      };
      // onend sometimes never fires (engine hiccups); never let the queue stall
      const safety = setTimeout(finish, 2500 + sayLength(say.text) * 120);
      u.onend = finish;
      u.onerror = finish;
      this.current = u;
      this.currentDone = finish;
      if (synth.paused) synth.resume();
      synth.speak(u);
      return true;
    } catch {
      this.current = null;
      return false;
    }
  }

  /** Stop whatever is being spoken (fires the pending done callback). */
  cancel(): void {
    const d = this.currentDone;
    try { this.synth?.cancel(); } catch { /* ignore */ }
    this.current = null;
    this.currentDone = null;
    if (d) d();
  }
}
