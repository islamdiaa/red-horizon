/**
 * Web Speech API wrapper: voice selection (with async `voiceschanged` handling), the
 * EVA-style announcer queue and short unit acknowledgement lines. All texts are original.
 */
import type { AnnouncerKey, ResponseKind, VoiceKind } from './types';

export const ANNOUNCER_TEXT: Record<AnnouncerKey, string> = {
  mission_start: 'Battle control online.',
  building: 'Building.',
  construction_complete: 'Construction complete.',
  unit_ready: 'Unit ready.',
  training: 'Training.',
  on_hold: 'On hold.',
  cancelled: 'Cancelled.',
  insufficient_funds: 'Insufficient funds.',
  low_power: 'Low power.',
  new_options: 'New construction options.',
  cannot_deploy: 'Cannot deploy here.',
  cannot_build_here: 'Cannot build here.',
  base_under_attack: 'Our base is under attack.',
  harvester_under_attack: 'Harvester under attack.',
  unit_lost: 'Unit lost.',
  structure_lost: 'Structure destroyed.',
  structure_sold: 'Structure sold.',
  repairing: 'Repairing.',
  silos_needed: 'Silos needed.',
  select_target: 'Select target.',
  radar_online: 'Radar online.',
  radar_offline: 'Radar offline.',
  mission_accomplished: 'Mission accomplished.',
  mission_failed: 'Mission failed.',
  nuke_ready: 'Nuclear missile ready.',
  nuke_launched: 'Nuclear missile launched.',
  nuke_warning: 'Warning. Nuclear launch detected.',
  iron_curtain_ready: 'Iron Curtain charged.',
  chrono_ready: 'Chronosphere ready.',
  building_captured: 'Building captured.',
  reinforcements: 'Reinforcements have arrived.',
  primary_selected: 'Primary building selected.',
  enemy_destroyed: 'Enemy destroyed.',
  unit_promoted: 'Unit promoted.',
  gps_ready: 'GPS satellite ready.',
  gps_launched: 'Satellite launched.',
  sonar_ready: 'Sonar pulse ready.',
  spyplane_ready: 'Spy plane ready.',
  paratroopers_ready: 'Paratroopers ready.',
  parabombs_ready: 'Parabombs ready.',
  building_infiltrated: 'Building infiltrated.',
  credits_stolen: 'Credits stolen.',
  sub_detected: 'Submarine detected.',
  bridge_destroyed: 'Bridge destroyed.',
  bridge_repaired: 'Bridge repaired.',
  enemy_aircraft: 'Enemy aircraft approaching.',
  naval_unit_lost: 'Naval unit lost.',
  radar_jammed: 'Radar jammed.',
  mine_detected: 'Mines detected.',
  paratroopers_inbound: 'Enemy paratroopers inbound.',
  spy_detected: 'Enemy spy eliminated.',
  mines_laid: 'Mines laid.',
};

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
};
export const DEFAULT_THROTTLE = 4000;

/** Higher priority announcements may displace lower ones from a full queue. */
export const ANNOUNCER_PRIORITY: Partial<Record<AnnouncerKey, number>> = {
  nuke_warning: 10, mission_accomplished: 9, mission_failed: 9, nuke_launched: 8, base_under_attack: 7,
  nuke_ready: 6, iron_curtain_ready: 6, chrono_ready: 6, harvester_under_attack: 5, structure_lost: 4,
  mission_start: 4, building_captured: 4, low_power: 3, construction_complete: 3, unit_ready: 3,
  unit_promoted: 2,
};

