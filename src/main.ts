import './ui/styles.css';
import { AudioSystem } from './audio';
import type { Game, GameSetup } from './game';
import { Menus, type Settings } from './ui/menu';
import { campaignMissions } from './missions';
import { setToastSound } from './meta';
import { readSave, type SaveData } from './sim/save';
import { GAME_TITLE, MULTIPLAYER } from './config';
import type { Faction } from './data/rules';
import type { AIDifficulty } from './sim/ai';
import type { TimeOfDay } from './render/renderer';
import { installErrorBoundary, reportError } from './platform/errors';
import { checkSupportRetrying, renderUnsupported, showSlowRendererNotice } from './platform/webgl';
import { detectQuality } from './platform/gpu';
import { registerServiceWorker, serviceWorkerRegistration } from './platform/pwa';
import { enterFullscreen } from './platform/fullscreen';
import { hdModelsWanted, loadSettings, saveSettings } from './ui/settings';
import { resolveTestSetup } from './replay/launch';
import { customMissionSetup, initEditorStore } from './editor/store';
import { activeModSet, showModBadge, showMods } from './mods'; // mods
import { saveRun, loadRun } from './conquest/storage';
import type { BattleKind, ConquestSetup } from './conquest/battle';
import { showQuickCard } from './ui/variety';
import { isWorldBattle, worldBadge, worldLinkPending } from './ui/world/entry'; // World Conquest (the mode itself is the src/ui/world chunk)
import './ui/doctrine-picker'; // registers the doctrine picker in the skirmish Rules tab
import type { LobbyHost } from './ui/lobby'; // multiplayer lobby (loaded on demand)
import { boardOfSetup, portableMathFor, withPortableFlag } from './net/boards'; // multiplayer and ranked runs: portable maths, verified leaderboards
import { i18nReady } from './i18n/core'; // interface language (src/i18n)
import tMenu from './i18n/en/menu';
import tLoading from './i18n/en/loading';

/**
 * The engine (src/engine.ts: three.js, the renderer, models, HUD, the menu backdrop) is its own chunk, requested
 * right here so it downloads while the menu is already up; the backdrop battle starts once it has arrived.
 */
type Engine = typeof import('./engine');
const engineLoad: Promise<Engine> = import('./engine');
engineLoad.catch(() => {}); // (reported where it is awaited)
await i18nReady; // the saved or browser language: its catalogue downloads alongside the engine
let engineMod: Engine | null = null;
let engineReady: Promise<Engine> | null = null;
function engine(): Promise<Engine> {
  return (engineReady ??= engineLoad.then((E) => {
    engineMod = E;
    // how mode screens (challenges, result, end-screen offers) start games and return to the menus
    E.setModeHost({ start: (s) => void startGame(s), quality: () => menus.settings.quality, toMenu: () => { audio.stopMusic(); startDemo(); }, openChallenges: () => openChallenges(), openReplays: () => menus.showReplays() });
    return E;
  }));
}

document.title = GAME_TITLE;
const support = await checkSupportRetrying(); // before anything creates a WebGLRenderer (retried, a cold GPU process can fail the first try)
if (!support.ok) {
  document.getElementById('loading')?.remove();
  renderUnsupported(support);
  throw new Error(`WebGL 2 unavailable: ${support.reason}`);
}
showSlowRendererNotice(support); // no graphics card in use (software rendering): say why it is slow and how to fix it
// first launch: pick a quality preset that suits this GPU (must run before the menus read settings)
try {
  if (!new URLSearchParams(location.search).get('autostart') && !JSON.parse(localStorage.getItem('rh.settings') ?? '{}').quality) saveSettings({ ...loadSettings(), quality: await detectQuality() });
} catch { /* keep defaults */ }
const params = new URLSearchParams(location.search);
/** Numeric test parameter, clamped: a shared link must not be able to freeze the tab (?ff=1e9, ?size=1e5). */
const numParam = (name: string, def: number, lo: number, hi: number): number => {
  const v = Number(params.get(name) ?? def);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
};
const audio = new AudioSystem();
let game: Game | null = null;
let lastSetup: GameSetup | null = null;
// A tab left open across a deploy asks for chunks the server no longer has (plain-http hosts have no service worker to
// keep them): reload into the new build instead of leaving the player on the bare backdrop. Never under a match; at
// most once in 30 s, so a broken deploy shows its error instead of reloading in a loop.
window.addEventListener('vite:preloadError', () => {
  if (game && !game.setup.demo) return;
  try {
    if (Date.now() - Number(sessionStorage.getItem('rh.chunkReload') || 0) < 30_000) return;
    sessionStorage.setItem('rh.chunkReload', String(Date.now()));
  } catch { return; }
  location.reload();
});
/** A playtest started from the editor: leaving the match goes back to the editor. */
let returnToEditor = false;
const loading = document.getElementById('loading')!;
const loadingBar = loading.querySelector('.bar div') as HTMLElement;
const loadingLabel = loading.querySelector('.label') as HTMLElement;

