/**
 * Fixed pool of PointLights for explosion flashes. Lights are added to the scene once and never
 * removed or hidden (that would change the light count and recompile every material); idle lights
 * simply have intensity 0.
 */
import * as THREE from 'three';

interface Slot {
  start: number;
  dur: number;
  attack: number;
  peak: number;
  active: boolean;
}

export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private slots: Slot[] = [];
  private group = new THREE.Group();
  /** Global multiplier for all flashes (tuning hook). */
  intensityScale = 1;

  constructor(scene: THREE.Scene, count: number) {
    this.group.name = 'fx-lights';
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 8, 2);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
      this.slots.push({ start: -1e9, dur: 0, attack: 0.03, peak: 0, active: false });
    }
    scene.add(this.group);
  }

  /**
   * Flash a light. Picks a free slot or the one contributing the least right now.
   * colour is a hex/linear colour, intensity in three.js (physical) candela units.
   */
  flash(now: number, x: number, y: number, z: number, color: number, intensity: number, radius: number, duration: number, delay = 0, attack = 0.03): void {
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      let score: number;
      if (!s.active) score = -1;
      else {
        const age = now - s.start;
        const rem = 1 - Math.min(1, Math.max(0, age / s.dur));
        score = s.peak * rem * rem;
      }
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    // do not steal a much brighter light for a tiny flash
    if (bestScore > intensity * 1.5) return;
    const s = this.slots[best];
    s.start = now + delay;
    s.dur = duration;
    s.attack = attack;
    s.peak = intensity;
    s.active = true;
    const l = this.lights[best];
    l.position.set(x, y, z);
    l.color.setHex(color);
    l.distance = radius;
    l.intensity = 0;
  }

  update(now: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const l = this.lights[i];
      if (!s.active) {
        if (l.intensity !== 0) l.intensity = 0;
        continue;
      }
      const age = now - s.start;
      if (age < 0) {
        l.intensity = 0;
        continue;
      }
      if (age >= s.dur) {
        s.active = false;
        l.intensity = 0;
        continue;
      }
      let e: number;
      if (age < s.attack) e = age / s.attack;
      else {
        const k = 1 - (age - s.attack) / Math.max(1e-3, s.dur - s.attack);
        e = k * k;
      }
      // subtle flicker
      e *= 0.9 + 0.1 * Math.sin(age * 60 + i * 1.7);
      l.intensity = s.peak * e * this.intensityScale;
    }
  }

  dispose(): void {
    for (const l of this.lights) l.dispose();
    this.group.removeFromParent();
  }
}
