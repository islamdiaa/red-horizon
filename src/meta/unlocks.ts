/**
 * Cosmetic unlocks: commander portraits and titles, unit paint schemes, HUD accent themes, announcer voice
 * styles, victory fanfares and profile banners. Cosmetic only: nothing here touches the rules or the
 * simulation, and nothing is for sale. Items are earned by rank milestones, wins, contracts, medals, the
 * daily streak and Conquest renown, or claimed with Commendations (earned from contracts, never bought).
 *
 * Pure data + logic (no DOM): the Locker (src/ui/locker.ts) renders it, src/meta/cosmetics.ts applies the
 * equipped items, and the MetaTracker announces new unlocks after a battle.
 */
import { ACH_BY_ID, achievementTitle, tierName } from './achievements';
import { RANKS, rankName } from './ranks';
import type { Profile } from './profile';
import { dt, fmtInt } from '../i18n/core';
import tMeta, { SLOT_TEXT } from '../i18n/en/meta';

export type CosmeticSlot = 'paint' | 'theme' | 'portrait' | 'title' | 'banner' | 'voice' | 'fanfare';
export const COSMETIC_SLOTS: CosmeticSlot[] = ['paint', 'theme', 'portrait', 'title', 'banner', 'voice', 'fanfare'];
/** Slot display names (translated on read: src/i18n/en/meta.ts). */
export const SLOT_LABEL: Record<CosmeticSlot, string> = SLOT_TEXT;
/** Pictogram (src/meta/art.ts PICTO) per slot. */
export const SLOT_PICTO: Record<CosmeticSlot, string> = { paint: 'tank', theme: 'eye', portrait: 'user', title: 'laurel', banner: 'flag', voice: 'wave', fanfare: 'trophy' };

export type UnlockReq =
  | { kind: 'default' }
  | { kind: 'rank'; n: number }
  | { kind: 'wins'; n: number }
  | { kind: 'games'; n: number }
  | { kind: 'contracts'; n: number }
  | { kind: 'streak'; n: number }
  | { kind: 'renown'; n: number }
  | { kind: 'medal'; id: string; tier?: number }
  | { kind: 'cmd'; cost: number };

/** Render-only repaint of the team colour (linear RGB; see setPaintScheme in src/render/models/materials.ts). */
export interface PaintSpec {
  /** Base paint colour, or null to keep the team colour. */
  base: [number, number, number] | null;
  /** How much of the team colour shows through the base (0..1). */
  keep: number;
  /** Brightness multiplier of the team colour part. */
  gain: number;
  /** 0..1: lower roughness on painted parts (parade gloss). */
  gloss: number;
}
export interface ThemeSpec { accent: string; rgb: string; hi: string }
export interface VoiceSpec { gender: 'male' | 'female'; pitch: number; rate: number }
/** A fanfare: notes as [semitones from the tonic, start beat, length in beats, instrument]. */
export interface FanfareSpec { bpm: number; notes: [number, number, number, 'brass' | 'bugle' | 'bell' | 'timp' | 'synth' | 'snare'][] }
export interface PortraitSpecLite { seed: number; skin: number; hair: number; hat: number; facial: number; eyewear: number }

export interface CosmeticDef {
  id: string;
  slot: CosmeticSlot;
  name: string;
  desc: string;
  req: UnlockReq;
  paint?: PaintSpec;
  theme?: ThemeSpec;
  voice?: VoiceSpec;
  fanfare?: FanfareSpec;
  /** CSS background of the banner. */
  banner?: string;
  portrait?: PortraitSpecLite;
}

const lin = (hex: number): [number, number, number] => {
  const f = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
};