installErrorBoundary({
  onReturnToMenu: () => { audio.stopMusic(); startDemo(); },
  getContext: () => game
    ? { tick: game.world.tick, seed: game.setup.seed, units: game.world.units.length, quality: game.setup.quality, demo: !!game.setup.demo, mission: game.setup.mission ?? null }
    : { screen: 'menu' },
  getGl: () => game?.gfx.renderer.getContext(),
});

// Web Audio needs a user gesture.
const unlock = () => {
  audio.unlock().then(() => {
    // calm menu music behind the title screen
    if (!game || game.setup.demo) { audio.startMusic(); audio.setMusicIntensity(0); }
  }).catch(() => {});
};
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

/**
 * Offline support (E2E fix). A downloaded update reloads the page, so it is applied only while the main menu is on
 * show: never mid-match, and never under the editor, a lobby or another screen with work in progress (it waits for
 * the next visit to the main menu). If another tab already switched to the new build, this page reloads into it.
 */
let applyUpdate: (() => void) | null = null;
function maybeApplyUpdate() {
  if (!applyUpdate || (game && !game.setup.demo) || !menus.onMainMenu) return;
  const apply = applyUpdate;
  applyUpdate = null;
  if (serviceWorkerRegistration()?.waiting) apply(); else location.reload();
}

const menus = new Menus(audio, {
  start: (setup) => void startGame(setup),
  resume: () => game?.resume(),
  // same map, same opponents, from the beginning (a loaded game restarts its map from scratch)
  restart: (newMap) => { if (newMap && lastSetup?.quick && !lastSetup.replay) { menus.quickBattle(); return; } /* "Play again" after a Quick Battle rolls a new one */ if (lastSetup) void startGame({ ...lastSetup, load: undefined, intro: false, ...(newMap && !lastSetup.branch && !lastSetup.challenge ? { seed: (Math.random() * 1e9) | 0 } : {}) }); }, // a branch / challenge restarts from its moment
  quit: () => { if (game?.setup.conquest && !game.world.gameOver) game.save('auto'); /* the campaign can resume this battle */ audio.stopMusic(); if (returnToEditor) { openEditorScreen(); return; } startDemo(); }, // playtests return to the editor (a downloaded update applies when the main menu shows: mainShown)
  settingsChanged: (s: Settings) => { if (game) applySettings(game, s); },
  openCampaign: () => openCampaign(),
  openConquest: () => openConquest(),
  conquestInfo: () => { const r = loadRun(); return r && r.status === 'active' ? tMenu('main.conquestTurn', { n: r.turn }) : null; },
  openWorld: () => openWorld(), // World Conquest
  worldInfo: () => { const b = worldBadge(); return b ? tMenu('main.conquestTurn', { n: b.turn }) : null; },
  openChallenges: () => openChallenges(),
  openProfile: () => openProfile(),
  openBootCamp: () => deployMission('bootcamp'),
  openEditor: () => openEditorScreen(),
  openMods: () => showMods({ play: (k) => audio.play(k), onBack: () => menus.showMain() }),
  // online play (left out of a VITE_MULTIPLAYER=off build: no menu entry)
  openMultiplayer: MULTIPLAYER ? () => void import('./ui/lobby').then((m) => m.openLobby(lobbyHost)).catch((e) => reportError(e)) : undefined,
  backToLobby: MULTIPLAYER ? () => void import('./ui/lobby').then((m) => { m.keepConnection(); audio.stopMusic(); startDemo(); menus.hide(); m.openLobby(lobbyHost); }).catch((e) => reportError(e)) : undefined, // after a match: back to its room
  continueInfo: () => {
    const s = latestSave();
    return s ? { label: s.game?.label ?? tMenu('main.savedGame'), savedAt: s.savedAt } : null;
  },
  continueGame: () => {
    const s = latestSave();
    if (s?.game?.setup) void startGame({ ...s.game.setup, load: s, intro: false, quality: menus.settings.quality });
  },
  saveGame: () => game?.save('manual') ?? false,
  mainShown: () => maybeApplyUpdate(), // (E2E fix: updates reload the page only here)
});

