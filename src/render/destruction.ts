/**
 * Destruction & physics visuals. Purely visual, driven by sim events and entity state:
 *
 *  - Structures break apart when destroyed: the model's pre-baked fracture (destruction-fracture.ts) takes
 *    its place, shakes while the charges go off, then the chunks collapse and topple under a small rigid-body
 *    solver (destruction-physics.ts), throwing dust where they land and burning afterwards; when they settle
 *    the permanent rubble pile (rubble.ts) is laid out exactly where the chunks came to rest and the chunks
 *    sink away into it.
 *  - Living structures show their damage stages: extra smoke at 50 % health, fires on the roof at 25 %
 *    (on top of the shader's cracks / burnt-through panels).
 *  - Vehicle wrecks bounce and settle (tumbling down slopes), turrets pop off, and wheels / track runs /
 *    armour plates fly off as instanced debris (destruction-debris.ts). Downed aircraft fall and crash.
 *  - Infantry deaths become short verlet ragdolls (destruction-ragdoll.ts), varied by death type.
 *  - The battlefield remembers (destruction-scars.ts): heavy explosions press craters through the terrain's
 *    deform() that stay for the match (nearby hits merge, the least recently hit crater heals away over the
 *    live budget), the ground stays burnt, destroyed trees leave charred stumps and fallen trunks
 *    (destruction-trees.ts), and all of it goes into save games (saveScars / loadScars).
 *  - Aftermath effects: M.A.D. seismic pulses, the demolition truck's blast, chrono-tank jumps.
 *
 * Budgets: <= 6 collapses at once (1 draw call + shadow each), 256 rigid bodies, 24 ragdolls,
 * 224 debris pieces in 5 instanced draw calls (only while in use). No per-frame allocations.
 */
import * as THREE from 'three';
import type { Effects } from './effects';
import type { EmitterHandle } from './effects/types';
import type { FxContext } from './effects/context';
import { madPulse, demoBlast, demoRing, chronoShift } from './effects/explosions';
import { repairSparks } from './effects/misc';
import { DecalSystem } from './effects/decals';
import type { GameMap } from '../sim/map';
import { WATER_LEVEL } from '../sim/map';
import { modelAliasOf, modelBodyGeometry } from './models';
import type { ModelAnimState, ModelInstance } from './models/types';
import { bodyMaterial, BodyVariant, setBodyTime, shadowDepthMaterial } from './models/materials';
import { PhysicsWorld, type RigidBody } from './destruction-physics';
import { bakeFracture, type FractureData } from './destruction-fracture';
import { RagdollPool, type Ragdoll, type RagdollKind } from './destruction-ragdoll';
import { DebrisPool, DS, DEBRIS_HE } from './destruction-debris';
import { Rubble } from './rubble';
import { ScarLedger, SCAR_BUDGET, type ScarCrater, type ScarSnapshot } from './destruction-scars';
import { BurntTrees } from './destruction-trees';
import { explosionHeat } from './effects/heatfx';

/** What the destruction system needs from the terrain renderer (FX implements deform). */
export interface DeformableTerrain {
  /** Rendered terrain height at map (x, y). */
  renderHeight?(x: number, y: number): number;
  /** Press a crater (positive depth digs down) of `radius` cells into the rendered terrain at map (x, y). */
  deform?(x: number, y: number, radius: number, depth: number): void;
  /** Persistent burn mark on the ground (0..1 amount, accumulates). */
  scorch?(x: number, y: number, radius: number, amount?: number): void;
  /** Tread ruts from (x0, y0) to (x1, y1), two grooves `width` apart. */
  rut?(x0: number, y0: number, x1: number, y1: number, width: number, depth?: number): void;
}

const MAX_COLLAPSES = 6;
const SHAKE_T = 0.75;
const SETTLE_MAX = 6.5;
const HOLD_T = 6;
const SINK_T = 3;
const MAX_FIRES = 10;
const MAX_DAMAGE_EMITTERS = 28;
/** Terrain craters pressed per frame at most (the deform is a CPU + upload cost). */
const CRATERS_PER_FRAME = 3;
/** An evicted crater heals back in steps (seconds apart). */
const CRATER_HEAL_STEPS = 5;
const CRATER_HEAL_DT = 0.8;
/** Burn left in the ground where a crater healed away / a tree burnt down. */
const HEALED_BURN = 0.32;
const TREE_BURN = 0.42;
const DEBRIS_LIFE = 14;

interface Collapse {
  id: number;
  typeId: string;
  data: FractureData;
  holder: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  bodies: (RigidBody | null)[];
  delay: Float32Array;
  origin: THREE.Vector3;
  t: number;
  released: boolean;
  settledT: number;
  rubbled: boolean;
  fires: EmitterHandle[];
  fireChunk: number[];
  dust: number;
  team: number;
}

interface Wreck {
  id: number;
  model: ModelInstance;
  t: number;
  hull: RigidBody | null;
  hullC: THREE.Vector3;
  turret: THREE.Object3D | null;
  turretBody: RigidBody | null;
  turretC: THREE.Vector3;
  air: boolean;
  crashed: boolean;
}

interface Piece {
  shape: number;
  slot: number;
  body: RigidBody;
  t: number;
  scale: number;
  wet: boolean;
}

/** A crater evicted from the live budget, healing back in steps. */
interface Healing {
  c: ScarCrater;
  step: number;
  next: number;
}