export const COSMETICS: CosmeticDef[] = [
  // ---- paint schemes (your units only; a hint of the team colour always shows through)
  { id: 'paint-standard', slot: 'paint', name: 'Standard Issue', desc: 'Factory team colours.', req: { kind: 'default' } },
  { id: 'paint-desert', slot: 'paint', name: 'Desert Tan', desc: 'Sand-coloured armour for the dry theatres.', req: { kind: 'wins', n: 3 }, paint: { base: lin(0xa48a5c), keep: 0.2, gain: 1, gloss: 0 } },
  { id: 'paint-urban', slot: 'paint', name: 'Urban Grey', desc: 'Concrete grey for city fighting.', req: { kind: 'rank', n: 3 }, paint: { base: lin(0x6e747c), keep: 0.18, gain: 1, gloss: 0 } },
  { id: 'paint-woodland', slot: 'paint', name: 'Woodland Olive', desc: 'Deep olive drab for the forests of Europe.', req: { kind: 'contracts', n: 5 }, paint: { base: lin(0x55633a), keep: 0.2, gain: 1, gloss: 0 } },
  { id: 'paint-arctic', slot: 'paint', name: 'Arctic White', desc: 'Winter whitewash over the team colours.', req: { kind: 'wins', n: 10 }, paint: { base: lin(0xb9c0c6), keep: 0.2, gain: 1.05, gloss: 0 } },
  { id: 'paint-night', slot: 'paint', name: 'Night Black', desc: 'Matte black for operations after dark.', req: { kind: 'cmd', cost: 40 }, paint: { base: lin(0x1c1e22), keep: 0.16, gain: 0.8, gloss: 0 } },
  { id: 'paint-parade', slot: 'paint', name: 'Parade Gloss', desc: 'Polished, deep team colours fit for a victory parade.', req: { kind: 'rank', n: 9 }, paint: { base: null, keep: 1, gain: 1.3, gloss: 0.7 } },
  // ---- HUD accent themes
  { id: 'theme-faction', slot: 'theme', name: 'Faction', desc: 'Allied blue or Soviet red, by the side you fight for.', req: { kind: 'default' } },
  { id: 'theme-amber', slot: 'theme', name: 'Amber', desc: 'Warm phosphor amber.', req: { kind: 'rank', n: 2 }, theme: { accent: '#ffb347', rgb: '255, 179, 71', hi: '#ffe0b0' } },
  { id: 'theme-jade', slot: 'theme', name: 'Jade', desc: 'Radar-scope green.', req: { kind: 'cmd', cost: 15 }, theme: { accent: '#3ddc97', rgb: '61, 220, 151', hi: '#b6f5d8' } },
  { id: 'theme-violet', slot: 'theme', name: 'Violet', desc: 'Chronosphere violet.', req: { kind: 'medal', id: 'challenger' }, theme: { accent: '#a78bfa', rgb: '167, 139, 250', hi: '#ddd2ff' } },
  { id: 'theme-glacier', slot: 'theme', name: 'Glacier', desc: 'Cold cyan of the northern front.', req: { kind: 'renown', n: 200 }, theme: { accent: '#4fd8ff', rgb: '79, 216, 255', hi: '#c4f2ff' } },
  { id: 'theme-crimson', slot: 'theme', name: 'Crimson', desc: 'Deep alarm red.', req: { kind: 'cmd', cost: 25 }, theme: { accent: '#ff4d6d', rgb: '255, 77, 109', hi: '#ffc2cd' } },
  { id: 'theme-gold', slot: 'theme', name: 'General Staff Gold', desc: 'Gold braid for the highest ranks.', req: { kind: 'rank', n: 11 }, theme: { accent: '#ffd34d', rgb: '255, 211, 77', hi: '#fff0b8' } },
  // ---- commander portraits
  { id: 'portrait-officer', slot: 'portrait', name: 'Field Officer', desc: 'Peaked cap, regulation haircut.', req: { kind: 'default' }, portrait: { seed: 1, skin: 0, hair: 0, hat: 0, facial: 0, eyewear: 0 } },
  { id: 'portrait-veteran', slot: 'portrait', name: 'Old Guard', desc: 'Grey beard, ten battles on the clock.', req: { kind: 'medal', id: 'old-guard' }, portrait: { seed: 3, skin: 1, hair: 4, hat: 0, facial: 2, eyewear: 0 } },
  { id: 'portrait-tanker', slot: 'portrait', name: 'Tank Commander', desc: 'Beret and dark goggles.', req: { kind: 'medal', id: 'tank-buster' }, portrait: { seed: 2, skin: 2, hair: 1, hat: 1, facial: 1, eyewear: 4 } },
  { id: 'portrait-sapper', slot: 'portrait', name: 'Sapper', desc: 'Field helmet and spectacles.', req: { kind: 'medal', id: 'hostile-takeover' }, portrait: { seed: 5, skin: 3, hair: 0, hat: 2, facial: 4, eyewear: 2 } },
  { id: 'portrait-spymaster', slot: 'portrait', name: 'Spymaster', desc: 'Nobody remembers the face.', req: { kind: 'medal', id: 'spymaster' }, portrait: { seed: 6, skin: 0, hair: 3, hat: 3, facial: 4, eyewear: 4 } },
  { id: 'portrait-winter', slot: 'portrait', name: 'Winter Guard', desc: 'Fur hat and a stubborn jaw.', req: { kind: 'cmd', cost: 20 }, portrait: { seed: 7, skin: 1, hair: 2, hat: 2, facial: 3, eyewear: 0 } },
  { id: 'portrait-scarred', slot: 'portrait', name: 'Scarred Veteran', desc: 'The one who walked out of the fire.', req: { kind: 'medal', id: 'phoenix' }, portrait: { seed: 8, skin: 4, hair: 0, hat: 0, facial: 9, eyewear: 0 } },
  { id: 'portrait-strategist', slot: 'portrait', name: 'Grand Strategist', desc: 'Monocle, maps, and a long memory.', req: { kind: 'renown', n: 300 }, portrait: { seed: 9, skin: 0, hair: 5, hat: 3, facial: 1, eyewear: 1 } },
  { id: 'portrait-marshal', slot: 'portrait', name: 'Marshal', desc: 'Every ribbon earned the hard way.', req: { kind: 'rank', n: 12 }, portrait: { seed: 10, skin: 2, hair: 4, hat: 0, facial: 4, eyewear: 0 } },
  // ---- titles (shown under your name)
  { id: 'title-none', slot: 'title', name: 'No title', desc: 'Just your rank and name.', req: { kind: 'default' } },
  { id: 'title-recruit', slot: 'title', name: 'Fresh Recruit', desc: 'Fight your first battle.', req: { kind: 'games', n: 1 } },
  { id: 'title-tank-hunter', slot: 'title', name: 'Tank Hunter', desc: 'For the Tank Buster medal.', req: { kind: 'medal', id: 'tank-buster' } },
  { id: 'title-contractor', slot: 'title', name: 'Reliable', desc: 'Complete 10 contracts.', req: { kind: 'contracts', n: 10 } },
  { id: 'title-globetrotter', slot: 'title', name: 'Globetrotter', desc: 'For the Globetrotter medal.', req: { kind: 'medal', id: 'globetrotter' } },
  { id: 'title-untouchable', slot: 'title', name: 'The Untouchable', desc: 'For the Untouchable medal.', req: { kind: 'medal', id: 'untouchable' } },
  { id: 'title-devoted', slot: 'title', name: 'Ever Ready', desc: 'Reach a 3-day Daily Challenge streak.', req: { kind: 'streak', n: 3 } },
  { id: 'title-iron', slot: 'title', name: 'Iron Commander', desc: 'Reach the rank of Major.', req: { kind: 'rank', n: 7 } },
  { id: 'title-strategist', slot: 'title', name: 'Chief Strategist', desc: 'Claimed with Commendations.', req: { kind: 'cmd', cost: 30 } },
  { id: 'title-warlord', slot: 'title', name: 'Warlord of Europe', desc: 'Earn 1,500 Conquest renown.', req: { kind: 'renown', n: 1500 } },
  { id: 'title-legend', slot: 'title', name: 'Living Legend', desc: 'Reach the highest rank.', req: { kind: 'rank', n: 14 } },
  // ---- profile banners
  { id: 'banner-standard', slot: 'banner', name: 'Standard', desc: 'Field-grey service banner.', req: { kind: 'default' }, banner: 'linear-gradient(135deg, #1d2836, #0b1119)' },
  { id: 'banner-redstar', slot: 'banner', name: 'Red Star', desc: 'Fight five battles.', req: { kind: 'games', n: 5 }, banner: 'radial-gradient(circle at 86% 40%, rgba(255, 80, 60, .55), transparent 38%), repeating-linear-gradient(120deg, rgba(255, 255, 255, .03) 0 2px, transparent 2px 14px), linear-gradient(135deg, #3b0f0b, #140606)' },
  { id: 'banner-eagle', slot: 'banner', name: 'Allied Eagle', desc: 'For the Conqueror medal.', req: { kind: 'medal', id: 'conqueror' }, banner: 'radial-gradient(circle at 84% 45%, rgba(120, 180, 255, .45), transparent 40%), repeating-linear-gradient(90deg, rgba(255, 255, 255, .04) 0 1px, transparent 1px 22px), linear-gradient(135deg, #0f2a52, #071326)' },
  { id: 'banner-tiger', slot: 'banner', name: 'Tiger Stripe', desc: 'For the Tank Buster medal.', req: { kind: 'medal', id: 'tank-buster' }, banner: 'repeating-linear-gradient(115deg, rgba(20, 12, 4, .92) 0 12px, rgba(170, 104, 30, .82) 12px 26px, rgba(20, 12, 4, .92) 26px 31px, rgba(196, 128, 44, .78) 31px 52px)' },
  { id: 'banner-arctic', slot: 'banner', name: 'Arctic Camo', desc: 'Claimed with Commendations.', req: { kind: 'cmd', cost: 15 }, banner: 'radial-gradient(ellipse at 20% 30%, rgba(255, 255, 255, .22) 0 18%, transparent 19%), radial-gradient(ellipse at 70% 70%, rgba(150, 165, 180, .35) 0 22%, transparent 23%), radial-gradient(ellipse at 85% 20%, rgba(90, 105, 120, .4) 0 14%, transparent 15%), linear-gradient(135deg, #8d9aa6, #46525e)' },
  { id: 'banner-desert', slot: 'banner', name: 'Desert Storm', desc: 'Claimed with Commendations.', req: { kind: 'cmd', cost: 15 }, banner: 'radial-gradient(ellipse at 25% 65%, rgba(120, 80, 40, .45) 0 20%, transparent 21%), radial-gradient(ellipse at 75% 30%, rgba(220, 190, 140, .4) 0 18%, transparent 19%), linear-gradient(135deg, #a8855a, #5a4024)' },
  { id: 'banner-dawn', slot: 'banner', name: 'Red Dawn', desc: 'Reach a 7-day Daily Challenge streak.', req: { kind: 'streak', n: 7 }, banner: 'radial-gradient(ellipse at 50% 120%, rgba(255, 200, 90, .85), rgba(255, 90, 50, .5) 35%, transparent 70%), linear-gradient(180deg, #120a1e, #3a1420)' },
  { id: 'banner-laurels', slot: 'banner', name: 'Laurels of Europe', desc: 'Earn 1,000 Conquest renown.', req: { kind: 'renown', n: 1000 }, banner: 'radial-gradient(circle at 85% 50%, rgba(255, 220, 120, .4), transparent 35%), repeating-radial-gradient(circle at 85% 50%, rgba(140, 200, 120, .12) 0 3px, transparent 3px 11px), linear-gradient(135deg, #1e3016, #0a1208)' },
  { id: 'banner-gold', slot: 'banner', name: 'Gold Leaf', desc: 'Reach the rank of Brigadier General.', req: { kind: 'rank', n: 10 }, banner: 'linear-gradient(115deg, #4a3205, #c99a2a 35%, #fff0b0 50%, #c99a2a 65%, #4a3205)' },
  // ---- announcer voice styles (speech synthesis)
  { id: 'voice-command', slot: 'voice', name: 'Command Net', desc: 'The standard battlefield announcer.', req: { kind: 'default' }, voice: { gender: 'female', pitch: 0.92, rate: 1.04 } },
  { id: 'voice-radio', slot: 'voice', name: 'Radio Operator', desc: 'Quick and crisp.', req: { kind: 'contracts', n: 3 }, voice: { gender: 'female', pitch: 1.12, rate: 1.18 } },
  { id: 'voice-marshal', slot: 'voice', name: 'Field Marshal', desc: 'Slow, low and grave.', req: { kind: 'rank', n: 5 }, voice: { gender: 'male', pitch: 0.72, rate: 0.92 } },
  { id: 'voice-sergeant', slot: 'voice', name: 'Drill Sergeant', desc: 'Loud and in a hurry.', req: { kind: 'cmd', cost: 20 }, voice: { gender: 'male', pitch: 0.98, rate: 1.24 } },
  { id: 'voice-archive', slot: 'voice', name: 'Cold Archive', desc: 'Measured, like a recording from a bunker.', req: { kind: 'medal', id: 'riders-on-the-storm' }, voice: { gender: 'female', pitch: 0.78, rate: 0.9 } },
  // ---- victory fanfares (played when you win)
  { id: 'fanfare-classic', slot: 'fanfare', name: 'Orchestral', desc: 'The score\'s own victory stinger.', req: { kind: 'default' } },
  { id: 'fanfare-bugle', slot: 'fanfare', name: 'Bugle Call', desc: 'A lone bugle over the battlefield.', req: { kind: 'medal', id: 'first-victory' },
    fanfare: { bpm: 132, notes: [[-5, 0, 0.5, 'bugle'], [0, 0.5, 0.5, 'bugle'], [4, 1, 0.5, 'bugle'], [7, 1.5, 1, 'bugle'], [4, 2.5, 0.5, 'bugle'], [7, 3, 0.5, 'bugle'], [12, 3.5, 2.5, 'bugle']] } },
  { id: 'fanfare-brass', slot: 'fanfare', name: 'Brass Salute', desc: 'Full brass with timpani.', req: { kind: 'wins', n: 5 },
    fanfare: { bpm: 112, notes: [[0, 0, 0.75, 'brass'], [-12, 0, 0.75, 'timp'], [7, 0.75, 0.25, 'brass'], [7, 1, 0.5, 'brass'], [12, 1.5, 0.5, 'brass'], [-5, 1.5, 0.5, 'timp'], [16, 2, 0.5, 'brass'], [19, 2.5, 3, 'brass'], [12, 2.5, 3, 'brass'], [7, 2.5, 3, 'brass'], [-12, 2.5, 2, 'timp']] } },
  { id: 'fanfare-march', slot: 'fanfare', name: 'Victory March', desc: 'Snare roll into a marching chord.', req: { kind: 'cmd', cost: 20 },
    fanfare: { bpm: 120, notes: [[0, 0, 0.25, 'snare'], [0, 0.25, 0.25, 'snare'], [0, 0.5, 0.25, 'snare'], [0, 0.75, 0.25, 'snare'], [0, 1, 1, 'brass'], [4, 1, 1, 'brass'], [-12, 1, 1, 'timp'], [5, 2, 0.5, 'brass'], [9, 2, 0.5, 'brass'], [7, 2.5, 2.5, 'brass'], [11, 2.5, 2.5, 'brass'], [14, 2.5, 2.5, 'brass'], [-5, 2.5, 2, 'timp']] } },
  { id: 'fanfare-bells', slot: 'fanfare', name: 'Bell Tower', desc: 'Church bells ringing out over a liberated town.', req: { kind: 'renown', n: 500 },
    fanfare: { bpm: 96, notes: [[12, 0, 2, 'bell'], [7, 0.5, 2, 'bell'], [4, 1, 2, 'bell'], [0, 1.5, 2, 'bell'], [12, 2.5, 3, 'bell'], [16, 2.5, 3, 'bell'], [19, 2.5, 3, 'bell']] } },
  { id: 'fanfare-synth', slot: 'fanfare', name: 'Synth Anthem', desc: 'A cold-war synthesiser anthem.', req: { kind: 'rank', n: 7 },
    fanfare: { bpm: 140, notes: [[0, 0, 0.25, 'synth'], [7, 0.25, 0.25, 'synth'], [12, 0.5, 0.25, 'synth'], [7, 0.75, 0.25, 'synth'], [3, 1, 0.25, 'synth'], [10, 1.25, 0.25, 'synth'], [15, 1.5, 0.25, 'synth'], [10, 1.75, 0.25, 'synth'], [5, 2, 0.5, 'synth'], [12, 2.5, 0.5, 'synth'], [-12, 2, 1, 'timp'], [12, 3, 2.5, 'synth'], [19, 3, 2.5, 'synth'], [24, 3, 2.5, 'synth']] } },
];

