/**
 * Game-feel director: turns the sim's event feed into impact feedback and battle payoff.
 *
 *  - Camera shake: trauma model (juicelogic.ts) fed by the effects' distance-attenuated shake; smooth noise;
 *    none at all with settings.reduceMotion / prefers-reduced-motion.
 *  - Kill punches: layered boom + debris tail + metal groan for armour, a low-pass "thump" when a big blast
 *    goes off near the camera.
 *  - Big battles: a clash meter (25+ units fighting on screen) swells the score into its battle theme with
 *    stingers; the announcer calls the moments (enemy armour neutralised, base under heavy attack, sector
 *    won, enemy base destroyed), throttled.
 *  - Flourishes (render/cinematicfx.ts): a beat of slow motion under letterbox bars when a superweapon lands
 *    on screen or an enemy's last structure falls. Never in normal combat, never with reduced motion.
 *  - Progress: veterancy chevron bursts, superweapon online / first heavy unit milestones.
 *
 * Client-side only (reads the sim, never writes it). One instance per Game (game.ts: `juice`), disposed with
 * the game's attachments. `?juice=0` turns the game-feel layer off for A/B comparisons.
 */
import * as THREE from 'three';
import { Building, Unit, type Entity } from '../../sim/entities';
import type { GameEvent } from '../../sim/types';
import type { World } from '../../sim/world';
import type { Player } from '../../sim/player';
import type { AudioSystem } from '../../audio';
import type { AnnouncerKey, SfxKey, StingerKind } from '../../audio/types';
import type { Effects } from './index';
import type { EmitterHandle } from './types';
import { ClashMeter, MomentTracker, ShakeModel, shakeFalloff, type MomentKey } from './juicelogic';
import { JUICE } from './juiceflags';
import { Flourish } from '../cinematicfx';
import { loadSettings, onSettingsChanged } from '../../ui/settings';

/** What the director needs from the game (structural: Game satisfies it). */
export interface JuiceHost {
  readonly world: World;
  readonly local: Player;
  readonly effects: Effects;
  readonly audio: AudioSystem;
  readonly gfx: {
    readonly cam: { x: number; y: number; dist: number; readonly viewRadius: number; shakeOffset: THREE.Vector3; readonly camera: THREE.PerspectiveCamera; heightAt(x: number, y: number): number };
    readonly fog: { visibilityAt(x: number, y: number): number };
    cinematicDof: number;
    cinematicBlur: number;
  };
  readonly overlay: { addFloat(x: number, y: number, z: number, text: string, color?: string): void } | null;
  readonly setup: { demo?: boolean };
  speed: number;
}

/** Heavy units whose first appearance in a match is a moment (label for the float text). */
const MILESTONE_UNITS: Record<string, string> = {
  '4tnk': 'MAMMOTH TANK', ttnk: 'TESLA TANK', qtnk: 'M.A.D. TANK', ctnk: 'CHRONO TANK', ca: 'CRUISER', msub: 'MISSILE SUB',
};
/** Thump strength of big blasts right next to the camera. */
const THUMP: Partial<Record<string, number>> = { large: 0.32, huge: 0.6, building: 0.55, nuke: 1 };

const _p = new THREE.Vector3();
const _probe = new THREE.Vector3();

interface Timed { h: EmitterHandle; until: number; fade: number; base: number }

export class JuiceDirector {
  private readonly shake = new ShakeModel();
  private readonly clash = new ClashMeter();
  private readonly moments = new MomentTracker();
  private readonly flourish: Flourish;
  /** Real seconds since the match started (throttles use wall time, not sim time). */
  private clock = 0;
  private timed: Timed[] = [];
  private reduceMotion = false;
  private unsub: (() => void) | null = null;
  private mq: MediaQueryList | null = null;
  private primed = false;
  private scanT = 0;
  private seenTypes = new Set<string>();
  private superDone = new Set<number>();
  private pendingFlourish = -1;
  private clashSent = -1;
  private lastFlak = -1;
  private lastJoined = -1e9;

