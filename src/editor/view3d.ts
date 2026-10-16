/**
 * 3D preview / editing view built on the game's real renderer (GameRenderer: terrain, water,
 * vegetation, ore, weather, lighting) plus the bridge renderer and the unit / structure models for
 * mission placements. After edits the renderer rebuilds its map layers in place (GameRenderer.rebuildMap,
 * debounced by the editor); a new size or climate recreates the whole renderer. The camera survives both.
 */
import * as THREE from 'three';
import { GameRenderer, type Quality } from '../render/renderer';
import { BridgeRenderer } from '../render/bridges';
import { createModel, type ModelInstance } from '../render/models';
import { releaseGpuResources } from '../render/gpuregistry';
import type { WeatherKind } from '../render/weather';
import { buildMap } from '../maps/build';
import type { MapDef } from '../maps/format';
import { BUILDINGS, UNITS } from '../data/rules';
import type { GameMap } from '../sim/map';
import type { Player } from '../sim/player';
import { drawOverlay, type OverlayState, type Proj } from './overlay';
import type { MissionSpec } from './mission';

/** Same player colours as the game (game.ts TEAM_COLORS), without importing the whole game module. */
const TEAM_COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d, 0xe07b2a, 0x8e4fd0, 0x2aa8a8, 0x9aa0aa];
const _v = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();

export interface View3DOptions {
  quality: Quality;
  hours: number;
  weather: WeatherKind | 'auto';
}

export class View3D {
  private host: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  readonly overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  gfx: GameRenderer | null = null;
  map: GameMap | null = null;
  private bridges: BridgeRenderer | null = null;
  private models: ModelInstance[] = [];
  private modelKey = '';
  private builtKey = '';
  private cam = { x: -1, y: -1, dist: 52, yaw: 0 };
  private keys = new Set<string>();
  opts: View3DOptions;
  /** Seconds the last rebuild took (shown in the status bar). */
  lastBuild = 0;

  constructor(host: HTMLElement, opts: View3DOptions) {
    this.host = host;
    this.opts = opts;
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'ed-canvas ed-3d-overlay';
    host.appendChild(this.overlay);
    this.octx = this.overlay.getContext('2d')!;
    this.resize();
  }

  get ready(): boolean {
    return !!this.gfx;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.round(window.innerWidth * dpr);
    this.overlay.height = Math.round(window.innerHeight * dpr);
  }

  /** (Re)build the renderer for this map definition unless it already shows exactly that. */
  rebuild(def: MapDef, key: string) {
    if (this.gfx && key === this.builtKey) return;
    const t0 = performance.now();
    // same size and climate: rebuild terrain, water, forests and ore in place (no new WebGL context)
    const next = buildMap(def);
    if (this.gfx && this.map && this.map.w === next.w && this.map.h === next.h && this.map.climate === next.climate) {
      this.map = next;
      this.builtKey = key;
      this.gfx.rebuildMap(next);
      const n = next.w * next.h;
      this.gfx.fog.snap({ visible: new Uint8Array(n).fill(1), explored: new Uint8Array(n).fill(1) } as unknown as Player);
      this.bridges?.dispose();
      this.bridges = new BridgeRenderer({ heightAt: (x, y) => next.heightAt(x, y), climate: next.climate, effects: null });
      this.gfx.scene.add(this.bridges.group);
      this.bridges.update(next.bridges.map((b, i) => ({ id: i + 1, cells: b.cells, axis: b.axis, hp: 1, maxHp: 1, alive: true })), 0, 0);
      this.modelKey = ''; // placements sit on the new ground
      this.lastBuild = (performance.now() - t0) / 1000;
      return;
    }
    if (this.gfx) {
      const c = this.gfx.cam;
      this.cam = { x: c.x, y: c.y, dist: c.targetDist, yaw: c.targetYaw };
    }
    this.teardown();
    const map = next;
    this.map = map;
    this.builtKey = key;
    const canvas = document.createElement('canvas');
    canvas.className = 'ed-canvas ed-3d';
    this.host.insertBefore(canvas, this.overlay);
    this.canvas = canvas;
    const gfx = new GameRenderer(canvas, map, { quality: this.opts.quality, timeOfDay: this.opts.hours >= 19.5 || this.opts.hours < 5 ? 'night' : this.opts.hours >= 17 ? 'dusk' : 'day', climate: map.climate });
    this.gfx = gfx;
    gfx.dynamicResolution = false;
    // no fog of war in the editor: everything visible and explored
    const n = map.w * map.h;
    gfx.fog.enabled = false;
    gfx.fog.snap({ visible: new Uint8Array(n).fill(1), explored: new Uint8Array(n).fill(1) } as unknown as Player);
    this.bridges = new BridgeRenderer({ heightAt: (x, y) => map.heightAt(x, y), climate: map.climate, effects: null });
    gfx.scene.add(this.bridges.group);
    this.bridges.update(map.bridges.map((b, i) => ({ id: i + 1, cells: b.cells, axis: b.axis, hp: 1, maxHp: 1, alive: true })), 0, 0);
    this.applyLook();
    // first build (or another map size): overview of the whole map
    if (this.cam.x < 0 || this.cam.x > map.w || this.cam.y > map.h) this.cam = { x: map.w / 2, y: map.h / 2 + 4, dist: 52, yaw: 0 };
    gfx.cam.maxDist = 64;
    gfx.cam.jumpTo(Math.min(map.w - 2, this.cam.x), Math.min(map.h - 2, this.cam.y));
    gfx.cam.dist = gfx.cam.targetDist = this.cam.dist;
    gfx.cam.yaw = gfx.cam.targetYaw = this.cam.yaw;
    this.modelKey = '';
    this.lastBuild = (performance.now() - t0) / 1000;
  }