interface DamageFx {
  em: EmitterHandle[];
  stage: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _col = new THREE.Color();
const TEAM_PLATE = new THREE.Color();
const RUBBLE_GREY = new THREE.Color(0.32, 0.31, 0.29);

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** The effects system's recipe context (Effects keeps it private; FX may expose `context`). */
function fxContext(effects: Effects): FxContext | null {
  const e = effects as unknown as { context?: FxContext; ctx?: FxContext };
  return e.context ?? e.ctx ?? null;
}

/** Fracture data per model type (baked lazily, ideally during idle time before the first collapse). */
const fractures = new Map<string, FractureData | null>();

export function fractureOf(typeId: string, footprint: [number, number]): FractureData | null {
  const id = modelAliasOf(typeId);
  if (fractures.has(id)) return fractures.get(id)!;
  // the distant body: close-up rivets and stencils would only add triangles to the chunks
  const geo = modelBodyGeometry(id, true);
  let data: FractureData | null = null;
  try {
    data = geo ? bakeFracture(geo, id, footprint) : null;
  } catch (e) {
    console.warn(`[destruction] fracture bake failed for '${id}'`, e);
  }
  fractures.set(id, data);
  return data;
}

/** Forget the baked fractures whose type key starts with `prefix` (World Conquest civilian buildings: per battle). */
export function forgetFractures(prefix: string): void {
  for (const k of [...fractures.keys()]) if (k.startsWith(prefix)) fractures.delete(k);
}

const idle: (cb: () => void) => void =
  typeof requestIdleCallback === 'function' ? (cb) => requestIdleCallback(() => cb(), { timeout: 4000 }) : (cb) => setTimeout(cb, 200);

export class Destruction {
  /** Everything this system draws (added to the scene). */
  readonly group = new THREE.Group();
  readonly physics: PhysicsWorld;
  private ragdolls = new RagdollPool(24);
  private ragdollOf = new Map<number, Ragdoll>();
  private debris = new DebrisPool();
  private pieces: Piece[] = [];
  private pieceBounds = [0, 1, 2, 3, 4].map(() => new THREE.Box3());
  private collapses: Collapse[] = [];
  private meshPool = new Map<string, { holder: THREE.Group; mesh: THREE.SkinnedMesh; bones: THREE.Bone[] }[]>();
  private wrecks = new Map<number, Wreck>();
  /** Craters, burnt ground and burnt trees of this match (budgets per quality). */
  readonly scars: ScarLedger;
  private healing: Healing[] = [];
  private burntTrees: BurntTrees;
  private damage = new Map<number, DamageFx>();
  private damageCount = 0;
  private fires = 0;
  /** Fires left burning on the rubble after a collapse ends (fade out on their own). */
  private burning: { em: EmitterHandle; t: number; k: number }[] = [];
  private ctx: FxContext | null;
  private terrain: DeformableTerrain | null = null;
  private time = 0;
  private scheduled = new Set<string>();
  private warm = new THREE.Group();
  /** Height the debris rests on (rendered terrain, the lake bed under water). */
  readonly height = (x: number, z: number): number => (this.terrain?.renderHeight ? this.terrain.renderHeight(x, z) : this.map.heightAt(x, z));

  constructor(
    private scene: THREE.Scene,
    private effects: Effects,
    private map: GameMap,
  ) {
    this.group.name = 'destruction';
    this.physics = new PhysicsWorld(this.height, 256);
    this.ctx = fxContext(effects);
    this.group.add(this.debris.group);
    const q = (scene.userData.fxQuality as 'low' | 'medium' | 'high' | undefined) ?? 'high';
    const budget = SCAR_BUDGET[q] ?? SCAR_BUDGET.high;
    this.scars = new ScarLedger(Math.max(1, map.w | 0), Math.max(1, map.h | 0), budget.craters, budget.trees);
    this.burntTrees = new BurntTrees(budget.trees);
    this.group.add(this.burntTrees.group);
    scene.add(this.group);
    // never-drawn stand-in so the skinned 'wrecked' body variant is compiled with the scene on the loading
    // screen (debris meshes are in the scene too: instanced + per-instance colour)
    this.warm.name = 'destruction-warmup';
    this.warm.visible = false;
    const g = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    const n = g.getAttribute('position').count;
    g.setAttribute('pbr', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4));
    const sk = new THREE.SkinnedMesh(g, bodyMaterial(0xffffff, BodyVariant.Wrecked, false, true));
    const bone = new THREE.Bone();
    sk.add(bone);
    sk.bind(new THREE.Skeleton([bone]));
    this.warm.add(sk);
    this.group.add(this.warm);
  }

  /** Hook up the rendered terrain: crater deformation, and debris / decals resting on the rendered surface. */
  setTerrain(t: DeformableTerrain | null): void {
    this.terrain = t;
    const rh = t?.renderHeight ? (x: number, z: number) => t.renderHeight!(x, z) : null;
    // decals follow the rendered (and deformed) ground instead of the sim heightfield
    DecalSystem.terrainHeight = rh ? (x: number, z: number) => (this.map.heightAt(x, z) <= WATER_LEVEL ? WATER_LEVEL : rh(x, z)) : null;
  }

  /** Bake a structure type's fracture in idle time (call when the type first appears). */
  prepare(typeId: string, footprint: [number, number]): void {
    const id = modelAliasOf(typeId);
    if (fractures.has(id) || this.scheduled.has(id)) return;
    this.scheduled.add(id);
    idle(() => fractureOf(id, footprint));
  }

  // ===========================================================================================
  // Structures

