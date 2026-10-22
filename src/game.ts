import * as THREE from 'three';
import { GAME_SPEEDS, TEAM_COLORS } from './config';
import { BUILDINGS, UNITS, type Faction } from './data/rules';
import { generateMap } from './sim/mapgen';
import { World, type PlayerSetup } from './sim/world';
import { DT, type Command, type GameEvent } from './sim/types';
import type { AIDifficulty } from './sim/ai';
import { Building, Unit } from './sim/entities';
import { GameRenderer, type Quality, type TimeOfDay } from './render/renderer';
import { Effects } from './render/effects';
import { JuiceDirector } from './render/effects/juice'; // game-feel director
import { EntityRenderer } from './render/entities';
import { Overlay } from './render/overlay';
import { PlacementGhost } from './render/placement';
import { renderThumbnails } from './render/thumbnails';
import { createModel, createProjectileModel, listModelIds, prewarmModels } from './render/models';
import { infantryVatMode, probeInfantryGpu } from './render/models/infantry-hd';
import { setModelDetail } from './render/models/builder';
import { hdModelsEnabled, hdReleaseAll, hdReleaseUploaded, hdRestoreTextures, hdStatus, hdTextures, onHdReady, setHdModels } from './render/models/hd'; // baked HD models
import { registerDiagnostics } from './ui/a11y-diagnostics'; // battle status for bug reports
import { hdModelsWanted, loadSettings } from './ui/settings';
import { releaseGpuResources } from './render/gpuregistry';
import { ShipWakes, type WakeShip } from './render/wakes';
import { GapField, type GapSource } from './render/gapfield';
import { BridgeRenderer } from './render/bridges';
import { WATER_LEVEL } from './sim/map';
import { LightPools } from './render/lightpools';
import { CrateRenderer } from './render/crates';
import { TrackMarks } from './render/tracks';
import { Rubble } from './render/rubble';
import { AmbientLife } from './render/ambientlife';
import { BaseDressing } from './render/props'; // base dressing
import { WallRenderer } from './render/walls';
import { TargetReticle } from './render/reticle';
import { randomWeatherSequence, type WeatherKind, type WeatherStep } from './render/weather';
import type { EmitterHandle } from './render/effects/types';
import { Hud } from './ui/hud';
import { InputController } from './ui/input';
import { Hints } from './ui/hints';
import type { AudioSystem } from './audio';
import type { SfxKey } from './audio/types';
import type { SuperKind } from './sim/superweapons';
import { setupScenario } from './debug';
import { playIntro, nukeCinematic, nukeWarning, endingCinematic } from './cinematic';
import { getMission } from './missions';
import { MissionRuntime, type MissionDef } from './sim/mission';
import type { MissionLevel } from './sim/handicap'; // CAMP: campaign difficulty
import { missionLevelFor, recordResult } from './missions/progress';
import { MissionHud } from './ui/missionhud';
import { SAVE_VERSION, deserializeWorld, serializeWorld, writeSave, type SaveData } from './sim/save';
import { SIM_VERSION } from './sim/version';
import { recalcPlayerEconomy } from './sim/production';
import { ceasefireForSetup } from './sim/ceasefire';
import { guardFrame } from './platform/errors';
import { watchContextLoss, type ContextWatch } from './platform/webgl';
import { MetaTracker, showAchievementToast, showXpSummary } from './meta';
import type { MatchSummary } from './meta';
import { BattleReport } from './meta/report'; // battle report sampler (not sim state)
import { applyMatchCosmetics, playVictoryFanfare } from './meta/cosmetics'; // HUD theme, announcer, fanfare (presentation only)
import { applyMatchPaint, clearMatchCosmetics } from './meta/paint'; // paint scheme
import { loadCuratedMap } from './maps'; // curated skirmish maps
import { ReplayRecorder } from './replay/recorder'; // replays
import { buildMap, type MapDef } from './maps'; // custom maps from the editor
import { customMissionDef, type CustomMissionSetup } from './editor/mission'; // custom missions
import { applyModSet } from './mods/engine'; // mods
import { mutateSetup, varietyOptions, withEconFlag, withMutatorMods } from './modes/mutators';
import type { QuickInfo } from './modes/quickbattle';
import type { ModSet } from './mods/format';
import type { PlaybackOptions } from './replay/format';
import type { Personality } from './sim/ai-personality';
import type { RivalRef } from './meta/rivals';
import { attachRivals } from './ui/rivals'; // rivals radio
import { clearSubtitles, showSubtitle } from './ui/a11y-subtitles'; // announcer captions
import { attachCommanderPanel, commanderVisual } from './ui/commander'; // commander powers panel + visuals
import { applyRoster, attachModeRuntime, isWhatIf, prepareModeSetup, startModes } from './modes/runtime';
import type { AllySetup, BranchInfo, ChallengeDef } from './modes/types';
import { conquestMission, type ConquestSetup } from './conquest/battle'; // conquest battles
import { applyNetRoster, type NetSetup } from './net/roster'; // multiplayer roster
import { hookRecordedDrops } from './net/takeover';
import tHud, { trSource } from './i18n/en/hud'; // interface strings
import { playerName } from './i18n/en/players'; // built-in commander names, translated
import { arrangeStarts } from './sim/starts';
import type { NetLink } from './net/types';
const _viewProbe = new THREE.Vector3(); // scratch for Game.inView

/** Hull lengths (cells) for wake sizes. */
const SHIP_LENGTH: Record<string, number> = { pt: 0.9, dd: 1.5, ca: 2.35, lst: 1.4, ss: 1.3 };

/** Progression tracker shared by every match (XP, ranks, medals, records). Unlocks pop as toasts. */
export const meta = new MetaTracker();
meta.onUnlock = (a) => showAchievementToast(a);

export interface OpponentSetup {
  faction: Faction | 'random';
  difficulty: AIDifficulty;
  /** Commander personality (id or full trait object, src/sim/ai-personality.ts); default = balanced. */
  personality?: string | Personality;
  /** A persistent rival (src/meta/rivals.ts): name, portrait and the counter-plan chosen before the match. */
  rival?: RivalRef;
  /** On the player's team (skirmish 2 vs 2 with an AI ally, src/ui/menu.ts); default: an opponent. */
  ally?: boolean;
}

export interface GameSetup {
  faction: Faction;
  color: number;
  opponents: OpponentSetup[];
  mapSize: number;
  water: number;
  trees: number;
  ore: number;
  credits: number;
  startUnits: 'mcv' | 'light' | 'heavy';
  fog: boolean;
  timeOfDay: TimeOfDay;
  quality: Quality;
  seed: number;
  demo?: boolean;
  /** Real-time day/night cycle (time of day advances during the match). */
  dayCycle?: boolean;
  /** Weather: 'auto' cycles naturally, or a fixed kind. */
  weather?: string;
  /** Climate for automatic weather: temperate | winter | desert. */
  climate?: string;
  /** Play the opening cinematic (default true). */
  intro?: boolean;
  /** Mission id (campaign / survival / challenge); overrides map and players. */
  mission?: string;
  /** CAMP: campaign difficulty for a fresh mission start (default: the player's pick for missions that take one; sim/handicap.ts). */
  missionLevel?: MissionLevel;
  /** Resume from a saved game. */
  load?: SaveData;
  /** Curated skirmish map id (src/maps); used instead of the generated map. */
  mapId?: string;
  /** Watch a recorded match (src/replay): the human player's orders come from the recording. */
  replay?: PlaybackOptions;
  /** Custom map content (editor): built instead of a curated / generated map; saves and replays carry it. */
  customMap?: MapDef;
  /** Custom mission content (editor) for `mission` = its id; the map comes from `customMap`. */
  customMission?: CustomMissionSetup;
  /** Mods (content + hash) applied to the rules before the World exists; recorded in saves and replays. */
  mods?: ModSet;
  /** Rewind & take command: a live game from a replay moment (src/modes, src/replay/branch.ts). */
  branch?: BranchInfo;
  /** A challenge attempt: start state, side, goal, time limit (src/modes/challenge.ts). */
  challenge?: ChallengeDef;
  /** King of the Hill skirmish (src/modes/koth.ts); kothMinutes = hold time to win (default 5). */
  koth?: boolean;
  kothMinutes?: number;
  /** AI teammates for co-op survival (same team, own bases). */
  allies?: AllySetup[];
  /** A Conquest battle: the run and territory it belongs to, plus the frozen battle spec its mission is built from. */
  conquest?: ConquestSetup;
  /**
   * Build-up time (sim/ceasefire.ts): minutes of ceasefire at the start (the AI builds and only defends),
   * -1 = for the whole match, 0 / undefined = off. Skirmish only (ignored by missions, KOTH, challenges, Conquest).
   */
  ceasefire?: number;
  /**
   * Skirmish rules: 'commander' = doctrines, commander powers, battlefield events,
   * neutral tech structures (the default for new skirmishes); 'classic' / undefined = pure Red Alert (missions,
   * campaigns, old saves and replays).
   */
  rules?: 'classic' | 'commander';
  /**
   * Commander economy: tech tiers, upgrades, research (src/sim/economy.ts). Made explicit when a match starts
   * (withEconFlag: fresh Commander setups true), so replays and saves record it; recordings without the field
   * predate the economy and play without it.
   */
  econ?: boolean;
  /** Mutator ids (src/modes/mutators.ts): daily modifiers and skirmish additions. */
  mutators?: string[];
  /** Battlefield events (src/sim/events.ts); Commander rules only, undefined = on. */
  events?: boolean;
  /** Dynamic difficulty: the AI's economy and aggression flex to keep the match close. */
  dynamicDifficulty?: boolean;
  /** A Quick Battle: what was rolled (loading card, end screen "play again"). */
  quick?: QuickInfo;
  /**
   * Commander rules: doctrine id per player (src/sim/doctrine.ts; index 0 = the human). null / missing =
   * none for a human, the AI's own pick (personality + seed) for an AI. Ignored under Classic rules.
   */
  doctrines?: (string | null)[];
  /** A multiplayer match (src/net): the roster, the player this client commands, drops (replays). */
  net?: NetSetup;
  /**
   * Portable math (src/net/dmath.ts): multiplayer matches and ranked runs are simulated with maths every machine
   * computes the same; recorded so replays, branches and saves reproduce (absent = the engine's maths).
   */
  dmath?: boolean;
}

