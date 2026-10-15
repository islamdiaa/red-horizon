import { BAIL_COUNT, BUILDINGS, CONDITION_RED, CONDITION_YELLOW, WEAPONS, getType, isBuildingType, mphToCellsPerSecond, type Category, type TypeDef } from '../data/rules';
import { formatTime } from '../core/util';
import { Building, Unit, type Entity } from '../sim/entities';
import { queueKindOf, type Player, type ProductionQueue } from '../sim/player';
import { buildSeconds } from '../sim/production';
import { superBuilding, superReady, type SuperKind } from '../sim/superweapons';
import type { Command } from '../sim/types';
import type { World } from '../sim/world';
import type { AudioSystem } from '../audio';
import { Minimap } from './minimap';
import { ICONS, rankBadge } from './icons';
import { Odometer, Tooltip, UiSound, bindTilt, el, esc, hexColor, replay, tipHtml } from './dom';
import { Toasts, classifyMessage, type ToastKind } from './toasts';
import { RANK_NAMES, factionTypes, missingRequirements, statLines, xpThresholds } from './tech';
import { applyUiSettings } from './settings';

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
}

const TABS: { cat: Category; icon: string; title: string }[] = [
  { cat: 'building', icon: ICONS.building, title: 'Structures' },
  { cat: 'defense', icon: ICONS.defense, title: 'Defenses' },
  { cat: 'infantry', icon: ICONS.infantry, title: 'Infantry' },
  { cat: 'vehicle', icon: ICONS.vehicle, title: 'Vehicles' },
  { cat: 'aircraft', icon: ICONS.aircraft, title: 'Aircraft' },
];
const CAT_ICON: Record<Category, string> = Object.fromEntries(TABS.map((t) => [t.cat, t.icon])) as Record<Category, string>;

const SUPER_INFO: Record<SuperKind, { icon: string; name: string; desc: string }> = {
  nuke: { icon: ICONS.nuke, name: 'A-Bomb', desc: 'Launch a nuclear missile at any target on the map.' },
  ironcurtain: { icon: ICONS.ironCurtain, name: 'Iron Curtain', desc: 'Make a group of your units invulnerable for a short time.' },
  chrono: { icon: ICONS.chrono, name: 'Chronoshift', desc: 'Teleport one of your vehicles anywhere on the battlefield.' },
};

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

export class Hud {
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
  private tabEls = new Map<Category, HTMLButtonElement>();
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
  private speedBtns: HTMLButtonElement[] = [];
  private sellBtn: HTMLButtonElement;
  private repairBtn: HTMLButtonElement;
  private activeTab: Category = 'building';
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