  /**
   * A structure was destroyed in view: replace its model by the fracture and collapse it. Returns false
   * (caller keeps the old squash animation) when the type can't break or too many collapses are running.
   */
  collapse(id: number, typeId: string, teamHex: number, model: ModelInstance, footprint: [number, number]): boolean {
    if (this.collapses.length >= MAX_COLLAPSES) return false;
    const data = fractureOf(typeId, footprint);
    if (!data) return false;
    const key = modelAliasOf(typeId);
    let rig = this.meshPool.get(key)?.pop();
    if (!rig) {
      const bones = data.chunks.map(() => new THREE.Bone());
      const holder = new THREE.Group();
      holder.name = `collapse:${key}`;
      for (const b of bones) holder.add(b);
      const mesh = new THREE.SkinnedMesh(data.geo, bodyMaterial(teamHex, BodyVariant.Wrecked, false, true));
      mesh.bind(new THREE.Skeleton(bones, data.inverses), new THREE.Matrix4());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // the shared per-kind depth material (compiled on the loading screen, like every model's)
      mesh.customDepthMaterial = shadowDepthMaterial(mesh);
      mesh.boundingSphere = new THREE.Sphere();
      holder.add(mesh);
      rig = { holder, mesh, bones };
    }
    rig.mesh.material = bodyMaterial(teamHex, BodyVariant.Wrecked, false, true);
    const origin = model.root.position.clone();
    rig.mesh.boundingSphere!.center.set(origin.x, origin.y + data.box.max.y * 0.5, origin.z);
    rig.mesh.boundingSphere!.radius = Math.max(footprint[0], footprint[1]) * 1.2 + data.box.max.y + 1.5;
    for (let i = 0; i < data.chunks.length; i++) {
      const c = data.chunks[i].c;
      rig.bones[i].position.set(origin.x + c.x, origin.y + c.y, origin.z + c.z);
      rig.bones[i].quaternion.identity();
      rig.bones[i].scale.set(1, 1, 1);
    }
    rig.holder.visible = true;
    this.group.add(rig.holder);
    const h = Math.max(0.2, data.box.max.y);
    const delay = new Float32Array(data.chunks.length);
    for (let i = 0; i < data.chunks.length; i++) {
      // the top goes first, the lower storeys follow as the structure gives way
      delay[i] = SHAKE_T + (1 - Math.min(1, data.chunks[i].c.y / h)) * 0.35 + Math.random() * 0.12;
    }
    this.collapses.push({
      id, typeId: key, data, holder: rig.holder, mesh: rig.mesh, bones: rig.bones, bodies: data.chunks.map(() => null), delay,
      origin, t: 0, released: false, settledT: -1, rubbled: false, fires: [], fireChunk: [], dust: 0, team: teamHex,
    });
    // the permanent rubble is laid out where the chunks come to rest (rubble.ts waits for fillPile)
    Rubble.current?.defer(id, Math.round(origin.x - footprint[0] / 2), Math.round(origin.z - footprint[1] / 2), footprint[0], footprint[1]);
    model.root.visible = false;
    this.forget(id);
    return true;
  }

  private updateCollapse(c: Collapse, dt: number): boolean {
    c.t += dt;
    const data = c.data;
    const o = c.origin;
    if (!c.released) {
      // the structure trembles while the charges go off inside
      const k = Math.min(1, c.t / SHAKE_T) * 0.012;
      for (let i = 1; i < data.chunks.length; i++) {
        const ch = data.chunks[i];
        c.bones[i].position.set(o.x + ch.c.x + rnd(-k, k), o.y + ch.c.y + rnd(-k, k) * 0.5, o.z + ch.c.z + rnd(-k, k));
      }
    }
    // release chunks into the physics as their time comes
    let pending = 0;
    for (let i = 1; i < data.chunks.length; i++) {
      if (c.bodies[i] || c.delay[i] < 0) continue;
      if (c.t < c.delay[i]) {
        pending++;
        continue;
      }
      c.delay[i] = -1;
      const ch = data.chunks[i];
      if (ch.tris === 0) continue;
      const b = this.physics.alloc();
      if (!b) continue;
      b.setBox(ch.he.x, ch.he.y, ch.he.z);
      b.group = c.id + 1;
      b.restitution = 0.15;
      b.friction = 0.8;
      b.maxAwake = SETTLE_MAX;
      b.p.set(o.x + ch.c.x, o.y + ch.c.y, o.z + ch.c.z);
      // outward burst + topple away from the centre; top pieces pop higher
      let rx = ch.c.x, rz = ch.c.z;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl;
      rz /= rl;
      const hk = Math.min(1, ch.c.y / Math.max(0.2, data.box.max.y));
      const out = rnd(0.25, 1.1) * (0.4 + hk);
      b.v.set(rx * out + rnd(-0.2, 0.2), rnd(0.1, 1.3) * hk, rz * out + rnd(-0.2, 0.2));
      const topple = rnd(1.0, 3.2) * (0.35 + hk);
      b.w.set(rz * topple + rnd(-1.4, 1.4), rnd(-0.9, 0.9), -rx * topple + rnd(-1.4, 1.4));
      c.bodies[i] = b;
    }
    if (pending === 0) c.released = true;
    // follow the bodies
    let awake = 0;
    let dusts = 0;
    for (let i = 1; i < data.chunks.length; i++) {
      const b = c.bodies[i];
      if (!b) continue;
      if (!b.sleeping) awake++;
      const ch = data.chunks[i];
      const bone = c.bones[i];
      // bone origin = body centre - R * 0 (the chunk's bind position is its centroid)
      bone.position.copy(b.p);
      bone.quaternion.copy(b.q);
      if (b.impact > 0.9 && b.hits <= 2 && dusts < 3 && c.dust < 24) {
        dusts++;
        c.dust++;
        _v.set(b.p.x, this.height(b.p.x, b.p.z), b.p.z);
        this.effects.dust(_v, 0.6 + Math.min(1.4, ch.he.x * ch.he.z * 30));
      }
      this.checkSplash(b, ch.he.x + ch.he.z);
    }
    // burning wreckage: fires ride on the two largest chunks
    if (c.released && !c.fires.length && c.t > SHAKE_T + 1.0 && this.fires < MAX_FIRES) {
      const order = c.bodies
        .map((b, i) => (b ? i : -1))
        .filter((i) => i > 0)
        .sort((a, b) => data.chunks[b].tris - data.chunks[a].tris);
      const n = Math.min(order.length, data.chunks.length > 12 ? 2 : 1, MAX_FIRES - this.fires);
      for (let k = 0; k < n; k++) {
        const b = c.bodies[order[k]]!;
        c.fires.push(this.effects.createEmitter('fire', _v.set(b.p.x, b.p.y + 0.1, b.p.z)));
        this.light(b.p.x, b.p.y + 0.5, b.p.z, 0xff7a30, 2.2, 3.2, 20);
        c.fireChunk.push(order[k]);
        this.fires++;
      }
    }
    for (let k = 0; k < c.fires.length; k++) {
      const b = c.bodies[c.fireChunk[k]];
      if (b) c.fires[k].setPosition(_v.set(b.p.x, b.p.y + 0.08, b.p.z));
      c.fires[k].setIntensity(0.85);
    }
    // settled: rubble where the pieces lie, then the pieces sink into it
    if (c.released && c.settledT < 0 && (awake === 0 || c.t > SHAKE_T + SETTLE_MAX + 0.5)) {
      c.settledT = c.t;
      this.layRubble(c);
      // burnt out: the lingering pieces go fully charred (under the smoke)
      c.mesh.material = bodyMaterial(c.team, BodyVariant.Charred, false, true);
    }
    if (c.settledT >= 0) {
      const st = c.t - c.settledT - HOLD_T;
      if (st > 0) {
        const k = Math.min(1, st / SINK_T);
        const sink = k * k;
        for (let i = 0; i < data.chunks.length; i++) {
          const ch = data.chunks[i];
          const b = c.bodies[i];
          const depth = (ch.he.y * 2 + 0.12) * sink;
          if (b) c.bones[i].position.set(b.p.x, b.p.y - depth, b.p.z);
          else c.bones[i].position.set(o.x + ch.c.x, o.y + ch.c.y - depth, o.z + ch.c.z);
        }
        if (k >= 1) return false;
      }
    }
    return true;
  }

