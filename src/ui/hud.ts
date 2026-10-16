import { BAIL_COUNT, BUILDINGS, CATEGORIES, CONDITION_RED, CONDITION_YELLOW, WEAPONS, getType, isBuildingType, mphToCellsPerSecond, type BuildingTypeDef, type Category, type TypeDef, type UnitTypeDef } from '../data/rules';
import { modCardTag, modTipHtml } from '../mods'; // [EDIT] "Modded" markers
import { formatTime } from '../core/util';
import { Building, Unit, type Entity } from '../sim/entities';
import { queueKindOf, type Player, type ProductionQueue } from '../sim/player';
import { buildSeconds } from '../sim/production';
import { SUPER_KINDS, SUPER_TARGET, superAvailable, superBuilding, superFull, superReady, type SuperKind } from '../sim/superweapons';
import { apparentType, disguisedAs } from '../sim/infiltration';
import type { Command, Stance } from '../sim/types';
import type { World } from '../sim/world';
import type { AudioSystem } from '../audio';
import { Minimap } from './minimap';
import { ICONS, rankBadge } from './icons';
import { Odometer, Tooltip, UiSound, bindTilt, el, esc, hexColor, replay, tipHtml, type TipSide } from './dom';
import { Toasts, classifyMessage, type ToastKind } from './toasts';
import { RANK_NAMES, factionTypes, missingRequirements, statLines, xpThresholds } from './tech';
import { applyUiSettings, hudLayoutOf, loadSettings, onSettingsChanged, type HudLayout } from './settings';
import { CTRL_ICONS, FORMATION_INFO, formationBar, refreshFormationBar } from './orderui'; // [CTRL]
import { fullscreenSupported, isFullscreen, onFullscreenChange, toggleFullscreen } from '../platform/fullscreen';
import { BOOT_CAMP_HUD } from '../missions/tutorial'; // [HUD] Boot Camp drill highlights
import { GAME_SPEEDS, GAME_SPEED_LABELS } from '../config';
import { CEASEFIRE_WARNING, ceasefireLeft } from '../sim/ceasefire';

export interface HudHost {
  world: World;
  local: Player;
  thumbs: Map<string, string>;
  selection: Set<number>;
  audio: AudioSystem;
  issue(cmd: Command): void;
  beginPlacement(type: string): void;
  setMode(mode: 'sell' | 'repair' | 'normal'): void;
  getMode(): string;
  beginSuperweapon(kind: SuperKind): void;
  select(ids: number[]): void;
  focusOn(x: number, y: number): void;
  minimapPoint(x: number, y: number, button: number, drag: boolean): void;
  openPauseMenu(): void;
  setSpeed(s: number): void;
  getSpeed(): number;
  keyCommand(key: string, fromButton?: boolean): void;
  stats?(): string;
  /**
   * Optional: control groups (number key 0-9 -> entity ids), e.g. `() => input.groups`.
   * Enables the control-group bar above the selection panel.
   */
  getGroups?(): Map<number, number[]>;
  /**
   * Optional: recall control group `g` exactly like pressing its number key (jump = double tap,
   * i.e. also centre the camera). Without it the HUD falls back to select() + focusOn().
   */
  selectGroup?(g: number, jump: boolean): void;
  /** Read-only spectator HUD (replays): no build, power or unit orders; `local` is the viewed player. */
  spectator?: boolean;
}

/**
 * Build tabs. Classic (the right-hand sidebar) has one tab per production category, data-driven from
 * CATEGORIES (sidebar order). Modern (the bottom build bar) splits the tech / support structures (radar,
 * service depot, tech centres, superweapons, decoys) off the structures into a "Support" tab, and only
 * shows Aircraft and Naval once they can be built. Conditional tabs (naval, and any category added later
 * without an entry here) only appear once the player can build them or owns a structure that produces them.
 */
type TabId = Category | 'support';
interface TabDef { id: TabId; cat: Category; icon: string; title: string; conditional: boolean }
const CAT_META: Partial<Record<Category, { icon: string; title: string; conditional?: boolean }>> = {
  building: { icon: ICONS.building, title: 'Structures' },
  defense: { icon: ICONS.defense, title: 'Defenses' },
  infantry: { icon: ICONS.infantry, title: 'Infantry' },
  vehicle: { icon: ICONS.vehicle, title: 'Vehicles' },
  aircraft: { icon: ICONS.aircraft, title: 'Aircraft' },
  naval: { icon: ICONS.naval, title: 'Naval', conditional: true },
};
const TABS: TabDef[] = CATEGORIES.map((cat) => {
  const m = CAT_META[cat];
  return { id: cat, cat, icon: m?.icon ?? ICONS.building, title: m?.title ?? cat.charAt(0).toUpperCase() + cat.slice(1), conditional: m ? !!m.conditional : true };
});
const CAT_ICON: Record<Category, string> = Object.fromEntries(TABS.map((t) => [t.cat, t.icon])) as Record<Category, string>;
/** [HUD] Modern build bar tabs: Structures, Infantry, Vehicles, Defences, Support, then Aircraft / Naval once available. */
const MODERN_ORDER: TabId[] = ['building', 'infantry', 'vehicle', 'defense', 'support', 'aircraft', 'naval'];
const MODERN_TITLES: Partial<Record<TabId, string>> = { defense: 'Defences', support: 'Support' };
const SUPPORT_TAB: TabDef = { id: 'support', cat: 'building', icon: ICONS.radar, title: 'Support', conditional: false };
const MODERN_TABS: TabDef[] = [
  ...MODERN_ORDER.map((id) => (id === 'support' ? SUPPORT_TAB : TABS.find((t) => t.id === id))).filter((t): t is TabDef => !!t)
    .map((t) => ({ ...t, title: MODERN_TITLES[t.id] ?? t.title, conditional: t.conditional || t.id === 'aircraft' })),
  ...TABS.filter((t) => !MODERN_ORDER.includes(t.id)),
];
const TAB_ICON = (id: TabId): string => (id === 'support' ? SUPPORT_TAB.icon : CAT_ICON[id]);
/** Tech and support structures (no factory, no power output, no ore storage): radar, depot, tech centres, superweapons, decoys. */
const isSupportStructure = (t: TypeDef): boolean => isBuildingType(t) && t.category === 'building' && !t.factory && !(t.power > 0) && !t.storage;

/** Superweapons and support powers, in SUPER_KINDS order. Aiming follows SUPER_TARGET. */
const SUPER_INFO: Record<SuperKind, { icon: string; name: string; desc: string }> = {
  nuke: { icon: ICONS.nuke, name: 'A-Bomb', desc: 'Launch a nuclear missile at any target on the map.' },
  ironcurtain: { icon: ICONS.ironCurtain, name: 'Iron Curtain', desc: 'Make a group of your units invulnerable for a short time.' },
  chrono: { icon: ICONS.chrono, name: 'Chronoshift', desc: 'Teleport one of your vehicles anywhere on the battlefield.' },
  gps: { icon: ICONS.gps, name: 'GPS Satellite', desc: 'Launch a satellite that permanently reveals the entire map. One use.' },
  sonar: { icon: ICONS.sonar, name: 'Sonar Pulse', desc: 'Reveal every enemy submarine on the map for a short time.' },
  spyplane: { icon: ICONS.spyplane, name: 'Spy Plane', desc: 'A reconnaissance plane photographs the area around the target.' },
  paratroopers: { icon: ICONS.paratroopers, name: 'Paratroopers', desc: 'A Badger drops a squad of riflemen at the target.' },
  parabombs: { icon: ICONS.parabombs, name: 'Parabombs', desc: 'Badger bombers carpet-bomb the target area.' },
};

/** The player owns a structure that produces this category (shipyard → naval). */
function ownsProducer(p: Player, cat: Category): boolean {
  for (const b of Object.values(BUILDINGS)) if ((b.factory as string | undefined) === cat && p.has(b.id)) return true;
  return false;
}
/** Powers the HUD lists (structure standing, or granted like a stolen sonar pulse) and their charge time. */
const powerAvailable = superAvailable;
const powerFull = superFull;

export const STANCES: { id: Stance; key: string; icon: string; title: string; desc: string }[] = [
  { id: 'aggressive', key: 'F1', icon: ICONS.stanceAggressive, title: 'Aggressive', desc: 'Engage anything in sight and chase it down.' },
  { id: 'guard', key: 'F2', icon: ICONS.guard, title: 'Guard', desc: 'Engage nearby enemies, then return to position (default).' },
  { id: 'hold', key: 'F3', icon: ICONS.stanceHold, title: 'Hold position', desc: 'Fire at enemies in range but never move to chase.' },
  { id: 'passive', key: 'F4', icon: ICONS.stancePassive, title: 'Hold fire', desc: 'Never open fire on its own (stealthy scouts, spies).' },
];

/**
 * Spy intel on another player (player.intel, filled when a spy infiltrates a structure). Reads the
 * sim's `{ radar: id[], power: id[], credits: id[], production: id[] }`, and tolerates simpler shapes
 * (a set / array of player ids, or a per-id record) so the HUD never depends on the exact layout.
 */
export interface IntelView { credits: boolean; power: boolean; radar: boolean; production: boolean }
export function intelOn(viewer: Player, other: Player): IntelView | null {
  const intel = (viewer as { intel?: unknown }).intel;
  if (!intel) return null;
  const all: IntelView = { credits: true, power: true, radar: true, production: true };
  if (intel instanceof Set) return intel.has(other.id) ? all : null;
  if (intel instanceof Map) return intel.get(other.id) ? all : null;
  if (Array.isArray(intel)) return intel.includes(other.id) ? all : null;
  if (typeof intel !== 'object') return null;
  const o = intel as Record<string, unknown>;
  if (['credits', 'power', 'radar', 'production'].some((k) => Array.isArray(o[k]))) {
    const has = (k: string) => Array.isArray(o[k]) && (o[k] as unknown[]).includes(other.id);
    const v: IntelView = { credits: has('credits'), power: has('power'), radar: has('radar'), production: has('production') };
    return v.credits || v.power || v.radar || v.production ? v : null;
  }
  const v = o[other.id];
  if (!v) return null;
  if (typeof v === 'object') {
    const f = v as Partial<IntelView>;
    return { credits: !!f.credits, power: !!f.power, radar: !!f.radar, production: !!f.production };
  }
  return all;
}

const SHORT_NAMES: Record<string, string> = {
  'Advanced Power Plant': 'Adv. Power',
  'Mobile Construction Vehicle': 'MCV',
  'Allied Tech Center': 'Tech Center',
  'Soviet Tech Center': 'Tech Center',
  'V2 Rocket Launcher': 'V2 Launcher',
  'Construction Yard': 'Const. Yard',
};
const shortName = (t: TypeDef) => SHORT_NAMES[t.name] ?? t.name;

