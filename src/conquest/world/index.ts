/**
 * World Conquest: a Risk-style world campaign (start from any homeland and conquer the world). The strategic layer:
 *
 *   run.ts        the public API: newWorldRun, legal actions, placing, cards, attacks, fortify, turns (+ re-exports)
 *   state.ts      the WorldRun JSON and shared helpers · rules.ts the rules · dice.ts / odds.ts Risk dice and odds
 *   powers.ts     the rival AI · diplomacy.ts ceasefires · resolve.ts the RTS route (BattleSpec.world)
 *   atlas.ts      the geography a run is built from (GEO's regions, or stub-geo.ts) · score.ts · link.ts · storage.ts
 * Types shared with the geography, battlefields and screens: types.ts.
 */
export * from './run';
export { worldScore, endMedals, shareLine, DIFFICULTY_MULT, PAR_TURNS } from './score';
export { encodeWorldLink, decodeWorldLink, isoWeek, weekKey, weeklySeed, weeklyWorld, daysFromCivil } from './link';
export * from './storage';
export { blitzOdds, winChance, rollOdds, rollDistribution, compare } from './dice';
