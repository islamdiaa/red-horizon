/**
 * Big-army command tools, owned by the HUD (ui/hud.ts):
 *
 * - Army overview (` or the army chip): your forces by type with count, value, veterancy, idle and damaged
 *   units and health; click a row to select that type on the map (Shift adds, double-click also jumps there).
 *   Totals, a production strip (loops, idle factories) and quick actions. Works in both HUD layouts, by touch
 *   (the chip and every row are buttons) and by gamepad (D-pad focus).
 * - Repeat production: Alt- (or Ctrl- / Cmd-) click a unit card, or its loop button, to keep it building
 *   (sim/repeat.ts). The HUD draws the badges; this module sends the commands and the toasts.
 * - Auto-groups: with only factories selected, Ctrl+0–9 (or Ctrl+Alt+0–9 with units selected too) makes new units
 *   from those factories join that control group; the same key again (or the selection panel's "Off") clears it.
 *   A badge over the factory shows the group. Client-side only (no sim command), kept in saves.
 * - Idle watch: a factory idle for 20 s while you have money pulses its build tab and (throttled) says so; idle
 *   harvesters and refineries without a harvester get a toast too. Off with the "Field manual hints" setting.
 * - Idle units counter (click cycles through them, like I), Shift+E selects every damaged unit, Shift+R sends the
 *   selected damaged vehicles to the service depot one at a time (and ships alongside a naval yard); repaired
 *   vehicles drive back to where they were.
 */
import { groupMods, isAction, keyLabel, modHeld } from './keymap';
import { UNITS, getType, type UnitTypeDef } from '../data/rules';
import { Building, Unit } from '../sim/entities';
import type { Player } from '../sim/player';
import { isLooping, loopFactory } from '../sim/repeat';
import { priceOf } from '../sim/doctrine';
import type { Command, GameEvent, QueueKind } from '../sim/types';
import type { World } from '../sim/world';
import { el, esc, tipHtml, type Tooltip } from './dom';
import { ICONS, rankBadge } from './icons';
import { loadSettings, onSettingsChanged } from './settings';
import tArmy from '../i18n/en/army';
import tCommon from '../i18n/en/common';
import { fmtMoney, hasKey, onLanguageChange, tx } from '../i18n/core';
import { typeName } from '../i18n/names';

/** The overlay hook the factory badges draw through (render/overlay.ts `extra`, chained after the order layer). */
type ExtraDraw = (ctx: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => [number, number] | null) => boolean;
export interface OverlayHook { extra: ExtraDraw | null; groups: Map<number, number> }

export interface ArmyHost {
  world: World;
  local: Player;
  selection: Set<number>;
  thumbs: Map<string, string>;
  spectator?: boolean;
  tip: Tooltip;
  issue(cmd: Command): void;
  select(ids: number[]): void;
  focusOn(x: number, y: number): void;
  message(text: string, warn?: boolean): void;
  sound(key: 'click' | 'error' | 'tab'): void;
  /** Control groups (InputController.groups, mutated in place for auto-groups). */
  getGroups?(): Map<number, number[]>;
  /** Overlay for the control-group numbers and the factory badges. */
  overlay?: OverlayHook | null;
  /** Switch the build bar to the tab of a production queue. */
  openTab(kind: QueueKind): void;
}

export const UNIT_KINDS = ['infantry', 'vehicle', 'aircraft', 'naval'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];
const KIND_ICON: Record<UnitKind, string> = { infantry: ICONS.infantry, vehicle: ICONS.vehicle, aircraft: ICONS.aircraft, naval: ICONS.naval };
const kindTitle = (k: UnitKind) => tArmy(`kind.${k}`);
const KIND_ORDER: Record<string, number> = { vehicle: 0, infantry: 1, aircraft: 2, naval: 3 };

/** Seconds a factory may stand idle (with money to spend) before its tab pulses. */
export const IDLE_FACTORY_SECS = 20;
/** Minimum credits for "you have money" (a broke player is not nagged about riflemen). */
const IDLE_MIN_CREDITS = 500;
const TOAST_EVERY_KIND = 120;
const TOAST_EVERY_ANY = 30;
const HARV_IDLE_SECS = 10;

/** Units the player can select (input.ts selectableUnit; repeated here so touch.ts can import this module without a cycle). */
const selectableUnit = (u: Unit) => u.alive && !u.ut.supportPlane && !(u.parachute > 0) && !u.transport;
const money = (v: number) => fmtMoney(Math.round(v));
/** A unit type's display name. */
const tName = (id: string) => typeName(getType(id));
const isDamaged = (u: Unit) => u.hp < u.maxHp - 0.01;
/** Same notion of "idle" as the I key (input.ts cycleIdle). */
export const isIdle = (u: Unit) => !u.ut.harvester && (u.order.type === 'idle' || u.order.type === 'guard') && !u.orderQueue.length;
const ownedBy = (u: Unit, p: Player) => u.alive && u.owner === p && !u.ut.supportPlane;

interface Row { el: HTMLButtonElement; cnt: HTMLElement; val: HTMLElement; rank: HTMLElement; hp: HTMLElement; idle: HTMLElement; key: string }
interface TypeStat { type: string; kind: UnitKind; ids: number[]; idle: number[]; damaged: number; vet: number; elite: number; hp: number; value: number }
interface RepairJob { depot: number; staging: [number, number]; queue: number[]; active: number; since: number; arrived: number; lastHp: number; healed: number; home: Map<number, [number, number]> }

let styled = false;
/** The battle's army tools (one HUD at a time), for the touch / gamepad order menu. */
let live: ArmyTools | null = null;
export const armyTools = (): ArmyTools | null => live;

export class ArmyTools {
  /** The army chip (unit count + idle count) the HUD mounts in its top bar / resource bar. */
  readonly chip: HTMLElement;
  private unitsBtn: HTMLButtonElement;
  private idleBtn: HTMLButtonElement;
  private panel: HTMLElement;
  private listEl: HTMLElement;
  private headEl: HTMLElement;
  private sumEl: HTMLElement;
  private prodEl: HTMLElement;
  private footEl: HTMLElement;
  private rows = new Map<string, Row>();
  private listKey = '';
  private sumKey = '';
  private prodKey = '';
  private footKey = '';
  private chipKey = '';
  private open = false;
  private panelT = 0;
  private watchT = 0;
  private repairT = 0;
  private idleCursor = 0;
  private offSettings: () => void;
  private offLang: () => void;
  /** Factory id -> control group its new units join. */
  readonly autoGroups = new Map<number, number>();
  /** Idle factories / harvesters / refineries (DOM-free, tested in tests/army.test.ts). */
  readonly idle: IdleWatch;
  /** Repair runs to the service depot (DOM-free, tested in tests/army.test.ts). */
  readonly runs: RepairRuns;
  private extraFn: ExtraDraw | null = null;
  private prevExtra: ExtraDraw | null = null;
  private stats: TypeStat[] = [];
  private lastClick = { t: 0, type: '' };
  /** Loops seen last update, and the ones the player switched off (the rest ended with their factory). */
  private loopsSeen: string[] = [];
  private userOff = new Set<string>();
  private pendingLoop = new Map<string, { on: boolean; tick: number }>();

