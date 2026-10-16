import './ui/styles.css';
import { AudioSystem } from './audio';
import { Game, type GameSetup } from './game';
import { Menus, type Settings } from './ui/menu';
import { showCampaign, showDebrief } from './ui/campaign';
import { campaignMissions } from './missions';
import { showProfile } from './ui/profile';
import { showChallenges } from './ui/challenges';
import { setToastSound } from './meta';
import { readSave, type SaveData } from './sim/save';
import { GAME_TITLE } from './config';
import type { Faction } from './data/rules';
import type { AIDifficulty } from './sim/ai';
import type { TimeOfDay } from './render/renderer';
import { chargeArmies, debugConstruct } from './debug';
import { AIController } from './sim/ai';
import { installErrorBoundary, reportError } from './platform/errors';
import { checkSupport, renderUnsupported } from './platform/webgl';
import { detectQuality } from './platform/gpu';
import { registerServiceWorker } from './platform/pwa';
import { enterFullscreen } from './platform/fullscreen';
import { hdModelsWanted, loadSettings, saveSettings } from './ui/settings';
import { hdModelsEnabled, hdStatus, prefetchHdFiles, setHdModels } from './render/models/hd'; // [HD]
import { preloadHd as preloadHdModelsFor } from './render/models'; // [HD]
import { attachPlayback } from './replay/playback'; // [D] replays
import { resolveTestSetup } from './replay/launch';
import { customMissionSetup, initEditorStore } from './editor/store'; // [EDIT]
import { activeModSet, showModBadge, showMods } from './mods'; // [EDIT] mods
import { attachModes, modesOnEnd, offerMoments, setModeHost } from './modes/ui'; // [MODES] KOTH, challenges, branches, co-op
import { saveRun, loadRun, type BattleKind, type ConquestSetup } from './conquest'; // [CONQ]

document.title = GAME_TITLE;
const support = checkSupport(); // before anything creates a WebGLRenderer
if (!support.ok) {
  document.getElementById('loading')?.remove();
  renderUnsupported(support);
  throw new Error(`WebGL 2 unavailable: ${support.reason}`);
}
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
/** [EDIT] A playtest started from the editor: leaving the match goes back to the editor. */
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

const menus = new Menus(audio, {
  start: (setup) => void startGame(setup),
  resume: () => game?.resume(),
  // same map, same opponents, from the beginning (a loaded game restarts its map from scratch)
  restart: (newMap) => { if (lastSetup) void startGame({ ...lastSetup, load: undefined, intro: false, ...(newMap && !lastSetup.branch && !lastSetup.challenge ? { seed: (Math.random() * 1e9) | 0 } : {}) }); }, // [MODES] a branch / challenge restarts from its moment
  quit: () => { if (game?.setup.conquest && !game.world.gameOver) game.save('auto'); /* [CONQ] the campaign can resume this battle */ if (applyUpdate) return applyUpdate(); audio.stopMusic(); if (returnToEditor) { openEditorScreen(); return; } startDemo(); }, // [EDIT] playtests return to the editor
  settingsChanged: (s: Settings) => { if (game) applySettings(game, s); },
  openCampaign: () => openCampaign(),
  openConquest: () => openConquest(), // [CONQ]
  conquestInfo: () => { const r = loadRun(); return r && r.status === 'active' ? `Turn ${r.turn}` : null; }, // [CONQ]
  openChallenges: () => openChallenges(),
  openProfile: () => openProfile(),
  openBootCamp: () => deployMission('bootcamp'),
  openEditor: () => openEditorScreen(), // [EDIT]
  openMods: () => showMods({ play: (k) => audio.play(k), onBack: () => menus.showMain() }), // [EDIT]
  continueInfo: () => {
    const s = latestSave();
    return s ? { label: s.game?.label ?? 'Saved game', savedAt: s.savedAt } : null;
  },
  continueGame: () => {
    const s = latestSave();
    if (s?.game?.setup) void startGame({ ...s.game.setup, load: s, intro: false, quality: menus.settings.quality });
  },
  saveGame: () => game?.save('manual') ?? false,
});
// [MODES] how mode screens (challenges, result, end-screen offers) start games and return to the menus
setModeHost({ start: (s) => void startGame(s), quality: () => menus.settings.quality, toMenu: () => { audio.stopMusic(); startDemo(); }, openChallenges: () => openChallenges(), openReplays: () => menus.showReplays() });

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
  // [EDIT] a custom mission (editor) travels with its content, so saves rebuild it even if it is edited later
  const custom = customMissionSetup(id) ?? (lastSetup?.mission === id && lastSetup.customMission ? { customMission: lastSetup.customMission, customMap: lastSetup.customMap } : null);
  void startGame({
    faction: 'allies', color: 0x3d7be0, opponents: [], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6, credits: 5000,
    startUnits: 'mcv', fog: true, timeOfDay: 'day', quality: menus.settings.quality, seed: 0, mission: id, intro: true, ...(custom ?? {}),
  });
}

