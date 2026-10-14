/** Sound effect keys. Weapon `report` values in data/rules.ts map directly onto these. */
export type SfxKey =
  // weapons
  | 'pistol' | 'rifle' | 'mg' | 'cannon_small' | 'cannon_med' | 'cannon_heavy' | 'rocket' | 'grenade'
  | 'flame' | 'artillery' | 'missile_launch' | 'tesla_zap' | 'tesla_charge' | 'dog_attack' | 'dog_bark'
  | 'heal' | 'flak' | 'nuke_launch'
  // explosions (match ExplosionKind with the expl_ prefix)
  | 'expl_piff' | 'expl_small' | 'expl_medium' | 'expl_large' | 'expl_huge' | 'expl_fire' | 'expl_electric'
  | 'expl_nuke' | 'expl_building'
  // deaths
  | 'inf_die' | 'inf_scream' | 'inf_burn' | 'inf_electro' | 'crush' | 'vehicle_die'
  // base & economy
  | 'build_place' | 'build_rise' | 'sell' | 'repair' | 'cash_tick' | 'harvest' | 'ore_dump' | 'door'
  | 'deploy' | 'power_down' | 'radar_on' | 'chrono' | 'iron_curtain' | 'crate'
  // ui
  | 'click' | 'hover' | 'error' | 'tab' | 'ready_ping';

export type AnnouncerKey =
  | 'mission_start' | 'building' | 'construction_complete' | 'unit_ready' | 'training' | 'on_hold'
  | 'cancelled' | 'insufficient_funds' | 'low_power' | 'new_options' | 'cannot_deploy' | 'cannot_build_here'
  | 'base_under_attack' | 'harvester_under_attack' | 'unit_lost' | 'structure_lost' | 'structure_sold'
  | 'repairing' | 'silos_needed' | 'select_target' | 'radar_online' | 'radar_offline'
  | 'mission_accomplished' | 'mission_failed' | 'nuke_ready' | 'nuke_launched' | 'nuke_warning'
  | 'iron_curtain_ready' | 'chrono_ready' | 'building_captured' | 'reinforcements' | 'primary_selected'
  | 'enemy_destroyed';

export type VoiceKind = 'infantry' | 'vehicle' | 'dog' | 'tanya' | 'engineer' | 'medic' | 'harvester' | 'aircraft';
export type ResponseKind = 'select' | 'move' | 'attack';

export interface AudioVolumes {
  master: number;
  sfx: number;
  music: number;
  voice: number;
}

/** Public surface of the audio system (implemented in ./index.ts as `class AudioSystem`). */
export interface AudioApi {
  /** Must be called from a user gesture; resolves when the AudioContext is running. */
  unlock(): Promise<void>;
  /** Play a one-shot sound. `pos` is in map cells; omit for UI (non-positional) sounds. */
  play(key: SfxKey, pos?: { x: number; y: number }, opts?: { volume?: number; pitch?: number }): void;
  /** Listener = camera focus point in map cells, `viewRadius` = half the visible width in cells. */
  setListener(x: number, y: number, viewRadius: number): void;
  /** EVA-style announcer (throttled & de-duplicated). */
  announce(key: AnnouncerKey): void;
  /** Called with the subtitle text whenever an announcement plays. */
  onAnnounce?: (text: string, key: AnnouncerKey) => void;
  /** Unit acknowledgement voice. */
  unitResponse(kind: ResponseKind, voice: VoiceKind): void;
  startMusic(): void;
  stopMusic(): void;
  /** 0 = calm / building, 1 = full battle. Music crossfades accordingly. */
  setMusicIntensity(v: number): void;
  setVolumes(v: Partial<AudioVolumes>): void;
  getVolumes(): AudioVolumes;
  update(dt: number): void;
}