  constructor(private readonly g: JuiceHost) {
    this.flourish = new Flourish(g);
    try {
      this.mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this.applySettings(loadSettings().reduceMotion);
      this.unsub = onSettingsChanged((s) => this.applySettings(s.reduceMotion));
    } catch {
      /* no DOM (tests) */
    }
  }

  private applySettings(reduce: boolean | undefined): void {
    this.reduceMotion = !!reduce || !!this.mq?.matches;
    JUICE.reduceMotion = this.reduceMotion;
    if (this.reduceMotion) this.flourish.end(true);
  }

  private get demo(): boolean {
    return !!this.g.setup.demo;
  }

  /** Is a map point on screen (projected through the real camera)? */
  private inView(x: number, y: number): boolean {
    const cam = this.g.gfx.cam;
    const v = _probe.set(x, Math.max(0, cam.heightAt(x, y)), y).project(cam.camera);
    return v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05;
  }

  private visible(x: number, y: number, k = 0.2): boolean {
    return this.g.gfx.fog.visibilityAt(x, y) > k;
  }

  /** 1 at the view centre … 0 off-screen (thumps, kill punches). */
  private closeness(x: number, y: number): number {
    const cam = this.g.gfx.cam;
    return shakeFalloff(x - cam.x, y - cam.y, cam.viewRadius);
  }

  private announce(key: MomentKey | AnnouncerKey): void {
    if (!this.demo) this.g.audio.announce(key as AnnouncerKey);
  }

  private stinger(kind: StingerKind): void {
    if (!this.demo) this.g.audio.stinger(kind);
  }

  // -------------------------------------------------------------------------------------------
  // Events

  /** Every sim event (game.ts processEvents). `dead` = the entity of a death event (already removed). */
  onEvent(ev: GameEvent, dead?: Entity): void {
    if (!JUICE.on) return;
    try {
      this.handle(ev, dead);
    } catch (e) {
      console.warn('juice', e);
    }
  }

  private handle(ev: GameEvent, dead?: Entity): void {
    const g = this.g;
    const local = g.local;
    switch (ev.e) {
      case 'fire': {
        const vis = this.visible(ev.fx, ev.fy, 0.25) || this.visible(ev.tx, ev.ty, 0.25);
        if (!vis) return;
        const inView = this.inView(ev.fx, ev.fy) || this.inView(ev.tx, ev.ty);
        this.clash.onFire(ev.shooter, this.clock, inView);
        if (ev.weapon.projectile === 'flak' && inView && this.clock - this.lastFlak > 0.09) {
          this.lastFlak = this.clock;
          g.audio.play('flak_burst', { x: ev.tx, y: ev.ty }, { volume: 0.55, delay: 0.1 });
        }
        if (ev.target !== undefined && !this.demo) {
          const t = g.world.getEntity(ev.target);
          if (t instanceof Building && t.owner === local && !t.bt.wall) {
            const m = this.moments.baseHit(ev.shooter, this.clock);
            if (m) this.announce(m);
          }
        }
        return;
      }
      case 'impact': {
        const base = THUMP[ev.kind];
        if (!base || (ev.kind !== 'nuke' && !this.visible(ev.x, ev.y))) return;
        const k = ev.kind === 'nuke' ? Math.max(0.6, this.closeness(ev.x, ev.y)) : this.closeness(ev.x, ev.y);
        if (k > 0.2) g.audio.thump(base * k);
        if (ev.kind === 'nuke' && this.inView(ev.x, ev.y)) this.tryFlourish(1.9, 0.35);
        return;
      }
      case 'death':
        if (dead) this.onDeath(ev, dead);
        return;
      case 'promoted': {
        const u = g.world.getEntity(ev.id);
        if (!(u instanceof Unit) || !this.visible(u.x, u.y)) return;
        const gy = g.world.map.surfaceAt(u.x, u.y) + (u.kind === 'aircraft' ? u.altitude : 0);
        g.effects.promotionBurst(_p.set(u.x, gy, u.y), u.kind === 'infantry' ? 0.45 : u.kind === 'vehicle' ? 0.7 : 0.9, ev.rank);
        return;
      }
      case 'gameover':
        // the ending cinematic owns the screen and the game speed from here
        this.flourish.end(false);
        this.pendingFlourish = -1;
        this.clash.reset();
        g.audio.setClash(0);
        return;
      default:
        return;
    }
  }

