/**
 * Quick Battle: one click into a well-tuned random skirmish. DOM-free: the roll is a pure function of a
 * seed and the commander's record, so the menu, the tests and "play again with the same setup" agree.
 *
 * Rolled: a good map (a curated two-player map or a generated battlefield with balanced parameters), climate, time
 * of day, the opponent (a rival, chosen by the menu, or an AI personality) at the commander's skill level,
 * Commander rules with battlefield events, and one or two Quick-Battle-friendly mutators (exactly one, from the
 * newcomer-safe pool, on Recruit and Easy, where dynamic difficulty is on too).
 */
import { Rng } from '../core/rng';
import type { Faction } from '../data/rules';
import type { GameSetup, OpponentSetup } from '../game';
import { CURATED_MAPS } from '../maps';
import type { AIDifficulty } from '../sim/ai';
import { AI_DIFFICULTIES, capDifficulty, isNewcomerLevel } from './difficulty';
import { PERSONALITIES } from '../sim/ai-personality';
import { MUTATOR_BY_ID, mutateSetup, normaliseMutators, surpriseMutators } from './mutators';
import { MODES_EN, fillEn } from './text';
import { dt, trSource, tx } from '../i18n/core';
import { mutatorName, personalityName } from '../i18n/names';
import tModes from '../i18n/en/modes';
import tCommon from '../i18n/en/common';

/** What a Quick Battle rolled (GameSetup.quick: the loading card and the end screen). */
export interface QuickInfo {
  seed: number;
  /** Battlefield name ("Frozen Lakes", "Generated battlefield"). */
  map: string;
  climate: 'temperate' | 'winter' | 'desert';
  time: 'day' | 'dusk' | 'night';
  /** Opponent label: the rival's name or the personality's. */
  opponent: string;
  difficulty: AIDifficulty;
  personality?: string;
  rival?: boolean;
  mutators: string[];
}

export interface QuickStats {
  skirmishes?: number;
  gamesByDifficulty?: Partial<Record<AIDifficulty, number>>;
  winsByDifficulty?: Partial<Record<AIDifficulty, number>>;
}

/** Wins (and win rate) at a level that count as having mastered it. */
const PROMOTE_WINS = 3;
const PROMOTE_RATE = 0.6;

/**
 * The AI level that keeps a commander's matches close. A newcomer starts on Recruit and moves up one level at a
 * time: the level above the highest one they have mastered (at least three wins there, at least 60% of their games
 * at that level). Somebody who has mastered nothing yet stays on Recruit, however many games they have played (a
 * lucky win or two doesn't promote them: Quick Battle is where new players learn). A commander who masters Hard in
 * regular skirmishes goes straight to Brutal. Records from before Recruit existed (no recruit entries) work the same.
 */
export function quickSkill(st: QuickStats | null | undefined): AIDifficulty {
  if (!st || !(st.skirmishes ?? 0)) return 'recruit';
  let best = -1;
  for (let i = 0; i < AI_DIFFICULTIES.length; i++) {
    const g = st.gamesByDifficulty?.[AI_DIFFICULTIES[i]] ?? 0, w = st.winsByDifficulty?.[AI_DIFFICULTIES[i]] ?? 0;
    if (w >= PROMOTE_WINS && w / Math.max(1, g, w) >= PROMOTE_RATE) best = i;
  }
  return AI_DIFFICULTIES[Math.min(AI_DIFFICULTIES.length - 1, best + 1)];
}

/** A rival in Quick Battle never plays above the commander's skill level. */
export function quickRivalLevel(rival: AIDifficulty, skill: AIDifficulty): AIDifficulty {
  return capDifficulty(rival, skill);
}

export interface QuickOptions {
  faction: Faction;
  color: number;
  quality: GameSetup['quality'];
  skill: AIDifficulty;
  /** A rival to face (the menu resolves it into the opponent), with its display name. */
  rival?: { name: string; opponent: OpponentSetup };
  /** The commander's doctrine (already resolved for their side and rank; null = none). */
  doctrine?: string | null;
}

