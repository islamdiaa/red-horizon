import * as THREE from 'three';

const wrap = (v: number) => v - Math.floor(v);

/**
 * A camera-following particle volume (a parallelepiped). Particles live in normalised [0,1)^3
 * coordinates n and are mapped to world space with  world = base + M * (n - (0.5, 0.5, 0)).
 *
 * Everything that moves particles is accumulated here on the CPU as *normalised* phases, so the
 * vertex shader only does  n = fract(seed + lanePhase - camPhase):
 *  - camPhase compensates for the volume following the camera, so particles stay anchored in the
 *    world while panning (they only wrap around at the volume's edges, off-screen);
 *  - lanePhase integrates particle velocity (fall + wind) for 4 speed lanes.
 * Because both are integrated incrementally with the current frame matrix, zooming (which rescales
 * M) never makes particles jump.
 */
export class FollowVolume {
  readonly base = new THREE.Vector3();
  readonly matrix = new THREE.Matrix3();
  /** Normalised camera phase (wrapped to [0,1)). */
  readonly cam = new THREE.Vector3();
  /** Per-lane normalised drift phases. */
  readonly phX = new THREE.Vector4();
  readonly phY = new THREE.Vector4();
  readonly phZ = new THREE.Vector4();
  private inv = new THREE.Matrix3();
  private prev = new THREE.Vector3();
  private has = false;
  private tmp = new THREE.Vector3();

  /** Set the frame: base point (bottom centre) and the three edge vectors of the volume. */
  setFrame(base: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, az: THREE.Vector3): void {
    this.matrix.set(ax.x, ay.x, az.x, ax.y, ay.y, az.y, ax.z, ay.z, az.z);
    this.inv.copy(this.matrix).invert();
    if (this.has) {
      const d = this.tmp.subVectors(base, this.prev).applyMatrix3(this.inv);
      this.cam.set(wrap(this.cam.x + d.x), wrap(this.cam.y + d.y), wrap(this.cam.z + d.z));
    }
    this.prev.copy(base);
    this.base.copy(base);
    this.has = true;
  }

  /** Advance the lane phases by a world-space velocity (units/s) times per-lane speed factors. */
  drift(vel: THREE.Vector3, dt: number, lanes: ArrayLike<number>): void {
    const d = this.tmp.copy(vel).multiplyScalar(dt).applyMatrix3(this.inv);
    const X = this.phX, Y = this.phY, Z = this.phZ;
    X.set(wrap(X.x + d.x * lanes[0]), wrap(X.y + d.x * lanes[1]), wrap(X.z + d.x * lanes[2]), wrap(X.w + d.x * lanes[3]));
    Y.set(wrap(Y.x + d.y * lanes[0]), wrap(Y.y + d.y * lanes[1]), wrap(Y.z + d.y * lanes[2]), wrap(Y.w + d.y * lanes[3]));
    Z.set(wrap(Z.x + d.z * lanes[0]), wrap(Z.y + d.z * lanes[1]), wrap(Z.z + d.z * lanes[2]), wrap(Z.w + d.z * lanes[3]));
  }

  /** Uniform objects for the shader chunk VOLUME_GLSL (bind once, values update in place). */
  uniforms() {
    return {
      uM: { value: this.matrix },
      uB: { value: this.base },
      uCam: { value: this.cam },
      uPhX: { value: this.phX },
      uPhY: { value: this.phY },
      uPhZ: { value: this.phZ },
    };
  }
}
