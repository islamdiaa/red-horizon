import * as THREE from 'three';
import { BUILDINGS, getType } from '../data/rules';
import { wallLine } from '../sim/world';
import { lerp } from '../core/util';
import { Building, Entity, Unit } from '../sim/entities';
import type { Player } from '../sim/player';
import { SUPER_TARGET, type SuperKind } from '../sim/superweapons';
import type { Command, FormationShape, Stance } from '../sim/types';
import type { PlacementIssue, World } from '../sim/world';
import type { GameRenderer } from '../render/renderer';
import type { EntityRenderer } from '../render/entities';
import type { Overlay } from '../render/overlay';
import type { PlacementGhost } from '../render/placement';
import type { Effects } from '../render/effects';
import type { AudioSystem } from '../audio';
import type { VoiceKind } from '../audio/types';
import type { TargetReticle } from '../render/reticle';
import { bridgeAtCell } from '../sim/bridges';
import { disguisedAs } from '../sim/infiltration';
import { canCarry } from '../sim/naval';
import { pickWeapon } from '../sim/combat';
import { FORMATION_SHAPES } from '../sim/formation';
import { chronoTarget } from '../sim/aftermath';
import { T } from '../sim/map';
import { canGarrison } from '../sim/economy'; // Commander economy: bunkers
import { toggleFullscreen } from '../platform/fullscreen';
import { FORMATION_INFO, OrderViz, injectCtrlStyles } from './orderui';
import { TouchController } from './touch';
import { attachGamepad, gamepadFrame } from './gamepad';
import { visualScale } from '../render/scale';
import { ACTION_COMMAND, isAction, isHeld, keyLabel, lookup, eventBase, modHeld, groupMods, type ActionId } from './keymap';
import { BATTLE_TEXT, fmt } from './a11y-strings';
import tControls from '../i18n/en/controls';
import tHud from '../i18n/en/hud';
import { typeName } from '../i18n/names';

export type Mode = 'normal' | 'place' | 'sell' | 'repair' | 'attackMove' | 'attackGround' | 'super' | 'layMines'
  /** click patrol waypoints (Shift: more) / click a unit or structure to guard / click to plan a structure. */
  | 'patrol' | 'guard' | 'plan'
  /** Chrono Tank: click where to chronoshift (D). */
  | 'chrono'
  /** Aim a commander power (ui/commander.ts): click the target point / structure. */
  | 'aim';

/** A ground-aimed action started from outside the input layer (commander powers, ui/commander.ts). */
export interface AimRequest {
  /** Reticle radius (cells) and colour. */
  r: number;
  color: number;
  /** Shown when aiming starts. */
  label: string;
  /** Map point picked (and the entity under the pointer). Return false to keep aiming (invalid target). */
  onTarget(x: number, y: number, picked: Entity | null): boolean | void;
}

/** A pointer position with modifier keys: a PointerEvent, or synthesised by touch and gamepad input. */
export interface PtrLike {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** Units the player can click or box-select: not support planes (Badger, U2), not still under a parachute. */
export function selectableUnit(u: Unit): boolean {
  return u.alive && !u.ut.supportPlane && !(u.parachute > 0) && !u.transport;
}

/** Targeting reticle per superweapon / support power: affected radius (cells) and colour. */
export const SUPER_RETICLE: Record<SuperKind, { r: number; color: number }> = {
  nuke: { r: 4.5, color: 0xff3a1a }, ironcurtain: { r: 1.8, color: 0xff2050 }, chrono: { r: 0.9, color: 0x30e0ff },
  gps: { r: 0, color: 0x40ff90 }, sonar: { r: 0, color: 0x40c8ff }, spyplane: { r: 6, color: 0x7dffb0 },
  paratroopers: { r: 2.5, color: 0xf0f4ff }, parabombs: { r: 3.5, color: 0xff8a30 },
};

/** Stance hotkeys (default F1–F4; rebindable in ui/keymap.ts). */
export const STANCE_KEYS: Record<string, Stance> = { f1: 'aggressive', f2: 'guard', f3: 'hold', f4: 'passive' };
const STANCE_ACTIONS: [ActionId, Stance][] = [['stanceAggressive', 'aggressive'], ['stanceGuard', 'guard'], ['stanceHold', 'hold'], ['stancePassive', 'passive']];
/** A stance's name in the interface language. */
export const stanceName = (s: Stance): string => tHud(`stance.${s}.title`);

/** Camera bookmarks (default F6–F9): the key jumps, Ctrl / Shift + the key stores. */
const BOOKMARK_ACTIONS: ActionId[] = ['bookmark1', 'bookmark2', 'bookmark3', 'bookmark4'];
/** Idle, formation and the single-key commands that go through keyCommand (stances, bookmarks and groups are separate). */
const KEY_ACTIONS = ['nextIdle', 'formation', ...Object.keys(ACTION_COMMAND)] as ActionId[];

export interface InputHost {
  world: World;
  local: Player;
  gfx: GameRenderer;
  ents: EntityRenderer;
  overlay: Overlay;
  placement: PlacementGhost;
  effects: Effects;
  audio: AudioSystem;
  selection: Set<number>;
  alpha: number;
  reticle?: TargetReticle;
  issue(cmd: Command): void;
  message(text: string, warn?: boolean): void;
  openPauseMenu(): void;
  paused: boolean;
  /** Step the game speed up (+1) or down (-1) through GAME_SPEEDS. */
  stepSpeed?(dir: 1 | -1): void;
}

const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3();
const _proj: [number, number, number] = [0, 0, 0];
const _ndc = new THREE.Vector2();

export function voiceOf(u: Unit): VoiceKind {
  const t = u.ut;
  if (t.dog) return 'dog';
  if (t.hero) return 'tanya';
  if (t.engineer) return 'engineer';
  if (t.medic) return 'medic';
  if (t.harvester) return 'harvester';
  if (t.id === 'spy' || t.id === 'thf') return 'spy';
  if (t.id === 'mech') return 'mechanic';
  if (t.id === 'shok') return 'shock';
  if (u.kind === 'aircraft') return 'aircraft';
  if (u.kind === 'naval') return 'naval';
  return u.kind === 'infantry' ? 'infantry' : 'vehicle';
}

const isGroundUnit = (u: Unit) => u.kind === 'infantry' || u.kind === 'vehicle';

export class InputController {
  mode: Mode = 'normal';
  placeType: string | null = null;
  superKind: SuperKind | null = null;
  /** Commander power being aimed (mode 'aim'). */
  aim: AimRequest | null = null;
  groups = new Map<number, number[]>();
  mouseX = window.innerWidth / 2;
  mouseY = window.innerHeight / 2;
  private hasMoved = false;
  groundX = 0;
  groundY = 0;
  hovered = 0;
  private keys = new Set<string>();
  private leftDown: { x: number; y: number } | null = null;
  private rightDown: { x: number; y: number; moved: boolean } | null = null;
  private middleDown: { x: number; y: number } | null = null;
  private lastClick = { t: 0, id: 0 };
  private lastGroupTap = { t: 0, g: -1 };
  private pointerInside = false;
  /** Edge the pointer left the window through (-1/0/1 per axis): keep scrolling that way until it comes back. */
  private exitX = 0;
  private exitY = 0;
  private wallStart: [number, number] | null = null;
  private canvas: HTMLCanvasElement;
  private disposers: (() => void)[] = [];
  edgeScroll = true;
  unitVoices = true;
  /** Replay spectator: select and look around, but no orders. */
  spectator = false;
  /** Camera follows the selection (F). */
  follow = false;
  private idleCursor = 0;
  /** Patrol waypoints placed so far (patrol mode). */
  patrolPts: [number, number][] = [];
  /** Plan-mode ghost is on a plannable spot. */
  planOk = false;
  /** Camera bookmarks (slots 0–3, default keys F6–F9): x, y, zoom, yaw. */
  bookmarks = new Map<number, [number, number, number, number]>();
  readonly touch: TouchController;
  private viz: OrderViz;
  /** Timestamp of the touch tap being handled (double taps are timed on event timestamps). */
  tapTime = 0;
  /** Camera pan from a gamepad's right stick (-1..1 per axis). */
  padPan: [number, number] = [0, 0];

