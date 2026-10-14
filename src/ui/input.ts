import * as THREE from 'three';
import { BUILDINGS } from '../data/rules';
import { lerp } from '../core/util';
import { Building, Entity, Unit } from '../sim/entities';
import type { Player } from '../sim/player';
import type { SuperKind } from '../sim/superweapons';
import type { Command } from '../sim/types';
import type { World } from '../sim/world';
import type { GameRenderer } from '../render/renderer';
import type { EntityRenderer } from '../render/entities';
import type { Overlay } from '../render/overlay';
import type { PlacementGhost } from '../render/placement';
import type { Effects } from '../render/effects';
import type { AudioSystem } from '../audio';
import type { VoiceKind } from '../audio/types';

export type Mode = 'normal' | 'place' | 'sell' | 'repair' | 'attackMove' | 'attackGround' | 'super';

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
  if (u.kind === 'aircraft') return 'aircraft';
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
  private canvas: HTMLCanvasElement;
  private disposers: (() => void)[] = [];
  edgeScroll = true;
  unitVoices = true;

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
    on(document, 'pointerleave', () => { this.pointerInside = false; });
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e, true));
    on(window, 'keyup', (e: KeyboardEvent) => this.onKey(e, false));
    on(window, 'blur', () => this.keys.clear());
  }

  dispose() {
    for (const d of this.disposers) d();
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
      if (!u.alive || !ents.isShown(u.id)) continue;
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
      if (b && b.alive && ents.isShown(b.id)) return b;
    }
    // tall structures: screen-space box test
    for (const b of world.buildings) {
      if (!b.alive || !ents.isShown(b.id)) continue;
      const top = ents.topOf(b.id);
      const g = map.heightAt(b.x, b.y);
      const [x0, y0] = this.project(b.cx, g, b.cy + b.h);
      const [x1] = this.project(b.cx + b.w, g, b.cy + b.h);
      const [, yt] = this.project(b.x, g + top, b.y);
      if (sx >= Math.min(x0, x1) && sx <= Math.max(x0, x1) && sy >= yt && sy <= y0) return b;
    }
    return null;
  }

  /** Ground polygon visible on screen (for the minimap). */
  viewPolygon(): [number, number][] {
    const w = window.innerWidth - 312, hh = window.innerHeight;
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
      if (!u.alive || u.owner !== this.h.local) continue;
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

  private selectSameTypeOnScreen(typeId: string) {
    const ids: number[] = [];
    const W = window.innerWidth - 312, H = window.innerHeight;
    const map = this.h.world.map;
    for (const u of this.h.world.units) {
      if (!u.alive || u.owner !== this.h.local || u.ut.id !== typeId) continue;
      const [px, py] = this.project(u.x, map.surfaceAt(u.x, u.y), u.y);
      if (px >= 0 && px <= W && py >= 0 && py <= H) ids.push(u.id);
    }
    if (ids.length) this.select(ids);
  }

  // ---------------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------------
  setMode(m: Mode) {
    this.mode = m;
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
    if (kind === 'chrono' && !this.ownSelectedUnits().some((u) => u.kind === 'vehicle')) {
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
    switch (this.mode) {
      case 'place': {
        const [cx, cy] = this.placementCell();
        if (world.canPlace(local, this.placeType!, cx, cy)) {
          this.h.issue({ c: 'place', player: local.id, type: this.placeType!, cx, cy });
          this.h.audio.play('build_place');
          this.setMode('normal');
        } else {
          this.h.audio.play('error');
          this.h.audio.announce('cannot_build_here');
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
      case 'super': {
        const kind = this.superKind!;
        const unit = kind === 'chrono' ? this.ownSelectedUnits().find((u) => u.kind === 'vehicle') : undefined;
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
      this.command(e);
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
    if (t instanceof Unit && t.owner === this.h.local && t.ut.deploysInto && sel.size === 1 && sel.has(t.id)) {
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
    if (t && t.owner !== local && local.isEnemy(t.owner)) {
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
    if (t instanceof Unit && t.owner === local && t.ut.passengers && units.some((u) => u.kind === 'infantry')) {
      const inf = units.filter((u) => u.kind === 'infantry').map((u) => u.id);
      this.h.issue({ c: 'enter', player: local.id, units: inf, target: t.id });
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
    if (k === 'escape') {
      if (this.mode !== 'normal') this.setMode('normal');
      else this.h.openPauseMenu();
      return;
    }
    if (this.h.paused) return;
    if (k === 'tab' || k === 'alt') e.preventDefault();
    // control groups
    if (/^[0-9]$/.test(k)) {
      const g = +k;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const ids = this.ownSelectedUnits().map((u) => u.id);
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
      this.select(this.h.world.units.filter((u) => u.alive && u.owner === this.h.local && u.weapons.length && !u.ut.harvester).map((u) => u.id));
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    this.keyCommand(k);
  }

  keyCommand(k: string) {
    const { local } = this.h;
    const units = this.ownSelectedUnits();
    const ids = units.map((u) => u.id);
    const blds = this.ownSelectedBuildings();
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
        if (blds.length === 1 && blds[0].alive) this.h.issue({ c: 'sell', player: local.id, building: blds[0].id });
        else this.setMode(this.mode === 'sell' ? 'normal' : 'sell');
        break;
      case 'r':
        if (blds.length === 1) this.h.issue({ c: 'repair', player: local.id, building: blds[0].id });
        else this.setMode(this.mode === 'repair' ? 'normal' : 'repair');
        break;
      case 'p':
        if (blds.length === 1) this.h.issue({ c: 'primary', player: local.id, building: blds[0].id });
        break;
      case 'e':
        if (units.length) this.selectSameTypeOnScreen(units[0].ut.id);
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
    if (this.edgeScroll && this.hasMoved && this.pointerInside && document.hasFocus() && !this.middleDown && !this.rightDown) {
      const m = 4;
      if (this.mouseX <= m) px -= 1;
      if (this.mouseX >= window.innerWidth - m) px += 1;
      if (this.mouseY <= m) py -= 1;
      if (this.mouseY >= window.innerHeight - m) py += 1;
    }
    cam.pan(px, py, dt);

    const [gx, gy] = this.screenToGround(this.mouseX, this.mouseY);
    this.groundX = gx;
    this.groundY = gy;

    if (this.mode === 'place' && this.placeType) {
      const [cx, cy] = this.placementCell();
      const map = this.h.world.map;
      const valid = this.h.world.canPlace(this.h.local, this.placeType, cx, cy);
      this.h.placement.update(cx, cy, (dx, dy) => map.buildable(cx + dx, cy + dy), valid, time);
      const u = this.h.gfx.terrain.uniforms.uGrid.value;
      u.set(gx, gy, 7, 1);
    }
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
      case 'super': c = 'target'; break;
      default: {
        const units = this.ownSelectedUnits();
        if (!units.length) { c = t ? 'select' : ''; break; }
        if (t && local.isEnemy(t.owner)) {
          c = units.some((u) => u.weapons.length || u.ut.engineer || u.ut.c4) ? (units.every((u) => u.ut.engineer) ? 'enter' : 'attack') : 'select';
        } else if (t instanceof Unit && t.owner === local && t.ut.passengers && units.some((u) => u.kind === 'infantry')) {
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
          else if (map.ore[map.idx(cx, cy)] && units.some((u) => u.ut.harvester)) c = 'harvest';
          else c = map.passable(cx, cy) ? 'move' : 'nomove';
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