  constructor(private host: ArmyHost, private uiRoot: HTMLElement) {
    live = this;
    injectArmyStyles();
    this.idle = new IdleWatch(host);
    this.idle.enabled = loadSettings().hints;
    this.runs = new RepairRuns(host);
    this.chip = el('span', 'tb-chip rb-units ar-chip');
    this.unitsBtn = el('button', 'ar-units', `${ICONS.people}<b>0</b>`);
    this.idleBtn = el('button', 'ar-idle', `${ICONS.idle}<b>0</b>`);
    this.unitsBtn.setAttribute('aria-label', tArmy('overview'));
    this.idleBtn.setAttribute('aria-label', tArmy('nextIdle'));
    this.unitsBtn.onclick = () => { host.sound('click'); this.toggle(); };
    this.idleBtn.onclick = () => { host.sound('click'); this.cycleIdle(); };
    this.chip.append(this.unitsBtn, this.idleBtn);
    host.tip.bind(this.chip, 'bottom');

    this.panel = el('div', 'panel ar-panel');
    this.panel.id = 'army-panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', tArmy('overview'));
    this.panel.innerHTML = `<div class="ap-head"></div><div class="ap-sum"></div><div class="ap-prod"></div><div class="ap-list"></div><div class="ap-foot"></div>`;
    this.headEl = this.panel.querySelector('.ap-head')!;
    this.sumEl = this.panel.querySelector('.ap-sum')!;
    this.prodEl = this.panel.querySelector('.ap-prod')!;
    this.listEl = this.panel.querySelector('.ap-list')!;
    this.footEl = this.panel.querySelector('.ap-foot')!;
    this.headEl.innerHTML = `<span class="ap-ic">${ICONS.people}</span><b>${tArmy.html('title')}</b><span class="ap-tot"></span><button class="ap-x" aria-label="${esc(tCommon('close'))}">${ICONS.close}</button>`;
    (this.headEl.querySelector('.ap-x') as HTMLElement).onclick = () => { host.sound('click'); this.toggle(false); };
    host.tip.bind(this.panel, 'right');
    // HUD buttons must not keep keyboard focus (Space / Enter are game hotkeys)
    this.panel.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
    this.chip.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
    this.listEl.addEventListener('click', (e) => this.onRowClick(e));
    this.prodEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
      if (!b) return;
      host.sound('click');
      const stop = (e.target as HTMLElement).closest<HTMLElement>('[data-unloop]');
      if (stop) { this.setLoop(stop.dataset.unloop!, false); return; }
      host.openTab(b.dataset.kind as QueueKind);
    });
    this.footEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      host.sound('click');
      const act = b.dataset.act;
      if (act === 'idle') this.selectIdle();
      else if (act === 'damaged') this.selectDamaged();
      else if (act === 'repair') this.sendToRepair();
      else if (act === 'all') this.selectAll();
    });
    window.addEventListener('keydown', this.onKey, true);
    this.offSettings = onSettingsChanged((s) => { this.idle.enabled = s.hints; if (!s.hints) this.idle.clear(); });
    setBadgeText();
    this.offLang = onLanguageChange(() => {
      setBadgeText();
      this.unitsBtn.setAttribute('aria-label', tArmy('overview'));
      this.idleBtn.setAttribute('aria-label', tArmy('nextIdle'));
      this.panel.setAttribute('aria-label', tArmy('overview'));
      (this.headEl.querySelector('b') as HTMLElement).textContent = tArmy('title');
      this.headEl.querySelector('.ap-x')!.setAttribute('aria-label', tCommon('close'));
      this.chipKey = this.sumKey = this.prodKey = this.footKey = this.listKey = '';
    });
  }

  dispose() {
    if (live === this) live = null;
    window.removeEventListener('keydown', this.onKey, true);
    this.offSettings();
    this.offLang();
    this.panel.remove();
    const ov = this.host.overlay;
    if (ov && this.extraFn && ov.extra === this.extraFn) ov.extra = this.prevExtra; // (the order layer stays)
  }

  // ---------------------------------------------------------------------------
  // Frame update (called every HUD frame; the work is throttled)
  // ---------------------------------------------------------------------------
  update(dt: number) {
    this.chainOverlay();
    this.watchLoops();
    this.panelT -= dt;
    this.watchT -= dt;
    this.repairT -= dt;
    if (this.panelT <= 0) {
      this.panelT = 0.35;
      this.collect();
      this.updateChip();
      if (this.open) this.renderPanel();
    }
    if (this.watchT <= 0) {
      this.watchT = 0.5;
      if (!this.host.spectator) this.idle.update();
      for (const id of this.autoGroups.keys()) if (!this.host.world.getEntity(id)?.alive) this.autoGroups.delete(id);
    }
    if (this.repairT <= 0) {
      this.repairT = 0.3;
      this.runs.update();
    }
  }

  /** Sim events (game.ts forwards each one): new units join their factory's auto-group. */
  simEvent(ev: GameEvent) {
    if (ev.e !== 'produced' || ev.player !== this.host.local.id) return;
    const g = this.autoGroups.get(ev.building);
    if (g !== undefined) this.addToGroup(g, [ev.id]);
    const u = this.host.world.getEntity(ev.id);
    if (u instanceof Unit) this.idle.busy(u.kind as UnitKind);
  }

  /** Unit factory kinds whose tab should pulse ("factory idle"). */
  nagging(kind: QueueKind): boolean {
    return this.idle.nagging(kind);
  }

  /** Seconds the factory kind has been idle with money to spend (0 = busy). */
  idleFor(kind: QueueKind): number {
    return this.idle.idleFor(kind);
  }

  // ---------------------------------------------------------------------------
  // Repeat production
  // ---------------------------------------------------------------------------
  /**
   * Is the type looping, counting a loop command sent this tick that the sim hasn't run yet (commands apply on the
   * next tick: a quick second click must toggle back, not repeat the first).
   */
  looping(type: string): boolean {
    const pend = this.pendingLoop.get(type);
    if (pend && pend.tick === this.host.world.tick) return pend.on;
    return isLooping(this.host.local, type);
  }

  /** Toggle (or set) a loop on a unit type; returns false when it can't loop. */
  setLoop(type: string, on = !this.looping(type)): boolean {
    const { world, local: p } = this.host;
    if (this.host.spectator) return false;
    if (!on) {
      if (!this.looping(type)) return false;
      const b = loopFactory(world, p, type);
      this.userOff.add(type);
      this.pendingLoop.set(type, { on: false, tick: world.tick });
      this.host.issue({ c: 'repeat', player: p.id, building: b?.id ?? 0, type, on: false });
      this.host.message(tArmy('msg.loopOff', { name: tName(type) }));
      return true;
    }
    const b = loopFactory(world, p, type);
    if (!b) { this.host.sound('error'); return false; }
    this.pendingLoop.set(type, { on: true, tick: world.tick });
    this.host.issue({ c: 'repeat', player: p.id, building: b.id, type, on: true });
    const cost = priceOf(p, type); // price under Commander rules
    this.host.message(tArmy(p.credits < cost ? 'msg.loopOnWaiting' : 'msg.loopOn', { name: tName(type) }));
    return true;
  }

  /** A loop that ended without the player switching it off lost its factory or tech: say so. */
  private watchLoops() {
    const now = this.host.local.repeat;
    if (now.length === this.loopsSeen.length && now.every((t, i) => t === this.loopsSeen[i])) return;
    for (const t of this.loopsSeen) {
      if (now.includes(t)) continue;
      if (this.userOff.delete(t) || this.host.spectator) continue;
      this.host.message(tArmy('msg.loopStopped', { name: tName(t) }), true);
    }
    for (const t of now) this.userOff.delete(t);
    this.loopsSeen = [...now];
  }

  // ---------------------------------------------------------------------------
  // Auto-groups
  // ---------------------------------------------------------------------------
  /** Set (or with the same group again, clear) the auto-group of these own unit factories; null clears. */
  setAutoGroup(blds: Building[], g: number | null) {
    const facs = blds.filter((b) => b.alive && b.owner === this.host.local && b.bt.factory && b.bt.factory !== 'building');
    if (!facs.length || this.host.spectator) return false;
    const clear = g === null || facs.every((b) => this.autoGroups.get(b.id) === g);
    for (const b of facs) { if (clear) this.autoGroups.delete(b.id); else this.autoGroups.set(b.id, g!); }
    const names = [...new Set(facs.map((b) => typeName(b.bt)))].join(', ');
    if (clear) this.host.message(tArmy('msg.autoGroupOff', { names }));
    else {
      const kind = facs[0].bt.factory as UnitKind;
      const notPrimary = facs.length === 1 && !facs[0].primary && this.host.world.buildings.some((o) => o.alive && o.owner === this.host.local && o.bt.factory === kind && o.primary && o !== facs[0]);
      this.host.message(tArmy(notPrimary ? 'msg.autoGroupNotPrimary' : 'msg.autoGroup', { names, g: String(g) }));
    }
    this.host.sound('click');
    return true;
  }

  private addToGroup(g: number, ids: number[]) {
    const groups = this.host.getGroups?.();
    if (!groups) return;
    const w = this.host.world;
    for (const [k, list] of groups) if (k !== g && list.some((id) => ids.includes(id))) groups.set(k, list.filter((id) => !ids.includes(id)));
    const cur = (groups.get(g) ?? []).filter((id) => w.getEntity(id)?.alive);
    for (const id of ids) if (!cur.includes(id)) cur.push(id);
    groups.set(g, cur);
    const ov = this.host.overlay;
    if (ov) for (const id of ids) ov.groups.set(id, g);
  }

  /** Save-game state (auto-groups are UI state, so they ride in the save's `game` part). */
  saveState(): [number, number][] {
    return [...this.autoGroups.entries()];
  }
  loadState(s: unknown) {
    this.autoGroups.clear();
    if (!Array.isArray(s)) return;
    for (const e of s) if (Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1]) && e[1] >= 0 && e[1] <= 9) this.autoGroups.set(e[0], e[1]);
  }

  /** The overlay's extra layer: keep our factory badges chained after whatever is there (the order layer). */
  private chainOverlay() {
    const ov = this.host.overlay;
    if (!ov || (this.extraFn && ov.extra === this.extraFn)) return;
    const prev = ov.extra;
    this.prevExtra = prev;
    const fn: ExtraDraw = (ctx, project) => {
      const a = prev ? prev(ctx, project) : false;
      const b = this.drawBadges(ctx, project);
      return a || b;
    };
    this.extraFn = fn;
    ov.extra = fn;
  }

  private drawBadges(ctx: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => [number, number] | null): boolean {
    if (!this.autoGroups.size) return false;
    const w = this.host.world;
    let drawn = false;
    for (const [id, g] of this.autoGroups) {
      const b = w.getEntity(id);
      if (!(b instanceof Building) || !b.alive) continue;
      const p = project(b.x, w.map.surfaceAt(b.x, b.y) + 1.9, b.y);
      if (!p) continue;
      drawn = true;
      const [x, y] = p;
      ctx.save();
      ctx.font = '700 12px "Rajdhani", "Segoe UI", sans-serif';
      const label = `→ ${g}`;
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(6, 16, 26, 0.85)';
      ctx.strokeStyle = 'rgba(255, 211, 77, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, y - 9, tw, 18, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd34d';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + 0.5);
      ctx.restore();
    }
    return drawn;
  }

  // ---------------------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------------------
  private ownUnits(): Unit[] {
    const p = this.host.local;
    return this.host.world.units.filter((u) => selectableUnit(u) && u.owner === p);
  }

  private selectIds(ids: number[], add: boolean, none: 'msg.noDamaged' | 'msg.noIdle' | 'msg.noCombat' | 'msg.noIdleOfType' | 'msg.noOfType') {
    if (!ids.length) { this.host.message(tArmy(none)); return; }
    this.host.select(add ? [...new Set([...this.host.selection, ...ids])] : ids);
  }

  /** Shift+E: every damaged combat unit on the map. */
  selectDamaged() {
    const ids = this.ownUnits().filter((u) => isDamaged(u) && !u.ut.harvester && !u.ut.deploysInto).map((u) => u.id);
    this.selectIds(ids, false, 'msg.noDamaged');
    if (ids.length && !this.host.spectator) this.host.message(tArmy('msg.damagedSelected', { n: ids.length }));
  }

  selectIdle() {
    this.selectIds(this.ownUnits().filter(isIdle).map((u) => u.id), false, 'msg.noIdle');
  }

  selectAll() {
    this.selectIds(this.ownUnits().filter((u) => u.weapons.length && !u.ut.harvester).map((u) => u.id), false, 'msg.noCombat');
  }

  /** Next idle unit, centred (the I key does the same). */
  cycleIdle() {
    const idle = this.ownUnits().filter(isIdle).sort((a, b) => a.id - b.id);
    if (!idle.length) { this.host.message(tArmy('msg.noIdle')); return; }
    const next = idle.find((u) => u.id > this.idleCursor) ?? idle[0];
    this.idleCursor = next.id;
    this.host.select([next.id]);
    this.host.focusOn(next.x, next.y);
  }

  // ---------------------------------------------------------------------------
  // Repairs (RepairRuns below)
  // ---------------------------------------------------------------------------
  /** Damaged own vehicles / ships in the selection, and where they could be repaired. */
  repairable(ids: Iterable<number> = this.host.selection) {
    return this.runs.repairable(ids);
  }

  /** Shift+R: damaged vehicles queue up at the nearest service depot (one on the pad at a time), ships moor at a yard. */
  sendToRepair(ids: Iterable<number> = this.host.selection) {
    if (this.host.spectator) return;
    if (!this.runs.send(ids)) this.host.sound('error');
  }

  // ---------------------------------------------------------------------------
  // Army overview
  // ---------------------------------------------------------------------------
  toggle(open = !this.open) {
    this.open = open;
    if (open) {
      if (!this.panel.isConnected) this.uiRoot.appendChild(this.panel);
      this.panel.classList.add('on');
      this.collect();
      this.renderPanel();
    } else {
      this.panel.classList.remove('on');
      this.host.tip.hide();
    }
    this.unitsBtn.classList.toggle('active', open);
  }

  get isOpen() { return this.open; }

  private collect() {
    const p = this.host.local;
    const by = new Map<string, TypeStat>();
    for (const u of this.host.world.units) {
      if (!ownedBy(u, p)) continue;
      let s = by.get(u.ut.id);
      if (!s) {
        const k = u.kind === 'infantry' || u.kind === 'aircraft' || u.kind === 'naval' ? u.kind : 'vehicle';
        s = { type: u.ut.id, kind: k, ids: [], idle: [], damaged: 0, vet: 0, elite: 0, hp: 0, value: 0 };
        by.set(u.ut.id, s);
      }
      if (selectableUnit(u)) s.ids.push(u.id);
      if (isIdle(u) && selectableUnit(u)) s.idle.push(u.id);
      if (isDamaged(u)) s.damaged++;
      if (u.rank >= 2) s.elite++; else if (u.rank === 1) s.vet++;
      s.hp += u.healthFrac;
      s.value += u.ut.cost;
    }
    this.stats = [...by.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.value - a.value || a.type.localeCompare(b.type));
  }

  private totals() {
    let n = 0, value = 0, idle = 0, damaged = 0, vet = 0;
    const kinds: Record<UnitKind, number> = { infantry: 0, vehicle: 0, aircraft: 0, naval: 0 };
    for (const s of this.stats) {
      const c = s.ids.length || 0;
      n += c; value += s.value; idle += s.idle.length; damaged += s.damaged; vet += s.vet + s.elite;
      kinds[s.kind] += c;
    }
    return { n, value, idle, damaged, vet, kinds };
  }

  private updateChip() {
    const t = this.totals();
    const key = `${t.n}|${t.idle}|${t.value}|${t.kinds.infantry}|${t.kinds.vehicle}|${t.kinds.aircraft}|${t.kinds.naval}`;
    if (key === this.chipKey) return;
    this.chipKey = key;
    (this.unitsBtn.lastElementChild as HTMLElement).textContent = String(t.n);
    (this.idleBtn.lastElementChild as HTMLElement).textContent = String(t.idle);
    this.idleBtn.classList.toggle('has', t.idle > 0);
    const k = t.kinds;
    const blds = this.host.world.buildings.reduce((n, b) => n + (b.alive && b.owner === this.host.local && !b.bt.wall && !b.bt.mine ? 1 : 0), 0);
    const kinds = [tArmy.html('chip.infantry', { n: k.infantry }), tArmy.html('chip.vehicles', { n: k.vehicle })];
    if (k.aircraft) kinds.push(tArmy.html('chip.aircraft', { n: k.aircraft }));
    if (k.naval) kinds.push(tArmy.html('chip.ships', { n: k.naval }));
    this.unitsBtn.dataset.tip = tipHtml(tArmy.html('title'), `${tArmy.html('chip.worth', { n: t.n, money: money(t.value) })}<br>${kinds.join(' · ')}<br>${tArmy.html('chip.structures', { n: blds })}`,
      [[esc(keyLabel('army')) || '—', tArmy.html('chip.keyOverview')], [esc(keyLabel('selectCombat')) || '—', tArmy.html('chip.keyCombat')]]);
    this.idleBtn.dataset.tip = tipHtml(tArmy.html('chip.idleTitle'), t.idle ? tArmy.html('chip.idle', { n: t.idle }) : tArmy.html('chip.noIdle'),
      [[esc(keyLabel('nextIdle')) || '—', tArmy.html('chip.keyNextIdle')], [tArmy.html('chip.combo', { mod: tCommon('keys.shift'), key: keyLabel('nextIdle') || '—' }), tArmy.html('chip.keyIdleHarvester')]]);
    this.host.tip.refresh(this.unitsBtn, this.unitsBtn.dataset.tip);
    this.host.tip.refresh(this.idleBtn, this.idleBtn.dataset.tip);
  }

  private renderPanel() {
    const t = this.totals();
    const p = this.host.local;
    const tot = tArmy.html('panel.total', { n: t.n, money: money(t.value) });
    const totEl = this.headEl.querySelector('.ap-tot') as HTMLElement;
    if (totEl.innerHTML !== tot) totEl.innerHTML = tot;
    // summary chips
    const sumKey = `${t.n}|${t.idle}|${t.damaged}|${t.vet}|${Object.values(t.kinds).join(',')}`;
    if (sumKey !== this.sumKey) {
      this.sumKey = sumKey;
      const kinds = UNIT_KINDS.filter((k) => t.kinds[k] > 0 || k === 'infantry' || k === 'vehicle');
      this.sumEl.innerHTML = kinds.map((k) => `<span class="ap-k" data-tip="${esc(tipHtml(esc(kindTitle(k))))}">${KIND_ICON[k]}<b>${t.kinds[k]}</b></span>`).join('')
        + `<span class="ap-k vet" data-tip="${esc(tipHtml(tArmy.html('panel.veterans'), tArmy.html('panel.veteransTip')))}">${rankBadge(1)}<b>${t.vet}</b></span>`;
    }
    // production strip: every unit factory kind you own
    const facs = new Map<UnitKind, Building>();
    for (const b of this.host.world.buildings) {
      if (!b.alive || b.owner !== p || !b.active || !b.bt.factory || b.bt.factory === 'building') continue;
      const k = b.bt.factory as UnitKind;
      if (!facs.has(k) || b.primary) facs.set(k, b);
    }
    const prod: string[] = [];
    for (const k of UNIT_KINDS) {
      const f = facs.get(k);
      if (!f) continue;
      const q = p.queues[k];
      const loops = p.repeat.filter((id) => unitKind(id) === k);
      const head = q.items[0];
      const nag = this.nagging(k);
      const g = this.autoGroups.get(f.id);
      let st = head ? `${esc(tName(head.type))} <small>${Math.floor(head.progress * 100)}%</small>${q.items.length > 1 ? ` <small>+${q.items.length - 1}</small>` : ''}` : tArmy.html(nag ? 'fac.idle' : 'fac.ready');
      if (head?.paused) st = tArmy.html('fac.onHold');
      const click = tArmy.html('click');
      const loopHtml = loops.map((id) => `<span class="ap-loop" data-unloop="${esc(id)}" data-tip="${esc(tipHtml(tArmy.html('fac.loopTip', { name: tName(id) }), tArmy.html('fac.loopTipBody'), [[click, tArmy.html('fac.keyStopLoop')]]))}">${ICONS.cycle}${esc(shortName(id))}</span>`).join('');
      if (!head && loops.length) st = tArmy.html('fac.loopWaiting');
      const fname = typeName(f.bt);
      const facTip = (nag ? tArmy.html('fac.idleFor', { idle: SLOT, money: money(p.credits) }).replace(SLOT, `<span class="tt-bad">${tArmy.html('fac.idleSecs', { s: Math.floor(this.idleFor(k)) })}</span>`) : tArmy.html(head ? 'fac.producing' : 'fac.readyTip'))
        + (g !== undefined ? `<br>${tArmy.html('fac.group', { g: String(g) })}` : '');
      prod.push(`<button class="ap-pc${nag ? ' nag' : ''}${head ? ' busy' : ''}" data-kind="${k}" data-tip="${esc(tipHtml(esc(fname), facTip, [[click, tArmy.html('fac.keyOpenTab')]]))}">${KIND_ICON[k]}<span class="ap-fn">${esc(fname)}</span><span class="ap-st">${st}</span>${g !== undefined ? `<span class="ap-ag">→${g}</span>` : ''}${loopHtml}</button>`);
    }
    const prodHtml = prod.join('');
    if (prodHtml !== this.prodKey) { this.prodKey = prodHtml; this.prodEl.innerHTML = prodHtml; this.prodEl.style.display = prod.length ? '' : 'none'; }
    // rows by kind
    const listKey = this.stats.map((s) => s.type).join(',');
    if (listKey !== this.listKey) {
      this.listKey = listKey;
      this.listEl.innerHTML = '';
      this.rows.clear();
      let lastKind = '';
      for (const s of this.stats) {
        if (s.kind !== lastKind) {
          lastKind = s.kind;
          this.listEl.appendChild(el('div', 'ap-sec', `${KIND_ICON[s.kind]}<span>${esc(kindTitle(s.kind))}</span><i></i>`));
        }
        const img = this.host.thumbs.get(s.type);
        const row = el('button', 'ap-row', `<span class="ap-img">${img ? `<img src="${img}" alt="" draggable="false">` : KIND_ICON[s.kind]}</span><span class="ap-name">${esc(tName(s.type))}</span><span class="ap-cnt"></span><span class="ap-rank"></span><span class="ap-hp"><i></i></span><span class="ap-idle" data-act="idle"></span><span class="ap-v"></span>`);
        row.dataset.type = s.type;
        this.listEl.appendChild(row);
        this.rows.set(s.type, { el: row, cnt: row.querySelector('.ap-cnt')!, val: row.querySelector('.ap-v')!, rank: row.querySelector('.ap-rank')!, hp: row.querySelector('.ap-hp i')!, idle: row.querySelector('.ap-idle')!, key: '' });
      }
      if (!this.stats.length) this.listEl.appendChild(el('div', 'ap-empty', tArmy.html('panel.empty')));
    }
    for (const s of this.stats) {
      const r = this.rows.get(s.type);
      if (!r) continue;
      const n = s.ids.length;
      const hp = s.hp / Math.max(1, s.ids.length || 1);
      const key = `${n}|${s.idle.length}|${s.vet}|${s.elite}|${s.damaged}|${Math.round(hp * 50)}|${s.value}`;
      if (key === r.key) continue;
      r.key = key;
      r.cnt.textContent = `×${n}`;
      r.val.textContent = money(s.value);
      r.rank.innerHTML = (s.elite ? `<span class="e">${rankBadge(2)}${s.elite}</span>` : '') + (s.vet ? `<span class="v">${rankBadge(1)}${s.vet}</span>` : '');
      r.hp.style.width = `${(hp * 100).toFixed(0)}%`;
      r.hp.dataset.c = hp > 0.5 ? 'ok' : hp > 0.25 ? 'mid' : 'low';
      r.idle.innerHTML = s.idle.length ? `${ICONS.idle}${s.idle.length}` : '';
      r.idle.classList.toggle('on', s.idle.length > 0);
      r.el.dataset.tip = tipHtml(esc(tName(s.type)), `${tArmy.html('row.onField', { n })} · ${money(s.value)}${s.damaged ? ` · <span class="tt-bad">${tArmy.html('row.damaged', { n: s.damaged })}</span>` : ''}${s.idle.length ? ` · ${tArmy.html('row.idle', { n: s.idle.length })}` : ''}${s.vet + s.elite ? `<br>${tArmy.html('row.ranks', { vet: s.vet, elite: s.elite })}` : ''}`,
        [[tArmy.html('click'), tArmy.html('row.keySelect')], [esc(tCommon('keys.shift')), tArmy.html('row.keyAdd')], [tArmy.html('doubleClick'), tArmy.html('row.keyJump')], ['zZ', tArmy.html('row.keyIdle')]]);
      this.host.tip.refresh(r.el, r.el.dataset.tip);
    }
    // quick actions
    const { veh, ships } = this.repairable();
    const kE = esc(keyLabel('selectCombat')), kI = esc(keyLabel('nextIdle')), kDE = esc(keyLabel('selectDamaged')), kDR = esc(keyLabel('sendRepair')); // active bindings
    const shiftPlus = `${esc(tCommon('keys.shift'))} + `;
    const short = (k: string) => k.replace('Shift + ', '⇧').replace(shiftPlus, '⇧');
    const hk = tArmy.html('foot.hotkey');
    const nRep = veh.length + ships.length;
    const foot = `<button class="ap-act" data-act="all" data-tip="${esc(tipHtml(tArmy.html('foot.allTip'), '', kE ? [[kE, hk]] : []))}">${ICONS.target}<span>${tArmy.html('foot.all')}</span>${kE ? `<kbd>${short(kE)}</kbd>` : ''}</button>`
      + `<button class="ap-act${t.idle ? '' : ' off'}" data-act="idle" data-tip="${esc(tipHtml(tArmy.html('foot.idleTip'), tArmy.html('foot.idleTipBody'), kI ? [[kI, tArmy.html('foot.keyCycle')]] : []))}">${ICONS.idle}<span>${tArmy.html('foot.idle', { n: t.idle })}</span>${kI ? `<kbd>${short(kI)}</kbd>` : ''}</button>`
      + `<button class="ap-act${t.damaged ? '' : ' off'}" data-act="damaged" data-tip="${esc(tipHtml(tArmy.html('foot.damagedTip'), tArmy.html('foot.damagedTipBody'), kDE ? [[kDE, hk]] : []))}">${ICONS.shield}<span>${tArmy.html('foot.damaged', { n: t.damaged })}</span>${kDE ? `<kbd>${short(kDE)}</kbd>` : ''}</button>`
      + (this.host.spectator ? '' : `<button class="ap-act${nRep ? '' : ' off'}" data-act="repair" data-tip="${esc(tipHtml(tArmy.html('foot.repairTip'), tArmy.html('foot.repairTipBody'), kDR ? [[kDR, hk]] : []))}">${ICONS.wrench}<span>${nRep ? tArmy.html('foot.repairN', { n: nRep }) : tArmy.html('foot.repair')}</span>${kDR ? `<kbd>${short(kDR)}</kbd>` : ''}</button>`);
    if (foot !== this.footKey) { this.footKey = foot; this.footEl.innerHTML = foot; }
  }

  private onRowClick(e: MouseEvent) {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.ap-row');
    if (!row) return;
    const s = this.stats.find((x) => x.type === row.dataset.type);
    if (!s) return;
    this.host.sound('click');
    const idleOnly = !!(e.target as HTMLElement).closest('[data-act="idle"]');
    const ids = idleOnly ? s.idle : s.ids;
    const now = performance.now();
    const dbl = this.lastClick.type === s.type && now - this.lastClick.t < 350;
    this.lastClick = { t: now, type: s.type };
    this.selectIds(ids, e.shiftKey, idleOnly ? 'msg.noIdleOfType' : 'msg.noOfType');
    if (dbl && ids.length) {
      const w = this.host.world;
      let x = 0, y = 0, n = 0;
      for (const id of ids) { const u = w.getEntity(id); if (u) { x += u.x; y += u.y; n++; } }
      // the member nearest the middle (never empty ground)
      let best: Unit | null = null, bd = Infinity;
      for (const id of ids) { const u = w.getEntity(id) as Unit | undefined; if (!u) continue; const d = Math.hypot(u.x - x / n, u.y - y / n); if (d < bd) { bd = d; best = u; } }
      if (best) this.host.focusOn(bd < 4 ? x / n : best.x, bd < 4 ? y / n : best.y);
    }
  }

  // ---------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('.screen, .rv, .chx') || !this.chip.isConnected && !this.panel.isConnected) return;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    // hotkeys from the keymap (defaults: ` overview, Shift+E damaged, Shift+R repair run)
    if (isAction('army', e, { exactAlt: true })) { stop(); if (!e.repeat) this.toggle(); return; }
    if (e.key === 'Escape' && this.open) { stop(); this.toggle(false); return; }
    if (isAction('selectDamaged', e, { exactAlt: true, exactShift: true })) { stop(); this.selectDamaged(); return; }
    if (isAction('sendRepair', e, { exactAlt: true, exactShift: true })) {
      const units = [...this.host.selection].some((id) => { const u = this.host.world.getEntity(id); return u instanceof Unit && u.owner === this.host.local; });
      if (!units) return; // a structure selected: R / Shift+R keeps toggling its repairs
      stop();
      this.sendToRepair();
      return;
    }
    // auto-group: assign modifier (Ctrl) + N with only factories selected, plus Alt (Ctrl when Alt assigns) with anything
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1];
    const gm = groupMods();
    if (digit !== undefined && modHeld(e, gm.assign) && !modHeld(e, gm.add)) {
      const extra = gm.assign === 'alt' ? e.ctrlKey || e.metaKey : e.altKey;
      const w = this.host.world, me = this.host.local;
      const sel = [...this.host.selection].map((id) => w.getEntity(id)).filter((x) => x?.alive && x.owner === me);
      const facs = sel.filter((x): x is Building => x instanceof Building && !!x.bt.factory && x.bt.factory !== 'building');
      const units = sel.some((x) => x instanceof Unit);
      if (!facs.length || (units && !extra)) return;
      stop();
      if (!e.repeat) this.setAutoGroup(facs, +digit);
    }
  };
}

