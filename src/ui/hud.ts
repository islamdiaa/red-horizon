import { BUILDINGS, UNITS, WEAPONS, getType, isBuildingType, mphToCellsPerSecond, type Category, type TypeDef } from '../data/rules';
import { formatTime } from '../core/util';
import { Building, Unit } from '../sim/entities';
import { queueKindOf, type Player } from '../sim/player';
import { buildSeconds } from '../sim/production';
import { superBuilding, superReady, type SuperKind } from '../sim/superweapons';
import type { Command } from '../sim/types';
import type { World } from '../sim/world';
import type { AudioSystem } from '../audio';
import { Minimap } from './minimap';
import { ICONS } from './icons';

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
  keyCommand(key: string): void;
  stats?(): string;
}

const TABS: { cat: Category; icon: string; title: string }[] = [
  { cat: 'building', icon: ICONS.building, title: 'Structures' },
  { cat: 'defense', icon: ICONS.defense, title: 'Defenses' },
  { cat: 'infantry', icon: ICONS.infantry, title: 'Infantry' },
  { cat: 'vehicle', icon: ICONS.vehicle, title: 'Vehicles' },
  { cat: 'aircraft', icon: ICONS.aircraft, title: 'Aircraft' },
];

const SUPER_INFO: Record<SuperKind, { icon: string; name: string }> = {
  nuke: { icon: '☢', name: 'A-BOMB' },
  ironcurtain: { icon: '🛡', name: 'IRON CURTAIN' },
  chrono: { icon: '⧗', name: 'CHRONOSHIFT' },
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class Hud {
  readonly root: HTMLElement;
  readonly minimap: Minimap;
  private creditsVal: HTMLElement;
  private creditsBox: HTMLElement;
  private powerFill: HTMLElement;
  private powerUse: HTMLElement;
  private powerBox: HTMLElement;
  private powerTxt: HTMLElement;
  private radarOffline: HTMLElement;
  private tabEls = new Map<Category, HTMLButtonElement>();
  private grid: HTMLElement;
  private supers: HTMLElement;
  private selpanel: HTMLElement;
  private tooltip: HTMLElement;
  private messages: HTMLElement;
  private clock: HTMLElement;
  private fpsEl: HTMLElement;
  private sellBtn: HTMLButtonElement;
  private repairBtn: HTMLButtonElement;
  private activeTab: Category = 'building';
  private shownCredits = 0;
  private items = new Map<string, HTMLElement>();
  private gridKey = '';
  private selKey = '';
  private slowT = 0;
  private cashTickT = 0;
  private fpsAcc = 0;
  private fpsN = 0;

  constructor(private host: HudHost) {
    const ui = document.getElementById('ui')!;
    this.root = ui;
    ui.innerHTML = '';

    // ---- sidebar
    const sb = el('div', 'panel');
    sb.id = 'sidebar';
    ui.appendChild(sb);
    const top = el('div', 'sb-top');
    this.creditsBox = el('div', 'credits', '<span class="lbl">Credits</span><span class="val">0</span>');
    this.creditsVal = this.creditsBox.querySelector('.val')!;
    this.repairBtn = el('button', 'mode-btn', ICONS.wrench);
    this.repairBtn.title = 'Repair mode (R)';
    this.sellBtn = el('button', 'mode-btn', ICONS.sell);
    this.sellBtn.title = 'Sell mode (Z)';
    this.repairBtn.onclick = () => host.setMode(host.getMode() === 'repair' ? 'normal' : 'repair');
    this.sellBtn.onclick = () => host.setMode(host.getMode() === 'sell' ? 'normal' : 'sell');
    top.append(this.creditsBox, this.repairBtn, this.sellBtn);
    sb.appendChild(top);

    this.powerBox = el('div', 'power', '<div class="fill"></div><div class="use"></div><div class="txt"></div>');
    this.powerFill = this.powerBox.querySelector('.fill')!;
    this.powerUse = this.powerBox.querySelector('.use')!;
    this.powerTxt = this.powerBox.querySelector('.txt')!;
    sb.appendChild(this.powerBox);

    const radar = el('div', 'radar');
    sb.appendChild(radar);
    this.minimap = new Minimap(radar, host.world, host.local, (x, y, b, d) => host.minimapPoint(x, y, b, d));
    this.radarOffline = el('div', 'offline', '<b>RADAR OFFLINE</b><span>Build a Radar Dome</span>');
    radar.appendChild(this.radarOffline);

    const tabs = el('div', 'tabs');
    for (const t of TABS) {
      const b = el('button', 'tab', `${t.icon}<span class="badge"></span>`);
      b.title = t.title;
      b.onclick = () => { this.activeTab = t.cat; host.audio.play('tab'); this.gridKey = ''; };
      this.tabEls.set(t.cat, b);
      tabs.appendChild(b);
    }
    sb.appendChild(tabs);
    this.grid = el('div', 'build-grid');
    sb.appendChild(this.grid);
    this.supers = el('div', 'supers');
    sb.appendChild(this.supers);

    // ---- top bar
    const tb = el('div');
    tb.id = 'topbar';
    const menuBtn = el('button', '', `${ICONS.menu}<span>MENU</span>`);
    menuBtn.onclick = () => host.openPauseMenu();
    this.clock = el('div', 'chip panel', '00:00');
    const speed = el('div', 'speed-ctl');
    for (const [label, s] of [['▶', 1], ['▶▶', 1.5], ['▶▶▶', 2.2]] as [string, number][]) {
      const b = el('button', '', label);
      b.title = `Game speed ×${s}`;
      b.onclick = () => host.setSpeed(s);
      b.dataset.speed = String(s);
      speed.appendChild(b);
    }
    this.fpsEl = el('div', '', '');
    this.fpsEl.id = 'fps';
    tb.append(menuBtn, this.clock, speed, this.fpsEl);
    ui.appendChild(tb);

    this.messages = el('div');
    this.messages.id = 'messages';
    ui.appendChild(this.messages);

    this.selpanel = el('div', 'panel glow-edge');
    this.selpanel.id = 'selpanel';
    ui.appendChild(this.selpanel);

    this.tooltip = el('div', 'panel');
    this.tooltip.id = 'tooltip';
    document.body.appendChild(this.tooltip);

    this.shownCredits = host.local.credits;
  }

  message(text: string, warn = false) {
    const m = el('div', 'msg' + (warn ? ' warn' : ''), text);
    this.messages.appendChild(m);
    while (this.messages.children.length > 4) this.messages.firstChild?.remove();
    setTimeout(() => m.remove(), 4200);
  }

  // ---------------------------------------------------------------------------
  update(dt: number) {
    const p = this.host.local;
    const w = this.host.world;
    // credits counter rolls towards the real value
    const target = p.credits;
    const diff = target - this.shownCredits;
    if (Math.abs(diff) >= 1) {
      const step = Math.sign(diff) * Math.max(1, Math.abs(diff) * Math.min(1, dt * 6));
      this.shownCredits += Math.abs(step) > Math.abs(diff) ? diff : step;
      this.cashTickT -= dt;
      if (this.cashTickT <= 0 && Math.abs(diff) > 4) { this.cashTickT = 0.07; this.host.audio.play('cash_tick', undefined, { volume: 0.35 }); }
    }
    this.creditsVal.textContent = Math.round(this.shownCredits).toLocaleString('en-US');
    this.creditsBox.classList.toggle('storage-full', p.storage > 0 && p.ore >= p.storage - 1);

    this.fpsAcc += dt; this.fpsN++;
    this.slowT -= dt;
    if (this.slowT > 0) {
      this.updateProgress();
      return;
    }
    this.slowT = 0.12;
    if (this.fpsAcc > 0.5) { this.fpsEl.textContent = `${Math.round(this.fpsN / this.fpsAcc)} FPS · ${this.host.stats?.() ?? ''}`; this.fpsAcc = 0; this.fpsN = 0; }
    this.clock.textContent = formatTime(w.time);
    // power
    const maxP = Math.max(100, p.powerOut, p.powerUse) * 1.1;
    this.powerFill.style.width = `${(p.powerOut / maxP) * 100}%`;
    this.powerUse.style.left = `${(p.powerUse / maxP) * 100}%`;
    this.powerBox.classList.toggle('low', p.lowPower);
    this.powerTxt.textContent = `⚡ ${p.powerOut} / ${p.powerUse}`;
    this.powerBox.title = p.lowPower ? 'LOW POWER — production slowed, defenses offline' : 'Power output / usage';
    this.radarOffline.style.display = p.radar || !w.fog ? 'none' : 'flex';
    this.sellBtn.classList.toggle('active', this.host.getMode() === 'sell');
    this.repairBtn.classList.toggle('active', this.host.getMode() === 'repair');
    for (const b of document.querySelectorAll<HTMLButtonElement>('.speed-ctl button')) b.classList.toggle('on', +b.dataset.speed! === this.host.getSpeed());

    // tabs
    const opts = p.buildOptions();
    const byCat = new Map<Category, string[]>();
    for (const id of opts) {
      const t = getType(id);
      const list = byCat.get(t.category) ?? [];
      list.push(id);
      byCat.set(t.category, list);
    }
    // keep items that are in progress visible even if tech was lost
    for (const q of Object.values(p.queues)) for (const it of q.items) {
      const t = getType(it.type);
      const list = byCat.get(t.category) ?? [];
      if (!list.includes(it.type)) list.push(it.type);
      byCat.set(t.category, list);
    }
    if (p.queues.structure.ready) {
      const t = getType(p.queues.structure.ready);
      const list = byCat.get(t.category) ?? [];
      if (!list.includes(t.id)) list.push(t.id);
      byCat.set(t.category, list);
    }
    if (!(byCat.get(this.activeTab)?.length)) {
      const first = TABS.find((t) => byCat.get(t.cat)?.length);
      if (first) this.activeTab = first.cat;
    }
    for (const t of TABS) {
      const b = this.tabEls.get(t.cat)!;
      const n = byCat.get(t.cat)?.length ?? 0;
      b.disabled = n === 0;
      b.classList.toggle('active', t.cat === this.activeTab);
      const badge = b.querySelector('.badge') as HTMLElement;
      const ready = (t.cat === 'building' || t.cat === 'defense') && p.queues.structure.ready && getType(p.queues.structure.ready).category === t.cat;
      badge.classList.toggle('on', !!ready);
      badge.textContent = ready ? '!' : '';
    }
    const list = (byCat.get(this.activeTab) ?? []).sort((a, b) => getType(a).cost - getType(b).cost);
    const key = this.activeTab + ':' + list.join(',');
    if (key !== this.gridKey) this.rebuildGrid(list, key);
    this.updateProgress();
    this.updateSupers();
    this.updateSelection();
  }

  private rebuildGrid(list: string[], key: string) {
    this.gridKey = key;
    this.grid.innerHTML = '';
    this.items.clear();
    for (const id of list) {
      const t = getType(id);
      const item = el('div', 'bitem');
      const img = this.host.thumbs.get(id);
      item.innerHTML = `${img ? `<img src="${img}" alt="">` : `<div class="state">${t.name}</div>`}<div class="prog"></div><div class="state pstate"></div><span class="cost">$${t.cost}</span><span class="count"></span>`;
      item.addEventListener('click', (ev) => this.clickItem(id, ev.shiftKey));
      item.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.rightClickItem(id); });
      item.addEventListener('mouseenter', (ev) => this.showTooltip(t, ev));
      item.addEventListener('mousemove', (ev) => this.moveTooltip(ev));
      item.addEventListener('mouseleave', () => this.tooltip.classList.remove('on'));
      this.grid.appendChild(item);
      this.items.set(id, item);
    }
  }

  private updateProgress() {
    const p = this.host.local;
    for (const [id, item] of this.items) {
      const t = getType(id);
      const q = p.queues[queueKindOf(t)];
      const prog = item.querySelector('.prog') as HTMLElement;
      const state = item.querySelector('.pstate') as HTMLElement;
      const count = item.querySelector('.count') as HTMLElement;
      const ready = q.ready === id;
      const n = q.count(id);
      const head = q.items[0]?.type === id ? q.items[0] : null;
      item.classList.toggle('ready', ready);
      item.classList.toggle('hold', !!head?.paused);
      item.classList.toggle('poor', p.credits < t.cost * 0.25 && !head && !ready);
      count.textContent = n > 1 ? String(n) : '';
      if (ready) {
        prog.style.background = '';
        state.textContent = 'READY';
      } else if (head) {
        const pct = head.progress * 100;
        prog.style.background = `conic-gradient(from 0deg, rgba(var(--accent-rgb),0.18) 0 ${pct}%, rgba(0,0,0,0.66) ${pct}% 100%)`;
        state.textContent = head.paused ? 'ON HOLD' : q.stalled ? '$$$' : `${Math.floor(pct)}%`;
      } else if (n > 0) {
        prog.style.background = 'rgba(0,0,0,0.45)';
        state.textContent = 'QUEUED';
      } else {
        prog.style.background = '';
        state.textContent = '';
      }
    }
  }

  private clickItem(id: string, shift: boolean) {
    const p = this.host.local;
    const t = getType(id);
    const q = p.queues[queueKindOf(t)];
    this.host.audio.play('click');
    if (isBuildingType(t)) {
      if (q.ready === id) { this.host.beginPlacement(id); return; }
      if (q.ready || (q.items.length && q.items[0].type !== id)) {
        this.message('Already building', true);
        this.host.audio.play('error');
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

  private rightClickItem(id: string) {
    const p = this.host.local;
    const t = getType(id);
    const q = p.queues[queueKindOf(t)];
    this.host.audio.play('click');
    if (q.ready === id) { this.host.issue({ c: 'cancel', player: p.id, type: id }); return; }
    const head = q.items[0];
    if (head && head.type === id && !head.paused) this.host.issue({ c: 'pause', player: p.id, type: id });
    else if (q.count(id) > 0) this.host.issue({ c: 'cancel', player: p.id, type: id });
  }

  private showTooltip(t: TypeDef, ev: MouseEvent) {
    const w = this.host.world, p = this.host.local;
    const secs = buildSeconds(w, p, t.id);
    let stats = `<span>Strength</span><b>${t.strength} · ${t.armor} armor</b>`;
    if (isBuildingType(t)) {
      stats += `<span>Power</span><b>${t.power > 0 ? '+' : ''}${t.power}</b>`;
      if (t.primary) stats += `<span>Weapon</span><b>${WEAPONS[t.primary].id} · range ${WEAPONS[t.primary].range}</b>`;
    } else {
      const u = UNITS[t.id];
      stats += `<span>Speed</span><b>${mphToCellsPerSecond(u.speed).toFixed(1)} cells/s</b>`;
      if (u.primary) stats += `<span>Weapon</span><b>${u.primary}${u.secondary && u.secondary !== u.primary ? ' + ' + u.secondary : ''}</b>`;
    }
    stats += `<span>Build time</span><b>${secs.toFixed(0)} s</b>`;
    this.tooltip.innerHTML = `<h4>${t.name}</h4><span class="cost">$${t.cost}</span><p>${t.description}</p><div class="stats">${stats}</div>
      <p class="small">Left-click: build${isBuildingType(t) ? ' / place' : ' (Shift ×5)'} · Right-click: hold / cancel</p>`;
    this.tooltip.classList.add('on');
    this.moveTooltip(ev);
  }

  private moveTooltip(ev: MouseEvent) {
    const r = this.tooltip.getBoundingClientRect();
    this.tooltip.style.left = `${Math.max(8, ev.clientX - r.width - 18)}px`;
    this.tooltip.style.top = `${Math.min(window.innerHeight - r.height - 8, Math.max(8, ev.clientY - 20))}px`;
  }

  private updateSupers() {
    const w = this.host.world, p = this.host.local;
    const kinds = (['nuke', 'ironcurtain', 'chrono'] as SuperKind[]).filter((k) => superBuilding(w, p, k));
    const key = kinds.join(',');
    if (this.supers.dataset.key !== key) {
      this.supers.dataset.key = key;
      this.supers.innerHTML = '';
      for (const k of kinds) {
        const b = el('button', 'super', `<span class="ic">${SUPER_INFO[k].icon}</span>${SUPER_INFO[k].name}<div class="bar"></div>`);
        b.dataset.kind = k;
        b.onclick = () => {
          if (superReady(w, p, k)) this.host.beginSuperweapon(k);
          else { this.host.audio.play('error'); this.message(`${SUPER_INFO[k].name} not ready`, true); }
        };
        this.supers.appendChild(b);
      }
    }
    for (const b of this.supers.querySelectorAll<HTMLElement>('.super')) {
      const k = b.dataset.kind as SuperKind;
      const bld = superBuilding(w, p, k);
      const full = bld?.bt.superCharge ?? 300;
      const frac = Math.min(1, p.superCharge[k] / full);
      (b.querySelector('.bar') as HTMLElement).style.width = `${frac * 100}%`;
      b.classList.toggle('ready', frac >= 1);
      b.title = frac >= 1 ? 'Ready — click, then choose a target' : `Charging ${Math.floor(frac * 100)}% (${Math.ceil(full - p.superCharge[k])}s)`;
    }
  }

  private updateSelection() {
    const w = this.host.world;
    const ids = [...this.host.selection].filter((id) => w.getEntity(id)?.alive);
    const ents = ids.map((id) => w.getEntity(id)!);
    if (!ents.length) {
      this.selpanel.classList.remove('on');
      this.selKey = '';
      return;
    }
    this.selpanel.classList.add('on');
    const key = ids.join(',');
    const first = ents[0];
    const own = first.owner === this.host.local;
    if (key !== this.selKey) {
      this.selKey = key;
      this.selpanel.innerHTML = '';
      if (ents.length === 1) {
        const por = el('div', 'sel-portrait', `<img src="${this.host.thumbs.get(first.type.id) ?? ''}" alt="">`);
        const info = el('div', 'sel-info', `<div class="name">${first.type.name}</div><div class="sub" data-k="sub"></div><div class="hp"><div></div></div><div class="sub" data-k="extra"></div>`);
        this.selpanel.append(por, info);
      } else {
        const groups = new Map<string, number[]>();
        for (const e of ents) {
          const l = groups.get(e.type.id) ?? [];
          l.push(e.id);
          groups.set(e.type.id, l);
        }
        const multi = el('div', 'sel-multi');
        for (const [tid, list] of groups) {
          const m = el('div', 'mini', `<img src="${this.host.thumbs.get(tid) ?? ''}" alt=""><span>${list.length}</span>`);
          m.title = `${getType(tid).name} — click to select only these`;
          m.onclick = () => this.host.select(list);
          multi.appendChild(m);
        }
        this.selpanel.appendChild(multi);
      }
      if (own) this.selpanel.appendChild(this.commandButtons(ents as (Unit | Building)[]));
    }
    if (ents.length === 1) {
      const e = first;
      const sub = this.selpanel.querySelector('[data-k="sub"]') as HTMLElement | null;
      const extra = this.selpanel.querySelector('[data-k="extra"]') as HTMLElement | null;
      const hp = this.selpanel.querySelector('.hp div') as HTMLElement | null;
      if (sub) sub.textContent = `${Math.ceil(e.hp)} / ${e.maxHp} · ${e.owner.name}`;
      if (hp) {
        hp.style.width = `${e.healthFrac * 100}%`;
        hp.style.background = e.healthFrac > 0.5 ? 'var(--ok)' : e.healthFrac > 0.25 ? '#ffd23c' : 'var(--danger)';
      }
      if (extra) {
        if (e instanceof Unit && e.ut.harvester) extra.textContent = `Cargo ${Math.round((e.cargo / 28) * 100)}% · ${e.hstate}`;
        else if (e instanceof Building && e.bt.power) extra.textContent = `Power ${e.bt.power > 0 ? '+' : ''}${e.bt.power}`;
        else if (e.kills) extra.textContent = `Kills: ${e.kills}`;
        else extra.textContent = '';
      }
    }
  }

  private commandButtons(ents: (Unit | Building)[]): HTMLElement {
    const box = el('div', 'cmds');
    const add = (icon: string, key: string, title: string) => {
      const b = el('button', 'cmd', `${icon}<small>${key}</small>`);
      b.title = `${title} (${key})`;
      b.onclick = () => this.host.keyCommand(key.toLowerCase());
      box.appendChild(b);
    };
    const units = ents.filter((e): e is Unit => e instanceof Unit);
    const blds = ents.filter((e): e is Building => e instanceof Building);
    if (units.length) {
      add('⚔', 'A', 'Attack-move');
      add('■', 'S', 'Stop');
      add('✳', 'X', 'Scatter');
      if (units.some((u) => u.ut.deploysInto)) add('⬇', 'D', 'Deploy');
      add('⚑', 'G', 'Force-fire on ground (then click)');
    }
    if (blds.length === 1) {
      add('$', 'Z', 'Sell');
      add(ICONS.wrench, 'R', 'Repair');
      if (blds[0].bt.factory && blds[0].bt.factory !== 'building') add('★', 'P', 'Set as primary factory');
    }
    return box;
  }
}

export { BUILDINGS };