export interface GameCallbacks {
  onPause(game: Game): void;
  onEnd(game: Game, won: boolean): void;
  onProgress?(frac: number, label: string): void;
}

export { TEAM_COLORS }; // (defined in config.ts: the menu uses it without loading the engine)

const AI_NAMES = ['Gen. Volkov', 'Marshal Krukov', 'Col. Nadia', 'Gen. Stavros', 'Cdr. Bennett', 'Maj. Kane'];

export class Game {
  world: World;
  gfx: GameRenderer;
  effects: Effects;
  ents: EntityRenderer;
  overlay: Overlay | null = null;
  placement: PlacementGhost;
  lightPools: LightPools | null = null;
  crates: CrateRenderer;
  tracks: TrackMarks;
  rubble: Rubble;
  life: AmbientLife;
  /** Paths, concrete aprons and props around the structures the local player can see. */
  props: BaseDressing;
  walls: WallRenderer;
  reticle: TargetReticle;
  private wxSeq: WeatherStep[] | null = null;
  private autosaveT = 120;
  private nukeWarn: { update(s: number): void; remove(): void } | null = null;
  private nukeWatched = new Set<number>();
  private endCine: (() => void) | null = null;
  private nukeCine: (() => void) | null = null;
  // content renderers: ship wakes, gap-generator shroud domes, bridges
  private wakes!: ShipWakes;
  private gapField!: GapField;
  bridges!: BridgeRenderer;
  private wakeShips: WakeShip[] = [];
  private gapSources: GapSource[] = [];
  private ambT = 0;
  private envT = 0;
  private offHeat = 0;
  private waterFrac = 0;
  private forestFrac = 0;
  private lastSpotted = -1e9;
  private spottedCheckT = 0;
  private wxIdx = 0;
  private wxTimer = 0;
  private timedEmitters: { h: EmitterHandle; until: number }[] = [];
  hud: Hud | null = null;
  input: InputController | null = null;
  hints: Hints | null = null;
  private hintsTick = -10;
  missionDef: MissionDef | null = null;
  missionHud: MissionHud | null = null;
  /** Result of a finished mission (stars, time, score). */
  missionResult: { won: boolean; stars: number; time: number; score: number } | null = null;
  /** Records the local player's commands for replays (skirmish only). */
  recorder: ReplayRecorder | null = null;
  /** The multiplayer match this game runs in (src/net/game-link.ts); null in single player. */
  net: NetLink | null = null;
  /** Extra per-match UI (replay controls) torn down with the game. */
  attachments: { dispose(): void }[] = [];
  /** Battle report: army value, income, kills and losses per player every 10 s (src/meta/report.ts; not sim state). */
  report: BattleReport | null = null;
  /** This battle's progression summary (XP, contracts, unlocks) for the results screen. */
  metaSummary: MatchSummary | null = null;
  juice!: JuiceDirector;
  local;
  selection = new Set<number>();
  paused = false;
  speed = 1;
  alpha = 0;
  time = 0;
  thumbs = new Map<string, string>();
  /** In-game clock (hours) driving the day/night cycle. */
  hours = 12;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private contextWatch: ContextWatch | null = null;
  private pausedBeforeLoss = false;
  private heat = 0;
  private minimapT = 0;
  private harvestSfxT = 0;
  private endTimer = -1;
  private lastDeath: [number, number] | null = null;
  private demoCam = { angle: 0, tx: 0, ty: 0, retarget: 0 };
  /** While set, drives the camera every frame instead of the default menu drift (src/share/director.ts). */
  cameraDirector: { update(dt: number): void; dispose?(): void } | null = null;
  private canvas: HTMLCanvasElement;