type Lines = Record<ResponseKind, string[]>;
export const RESPONSE_LINES: Record<Exclude<VoiceKind, 'dog'>, Lines> = {
  infantry: {
    select: ['Yes sir!', 'Reporting.', 'Awaiting orders.', 'Ready.'],
    move: ['Acknowledged.', 'Moving out.', 'Affirmative.', 'On my way.', 'Yes sir!'],
    attack: ['Engaging!', 'Open fire!', 'Target acquired.', 'Attacking.'],
  },
  vehicle: {
    select: ['Vehicle reporting.', 'Standing by.', 'Awaiting orders.'],
    move: ['Rolling out.', 'Moving.', 'Affirmative.', 'Under way.'],
    attack: ['Firing.', 'Engaging target.', 'Target locked.'],
  },
  tanya: {
    select: ['Talk to me.', "What's the job?", 'Ready when you are.'],
    move: ['On it.', 'Leave it to me.', 'Moving.'],
    attack: ['Lights out!', 'Too easy!', 'Watch this!'],
  },
  engineer: {
    select: ['Engineer ready.', 'Tools ready.'],
    move: ['Moving.', 'On my way.'],
    attack: ["I'll take it.", 'Securing it.', 'Right away.'],
  },
  medic: {
    select: ['Medic here.', "Who's hurt?"],
    move: ['On my way.', 'Moving.'],
    attack: ['Hold still.', 'Patching you up.'],
  },
  harvester: {
    select: ['Harvester ready.', 'Ore truck standing by.'],
    move: ['Heading out.', 'Moving to ore field.'],
    attack: ['Harvesting.', 'Collecting ore.'],
  },
  aircraft: {
    select: ['Pilot standing by.', 'Airborne.'],
    move: ['Inbound.', 'Changing course.', 'Roger.'],
    attack: ['Attack run.', 'Weapons hot.', 'Target in sight.'],
  },
  naval: {
    select: ['Bridge here.', 'Captain on deck.', 'Ship ready.'],
    move: ['Setting course.', 'Full ahead.', 'Aye, Commander.', 'Helm answering.'],
    attack: ['All guns, fire!', 'Target bearing locked.', 'Engaging.'],
  },
  spy: {
    select: ['Yes?', 'Discreetly.', 'At your service.'],
    move: ['Quietly now.', 'Of course.', 'Leave it with me.'],
    attack: ['Consider it done.', 'Nobody will notice.', 'With pleasure.'],
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
};

const FEMALE = /\b(zira|aria|jenny|michelle|emma|sonia|libby|hazel|susan|samantha|karen|moira|tessa|fiona|serena|victoria|allison|ava|kate|female|woman|joanna|salli|kendra|kimberly|ivy|amy|natasha|clara|catherine|heather|linda|nicky|sara|ana|eva|emily|olivia|ashley|jane|elizabeth|nancy|libby|maisie|mia|isla)\b/i;
const MALE = /\b(david|mark|guy|ryan|george|daniel|alex|fred|tom|male|man|christopher|eric|roger|steffan|william|james|brian|thomas|oliver|arthur|aaron|gordon|lee|rishi|matthew|andrew|brandon|davis|tony|jason|liam|noah|ethan|elliot)\b/i;
const NOVELTY = /(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|grandpa|grandma|rocko|shelley|reed|sandy|flo|eddy)/i;

function scoreVoice(v: SpeechSynthesisVoice, want: 'male' | 'female'): number {
  const lang = (v.lang || '').toLowerCase().replace('_', '-');
  if (!lang.startsWith('en')) return -100;
  let s = 0;
  if (/en-(us|gb)/.test(lang)) s += 3;
  else if (/en-(au|ie|ca|nz)/.test(lang)) s += 1;
  const name = v.name || '';
  if (NOVELTY.test(name)) s -= 40;
  const isF = FEMALE.test(name);
  const isM = MALE.test(name);
  if (want === 'female') s += isF ? 6 : isM ? -4 : 0;
  else s += isM ? 6 : isF ? -4 : 0;
  if (/natural|neural|online|premium|enhanced/i.test(name)) s += 4;
  if (/google/i.test(name)) s += 2;
  if (v.localService) s += 1;
  if (v.default) s += 0.5;
  return s;
}

/** Thin, exception-safe wrapper around window.speechSynthesis. */
export class Speech {
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  female: SpeechSynthesisVoice | null = null;
  male: SpeechSynthesisVoice | null = null;
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
      if (!list.length) return;
      const best = (want: 'male' | 'female') => {
        let b: SpeechSynthesisVoice | null = null;
        let bs = -Infinity;
        for (const v of list) {
          const s = scoreVoice(v, want);
          if (s > bs) { bs = s; b = v; }
        }
        // no English voice installed: let the engine pick one for lang=en-US instead of a foreign voice
        return bs > -50 ? b : null;
      };
      this.female = best('female');
      this.male = best('male');
    } catch { /* ignore */ }
  }

  voiceFor(gender: 'male' | 'female'): SpeechSynthesisVoice | null {
    return gender === 'female' ? this.female ?? this.male : this.male ?? this.female;
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
   * Speak `text`; `done` is called exactly once (end, error, cancel or safety timeout).
   * Returns false if speech is unavailable (done is NOT called in that case).
   */
  speak(text: string, o: { voice: SpeechSynthesisVoice | null; pitch: number; rate: number; volume: number }, done: () => void): boolean {
    const synth = this.synth;
    if (!synth || !this.hasVoices) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (o.voice) { u.voice = o.voice; u.lang = o.voice.lang; } else u.lang = 'en-US';
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
      const safety = setTimeout(finish, 2500 + text.length * 120);
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