  constructor(private host: HudHost) {
    const ui = document.getElementById('ui')!;
    this.root = ui;
    ui.innerHTML = '';
    applyUiSettings();
    this.sound = new UiSound(host.audio);
    this.tip = new Tooltip();

    // ======================================================== sidebar
    const sb = el('div', 'panel');
    sb.id = 'sidebar';
    this.sidebar = sb;
    ui.appendChild(sb);

    const head = el('div', 'sb-head');
    this.creditsBox = el('div', 'credits', `<span class="cr-ic">$</span><div class="cr-body"><span class="cr-lbl">Credits</span></div><span class="cr-delta"></span><span class="cr-store"><i></i></span>`);
    this.creditsBox.querySelector('.cr-body')!.appendChild(this.odo.el);
    this.deltaEl = this.creditsBox.querySelector('.cr-delta')!;
    this.storeFill = this.creditsBox.querySelector('.cr-store i')!;
    this.repairBtn = el('button', 'mode-btn', ICONS.wrench);
    this.repairBtn.dataset.tip = tipHtml('Repair mode', 'Click damaged structures to repair them. Costs credits.', [['R', 'Toggle']]);
    this.sellBtn = el('button', 'mode-btn', ICONS.sell);
    this.sellBtn.dataset.tip = tipHtml('Sell mode', 'Click a structure to sell it for a partial refund.', [['Z', 'Toggle']]);
    this.repairBtn.onclick = () => { this.sound.play('click'); host.setMode(host.getMode() === 'repair' ? 'normal' : 'repair'); };
    this.sellBtn.onclick = () => { this.sound.play('click'); host.setMode(host.getMode() === 'sell' ? 'normal' : 'sell'); };
    head.append(this.creditsBox, this.repairBtn, this.sellBtn);
    sb.appendChild(head);

    this.powerBox = el('div', 'power', `<div class="pw-head"><span class="pw-ic">${ICONS.boltSolid}</span><span class="pw-lbl">Power</span><span class="pw-state"></span><span class="pw-num"></span></div>
      <div class="pw-bar"><i class="pw-out"></i><i class="pw-load"></i><i class="pw-deficit"></i><i class="pw-segs"></i><i class="pw-use"></i></div>`);
    const q = (s: string) => this.powerBox.querySelector(s) as HTMLElement;
    this.pw = { out: q('.pw-out'), load: q('.pw-load'), deficit: q('.pw-deficit'), use: q('.pw-use'), num: q('.pw-num'), state: q('.pw-state') };
    sb.appendChild(this.powerBox);

    this.radar = el('div', 'radar');
    sb.appendChild(this.radar);
    this.minimap = new Minimap(this.radar, host.world, host.local, (x, y, b, d) => host.minimapPoint(x, y, b, d));
    this.radar.insertAdjacentHTML('beforeend', `<div class="radar-sweep"></div><div class="radar-grid"></div><div class="radar-frame"><i></i><i></i><i></i><i></i></div>
      <div class="offline"><span class="off-ic">${ICONS.radar}</span><b>Radar offline</b><span>Build a Radar Dome</span></div>`);

    const tabs = el('div', 'tabs');
    TABS.forEach((t, i) => {
      const b = el('button', 'tab', `${t.icon}<span class="tab-prog"><i></i></span><span class="badge"></span>`);
      b.dataset.tip = tipHtml(t.title);
      b.dataset.i = String(i);
      b.onclick = () => {
        if (this.activeTab !== t.cat) this.sound.play('tab');
        this.activeTab = t.cat;
        this.tabUserChosen = true;
        this.gridKey = '';
        this.slowT = 0;
      };
      this.tabEls.set(t.cat, b);
      tabs.appendChild(b);
    });
    this.tabInd = el('span', 'tab-ind');
    tabs.appendChild(this.tabInd);
    sb.appendChild(tabs);

    const ch = el('div', 'cat-head', `<span class="cat-title"></span><span class="cat-line"></span><span class="cat-status"></span>`);
    this.catTitle = ch.querySelector('.cat-title')!;
    this.catStatus = ch.querySelector('.cat-status')!;
    sb.appendChild(ch);
    this.grid = el('div', 'build-grid');
    // reading scroll metrics forces a layout, so only on scroll / resize / grid rebuild (not every frame)
    this.grid.addEventListener('scroll', () => this.updateScrollFade(), { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.updateScrollFade()).observe(this.grid);
    sb.appendChild(this.grid);
    this.supers = el('div', 'supers');
    sb.appendChild(this.supers);
    this.tip.bind(sb, 'left');
    this.sound.bind(sb, 'button:not(:disabled), .bitem');

    // ======================================================== top bar
    const tb = el('div');
    tb.id = 'topbar';
    const menuBtn = el('button', 'tb-btn tb-menu', `${ICONS.menu}<span>Menu</span><kbd>Esc</kbd>`);
    menuBtn.onclick = () => { this.sound.play('click'); host.openPauseMenu(); };
    this.clock = el('div', 'tb-chip tb-clock', `${ICONS.clock}<span class="tb-time">00:00</span>`);
    this.clock.dataset.tip = tipHtml('Mission time');
    const speed = el('div', 'speed-ctl tb-chip');
    for (const [n, s, label] of [[1, 1, 'Normal'], [2, 1.5, 'Fast'], [3, 2.2, 'Fastest']] as [number, number, string][]) {
      const b = el('button', '', `<span class="chev">${'<i></i>'.repeat(n)}</span>`);
      b.dataset.tip = tipHtml(`${label} speed`, '', [[`×${s}`, 'game speed']]);
      b.onclick = () => { this.sound.play('click'); host.setSpeed(s); };
      b.dataset.speed = String(s);
      this.speedBtns.push(b);
      speed.appendChild(b);
    }
    this.objEl = el('div', 'tb-chip tb-obj', `<span class="obj-ic">${ICONS.target}</span><span class="obj-txt"><small>Objective</small><b>Destroy all enemy forces</b></span><span class="obj-pips"></span>`);
    tb.append(menuBtn, this.clock, speed, this.objEl);
    ui.appendChild(tb);
    this.tip.bind(tb, 'bottom');
    this.sound.bind(tb, 'button');

    const tr = el('div');
    tr.id = 'topright';
    this.fpsEl = el('div', 'tb-chip tb-fps');
    this.fpsEl.id = 'fps';
    tr.appendChild(this.fpsEl);
    ui.appendChild(tr);
    this.toasts = new Toasts(ui, tr, () => host.world.time, this.sound);
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

    // HUD buttons must not keep keyboard focus: Space / Enter are game hotkeys and would re-click them.
    const noFocus = (e: MouseEvent) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); };
    for (const c of [sb, tb, tr, this.dock]) c.addEventListener('mousedown', noFocus);
    const label = (b: HTMLElement, l: string) => b.setAttribute('aria-label', l);
    label(this.repairBtn, 'Repair mode');
    label(this.sellBtn, 'Sell mode');
    label(menuBtn, 'Menu');
    label(this.toasts.bell, 'Event log');
    this.speedBtns.forEach((b) => label(b, `Game speed ${b.dataset.speed}x`));
    TABS.forEach((t) => label(this.tabEls.get(t.cat)!, t.title));