export const COSMETIC_BY_ID: Record<string, CosmeticDef> = Object.fromEntries(COSMETICS.map((c) => [c.id, c]));
export const DEFAULT_COSMETIC: Record<CosmeticSlot, string> = {
  paint: 'paint-standard', theme: 'theme-faction', portrait: 'portrait-officer', title: 'title-none', banner: 'banner-standard', voice: 'voice-command', fanfare: 'fanfare-classic',
};

// ---------------------------------------------------------------------------
// Profile state
// ---------------------------------------------------------------------------
export interface CosmeticsState {
  /** Items claimed with Commendations. */
  owned: string[];
  equipped: Partial<Record<CosmeticSlot, string>>;
  /** Items looked at in the Locker (others that are unlocked carry a "new" marker). */
  seen: string[];
  /** Unlocks already announced after a battle. */
  announced: string[];
}

export function defaultCosmetics(): CosmeticsState {
  return { owned: [], equipped: {}, seen: [], announced: [] };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const known = (id: unknown): id is string => typeof id === 'string' && Object.hasOwn(COSMETIC_BY_ID, id);
const knownIds = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter(known))] : []);

export function normalizeCosmetics(raw: unknown): CosmeticsState {
  if (!isObj(raw)) return defaultCosmetics();
  const equipped: CosmeticsState['equipped'] = {};
  if (isObj(raw.equipped)) {
    for (const slot of COSMETIC_SLOTS) {
      const id = raw.equipped[slot];
      if (known(id) && COSMETIC_BY_ID[id].slot === slot) equipped[slot] = id;
    }
  }
  return { owned: knownIds(raw.owned).filter((id) => COSMETIC_BY_ID[id].req.kind === 'cmd'), equipped, seen: knownIds(raw.seen), announced: knownIds(raw.announced) };
}

