/**
 * The campaign screen (theatre map, mission select, briefing) and the mission debrief (src/ui/campaign.ts).
 * Mission titles, locations and dates are game data (tools/i18n/data-sources.ts, table "mission"); the campaign
 * briefings and radio stay English for now. The radio cast is in campaign-cast.ts.
 */
import { strings } from '../core';

export { CAST, SIM } from './campaign-cast';

export default strings('campaign', {
  head: {
    allies: 'ALLIED CAMPAIGN',
    alliesName: 'Operation Dawnbreak',
    soviet: 'SOVIET CAMPAIGN',
    sovietName: 'Operation Red Horizon',
    special: 'SPECIAL OPERATIONS',
    specialName: 'Off the Record',
    // under "3 / 7" (missions completed): stars earned of the maximum
    progress: 'MISSIONS · {stars} / {max} STARS',
  },
  tab: {
    // the special operations tab (next to Allies and Soviets)
    special: 'Special',
  },
  map: {
    theatre: 'THEATRE: EUROPE · 1953',
    allied: 'ALLIED',
    soviet: 'SOVIET',
    front: 'FRONT',
    noSpecials: 'No special operations yet.',
    // best score of a survival / challenge mission
    best: 'BEST {score}',
  },
  brief: {
    select: 'Select a mission.',
    special: 'SPECIAL OPERATION',
    custom: 'CUSTOM MISSION',
    mission: 'MISSION {n} OF {total}',
    // {kind}: "MISSION 3 OF 7", "SPECIAL OPERATION"...
    kick: '{kind} · BRIEFING',
    operation: 'OPERATION {name}',
    // par time for the speed star
    par: 'PAR {time}',
    skip: 'Click to skip',
    // the stamp on the briefing: {stamp} is "EYES ONLY" or its Soviet counterpart
    stamp: 'TOP SECRET // {stamp} // {codename}',
    eyesOnly: 'EYES ONLY',
    // Russian "top secret" (transliterated on purpose in English)
    sovietSecret: 'SOVERSHENNO SEKRETNO',
    tips: 'FIELD NOTES',
    tech: 'NEW EQUIPMENT',
    bestTime: 'BEST {time}',
    bestScore: 'BEST SCORE {score}',
    notAttempted: 'NOT YET ATTEMPTED',
    deploy: 'Deploy',
  },
  // the briefing officer's position, under their name
  role: {
    rourke: 'Allied Command, Europe',
    brandt: 'Allied Intelligence',
    kestrel: 'Special Operations',
    saarinen: 'Project Looking Glass',
    hollander: 'Allied Air Transport',
    morozov: 'Commander, Western Front',
    orlova: 'Political Directorate',
    belinsky: 'Horizon Directorate',
    gromova: 'Raider Section, Guards Division',
    eva: 'Tactical Network',
  },
  // closing radio line when a mission has none of its own
  debriefLine: {
    alliesWin: 'Well done, Commander. Rest your people; there is more work tomorrow.',
    alliesLose: 'We will regroup and try again, Commander.',
    sovietWin: 'The Motherland is pleased, Comrade.',
    sovietLose: 'Regroup, Comrade. History is patient, but I am not.',
    specialWin: 'Operation complete. Results logged.',
    specialLose: 'Operation terminated. Results logged.',
  },
  debrief: {
    special: 'SPECIAL OPERATION',
    mission: 'MISSION {n}',
    // {kind}: "MISSION 3" or "SPECIAL OPERATION"
    kick: '{kind} · OPERATION {codename}',
    won: 'MISSION ACCOMPLISHED',
    lost: 'MISSION FAILED',
    // the three stars
    starComplete: 'Mission complete',
    starPar: 'Under par {time}',
    starSpeed: 'Speed',
    starOptional: 'All optional objectives',
    starClean: 'Clean sweep',
    time: 'TIME',
    par: 'PAR {time}',
    // time left below / above the par time
    under: '{time} UNDER',
    over: '{time} OVER',
    // marker on the par bar
    parMark: 'PAR',
    result: 'RESULT',
    victory: 'VICTORY',
    defeat: 'DEFEAT',
    score: 'SCORE',
    stars: 'STARS',
    starsOf: '{n} / 3',
    objectives: 'OBJECTIVES',
    noObjectives: 'No objective record.',
    primary: 'PRIMARY',
    optional: 'OPTIONAL',
    mainMenu: 'Main menu',
    replay: 'Replay',
    retry: 'Retry',
    next: 'Next mission',
  },
});