/** [EDIT] Map & mission editor (the menu backdrop battle is stopped while it is open). */
function openEditorScreen() {
  returnToEditor = false;
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
  showCampaign({ play: (k) => audio.play(k), onBack: () => menus.showMain(), onDeploy: (id) => deployMission(id) });
}

/** [CONQ] Conquest: the roguelite campaign across Europe (src/ui/conquest.ts). */
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

/** [CONQ] Start a conquest battle (the mission is built from the frozen battle spec). */
function deployConquest(c: ConquestSetup) {
  void startGame({
    faction: c.battle.faction, color: c.battle.faction === 'allies' ? 0x3d7be0 : 0xd23a2c, opponents: [], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6, credits: 5000,
    startUnits: 'mcv', fog: true, timeOfDay: 'day', quality: menus.settings.quality, seed: 0, mission: 'conquest', conquest: c, intro: true,
  });
}

function openChallenges() {
  showChallenges({ play: (k) => audio.play(k), onBack: () => menus.showMain(), onProfile: () => openProfile(), onDeploy: (id) => deployMission(id) });
}

function openProfile() {
  showProfile({ play: (k) => audio.play(k), onBack: () => menus.showMain() });
}

function applySettings(g: Game, s: Settings) {
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
 * [HD] Load the baked HD models of the match's factions on the loading screen (both factions when they are
 * not known up front: missions, saves, replays, random opponents). Bounded: a slow network starts the match
 * with procedural models rather than waiting.
 */
async function preloadHd(setup: GameSetup): Promise<void> {
  const on = hdModelsWanted(menus.settings, setup.quality);
  setHdModels(on, setup.quality === 'high' ? 'high' : 'medium');
  if (!on) return;
  const both = !!(setup.mission || setup.load || setup.replay || setup.conquest || setup.allies?.length) || setup.opponents.some((o) => o.faction === 'random');
  const facs = new Set<Faction>(both ? ['soviet', 'allies'] : [setup.faction, ...setup.opponents.map((o) => o.faction as Faction)]);
  setLoading(0.02, 'Loading HD models');
  await Promise.race([
    preloadHdModelsFor([...facs], [], (d, n) => setLoading(0.02 + (0.06 * d) / Math.max(1, n), 'Loading HD models')),
    new Promise<void>((r) => setTimeout(r, 20000)),
  ]);
}

/**
 * [HD] Everything the battle starts with (structures, start units, scenario / mission / save content) loads
 * before the first frame, so none of it has to swap from procedural later; the rest loads lazily
 * (EntityRenderer: structures when placed or seen, units when first produced).
 */
async function preloadHdWorld(g: Game): Promise<void> {
  if (!hdModelsEnabled()) return;
  const types: [string, Faction][] = [];
  for (const e of [...g.world.buildings, ...g.world.units]) if (e.alive) types.push([e.type.id, e.owner.faction]);
  setLoading(0.96, 'Loading HD models');
  await Promise.race([preloadHdModelsFor([], types), new Promise<void>((r) => setTimeout(r, 15000))]);
  g.warmHd();
  prefetchHdFiles([...new Set(g.world.players.map((p) => p.faction))]); // offline: the service worker caches the rest
}

