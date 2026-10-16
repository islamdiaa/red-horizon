/**
 * Lightweight rigid-body solver for visual debris (building chunks, popped turrets, wreck hulls,
 * wheels and plates). No external physics library: boxes against a terrain heightfield with gravity,
 * impulse-based contacts (restitution + Coulomb friction), soft sphere repulsion between bodies of the
 * same group, damping and sleeping. Purely visual: it never feeds back into the simulation.
 *
 * Everything is pooled and allocation-free per frame (scratch vectors, fixed body pool).
 */
import * as THREE from 'three';

export type HeightFn = (x: number, z: number) => number;

/** Units: 1 world unit = 1 map cell. Debris uses a snappy, slightly exaggerated gravity for the RTS scale. */
export const GRAVITY = 7.5;
const SUBSTEP = 1 / 60;
const MAX_SUBSTEPS = 3;
const SLEEP_V2 = 0.02;
const SLEEP_W2 = 0.12;
const SLEEP_TIME = 0.45;
/** Bodies of one group push each other apart only this long after release. */
const SEPARATE_TIME = 1.6;

const _r = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _t = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _corner = new THREE.Vector3();
const SIGNS = [-1, -1, -1, 1, -1, -1, -1, 1, -1, 1, 1, -1, -1, -1, 1, 1, -1, 1, -1, 1, 1, 1, 1, 1];

export class RigidBody {
  readonly p = new THREE.Vector3();
  readonly q = new THREE.Quaternion();
  readonly v = new THREE.Vector3();
  readonly w = new THREE.Vector3();
  /** Box half extents (local frame). */
  readonly he = new THREE.Vector3(0.1, 0.1, 0.1);
  invMass = 1;
  /** Diagonal inverse inertia (local frame). */
  readonly invI = new THREE.Vector3(1, 1, 1);
  restitution = 0.22;
  friction = 0.65;
  /** Bounding radius (for soft body-body repulsion). */
  radius = 0.1;
  /** Bodies only repel others of the same group (one building's chunks, one wreck's parts). 0 = none. */
  group = 0;
  sleeping = false;
  active = false;
  /** Seconds since activation. */
  age = 0;
  /** Force sleep after this many seconds (cost cap). */
  maxAwake = 6;
  /** Touching the ground during the last step. */
  grounded = false;
  /** Largest impact speed seen in the last step (for dust / sparks / splashes). */
  impact = 0;
  /** Number of ground hits so far. */
  hits = 0;
  private sleepT = 0;
  /** Opaque owner slot (destruction system bookkeeping). */
  tag = 0;

  /** Configure as a box of half extents (hx, hy, hz) and density-ish mass. */
  setBox(hx: number, hy: number, hz: number, mass = -1): this {
    this.he.set(Math.max(0.005, hx), Math.max(0.005, hy), Math.max(0.005, hz));
    const m = mass > 0 ? mass : Math.max(0.02, 8 * hx * hy * hz * 4);
    this.invMass = 1 / m;
    const x2 = 4 * hx * hx, y2 = 4 * hy * hy, z2 = 4 * hz * hz;
    this.invI.set(12 / (m * (y2 + z2)), 12 / (m * (x2 + z2)), 12 / (m * (x2 + y2)));
    this.radius = Math.hypot(hx, hy, hz);
    return this;
  }

  reset(): this {
    this.v.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.q.identity();
    this.sleeping = false;
    this.sleepT = 0;
    this.age = 0;
    this.grounded = false;
    this.impact = 0;
    this.hits = 0;
    this.group = 0;
    this.restitution = 0.22;
    this.friction = 0.65;
    this.maxAwake = 6;
    return this;
  }

  wake(): void {
    this.sleeping = false;
    this.sleepT = 0;
  }

  /** World-space inverse inertia applied to `v` (in place). */
  applyInvInertia(v: THREE.Vector3): THREE.Vector3 {
    // R * diag(invI) * R^T * v
    _tmp.copy(v).applyQuaternion(_dq.copy(this.q).invert());
    _tmp.set(_tmp.x * this.invI.x, _tmp.y * this.invI.y, _tmp.z * this.invI.z);
    return v.copy(_tmp.applyQuaternion(this.q));
  }

