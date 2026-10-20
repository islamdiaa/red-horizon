import { GAME_TITLE, TEAM_COLORS, VERSION } from '../config';
import type { Faction } from '../data/rules';
import { AI_DIFFICULTIES, type AIDifficulty } from '../sim/ai';
import type { Quality, TimeOfDay } from '../render/renderer';
import { formatTime } from '../core/util';
import type { Game, GameSetup } from '../game'; // (types only: the engine loads after the menu)
import type { AudioSystem } from '../audio';
import { ICONS, alliedEmblem, medalSvg, rankBadge, sovietEmblem, type MedalTier } from './icons';
import { UiSound, bindTilt, countUp, el as h, esc, hexColor, replay as replayAnim } from './dom';
import { Embers } from './embers';
import { initLoadingScreen } from './loading';
import { applyUiSettings, loadSettings, modelDetailOf, saveSettings, type ModelDetail, type Settings } from './settings'; // model detail
import { clampUiScale, focusTrap, subtitleSizeOf, type SubtitleSize, type TeamPalette } from './a11y'; // accessibility settings
import { groupModLabel, groupMods, keysLabel, type ActionId } from './keymap';
import { buildKeysPanel } from './a11y-controls';
import { copyDiagnostics } from './a11y-diagnostics';
import { ACTION_TEXT, ARIA_TEXT, CONTROLS_TEXT, GROUP_TEXT, SETTINGS_TEXT } from './a11y-strings';
import { offlineContentRows } from './offline-setting';
import { dailyPending, picto, rankBadge as commanderBadge } from '../meta';
import { mountSessionCard } from './session-card'; // session goals on the main menu
import { opponentLevel, resolveRivalOpponent, rivalChip, setOpponentKind } from './rivals'; // rivals
import { dynamicDefault } from '../modes/difficulty';
import { CURATED_MAPS, getMapDef, loadCuratedMap } from '../maps';
import { decodeMapCode, encodeMapCode, generatorOptions, mapCodeForSetup, normaliseParams, type GenParams } from '../maps/code';
import { mapPreviewUrl } from '../maps/preview';
import { generateMap } from '../sim/mapgen';
import type { GameMap } from '../sim/map';
import { fitOpponents, playbackSetup } from '../replay/launch';
import { MAX_REPLAYS, type ReplayData } from '../replay/format';
import { deleteReplay, exportReplay, importReplayFile, listReplays, replayMapName } from '../replay/store';
import { KOTH_MINUTES } from '../modes/koth';
import { CEASEFIRE_CHOICES } from '../sim/ceasefire';
import { loadProgress } from '../missions/progress';
import { customMaps, isCustomMapId } from '../maps/custom'; // editor maps in the picker
import { enabledModIds } from '../mods/store';
import { activeModsChip } from '../mods';
import { quickBattleSetup, rulesTabs } from './variety'; // rules tab, mutators, Quick Battle
import { DOCTRINES, doctrinesFor, doctrineUnlocked } from '../sim/doctrine'; // Quick Battle doctrine
import { LANGS, LANG_NAMES, dt, fmtDateTime, fmtMoney, fmtPct, languagePref, resolvePref, setLanguage, trSource, type LangPref } from '../i18n/core'; // interface language
import tCommon from '../i18n/en/common';
import tMenu from '../i18n/en/menu';
import tSettings from '../i18n/en/settings';

export { loadSettings, saveSettings, type Settings };

const SETUP_KEY = 'rh.setup';

export type Weather = 'auto' | 'clear' | 'rain' | 'storm' | 'snow' | 'fog' | 'dust';
export type Climate = 'temperate' | 'winter' | 'desert';

/** Extra skirmish options the renderer picks up (merged into the GameSetup the menu builds). */
export interface AtmosphereSetup {
  weather?: Weather;
  climate?: Climate;
  dayCycle?: boolean;
}

interface SkirmishPrefs {
  faction: Faction;
  color: number;
  opponents: { faction: Faction | 'random'; difficulty: AIDifficulty; rivalId?: string }[]; // rival id
  mapSize: number;
  water: number;
  trees: number;
  ore: number;
  credits: number;
  startUnits: 'mcv' | 'light' | 'heavy';
  fog: boolean;
  timeOfDay: TimeOfDay;
  weather: Weather;
  climate: Climate;
  dayCycle: boolean;
  /** Curated map id (undefined = generated battlefield). */
  mapId?: string;
  /** Seed of the generated battlefield shown in the panel (its map code). */
  seed?: number;
  /** Keep the same generated map for the next match (a pasted code locks it). */
  lockSeed?: boolean;
  /** King of the Hill: minutes of hill time to win (0 / undefined = classic). */
  koth?: number;
  /** Build-up time: minutes of ceasefire at the start, -1 = unlimited, 0 / undefined = off (classic modes only). */
  ceasefire?: number;
  /** Rules (default Commander), mutators, battlefield events (default on), dynamic difficulty, doctrine. */
  rules?: 'classic' | 'commander';
  mutators?: string[];
  events?: boolean;
  dynamicDifficulty?: boolean;
  doctrine?: string | null;
}