  private onDeath(ev: Extract<GameEvent, { e: 'death' }>, e: Entity): void {
    if (ev.how === 'sold') return;
    const g = this.g;
    const vis = this.visible(ev.x, ev.y);
    const own = e.owner.team === g.local.team;
    if (e instanceof Unit) {
      if (!vis) return;
      if (this.inView(ev.x, ev.y)) this.clash.onLoss(own);
      if (e.kind !== 'vehicle' && e.kind !== 'naval') return;
      const hp = e.ut.strength ?? 0;
      if (!own && e.kind === 'vehicle' && hp >= 250 && !this.demo) {
        const m = this.moments.enemyArmourLost(this.clock);
        if (m) this.announce(m);
      }
      // kill punch: layered boom, debris tail, metal groan
      const key: SfxKey | null = hp >= 550 ? 'kill_heavy' : hp >= 250 ? 'kill_armor' : null;
      if (key) g.audio.play(key, { x: ev.x, y: ev.y }, { volume: 0.85 });
      else g.audio.play('debris_rain', { x: ev.x, y: ev.y }, { volume: 0.5, delay: 0.25 });
      const k = this.closeness(ev.x, ev.y);
      if (k > 0.3 && hp >= 250) g.audio.thump((hp >= 550 ? 0.45 : 0.3) * k);
      return;
    }
    if (!(e instanceof Building) || e.bt.wall) return;
    if (vis) {
      // the ruin keeps smoking: a tall column that thins out over ~40 s
      const size = Math.max(e.w, e.h);
      if (g.effects.juice > 0) {
        const h = g.effects.createEmitter('column', _p.set(e.x, g.world.map.heightAt(e.x, e.y) + 0.3, e.y));
        const base = 0.7 + size * 0.55;
        h.setIntensity(base);
        h.setHeat?.(1);
        this.timed.push({ h, until: this.clock + 42, fade: 14, base });
      }
      const k = this.closeness(ev.x, ev.y);
      if (k > 0.3) g.audio.thump(0.35 * k);
    }
    if (this.demo) return;
    if (own && e.owner === g.local) {
      const m = this.moments.baseLost(this.clock);
      if (m) this.announce(m);
      return;
    }
    if (!own && e.owner.isEnemy(g.local)) {
      // the enemy's last structure just fell (the building is already gone from world.buildings)
      let left = 0;
      for (const b of g.world.buildings) if (b.alive && b.owner === e.owner && !b.bt.wall) { left++; break; }
      if (left === 0 && this.moments.allow('enemy_base_destroyed', this.clock)) {
        this.announce('enemy_base_destroyed');
        if (vis && this.inView(ev.x, ev.y)) this.pendingFlourish = this.clock + 0.15;
      }
    }
  }

  private tryFlourish(seconds: number, slow: number): void {
    if (this.reduceMotion || this.demo || this.g.world.gameOver) return;
    this.flourish.play(seconds, slow);
  }

  // -------------------------------------------------------------------------------------------
  // Frame

