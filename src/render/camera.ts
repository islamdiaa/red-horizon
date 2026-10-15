import * as THREE from 'three';
import { clamp, lerp } from '../core/util';

/**
 * RTS camera: orbits a ground focus point at a fixed yaw (north up, like the original),
 * with smooth zoom, keyboard / edge / drag panning and a little cinematic tilt when zoomed in.
 */
export class RTSCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Focus point on the ground (map coordinates). */
  x: number;
  y: number;
  /** Distance from focus point. */
  dist = 26;
  targetDist = 26;
  minDist = 9;
  maxDist = 52;
  yaw = 0;
  targetYaw = 0;
  private vx = 0;
  private vy = 0;
  shakeOffset = new THREE.Vector3();
  /** Height provider for the focus point. */
  heightAt: (x: number, y: number) => number = () => 0;
  /** Smooth "fly to" animation. */
  private flyFrom: [number, number] | null = null;
  private flyTo: [number, number] | null = null;
  private flyT = 0;
  private flyRate = 2.2;
  /** Smoothing for zoom / rotation (smaller = snappier). Raised during cinematics. */
  zoomDamp = 0.0001;
  yawDamp = 0.001;

  constructor(private mapW: number, private mapH: number, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.5, 400);
    this.x = mapW / 2;
    this.y = mapH / 2;
  }

  /** Pitch angle in radians from horizontal (steeper when zoomed out). */
  get pitch(): number {
    const t = (this.dist - this.minDist) / (this.maxDist - this.minDist);
    return lerp(0.82, 1.05, clamp(t, 0, 1));
  }

  jumpTo(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.flyTo = null;
    this.clampFocus();
  }

  flyToPoint(x: number, y: number, seconds = 0.45) {
    this.flyFrom = [this.x, this.y];
    this.flyTo = [x, y];
    this.flyT = 0;
    this.flyRate = 1 / Math.max(0.05, seconds);
  }

  zoomBy(delta: number) {
    this.targetDist = clamp(this.targetDist * Math.pow(1.0015, delta), this.minDist, this.maxDist);
  }

  /** Pan in screen-aligned directions (cells/second scaled by zoom). */
  pan(dx: number, dy: number, dt: number) {
    const speed = this.dist * 1.25;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const mx = dx * c - dy * s, my = dx * s + dy * c;
    this.vx = lerp(this.vx, mx * speed, Math.min(1, dt * 12));
    this.vy = lerp(this.vy, my * speed, Math.min(1, dt * 12));
    // InputController calls pan(0, 0) every frame: only real scroll input may cancel a fly-to
    // (otherwise the intro sweep, H, Space and group double-tap never move the camera)
    if (dx || dy) this.flyTo = null;
  }

  /** Drag the map by a world-space delta. */
  dragBy(dx: number, dy: number) {
    this.x -= dx;
    this.y -= dy;
    this.flyTo = null;
    this.clampFocus();
  }

  private clampFocus() {
    const margin = 2;
    this.x = clamp(this.x, margin, this.mapW - margin);
    this.y = clamp(this.y, margin, this.mapH - margin);
  }

  update(dt: number) {
    dt = Math.max(0, dt);
    if (this.flyTo && this.flyFrom) {
      this.flyT = Math.min(1, this.flyT + dt * this.flyRate);
      const e = this.flyT < 0.5 ? 4 * this.flyT ** 3 : 1 - Math.pow(-2 * this.flyT + 2, 3) / 2;
      this.x = lerp(this.flyFrom[0], this.flyTo[0], e);
      this.y = lerp(this.flyFrom[1], this.flyTo[1], e);
      if (this.flyT >= 1) this.flyTo = null;
    } else {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= Math.pow(0.0005, dt);
      this.vy *= Math.pow(0.0005, dt);
    }
    this.clampFocus();
    this.dist = lerp(this.dist, this.targetDist, 1 - Math.pow(this.zoomDamp, dt));
    this.yaw = lerp(this.yaw, this.targetYaw, 1 - Math.pow(this.yawDamp, dt));
    this.apply();
  }

  apply() {
    const pitch = this.pitch;
    const gy = Math.max(0, this.heightAt(this.x, this.y));
    const horiz = Math.cos(pitch) * this.dist;
    const cx = this.x - Math.sin(this.yaw) * horiz;
    const cz = this.y + Math.cos(this.yaw) * horiz;
    const cy = gy + Math.sin(pitch) * this.dist;
    this.camera.position.set(cx + this.shakeOffset.x, cy + this.shakeOffset.y, cz + this.shakeOffset.z);
    this.camera.lookAt(this.x + this.shakeOffset.x * 0.5, gy, this.y + this.shakeOffset.z * 0.5);
    this.camera.updateMatrixWorld();
  }

  /** Approximate half-width of the view in cells (for audio attenuation). */
  get viewRadius(): number {
    return this.dist * 0.75;
  }
}