  constructor(private h: InputHost) {
    this.canvas = h.gfx.canvas;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.disposers.push(() => t.removeEventListener(type, fn, opts));
    };
    on(this.canvas, 'pointerdown', (e: PointerEvent) => this.onDown(e));
    on(window, 'pointermove', (e: PointerEvent) => this.onMove(e));
    on(window, 'pointerup', (e: PointerEvent) => this.onUp(e));
    on(window, 'pointercancel', (e: PointerEvent) => { if (e.pointerType === 'touch') this.touch.cancel(e); });
    on(this.canvas, 'contextmenu', (e: Event) => e.preventDefault());
    // (deltaMode 1: lines, 2: pages, e.g. Windows' "one screen at a time" wheel setting)
    on(this.canvas, 'wheel', (e: WheelEvent) => { e.preventDefault(); this.h.gfx.cam.zoomBy(e.deltaY * (e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 600 : 1)); }, { passive: false });
    on(this.canvas, 'pointerenter', () => { this.pointerInside = true; });
    on(document, 'pointerleave', () => {
      // in a browser window the pointer easily overshoots the edge; remember which way it went
      this.pointerInside = false;
      const zone = 64;
      this.exitX = this.mouseX < zone ? -1 : this.mouseX > window.innerWidth - zone ? 1 : 0;
      this.exitY = this.mouseY < zone ? -1 : this.mouseY > window.innerHeight - zone ? 1 : 0;
    });
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e, true));
    on(window, 'keyup', (e: KeyboardEvent) => this.onKey(e, false));
    on(window, 'blur', () => { this.keys.clear(); this.exitX = this.exitY = 0; });
    // order layer, touch and gamepad
    injectCtrlStyles();
    const self = this;
    this.viz = new OrderViz({
      get world() { return self.h.world; }, get local() { return self.h.local; }, get selection() { return self.h.selection; },
      get alpha() { return self.h.alpha; }, get mode() { return self.mode; }, get placeType() { return self.placeType; },
      get patrolPts() { return self.patrolPts; }, get groundX() { return self.groundX; }, get groundY() { return self.groundY; },
      get planOk() { return self.planOk; },
    });
    h.overlay.extra = (ctx, project) => this.viz.draw(ctx, project);
    this.touch = new TouchController(this, h);
    this.disposers.push(() => this.touch.dispose());
    this.disposers.push(attachGamepad(this, h));
  }

  dispose() {
    for (const d of this.disposers) d();
    if (this.h.overlay.extra) this.h.overlay.extra = null;
  }

  /** Switch the player whose units are "own" (replay player-view switch). */
  setLocal(p: Player) {
    this.h.local = p;
    this.h.selection.clear();
    this.setMode('normal');
  }

  // ---------------------------------------------------------------------------
  // Picking
  // ---------------------------------------------------------------------------
  screenToGround(sx: number, sy: number): [number, number] {
    const cam = this.h.gfx.cam.camera;
    _ndc.set((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    _ray.setFromCamera(_ndc, cam);
    const o = _ray.ray.origin, d = _ray.ray.direction;
    const map = this.h.world.map;
    let hgt = 0, x = o.x, z = o.z;
    for (let i = 0; i < 5; i++) {
      if (Math.abs(d.y) < 1e-4) break;
      const t = (hgt - o.y) / d.y;
      x = o.x + d.x * t;
      z = o.z + d.z * t;
      hgt = map.surfaceAt(Math.max(0, Math.min(map.w, x)), Math.max(0, Math.min(map.h, z)));
    }
    return [x, z];
  }

  /** Screen position and depth of a world point; the tuple is reused (callers destructure it at once: hover picks every frame). */
  private project(x: number, y: number, z: number): readonly [number, number, number] {
    _v.set(x, y, z).project(this.h.gfx.cam.camera);
    _proj[0] = (_v.x * 0.5 + 0.5) * window.innerWidth;
    _proj[1] = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    _proj[2] = _v.z;
    return _proj;
  }

  /** Entity under a screen point. `slack` widens the unit hit radius (fingers are less precise than mice). */
  pickAt(sx: number, sy: number, slack = 1): Entity | null {
    const { world, ents } = this.h;
    const map = world.map;
    const cam = this.h.gfx.cam.camera;
    const focal = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    let best: Entity | null = null, bestD = Infinity;
    const a = this.h.alpha;
    for (const u of world.units) {
      if (!selectableUnit(u) || !ents.isShown(u.id)) continue;
      const x = lerp(u.prevX, u.x, a), y = lerp(u.prevY, u.y, a);
      const top = ents.topOf(u.id);
      const wy = map.surfaceAt(x, y) + top * 0.5 + (u.kind === 'aircraft' ? u.altitude : 0);
      const [px, py] = this.project(x, wy, y);
      const depth = cam.position.distanceTo(_v.set(x, wy, y));
      const rpx = Math.max(10 * slack, (u.ut.radius * visualScale(u.kind, u.type.id) * 1.5 + 0.1) * focal / depth * slack); // units are drawn larger than their sim radius
      const d = Math.hypot(px - sx, py - sy);
      if (d < rpx && d < bestD) { bestD = d; best = u; }
    }
    if (best) return best;
    const [gx, gy] = this.screenToGround(sx, sy);
    const cx = Math.floor(gx), cy = Math.floor(gy);
    if (map.inBounds(cx, cy)) {
      const id = map.occupant[map.idx(cx, cy)];
      const b = id ? world.getEntity(id) : undefined;
      if (b && b.alive && ents.isShown(b.id) && !(b instanceof Building && b.bt.mine)) return b;
    }
    // tall structures: screen-space box test
    for (const b of world.buildings) {
      if (!b.alive || !ents.isShown(b.id) || b.bt.mine) continue;
      const top = ents.topOf(b.id);
      const g = map.heightAt(b.x, b.y);
      const [x0, y0] = this.project(b.cx, g, b.cy + b.h);
      const [x1] = this.project(b.cx + b.w, g, b.cy + b.h);
      const [, yt] = this.project(b.x, g + top, b.y);
      if (sx >= Math.min(x0, x1) && sx <= Math.max(x0, x1) && sy >= yt && sy <= y0) return b;
    }
    return null;
  }

  /** Width of the right-hand sidebar (it scales with the viewport), so "on screen" means the map area. */
  /** Width of the sidebar; measured on resize only (reading offsetWidth every frame forces a layout). */
  private sidebarW(): number {
    if (document.body.classList.contains('hud-modern')) return 0; // the Modern layout floats over the map: the whole width is "on screen"
    if (this.sidebarWidth < 0) {
      const el = document.getElementById('sidebar');
      if (!el) return 312;
      this.sidebarWidth = el.offsetWidth;
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => { this.sidebarWidth = el.offsetWidth; });
        ro.observe(el);
        this.disposers.push(() => ro.disconnect());
      }
    }
    return this.sidebarWidth;
  }
  private sidebarWidth = -1;

  /** Ground polygon visible on screen (for the minimap). */
  viewPolygon(): [number, number][] {
    const w = window.innerWidth - this.sidebarW(), hh = window.innerHeight;
    return [this.screenToGround(0, 0), this.screenToGround(w, 0), this.screenToGround(w, hh), this.screenToGround(0, hh)];
  }

  // ---------------------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------------------
  ownSelectedUnits(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.h.selection) {
      const e = this.h.world.getEntity(id);
      if (e instanceof Unit && e.alive && e.owner === this.h.local) out.push(e);
    }
    return out;
  }

  ownSelectedBuildings(): Building[] {
    const out: Building[] = [];
    for (const id of this.h.selection) {
      const e = this.h.world.getEntity(id);
      if (e instanceof Building && e.alive && e.owner === this.h.local) out.push(e);
    }
    return out;
  }

  select(ids: number[], add = false) {
    const sel = this.h.selection;
    if (!add) sel.clear();
    for (const id of ids) sel.add(id);
    const units = this.ownSelectedUnits();
    if (units.length) this.voice('select', voiceOf(units[0]));
    else if (this.ownSelectedBuildings().length) this.h.audio.play('click');
  }

  /** Box select (Shift: add, Ctrl: remove from the selection). */
  boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean, remove = false) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const map = this.h.world.map;
    const a = this.h.alpha;
    let hits: Unit[] = [];
    for (const u of this.h.world.units) {
      if (!selectableUnit(u) || u.owner !== this.h.local) continue;
      const x = lerp(u.prevX, u.x, a), y = lerp(u.prevY, u.y, a);
      const [px, py] = this.project(x, map.surfaceAt(x, y) + 0.2, y);
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) hits.push(u);
    }
    if (remove) {
      for (const u of hits) this.h.selection.delete(u.id);
      return;
    }
    // prefer combat units over harvesters / MCVs when mixed
    const combat = hits.filter((u) => !u.ut.harvester && !u.ut.deploysInto);
    if (combat.length) hits = combat;
    if (hits.length) this.select(hits.map((u) => u.id), add);
    else if (!add) this.h.selection.clear();
  }

  private onScreen(x: number, y: number): boolean {
    const W = window.innerWidth - this.sidebarW(), H = window.innerHeight;
    const [px, py] = this.project(x, this.h.world.map.surfaceAt(x, y), y);
    return px >= 0 && px <= W && py >= 0 && py <= H;
  }

  private selectSameTypeOnScreen(types: string | Set<string>, add = false) {
    const want = typeof types === 'string' ? new Set([types]) : types;
    const ids: number[] = [];
    for (const u of this.h.world.units) {
      if (!selectableUnit(u) || u.owner !== this.h.local || !want.has(u.ut.id)) continue;
      if (this.onScreen(u.x, u.y)) ids.push(u.id);
    }
    if (ids.length) this.select(ids, add);
  }

  /** Double-click a structure: every own structure of that type on screen (e.g. all barracks to set a rally point). */
  private selectSameBuildingsOnScreen(type: string, add = false) {
    const ids: number[] = [];
    for (const b of this.h.world.buildings) {
      if (b.alive && b.owner === this.h.local && b.bt.id === type && this.onScreen(b.x, b.y)) ids.push(b.id);
    }
    if (ids.length) this.select(ids, add);
  }

  /** Who an entity appears to belong to for this player (a disguised spy passes for the player it mimics). */
  private apparentOwner(e: Entity): Player {
    return (e instanceof Unit ? disguisedAs(this.h.world, e, this.h.local)?.owner : undefined) ?? e.owner;
  }

  /** A destroyed bridge whose gap (or either landing) is at this ground point. */
  private destroyedBridgeAt(gx: number, gy: number): { id: number } | null {
    const w = this.h.world as World & { bridges?: { id: number; alive: boolean; ends: [number, number][] }[] };
    if (!w.bridges?.length) return null;
    const cx = Math.floor(gx), cy = Math.floor(gy);
    const b = bridgeAtCell(this.h.world, cx, cy);
    if (b && !b.alive) return b;
    return w.bridges.find((br) => !br.alive && br.ends.some(([x, y]) => x === cx && y === cy)) ?? null;
  }

  /** Ctrl+A: every own unit on screen (combat units preferred over harvesters / MCVs, like box select). */
  selectOnScreen() {
    let hits: Unit[] = [];
    for (const u of this.h.world.units) {
      if (!selectableUnit(u) || u.owner !== this.h.local) continue;
      if (this.onScreen(u.x, u.y)) hits.push(u);
    }
    const combat = hits.filter((u) => !u.ut.harvester && !u.ut.deploysInto);
    if (combat.length) hits = combat;
    if (hits.length) this.select(hits.map((u) => u.id));
  }

  /** I: select and centre the next idle unit (Shift: idle harvesters). */
  cycleIdle(harvesters: boolean) {
    const idle = this.h.world.units.filter((u) => {
      if (!selectableUnit(u) || u.owner !== this.h.local || !!u.ut.harvester !== harvesters) return false;
      if (harvesters) return u.order.type === 'idle' || u.hstate === 'idle';
      return u.order.type === 'idle' || u.order.type === 'guard';
    }).sort((a, b) => a.id - b.id);
    if (!idle.length) {
      this.h.message(tControls(harvesters ? 'msg.noIdleHarvesters' : 'msg.noIdleUnits'));
      return;
    }
    const next = idle.find((u) => u.id > this.idleCursor) ?? idle[0];
    this.idleCursor = next.id;
    this.select([next.id]);
    this.h.gfx.cam.flyToPoint(next.x, next.y);
  }

  /** F1–F4: set the stance of the selected own combat units. */
  setStance(stance: Stance) {
    if (this.spectator) return;
    const ids = this.ownSelectedUnits().filter((u) => u.weapons.length).map((u) => u.id);
    if (!ids.length) return;
    this.h.issue({ c: 'stance', player: this.h.local.id, units: ids, stance });
    this.h.message(tHud('stances.set', { name: stanceName(stance) }));
    this.h.audio.play('click');
  }

  /** Formation of the selected ground units (they form up on the spot when idle). */
  setFormation(shape: FormationShape) {
    if (this.spectator) return;
    const ids = this.ownSelectedUnits().filter(isGroundUnit).map((u) => u.id);
    if (ids.length < 2) { this.h.message(tControls('msg.formationNeedTwo')); return; }
    this.h.issue({ c: 'formation', player: this.h.local.id, units: ids, shape });
    this.h.message(tHud('formations.set', { name: FORMATION_INFO.find((f) => f.id === shape)?.title ?? shape }));
    this.h.audio.play('click');
  }

  /** L: next formation (Shift: previous). */
  cycleFormation(dir = 1) {
    const units = this.ownSelectedUnits().filter(isGroundUnit);
    if (!units.length) return;
    const cur = units[0].formShape ?? 'none';
    const i = FORMATION_SHAPES.indexOf(cur);
    this.setFormation(FORMATION_SHAPES[(i + dir + FORMATION_SHAPES.length) % FORMATION_SHAPES.length]);
  }

  /** Recall control group g (add: to the selection); a quick second recall centres the camera on it. */
  recallGroup(g: number, add = false) {
    const ids = (this.groups.get(g) ?? []).filter((id) => this.h.world.getEntity(id)?.alive);
    if (!ids.length) return;
    const now = performance.now();
    if (this.lastGroupTap.g === g && now - this.lastGroupTap.t < 350) this.centreOn(ids);
    this.lastGroupTap = { t: now, g };
    this.select(ids, add);
  }

  /** Fly to the middle of a group of entities (the member nearest the middle, so never empty ground). */
  centreOn(ids: number[]) {
    const es = ids.map((id) => this.h.world.getEntity(id)).filter((e): e is Entity => !!e?.alive);
    if (!es.length) return;
    let x = 0, y = 0;
    for (const e of es) { x += e.x; y += e.y; }
    x /= es.length; y /= es.length;
    let best = es[0], bd = Infinity;
    for (const e of es) { const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } }
    this.h.gfx.cam.flyToPoint(bd < 4 ? x : best.x, bd < 4 ? y : best.y);
  }

  /** Ctrl+N: assign / Shift+N: add the selected units to group g. */
  assignGroup(g: number, add: boolean) {
    const ids = this.ownSelectedUnits().map((u) => u.id);
    if (!ids.length) return;
    const ov = this.h.overlay.groups;
    let members = ids;
    if (add) members = [...new Set([...(this.groups.get(g) ?? []).filter((id) => this.h.world.getEntity(id)?.alive), ...ids])];
    else for (const [id, gg] of ov) if (gg === g) ov.delete(id);
    // a unit belongs to one group: take these units out of the other groups
    for (const [k2, list] of this.groups) if (k2 !== g) this.groups.set(k2, list.filter((id) => !ids.includes(id)));
    this.groups.set(g, members);
    for (const id of members) ov.set(id, g);
    this.h.message(add ? tControls('msg.groupAdded', { g, n: members.length }) : tControls('msg.groupAssigned', { g }));
  }

  // ---------------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------------
  setMode(m: Mode) {
    this.mode = m;
    this.wallStart = null;
    this.patrolPts.length = 0;
    if (m !== 'place' && m !== 'plan') {
      this.placeType = null;
      this.h.placement.set(null);
      this.h.gfx.terrain.uniforms.uGrid.value.w = 0;
    }
    if (m !== 'super') this.superKind = null;
    if (m !== 'aim') this.aim = null;
  }

  /** Aim a commander power: the next primary click on the map calls `req.onTarget` (right click / Esc cancels). */
  beginAim(req: AimRequest) {
    if (this.spectator) return;
    this.setMode('aim');
    this.aim = req;
    this.h.message(req.label);
    this.h.audio.announce('select_target');
  }

  /** Place a finished structure; one that isn't ready yet goes into plan mode (queue it in the build plan). */
  beginPlacement(type: string) {
    if (this.h.local.queues.structure.ready !== type) { this.beginPlan(type); return; }
    this.setMode('place');
    this.placeType = type;
    this.h.placement.set(type, new THREE.Color(this.h.local.color));
  }

  /** Plan mode: click to add the structure to the build plan (Shift: keep planning). */
  beginPlan(type: string) {
    if (this.spectator || !BUILDINGS[type]) return;
    this.setMode('plan');
    this.placeType = type;
    this.h.placement.set(type, new THREE.Color(0x8fd0ff));
    this.h.message(tControls('msg.plan', { name: typeName(getType(type)) }));
  }

  beginSuperweapon(kind: SuperKind) {
    if (this.spectator) return;
    if (SUPER_TARGET[kind] === 'unit-point' && !this.ownSelectedUnits().some((u) => u.kind === 'vehicle')) {
      this.h.message(tControls('msg.chronoSelect'), true);
      this.h.audio.play('error');
      return;
    }
    this.setMode('super');
    this.superKind = kind;
    this.h.audio.announce('select_target');
  }

  /**
   * The footprint's top-left cell for a ground point: by default the one under the pointer as of the last frame (the
   * ghost); clicks pass their own point, since on a slow frame the cached one can still be the previous position.
   */
  private placementCell(gx = this.groundX, gy = this.groundY): [number, number] {
    const bt = BUILDINGS[this.placeType!];
    return [Math.round(gx - bt.size[0] / 2), Math.round(gy - bt.size[1] / 2)];
  }

  /** Plan mode: open ground, clear of other planned structures, next to the base or to a planned structure. */
  private planValid(type: string, cx: number, cy: number): boolean {
    const bt = BUILDINGS[type];
    const { world, local } = this.h;
    const m = world.map;
    for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) {
      const x = cx + dx, y = cy + dy;
      if (bt.water ? !(m.inBounds(x, y) && m.navalTerrain(m.idx(x, y)) && !m.occupant[m.idx(x, y)]) : !m.buildable(x, y)) return false;
    }
    // cells between the footprints (negative: they overlap)
    const gap = (it: { type: string; cx: number; cy: number }) => {
      const o = BUILDINGS[it.type];
      if (!o) return Infinity;
      return Math.max(it.cx - (cx + bt.size[0]), cx - (it.cx + o.size[0]), it.cy - (cy + bt.size[1]), cy - (it.cy + o.size[1]));
    };
    if (local.buildPlan.some((it) => gap(it) < 0)) return false;
    return world.isAdjacentToBase(local, bt, cx, cy, bt.wall ? 6 : 2, !bt.wall) || local.buildPlan.some((it) => gap(it) <= 2);
  }

  // ---------------------------------------------------------------------------
  // Pointer
  // ---------------------------------------------------------------------------
  private onDown(e: PointerEvent) {
    if (this.h.paused) return;
    if (e.pointerType === 'touch') { this.touch.down(e); return; }
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    if (e.button === 1) {
      e.preventDefault();
      this.middleDown = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 2) {
      this.rightDown = { x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    if (e.button !== 0) return;
    this.primaryPress(e);
  }

  /** Left button (tap, gamepad A) pressed at a screen point: act on the current mode, or start selecting. */
  primaryPress(e: PtrLike) {
    const [gx, gy] = this.screenToGround(e.clientX, e.clientY);
    const world = this.h.world;
    const local = this.h.local;
    if (this.spectator && this.mode !== 'normal') this.setMode('normal');
    switch (this.mode) {
      case 'place': {
        const [cx, cy] = this.placementCell(gx, gy); // (where the click is, not where the last frame saw the pointer)
        const type = this.placeType!;
        const issue = world.placementIssue(local, type, cx, cy);
        if (issue) {
          this.h.audio.play('error');
          this.h.audio.announce('cannot_build_here');
          this.h.message(placementText(issue, !!BUILDINGS[type].wall, !!BUILDINGS[type].water), true);
          return;
        }
        if (BUILDINGS[type].wall) { this.wallStart = [cx, cy]; return; }
        this.h.issue({ c: 'place', player: local.id, type, cx, cy });
        this.h.audio.play('build_place');
        // Shift: keep going and plan more of the same
        if (e.shiftKey) this.beginPlan(type);
        else this.setMode('normal');
        return;
      }
      case 'plan': {
        const [cx, cy] = this.placementCell(gx, gy);
        const type = this.placeType!;
        if (!this.planValid(type, cx, cy)) {
          this.h.audio.play('error');
          this.h.message(tControls('msg.planInvalid'), true);
          return;
        }
        this.h.issue({ c: 'queuePlan', player: local.id, items: [{ type, cx, cy }] });
        this.h.audio.play('build_place');
        this.h.message(tControls('msg.planned', { name: typeName(getType(type)), n: String(local.buildPlan.length + 1) }));
        if (!e.shiftKey) this.setMode('normal');
        return;
      }
      case 'patrol': {
        const units = this.ownSelectedUnits().filter((u) => u.kind !== 'aircraft');
        if (!units.length || !world.map.inBounds(Math.floor(gx), Math.floor(gy))) { this.setMode('normal'); return; }
        this.patrolPts.push([gx, gy]);
        this.marker(gx, gy, 'move');
        if (e.shiftKey && this.patrolPts.length < 12) return;
        this.h.issue({ c: 'patrol', player: local.id, units: units.map((u) => u.id), points: this.patrolPts.slice() });
        this.voice('move', voiceOf(units[0]));
        this.h.message(tControls('msg.patrolling', { n: this.patrolPts.length + 1 }));
        this.setMode('normal');
        return;
      }
      case 'guard': {
        const units = this.ownSelectedUnits();
        const t = this.pickAt(e.clientX, e.clientY, 1.4);
        if (t && this.guardable(t)) {
          const ids = units.filter((u) => u.id !== t.id).map((u) => u.id);
          if (ids.length) {
            this.h.issue({ c: 'guard', player: local.id, units: ids, target: t.id, queue: e.shiftKey });
            this.marker(t.x, t.y, 'rally');
            this.voice('move', voiceOf(units[0]));
            this.h.message(tControls('msg.guarding', { name: typeName(t.type) }));
          }
          if (!e.shiftKey) this.setMode('normal');
        } else {
          this.h.audio.play('error');
          this.h.message(tControls('msg.guardInvalid'), true);
        }
        return;
      }
      case 'sell': {
        const t = this.pickAt(e.clientX, e.clientY);
        if (t instanceof Building && t.owner === local) this.h.issue({ c: 'sell', player: local.id, building: t.id });
        else this.h.audio.play('error');
        if (!e.shiftKey) this.setMode('normal');
        return;
      }
      case 'repair': {
        const t = this.pickAt(e.clientX, e.clientY);
        if (t instanceof Building && t.owner === local) this.h.issue({ c: 'repair', player: local.id, building: t.id });
        else this.h.audio.play('error');
        return;
      }
      case 'attackMove':
      case 'attackGround': {
        const units = this.ownSelectedUnits();
        const t = this.pickAt(e.clientX, e.clientY);
        if (this.mode === 'attackGround') {
          if (t) this.h.issue({ c: 'attack', player: local.id, units: units.map((u) => u.id), target: t.id, forced: true });
          else this.h.issue({ c: 'attackGround', player: local.id, units: units.map((u) => u.id), x: gx, y: gy });
        } else {
          if (t && local.isEnemy(t.owner)) this.h.issue({ c: 'attack', player: local.id, units: units.map((u) => u.id), target: t.id });
          else this.h.issue({ c: 'move', player: local.id, units: units.map((u) => u.id), x: gx, y: gy, attackMove: true, queue: e.shiftKey });
        }
        this.marker(gx, gy, 'attack');
        if (units.length) this.voice('attack', voiceOf(units[0]));
        if (!e.shiftKey) this.setMode('normal');
        return;
      }
      case 'layMines': {
        const layers = this.ownSelectedUnits().filter((u) => u.ut.minelayer);
        if (layers.length) {
          this.h.issue({ c: 'mine', player: local.id, units: layers.map((u) => u.id), x: gx, y: gy });
          this.marker(gx, gy, 'attack');
          this.voice('move', voiceOf(layers[0]));
        } else this.h.audio.play('error');
        if (!e.shiftKey) this.setMode('normal');
        return;
      }
      case 'chrono': {
        // Chrono Tanks: each ready tank jumps (side by side when several)
        const tanks = this.readyChronoTanks();
        if (!tanks.length || !chronoTarget(world, local, gx, gy)) {
          this.h.audio.play('error');
          this.h.message(tControls(tanks.length ? 'msg.chronoInvalid' : 'msg.noChrono'), true);
          return;
        }
        tanks.forEach((u, k) => this.h.issue({ c: 'chronoJump', player: local.id, unit: u.id, x: gx + (k % 3) * 1.1, y: gy + Math.floor(k / 3) * 1.1 }));
        this.marker(gx, gy, 'move');
        this.setMode('normal');
        return;
      }
      case 'aim': { // commander power target
        const req = this.aim;
        if (req && req.onTarget(gx, gy, this.pickAt(e.clientX, e.clientY) ?? null) === false) return;
        this.setMode('normal');
        return;
      }
      case 'super': {
        const kind = this.superKind!;
        const unit = SUPER_TARGET[kind] === 'unit-point' ? this.ownSelectedUnits().find((u) => u.kind === 'vehicle') : undefined;
        this.h.issue({ c: 'superweapon', player: local.id, kind, x: gx, y: gy, unit: unit?.id });
        this.setMode('normal');
        return;
      }
      default:
        this.leftDown = { x: e.clientX, y: e.clientY };
    }
  }

  /** Selected own Chrono Tanks that can jump now. */
  private readyChronoTanks(): Unit[] {
    return this.ownSelectedUnits().filter((u) => u.ut.chronoShift && u.chronoCooldown <= 0);
  }

  /** A friendly unit or structure that can be escorted / guarded. */
  private guardable(t: Entity): boolean {
    if (this.h.local.isEnemy(t.owner)) return false;
    if (t instanceof Building) return !t.bt.mine;
    return t instanceof Unit && selectableUnit(t) && t.kind !== 'aircraft';
  }

  private onMove(e: PointerEvent) {
    if (e.pointerType === 'touch') { this.touch.move(e); return; }
    this.hasMoved = true;
    this.pointerInside = true;
    this.exitX = this.exitY = 0;
    const dx = e.clientX - this.mouseX, dy = e.clientY - this.mouseY;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    const cam = this.h.gfx.cam;
    if (this.middleDown || (this.rightDown && (this.rightDown.moved || Math.hypot(e.clientX - this.rightDown.x, e.clientY - this.rightDown.y) > 8))) {
      if (this.rightDown) this.rightDown.moved = true;
      const k = cam.dist * 0.0019;
      cam.dragBy(dx * k, dy * k * 1.25);
      document.body.dataset.cursor = 'pan';
      return;
    }
    this.dragTo(e.clientX, e.clientY);
  }

  /** Move the (virtual) pointer: gamepad cursor, touch. Extends a box selection in progress. */
  pointerAt(x: number, y: number) {
    this.hasMoved = true;
    this.pointerInside = true;
    this.exitX = this.exitY = 0;
    this.mouseX = x;
    this.mouseY = y;
    this.dragTo(x, y);
  }

  private dragTo(x: number, y: number) {
    if (this.leftDown && this.mode === 'normal' && Math.hypot(x - this.leftDown.x, y - this.leftDown.y) > 6) {
      this.h.overlay.selectionBox = { x0: this.leftDown.x, y0: this.leftDown.y, x1: x, y1: y };
    }
  }

  private onUp(e: PointerEvent) {
    if (e.pointerType === 'touch') { this.touch.up(e); return; }
    if (e.button === 1) { this.middleDown = null; return; }
    if (e.button === 2) {
      const rd = this.rightDown;
      this.rightDown = null;
      if (!rd || rd.moved || this.h.paused) return;
      this.contextAt(e);
      return;
    }
    if (e.button === 0) this.primaryRelease(e);
  }

  /** Left button released (tap end, gamepad A up): finish a wall line, a box, or a click selection. */
  primaryRelease(e: PtrLike) {
    if (this.wallStart && this.mode === 'place' && this.placeType) {
      const [cx, cy] = this.placementCell(...this.screenToGround(e.clientX, e.clientY)); // (the release point itself)
      this.h.issue({ c: 'place', player: this.h.local.id, type: this.placeType, cx: this.wallStart[0], cy: this.wallStart[1], cx2: cx, cy2: cy });
      this.h.audio.play('build_place');
      this.wallStart = null;
      this.setMode('normal');
      return;
    }
    if (!this.leftDown) return;
    const ld = this.leftDown;
    this.leftDown = null;
    const box = this.h.overlay.selectionBox;
    this.h.overlay.selectionBox = null;
    if (box && Math.hypot(box.x1 - box.x0, box.y1 - box.y0) > 6) {
      this.boxSelect(box.x0, box.y0, box.x1, box.y1, e.shiftKey, e.ctrlKey);
      return;
    }
    this.clickSelect(ld.x, ld.y, e.shiftKey, e.ctrlKey);
  }

  /** Right click (gamepad X, touch tap with a selection): cancel the mode, or the context command. */
  contextAt(e: PtrLike) {
    if (this.h.paused) return;
    if (this.mode !== 'normal') { this.setMode('normal'); return; }
    if (!this.spectator) this.command(e);
  }

  /** Click selection: Shift toggles, double-click / Ctrl selects all of that type on screen (Shift: adds them). */
  clickSelect(sx: number, sy: number, shift: boolean, ctrl: boolean, slack = 1) {
    const t = this.pickAt(sx, sy, slack);
    const sel = this.h.selection;
    const now = this.tapTime || performance.now();
    this.tapTime = 0;
    if (!t) {
      if (!shift) sel.clear();
      return;
    }
    const own = t.owner === this.h.local;
    // clicking an already selected MCV deploys it (classic behaviour)
    if (!this.spectator && t instanceof Unit && own && t.ut.deploysInto && sel.size === 1 && sel.has(t.id)) {
      this.h.issue({ c: 'deploy', player: this.h.local.id, units: [t.id] });
      return;
    }
    if (now - this.lastClick.t < 320 && this.lastClick.id === t.id && own) {
      if (t instanceof Unit) this.selectSameTypeOnScreen(t.ut.id, shift);
      else if (t instanceof Building) this.selectSameBuildingsOnScreen(t.bt.id, shift);
      this.lastClick.t = 0;
      return;
    }
    this.lastClick = { t: now, id: t.id };
    if (ctrl && t instanceof Unit && own) { this.selectSameTypeOnScreen(t.ut.id, shift); return; }
    if (shift && own) {
      if (sel.has(t.id)) sel.delete(t.id);
      else this.select([t.id], true);
    } else {
      this.select([t.id]);
    }
  }

  /** Context-sensitive right-click order. */
  private command(e: PtrLike) {
    const { world, local } = this.h;
    const [gx, gy] = this.screenToGround(e.clientX, e.clientY);
    const units = this.ownSelectedUnits();
    const ids = units.map((u) => u.id);
    if (!units.length) {
      const fac = this.ownSelectedBuildings().filter((b) => b.bt.factory && b.bt.factory !== 'building');
      if (!fac.length) return;
      // right click an own unit: new units join it (rally to a unit)
      const t = e.altKey ? null : this.pickAt(e.clientX, e.clientY);
      const rallyTo = fac.filter((b) => b.bt.factory !== 'aircraft');
      if (t instanceof Unit && t.owner === local && selectableUnit(t) && t.kind !== 'aircraft' && rallyTo.length) {
        for (const b of rallyTo) this.h.issue({ c: 'rallyUnit', player: local.id, building: b.id, target: t.id });
        this.marker(t.x, t.y, 'rally');
        this.h.message(tControls('msg.rallyUnit', { name: typeName(t.ut) }));
        return;
      }
      for (const b of fac) this.h.issue({ c: 'rally', player: local.id, building: b.id, x: gx, y: gy });
      this.marker(gx, gy, 'rally');
      return;
    }
    const t = e.altKey ? null : this.pickAt(e.clientX, e.clientY);
    const voice = voiceOf(units[0]);
    if (t && t.owner !== local && local.isEnemy(this.apparentOwner(t))) {
      // whoever can't hurt the target (rifles vs aircraft, medics…) attack-moves there with the others
      const able = units.filter((u) => canEngage(u, t));
      const rest = units.filter((u) => !able.includes(u)).map((u) => u.id);
      if (able.length) this.h.issue({ c: 'attack', player: local.id, units: able.map((u) => u.id), target: t.id });
      if (rest.length) this.h.issue({ c: 'move', player: local.id, units: rest, x: t.x, y: t.y, attackMove: true });
      this.marker(t.x, t.y, 'attack');
      this.voice('attack', voice);
      return;
    }
    if (t && e.ctrlKey) {
      this.h.issue({ c: 'attack', player: local.id, units: ids, target: t.id, forced: true });
      this.marker(t.x, t.y, 'attack');
      this.voice('attack', voice);
      return;
    }
    const riders = t instanceof Unit && t.owner === local && t.ut.passengers ? units.filter((u) => canCarry(t, u)) : [];
    if (riders.length && t) {
      this.h.issue({ c: 'enter', player: local.id, units: riders.map((u) => u.id), target: t.id });
      this.marker(t.x, t.y, 'move');
      this.voice('move', voice);
      return;
    }
    // right click a friendly unit outside the selection: escort it (follow and defend)
    if (t instanceof Unit && !this.h.selection.has(t.id) && this.guardable(t)) {
      const escorts = units.filter((u) => u.kind !== 'aircraft');
      if (escorts.length) {
        this.h.issue({ c: 'guard', player: local.id, units: escorts.map((u) => u.id), target: t.id, queue: e.shiftKey });
        const rest = units.filter((u) => u.kind === 'aircraft').map((u) => u.id);
        if (rest.length) this.h.issue({ c: 'move', player: local.id, units: rest, x: t.x, y: t.y });
        this.marker(t.x, t.y, 'rally');
        this.voice('move', voice);
        return;
      }
    }
    if (t instanceof Building && t.owner === local) {
      const harv = units.filter((u) => u.ut.harvester && t.bt.dock);
      const eng = units.filter((u) => u.ut.engineer && t.hp < t.maxHp);
      const veh = units.filter((u) => u.kind === 'vehicle' && t.bt.repairPad && !u.ut.harvester);
      const gar = t.bt.garrison ? units.filter((u) => canGarrison(u, t)) : []; // into a bunker (Commander economy)
      const special = new Set([...harv, ...eng, ...veh, ...gar].map((u) => u.id));
      if (special.size) {
        this.h.issue({ c: 'enter', player: local.id, units: [...special], target: t.id });
        const rest = ids.filter((id) => !special.has(id));
        if (rest.length) this.h.issue({ c: 'move', player: local.id, units: rest, x: gx, y: gy, queue: e.shiftKey });
        this.marker(t.x, t.y, 'move');
        this.voice('move', voice);
        return;
      }
    }
    // engineers walk up to a neutral tech structure (sim/neutral.ts: reaching it captures it)
    if (t instanceof Building && t.bt.tech && t.owner.id < 0 && units.some((u) => u.ut.engineer)) {
      const eng = units.filter((u) => u.ut.engineer);
      const [px, py] = t.closestPoint(eng[0].x, eng[0].y);
      this.h.issue({ c: 'move', player: local.id, units: eng.map((u) => u.id), x: px + Math.sign(eng[0].x - px) * 0.6, y: py + Math.sign(eng[0].y - py) * 0.6 });
      const rest = ids.filter((id) => !eng.some((u) => u.id === id));
      if (rest.length) this.h.issue({ c: 'move', player: local.id, units: rest, x: gx, y: gy, queue: e.shiftKey });
      this.marker(t.x, t.y, 'move');
      this.voice('move', voiceOf(eng[0]));
      return;
    }
    // engineers rebuild a destroyed bridge (click its gap or either end)
    const engineers = units.filter((u) => u.ut.engineer);
    const wreck = engineers.length ? this.destroyedBridgeAt(gx, gy) : null;
    if (wreck) {
      this.h.issue({ c: 'repairBridge', player: local.id, units: engineers.map((u) => u.id), bridge: wreck.id });
      const rest = ids.filter((id) => !engineers.some((u) => u.id === id));
      if (rest.length) this.h.issue({ c: 'move', player: local.id, units: rest, x: gx, y: gy, queue: e.shiftKey });
      this.marker(gx, gy, 'move');
      this.voice('move', voiceOf(engineers[0]));
      return;
    }
    // Ctrl + right click with minelayers: lay a minefield there (the rest force-fire)
    const layers = units.filter((u) => u.ut.minelayer);
    if (e.ctrlKey && layers.length) {
      this.h.issue({ c: 'mine', player: local.id, units: layers.map((u) => u.id), x: gx, y: gy });
      const rest = units.filter((u) => !u.ut.minelayer).map((u) => u.id);
      if (rest.length) this.h.issue({ c: 'attackGround', player: local.id, units: rest, x: gx, y: gy });
      this.marker(gx, gy, 'attack');
      this.voice('move', voice);
      return;
    }
    if (e.ctrlKey) {
      this.h.issue({ c: 'attackGround', player: local.id, units: ids, x: gx, y: gy });
      this.marker(gx, gy, 'attack');
      this.voice('attack', voice);
      return;
    }
    const map = world.map;
    const cx = Math.floor(gx), cy = Math.floor(gy);
    const harvesters = units.filter((u) => u.ut.harvester);
    if (harvesters.length && map.inBounds(cx, cy) && map.ore[map.idx(cx, cy)] > 0) {
      this.h.issue({ c: 'harvest', player: local.id, units: harvesters.map((u) => u.id), x: gx, y: gy });
      const rest = units.filter((u) => !u.ut.harvester).map((u) => u.id);
      if (rest.length) this.h.issue({ c: 'move', player: local.id, units: rest, x: gx, y: gy, queue: e.shiftKey });
      this.marker(gx, gy, 'move');
      this.voice('move', voice);
      return;
    }
    if (!map.inBounds(cx, cy)) return;
    this.h.issue({ c: 'move', player: local.id, units: ids, x: gx, y: gy, queue: e.shiftKey });
    this.marker(gx, gy, 'move');
    this.voice('move', voice);
  }

  private voice(kind: 'select' | 'move' | 'attack', v: VoiceKind) {
    if (this.unitVoices || v === 'dog') this.h.audio.unitResponse(kind, v);
  }

  private marker(x: number, y: number, kind: 'move' | 'attack' | 'rally') {
    this.h.effects.orderMarker(new THREE.Vector3(x, this.h.world.map.surfaceAt(x, y), y), kind);
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------
  private onKey(e: KeyboardEvent, down: boolean) {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    // held keys by base key and by position (camera scrolling reads them through the keymap)
    const base = eventBase(e), code = '#' + e.code;
    if (down) { this.keys.add(k); this.keys.add(base); this.keys.add(code); } else { this.keys.delete(k); this.keys.delete(base); this.keys.delete(code); }
    this.h.overlay.showAllBars = e.altKey;
    if (!down) return;
    // Alt+Enter: the classic fullscreen toggle (works while paused too)
    if (k === 'enter' && e.altKey) {
      e.preventDefault();
      void toggleFullscreen();
      return;
    }
    if (k === 'escape') {
      if (this.mode !== 'normal') this.setMode('normal');
      else this.h.openPauseMenu();
      return;
    }
    if (this.h.paused) return;
    if (k === 'tab' || k === 'alt') e.preventDefault();
    // stances (default F1–F4; the browser's F1 help / F3 find are suppressed in game)
    const stance = STANCE_ACTIONS.find(([id]) => isAction(id, e, { anyMods: true }));
    if (stance) {
      e.preventDefault();
      this.setStance(stance[1]);
      return;
    }
    // camera bookmarks: the key jumps, Ctrl / Shift + the key stores
    const bm = BOOKMARK_ACTIONS.findIndex((id) => isAction(id, e, { anyMods: true }));
    if (bm >= 0) {
      e.preventDefault();
      this.bookmark(bm, e.ctrlKey || e.metaKey || e.shiftKey);
      return;
    }
    // control groups (by key position, so Shift+1 works on every layout): assign / add modifiers (default Ctrl / Shift), plain recall
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1] ?? (/^[0-9]$/.test(k) ? k : null);
    if (digit !== null) {
      const g = +digit;
      const mods = groupMods();
      if (modHeld(e, mods.assign)) {
        e.preventDefault();
        this.assignGroup(g, false);
      } else if (modHeld(e, mods.add) && this.ownSelectedUnits().length) {
        e.preventDefault();
        this.assignGroup(g, true);
      } else this.recallGroup(g);
      return;
    }
    if (isAction('selectScreen', e)) {
      e.preventDefault();
      this.selectOnScreen();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    const act = lookup(e, KEY_ACTIONS);
    if (act === 'nextIdle') { this.cycleIdle(e.shiftKey); return; }
    if (act === 'formation') { if (!this.spectator) this.cycleFormation(e.shiftKey ? -1 : 1); return; }
    if (act) this.keyCommand(ACTION_COMMAND[act]!);
  }

  /** Store or recall a camera bookmark (slot 0–3). */
  bookmark(slot: number, store: boolean) {
    const cam = this.h.gfx.cam;
    const key = keyLabel(BOOKMARK_ACTIONS[slot]) || `F${slot + 6}`;
    if (store) {
      this.bookmarks.set(slot, [cam.x, cam.y, cam.targetDist, cam.targetYaw]);
      this.h.message(fmt(BATTLE_TEXT.bookmarkSaved, { key }));
      return;
    }
    const b = this.bookmarks.get(slot);
    if (!b) { this.h.message(fmt(BATTLE_TEXT.bookmarkEmpty, { key })); return; }
    cam.flyToPoint(b[0], b[1]);
    cam.targetDist = b[2];
    cam.targetYaw = b[3];
  }

  keyCommand(k: string, fromButton = false) {
    const { local } = this.h;
    const units = this.ownSelectedUnits();
    const ids = units.map((u) => u.id);
    const blds = this.ownSelectedBuildings();
    // spectators keep the camera and selection keys only
    if (this.spectator && k.length === 1 && 'sagxdzrpmcl '.includes(k)) return;
    switch (k) {
      case 's':
        if (ids.length) this.h.issue({ c: 'stop', player: local.id, units: ids });
        break;
      case 'a':
        if (ids.length) { this.setMode('attackMove'); }
        break;
      case 'g':
        if (ids.length) { this.setMode('attackGround'); }
        break;
      case 'x':
        if (ids.length) this.h.issue({ c: 'scatter', player: local.id, units: ids });
        break;
      case 'd': {
        // Chrono Tanks pick a destination; everything else deploys / unloads / detonates
        const chrono = units.filter((u) => u.ut.chronoShift);
        const rest = ids.filter((id) => !chrono.some((u) => u.id === id));
        if (rest.length) this.h.issue({ c: 'deploy', player: local.id, units: rest });
        for (const b of blds) if (b.garrison?.length) this.h.issue({ c: 'evacuate', player: local.id, building: b.id }); // bunker (Commander economy)
        if (chrono.length) {
          if (this.readyChronoTanks().length) {
            this.setMode(this.mode === 'chrono' ? 'normal' : 'chrono');
            if (this.mode === 'chrono') this.h.message(tControls('msg.chronoMode'));
          } else this.h.message(tControls('msg.chronoRecharging', { n: Math.ceil(Math.min(...chrono.map((u) => u.chronoCooldown))) }));
        }
        break;
      }
      case 'z':
        // the hotkey only arms sell mode (avoids accidental sales); the panel button sells directly
        if (fromButton && blds.length === 1 && blds[0].alive) this.h.issue({ c: 'sell', player: local.id, building: blds[0].id });
        else this.setMode(this.mode === 'sell' ? 'normal' : 'sell');
        break;
      case 'r':
        if (blds.length === 1) this.h.issue({ c: 'repair', player: local.id, building: blds[0].id });
        else this.setMode(this.mode === 'repair' ? 'normal' : 'repair');
        break;
      case 'p':
        // units: patrol (click waypoints, Shift-click for more); a factory: primary
        if (units.some((u) => u.kind !== 'aircraft')) {
          this.setMode(this.mode === 'patrol' ? 'normal' : 'patrol');
          if (this.mode === 'patrol') this.h.message(tControls('msg.patrolMode'));
        } else if (blds.length === 1) this.h.issue({ c: 'primary', player: local.id, building: blds[0].id });
        break;
      case 'c':
        // guard / escort: click the unit or structure to protect
        if (units.some((u) => u.kind !== 'aircraft')) {
          this.setMode(this.mode === 'guard' ? 'normal' : 'guard');
          if (this.mode === 'guard') this.h.message(tControls('msg.guardMode'));
        }
        break;
      case 'h': {
        const fact = this.h.world.buildings.find((b) => b.alive && b.owner === local && b.bt.id === 'fact');
        const target = fact ?? this.h.world.units.find((u) => u.alive && u.owner === local && u.ut.deploysInto);
        if (target) { this.select([target.id]); this.h.gfx.cam.flyToPoint(target.x, target.y); }
        break;
      }
      case ' ':
        if (local.lastAttackX >= 0) this.h.gfx.cam.flyToPoint(local.lastAttackX, local.lastAttackY);
        break;
      case 'q': case ',':
        this.h.gfx.cam.targetYaw += Math.PI / 4;
        break;
      case '.':
        this.h.gfx.cam.targetYaw -= Math.PI / 4;
        break;
      case 'e':
        // all combat units on the map
        this.select(this.h.world.units.filter((u) => selectableUnit(u) && u.owner === local && u.weapons.length && !u.ut.harvester).map((u) => u.id));
        break;
      case 'm':
        if (units.some((u) => u.ut.minelayer)) this.setMode(this.mode === 'layMines' ? 'normal' : 'layMines');
        break;
      case 'w':
        // every unit of the selected type(s) on screen
        if (units.length) this.selectSameTypeOnScreen(new Set(units.map((u) => u.ut.id)));
        break;
      case 'f':
        this.follow = !this.follow && this.h.selection.size > 0;
        this.h.message(tControls(this.follow ? 'msg.follow' : 'msg.released'));
        break;
      case 'backspace':
        this.h.gfx.cam.targetYaw = Math.round(this.h.gfx.cam.targetYaw / (Math.PI * 2)) * Math.PI * 2;
        break;
      case 'u':
        if (!document.getElementById('photo-style')) {
          const st = document.createElement('style');
          st.id = 'photo-style';
          st.textContent = 'body.photo-mode #ui, body.photo-mode .overlay-canvas, body.photo-mode #tooltip { opacity: 0 !important; pointer-events: none !important; }';
          document.head.appendChild(st);
        }
        document.body.classList.toggle('photo-mode');
        this.h.gfx.setPhotoMode?.(document.body.classList.contains('photo-mode')); // depth-of-field panel
        break;
      case '[': case ']':
        if (!this.spectator) this.h.stepSpeed?.(k === ']' ? 1 : -1);
        break;
      case '+': case '=':
        this.h.gfx.cam.zoomBy(-300);
        break;
      case '-':
        this.h.gfx.cam.zoomBy(300);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  /** Per-frame: camera keys / edge scroll, hover & cursor, placement ghost. */
  update(dt: number, time: number) {
    gamepadFrame();
    const cam = this.h.gfx.cam;
    let px = this.padPan[0], py = this.padPan[1];
    if (isHeld('camLeft', this.keys)) px -= 1;
    if (isHeld('camRight', this.keys)) px += 1;
    if (isHeld('camUp', this.keys)) py -= 1;
    if (isHeld('camDown', this.keys)) py += 1;
    if (this.edgeScroll && this.hasMoved && document.hasFocus() && !this.middleDown && !this.rightDown && !this.touch.active) {
      if (this.pointerInside) {
        // a band rather than the last pixel row: easy to hit in a window as well as fullscreen
        const m = 10;
        if (this.mouseX <= m) px -= 1;
        if (this.mouseX >= window.innerWidth - m) px += 1;
        if (this.mouseY <= m) py -= 1;
        if (this.mouseY >= window.innerHeight - m) py += 1;
      } else {
        px += this.exitX;
        py += this.exitY;
      }
    }
    if (this.follow) {
      // follow the selection; any manual scroll releases the camera
      let n = 0, fx = 0, fy = 0;
      for (const id of this.h.selection) {
        const e = this.h.world.getEntity(id);
        if (e?.alive) { fx += e.x; fy += e.y; n++; }
      }
      if (!n || px || py || this.middleDown || this.rightDown?.moved) this.follow = false;
      else {
        const k = Math.min(1, dt * 4);
        cam.jumpTo(cam.x + (fx / n - cam.x) * k, cam.y + (fy / n - cam.y) * k);
      }
    }
    cam.pan(px, py, dt);

    const [gx, gy] = this.screenToGround(this.mouseX, this.mouseY);
    this.groundX = gx;
    this.groundY = gy;

    if (this.mode === 'place' && this.placeType && this.wallStart) {
      const [cx, cy] = this.placementCell();
      const local = this.h.local;
      const cost = BUILDINGS[this.placeType].cost;
      let budget = local.credits;
      const cells = wallLine(this.wallStart[0], this.wallStart[1], cx, cy).slice(0, 24).map(([x, y], k): [number, number, boolean] => {
        const ok = this.h.world.canPlace(local, this.placeType!, x, y) && (k === 0 || (budget -= cost) >= 0);
        return [x, y, ok];
      });
      this.h.placement.updateLine(cells, time);
    } else if ((this.mode === 'place' || this.mode === 'plan') && this.placeType) {
      const [cx, cy] = this.placementCell();
      const map = this.h.world.map;
      const valid = this.mode === 'plan' ? (this.planOk = this.planValid(this.placeType, cx, cy)) : this.h.world.canPlace(this.h.local, this.placeType, cx, cy);
      const water = !!BUILDINGS[this.placeType].water;
      // shipyards / sub pens stand on open water; everything else on clear dry ground
      const cellOk = water
        ? (dx: number, dy: number) => map.inBounds(cx + dx, cy + dy) && map.navalTerrain(map.idx(cx + dx, cy + dy)) && !map.occupant[map.idx(cx + dx, cy + dy)]
        : (dx: number, dy: number) => map.buildable(cx + dx, cy + dy);
      this.h.placement.update(cx, cy, cellOk, valid, time);
      const u = this.h.gfx.terrain.uniforms.uGrid.value;
      u.set(gx, gy, 7, 1);
    }
    if (this.mode === 'super' && this.superKind && this.h.reticle) {
      const ret = SUPER_RETICLE[this.superKind] ?? { r: 1.5, color: 0xffffff };
      this.h.reticle.show(this.groundX, this.groundY, Math.max(0.9, ret.r), ret.color, time);
    } else if (this.mode === 'aim' && this.aim && this.h.reticle) {
      this.h.reticle.show(this.groundX, this.groundY, Math.max(0.9, this.aim.r), this.aim.color, time);
    } else if (this.mode === 'chrono' && this.h.reticle) {
      const ok = !!chronoTarget(this.h.world, this.h.local, this.groundX, this.groundY);
      this.h.reticle.show(this.groundX, this.groundY, 0.9, ok ? SUPER_RETICLE.chrono.color : 0xff3020, time);
    } else this.h.reticle?.hide();
    this.touch.update(dt);
    // the hover pick walks every unit: a still pointer re-picks every other frame (30 Hz is plenty for a cursor)
    if (this.mouseX !== this.pickX || this.mouseY !== this.pickY || (++this.pickTick & 1) === 0) {
      this.pickX = this.mouseX;
      this.pickY = this.mouseY;
      this.updateCursor();
    }
  }
  private pickX = NaN;
  private pickY = NaN;
  private pickTick = 0;

  private updateCursor() {
    if (this.middleDown || this.rightDown?.moved) { document.body.dataset.cursor = 'pan'; this.applyCursor('pan'); return; }
    const t = this.pickAt(this.mouseX, this.mouseY);
    this.hovered = t ? t.id : 0;
    const local = this.h.local;
    let c = '';
    switch (this.mode) {
      case 'place': case 'plan': c = ''; break;
      case 'sell': c = t instanceof Building && t.owner === local ? 'sell' : 'nomove'; break;
      case 'repair': c = t instanceof Building && t.owner === local && t.hp < t.maxHp ? 'repair' : 'nomove'; break;
      case 'attackMove': case 'attackGround': c = 'attack'; break;
      case 'super': case 'layMines': case 'aim': c = 'target'; break; // aim
      case 'patrol': c = 'patrol'; break;
      case 'chrono': c = chronoTarget(this.h.world, local, this.groundX, this.groundY) ? 'target' : 'nomove'; break;
      case 'guard': c = t && this.guardable(t) ? 'guard' : 'nomove'; break;
      default: {
        const units = this.ownSelectedUnits();
        if (this.spectator) { c = t ? 'select' : ''; break; }
        if (!units.length) {
          const factory = this.ownSelectedBuildings().some((b) => b.bt.factory && b.bt.factory !== 'building' && b.bt.factory !== 'aircraft');
          c = factory && t instanceof Unit && t.owner === local && t.kind !== 'aircraft' ? 'rally' : t ? 'select' : '';
          break;
        }
        if (t && local.isEnemy(this.apparentOwner(t))) {
          c = units.some((u) => u.weapons.length || u.ut.engineer || u.ut.c4) ? (units.every((u) => u.ut.engineer) ? 'enter' : 'attack') : 'select';
        } else if (t instanceof Unit && t.owner === local && t.ut.passengers && units.some((u) => canCarry(t, u))) {
          c = 'enter';
        } else if (t instanceof Unit && t.ut.deploysInto && this.h.selection.has(t.id) && units.length === 1) {
          c = 'deploy';
        } else if (t instanceof Building && t.owner === local && ((t.bt.dock && units.some((u) => u.ut.harvester)) || (t.bt.repairPad && units.some((u) => u.kind === 'vehicle')) || (units.some((u) => u.ut.engineer) && t.hp < t.maxHp) || (!!t.bt.garrison && units.some((u) => canGarrison(u, t))))) { // (bunker)
          c = 'enter';
        } else if (t instanceof Building && t.bt.tech && t.owner.id < 0 && units.some((u) => u.ut.engineer)) {
          c = 'enter'; // capture a neutral tech structure
        } else if (t instanceof Unit && !this.h.selection.has(t.id) && this.guardable(t) && units.some((u) => u.kind !== 'aircraft')) {
          c = 'guard';
        } else if (t) {
          c = 'select';
        } else {
          const map = this.h.world.map;
          const cx = Math.floor(this.groundX), cy = Math.floor(this.groundY);
          if (!map.inBounds(cx, cy)) c = 'nomove';
          else if (units.some((u) => u.ut.engineer) && this.destroyedBridgeAt(this.groundX, this.groundY)) c = 'enter';
          else if (map.ore[map.idx(cx, cy)] && units.some((u) => u.ut.harvester)) c = 'harvest';
          else if (units.every((u) => u.kind === 'naval')) c = 'move'; // ships head for the nearest water
          else c = map.passable(cx, cy) || (units.some((u) => u.kind === 'naval') && map.terrain[map.idx(cx, cy)] === T.Water) ? 'move' : 'nomove';
        }
      }
    }
    this.applyCursor(c);
  }

  private curCursor = '';
  private applyCursor(c: string) {
    if (c === this.curCursor) return;
    const b = document.body;
    if (this.curCursor) b.classList.remove('cur-' + this.curCursor);
    if (c) b.classList.add('cur-' + c);
    this.curCursor = c;
  }

  /** The cursor class currently shown (for the gamepad cursor). */
  get cursorKind(): string {
    return this.curCursor;
  }

  // --- for touch / gamepad -------------------------------------------------------
  get world(): World { return this.h.world; }
  get local(): Player { return this.h.local; }
  get selection(): Set<number> { return this.h.selection; }
  get paused(): boolean { return this.h.paused; }
  message(text: string, warn = false) { this.h.message(text, warn); }
  pause() { this.h.openPauseMenu(); }
  playClick() { this.h.audio.play('click'); }
}

/** Whether a selected unit can act on an enemy target with the attack command. */
function canEngage(u: Unit, t: Entity): boolean {
  if (t instanceof Building && (u.ut.engineer || u.ut.c4 || u.ut.spy || u.ut.thief)) return true;
  return u.weapons.length > 0 && !u.ut.medic && !!pickWeapon(u, t);
}

/** Why a structure can't go where the player clicked. */
function placementText(issue: PlacementIssue, wall: boolean, water = false): string {
  switch (issue) {
    case 'no-yard': return tControls('place.noYard');
    case 'terrain': return tControls(water ? 'place.water' : 'place.terrain');
    case 'occupied': return tControls('place.occupied');
    case 'exit': return tControls('place.exit');
    case 'distance': return tControls(wall ? 'place.wallDistance' : 'place.distance');
  }
}