  private layRubble(c: Collapse): void {
    if (c.rubbled) return;
    c.rubbled = true;
    const r = Rubble.current;
    if (!r) return;
    const items: { x: number; y: number; size: number; color: THREE.Color }[] = [];
    const data = c.data;
    TEAM_PLATE.setHex(c.team).convertSRGBToLinear();
    for (let i = 1; i < data.chunks.length; i++) {
      const ch = data.chunks[i];
      if (!ch.tris) continue;
      const b = c.bodies[i];
      const x = b ? b.p.x : c.origin.x + ch.c.x;
      const z = b ? b.p.z : c.origin.z + ch.c.z;
      // the chunk's material (team paint where it was painted), dirtied toward concrete
      const col = ch.color.clone().lerp(TEAM_PLATE, ch.team * 0.6).lerp(RUBBLE_GREY, 0.35);
      items.push({ x, y: z, size: Math.min(0.5, Math.max(ch.he.x, ch.he.z) * 0.85 + 0.05), color: col });
    }
    r.fillPile(c.id, items);
  }

  private endCollapse(c: Collapse): void {
    for (const b of c.bodies) if (b) this.physics.release(b);
    // the fires keep burning on the rubble for a while
    for (const f of c.fires) this.burning.push({ em: f, t: 0, k: 0.85 });
    c.fires.length = 0;
    if (!c.rubbled) this.layRubble(c);
    c.holder.removeFromParent();
    const list = this.meshPool.get(c.typeId) ?? [];
    if (list.length < 2) {
      list.push({ holder: c.holder, mesh: c.mesh, bones: c.bones });
      this.meshPool.set(c.typeId, list);
    } else c.mesh.skeleton.dispose();
  }

  /**
   * Per-frame hook for a living structure: its damage stages (extra smoke columns on the roof below 50 %
   * health, roof fires and sparks below 25 %; the renderer's own centre smoke / fire keep running) and its
   * ambient effects (steam puffing from power plant / refinery vents, welding sparks in an open factory bay).
   */
  buildingDamage(
    id: number, typeId: string, footprint: [number, number], x: number, y: number, z: number, hf: number, visible: boolean,
    model?: ModelInstance, anim?: ModelAnimState,
  ): void {
    if (model?.fxPoints?.length && anim) this.ambient(id, model, anim, visible && hf > 0);
    const stage = !visible ? 0 : hf < 0.25 ? 2 : hf < 0.5 ? 1 : 0;
    let d = this.damage.get(id);
    if (!d) {
      if (stage === 0) return;
      d = { em: [], stage: 0 };
      this.damage.set(id, d);
    }
    if (d.stage === stage) return;
    this.clearDamage(id);
    if (stage === 0) return;
    const data = fractures.get(modelAliasOf(typeId));
    if (data === undefined) {
      this.prepare(typeId, footprint);
      return;
    }
    if (!data || !data.anchors.length) return;
    const fresh: DamageFx = { em: [], stage };
    this.damage.set(id, fresh);
    const a = data.anchors;
    const size = 0.5 + Math.max(footprint[0], footprint[1]) * 0.25;
    const add = (kind: 'smoke' | 'fire' | 'sparks', p: THREE.Vector3, k: number) => {
      if (this.damageCount >= MAX_DAMAGE_EMITTERS) return;
      const e = this.effects.createEmitter(kind, _v.set(x + p.x, y + p.y + 0.05, z + p.z));
      e.setIntensity(k);
      fresh.em.push(e);
      this.damageCount++;
    };
    if (a.length > 1) add('smoke', a[1], size * (stage === 2 ? 1.1 : 0.6));
    if (stage === 2) {
      add('fire', a[0], size * 0.6);
      if (a.length > 2) add('fire', a[2], size * 0.45);
      if (a.length > 3) add('sparks', a[3], 0.8);
    }
  }

  /** Steam vents and welding sparks of a structure (emitters created on demand, paused when unseen). */
  private ambient(id: number, model: ModelInstance, s: ModelAnimState, visible: boolean): void {
    let list = this.ambientFx.get(id);
    const pts = model.fxPoints!;
    if (!list) {
      if (!visible) return;
      list = [];
      model.root.updateMatrixWorld(true);
      for (const p of pts) list.push(this.effects.createEmitter(p.kind, p.node.getWorldPosition(_v)));
      this.ambientFx.set(id, list);
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let k = 0;
      if (visible && s.powered) {
        if (p.kind === 'steam') {
          // puffs: a valve opens for a moment every few seconds (each vent on its own beat)
          const ph = (s.time * 0.23 + i * 0.37 + (id % 7) * 0.13) % 1;
          k = ph < 0.18 ? 0.9 : s.load > 0.05 || s.harvesting ? 0.25 : 0;
        } else k = s.door > 0.3 ? (Math.sin(s.time * 11 + i) > 0.2 ? 0.8 : 0.15) : 0;
      }
      list[i].setIntensity(k);
    }
  }

  private ambientFx = new Map<number, EmitterHandle[]>();

  private clearDamage(id: number): void {
    const d = this.damage.get(id);
    if (!d) return;
    for (const e of d.em) e.dispose();
    this.damageCount -= d.em.length;
    d.em.length = 0;
    d.stage = 0;
    this.damage.delete(id);
  }

  // ===========================================================================================
  // Vehicles