function latestSave(): SaveData | null {
  const a = readSave('auto'), m = readSave('manual');
  if (!a) return m;
  if (!m) return a;
  return a.savedAt > m.savedAt ? a : m;
}

// keep progress when the tab is closed mid-game
window.addEventListener('beforeunload', () => { if (game && !game.setup.demo) game.save('auto'); });

setToastSound((k) => (k === 'rank' ? audio.stinger('promotion') : audio.play(k === 'xp' ? 'ready_ping' : 'promote')));

/** Start a scripted mission (campaign, special operation or daily challenge); the mission defines the rest. */
function deployMission(id: string) {
  // a custom mission (editor) travels with its content, so saves rebuild it even if it is edited later
  const custom = customMissionSetup(id) ?? (lastSetup?.mission === id && lastSetup.customMission ? { customMission: lastSetup.customMission, customMap: lastSetup.customMap } : null);
  void startGame({
    faction: 'allies', color: 0x3d7be0, opponents: [], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6, credits: 5000,
    startUnits: 'mcv', fog: true, timeOfDay: 'day', quality: menus.settings.quality, seed: 0, mission: id, intro: true, ...(custom ?? {}),
  });
}

/** Map & mission editor (the menu backdrop battle is stopped while it is open). */
function openEditorScreen() {
  returnToEditor = false;
  demoToken++; // (a backdrop still waiting for the engine stays away)
  game?.dispose();
  game = null;
  exposeDebug(null);
  showModBadge(null);
  menus.hide();
  hideLoading();
  audio.stopMusic();
  // the editor is loaded on demand (its own chunk): most players never open it
  void import('./editor').then(({ openEditor }) => openEditor({
    quality: menus.settings.quality,
    play: (k) => audio.play(k),
    onExit: () => startDemo(),
    onPlaytest: (setup) => { returnToEditor = true; void startGame(setup); },
  })).catch((e) => reportError(e));
}

/** Campaign / special operations screen. */
function openCampaign() {
  void import('./ui/campaign').then(({ showCampaign }) => showCampaign({ play: (k) => audio.play(k), onBack: () => menus.showMain(), onDeploy: (id) => deployMission(id) })).catch((e) => reportError(e));
}

/** Conquest: the roguelite campaign across Europe (src/ui/conquest.ts). */
function openConquest(demo?: string) {
  // the strategic map screens load on demand (their own chunk)
  void import('./ui/conquest').then(({ showConquest }) => showConquest({
    play: (k) => audio.play(k),
    onBack: () => menus.showMain(),
    onDeploy: (c) => deployConquest(c),
    onResume: (save) => { if (save.game?.setup) void startGame({ ...save.game.setup, load: save, intro: false, quality: menus.settings.quality }); },
    demo,
  })).catch((e) => reportError(e));
}

/** Start a conquest battle (the mission is built from the frozen battle spec). */
function deployConquest(c: ConquestSetup) {
  void startGame({
    faction: c.battle.faction, color: c.battle.faction === 'allies' ? 0x3d7be0 : 0xd23a2c, opponents: [], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6, credits: 5000,
    startUnits: 'mcv', fog: true, timeOfDay: 'day', quality: menus.settings.quality, seed: 0, mission: 'conquest', conquest: c, intro: true,
  });
}

/**
 * World Conquest (src/ui/world, its own chunk): the Risk-style world campaign. The globe gets the GPU to
 * itself (the menu backdrop stops, as for the editor); its battles go through deployConquest like Conquest's.
 */
function openWorld(demo?: string) {
  demoToken++; // (a backdrop still waiting for the engine stays away)
  game?.dispose();
  game = null;
  exposeDebug(null);
  showModBadge(null);
  menus.hide();
  setLoading(0.4, tLoading('stage.loading')); // (the chunk may take a moment on a slow connection)
  void import('./ui/world').then(({ showWorld }) => { hideLoading(); return showWorld({
    play: (k) => audio.play(k),
    quality: menus.settings.quality,
    onBack: () => startDemo(),
    onDeploy: (c) => deployConquest(c),
    onResume: (save) => { if (save.game?.setup) void startGame({ ...save.game.setup, load: save, intro: false, quality: menus.settings.quality }); },
    demo,
  }); }).catch((e) => { hideLoading(); reportError(e); });
}