  constructor(readonly setup: GameSetup, readonly audio: AudioSystem, private cb: GameCallbacks) {
    cb.onProgress?.(0.05, tHud('loading.battlefield'));
    setup = (this as { setup: GameSetup }).setup = withEconFlag(mutateSetup(prepareModeSetup(setup))); // branch / challenge moment as the load · co-op allies · mutators' conditions · the Commander economy flag (recorded with the match)
    applyModSet(withMutatorMods(setup.mods, setup.mutators)); // the match's mods (none: base rules), before anything reads the rules, plus the mutators' rule changes
    const def = setup.conquest ? conquestMission(setup.conquest) : setup.mission ? (setup.customMission && setup.customMap ? customMissionDef(setup.customMission, setup.customMap) : getMission(setup.mission)) ?? null : null; // custom missions
    this.missionDef = def;
    if (def) {
      // missions define the battlefield themselves
      const mp = def.map;
      setup = { ...setup, mapSize: mp.size, seed: mp.seed, water: mp.water ?? 0.5, trees: mp.trees ?? 0.5, ore: mp.ore ?? 0.6,
        climate: mp.climate ?? 'temperate', weather: mp.weather ?? 'clear', dayCycle: mp.dayCycle ?? true, timeOfDay: mp.timeOfDay ?? 'day',
        fog: def.fog ?? true, faction: def.players[0].faction, color: def.players[0].color ?? setup.color };
      (this as { setup: GameSetup }).setup = setup;
    }
    const nPlayers = def ? def.map.players : 1 + setup.opponents.length;
    const curated = setup.customMap ? buildMap(setup.customMap) : !def && setup.mapId ? loadCuratedMap(setup.mapId) : def?.map.mapId ? loadCuratedMap(def.map.mapId) : null; // editor map, curated skirmish map, or the curated map a mission names (Conquest battles)
    const climate = curated?.climate ?? (setup.climate === 'winter' || setup.climate === 'desert' ? setup.climate : 'temperate') as 'temperate' | 'winter' | 'desert';
    const map = curated ?? generateMap({
      size: setup.mapSize, players: nPlayers, seed: setup.seed, ore: setup.ore,
      rocks: def?.map.rocks, // mountain battlefields
      // deserts are dry, except that a sea map (water >= 0.9) becomes a desert coastline
      water: climate === 'desert' && setup.water < 0.9 ? Math.min(setup.water, 0.2) : setup.water,
      trees: climate === 'desert' ? setup.trees * 0.35 : climate === 'winter' ? Math.min(1, setup.trees * 1.2) : setup.trees,
    });
    map.climate = climate;
    const rngFaction = (i: number): Faction => ((setup.seed >> i) & 1 ? 'allies' : 'soviet');
    const usedColors = new Set([setup.color]);
    const players: PlayerSetup[] = [{ name: setup.demo ? 'Allied Command' : 'Commander', faction: setup.faction, color: setup.color, team: 0, isHuman: !setup.demo, ai: setup.demo ? 'hard' : undefined }];
    setup.opponents.forEach((o, i) => {
      const color = TEAM_COLORS.find((c) => !usedColors.has(c))!;
      usedColors.add(color);
      const faction = o.faction === 'random' ? rngFaction(i + 1) : o.faction;
      players.push({ name: o.rival?.name ?? AI_NAMES[(setup.seed + i) % AI_NAMES.length], faction, color, team: o.ally ? 0 : i + 1, isHuman: false, ai: o.difficulty, personality: o.personality }); // rivals / personalities; an AI ally shares the player's team (PLAY round 3)
    });
    if (def) {
      players.length = 0;
      def.players.forEach((ps, i) => players.push({
        name: ps.name, faction: ps.faction, color: ps.color ?? TEAM_COLORS[i], team: ps.team ?? i, isHuman: i === 0,
        ai: i === 0 ? undefined : ps.ai === 'passive' || ps.ai === 'defensive' || !ps.ai ? 'normal' : ps.ai,
        personality: i === 0 ? undefined : ps.personality, // commander personalities in missions
      }));
    }
    if (!def && setup.net) applyNetRoster(players, setup.net); // multiplayer: the match roster
    if (!def) applyRoster(players, setup); // branch / challenge: the chosen player is human, the rest AI
    // shuffle start positions so the player isn't always bottom-left
    if (!setup.demo && !def && (setup.seed & 2)) map.startPositions.reverse();
    if (!def) map.startPositions = arrangeStarts(map.startPositions, players.map((p) => p.team)); // teammates share a side (sim/starts.ts)
    this.world = new World({
      map, players, credits: def ? (def.credits ?? 5000) : setup.credits, startUnits: def ? 'none' : setup.startUnits,
      startUnitsPer: def ? def.players.map((_, i) => (i === 0 ? def.startUnits ?? 'none' : 'none')) : undefined,
      creditsPer: def ? def.players.map((ps, i) => (i === 0 ? def.credits : ps.credits ?? 5000)) : undefined,
      fog: setup.fog && !setup.demo, seed: setup.seed,
      ceasefireUntil: ceasefireForSetup(setup, !!def), // build-up time (saves restore their own below)
      ...varietyOptions(setup, !!def), // rules, mutators, battlefield events, dynamic difficulty (skirmish only)
      doctrines: def ? undefined : setup.doctrines, // (only read under Commander rules)
    });
    this.local = this.world.players[0];
    attachModeRuntime(this.world, setup, !!def); // KOTH / challenge runtime, restored by the load below
    if (setup.load) {
      deserializeWorld(this.world, setup.load.world, this.world.mission); // mode runtimes restore with the world (missions attach theirs below)
    }
    if (!def) this.local = startModes(this.world, setup); // hand the chosen player over, start fresh modes
    if (!def && setup.net && !setup.branch) { const me = this.world.players[setup.net.local]; if (me) this.local = me; if (setup.replay) hookRecordedDrops(this.world, setup.net); } // our seat; replays re-apply AI takeovers
    if (!def && !setup.demo && !setup.replay) this.recorder = new ReplayRecorder(this, setup.load?.game?.replay); // replays
    if (def) {
      const rt = new MissionRuntime(this.world, def);
      this.world.mission = rt;
      def.players.forEach((ps, i) => { if (i > 0 && ps.ai) rt.setAI(i, ps.ai); });
      if (def.allowedBuild) rt.allowBuild(def.allowedBuild);
      if (!setup.load) rt.setLevel(setup.missionLevel ?? missionLevelFor(def)); // CAMP: campaign difficulty (RA's handicaps, sim/handicap.ts) before the script's setup; a save restores its own
      if (!setup.load) def.setup(rt);
      if (setup.load) deserializeWorld(this.world, setup.load.world, rt);
      for (const p of this.world.players) { if (!setup.load) this.world.updateVisibility(p); for (const o of p.buildOptions()) p.knownOptions.add(o); } // (a save restores the fog exactly as it was: refreshing it here would change the resumed game)
    }

    applyMatchPaint(this.local.color, !setup.demo && !setup.replay); // before the first model / portrait
    applyMatchCosmetics({ teamColor: this.local.color, commanded: !setup.demo && !setup.replay, audio: this.audio });
    cb.onProgress?.(0.2, tHud('loading.armies'));
    prewarmModels();
    cb.onProgress?.(0.3, tHud('loading.terrain'));
    const old = document.getElementById('game-canvas');
    old?.remove();
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    document.body.prepend(this.canvas);
    this.gfx = new GameRenderer(this.canvas, map, { quality: setup.quality, timeOfDay: setup.timeOfDay, climate });
    probeInfantryGpu(this.gfx.renderer); // can this GPU skin the HD infantry from their half-float VAT? (before any soldier exists)
    this.contextWatch = watchContextLoss(this.canvas, {
      onLost: () => { this.pausedBeforeLoss = this.paused; this.paused = true; },
      onRestored: () => { this.gfx.restoreAfterContextLoss(); void hdRestoreTextures(); this.paused = this.pausedBeforeLoss; this.last = performance.now(); }, // re-decode the closed HD atlases
      onTimeout: () => { if (!this.setup.demo) this.save('auto'); }, // the overlay then offers a reload
    });
    this.gfx.fog.enabled = this.world.fog;
    this.effects = new Effects({ scene: this.gfx.scene, camera: this.gfx.cam.camera, renderer: this.gfx.renderer, getHeight: (x, z) => map.surfaceAt(x, z) });
    this.wakes = new ShipWakes({ waterLevel: WATER_LEVEL, effects: this.effects });
    this.gfx.scene.add(this.wakes.mesh);
    this.gapField = new GapField({ getHeight: (x, z) => map.surfaceAt(x, z) });
    this.gfx.scene.add(this.gapField.mesh);
    this.bridges = new BridgeRenderer({ heightAt: (x, y) => map.heightAt(x, y), climate: map.climate, effects: this.effects });
    this.gfx.scene.add(this.bridges.group);
    this.effects.setSunDirection?.(this.gfx.sunDir);
    if (setup.quality === 'low') this.effects.setDensity?.(0.5);
    setModelDetail(setup.quality === 'low' ? 0 : setup.quality === 'medium' ? 1 : 2); // model LOD reach / Low: light bodies + shader
    setHdModels(hdModelsWanted(loadSettings(), setup.quality), setup.quality === 'high' ? 'high' : 'medium'); // memory tier; loaded on the loading screen (main.ts) and lazily per type
    this.ents = new EntityRenderer(this.gfx.scene, this.world, this.effects, this.local, this.gfx.fog);
    this.juice = new JuiceDirector(this); this.attachments.push(this.juice); // shake, kill punches, battle music / call-outs, moments
    this.ents.deckHeight = (x, y) => this.bridges.deckHeightAt(x, y);
    this.ents.weatherUniforms = this.gfx.weather.surfaceUniforms;
    this.placement = new PlacementGhost(map);
    this.gfx.scene.add(this.placement.group);
    this.crates = new CrateRenderer(this.world, this.gfx.fog);
    this.tracks = new TrackMarks(this.world, this.gfx.fog);
    this.gfx.scene.add(this.tracks.mesh);
    // persistent craters, debris on the rendered ground, tread ruts (snow ruts after fresh snowfall)
    this.ents.destruction.setTerrain(this.gfx.terrain);
    this.tracks.setTerrain(this.gfx.terrain);
    this.tracks.setWeather(this.gfx.weather.surfaceUniforms);
    this.rubble = new Rubble(map);
    this.gfx.scene.add(this.rubble.mesh);
    this.life = new AmbientLife(map, (x, y) => this.gfx.terrain.renderHeight(x, y));
    // base dressing (render only): reads the shown structures' footprints, never sim state changes
    this.props = new BaseDressing(map, this.gfx.terrain, {
      quality: setup.quality, climate, weather: this.gfx.weather.surfaceUniforms,
      shown: (id) => this.ents.isShown(id), hideClutter: (cells) => this.gfx.vegetation.hideCells(cells),
    });
    this.gfx.scene.add(this.props.group);
    this.attachments.push(this.props);
    this.attachments.push(registerDiagnostics('Battle', () => { // "Copy diagnostics" (ui/a11y-diagnostics.ts)
      const hd = hdStatus();
      const t = this.gfx.terrain?.textureStatus();
      return {
        quality: this.setup.quality, rules: this.setup.rules ?? 'commander', mode: this.setup.replay ? 'replay' : this.net ? 'multiplayer' : this.setup.mission ? 'mission' : 'skirmish',
        map: `${this.world.map.w}x${this.world.map.h}`, players: this.world.players.length, tick: this.world.tick, units: this.world.units.length,
        hd: hd.enabled ? `${hd.tier} ${hd.loaded.length} loaded / ${hd.pending.length} pending / ${hd.failed.length} failed, ${hd.textureMB} MB` : 'off',
        terrain: t ? `${t.state} (${t.climate}, ${Math.round(t.bytes / 1048576)} MB)` : '?',
        infantry: infantryVatMode().mode, // HD infantry skinning: linear / nearest (frames step) / off (procedural)
      };
    }));
    this.walls = new WallRenderer(this.world, this.gfx.fog, this.local);
    this.gfx.scene.add(this.walls.group);
    this.reticle = new TargetReticle(map);
    this.gfx.scene.add(this.reticle.mesh);
    // weather: a natural sequence for the climate, or a fixed kind
    const wx = setup.weather ?? 'auto';
    if (wx === 'auto') {
      this.wxSeq = randomWeatherSequence(setup.seed, climate, 7200);
      const g = setup.load?.game;
      if (g) { this.wxIdx = Math.min(this.wxSeq.length - 1, g.wxIdx ?? 0); this.wxTimer = g.wxTimer ?? 0; }
      this.gfx.weather.set(this.wxSeq[this.wxIdx].kind, 0);
    } else {
      this.gfx.weather.set(wx as WeatherKind, 0);
    }
    this.gfx.weather.onLightning = (intensity, pos, cloud) => {
      const d = Math.hypot(pos.x - this.gfx.cam.x, pos.z - this.gfx.cam.y);
      const pan = Math.max(-1, Math.min(1, (pos.x - this.gfx.cam.x) / Math.max(8, this.gfx.cam.viewRadius)));
      window.setTimeout(() => this.audio.thunder(d, intensity * (cloud ? 0.6 : 1), pan), Math.min(3500, d * 30));
    };
    this.gfx.scene.add(this.life.group);
    this.gfx.scene.add(this.crates.group);
    this.lightPools = new LightPools(this.world, this.ents);
    this.gfx.scene.add(this.lightPools.mesh);
    this.hours = def?.map.hour ?? (setup.timeOfDay === 'night' ? 22.5 : setup.timeOfDay === 'dusk' ? 17.9 : 10.5);
    if (setup.load?.game) this.hours = setup.load.game.hours ?? this.hours;
    this.gfx.setTimeOfDay(this.hours);

    const start = (!def && map.startPositions[this.local.id]) || map.startPositions[0]; // MP: each player starts over their own base, not player 0's
    this.gfx.cam.jumpTo(start.x, start.y + 1);
    if (!setup.demo) {
      // cinematic drop-in from high altitude
      this.gfx.cam.dist = 48;
      this.gfx.cam.targetDist = 20;
    }
    this.gfx.fog.snap(this.local);

    if (!setup.demo) {
      cb.onProgress?.(0.55, tHud('loading.armoury'));
      const ids = [...Object.keys(BUILDINGS), ...Object.keys(UNITS)].filter((id) => {
        const t = BUILDINGS[id] ?? UNITS[id];
        return t.owner.includes(this.local.faction);
      });
      this.thumbs = renderThumbnails(ids, this.local.color, undefined, undefined, this.local.faction); // faction dressing
      // a type whose HD model arrives later (lazy loading) gets its portrait re-rendered
      const own = new Set(ids);
      const off = onHdReady((type) => {
        if (!own.has(type)) return;
        for (const [id, url] of renderThumbnails([type], this.local.color, undefined, undefined, this.local.faction)) this.thumbs.set(id, url);
      });
      this.attachments.push({ dispose: off });
      cb.onProgress?.(0.9, tHud('loading.control'));
      this.overlay = new Overlay(document.body);
      document.body.classList.toggle('faction-soviet', this.local.faction === 'soviet');
      this.hud = new Hud({
        world: this.world, local: this.local, thumbs: this.thumbs, selection: this.selection, audio: this.audio,
        issue: (c) => this.issue(c),
        beginPlacement: (t) => this.input?.beginPlacement(t),
        setMode: (m) => this.input?.setMode(m),
        getMode: () => this.input?.mode ?? 'normal',
        beginSuperweapon: (k: SuperKind) => this.input?.beginSuperweapon(k),
        select: (ids) => this.input?.select(ids),
        focusOn: (x, y) => this.gfx.cam.flyToPoint(x, y),
        minimapPoint: (x, y, b, drag) => this.minimapPoint(x, y, b, drag),
        openPauseMenu: () => this.pause(),
        setSpeed: (s) => { if (!this.net) this.speed = s; }, // (multiplayer: one pace for everybody)
        getSpeed: () => this.speed,
        keyCommand: (k, b) => this.input?.keyCommand(k, b),
        getGroups: () => this.input?.groups ?? new Map(),
        selectGroup: (g, jump) => {
          const ids = (this.input?.groups.get(g) ?? []).filter((id) => this.world.getEntity(id)?.alive);
          if (!ids.length) return;
          this.input?.select(ids);
          if (jump) this.input?.centreOn(ids); // the group's middle, not just its first member
        },
        stats: () => `${this.gfx.stats.calls} calls · ${(this.gfx.stats.tris / 1000).toFixed(0)}k tris`,
        overlay: this.overlay, // auto-group numbers and factory badges
      });
      this.hud.minimap.structures = () => this.ents.structureMarkers();
      const game = this;
      this.input = new InputController({
        world: this.world, local: this.local, gfx: this.gfx, ents: this.ents, overlay: this.overlay, placement: this.placement,
        effects: this.effects, audio: this.audio, selection: this.selection, reticle: this.reticle,
        get alpha() { return game.alpha; },
        get paused() { return game.paused; },
        issue: (c) => this.issue(c),
        message: (t, w) => this.hud?.message(t, w),
        openPauseMenu: () => this.pause(),
        stepSpeed: (dir) => {
          if (this.net) return; // multiplayer: one pace for everybody
          const i = GAME_SPEEDS.findIndex((s) => Math.abs(s - this.speed) < 0.01);
          const next = GAME_SPEEDS[Math.max(0, Math.min(GAME_SPEEDS.length - 1, (i < 0 ? 0 : i) + dir))];
          if (next !== this.speed) { this.speed = next; this.hud?.message(tHud('speed.changed', { n: next })); }
        },
      });
      this.audio.onAnnounce = (text, key) => {
        const warn = key === 'base_under_attack' || key === 'low_power' || key === 'nuke_warning' || key === 'insufficient_funds' || key === 'unit_lost' || key === 'structure_lost' || key === 'ceasefire_warning' || key === 'ceasefire_over';
        this.hud?.message(text, warn, undefined, !!this.hud && showSubtitle(text, { warn })); // captioned: the event log keeps it, no toast
      };
      this.hints = new Hints(document.getElementById('ui')!, this.world, this.local); // (missions: the battle alerts only)
      if (!this.world.mission && !setup.replay && !setup.branch && !setup.challenge) this.attachments.push(attachRivals(this)); // rival radio + habit tracking (not in replay branches / challenges)
      if (this.world.commander) this.attachments.push(attachCommanderPanel(this)); // commander powers panel (Commander rules)
      if (this.world.mission) {
        this.missionHud = new MissionHud(this.world.mission, (k) => this.audio.play(k));
      }
      // select the MCV at start
      const mcv = this.world.units.find((u) => u.owner === this.local && u.ut.deploysInto);
      if (mcv) this.selection.add(mcv.id);
      else if (!setup.load) {
        // commando / strike-force openings: hand the player their squad (they glow even on dark storm nights)
        const squad = this.world.units.filter((u) => u.owner === this.local && u.alive && u.kind !== 'aircraft' && !u.transport);
        if (squad.length && squad.length <= 24) for (const u of squad) this.selection.add(u.id);
      }
    } else {
      this.gfx.cam.dist = this.gfx.cam.targetDist = 30;
      this.demoCam.tx = map.w / 2;
      this.demoCam.ty = map.h / 2;
    }
    if (setup.load) this.restoreView(setup.load);
    if (!setup.demo && !setup.replay && !isWhatIf(setup)) { // branches / challenges are "what if" games: no progression
      meta.onGameStart({
        mode: this.missionDef ? 'mission' : 'skirmish', missionId: this.missionDef?.id,
        difficulties: this.missionDef ? undefined : setup.opponents.filter((o) => !o.ally).map((o) => o.difficulty), // (not an AI ally's)
        faction: this.local.faction, opponents: this.world.players.filter((p) => this.local.isEnemy(p)).length, seed: setup.seed,
        climate: map.climate, weather: this.wxSeq ? this.wxSeq[this.wxIdx]?.kind : setup.weather,
        rivals: this.missionDef ? 0 : setup.opponents.filter((o) => o.rival).length, // contracts: "beat a rival"
      });
    }
    if (!setup.demo && !setup.replay) this.report = new BattleReport(this.world, () => this.local, (s) => meta.onSample(s));
    if (!setup.demo) {
      // (the menu backdrop doesn't need it, and skipping it keeps "return to menu" quick)
      cb.onProgress?.(0.95, tHud('loading.shaders'));
      this.precompileShaders();
    }
    cb.onProgress?.(1, tHud('loading.ready'));
  }

