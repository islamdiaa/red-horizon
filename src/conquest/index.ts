/**
 * Conquest: a roguelite campaign across a procedurally drawn Europe (1953).
 *
 *   generate.ts  a seed -> territories, borders, sea lanes, owners, fronts, starting kit
 *   run.ts       turn logic: battles, results, enemy phase, income, research, perks, score
 *   battle.ts    BattleSpec -> MissionDef (MissionRuntime) and the battle outcome
 *   events.ts    random events between turns
 *   storage.ts   localStorage: the run, meta progression (renown, titles, unlocks) and profile XP
 *   geo.ts       Europe outline, region pool, the territory mesh
 *   data.ts      perks, doctrines, research, commanders, personalities
 * The UI lives in src/ui/conquest.ts.
 */
export * from './state';
export * from './data';
export { generateRun, type NewRunOptions } from './generate';
export * from './run';
export { EVENTS, EVENT_BY_ID, rollEvent, chooseEvent, type EventDef, type EventChoice } from './events';
export * from './battle';
export * from './storage';