  /** Apply an impulse J at world point c. */
  applyImpulse(jx: number, jy: number, jz: number, cx: number, cy: number, cz: number): void {
    this.v.x += jx * this.invMass;
    this.v.y += jy * this.invMass;
    this.v.z += jz * this.invMass;
    _r.set(cx - this.p.x, cy - this.p.y, cz - this.p.z);
    _tmp2.set(jx, jy, jz);
    _r.cross(_tmp2);
    this.applyInvInertia(_r);
    this.w.add(_r);
  }

  /** Integrate + collide one substep. Returns true while awake. */
  step(dt: number, height: HeightFn, gravity: number): boolean {
    if (!this.active || this.sleeping) return false;
    this.age += dt;
    this.v.y -= gravity * dt;
    // light air drag, stronger angular damping (keeps debris from spinning forever)
    // resting contact: slow pieces on the ground lose energy fast (no endless creeping / rocking)
    const resting = this.grounded && this.v.lengthSq() < 0.09;
    const ld = Math.exp(-(resting ? 5 : 0.15) * dt);
    const ad = Math.exp(-(this.grounded ? (resting ? 6 : 2.5) : 0.35) * dt);
    this.v.multiplyScalar(ld);
    this.w.multiplyScalar(ad);
    this.p.addScaledVector(this.v, dt);
    // q += 0.5 * (0, w) * q * dt
    const wx = this.w.x * dt * 0.5, wy = this.w.y * dt * 0.5, wz = this.w.z * dt * 0.5;
    const q = this.q;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    q.x += wx * qw + wy * qz - wz * qy;
    q.y += wy * qw + wz * qx - wx * qz;
    q.z += wz * qw + wx * qy - wy * qx;
    q.w += -wx * qx - wy * qy - wz * qz;
    q.normalize();
    this.collideGround(height);
    // sleep
    if (this.grounded && this.v.lengthSq() < SLEEP_V2 && this.w.lengthSq() < SLEEP_W2) {
      this.sleepT += dt;
      if (this.sleepT > SLEEP_TIME) {
        this.sleeping = true;
        this.v.set(0, 0, 0);
        this.w.set(0, 0, 0);
      }
    } else this.sleepT = 0;
    if ((this.age > this.maxAwake && this.grounded) || this.age > this.maxAwake + 3) {
      this.sleeping = true;
      this.v.set(0, 0, 0);
      this.w.set(0, 0, 0);
    }
    return !this.sleeping;
  }

  private collideGround(height: HeightFn): void {
    // quick reject: lowest possible point above the ground under the centre
    const gc = height(this.p.x, this.p.z);
    if (this.p.y - this.radius > gc + 0.05) {
      this.grounded = false;
      return;
    }
    let grounded = false;
    let maxPen = 0;
    let nx = 0, ny = 1, nz = 0;
    // two passes of sequential impulses over the 8 corners
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < 8; k++) {
        _corner.set(SIGNS[k * 3] * this.he.x, SIGNS[k * 3 + 1] * this.he.y, SIGNS[k * 3 + 2] * this.he.z).applyQuaternion(this.q).add(this.p);
        const h = height(_corner.x, _corner.z);
        const pen = h - _corner.y;
        if (pen <= 0) continue;
        grounded = true;
        // terrain normal by central differences
        const e = 0.12;
        const hx = height(_corner.x + e, _corner.z) - height(_corner.x - e, _corner.z);
        const hz = height(_corner.x, _corner.z + e) - height(_corner.x, _corner.z - e);
        _n.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
        if (pass === 0 && pen > maxPen) {
          maxPen = pen;
          nx = _n.x; ny = _n.y; nz = _n.z;
        }
        _r.subVectors(_corner, this.p);
        // velocity of the contact point
        _vc.copy(this.w).cross(_r).add(this.v);
        const vn = _vc.dot(_n);
        if (vn >= 0) continue;
        if (pass === 0 && -vn > this.impact) this.impact = -vn;
        // effective mass along n
        _c.copy(_r).cross(_n);
        this.applyInvInertia(_c);
        _c.cross(_r);
        const kn = this.invMass + _n.dot(_c);
        const e2 = -vn > 0.9 ? this.restitution : 0;
        const jn = (-(1 + e2) * vn) / kn;
        // friction along the tangential slip direction
        _t.copy(_vc).addScaledVector(_n, -vn);
        const vt = _t.length();
        let jt = 0;
        if (vt > 1e-5) {
          _t.multiplyScalar(1 / vt);
          _c.copy(_r).cross(_t);
          this.applyInvInertia(_c);
          _c.cross(_r);
          const kt = this.invMass + _t.dot(_c);
          jt = Math.min(vt / kt, this.friction * jn);
        }
        this.applyImpulse(
          _n.x * jn - _t.x * jt, _n.y * jn - _t.y * jt, _n.z * jn - _t.z * jt,
          _corner.x, _corner.y, _corner.z,
        );
      }
    }
    if (maxPen > 0) {
      // positional correction along the deepest contact normal
      const k = Math.min(maxPen, 0.2) * 0.85;
      this.p.x += nx * k;
      this.p.y += ny * k;
      this.p.z += nz * k;
    }
    if (grounded && !this.grounded) this.hits++;
    this.grounded = grounded;
  }

  /** World matrix of the body (position + rotation). */
  matrix(out: THREE.Matrix4): THREE.Matrix4 {
    return out.makeRotationFromQuaternion(this.q).setPosition(this.p);
  }
}