/** What the DOM-free helpers need from the game. */
export interface ArmyCore {
  world: World;
  local: Player;
  issue(cmd: Command): void;
  message(text: string, warn?: boolean): void;
}

/**
 * Idle watch: unit factories idle for IDLE_FACTORY_SECS while the player has money (and no loop saving up
 * for its next unit), idle harvesters and refineries without one. `nagging()` drives the tab pulse; toasts are
 * throttled per kind (2 min) and overall (30 s). Game time, so pausing or game speed don't fake idleness.
 */
export class IdleWatch {
  enabled = true;
  private state = new Map<UnitKind, { since: number; nag: boolean; toast: number }>();
  private lastToast = -1e9;
  private harvIdle = new Map<number, number>();
  private harvToast = -1e9;
  private refSince = -1;
  private refToast = -1e9;

  constructor(private host: ArmyCore) {}

  nagging(kind: QueueKind): boolean {
    return !!this.state.get(kind as UnitKind)?.nag;
  }
  idleFor(kind: QueueKind): number {
    const st = this.state.get(kind as UnitKind);
    return st && st.since >= 0 ? this.host.world.time - st.since : 0;
  }
  /** A unit came out of a factory of this kind: it is busy again. */
  busy(kind: UnitKind) {
    const st = this.state.get(kind);
    if (st) { st.since = -1; st.nag = false; }
  }
  clear() {
    for (const st of this.state.values()) { st.nag = false; st.since = -1; }
  }