async function startGame(setup: GameSetup) {
  if (menus.settings.skipIntro && !params.get('autostart')) setup = { ...setup, intro: false };
  // [EDIT] a new match runs with the enabled mods (loads and replays keep the mods they were recorded with)
  if (!setup.load && !setup.replay && !setup.demo && !('mods' in setup)) setup = { ...setup, mods: activeModSet() ?? undefined };
  // still inside the Deploy click, so the browser allows it
  if (menus.settings.fullscreen !== false && !params.get('autostart')) void enterFullscreen();
  menus.hide();
  setLoading(0, 'Initialising');
  await nextFrame();
  game?.dispose();
  game = null;
  lastSetup = setup;
  await preloadHd(setup); // [HD] the match's factions' baked models (procedural meanwhile / on failure)
  try {
    game = new Game(setup, audio, {
      onPause: () => menus.showPause(game!),
      onEnd: (g, won) => {
        if (g.setup.replay) return; // [D] replay playback shows its own end panel
        g.paused = true;
        if (modesOnEnd(g, won)) return; // [MODES] challenge result screen · mode medals
        if (g.setup.conquest) { // [CONQ] the result goes back to the campaign: battle report, then the strategic map
          const conquest = g.setup.conquest;
          void import('./ui/conquest').then(({ showConquestAfterBattle }) => showConquestAfterBattle(g.world, conquest, {
            play: (k) => audio.play(k),
            onContinue: () => { audio.stopMusic(); startDemo(); menus.hide(); openConquest(); },
            onMenu: () => { audio.stopMusic(); startDemo(); },
          })).catch((e) => reportError(e));
          return;
        }
        const def = g.missionDef, res = g.missionResult;
        if (!def || !res) { menus.showEnd(g, won); offerMoments(g, won); return; } // [MODES] "make this a challenge" offers
        // campaign / special operation: debrief with objectives, stars and the next mission
        const next = won && def.campaign !== 'special' ? campaignMissions(def.campaign).find((m) => m.index === def.index + 1) : undefined;
        showDebrief(res, def, {
          onNext: next ? () => deployMission(next.id) : undefined,
          onRetry: () => deployMission(def.id),
          onMenu: () => { audio.stopMusic(); if (returnToEditor) { openEditorScreen(); return; } startDemo(); menus.hide(); openCampaign(); }, // [EDIT] playtests return to the editor
        });
      },
      onProgress: (f, l) => setLoading(f, l),
    });
    applySettings(game, menus.settings);
    showModBadge(game.setup.mods); // [EDIT] "Modded" badge
    exposeDebug(game);
    (window as any).__debug = { construct: (t: string, x: number, y: number) => debugConstruct(game!.world, game!.local, t, x, y) };
    applyTestParams(game);
    await preloadHdWorld(game); // [HD]
    // [D] watching a replay: playback controls, spectator HUD, seeking (backwards = restart + seek)
    if (setup.replay) attachPlayback(game, { restart: (s) => void startGame(s), exit: (toReplays) => { audio.stopMusic(); startDemo(); if (toReplays) menus.showReplays(); } });
    attachModes(game); // [MODES] KOTH HUD, branch / challenge badge, moment tracking
    game.start();
  } catch (e) {
    reportError(e, true);
  }
  hideLoading();
}

/** URL testing hooks: scenario=base|battle, ff=seconds, charge=1, cam=x,y,dist, sel=army */
function applyTestParams(g: Game) {
  if (params.get('autostart')) g.gfx.dynamicResolution = false; // stable screenshots in tests
  const sc = params.get('scenario');
  if (sc) g.applyScenario(sc);
  if (params.get('charge')) chargeArmies(g.world);
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
  if (sp) g.world.ais.push(new AIController(g.world, g.local, sp as AIDifficulty));
  if (sc || params.get('charge') || sp) { g.recorder?.discard(); g.recorder = null; } // [D] edited worlds can't be replayed
  if (params.get('speed')) g.speed = numParam('speed', 1, 0.1, 16);
  if (params.get('sel') === 'army') {
    for (const u of g.world.units) if (u.alive && u.owner === g.local && u.weapons.length) g.selection.add(u.id);
  }
}

/** Test / dev hook. Only exposed in dev builds or test runs, so a quit game isn't kept alive. */
function exposeDebug(g: Game | null) {
  if (import.meta.env.DEV || params.get('autostart') || params.get('debug')) { (window as any).__game = g; (window as any).__hdStatus = hdStatus; } // [HD] status for tests
}