  /** Per frame (game.ts, after effects.update): camera shake, battle music, timed emitters, moments. */
  update(dt: number): void {
    const g = this.g;
    const cam = g.gfx.cam;
    const fx = g.effects;
    if (!JUICE.on) {
      // game-feel layer off (A/B): plain white-noise shake decayed here
      const shake = Math.min(1.2, fx.shake);
      fx.shake = Math.max(0, fx.shake - dt * 2.5) * Math.pow(0.02, dt);
      cam.shakeOffset.set((Math.random() - 0.5) * shake * 0.5, (Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.5);
      return;
    }
    this.clock += dt;
    fx.setFocus(cam.x, cam.y, cam.viewRadius);
    // shake: everything accumulated in effects.shake this frame (recipes, destruction, game.ts) becomes trauma
    const pending = fx.shake;
    fx.shake = 0;
    if (pending > 0) this.shake.kick(Math.min(pending, 6));
    this.shake.update(dt, cam.shakeOffset, cam.dist, this.reduceMotion ? 0 : 1);

    // timed ruin columns
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      const left = t.until - this.clock;
      if (left <= 0) {
        t.h.dispose();
        this.timed[i] = this.timed[this.timed.length - 1];
        this.timed.pop();
        continue;
      }
      if (left < t.fade) t.h.setIntensity(t.base * (left / t.fade));
      t.h.setHeat?.(Math.max(0, Math.min(1, (left - t.fade - 10) / 12)));
    }

    if (this.demo) return;
    // big battles: music swell + stingers + "sector won"
    const tr = this.clash.update(dt, this.clock);
    if (tr === 'start' && this.clock - this.lastJoined > 45) {
      this.lastJoined = this.clock;
      this.stinger('battle_joined');
    }
    else if (tr === 'end' && this.clash.lastResult) {
      const m = this.moments.clashEnded(this.clash.lastResult, this.clock);
      if (m) {
        this.announce(m);
        this.stinger('battle_won');
      }
    }
    const level = this.clash.level;
    if (Math.abs(level - this.clashSent) > 0.02 || (level === 0 && this.clashSent !== 0)) {
      this.clashSent = level < 0.02 ? 0 : level;
      g.audio.setClash(this.clashSent);
    }

    if (this.pendingFlourish > 0 && this.clock >= this.pendingFlourish) {
      this.pendingFlourish = -1;
      this.tryFlourish(1.6, 0.4);
    }

    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.5;
      this.scanMilestones();
    }
  }

  /** First heavy unit of a kind / a superweapon coming online for the local player. */
  private scanMilestones(): void {
    const g = this.g;
    const local = g.local;
    const prime = !this.primed;
    this.primed = true;
    for (const u of g.world.units) {
      if (!u.alive || u.owner !== local) continue;
      const label = MILESTONE_UNITS[u.type.id];
      if (!label || this.seenTypes.has(u.type.id)) continue;
      this.seenTypes.add(u.type.id);
      if (prime) continue;
      this.moment(u.x, u.y, 1.1, `${label} READY`, u.kind === 'vehicle' ? 'heavy_armour_ready' : null);
    }
    for (const b of g.world.buildings) {
      if (!b.alive || b.owner !== local || !b.bt.superweapon || b.buildAnim < 1 || this.superDone.has(b.id)) continue;
      this.superDone.add(b.id);
      if (prime) continue;
      this.moment(b.x, b.y, Math.max(b.w, b.h) * 0.8, 'SUPERWEAPON ONLINE', 'superweapon_online');
    }
  }

  private moment(x: number, y: number, size: number, text: string, line: AnnouncerKey | null): void {
    const g = this.g;
    const gy = g.world.map.surfaceAt(x, y);
    g.effects.milestoneBurst(_p.set(x, gy, y), size);
    g.audio.play('milestone');
    this.stinger('milestone');
    if (line) this.announce(line);
    g.overlay?.addFloat(x, gy + 2.2, y, text, '#ffd76a');
  }

  /** Turn every game-feel layer on / off at runtime (A/B benches: tools/qa/juice_bench.mjs INTERLEAVE=1). */
  setEnabled(on: boolean): void {
    JUICE.on = on;
    this.g.effects.setJuice(on);
    if (!on) this.g.audio.setClash(0);
    this.clashSent = -1;
  }

  /** Diagnostics for tests / the bench: clash state and shake. */
  get stats(): { fighters: number; clash: number; clashing: boolean; trauma: number; reduceMotion: boolean } {
    return { fighters: this.clash.fighters, clash: this.clash.level, clashing: this.clash.active, trauma: this.shake.trauma, reduceMotion: this.reduceMotion };
  }

  dispose(): void {
    this.flourish.dispose();
    for (const t of this.timed) t.h.dispose();
    this.timed.length = 0;
    this.unsub?.();
    this.unsub = null;
    try { this.g.audio.setClash(0); } catch { /* ignore */ }
  }
}