function loadPrefs(): SkirmishPrefs {
  const def: SkirmishPrefs = {
    faction: 'allies', color: TEAM_COLORS[0], opponents: [{ faction: 'soviet', difficulty: 'recruit' }], // (a fresh profile starts gently, as Quick Battle does)
    mapSize: 96, water: 0.5, trees: 0.5, ore: 0.6, credits: 10000, startUnits: 'light', fog: true, timeOfDay: 'day',
    weather: 'auto', climate: 'temperate', dayCycle: true,
    rules: 'commander', events: true,
  };
  try {
    const prefs: SkirmishPrefs = { ...def, ...JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') };
    if (!(CEASEFIRE_CHOICES as readonly number[]).includes(prefs.ceasefire ?? 0)) prefs.ceasefire = undefined;
    return prefs;
  } catch {
    return def;
  }
}

const randomSeed = () => Math.floor(Math.random() * 1e9);

/** A climate's display name. */
const climateName = (c: string): string => tMenu(c === 'winter' ? 'skirmish.climateWinter' : c === 'desert' ? 'skirmish.climateDesert' : 'skirmish.climateTemperate');
/** A map's name, description and tags in the interface language (curated maps; editor maps keep their author's text). */
const mapName = (m: { id: string; name: string }): string => (isCustomMapId(m.id) ? m.name : dt('map', m.id, 'name', m.name));
const mapDesc = (m: { id: string; desc: string }): string => (isCustomMapId(m.id) ? m.desc : dt('map', m.id, 'desc', m.desc));
const mapTags = (m: { id: string; tags?: readonly string[] }): string[] => (m.tags ?? []).map((t, i) => (isCustomMapId(m.id) ? t : dt('map', m.id, `tags.${i}`, t)));
/** "64×64 · 2 players · Winter". */
const mapMeta = (size: number, players: number, climate: string): string => tMenu('skirmish.mapMeta', { size, players, climate: climateName(climate) });
/** The Back button of the sub-screens. */
const backButton = (): HTMLElement => h('button', 'btn btn-back', `${ICONS.chevL}<span>${tCommon.html('back')}</span><kbd>${tCommon.html('keys.esc')}</kbd>`);

/** Start-marker colours for previews: the player's colour first, then the AI colours in game order. */
function startColors(own: number, players: number): string[] {
  const used = new Set([own]);
  const out = [hexColor(own)];
  for (let i = 1; i < players; i++) {
    const c = TEAM_COLORS.find((x) => !used.has(x))!;
    used.add(c);
    out.push(hexColor(c));
  }
  return out;
}

/** The generated map for these parameters, with start 1 = the player's base (as the game orders them). */
function previewGenerated(p: GenParams): GameMap {
  const map = generateMap(generatorOptions(p));
  map.climate = p.climate;
  if (p.seed & 2) map.startPositions.reverse();
  return map;
}

function copyText(text: string) {
  try { void navigator.clipboard?.writeText(text); } catch { /* clipboard blocked */ }
}

function bootCampDone(): boolean {
  try { return !!loadProgress()['bootcamp']?.completed; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
type Opt<T> = [T, string, string?]; // value, label (HTML: escape translations, e.g. tX.html()), icon

function seg<T extends string | number | boolean>(options: Opt<T>[], value: T, onChange: (v: T) => void, cls = ''): HTMLElement {
  const box = h('div', 'seg ' + cls);
  box.setAttribute('role', 'group');
  box.style.setProperty('--n', String(options.length));
  const thumb = h('span', 'seg-thumb');
  box.appendChild(thumb);
  const place = (i: number) => { thumb.style.transform = `translateX(${i * 100}%)`; box.dataset.i = String(i); };
  options.forEach(([v, label, icon], i) => {
    const b = h('button', v === value ? 'on' : '', `${icon ?? ''}<span>${label}</span>`);
    b.dataset.v = String(v);
    b.setAttribute('aria-pressed', String(v === value));
    b.onclick = () => {
      for (const c of box.querySelectorAll('button')) { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); }
      b.classList.add('on');
      b.setAttribute('aria-pressed', 'true');
      place(i);
      onChange(v);
    };
    box.appendChild(b);
  });
  place(Math.max(0, options.findIndex(([v]) => v === value)));
  return box;
}

function stepper<T extends string>(options: Opt<T>[], value: T, onChange: (v: T) => void): HTMLElement {
  const box = h('div', 'stepper');
  let i = Math.max(0, options.findIndex(([v]) => v === value));
  const prev = h('button', 'st-arrow', ICONS.chevL);
  const next = h('button', 'st-arrow', ICONS.chevR);
  prev.setAttribute('aria-label', ARIA_TEXT.previous);
  next.setAttribute('aria-label', ARIA_TEXT.next);
  const mid = h('div', 'st-mid');
  const dots = h('div', 'st-dots', options.map(() => '<i></i>').join(''));
  const render = (dir: number) => {
    const [, label, icon] = options[i];
    mid.innerHTML = `<span class="st-val ${dir > 0 ? 'from-r' : dir < 0 ? 'from-l' : ''}">${icon ?? ''}<b>${label}</b></span>`;
    dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
  };
  const go = (d: number) => { i = (i + d + options.length) % options.length; render(d); onChange(options[i][0]); };
  prev.onclick = () => go(-1);
  next.onclick = () => go(1);
  mid.onclick = () => go(1);
  box.append(prev, mid, next, dots);
  render(0);
  return box;
}

function toggle(value: boolean, onChange: (v: boolean) => void): HTMLButtonElement {
  const b = h('button', 'toggle' + (value ? ' on' : ''), '<i></i>');
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(value));
  b.onclick = () => {
    value = !value;
    b.classList.toggle('on', value);
    b.setAttribute('aria-checked', String(value));
    onChange(value);
  };
  return b;
}

/** A 0–1 slider shown in percent; `range` makes it min–max (the fill still spans the track) and `onCommit` waits for release. */
function slider(value: number, onChange: (v: number) => void, range?: { min: number; max: number; step: number; onCommit?: boolean }): HTMLElement {
  const wrap = h('div', 'slider-wrap');
  const s = h('input', 'slider') as HTMLInputElement;
  s.type = 'range';
  const lo = range?.min ?? 0, hi = range?.max ?? 1;
  s.min = String(lo); s.max = String(hi); s.step = String(range?.step ?? 0.01);
  s.value = String(value);
  const out = h('span', 'sv');
  out.setAttribute('aria-hidden', 'true');
  const sync = () => {
    s.style.setProperty('--p', `${Math.round(((+s.value - lo) / (hi - lo)) * 100)}%`);
    out.textContent = fmtPct(Math.round(+s.value * 100) / 100);
    s.setAttribute('aria-valuetext', out.textContent);
  };
  if (range?.onCommit) { s.oninput = sync; s.onchange = () => { sync(); onChange(+s.value); }; } // (resizing the UI under the pointer mid-drag)
  else s.oninput = () => { sync(); onChange(+s.value); };
  sync();
  wrap.append(s, out);
  return wrap;
}

/** A labelled control (`label` is HTML). */
function field(label: string, icon: string, control: HTMLElement, cls = ''): HTMLElement {
  const f = h('div', 'field ' + cls);
  f.append(h('label', '', `${icon}<span>${label}</span>`), control);
  return f;
}

let rowIds = 0;
/** A settings row (`title` and `sub` are HTML). */
function settingRow(icon: string, title: string, sub: string, control: HTMLElement): HTMLElement {
  const r = h('div', 'set-row');
  const id = `set-${++rowIds}`;
  r.append(h('span', 'set-l', `<span class="set-ic">${icon}</span><span><b id="${id}">${title}</b>${sub ? `<small id="${id}-d">${sub}</small>` : ''}</span>`), control);
  // the control (or each control inside it) is named by the row title for screen readers
  const target = control.matches('button, input, select') ? control : control.querySelector<HTMLElement>('input, select') ?? control;
  const named = target.matches('button') && !!target.textContent?.trim(); // "Customise", "Copy": keep their own name
  target.setAttribute(named ? 'aria-describedby' : 'aria-labelledby', named ? `${id} ${sub ? `${id}-d` : ''}`.trim() : id);
  if (sub && !named) target.setAttribute('aria-describedby', `${id}-d`);
  return r;
}

function keycaps(k: string): string {
  return k.split(/( \+ | \/ | · )/).map((part) => (/^( \+ | \/ | · )$/.test(part) ? `<span class="kc-sep">${part.trim()}</span>` : `<kbd>${esc(part)}</kbd>`)).join('');
}

export interface MenuCallbacks {
  start(setup: GameSetup): void;
  resume(): void;
  /** Restart the match: the same map by default, a fresh one for "Play again". */
  restart(newMap?: boolean): void;
  quit(): void;
  settingsChanged(s: Settings): void;
  /** Open the campaign / special-ops screen. */
  openCampaign?(): void;
  /** Open the Conquest roguelite campaign; conquestInfo labels a campaign in progress (e.g. "Turn 5"). */
  openConquest?(): void;
  conquestInfo?(): string | null;
  /** Most recent saved game, if any. */
  continueInfo?(): { label: string; savedAt: number } | null;
  continueGame?(): void;
  /** Save the running game; returns success. */
  saveGame?(): boolean;
  /** Open the challenges hub (daily challenge, survival). Falls back to a built-in screen that deploys via start(). */
  openChallenges?(): void;
  /** Open the commander profile (rank, medals, history). Falls back to a built-in screen. */
  openProfile?(): void;
  /** Start the Boot Camp tutorial mission (shown as a nav item; highlighted until completed). */
  openBootCamp?(): void;
  /** Open the map & mission editor. */
  openEditor?(): void;
  /** Open the Mods screen. */
  openMods?(): void;
  /** Open the multiplayer lobby (src/ui/lobby.ts); after a match, back to its room. */
  openMultiplayer?(): void;
  backToLobby?(): void;
}

/** How the Settings screen was opened (see Menus.showSettings). */
interface SettingsOpts { inBattle?: boolean; rerender?: boolean }

export class Menus {
  private screen: HTMLElement | null = null;
  /** The Settings screen while it is up (rebuilt in place after a language switch). */
  private settingsScreen: HTMLElement | null = null;
  /** Language switches run one after another, so the last pick is the one in effect. */
  private langSwitch: Promise<unknown> = Promise.resolve();
  private langTicket = 0;
  /** Switches in flight, and a pick still waiting for the stepper to settle. */
  private langBusy = 0;
  private langPick: (() => void) | null = null;
  private langTimer = 0;
  private escAction: (() => void) | null = null;
  /** Keeps Tab inside the current screen (released when it goes). */
  private untrap: (() => void) | null = null;
  private sound: UiSound;
  settings = loadSettings();

  constructor(private audio: AudioSystem, private cb: MenuCallbacks) {
    this.sound = new UiSound(audio);
    applyUiSettings(this.settings);
    initLoadingScreen();
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.escAction || !this.screen) return;
      e.preventDefault();
      e.stopPropagation();
      this.escAction();
    });
  }

  hide() {
    const old = this.screen;
    this.screen = null;
    this.escAction = null;
    this.untrap?.();
    this.untrap = null;
    if (old) this.retire(old);
  }

  private retire(s: HTMLElement) {
    s.classList.add('leaving');
    s.style.pointerEvents = 'none';
    setTimeout(() => s.remove(), 420);
  }

  private open(cls: string, dim = true): HTMLElement {
    const old = this.screen;
    if (old) this.retire(old);
    this.escAction = null;
    const s = h('div', `screen ${cls}${dim ? ' dim' : ''}`);
    document.body.appendChild(s);
    this.screen = s;
    this.untrap?.();
    this.untrap = focusTrap(s, { initial: false, restore: false }); // Tab stays in the screen (the game HUD underneath is out of reach)
    this.sound.bind(s, 'button:not(:disabled), .faction-card, .sw');
    s.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button, .faction-card, .sw');
      if (t && !(t as HTMLButtonElement).disabled) this.sound.play('click');
    });
    return s;
  }

  private header(kicker: string, title: string, icon = ''): HTMLElement {
    return h('div', 'mp-head', `${icon ? `<span class="mp-ic">${icon}</span>` : ''}<div><small>${kicker}</small><h2>${title}</h2></div>`);
  }

  // ---------------------------------------------------------------------------
  showMain() {
    const s = this.open('main-screen', false);
    const prefs = loadPrefs();
    if (!prefs.lockSeed || prefs.seed === undefined) prefs.seed = randomSeed();
    if (prefs.mapId && !getMapDef(prefs.mapId)) prefs.mapId = undefined;
    document.body.classList.toggle('faction-soviet', prefs.faction === 'soviet');
    s.innerHTML = `<div class="mm-shade"></div><canvas class="mm-embers"></canvas><div class="mm-lines"></div>`;
    const embers = new Embers(s.querySelector('.mm-embers') as HTMLCanvasElement);
    const layout = h('div', 'mm-layout');
    s.appendChild(layout);
    s.addEventListener('pointermove', (e) => {
      const x = e.clientX / window.innerWidth - 0.5, y = e.clientY / window.innerHeight - 0.5;
      layout.style.setProperty('--mx', x.toFixed(3));
      layout.style.setProperty('--my', y.toFixed(3));
      embers.pointer(x, y);
    });

    // ---- left column: title + navigation
    const words = GAME_TITLE.split(' ');
    const left = h('div', 'mm-left');
    left.innerHTML = `
      <div class="mm-kicker"><i></i><span>${tCommon.html('gameSubtitle')}</span></div>
      <h1 class="game-title">${words.map((w, i) => `<span class="gt-line" style="--d:${i}" data-text="${esc(w)}"><span class="gt-fill">${esc(w)}</span></span>`).join('')}</h1>
      <div class="mm-horizon"><i></i></div>
      <p class="mm-tag">${tMenu.html('main.tagline')}</p>`;
    const nav = h('nav', 'mm-nav');
    const pill = (text: string, cls = '') => `<em class="rh-daily-pill${cls}">${esc(text)}</em>`;
    const navItem = (n: string, label: string, icon: string, fn: () => void, active = false) => { // (label: HTML)
      const b = h('button', 'mm-nav-btn' + (active ? ' on' : ''), `<span class="nb-idx">${n}</span><span class="nb-ic">${icon}</span><span class="nb-label">${label}</span><span class="nb-arrow">${ICONS.arrowR}</span>`);
      b.onclick = fn;
      nav.appendChild(b);
    };
    const cont = this.cb.continueInfo?.();
    const bootDone = bootCampDone();
    const T = (k: Parameters<typeof tMenu>[0]) => tMenu.html(k);
    if (cont) navItem('▶', esc(tMenu('main.continue', { label: trSource(cont.label) })), ICONS.play, () => { this.hide(); this.cb.continueGame!(); });
    if (this.cb.openBootCamp && !bootDone) navItem('00', `${T('main.nav.bootCamp')}${pill(tMenu('main.nav.startHere'), ' rh-new-pill')}`, ICONS.bulb, () => { this.hide(); this.cb.openBootCamp!(); });
    navItem('»', `${T('main.nav.quickBattle')}${pill(tMenu('main.nav.oneClick'))}`, ICONS.dice, () => this.quickBattle()); // one click into a rolled skirmish
    if (this.cb.openCampaign) navItem('01', T('main.nav.campaign'), ICONS.flag, () => { this.hide(); this.cb.openCampaign!(); });
    if (this.cb.openConquest) { const ci = this.cb.conquestInfo?.(); navItem('★', `${T('main.nav.conquest')}${ci ? pill(ci) : ''}`, picto('globe', 'ic'), () => { this.hide(); this.cb.openConquest!(); }); }
    navItem('02', T('main.nav.skirmish'), ICONS.target, () => { panel.classList.remove('attn'); void panel.offsetWidth; panel.classList.add('attn'); }, true);
    if (this.cb.openMultiplayer) navItem('MP', `${T('main.nav.multiplayer')}${pill(tMenu('main.nav.online'))}`, ICONS.people, () => { this.hide(); this.cb.openMultiplayer!(); });
    navItem('03', `${T('main.nav.challenges')}${dailyPending() ? pill(tMenu('main.nav.daily')) : ''}`, picto('trophy', 'ic'), () => this.openChallenges());
    navItem('04', T('main.nav.replays'), ICONS.replay, () => this.showReplays());
    navItem('05', T('main.nav.commander'), picto('chevrons', 'ic'), () => this.openProfile());
    if (this.cb.openBootCamp && bootDone) navItem('06', T('main.nav.bootCamp'), ICONS.bulb, () => { this.hide(); this.cb.openBootCamp!(); });
    navItem(bootDone && this.cb.openBootCamp ? '07' : '06', tCommon.html('settings'), ICONS.gear, () => this.showSettings(() => this.showMain()));
    navItem(bootDone && this.cb.openBootCamp ? '08' : '07', T('main.nav.controls'), ICONS.keyboard, () => this.showHelp(() => this.showMain()));
    // map editor and mods: numbered on from the last numbered entry (the ▶ » ★ MP entries carry no number)
    const nextIdx = () => String(Math.max(0, ...[...nav.querySelectorAll('.nb-idx')].map((e) => parseInt(e.textContent ?? '', 10)).filter(Number.isFinite)) + 1).padStart(2, '0');
    if (this.cb.openEditor) navItem(nextIdx(), T('main.nav.mapEditor'), ICONS.map, () => { this.hide(); this.cb.openEditor!(); });
    if (this.cb.openMods) { const n = enabledModIds().length; navItem(nextIdx(), `${T('main.nav.mods')}${n ? pill(tMenu('main.nav.modsOn', { n })) : ''}`, ICONS.gear, () => { this.hide(); this.cb.openMods!(); }); }
    nav.classList.toggle('dense', nav.childElementCount > 7);
    nav.querySelectorAll<HTMLElement>('.mm-nav-btn').forEach((b, i) => { b.style.animationDelay = `${(0.65 + i * 0.08).toFixed(2)}s`; });
    left.appendChild(nav);
    mountSessionCard(left, { audio: this.audio, play: (k) => this.sound.play(k) }); // today's contracts, streak, next unlock (replaces the tagline)
    // commander badge (rank insignia + name) next to the title; opens the profile
    const cmdr = h('div', 'mm-cmdr', commanderBadge());
    cmdr.style.cssText = 'margin-bottom:1.3rem;animation:fadeUp .8s .05s var(--ease) both';
    cmdr.onclick = () => { this.sound.play('click'); this.openProfile(); };
    left.prepend(cmdr);
    left.appendChild(h('div', 'mm-foot', `<span class="live"><i></i>${tMenu.html('main.liveFeed')}</span><span>v${VERSION}</span>`));

    // ---- right column: skirmish setup
    let vr: ReturnType<typeof rulesTabs> | null = null;
    const panel = h('div', 'menu-panel panel mm-panel');
    panel.appendChild(this.header(tMenu.html('skirmish.kicker'), tMenu.html('main.nav.skirmish')));

    // factions
    const fac = h('div', 'factions');
    const mkFaction = (f: Faction, name: string, desc: string, traits: string[], emblem: string) => {
      const c = h('div', `faction-card ${f}${prefs.faction === f ? ' on' : ''}`, `<div class="fc-bg"></div><div class="fc-emblem">${emblem}</div>
        <div class="fc-text"><div class="fc-name">${name}</div><div class="fc-desc">${desc}</div><div class="fc-traits">${traits.map((t) => `<span>${t}</span>`).join('')}</div></div>
        <span class="fc-check">${ICONS.check}</span><div class="fc-glare"></div>`);
      c.onclick = () => {
        if (prefs.faction === f) return;
        prefs.faction = f;
        for (const x of fac.children) x.classList.remove('on');
        c.classList.add('on');
        document.body.classList.toggle('faction-soviet', f === 'soviet');
        vr?.refresh(); // doctrines and mutators depend on the side
        if (f === 'soviet' && prefs.color === TEAM_COLORS[0]) setColor(TEAM_COLORS[1]);
        if (f === 'allies' && prefs.color === TEAM_COLORS[1]) setColor(TEAM_COLORS[0]);
        this.audio.play('tab');
      };
      bindTilt(c, 6);
      fac.appendChild(c);
    };
    mkFaction('allies', tCommon.html('faction.allies'), tMenu.html('skirmish.allies.desc'), [tMenu.html('skirmish.allies.trait1'), tMenu.html('skirmish.allies.trait2'), tMenu.html('skirmish.allies.trait3')], alliedEmblem());
    mkFaction('soviet', tCommon.html('faction.soviet'), tMenu.html('skirmish.soviets.desc'), [tMenu.html('skirmish.soviets.trait1'), tMenu.html('skirmish.soviets.trait2'), tMenu.html('skirmish.soviets.trait3')], sovietEmblem());
    panel.appendChild(fac);

    // colour
    const colors = h('div', 'colors');
    const setColor = (c: number) => {
      prefs.color = c;
      for (const sw of colors.children) sw.classList.toggle('on', +(sw as HTMLElement).dataset.c! === c);
      renderOpps();
      renderMap();
    };
    for (const c of TEAM_COLORS) {
      const sw = h('div', 'sw' + (c === prefs.color ? ' on' : ''));
      sw.style.setProperty('--c', hexColor(c));
      sw.dataset.c = String(c);
      sw.onclick = () => setColor(c);
      colors.appendChild(sw);
    }

    // opponents (a curated map fixes their number)
    const oppBox = h('div', 'opponents');
    const oppCount = h('span', 'sec-count');
    const renderOpps = () => {
      oppBox.innerHTML = '';
      const def = prefs.mapId ? getMapDef(prefs.mapId) : undefined;
      if (def) prefs.opponents = fitOpponents(prefs.opponents, def.players);
      const used = new Set([prefs.color]);
      prefs.opponents.forEach((o, i) => {
        const color = TEAM_COLORS.find((c) => !used.has(c))!;
        used.add(color);
        const r = h('div', 'opponent');
        r.style.setProperty('--i', String(i));
        r.appendChild(h('span', 'op-id', `<i style="--c:${hexColor(color)}"></i>${ICONS.cpu}<b>${tMenu.html('skirmish.aiName', { n: i + 1 })}</b>`));
        // a rival replaces the faction choice with its chip; "Rival" sits next to the difficulties
        r.appendChild(o.rivalId ? rivalChip(o, renderOpps, (k) => this.sound.play(k)) : seg<Faction | 'random'>([['allies', tCommon.html('faction.allies')], ['soviet', tMenu.html('skirmish.oppSoviet')], ['random', tCommon.html('random')]], o.faction, (v) => { o.faction = v; }, 'op-fac'));
        const diffSeg = seg<AIDifficulty | 'rival'>([...AI_DIFFICULTIES.map((d): [AIDifficulty, string] => [d, tCommon.html(`difficulty.${d}`)]), ['rival', tMenu.html('skirmish.rival')]], o.rivalId ? 'rival' : o.difficulty, (v) => { const was = !!o.rivalId; setOpponentKind(o, v); r.dataset.diff = v; if (was !== !!o.rivalId) renderOpps(); else vr?.syncDynamic(); }, 'op-diff');
        diffSeg.querySelector<HTMLElement>('[data-v="recruit"]')?.setAttribute('title', tMenu('skirmish.recruitTip'));
        r.appendChild(diffSeg);
        r.dataset.diff = o.rivalId ? 'rival' : o.difficulty;
        const x = h('button', 'op-x', ICONS.close);
        x.title = def ? tMenu('skirmish.mapFixesPlayers', { map: mapName(def), n: def.players }) : tMenu('skirmish.removeOpponent');
        x.disabled = prefs.opponents.length <= 1 || !!def;
        x.onclick = () => { prefs.opponents.splice(i, 1); renderOpps(); renderMap(); };
        r.appendChild(x);
        oppBox.appendChild(r);
      });
      if (prefs.opponents.length < 3 && !def) {
        const add = h('button', 'op-add', `${ICONS.plus}<span>${tMenu.html('skirmish.addOpponent')}</span>`);
        add.onclick = () => { const last = prefs.opponents[prefs.opponents.length - 1]; prefs.opponents.push({ faction: 'random', difficulty: last && !last.rivalId ? last.difficulty : 'normal' }); renderOpps(); renderMap(); }; // (a new opponent matches the last one's level)
        oppBox.appendChild(add);
      }
      oppCount.textContent = def ? tMenu('skirmish.oppCountFixed', { n: prefs.opponents.length }) : `${prefs.opponents.length} / 3`;
      vr?.syncDynamic(); // (dynamic difficulty's default follows the opponents)
    };
    const forces = h('div', 'mp-section');
    const secHead = h('div', 'sec-title', `<span>${tMenu.html('skirmish.opponents')}</span>`);
    secHead.appendChild(oppCount);
    const colorRow = h('div', 'color-row', `<span class="cr-label">${ICONS.flag}<span>${tMenu.html('skirmish.teamColour')}</span></span>`);
    colorRow.appendChild(colors);
    forces.append(colorRow, secHead, oppBox);
    panel.appendChild(forces);

    // map: curated pick or a generated battlefield with a shareable code
    const mapRow = h('div', 'map-row');
    const genParams = (): GenParams => normaliseParams({ size: prefs.mapSize, players: 1 + prefs.opponents.length, water: prefs.water, trees: prefs.trees, ore: prefs.ore, climate: prefs.climate, seed: prefs.seed! });
    let thumbTimer = 0;
    const renderMap = () => {
      const def = prefs.mapId ? getMapDef(prefs.mapId) : undefined;
      const p = genParams();
      const code = encodeMapCode(p);
      const colorsFor = startColors(prefs.color, def ? def.players : p.players);
      mapRow.className = 'map-row' + (def ? ' curated' : '');
      mapRow.innerHTML = `<div class="mr-thumb"><img alt=""><span class="mr-load"></span></div>
        <div class="mr-info"><small>${tMenu.html('skirmish.battlefield')}</small><b>${esc(def ? mapName(def) : tMenu('skirmish.randomBattlefield'))}</b>
        <span class="mr-meta">${def ? `${esc(mapMeta(def.size, def.players, def.climate))}${def.tags?.length ? ' · ' + mapTags(def).slice(0, 2).map(esc).join(' · ') : ''}` : esc(tMenu('skirmish.mapMetaGenerated', { size: p.size, players: p.players, climate: climateName(p.climate) }))}</span>
        ${def ? '' : `<span class="mr-code"><span class="mr-code-lbl">${tMenu.html('skirmish.mapCode')}</span><code>${code}</code><button class="mr-ib mr-copy" title="${esc(tMenu('skirmish.copyMapCode'))}">${ICONS.copy}</button><button class="mr-ib mr-lock${prefs.lockSeed ? ' on' : ''}" title="${esc(tMenu(prefs.lockSeed ? 'skirmish.lockOn' : 'skirmish.lockOff'))}">${ICONS.lock}</button><button class="mr-ib mr-dice" title="${esc(tMenu('skirmish.rollMap'))}">${ICONS.dice}</button></span>`}</div>
        <button class="btn mr-change">${ICONS.map}<span>${tMenu.html('skirmish.maps')}</span></button>`;
      const img = mapRow.querySelector('img') as HTMLImageElement;
      window.clearTimeout(thumbTimer);
      const draw = () => {
        img.src = def
          ? mapPreviewUrl(`c:${def.id}:${colorsFor.join(',')}`, () => loadCuratedMap(def.id)!, { size: 160, colors: colorsFor })
          : mapPreviewUrl(`g:${code}:${prefs.color}`, () => previewGenerated(p), { size: 160, colors: colorsFor, highlight: 0 });
        mapRow.classList.remove('loading');
      };
      mapRow.classList.add('loading');
      thumbTimer = window.setTimeout(draw, 120);
      (mapRow.querySelector('.mr-change') as HTMLElement).onclick = () => this.mapPicker(prefs, () => { renderOpps(); renderBf(); renderMap(); });
      (mapRow.querySelector('.mr-thumb') as HTMLElement).onclick = () => this.mapPicker(prefs, () => { renderOpps(); renderBf(); renderMap(); });
      const copy = mapRow.querySelector('.mr-copy') as HTMLElement | null;
      if (copy) copy.onclick = () => { copyText(code); this.flashTip(copy, tCommon('copied')); };
      const lock = mapRow.querySelector('.mr-lock') as HTMLElement | null;
      if (lock) lock.onclick = () => { prefs.lockSeed = !prefs.lockSeed; renderMap(); };
      const dice = mapRow.querySelector('.mr-dice') as HTMLElement | null;
      if (dice) dice.onclick = () => { prefs.seed = randomSeed(); prefs.lockSeed = false; renderMap(); };
    };
    panel.appendChild(mapRow);

    // battlefield / conditions
    const grid = h('div', 'mp-grid');
    const bf = h('div', 'mp-col');
    const renderBf = () => {
      bf.innerHTML = '';
      const def = prefs.mapId ? getMapDef(prefs.mapId) : undefined;
      const T = (k: Parameters<typeof tMenu>[0]) => tMenu.html(k);
      bf.appendChild(h('div', 'sec-title', `<span>${T('skirmish.battlefield')}</span>`));
      if (def) {
        const info = (icon: string, label: string, value: string) => bf.appendChild(field(label, icon, h('div', 'fixed-val', `<b>${value}</b><small>${T('skirmish.setByMap')}</small>`)));
        info(ICONS.map, T('skirmish.mapSize'), `${def.size}×${def.size}`);
        const tags = def.tags ?? [], ti = tags.findIndex((t) => /naval|river|lake|island|canyon|ridge/i.test(t));
        info(ICONS.water, T('skirmish.terrain'), esc(ti >= 0 ? mapTags(def)[ti] : tMenu('skirmish.handMade')));
        info(def.climate === 'winter' ? ICONS.snow : def.climate === 'desert' ? ICONS.desert : ICONS.tree, T('skirmish.climate'), esc(climateName(def.climate)));
      } else {
        bf.appendChild(field(T('skirmish.mapSize'), ICONS.map, seg<number>([[64, T('skirmish.sizeSmall')], [96, T('skirmish.sizeMedium')], [128, T('skirmish.sizeLarge')]], prefs.mapSize, (v) => { prefs.mapSize = v; renderMap(); })));
        bf.appendChild(field(T('skirmish.terrain'), ICONS.water, seg<number>([[0, T('skirmish.terrainDry')], [0.5, T('skirmish.terrainLakes')], [1, T('skirmish.terrainSea')]], prefs.water, (v) => { prefs.water = v; renderMap(); })));
        bf.appendChild(field(T('skirmish.climate'), ICONS.tree, seg<Climate>([['temperate', T('skirmish.climateTemperate'), ICONS.tree], ['winter', T('skirmish.climateWinter'), ICONS.snow], ['desert', T('skirmish.climateDesert'), ICONS.desert]], prefs.climate, (v) => { prefs.climate = v; renderMap(); }, 'with-ic')));
      }
      bf.appendChild(field(T('skirmish.weather'), ICONS.rain, stepper<Weather>([
        ['auto', tCommon.html('auto'), ICONS.auto], ['clear', T('skirmish.weatherClear'), ICONS.clear], ['rain', T('skirmish.weatherRain'), ICONS.rain], ['storm', T('skirmish.weatherStorm'), ICONS.storm],
        ['snow', T('skirmish.weatherSnow'), ICONS.snow], ['fog', T('skirmish.weatherFog'), ICONS.fog], ['dust', T('skirmish.weatherDust'), ICONS.dust]], prefs.weather, (v) => { prefs.weather = v; })));
      // build-up time and the game mode live in the Rules tab
    };
    const cond = h('div', 'mp-col');
    cond.appendChild(h('div', 'sec-title', `<span>${T('skirmish.conditions')}</span>`));
    cond.appendChild(field(T('skirmish.timeOfDay'), ICONS.sun, seg<TimeOfDay>([['day', T('skirmish.day'), ICONS.sun], ['dusk', T('skirmish.dusk'), ICONS.dusk], ['night', T('skirmish.night'), ICONS.moon]], prefs.timeOfDay, (v) => { prefs.timeOfDay = v; }, 'with-ic')));
    cond.appendChild(field(T('skirmish.credits'), ICONS.coin, seg<number>([5, 10, 20].map((k): Opt<number> => [k * 1000, tMenu.html('skirmish.creditsShort', { n: k })]), prefs.credits, (v) => { prefs.credits = v; })));
    cond.appendChild(field(T('skirmish.startUnits'), ICONS.vehicle, seg<'mcv' | 'light' | 'heavy'>([['mcv', T('skirmish.unitsMcv')], ['light', T('skirmish.unitsSquad')], ['heavy', T('skirmish.unitsCompany')]], prefs.startUnits, (v) => { prefs.startUnits = v; })));
    // game mode: classic, or King of the Hill (hold the centre for N minutes)
    const modeField = field(T('skirmish.mode'), ICONS.flag, stepper<string>([['0', T('skirmish.annihilation'), ICONS.target], ...KOTH_MINUTES.map((m): Opt<string> => [String(m), tMenu.html('skirmish.koth', { n: m }), ICONS.flag])],
      String(prefs.koth ?? 0), (v) => { prefs.koth = +v || undefined; syncBuildup(); })); // placed in the Rules tab
    // build-up time: a ceasefire at the start (the AI builds and only defends until it runs out)
    const buildupLabel = (m: number) => (!m ? tCommon.html('off') : m < 0 ? T('skirmish.buildupUnlimited') : tMenu.html('skirmish.buildupMinutes', { n: m })); // (sim/ceasefire.ts ceasefireLabel, translated)
    const buildup = field(T('skirmish.buildup'), ICONS.shield, stepper<string>(CEASEFIRE_CHOICES.map((m): Opt<string> => [String(m), buildupLabel(m), m < 0 ? ICONS.shield : m ? ICONS.clock : ICONS.target]),
      String(prefs.ceasefire ?? 0), (v) => { prefs.ceasefire = +v || undefined; }), 'f-buildup');
    function syncBuildup() {
      buildup.classList.toggle('disabled', !!prefs.koth);
      buildup.title = tMenu(prefs.koth ? 'skirmish.buildupNoKoth' : 'skirmish.buildupTip');
    }
    syncBuildup();
    const toggles = h('div', 'toggle-pair');
    const tp = (icon: string, label: string, v: boolean, fn: (v: boolean) => void) => {
      const t = h('label', 'tp', `${icon}<span>${label}</span>`);
      t.appendChild(toggle(v, fn));
      toggles.appendChild(t);
    };
    tp(ICONS.cycle, T('skirmish.dayCycle'), prefs.dayCycle, (v) => { prefs.dayCycle = v; });
    tp(ICONS.eyeOff, T('skirmish.fogOfWar'), prefs.fog, (v) => { prefs.fog = v; });
    cond.appendChild(toggles);
    grid.append(bf, cond);
    // "Battlefield | Rules" tabs: rules, doctrine, mode, build-up, events, dynamic difficulty, mutators
    vr = rulesTabs(prefs, { seg, toggle, field, play: (k) => this.sound.play(k) }, {
      grid, mode: modeField, buildup, faction: () => prefs.faction,
      mutatorContext: () => ({ climate: (prefs.mapId ? getMapDef(prefs.mapId)?.climate : undefined) ?? prefs.climate, faction: prefs.faction }),
      host: () => this.screen, setEsc: (fn) => { this.escAction = fn; },
      dynamicDefault: () => dynamicDefault(prefs.opponents.map(opponentLevel)),
    });
    panel.append(vr.tabs, grid, vr.rules);
    renderOpps();
    renderBf();
    renderMap();

    const modsChip = activeModsChip(() => { this.hide(); this.cb.openMods?.(); }); // "Modded" marker
    if (modsChip) (panel.querySelector('.mp-head') ?? panel).appendChild(modsChip);
    const go = h('button', 'btn-primary deploy', `<span>${T('skirmish.deploy')}</span>${ICONS.arrowR}<i class="shine"></i>`);
    go.onclick = () => {
      this.audio.unlock().catch(() => {});
      const def = prefs.mapId ? getMapDef(prefs.mapId) : undefined;
      // a generated map is started from exactly the parameters its map code encodes
      const p = genParams();
      const opponents = prefs.opponents.map((o) => resolveRivalOpponent({ ...o })); // rivals plan before the match
      const setup: GameSetup & AtmosphereSetup = {
        faction: prefs.faction, color: prefs.color, opponents,
        mapSize: def ? def.size : p.size, water: p.water, trees: p.trees, ore: p.ore, credits: prefs.credits, startUnits: prefs.startUnits, fog: prefs.fog,
        timeOfDay: prefs.timeOfDay, quality: this.settings.quality, seed: def ? randomSeed() : p.seed,
        weather: prefs.weather, climate: def ? def.climate : p.climate, dayCycle: prefs.dayCycle, mapId: def?.id,
        customMap: def && isCustomMapId(def.id) ? JSON.parse(JSON.stringify(def)) : undefined, // saves / replays carry the map
        koth: prefs.koth ? true : undefined, kothMinutes: prefs.koth || undefined, // King of the Hill
        ceasefire: prefs.koth ? undefined : prefs.ceasefire || undefined, // build-up time (classic skirmish only)
        // rules, mutators, battlefield events, dynamic difficulty
        rules: prefs.rules === 'classic' ? 'classic' : 'commander',
        mutators: prefs.mutators?.length ? [...prefs.mutators] : undefined,
        events: prefs.rules === 'classic' ? undefined : prefs.events !== false,
        dynamicDifficulty: (prefs.dynamicDifficulty ?? dynamicDefault(opponents.map((o) => o.difficulty))) || undefined, // (default: on against Recruit / Easy only)
        doctrines: prefs.rules !== 'classic' && prefs.doctrine ? [prefs.doctrine] : undefined, // the player's pick (AIs choose their own)
      };
      try { localStorage.setItem(SETUP_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
      this.cb.start(setup);
    };
    panel.appendChild(go);
    layout.append(left, panel);
  }

  /** Quick Battle: roll a well-tuned random skirmish, show the roll on the loading screen, deploy. */
  quickBattle() {
    this.audio.unlock().catch(() => {});
    const prefs = loadPrefs();
    // the commander's saved doctrine for this side, else the side's first doctrine that is open from the start
    const own = prefs.doctrine && DOCTRINES[prefs.doctrine]?.faction === prefs.faction ? prefs.doctrine : undefined;
    const doctrine = own ?? doctrinesFor(prefs.faction).find((d) => doctrineUnlocked(d, 0))?.id ?? null;
    this.cb.start(quickBattleSetup({ faction: prefs.faction, color: prefs.color, quality: this.settings.quality, doctrine })); // (main.ts shows the roll on the loading screen)
  }

  /**
   * "Play again" for the results screen: `same` = the same setup again (map, opponents, rules, mutators;
   * a Quick Battle shows its roll again), otherwise a fresh map (a Quick Battle rolls a new one).
   */
  playAgain(setup: GameSetup, same = true) {
    if (!same && setup.quick) { this.quickBattle(); return; }
    if (!same) { this.cb.restart(true); return; }
    this.cb.start({ ...setup, load: undefined, replay: undefined, branch: undefined, intro: false, quality: this.settings.quality });
  }

  /** Brief "Copied" style confirmation on a button. */
  private flashTip(el: HTMLElement, text: string) {
    el.dataset.flash = text;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1100);
  }

  /** Map picker overlay: "Random" plus every curated map, with previews; map codes for random maps. */
  private mapPicker(prefs: SkirmishPrefs, done: () => void) {
    const host = this.screen;
    if (!host) return;
    const ov = h('div', 'map-picker');
    const pnl = h('div', 'menu-panel panel mpk-panel');
    pnl.appendChild(this.header(tMenu.html('picker.kicker'), tMenu.html('skirmish.battlefield'), ICONS.map));
    const close = () => {
      ov.classList.add('leaving');
      setTimeout(() => ov.remove(), 300);
      this.escAction = null;
      done();
    };
    const x = h('button', 'mpk-x', ICONS.close);
    x.title = tMenu('picker.close');
    x.onclick = close;
    pnl.appendChild(x);
    const gridEl = h('div', 'mpk-grid');
    const p = normaliseParams({ size: prefs.mapSize, players: 1 + prefs.opponents.length, water: prefs.water, trees: prefs.trees, ore: prefs.ore, climate: prefs.climate, seed: prefs.seed! });
    const card = (id: string | null, name: string, meta: string, desc: string, tags: string[], thumb: () => string) => {
      const c = h('button', 'mpk-card' + ((prefs.mapId ?? null) === id ? ' on' : ''), `<div class="mpk-thumb"><img alt=""></div>
        <div class="mpk-info"><b>${esc(name)}</b><span class="mpk-meta">${esc(meta)}</span><p>${esc(desc)}</p><span class="mpk-tags">${tags.map((t) => `<i>${esc(t)}</i>`).join('')}</span></div>`);
      const img = c.querySelector('img') as HTMLImageElement;
      // previews are built lazily, a few per frame, so the picker opens instantly
      queue.push(() => { img.src = thumb(); c.classList.add('ready'); });
      c.onclick = () => {
        this.sound.play('click');
        prefs.mapId = id ?? undefined;
        close();
      };
      gridEl.appendChild(c);
    };
    const queue: (() => void)[] = [];
    card(null, tMenu('skirmish.randomBattlefield'), tMenu('picker.randomMeta', { size: p.size }), tMenu('picker.randomDesc'),
      [tMenu('picker.tagGenerated'), tMenu('picker.tagMapCodes')], () => mapPreviewUrl(`g:${encodeMapCode(p)}:${prefs.color}`, () => previewGenerated(p), { size: 160, colors: startColors(prefs.color, p.players), highlight: 0 }));
    for (const m of CURATED_MAPS) {
      card(m.id, mapName(m), mapMeta(m.size, m.players, m.climate), mapDesc(m), mapTags(m),
        () => mapPreviewUrl(`c:${m.id}:${startColors(prefs.color, m.players).join(',')}`, () => loadCuratedMap(m.id)!, { size: 160, colors: startColors(prefs.color, m.players) }));
    }
    // maps made in the editor (saved with 2+ starts)
    for (const m of customMaps()) {
      card(m.id, m.name, mapMeta(m.size, m.players, m.climate), m.desc || (m.author ? tMenu('picker.customDescBy', { author: m.author }) : tMenu('picker.customDesc')), [tMenu('picker.tagCustom'), ...(m.tags ?? []).slice(0, 2)],
        () => mapPreviewUrl(`x:${m.id}:${JSON.stringify(m).length}:${startColors(prefs.color, m.players).join(',')}`, () => loadCuratedMap(m.id)!, { size: 160, colors: startColors(prefs.color, m.players) }));
    }
    pnl.appendChild(gridEl);
    // map code box (generated maps)
    const codeBox = h('div', 'mpk-code', `<span class="sec-title"><span>${tMenu.html('skirmish.mapCode')}</span></span>
      <div class="mpk-code-row"><input type="text" spellcheck="false" maxlength="24" placeholder="${esc(tMenu('picker.codePlaceholder', { code: encodeMapCode(p) }))}" value="${encodeMapCode(p)}" aria-label="${esc(tMenu('skirmish.mapCode'))}"><button class="btn mpk-apply">${ICONS.check}<span>${tMenu.html('picker.useCode')}</span></button><button class="btn mpk-copy">${ICONS.copy}<span>${tCommon.html('copy')}</span></button></div>
      <small class="mpk-msg">${tMenu.html('picker.codeHelp')}</small>`);
    const input = codeBox.querySelector('input') as HTMLInputElement;
    const msg = codeBox.querySelector('.mpk-msg') as HTMLElement;
    const apply = () => {
      const raw = input.value.trim();
      const cur = CURATED_MAPS.find((m) => m.id === raw.toLowerCase() || m.name.toLowerCase() === raw.toLowerCase() || mapName(m).toLowerCase() === raw.toLowerCase()); // (the English or the translated name)
      if (cur) { prefs.mapId = cur.id; close(); return; }
      const dec = decodeMapCode(raw);
      if (!dec) {
        msg.textContent = tMenu('picker.codeInvalid');
        msg.classList.add('bad');
        replayAnim(codeBox, 'shake', 450);
        this.sound.play('error');
        return;
      }
      prefs.mapId = undefined;
      prefs.mapSize = dec.size; prefs.water = dec.water; prefs.trees = dec.trees; prefs.ore = dec.ore; prefs.climate = dec.climate; prefs.seed = dec.seed;
      prefs.lockSeed = true;
      prefs.opponents = fitOpponents(prefs.opponents, dec.players);
      close();
    };
    (codeBox.querySelector('.mpk-apply') as HTMLElement).onclick = apply;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); e.stopPropagation(); });
    (codeBox.querySelector('.mpk-copy') as HTMLElement).onclick = (e) => { copyText(encodeMapCode(p)); this.flashTip(e.currentTarget as HTMLElement, tCommon('copied')); };
    pnl.appendChild(codeBox);
    ov.appendChild(pnl);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    host.appendChild(ov);
    this.sound.bind(ov, 'button');
    this.escAction = close;
    const pump = () => {
      if (!ov.isConnected) return;
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 30) queue.shift()!();
      if (queue.length) requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
  }

  /** Challenges hub (daily challenge + survival); built-in fallback deploys through cb.start(). */
  openChallenges() {
    this.hide();
    if (this.cb.openChallenges) { this.cb.openChallenges(); return; }
    void import('./challenges').then(({ showChallenges }) => showChallenges({
      play: (k) => this.sound.play(k),
      onBack: () => this.showMain(),
      onProfile: () => this.openProfile(),
      onDeploy: (id) => this.cb.start({
        faction: 'allies', color: TEAM_COLORS[0], opponents: [], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6, credits: 5000,
        startUnits: 'mcv', fog: true, timeOfDay: 'day', quality: this.settings.quality, seed: 0, mission: id, intro: true,
      }),
    }));
  }

  /** Commander profile; built-in fallback when main.ts does not provide openProfile. */
  openProfile() {
    this.hide();
    if (this.cb.openProfile) { this.cb.openProfile(); return; }
    void import('./profile').then(({ showProfile }) => showProfile({ play: (k) => this.sound.play(k), onBack: () => this.showMain() }));
  }

  // ---------------------------------------------------------------------------
  /** Replay archive: the last matches with watch / export / delete, plus import from a file. */
  showReplays(back: () => void = () => this.showMain()) {
    const s = this.open('sub-screen');
    const panel = h('div', 'menu-panel panel replays-panel');
    panel.appendChild(this.header(tMenu.html('replays.kicker'), tMenu.html('main.nav.replays'), ICONS.replay));
    const list = h('div', 'rpl-list', `<div class="rpl-empty"><span class="rpl-spin"></span>${tMenu.html('replays.loading')}</div>`);
    panel.appendChild(list);
    const foot = h('div', 'rpl-foot');
    const note = h('small', 'rpl-note', tMenu.html('replays.note', { n: MAX_REPLAYS }));
    const file = h('input') as HTMLInputElement;
    file.type = 'file';
    file.accept = '.json,application/json';
    file.style.display = 'none';
    const imp = h('button', 'btn', `${ICONS.upload}<span>${tMenu.html('replays.importFile')}</span>`);
    imp.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        const r = await importReplayFile(f);
        note.textContent = tMenu('replays.imported', { map: replayMapName(r), date: fmtDateTime(r.createdAt) });
        note.classList.remove('bad');
        void render();
      } catch (e) {
        note.textContent = (e as Error).message;
        note.classList.add('bad');
        this.sound.play('error');
      }
    };
    foot.append(note, file, imp);
    panel.appendChild(foot);
    const b = backButton();
    b.onclick = back;
    panel.appendChild(b);
    s.appendChild(panel);
    this.escAction = back;

    const render = async () => {
      let replays: ReplayData[] = [];
      try { replays = await listReplays(); } catch { /* storage unavailable */ }
      if (!panel.isConnected) return;
      list.innerHTML = '';
      if (!replays.length) {
        list.appendChild(h('div', 'rpl-empty', `${ICONS.replay}<b>${tMenu.html('replays.empty')}</b><span>${tMenu.html('replays.emptySub')}</span>`));
        return;
      }
      // trees: originals with their branches (rewind & take command); continue = take command at the end
      const { renderReplayTree } = await import('./replay-tree');
      if (!panel.isConnected) return;
      renderReplayTree(list, replays, {
        watch: (r) => { this.hide(); this.cb.start(playbackSetup(r, this.settings.quality)); },
        cont: (r) => {
          const ps = playbackSetup(r, this.settings.quality);
          this.hide();
          this.cb.start({ ...ps, replay: { ...ps.replay!, seekTo: r.ticks, paused: true, takeCommand: { local: r.local } } });
        },
        exportReplay: (r) => exportReplay(r),
        del: (r) => deleteReplay(r.id),
      }, () => void render());
    };
    void render();
  }

  // ---------------------------------------------------------------------------
  /**
   * The Settings screen. `o.inBattle`: opened from the pause menu (the battle's interface was built in the current
   * language, so the language row is locked there). `o.rerender`: rebuild in place (after a language switch).
   */
  showSettings(back: () => void, o: SettingsOpts = {}) {
    const again = o.rerender && this.screen && this.screen === this.settingsScreen ? this.screen : null;
    const oldPanel = again?.querySelector<HTMLElement>('.settings-panel') ?? null;
    const s = again ?? this.open('sub-screen');
    this.settingsScreen = s;
    const opts: SettingsOpts = { inBattle: o.inBattle };
    const panel = h('div', 'menu-panel panel settings-panel');
    const tS = (k: Parameters<typeof tSettings>[0]) => tSettings.html(k);
    panel.appendChild(this.header(tS('kicker'), tCommon.html('settings'), ICONS.gear));
    const apply = () => { saveSettings(this.settings); this.cb.settingsChanged(this.settings); };
    const sec = (icon: string, title: string) => {
      const x = h('section', 'set-sec', `<div class="sec-title">${icon}<span>${title}</span></div>`);
      return x;
    };
    const gfx = sec(ICONS.monitor, tS('graphics'));
    gfx.appendChild(settingRow(ICONS.monitor, tS('quality'), tS('qualitySub'), seg<Quality>([['low', tS('qualityLow')], ['medium', tS('qualityMedium')], ['high', tS('qualityHigh')]], this.settings.quality, (v) => { this.settings.quality = v; apply(); })));
    gfx.appendChild(settingRow(ICONS.monitor, tS('modelDetail'), tS('modelDetailSub'), seg<ModelDetail>([['hd', tS('modelHd')], ['standard', tS('modelStandard')]], modelDetailOf(this.settings), (v) => { this.settings.modelDetail = v; apply(); })));
    gfx.appendChild(settingRow(ICONS.monitor, tS('renderScale'), tS('renderScaleSub'), seg<string>([['auto', tS('renderScaleAuto')], ['1', '100%'], ['0.75', '75%'], ['0.5', '50%']], String(this.settings.renderScale ?? 'auto'), (v) => { this.settings.renderScale = v === 'auto' ? 'auto' : +v; apply(); }))); // render resolution (GameRenderer.setRenderScaleMode)
    gfx.append(...offlineContentRows(settingRow)); // download HD content for offline play (src/ui/offline-setting.ts)
    gfx.appendChild(settingRow(ICONS.gauge, tS('perfOverlay'), tS('perfOverlaySub'), toggle(this.settings.showFps !== false, (v) => { this.settings.showFps = v; apply(); })));
    gfx.appendChild(settingRow(ICONS.motion, tS('reduceMotion'), tS('reduceMotionSub'), toggle(!!this.settings.reduceMotion, (v) => { this.settings.reduceMotion = v; apply(); })));
    gfx.appendChild(settingRow(ICONS.map, tS('layout'), tS('layoutSub'), seg<'modern' | 'classic'>([['modern', tS('layoutModern')], ['classic', tS('layoutClassic')]], this.settings.hudLayout === 'classic' ? 'classic' : 'modern', (v) => { this.settings.hudLayout = v; apply(); })));
    const aud = sec(ICONS.volume, tS('audio'));
    const vols = this.audio.getVolumes();
    const VOL: Record<string, [string, string]> = { master: [tS('volume.master'), ICONS.volume], sfx: [tS('volume.sfx'), ICONS.bolt], music: [tS('volume.music'), ICONS.music], voice: [tS('volume.voice'), ICONS.mic], ambience: [tS('volume.ambience'), ICONS.tree] };
    for (const k of Object.keys(vols) as (keyof typeof vols)[]) {
      const [label, icon] = VOL[k] ?? [esc(k.charAt(0).toUpperCase() + k.slice(1)), ICONS.volume];
      aud.appendChild(settingRow(icon, label, '', slider(vols[k], (v) => this.audio.setVolumes({ [k]: v } as Partial<typeof vols>))));
    }
    const play = sec(ICONS.mouse, tS('gameplay'));
    play.appendChild(this.languageRow(back, opts));
    play.appendChild(settingRow(ICONS.mouse, tS('edgeScroll'), tS('edgeScrollSub'), toggle(this.settings.edgeScroll, (v) => { this.settings.edgeScroll = v; apply(); })));
    play.appendChild(settingRow(ICONS.mic, tS('unitVoices'), tS('unitVoicesSub'), toggle(this.settings.unitVoices, (v) => { this.settings.unitVoices = v; apply(); })));
    play.appendChild(settingRow(ICONS.bulb, tS('hints'), tS('hintsSub'), toggle(this.settings.hints, (v) => { this.settings.hints = v; apply(); })));
    play.appendChild(settingRow(ICONS.eye, tS('skipIntro'), tS('skipIntroSub'), toggle(!!this.settings.skipIntro, (v) => { this.settings.skipIntro = v; apply(); })));
    play.appendChild(settingRow(ICONS.scatter, tS('fullscreen'), tS('fullscreenSub'), toggle(this.settings.fullscreen !== false, (v) => { this.settings.fullscreen = v; apply(); })));
    // accessibility: team colours, interface size, subtitles, key bindings, diagnostics
    const T = SETTINGS_TEXT;
    const acc = sec(ICONS.eye, esc(T.section));
    const pal = seg<TeamPalette>([['default', esc(T.palDefault)], ['cvd', esc(T.palCvd)], ['vs', esc(T.palVs)]], this.settings.teamPalette ?? 'default', (v) => { this.settings.teamPalette = v; apply(); });
    pal.querySelectorAll('button').forEach((b, i) => { b.title = [T.palDefaultTip, T.palCvdTip, T.palVsTip][i]; });
    acc.appendChild(settingRow(ICONS.flag, esc(T.teamColours), esc(T.teamColoursSub), pal)).classList.add('set-wide');
    acc.appendChild(settingRow(ICONS.monitor, esc(T.uiScale), esc(T.uiScaleSub), slider(clampUiScale(this.settings.uiScale), (v) => { this.settings.uiScale = clampUiScale(v); apply(); }, { min: 0.8, max: 1.5, step: 0.05, onCommit: true })));
    acc.appendChild(settingRow(ICONS.info, esc(T.subtitles), esc(T.subtitlesSub), toggle(this.settings.subtitles !== false, (v) => { this.settings.subtitles = v; apply(); })));
    const size = seg<SubtitleSize>([['small', esc(T.sizeSmall)], ['medium', esc(T.sizeMedium)], ['large', esc(T.sizeLarge)], ['xl', esc(T.sizeXl)]], subtitleSizeOf(this.settings.subtitleSize), (v) => { this.settings.subtitleSize = v; apply(); });
    size.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-label', [T.sizeSmallName, T.sizeMediumName, T.sizeLargeName, T.sizeXlName][i]));
    acc.appendChild(settingRow(ICONS.info, esc(T.subtitleSize), esc(T.subtitleSizeSub), size));
    // leaving the screen first applies a language pick that is still pending (so the next screen is in it)
    const leave = (fn: () => void) => {
      if (!this.langPick && !this.langBusy) { fn(); return; }
      void this.settleLanguage().then(() => { if (this.screen === s) fn(); });
    };
    const keysBtn = h('button', 'btn btn-sm', `${ICONS.keyboard}<span>${esc(T.keysButton)}</span>`) as HTMLButtonElement;
    keysBtn.onclick = () => { apply(); leave(() => this.showKeys(() => this.showSettings(back, opts))); };
    acc.appendChild(settingRow(ICONS.keyboard, esc(T.keys), esc(T.keysSub), keysBtn));
    const diagBtn = h('button', 'btn btn-sm', `${ICONS.copy}<span>${esc(T.diagnosticsButton)}</span>`) as HTMLButtonElement;
    const diagStatus = h('div', 'acc-status');
    diagStatus.setAttribute('role', 'status');
    diagBtn.onclick = async () => {
      const ok = await copyDiagnostics();
      diagBtn.querySelector('span')!.textContent = ok ? T.copied : T.copyFailed;
      diagStatus.textContent = ok ? T.copiedStatus : T.copyFailedStatus;
      setTimeout(() => { const sp = diagBtn.querySelector('span'); if (sp) sp.textContent = T.diagnosticsButton; }, 2500);
    };
    acc.appendChild(settingRow(ICONS.bulb, esc(T.diagnostics), esc(T.diagnosticsSub), diagBtn));
    acc.appendChild(diagStatus);
    const g = h('div', 'set-grid');
    const right = h('div', 'set-sec set-col'); // audio, then accessibility, in the right-hand column
    right.append(aud, acc);
    g.append(gfx, right, play);
    panel.appendChild(g);
    const done = () => { apply(); leave(back); };
    const b = backButton();
    b.onclick = done;
    panel.appendChild(b);
    if (again) { // (the same screen: no exit / entry animation)
      panel.style.animation = 'none';
      const top = oldPanel?.scrollTop ?? 0;
      oldPanel?.remove();
      s.appendChild(panel);
      panel.scrollTop = top;
    } else s.appendChild(panel);
    this.escAction = done;
  }

  /**
   * Settings › Gameplay › Language: Auto (the browser's language) or a fixed one, each in its own name. The switch
   * waits for the stepper to settle, then reloads the screen in the new language. Locked during a battle.
   */
  private languageRow(back: () => void, o: SettingsOpts): HTMLElement {
    const options: Opt<LangPref>[] = [
      ['auto', esc(tSettings('languageAuto', { lang: LANG_NAMES[resolvePref('auto')] }))],
      ...LANGS.map((l): Opt<LangPref> => [l, esc(LANG_NAMES[l])]),
    ];
    const control = stepper<LangPref>(options, languagePref(), (v) => {
      // (stepping through the list loads only the language it stops on)
      this.langPick = () => void this.switchLanguage(v, back, o, control);
      window.clearTimeout(this.langTimer);
      this.langTimer = window.setTimeout(() => { const pick = this.langPick; this.langPick = null; pick?.(); }, 450);
    });
    control.style.cssText = 'width:14rem;flex-shrink:0';
    control.dataset.setting = 'language';
    if (o.inBattle) {
      control.setAttribute('aria-disabled', 'true');
      control.style.opacity = '0.4';
      control.style.pointerEvents = 'none';
      control.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    }
    const row = settingRow(picto('globe', 'ic'), tSettings.html('language'), tSettings.html(o.inBattle ? 'languageInBattle' : 'languageSub'), control);
    const val = control.querySelector('.st-mid');
    val?.setAttribute('aria-live', 'polite'); // the picked language is read out
    return row;
  }

  /** Apply a language pick (serialised: the last pick wins) and rebuild the Settings screen in it. */
  private async switchLanguage(v: LangPref, back: () => void, o: SettingsOpts, control: HTMLElement) {
    const ticket = ++this.langTicket;
    const focused = control.contains(document.activeElement) ? [...control.querySelectorAll('button')].indexOf(document.activeElement as HTMLButtonElement) : -1;
    this.langBusy++;
    this.langSwitch = this.langSwitch.then(() => setLanguage(v)).catch(() => 'en');
    try { await this.langSwitch; } finally { this.langBusy--; }
    if (ticket !== this.langTicket || !control.isConnected || this.screen !== this.settingsScreen) return; // a newer pick, or the screen is gone
    this.showSettings(back, { ...o, rerender: true });
    if (focused >= 0) this.screen?.querySelector('[data-setting="language"]')?.querySelectorAll('button')[focused]?.focus({ preventScroll: true });
  }

  /** Apply a language pick that is still waiting, and wait for every switch in flight. */
  private async settleLanguage(): Promise<void> {
    const pick = this.langPick;
    this.langPick = null;
    window.clearTimeout(this.langTimer);
    pick?.();
    await this.langSwitch;
  }

  /** Key rebinding (ui/a11y-controls.ts): changes are saved as they are made. */
  showKeys(back: () => void) {
    const s = this.open('sub-screen');
    const panel = h('div', 'menu-panel panel keys-panel');
    panel.appendChild(this.header(esc(CONTROLS_TEXT.kicker), esc(CONTROLS_TEXT.title), ICONS.keyboard));
    const body = buildKeysPanel(this.settings, () => { saveSettings(this.settings); this.cb.settingsChanged(this.settings); });
    panel.appendChild(body.el);
    const done = () => { body.dispose(); back(); };
    const b = h('button', 'btn btn-back', `${ICONS.chevL}<span>${esc(CONTROLS_TEXT.back)}</span><kbd>${tCommon.html('keys.esc')}</kbd>`);
    b.onclick = done;
    panel.appendChild(b);
    s.appendChild(panel);
    this.escAction = done;
    (panel.querySelector('.kb-key') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  showHelp(back: () => void) {
    const s = this.open('sub-screen');
    const panel = h('div', 'menu-panel panel help-panel');
    panel.appendChild(this.header(tMenu.html('help.kicker'), tMenu.html('main.nav.controls'), ICONS.keyboard));
    // the active key bindings (rebindable: ui/keymap.ts); "—" when an action has no key
    const K = (id: ActionId) => keysLabel(id);
    const Ks = (...ids: ActionId[]) => ids.map(K).join(' / ');
    const GM = (which: 'assign' | 'add') => groupModLabel(groupMods()[which]);
    // key caps (common.keys) and mouse buttons; " + " and " / " split them into separate caps
    const ctrl = tCommon('keys.ctrl'), shift = tCommon('keys.shift'), alt = tCommon('keys.alt');
    const kk = (k: Parameters<typeof tMenu>[0] & `help.key.${string}`) => tMenu(k);
    const lmb = kk('help.key.lmb'), rmb = kk('help.key.rmb');
    const d = (k: Parameters<typeof tMenu>[0]) => tMenu(k);
    const groups: [string, string, [string, string][]][] = [
      [GROUP_TEXT.selection, ICONS.target, [
        [lmb, d('help.sel.select')], [kk('help.key.doubleClick'), d('help.sel.typeOnScreen')], [`${ctrl} + ${lmb}`, d('help.sel.typeOnScreen')],
        [K('selectCombat'), d('help.sel.combat')], [K('selectType'), d('help.sel.selectedTypes')], [K('selectScreen'), d('help.sel.ownOnScreen')],
        [K('nextIdle'), d('help.sel.nextIdle')], [`${GM('assign')} + 1–9`, d('help.sel.assignGroup')], ['1–9', d('help.sel.recallGroup')],
        [`${GM('add')} + 1–9`, d('help.sel.addToGroup')], [kk('help.key.ctrlDrag'), d('help.sel.removeFromSelection')], [kk('help.key.doubleClickStructure'), d('help.sel.structureOnScreen')],
        [K('army'), d('help.sel.army')], [K('selectDamaged'), d('help.sel.damaged')],
      ]],
      [GROUP_TEXT.orders, ICONS.attackMove, [
        [rmb, d('help.ord.rmb')], [`${shift} + ${rmb}`, d('help.ord.waypoints')], [`${ctrl} + ${rmb}`, d('help.ord.forceFire')], [`${alt} + ${rmb}`, d('help.ord.forceMove')],
        [K('attackMove'), ACTION_TEXT.attackMove], [Ks('stop', 'scatter', 'attackGround'), d('help.ord.stopScatter')], [K('deploy'), d('help.ord.deploy')],
        [Ks('stanceAggressive', 'stanceGuard', 'stanceHold', 'stancePassive'), d('help.ord.stances')],
        [K('layMines'), d('help.ord.mines')],
        [K('patrol'), d('help.ord.patrol')], [K('guard'), d('help.ord.guard')],
        [kk('help.key.rmbFriendly'), d('help.ord.escort')], [K('formation'), d('help.ord.formation')],
        [K('deploy'), d('help.ord.chrono')],
        [K('sendRepair'), d('help.ord.sendRepair')],
      ]],
      [GROUP_TEXT.base, ICONS.building, [
        [Ks('sell', 'repair', 'patrol'), d('help.base.sellRepair')], [lmb, d('help.base.build')], [rmb, d('help.base.hold')],
        [rmb, d('help.base.rally')],
        [`${shift} + ${lmb}`, d('help.base.placeMore')], [kk('help.key.lmbCardBusy'), d('help.base.plan')],
        [kk('help.key.tabB'), d('help.base.tabs')],
        [`${alt} + ${lmb}`, d('help.base.loop')], [`${GM('assign')} + 1–9`, d('help.base.factoryGroup')],
        [`${K('powers')}, 1–9`, d('help.base.powers')], [Ks('speedDown', 'speedUp'), d('help.base.speed')],
      ]],
      [GROUP_TEXT.camera, ICONS.eye, [
        [Ks('camUp', 'camDown', 'camLeft', 'camRight'), d('help.cam.scroll')], [kk('help.key.mmbRmbDrag'), d('help.cam.pan')], [`${tCommon('keys.wheel')} / ${Ks('zoomIn', 'zoomOut')}`, d('help.cam.zoom')],
        [Ks('home', 'lastAttack'), d('help.cam.homeAttack')], [K('follow'), d('help.cam.follow')], [Ks('rotateLeft', 'rotateRight'), tMenu('help.cam.rotate', { key: K('resetNorth') })],
        [Ks('bookmark1', 'bookmark2', 'bookmark3', 'bookmark4'), d('help.cam.bookmark')],
        [alt, d('help.cam.healthBars')], [K('photo'), d('help.cam.photo')], [`${alt}+${tCommon('keys.enter')}`, d('help.cam.fullscreen')], [tCommon('keys.esc'), d('help.cam.esc')],
      ]],
      // touch screens and gamepads
      [tMenu('help.touch'), ICONS.target, [
        [kk('help.key.tap'), d('help.tch.tap')], [kk('help.key.doubleTap'), d('help.tch.doubleTap')], [kk('help.key.drag'), d('help.tch.drag')],
        [kk('help.key.hold'), d('help.tch.hold')], [kk('help.key.twoFingers'), d('help.tch.twoFingers')],
        [kk('help.key.toolbar'), d('help.tch.toolbar')], [kk('help.key.holdCard'), d('help.tch.holdCard')],
        [kk('help.key.cardLoop'), d('help.tch.cardLoop')],
      ]],
      [tMenu('help.gamepad'), ICONS.gear, [
        [kk('help.key.leftStick'), d('help.pad.stick')], ['A', d('help.pad.a')], ['B / Y', d('help.pad.by')],
        [kk('help.key.view'), d('help.pad.view')], ['LB / RB', d('help.pad.bumpers')],
        [kk('help.key.dpad'), d('help.pad.dpad')], ['L3 / R3', d('help.pad.sticks')], [kk('help.key.start'), d('help.pad.start')], // Y loop
      ]],
      [tMenu('main.nav.replays'), ICONS.replay, [
        [tCommon('keys.space'), d('help.rpl.pause')], ['[ / ]', d('help.rpl.speed')], ['V', d('help.rpl.view')], [tCommon('keys.home'), d('help.rpl.restart')],
      ]],
    ];
    const g = h('div', 'help-grid');
    for (const [title, icon, rows] of groups) {
      const sct = h('section', 'help-sec', `<div class="sec-title">${icon}<span>${esc(title)}</span></div>`);
      for (const [k, v] of rows) sct.appendChild(h('div', 'help-row', `<span class="keys">${keycaps(k)}</span><span>${esc(v)}</span>`));
      g.appendChild(sct);
    }
    panel.appendChild(g);
    const foot = h('div', 'help-foot');
    const b = backButton();
    b.onclick = back;
    const custom = h('button', 'btn', `${ICONS.keyboard}<span>${esc(CONTROLS_TEXT.helpButton)}</span>`);
    custom.onclick = () => this.showKeys(() => this.showHelp(back));
    foot.append(b, custom);
    panel.appendChild(foot);
    s.appendChild(panel);
    this.escAction = back;
  }

  // ---------------------------------------------------------------------------
  showPause(game: Game) {
    const s = this.open('sub-screen pause-screen');
    const panel = h('div', 'menu-panel panel pause-panel');
    const rp = game.setup.replay;
    const mp = !!game.net?.active; // a multiplayer match runs on behind this menu
    const P = (k: Parameters<typeof tMenu>[0]) => tMenu.html(k);
    panel.appendChild(h('div', 'mp-head', `<span class="mp-ic pause-ic"><i></i><i></i></span><div><small>${P(rp ? 'pause.replayOnHold' : mp ? 'pause.matchGoesOn' : 'pause.missionOnHold')}</small><h2>${mp ? tCommon.html('menu') : P('pause.paused')}</h2></div>`));
    const me = game.local;
    const foes = game.world.players.filter((o) => me.isEnemy(o));
    const alive = foes.filter((o) => !o.defeated).length;
    panel.appendChild(h('div', 'pp-stats', rp ? `
      <div>${ICONS.clock}<small>${P('pause.replayTime')}</small><b>${formatTime(game.world.time)} / ${formatTime(rp.data.ticks / 20)}</b></div>
      <div>${ICONS.map}<small>${P('skirmish.battlefield')}</small><b>${esc(replayMapName(rp.data))}</b></div>
      <div>${ICONS.eye}<small>${P('pause.viewing')}</small><b>${esc(me.name)}</b></div>` : `
      <div>${ICONS.clock}<small>${P('pause.missionTime')}</small><b>${formatTime(game.world.time)}</b></div>
      <div>${ICONS.target}<small>${P('pause.hostiles')}</small><b>${alive} / ${foes.length}</b></div>
      <div>${ICONS.coin}<small>${P('skirmish.credits')}</small><b>${fmtMoney(me.credits)}</b></div>`));
    // the battlefield: curated map name, or the shareable code of a generated map
    const code = !rp && !game.setup.mission ? mapCodeForSetup(game.setup) : null;
    const mapDef = game.setup.mapId ? getMapDef(game.setup.mapId) : undefined;
    if (code || mapDef) {
      const row = h('div', 'pp-map', `${ICONS.map}<span>${mapDef ? `<b>${esc(mapName(mapDef))}</b><small>${tMenu.html('pause.mapMeta', { size: mapDef.size, players: mapDef.players })}</small>` : `<small>${P('skirmish.mapCode')}</small><code>${code}</code>`}</span>`);
      if (code) {
        const c = h('button', 'mr-ib', ICONS.copy);
        c.title = tMenu('skirmish.copyMapCode');
        c.onclick = () => { copyText(code); this.flashTip(c, tCommon('copied')); };
        row.appendChild(c);
      }
      panel.appendChild(row);
    }
    const list = h('div', 'pp-list');
    /** A menu entry; `act` names it for scripts (the HUD's settings button opens "settings" directly). */
    const mk = (act: string, label: string, icon: string, fn: () => void, cls = '') => {
      const b = h('button', 'pp-btn ' + cls, `<span class="pp-bic">${icon}</span><span>${esc(label)}</span>${cls.includes('primary') ? `<kbd>${tCommon.html('keys.esc')}</kbd>` : ICONS.chevR}`);
      b.dataset.act = act;
      b.onclick = fn;
      list.appendChild(b);
    };
    const resume = () => { this.hide(); this.cb.resume(); };
    const settings = () => this.showSettings(() => this.showPause(game), { inBattle: true }); // (the language is locked in a battle)
    mk('resume', tMenu('pause.resume'), ICONS.play, resume, 'primary');
    if (rp) {
      mk('settings', tCommon('settings'), ICONS.gear, settings);
      mk('controls', tMenu('main.nav.controls'), ICONS.keyboard, () => this.showHelp(() => this.showPause(game)));
      mk('watch from the start', tMenu('pause.watchFromStart'), ICONS.restart, () => { this.hide(); this.cb.start(playbackSetup(rp.data, this.settings.quality, { view: game.world.players.indexOf(game.local) })); });
      mk('back to replays', tMenu('pause.backToReplays'), ICONS.replay, () => { this.hide(); this.cb.quit(); this.showReplays(); });
      mk('quit to menu', tMenu('pause.quitToMenu'), ICONS.exit, () => { this.hide(); this.cb.quit(); }, 'danger');
      panel.appendChild(list);
      s.appendChild(panel);
      this.escAction = resume;
      return;
    }
    if (this.cb.saveGame && !mp) mk('save game', tMenu('pause.saveGame'), ICONS.history, () => { // (no saves of multiplayer matches)
      const ok = this.cb.saveGame!();
      const lbl = list.querySelector('.pp-btn:nth-child(2) span:nth-child(2)');
      if (lbl) lbl.textContent = tMenu(ok ? 'pause.saved' : 'pause.saveFailed');
    });
    mk('settings', tCommon('settings'), ICONS.gear, settings);
    mk('controls', tMenu('main.nav.controls'), ICONS.keyboard, () => this.showHelp(() => this.showPause(game)));
    if (!mp) mk('restart', tMenu('pause.restart'), ICONS.restart, () => { this.hide(); this.cb.restart(); });
    mk(mp ? 'leave match' : 'quit to menu', tMenu(mp ? 'pause.leaveMatch' : 'pause.quitToMenu'), ICONS.exit, () => { this.hide(); this.cb.quit(); }, 'danger');
    panel.appendChild(list);
    s.appendChild(panel);
    this.escAction = resume;
  }

  // ---------------------------------------------------------------------------
  showEnd(game: Game, won: boolean) {
    const s = this.open(`sub-screen end-screen ${won ? 'win' : 'lose'}`);
    this.escAction = () => { this.hide(); this.cb.resume(); }; // Esc: keep watching the battlefield (Enter plays again)
    // results screen (src/ui/results.ts): XP and rank-up, contracts, medals, next unlock, battle report, MVP,
    // highlights, and a big "Play again" (same settings, new seed) next to "Rematch" (same seed) and "Menu"
    const rec = game.recorder;
    const setup = game.setup;
    // (loaded on demand; main.ts warms these chunks up while the match runs)
    void Promise.all([import('./results'), import('./clips')]).then(([{ showResults }, { canRecordClips, clipStartTick, requestClip }]) => showResults(s, game, won, {
      summary: game.metaSummary, report: game.report, rating: rateCommander(game, won), audio: this.audio,
      playAgain: () => { this.hide(); if (setup.net && this.cb.backToLobby) { this.cb.backToLobby(); return; } this.playAgain(setup, false); }, // (a fresh map; a Quick Battle rolls a new one) multiplayer: back to the room
      rematch: !setup.mission && !setup.branch && !setup.challenge && !setup.net ? () => { this.hide(); this.cb.restart(); } : undefined,
      watchReplay: rec ? () => { const data = rec.toData(); this.hide(); this.cb.start(playbackSetup(data, this.settings.quality)); } : undefined,
      // highlight clips: open the replay just before the moment; the player records once it gets there
      recordClip: rec && canRecordClips() ? (t, label, fileLabel) => {
        const data = rec.toData();
        const at = Math.round(t * 20);
        requestClip(data.id, at, label, fileLabel);
        this.hide();
        const ps = playbackSetup(data, this.settings.quality);
        this.cb.start({ ...ps, replay: { ...ps.replay!, seekTo: clipStartTick(at) } });
      } : undefined,
      keepWatching: () => { this.hide(); this.cb.resume(); },
      menu: () => { this.hide(); this.cb.quit(); },
      copyCode: (code, el) => { copyText(code); this.flashTip(el, tCommon('copied')); },
    }));
  }
}

/** Performance rating for the end screen medal. */
export function rateCommander(game: Game, won: boolean): { score: number; tier: MedalTier; grade: string; title: string } {
  const st = game.local.stats;
  const kills = st.unitsKilled + st.buildingsKilled;
  const lost = st.unitsLost + st.buildingsLost;
  const mins = game.world.time / 60;
  let r = won ? 45 : 8;
  r += Math.min(22, (kills / Math.max(1, lost)) * 7);
  r += Math.min(14, st.harvested / 1200);
  r += Math.min(8, st.buildingsKilled * 0.8);
  if (won) r += mins < 12 ? 11 : mins < 20 ? 7 : mins < 30 ? 3 : 0;
  r = Math.max(0, Math.min(100, r));
  const score = Math.round(r * 97 + kills * 25 + st.harvested * 0.05);
  const tiers: [number, MedalTier, string][] = [
    [88, 's', 'S'], [74, 'a', 'A'], [60, 'b', 'B'],
    [45, 'c', 'C'], [28, 'd', 'D'], [0, 'e', 'E'],
  ];
  const [, tier, grade] = tiers.find(([min]) => r >= min)!;
  return { score, tier, grade, title: tMenu(`rating.${tier}`) }; // (the title: General of the Army … Sergeant)
}
