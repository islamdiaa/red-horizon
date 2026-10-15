import * as THREE from 'three';
import { BUILDINGS } from '../data/rules';
import { wallLine } from '../sim/world';
import { lerp } from '../core/util';
import { Building, Entity, Unit } from '../sim/entities';
import type { Player } from '../sim/player';
import { SUPER_TARGET, type SuperKind } from '../sim/superweapons';
import type { Command, Stance } from '../sim/types';
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
import { T } from '../sim/map';
import { toggleFullscreen } from '../platform/fullscreen';

export type Mode = 'normal' | 'place' | 'sell' | 'repair' | 'attackMove' | 'attackGround' | 'super' | 'layMines';

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

/** Stance hotkeys (F1–F4). */
export const STANCE_KEYS: Record<string, Stance> = { f1: 'aggressive', f2: 'guard', f3: 'hold', f4: 'passive' };
const STANCE_NAME: Record<Stance, string> = { aggressive: 'Aggressive', guard: 'Guard', hold: 'Hold position', passive: 'Hold fire' };

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
}

const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3();
const _ndc = new THREE.Vector2();

export function voiceOf(u: Unit): VoiceKind {
  const t = u.ut;
  if (t.dog) return 'dog';
  if (t.hero) return 'tanya';
  if (t.engineer) return 'engineer';
  if (t.medic) return 'medic';
  if (t.harvester) return 'harvester';
  if (t.id === 'spy' || t.id === 'thf') return 'spy';
  if (u.kind === 'aircraft') return 'aircraft';
  if (u.kind === 'naval') return 'naval';
  return u.kind === 'infantry' ? 'infantry' : 'vehicle';
}

export class InputController {
  mode: Mode = 'normal';
  placeType: string | null = null;
  superKind: SuperKind | null = null;
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

  constructor(private h: InputHost) {
    this.canvas = h.gfx.canvas;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.disposers.push(() => t.removeEventListener(type, fn, opts));
    };
    on(this.canvas, 'pointerdown', (e: PointerEvent) => this.onDown(e));
    on(window, 'pointermove', (e: PointerEvent) => this.onMove(e));
    on(window, 'pointerup', (e: PointerEvent) => this.onUp(e));
    on(this.canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(this.canvas, 'wheel', (e: WheelEvent) => { e.preventDefault(); this.h.gfx.cam.zoomBy(e.deltaY * (e.deltaMode === 1 ? 30 : 1)); }, { passive: false });
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
  }