function openChallenges() {
  // (the challenge screens use the mode runtime, so the engine comes first)
  void Promise.all([import('./ui/challenges'), engine()]).then(([{ showChallenges }]) => showChallenges({ play: (k) => audio.play(k), onBack: () => menus.showMain(), onProfile: () => openProfile(), onDeploy: (id) => deployMission(id) })).catch((e) => reportError(e));
}

function openProfile() {
  void import('./ui/profile').then(({ showProfile }) => showProfile({ play: (k) => audio.play(k), onBack: () => menus.showMain() })).catch((e) => reportError(e));
}

function applySettings(g: Game, s: Settings) {
  g.gfx.setRenderScaleMode(s.renderScale ?? 'auto'); // render resolution: Auto (dynamic) or fixed
  if (g.input) { g.input.edgeScroll = s.edgeScroll; g.input.unitVoices = s.unitVoices; }
  if (g.hints) g.hints.enabled = s.hints;
}

function setLoading(frac: number, label: string) {
  loading.style.display = 'flex';
  loading.style.opacity = '1';
  loadingBar.style.width = `${Math.round(frac * 100)}%`;
  loadingLabel.textContent = label.toUpperCase();
}
function hideLoading() {
  loading.style.opacity = '0';
  setTimeout(() => { loading.style.display = 'none'; }, 600);
}
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/**
 * Load the baked HD models of the match's factions on the loading screen (both factions when they are
 * not known up front: missions, saves, replays, random opponents). Bounded: a slow network starts the match
 * with procedural models rather than waiting.
 */
async function preloadHd(E: Engine, setup: GameSetup): Promise<void> {
  const on = hdModelsWanted(menus.settings, setup.quality);
  E.setHdModels(on, setup.quality === 'high' ? 'high' : 'medium');
  if (!on) return;
  const both = !!(setup.mission || setup.load || setup.replay || setup.conquest || setup.allies?.length) || setup.opponents.some((o) => o.faction === 'random');
  const facs = new Set<Faction>(both ? ['soviet', 'allies'] : [setup.faction, ...setup.opponents.map((o) => o.faction as Faction)]);
  setLoading(0.02, tLoading('stage.hdModels'));
  await Promise.race([
    E.preloadHd([...facs], [], (d, n) => setLoading(0.02 + (0.06 * d) / Math.max(1, n), tLoading('stage.hdModels'))),
    new Promise<void>((r) => setTimeout(r, 20000)),
  ]);
}

/**
 * Everything the battle starts with (structures, start units, scenario / mission / save content) loads
 * before the first frame, so none of it has to swap from procedural later; the rest loads lazily
 * (EntityRenderer: structures when placed or seen, units when first produced).
 */
async function preloadHdWorld(E: Engine, g: Game): Promise<void> {
  if (!E.hdModelsEnabled()) return;
  const types: [string, Faction][] = [];
  for (const e of [...g.world.buildings, ...g.world.units]) if (e.alive) types.push([e.type.id, e.owner.faction]);
  setLoading(0.96, tLoading('stage.hdModels'));
  await Promise.race([E.preloadHd([], types), new Promise<void>((r) => setTimeout(r, 15000))]);
  g.warmHd();
  E.prefetchHdFiles([...new Set(g.world.players.map((p) => p.faction))]); // offline: the service worker caches the rest
}

