import './ui/styles.css';
import { AudioSystem } from './audio';
import { Game, type GameSetup } from './game';
import { Menus, type Settings } from './ui/menu';
import { showCampaign } from './ui/campaign';
import { readSave, type SaveData } from './sim/save';
import { GAME_TITLE } from './config';
import type { Faction } from './data/rules';
import type { AIDifficulty } from './sim/ai';
import type { TimeOfDay } from './render/renderer';
import { chargeArmies, debugConstruct } from './debug';
import { AIController } from './sim/ai';

document.title = GAME_TITLE;
const params = new URLSearchParams(location.search);
const audio = new AudioSystem();
let game: Game | null = null;
let lastSetup: GameSetup | null = null;
const loading = document.getElementById('loading')!;
const loadingBar = loading.querySelector('.bar div') as HTMLElement;
const loadingLabel = loading.querySelector('.label') as HTMLElement;

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
  restart: () => { if (lastSetup) void startGame({ ...lastSetup, seed: (Math.random() * 1e9) | 0 }); },
  quit: () => { audio.stopMusic(); startDemo(); },
  settingsChanged: (s: Settings) => { if (game) applySettings(game, s); },
  openCampaign: () => openCampaign(),
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

function latestSave(): SaveData | null {
  const a = readSave('auto'), m = readSave('manual');
  if (!a) return m;
  if (!m) return a;
  return a.savedAt > m.savedAt ? a : m;
}

// keep progress when the tab is closed mid-game
window.addEventListener('beforeunload', () => { if (game && !game.setup.demo) game.save('auto'); });

/** Campaign / special operations screen. */
function openCampaign() {
  showCampaign({
    play: (k) => audio.play(k),
    onBack: () => menus.showMain(),
    onDeploy: (id) => void startGame({
      faction: 'allies', color: 0x3d7be0, opponents: [], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6, credits: 5000,
      startUnits: 'mcv', fog: true, timeOfDay: 'day', quality: menus.settings.quality, seed: 0, mission: id, intro: true,
    }),
  });
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

async function startGame(setup: GameSetup) {
  menus.hide();
  setLoading(0, 'Initialising');
  await nextFrame();
  game?.dispose();
  game = null;
  lastSetup = setup;
  try {
    game = new Game(setup, audio, {
      onPause: () => menus.showPause(game!),
      onEnd: (g, won) => { g.paused = true; menus.showEnd(g, won); },
      onProgress: (f, l) => setLoading(f, l),
    });
    applySettings(game, menus.settings);
    (window as any).__game = game;
    (window as any).__debug = { construct: (t: string, x: number, y: number) => debugConstruct(game!.world, game!.local, t, x, y) };
    applyTestParams(game);
    game.start();
  } catch (e) {
    console.error(e);
    alert('Failed to start the game: ' + (e as Error).message);
  }
  hideLoading();
}

/** URL testing hooks: scenario=base|battle, ff=seconds, charge=1, cam=x,y,dist, sel=army */
function applyTestParams(g: Game) {
  if (params.get('autostart')) g.gfx.dynamicResolution = false; // stable screenshots in tests
  const sc = params.get('scenario');
  if (sc) g.applyScenario(sc);
  if (params.get('charge')) chargeArmies(g.world);
  const ff = +(params.get('ff') ?? 0);
  if (ff > 0) g.fastForward(ff);
  const cam = params.get('cam');
  if (cam) {
    const [x, y, d] = cam.split(',').map(Number);
    g.gfx.cam.jumpTo(x, y);
    if (d) g.gfx.cam.dist = g.gfx.cam.targetDist = d;
  } else if (sc === 'battle') {
    const m = g.world.map;
    g.gfx.cam.jumpTo(m.w / 2, m.h / 2 + 2);
  }
  if (params.get('hour')) g.hours = +params.get('hour')!;
  const sp = params.get('selfplay');
  if (sp) g.world.ais.push(new AIController(g.world, g.local, sp as AIDifficulty));
  if (params.get('speed')) g.speed = +params.get('speed')!;
  if (params.get('sel') === 'army') {
    for (const u of g.world.units) if (u.alive && u.owner === g.local && u.weapons.length) g.selection.add(u.id);
  }
}

function startDemo() {
  game?.dispose();
  game = null;
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
      (window as any).__game = game;
      game.start();
    } catch (e) {
      console.warn('demo failed', e);
    }
  }
  menus.showMain();
  hideLoading();
}

if (params.get('autostart')) {
  // Testing shortcut: ?autostart=1&faction=soviet&ai=hard&size=64&fog=0&tod=dusk&units=heavy
  void startGame({
    faction: (params.get('faction') as Faction) ?? 'allies',
    color: params.get('faction') === 'soviet' ? 0xd23a2c : 0x3d7be0,
    opponents: [{ faction: (params.get('enemy') as Faction) ?? (params.get('faction') === 'soviet' ? 'allies' : 'soviet'), difficulty: (params.get('ai') as AIDifficulty) ?? 'normal' }],
    mapSize: +(params.get('size') ?? 96), water: 0.5, trees: 0.5, ore: 0.6, credits: +(params.get('credits') ?? 10000),
    startUnits: (params.get('units') as any) ?? 'light', fog: params.get('fog') !== '0', timeOfDay: (params.get('tod') as TimeOfDay) ?? 'day',
    quality: (params.get('q') as any) ?? menus.settings.quality, seed: +(params.get('seed') ?? 1234),
    dayCycle: params.get('cycle') === '1', weather: params.get('wx') ?? 'clear', intro: params.get('intro') === '1', climate: params.get('climate') ?? 'temperate', mission: params.get('mission') ?? undefined,
  });
} else {
  setLoading(0.5, 'Loading');
  setTimeout(startDemo, 30);
}