  /** Run every half second or so. */
  update() {
    const { world: w, local: p } = this.host;
    if (!this.enabled || p.defeated || w.gameOver) { this.clear(); return; }
    const now = w.time;
    // cheapest unit buildable now per factory kind
    const cheapest = new Map<string, number>();
    for (const id of p.buildOptions()) {
      const k = unitKind(id);
      if (!k || UNITS[id].harvester) continue;
      cheapest.set(k, Math.min(cheapest.get(k) ?? Infinity, priceOf(p, id)));
    }
    const facNames = new Map<UnitKind, string>();
    for (const b of w.buildings) {
      if (!b.alive || b.owner !== p || !b.active || !b.bt.factory || b.bt.factory === 'building') continue;
      const k = b.bt.factory as UnitKind;
      if (!facNames.has(k) || b.primary) facNames.set(k, typeName(b.bt));
    }
    for (const kind of UNIT_KINDS) {
      let st = this.state.get(kind);
      if (!st) { st = { since: -1, nag: false, toast: -1e9 }; this.state.set(kind, st); }
      const min = cheapest.get(kind) ?? Infinity;
      // (a loop waiting for the money for its next unit is not idle: the player chose to save up)
      const looping = p.repeat.some((id) => unitKind(id) === kind);
      const idle = facNames.has(kind) && !looping && !p.queues[kind].items.length && min < Infinity && p.credits >= Math.max(min, IDLE_MIN_CREDITS);
      if (!idle) { st.since = -1; st.nag = false; continue; }
      if (st.since < 0) st.since = now;
      if (now - st.since < IDLE_FACTORY_SECS) continue;
      st.nag = true;
      if (now - st.toast >= TOAST_EVERY_KIND && now - this.lastToast >= TOAST_EVERY_ANY) {
        st.toast = this.lastToast = now;
        this.host.message(tArmy('msg.factoryIdle', { name: facNames.get(kind), money: money(p.credits) }));
      }
    }
    // harvesters standing idle, refineries without one
    let harv = 0, refineries = 0;
    for (const u of w.units) {
      if (!u.alive || u.owner !== p || !u.ut.harvester) continue;
      harv++;
      const idle = u.order.type === 'idle' || u.hstate === 'idle';
      if (!idle) { this.harvIdle.delete(u.id); continue; }
      const since = this.harvIdle.get(u.id) ?? now;
      this.harvIdle.set(u.id, since);
      if (now - since >= HARV_IDLE_SECS && now - this.harvToast >= 90 && now - this.lastToast >= TOAST_EVERY_ANY) {
        this.harvToast = this.lastToast = now;
        this.host.message(tArmy('msg.harvesterIdle', { name: typeName(u.ut) }), true);
      }
    }
    for (const id of this.harvIdle.keys()) if (!w.getEntity(id)?.alive) this.harvIdle.delete(id);
    for (const b of w.buildings) if (b.alive && b.owner === p && b.active && b.bt.dock) refineries++;
    if (refineries > harv && p.canBuild('harv')) {
      if (this.refSince < 0) this.refSince = now;
      if (now - this.refSince >= 15 && now - this.refToast >= 150 && now - this.lastToast >= TOAST_EVERY_ANY) {
        this.refToast = this.lastToast = now;
        this.host.message(tArmy('msg.noHarvester', { n: refineries - harv }), true);
      }
    } else this.refSince = -1;
  }
}