  issue(cmd: Command) {
    if (this.setup.replay) return; // spectating a replay: no orders
    if (this.net) { this.net.issue(cmd); return; } // multiplayer: through the lockstep (recorded when it runs)
    this.recorder?.record(cmd); // replays
    this.world.issue(cmd);
  }

  /** Debug / test scenarios (see debug.ts). */
  applyScenario(name: string) {
    setupScenario(this.world, name);
    for (const p of this.world.players) recalcPlayerEconomy(this.world, p);
    const cells: number[] = [];
    for (const b of this.world.buildings) {
      for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) cells.push(this.world.map.idx(b.cx + dx, b.cy + dy));
    }
    this.gfx.vegetation.hideCells(cells);
    this.world.step();
    this.world.events.length = 0;
    this.gfx.fog.snap(this.local);
  }

  /** Advance the simulation quickly (testing). */
  fastForward(seconds: number) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      this.world.step();
      if (i > n - 40) this.processEvents();
      else this.world.events.length = 0;
    }
    this.gfx.fog.snap(this.local);
  }

  /** Visual counterparts of simulation sound cues (splashes, radar jamming). */
  private sfxVisual(key: string, x: number, y: number) {
    if (key === 'water_splash') this.effects.waterSplash(new THREE.Vector3(x, 0, y), 1);
    else if (key === 'jammer') this.effects.radarJamPulse(new THREE.Vector3(x, 0, y), 4);
  }

  /** Support powers: the GPS launch from the tech centre, sonar contacts lighting up across the sea. */
  private powerVisual(ev: Extract<GameEvent, { e: 'power' }>) {
    if (ev.kind === 'gps' && ev.x >= 0 && this.gfx.fog.visibilityAt(ev.x, ev.y) > 0.2) {
      this.effects.gpsLaunch(new THREE.Vector3(ev.x, this.world.map.surfaceAt(ev.x, ev.y), ev.y));
    } else if (ev.kind === 'sonar' && ev.player === this.local.id) {
      for (const u of this.world.units) {
        if (u.alive && u.ut.cloakable && this.local.isEnemy(u.owner)) this.effects.sonarPing(new THREE.Vector3(u.x, 0, u.y), 3);
      }
    }
  }

  /** Wakes behind moving ships, shroud domes over our gap generators, bridge decks (and their collapse). */
  private updateContentVisuals(fdt: number) {
    const a = this.alpha;
    let n = 0;
    for (const u of this.world.units) {
      if (!u.alive || u.kind !== 'naval' || !this.ents.isShown(u.id)) continue;
      const w = this.wakeShips[n] ?? (this.wakeShips[n] = { x: 0, y: 0, heading: 0, speed: 0, size: 1, id: 0 });
      w.id = u.id;
      w.x = u.prevX + (u.x - u.prevX) * a;
      w.y = u.prevY + (u.y - u.prevY) * a;
      w.heading = u.heading;
      w.speed = u.moving ? u.speedFrac : 0;
      w.size = (SHIP_LENGTH[u.ut.id] ?? 1.2) * (u.submerged ? 0.35 : 1);
      n++;
    }
    this.wakeShips.length = n;
    this.wakes.update(this.wakeShips, fdt);
    if (fdt > 0) this.gfx.water.driveShips(this.wakeShips); // bows push the interactive water surface
    let g = 0;
    const put = (x: number, y: number, r: number) => {
      const s = this.gapSources[g] ?? (this.gapSources[g] = { x: 0, y: 0, radius: 1 });
      s.x = x; s.y = y; s.radius = r;
      g++;
    };
    for (const b of this.world.buildings) if (b.alive && b.owner === this.local && b.bt.gapRadius && b.active && !b.owner.lowPower) put(b.x, b.y, b.bt.gapRadius);
    for (const u of this.world.units) if (u.alive && u.owner === this.local && u.ut.gapRadius && !u.transport) put(u.x, u.y, u.ut.gapRadius);
    this.gapSources.length = g;
    this.gapField.update(this.gapSources, this.time);
    this.bridges.update(this.world.bridges, fdt, this.time);
  }

  /**
   * Compile every model / effect shader during loading (in parallel where the driver supports it) so the
   * first tank, explosion or missile of a battle doesn't stall a frame. compile() traverses synchronously,
   * so the stand-in models can leave the scene straight away.
   */
  private precompileShaders() {
    const group = new THREE.Group();
    group.position.y = -60;
    const color = new THREE.Color(this.local.color);
    const models = listModelIds().flatMap((id) => { try { return [createModel(id, color)]; } catch { return []; } });
    for (const m of models) group.add(m.root);
    for (const k of ['shell', 'missile', 'scud', 'grenade', 'nuke', 'fireball', 'torpedo', 'depthcharge', 'bomb', 'satrocket'] as const) group.add(createProjectileModel(k));
    this.gfx.scene.add(group);
    try {
      const r = this.gfx.renderer;
      this.effects.prepareCompile(true); // pooled 3D effect bodies join the warm-up
      for (const t of hdTextures()) r.initTexture(t); // upload the atlases now, not on first sight
      if (r.extensions.has('KHR_parallel_shader_compile')) void r.compileAsync(this.gfx.scene, this.gfx.cam.camera).catch(() => {});
      else r.compile(this.gfx.scene, this.gfx.cam.camera); // blocking, but on the loading screen rather than mid-battle
      this.effects.prepareCompile(false);
    } catch (e) {
      console.warn('shader precompile failed', e);
    }
    this.gfx.scene.remove(group);
    for (const m of models) m.dispose();
  }

  /**
   * Compile the HD body program and upload the HD atlases loaded after the constructor's warm-up (main.ts
   * calls it once the battle's own types are loaded), so the first frame doesn't stall on them.
   */
  warmHd() {
    if (!hdModelsEnabled()) return;
    const group = new THREE.Group();
    group.position.y = -60;
    const color = new THREE.Color(this.local.color);
    const models = listModelIds().flatMap((id) => { try { const m = createModel(id, color); return (m as { hd?: boolean }).hd ? [m] : (m.dispose(), []); } catch { return []; } });
    for (const m of models) group.add(m.root);
    this.gfx.scene.add(group);
    try {
      const r = this.gfx.renderer;
      for (const t of hdTextures()) r.initTexture(t);
      if (models.length) r.compile(this.gfx.scene, this.gfx.cam.camera);
      hdReleaseUploaded(r, Infinity); // close the decoded bitmaps now that the GPU has them
    } catch (e) {
      console.warn('HD warm-up failed', e);
    }
    this.gfx.scene.remove(group);
    for (const m of models) m.dispose();
  }

  start() {
    this.running = true;
    this.last = performance.now();
    if (!this.setup.demo) {
      const begin = () => {
        this.audio.announce('mission_start');
        this.audio.stinger('mission_start');
        this.audio.startMusic();
        this.audio.setMusicIntensity(0.1);
      };
      if (this.setup.intro !== false) playIntro(this, begin);
      else begin();
    }
    // a throwing frame is reported and skipped; repeated failures stop the loop and show the crash screen
    const frame = guardFrame((now: number) => this.frame(now), {
      onFatal: () => { this.running = false; cancelAnimationFrame(this.raf); this.audio.stopAmbience(); this.audio.stopMusic(); },
    });
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    if (this.paused || this.setup.demo) return;
    if (this.net?.active) { this.input?.setMode('normal'); this.cb.onPause(this); return; } // the match goes on: the menu opens over it
    this.paused = true;
    this.input?.setMode('normal');
    this.cb.onPause(this);
  }

  resume() {
    this.paused = false;
    if (this.world.gameOver && this.speed < 1) this.speed = 1;
    this.last = performance.now();
  }

  private minimapPoint(x: number, y: number, button: number, drag: boolean) {
    if (button === 0) {
      this.gfx.cam.jumpTo(x, y);
    } else if (button === 2 && !drag) {
      const ids = [...this.selection].filter((id) => {
        const e = this.world.getEntity(id);
        return e instanceof Unit && e.alive && e.owner === this.local;
      });
      if (ids.length) {
        this.issue({ c: 'move', player: this.local.id, units: ids, x, y });
        this.effects.orderMarker(new THREE.Vector3(x, this.world.map.surfaceAt(x, y), y), 'move');
      }
    }
  }

  private frame(now: number) {
    // rAF timestamps can be older than a performance.now() taken just before (start, resume): never go negative
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    const world = this.world;
    if (this.net?.active) { // multiplayer: the lockstep paces the simulation
      this.time += dt;
      this.net.frame(dt, (fast) => { world.step(); this.report?.afterStep(); if (fast) world.events.length = 0; else this.processEvents(); }); // (fast: catching up, as fastForward)
      this.acc = this.net.alpha * DT;
    } else if (!this.paused) {
      this.time += dt;
      this.acc += dt * this.speed;
      let steps = 0;
      // up to 12 ticks a frame: x5 (100 ticks/s) still holds down to ~9 fps before time is dropped
      while (this.acc >= DT && steps < 12) {
        world.step();
        this.report?.afterStep(); // (reads this step's events before they are drained)
        this.processEvents();
        this.acc -= DT;
        steps++;
      }
      if (steps >= 12) this.acc = 0;
    }
    this.alpha = Math.min(1, this.acc / DT);
    const fdt = this.paused ? 0 : dt;

    // selection housekeeping
    for (const id of this.selection) {
      const e = world.getEntity(id);
      if (!e?.alive || (e instanceof Unit && e.transport)) this.selection.delete(id);
    }

    if (this.cameraDirector) this.cameraDirector.update(dt); // attract mode, trailer, highlight clips
    else if (this.setup.demo) this.updateDemoCamera(dt);
    this.input?.update(dt, this.time);
    this.gfx.fog.update(this.local, dt);
    this.ents.update(this.alpha, fdt, this.time, this.selection, this.input?.hovered ?? 0);
    if (this.setup.dayCycle !== false && !this.paused) {
      // a full day passes in ~18 minutes of play
      this.hours = (this.hours + (dt * this.speed) / 45) % 24;
    }
    this.gfx.setTimeOfDay(this.hours);
    this.effects.setSunDirection?.(this.gfx.sunDir);
    if (this.wxSeq && !this.paused) {
      this.wxTimer += dt * this.speed;
      const cur = this.wxSeq[this.wxIdx];
      if (cur && this.wxTimer > cur.duration && this.wxIdx + 1 < this.wxSeq.length) {
        this.wxTimer = 0;
        const next = this.wxSeq[++this.wxIdx];
        this.gfx.weather.set(next.kind, next.fade);
        meta.noteWeather(next.kind);
      }
    }
    this.effects.setWind?.(this.gfx.weather.wind.x, this.gfx.weather.wind.y);
    if (this.lightPools) {
      this.lightPools.mesh.visible = this.gfx.night > 0.05;
      if (this.lightPools.mesh.visible) this.lightPools.update(this.alpha, this.time, this.gfx.night);
    }
    this.crates.update(this.time);
    this.walls.update();
    if (!this.paused) this.tracks.update(this.alpha, this.time);
    this.life.update(fdt, this.time, this.gfx.night, this.gfx.cam.x, this.gfx.cam.y);
    this.props.update(world.buildings, this.gfx.night, dt);
    if (this.timedEmitters.length) { // (compacted in place: no per-frame array)
      let n = 0;
      for (const t of this.timedEmitters) {
        if (this.time > t.until) t.h.dispose();
        else this.timedEmitters[n++] = t;
      }
      this.timedEmitters.length = n;
    }
    for (const p of this.gfx.vegetation.syncTrees()) {
      if (this.gfx.fog.visibilityAt(p.x, p.z) > 0.2) this.effects.explosion(p.clone().setY(p.y + 0.4), 'fire', 0.8);
      this.ents.destruction.treeDown(p.x, p.y, p.z); // charred stump / fallen trunk
    }
    this.effects.setAmbientCenter?.(this.gfx.cam.x, this.gfx.cam.y);
    this.updateContentVisuals(fdt);
    this.effects.update(fdt, this.time);

    // camera shake (distance-scaled trauma, off with reduceMotion), battle music / call-outs, moments
    this.juice.update(dt);

    // incoming enemy nukes: warning banner + marked blast zone
    if (!this.setup.demo) {
      const incoming = world.projectiles.find((p) => p.special === 'nuke' && p.alive && p.owner !== this.local);
      if (incoming) {
        if (!this.nukeWarn) this.nukeWarn = nukeWarning();
        this.nukeWarn.update((1 - incoming.t) * incoming.dur);
        if (this.input?.mode !== 'super') this.reticle.show(incoming.tx, incoming.ty, 4.5, 0xff2010, this.time);
      } else if (this.nukeWarn) {
        this.nukeWarn.remove();
        this.nukeWarn = null;
        this.reticle.hide();
      }
    }
    // (dynamic resolution before drawing: a resize after drawing clears the canvas that this frame then presents, a
    // black flash at every Auto render-scale step without TAA; seen on Android, tools/mobile)
    if (!this.setup.demo && !this.paused) this.gfx.adaptResolution(dt * 1000);
    this.gfx.render(dt, this.time);
    hdReleaseUploaded(this.gfx.renderer); // upload new HD atlases and close their decoded bitmaps
    if (this.overlay) this.overlay.draw(this.gfx.cam.camera, world, this.ents, this.local, this.selection, this.input?.hovered ?? 0, this.alpha, fdt);
    const rt = this.world.mission;
    if (rt && rt.events.length) {
      for (const ev of rt.events) {
        this.missionHud?.handle(ev);
        if (ev.e === 'camera') this.gfx.cam.flyToPoint(ev.x, ev.y, 1.2);
        else if (ev.e === 'beacon') {
          this.effects.orderMarker(new THREE.Vector3(ev.x, this.world.map.surfaceAt(ev.x, ev.y), ev.y), 'rally');
          this.hud?.minimap.ping(ev.x, ev.y, '#ffd34d');
        }
      }
      rt.events.length = 0;
    }
    this.missionHud?.update(dt);
    if (this.hud) {
      this.hud.update(dt);
      if (this.world.tick - this.hintsTick >= 10 || this.world.tick < this.hintsTick) { this.hintsTick = this.world.tick; this.hints?.update(); } // (every 10 ticks, however many a frame steps)
      this.minimapT -= dt;
      if (this.minimapT <= 0) {
        this.minimapT = 0.1;
        this.hud.minimap.draw(this.input!.viewPolygon(), 0.1, this.time);
      }
    }
    // autosave every two minutes of play
    if (!this.setup.demo && !this.paused && !world.gameOver && !this.net) { // (no saves of multiplayer matches)
      this.autosaveT -= dt * this.speed;
      if (this.autosaveT <= 0) { this.autosaveT = 120; this.save('auto'); }
    }
    // audio listener & adaptive music
    this.audio.setListener(this.gfx.cam.x, this.gfx.cam.y, this.gfx.cam.viewRadius);
    this.heat = Math.max(0, this.heat - dt * 2.5);
    this.offHeat = Math.max(0, this.offHeat - dt * 1.5);
    this.updateAmbience(dt);
    if (!this.setup.demo) this.audio.setMusicIntensity(Math.min(1, 0.12 + this.heat / 40));
    this.audio.update(dt);

    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        this.endCine?.();
        this.endCine = null;
        this.cb.onEnd(this, world.winnerTeam === this.local.team && !this.local.resigned); // (MP: who surrendered lost, whatever the team did; sim/resign.ts)
      }
    }
  }

  /** Is a ground point on screen? Projected through the real camera, so it follows any pitch / FOV / yaw. */
  private inView(x: number, y: number): boolean {
    const v = _viewProbe.set(x, Math.max(0, this.gfx.cam.heightAt(x, y)), y).project(this.gfx.cam.camera);
    return v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05;
  }

  private processEvents() {
    const world = this.world;
    const fog = this.gfx.fog;
    const demo = !!this.setup.demo;
    for (const ev of world.events) {
      // dead entities are already removed from the world; their view still knows them
      const deadEnt = ev.e === 'death' ? this.ents.views.get(ev.id)?.ent : undefined;
      if (!demo) meta.onEvent(ev, { localPlayerId: this.local.id, world, dead: deadEnt });
      this.ents.handleEvent(ev);
      this.juice.onEvent(ev, deadEnt);
      if (ev.e === 'produced') this.hud?.army.simEvent(ev); // auto-groups, idle-factory watch
      switch (ev.e) {
        case 'fire': {
          const vis = fog.visibilityAt(ev.fx, ev.fy) > 0.25;
          if (vis) {
            this.audio.play(ev.weapon.report as SfxKey, { x: ev.fx, y: ev.fy });
            if (this.inView(ev.fx, ev.fy)) this.heat += ev.weapon.damage >= 100 ? 2 : 0.6;
            else this.offHeat = Math.min(30, this.offHeat + 0.4);
          } else if (!this.inView(ev.fx, ev.fy)) {
            this.offHeat = Math.min(30, this.offHeat + 0.25);
          }
          break;
        }
        case 'impact':
          if (ev.kind === 'medium' || ev.kind === 'large' || ev.kind === 'huge' || ev.kind === 'nuke') this.life.startle(ev.x, ev.y, ev.kind === 'nuke' ? 4 : 1);
          if (fog.visibilityAt(ev.x, ev.y) > 0.2 || ev.kind === 'nuke') {
            this.audio.play(('expl_' + ev.kind) as SfxKey, { x: ev.x, y: ev.y });
            if (ev.kind === 'nuke') {
              this.gfx.flash = 0.45;
              this.effects.shake += 3;
              this.heat += 40;
            }
          }
          break;
        case 'death': {
          const e = deadEnt ?? world.getEntity(ev.id);
          if (e instanceof Building && ev.how !== 'sold') {
            this.rubble.add(e.cx, e.cy, e.w, e.h, e.id);
            const h = this.effects.createEmitter('smoke', new THREE.Vector3(e.x, world.map.heightAt(e.x, e.y) + 0.3, e.y));
            h.setIntensity(0.6 + Math.max(e.w, e.h) * 0.2);
            this.timedEmitters.push({ h, until: this.time + 25 });
            this.life.startle(e.x, e.y, 1.5);
          }
          if (ev.how === 'sold' || fog.visibilityAt(ev.x, ev.y) < 0.2) break;
          if (e instanceof Building) { this.audio.play('expl_building', { x: ev.x, y: ev.y }); this.lastDeath = [ev.x, ev.y]; }
          else if (e instanceof Unit && e.kind === 'infantry') {
            const key: SfxKey = ev.how === 'burn' ? 'inf_burn' : ev.how === 'electro' ? 'inf_electro' : ev.how === 'crushed' ? 'crush' : Math.random() < 0.4 ? 'inf_scream' : 'inf_die';
            this.audio.play(key, { x: ev.x, y: ev.y });
          } else this.audio.play('vehicle_die', { x: ev.x, y: ev.y });
          break;
        }
        case 'sfx':
          if (ev.x < 0 || fog.visibilityAt(ev.x, ev.y) > 0.2) {
            this.audio.play(ev.key, ev.x < 0 ? undefined : { x: ev.x, y: ev.y });
            if (ev.x >= 0) this.sfxVisual(ev.key, ev.x, ev.y);
          }
          break;
        case 'power':
          this.powerVisual(ev);
          break;
        case 'commander': // commander power visuals, rings, panel flashes
          if (!demo) commanderVisual(this, ev);
          break;
        case 'infiltrate':
          if (!demo && this.overlay && (ev.player === this.local.id || ev.victim === this.local.id)) {
            const text = ev.kind === 'thief' ? (ev.victim === this.local.id ? `-$${ev.amount}` : `+$${ev.amount}`) : tHud(ev.player === this.local.id ? 'float.infiltrated' : 'float.spy');
            this.overlay.addFloat(ev.x, world.map.heightAt(ev.x, ev.y) + 1.8, ev.y, text, ev.victim === this.local.id ? '#ff6a4a' : '#7fe0ff');
          }
          break;
        case 'harvest':
          this.harvestSfxT -= 1;
          if (this.harvestSfxT <= 0 && fog.visibilityAt(ev.x, ev.y) > 0.3) { this.harvestSfxT = 4; this.audio.play('harvest', { x: ev.x, y: ev.y }, { volume: 0.5 }); }
          break;
        case 'credits':
          if (!demo && ev.player === this.local.id && this.overlay) this.overlay.addFloat(ev.x, world.map.heightAt(ev.x, ev.y) + 1.4, ev.y, `+$${ev.amount}`);
          break;
        case 'announce':
          if (!demo && ev.player === this.local.id) {
            this.audio.announce(ev.key);
            if (ev.key === 'nuke_ready' || ev.key === 'iron_curtain_ready' || ev.key === 'chrono_ready') this.audio.stinger('superweapon_ready');
            else if (ev.key === 'reinforcements') this.audio.stinger('reinforcements');
            else if (ev.key === 'ceasefire_over') this.audio.stinger('enemy_spotted'); // build-up time is over
            if (ev.key === 'base_under_attack' || ev.key === 'harvester_under_attack') this.hud?.minimap.ping(this.local.lastAttackX, this.local.lastAttackY);
          }
          break;
        case 'placed': {
          const b = world.getEntity(ev.id);
          if (b instanceof Building) {
            const cells: number[] = [];
            for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) cells.push(world.map.idx(b.cx + dx, b.cy + dy));
            this.gfx.vegetation.hideCells(cells);
            this.rubble.clear(b.cx, b.cy, b.w, b.h);
            if (fog.visibilityAt(b.x, b.y) > 0.2) this.audio.play('build_rise', { x: b.x, y: b.y });
          }
          break;
        }
        case 'nuke': {
          this.audio.play('nuke_launch');
          const proj = world.projectiles.find((p) => p.special === 'nuke' && p.alive && !this.nukeWatched.has(p.id));
          if (proj && !demo) {
            this.nukeWatched.add(proj.id);
            if (proj.owner === this.local) {
              this.nukeCine = nukeCinematic(this, { x: proj.sx, y: proj.sy }, { x: proj.tx, y: proj.ty }, proj.dur, () => proj.alive);
            }
          }
          break;
        }
        case 'captured': {
          const b = world.getEntity(ev.id);
          if (b instanceof Building && fog.visibilityAt(b.x, b.y) > 0.2) {
            const p3 = new THREE.Vector3(b.x, world.map.heightAt(b.x, b.y) + 0.2, b.y);
            this.effects.chronoFlash(p3);
            this.effects.constructionBurst(p3, Math.max(b.w, b.h));
            if (!demo && this.overlay && (ev.to === this.local.id || ev.from === this.local.id)) this.overlay.addFloat(b.x, p3.y + 1.2, b.y, tHud(ev.to === this.local.id ? 'float.captured' : 'float.structureLost'), ev.to === this.local.id ? '#8dffb0' : '#ff6a5a');
          }
          break;
        }
        case 'promoted': {
          const u = world.getEntity(ev.id);
          if (u && fog.visibilityAt(u.x, u.y) > 0.2) {
            const p3 = new THREE.Vector3(u.x, world.map.surfaceAt(u.x, u.y) + 0.4, u.y);
            this.effects.oreSparkle(p3, false);
            this.effects.healPulse(p3);
            if (!demo && u.owner === this.local && this.overlay) {
              this.overlay.addFloat(u.x, p3.y + 0.5, u.y, ev.rank >= 2 ? `★ ${tHud('float.elite')}` : `▲ ${tHud('float.veteran')}`, '#ffe27a');
              this.audio.stinger('promotion');
            }
          }
          break;
        }
        case 'crate': {
          const p3 = new THREE.Vector3(ev.x, world.map.surfaceAt(ev.x, ev.y) + 0.3, ev.y);
          if (fog.visibilityAt(ev.x, ev.y) > 0.2) {
            if (ev.reward === 'unit') this.effects.chronoFlash(p3);
            else this.effects.oreSparkle(p3, ev.reward !== 'money');
            this.effects.healPulse(p3);
          }
          if (!demo && ev.player === this.local.id && this.overlay) {
            const label = ev.reward === 'money' ? `+$${ev.amount}` : tHud(ev.reward === 'unit' ? 'float.reinforcements' : ev.reward === 'heal' ? 'float.fieldRepair' : 'float.revealed');
            this.overlay.addFloat(ev.x, p3.y + 0.8, ev.y, label, ev.reward === 'money' ? '#ffd34d' : '#8dffb0');
          }
          break;
        }
        case 'eliminated':
          if (!demo) {
            const p = world.players[ev.player];
            this.hud?.message(p === this.local ? tHud('msg.defeated') : tHud('msg.eliminated', { name: playerName(p.name) }), p === this.local, p === this.local ? undefined : 'success');
          }
          break;
        case 'gameover':
          if (!demo) {
            const won = world.winnerTeam === this.local.team && !this.local.resigned; // (MP: surrendered = lost; sim/resign.ts)
            if (world.mission && this.missionDef) this.recordMission(world.mission); // KOTH / challenge runtimes keep no campaign record
            const summary = meta.onGameEnd({
              won, time: world.time, mode: this.missionDef ? 'mission' : 'skirmish', missionId: this.missionDef?.id,
              stars: this.missionResult?.stars, score: world.mission?.score, stats: this.local.stats, weather: this.gfx.weather.kind, world,
            });
            this.metaSummary = summary; // results screen
            if (summary) window.setTimeout(() => showXpSummary(summary), 5200);
            this.audio.announce(won ? 'mission_accomplished' : 'mission_failed');
            if (!(won && playVictoryFanfare())) this.audio.stinger(won ? 'victory' : 'defeat'); // equipped victory fanfare
            this.endTimer = 4.5;
            const reason = world.mission?.endReason; // KOTH / challenge reason (the mode's English: translated here)
            const sub = this.missionDef ? tHud('end.operation', { name: trSource(this.missionDef.codename) }) : reason != null ? trSource(reason) : tHud(won ? 'end.won' : 'end.lost');
            this.endCine = endingCinematic(won, sub, this.gfx); // lens
            // slow-motion sweep to the final explosion
            this.speed = 0.35;
            if (this.lastDeath) this.gfx.cam.flyToPoint(this.lastDeath[0], this.lastDeath[1]);
            this.gfx.cam.targetDist = 16;
            this.input?.setMode('normal');
          } else {
            this.endTimer = -1;
          }
          break;
      }
    }
    world.events.length = 0;
  }

  /** After loading: camera, clock, control groups, ground clutter under structures. */
  private restoreView(save: SaveData) {
    const g = save.game ?? {};
    this.time = this.world.time;
    if (g.cam) {
      this.gfx.cam.jumpTo(g.cam.x, g.cam.y);
      this.gfx.cam.dist = this.gfx.cam.targetDist = g.cam.dist;
      this.gfx.cam.yaw = this.gfx.cam.targetYaw = g.cam.yaw ?? 0;
    }
    this.hud?.army.loadState(g.army); // factory auto-groups
    if (g.scars) this.ents.destruction.loadScars(g.scars); // the battlefield's scars (validated)
    if (this.input && g.groups) {
      this.input.groups = new Map(g.groups);
      for (const [k, ids] of this.input.groups) for (const id of ids) this.overlay?.groups.set(id, k);
    }
    const cells: number[] = [];
    for (const b of this.world.buildings) for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) cells.push(this.world.map.idx(b.cx + dx, b.cy + dy));
    this.gfx.vegetation.hideCells(cells);
    this.selection.clear();
    this.gfx.fog.snap(this.local);
  }

  /** Snapshot the whole game into a save slot. */
  save(slot = 'auto'): boolean {
    if (this.setup.demo || this.setup.replay || this.world.gameOver || this.net) return false;
    const cam = this.gfx.cam;
    const { load: _ignore, ...setup } = this.setup;
    const label = this.missionDef ? `Operation ${this.missionDef.codename}` : `Skirmish · ${this.local.faction === 'allies' ? 'Allies' : 'Soviets'} vs ${this.world.players.length - 1}`;
    const data: SaveData = {
      version: SAVE_VERSION, sim: SIM_VERSION, savedAt: Date.now(), world: serializeWorld(this.world),
      game: {
        setup, label, hours: this.hours, wxIdx: this.wxIdx, wxTimer: this.wxTimer, time: this.world.time,
        cam: { x: cam.x, y: cam.y, dist: cam.targetDist, yaw: cam.targetYaw },
        groups: this.input ? [...this.input.groups.entries()] : [],
        army: this.hud?.army.saveState(), // factory auto-groups
        replay: this.recorder?.snapshot(), // the replay continues after loading
        scars: this.ents.destruction.saveScars(), // craters, burnt ground, scorch marks, burnt trees, rubble (render only)
      },
    };
    if (this.setup.conquest && slot === 'auto') writeSave('conquest', data); // the run can always resume its battle
    return writeSave(slot, data);
  }

  /** Stars: 1 for winning, +1 under par time, +1 for all optional objectives (or none existed). */
  private recordMission(rt: MissionRuntime) {
    const def = rt.def;
    const won = rt.won;
    const optional = rt.objectives.filter((o) => !o.primary);
    const optionalOk = optional.every((o) => o.state === 'done');
    const fast = !def.parTime || this.world.time <= def.parTime;
    const stars = won ? 1 + (fast ? 1 : 0) + (optionalOk ? 1 : 0) : 0;
    this.missionResult = { won, stars, time: this.world.time, score: rt.score };
    recordResult(def.id, { won, stars, time: this.world.time, score: def.scored ? rt.score : undefined, level: rt.level }); // CAMP: + the level it was won at
  }

  /** Feed the soundscape: time of day, weather, nearby water/forest, combat on and off screen, zoom. */
  private updateAmbience(dt: number) {
    const cam = this.gfx.cam;
    const map = this.world.map;
    this.envT -= dt;
    if (this.envT <= 0) {
      this.envT = 0.6;
      // sample the terrain around the camera focus
      let water = 0, forest = 0, n = 0;
      const R = Math.max(6, cam.viewRadius * 0.8);
      for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
        const x = Math.floor(cam.x + dx), y = Math.floor(cam.y + dy);
        if (!map.inBounds(x, y)) continue;
        const i = map.idx(x, y);
        n++;
        if (map.terrain[i] === 1) water++;
        if (map.tree[i]) forest++;
      }
      this.waterFrac = n ? Math.min(1, (water / n) * 4) : 0;
      this.forestFrac = n ? Math.min(1, (forest / n) * 3) : 0;
    }
    // first contact with the enemy after a quiet spell
    this.spottedCheckT -= dt;
    if (!this.setup.demo && this.spottedCheckT <= 0) {
      this.spottedCheckT = 1;
      const fog = this.gfx.fog;
      const seen = this.world.units.some((u) => u.alive && this.local.isEnemy(u.owner) && fog.visibilityAt(u.x, u.y) > 0.6);
      if (seen) {
        if (this.time - this.lastSpotted > 120 && this.time > 20) this.audio.stinger('enemy_spotted');
        this.lastSpotted = this.time;
      }
    }
    this.ambT -= dt;
    if (this.ambT > 0) return;
    this.ambT = 0.1;
    const w = this.gfx.weather;
    this.audio.setAmbience({
      night: this.gfx.night,
      weather: w.kind,
      intensity: w.weights[w.kind] ?? 1,
      wind: Math.min(1, w.levels.wind),
      water: this.waterFrac,
      forest: this.forestFrac,
      battle: Math.min(1, this.heat / 30),
      offscreenBattle: Math.min(1, this.offHeat / 20),
      zoom: (cam.dist - cam.minDist) / (cam.maxDist - cam.minDist),
    });
  }

  /** Cinematic camera for the menu background: drift towards the action. */
  private updateDemoCamera(dt: number) {
    const c = this.demoCam;
    c.retarget -= dt;
    if (c.retarget <= 0) {
      c.retarget = 9;
      // find the busiest area (most units near each other, preferring combat)
      let best: Unit | null = null, bestScore = -1;
      for (const u of this.world.units) {
        if (!u.alive) continue;
        let s = u.target ? 4 : 0;
        for (const o of this.world.units) if (o.alive && Math.abs(o.x - u.x) < 6 && Math.abs(o.y - u.y) < 6) s += o.owner !== u.owner ? 3 : 1;
        if (s > bestScore) { bestScore = s; best = u; }
      }
      if (best) { c.tx = best.x; c.ty = best.y; }
    }
    const cam = this.gfx.cam;
    c.angle += dt * 0.05;
    cam.x += (c.tx + Math.cos(c.angle) * 3 - cam.x) * Math.min(1, dt * 0.35);
    cam.y += (c.ty + Math.sin(c.angle) * 2 - cam.y) * Math.min(1, dt * 0.35);
    cam.targetDist = 24 + Math.sin(c.angle * 3) * 4;
  }

  dispose() {
    this.cameraDirector?.dispose?.();
    this.cameraDirector = null;
    this.recorder?.finish(); // store the replay of a match left before its end
    for (const a of this.attachments) a.dispose();
    if (!this.setup.demo && meta.active) meta.abandon(); // quit / restart mid-battle
    clearMatchCosmetics(); // factory colours again
    if (Rubble.current === this.rubble) Rubble.current = null; // (the static pointer would keep this whole match alive)
    this.contextWatch?.dispose(); // first: forceContextLoss below must not trigger the lost-context overlay
    this.contextWatch = null;
    this.running = false;
    this.audio.stopAmbience();
    cancelAnimationFrame(this.raf);
    this.input?.dispose();
    this.missionHud?.dispose();
    this.hud?.dispose();
    this.nukeWarn?.remove();
    this.endCine?.();
    this.nukeCine?.();
    this.ents.dispose();
    this.wakes.dispose();
    this.gapField.dispose();
    this.bridges.dispose();
    this.effects.dispose?.();
    // shared/cached resources hold dispose listeners that would pin this renderer in memory forever
    releaseGpuResources();
    hdReleaseAll(); // the next battle re-decodes from the cached GLB bytes (its own renderer, maybe another tier)
    this.gfx.dispose();
    this.gfx.renderer.forceContextLoss();
    this.overlay?.dispose();
    document.getElementById('tooltip')?.remove();
    const ui = document.getElementById('ui');
    if (ui) ui.innerHTML = '';
    this.canvas.remove();
    this.audio.onAnnounce = undefined;
    clearSubtitles();
    document.body.classList.remove('faction-soviet');
  }
}

export type { GameEvent };