// ---------------------------------------------------------------------------
// Unlock status
// ---------------------------------------------------------------------------
export interface UnlockCtx {
  profile: Profile;
  /** Conquest renown (rh.conquest.meta). */
  renown: number;
}

export interface UnlockStatus {
  unlocked: boolean;
  /** Claimable with Commendations (and not claimed yet). */
  purchasable: boolean;
  affordable: boolean;
  cur: number;
  target: number;
  frac: number;
  /** What it takes, e.g. "Win 10 battles". */
  how: string;
  /** What is still missing, e.g. "2 more wins" ('' when unlocked). */
  need: string;
}

const whole = (n: number) => Math.max(0, Math.round(n));
const fmt = (n: number) => fmtInt(whole(n));

/** A cosmetic's display name and description (game data cosmetic.<id>). */
export const cosmeticName = (def: Pick<CosmeticDef, 'id' | 'name'>): string => dt('cosmetic', def.id, 'name', def.name);
export const cosmeticDesc = (def: Pick<CosmeticDef, 'id' | 'desc'>): string => dt('cosmetic', def.id, 'desc', def.desc);

export function unlockStatus(def: CosmeticDef, ctx: UnlockCtx): UnlockStatus {
  const p = ctx.profile;
  const r = def.req;
  const st = (cur: number, target: number, how: string, need: (left: number) => string): UnlockStatus => {
    const ok = cur >= target;
    return { unlocked: ok, purchasable: false, affordable: false, cur: Math.min(cur, target), target, frac: target > 0 ? Math.min(1, cur / target) : 1, how, need: ok ? '' : need(target - cur) };
  };
  switch (r.kind) {
    case 'default':
      return { unlocked: true, purchasable: false, affordable: false, cur: 1, target: 1, frac: 1, how: tMeta('unlock.standard'), need: '' };
    case 'rank': {
      const rank = rankName(r.n, p.faction);
      return st(p.xp, RANKS[Math.min(r.n, RANKS.length - 1)].xp, tMeta('unlock.rankHow', { rank }), (left) => tMeta('unlock.rankNeed', { xp: fmt(left), rank }));
    }
    case 'wins':
      return st(p.stats.wins, r.n, tMeta('unlock.winsHow', { n: whole(r.n) }), (left) => tMeta('unlock.winsNeed', { n: whole(left) }));
    case 'games':
      return st(p.stats.games, r.n, tMeta('unlock.gamesHow', { n: whole(r.n) }), (left) => tMeta('unlock.gamesNeed', { n: whole(left) }));
    case 'contracts':
      return st(p.contracts.completed, r.n, tMeta('unlock.contractsHow', { n: whole(r.n) }), (left) => tMeta('unlock.contractsNeed', { n: whole(left) }));
    case 'streak':
      return st(p.daily.longest, r.n, tMeta('unlock.streakHow', { n: String(r.n) }), () => tMeta('unlock.streakNeed', { n: String(r.n), best: String(p.daily.longest) }));
    case 'renown':
      return st(ctx.renown, r.n, tMeta('unlock.renownHow', { n: fmt(r.n) }), (left) => tMeta('unlock.renownNeed', { n: fmt(left) }));
    case 'medal': {
      const a = ACH_BY_ID[r.id];
      const tier = Math.max(1, r.tier ?? 1);
      const have = p.medals[r.id]?.tier ?? 0;
      // a hidden medal keeps its secret until it is earned
      const secret = !!a?.hidden && have < 1;
      const medal = a ? achievementTitle(a) : r.id;
      const tiered = !!a?.tiers && a.tiers.length > 1;
      const tierLabel = tiered ? tierName(tier - 1) : '';
      const label = secret ? tMeta('unlock.medalSecretNeed') : tiered ? tMeta('unlock.medalTierNeed', { medal, tier: tierLabel }) : tMeta('unlock.medalNeed', { medal });
      const how = secret ? tMeta('unlock.medalSecretHow') : tiered ? tMeta('unlock.medalTierHow', { medal, tier: tierLabel }) : tMeta('unlock.medalHow', { medal });
      if (have >= tier) return { unlocked: true, purchasable: false, affordable: false, cur: 1, target: 1, frac: 1, how, need: '' };
      if (a?.counter && a.tiers && !secret) {
        const target = a.tiers[Math.min(tier, a.tiers.length) - 1];
        const cur = p.counters[a.counter] ?? 0;
        const prog = { medal, tier: tierLabel, cur: fmt(Math.min(cur, target)), target: fmt(target) };
        return { ...st(cur, target, how, () => (tiered ? tMeta('unlock.medalTierProgress', prog) : tMeta('unlock.medalProgress', prog))), unlocked: false };
      }
      return { unlocked: false, purchasable: false, affordable: false, cur: 0, target: 1, frac: 0, how, need: label };
    }
    case 'cmd': {
      const owned = p.cosmetics.owned.includes(def.id);
      const bal = p.commendations;
      return {
        unlocked: owned, purchasable: !owned, affordable: !owned && bal >= r.cost, cur: owned ? r.cost : Math.min(bal, r.cost), target: r.cost,
        frac: owned ? 1 : Math.min(1, bal / r.cost), how: tMeta('unlock.cmdHow', { n: whole(r.cost) }),
        need: owned ? '' : bal >= r.cost ? tMeta('unlock.cmdReady') : tMeta('unlock.cmdNeed', { n: whole(r.cost - bal) }),
      };
    }
  }
}