  /**
   * A vehicle / aircraft was destroyed in view: the wreck (the model itself) bounces and settles, the turret
   * may pop off, and a few pieces fly away. `airborne` = altitude above ground at death.
   */
  vehicleDeath(id: number, model: ModelInstance, teamHex: number, how: string, tracked: boolean, wheeled: boolean, airborne: number): void {
    if (this.wrecks.has(id)) return;
    const root = model.root;
    const w: Wreck = {
      id, model, t: 0, hull: null, hullC: new THREE.Vector3(), turret: null, turretBody: null, turretC: new THREE.Vector3(),
      air: airborne > 0.25, crashed: false,
    };
    const blown = how === 'blown' || how === 'normal';
    // hull: bounces (or falls, for aircraft) and settles on the slope it lands on
    const hb = model.nodeBounds?.('root', false);
    if (hb) {
      const b = this.physics.alloc();
      if (b) {
        const c = hb.getCenter(w.hullC);
        const he = hb.getSize(_v).multiplyScalar(0.5);
        b.setBox(he.x * 0.9, Math.max(0.03, he.y * 0.9), he.z * 0.9);
        b.restitution = 0.2;
        b.friction = 0.75;
        b.maxAwake = w.air ? 8 : 4;
        root.updateMatrixWorld(true);
        b.p.copy(c).applyMatrix4(root.matrixWorld);
        b.q.copy(root.quaternion);
        if (w.air) {
          b.v.set(rnd(-0.6, 0.6), rnd(-0.2, 0.4), rnd(-0.6, 0.6));
          b.w.set(rnd(-1.5, 1.5), rnd(-2.5, 2.5), rnd(-1.5, 1.5));
        } else {
          const pop = blown ? rnd(0.7, 1.5) : rnd(0.3, 0.7);
          b.v.set(rnd(-0.3, 0.3), pop, rnd(-0.3, 0.3));
          b.w.set(rnd(-1.6, 1.6), rnd(-1.2, 1.2), rnd(-1.6, 1.6));
        }
        w.hull = b;
      }
    }
    // turret pops off (most of the time)
    const t = model.turret;
    const tb = t && (t as THREE.Bone).isBone ? model.nodeBounds?.(t.name, true) : null;
    if (t && tb && !w.air && Math.random() < (blown ? 0.75 : 0.4)) {
      const b = this.physics.alloc();
      if (b) {
        const c = tb.getCenter(w.turretC);
        const he = tb.getSize(_v).multiplyScalar(0.5);
        // colliders ignore the long barrels a little (they would hold the turret up like stilts)
        b.setBox(Math.min(he.x, Math.max(he.z, 0.06) * 1.2) * 0.9, Math.max(0.025, he.y * 0.9), he.z * 0.9);
        b.restitution = 0.3;
        b.friction = 0.6;
        root.updateMatrixWorld(true);
        b.p.copy(c).applyMatrix4(t.matrixWorld);
        t.getWorldQuaternion(b.q);
        b.v.set(rnd(-0.9, 0.9), rnd(2.2, 3.4), rnd(-0.9, 0.9));
        b.w.set(rnd(-6, 6), rnd(-4, 4), rnd(-6, 6));
        w.turret = t;
        w.turretBody = b;
      }
    }
    this.wrecks.set(id, w);
    // flying parts
    root.updateMatrixWorld(true);
    const box = hb ?? new THREE.Box3(new THREE.Vector3(-0.3, 0, -0.2), new THREE.Vector3(0.3, 0.3, 0.2));
    const nParts = w.air ? 3 : blown ? 4 : 2;
    TEAM_PLATE.setHex(teamHex).multiplyScalar(0.55);
    for (let k = 0; k < nParts; k++) {
      let shape: number;
      if (w.air) shape = k === 0 ? DS.PLATE : DS.CHUNK;
      else if (k === 0) shape = tracked ? DS.TRACK : wheeled ? DS.WHEEL : DS.PLATE;
      else if (k === 1) shape = tracked ? DS.WHEEL : wheeled ? DS.WHEEL : DS.CHUNK;
      else if (k === 2) shape = DS.PLATE;
      else shape = Math.random() < 0.3 && t ? DS.BARREL : DS.CHUNK;
      _v.set(rnd(box.min.x, box.max.x), rnd(box.min.y, box.max.y) * 0.8 + 0.05, rnd(box.min.z, box.max.z)).applyMatrix4(root.matrixWorld);
      const out = _v2.set(_v.x - root.position.x, 0, _v.z - root.position.z);
      if (out.lengthSq() < 1e-4) out.set(rnd(-1, 1), 0, rnd(-1, 1));
      out.normalize();
      const sp = rnd(1.0, 2.4);
      this.spawnPiece(shape, shape === DS.PLATE ? TEAM_PLATE : _col.setRGB(1, 1, 1), _v, out.x * sp, rnd(1.4, 3.0), out.z * sp, 1);
    }
  }