async function startGame(setup: GameSetup) {
  if (menus.settings.skipIntro && !params.get('autostart')) setup = { ...setup, intro: false };
  // a new match runs with the enabled mods (loads and replays keep the mods they were recorded with)
  if (!setup.load && !setup.replay && !setup.demo && !('mods' in setup)) setup = { ...setup, mods: activeModSet() ?? undefined };
  // still inside the Deploy click, so the browser allows it
  if (menus.settings.fullscreen !== false && !params.get('autostart')) void enterFullscreen();
  menus.hide();
  setLoading(0, tLoading('stage.initialising'));
  if (setup.quick && !setup.load && !setup.replay) showQuickCard(setup.quick); // what the Quick Battle rolled
  demoToken++; // (a backdrop still waiting for the engine stays away)
  await nextFrame();
  let E: Engine;
  try {
    if (!engineMod) setLoading(0.01, tLoading('stage.engine')); // (a slow connection: still downloading)
    E = await engine();
  } catch (e) {
    reportError(e, true);
    hideLoading();
    return;
  }
  game?.dispose();
  game = null;
  lastSetup = setup;
  await preloadHd(E, setup); // the match's factions' baked models (procedural meanwhile / on failure)
  setup = withPortableFlag(setup); // multiplayer and ranked runs: the same maths on every machine, recorded with the game
  try {
    await setPortable(portableMathFor(setup));
  } catch (e) { // (its chunk failed to load: offline on an old cache, or a deploy that removed it)
    reportError(e, true);
    hideLoading();
    return;
  }
  try {
    game = new E.Game(setup, audio, {
      onPause: () => menus.showPause(game!),
      onEnd: (g, won) => {
        if (g.setup.replay) return; // replay playback shows its own end panel
        g.paused = true;
        if (E.modesOnEnd(g, won)) return; // challenge result screen · mode medals
        if (g.setup.conquest && isWorldBattle(g.setup.conquest)) { // World Conquest: the battle's results, then the globe
          const conquest = g.setup.conquest;
          void import('./ui/world').then(({ showWorldAfterBattle }) => showWorldAfterBattle(g.world, conquest, {
            play: (k) => audio.play(k),
            onContinue: () => { audio.stopMusic(); openWorld(); },
            onMenu: () => { audio.stopMusic(); startDemo(); },
          })).catch((e) => reportError(e));
          return;
        }
        if (g.setup.conquest) { // the result goes back to the campaign: battle report, then the strategic map
          const conquest = g.setup.conquest;
          void import('./ui/conquest').then(({ showConquestAfterBattle }) => showConquestAfterBattle(g.world, conquest, {
            play: (k) => audio.play(k),
            onContinue: () => { audio.stopMusic(); startDemo(); menus.hide(); openConquest(); },
            onMenu: () => { audio.stopMusic(); startDemo(); },
          })).catch((e) => reportError(e));
          return;
        }
        const def = g.missionDef, res = g.missionResult;
        if (!def || !res) { menus.showEnd(g, won); E.offerMoments(g, won); return; } // "make this a challenge" offers
        // campaign / special operation: debrief with objectives, stars and the next mission
        const next = won && def.campaign !== 'special' ? campaignMissions(def.campaign).find((m) => m.index === def.index + 1) : undefined;
        void import('./ui/campaign').then(({ showDebrief }) => showDebrief(res, def, {
          onNext: next ? () => deployMission(next.id) : undefined,
          onRetry: () => deployMission(def.id),
          onMenu: () => { audio.stopMusic(); if (returnToEditor) { openEditorScreen(); return; } startDemo(); menus.hide(); openCampaign(); }, // playtests return to the editor
        })).catch((e) => reportError(e));
      },
      onProgress: (f, l) => setLoading(f, l),
    });
    applySettings(game, menus.settings);
    showModBadge(game.setup.mods); // "Modded" badge
    exposeDebug(game);
    (window as any).__debug = { construct: (t: string, x: number, y: number) => E.debugConstruct(game!.world, game!.local, t, x, y) };
    applyTestParams(E, game);
    await preloadHdWorld(E, game);
    // scanned terrain materials and HD trees in place before the first frame (bounded: a slow network starts anyway)
    await Promise.race([Promise.all([game.gfx.terrain.texturesReady, game.gfx.vegetation.hdReady]), new Promise<void>((r) => setTimeout(r, 8000))]);
    // watching a replay: playback controls, spectator HUD, seeking (backwards = restart + seek)
    if (setup.replay) (await import('./replay/playback')).attachPlayback(game, { restart: (s) => void startGame(s), exit: (toReplays) => { audio.stopMusic(); startDemo(); if (toReplays) menus.showReplays(); } }); // (the replay viewer: its own chunk)
    E.attachModes(game); // KOTH HUD, branch / challenge badge, moment tracking
    E.attachVariety(game); // mutators / dynamic difficulty strip, battlefield event radio, event and tech-structure markers
    if (setup.net && !setup.replay) (await import('./net/game-link')).attachNetMatch(game, { quit: () => { menus.hide(); audio.stopMusic(); startDemo(); }, play: (k) => audio.play(k) }); // a multiplayer match: lockstep, network status, desync dialog
    if (MULTIPLAYER && boardOfSetup(game.setup)) (await import('./net/leaderboard')).attachLeaderboard(game, { tainted: !!(params.get('scenario') || params.get('charge') || params.get('selfplay')), play: (k) => audio.play(k) }); // ranked runs
    game.start();
    if (!setup.replay) { void import('./ui/results').catch(() => {}); void import('./ui/clips').catch(() => {}); } // the end screen's chunks, ready before the match ends
  } catch (e) {
    reportError(e, true);
  }
  hideLoading();
}

