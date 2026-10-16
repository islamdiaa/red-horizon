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
  // naval, air support, espionage
  | 'torpedo' | 'depth_charge' | 'naval_gun' | 'water_splash' | 'sonar_ping' | 'ship_horn' | 'plane_flyby'
  | 'bomb_whistle' | 'satellite_launch' | 'bridge_collapse' | 'infiltrate' | 'jammer'
  // Aftermath units
  | 'mad_pulse' | 'phase_shift' | 'demo_arm'
  // ui
  | 'click' | 'hover' | 'error' | 'tab' | 'ready_ping' | 'promote';

export type AnnouncerKey =
  | 'mission_start' | 'building' | 'construction_complete' | 'unit_ready' | 'training' | 'on_hold'
  | 'cancelled' | 'insufficient_funds' | 'low_power' | 'new_options' | 'cannot_deploy' | 'cannot_build_here'
  | 'base_under_attack' | 'harvester_under_attack' | 'unit_lost' | 'structure_lost' | 'structure_sold'
  | 'repairing' | 'silos_needed' | 'select_target' | 'radar_online' | 'radar_offline'
  | 'mission_accomplished' | 'mission_failed' | 'nuke_ready' | 'nuke_launched' | 'nuke_warning'
  | 'iron_curtain_ready' | 'chrono_ready' | 'building_captured' | 'reinforcements' | 'primary_selected'
  | 'enemy_destroyed' | 'unit_promoted'
  | 'gps_ready' | 'gps_launched' | 'sonar_ready' | 'spyplane_ready' | 'paratroopers_ready' | 'parabombs_ready'
  | 'building_infiltrated' | 'credits_stolen' | 'sub_detected' | 'bridge_destroyed' | 'bridge_repaired'
  | 'enemy_aircraft' | 'naval_unit_lost'
  | 'radar_jammed' | 'mine_detected' | 'paratroopers_inbound' | 'spy_detected' | 'mines_laid'
  | 'mad_tank_deployed' | 'chrono_tank_charged'
  | 'ceasefire_warning' | 'ceasefire_over';

export type VoiceKind = 'infantry' | 'vehicle' | 'dog' | 'tanya' | 'engineer' | 'medic' | 'harvester' | 'aircraft' | 'naval' | 'spy' | 'mechanic' | 'shock';
export type ResponseKind = 'select' | 'move' | 'attack';

export interface AudioVolumes {
  master: number;
  sfx: number;
  music: number;
  voice: number;
  /** Environmental ambience beds, weather and thunder (default 0.7). */
  ambience: number;
}

export type WeatherKind = 'clear' | 'rain' | 'storm' | 'snow' | 'fog' | 'dust';

/** Inputs of the living soundscape; see AudioApi.setAmbience. All numbers are 0..1. */
export interface AmbienceState {
  /** 0 = full day, 1 = deep night (continuous; dusk ≈ 0.5). */
  night: number;
  weather: WeatherKind;
  /** Weather strength (ramp it 0→1 / 1→0 during transitions). */
  intensity: number;
  wind: number;
  /** How much water is near the camera focus. */
  water: number;
  /** How much forest is near the camera focus. */
  forest: number;
  /** Combat intensity on screen. */
  battle: number;
  /** Combat happening off-screen (distant rumble). */
  offscreenBattle: number;
  /** Camera height: 0 = closest, 1 = max zoom-out (detail thins, wind takes over). */
  zoom: number;
}

export type StingerKind = 'victory' | 'defeat' | 'superweapon_ready' | 'promotion' | 'reinforcements' | 'mission_start' | 'enemy_spotted';

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
  /**
   * Living soundscape state; call ~10×/s. Everything cross-fades smoothly (weather ≈ 2 s, day/night ≈ 1.5 s,
   * camera-dependent values faster). Missing fields keep their previous value.
   */
  setAmbience?(a: Partial<AmbienceState>): void;
  /**
   * Thunder: crack + long rolling rumble. `distanceCells` 0 = overhead … ≥ 48 = far (low-passed, no crack).
   * The caller delays the call after the lightning flash (≈ distanceCells × 0.03 s feels right).
   * `pan` −1..1 is optional (random-ish when omitted).
   */
  thunder?(distanceCells: number, intensity: number, pan?: number): void;
  /** Short musical phrase in the current music key, aligned to the beat; ducks the score while it plays. */
  stinger?(kind: StingerKind): void;
  /** Fade the soundscape out (e.g. back to the menu); the next setAmbience() fades it back in. */
  stopAmbience?(): void;
}