export function isUnlocked(id: string, ctx: UnlockCtx): boolean {
  const def = known(id) ? COSMETIC_BY_ID[id] : undefined;
  return !!def && unlockStatus(def, ctx).unlocked;
}

/** "Arctic White paint", "Field Marshal announcer", "“Tank Hunter” title". */
export function cosmeticLabel(def: CosmeticDef): string {
  return tMeta(`item.${def.slot}`, { name: cosmeticName(def) });
}

/** The equipped item of a slot (falls back to the default when the stored choice is not unlocked). */
export function equippedId(slot: CosmeticSlot, ctx: UnlockCtx): string {
  const id = ctx.profile.cosmetics.equipped[slot];
  return known(id) && COSMETIC_BY_ID[id].slot === slot && isUnlocked(id, ctx) ? id : DEFAULT_COSMETIC[slot];
}
export function equipped(slot: CosmeticSlot, ctx: UnlockCtx): CosmeticDef {
  return COSMETIC_BY_ID[equippedId(slot, ctx)];
}

/** Equip an unlocked item (mutates the profile; the caller saves). */
export function equipCosmetic(ctx: UnlockCtx, id: string): boolean {
  const def = known(id) ? COSMETIC_BY_ID[id] : undefined;
  if (!def || !isUnlocked(id, ctx)) return false;
  ctx.profile.cosmetics.equipped[def.slot] = id;
  if (!ctx.profile.cosmetics.seen.includes(id)) ctx.profile.cosmetics.seen.push(id);
  return true;
}