  private spawnPiece(shape: number, color: THREE.Color, p: THREE.Vector3, vx: number, vy: number, vz: number, scale: number): void {
    const slot = this.debris.alloc(shape, color);
    if (slot < 0) return;
    const b = this.physics.alloc();
    if (!b) {
      this.debris.release(shape, slot);
      return;
    }
    const he = DEBRIS_HE[shape];
    b.setBox(he[0] * scale, he[1] * scale, he[2] * scale, 0.05 * scale);
    b.restitution = shape === DS.WHEEL ? 0.4 : 0.25;
    b.friction = shape === DS.WHEEL ? 0.4 : 0.7;
    b.maxAwake = 5;
    b.p.copy(p);
    b.q.setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)));
    b.v.set(vx, vy, vz);
    b.w.set(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9));
    this.pieces.push({ shape, slot, body: b, t: 0, scale, wet: false });
  }

  private updateWreck(w: Wreck, dt: number): void {
    w.t += dt;
    const root = w.model.root;
    const hb = w.hull;
    if (hb) {
      if (!hb.sleeping) {
        root.quaternion.copy(hb.q);
        // root origin = body centre - R * centre offset
        root.position.copy(w.hullC).applyQuaternion(hb.q).negate().add(hb.p);
        this.checkSplash(hb, 0.6);
      }
      if (w.air && !w.crashed && hb.hits > 0) {
        // a downed aircraft hits the ground
        w.crashed = true;
        _v.set(hb.p.x, this.height(hb.p.x, hb.p.z) + 0.15, hb.p.z);
        if (_v.y > WATER_LEVEL) {
          this.light(_v.x, _v.y + 0.8, _v.z, 0xff9040, 5, 5, 0.6);
          this.effects.explosion(_v, 'medium', 1.1);
          this.effects.scorch(_v, 1.0);
        } else this.effects.waterSplash(_v, 1.4);
      }
    }
    const tb = w.turretBody;
    const t = w.turret;
    if (tb && t && t.parent) {
      if (!tb.sleeping || (hb && !hb.sleeping)) {
        root.updateMatrixWorld(true);
        // turret world = body * T(-centre); local = parent^-1 * world
        _m.compose(tb.p, tb.q, _s.set(1, 1, 1)).multiply(_m2.makeTranslation(-w.turretC.x, -w.turretC.y, -w.turretC.z));
        _m2.copy(t.parent.matrixWorld).invert().multiply(_m);
        _m2.decompose(t.position, _q, _s);
        t.quaternion.copy(_q);
        t.scale.set(1, 1, 1);
      }
      this.checkSplash(tb, 0.3);
    }
  }

  private endWreck(w: Wreck): void {
    if (w.hull) this.physics.release(w.hull);
    if (w.turretBody) this.physics.release(w.turretBody);
    w.hull = null;
    w.turretBody = null;
  }

  // ===========================================================================================
  // Infantry

  /** Start a ragdoll for an infantry death (not 'crushed'). Returns false if the pose animation should play. */
  infantryDeath(id: number, model: ModelInstance, how: string): boolean {
    if (how === 'crushed' || how === 'sold') return false;
    const kind: RagdollKind = how === 'blown' || how === 'burn' || how === 'electro' || how === 'bite' ? how : 'normal';
    // push direction: away from the most recent nearby blast, else backwards relative to the facing
    const p = model.root.position;
    let dx = 0, dz = 0;
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      if (this.time - b.t > 0.6) break;
      const ex = p.x - b.x, ez = p.z - b.z;
      if (ex * ex + ez * ez < b.r * b.r) {
        dx = ex;
        dz = ez;
        break;
      }
    }
    if (dx === 0 && dz === 0) {
      _v.set(-1, 0, 0).applyQuaternion(model.root.quaternion);
      dx = _v.x + rnd(-0.4, 0.4);
      dz = _v.z + rnd(-0.4, 0.4);
    }
    const r = this.ragdolls.start(model, kind, dx, dz);
    if (!r) return false;
    this.ragdollOf.set(id, r);
    return true;
  }

  /** True while a ragdoll owns this entity's skeleton (skip the model's own death animation). */
  hasRagdoll(id: number): boolean {
    return this.ragdollOf.has(id);
  }

  /** Recent explosions (for ragdoll push directions). Ring of the last few. */
  private blasts: { x: number; z: number; r: number; t: number }[] = [];

  // ===========================================================================================
  // Explosions, craters, Aftermath effects

  /**
   * An explosion in view (sim 'impact' event; call BEFORE the explosion effect so its scorch decal is laid
   * into the crater). Heavy blasts press persistent craters into the terrain.
   */
  onImpact(x: number, y: number, z: number, kind: string, scale: number): void {
    const ground = this.map.heightAt(x, y);
    const r = kind === 'nuke' ? 4 : kind === 'huge' ? 1.1 : kind === 'large' ? 0.75 : kind === 'medium' ? 0.55 : kind === 'small' ? 0.4 : 0;
    if (r > 0) {
      this.blasts.push({ x, z: y, r: r * 1.6 * Math.max(0.6, scale), t: this.time });
      if (this.blasts.length > 12) this.blasts.shift();
    }
    if (kind === 'mad' || kind === 'seismic') {
      this.madPulse(x, y, 3.5 * Math.max(0.5, scale));
      return;
    }
    if (kind === 'demo' || kind === 'mininuke') {
      this.demoBlast(x, y, scale);
      return;
    }
    // the demolition truck's charge arrives as a small 'nuke': give it its burning ring
    if (kind === 'nuke' && scale < 0.9 && this.ctx) demoRing(this.ctx, x, this.map.surfaceAt(x, y), y, scale * 2);
    if (z - ground > 0.5 || ground <= WATER_LEVEL) return;
    const sc = Math.max(0.6, Math.min(1.6, scale));
    const depth = kind === 'nuke' ? 0.32 : kind === 'huge' ? 0.085 : kind === 'large' ? 0.05 : 0;
    if (depth > 0) this.crater(x, y, r * sc, depth * Math.max(0.6, Math.min(1.5, scale)));
    else if ((kind === 'medium' || kind === 'fire') && this.terrain?.scorch) {
      const rr = (kind === 'fire' ? 0.5 : 0.45) * sc;
      this.terrain.scorch(x, y, rr, 0.35);
      this.scars.burnAt(x, y, rr, 0.35);
    }
  }

  /**
   * Press a crater into the rendered terrain (terrain.deform). Policy (destruction-scars.ts): craters stay for
   * the match; a hit close to a live crater deepens it only so far (then just refreshes it); at most
   * CRATERS_PER_FRAME are pressed per frame; over the live budget the least recently hit crater heals back in
   * steps (a negative depth makes terrain.deform heal the ground) and leaves burnt ground behind.
   */
  crater(x: number, y: number, radius: number, depth: number): void {
    const t = this.terrain;
    if (!t?.deform) return;
    if (this.map.heightAt(x, y) <= WATER_LEVEL + 0.02) return;
    if (this.cratersThisFrame >= CRATERS_PER_FRAME) return;
    if (this.scars.depthNear(x, y) > depth * 2.5) {
      // deep enough already: the crater counts as freshly hit
      this.scars.addCrater(x, y, radius, 1e-3, this.time);
      return;
    }
    t.deform(x, y, radius, depth);
    this.cratersThisFrame++;
    const res = this.scars.addCrater(x, y, radius, depth, this.time);
    this.scars.burnAt(x, y, radius * 1.3, 0.35);
    for (const c of res.evicted) this.healing.push({ c, step: 0, next: this.time });
  }

  private cratersThisFrame = 0;

  /** Evicted craters heal back in steps; the burn stays. */
  private updateCraters(): void {
    const t = this.terrain;
    if (!t?.deform || !this.healing.length) return;
    for (let i = this.healing.length - 1; i >= 0; i--) {
      const h = this.healing[i];
      if (this.time < h.next) continue;
      const c = h.c;
      t.deform(c.x, c.y, c.r, -c.d / CRATER_HEAL_STEPS);
      h.step++;
      h.next = this.time + CRATER_HEAL_DT;
      if (h.step >= CRATER_HEAL_STEPS) {
        t.scorch?.(c.x, c.y, c.r * 1.2, HEALED_BURN);
        this.healing[i] = this.healing[this.healing.length - 1];
        this.healing.pop();
      }
    }
  }

  /**
   * A tree burnt down at world (x, groundY, z) (vegetation.syncTrees): a charred stump, often its trunk fallen
   * away from the most recent blast nearby, and burnt ground around it.
   */
  treeDown(x: number, groundY: number, z: number, scale = 0.85): void {
    if (!Number.isFinite(x + groundY + z)) return;
    const h = (k: number) => {
      const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
      return v - Math.floor(v);
    };
    let fall = NaN;
    if (h(1) < 0.6) {
      fall = h(2) * Math.PI * 2;
      for (let i = this.blasts.length - 1; i >= 0; i--) {
        const b = this.blasts[i];
        if (this.time - b.t > 1.5) break;
        const dx = x - b.x, dz = z - b.z;
        if (dx * dx + dz * dz < (b.r * 2.5) ** 2) { fall = Math.atan2(dz, dx) + (h(3) - 0.5) * 0.6; break; }
      }
    }
    const tree = { x, y: z, z: groundY, s: Math.max(0.5, Math.min(1.4, scale * (0.85 + 0.3 * h(4)))), yaw: h(5) * Math.PI * 2, fall };
    const old = this.scars.addTree(tree);
    if (old) this.burntTrees.remove(old);
    this.burntTrees.add(tree);
    this.terrain?.scorch?.(x, z, 0.6, TREE_BURN);
    this.scars.burnAt(x, z, 0.6, TREE_BURN);
  }

  /** Burnt remains of trees (diagnostics). */
  get burntTreeCount(): number {
    return this.burntTrees.count;
  }

  /** Everything the battlefield remembers, as plain JSON for a save game. */
  saveScars(): ScarSnapshot {
    const marks = (this.effects as unknown as { scarSnapshot?: () => number[][] }).scarSnapshot?.() ?? [];
    return this.scars.snapshot(marks, Rubble.current?.snapshot() ?? []);
  }

  /**
   * Paint a saved battlefield again (after setTerrain): craters, burnt ground, scorch marks, burnt trees, rubble.
   * The JSON comes from a save file: everything is validated (ScarLedger.restore). Returns false if unusable.
   */
  loadScars(json: unknown): boolean {
    const r = ScarLedger.restore(json, this.scars.w, this.scars.h, this.scars.maxCraters, this.scars.maxTrees);
    if (!r) return false;
    const t = this.terrain;
    const L = r.ledger;
    // burnt ground: one soft stamp per scorched cell
    if (t?.scorch) {
      for (let k = 0; k < L.burn.length; k++) {
        const v = L.burn[k];
        if (v > 8) t.scorch((k % L.w) + 0.5, Math.floor(k / L.w) + 0.5, 0.85, (v / 255) * 0.6);
      }
    }
    for (const c of L.craters) {
      if (t?.deform) t.deform(c.x, c.y, c.r, c.d);
      this.scars.craters.push({ ...c, used: this.time });
    }
    this.scars.burn.set(L.burn);
    for (const tr of L.trees) {
      const old = this.scars.addTree(tr);
      if (old) this.burntTrees.remove(old);
      this.burntTrees.add(tr);
    }
    (this.effects as unknown as { restoreScars?: (m: number[][]) => void }).restoreScars?.(r.marks);
    Rubble.current?.restore(r.ruins);
    return true;
  }

  /** M.A.D. tank seismic pulse at map (x, y) (sim 'quake' event): ground rings racing out to `radius`, dust, shake. */
  madPulse(x: number, y: number, radius = 3.5): void {
    if (this.ctx) madPulse(this.ctx, x, this.map.surfaceAt(x, y), y, radius * 0.6);
    this.light(x, this.map.surfaceAt(x, y) + 1, y, 0xffa060, 4, radius, 0.45);
    this.effects.shake += 0.35;
    // nearby debris and wrecks jump
    for (const b of this.physics.bodies) {
      const dx = b.p.x - x, dz = b.p.z - y;
      if (dx * dx + dz * dz > radius * radius) continue;
      b.wake();
      b.v.y += rnd(0.6, 1.4);
      b.w.x += rnd(-2, 2);
      b.w.z += rnd(-2, 2);
    }
  }

  /** Demolition truck detonation at map (x, y): a small nuclear blast with a crater. */
  demoBlast(x: number, y: number, scale = 1): void {
    const g = this.map.surfaceAt(x, y);
    this.crater(x, y, 1.6 * scale, 0.14 * scale);
    if (this.ctx) {
      demoBlast(this.ctx, x, g, y, scale);
      if (this.ctx.heat) explosionHeat(this.ctx.heat, 'nuke', x, g, y, g, 0.45 * scale);
    } else this.effects.explosion(_v.set(x, g + 0.3, y), 'huge', 1.6 * scale);
    this.effects.shake += 1.2 * scale;
  }

  /** Mechanic repairing a vehicle at world (x, y, z): welding sparks instead of the medic's green crosses. */
  repair(x: number, y: number, z: number): boolean {
    if (!this.ctx) return false;
    repairSparks(this.ctx, x, y, z);
    return true;
  }

  /** Chrono tank jump: the chronosphere shimmer at both ends and a rift between them. */
  chronoJump(fromX: number, fromY: number, toX: number, toY: number): void {
    if (this.ctx) chronoShift(this.ctx, fromX, this.map.surfaceAt(fromX, fromY), fromY, toX, this.map.surfaceAt(toX, toY), toY);
    else {
      this.effects.chronoFlash(_v.set(fromX, this.map.surfaceAt(fromX, fromY), fromY));
      this.effects.chronoFlash(_v.set(toX, this.map.surfaceAt(toX, toY), toY));
    }
  }

  // ===========================================================================================

  /** A dynamic point light through effects.addDynamicLight (when available). */
  private light(x: number, y: number, z: number, color: number, intensity: number, radius: number, duration: number): void {
    const fx = this.effects as unknown as { addDynamicLight?: (x: number, y: number, z: number, c: number, i: number, r: number, d: number) => void };
    fx.addDynamicLight?.(x, y, z, color, intensity, radius, duration);
  }

  private checkSplash(b: RigidBody, size: number): void {
    // tag bit 1: already splashed
    if (b.tag & 1 || b.p.y > WATER_LEVEL || b.v.y > 0) return;
    if (this.map.heightAt(b.p.x, b.p.z) > WATER_LEVEL) return;
    b.tag |= 1;
    this.effects.waterSplash(_v.set(b.p.x, WATER_LEVEL, b.p.z), Math.min(1.6, 0.35 + size));
  }

  /** The entity's view went away: drop every reference to its model. */
  forget(id: number): void {
    const w = this.wrecks.get(id);
    if (w) {
      this.endWreck(w);
      this.wrecks.delete(id);
    }
    const r = this.ragdollOf.get(id);
    if (r) {
      this.ragdolls.stop(r);
      this.ragdollOf.delete(id);
    }
    this.clearDamage(id);
    const amb = this.ambientFx.get(id);
    if (amb) {
      for (const e of amb) e.dispose();
      this.ambientFx.delete(id);
    }
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.cratersThisFrame = 0;
    setBodyTime(time);
    if (!(dt > 0)) {
      this.debris.flush();
      return;
    }
    dt = Math.min(dt, 0.1);
    this.physics.update(dt);
    for (let i = this.collapses.length - 1; i >= 0; i--) {
      const c = this.collapses[i];
      if (!this.updateCollapse(c, dt)) {
        this.endCollapse(c);
        this.collapses[i] = this.collapses[this.collapses.length - 1];
        this.collapses.pop();
      }
    }
    for (const w of this.wrecks.values()) {
      this.updateWreck(w, dt);
      if (w.t > 9 && (w.hull || w.turretBody) && (!w.hull || w.hull.sleeping) && (!w.turretBody || w.turretBody.sleeping)) this.endWreck(w);
    }
    this.ragdolls.update(dt, this.height);
    // debris pieces: fly, settle, linger, sink
    for (const b of this.pieceBounds) b.makeEmpty();
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const pc = this.pieces[i];
      pc.t += dt;
      const b = pc.body;
      if (!pc.wet && b.p.y < WATER_LEVEL && this.map.heightAt(b.p.x, b.p.z) <= WATER_LEVEL) {
        pc.wet = true;
        this.effects.waterSplash(_v.set(b.p.x, WATER_LEVEL, b.p.z), 0.35);
      }
      let s = pc.scale;
      if (pc.t > DEBRIS_LIFE) {
        const k = (pc.t - DEBRIS_LIFE) / 1.5;
        if (k >= 1) {
          this.debris.release(pc.shape, pc.slot);
          this.physics.release(b);
          this.pieces[i] = this.pieces[this.pieces.length - 1];
          this.pieces.pop();
          continue;
        }
        s *= 1 - k;
        _v.copy(b.p).y -= k * 0.06;
        this.debris.set(pc.shape, pc.slot, _v, b.q, s);
        this.pieceBounds[pc.shape].expandByPoint(b.p);
        continue;
      }
      if (!b.sleeping || pc.t < 0.05) this.debris.set(pc.shape, pc.slot, b.p, b.q, s);
      this.pieceBounds[pc.shape].expandByPoint(b.p);
    }
    for (let k = 0; k < this.pieceBounds.length; k++) this.debris.setBounds(k, this.pieceBounds[k]);
    this.debris.flush();
    for (let i = this.burning.length - 1; i >= 0; i--) {
      const f = this.burning[i];
      f.t += dt;
      const k = f.t < 8 ? f.k : f.k * Math.max(0, 1 - (f.t - 8) / 6);
      f.em.setIntensity(k);
      if (k <= 0) {
        f.em.dispose();
        this.fires--;
        this.burning[i] = this.burning[this.burning.length - 1];
        this.burning.pop();
      }
    }
    this.updateCraters();
    this.burntTrees.flush();
  }

  /** Counters for diagnostics / perf reports. */
  stats(): { collapses: number; bodies: number; awake: number; ragdolls: number; pieces: number; craters: number; fires: number; damageEmitters: number } {
    return {
      collapses: this.collapses.length, bodies: this.physics.used, awake: this.physics.awake, ragdolls: this.ragdolls.active.length,
      pieces: this.pieces.length, craters: this.scars.craters.length, fires: this.fires, damageEmitters: this.damageCount,
    };
  }

  dispose(): void {
    for (const c of this.collapses) this.endCollapse(c);
    this.collapses.length = 0;
    for (const f of this.burning) f.em.dispose();
    this.burning.length = 0;
    this.fires = 0;
    for (const list of this.meshPool.values()) for (const r of list) r.mesh.skeleton.dispose();
    this.meshPool.clear();
    for (const w of this.wrecks.values()) this.endWreck(w);
    this.wrecks.clear();
    for (const id of [...this.damage.keys()]) this.clearDamage(id);
    for (const list of this.ambientFx.values()) for (const e of list) e.dispose();
    this.ambientFx.clear();
    for (const r of [...this.ragdollOf.values()]) this.ragdolls.stop(r);
    this.ragdollOf.clear();
    this.physics.clear();
    this.pieces.length = 0;
    this.debris.dispose();
    this.burntTrees.dispose();
    for (const o of this.warm.children) (o as THREE.SkinnedMesh).skeleton?.dispose();
    this.group.removeFromParent();
    if (DecalSystem.terrainHeight) DecalSystem.terrainHeight = null;
    void this.scene;
  }
}
