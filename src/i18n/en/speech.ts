/**
 * The announcer's lines. They are SPOKEN in English (speech synthesis, src/audio/speech.ts re-exports the table)
 * and only their captions are translated: the subtitles and the event log match the English with trSource()
 * (src/ui/a11y-subtitles.ts, src/ui/toasts.ts). Keys are the announcer ids (src/audio/types.ts AnnouncerKey).
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

/** The announcer's English lines by id (what is spoken; captions translate them with trSource). */
export const ANNOUNCER_TEXT: Record<AnnouncerKey, string> = sourceStrings('speech', { announcer }).announcer;

export default strings('speech', {
  // a caption as read out by screen readers: "Announcer: Unit ready."
  srLine: '{speaker}: {text}',
});