    this.shownCredits = host.local.credits;
    this.odo.set(this.shownCredits);
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
    const online = p.radar || !w.fog;
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

  // ---------------------------------------------------------------------------
  /** Structures and defenses share one queue; returns the queue + whether the head belongs to `cat`. */
  private queueFor(p: Player, cat: Category): ProductionQueue {
    const kind = cat === 'building' || cat === 'defense' ? 'structure' : cat;
    return p.queues[kind];
  }

  private updateTabs(p: Player) {
    const avail = new Map<Category, string[]>();
    const opts = p.buildOptions();
    for (const id of opts) {
      const t = getType(id);
      const list = avail.get(t.category) ?? [];
      list.push(id);
      avail.set(t.category, list);
    }
    // keep items that are in progress visible even if tech was lost
    for (const qq of Object.values(p.queues)) {
      for (const it of qq.items) {
        const t = getType(it.type);
        const list = avail.get(t.category) ?? [];
        if (!list.includes(it.type)) list.push(it.type);
        avail.set(t.category, list);
      }
      if (qq.ready) {
        const t = getType(qq.ready);
        const list = avail.get(t.category) ?? [];
        if (!list.includes(t.id)) list.push(t.id);
        avail.set(t.category, list);
      }
    }
    // "NEW" flags for freshly unlocked options
    const now = performance.now();
    if (!this.known) this.known = new Set(opts);
    else for (const id of opts) if (!this.known.has(id)) { this.known.add(id); this.newUntil.set(id, now + 14000); }

    if (!(avail.get(this.activeTab)?.length) && !this.tabUserChosen) {
      const first = TABS.find((t) => avail.get(t.cat)?.length);
      if (first && first.cat !== this.activeTab) { this.activeTab = first.cat; this.gridKey = ''; }
    }
    if (avail.get(this.activeTab)?.length) this.tabUserChosen = false;

    TABS.forEach((t, i) => {
      const b = this.tabEls.get(t.cat)!;
      const n = avail.get(t.cat)?.length ?? 0;
      const q = this.queueFor(p, t.cat);
      const isStruct = q.kind === 'structure';
      const ready = isStruct && !!q.ready && getType(q.ready).category === t.cat;
      const mine = q.items.filter((it) => getType(it.type).category === t.cat);
      const head = mine.length && q.items[0] === mine[0] ? mine[0] : null;
      const hasNew = [...(avail.get(t.cat) ?? [])].some((id) => (this.newUntil.get(id) ?? 0) > now);
      b.classList.toggle('empty', n === 0);
      b.classList.toggle('active', t.cat === this.activeTab);
      b.classList.toggle('has-new', hasNew && t.cat !== this.activeTab);
      const badge = b.querySelector('.badge') as HTMLElement;
      const txt = ready ? '' : mine.length ? String(mine.length) : '';
      badge.className = 'badge' + (ready ? ' on ready' : mine.length ? ' on' : '');
      if (badge.innerHTML !== (ready ? ICONS.check : txt)) badge.innerHTML = ready ? ICONS.check : txt;
      const prog = b.querySelector('.tab-prog') as HTMLElement;
      prog.classList.toggle('on', !!head || ready);
      prog.classList.toggle('hold', !!head?.paused);
      (prog.firstElementChild as HTMLElement).style.transform = `scaleX(${ready ? 1 : head ? head.progress.toFixed(3) : 0})`;
      const status = ready ? '<span class="tt-ok">Ready to place</span>' : head ? `${head.paused ? 'On hold' : 'Producing'}: <b>${getType(head.type).name}</b> ${Math.floor(head.progress * 100)}%` + (mine.length > 1 ? ` · ${mine.length - 1} queued` : '') : n ? `${n} available` : 'Nothing available yet';
      const tip = tipHtml(t.title, status);
      if (b.dataset.tip !== tip) { b.dataset.tip = tip; this.tip.refresh(b, tip); }
    });

    // grid
    const list = (avail.get(this.activeTab) ?? []).sort((a, b) => getType(a).cost - getType(b).cost);
    const locked = factionTypes(p.faction, this.activeTab).filter((id) => !list.includes(id));
    const key = this.activeTab + ':' + list.join(',') + '|' + locked.join(',');
    if (key !== this.gridKey) { this.rebuildGrid(list, locked, key); this.updateScrollFade(); }
    for (const c of this.cards.values()) c.el.classList.toggle('is-new', (this.newUntil.get(c.id) ?? 0) > now);
    this.updateCatHeader(p, list, locked);
    if (this.hoverCard) this.tip.refresh(this.hoverCard.el, this.cardTip(this.hoverCard));
  }

