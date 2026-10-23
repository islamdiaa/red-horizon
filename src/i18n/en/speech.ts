/**
 * What the game says aloud: the announcer's lines and the units' acknowledgements (speech synthesis,
 * src/audio/speech.ts). The code keeps the English; when the browser has a voice for the interface language the
 * translated line is spoken with it, otherwise the English is (src/audio/speech.ts chooses). The announcer's
 * captions (subtitles, event log) are translated either way, matching the English with trSource()
 * (src/ui/a11y-subtitles.ts, src/ui/toasts.ts). Announcer keys are the announcer ids (src/audio/types.ts
 * AnnouncerKey). Translate for the ear: short and punchy, like an RTS announcer and radio chatter.
 */
import { sourceStrings, strings } from '../core';
import type { AnnouncerKey } from '../../audio/types';

const announcer: Record<AnnouncerKey, string> = {
  mission_start: 'Battle control online.',
  building: 'Building.',
  construction_complete: 'Construction complete.',
  unit_ready: 'Unit ready.',
  training: 'Training.',
  // production paused
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
  mad_tank_deployed: 'M.A.D. Tank deployed.',
  chrono_tank_charged: 'Chrono tank charged.',
  ceasefire_warning: 'Warning. Enemy forces are mobilising.',
  ceasefire_over: 'The ceasefire is over.',
  armour_neutralised: 'Enemy armour neutralised.',
  base_heavy_attack: 'Our base is under heavy attack!',
  sector_victorious: 'Our forces are victorious in the sector.',
  enemy_base_destroyed: 'Enemy base destroyed.',
  superweapon_online: 'Superweapon online.',
  heavy_armour_ready: 'Heavy armour ready for deployment.',
};

/** The announcer's English lines by id (spoken, translated where a voice allows; captions use trSource). */
export const ANNOUNCER_TEXT: Record<AnnouncerKey, string> = sourceStrings('speech', { announcer }).announcer;

/**
 * Units' spoken acknowledgements when selected ("select"), ordered to move ("move") or to attack ("attack");
 * src/audio/speech.ts RESPONSE_LINES says which unit uses which line. Spoken only (no captions). A line used by
 * several units appears once (a comment in brackets lists them): keep its translation neutral for all of them
 * (first person singular, no gendered past tense). Tanya is a woman; every other voice is a man.
 */
const unit = {
  // infantry (riflemen, rocket soldiers, grenadiers, flamethrowers: Allied and Soviet)
  yesSir: 'Yes sir!',
  reporting: 'Reporting.',
  // (infantry and vehicle crews)
  awaitingOrders: 'Awaiting orders.',
  ready: 'Ready.',
  acknowledged: 'Acknowledged.',
  // (infantry and the Soviet shock trooper)
  movingOut: 'Moving out.',
  // (infantry and vehicle crews)
  affirmative: 'Affirmative.',
  // (infantry, engineer, medic, mechanic)
  onMyWay: 'On my way.',
  // infantry, ordered to attack
  engaging: 'Engaging!',
  openFire: 'Open fire!',
  targetAcquired: 'Target acquired.',
  attacking: 'Attacking.',
  // tank and vehicle crews (radio)
  vehicleReporting: 'Vehicle reporting.',
  standingBy: 'Standing by.',
  rollingOut: 'Rolling out.',
  // (vehicle crews, Tanya, engineer, medic, mechanic)
  moving: 'Moving.',
  underWay: 'Under way.',
  // vehicle crews, ordered to attack
  firing: 'Firing.',
  engagingTarget: 'Engaging target.',
  targetLocked: 'Target locked.',
  // Tanya (the Allied commando, a woman: cocky)
  talkToMe: 'Talk to me.',
  whatsTheJob: "What's the job?",
  readyWhenYouAre: 'Ready when you are.',
  onIt: 'On it.',
  leaveItToMe: 'Leave it to me.',
  // Tanya, attacking
  lightsOut: 'Lights out!',
  tooEasy: 'Too easy!',
  watchThis: 'Watch this!',
  // engineer (captures and repairs buildings)
  engineerReady: 'Engineer ready.',
  // (engineer and mechanic)
  toolsReady: 'Tools ready.',
  // engineer, ordered onto a building to capture it
  illTakeIt: "I'll take it.",
  securingIt: 'Securing it.',
  rightAway: 'Right away.',
  // medic (heals infantry)
  medicHere: 'Medic here.',
  whosHurt: "Who's hurt?",
  holdStill: 'Hold still.',
  patchingYouUp: 'Patching you up.',
  // ore truck driver (radio)
  harvesterReady: 'Harvester ready.',
  oreTruckStandingBy: 'Ore truck standing by.',
  headingOut: 'Heading out.',
  movingToOreField: 'Moving to ore field.',
  harvesting: 'Harvesting.',
  collectingOre: 'Collecting ore.',
  // pilots (radio)
  pilotStandingBy: 'Pilot standing by.',
  airborne: 'Airborne.',
  inbound: 'Inbound.',
  changingCourse: 'Changing course.',
  roger: 'Roger.',
  attackRun: 'Attack run.',
  weaponsHot: 'Weapons hot.',
  targetInSight: 'Target in sight.',
  // ships' captains (radio)
  bridgeHere: 'Bridge here.',
  captainOnDeck: 'Captain on deck.',
  shipReady: 'Ship ready.',
  settingCourse: 'Setting course.',
  fullAhead: 'Full ahead.',
  ayeCommander: 'Aye, Commander.',
  helmAnswering: 'Helm answering.',
  allGunsFire: 'All guns, fire!',
  targetBearingLocked: 'Target bearing locked.',
  // a ship, ordered to attack (calm, unlike the infantry's "Engaging!")
  engagingCalm: 'Engaging.',
  // mechanic (repairs vehicles)
  mechanicHere: 'Mechanic here.',
  whatNeedsFixing: 'What needs fixing?',
  rightThere: 'Right there.',
  iCanFixThat: 'I can fix that.',
  // "her": the vehicle
  patchingHerUp: 'Patching her up.',
  goodAsNewSoon: 'Good as new soon.',
  // Soviet shock trooper (carries a Tesla coil: electric puns welcome)
  fullyCharged: 'Fully charged!',
  shockTrooperReady: 'Shock trooper ready.',
  powerIsOn: 'Power is on.',
  chargingForward: 'Charging forward.',
  yesComrade: 'Yes, Comrade.',
  lightningStrikes: 'Lightning strikes!',
  feelTheCurrent: 'Feel the current!',
  discharge: 'Discharge!',
  // spy (smooth, discreet)
  yes: 'Yes?',
  discreetly: 'Discreetly.',
  atYourService: 'At your service.',
  quietlyNow: 'Quietly now.',
  ofCourse: 'Of course.',
  leaveItWithMe: 'Leave it with me.',
  consider: 'Consider it done.',
  nobodyWillNotice: 'Nobody will notice.',
  withPleasure: 'With pleasure.',
};

/** The units' English acknowledgements by id (src/audio/speech.ts RESPONSE_LINES picks them per unit voice). */
export const UNIT_LINES: Readonly<typeof unit> = sourceStrings('speech', { unit }).unit;

export default strings('speech', {
  // a caption as read out by screen readers: "Announcer: Unit ready."
  srLine: '{speaker}: {text}',
});