/**
 * Repair runs ("send damaged units for repairs"): damaged vehicles queue at the nearest service depot,
 * most damaged first. The queue waits at a staging spot beside the depot, one vehicle at a time drives onto the
 * pad, and a repaired one drives back to where it was sent from. Ships move next to the nearest naval yard
 * (yards repair every idle ship alongside). Only ordinary move / enter commands are issued, so replays record
 * them like any order; a unit the player gives another order leaves the run.
 */
export class RepairRuns {
  private jobs = new Map<number, RepairJob>();
  private tick = -1;

  constructor(private host: ArmyCore) {}

  get active(): number {
    let n = 0;
    for (const j of this.jobs.values()) n += j.queue.length + (j.active ? 1 : 0);
    return n;
  }

  /** Is this unit waiting for, or on, a depot pad? */
  has(id: number): boolean {
    for (const j of this.jobs.values()) if (j.active === id || j.queue.includes(id)) return true;
    return false;
  }

  /** Damaged own vehicles / ships among these ids, and where they could be repaired. */
  repairable(ids: Iterable<number>): { veh: Unit[]; ships: Unit[]; depots: Building[]; yards: Building[] } {
    const { world: w, local: p } = this.host;
    const veh: Unit[] = [], ships: Unit[] = [];
    for (const id of ids) {
      const u = w.getEntity(id);
      if (!(u instanceof Unit) || !u.alive || u.owner !== p || !isDamaged(u)) continue;
      if (u.kind === 'vehicle' && !u.ut.harvester) veh.push(u);
      else if (u.kind === 'naval') ships.push(u);
    }
    const depots: Building[] = [], yards: Building[] = [];
    for (const b of w.buildings) {
      if (!b.alive || b.owner !== p || !b.active) continue;
      if (b.bt.repairPad) depots.push(b);
      else if (b.bt.water && b.bt.factory === 'naval') yards.push(b);
    }
    return { veh, ships, depots, yards };
  }