/** Claim an item with Commendations (mutates the profile; the caller saves). */
export function claimCosmetic(ctx: UnlockCtx, id: string): boolean {
  const def = known(id) ? COSMETIC_BY_ID[id] : undefined;
  if (!def || def.req.kind !== 'cmd') return false;
  const p = ctx.profile;
  if (p.cosmetics.owned.includes(id) || p.commendations < def.req.cost) return false;
  p.commendations -= def.req.cost;
  p.cosmetics.owned.push(id);
  if (!p.cosmetics.seen.includes(id)) p.cosmetics.seen.push(id);
  return true;
}

/** Earned (non-default, non-claimed) items not announced yet. */
export function unannouncedUnlocks(ctx: UnlockCtx): CosmeticDef[] {
  const done = new Set(ctx.profile.cosmetics.announced);
  return COSMETICS.filter((d) => d.req.kind !== 'default' && d.req.kind !== 'cmd' && !done.has(d.id) && unlockStatus(d, ctx).unlocked);
}

/** Unlocked items not looked at in the Locker yet ("new"). */
export function unseenUnlocks(ctx: UnlockCtx): CosmeticDef[] {
  const seen = new Set(ctx.profile.cosmetics.seen);
  return COSMETICS.filter((d) => d.req.kind !== 'default' && !seen.has(d.id) && unlockStatus(d, ctx).unlocked);
}

