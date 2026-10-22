/**
 * Custom missions made in the editor (src/editor/mission.ts, store.ts): small enough to load with the game,
 * which runs them, and with the campaign screen and share links, which list and import them.
 *
 *  - CM: English the mission runtime emits (lockstep, saved): translated where it is shown (trSource).
 *  - DEFAULTS: what the editor fills in for a new mission. The editor writes them in the author's language
 *    (tx('editorMission.defaults.…')); registered as source English too, so a mission an English author left at the
 *    defaults still reads translated for everyone else.
 *  - tEdFile: why a map file could not be imported.
 */
import { sourceStrings, strings, tx, type Leaves, type Params } from '../core';

export const CM = sourceStrings('editorMission.run', {
  // objective progress: enemy units and structures still standing
  left: '{n} left',
  holdOut: 'Hold out',
  failed: 'Mission failed',
  objectiveFailed: 'Objective failed: {text}',
  title: 'Custom Operation',
  codename: 'CUSTOM',
  // a custom mission's location line: "Custom map · Twin Rivers"
  location: 'Custom map · {map}',
  noBriefing: 'No briefing.',
});

export const DEFAULTS = sourceStrings('editorMission.defaults', {
  human: 'Commander',
  enemy: 'Gen. Volkov',
  // a new player in the mission's player list
  player: 'Player {n}',
  // a new mission's title, after the map's name
  title: 'Operation {map}',
  codename: 'NIGHTFALL',
  briefing1: 'Commander, enemy forces have dug in across the valley.',
  briefing2: 'Establish a base and destroy them.',
  objective: {
    destroyAll: 'Destroy all enemy forces',
    destroy: 'Destroy the target',
    survive: 'Hold out until help arrives',
    reach: 'Reach the extraction point',
    protect: 'Keep the convoy alive',
    build: 'Build a base',
  },
  message: 'Enemy reinforcements detected.',
});

/** A default in the active language: the editor writes these for the author. */
export const tDefault = (key: Leaves<typeof DEFAULTS>, params?: Params): string => tx(`editorMission.defaults.${key}`, params);

/** English for the simulation and saved files: placeholders filled in as plain text (never the interface language's number format). */
export const english = (template: string, params: Record<string, string | number>): string => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));

export const tEdFile = strings('editorFile', {
  invalidJson: 'Not a map file (invalid JSON).',
  notMap: 'Not a map file.',
  tooLarge: 'File too large for a map (4 MB max).',
  tooComplex: 'This file is too complex to be a map.',
  format: 'Unknown file format "{format}" (expected a .rhmap.json map).',
  newer: 'This map file is newer than this version of the game reads (file version {v}, this game reads {max}). Update the game to open it.',
  // {field} is the name of the broken part of the file ("size", "features[3]")
  badMap: 'The map in this file is damaged ({field}).',
  badMission: 'The mission in this file is damaged ({field}).',
});
