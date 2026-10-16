/**
 * Procedural verlet ragdolls for infantry deaths.
 *
 * Eleven particles are taken from the soldier's own skeleton at the moment of death (pelvis, chest, head,
 * shoulders, hands, hips, feet), joined by distance constraints (a braced, rigid torso plus single-segment
 * limbs) and integrated with gravity, ground contact and friction. Every frame the particles are mapped
 * back onto the model's bones (body / torso / arms / legs), so the same skinned mesh simply flops over.
 * Death types differ: blown = tossed and tumbling, normal / bite = knocked back, burn = staggering and
 * flailing before collapsing, electro = rigid twitching while the body flashes, then a collapse.
 *
 * Ragdolls are pooled (fixed typed arrays, no per-frame allocation) and short-lived: they go to sleep
 * after a couple of seconds and freeze in their final pose.
 */
import * as THREE from 'three';
import type { ModelInstance } from './models/types';
import { BodyVariant } from './models/materials';
import type { HeightFn } from './destruction-physics';

export type RagdollKind = 'normal' | 'blown' | 'burn' | 'electro' | 'bite';

const NP = 11;
const PELVIS = 0, CHEST = 1, HEAD = 2, SH_L = 3, SH_R = 4, HAND_L = 5, HAND_R = 6, HIP_L = 7, HIP_R = 8, FOOT_L = 9, FOOT_R = 10;
/** Collision radius per particle. */
const RAD = [0.03, 0.035, 0.04, 0.022, 0.022, 0.018, 0.018, 0.022, 0.022, 0.02, 0.02];
/** Rigid pairs (torso cluster) and limbs; stiffness 1 = hard. */
const LINKS: [number, number, number][] = [
  [PELVIS, CHEST, 1], [PELVIS, SH_L, 1], [PELVIS, SH_R, 1], [CHEST, SH_L, 1], [CHEST, SH_R, 1], [SH_L, SH_R, 1],
  [CHEST, HEAD, 1], [HEAD, SH_L, 1], [HEAD, SH_R, 1], [PELVIS, HIP_L, 1], [PELVIS, HIP_R, 1], [HIP_L, HIP_R, 1],
  [CHEST, HIP_L, 1], [CHEST, HIP_R, 1], [SH_L, HIP_R, 1], [SH_R, HIP_L, 1],
  [SH_L, HAND_L, 1], [SH_R, HAND_R, 1], [HIP_L, FOOT_L, 1], [HIP_R, FOOT_R, 1],
];
/** Keep-apart pairs (min distance = fraction of rest distance): no limbs through the body. */
const APART: [number, number, number][] = [
  [HAND_L, HIP_L, 0.5], [HAND_R, HIP_R, 0.5], [FOOT_L, FOOT_R, 0.35], [FOOT_L, CHEST, 0.8], [FOOT_R, CHEST, 0.8],
  [HAND_L, HEAD, 0.6], [HAND_R, HEAD, 0.6], [HAND_L, HAND_R, 0.3],
];