/** Mark items as looked at (mutates the profile; the caller saves). */
export function markSeen(ctx: UnlockCtx, ids: string[]) {
  const seen = ctx.profile.cosmetics.seen;
  for (const id of ids) if (known(id) && !seen.includes(id)) seen.push(id);
}

export interface Teaser {
  def: CosmeticDef;
  status: UnlockStatus;
  /** "2 more wins → Arctic White paint". */
  text: string;
}

/**
 * The next unlock worth chasing: the locked item closest to done (earned ones before Commendation claims;
 * an affordable claim is surfaced first: it only needs a visit to the Locker).
 */
export function nextUnlock(ctx: UnlockCtx): Teaser | null {
  let best: Teaser | null = null, bestScore = -Infinity;
  for (const def of COSMETICS) {
    if (def.req.kind === 'default') continue;
    const s = unlockStatus(def, ctx);
    if (s.unlocked) continue;
    let score = s.frac;
    if (s.affordable) score = 2;
    else if (s.purchasable) score = s.frac * 0.9 - 0.05;
    else if (def.req.kind === 'medal' && s.frac === 0) score = -1; // no progress to show
    if (score > bestScore) {
      bestScore = score;
      best = { def, status: s, text: s.affordable ? tMeta('unlock.teaserReady', { item: cosmeticLabel(def), need: s.need }) : tMeta('unlock.teaser', { need: s.need, item: cosmeticLabel(def) }) };
    }
  }
  return best;
}