  /** Time of day and weather preview. */
  applyLook() {
    if (!this.gfx) return;
    this.gfx.setTimeOfDay(this.opts.hours);
    const wx = this.opts.weather === 'auto' ? (this.map?.climate === 'winter' ? 'snow' : 'clear') : this.opts.weather;
    this.gfx.weather.set(wx as WeatherKind, 0);
  }

  /** Mission placements as real models (rebuilt when they change). */
  syncModels(mission: MissionSpec | null, show: boolean) {
    if (!this.gfx || !this.map) return;
    const key = show && mission ? JSON.stringify(mission.placements) + mission.players.length : '';
    if (key === this.modelKey) return;
    this.modelKey = key;
    for (const m of this.models) { this.gfx.scene.remove(m.root); m.dispose(); }
    this.models = [];
    if (!key || !mission) return;
    const map = this.map;
    for (const pl of mission.placements) {
      const color = new THREE.Color(TEAM_COLORS[pl.player % TEAM_COLORS.length]);
      try {
        const m = createModel(pl.type, color);
        if (pl.kind === 'structure') {
          const bt = BUILDINGS[pl.type];
          if (!bt) continue;
          const x = Math.round(pl.x) + bt.size[0] / 2, y = Math.round(pl.y) + bt.size[1] / 2;
          m.root.position.set(x, map.surfaceAt(x, y), y);
        } else {
          if (!UNITS[pl.type]) continue;
          const air = UNITS[pl.type].kind === 'aircraft';
          m.root.position.set(pl.x, map.surfaceAt(pl.x, pl.y) + (air ? 1.6 : 0), pl.y);
          m.root.rotation.y = Math.PI / 2;
        }
        m.update({ time: 0, dt: 0, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: pl.health ?? 1, door: 0, load: 0, harvesting: false, charge: 0, dying: 0 });
        this.gfx.scene.add(m.root);
        this.models.push(m);
      } catch (e) {
        console.warn('editor: model failed', pl.type, e);
      }
    }
  }

  keyDown(code: string) { this.keys.add(code); }
  keyUp(code: string) { this.keys.delete(code); }
  clearKeys() { this.keys.clear(); }

  zoom(delta: number) { this.gfx?.cam.zoomBy(delta); }
  rotate(dir: number) { if (this.gfx) this.gfx.cam.targetYaw += dir * (Math.PI / 4); }

  /** Drag the ground by a screen delta (pixels). */
  dragPixels(dx: number, dy: number) {
    const g = this.gfx;
    if (!g) return;
    const k = g.cam.dist / window.innerHeight * 1.1;
    const c = Math.cos(g.cam.yaw), s = Math.sin(g.cam.yaw);
    g.cam.dragBy((dx * c - dy * s) * k, (dx * s + dy * c) * k);
  }

  /** Map point under a screen position (ray marched onto the terrain). */
  toMap(sx: number, sy: number): [number, number] | null {
    if (!this.gfx || !this.map) return null;
    const cam = this.gfx.cam.camera;
    _ndc.set((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    _ray.setFromCamera(_ndc, cam);
    const o = _ray.ray.origin, d = _ray.ray.direction;
    const map = this.map;
    let h = 0, x = o.x, z = o.z;
    for (let i = 0; i < 6; i++) {
      if (Math.abs(d.y) < 1e-4) return null;
      const t = (h - o.y) / d.y;
      if (t < 0) return null;
      x = o.x + d.x * t;
      z = o.z + d.z * t;
      h = map.surfaceAt(Math.max(0, Math.min(map.w, x)), Math.max(0, Math.min(map.h, z)));
    }
    return [x, z];
  }

  frame(dt: number, time: number, o: OverlayState | null) {
    const g = this.gfx;
    const ctx = this.octx;
    const dpr = this.overlay.width / window.innerWidth;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!g || !this.map) return;
    const kx = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const ky = (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);
    g.cam.pan(kx, ky, dt);
    this.bridges?.update(this.map.bridges.map((b, i) => ({ id: i + 1, cells: b.cells, axis: b.axis, hp: 1, maxHp: 1, alive: true })), dt, time);
    g.render(dt, time);
    if (!o) return;
    const map = this.map;
    const cam = g.cam.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const proj: Proj = (x, y) => {
      _v.set(x, map.surfaceAt(Math.max(0, Math.min(map.w, x)), Math.max(0, Math.min(map.h, y))) + 0.05, y).project(cam);
      if (_v.z > 1 || _v.z < -1) return null;
      return [(_v.x * 0.5 + 0.5) * W, (-_v.y * 0.5 + 0.5) * H];
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay(ctx, proj, { ...o, guides: false, models: true }, time);
  }

  private teardown() {
    if (!this.gfx) return;
    for (const m of this.models) { this.gfx.scene.remove(m.root); m.dispose(); }
    this.models = [];
    this.bridges?.dispose();
    this.bridges = null;
    releaseGpuResources();
    this.gfx.dispose();
    this.gfx.renderer.forceContextLoss();
    this.gfx = null;
    this.canvas?.remove();
    this.canvas = null;
  }

  /** Forget the built map (next rebuild always rebuilds). */
  invalidate() {
    this.builtKey = '';
  }

  dispose() {
    this.teardown();
    this.overlay.remove();
  }
}