const GRAV = 6.5;
/** Particles held up during a stagger, with their height above the pelvis. */
const HOLD_IDS = [PELVIS, CHEST, HEAD, SH_L, SH_R];
const HOLD_DY = [0, 0.105, 0.163, 0.105, 0.105];
const ITER = 5;
const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export class Ragdoll {
  readonly p = new Float32Array(NP * 3);
  readonly o = new Float32Array(NP * 3);
  private rest = new Float32Array(LINKS.length);
  private apart = new Float32Array(APART.length);
  model: ModelInstance | null = null;
  kind: RagdollKind = 'normal';
  t = 0;
  asleep = false;
  private still = 0;
  private rootInv = new THREE.Matrix4();
  private rootQ = new THREE.Quaternion();
  private bones: {
    body: THREE.Object3D; torso: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D;
  } | null = null;
  /** Standing pelvis height (for the stagger phase). */
  private standY = 0;
  private dirX = 1;
  private dirZ = 0;
  private flashT = 0;

  /** True if the model has a soldier skeleton this ragdoll can drive. */
  static fits(model: ModelInstance): boolean {
    const n = model.node;
    return !!n && !!n('torso') && !!n('armL') && !!n('armR') && !!n('legL') && !!n('legR') && !!n('body');
  }

  /**
   * Start from the model's current pose. (dirX, dirZ): horizontal direction the hit came FROM is unknown in
   * the sim, so callers pass a plausible push direction (away from the nearest blast, or random).
   */
  start(model: ModelInstance, kind: RagdollKind, dirX: number, dirZ: number): void {
    this.model = model;
    this.kind = kind;
    this.t = 0;
    this.asleep = false;
    this.still = 0;
    this.flashT = 0;
    const n = model.node!;
    const bones = (this.bones = { body: n('body')!, torso: n('torso')!, armL: n('armL')!, armR: n('armR')!, legL: n('legL')!, legR: n('legR')! });
    const root = model.root;
    root.updateMatrixWorld(true);
    this.rootInv.copy(root.matrixWorld).invert();
    root.getWorldQuaternion(this.rootQ);
    const set = (i: number, o: THREE.Object3D, x: number, y: number, z: number) => {
      _a.set(x, y, z);
      o.localToWorld(_a);
      this.p[i * 3] = _a.x;
      this.p[i * 3 + 1] = _a.y;
      this.p[i * 3 + 2] = _a.z;
    };
    set(PELVIS, bones.torso, 0, 0, 0);
    set(CHEST, bones.torso, 0, 0.105, 0);
    set(HEAD, bones.torso, 0.003, 0.163, 0);
    set(SH_L, bones.armL, 0, 0, 0);
    set(SH_R, bones.armR, 0, 0, 0);
    set(HAND_L, bones.armL, 0, -0.108, 0);
    set(HAND_R, bones.armR, 0, -0.108, 0);
    set(HIP_L, bones.legL, 0, 0, 0);
    set(HIP_R, bones.legR, 0, 0, 0);
    set(FOOT_L, bones.legL, 0.01, -0.135, 0);
    set(FOOT_R, bones.legR, 0.01, -0.135, 0);
    this.standY = this.p[PELVIS * 3 + 1];
    for (let k = 0; k < LINKS.length; k++) this.rest[k] = this.dist(LINKS[k][0], LINKS[k][1]);
    for (let k = 0; k < APART.length; k++) this.apart[k] = this.dist(APART[k][0], APART[k][1]) * APART[k][2];
    this.o.set(this.p);
    const l = Math.hypot(dirX, dirZ) || 1;
    this.dirX = dirX / l;
    this.dirZ = dirZ / l;
    // initial velocities (stored as previous positions, verlet style) at ~60 Hz
    const dt = 1 / 60;
    const kick = (i: number, vx: number, vy: number, vz: number) => {
      this.o[i * 3] = this.p[i * 3] - vx * dt;
      this.o[i * 3 + 1] = this.p[i * 3 + 1] - vy * dt;
      this.o[i * 3 + 2] = this.p[i * 3 + 2] - vz * dt;
    };
    const dx = this.dirX, dz = this.dirZ;
    switch (kind) {
      case 'blown': {
        const sp = rnd(0.7, 1.3);
        const up = rnd(1.5, 2.2);
        for (let i = 0; i < NP; i++) {
          const h = this.p[i * 3 + 1] - this.p[PELVIS * 3 + 1];
          // upper body faster: a tumbling toss
          kick(i, dx * sp * (1 + h * 2.5) + rnd(-0.2, 0.2), up * (1 + h * 1.2) + rnd(-0.15, 0.15), dz * sp * (1 + h * 2.5) + rnd(-0.2, 0.2));
        }
        break;
      }
      case 'normal':
      case 'bite': {
        const sp = kind === 'bite' ? rnd(0.9, 1.3) : rnd(0.5, 0.9);
        kick(HEAD, dx * sp * 1.3, 0.2, dz * sp * 1.3);
        kick(CHEST, dx * sp, 0.15, dz * sp);
        kick(SH_L, dx * sp, 0.1, dz * sp);
        kick(SH_R, dx * sp, 0.1, dz * sp);
        kick(HAND_L, dx * sp + rnd(-0.6, 0.6), rnd(0.2, 0.8), dz * sp + rnd(-0.6, 0.6));
        kick(HAND_R, dx * sp + rnd(-0.6, 0.6), rnd(0.2, 0.8), dz * sp + rnd(-0.6, 0.6));
        // knees give way: the feet slide slightly the other way
        kick(FOOT_L, -dx * 0.3, 0, -dz * 0.3);
        kick(FOOT_R, -dx * 0.3, 0, -dz * 0.3);
        break;
      }
      default:
        break;
    }
  }

  private dist(i: number, j: number): number {
    const p = this.p;
    return Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
  }

  /** Advance and pose the bones. Returns false once asleep (pose frozen). */
  update(dt: number, height: HeightFn): boolean {
    if (!this.model || this.asleep) return false;
    dt = Math.min(dt, 1 / 30);
    if (dt <= 0) return true;
    this.t += dt;
    this.scripted(dt);
    this.integrate(dt, height);
    this.pose();
    // sleep once nothing moves (or after a hard cap)
    let move = 0;
    for (let i = 0; i < NP * 3; i++) move = Math.max(move, Math.abs(this.p[i] - this.o[i]));
    if (move < 0.0012 && this.t > 0.6) this.still += dt;
    else this.still = 0;
    if (this.still > 0.35 || this.t > 4) this.asleep = true;
    return !this.asleep;
  }

  /** Death-type specific forces and material flashes. */
  private scripted(dt: number): void {
    const m = this.model!;
    const t = this.t;
    const p = this.p;
    if (this.kind === 'electro') {
      // rigid twitching while the current runs, flashing; then a stiff collapse
      if (t < 0.6) {
        this.flashT += dt;
        if (this.flashT > 0.045) {
          this.flashT = 0;
          m.setVariant?.(Math.random() < 0.55 ? BodyVariant.Electro : BodyVariant.Damaged);
        }
        this.hold(0.8, dt);
        // displacement jitter (no velocity gained)
        const o = this.o;
        for (let i = 0; i < NP; i++) {
          const jx = rnd(-0.006, 0.006), jy = rnd(-0.003, 0.004), jz = rnd(-0.006, 0.006);
          p[i * 3] += jx; p[i * 3 + 1] += jy; p[i * 3 + 2] += jz;
          o[i * 3] += jx; o[i * 3 + 1] += jy; o[i * 3 + 2] += jz;
        }
      } else if (t - dt < 0.6) {
        m.setVariant?.(BodyVariant.Charred);
        this.push(CHEST, -this.dirX * 0.6, 0.1, -this.dirZ * 0.6, dt);
        this.push(HEAD, -this.dirX * 0.8, 0.1, -this.dirZ * 0.8, dt);
      }
    } else if (this.kind === 'burn') {
      // staggering and flailing in flames, then a collapse forward
      if (t < 0.9) {
        if (t < dt * 1.5) m.setVariant?.(BodyVariant.Damaged);
        this.hold(0.65 - t * 0.35, dt);
        // flailing arms, swaying head (accelerations)
        const s = Math.sin(t * 19);
        this.push(HAND_L, rnd(-30, 30) * dt, (9 + 14 * s) * dt, rnd(-30, 30) * dt, dt);
        this.push(HAND_R, rnd(-30, 30) * dt, (9 - 14 * s) * dt, rnd(-30, 30) * dt, dt);
        this.push(HEAD, Math.sin(t * 7) * 4 * dt, 0, Math.cos(t * 6) * 4 * dt, dt);
      } else if (t - dt < 0.9) {
        this.push(CHEST, this.dirX * 0.7, 0, this.dirZ * 0.7, dt);
        this.push(HEAD, this.dirX * 0.9, 0, this.dirZ * 0.9, dt);
      }
      if (t > 0.35 && t - dt <= 0.35) m.setVariant?.(BodyVariant.Charred);
    } else if (this.kind === 'blown') {
      if (t < dt * 1.5) m.setVariant?.(BodyVariant.Damaged);
    }
  }

  /** Spring the pelvis / chest back toward standing (k = how upright). */
  private hold(k: number, dt: number): void {
    const p = this.p;
    const o = this.o;
    const target = this.standY;
    const pull = Math.min(1, dt * 40) * k;
    for (let h = 0; h < HOLD_IDS.length; h++) {
      const i = HOLD_IDS[h];
      const want = target + HOLD_DY[h];
      const dy = want - p[i * 3 + 1];
      p[i * 3 + 1] += dy * pull;
      o[i * 3 + 1] += dy * pull;
    }
  }

  /** Add a velocity (units / s) to a particle. */
  private push(i: number, vx: number, vy: number, vz: number, dt: number): void {
    const o = this.o;
    o[i * 3] -= vx * dt;
    o[i * 3 + 1] -= vy * dt;
    o[i * 3 + 2] -= vz * dt;
  }

  private integrate(dt: number, height: HeightFn): void {
    const p = this.p;
    const o = this.o;
    const g = GRAV * dt * dt;
    for (let i = 0; i < NP; i++) {
      const k = i * 3;
      const vx = (p[k] - o[k]) * 0.995, vy = (p[k + 1] - o[k + 1]) * 0.995, vz = (p[k + 2] - o[k + 2]) * 0.995;
      o[k] = p[k];
      o[k + 1] = p[k + 1];
      o[k + 2] = p[k + 2];
      p[k] += vx;
      p[k + 1] += vy - g;
      p[k + 2] += vz;
    }
    for (let it = 0; it < ITER; it++) {
      for (let c = 0; c < LINKS.length; c++) {
        const [i, j] = LINKS[c];
        this.solve(i, j, this.rest[c], false);
      }
      for (let c = 0; c < APART.length; c++) {
        const [i, j] = APART[c];
        this.solve(i, j, this.apart[c], true);
      }
      // ground with friction
      for (let i = 0; i < NP; i++) {
        const k = i * 3;
        const gy = height(p[k], p[k + 2]) + RAD[i];
        if (p[k + 1] < gy) {
          p[k + 1] = gy;
          // friction: kill most horizontal motion on contact
          o[k] += (p[k] - o[k]) * 0.35;
          o[k + 2] += (p[k + 2] - o[k + 2]) * 0.35;
          if (o[k + 1] < gy - 0.0001) o[k + 1] = p[k + 1] + (p[k + 1] - o[k + 1]) * 0.2;
        }
      }
    }
  }

  private solve(i: number, j: number, rest: number, minOnly: boolean): void {
    const p = this.p;
    const a = i * 3, b = j * 3;
    const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) return;
    if (minOnly && d >= rest) return;
    const k = ((d - rest) / d) * 0.5;
    p[a] += dx * k; p[a + 1] += dy * k; p[a + 2] += dz * k;
    p[b] -= dx * k; p[b + 1] -= dy * k; p[b + 2] -= dz * k;
  }

  /** Particle i in model-local space. */
  private local(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]).applyMatrix4(this.rootInv);
  }

  /** Map the particles onto the bones (all in model-local space). */
  private pose(): void {
    const b = this.bones!;
    b.body.position.set(0, 0, 0);
    b.body.quaternion.identity();
    b.body.scale.set(1, 1, 1);
    // torso frame: Y = pelvis -> chest, Z = left -> right shoulder, X = forward
    const pel = this.local(PELVIS, _a);
    const chest = this.local(CHEST, _b);
    _y.subVectors(chest, pel).normalize();
    this.local(SH_R, _z);
    this.local(SH_L, _x);
    _z.sub(_x);
    _z.addScaledVector(_y, -_z.dot(_y)).normalize();
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    b.torso.position.copy(pel);
    b.torso.quaternion.copy(_q);
    _qi.copy(_q).invert();
    // arms: hang along local -Y from the shoulder toward the hand, in torso space
    this.limb(b.armL, SH_L, HAND_L, _qi, false);
    this.limb(b.armR, SH_R, HAND_R, _qi, false);
    // legs: in body (model) space, rooted at the hip particles
    this.limb(b.legL, HIP_L, FOOT_L, null, true);
    this.limb(b.legR, HIP_R, FOOT_R, null, true);
  }

  private limb(bone: THREE.Object3D, from: number, to: number, parentInv: THREE.Quaternion | null, setPos: boolean): void {
    const a = this.local(from, _a);
    const d = this.local(to, _b).sub(a);
    if (parentInv) d.applyQuaternion(parentInv);
    if (d.lengthSq() < 1e-10) return;
    d.normalize();
    bone.quaternion.setFromUnitVectors(DOWN, d);
    if (setPos) bone.position.copy(a);
  }

  release(): void {
    this.model = null;
    this.bones = null;
  }
}

/** Fixed pool of ragdolls with a hard cap on simultaneous ones. */
export class RagdollPool {
  private free: Ragdoll[] = [];
  readonly active: Ragdoll[] = [];

  constructor(readonly cap = 24) {
    for (let i = 0; i < cap; i++) this.free.push(new Ragdoll());
  }

  /** A ragdoll for this model, or null at the cap / for skeletons it can't drive. */
  start(model: ModelInstance, kind: RagdollKind, dirX: number, dirZ: number): Ragdoll | null {
    if (!Ragdoll.fits(model)) return null;
    let r = this.free.pop();
    if (!r) {
      // steal the oldest sleeping one (its pose is frozen anyway)
      const i = this.active.findIndex((a) => a.asleep);
      if (i < 0) return null;
      r = this.active[i];
      this.active.splice(i, 1);
      r.release();
    }
    r.start(model, kind, dirX, dirZ);
    this.active.push(r);
    return r;
  }

  stop(r: Ragdoll): void {
    const i = this.active.indexOf(r);
    if (i >= 0) this.active.splice(i, 1);
    r.release();
    this.free.push(r);
  }

  update(dt: number, height: HeightFn): void {
    for (const r of this.active) if (!r.asleep) r.update(dt, height);
  }
}