/** URL testing hooks: scenario=base|battle, ff=seconds, charge=1, cam=x,y,dist, sel=army */
function applyTestParams(E: Engine, g: Game) {
  if (params.get('autostart')) g.gfx.dynamicResolution = false; // stable screenshots in tests
  const sc = params.get('scenario');
  if (sc) g.applyScenario(sc);
  if (params.get('charge')) E.chargeArmies(g.world);
  const ff = numParam('ff', 0, 0, 1800);
  if (ff > 0) g.fastForward(ff);
  const cam = params.get('cam');
  if (cam) {
    const [x, y, d] = cam.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) g.gfx.cam.jumpTo(x, y);
    if (d && Number.isFinite(d)) g.gfx.cam.dist = g.gfx.cam.targetDist = Math.min(200, Math.max(2, d));
  } else if (sc === 'battle') {
    const m = g.world.map;
    g.gfx.cam.jumpTo(m.w / 2, m.h / 2 + 2);
  }
  if (params.get('hour')) g.hours = numParam('hour', 12, 0, 24);
  const sp = params.get('selfplay');
  if (sp) g.world.ais.push(new E.AIController(g.world, g.local, sp as AIDifficulty));
  if (sc || params.get('charge') || sp) { g.recorder?.discard(); g.recorder = null; } // edited worlds can't be replayed
  if (params.get('speed')) g.speed = numParam('speed', 1, 0.1, 16);
  if (params.get('sel') === 'army') {
    for (const u of g.world.units) if (u.alive && u.owner === g.local && u.weapons.length) g.selection.add(u.id);
  }
}

/** Test / dev hook. Only exposed in dev builds or test runs, so a quit game isn't kept alive. */
function exposeDebug(g: Game | null) {
  if (import.meta.env.DEV || params.get('autostart') || params.get('debug')) { (window as any).__game = g; (window as any).__hdStatus = engineMod?.hdStatus; } // status for tests
}

/** Bumped by everything that replaces the menu backdrop, so a backdrop still waiting for the engine stays away. */
let demoToken = 0;

function startDemo() {
  game?.dispose();
  void setPortable(false);
  exposeDebug(null);
  game = null;
  returnToEditor = false;
  showModBadge(null);
  const token = ++demoToken;
  if (params.get('demo') !== '0') {
    // the menu is up at once; the backdrop battle joins it as soon as the engine has loaded
    void engine().then(async (E) => {
      await nextFrame(); // the menu paints first: building the backdrop battle holds the main thread for a moment
      if (token !== demoToken || game) return; // a match or the editor took over meanwhile
      try {
        game = createDemo(E); // the directed attract mode (src/share/attract.ts)
        exposeDebug(game);
        game.start();
      } catch (e) {
        console.warn('demo failed', e);
      }
    }, (e) => console.warn('engine failed to load', e));
  }
  menus.showMain();
  hideLoading();
}

/**
 * The menu backdrop: a directed battle (src/share/attract.ts) that a fresh battlefield replaces behind a
 * fade every few loops, without touching the menus. ?attract=0 keeps the old free-running AI battle.
 */