  dispose() {
    for (const d of this.disposers) d();
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

  private project(x: number, y: number, z: number): [number, number, number] {
    _v.set(x, y, z).project(this.h.gfx.cam.camera);
    return [(_v.x * 0.5 + 0.5) * window.innerWidth, (-_v.y * 0.5 + 0.5) * window.innerHeight, _v.z];
  }

  pickAt(sx: number, sy: number): Entity | null {
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
      const rpx = Math.max(10, (u.ut.radius * 1.5 + 0.1) * focal / depth);
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
  private ownSelectedUnits(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.h.selection) {
      const e = this.h.world.getEntity(id);
      if (e instanceof Unit && e.alive && e.owner === this.h.local) out.push(e);
    }
    return out;
  }

  private ownSelectedBuildings(): Building[] {
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

  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean) {
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
    // prefer combat units over harvesters / MCVs when mixed
    const combat = hits.filter((u) => !u.ut.harvester && !u.ut.deploysInto);
    if (combat.length) hits = combat;
    if (hits.length) this.select(hits.map((u) => u.id), add);
    else if (!add) this.h.selection.clear();
  }

  private selectSameTypeOnScreen(types: string | Set<string>) {
    const ids: number[] = [];
    const W = window.innerWidth - this.sidebarW(), H = window.innerHeight;
    const map = this.h.world.map;
    const want = typeof types === 'string' ? new Set([types]) : types;
    for (const u of this.h.world.units) {
      if (!selectableUnit(u) || u.owner !== this.h.local || !want.has(u.ut.id)) continue;
      const [px, py] = this.project(u.x, map.surfaceAt(u.x, u.y), u.y);
      if (px >= 0 && px <= W && py >= 0 && py <= H) ids.push(u.id);
    }
    if (ids.length) this.select(ids);
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
  private selectOnScreen() {
    const W = window.innerWidth - this.sidebarW(), H = window.innerHeight;
    const map = this.h.world.map;
    let hits: Unit[] = [];
    for (const u of this.h.world.units) {
      if (!selectableUnit(u) || u.owner !== this.h.local) continue;
      const [px, py] = this.project(u.x, map.surfaceAt(u.x, u.y), u.y);
      if (px >= 0 && px <= W && py >= 0 && py <= H) hits.push(u);
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
      this.h.message(harvesters ? 'No idle harvesters' : 'No idle units');
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
    this.h.message(`Stance: ${STANCE_NAME[stance]}`);
    this.h.audio.play('click');
  }

  // ---------------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------------
  setMode(m: Mode) {
    this.mode = m;
    this.wallStart = null;
    if (m !== 'place') {
      this.placeType = null;
      this.h.placement.set(null);
      this.h.gfx.terrain.uniforms.uGrid.value.w = 0;
    }
    if (m !== 'super') this.superKind = null;
  }

  beginPlacement(type: string) {
    this.setMode('place');
    this.placeType = type;
    this.h.placement.set(type, new THREE.Color(this.h.local.color));
  }

  beginSuperweapon(kind: SuperKind) {
    if (this.spectator) return;
    if (SUPER_TARGET[kind] === 'unit-point' && !this.ownSelectedUnits().some((u) => u.kind === 'vehicle')) {
      this.h.message('Select a vehicle to chronoshift first', true);
      this.h.audio.play('error');
      return;
    }
    this.setMode('super');
    this.superKind = kind;
    this.h.audio.announce('select_target');
  }

  private placementCell(): [number, number] {
    const bt = BUILDINGS[this.placeType!];
    return [Math.round(this.groundX - bt.size[0] / 2), Math.round(this.groundY - bt.size[1] / 2)];
  }

  // ---------------------------------------------------------------------------
  // Pointer
  // ---------------------------------------------------------------------------
  private onDown(e: PointerEvent) {
    if (this.h.paused) return;
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
    const [gx, gy] = this.screenToGround(e.clientX, e.clientY);
    const world = this.h.world;
    const local = this.h.local;
    if (this.spectator && this.mode !== 'normal') this.setMode('normal');
    switch (this.mode) {
      case 'place': {
        const [cx, cy] = this.placementCell();
        const issue = world.placementIssue(local, this.placeType!, cx, cy);
        if (issue) {
          this.h.audio.play('error');
          this.h.audio.announce('cannot_build_here');
          this.h.message(placementText(issue, !!BUILDINGS[this.placeType!].wall, !!BUILDINGS[this.placeType!].water), true);
          return;
        }
        if (BUILDINGS[this.placeType!].wall) { this.wallStart = [cx, cy]; return; }
        this.h.issue({ c: 'place', player: local.id, type: this.placeType!, cx, cy });
        this.h.audio.play('build_place');
        this.setMode('normal');
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

  private onMove(e: PointerEvent) {
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
    if (this.leftDown && this.mode === 'normal') {
      if (Math.hypot(e.clientX - this.leftDown.x, e.clientY - this.leftDown.y) > 6) {
        this.h.overlay.selectionBox = { x0: this.leftDown.x, y0: this.leftDown.y, x1: e.clientX, y1: e.clientY };
      }
    }
  }

  private onUp(e: PointerEvent) {
    if (e.button === 1) { this.middleDown = null; return; }
    if (e.button === 2) {
      const rd = this.rightDown;
      this.rightDown = null;
      if (!rd || rd.moved || this.h.paused) return;
      if (this.mode !== 'normal') { this.setMode('normal'); return; }
      if (!this.spectator) this.command(e);
      return;
    }
    if (e.button === 0 && this.wallStart && this.mode === 'place' && this.placeType) {
      const [cx, cy] = this.placementCell();
      this.h.issue({ c: 'place', player: this.h.local.id, type: this.placeType, cx: this.wallStart[0], cy: this.wallStart[1], cx2: cx, cy2: cy });
      this.h.audio.play('build_place');
      this.wallStart = null;
      this.setMode('normal');
      return;
    }
    if (e.button !== 0 || !this.leftDown) return;
    const ld = this.leftDown;
    this.leftDown = null;
    const box = this.h.overlay.selectionBox;
    this.h.overlay.selectionBox = null;
    if (box && Math.hypot(box.x1 - box.x0, box.y1 - box.y0) > 6) {
      this.boxSelect(box.x0, box.y0, box.x1, box.y1, e.shiftKey);
      return;
    }
    this.clickSelect(ld.x, ld.y, e.shiftKey, e.ctrlKey);
  }

  private clickSelect(sx: number, sy: number, shift: boolean, ctrl: boolean) {
    const t = this.pickAt(sx, sy);
    const sel = this.h.selection;
    const now = performance.now();
    if (!t) {
      if (!shift) sel.clear();
      return;
    }
    // clicking an already selected MCV deploys it (classic behaviour)
    if (!this.spectator && t instanceof Unit && t.owner === this.h.local && t.ut.deploysInto && sel.size === 1 && sel.has(t.id)) {
      this.h.issue({ c: 'deploy', player: this.h.local.id, units: [t.id] });
      return;
    }
    if (now - this.lastClick.t < 320 && this.lastClick.id === t.id && t instanceof Unit && t.owner === this.h.local) {
      this.selectSameTypeOnScreen(t.ut.id);
      this.lastClick.t = 0;
      return;
    }
    this.lastClick = { t: now, id: t.id };
    if (ctrl && t instanceof Unit && t.owner === this.h.local) { this.selectSameTypeOnScreen(t.ut.id); return; }
    if (shift && t.owner === this.h.local) {
      if (sel.has(t.id)) sel.delete(t.id);
      else this.select([t.id], true);
    } else {
      this.select([t.id]);
    }
  }

  /** Context-sensitive right-click order. */
  private command(e: PointerEvent) {
    const { world, local } = this.h;
    const [gx, gy] = this.screenToGround(e.clientX, e.clientY);
    const units = this.ownSelectedUnits();
    const ids = units.map((u) => u.id);
    if (!units.length) {
      const fac = this.ownSelectedBuildings().filter((b) => b.bt.factory && b.bt.factory !== 'building');
      for (const b of fac) this.h.issue({ c: 'rally', player: local.id, building: b.id, x: gx, y: gy });
      if (fac.length) this.marker(gx, gy, 'rally');
      return;
    }
    const t = e.altKey ? null : this.pickAt(e.clientX, e.clientY);
    const voice = voiceOf(units[0]);
    if (t && t.owner !== local && local.isEnemy(this.apparentOwner(t))) {
      this.h.issue({ c: 'attack', player: local.id, units: ids, target: t.id });
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
    if (t instanceof Building && t.owner === local) {
      const harv = units.filter((u) => u.ut.harvester && t.bt.dock);
      const eng = units.filter((u) => u.ut.engineer && t.hp < t.maxHp);
      const veh = units.filter((u) => u.kind === 'vehicle' && t.bt.repairPad && !u.ut.harvester);
      const special = new Set([...harv, ...eng, ...veh].map((u) => u.id));
      if (special.size) {
        this.h.issue({ c: 'enter', player: local.id, units: [...special], target: t.id });
        const rest = ids.filter((id) => !special.has(id));
        if (rest.length) this.h.issue({ c: 'move', player: local.id, units: rest, x: gx, y: gy, queue: e.shiftKey });
        this.marker(t.x, t.y, 'move');
        this.voice('move', voice);
        return;
      }
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
    if (down) this.keys.add(k); else this.keys.delete(k);
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
    if (/^f[1-4]$/.test(k)) {
      // stance hotkeys (the browser's F1 help / F3 find are suppressed in game)
      e.preventDefault();
      this.setStance(STANCE_KEYS[k]);
      return;
    }
    // control groups
    if (/^[0-9]$/.test(k)) {
      const g = +k;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const ids = this.ownSelectedUnits().map((u) => u.id);
        // a unit belongs to one group: drop the old members' badges and take these units out of other groups
        for (const [id, gg] of this.h.overlay.groups) if (gg === g) this.h.overlay.groups.delete(id);
        for (const [k2, list] of this.groups) if (k2 !== g) this.groups.set(k2, list.filter((id) => !ids.includes(id)));
        this.groups.set(g, ids);
        for (const id of ids) this.h.overlay.groups.set(id, g);
        this.h.message(`Group ${g} assigned`);
      } else {
        const ids = (this.groups.get(g) ?? []).filter((id) => this.h.world.getEntity(id)?.alive);
        if (!ids.length) return;
        const now = performance.now();
        if (this.lastGroupTap.g === g && now - this.lastGroupTap.t < 350) {
          const u = this.h.world.getEntity(ids[0])!;
          this.h.gfx.cam.flyToPoint(u.x, u.y);
        }
        this.lastGroupTap = { t: now, g };
        this.select(ids, e.shiftKey);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'a') {
      e.preventDefault();
      this.selectOnScreen();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    if (k === 'i') { this.cycleIdle(e.shiftKey); return; }
    this.keyCommand(k);
  }

  keyCommand(k: string, fromButton = false) {
    const { local } = this.h;
    const units = this.ownSelectedUnits();
    const ids = units.map((u) => u.id);
    const blds = this.ownSelectedBuildings();
    // spectators keep the camera and selection keys only
    if (this.spectator && k.length === 1 && 'sagxdzrpm '.includes(k)) return;
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
      case 'd':
        if (ids.length) this.h.issue({ c: 'deploy', player: local.id, units: ids });
        break;
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
        if (blds.length === 1) this.h.issue({ c: 'primary', player: local.id, building: blds[0].id });
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
        this.h.message(this.follow ? 'Camera following the selection (F or scroll to release)' : 'Camera released');
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
    const cam = this.h.gfx.cam;
    let px = 0, py = 0;
    if (this.keys.has('arrowleft')) px -= 1;
    if (this.keys.has('arrowright')) px += 1;
    if (this.keys.has('arrowup')) py -= 1;
    if (this.keys.has('arrowdown')) py += 1;
    if (this.edgeScroll && this.hasMoved && document.hasFocus() && !this.middleDown && !this.rightDown) {
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
    } else if (this.mode === 'place' && this.placeType) {
      const [cx, cy] = this.placementCell();
      const map = this.h.world.map;
      const valid = this.h.world.canPlace(this.h.local, this.placeType, cx, cy);
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
    } else this.h.reticle?.hide();
    this.updateCursor();
  }

  private updateCursor() {
    if (this.middleDown || this.rightDown?.moved) { document.body.dataset.cursor = 'pan'; this.applyCursor('pan'); return; }
    const t = this.pickAt(this.mouseX, this.mouseY);
    this.hovered = t ? t.id : 0;
    const local = this.h.local;
    let c = '';
    switch (this.mode) {
      case 'place': c = ''; break;
      case 'sell': c = t instanceof Building && t.owner === local ? 'sell' : 'nomove'; break;
      case 'repair': c = t instanceof Building && t.owner === local && t.hp < t.maxHp ? 'repair' : 'nomove'; break;
      case 'attackMove': case 'attackGround': c = 'attack'; break;
      case 'super': case 'layMines': c = 'target'; break;
      default: {
        const units = this.ownSelectedUnits();
        if (!units.length || this.spectator) { c = t ? 'select' : ''; break; }
        if (t && local.isEnemy(this.apparentOwner(t))) {
          c = units.some((u) => u.weapons.length || u.ut.engineer || u.ut.c4) ? (units.every((u) => u.ut.engineer) ? 'enter' : 'attack') : 'select';
        } else if (t instanceof Unit && t.owner === local && t.ut.passengers && units.some((u) => canCarry(t, u))) {
          c = 'enter';
        } else if (t instanceof Unit && t.ut.deploysInto && this.h.selection.has(t.id) && units.length === 1) {
          c = 'deploy';
        } else if (t instanceof Building && t.owner === local && ((t.bt.dock && units.some((u) => u.ut.harvester)) || (t.bt.repairPad && units.some((u) => u.kind === 'vehicle')) || (units.some((u) => u.ut.engineer) && t.hp < t.maxHp))) {
          c = 'enter';
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
}

/** Why a structure can't go where the player clicked. */
function placementText(issue: PlacementIssue, wall: boolean, water = false): string {
  switch (issue) {
    case 'no-yard': return 'You need a Construction Yard to build structures';
    case 'terrain': return water ? 'Cannot build here: shipyards and sub pens go on open water next to your base' : 'Cannot build here: needs clear, dry ground';
    case 'occupied': return 'Cannot build here: something is in the way';
    case 'exit': return 'Cannot build here: it would block a factory exit or refinery dock';
    case 'distance': return wall ? 'Too far from your base: walls must stay close to your structures' : 'Too far from your base: build next to your other structures';
  }
}