function startDemo() {
  game?.dispose();
  exposeDebug(null);
  game = null;
  returnToEditor = false; // [EDIT]
  showModBadge(null); // [EDIT]
  if (params.get('demo') !== '0') {
    try {
      const tods: TimeOfDay[] = ['day', 'dusk', 'night'];
      game = new Game({
        faction: 'allies', color: 0x3d7be0, opponents: [{ faction: 'soviet', difficulty: 'hard' }], mapSize: 64, water: 0.5, trees: 0.6, ore: 0.8,
        credits: 10000, startUnits: 'heavy', fog: false, timeOfDay: tods[Math.floor(Math.random() * 3)], quality: menus.settings.quality,
        seed: (Math.random() * 1e9) | 0, demo: true,
      }, audio, { onPause: () => {}, onEnd: () => {} });
      // fast-forward so the menu opens on an established battlefield
      for (let i = 0; i < 20 * 150; i++) { game.world.step(); game.world.events.length = 0; }
      exposeDebug(game);
      game.start();
    } catch (e) {
      console.warn('demo failed', e);
    }
  }
  menus.showMain();
  hideLoading();
}

if (params.get('autostart') && params.get('conquest')) {
  // [CONQ] ?autostart=1&conquest=assault|capture|hold|defend|naval|boss[&seed=N&faction=soviet]: a conquest battle of a fresh run
  void import('./conquest/testing').then(({ runWithBattle }) => {
    const { run, setup } = runWithBattle(numParam('seed', 7, 0, 0x7fffffff) | 0, (params.get('faction') as Faction) ?? 'allies', params.get('conquest') as BattleKind);
    saveRun(run);
    deployConquest(setup);
  });
} else if (params.get('autostart')) {
  // Testing shortcut: ?autostart=1&faction=soviet&ai=hard&size=64&fog=0&tod=dusk&units=heavy&ceasefire=<minutes>|inf
  // [D] plus map=<curated id> · mapcode=<code> · replay=<id>|latest (resolveTestSetup)
  void resolveTestSetup(params, {
    faction: (params.get('faction') as Faction) ?? 'allies',
    color: params.get('faction') === 'soviet' ? 0xd23a2c : 0x3d7be0,
    opponents: [{ faction: (params.get('enemy') as Faction) ?? (params.get('faction') === 'soviet' ? 'allies' : 'soviet'), difficulty: (params.get('ai') as AIDifficulty) ?? 'normal' }],
    mapSize: Math.round(numParam('size', 96, 32, 192) / 16) * 16, water: 0.5, trees: 0.5, ore: 0.6, credits: numParam('credits', 10000, 0, 1e6),
    startUnits: (params.get('units') as any) ?? 'light', fog: params.get('fog') !== '0', timeOfDay: (params.get('tod') as TimeOfDay) ?? 'day',
    quality: (params.get('q') as any) ?? menus.settings.quality, seed: numParam('seed', 1234, 0, 0x7fffffff) | 0,
    dayCycle: params.get('cycle') === '1', weather: params.get('wx') ?? 'clear', intro: params.get('intro') === '1', climate: params.get('climate') ?? 'temperate', mission: params.get('mission') ?? undefined,
    ceasefire: params.get('ceasefire') === 'inf' ? -1 : numParam('ceasefire', 0, 0, 600) || undefined, // build-up time
  }).then(startGame);
} else {
  setLoading(0.5, 'Loading');
  // [EDIT] custom maps / missions are listed in the menus: load the editor library first (bounded wait)
  setTimeout(() => void Promise.race([initEditorStore(), new Promise((r) => setTimeout(r, 1500))]).finally(startDemo), 30);
}

// [CONQ] ?conquest=ui|fresh|mid[&seed=N&faction=soviet&cqdemo=new|select|preview|research|army|perks|perk|event|report|summary|threat] opens the campaign screen
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

// Offline support. A downloaded update is applied only between matches (never mid-game).
let applyUpdate: (() => void) | null = null;
void registerServiceWorker({ onUpdateReady: (apply) => { applyUpdate = apply; if (!game || game.setup.demo) apply(); } });
