import * as THREE from 'three';
import { BAIL_COUNT, raTicksToSeconds, type ExplosionKind } from '../data/rules';
import { lerp, lerpAngle } from '../core/util';
import { Building, Entity, Unit } from '../sim/entities';
import type { Player } from '../sim/player';
import { DT, type GameEvent } from '../sim/types';
import type { World } from '../sim/world';
import type { Projectile } from '../sim/combat';
import { createModel, holdHdModel, modelKey, requestHdModel } from './models';
import { hdReadyVersion, hdSwapMoment, releaseHd } from './models/hd'; // lazy per-type HD loading
import type { ModelAnimState, ModelInstance } from './models/types';
import { bodyMaterial, BodyVariant, setLitMaterialPatch } from './models/materials';
import type { Effects } from './effects';
import type { EmitterHandle, ProjectileHandle } from './effects/types';
import type { FogOfWar } from './fog';
import { createHoloMaterial } from './holo';
import { Water } from './water';
import { cloakHidden, contentAnim, perceived } from './contentview';
import { PARACHUTE_SECONDS } from '../sim/powers';
import { patchMaterialForWeather, type WeatherSurfaceUniforms } from './weather';
import { Destruction } from './destruction';
import { applyVisualScale, patchModelRim } from './scale'; // render-only unit scale + rim light
import { InfantryCrowd, setInfantryCrowd } from './models/infantry-hd'; // instanced HD infantry
import { breakUpgradeModules, tickUpgradeModules, updateCommanderView } from './models/upgrade-modules'; // Commander structures
import { paletteVersion, ringColors, setPaletteLocal, teamColor as paletteColor } from '../ui/a11y'; // team colour palettes (display only)

type DeathHow = 'normal' | 'blown' | 'burn' | 'electro' | 'bite' | 'crushed' | 'sold';

interface View {
  ent: Entity;
  model: ModelInstance;
  anim: ModelAnimState;
  dead: boolean;
  deathT: number;
  deathHow: DeathHow;
  smoke: EmitterHandle | null;
  fire: EmitterHandle | null;
  chimneys: EmitterHandle[];
  dustT: number;
  fade: number;
  lastBuildAnim: number;
  baseScale: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Hologram shell shown while a structure is being built. */
  holo: ModelInstance | null;
  holoRing: THREE.Mesh | null;
  /** Enemy structures under fog are drawn as last seen ("ghosts"): has the player seen this one yet? */
  seen: boolean;
  /** Seen before but currently outside vision: frozen in its last-seen state. */
  fogged: boolean;
  /** Destroyed while fogged: the ghost stays until the player looks again. */
  ghostDead: boolean;
  wasExplored: boolean;
  /** Inside the (shadow-expanded) camera frustum at the last render; culled views skip animation and matrix updates. */
  inView: boolean;
  /** model.update was skipped this frame because the view was culled. */
  animSkipped: boolean;
  /** Type and owner the local player perceives (a disguised spy looks like an enemy rifleman). */
  ptype: string;
  powner: number;
  /** Contrails behind support planes (Badger, U2), one per exhaust point. */
  trails: ProjectileHandle[] | null;
  /** The destruction system took over this structure's death (fracture + collapse). */
  collapsed?: boolean;
  /** Has been on screen at least once (a swap to HD after that must be hidden by something). */
  hdShown?: boolean;
  /** Its HD model has loaded: swap at the next unseen moment. */
  hdReady?: boolean;
  /** Pending ref on the HD template while waiting (released on swap / removal). */
  hdHold?: string | null;
  /** hdReadyVersion() when this view last asked for its template. */
  hdVer?: number;
  /** Tall smoke column over a badly damaged structure / a big burning wreck. */
  column?: EmitterHandle | null;
  /** Seconds a wreck keeps burning (bigger vehicles burn longer). */
  burn?: number;
}

/** Paratroopers jump from this height above the ground (world units). */
const DROP_HEIGHT = 3.2;