  /** Send the damaged vehicles / ships among `ids` for repairs; returns how many are on their way. */
  send(ids: Iterable<number>): number {
    const { world: w, local: p } = this.host;
    const { veh, ships, depots, yards } = this.repairable(ids);
    if (!veh.length && !ships.length) { this.host.message(tArmy('msg.noRepairable')); return 0; }
    const near = (u: Unit, list: Building[]) => list.reduce<Building | null>((best, b) => (!best || b.distTo(u.x, u.y) < best.distTo(u.x, u.y) ? b : best), null);
    let sent = 0;
    if (veh.length && !depots.length) this.host.message(tArmy('msg.needDepot'), true);
    for (const u of depots.length ? veh : []) {
      if (this.has(u.id)) continue;
      const d = near(u, depots)!;
      let job = this.jobs.get(d.id);
      if (!job) {
        const st = w.findFreeSpot(d.x + 0.5, d.y + d.h / 2 + 2.2, 5);
        job = { depot: d.id, staging: st, queue: [], active: 0, since: 0, arrived: -1, lastHp: 0, healed: 0, home: new Map() };
        this.jobs.set(d.id, job);
      }
      job.queue.push(u.id);
      job.home.set(u.id, [u.x, u.y]);
      sent++;
    }
    // the most damaged go first
    for (const job of this.jobs.values()) {
      job.queue = job.queue.filter((id) => (w.getEntity(id) as Unit | undefined)?.alive)
        .sort((a, b) => (w.getEntity(a) as Unit).healthFrac - (w.getEntity(b) as Unit).healthFrac || a - b);
    }
    // ships: moor next to the nearest yard
    if (ships.length && !yards.length) this.host.message(tArmy('msg.needYard'), true);
    const byYard = new Map<Building, number[]>();
    for (const s of yards.length ? ships : []) { const y = near(s, yards)!; byYard.set(y, [...(byYard.get(y) ?? []), s.id]); }
    for (const [y, list] of byYard) { this.host.issue({ c: 'move', player: p.id, units: list, x: y.x, y: y.y }); sent += list.length; }
    // the queue moves up beside the depot; the first one drives onto the pad
    for (const job of this.jobs.values()) {
      const wait = job.queue.filter((id) => id !== job.active);
      if (wait.length) this.host.issue({ c: 'move', player: p.id, units: wait, x: job.staging[0], y: job.staging[1] });
    }
    this.tick = -1;
    this.update();
    if (sent) this.host.message(tArmy('msg.sent', { n: sent }));
    return sent;
  }

  /** Run a few times a second (it only acts when the world advanced). */
  update() {
    const { world: w, local: p } = this.host;
    if (!this.jobs.size || w.tick === this.tick) return; // nothing to do / paused
    this.tick = w.tick;
    const now = w.time;
    for (const [id, job] of this.jobs) {
      const d = w.getEntity(id);
      if (!(d instanceof Building) || !d.alive || d.owner !== p) { this.jobs.delete(id); continue; }
      const unit = (uid: number) => { const u = w.getEntity(uid); return u instanceof Unit && u.alive && u.owner === p ? u : null; };
      // waiting units the player has since sent elsewhere leave the queue
      const spread = 4 + Math.sqrt(job.queue.length) * 1.5; // (a big queue spreads out around the staging spot)
      job.queue = job.queue.filter((uid) => {
        const u = unit(uid);
        if (!u) return false;
        const o = u.order;
        if (o.type === 'idle' || o.type === 'guard') return true;
        return o.type === 'move' && Math.hypot(o.x - job.staging[0], o.y - job.staging[1]) < spread;
      });
      if (job.active) {
        const u = unit(job.active);
        const o = u?.order;
        const onPad = !!u && Math.hypot(u.x - d.x, u.y - d.y) < 1.2;
        if (!u) job.active = 0;
        else if (u.hp >= u.maxHp) {
          job.healed++;
          this.goHome(job, u);
          job.active = 0;
        } else if (o && !(o.type === 'enter' && o.target === d.id) && o.type !== 'idle') {
          job.active = 0; // the player took it over
        } else {
          if (onPad && job.arrived < 0) { job.arrived = now; job.lastHp = u.hp; }
          if (job.arrived >= 0 && u.hp > job.lastHp) { job.lastHp = u.hp; job.arrived = now; }
          // stuck on the pad (no money for repairs) or never got there: give up on it
          if ((job.arrived >= 0 && now - job.arrived > 12) || (job.arrived < 0 && now - job.since > 90)) { this.goHome(job, u); job.active = 0; }
        }
      }
      if (!job.active && job.queue.length) {
        const next = job.queue.shift()!;
        job.active = next;
        job.since = now;
        job.arrived = -1;
        this.host.issue({ c: 'enter', player: p.id, units: [next], target: d.id });
      }
      if (!job.active && !job.queue.length) {
        this.jobs.delete(id);
        if (job.healed) this.host.message(tArmy('msg.repaired', { n: job.healed }));
      }
    }
  }