  /** Fade the grid edges only where more cards are hidden by scrolling. */
  private updateScrollFade() {
    const g = this.grid;
    g.classList.toggle('more-below', g.scrollHeight - g.clientHeight - g.scrollTop > 4);
    g.classList.toggle('more-above', g.scrollTop > 4);
  }

  private updateCatHeader(p: Player, list: string[], locked: string[]) {
    const tab = TABS.find((t) => t.cat === this.activeTab)!;
    this.catTitle.textContent = tab.title;
    const q = this.queueFor(p, this.activeTab);
    const mine = q.items.filter((it) => getType(it.type).category === this.activeTab);
    const head = mine.length && q.items[0] === mine[0] ? mine[0] : null;
    let html: string, cls = '';
    if (q.kind === 'structure' && q.ready) {
      const t = getType(q.ready);
      if (t.category === this.activeTab) { html = `Place ${esc(shortName(t))}`; cls = 'ok'; }
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
    if (this.hoverCard) { this.tip.hide(this.hoverCard.el); this.hoverCard = null; }
    let i = 0;
    for (const id of list) this.grid.appendChild(this.makeCard(id, false, i++));
    if (locked.length) {
      this.grid.appendChild(el('div', 'grid-sep', `${ICONS.lock}<span>Requires tech</span><i></i>`));
      for (const id of locked) this.grid.appendChild(this.makeCard(id, true, i++));
    }
    if (!list.length && !locked.length) this.grid.appendChild(el('div', 'grid-empty', `${CAT_ICON[this.activeTab]}<span>Nothing to build here yet</span>`));
    this.grid.classList.remove('stagger', 'stagger-soft');
    void this.grid.offsetWidth;
    this.grid.classList.add(tabChanged ? 'stagger' : 'stagger-soft');
    if (tabChanged) this.grid.scrollTop = 0;
    this.updateCards();
  }

  private makeCard(id: string, locked: boolean, i: number): HTMLElement {
    const t = getType(id);
    const img = this.host.thumbs.get(id);
    const c = el('div', 'bitem' + (locked ? ' locked' : ''));
    c.style.setProperty('--i', String(i));
    c.innerHTML = `<div class="bi-tilt">
        <div class="bi-img">${img ? `<img src="${img}" alt="" draggable="false">` : `<span class="bi-fallback">${CAT_ICON[t.category]}</span>`}</div>
        <div class="bi-shade"></div>
        <svg class="bi-ring" viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="40"/><circle class="arc" cx="50" cy="50" r="40" pathLength="100"/></svg>
        <div class="bi-label"></div>
        <span class="bi-cost">$${t.cost.toLocaleString('en-US')}</span>
        <span class="bi-name">${esc(shortName(t))}</span>
        <span class="bi-count"></span>
        ${locked ? `<span class="bi-lock">${ICONS.lock}</span>` : ''}
        <span class="bi-new">New</span>
        <div class="bi-glare"></div><div class="bi-shine"></div>
      </div>`;
    const card: Card = {
      id, el: c, locked, state: '', pct: -1, count: -1, poor: false,
      arc: c.querySelector('.arc') as SVGCircleElement, label: c.querySelector('.bi-label')!, countEl: c.querySelector('.bi-count')!,
    };
    c.addEventListener('click', (ev) => this.clickItem(card, ev.shiftKey));
    c.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.rightClickItem(card); });
    c.addEventListener('pointerenter', () => { this.hoverCard = card; this.tip.show(c, this.cardTip(card), 'left'); });
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
      foot += `<div class="tt-keys"><span><kbd>LMB</kbd>${isBuildingType(t) ? 'Build / place' : 'Train'}</span>${isBuildingType(t) ? '' : '<span><kbd>Shift</kbd>×5</span>'}<span><kbd>RMB</kbd>Hold / cancel</span></div>`;
    }
    return `<div class="tt-head"><b>${esc(t.name)}</b><span class="tt-cost">$${t.cost.toLocaleString('en-US')}</span></div>
      <div class="tt-sub">${cap(t.category === 'building' ? 'structure' : t.category)}${isBuildingType(t) ? ` · ${t.size[0]}×${t.size[1]}` : ''}</div>
      <p>${esc(t.description)}</p><div class="tt-stats">${rows}</div>${foot}`;
  }

  private clickItem(card: Card, shift: boolean) {
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
      if (q.ready || (q.items.length && q.items[0].type !== id)) {
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
    if (card.locked) return;
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
    const kinds = (['nuke', 'ironcurtain', 'chrono'] as SuperKind[]).filter((k) => superBuilding(w, p, k));
    const key = kinds.join(',');
    if (this.superKey !== key) {
      this.superKey = key;
      this.supers.innerHTML = '';
      this.supers.classList.toggle('on', kinds.length > 0);
      for (const k of kinds) {
        const b = el('button', `super sw-${k}`, `<span class="sw-ring"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="44"/><circle class="arc" cx="50" cy="50" r="44" pathLength="100"/></svg><span class="sw-ic">${SUPER_INFO[k].icon}</span></span>
          <span class="sw-txt"><b>${SUPER_INFO[k].name}</b><small></small></span><span class="sw-shine"></span>`);
        b.dataset.kind = k;
        b.onclick = () => {
          if (superReady(w, p, k)) { this.sound.play('click'); this.host.beginSuperweapon(k); }
          else { this.sound.play('error'); this.message(`${SUPER_INFO[k].name} not ready`, true); }
        };
        this.supers.appendChild(b);
      }
    }
    for (const b of this.supers.querySelectorAll<HTMLElement>('.super')) {
      const k = b.dataset.kind as SuperKind;
      const bld = superBuilding(w, p, k);
      const full = bld?.bt.superCharge ?? 300;
      const frac = Math.min(1, p.superCharge[k] / full);
      (b.querySelector('.arc') as SVGElement).style.strokeDashoffset = String(100 - frac * 100);
      const ready = frac >= 1;
      const offline = !ready && p.lowPower;
      b.classList.toggle('ready', ready);
      b.classList.toggle('offline', offline);
      const sub = ready ? 'Ready' : offline ? 'Offline' : `${Math.floor(frac * 100)}% · ${formatTime(Math.max(0, full - p.superCharge[k]))}`;
      const small = b.querySelector('small')!;
      if (small.textContent !== sub) small.textContent = sub;
      const tip = tipHtml(SUPER_INFO[k].name, SUPER_INFO[k].desc + (ready ? ' <span class="tt-ok">Ready — click, then choose a target.</span>' : offline ? ' <span class="tt-bad">Charging halted: low power.</span>' : ` Charging: ${Math.floor(frac * 100)}%.`));
      if (b.dataset.tip !== tip) { b.dataset.tip = tip; this.tip.refresh(b, tip); }
    }
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
  }

  private buildSelection(ents: Entity[], wasOpen: boolean) {
    const first = ents[0];
    const local = this.host.local;
    const own = first.owner === local;
    const sp = this.selpanel;
    sp.innerHTML = '';
    this.extraHtml = '';
    sp.className = 'panel on ' + (ents.length === 1 ? 'single' : 'multi') + (own ? '' : local.isEnemy(first.owner) ? ' enemy' : ' ally');
    sp.style.setProperty('--team', hexColor(first.owner.color));
    this.dock.classList.add('has-sel');
    if (ents.length === 1) sp.append(...this.singleView(first));
    else sp.append(this.multiView(ents));
    if (own) sp.appendChild(this.commandButtons(ents.filter((e): e is Unit | Building => e instanceof Unit || e instanceof Building)));
    replay(sp, wasOpen ? 'swap' : 'pop', 500);
  }

  private chip(icon: string, value: string, sub: string, tip: string, k = ''): string {
    return `<span class="chip"${tip ? ` data-tip="${esc(tip)}"` : ''}><span class="chip-ic">${icon}</span><span class="chip-v"${k ? ` data-k="${k}"` : ''}>${value}</span>${sub ? `<span class="chip-s">${sub}</span>` : ''}</span>`;
  }

  private singleView(e: Entity): HTMLElement[] {
    const t = e.type;
    const img = this.host.thumbs.get(t.id);
    const own = e.owner === this.host.local;
    const por = el('div', 'sp-portrait', `<div class="sp-img">${img ? `<img src="${img}" alt="" draggable="false">` : `<span class="sp-fallback">${CAT_ICON[t.category]}</span>`}</div>
      <span class="sp-rank" data-k="rank"></span><span class="sp-teamstrip"></span><i class="cn tl"></i><i class="cn tr"></i><i class="cn bl"></i><i class="cn br"></i>`);
    const chips: string[] = [];
    chips.push(this.chip(ICONS.shield, cap(t.armor), '', tipHtml('Armour', `Armour class <b>${cap(t.armor)}</b> — determines how much damage each warhead deals.`)));
    if (e instanceof Unit) {
      const ut = e.ut;
      const wps = [ut.primary, ut.secondary !== ut.primary ? ut.secondary : undefined].filter(Boolean) as string[];
      for (const wid of wps) {
        const wd = WEAPONS[wid];
        chips.push(this.chip(ICONS.target, esc(wd.id), `R${+wd.range.toFixed(2)}`, tipHtml(`Weapon: ${esc(wd.id)}`, `Damage <b>${Math.abs(wd.damage)}</b>${wd.burst > 1 ? ` ×${wd.burst}` : ''} · range <b>${+wd.range.toFixed(2)}</b> cells${wd.antiAir ? ' · anti-air' : ''}${!wd.antiGround ? ' (air only)' : ''}`)));
      }
      chips.push(this.chip(ICONS.gauge, mphToCellsPerSecond(e.ut.speed).toFixed(1), 'c/s', tipHtml('Speed', 'Cells per second.')));
    } else if (e instanceof Building) {
      const pw = e.bt.power;
      if (pw) chips.push(`<span class="chip ${pw > 0 ? 'pos' : 'neg'}" data-tip="${esc(tipHtml('Power', pw > 0 ? 'Produces power (less when damaged).' : 'Consumes power.'))}"><span class="chip-ic">${ICONS.bolt}</span><span class="chip-v">${pw > 0 ? '+' : ''}${pw}</span></span>`);
      if (e.bt.primary) {
        const wd = WEAPONS[e.bt.primary];
        chips.push(this.chip(ICONS.target, esc(wd.id), `R${+wd.range.toFixed(2)}`, tipHtml(`Weapon: ${esc(wd.id)}`, `Damage <b>${Math.abs(wd.damage)}</b> · range <b>${+wd.range.toFixed(2)}</b> cells`)));
      }
      if (e.bt.storage) chips.push(this.chip(ICONS.coin, `$${e.bt.storage.toLocaleString('en-US')}`, 'store', tipHtml('Ore storage')));
    }
    if (e.weapons.length) chips.push(this.chip(ICONS.kills, '0', 'kills', tipHtml('Confirmed kills'), 'kills'));
    const main = el('div', 'sp-main', `<div class="sp-title"><span class="sp-name">${esc(t.name)}</span><span class="sp-tag" data-k="tag"></span>${own ? '' : `<span class="sp-owner"><i></i>${esc(e.owner.name)}</span>`}</div>
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
      const txt = `<b>${Math.ceil(e.hp)}</b> / ${e.maxHp}`;
      if (hp.innerHTML !== txt) hp.innerHTML = txt;
    }
    const rk = sp.querySelector('[data-k="rank"]') as HTMLElement | null;
    if (rk && rk.dataset.r !== String(e.rank)) { rk.dataset.r = String(e.rank); rk.innerHTML = rankBadge(e.rank); }
    const kills = sp.querySelector('[data-k="kills"]') as HTMLElement | null;
    if (kills && kills.textContent !== String(e.kills)) kills.textContent = String(e.kills);
    // tag
    let tag = '', tagCls = '';
    if (e.invulnerable > 0) { tag = 'Invulnerable'; tagCls = 'inv'; }
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
      if (bt.superweapon && own) {
        const k = bt.superweapon;
        const full = bt.superCharge ?? 300;
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
      const l = groups.get(e.type.id) ?? [];
      l.push(e);
      groups.set(e.type.id, l);
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
      const l = byType.get(e.type.id) ?? [];
      l.push(e);
      byType.set(e.type.id, l);
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
      add(ICONS.groundFire, 'G', 'Fire at ground', 'Force-fire at a location (click the target after).');
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
}

export { BUILDINGS };
