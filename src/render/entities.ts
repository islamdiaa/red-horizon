import * as THREE from 'three';
import { BAIL_COUNT, raTicksToSeconds, type ExplosionKind } from '../data/rules';
import { lerp, lerpAngle } from '../core/util';
import { Building, Entity, Unit } from '../sim/entities';
import type { Player } from '../sim/player';
import { DT, type GameEvent } from '../sim/types';
import type { World } from '../sim/world';
import type { Projectile } from '../sim/combat';
import { createModel } from './models';
import type { ModelAnimState, ModelInstance } from './models/types';
import type { Effects } from './effects';
import type { EmitterHandle, ProjectileHandle } from './effects/types';
import type { FogOfWar } from './fog';
import { createHoloMaterial } from './holo';

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
}

interface ProjView {
  handle: ProjectileHandle;
  offset: THREE.Vector3;
  startDist: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();

const charred = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1, metalness: 0.1 });

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
  /** Vehicles whose wrecks linger. */
  private wreckTime = 22;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private effects: Effects,
    private local: Player,
    private fog: FogOfWar,
  ) {
    const mk = (c: number, o = 0.85) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.ringMats = { own: mk(0x58ff8a), ally: mk(0x5ac8ff), enemy: mk(0xff4a3a), iron: mk(0xff2020, 0.7) };
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
  }

  teamColor(p: Player): THREE.Color {
    let c = this.teamColors.get(p.id);
    if (!c) { c = new THREE.Color(p.color); this.teamColors.set(p.id, c); }
    return c;
  }

  private createView(e: Entity): View {
    const model = createModel(e.type.id, this.teamColor(e.owner));
    this.scene.add(model.root);
    const anim: ModelAnimState = {
      time: 0, dt: 0, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: 1,
      door: 0, load: 0, harvesting: false, charge: 0, dying: 0, altitude: 0,
    };
    const v: View = {
      ent: e, model, anim, dead: false, deathT: 0, deathHow: 'normal', smoke: null, fire: null, chimneys: [],
      dustT: 0, fade: 0, lastBuildAnim: 0, baseScale: 1, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), holo: null, holoRing: null,
    };
    if (e instanceof Building) {
      model.root.position.set(e.x, this.world.map.heightAt(e.x, e.y), e.y);
      if (e.buildAnim < 1) this.effects.constructionBurst(new THREE.Vector3(e.x, this.world.map.heightAt(e.x, e.y), e.y), Math.max(e.w, e.h));
    }
    this.views.set(e.id, v);
    return v;
  }

  /** Change an entity's team colour (capture) by recreating its model. */
  private recolor(v: View) {
    const pos = v.model.root.position.clone();
    v.model.dispose();
    v.model = createModel(v.ent.type.id, this.teamColor(v.ent.owner));
    v.model.root.position.copy(pos);
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

  isShown(id: number): boolean {
    const v = this.views.get(id);
    return !!v && v.model.root.visible;
  }

  handleEvent(ev: GameEvent) {
    switch (ev.e) {
      case 'death': {
        const v = this.views.get(ev.id);
        if (!v) return;
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
        if (e instanceof Building) {
          this.effects.explosion(p.clone().setY(p.y + 0.3), 'building', Math.max(e.w, e.h));
          this.effects.scorch(p, Math.max(e.w, e.h) * 1.1);
        } else if (e.kind === 'vehicle' || e.kind === 'aircraft') {
          this.effects.explosion(p.clone().setY(p.y + 0.25), 'large', e.type.id === '4tnk' || e.type.id === 'harv' || e.type.id === 'mcv' ? 1.3 : 1);
          this.effects.scorch(p, 1.1);
          v.model.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = charred; });
          v.fire = this.effects.createEmitter('fire', p.clone().setY(p.y + 0.3));
          v.fire.setIntensity(0.7);
        } else {
          if (ev.how === 'crushed') {
            this.effects.bloodSplat(p);
            v.model.root.scale.set(1.2, 0.08, 1.2);
          } else if (ev.how === 'burn' || ev.how === 'electro') {
            this.effects.scorch(p, 0.35);
          } else if (ev.how === 'blown') {
            this.effects.bloodSplat(p);
          }
          v.anim.deathKind = ev.how;
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
        this.effects.chronoFlash(new THREE.Vector3(ev.fromX, this.world.map.heightAt(ev.fromX, ev.fromY), ev.fromY));
        this.effects.chronoFlash(new THREE.Vector3(ev.x, this.world.map.heightAt(ev.x, ev.y), ev.y));
        break;
      }
      case 'ironcurtain':
        this.effects.ironCurtainPulse(new THREE.Vector3(ev.x, this.world.map.heightAt(ev.x, ev.y) + 0.3, ev.y), 2);
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
    const from = new THREE.Vector3(ev.fx, ev.fz, ev.fy);
    this.muzzleWorld(ev.shooter, this.muzzleIndex(ev.shooter, ev.weapon.id, ev.muzzle), from);
    const to = new THREE.Vector3(ev.tx, ev.tz, ev.ty);
    const dir = _v2.copy(to).sub(from).normalize();
    const w = ev.weapon;
    switch (w.projectile) {
      case 'bullet':
        this.effects.muzzleFlash(from, dir, w.damage >= 40 ? 0.8 : 0.5);
        this.effects.tracer(from, to);
        if (targetVisible) this.effects.explosion(to, 'piff', 0.6);
        break;
      case 'flak':
        this.effects.muzzleFlash(from, dir, 0.7);
        this.effects.tracer(from, to, 0xffd080);
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
        this.effects.healPulse(to);
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

  private clearHolo(v: View) {
    if (v.holo) { v.holo.dispose(); v.holo = null; }
    if (v.holoRing) { this.scene.remove(v.holoRing); v.holoRing = null; }
  }

  private removeView(id: number) {
    const v = this.views.get(id);
    if (!v) return;
    this.clearHolo(v);
    v.model.dispose();
    v.smoke?.dispose();
    v.fire?.dispose();
    for (const c of v.chimneys) c.dispose();
    const r = this.rings.get(id);
    if (r) { this.scene.remove(r); this.rings.delete(id); }
    this.views.delete(id);
  }

  /** Per-frame sync. */
  update(alpha: number, dt: number, time: number, selected: Set<number>, hovered: number) {
    this.time = time;
    const world = this.world;
    const map = world.map;
    // create views for new entities
    for (const u of world.units) if (!this.views.has(u.id)) this.createView(u);
    for (const b of world.buildings) if (!this.views.has(b.id)) this.createView(b);

    for (const [id, v] of this.views) {
      const e = v.ent;
      const anim = v.anim;
      anim.time = time;
      anim.dt = dt;
      anim.firing = Math.max(0, anim.firing - dt * 4);

      if (v.dead) {
        if (!this.updateDeath(v, dt)) this.removeView(id);
        continue;
      }
      if (!e.alive) {
        // removed without a death event (shouldn't happen) – clean up
        this.removeView(id);
        continue;
      }

      // ----- visibility
      let show: boolean;
      if (e.owner.team === this.local.team) show = true;
      else if (e instanceof Building) show = this.buildingExplored(e);
      else show = this.fog.visibilityAt(e.x, e.y) > 0.5;
      v.model.root.visible = show;
      anim.health = e.healthFrac;

      if (e instanceof Building) this.updateBuilding(v, e, dt);
      else this.updateUnit(v, e as Unit, alpha, dt);

      if (show) v.model.update(anim);
      this.updateRing(v, selected.has(id) || hovered === id, selected.has(id));
    }

    this.updateProjectiles(alpha);
    this.bracketMat.uniforms.uTime.value = time;
  }

  private buildingExplored(b: Building): boolean {
    return this.fog.exploredAt(b.x, b.y) > 0.5 || this.fog.exploredAt(b.cx + 0.5, b.cy + 0.5) > 0.5;
  }

  private updateBuilding(v: View, b: Building, dt: number) {
    const anim = v.anim;
    const root = v.model.root;
    const g = this.world.map.heightAt(b.x, b.y);
    root.position.set(b.x, g, b.y);
    // construction: hologram shell + solid structure rising inside it with a scanning ring
    let sy = 1;
    if (b.buildAnim < 1) {
      const t = b.buildAnim;
      sy = Math.max(0.02, 1 - Math.pow(1 - t, 2.2));
      if (!v.holo && root.visible) {
        v.holo = createModel(b.bt.id, this.teamColor(b.owner));
        v.holo.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = this.holoMat; m.castShadow = false; m.receiveShadow = false; } });
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

    // chimney smoke
    if (v.model.smokePoints && v.model.smokePoints.length && b.buildAnim >= 1) {
      if (!v.chimneys.length) {
        root.updateMatrixWorld(true);
        for (const sp of v.model.smokePoints) v.chimneys.push(this.effects.createEmitter('chimney', sp.getWorldPosition(new THREE.Vector3())));
      }
      const on = root.visible && anim.powered && b.selling < 0 ? 1 : 0;
      for (const c of v.chimneys) c.setIntensity(on);
    }
    this.damageEmitters(v, b.healthFrac, root.visible && b.buildAnim >= 1, new THREE.Vector3(b.x, g + v.model.height * 0.8, b.y), 1 + Math.max(b.w, b.h) * 0.3);
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

  private updateUnit(v: View, u: Unit, alpha: number, dt: number) {
    const map = this.world.map;
    const anim = v.anim;
    const root = v.model.root;
    const x = lerp(u.prevX, u.x, alpha), y = lerp(u.prevY, u.y, alpha);
    const heading = lerpAngle(u.prevHeading, u.heading, alpha);
    const turret = lerpAngle(u.prevTurret, u.turret, alpha);
    const g = map.surfaceAt(x, y);
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
    } else {
      root.quaternion.copy(_qy);
    }
    const alt = u.kind === 'aircraft' ? u.altitude : 0;
    root.position.set(x, g + alt, y);
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
        this.effects.dust(back.clone(), amt);
      }
    }
    if (u.kind === 'vehicle') this.damageEmitters(v, u.healthFrac + 0.2, root.visible, new THREE.Vector3(x, g + 0.4, y), 0.5);
  }

  /** Returns false when the view should be removed. */
  private updateDeath(v: View, dt: number): boolean {
    v.deathT += dt;
    const e = v.ent;
    const root = v.model.root;
    if (e instanceof Building) {
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
      if (v.deathHow !== 'crushed') v.model.update(v.anim);
      if (v.deathT > 4) root.position.y -= dt * 0.15;
      return v.deathT < 6;
    }
    // vehicles: the wreck burns, then smoulders, then sinks away
    if (v.fire) {
      const k = v.deathT < 6 ? 0.7 : Math.max(0, 0.7 - (v.deathT - 6) * 0.25);
      v.fire.setIntensity(k);
      if (k <= 0) { v.fire.dispose(); v.fire = null; }
    }
    if (v.deathT > 4 && !v.smoke && v.deathT < this.wreckTime - 4 && root.visible) {
      v.smoke = this.effects.createEmitter('smoke', root.position.clone().setY(root.position.y + 0.3));
      v.smoke.setIntensity(0.45);
    }
    if (v.smoke && v.deathT > this.wreckTime - 4) v.smoke.setIntensity(Math.max(0, (this.wreckTime - 1.5 - v.deathT) / 2.5) * 0.45);
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
      mat.uniforms.uColor.value.set(iron ? 0xff2020 : rel === 'own' ? 0x58ff8a : rel === 'ally' ? 0x5ac8ff : 0xff4a3a);
      mat.uniforms.uTime.value = this.time;
      r.position.set(e.x, this.world.map.heightAt(e.x, e.y) + 0.06, e.y);
    } else {
      r.material = iron ? this.ringMats.iron : this.ringMats[rel];
      const p = v.model.root.position;
      const pulse = selected ? 1 : 0.85 + Math.sin(this.time * 6) * 0.05;
      const s = Math.max(0.22, v.model.radius * 1.05) * pulse * (iron ? 1.3 : 1);
      r.scale.set(s, 1, s);
      r.position.set(p.x, this.world.map.surfaceAt(p.x, p.z) + 0.04, p.z);
    }
  }

  private updateProjectiles(alpha: number) {
    const seen = new Set<number>();
    for (const p of this.world.projectiles) {
      if (!p.alive) continue;
      seen.add(p.id);
      let pv = this.projViews.get(p.id);
      const x = lerp(p.prevX, p.x, alpha), y = lerp(p.prevY, p.y, alpha), z = lerp(p.prevZ, p.z, alpha);
      if (!pv) {
        const visible = this.fog.visibilityAt(p.sx, p.sy) > 0.25 || this.fog.visibilityAt(p.tx, p.ty) > 0.25 || p.special === 'nuke';
        if (!visible) continue;
        const handle = this.effects.spawnProjectile(p.special === 'nuke' ? 'scud' : p.kind);
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
    for (const id of [...this.views.keys()]) this.removeView(id);
    for (const pv of this.projViews.values()) pv.handle.end();
    this.projViews.clear();
  }
}

export type { ExplosionKind, Projectile };
void DT;