interface ProjView {
  handle: ProjectileHandle;
  offset: THREE.Vector3;
  startDist: number;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Reused sea-surface sample for ships. */
const _swell = { y: 0, nx: 0, ny: 1, nz: 0 };
const _v = new THREE.Vector3();
const _e = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _jv = new THREE.Vector3(); // scratch

/**
 * Weather surface uniforms shared by every model material for the lifetime of the page. Model materials
 * are cached across matches, so they bind to this stable object and each match's weather values are
 * copied in per frame (binding a match's own uniforms would leave the next match's models dry).
 */
const WX: WeatherSurfaceUniforms = { uWxWet: { value: 0 }, uWxSnow: { value: 0 }, uWxSky: { value: new THREE.Color() } };
const patchWx = (m: THREE.MeshStandardMaterial) => { patchMaterialForWeather(m, WX); patchModelRim(m); }; // + rim light

/** Camera height above which infantry stop casting shadows (a couple of pixels at that zoom). */
const SMALL_SHADOW_HEIGHT = 34;
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();


/** Keeps a 3D model per simulation entity in sync, and turns sim events into visual effects. */
export class EntityRenderer {
  readonly views = new Map<number, View>();
  private projViews = new Map<number, ProjView>();
  private teamColors = new Map<number, THREE.Color>();
  private ringGeo = new THREE.RingGeometry(0.86, 1, 40);
  private ringMats: Record<'own' | 'ally' | 'enemy' | 'iron', THREE.MeshBasicMaterial>;
  private rings = new Map<number, THREE.Mesh>();
  private bracketMat: THREE.ShaderMaterial;
  private holoMat = createHoloMaterial(0x46c8ff);
  /** Same hologram for skinned meshes (shared uniforms; a separate material avoids program ping-pong). */
  private holoMatSk = (() => { const m = this.holoMat.clone(); m.uniforms = this.holoMat.uniforms; return m; })();
  private ringMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { opacity: { value: 0.8 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float opacity; varying vec2 vUv;
      void main(){
        vec2 d = min(vUv, 1.0 - vUv);
        float edge = min(d.x, d.y);
        float line = smoothstep(0.035, 0.0, edge);
        float glow = smoothstep(0.18, 0.0, edge) * 0.25;
        gl_FragColor = vec4(vec3(1.0, 2.6, 3.4) * (line + glow), (line + glow + 0.03) * opacity);
      }`,
  });
  private ringGeo2 = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private time = 0;
  /** Bridge deck height at a map position, if a deck is there (set by the game from the bridge renderer). */
  deckHeight: ((x: number, y: number) => number | null) | null = null;
  /** Set after the first update: views created later are 'new' (built in the fog, unseen). */
  private primed = false;
  private wxSource: WeatherSurfaceUniforms | null = null;
  private seenProj = new Set<number>();
  private smallShadows = true;
  /** When set, model materials get rain gloss / snow cover from the weather system. */
  get weatherUniforms(): WeatherSurfaceUniforms | null {
    return this.wxSource;
  }
  set weatherUniforms(u: WeatherSurfaceUniforms | null) {
    this.wxSource = u;
    // every lit model material (all damage variants, existing and future) shares one patched program
    if (u) setLitMaterialPatch(patchWx);
  }
  /** Vehicles whose wrecks linger. */
  private wreckTime = 22;
  /** Structure collapse, wreck / debris physics, ragdolls, craters, damage stages. */
  readonly destruction: Destruction;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private effects: Effects,
    private local: Player,
    private fog: FogOfWar,
  ) {
    const mk = (c: number, o = 0.85) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.ringCols = ringColors();
    this.ringMats = { own: mk(this.ringCols.own), ally: mk(this.ringCols.ally), enemy: mk(this.ringCols.enemy), iron: mk(0xff2020, 0.7) };
    this.palVer = paletteVersion();
    this.palLocal = local;
    setPaletteLocal(local);
    // flat additive rings: one pass is identical (three would draw double-sided transparents twice)
    for (const m of Object.values(this.ringMats)) m.forceSinglePass = true;
    this.ringMat.forceSinglePass = true;
    this.ringGeo.rotateX(-Math.PI / 2);
    this.bracketMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x58ff8a) }, uTime: { value: 0 }, uAspect: { value: new THREE.Vector2(1, 1) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uTime; uniform vec2 uAspect; varying vec2 vUv;
        void main(){
          vec2 p = (vUv - 0.5) * uAspect;
          vec2 h = uAspect * 0.5;
          vec2 d = abs(p) - (h - 0.06);
          float border = abs(max(d.x, d.y));
          float line = smoothstep(0.045, 0.0, border);
          // only corners
          vec2 corner = step(h - 0.35, abs(p));
          float c = max(corner.x * corner.y, 0.0);
          float a = line * c * (0.75 + 0.25 * sin(uTime * 4.0));
          gl_FragColor = vec4(uColor * 2.0, a);
        }`,
    });
    // never-drawn stand-ins: materials that first appear mid-battle (selection rings and brackets, the
    // construction hologram on rigid and skinned models) get compiled on the loading screen with the scene
    const warm = this.warm;
    warm.name = 'entities-warmup';
    warm.visible = false;
    for (const m of [this.ringMats.own, this.bracketMat, this.ringMat, this.holoMat]) warm.add(new THREE.Mesh(this.ringGeo2, m));
    const sg = new THREE.PlaneGeometry(0.01, 0.01);
    const n = sg.attributes.position.count;
    sg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    sg.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4));
    warm.add(new THREE.SkinnedMesh(sg, this.holoMatSk));
    scene.add(warm);
    this.destruction = new Destruction(scene, effects, world.map);
    this.crowd = new InfantryCrowd(scene); // HD infantry: one instanced draw per soldier template
    setInfantryCrowd(this.crowd);
  }

  private warm = new THREE.Group();

  teamColor(p: Player): THREE.Color {
    let c = this.teamColors.get(p.id);
    if (!c) { c = new THREE.Color(paletteColor(p, this.local)); this.teamColors.set(p.id, c); }
    return c;
  }

  /** Selection ring colours of the active palette. */
  private ringCols: { own: number; ally: number; enemy: number };
  private palVer: number;
  private palLocal: Player;

  /** The team colour palette or the viewing player changed: re-colour the rings, then every model whose colour changed. */
  private refreshPalette() {
    this.palVer = paletteVersion();
    this.palLocal = this.local;
    setPaletteLocal(this.local);
    this.ringCols = ringColors();
    this.ringMats.own.color.setHex(this.ringCols.own);
    this.ringMats.ally.color.setHex(this.ringCols.ally);
    this.ringMats.enemy.color.setHex(this.ringCols.enemy);
    const old = new Map([...this.teamColors].map(([id, c]) => [id, c.getHex()]));
    this.teamColors.clear();
    for (const v of this.views.values()) {
      if (v.dead || !v.ent.alive) continue;
      const owner = this.ownerOf(v);
      const was = old.get(owner.id);
      if (was !== undefined && was === this.teamColor(owner).getHex()) continue;
      this.recolor(v, v.ptype, owner);
      if (v.ent instanceof Building) this.clearHolo(v);
    }
  }

  private createView(e: Entity): View {
    const seenAs = e instanceof Unit ? perceived(this.world, this.local, e) : { type: e.type.id, owner: e.owner };
    // lazy loading: the first instance of a type starts its HD load and renders procedural meanwhile
    const hdWait = !(e instanceof Building && e.bt.wall) && requestHdModel(seenAs.type, seenAs.owner.faction) === 'pending';
    const model: ModelInstance = e instanceof Building && e.bt.wall
      ? { root: new THREE.Group(), muzzles: [], height: 0.6, radius: 0.5, update() {}, dispose() { this.root.removeFromParent(); } }
      : createModel(seenAs.type, this.teamColor(seenAs.owner), seenAs.owner.faction); // faction dressing
    this.scene.add(model.root);
    const wx = !!this.wxSource;
    model.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const sm = m as THREE.MeshStandardMaterial;
        // other lit materials a model brings along (body/track materials are patched at creation)
        if (wx && sm.isMeshStandardMaterial && !sm.userData.wx && !sm.transparent) {
          sm.userData.wx = true;
          patchWx(sm);
        }
        // additive double-sided fx render identically in one pass (no per-draw program re-checks)
        if (m.transparent && m.side === THREE.DoubleSide && m.blending === THREE.AdditiveBlending) m.forceSinglePass = true;
        if (e.kind === 'infantry' && !this.smallShadows && !m.transparent) mesh.castShadow = false;
      }
    });
    const anim: ModelAnimState = {
      time: 0, dt: 0, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: 1,
      door: 0, load: 0, harvesting: false, charge: 0, dying: 0, altitude: 0,
    };
    const v: View = {
      ent: e, model, anim, dead: false, deathT: 0, deathHow: 'normal', smoke: null, fire: null, chimneys: [],
      dustT: 0, fade: 0, lastBuildAnim: 0, baseScale: 1, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), holo: null, holoRing: null,
      // structures present when the battle (or a save) starts count as known wherever the map is already explored;
      // anything built later inside the fog stays hidden until scouted
      seen: false, fogged: false, ghostDead: false, wasExplored: this.primed && e instanceof Building && this.buildingExplored(e),
      inView: true, animSkipped: false, ptype: seenAs.type, powner: seenAs.owner.id, trails: null,
    };
    if (e instanceof Unit) v.baseScale = applyVisualScale(model, e.kind, seenAs.type); // render-only unit scale
    if (e instanceof Building) {
      // surfaceAt: structures built on water (shipyard, sub pen) stand on the surface, not the lake bed
      model.root.position.set(e.x, this.world.map.surfaceAt(e.x, e.y), e.y);
      if (e.buildAnim < 1) this.effects.constructionBurst(new THREE.Vector3(e.x, this.world.map.surfaceAt(e.x, e.y), e.y), Math.max(e.w, e.h));
    }
    this.views.set(e.id, v);
    if (hdWait) { this.hdWaiting.add(v); v.hdHold = holdHdModel(seenAs.type, seenAs.owner.faction); } // the hold keeps the template from the sweep
    if (e instanceof Building && !e.bt.wall) this.destruction.prepare(modelKey(seenAs.type, seenAs.owner.faction), [e.w, e.h]); // bake its fracture in idle time (per-faction dressing)
    return v;
  }

  /** Views whose type's HD model is loading (see hdSwaps). */
  private hdWaiting = new Set<View>();

  /**
   * Swap views to their HD model once it has loaded, only when nobody can see the switch: before the view
   * was ever on screen, while it is hidden or off-screen, during a structure's construction (the hologram and
   * the build-up cover it), or while a unit is still inside the structure it is leaving (a factory exit).
   * A finished, on-screen structure stays procedural (its next instance is HD); a unit waits for such a moment.
   */
  private hdSwaps() {
    const ver = hdReadyVersion();
    // at most a few swaps per frame: the first instance of a type uploads its atlases (a burst of new types
    // uploading in one frame stalls software GL for seconds)
    let budget = 3;
    for (const v of this.hdWaiting) {
      if (budget <= 0) break;
      const e = v.ent;
      if (v.dead || !e.alive) { this.hdDone(v); continue; }
      if (!v.hdReady) {
        // re-asked only when a template finished loading since this view last asked (allocation-free frames
        // otherwise; per view, so a view that joins mid-frame never misses a load)
        if (v.hdVer === ver) continue;
        v.hdVer = ver;
        const st = requestHdModel(v.ptype, this.ownerOf(v).faction);
        if (st === 'pending') continue;
        if (st === 'none') { this.hdDone(v); continue; }
        v.hdReady = true;
      }
      // swap only unseen: never shown yet, hidden (fog) or off-screen; under construction (hologram + build-up);
      // a unit still inside the structure it is leaving. A finished structure on screen waits for such a moment.
      const ok = hdSwapMoment({
        shown: !!v.hdShown, visible: v.model.root.visible, inView: v.inView,
        constructing: e instanceof Building && e.buildAnim < 1 && e.selling < 0,
        insideStructure: e instanceof Unit && v.hdShown && v.inView && this.insideStructure(e),
      });
      if (!ok) continue;
      budget--;
      this.recolor(v, v.ptype, this.ownerOf(v)); // (the new instance takes its live ref before the hold goes)
      if (e instanceof Building) this.clearHolo(v); // re-created from the HD model next frame
      if ((v.model as { hd?: boolean }).hd) this.hdDone(v);
      else { v.hdReady = false; v.hdVer = -1; } // the template went away in between: ask again, keep waiting
    }
  }

  /** Stop waiting: drop the view from the set and release its pending ref. */
  private hdDone(v: View) {
    this.hdWaiting.delete(v);
    releaseHd(v.hdHold);
    v.hdHold = null;
  }

  /** The player a view is drawn as owned by (a spy's disguise). */
  private ownerOf(v: View): Player {
    for (const p of this.world.players) if (p.id === v.powner) return p;
    return v.ent.owner;
  }

  /** A unit still inside a structure's footprint (rolling out of a factory). */
  private insideStructure(u: Unit): boolean {
    for (const b of this.world.buildings) {
      if (!b.alive || b.bt.wall) continue;
      if (u.x >= b.cx && u.x <= b.cx + b.w && u.y >= b.cy && u.y <= b.cy + b.h) return true;
    }
    return false;
  }

  /** Change an entity's team colour (capture) or apparent type (spy disguise) by recreating its model. */
  private recolor(v: View, type = v.ent.type.id, owner = v.ent.owner) {
    v.ptype = type;
    v.powner = owner.id;
    const pos = v.model.root.position.clone();
    const rot = v.model.root.quaternion.clone(); // (units slerp towards their heading: keep it across swaps)
    const vis = v.model.root.visible;
    v.model.dispose();
    v.model = createModel(type, this.teamColor(owner), owner.faction);
    if (v.ent instanceof Unit) v.baseScale = applyVisualScale(v.model, v.ent.kind, type); // render-only unit scale
    v.model.root.position.copy(pos);
    v.model.root.quaternion.copy(rot);
    v.model.root.visible = vis;
    this.scene.add(v.model.root);
    for (const c of v.chimneys) c.dispose();
    v.chimneys = [];
  }

  /** Secondary weapons use the second pair of fire points when the model has them (Mammoth missile pods). */
  private muzzleIndex(id: number, weaponId: string, muzzle: number): number {
    const v = this.views.get(id);
    if (!v) return muzzle;
    const e = v.ent;
    if (e instanceof Unit && e.ut.secondary === weaponId && e.ut.primary !== weaponId && v.model.muzzles.length >= 4) return 2 + (muzzle % 2);
    return muzzle;
  }

  /** World-space muzzle position of an entity (falls back to body centre). */
  muzzleWorld(id: number, muzzle: number, out: THREE.Vector3): boolean {
    const v = this.views.get(id);
    if (!v || !v.model.muzzles.length) return false;
    const m = v.model.muzzles[muzzle % v.model.muzzles.length];
    v.model.root.updateMatrixWorld(true);
    m.getWorldPosition(out);
    return true;
  }

  /** World-space position of a structure's firing slit `m<slit>` (models without that many muzzles use m0). */
  private slitWorld(id: number, slit: number, out: THREE.Vector3): boolean {
    const v = this.views.get(id);
    if (!v || !v.model.muzzles.length) return false;
    const m = v.model.muzzles[slit >= 0 && slit < v.model.muzzles.length ? slit : 0];
    v.model.root.updateMatrixWorld(true);
    m.getWorldPosition(out);
    return true;
  }

  isShown(id: number): boolean {
    const v = this.views.get(id);
    return !!v && v.model.root.visible;
  }

  /** Shown with its live state (not a fogged last-seen ghost). */
  isLive(id: number): boolean {
    const v = this.views.get(id);
    return !!v && v.model.root.visible && !v.fogged;
  }

  /** Structures as the local player knows them (ghosts included), for the radar. */
  structureMarkers(): Iterable<{ cx: number; cy: number; w: number; h: number; color: number }> {
    // a reused list of reused records (read immediately by the radar; no per-call allocations)
    const out = this.markers;
    let n = 0;
    for (const v of this.views.values()) {
      const b = v.ent;
      if (!(b instanceof Building) || b.bt.wall || !v.model.root.visible || (v.dead && !v.ghostDead)) continue;
      const m = this.markerPool[n] ?? (this.markerPool[n] = { cx: 0, cy: 0, w: 0, h: 0, color: 0 });
      m.cx = b.cx; m.cy = b.cy; m.w = b.w; m.h = b.h; m.color = paletteColor(b.owner, this.local);
      out[n++] = m;
    }
    out.length = n;
    return out;
  }
  private markers: { cx: number; cy: number; w: number; h: number; color: number }[] = [];
  private markerPool: { cx: number; cy: number; w: number; h: number; color: number }[] = [];

  handleEvent(ev: GameEvent) {
    switch (ev.e) {
      case 'death': {
        const v = this.views.get(ev.id);
        if (!v) return;
        if (v.fogged && v.ent instanceof Building) {
          // destroyed out of sight: the player keeps seeing the ruin-to-be until they look again
          v.ghostDead = true;
          return;
        }
        v.dead = true;
        v.deathT = 0;
        v.deathHow = ev.how;
        const e = v.ent;
        const p = new THREE.Vector3(v.model.root.position.x, v.model.root.position.y, v.model.root.position.z);
        const shown = v.model.root.visible;
        if (ev.how === 'sold') {
          if (!(e instanceof Building)) this.removeView(e.id);
          return;
        }
        if (!shown) { this.removeView(e.id); return; }
        if (e instanceof Building && e.bt.wall) {
          this.effects.explosion(p.clone().setY(p.y + 0.3), 'small', 1.2);
        } else if (e instanceof Building) {
          this.destruction.crater(p.x, p.z, Math.max(e.w, e.h) * 0.55, 0.05); // before the scorch so it lies in the crater
          this.effects.explosion(p.clone().setY(p.y + 0.3), 'building', Math.max(e.w, e.h));
          this.effects.scorch(p, Math.max(e.w, e.h) * 1.1);
          // the structure breaks apart into physics-driven chunks
          if (e.buildAnim >= 1 && e.selling < 0) v.collapsed = this.destruction.collapse(e.id, modelKey(v.ptype, e.owner.faction), this.teamColor(e.owner).getHex(), v.model, [e.w, e.h]); // modelKey
          if (v.collapsed) breakUpgradeModules(v.model, this.destruction.physics); // modules topple off
        } else if (e.kind === 'vehicle' || e.kind === 'aircraft') {
          const u = e as Unit;
          this.destruction.onImpact(p.x, p.z, p.y, 'large', 1); // crater under the wreck
          this.effects.explosion(p.clone().setY(p.y + 0.25), 'large', e.type.id === '4tnk' || e.type.id === 'harv' || e.type.id === 'mcv' ? 1.3 : 1);
          this.effects.scorch(p, 1.1);
          this.charWreck(v);
          v.fire = this.effects.createEmitter('fire', p.clone().setY(p.y + 0.3));
          v.fire.setIntensity(0.7);
          this.juiceWreck(v, u, p); // cook-off, longer burn, smoke column
          // the wreck bounces and settles, the turret may pop off, parts fly
          this.destruction.vehicleDeath(e.id, v.model, this.teamColor(e.owner).getHex(), ev.how, !!u.ut.tracked, e.kind === 'vehicle' && !u.ut.tracked, e.kind === 'aircraft' ? u.altitude : 0);
        } else {
          if (ev.how === 'crushed') {
            this.effects.bloodSplat(p);
            v.model.root.scale.set(1.2 * v.baseScale, 0.08 * v.baseScale, 1.2 * v.baseScale); // keep the visual scale
          } else if (ev.how === 'burn' || ev.how === 'electro') {
            this.effects.scorch(p, 0.35);
          } else if (ev.how === 'blown') {
            this.effects.bloodSplat(p);
          }
          v.anim.deathKind = ev.how;
          if (e.kind === 'infantry') this.destruction.infantryDeath(e.id, v.model, ev.how); // ragdoll
        }
        break;
      }
      case 'placed': {
        const e = this.world.getEntity(ev.id);
        if (e instanceof Building) {
          const v = this.views.get(e.id) ?? this.createView(e);
          v.lastBuildAnim = 0;
        }
        break;
      }
      case 'captured': {
        const v = this.views.get(ev.id);
        if (v) this.recolor(v);
        break;
      }
      case 'fire':
        this.onFire(ev);
        break;
      case 'impact': {
        _v.set(ev.x, ev.z, ev.y);
        if (this.fog.visibilityAt(ev.x, ev.y) < 0.2 && ev.kind !== 'nuke') return;
        this.destruction.onImpact(ev.x, ev.y, ev.z, ev.kind, ev.scale); // crater first, so the scorch lies in it
        this.effects.explosion(_v.clone(), ev.kind, ev.scale);
        if (ev.kind === 'medium' || ev.kind === 'large' || ev.kind === 'huge') {
          const g = this.world.map.heightAt(ev.x, ev.y);
          if (ev.z - g < 0.5) this.effects.scorch(new THREE.Vector3(ev.x, g, ev.y), ev.kind === 'huge' ? 2.2 : ev.kind === 'large' ? 1.2 : 0.7);
        }
        break;
      }
      case 'harvest':
        if (this.fog.visibilityAt(ev.x, ev.y) > 0.3) this.effects.oreSparkle(new THREE.Vector3(ev.x, this.world.map.heightAt(ev.x, ev.y) + 0.15, ev.y), ev.gems);
        break;
      case 'teleport': {
        // a chrono tank's own jump gets the rift between both ends
        if (this.views.get(ev.id)?.ent.type.id === 'ctnk') { this.destruction.chronoJump(ev.fromX, ev.fromY, ev.x, ev.y); break; }
        this.effects.chronoFlash(new THREE.Vector3(ev.fromX, this.world.map.surfaceAt(ev.fromX, ev.fromY), ev.fromY));
        this.effects.chronoFlash(new THREE.Vector3(ev.x, this.world.map.surfaceAt(ev.x, ev.y), ev.y));
        break;
      }
      case 'quake': // M.A.D. tank seismic pulse
        if (this.fog.visibilityAt(ev.x, ev.y) > 0.2) this.destruction.madPulse(ev.x, ev.y, ev.radius);
        break;
      case 'ironcurtain':
        this.effects.ironCurtainPulse(new THREE.Vector3(ev.x, this.world.map.surfaceAt(ev.x, ev.y) + 0.3, ev.y), 2);
        break;
    }
  }

  private onFire(ev: Extract<GameEvent, { e: 'fire' }>) {
    const shooterVisible = this.fog.visibilityAt(ev.fx, ev.fy) > 0.25;
    const targetVisible = this.fog.visibilityAt(ev.tx, ev.ty) > 0.25;
    if (!shooterVisible && !targetVisible) return;
    const v = this.views.get(ev.shooter);
    if (v) {
      v.anim.firing = 1;
      v.anim.firingMuzzle = ev.muzzle;
    }
    const from = _from.set(ev.fx, ev.fz, ev.fy);
    if (ev.via !== undefined) this.slitWorld(ev.via, ev.muzzle, from); // a bunker's garrison fires through the slit facing the target
    else this.muzzleWorld(ev.shooter, this.muzzleIndex(ev.shooter, ev.weapon.id, ev.muzzle), from);
    const to = _to.set(ev.tx, ev.tz, ev.ty);
    const dir = _v2.copy(to).sub(from).normalize();
    const w = ev.weapon;
    switch (w.projectile) {
      case 'bullet':
        this.effects.muzzleFlash(from, dir, w.damage >= 40 ? 0.8 : 0.5);
        this.effects.tracer(from, to, undefined, w.report === 'mg' ? 2 : 0); // machine-gun bursts
        if (targetVisible) this.effects.explosion(to, 'piff', 0.6);
        break;
      case 'flak':
        this.effects.muzzleFlash(from, dir, 0.7);
        this.effects.tracer(from, to, 0xffd080);
        this.effects.flakBurst(to, 2); // flak bursts in the sky
        break;
      case 'tesla':
        this.effects.teslaBolt(from, to);
        break;
      case 'flame':
      case 'fireball':
        if (w.projectile === 'flame') this.effects.flameStream(from, to);
        else this.effects.muzzleFlash(from, dir, 1);
        break;
      case 'heal':
        // the mechanic's wrench throws welding sparks
        if (w.warhead !== 'Mechanical' || !this.destruction.repair(to.x, to.y, to.z)) this.effects.healPulse(to);
        break;
      case 'melee':
        break;
      case 'cannon':
        this.effects.muzzleFlash(from, dir, w.damage >= 40 ? 1.3 : 1.0);
        break;
      case 'missile':
      case 'scud':
        this.effects.muzzleFlash(from, dir, 0.6);
        break;
      default:
        this.effects.muzzleFlash(from, dir, 1.2);
    }
  }

  /**
   * Burnt-out wreck: the body's own Charred variant (same shader program as the living model, so a death
   * never compiles a shader mid-battle); lamps, glows and fx go dark.
   */
  private charWreck(v: View) {
    const hex = this.teamColor(v.ent.owner).getHex();
    v.model.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.Material;
      if (mesh.geometry.getAttribute('pbr') && !m.transparent && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        mesh.material = bodyMaterial(hex, BodyVariant.Charred, false, (mesh as THREE.SkinnedMesh).isSkinnedMesh === true);
      }
      else if (mesh.geometry.getAttribute('pbr') && !m.transparent && m.name.startsWith('glow')) mesh.visible = false;
      else if (m.transparent) mesh.visible = false;
    });
    (v.model as { hdSync?: () => void }).hdSync?.(); // the HD body follows the procedural body's charred material
  }

  private clearHolo(v: View) {
    if (v.holo) { v.holo.dispose(); v.holo = null; }
    if (v.holoRing) { this.scene.remove(v.holoRing); v.holoRing = null; }
  }

  private removeView(id: number) {
    const v = this.views.get(id);
    if (!v) return;
    this.hdDone(v);
    this.destruction.forget(id);
    this.clearHolo(v);
    v.model.dispose();
    v.smoke?.dispose();
    v.fire?.dispose();
    v.column?.dispose();
    for (const c of v.chimneys) c.dispose();
    for (const t of v.trails ?? []) t.end();
    const r = this.rings.get(id);
    if (r) { this.scene.remove(r); this.rings.delete(id); }
    this.views.delete(id);
  }

  /** Per-frame sync. */
  update(alpha: number, dt: number, time: number, selected: Set<number>, hovered: number) {
    this.time = time;
    if (this.palVer !== paletteVersion() || this.palLocal !== this.local) this.refreshPalette();
    const world = this.world;
    const map = world.map;
    // the renderer calls back right before drawing, with this frame's camera (see preRender)
    this.scene.userData.preRender = this.preRender;
    if (this.wxSource) {
      WX.uWxWet.value = this.wxSource.uWxWet.value;
      WX.uWxSnow.value = this.wxSource.uWxSnow.value;
      WX.uWxSky.value.copy(this.wxSource.uWxSky.value);
    }
    // create views for new entities
    for (const u of world.units) if (!this.views.has(u.id)) this.createView(u);
    for (const b of world.buildings) if (!this.views.has(b.id)) this.createView(b);
    if (this.hdWaiting.size) this.hdSwaps();

    // values() rather than entries(): no [id, view] pair allocated per view per frame
    for (const v of this.views.values()) {
      const e = v.ent;
      const id = e.id;
      const anim = v.anim;
      anim.time = time;
      anim.dt = dt;
      anim.firing = Math.max(0, anim.firing - dt * 4);

      if (v.ghostDead) {
        if (this.buildingVisible(e as Building)) this.removeView(id);
        continue;
      }
      if (v.dead) {
        if (!this.updateDeath(v, dt)) this.removeView(id);
        continue;
      }
      if (!e.alive) {
        // removed without a death event (shouldn't happen) – clean up
        this.removeView(id);
        continue;
      }

      // ----- visibility (fog, plus cloaking: submerged subs, mines and camo pillboxes stay hidden unless detected)
      let show: boolean;
      const hidden = cloakHidden(world, this.local, e);
      if (e.owner.team === this.local.team) { show = true; v.fogged = false; }
      else if (e instanceof Building) {
        const explored = this.buildingExplored(e);
        if (!hidden && (this.buildingVisible(e) || (explored && !v.wasExplored))) v.seen = true; // in sight, or shroud just lifted
        v.wasExplored = explored;
        v.fogged = v.seen && !hidden && !this.buildingVisible(e);
        show = v.seen && !hidden;
      } else show = !hidden && this.fog.visibilityAt(e.x, e.y) > 0.5;
      // a spy's disguise changes what enemies see: swap the model when it does
      if (e instanceof Unit && e.ut.spy) {
        const as = perceived(world, this.local, e);
        if (as.type !== v.ptype || as.owner.id !== v.powner) this.recolor(v, as.type, as.owner);
      }
      v.model.root.visible = show;
      if (show && v.inView) v.hdShown = true;
      if (v.fogged) {
        // a ghost keeps its last-seen health, smoke and pose
        this.updateRing(v, selected.has(id) || hovered === id, selected.has(id));
        continue;
      }
      if (show && v.inView && !(e instanceof Building)) this.juiceHit(v, e as Unit, anim.health); // hit flash
      anim.health = e.healthFrac;

      if (e instanceof Building) this.updateBuilding(v, e, dt);
      else this.updateUnit(v, e as Unit, alpha, dt);

      contentAnim(e, this.local, anim);
      // off-screen models skip their animation (caught up in preRender if they come into view)
      v.animSkipped = false;
      if (show) {
        if (v.inView) v.model.update(anim);
        else v.animSkipped = true;
      }
      this.updateRing(v, selected.has(id) || hovered === id, selected.has(id));
    }

    this.updateProjectiles(alpha);
    this.destruction.update(dt, time);
    tickUpgradeModules(time, dt); // module build-in animations, module debris
    this.bracketMat.uniforms.uTime.value = time;
    this.primed = true;
  }

  /**
   * Called by the renderer after the camera moved and before anything is drawn. Views outside the camera
   * frustum (grown by a shadow margin) neither animate nor update their node matrices: three would
   * otherwise walk every bone and node of every model every frame. Hidden views skip matrix updates too.
   */
  private preRender = (camera: THREE.Camera) => {
    this.scene.userData.postRender = this.postRender;
    this.culled.length = 0;
    _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const sun = this.scene.userData.sunDir as THREE.Vector3 | undefined;
    const shadowLen = sun ? Math.min(6, Math.hypot(sun.x, sun.z) / Math.max(0.15, sun.y)) + 0.5 : 4;
    const small = camera.position.y < SMALL_SHADOW_HEIGHT;
    const smallChanged = small !== this.smallShadows;
    this.smallShadows = small;
    for (const v of this.views.values()) {
      const root = v.model.root;
      if (v.dead || v.ghostDead || v.fogged) {
        root.matrixWorldAutoUpdate = true;
        continue;
      }
      if (!root.visible) {
        root.matrixWorldAutoUpdate = false;
        v.inView = false;
        continue;
      }
      // grown by the length of the shadow the model can throw into view
      const alt = v.anim.altitude ?? 0;
      _sphere.center.copy(root.position);
      _sphere.center.y += v.model.height * 0.5;
      _sphere.radius = v.model.radius + 1.5 + (v.model.height + alt) * shadowLen;
      const inView = _frustum.intersectsSphere(_sphere);
      if (inView && v.animSkipped) {
        v.model.update(v.anim);
        v.animSkipped = false;
      }
      v.inView = inView;
      root.matrixWorldAutoUpdate = inView;
      if (!inView) {
        // hidden for this render only (shadow pass included); visible again in postRender for the radar etc.
        root.visible = false;
        this.culled.push(root);
      }
      if (smallChanged && v.ent.kind === 'infantry') {
        root.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material && !((o as THREE.Mesh).material as THREE.Material).transparent) o.castShadow = small; });
      }
    }
    this.crowd.prepare(camera, small); // HD infantry instance buffers for this frame
  };

  private culled: THREE.Object3D[] = [];
  /** HD infantry, drawn instanced (filled at the end of preRender, after the culling). */
  readonly crowd: InfantryCrowd;
  private postRender = () => {
    for (const r of this.culled) r.visible = true;
    this.culled.length = 0;
  };

  private buildingVisible(b: Building): boolean {
    return this.fog.visibilityAt(b.x, b.y) > 0.5 || this.fog.visibilityAt(b.cx + 0.5, b.cy + 0.5) > 0.5;
  }

  private buildingExplored(b: Building): boolean {
    return this.fog.exploredAt(b.x, b.y) > 0.5 || this.fog.exploredAt(b.cx + 0.5, b.cy + 0.5) > 0.5;
  }

  private updateBuilding(v: View, b: Building, dt: number) {
    const anim = v.anim;
    const root = v.model.root;
    const g = this.world.map.surfaceAt(b.x, b.y);
    root.position.set(b.x, g, b.y);
    // construction: hologram shell + solid structure rising inside it with a scanning ring
    let sy = 1;
    if (b.buildAnim < 1) {
      const t = b.buildAnim;
      sy = Math.max(0.02, 1 - Math.pow(1 - t, 2.2));
      if (!v.holo && root.visible && !b.bt.wall) {
        v.holo = createModel(b.bt.id, this.teamColor(b.owner), b.owner.faction);
        v.holo.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = (m as THREE.SkinnedMesh).isSkinnedMesh ? this.holoMatSk : this.holoMat; m.castShadow = false; m.receiveShadow = false; } });
        v.holo.root.position.set(b.x, g, b.y);
        this.scene.add(v.holo.root);
        v.holoRing = new THREE.Mesh(this.ringGeo2, this.ringMat);
        v.holoRing.scale.set(b.w + 0.1, 1, b.h + 0.1);
        v.holoRing.renderOrder = 4;
        this.scene.add(v.holoRing);
      }
      if (v.holoRing) {
        v.holoRing.position.set(b.x, g + v.model.height * sy + 0.02, b.y);
        this.ringMat.uniforms.opacity.value = 0.65 + 0.25 * Math.sin(this.time * 12);
      }
      this.holoMat.uniforms.uTime.value = this.time;
    } else if (b.selling >= 0) {
      sy = Math.max(0.02, b.selling / 0.9);
    }
    root.scale.set(1, sy, 1);
    if (v.lastBuildAnim < 1 && b.buildAnim >= 1) {
      if (root.visible) {
        this.effects.dust(new THREE.Vector3(b.x, g, b.y + b.h / 2), 1.5);
        this.effects.constructionBurst(new THREE.Vector3(b.x, g + 0.1, b.y), Math.max(b.w, b.h));
      }
      this.clearHolo(v);
    }
    v.lastBuildAnim = b.buildAnim;

    anim.powered = !b.owner.lowPower || b.bt.power > 0;
    if (b.bt.requiresPower) anim.powered = b.powered;
    anim.door = b.door;
    anim.load = b.load;
    anim.harvesting = b.load > 0.5;
    if (b.bt.superweapon) {
      const full = b.bt.superCharge ?? 300;
      anim.charge = b.owner.superCharge[b.bt.superweapon] / full;
    } else if (b.weapons[0]?.def.charge) {
      anim.charge = Math.min(1, b.charge / raTicksToSeconds(b.weapons[0].def.charge));
      if (!b.charging && b.weapons[0].cooldown > 0) anim.charge = Math.max(anim.charge, 0);
    } else anim.charge = 1;
    if (v.model.turret) v.model.turret.rotation.y = -b.turret;
    if (b.upgrades || b.task || b.bt.commander) updateCommanderView(v, b, this.world); // upgrade modules, scaffold, lab glow, garrison, gate

    // chimney smoke
    if (v.model.smokePoints && v.model.smokePoints.length && b.buildAnim >= 1) {
      if (!v.chimneys.length) {
        root.updateMatrixWorld(true);
        for (const sp of v.model.smokePoints) v.chimneys.push(this.effects.createEmitter('chimney', sp.getWorldPosition(new THREE.Vector3())));
      }
      const on = root.visible && anim.powered && b.selling < 0 ? 1 : 0;
      for (const c of v.chimneys) c.setIntensity(on);
    }
    this.damageEmitters(v, b.healthFrac, root.visible && b.buildAnim >= 1, _e.set(b.x, g + v.model.height * 0.8, b.y), 1 + Math.max(b.w, b.h) * 0.3);
    this.juiceColumn(v, b.healthFrac, root.visible && b.buildAnim >= 1 && !b.bt.wall, _e.set(b.x, g + v.model.height * 0.75, b.y), Math.max(b.w, b.h)); // smoke column
    if (!b.bt.wall) this.destruction.buildingDamage(b.id, modelKey(v.ptype, b.owner.faction), [b.w, b.h], b.x, g, b.y, b.healthFrac, root.visible && b.buildAnim >= 1 && b.selling < 0, v.model, anim); // roof fires / smoke, steam vents
  }

  private damageEmitters(v: View, hf: number, visible: boolean, pos: THREE.Vector3, size: number) {
    const wantSmoke = visible && hf < 0.5;
    const wantFire = visible && hf < 0.25;
    if (wantSmoke && !v.smoke) v.smoke = this.effects.createEmitter('smoke', pos);
    if (!wantSmoke && v.smoke) { v.smoke.dispose(); v.smoke = null; }
    if (v.smoke) { v.smoke.setPosition(pos); v.smoke.setIntensity(size * (hf < 0.25 ? 1.4 : 0.8)); }
    if (wantFire && !v.fire) v.fire = this.effects.createEmitter('fire', pos);
    if (!wantFire && v.fire) { v.fire.dispose(); v.fire = null; }
    if (v.fire) { v.fire.setPosition(pos); v.fire.setIntensity(size * 0.7); }
  }

  /** Hit flash when a unit loses a big chunk of health in one frame (vehicles ≥ 10 %, infantry ≥ 45 %). */
  private juiceHit(v: View, u: Unit, prev: number | undefined) {
    if (prev === undefined || this.effects.juice <= 0) return;
    const drop = prev - u.healthFrac;
    const metal = u.kind !== 'infantry';
    if (drop < (metal ? 0.1 : 0.45)) return;
    const p = v.model.root.position;
    _jv.set(p.x, p.y + v.model.height * 0.55, p.z);
    this.effects.hitFlash(_jv, Math.max(0.15, v.model.radius * 0.6), Math.min(1, drop * 2.5), metal);
  }

  /** Smoke column over a badly damaged structure (fire glow at its base below 25 %). */
  private juiceColumn(v: View, hf: number, visible: boolean, pos: THREE.Vector3, size: number) {
    const want = visible && hf < 0.5 && this.effects.juice > 0;
    if (want && !v.column) v.column = this.effects.createEmitter('column', pos);
    if (!want && v.column) { v.column.dispose(); v.column = null; }
    if (!v.column) return;
    v.column.setPosition(pos);
    v.column.setIntensity(0.6 + size * (hf < 0.25 ? 0.6 : 0.35));
    v.column.setHeat?.(hf < 0.25 ? 1 : 0);
  }

  /** Big vehicle wreck: ammo cook-off and fuel fireball, a longer burn and a smoke column while it burns. */
  private juiceWreck(v: View, u: Unit, p: THREE.Vector3) {
    if (this.effects.juice <= 0 || u.kind !== 'vehicle') return;
    const hp = u.ut.strength ?? 0;
    if (hp < 250) return;
    const size = Math.min(1.6, 0.55 + hp / 600 * 0.85);
    this.effects.heavyDeath(p, size);
    v.burn = 6 + 8 * Math.max(0, size - 0.7);
    if (hp >= 400) {
      v.column = this.effects.createEmitter('column', _jv.set(p.x, p.y + 0.35, p.z));
      v.column.setIntensity(0.5 + 0.4 * size);
      v.column.setHeat?.(1);
    }
  }

  private updateUnit(v: View, u: Unit, alpha: number, dt: number) {
    const map = this.world.map;
    const anim = v.anim;
    const root = v.model.root;
    const x = lerp(u.prevX, u.x, alpha), y = lerp(u.prevY, u.y, alpha);
    const heading = lerpAngle(u.prevHeading, u.heading, alpha);
    const turret = lerpAngle(u.prevTurret, u.turret, alpha);
    // ground units crossing a bridge ride on its deck, not on the water below
    const onDeck = u.kind !== 'naval' && u.kind !== 'aircraft' && this.deckHeight && map.bridgeAt[map.idx(Math.floor(x), Math.floor(y))]
      ? this.deckHeight(x, y) : null;
    const g = onDeck ?? map.surfaceAt(x, y);
    _qy.setFromAxisAngle(UP, -heading);
    if (u.kind === 'vehicle') {
      // tilt to terrain slope
      const e = 0.3;
      const hx = map.heightAt(x + e, y) - map.heightAt(x - e, y);
      const hz = map.heightAt(x, y + e) - map.heightAt(x, y - e);
      _n.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
      _q.setFromUnitVectors(UP, _n);
      v.quat.copy(_q).multiply(_qy);
      root.quaternion.slerp(v.quat, Math.min(1, dt * 10));
    } else if (u.kind === 'naval' && Water.current) {
      // ride the sea swell: lift with the surface and lean with its slope (the model adds its own bob and roll)
      const s = Water.current.surfaceOffset(x, y, undefined, _swell);
      _n.set(s.nx, s.ny, s.nz);
      _q.setFromUnitVectors(UP, _n);
      v.quat.copy(_q).multiply(_qy);
      root.quaternion.slerp(v.quat, Math.min(1, dt * 4));
    } else {
      root.quaternion.copy(_qy);
    }
    const alt = u.kind === 'aircraft' ? u.altitude : u.parachute > 0 ? (u.parachute / PARACHUTE_SECONDS) * DROP_HEIGHT : 0;
    root.position.set(x, g + alt + (u.kind === 'naval' && Water.current ? _swell.y : 0), y);
    if (u.ut.supportPlane && root.visible) this.updateTrails(v);
    if (v.model.turret) v.model.turret.rotation.y = -(turret - heading);
    anim.moving = u.moving;
    anim.speed = u.speedFrac;
    anim.altitude = alt;
    anim.harvesting = u.harvesting;
    anim.load = u.ut.harvester ? u.cargo / BAIL_COUNT : 0;
    anim.powered = true;
    // V2: rocket visible when reloaded
    const w0 = u.weapons[0];
    anim.charge = w0 ? 1 - Math.max(0, w0.cooldown) / raTicksToSeconds(w0.def.rof) : 1;
    // iron curtain glow ring is handled by rings; dust trail
    if (u.kind === 'vehicle' && u.moving && root.visible) {
      v.dustT -= dt;
      if (v.dustT <= 0) {
        v.dustT = 0.12;
        const back = _v.set(x - Math.cos(heading) * 0.35, g + 0.05, y - Math.sin(heading) * 0.35);
        const t = map.terrain[map.idx(Math.floor(x), Math.floor(y))];
        const amt = (t === 3 || t === 4 ? 0.8 : 0.35) * (u.ut.tracked ? 1 : 0.6);
        this.effects.dust(back, amt); // (read at once: no copy)
      }
    }
    if (u.kind === 'vehicle') this.damageEmitters(v, u.healthFrac + 0.2, root.visible, _e.set(x, g + 0.4, y), 0.5);
    // boats push rings out from the bow as they move (the wake proper is drawn by wakes.ts)
    if ((u.kind as string) === 'naval' && u.moving && root.visible) {
      v.dustT -= dt;
      if (v.dustT <= 0) {
        v.dustT = 0.45;
        const r = u.ut.radius ?? 0.4;
        Water.current?.addRipple(x + Math.cos(heading) * r * 0.8, y + Math.sin(heading) * r * 0.8, 0.25 + 0.35 * u.speedFrac);
      }
    }
  }

  /** Returns false when the view should be removed. */
  private updateDeath(v: View, dt: number): boolean {
    v.deathT += dt;
    const e = v.ent;
    const root = v.model.root;
    if (e instanceof Building) {
      if (v.collapsed) return false; // the fracture took the model's place
      if (v.deathHow === 'sold') {
        // shrink back into the ground
        const s = Math.max(0, 1 - v.deathT / 0.5);
        root.scale.y = Math.max(0.01, s * 0.1);
        return v.deathT < 0.5;
      }
      // collapse while the explosion covers it
      const t = Math.min(1, Math.max(0, (v.deathT - 0.25) / 1.0));
      root.scale.y = Math.max(0.02, 1 - t * t);
      root.position.y -= dt * 0.25 * t;
      v.smoke?.setIntensity(0);
      return v.deathT < 1.4;
    }
    if (e.kind === 'infantry') {
      v.anim.dying = Math.min(1, v.deathT / 0.9);
      v.anim.time += dt;
      if (v.deathHow !== 'crushed' && !this.destruction.hasRagdoll(e.id)) v.model.update(v.anim); // ragdolls pose the bones themselves
      if (v.deathT > 4) root.position.y -= dt * 0.15;
      return v.deathT < 6;
    }
    // vehicles: the wreck burns, then smoulders, then sinks away
    if (v.fire) {
      const burn = v.burn ?? 6; // heavy wrecks burn longer
      const k = v.deathT < burn ? 0.7 : Math.max(0, 0.7 - (v.deathT - burn) * 0.25);
      v.column?.setHeat?.(k / 0.7);
      v.fire.setIntensity(k);
      if (k <= 0) { v.fire.dispose(); v.fire = null; }
    }
    if (v.deathT > 4 && !v.smoke && v.deathT < this.wreckTime - 4 && root.visible) {
      v.smoke = this.effects.createEmitter('smoke', root.position.clone().setY(root.position.y + 0.3));
      v.smoke.setIntensity(0.45);
    }
    if (v.smoke && v.deathT > this.wreckTime - 4) v.smoke.setIntensity(Math.max(0, (this.wreckTime - 1.5 - v.deathT) / 2.5) * 0.45);
    if (v.column && v.deathT > this.wreckTime - 8) v.column.setIntensity(Math.max(0, (this.wreckTime - 2 - v.deathT) / 6) * 0.9); // the column thins out
    if (v.deathT > this.wreckTime - 1.5) root.position.y -= dt * 0.3;
    return v.deathT < this.wreckTime;
  }

  private updateRing(v: View, show: boolean, selected: boolean) {
    const e = v.ent;
    const iron = e.invulnerable > 0;
    let r = this.rings.get(e.id);
    const want = (show || iron) && v.model.root.visible && !v.dead;
    if (!want) {
      if (r) r.visible = false;
      return;
    }
    if (!r) {
      if (e instanceof Building) {
        const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        const mat = this.bracketMat.clone();
        mat.uniforms.uAspect.value = new THREE.Vector2(e.w + 0.3, e.h + 0.3);
        r = new THREE.Mesh(geo, mat);
        r.scale.set(e.w + 0.3, 1, e.h + 0.3);
      } else {
        r = new THREE.Mesh(this.ringGeo, this.ringMats.own);
        const s = Math.max(0.22, v.model.radius * 1.05);
        r.scale.set(s, 1, s);
      }
      r.renderOrder = 2;
      this.scene.add(r);
      this.rings.set(e.id, r);
    }
    r.visible = true;
    const rel = e.owner === this.local ? 'own' : e.owner.team === this.local.team ? 'ally' : 'enemy';
    if (e instanceof Building) {
      const mat = r.material as THREE.ShaderMaterial;
      mat.uniforms.uColor.value.set(iron ? 0xff2020 : this.ringCols[rel]);
      mat.uniforms.uTime.value = this.time;
      r.position.set(e.x, this.world.map.surfaceAt(e.x, e.y) + 0.06, e.y);
    } else {
      r.material = iron ? this.ringMats.iron : this.ringMats[rel];
      const p = v.model.root.position;
      const pulse = selected ? 1 : 0.85 + Math.sin(this.time * 6) * 0.05;
      const s = Math.max(0.22, v.model.radius * 1.05) * pulse * (iron ? 1.3 : 1);
      r.scale.set(s, 1, s);
      r.position.set(p.x, this.world.map.surfaceAt(p.x, p.z) + 0.04, p.z);
    }
  }

  /** Contrails from each exhaust of a support plane. */
  private updateTrails(v: View) {
    const pts = v.model.smokePoints ?? [];
    if (!pts.length) return;
    v.trails ??= pts.map(() => this.effects.spawnTrail('contrail', 0.8));
    const u = v.ent as Unit;
    _v2.set(Math.cos(u.heading), 0, Math.sin(u.heading));
    for (let i = 0; i < pts.length; i++) {
      pts[i].getWorldPosition(_v);
      v.trails[i]?.update(_v, _v2);
    }
  }

  private updateProjectiles(alpha: number) {
    const seen = this.seenProj;
    seen.clear();
    for (const p of this.world.projectiles) {
      if (!p.alive) continue;
      seen.add(p.id);
      let pv = this.projViews.get(p.id);
      const x = lerp(p.prevX, p.x, alpha), y = lerp(p.prevY, p.y, alpha), z = lerp(p.prevZ, p.z, alpha);
      if (!pv) {
        const visible = this.fog.visibilityAt(p.sx, p.sy) > 0.25 || this.fog.visibilityAt(p.tx, p.ty) > 0.25 || p.special === 'nuke';
        if (!visible) continue;
        // heavy guns (cruiser 8-inch, Mammoth) throw visibly bigger shells
        const handle = this.effects.spawnProjectile(p.special === 'nuke' ? 'scud' : p.kind, p.weapon.damage >= 150 ? 1.8 : 1);
        const muzzle = new THREE.Vector3(p.sx, p.sz, p.sy);
        const shooter = this.world.getEntity(p.shooter);
        const ok = this.muzzleWorld(p.shooter, this.muzzleIndex(p.shooter, p.weapon.id, shooter ? shooter.lastFireMuzzle : 0), muzzle);
        const offset = ok ? muzzle.sub(_v.set(p.sx, p.sz, p.sy)) : new THREE.Vector3();
        pv = { handle, offset, startDist: Math.max(0.01, Math.hypot(p.tx - p.sx, p.ty - p.sy)) };
        this.projViews.set(p.id, pv);
      }
      const travelled = Math.hypot(x - p.sx, y - p.sy) / pv.startDist;
      const k = Math.max(0, 1 - travelled * 2.5);
      _v.set(x + pv.offset.x * k, z + pv.offset.y * k, y + pv.offset.z * k);
      _v2.set(p.x - p.prevX, p.z - p.prevZ, p.y - p.prevY);
      if (_v2.lengthSq() < 1e-8) _v2.set(1, 0, 0);
      _v2.normalize();
      pv.handle.update(_v, _v2);
    }
    for (const [id, pv] of this.projViews) {
      if (!seen.has(id)) {
        pv.handle.end();
        this.projViews.delete(id);
      }
    }
  }

  /** Approximate top of an entity's model for overlays. */
  topOf(id: number): number {
    const v = this.views.get(id);
    return v ? v.model.height : 0.5;
  }

  dispose() {
    this.destruction.dispose();
    this.crowd.dispose();
    this.warm.removeFromParent();
    if (this.scene.userData.preRender === this.preRender) delete this.scene.userData.preRender;
    for (const id of [...this.views.keys()]) this.removeView(id);
    for (const pv of this.projViews.values()) pv.handle.end();
    this.projViews.clear();
  }
}

export type { ExplosionKind, Projectile };
void DT;