const HARVEST_STATE: Record<string, string> = {
  seek: 'Searching for ore', toOre: 'Moving to ore field', harvesting: 'Harvesting', toRefinery: 'Returning to refinery',
  waitDock: 'Waiting to dock', unloading: 'Unloading', idle: 'Idle',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Card {
  id: string;
  el: HTMLElement;
  locked: boolean;
  state: string;
  pct: number;
  count: number;
  poor: boolean;
  arc: SVGCircleElement;
  label: HTMLElement;
  countEl: HTMLElement;
}

type CardState = 'idle' | 'build' | 'hold' | 'nofunds' | 'queued' | 'ready' | 'busy';

/** [HUD] Build-card hotkeys of the Modern layout: B arms them, then 1–9 / 0 picks the Nth card of the open tab. */
const CARD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export class Hud {
  private detachListeners: (() => void) | null = null;
  /** [HUD] The HUD on screen: a new one (replays rebuild theirs per viewed player) retires the previous one. */
  private static live: Hud | null = null;

  /** Detach document-level listeners and the layout's body state (the DOM itself is cleared with the UI root). */
  dispose() {
    if (Hud.live === this) Hud.live = null;
    this.detachListeners?.();
    this.detachListeners = null;
    window.clearTimeout(this.armTimer);
    // [HUD] the next screen (menus, another battle's HUD) starts from a clean body
    document.body.classList.remove('hud-modern');
    for (const v of ['--dock-h', '--tl-h', '--bb-h']) document.body.style.removeProperty(v);
  }
  readonly root: HTMLElement;
  readonly minimap: Minimap;
  private sound: UiSound;
  private tip: Tooltip;
  private toasts: Toasts;
  private sidebar: HTMLElement;
  private creditsBox: HTMLElement;
  private odo = new Odometer('odo cr-odo');
  private deltaEl: HTMLElement;
  private storeFill: HTMLElement;
  private powerBox: HTMLElement;
  private pw: Record<'out' | 'load' | 'deficit' | 'use' | 'num' | 'state', HTMLElement>;
  private radar: HTMLElement;
  private tabEls = new Map<TabId, HTMLButtonElement>();
  private tabInd: HTMLElement;
  private catTitle: HTMLElement;
  private catStatus: HTMLElement;
  private grid: HTMLElement;
  private supers: HTMLElement;
  private dock: HTMLElement;
  private groupsBar: HTMLElement;
  private selpanel: HTMLElement;
  private clock: HTMLElement;
  private fpsEl: HTMLElement;
  private objEl: HTMLElement;
  private intelEl: HTMLElement;
  /** Build-up time countdown: a chip in the Classic top bar, a row of the Modern objectives panel. */
  private cfChip: HTMLElement;
  private cfRow: HTMLElement;
  private cfKey = '';
  private intelKey = '';
  private tabsKey = '';
  private speedBtns: HTMLButtonElement[] = [];
  private sellBtn: HTMLButtonElement;
  private repairBtn: HTMLButtonElement;
  private activeTab: TabId = 'building';
  private tabUserChosen = false;
  private shownCredits = 0;
  private lastCredits = -1;
  private income = 0;
  private incomeAt = 0;
  private cards = new Map<string, Card>();
  private gridKey = '';
  private selKey = '';
  private extraHtml = '';
  private groupKey = '';
  private objKey = '';
  private superKey = '';
  private slowT = 0;
  private cashTickT = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private known: Set<string> | null = null;
  private newUntil = new Map<string, number>();
  private hoverCard: Card | null = null;

  // ---- [HUD] layout: the same widgets mounted as the Classic sidebar or the Modern corner panels
  private layout: HudLayout = 'classic';
  private ui: HTMLElement;
  private sbHead: HTMLElement;
  private tabsEl: HTMLElement;
  private catHead: HTMLElement;
  private topbar: HTMLElement;
  private topright: HTMLElement;
  private menuBtn: HTMLButtonElement;
  private speedEl: HTMLElement;
  private fsBtn: HTMLButtonElement | null = null;
  private logPanel: HTMLElement | null;
  /** Modern-only containers and widgets (detached in Classic). */
  private mmPanel: HTMLElement;
  private bbSide: HTMLElement;
  private bbMain: HTMLElement;
  private bbTop: HTMLElement;
  private rbRes: HTMLElement;
  private rbTime: HTMLElement;
  private rbBtns: HTMLElement;
  private unitsEl: HTMLElement;
  private settingsBtn: HTMLButtonElement;
  private objPanel: HTMLElement;
  private objPanelKey = '';
  private unitsKey = '';
  private visibleTabs: TabId[] = [];
  /** Unlocked cards of the open tab in hotkey order (1–9, 0). */
  private keyCards: Card[] = [];
  private armed = false;
  private armTimer = 0;
  private tutKey = '';

  constructor(private host: HudHost) {
    Hud.live?.dispose(); // [HUD] its widgets are about to be cleared with the UI root; drop its listeners too
    Hud.live = this;
    const ui = document.getElementById('ui')!;
    this.root = ui;
    this.ui = ui;
    ui.innerHTML = '';
    ui.classList.toggle('spectator', !!host.spectator);
    applyUiSettings();
    this.sound = new UiSound(host.audio);
    this.tip = new Tooltip();

    // ======================================================== sidebar
    const sb = el('div', 'panel');
    sb.id = 'sidebar';
    this.sidebar = sb;
    ui.appendChild(sb);

    const head = el('div', 'sb-head');
    this.sbHead = head;
    this.creditsBox = el('div', 'credits', `<span class="cr-ic">$</span><div class="cr-body"><span class="cr-lbl">Credits</span></div><span class="cr-delta"></span><span class="cr-store"><i></i></span>`);
    this.creditsBox.querySelector('.cr-body')!.appendChild(this.odo.el);
    this.deltaEl = this.creditsBox.querySelector('.cr-delta')!;
    this.storeFill = this.creditsBox.querySelector('.cr-store i')!;
    this.repairBtn = el('button', 'mode-btn', ICONS.wrench);
    this.repairBtn.dataset.tip = tipHtml('Repair mode', 'Click damaged structures to repair them. Costs credits.', [['R', 'Toggle']]);
    this.sellBtn = el('button', 'mode-btn', ICONS.sell);
    this.sellBtn.dataset.tip = tipHtml('Sell mode', 'Click a structure to sell it for a partial refund.', [['Z', 'Toggle']]);
    this.repairBtn.onclick = () => { if (host.spectator) return; this.sound.play('click'); host.setMode(host.getMode() === 'repair' ? 'normal' : 'repair'); };
    this.sellBtn.onclick = () => { if (host.spectator) return; this.sound.play('click'); host.setMode(host.getMode() === 'sell' ? 'normal' : 'sell'); };

    this.powerBox = el('div', 'power', `<div class="pw-head"><span class="pw-ic">${ICONS.boltSolid}</span><span class="pw-lbl">Power</span><span class="pw-state"></span><span class="pw-num"></span></div>
      <div class="pw-bar"><i class="pw-out"></i><i class="pw-load"></i><i class="pw-deficit"></i><i class="pw-segs"></i><i class="pw-use"></i></div>`);
    const q = (s: string) => this.powerBox.querySelector(s) as HTMLElement;
    this.pw = { out: q('.pw-out'), load: q('.pw-load'), deficit: q('.pw-deficit'), use: q('.pw-use'), num: q('.pw-num'), state: q('.pw-state') };

    this.radar = el('div', 'radar');
    this.minimap = new Minimap(this.radar, host.world, host.local, (x, y, b, d) => host.minimapPoint(x, y, b, d));
    this.radar.insertAdjacentHTML('beforeend', `<div class="radar-sweep"></div><div class="radar-grid"></div><div class="radar-frame"><i></i><i></i><i></i><i></i></div>
      <div class="offline"><span class="off-ic">${ICONS.radar}</span><b>Radar offline</b><span>Build a Radar Dome</span></div>`);

    const tabs = el('div', 'tabs');
    this.tabsEl = tabs;
    for (const t of [...TABS, SUPPORT_TAB]) {
      const modernTitle = MODERN_TABS.find((m) => m.id === t.id)?.title ?? t.title;
      // the label only shows in the Modern build bar (Classic tabs are icon-only)
      const b = el('button', 'tab', `${t.icon}<span class="tab-l">${modernTitle}</span><span class="tab-prog"><i></i></span><span class="badge"></span>`);
      b.dataset.tip = tipHtml(t.title);
      b.dataset.tab = t.id;
      b.onclick = () => this.pickTab(t.id);
      this.tabEls.set(t.id, b);
    }
    this.tabInd = el('span', 'tab-ind');

    const ch = el('div', 'cat-head', `<span class="cat-title"></span><span class="cat-line"></span><span class="cat-status"></span>`);
    this.catHead = ch;
    this.catTitle = ch.querySelector('.cat-title')!;
    this.catStatus = ch.querySelector('.cat-status')!;
    this.grid = el('div', 'build-grid');
    // reading scroll metrics forces a layout, so only on scroll / resize / grid rebuild (not every frame)
    this.grid.addEventListener('scroll', () => this.updateScrollFade(), { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.updateScrollFade()).observe(this.grid);
    // [HUD] the Modern build bar is one row of cards: the mouse wheel scrolls it sideways
    this.grid.addEventListener('wheel', (e) => {
      if (this.layout !== 'modern' || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const g = this.grid;
      if (g.scrollWidth <= g.clientWidth + 1) return;
      e.preventDefault();
      g.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 30 : 1);
    }, { passive: false });
    this.supers = el('div', 'supers');
    this.bindTips(sb, () => (this.layout === 'modern' ? 'top' : 'left'));
    this.sound.bind(sb, 'button:not(:disabled), .bitem');

    // ======================================================== top bar
    const tb = el('div');
    tb.id = 'topbar';
    this.topbar = tb;
    const menuBtn = el('button', 'tb-btn tb-menu', `${ICONS.menu}<span>Menu</span><kbd>Esc</kbd>`);
    this.menuBtn = menuBtn;
    menuBtn.onclick = () => { this.sound.play('click'); host.openPauseMenu(); };
    this.clock = el('div', 'tb-chip tb-clock', `${ICONS.clock}<span class="tb-time">00:00</span>`);
    this.clock.dataset.tip = tipHtml('Mission time');
    const speed = el('div', 'speed-ctl tb-chip');
    this.speedEl = speed;
    for (const [n, s, label] of GAME_SPEEDS.map((s, i) => [i + 1, s, GAME_SPEED_LABELS[i]] as [number, number, string])) {
      const b = el('button', '', `<span class="chev">${'<i></i>'.repeat(n)}</span>`);
      b.dataset.tip = tipHtml(`${label} speed`, '', [[`×${s}`, 'game speed']]);
      b.onclick = () => { this.sound.play('click'); host.setSpeed(s); };
      b.dataset.speed = String(s);
      this.speedBtns.push(b);
      speed.appendChild(b);
    }
    this.objEl = el('div', 'tb-chip tb-obj', `<span class="obj-ic">${ICONS.target}</span><span class="obj-txt"><small>Objective</small><b>Destroy all enemy forces</b></span><span class="obj-pips"></span>`);
    this.intelEl = el('div', 'tb-chip tb-intel');
    const cfTip = tipHtml('Build-up time', 'Ceasefire: the enemy builds up its forces and only defends itself until the timer runs out; attacking it does not end the ceasefire early. Expect a big attack when it does.',
      [['[', 'slower'], [']', `faster (up to ×${GAME_SPEEDS[GAME_SPEEDS.length - 1]})`]]);
    this.cfChip = el('div', 'tb-chip tb-cf', `<span class="cf-ic">${ICONS.shield}</span><span class="cf-txt"></span>`);
    this.cfRow = el('div', 'op-row cf-row', `<span class="cf-ic">${ICONS.shield}</span><span class="op-tx cf-txt"></span>`);
    this.cfChip.dataset.tip = cfTip;
    this.cfRow.dataset.tip = cfTip;
    this.cfChip.style.display = this.cfRow.style.display = 'none';
    ui.appendChild(tb);
    this.tip.bind(tb, 'bottom');
    this.sound.bind(tb, 'button');

    const tr = el('div');
    tr.id = 'topright';
    this.topright = tr;
    this.fpsEl = el('div', 'tb-chip tb-fps');
    this.fpsEl.id = 'fps';
    tr.appendChild(this.fpsEl);
    if (fullscreenSupported()) {
      const fsBtn = el('button', 'tb-btn tb-fs', ICONS.scatter);
      this.fsBtn = fsBtn;
      const sync = (on: boolean) => {
        fsBtn.classList.toggle('on', on);
        fsBtn.dataset.tip = tipHtml(on ? 'Leave fullscreen' : 'Fullscreen', on ? 'Hold <kbd>Esc</kbd> or press <kbd>Alt</kbd>+<kbd>Enter</kbd>.' : 'Edge scrolling works best fullscreen. <kbd>Alt</kbd>+<kbd>Enter</kbd>');
        fsBtn.setAttribute('aria-label', on ? 'Leave fullscreen' : 'Fullscreen');
      };
      fsBtn.onclick = () => { this.sound.play('click'); void toggleFullscreen(); };
      sync(isFullscreen());
      this.detachListeners = onFullscreenChange(sync);
      tr.appendChild(fsBtn);
    }
    ui.appendChild(tr);
    this.toasts = new Toasts(ui, tr, () => host.world.time, this.sound);
    this.logPanel = tr.querySelector('.notif-log');
    this.tip.bind(tr, 'bottom');
    this.sound.bind(tr, 'button');

    // ======================================================== bottom dock: control groups + selection
    this.dock = el('div');
    this.dock.id = 'dock';
    this.groupsBar = el('div');
    this.groupsBar.id = 'groups';
    this.selpanel = el('div', 'panel');
    this.selpanel.id = 'selpanel';
    this.dock.append(this.groupsBar, this.selpanel);
    ui.appendChild(this.dock);
    this.tip.bind(this.dock, 'top');
    this.sound.bind(this.dock, 'button');

    // ======================================================== [HUD] Modern-only widgets
    this.mmPanel = el('div', 'panel');
    this.mmPanel.id = 'minimap-panel';
    this.bbSide = el('div', 'bb-side');
    this.bbTop = el('div', 'bb-top');
    this.bbMain = el('div', 'bb-main');
    this.rbRes = el('div', 'rb-grp rb-res');
    this.rbTime = el('div', 'rb-grp rb-time');
    this.rbBtns = el('div', 'rb-grp rb-btns');
    this.unitsEl = el('div', 'tb-chip rb-units', `${ICONS.people}<b>0</b>`);
    this.settingsBtn = el('button', 'tb-btn rb-gear', ICONS.gear);
    this.settingsBtn.dataset.tip = tipHtml('Settings', 'Graphics, audio, controls and the interface layout (the game pauses).');
    this.settingsBtn.onclick = () => {
      this.sound.play('click');
      host.openPauseMenu();
      // straight to the settings page of the pause menu (Back returns to the pause menu)
      document.querySelector<HTMLElement>('.pause-panel [data-act="settings"]')?.click();
    };
    this.objPanel = el('div', 'obj-panel panel');
    this.tip.bind(this.mmPanel, 'right');

    // radios (mission, rival) sit above the bottom panels; they change height with what is selected
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.measure());
      for (const e of [this.dock, this.mmPanel, sb, tb]) ro.observe(e);
      const prev = this.detachListeners;
      this.detachListeners = () => { prev?.(); ro.disconnect(); };
    }

    // HUD buttons must not keep keyboard focus: Space / Enter are game hotkeys and would re-click them.
    const noFocus = (e: MouseEvent) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); };
    for (const c of [sb, tb, tr, this.dock, this.mmPanel]) c.addEventListener('mousedown', noFocus);
    const label = (b: HTMLElement, l: string) => b.setAttribute('aria-label', l);
    label(this.repairBtn, 'Repair mode');
    label(this.sellBtn, 'Sell mode');
    label(menuBtn, 'Menu');
    label(this.settingsBtn, 'Settings');
    label(this.toasts.bell, 'Event log');
    this.speedBtns.forEach((b) => label(b, `Game speed ${b.dataset.speed}x`));

    // [HUD] build-bar hotkeys (Modern) and live layout switching from the settings screen
    window.addEventListener('keydown', this.onKeyDown, true);
    const offSettings = onSettingsChanged((s) => { const l = hudLayoutOf(s); if (l !== this.layout && this.sidebar.isConnected) this.mount(l); });
    const prev = this.detachListeners;
    this.detachListeners = () => { prev?.(); offSettings(); window.removeEventListener('keydown', this.onKeyDown, true); };

    this.mount(hudLayoutOf(loadSettings()));

    this.shownCredits = host.local.credits;
    this.odo.set(this.shownCredits);
  }

  // ---------------------------------------------------------------------------
  // [HUD] Layout
  // ---------------------------------------------------------------------------
  /** The tabs of the current layout. */
  private tabDefs(): TabDef[] {
    return this.layout === 'modern' ? MODERN_TABS : TABS;
  }

  /** The tab a type is listed under (Modern files tech / support structures under "Support"). */
  private tabOf(id: string): TabId {
    const t = getType(id);
    return this.layout === 'modern' && isSupportStructure(t) ? 'support' : t.category;
  }

  /**
   * Arrange the widgets for a layout. Classic rebuilds exactly the original DOM (sidebar on the right, top bar,
   * bottom dock); Modern moves the same elements into the corner panels and the bottom build bar. Elements other
   * modules add to #topbar / #ui (mode chips, mission objectives, radios, hints) are left where they are.
   */
  private mount(layout: HudLayout) {
    this.layout = layout;
    const modern = layout === 'modern';
    const body = document.body;
    body.classList.toggle('hud-modern', modern);
    const sb = this.sidebar, tb = this.topbar, tr = this.topright;
    this.tabsEl.replaceChildren(...this.tabDefs().map((t) => this.tabEls.get(t.id)!), this.tabInd);
    for (const t of this.tabDefs()) this.tabEls.get(t.id)!.setAttribute('aria-label', t.title);
    const mission = this.ui.querySelector<HTMLElement>('.mh-obj');
    if (modern) {
      sb.id = 'buildbar';
      this.bbSide.replaceChildren(this.repairBtn, this.sellBtn);
      this.bbTop.replaceChildren(this.tabsEl, this.catHead);
      this.bbMain.replaceChildren(this.bbTop, this.grid);
      sb.replaceChildren(this.bbSide, this.bbMain, this.supers);
      this.sbHead.remove();
      this.mmPanel.replaceChildren(this.radar);
      if (!this.mmPanel.isConnected) this.ui.insertBefore(this.mmPanel, this.dock.nextSibling);
      this.rbRes.replaceChildren(this.creditsBox, this.powerBox, this.unitsEl);
      this.rbTime.replaceChildren(this.clock, this.speedEl);
      this.rbBtns.replaceChildren(...[this.fsBtn, this.toasts.bell, this.settingsBtn, this.menuBtn].filter((b): b is HTMLButtonElement => !!b));
      tr.replaceChildren(this.fpsEl, this.rbRes, this.rbTime, this.rbBtns, ...(this.logPanel ? [this.logPanel] : []));
      this.objEl.remove();
      this.cfChip.remove();
      tb.prepend(...(mission ? [mission] : []), this.objPanel, this.intelEl);
    } else {
      sb.id = 'sidebar';
      this.sbHead.replaceChildren(this.creditsBox, this.repairBtn, this.sellBtn);
      sb.replaceChildren(this.sbHead, this.powerBox, this.radar, this.tabsEl, this.catHead, this.grid, this.supers);
      this.mmPanel.remove();
      tr.replaceChildren(this.fpsEl, ...[this.fsBtn, this.toasts.bell, this.logPanel].filter((b): b is HTMLElement => !!b));
      this.objPanel.remove();
      tb.prepend(this.menuBtn, this.clock, this.speedEl, this.objEl, this.cfChip, this.intelEl);
      if (mission) this.ui.appendChild(mission);
    }
    this.setArmed(false);
    // everything re-renders for the new arrangement on the next update
    this.gridKey = ''; this.tabsKey = ''; this.superKey = ''; this.objKey = ''; this.objPanelKey = ''; this.tutKey = ''; this.cfKey = '';
    if (this.selKey) { this.selKey = ''; this.selpanel.classList.remove('on'); }
    this.grid.scrollTop = 0; this.grid.scrollLeft = 0;
    this.slowT = 0;
    this.measure();
  }

  /** Publish the HUD's footprint for the panels other modules position around it (radios, hints, replay bar). */
  private measure() {
    const s = document.body.style;
    if (this.layout === 'modern') {
      s.setProperty('--dock-h', `${Math.max(this.mmPanel.offsetHeight, this.sidebar.offsetHeight)}px`);
      s.setProperty('--tl-h', `${this.topbar.offsetHeight}px`);
      s.setProperty('--bb-h', `${this.sidebar.offsetHeight}px`);
    } else {
      s.setProperty('--dock-h', `${this.dock.offsetHeight}px`);
      s.removeProperty('--tl-h');
      s.removeProperty('--bb-h');
    }
  }

  /** Tooltip delegation whose default side follows the layout (sidebar: left of it; build bar: above). */
  private bindTips(root: HTMLElement, side: () => TipSide) {
    root.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (!t || !root.contains(t) || this.tip.isFor(t)) return;
      this.tip.show(t, t.dataset.tip!, (t.dataset.tipSide as TipSide) ?? side());
    });
    root.addEventListener('pointerout', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (t && !t.contains(e.relatedTarget as Node)) this.tip.hide(t);
    });
  }

  private pickTab(id: TabId) {
    if (this.activeTab !== id) this.sound.play('tab');
    this.activeTab = id;
    this.tabUserChosen = true;
    this.gridKey = '';
    this.slowT = 0;
  }

  /** [HUD] Keyboard for the Modern build bar: Tab / Shift+Tab switch tabs, B then 1–9 / 0 builds the Nth card. */
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.layout !== 'modern' || this.host.spectator || e.ctrlKey || e.metaKey || e.altKey || !this.sidebar.isConnected) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('.screen, .rv, .chx')) return; // a menu is open (the game is paused)
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === 'Tab') {
      stop();
      this.cycleTab(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.code === 'KeyB') {
      stop();
      if (!e.repeat) this.setArmed(!this.armed);
      return;
    }
    if (!this.armed) return;
    if (e.key === 'Escape') { stop(); this.setArmed(false); return; }
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1];
    if (digit === undefined) return;
    stop();
    if (!this.gridKey) this.updateTabs(this.host.local); // a tab switch since the last HUD update: build its cards first
    const card = this.keyCards[CARD_KEYS.indexOf(digit)];
    if (card?.el.isConnected) {
      this.clickItem(card, e.shiftKey);
      replay(card.el, 'keyhit', 350);
    } else this.sound.play('error');
    this.setArmed(false);
  };

  private setArmed(on: boolean) {
    this.armed = on;
    window.clearTimeout(this.armTimer);
    this.sidebar.classList.toggle('armed', on);
    if (on) {
      this.sound.play('tab');
      this.armTimer = window.setTimeout(() => this.setArmed(false), 3500);
    }
  }

  private cycleTab(d: number) {
    const vis = this.visibleTabs;
    if (!vis.length) return;
    const i = vis.indexOf(this.activeTab);
    this.pickTab(vis[(Math.max(0, i) + d + vis.length) % vis.length]);
    if (this.armed) this.setArmed(true);
  }

  /** Show a notification toast. `kind` overrides the style inferred from the text. */
  message(text: string, warn = false, kind?: ToastKind) {
    this.toasts.push(text, kind ?? classifyMessage(text, warn));
  }

  // ---------------------------------------------------------------------------
  update(dt: number) {
    const p = this.host.local;
    const w = this.host.world;
    this.updateCredits(dt, p);
    this.toasts.update(dt);

    this.fpsAcc += dt; this.fpsN++;
    this.slowT -= dt;
    if (this.slowT > 0) {
      this.updateCards();
      return;
    }
    this.slowT = 0.12;
    if (this.fpsAcc > 0.5) {
      const s = this.host.stats?.() ?? '';
      this.fpsEl.innerHTML = `<b>${Math.round(this.fpsN / this.fpsAcc)}</b> FPS${s ? ` <span>· ${esc(s)}</span>` : ''}`;
      this.fpsAcc = 0; this.fpsN = 0;
    }
    (this.clock.lastElementChild as HTMLElement).textContent = formatTime(w.time);
    this.updatePower(p);
    const online = p.radar || !w.fog || this.minimap.revealAll;
    this.radar.classList.toggle('online', online);
    this.sellBtn.classList.toggle('active', this.host.getMode() === 'sell');
    this.repairBtn.classList.toggle('active', this.host.getMode() === 'repair');
    const sp = this.host.getSpeed();
    for (const b of this.speedBtns) b.classList.toggle('on', Math.abs(+b.dataset.speed! - sp) < 0.01);

    this.updateTabs(p);
    this.updateCards();
    this.updateSupers();
    this.updateSelection();
    this.updateGroups();
    this.updateObjective();
    this.updateIntel();
    if (this.layout === 'modern') {
      this.updateUnits(p);
      this.updateObjPanel();
      this.updateTutorial();
    }
    this.updateCeasefire();
  }

  // ---------------------------------------------------------------------------
  private updateCredits(dt: number, p: Player) {
    const target = p.credits;
    const diff = target - this.shownCredits;
    if (Math.abs(diff) >= 1) {
      const step = Math.sign(diff) * Math.max(1, Math.abs(diff) * Math.min(1, dt * 6));
      this.shownCredits += Math.abs(step) > Math.abs(diff) ? diff : step;
      this.cashTickT -= dt;
      if (this.cashTickT <= 0 && Math.abs(diff) > 4) { this.cashTickT = 0.07; this.host.audio.play('cash_tick', undefined, { volume: 0.35 }); }
    } else this.shownCredits = target;
    this.odo.set(this.shownCredits);

    // income pops: accumulate deposits until the flow pauses, then show "+$X"
    if (this.lastCredits >= 0) {
      const d = target - this.lastCredits;
      if (d > 0) { this.income += d; this.incomeAt = performance.now(); this.flash('gain'); }
      else if (d <= -150) { this.flash('spend'); this.popDelta(d); }
    }
    this.lastCredits = target;
    if (this.income > 0 && performance.now() - this.incomeAt > 600) {
      if (this.income >= 20) this.popDelta(this.income);
      this.income = 0;
    }
    const full = p.storage > 0 && p.ore >= p.storage - 1;
    this.creditsBox.classList.toggle('storage-full', full);
    this.storeFill.style.transform = `scaleX(${p.storage > 0 ? Math.min(1, p.ore / p.storage).toFixed(3) : 0})`;
  }

  private flash(kind: 'gain' | 'spend') {
    const c = this.creditsBox;
    if (c.classList.contains('fl-' + kind)) return;
    c.classList.add('fl-' + kind);
    setTimeout(() => c.classList.remove('fl-' + kind), 650);
  }

  private popDelta(v: number) {
    const d = this.deltaEl;
    d.textContent = `${v > 0 ? '+' : '−'}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
    d.className = 'cr-delta ' + (v > 0 ? 'up' : 'down');
    void d.offsetWidth;
    d.classList.add('go');
  }

  private updatePower(p: Player) {
    const max = Math.max(100, p.powerOut, p.powerUse) * 1.08;
    const out = p.powerOut / max, use = p.powerUse / max;
    this.pw.out.style.width = `${out * 100}%`;
    this.pw.load.style.width = `${Math.min(out, use) * 100}%`;
    this.pw.deficit.style.left = `${out * 100}%`;
    this.pw.deficit.style.width = `${Math.max(0, use - out) * 100}%`;
    this.pw.use.style.left = `${use * 100}%`;
    const ratio = p.powerOut > 0 ? p.powerUse / p.powerOut : p.powerUse > 0 ? 2 : 0;
    const state = p.lowPower ? 'low' : ratio > 0.85 ? 'tight' : 'ok';
    if (this.powerBox.dataset.state !== state) {
      this.powerBox.dataset.state = state;
      this.sidebar.classList.toggle('low-power', state === 'low');
      this.pw.state.textContent = state === 'low' ? 'Low power' : state === 'tight' ? 'Near capacity' : '';
    }
    const num = `<b class="pw-o">${p.powerOut}</b><small>/</small><b class="${p.lowPower ? 'pw-over' : ''}">${p.powerUse}</b>`;
    if (this.pw.num.innerHTML !== num) this.pw.num.innerHTML = num;
    const tip = tipHtml('Power grid', (p.lowPower
      ? '<span class="tt-bad">Low power!</span> Production is slowed; radar, Tesla Coils and superweapons are offline. Build more power plants.'
      : `Surplus <b>${p.powerOut - p.powerUse}</b>.`) + `<br>Output <b>${p.powerOut}</b> · drain <b>${p.powerUse}</b>`);
    this.powerBox.dataset.tip = tip;
    this.tip.refresh(this.powerBox, tip);
  }

  /** [HUD] Army size in the Modern resource bar (own units by kind in the tooltip). */
  private updateUnits(p: Player) {
    let inf = 0, veh = 0, air = 0, sea = 0, blds = 0;
    for (const u of this.host.world.units) {
      if (!u.alive || u.owner !== p) continue;
      if (u.kind === 'infantry') inf++;
      else if (u.kind === 'aircraft') air++;
      else if (u.kind === 'naval') sea++;
      else veh++;
    }
    for (const b of this.host.world.buildings) if (b.alive && b.owner === p && !b.bt.wall && !b.bt.mine) blds++;
    const key = `${inf}|${veh}|${air}|${sea}|${blds}`;
    if (key === this.unitsKey) return;
    this.unitsKey = key;
    (this.unitsEl.lastElementChild as HTMLElement).textContent = String(inf + veh + air + sea);
    const tip = tipHtml('Army', `Infantry <b>${inf}</b> · vehicles <b>${veh}</b>${air ? ` · aircraft <b>${air}</b>` : ''}${sea ? ` · ships <b>${sea}</b>` : ''}<br>Structures <b>${blds}</b>`, [['E', 'select every combat unit']]);
    this.unitsEl.dataset.tip = tip;
    this.tip.refresh(this.unitsEl, tip);
  }

  // ---------------------------------------------------------------------------
  /** Structures, defences and support share one queue; units have one queue per category. */
  private queueFor(p: Player, tab: TabId): ProductionQueue {
    const kind = tab === 'building' || tab === 'defense' || tab === 'support' ? 'structure' : tab;
    return p.queues[kind];
  }

  private updateTabs(p: Player) {
    const avail = new Map<TabId, string[]>();
    const add = (id: string) => {
      const tab = this.tabOf(id);
      const list = avail.get(tab) ?? [];
      if (!list.includes(id)) list.push(id);
      avail.set(tab, list);
    };
    const opts = p.buildOptions();
    for (const id of opts) add(id);
    // keep items that are in progress visible even if tech was lost
    for (const qq of Object.values(p.queues)) {
      for (const it of qq.items) add(it.type);
      if (qq.ready) add(qq.ready);
    }
    // "NEW" flags for freshly unlocked options
    const now = performance.now();
    if (!this.known) this.known = new Set(opts);
    else for (const id of opts) if (!this.known.has(id)) { this.known.add(id); this.newUntil.set(id, now + 14000); }

    const defs = this.tabDefs();
    if (!(avail.get(this.activeTab)?.length) && !this.tabUserChosen) {
      const first = defs.find((t) => avail.get(t.id)?.length);
      if (first && first.id !== this.activeTab) { this.activeTab = first.id; this.gridKey = ''; }
    }
    if (avail.get(this.activeTab)?.length) this.tabUserChosen = false;

    // conditional tabs (naval, …) appear once the category can be built or a producer is owned
    const visible = defs.filter((t) => !t.conditional || (avail.get(t.id)?.length ?? 0) > 0 || ownsProducer(p, t.cat));
    if (!visible.some((t) => t.id === this.activeTab)) { this.activeTab = visible[0].id; this.gridKey = ''; }
    this.visibleTabs = visible.map((t) => t.id);
    const vkey = this.layout + ':' + visible.map((t) => t.id).join(',');
    if (vkey !== this.tabsKey) {
      const grew = this.tabsKey && this.tabsKey.split(':')[0] === this.layout && visible.length > this.tabsKey.split(':')[1].split(',').length;
      this.tabsKey = vkey;
      for (const t of defs) {
        const b = this.tabEls.get(t.id)!;
        const show = visible.includes(t);
        b.style.display = show ? '' : 'none';
        if (show && grew && t.conditional) replay(b, 'pop', 650);
      }
      (this.tabInd.parentElement as HTMLElement).style.gridTemplateColumns = `repeat(${visible.length}, 1fr)`;
      this.tabInd.style.width = `calc((100% - ${((visible.length - 1) * 0.3).toFixed(1)}rem) / ${visible.length})`;
    }
    const vi = Math.max(0, visible.findIndex((t) => t.id === this.activeTab));
    const tr = `translateX(calc(${vi * 100}% + ${(vi * 0.3).toFixed(1)}rem))`;
    if (this.tabInd.style.transform !== tr) this.tabInd.style.transform = tr;

    for (const t of defs) {
      const b = this.tabEls.get(t.id)!;
      const n = avail.get(t.id)?.length ?? 0;
      const q = this.queueFor(p, t.id);
      const isStruct = q.kind === 'structure';
      const ready = isStruct && !!q.ready && this.tabOf(q.ready) === t.id;
      const mine = q.items.filter((it) => this.tabOf(it.type) === t.id);
      const head = mine.length && q.items[0] === mine[0] ? mine[0] : null;
      const hasNew = [...(avail.get(t.id) ?? [])].some((id) => (this.newUntil.get(id) ?? 0) > now);
      b.classList.toggle('empty', n === 0);
      b.classList.toggle('active', t.id === this.activeTab);
      b.classList.toggle('has-new', hasNew && t.id !== this.activeTab);
      const badge = b.querySelector('.badge') as HTMLElement;
      const txt = ready ? '' : mine.length ? String(mine.length) : '';
      badge.className = 'badge' + (ready ? ' on ready' : mine.length ? ' on' : '');
      if (badge.innerHTML !== (ready ? ICONS.check : txt)) badge.innerHTML = ready ? ICONS.check : txt;
      const prog = b.querySelector('.tab-prog') as HTMLElement;
      prog.classList.toggle('on', !!head || ready);
      prog.classList.toggle('hold', !!head?.paused);
      (prog.firstElementChild as HTMLElement).style.transform = `scaleX(${ready ? 1 : head ? head.progress.toFixed(3) : 0})`;
      const status = ready ? '<span class="tt-ok">Ready to place</span>' : head ? `${head.paused ? 'On hold' : 'Producing'}: <b>${getType(head.type).name}</b> ${Math.floor(head.progress * 100)}%` + (mine.length > 1 ? ` · ${mine.length - 1} queued` : '') : n ? `${n} available` : 'Nothing available yet';
      const tip = tipHtml(t.title, status, this.layout === 'modern' ? [['Tab', 'next tab']] : []);
      if (b.dataset.tip !== tip) { b.dataset.tip = tip; this.tip.refresh(b, tip); }
    }

    // grid
    // cheapest first, decoy structures last (they would otherwise top the list at $50)
    const decoy = (id: string) => (BUILDINGS[id]?.fakeOf ? 1 : 0);
    const list = (avail.get(this.activeTab) ?? []).sort((a, b) => decoy(a) - decoy(b) || getType(a).cost - getType(b).cost);
    const tabCat = this.activeTab === 'support' ? 'building' : this.activeTab;
    const locked = factionTypes(p.faction, tabCat).filter((id) => !list.includes(id) && this.tabOf(id) === this.activeTab).sort((a, b) => decoy(a) - decoy(b));
    const key = this.activeTab + ':' + list.join(',') + '|' + locked.join(',');
    if (key !== this.gridKey) { this.rebuildGrid(list, locked, key); this.updateScrollFade(); }
    for (const c of this.cards.values()) c.el.classList.toggle('is-new', (this.newUntil.get(c.id) ?? 0) > now);
    this.updateCatHeader(p, list, locked);
    if (this.hoverCard) this.tip.refresh(this.hoverCard.el, this.cardTip(this.hoverCard));
  }

  /** Fade the grid edges only where more cards are hidden by scrolling. */
  private updateScrollFade() {
    const g = this.grid;
    if (this.layout === 'modern') {
      // one row of cards: fade the sides instead
      g.classList.toggle('more-right', g.scrollWidth - g.clientWidth - g.scrollLeft > 4);
      g.classList.toggle('more-left', g.scrollLeft > 4);
      g.classList.remove('more-below', 'more-above');
      return;
    }
    g.classList.remove('more-right', 'more-left');
    g.classList.toggle('more-below', g.scrollHeight - g.clientHeight - g.scrollTop > 4);
    g.classList.toggle('more-above', g.scrollTop > 4);
  }

  private updateCatHeader(p: Player, list: string[], locked: string[]) {
    const tab = this.tabDefs().find((t) => t.id === this.activeTab) ?? this.tabDefs()[0];
    this.catTitle.textContent = tab.title;
    const q = this.queueFor(p, this.activeTab);
    const mine = q.items.filter((it) => this.tabOf(it.type) === this.activeTab);
    const head = mine.length && q.items[0] === mine[0] ? mine[0] : null;
    let html: string, cls = '';
    if (q.kind === 'structure' && q.ready) {
      const t = getType(q.ready);
      if (this.tabOf(t.id) === this.activeTab) { html = `Place ${esc(shortName(t))}`; cls = 'ok'; }
      else { html = 'Yard busy'; cls = 'muted'; }
    } else if (head) {
      const pct = Math.floor(head.progress * 100);
      html = head.paused ? 'On hold' : q.stalled ? 'Awaiting funds' : `${q.kind === 'structure' ? 'Building' : 'Training'} ${pct}%`;
      cls = head.paused ? 'hold' : q.stalled ? 'bad' : 'busy';
      if (mine.length > 1) html += ` <small>+${mine.length - 1}</small>`;
    } else if (q.kind === 'structure' && q.items.length) {
      html = 'Yard busy'; cls = 'muted';
    } else if (!list.length && locked.length) {
      const req = missingRequirements(p, locked[0])[0];
      html = req ? `Requires ${esc(req)}` : 'Locked';
      cls = 'bad';
    } else {
      html = `${list.length} available`;
      cls = 'muted';
    }
    if (this.catStatus.innerHTML !== html) this.catStatus.innerHTML = html;
    this.catStatus.className = 'cat-status ' + cls;
  }

  private rebuildGrid(list: string[], locked: string[], key: string) {
    const tabChanged = this.gridKey.split(':')[0] !== key.split(':')[0];
    this.gridKey = key;
    this.grid.innerHTML = '';
    this.cards.clear();
    this.keyCards = [];
    if (this.hoverCard) { this.tip.hide(this.hoverCard.el); this.hoverCard = null; }
    let i = 0;
    for (const id of list) this.grid.appendChild(this.makeCard(id, false, i++));
    if (locked.length) {
      this.grid.appendChild(el('div', 'grid-sep', `${ICONS.lock}<span>Requires tech</span><i></i>`));
      for (const id of locked) this.grid.appendChild(this.makeCard(id, true, i++));
    }
    if (!list.length && !locked.length) this.grid.appendChild(el('div', 'grid-empty', `${TAB_ICON(this.activeTab)}<span>Nothing to build here yet</span>`));
    this.grid.classList.remove('stagger', 'stagger-soft');
    void this.grid.offsetWidth;
    this.grid.classList.add(tabChanged ? 'stagger' : 'stagger-soft');
    if (tabChanged) { this.grid.scrollTop = 0; this.grid.scrollLeft = 0; }
    this.tutKey = '';
    this.updateCards();
  }

  private makeCard(id: string, locked: boolean, i: number): HTMLElement {
    const t = getType(id);
    const img = this.host.thumbs.get(id);
    const c = el('div', 'bitem' + (locked ? ' locked' : ''));
    c.style.setProperty('--i', String(i));
    c.dataset.id = id;
    // [HUD] build hotkey (Modern: B, then the digit); hidden in the Classic sidebar
    const keyIdx = locked ? -1 : this.keyCards.length;
    const hk = keyIdx >= 0 && keyIdx < CARD_KEYS.length ? CARD_KEYS[keyIdx] : '';
    c.innerHTML = `<div class="bi-tilt">
        <div class="bi-img">${img ? `<img src="${img}" alt="" draggable="false">` : `<span class="bi-fallback">${CAT_ICON[t.category]}</span>`}</div>
        <div class="bi-shade"></div>
        <svg class="bi-ring" viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="40"/><circle class="arc" cx="50" cy="50" r="40" pathLength="100"/></svg>
        <div class="bi-label"></div>
        <span class="bi-cost">$${t.cost.toLocaleString('en-US')}</span>
        <span class="bi-name">${esc(shortName(t))}</span>
        <span class="bi-count"></span>
        ${locked ? `<span class="bi-lock">${ICONS.lock}</span>` : ''}
        <span class="bi-new">New</span>${modCardTag(id)}${hk ? `<kbd class="bi-key">${hk}</kbd>` : ''}
        <div class="bi-glare"></div><div class="bi-shine"></div>
      </div>`;
    const card: Card = {
      id, el: c, locked, state: '', pct: -1, count: -1, poor: false,
      arc: c.querySelector('.arc') as SVGCircleElement, label: c.querySelector('.bi-label')!, countEl: c.querySelector('.bi-count')!,
    };
    if (!locked) this.keyCards.push(card);
    c.addEventListener('click', (ev) => this.clickItem(card, ev.shiftKey));
    c.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.rightClickItem(card); });
    c.addEventListener('pointerenter', () => { this.hoverCard = card; this.tip.show(c, this.cardTip(card), this.layout === 'modern' ? 'top' : 'left'); });
    c.addEventListener('pointerleave', () => { if (this.hoverCard === card) this.hoverCard = null; this.tip.hide(c); });
    bindTilt(c, 10);
    this.cards.set(id, card);
    return c;
  }

  private updateCards() {
    const p = this.host.local;
    const credits = p.credits;
    for (const card of this.cards.values()) {
      if (card.locked) continue;
      const t = getType(card.id);
      const q = p.queues[queueKindOf(t)];
      const ready = q.ready === card.id;
      const n = q.count(card.id);
      const head = q.items[0]?.type === card.id ? q.items[0] : null;
      const busy = q.kind === 'structure' && !ready && !head && (!!q.ready || q.items.length > 0);
      const state: CardState = ready ? 'ready' : head ? (head.paused ? 'hold' : q.stalled ? 'nofunds' : 'build') : n > 0 ? 'queued' : busy ? 'busy' : 'idle';
      const pct = ready ? 100 : head ? Math.floor(head.progress * 1000) / 10 : 0;
      if (state !== card.state) {
        const was = card.state;
        card.state = state;
        card.el.dataset.state = state;
        card.label.innerHTML = state === 'ready' ? `${ICONS.check}<span>Ready</span>`
          : state === 'hold' ? `<span class="lb-hold">On hold</span>`
          : state === 'nofunds' ? `${ICONS.coin}<span>No funds</span>`
          : state === 'queued' ? `<span class="lb-q">Queued</span>` : '';
        if (state === 'ready' && was) replay(card.el, 'pop', 650);
      }
      if (pct !== card.pct) {
        card.pct = pct;
        card.arc.style.strokeDashoffset = String(100 - pct);
        if (state === 'build') card.label.innerHTML = `<b>${Math.floor(pct)}</b><small>%</small>`;
      } else if (state === 'build' && !card.label.firstElementChild) card.label.innerHTML = `<b>${Math.floor(pct)}</b><small>%</small>`;
      if (n !== card.count) {
        card.count = n;
        card.countEl.textContent = n > 1 ? `×${n}` : '';
        card.countEl.classList.toggle('on', n > 1);
        if (n > 1) replay(card.countEl, 'bump', 400);
      }
      // [CTRL] planned copies of this structure (build plan)
      const planned = q.kind === 'structure' ? p.buildPlan.reduce((n, x) => n + (x.type === card.id ? 1 : 0), 0) : 0;
      if ((card.el.dataset.planned ?? '') !== (planned ? `${planned}` : '')) { if (planned) card.el.dataset.planned = `${planned}`; else delete card.el.dataset.planned; }
      const poor = state === 'idle' && credits < t.cost;
      if (poor !== card.poor) { card.poor = poor; card.el.classList.toggle('poor', poor); }
    }
  }

  private cardTip(card: Card): string {
    const t = getType(card.id);
    const w = this.host.world, p = this.host.local;
    const lines = statLines(t);
    const rows = lines.map((l) => `<span class="ts-l">${l.label}</span><span class="ts-v">${esc(l.value)}</span>${l.frac !== undefined ? `<span class="ts-bar"><i style="width:${Math.round(Math.min(1, l.frac) * 100)}%"></i></span>` : '<span></span>'}`).join('');
    let foot = '';
    if (card.locked) {
      const req = missingRequirements(p, card.id);
      foot = `<div class="tt-req">${ICONS.lock}<span>Requires <b>${req.map(esc).join('</b>, <b>') || 'more technology'}</b></span></div>`;
    } else {
      const secs = buildSeconds(w, p, card.id);
      const poor = p.credits < t.cost;
      foot = `<div class="tt-meta"><span>${ICONS.clock}${Math.ceil(secs)}s build</span>${poor ? `<span class="tt-bad">${ICONS.coin}Need $${(t.cost - p.credits).toLocaleString('en-US')} more</span>` : ''}${p.lowPower ? `<span class="tt-bad">${ICONS.bolt}Low power: slower</span>` : ''}</div>`;
      const hk = this.layout === 'modern' ? CARD_KEYS[this.keyCards.indexOf(card)] : undefined;
      foot += `<div class="tt-keys"><span><kbd>LMB</kbd>${isBuildingType(t) ? 'Build / place' : 'Train'}</span>${isBuildingType(t) ? '' : '<span><kbd>Shift</kbd>×5</span>'}<span><kbd>RMB</kbd>Hold / cancel</span>${hk ? `<span><kbd>B</kbd><kbd>${hk}</kbd>Hotkey</span>` : ''}</div>`;
    }
    return `<div class="tt-head"><b>${esc(t.name)}</b><span class="tt-cost">$${t.cost.toLocaleString('en-US')}</span></div>
      <div class="tt-sub">${cap(t.category === 'building' ? 'structure' : t.category)}${isBuildingType(t) ? ` · ${t.size[0]}×${t.size[1]}` : ''}</div>
      <p>${esc(t.description)}</p><div class="tt-stats">${rows}</div>${modTipHtml(card.id)}${foot}`;
  }

  private clickItem(card: Card, shift: boolean) {
    if (this.host.spectator) return;
    const id = card.id;
    const p = this.host.local;
    const t = getType(id);
    const q = p.queues[queueKindOf(t)];
    if (card.locked) {
      this.sound.play('error');
      const req = missingRequirements(p, id);
      this.message(`${t.name} requires ${req.join(', ') || 'more technology'}`, true);
      replay(card.el, 'shake', 450);
      return;
    }
    this.sound.play('click');
    if (isBuildingType(t)) {
      if (q.ready === id) { this.host.beginPlacement(id); return; }
      // [CTRL] yard busy (or Shift): plan it instead; the yard builds and places it later
      if (shift || q.ready || (q.items.length && q.items[0].type !== id)) {
        this.host.beginPlacement(id);
        if (this.host.getMode() === 'plan') return;
        this.message('Already building', true);
        this.host.audio.play('error');
        replay(card.el, 'shake', 450);
        return;
      }
      if (q.items[0]?.type === id) {
        if (q.items[0].paused) this.host.issue({ c: 'pause', player: p.id, type: id });
        return;
      }
      this.host.issue({ c: 'build', player: p.id, type: id });
    } else {
      const head = q.items[0];
      if (head && head.type === id && head.paused) { this.host.issue({ c: 'pause', player: p.id, type: id }); return; }
      this.host.issue({ c: 'build', player: p.id, type: id, count: shift ? 5 : 1 });
    }
  }

  private rightClickItem(card: Card) {
    if (card.locked || this.host.spectator) return;
    const id = card.id;
    const p = this.host.local;
    const t = getType(id);
    const q = p.queues[queueKindOf(t)];
    this.sound.play('click');
    if (q.ready === id) { this.host.issue({ c: 'cancel', player: p.id, type: id }); return; }
    const head = q.items[0];
    // commands apply on the next sim tick: a second click before then must cancel, not un-pause
    const tick = this.host.world.tick;
    const pausing = this.pendingPause?.id === id && this.pendingPause.tick === tick;
    if (head && head.type === id && !head.paused && !pausing) {
      this.host.issue({ c: 'pause', player: p.id, type: id });
      this.pendingPause = { id, tick };
    } else if (q.count(id) > 0) this.host.issue({ c: 'cancel', player: p.id, type: id });
  }
  private pendingPause: { id: string; tick: number } | null = null;

  // ---------------------------------------------------------------------------
  private updateSupers() {
    const w = this.host.world, p = this.host.local;
    const kinds = SUPER_KINDS.filter((k) => powerAvailable(w, p, k));
    const key = kinds.join(',');
    if (this.superKey !== key) {
      this.superKey = key;
      this.supers.innerHTML = '';
      this.supers.classList.toggle('on', kinds.length > 0);
      this.supers.classList.toggle('compact', kinds.length > 2);
      for (const k of kinds) {
        const b = el('button', `super sw-${k}`, `<span class="sw-ring"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="44"/><circle class="arc" cx="50" cy="50" r="44" pathLength="100"/></svg><span class="sw-ic">${SUPER_INFO[k].icon}</span></span>
          <span class="sw-txt"><b>${SUPER_INFO[k].name}</b><small></small></span><span class="sw-shine"></span>`);
        b.dataset.kind = k;
        b.setAttribute('aria-label', SUPER_INFO[k].name);
        b.onclick = () => this.activatePower(k);
        this.supers.appendChild(b);
      }
    }
    for (const b of this.supers.querySelectorAll<HTMLElement>('.super')) {
      const k = b.dataset.kind as SuperKind;
      const full = powerFull(w, p, k);
      const frac = Math.min(1, p.superCharge[k] / full);
      (b.querySelector('.arc') as SVGElement).style.strokeDashoffset = String(100 - frac * 100);
      const ready = superReady(w, p, k);
      const offline = !ready && p.lowPower;
      b.classList.toggle('ready', ready);
      b.classList.toggle('offline', offline);
      // [HUD] the Modern support row is always compact: just the timer under each power
      const compact = this.layout === 'modern' || this.supers.classList.contains('compact');
      const sub = ready ? 'Ready' : offline ? 'Offline' : compact ? formatTime(Math.max(0, full - p.superCharge[k])) : `${Math.floor(frac * 100)}% · ${formatTime(Math.max(0, full - p.superCharge[k]))}`;
      const small = b.querySelector('small')!;
      if (small.textContent !== sub) small.textContent = sub;
      const how = k === 'gps' ? 'launching' : SUPER_TARGET[k] === 'none' ? 'click to activate' : SUPER_TARGET[k] === 'unit-point' ? 'select a vehicle, click, then choose the destination' : 'click, then choose a target';
      const tip = tipHtml(SUPER_INFO[k].name, SUPER_INFO[k].desc + (this.host.spectator ? '' : ready ? ` <span class="tt-ok">Ready — ${how}.</span>` : offline ? ' <span class="tt-bad">Charging halted: low power.</span>' : ` Charging: ${Math.floor(frac * 100)}%.`));
      if (b.dataset.tip !== tip) { b.dataset.tip = tip; this.tip.refresh(b, tip); }
    }
  }

  /** Superweapon / support power button: 'none' powers fire at once, the others enter targeting. */
  private activatePower(k: SuperKind) {
    const w = this.host.world, p = this.host.local;
    if (this.host.spectator) return;
    if (k === 'gps') { this.message('The GPS satellite launches by itself when it is ready'); return; }
    if (!superReady(w, p, k)) { this.sound.play('error'); this.message(`${SUPER_INFO[k].name} not ready`, true); return; }
    this.sound.play('click');
    if (SUPER_TARGET[k] === 'none') {
      // no aiming: the command still carries an on-map point (the power's structure, or the map centre)
      const b = superBuilding(w, p, k);
      this.host.issue({ c: 'superweapon', player: p.id, kind: k, x: b?.x ?? w.map.w / 2, y: b?.y ?? w.map.h / 2 });
      this.message(`${SUPER_INFO[k].name} activated`);
    } else this.host.beginSuperweapon(k);
  }

  // ---------------------------------------------------------------------------
  private updateSelection() {
    const w = this.host.world;
    const ents: Entity[] = [];
    for (const id of this.host.selection) {
      const e = w.getEntity(id);
      if (e?.alive) ents.push(e);
    }
    if (!ents.length) {
      if (this.selKey) {
        this.selKey = '';
        this.selpanel.classList.remove('on');
        this.dock.classList.remove('has-sel');
      }
      return;
    }
    const key = ents.map((e) => e.id).join(',');
    if (key !== this.selKey) {
      const wasOpen = !!this.selKey;
      this.selKey = key;
      this.buildSelection(ents, wasOpen);
    }
    if (ents.length === 1) this.refreshSingle(ents[0]);
    else this.refreshMulti(ents);
    this.refreshStances(ents);
    refreshFormationBar(this.selpanel, ents.filter((e): e is Unit => e instanceof Unit)); // [CTRL]
  }

  /** Stance selector for own combat units (current stance highlighted; mixed selections show none). */
  private stanceButtons(ents: (Unit | Building)[]): HTMLElement | null {
    const units = ents.filter((e): e is Unit => e instanceof Unit && e.weapons.length > 0 && !e.ut.harvester);
    if (!units.length) return null;
    const box = el('div', 'stances');
    box.appendChild(el('span', 'st-lbl', 'Stance'));
    for (const st of STANCES) {
      const b = el('button', 'stance', `${st.icon}<kbd>${st.key}</kbd>`);
      b.dataset.stance = st.id;
      b.dataset.tip = tipHtml(st.title, st.desc, [[st.key, 'hotkey']]);
      b.setAttribute('aria-label', `Stance: ${st.title}`);
      b.onclick = () => { this.sound.play('click'); this.setStance(st.id); };
      box.appendChild(b);
    }
    return box;
  }

  /** Order the selected own units into a stance (also used by the F1–F4 hotkeys). */
  setStance(stance: Stance) {
    if (this.host.spectator) return;
    const w = this.host.world, p = this.host.local;
    const ids: number[] = [];
    for (const id of this.host.selection) {
      const e = w.getEntity(id);
      if (e instanceof Unit && e.alive && e.owner === p && e.weapons.length) ids.push(id);
    }
    if (!ids.length) return;
    this.host.issue({ c: 'stance', player: p.id, units: ids, stance });
    const st = STANCES.find((s) => s.id === stance)!;
    this.message(`Stance: ${st.title}`);
  }

  private refreshStances(ents: Entity[]) {
    const box = this.selpanel.querySelector('.stances');
    if (!box) return;
    let cur: string | null = null;
    for (const e of ents) {
      if (!(e instanceof Unit) || !e.weapons.length || e.ut.harvester) continue;
      const s = e.stance ?? 'guard';
      if (cur === null) cur = s;
      else if (cur !== s) { cur = 'mixed'; break; }
    }
    for (const b of box.querySelectorAll<HTMLElement>('.stance')) b.classList.toggle('on', b.dataset.stance === cur);
  }

  /** Enemy economy revealed by spies (player.intel): credits, power and production per infiltrated player. */
  private updateIntel() {
    const me = this.host.local, w = this.host.world;
    const rows: string[] = [];
    const tips: string[] = [];
    let key = '';
    for (const o of w.players) {
      if (o === me || !me.isEnemy(o) || o.defeated) continue;
      const it = intelOn(me, o);
      if (!it) continue;
      const making = it.production ? Object.values(o.queues).map((q) => q.items[0]?.type ?? q.ready).filter((t): t is string => !!t).map((t) => getType(t).name) : [];
      key += `${o.id}:${it.credits ? o.credits : ''}:${it.power ? o.powerOut + '/' + o.powerUse : ''}:${it.radar ? 'r' : ''}:${making.join(',')}|`;
      if (!it.credits && !it.power && !making.length && !it.radar) continue;
      rows.push(`<span class="in-row" style="--c:${hexColor(o.color)}"><i></i><b>${esc(o.name)}</b>${it.credits ? `<span class="in-cr">$${o.credits.toLocaleString('en-US')}</span>` : ''}${it.power ? `<span class="in-pw${o.lowPower ? ' low' : ''}">${ICONS.bolt}${o.powerOut}/${o.powerUse}</span>` : ''}${it.radar ? `<span class="in-rd" title="Radar shared">${ICONS.radar}</span>` : ''}${making.length ? `<span class="in-mk">${ICONS.building}${making.length}</span>` : ''}</span>`);
      const lines = [it.credits ? `Credits <b>$${o.credits.toLocaleString('en-US')}</b>` : '', it.power ? `Power <b>${o.powerOut}</b> / drain <b>${o.powerUse}</b>${o.lowPower ? ' <span class="tt-bad">low power</span>' : ''}` : '',
        it.radar ? 'Radar view shared on your minimap' : '', making.length ? `Producing: <b>${making.map(esc).join('</b>, <b>')}</b>` : ''].filter(Boolean);
      tips.push(`<span class="tt-foe" style="--c:${hexColor(o.color)}"><i></i>${esc(o.name)}</span><br>${lines.join('<br>')}`);
    }
    if (key === this.intelKey) return;
    this.intelKey = key;
    this.intelEl.classList.toggle('on', rows.length > 0);
    this.intelEl.innerHTML = rows.length ? `<span class="in-ic">${ICONS.intel}</span><span class="in-rows">${rows.join('')}</span>` : '';
    const tip = tipHtml('Spy intel', tips.join('<br>') || 'Infiltrate enemy structures with spies.');
    this.intelEl.dataset.tip = tip;
    this.tip.refresh(this.intelEl, tip);
  }

  private buildSelection(ents: Entity[], wasOpen: boolean) {
    const first = ents[0];
    const local = this.host.local;
    const own = first.owner === local;
    const look = this.appear(first);
    const sp = this.selpanel;
    sp.innerHTML = '';
    this.extraHtml = '';
    sp.className = 'panel on ' + (ents.length === 1 ? 'single' : 'multi') + (own ? '' : look.owner === local ? '' : local.isEnemy(look.owner) ? ' enemy' : ' ally');
    sp.style.setProperty('--team', hexColor(look.owner.color));
    this.dock.classList.add('has-sel');
    if (ents.length === 1) sp.append(...this.singleView(first));
    else sp.append(this.multiView(ents));
    if (own && !this.host.spectator) {
      const cmdEnts = ents.filter((e): e is Unit | Building => e instanceof Unit || e instanceof Building);
      sp.appendChild(this.commandButtons(cmdEnts));
      const st = this.stanceButtons(cmdEnts);
      if (st) sp.appendChild(st);
      // [CTRL] formation selector for two or more own ground units
      const fm = formationBar(cmdEnts.filter((e): e is Unit => e instanceof Unit), (shape) => {
        const ids = cmdEnts.filter((e): e is Unit => e instanceof Unit && (e.kind === 'infantry' || e.kind === 'vehicle')).map((u) => u.id);
        this.sound.play('click');
        this.host.issue({ c: 'formation', player: local.id, units: ids, shape });
        this.message(`Formation: ${FORMATION_INFO.find((f) => f.id === shape)?.title ?? shape}`);
      });
      if (fm) sp.appendChild(fm);
    }
    replay(sp, wasOpen ? 'swap' : 'pop', 500);
    this.tutKey = '';
  }

  private chip(icon: string, value: string, sub: string, tip: string, k = ''): string {
    return `<span class="chip"${tip ? ` data-tip="${esc(tip)}"` : ''}><span class="chip-ic">${icon}</span><span class="chip-v"${k ? ` data-k="${k}"` : ''}>${value}</span>${sub ? `<span class="chip-s">${sub}</span>` : ''}</span>`;
  }

  /**
   * What the local player sees: decoy structures pass for the real thing and disguised spies for a
   * rifleman of another player, unless the viewer is in on it (sim apparentType / disguisedAs).
   */
  private appear(e: Entity): { type: TypeDef; owner: Player; masked: boolean } {
    const me = this.host.local;
    if (e instanceof Building) {
      const t = apparentType(e, me);
      return { type: t, owner: e.owner, masked: t !== e.bt };
    }
    if (e instanceof Unit) {
      const d = disguisedAs(this.host.world, e, me);
      if (d) return { type: getType(d.type), owner: d.owner, masked: true };
    }
    return { type: e.type, owner: e.owner, masked: false };
  }

  private singleView(e: Entity): HTMLElement[] {
    const look = this.appear(e);
    const t = look.type;
    const img = this.host.thumbs.get(t.id);
    const own = look.owner === this.host.local;
    const por = el('div', 'sp-portrait', `<div class="sp-img">${img ? `<img src="${img}" alt="" draggable="false">` : `<span class="sp-fallback">${CAT_ICON[t.category]}</span>`}</div>
      <span class="sp-rank" data-k="rank"></span><span class="sp-teamstrip"></span><i class="cn tl"></i><i class="cn tr"></i><i class="cn bl"></i><i class="cn br"></i>`);
    const chips: string[] = [];
    chips.push(this.chip(ICONS.shield, cap(t.armor), '', tipHtml('Armour', `Armour class <b>${cap(t.armor)}</b> — determines how much damage each warhead deals.`)));
    if (e instanceof Unit) {
      const ut = look.masked ? (t as UnitTypeDef) : e.ut;
      const wps = [ut.primary, ut.secondary !== ut.primary ? ut.secondary : undefined].filter(Boolean) as string[];
      for (const wid of wps) {
        const wd = WEAPONS[wid];
        chips.push(this.chip(ICONS.target, esc(wd.id), `R${+wd.range.toFixed(2)}`, tipHtml(`Weapon: ${esc(wd.id)}`, `Damage <b>${Math.abs(wd.damage)}</b>${wd.burst > 1 ? ` ×${wd.burst}` : ''} · range <b>${+wd.range.toFixed(2)}</b> cells${wd.antiAir ? ' · anti-air' : ''}${!wd.antiGround ? ' (air only)' : ''}`)));
      }
      chips.push(this.chip(ICONS.gauge, mphToCellsPerSecond(ut.speed).toFixed(1), 'c/s', tipHtml('Speed', 'Cells per second.')));
    } else if (e instanceof Building) {
      const bt = t as BuildingTypeDef;
      const pw = bt.power;
      if (pw) chips.push(`<span class="chip ${pw > 0 ? 'pos' : 'neg'}" data-tip="${esc(tipHtml('Power', pw > 0 ? 'Produces power (less when damaged).' : 'Consumes power.'))}"><span class="chip-ic">${ICONS.bolt}</span><span class="chip-v">${pw > 0 ? '+' : ''}${pw}</span></span>`);
      if (bt.primary) {
        const wd = WEAPONS[bt.primary];
        chips.push(this.chip(ICONS.target, esc(wd.id), `R${+wd.range.toFixed(2)}`, tipHtml(`Weapon: ${esc(wd.id)}`, `Damage <b>${Math.abs(wd.damage)}</b> · range <b>${+wd.range.toFixed(2)}</b> cells`)));
      }
      if (bt.storage) chips.push(this.chip(ICONS.coin, `$${bt.storage.toLocaleString('en-US')}`, 'store', tipHtml('Ore storage')));
    }
    if (e.weapons.length || look.masked) chips.push(this.chip(ICONS.kills, '0', 'kills', tipHtml('Confirmed kills'), 'kills'));
    const main = el('div', 'sp-main', `<div class="sp-title"><span class="sp-name">${esc(t.name)}</span><span class="sp-tag" data-k="tag"></span>${own ? '' : `<span class="sp-owner"><i></i>${esc(look.owner.name)}</span>`}</div>
      <div class="sp-hp"><div class="hp-bar"><i class="hp-trail"></i><i class="hp-fill"></i><i class="hp-segs"></i></div><span class="hp-num" data-k="hp"></span></div>
      <div class="sp-chips">${chips.join('')}</div>
      <div class="sp-extra" data-k="extra"></div>`);
    return [por, main];
  }

  private refreshSingle(e: Entity) {
    const sp = this.selpanel;
    const own = e.owner === this.host.local;
    const f = Math.max(0, Math.min(1, e.healthFrac));
    const fill = sp.querySelector('.hp-fill') as HTMLElement | null;
    if (fill) {
      const w = `${(f * 100).toFixed(1)}%`;
      if (fill.style.width !== w) {
        fill.style.width = w;
        (sp.querySelector('.hp-trail') as HTMLElement).style.width = w;
      }
      const bar = sp.querySelector('.hp-bar') as HTMLElement;
      bar.dataset.c = f > CONDITION_YELLOW ? 'ok' : f > CONDITION_RED ? 'mid' : 'low';
      const hp = sp.querySelector('[data-k="hp"]') as HTMLElement;
      const look = this.appear(e);
      const max = look.masked ? (look.type as { strength?: number }).strength ?? e.maxHp : e.maxHp;
      const txt = `<b>${look.masked ? Math.ceil(f * max) : Math.ceil(e.hp)}</b> / ${max}`;
      if (hp.innerHTML !== txt) hp.innerHTML = txt;
    }
    const rk = sp.querySelector('[data-k="rank"]') as HTMLElement | null;
    if (rk && rk.dataset.r !== String(e.rank)) { rk.dataset.r = String(e.rank); rk.innerHTML = rankBadge(e.rank); }
    const kills = sp.querySelector('[data-k="kills"]') as HTMLElement | null;
    if (kills && kills.textContent !== String(e.kills)) kills.textContent = String(e.kills);
    // tag
    let tag = '', tagCls = '';
    if (e.invulnerable > 0) { tag = 'Invulnerable'; tagCls = 'inv'; }
    else if (e instanceof Unit && e.submerged) { tag = 'Submerged'; tagCls = 'acc'; }
    else if (e instanceof Unit && e.parachute > 0) { tag = 'Parachuting'; tagCls = 'acc'; }
    else if (e instanceof Unit && e.madStage) { tag = e.madStage === 2 ? 'Quaking' : 'Arming'; tagCls = 'bad'; } // [CTRL] Aftermath
    else if (e instanceof Unit && e.armed) { tag = 'Armed'; tagCls = 'bad'; }
    else if (e instanceof Building && e.repairing) { tag = 'Repairing'; tagCls = 'ok'; }
    else if (e instanceof Building && e.bt.requiresPower && e.owner.lowPower) { tag = 'Offline'; tagCls = 'bad'; }
    else if (e instanceof Building && e.primary) { tag = 'Primary'; tagCls = 'acc'; }
    else if (e.rank > 0) { tag = RANK_NAMES[e.rank]; tagCls = 'rank'; }
    const tagEl = sp.querySelector('[data-k="tag"]') as HTMLElement | null;
    if (tagEl && tagEl.textContent !== tag) { tagEl.textContent = tag; tagEl.className = 'sp-tag ' + tagCls; }
    // extra line
    const extra = sp.querySelector('[data-k="extra"]') as HTMLElement | null;
    if (!extra) return;
    const html = this.extraFor(e, own);
    if (html !== this.extraHtml) { this.extraHtml = html; extra.innerHTML = html; }
  }

  private xbar(icon: string, label: string, frac: number, value: string, cls = ''): string {
    return `<div class="xbar ${cls}"><span class="xb-l">${icon}${label}</span><span class="xb-track"><i style="width:${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%"></i></span><span class="xb-v">${value}</span></div>`;
  }
  private pips(icon: string, label: string, n: number, max: number, value: string): string {
    let s = '';
    for (let i = 0; i < max; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`;
    return `<div class="xbar pipsrow"><span class="xb-l">${icon}${label}</span><span class="pips">${s}</span><span class="xb-v">${value}</span></div>`;
  }

  private extraFor(e: Entity, own: boolean): string {
    const p = this.host.local;
    if (e instanceof Unit) {
      if (e.ut.harvester) {
        const frac = e.cargo / BAIL_COUNT;
        return this.xbar(ICONS.ore, 'Cargo', frac, `${Math.round(frac * 100)}% · ${HARVEST_STATE[e.hstate] ?? e.hstate}`, 'ore');
      }
      // [CTRL] Aftermath status: chrono recharge, M.A.D. charge, demolition truck
      if (e.ut.chronoShift) {
        const left = e.chronoCooldown;
        return this.xbar(ICONS.clock, 'Chronoshift', 1 - left / e.ut.chronoShift, left > 0 ? `Recharging ${Math.ceil(left)} s` : own ? 'Ready · D' : 'Ready', left > 0 ? 'hold' : 'ready');
      }
      if (e.ut.quake) return this.xbar(ICONS.boltSolid, e.madStage === 2 ? 'Quaking' : e.madStage === 1 ? 'Arming…' : 'Seismic charge', e.madCharge, e.madStage ? `${Math.round(e.madCharge * 100)}%` : own ? 'D to deploy' : 'Mobile', e.madStage ? 'hold' : '');
      if (e.ut.demolition) return this.xbar(ICONS.target, 'Charge', e.armed ? 1 : 0, e.armed ? 'Armed: driving in' : own ? 'Attack to arm · D detonates' : 'Safe', e.armed ? 'hold' : '');
      if (e.ut.passengers) return this.pips(ICONS.people, 'Passengers', e.passengers.length, e.ut.passengers, e.passengers.length && own ? 'D to unload' : `${e.passengers.length} / ${e.ut.passengers}`);
      let s = '';
      if (e.kind === 'aircraft' && e.ut.ammo) s += this.pips(ICONS.ammo, 'Ammo', e.ammo, e.ut.ammo, e.ammo ? `${e.ammo} / ${e.ut.ammo}` : 'Rearm at pad');
      if (own && e.weapons.length && !s) {
        const [vet, elite] = xpThresholds(e.ut);
        if (e.rank >= 2) s += this.xbar(ICONS.chevrons, 'Elite', 1, 'Max rank', 'xp elite');
        else {
          const lo = e.rank === 1 ? vet : 0, hi = e.rank === 1 ? elite : vet;
          s += this.xbar(ICONS.chevrons, 'Experience', (e.xp - lo) / (hi - lo), `${Math.round(e.xp)} / ${hi} → ${RANK_NAMES[e.rank + 1]}`, 'xp');
        }
      }
      return s;
    }
    if (e instanceof Building) {
      const bt = e.bt;
      const k = bt.superweapon ?? ((bt as { powers?: SuperKind[] }).powers ?? []).find((pk) => superBuilding(this.host.world, p, pk) === e);
      if (k && own) {
        const full = powerFull(this.host.world, p, k);
        const frac = Math.min(1, p.superCharge[k] / full);
        return this.xbar(SUPER_INFO[k].icon, 'Charge', frac, frac >= 1 ? 'Ready' : p.lowPower ? 'Offline' : formatTime(full - p.superCharge[k]), frac >= 1 ? 'ready' : '');
      }
      if (bt.factory && bt.factory !== 'building' && own) {
        const q = p.queues[bt.factory];
        const head = q.items[0];
        if (head) return this.xbar(CAT_ICON[getType(head.type).category], 'Producing', head.progress, `${esc(getType(head.type).name)}${q.items.length > 1 ? ` +${q.items.length - 1}` : ''}`, head.paused ? 'hold' : '');
        return this.xbar(CAT_ICON[bt.factory === 'infantry' ? 'infantry' : bt.factory], 'Producing', 0, 'Idle', 'idle');
      }
      if (bt.factory === 'building' && own) {
        const q = p.queues.structure;
        if (q.ready) return this.xbar(ICONS.building, 'Construction', 1, `${esc(getType(q.ready).name)} ready`, 'ready');
        const head = q.items[0];
        if (head) return this.xbar(ICONS.building, 'Construction', head.progress, esc(getType(head.type).name), head.paused ? 'hold' : '');
      }
      if (bt.storage && own) return this.xbar(ICONS.coin, 'Silo', p.storage ? p.ore / p.storage : 0, `$${Math.round(p.ore).toLocaleString('en-US')} / ${p.storage.toLocaleString('en-US')}`, 'ore');
    }
    return '';
  }

  private multiView(ents: Entity[]): HTMLElement {
    const groups = new Map<string, Entity[]>();
    for (const e of ents) {
      const tid = this.appear(e).type.id;
      const l = groups.get(tid) ?? [];
      l.push(e);
      groups.set(tid, l);
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || b[1][0].type.cost - a[1][0].type.cost);
    const box = el('div', 'sp-multi');
    const units = ents.filter((e) => e instanceof Unit).length;
    const label = units === ents.length ? (units === 1 ? 'unit' : 'units') : units === 0 ? 'structures' : 'selected';
    box.innerHTML = `<div class="spm-head"><b>${ents.length}</b><span>${label}</span><span class="spm-types">${groups.size} type${groups.size > 1 ? 's' : ''}</span><span class="spm-hp"><i></i></span></div><div class="spm-grid"></div>`;
    const grid = box.querySelector('.spm-grid')!;
    sorted.forEach(([tid, list], i) => {
      const t = getType(tid);
      const img = this.host.thumbs.get(tid);
      const c = el('button', 'spm-card', `${img ? `<img src="${img}" alt="" draggable="false">` : `<span class="sp-fallback">${CAT_ICON[t.category]}</span>`}<span class="spm-n">${list.length > 1 ? '×' + list.length : ''}</span><span class="spm-rank"></span><span class="spm-bar"><i></i></span>`);
      c.dataset.tid = tid;
      c.style.setProperty('--i', String(i));
      c.dataset.tip = tipHtml(esc(t.name), `${list.length} selected`, [['Click', 'select only these'], ['Shift', 'deselect']]);
      c.onclick = (ev) => {
        this.sound.play('click');
        const ids = list.map((e) => e.id);
        if (ev.shiftKey) this.host.select([...this.host.selection].filter((id) => !ids.includes(id)));
        else this.host.select(ids);
      };
      grid.appendChild(c);
    });
    return box;
  }

  private refreshMulti(ents: Entity[]) {
    const byType = new Map<string, Entity[]>();
    let hp = 0, max = 0;
    for (const e of ents) {
      const tid = this.appear(e).type.id;
      const l = byType.get(tid) ?? [];
      l.push(e);
      byType.set(tid, l);
      hp += Math.max(0, e.hp); max += e.maxHp;
    }
    const tot = this.selpanel.querySelector('.spm-hp i') as HTMLElement | null;
    if (tot) { const f = hp / Math.max(1, max); tot.style.width = `${(f * 100).toFixed(1)}%`; tot.dataset.c = f > CONDITION_YELLOW ? 'ok' : f > CONDITION_RED ? 'mid' : 'low'; }
    for (const c of this.selpanel.querySelectorAll<HTMLElement>('.spm-card')) {
      const list = byType.get(c.dataset.tid!) ?? [];
      const f = list.reduce((s, e) => s + e.healthFrac, 0) / Math.max(1, list.length);
      const bar = c.querySelector('.spm-bar i') as HTMLElement;
      bar.style.width = `${(f * 100).toFixed(1)}%`;
      bar.dataset.c = f > CONDITION_YELLOW ? 'ok' : f > CONDITION_RED ? 'mid' : 'low';
      const rank = list.reduce((m, e) => Math.max(m, e.rank), 0);
      const rk = c.querySelector('.spm-rank') as HTMLElement;
      if (rk.dataset.r !== String(rank)) { rk.dataset.r = String(rank); rk.innerHTML = rankBadge(rank); }
    }
  }

  private commandButtons(ents: (Unit | Building)[]): HTMLElement {
    const box = el('div', 'cmds');
    const add = (icon: string, key: string, title: string, desc: string, cls = '') => {
      const b = el('button', 'cmd ' + cls, `${icon}<kbd>${key}</kbd>`);
      b.dataset.tip = tipHtml(title, desc, [[key, 'hotkey']]);
      b.dataset.key = key;
      b.setAttribute('aria-label', title);
      b.onclick = () => { this.sound.play('click'); this.host.keyCommand(key.toLowerCase(), true); };
      box.appendChild(b);
    };
    const units = ents.filter((e): e is Unit => e instanceof Unit);
    const blds = ents.filter((e): e is Building => e instanceof Building);
    if (units.length) {
      add(ICONS.attackMove, 'A', 'Attack-move', 'Move to a location, engaging any enemies met on the way.');
      add(ICONS.stop, 'S', 'Stop', 'Cancel all current orders.');
      add(ICONS.scatter, 'X', 'Scatter', 'Spread out to avoid splash damage.');
      if (units.some((u) => u.ut.deploysInto)) add(ICONS.deploy, 'D', 'Deploy', 'Deploy into a Construction Yard.', 'hl');
      else if (units.some((u) => u.ut.passengers)) add(ICONS.unload, 'D', 'Unload', 'Unload all passengers.');
      else if (units.some((u) => u.kind === 'aircraft')) add(ICONS.home, 'D', 'Return to base', 'Fly back to a pad to rearm.');
      // [CTRL] Aftermath specials on D
      else if (units.some((u) => u.ut.chronoShift)) add(ICONS.deploy, 'D', 'Chronoshift', 'Click any explored open ground: the Chrono Tank jumps there, then recharges.', 'hl');
      else if (units.some((u) => u.ut.quake)) add(ICONS.deploy, 'D', 'Deploy seismic charge', 'The crew bails out and the charge arms, then quakes wreck every vehicle and structure nearby (friend or foe).', 'warn');
      else if (units.some((u) => u.ut.demolition)) add(ICONS.deploy, 'D', 'Detonate', 'Set the charge off right here. Order an attack to arm it and drive it into a target.', 'warn');
      add(ICONS.groundFire, 'G', 'Fire at ground', 'Force-fire at a location (click the target after).');
      // [CTRL] patrol and guard
      if (units.some((u) => u.kind !== 'aircraft')) {
        add(CTRL_ICONS.patrol, 'P', 'Patrol', 'Click the far end of a route (Shift-click for more waypoints): loop along it, engaging enemies on the way.');
        add(CTRL_ICONS.guard, 'C', 'Guard / escort', 'Click a unit to escort (follow and defend it) or a structure to defend. Right-clicking a friendly unit escorts it too.');
      }
      if (units.some((u) => u.ut.minelayer)) add(ICONS.mine, 'M', 'Lay mines', 'Click the ground to lay a minefield there (Ctrl + right click does the same). D drops a single mine.', 'hl');
    }
    if (blds.length === 1) {
      add(ICONS.sell, 'Z', 'Sell', 'Sell this structure for a partial refund.', 'warn');
      add(ICONS.wrench, 'R', 'Repair', 'Toggle repairs on this structure (costs credits).');
      if (blds[0].bt.factory && blds[0].bt.factory !== 'building') add(ICONS.primary, 'P', 'Primary factory', 'New units of this type are produced here.');
    }
    box.classList.toggle('few', box.children.length <= 3);
    return box;
  }

  // ---------------------------------------------------------------------------
  private updateGroups() {
    const groups = this.host.getGroups?.();
    if (!groups) return;
    const w = this.host.world;
    const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
    const data: { g: number; ids: number[]; type: string; hp: number; x: number; y: number }[] = [];
    for (const g of order) {
      const ids = (groups.get(g) ?? []).filter((id) => w.getEntity(id)?.alive);
      if (!ids.length) continue;
      const counts = new Map<string, number>();
      let hp = 0, x = 0, y = 0;
      for (const id of ids) {
        const e = w.getEntity(id)!;
        counts.set(e.type.id, (counts.get(e.type.id) ?? 0) + 1);
        hp += e.healthFrac; x += e.x; y += e.y;
      }
      const type = [...counts.entries()].sort((a, b) => b[1] - a[1] || getType(b[0]).cost - getType(a[0]).cost)[0][0];
      data.push({ g, ids, type, hp: hp / ids.length, x: x / ids.length, y: y / ids.length });
    }
    const key = data.map((d) => `${d.g}:${d.type}:${d.ids.length}`).join('|');
    if (key !== this.groupKey) {
      this.groupKey = key;
      this.groupsBar.innerHTML = '';
      this.groupsBar.classList.toggle('on', data.length > 0);
      for (const d of data) {
        const img = this.host.thumbs.get(d.type);
        const b = el('button', 'grp', `<kbd>${d.g}</kbd>${img ? `<img src="${img}" alt="" draggable="false">` : `<span class="sp-fallback">${CAT_ICON[getType(d.type).category]}</span>`}<span class="grp-n">${d.ids.length}</span><span class="grp-hp"><i></i></span>`);
        b.dataset.g = String(d.g);
        b.dataset.tip = tipHtml(`Group ${d.g}`, `${d.ids.length} unit${d.ids.length > 1 ? 's' : ''} · mostly ${esc(getType(d.type).name)}`, [['Click', 'select'], ['Double-click', 'jump']]);
        b.onclick = () => this.recallGroup(+b.dataset.g!, false);
        b.ondblclick = () => this.recallGroup(+b.dataset.g!, true);
        this.groupsBar.appendChild(b);
      }
    }
    const sel = this.host.selection;
    for (const b of this.groupsBar.querySelectorAll<HTMLElement>('.grp')) {
      const d = data.find((x) => x.g === +b.dataset.g!);
      if (!d) continue;
      const i = b.querySelector('.grp-hp i') as HTMLElement;
      i.style.width = `${(d.hp * 100).toFixed(0)}%`;
      i.dataset.c = d.hp > CONDITION_YELLOW ? 'ok' : d.hp > CONDITION_RED ? 'mid' : 'low';
      b.classList.toggle('active', sel.size === d.ids.length && d.ids.every((id) => sel.has(id)));
    }
  }

  private recallGroup(g: number, jump: boolean) {
    this.sound.play('click');
    if (this.host.selectGroup) { this.host.selectGroup(g, jump); return; }
    const w = this.host.world;
    const ids = (this.host.getGroups?.().get(g) ?? []).filter((id) => w.getEntity(id)?.alive);
    if (!ids.length) return;
    this.host.select(ids);
    if (jump) {
      let x = 0, y = 0;
      for (const id of ids) { const e = w.getEntity(id)!; x += e.x; y += e.y; }
      this.host.focusOn(x / ids.length, y / ids.length);
    }
  }

  private updateObjective() {
    const w = this.host.world, me = this.host.local;
    if (w.mission) { this.updateMissionObjective(); return; }
    const foes = w.players.filter((o) => me.isEnemy(o));
    const key = foes.map((o) => `${o.id}:${o.defeated ? 1 : 0}`).join(',');
    if (key === this.objKey) return;
    const first = !this.objKey;
    this.objKey = key;
    const alive = foes.filter((o) => !o.defeated).length;
    const pips = this.objEl.querySelector('.obj-pips') as HTMLElement;
    pips.innerHTML = foes.map((o) => `<i class="${o.defeated ? 'dead' : ''}" style="--c:${hexColor(o.color)}"></i>`).join('') + `<span><b>${alive}</b>/${foes.length}</span>`;
    this.objEl.dataset.tip = tipHtml('Objective', 'Destroy every enemy structure and unit.<br>' + foes.map((o) => `<span class="tt-foe${o.defeated ? ' dead' : ''}" style="--c:${hexColor(o.color)}"><i></i>${esc(o.name)} <small>${o.faction === 'soviet' ? 'Soviet' : 'Allied'}${o.defeated ? ' · eliminated' : ''}</small></span>`).join(''));
    this.tip.refresh(this.objEl, this.objEl.dataset.tip);
    if (!first) replay(this.objEl, 'flash', 1600);
  }

  /** Scripted missions: the chip shows the current primary objective and primary progress. */
  private updateMissionObjective() {
    const objs = this.host.world.mission!.objectives;
    const primary = objs.filter((o) => o.primary);
    const current = primary.find((o) => o.state === 'active') ?? primary[primary.length - 1];
    const key = 'm|' + objs.map((o) => `${o.id}:${o.state}:${o.text}`).join('|');
    if (key === this.objKey) return;
    const first = !this.objKey;
    this.objKey = key;
    this.objEl.style.display = current ? '' : 'none';
    if (!current) return;
    (this.objEl.querySelector('.obj-txt b') as HTMLElement).textContent = current.text;
    const done = primary.filter((o) => o.state === 'done').length;
    const pips = this.objEl.querySelector('.obj-pips') as HTMLElement;
    pips.innerHTML = primary.map((o) => `<i class="${o.state === 'done' ? 'dead' : ''}" style="--c:${o.state === 'failed' ? '#ff4a3a' : '#5ab4ff'}"></i>`).join('') + `<span><b>${done}</b>/${primary.length}</span>`;
    this.objEl.dataset.tip = tipHtml('Objectives', objs.map((o) => `<span class="tt-foe${o.state !== 'active' ? ' dead' : ''}"><i></i>${esc(o.text)} <small>${o.primary ? 'primary' : 'optional'}${o.state === 'done' ? ' · complete' : o.state === 'failed' ? ' · failed' : ''}</small></span>`).join(''));
    this.tip.refresh(this.objEl, this.objEl.dataset.tip);
    if (!first) replay(this.objEl, 'flash', 1600);
  }

  /**
   * [HUD] Modern objectives checklist (top left) for skirmish: the goal, the opponents still standing, and a
   * row per enemy that gets ticked off when it is eliminated. Scripted missions show MissionHud's checklist here.
   */
  private updateObjPanel() {
    const w = this.host.world, me = this.host.local;
    if (w.mission) {
      if (this.objPanelKey !== 'mission') { this.objPanelKey = 'mission'; this.objPanel.style.display = 'none'; }
      return;
    }
    const foes = w.players.filter((o) => me.isEnemy(o));
    const key = foes.map((o) => `${o.id}:${o.defeated ? 1 : 0}`).join(',');
    if (key === this.objPanelKey) return;
    const first = !this.objPanelKey;
    this.objPanelKey = key;
    this.objPanel.style.display = '';
    const alive = foes.filter((o) => !o.defeated).length;
    const done = foes.length > 0 && alive === 0;
    const row = (cls: string, text: string, pg = '') => `<div class="op-row ${cls}"><i class="op-bx"></i><span class="op-tx">${text}</span>${pg ? `<span class="op-pg">${pg}</span>` : ''}</div>`;
    this.objPanel.innerHTML = `<div class="op-head"><span class="op-ic">${ICONS.target}</span><b>Objectives</b><span class="op-n">${foes.length - alive}/${foes.length}</span></div>`
      + row(done ? 'done' : '', 'Destroy all enemy forces', foes.length ? `${alive} left` : '')
      + foes.map((o) => row(`sub ${o.defeated ? 'done' : ''}`, `<i class="op-dot" style="--c:${hexColor(o.color)}"></i>${esc(o.name)} <small>${o.faction === 'soviet' ? 'Soviet' : 'Allied'}</small>`)).join('');
    this.objPanel.dataset.tip = this.objEl.dataset.tip ?? '';
    this.objPanel.querySelector('.op-head')!.after(this.cfRow); // (the build-up countdown leads the list)
    if (!first) replay(this.objPanel, 'flash', 1600);
  }

  /** Build-up time (sim/ceasefire.ts): "Ceasefire: 12:34" while it holds, in both layouts; gone when it ends. */
  private updateCeasefire() {
    const w = this.host.world;
    const left = w.ceasefireUntil ? ceasefireLeft(w) : 0;
    const key = !left ? 'off' : left === Infinity ? 'inf' : String(Math.ceil(left));
    if (key === this.cfKey) return;
    this.cfKey = key;
    const show = key !== 'off';
    const modern = this.layout === 'modern';
    this.cfChip.style.display = show && !modern ? '' : 'none';
    this.cfRow.style.display = show && modern ? '' : 'none';
    if (!show) return;
    const html = left === Infinity ? 'Ceasefire: <b>unlimited</b> <small>(enemy only defends)</small>' : `Ceasefire: <b>${formatTime(Math.ceil(left))}</b>`;
    for (const e of [this.cfChip, this.cfRow]) {
      (e.querySelector('.cf-txt') as HTMLElement).innerHTML = html;
      e.classList.toggle('urgent', left <= CEASEFIRE_WARNING);
    }
  }

  /** [HUD] Boot Camp: glow the cards / buttons the current drill asks for (missions/tutorial.ts BOOT_CAMP_HUD). */
  private updateTutorial() {
    const m = this.host.world.mission;
    const step = m?.def.id === 'bootcamp' ? String(m.flags.step ?? '') : '';
    const key = `${step}|${this.activeTab}|${this.gridKey}|${this.selKey}`;
    if (key === this.tutKey) return;
    this.tutKey = key;
    for (const e of this.ui.querySelectorAll('.tut-hl')) e.classList.remove('tut-hl');
    const sels = BOOT_CAMP_HUD[step];
    if (!sels?.length) return;
    for (const s of sels) {
      for (const e of this.ui.querySelectorAll<HTMLElement>(s)) {
        // a tab only glows while its card is not on show
        if (e.classList.contains('tab') && e.classList.contains('active')) continue;
        e.classList.add('tut-hl');
      }
    }
  }
}

export { BUILDINGS };