  private goHome(job: RepairJob, u: Unit) {
    const home = job.home.get(u.id);
    job.home.delete(u.id);
    // off the pad: back to where it was sent from (or just clear of the depot)
    const [x, y] = home && Math.hypot(home[0] - u.x, home[1] - u.y) > 3 ? home : job.staging;
    this.host.issue({ c: 'move', player: this.host.local.id, units: [u.id], x, y });
  }
}

/** The production queue (factory kind) of a unit type. */
function unitKind(id: string): UnitKind | null {
  const t = UNITS[id];
  if (!t) return null;
  return t.kind === 'infantry' || t.kind === 'aircraft' || t.kind === 'naval' ? t.kind : 'vehicle';
}

/** The short name of a unit type on a loop chip (army.short.<id>, else its name). */
function shortName(id: string): string {
  const k = `${tArmy.ns}.short.${id}`;
  if (hasKey(k)) return tx(k);
  const t = UNITS[id] as UnitTypeDef | undefined;
  return t ? typeName(t) : id;
}

/** Marks where raw HTML goes into a translated .html() message (parameters are escaped). */
const SLOT = '\u0001';

/** A CSS string literal. */
const cssString = (s: string) => `"${s.replace(/["\\]/g, '\\$&').replace(/[\n\r]/g, ' ')}"`;
/** The badge words the styles draw (::after / ::before content) in the active language. */
function setBadgeText() {
  if (typeof document === 'undefined') return;
  const st = document.documentElement.style;
  st.setProperty('--ar-t-loop', cssString(tArmy('badge.loop')));
  st.setProperty('--ar-t-loopwait', cssString(tArmy('badge.loopWait')));
  st.setProperty('--ar-t-idle', cssString(tArmy('badge.idle')));
}