function createDemo(E: Engine): Game {
  if (params.get('attract') !== '0') {
    try {
      return createAttractDemo(E);
    } catch (e) {
      console.warn('attract mode failed, using the free-running backdrop', e);
    }
  }
  const tods: TimeOfDay[] = ['day', 'dusk', 'night'];
  const g = new E.Game({
    faction: 'allies', color: 0x3d7be0, opponents: [{ faction: 'soviet', difficulty: 'hard' }], mapSize: 64, water: 0.5, trees: 0.6, ore: 0.8,
    credits: 10000, startUnits: 'heavy', fog: false, timeOfDay: tods[Math.floor(Math.random() * 3)], quality: menus.settings.quality,
    seed: (Math.random() * 1e9) | 0, demo: true,
  }, audio, { onPause: () => {}, onEnd: () => {} });
  // fast-forward so the menu opens on an established battlefield
  for (let i = 0; i < 20 * 150; i++) { g.world.step(); g.world.events.length = 0; }
  return g;
}

function createAttractDemo(E: Engine): Game {
  const g: Game = E.createAttractGame({
    makeGame: (setup) => new E.Game(setup, audio, { onPause: () => {}, onEnd: () => {} }), quality: menus.settings.quality, tod: params.get('tod'), climate: params.get('climate'),
    rebuild: () => {
      if (game !== g) return; // a real match (or the editor) took over meanwhile
      g.dispose();
      game = null;
      try { game = createDemo(E); exposeDebug(game); game.start(); } catch (e) { console.warn('demo failed', e); }
    },
  });
  return g;
}

if (params.get('autostart') && params.get('conquest')) {
  // ?autostart=1&conquest=assault|capture|hold|defend|naval|boss[&seed=N&faction=soviet]: a conquest battle of a fresh run
  void import('./conquest/testing').then(async ({ runWithBattle }) => {
    const { run, setup } = runWithBattle(numParam('seed', 7, 0, 0x7fffffff) | 0, (params.get('faction') as Faction) ?? 'allies', params.get('conquest') as BattleKind);
    if (params.get('region')) await (await import('./maps/region-test')).useRegion(setup.battle, params.get('region')!); // &region=<id>: that World Conquest region's battlefield
    saveRun(run);
    deployConquest(setup);
  });
} else if (params.get('autostart')) {
  // Testing shortcut: ?autostart=1&faction=soviet&ai=hard&size=64&fog=0&tod=dusk&units=heavy&ceasefire=<minutes>|inf
  // plus map=<curated id> · mapcode=<code> · replay=<id>|latest (resolveTestSetup)
  void resolveTestSetup(params, {
    faction: (params.get('faction') as Faction) ?? 'allies',
    color: params.get('faction') === 'soviet' ? 0xd23a2c : 0x3d7be0,
    opponents: [{ faction: (params.get('enemy') as Faction) ?? (params.get('faction') === 'soviet' ? 'allies' : 'soviet'), difficulty: (params.get('ai') as AIDifficulty) ?? 'normal' }],
    mapSize: Math.round(numParam('size', 96, 32, 192) / 16) * 16, water: 0.5, trees: 0.5, ore: 0.6, credits: numParam('credits', 10000, 0, 1e6),
    startUnits: (params.get('units') as any) ?? 'light', fog: params.get('fog') !== '0', timeOfDay: (params.get('tod') as TimeOfDay) ?? 'day',
    quality: (params.get('q') as any) ?? menus.settings.quality, seed: numParam('seed', 1234, 0, 0x7fffffff) | 0,
    dayCycle: params.get('cycle') === '1', weather: params.get('wx') ?? 'clear', intro: params.get('intro') === '1', climate: params.get('climate') ?? 'temperate', mission: params.get('mission') ?? undefined,
    ceasefire: params.get('ceasefire') === 'inf' ? -1 : numParam('ceasefire', 0, 0, 600) || undefined, // build-up time
    // &rules=commander[&doctrine=<id>]: Commander rules (doctrines, command points, commander powers)
    ...(params.get('rules') === 'commander' ? { rules: 'commander' as const, doctrines: [params.get('doctrine')] } : {}),
    // &mut=<id,id>: mutators · &events=0: no battlefield events · &dyn=1: dynamic difficulty
    ...(params.get('mut') ? { mutators: params.get('mut')!.split(',').slice(0, 8) } : {}), ...(params.get('events') === '0' ? { events: false } : {}), ...(params.get('dyn') === '1' ? { dynamicDifficulty: true } : {}),
  }).then(startGame);
} else if (params.get('trailer')) {
  // ?trailer=1: the ~85 s trailer cut with title cards, recorded to WebM (src/share/trailer.ts)
  setLoading(0.5, tLoading('stage.loading'));
  void Promise.all([import('./share/trailer'), engine()]).then(([{ startTrailer }, E]) => {
    startTrailer({ audio, makeGame: (setup) => new E.Game(setup, audio, { onPause: () => {}, onEnd: () => {} }), quality: menus.settings.quality, setGame: (g) => { game = g; exposeDebug(g); }, exit: () => { location.href = location.pathname; } }, params);
    hideLoading();
  }).catch((e) => reportError(e, true));
} else {
  setLoading(0.5, tLoading('stage.loading'));
  // custom maps / missions are listed in the menus: load the editor library first (bounded wait)
  setTimeout(() => void Promise.race([initEditorStore(), new Promise((r) => setTimeout(r, 1500))]).finally(() => { startDemo(); openShare(); openInvite(); }), 30); // share links · invite links
}