/**
 * Fixed pool of rigid bodies stepped together at a fixed substep. Bodies of the same group repel each
 * other softly (so a collapsing building's chunks spread instead of melting into one another).
 */
export class PhysicsWorld {
  readonly bodies: RigidBody[] = [];
  private free: RigidBody[] = [];
  private acc = 0;
  gravity = GRAVITY;
  /** Active, awake bodies after the last update. */
  awake = 0;

  constructor(
    public height: HeightFn,
    readonly capacity = 256,
  ) {
    for (let i = 0; i < capacity; i++) this.free.push(new RigidBody());
  }

  /** A fresh body, or null when the pool is exhausted. */
  alloc(): RigidBody | null {
    const b = this.free.pop();
    if (!b) return null;
    b.reset();
    b.active = true;
    this.bodies.push(b);
    return b;
  }

  release(b: RigidBody): void {
    if (!b.active) return;
    b.active = false;
    const i = this.bodies.indexOf(b);
    if (i >= 0) {
      this.bodies[i] = this.bodies[this.bodies.length - 1];
      this.bodies.pop();
    }
    this.free.push(b);
  }

  get used(): number {
    return this.bodies.length;
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    this.acc = Math.min(this.acc + dt, SUBSTEP * MAX_SUBSTEPS);
    const list = this.bodies;
    for (const b of list) b.impact = 0;
    let steps = 0;
    while (this.acc >= SUBSTEP && steps < MAX_SUBSTEPS) {
      this.acc -= SUBSTEP;
      steps++;
      let awake = 0;
      for (let i = 0; i < list.length; i++) if (list[i].step(SUBSTEP, this.height, this.gravity)) awake++;
      this.awake = awake;
      if (awake > 1) this.separate();
    }
  }

  /**
   * Soft repulsion between awake bodies of the same (non-zero) group, horizontal only: pieces of one
   * collapse spread out over the ground instead of melting into each other, but never hold each other up
   * (a collapsed structure ends up lower and wider, and everything comes to rest on the terrain).
   */
  private separate(): void {
    const list = this.bodies;
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const a = list[i];
      if (!a.group) continue;
      for (let j = i + 1; j < n; j++) {
        const b = list[j];
        if (b.group !== a.group || (a.sleeping && b.sleeping)) continue;
        // only while the pieces are flying apart: packed rubble must be allowed to come to rest
        if (a.age > SEPARATE_TIME && b.age > SEPARATE_TIME) continue;
        const dx = b.p.x - a.p.x, dz = b.p.z - a.p.z;
        const dy = b.p.y - a.p.y;
        const rr = (a.radius + b.radius) * 0.55;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || dy * dy > rr * rr || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const pen = (rr - d) / d;
        const wa = a.sleeping ? 0 : a.invMass, wb = b.sleeping ? 0 : b.invMass;
        const ws = wa + wb;
        if (ws <= 0) continue;
        const k = Math.min(pen, 0.5) * 0.12;
        a.p.x -= dx * k * (wa / ws); a.p.z -= dz * k * (wa / ws);
        b.p.x += dx * k * (wb / ws); b.p.z += dz * k * (wb / ws);
        const rv = ((b.v.x - a.v.x) * dx + (b.v.z - a.v.z) * dz) / d;
        if (rv < 0) {
          const j2 = (-rv * 0.4) / ws / d;
          a.v.x -= dx * j2 * wa; a.v.z -= dz * j2 * wa;
          b.v.x += dx * j2 * wb; b.v.z += dz * j2 * wb;
        }
      }
    }
  }

  clear(): void {
    for (let i = this.bodies.length - 1; i >= 0; i--) this.release(this.bodies[i]);
  }
}