/** Styles of the army tools (injected once; styles.css stays untouched). */
function injectArmyStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.id = 'army-styles';
  st.textContent = `
/* army chip: unit count (opens the overview) + idle count (cycles) */
.ar-chip { display: inline-flex; align-items: stretch; gap: 0; padding: 0 !important; overflow: hidden; }
.ar-chip button { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0 0.55rem; min-height: 1.9rem; border: 0; background: transparent; color: var(--text, #dbe5ef); font: inherit; cursor: pointer; }
.ar-chip button:hover, .ar-chip button.active { background: rgba(var(--accent-rgb), 0.18); color: #fff; }
.ar-chip button b { font-family: var(--mono, monospace); font-weight: 400; }
.ar-chip .ar-idle { border-left: 1px solid rgba(255, 255, 255, 0.08); color: var(--muted, #8aa0b4); }
.ar-chip .ar-idle.has { color: #ffd34d; }
.ar-chip svg { width: 1em; height: 1em; }

/* army overview panel */
#army-panel { position: fixed; left: 0.7rem; top: calc(var(--tl-h, 3.2rem) + 0.7rem); z-index: 30; width: 28rem; max-width: calc(100vw - 1.4rem);
  max-height: calc(100vh - var(--tl-h, 3.2rem) - var(--dock-h, 9rem) - 2.2rem); min-height: 10rem; display: none; flex-direction: column; gap: 0.4rem; padding: 0.6rem 0.65rem; font-size: 0.8rem; }
#army-panel.on { display: flex; animation: arPanelIn 0.28s var(--spring, ease) both; }
@keyframes arPanelIn { from { opacity: 0; transform: translateX(-0.8rem); } to { opacity: 1; transform: none; } }
body.hud-modern #army-panel { top: calc(var(--tl-h, 9rem) + 0.6rem); max-height: calc(100vh - var(--tl-h, 9rem) - var(--dock-h, 12rem) - 1.6rem); }
body.reduce-motion #army-panel.on { animation: none; }
body.touch-ui #army-panel { left: 4.6rem; max-width: calc(100vw - 5.3rem); }
body.touch-ui .ap-row { min-height: 2.7rem; }
body.touch-ui .ap-act, body.touch-ui .ap-pc, body.touch-ui .ar-chip button { min-height: 2.4rem; }
.ap-head { display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; letter-spacing: 0.14em; text-transform: uppercase; }
.ap-head .ap-ic { color: var(--accent); display: inline-flex; }
.ap-head .ap-tot { margin-left: auto; letter-spacing: 0.02em; text-transform: none; color: var(--muted, #8aa0b4); }
.ap-head .ap-tot b { color: #fff; font-family: var(--mono, monospace); font-weight: 400; }
.ap-head .ap-tot b:last-child { color: var(--gold, #ffd34d); }
.ap-x { display: inline-flex; align-items: center; justify-content: center; width: 1.6rem; height: 1.6rem; border-radius: 0.3rem; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.25); color: var(--muted, #8aa0b4); cursor: pointer; }
.ap-x:hover { color: #fff; border-color: rgba(var(--accent-rgb), 0.6); }
.ap-sum { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.ap-k { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.12rem 0.45rem; border-radius: 1rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: var(--muted, #8aa0b4); }
.ap-k b { color: #fff; font-family: var(--mono, monospace); font-weight: 400; }
.ap-k.vet { color: #ffd34d; }
.ap-prod { display: flex; flex-direction: column; gap: 0.22rem; }
.ap-pc { display: flex; align-items: center; gap: 0.4rem; padding: 0.22rem 0.45rem; border-radius: 0.35rem; border: 1px solid rgba(255,255,255,0.07); background: rgba(0,0,0,0.22); color: var(--muted, #8aa0b4); font: inherit; cursor: pointer; text-align: left; min-height: 1.75rem; }
.ap-pc:hover { border-color: rgba(var(--accent-rgb), 0.55); color: #fff; }
.ap-pc .ap-fn { color: var(--text, #dbe5ef); font-weight: 600; min-width: 6.2rem; }
.ap-pc.busy .ap-st { color: var(--accent-hi, #b9e0ff); }
.ap-pc .ap-st small { color: var(--muted, #8aa0b4); }
.ap-pc.nag { border-color: rgba(255, 190, 70, 0.55); color: #ffc85a; animation: arNag 1.6s ease-in-out infinite; }
.ap-ag { margin-left: auto; padding: 0 0.3rem; border-radius: 0.25rem; border: 1px solid rgba(255, 211, 77, 0.7); color: #ffd34d; font-family: var(--mono, monospace); }
.ap-loop { display: inline-flex; align-items: center; gap: 0.18rem; padding: 0 0.35rem; border-radius: 1rem; background: rgba(var(--accent-rgb), 0.18); border: 1px solid rgba(var(--accent-rgb), 0.55); color: var(--accent-hi, #b9e0ff); font-size: 0.72rem; }
.ap-ag + .ap-loop, .ap-st + .ap-loop { margin-left: auto; }
.ap-loop:hover { border-color: #ff8a7a; color: #ffb4a8; text-decoration: line-through; }
.ap-list { flex: 1 1 auto; min-height: 3rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.18rem; padding-right: 0.15rem; overscroll-behavior: contain; }
.ap-sec { display: flex; align-items: center; gap: 0.35rem; margin-top: 0.3rem; color: var(--muted, #8aa0b4); font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase; }
.ap-sec i { flex: 1; height: 1px; background: linear-gradient(90deg, rgba(var(--accent-rgb), 0.45), transparent); }
.ap-row { display: grid; grid-template-columns: 2.3rem minmax(0, 1fr) 2.3rem 2.7rem 2.6rem 2.5rem 3.7rem; align-items: center; gap: 0.3rem; padding: 0.12rem 0.3rem; border-radius: 0.35rem;
  border: 1px solid transparent; background: rgba(255,255,255,0.03); color: var(--text, #dbe5ef); font: inherit; cursor: pointer; text-align: left; min-height: 2.1rem; }
.ap-row:hover, .ap-row:focus-visible { border-color: rgba(var(--accent-rgb), 0.6); background: rgba(var(--accent-rgb), 0.1); }
.ap-row:active { transform: scale(0.99); }
.ap-img { width: 2.3rem; height: 1.8rem; display: flex; align-items: center; justify-content: center; color: var(--muted, #8aa0b4); }
.ap-img img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.ap-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.ap-cnt { font-family: var(--mono, monospace); color: #fff; text-align: right; font-size: 0.9rem; }
.ap-rank { display: flex; gap: 0.2rem; color: #ffd34d; font-family: var(--mono, monospace); font-size: 0.7rem; }
.ap-rank span { display: inline-flex; align-items: center; gap: 0.05rem; }
.ap-rank .e { color: #ff9a4a; }
.ap-hp { height: 0.32rem; border-radius: 0.2rem; background: rgba(255,255,255,0.08); overflow: hidden; }
.ap-hp i { display: block; height: 100%; background: #4cd964; }
.ap-hp i[data-c='mid'] { background: #ffc93c; }
.ap-hp i[data-c='low'] { background: #ff4a3a; }
.ap-idle { display: inline-flex; align-items: center; gap: 0.12rem; justify-content: center; border-radius: 1rem; font-family: var(--mono, monospace); font-size: 0.7rem; color: #ffd34d; min-height: 1.3rem; }
.ap-idle.on { border: 1px solid rgba(255, 211, 77, 0.35); }
.ap-idle.on:hover { background: rgba(255, 211, 77, 0.2); }
.ap-v { font-family: var(--mono, monospace); color: var(--gold, #ffd34d); text-align: right; font-size: 0.74rem; }
.ap-empty { padding: 1rem 0.4rem; color: var(--muted, #8aa0b4); text-align: center; }
.ap-foot { display: flex; flex-wrap: wrap; gap: 0.3rem; padding-top: 0.35rem; border-top: 1px solid rgba(255,255,255,0.07); }
.ap-act { position: relative; display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.5rem; min-height: 1.9rem; border-radius: 0.35rem; border: 1px solid rgba(var(--accent-rgb), 0.35); background: rgba(var(--accent-rgb), 0.08); color: var(--text, #dbe5ef); font: inherit; cursor: pointer; }
.ap-act:hover { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.2); color: #fff; }
.ap-act.off { opacity: 0.45; }
.ap-act kbd { font-size: 0.6rem; padding: 0.02rem 0.2rem; color: var(--muted, #8aa0b4); background: rgba(0,0,0,0.3); border: 0; }
@keyframes arNag { 0%, 100% { box-shadow: 0 0 0 rgba(255, 190, 70, 0); } 50% { box-shadow: 0 0 0.7rem rgba(255, 190, 70, 0.45); } }

/* build cards: loop button (hover / touch) that becomes the loop badge */
.bi-loop { position: absolute; right: 0.22rem; top: 0.22rem; z-index: 4; height: 1.35rem; min-width: 1.35rem; display: flex; align-items: center; justify-content: center; gap: 0.15rem; padding: 0 0.22rem;
  border-radius: 0.7rem; border: 1px solid rgba(var(--accent-rgb), 0.55); background: rgba(4, 12, 20, 0.82); color: var(--accent-hi, #b9e0ff); cursor: pointer;
  opacity: 0; transform: scale(0.8); transition: opacity 0.15s, transform 0.2s; pointer-events: auto; font: 700 max(0.55rem, 8.5px) var(--font, 'Rajdhani', sans-serif); letter-spacing: 0.1em; text-transform: uppercase; }
.bi-loop svg { width: 0.85rem; height: 0.85rem; flex: none; }
.bi-count.on ~ .bi-loop { top: 1.55rem; }
.bitem[data-loop] .bi-new { display: none !important; }
.bitem:hover .bi-loop, .bi-loop:focus-visible { opacity: 0.9; transform: none; }
.bi-loop:hover { opacity: 1; border-color: var(--accent); background: rgba(var(--accent-rgb), 0.35); color: #fff; }
@media (pointer: coarse) { .bi-loop { opacity: 0.75; transform: none; } }
.bitem[data-loop] .bi-loop { opacity: 1; transform: none; background: var(--accent); border-color: rgba(255, 255, 255, 0.85); color: #02101e; box-shadow: 0 0 0.6rem rgba(var(--accent-rgb), 0.9); }
.bitem[data-loop] .bi-loop::after { content: var(--ar-t-loop, 'Loop'); padding-right: 0.1rem; }
.bitem[data-loop='wait'] .bi-loop { background: #ffc93c; box-shadow: 0 0 0.6rem rgba(255, 201, 60, 0.8); }
.bitem[data-loop='wait'] .bi-loop::after { content: var(--ar-t-loopwait, 'Loop $'); }
.bitem[data-loop='on'] .bi-loop svg { animation: arSpin 2.4s linear infinite; }
.bitem[data-loop] .bi-tilt { border-color: rgba(var(--accent-rgb), 0.8); box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.35); }
body.reduce-motion .bitem[data-loop] .bi-loop svg { animation: none; }
@keyframes arSpin { to { transform: rotate(360deg); } }

/* build tabs: loop marker and the "factory idle" pulse */
.tab .tab-loop { position: absolute; left: 0.18rem; bottom: 0.15rem; display: none; color: var(--accent-hi, #b9e0ff); }
.tab .tab-loop svg { width: 0.7rem; height: 0.7rem; }
.tab.has-loop .tab-loop { display: inline-flex; }
.tab.idle-nag { box-shadow: inset 0 0 0 1px rgba(255, 190, 70, 0.55); animation: arTabNag 1.8s ease-in-out infinite; }
.tab.idle-nag::before { content: var(--ar-t-idle, 'idle'); position: absolute; right: 0.2rem; bottom: 0.1rem; font: 700 0.5rem var(--font, sans-serif); letter-spacing: 0.1em; text-transform: uppercase; color: #ffc85a; pointer-events: none; }
body.reduce-motion .tab.idle-nag, body.reduce-motion .ap-pc.nag { animation: none; }
@keyframes arTabNag { 0%, 100% { background-color: transparent; } 50% { background-color: rgba(255, 190, 70, 0.14); } }
.cat-status.idle { color: #ffc85a; }

/* selection panel: per-factory auto-group picker, multi-selection summary */
.ag-pick { display: flex; flex-wrap: wrap; gap: 0.2rem; align-items: center; margin-top: 0.3rem; }
.ag-pick .ag-l { color: var(--muted, #8aa0b4); font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; margin-right: 0.2rem; }
.ag-pick button { min-width: 1.5rem; height: 1.45rem; padding: 0 0.3rem; border-radius: 0.25rem; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); color: var(--muted, #8aa0b4); font: inherit; font-size: 0.75rem; cursor: pointer; }
.ag-pick button:hover { color: #fff; border-color: rgba(var(--accent-rgb), 0.6); }
.ag-pick button.on { color: #02101e; background: #ffd34d; border-color: #ffd34d; }
.spm-head .spm-val { color: var(--gold, #ffd34d); font-family: var(--mono, monospace); }
.spm-head .spm-dmg { color: #ff8a7a; cursor: pointer; border-bottom: 1px dotted currentColor; }
.cmd.off { opacity: 0.45; }
.loop-line { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; margin-top: 0.25rem; color: var(--muted, #8aa0b4); font-size: 0.72rem; }
`;
  document.head.appendChild(st);
}
