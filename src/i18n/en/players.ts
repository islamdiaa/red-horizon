/**
 * Built-in player names: the AI commanders' names and the default human names. The game and the network use the
 * English (it is part of the match setup, saved and sent to other players); the interface shows playerName(),
 * which translates these and leaves every name a player chose unchanged.
 */
import { sourceStrings, trSource } from '../core';

/** The AI commanders of skirmish, multiplayer and special operations (rank abbreviation and name). */
export const AI_COMMANDERS = sourceStrings('players.ai', {
  volkov: 'Gen. Volkov',
  krukov: 'Marshal Krukov',
  nadia: 'Col. Nadia',
  stavros: 'Gen. Stavros',
  // Cdr. = Commander (a naval rank)
  bennett: 'Cdr. Bennett',
  kane: 'Maj. Kane',
  // the AI allies of co-op Survival (src/missions/special.ts)
  hartmann: 'Gen. Hartmann',
  dubois: 'Col. Dubois',
});

export const DEFAULT_NAMES = sourceStrings('players.default', {
  // the player's default name (profile, skirmish, multiplayer)
  commander: 'Commander',
  // the Allied side in the main menu's background battle
  alliedCommand: 'Allied Command',
});

/** A player's name for display: a built-in name in the interface language, a chosen name as it is. */
export const playerName = (name: string): string => trSource(name);