/** Roll a Quick Battle for a seed. */
export function rollQuickBattle(seed: number, o: QuickOptions): GameSetup {
  const rng = new Rng((seed ^ 0x51ed270b) >>> 0 || 1);
  const curated = CURATED_MAPS.filter((m) => m.players === 2 && !m.naval);
  const useCurated = curated.length > 0 && rng.chance(0.35);
  const def = useCurated ? curated[rng.int(0, curated.length - 1)] : undefined;
  const climate = def ? def.climate : rng.pick<QuickInfo['climate']>(['temperate', 'temperate', 'winter', 'desert']);
  const time = rng.pick<QuickInfo['time']>(['day', 'day', 'day', 'dusk', 'dusk', 'night']);
  const mapSeed = rng.int(1, 999_999_999);
  const foe: Faction = rng.chance(0.75) ? (o.faction === 'allies' ? 'soviet' : 'allies') : o.faction;
  const pids = Object.keys(PERSONALITIES);
  const personality = pids[rng.int(0, pids.length - 1)];
  // (Recruit and Easy: exactly one mutator, from the pool that never favours the AI over a newcomer)
  const newcomer = isNewcomerLevel(o.skill);
  const count = rng.chance(0.55) || newcomer ? 1 : 2;
  const mutators = surpriseMutators(rng.int(1, 1e9), { climate, faction: o.faction }, { count, quick: true, newcomer });
  const opponent: OpponentSetup = o.rival ? { ...o.rival.opponent, difficulty: quickRivalLevel(o.rival.opponent.difficulty, o.skill) } : { faction: foe, difficulty: o.skill, personality };
  const size = def ? def.size : rng.pick([80, 96, 96, 112]);
  const info: QuickInfo = {
    // (stored with the setup: English, translated by quickLines)
    seed, map: def ? def.name : fillEn(MODES_EN.quick.generated, { w: String(size), h: String(size) }), climate, time,
    opponent: o.rival ? o.rival.name : PERSONALITIES[personality]?.name ?? MODES_EN.quick.aiCommander,
    difficulty: opponent.difficulty, personality: o.rival ? undefined : personality, rival: !!o.rival, mutators,
  };
  const setup = mutateSetup<GameSetup>({
    faction: o.faction, color: o.color, opponents: [opponent],
    mapSize: size, water: def ? 0.5 : rng.pick([0, 0.25, 0.4, 0.5]), trees: rng.range(0.35, 0.7), ore: rng.range(0.6, 0.85),
    credits: 10000, startUnits: rng.chance(0.6) ? 'light' : 'mcv', fog: true, timeOfDay: time, quality: o.quality,
    seed: mapSeed, weather: 'auto', climate, dayCycle: true, mapId: def?.id,
    rules: 'commander', events: true, mutators, quick: info,
    dynamicDifficulty: newcomer, // (assist-only on these levels: it eases off for a struggling player, never pushes harder)
    doctrines: o.doctrine ? [o.doctrine] : undefined, // the player's doctrine (AIs choose their own)
  });
  info.time = setup.timeOfDay; // (Night Ops)
  return setup;
}

/** Short lines describing a roll (loading card), in the active language. */
export function quickLines(q: QuickInfo): { label: string; value: string }[] {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const curated = CURATED_MAPS.find((m) => m.name === q.map);
  const map = curated ? dt('map', curated.id, 'name', curated.name) : trSource(q.map);
  const pers = !q.rival && q.personality ? PERSONALITIES[q.personality] : undefined;
  const opponent = pers ? personalityName(pers) : trSource(q.opponent);
  const word = (k: string, v: string) => tx(`modes.quick.${k}.${v}`, undefined, cap(v));
  return [
    { label: tModes('quick.battlefield'), value: `${map} · ${word('climate', q.climate)} · ${word('time', q.time)}` },
    { label: tModes('quick.opponent'), value: `${opponent} · ${tx(`common.difficulty.${q.difficulty}`, undefined, cap(q.difficulty))}${q.rival ? ` · ${tModes('quick.rival')}` : ''}` },
    { label: tModes('quick.rules'), value: tModes('quick.rulesValue') },
    { label: tModes('quick.mutators'), value: normaliseMutators(q.mutators).map((id) => mutatorName(MUTATOR_BY_ID[id])).join(' · ') || tCommon('none') },
  ];
}