// ?conquest=ui|fresh|mid[&seed=N&faction=soviet&cqdemo=new|select|preview|research|army|perks|perk|event|report|summary|threat] opens the campaign screen
if (params.get('conquest') && !params.get('autostart')) {
  const t0 = performance.now();
  const wait = async () => {
    if (!game && performance.now() - t0 < 4000) { setTimeout(wait, 100); return; }
    const { demoState, midCampaignRun } = await import('./conquest/testing');
    const seed = numParam('seed', 1953, 0, 0x7fffffff) | 0, fac = (params.get('faction') as Faction) ?? 'allies', demo = params.get('cqdemo') ?? undefined;
    const mode = params.get('conquest');
    if (mode === 'mid' || mode === 'fresh') {
      const run = midCampaignRun(seed, fac, mode === 'mid' ? numParam('turns', 6, 0, 40) : 0);
      if (demo) demoState(run, demo);
      saveRun(run);
    } else if (demo && loadRun()) {
      const run = loadRun()!;
      demoState(run, demo);
      saveRun(run);
    }
    menus.hide();
    openConquest(demo);
  };
  setTimeout(wait, 100);
}

// World Conquest: challenge links (#world=<seed>&home=…) and the test switch ?world=<screen> (new, options,
// fresh, attack, …: src/ui/world/index.ts runDemo) open the world screens once the main menu is up
if (worldLinkPending() && !params.get('autostart')) {
  const t0 = performance.now();
  const wait = () => { if (!menus.onMainMenu && performance.now() - t0 < 4000) { setTimeout(wait, 100); return; } openWorld(params.get('world') ?? undefined); };
  setTimeout(wait, 100);
}
window.addEventListener('hashchange', () => { if (/^#(?:.*&)?world=/.test(location.hash) && (!game || game.setup.demo)) openWorld(); });

// Share links (#share=…, src/share): loaded on demand, decoded as untrusted input, imported only after a confirmation.
function openShare() {
  if (!/[#&]share=/.test(location.hash)) return;
  void import('./share/open').then((m) => m.openShareLink({ start: (s) => void startGame(s), quality: () => menus.settings.quality, play: (k) => audio.play(k) })).catch((e) => reportError(e));
}
window.addEventListener('hashchange', openShare);

// The multiplayer lobby (src/ui/lobby.ts); invite links (#join=CODE) open it with the code filled in.
const lobbyHost: LobbyHost = {
  play: (k) => audio.play(k),
  quality: () => menus.settings.quality,
  back: () => menus.showMain(),
  start: (s) => void startGame(s),
};
function openInvite() {
  if (!MULTIPLAYER) return; // (a build without online play ignores invite links)
  const code = /[#&]join=([A-Za-z0-9]{6})/.exec(location.hash)?.[1];
  if (!code || (game && !game.setup.demo)) return;
  menus.hide();
  void import('./ui/lobby').then((m) => m.openLobby(lobbyHost, { join: m.inviteFromHash() ?? undefined })).catch((e) => reportError(e));
}
/** Portable maths for the running game (src/net/dmath.ts, loaded the first time it is needed). */
let dmath: typeof import('./net/dmath') | null = null;
async function setPortable(on: boolean) {
  if (on && !dmath) dmath = await import('./net/dmath');
  dmath?.setGamePortableMath(on);
}
window.addEventListener('hashchange', openInvite);

// Offline support: the service worker announces a downloaded update; maybeApplyUpdate (above) applies it on the main menu.
void registerServiceWorker({ onUpdateReady: (apply) => { applyUpdate = apply; maybeApplyUpdate(); } });
