/**
 * Camera director: plays a program of cinematic shots on a running Game (the menu backdrop's attract mode,
 * the `?trailer=1` cut, highlight clips from replays). Render-side only: it reads the world and moves the
 * camera and the cinematic lens; staging (spawning units, firing a nuke) belongs to the caller's shots.
 *
 * A shot is a camera pose over time (focus point, distance, yaw, lens) around a subject found when the shot
 * begins: a base, a Tesla coil, ships, the busiest fight, a nuke in flight. Shots are joined by a short dip
 * to black (the temporal AA history is reset at the cut), so a cut never smears.
 *
 * Game hooks it into its frame through `game.cameraDirector` (game.ts calls update(dt) every frame).
 */
import type { Game } from '../game';
import type { World } from '../sim/world';
import { Building, Unit } from '../sim/entities';

export interface CamPose {
  x: number;
  y: number;
  dist: number;
  yaw: number;
  /** Depth of field 0..1 (high quality only). */
  dof?: number;
  /** Motion blur shutter 0..1 (medium / high). */
  blur?: number;
}

/** A title card (trailer): drawn in the DOM and into recordings. */
export interface TitleCard {
  kicker?: string;
  title: string;
  sub?: string;
  /** Where: 'center' (big) or 'lower' (lower third). */
  at?: 'center' | 'lower';
}

export interface Shot {
  name: string;
  /** Seconds. */
  dur: number;
  /** Called when the previous shot begins: stage the action this shot will film. */
  prep?(d: Director): void;
  /** Called when the shot begins (find the subject; return false to skip the shot). */
  begin?(d: Director): boolean;
  /** Called every frame while the shot runs (staging on cue). `time` = seconds into the shot. */
  tick?(d: Director, time: number): void;
  /** The camera at `t` (0..1 of the shot), `time` seconds in. */
  pose(d: Director, t: number, time: number): CamPose;
  /** Game speed multiplier during the shot (slow motion). */
  speed?(d: Director, t: number, time: number): number;
  card?: TitleCard;
  /** The camera carries on from the previous shot: no dip to black, no cut (temporal history and lens kept). */
  continuous?: boolean;
}

export interface DirectorOptions {
  /** Loop the program (attract mode) or stop at its end. */
  loop?: boolean;
  /** Dip-to-black length at each cut, seconds (each side). */
  dip?: number;
  /** Lens effects allowed (depth of field on high, motion blur on medium+). */
  lens?: boolean;
  /** Letterbox bars 0..1 (drawn in the DOM and into recordings). */
  letterbox?: number;
  /** Cap the camera distance (wide shots draw more: the menu backdrop keeps Low / Medium close). */
  maxDist?: number;
  /** Called when the program wraps (loop) or ends. */
  onProgramEnd?(loops: number): void;
  /** Called at the start of each shot. */
  onShot?(shot: Shot, index: number): void;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
export const ease = (t: number) => smooth(clamp01(t));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A point that follows a moving target smoothly (no 20 Hz stepping on screen). */
export class Follow {
  x = 0;
  y = 0;
  private set = false;
  constructor(private rate = 2.5) {}
  to(x: number, y: number, dt: number): this {
    if (!this.set || !Number.isFinite(this.x)) { this.x = x; this.y = y; this.set = true; return this; }
    const k = 1 - Math.exp(-dt * this.rate);
    this.x += (x - this.x) * k;
    this.y += (y - this.y) * k;
    return this;
  }
  jump(x: number, y: number): this {
    this.x = x;
    this.y = y;
    this.set = true;
    return this;
  }
}

export class Director {
  /** 0..1 black over the picture (cuts, start, end). */
  fade = 1;
  /** 0..1 letterbox bars. */
  letter = 0;
  /** Current title card and its opacity. */
  card: TitleCard | null = null;
  cardAlpha = 0;
  /** Shared state for shots (subjects, staged unit ids...). */
  readonly state: Record<string, unknown> = {};
  readonly follow = new Follow();
  index = -1;
  shotTime = 0;
  /** Last frame's delta (seconds), for subject smoothing inside poses. */
  dt = 1 / 60;
  loops = 0;
  ended = false;
  private shots: Shot[];
  private saved: { maxDist: number; minDist: number; zoomDamp: number; yawDamp: number; speed: number; dof: number; blur: number };
  private fadeEl: HTMLElement | null = null;
  private barEls: HTMLElement[] = [];
  private cardEl: HTMLElement | null = null;
  private disposed = false;
  private lensDof = 0;
  private lensBlur = 0;
  private cutFrames = 0;
  private dip: number;
  private baseSpeed: number;

  constructor(readonly game: Game, program: Shot[], readonly opts: DirectorOptions = {}) {
    this.shots = program;
    this.dip = opts.dip ?? 0.35;
    const cam = game.gfx.cam;
    this.saved = { maxDist: cam.maxDist, minDist: cam.minDist, zoomDamp: cam.zoomDamp, yawDamp: cam.yawDamp, speed: game.speed, dof: game.gfx.cinematicDof, blur: game.gfx.cinematicBlur };
    this.baseSpeed = game.speed || 1;
    cam.maxDist = 80;
    cam.minDist = 7;
    this.letter = opts.letterbox ?? 0;
    if (typeof document !== 'undefined') this.mountDom();
    this.next();
  }

  get world(): World {
    return this.game.world;
  }

  private clock = 0;
  private memoed = new Map<string, { at: number; v: unknown }>();
  /** `fn()` cached for `seconds` of director time (subject searches are O(units²): not every frame). */
  memo<T>(key: string, seconds: number, fn: () => T): T {
    const m = this.memoed.get(key);
    if (m && this.clock - m.at < seconds) return m.v as T;
    const v = fn();
    this.memoed.set(key, { at: this.clock, v });
    return v;
  }

  get quality(): string {
    return this.game.setup.quality;
  }

  /** Replace the program (takes effect at the next shot). */
  setProgram(shots: Shot[]): void {
    this.shots = shots;
  }

  get current(): Shot | null {
    return this.shots[this.index] ?? null;
  }

  /** Total program length (seconds). */
  get length(): number {
    return this.shots.reduce((s, x) => s + x.dur, 0);
  }

  /** Seconds of the program played so far (this loop). */
  get elapsed(): number {
    if (this.ended) return this.length;
    let t = this.shotTime;
    for (let i = 0; i < this.index && i < this.shots.length; i++) t += this.shots[i].dur;
    return t;
  }

  private next(): void {
    for (let guard = 0; guard < this.shots.length + 1; guard++) {
      this.index++;
      if (this.index >= this.shots.length) {
        this.loops++;
        this.opts.onProgramEnd?.(this.loops);
        if (!this.opts.loop || this.disposed) { this.ended = true; this.index = this.shots.length; return; }
        this.index = 0;
      }
      const s = this.shots[this.index];
      // stage the following shot ahead of time
      const after = this.shots[(this.index + 1) % this.shots.length];
      let ok = true;
      try { ok = s.begin ? s.begin(this) !== false : true; } catch (e) { console.warn('[director] shot', s.name, e); ok = false; }
      if (!ok) continue;
      try { after?.prep?.(this); } catch (e) { console.warn('[director] prep', after?.name, e); }
      this.shotTime = 0;
      this.card = s.card ?? null;
      if (!s.continuous) {
        this.cutFrames = 2;
        if (this.game.gfx.taa) this.game.gfx.taa.reset = true;
      }
      this.opts.onShot?.(s, this.index);
      return;
    }
    this.ended = true;
  }

  /** Per frame (game.ts frame → cameraDirector.update). */
  update(dt: number): void {
    if (this.disposed || this.ended) return;
    this.dt = Math.min(0.1, Math.max(0, dt));
    this.clock += this.dt;
    let s = this.current;
    if (!s) return;
    this.shotTime += this.dt;
    if (this.shotTime >= s.dur) {
      this.next();
      s = this.current;
      if (!s || this.ended) { this.applyDom(); return; }
    }
    const time = this.shotTime;
    const t = clamp01(time / s.dur);
    try { s.tick?.(this, time); } catch (e) { console.warn('[director] tick', s.name, e); }
    let pose: CamPose;
    try { pose = s.pose(this, t, time); } catch (e) { console.warn('[director] pose', s.name, e); this.next(); return; }
    this.apply(pose, dt);
    // dip to black around cuts
    const d = this.dip;
    const nextShot = this.shots[this.index + 1] ?? (this.opts.loop ? this.shots[0] : null);
    const fin = d > 0 && !(nextShot?.continuous) ? clamp01((time - (s.dur - d)) / d) : 0;
    const fout = d > 0 && !s.continuous ? 1 - clamp01(time / d) : 0;
    this.fade = Math.max(fin, fout, this.ended ? 1 : 0);
    // title card: fades in and out within the shot
    if (this.card) this.cardAlpha = Math.min(clamp01((time - 0.25) / 0.6), clamp01((s.dur - 0.35 - time) / 0.6));
    else this.cardAlpha = 0;
    const sp = s.speed ? s.speed(this, t, time) : 1;
    this.game.speed = Math.max(0.05, this.baseSpeed * sp);
    this.applyDom();
  }

  /** Put the camera and lens on a pose. */
  private apply(p: CamPose, dt: number): void {
    const g = this.game, cam = g.gfx.cam, m = this.world.map;
    cam.x = Math.max(2, Math.min(m.w - 2, p.x));
    cam.y = Math.max(2, Math.min(m.h - 2, p.y));
    cam.dist = cam.targetDist = Math.max(cam.minDist, Math.min(this.opts.maxDist ?? cam.maxDist, cam.maxDist, p.dist));
    cam.yaw = cam.targetYaw = p.yaw;
    // lens: depth of field on high only, motion blur from medium; eased so it never pops
    const lens = this.opts.lens !== false;
    const q = this.quality;
    const wantDof = lens && q === 'high' ? (p.dof ?? 0) : 0;
    const wantBlur = lens && q !== 'low' && this.cutFrames <= 0 ? (p.blur ?? 0) : 0;
    const k = 1 - Math.exp(-dt * 4);
    this.lensDof += (wantDof - this.lensDof) * k;
    this.lensBlur = this.cutFrames > 0 ? 0 : this.lensBlur + (wantBlur - this.lensBlur) * k;
    if (this.cutFrames > 0) this.cutFrames--;
    g.gfx.cinematicDof = this.lensDof < 0.01 ? 0 : this.lensDof;
    g.gfx.cinematicBlur = this.lensBlur < 0.01 ? 0 : this.lensBlur;
  }

  // ---------------------------------------------------------------- DOM (fade, letterbox, title cards)
  private mountDom(): void {
    ensureCss();
    const canvas = document.getElementById('game-canvas');
    const fade = document.createElement('div');
    fade.className = 'dir-fade';
    fade.style.opacity = '1';
    if (canvas) canvas.after(fade); else document.body.prepend(fade);
    this.fadeEl = fade;
    const top = document.createElement('div');
    top.className = 'dir-bar top';
    const bottom = document.createElement('div');
    bottom.className = 'dir-bar bottom';
    fade.after(top, bottom);
    this.barEls = [top, bottom];
    const card = document.createElement('div');
    card.className = 'dir-card';
    bottom.after(card);
    this.cardEl = card;
  }

  private shownCard: TitleCard | null = null;
  private shown = { fade: '', bars: '', card: '' };
  /** Write the DOM only when a value changes (the menu backdrop runs this every frame). */
  private applyDom(): void {
    const sh = this.shown;
    const fade = this.fade.toFixed(3);
    if (this.fadeEl && fade !== sh.fade) { sh.fade = fade; this.fadeEl.style.opacity = fade; }
    const bars = `${(this.letter * 11).toFixed(2)}vh`;
    if (bars !== sh.bars) { sh.bars = bars; for (const b of this.barEls) b.style.setProperty('--h', bars); }
    const c = this.cardEl;
    if (!c) return;
    if (this.card !== this.shownCard) {
      this.shownCard = this.card;
      c.className = `dir-card ${this.card?.at === 'lower' ? 'lower' : 'center'}`;
      c.innerHTML = this.card ? `${this.card.kicker ? `<small>${escText(this.card.kicker)}</small>` : ''}<b>${escText(this.card.title)}</b>${this.card.sub ? `<span>${escText(this.card.sub)}</span>` : ''}` : '';
    }
    const ca = this.cardAlpha.toFixed(3);
    if (ca !== sh.card) { sh.card = ca; c.style.opacity = ca; }
  }

  /** Stop directing: camera limits, speed and lens back as they were. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const g = this.game, cam = g.gfx.cam, s = this.saved;
    cam.maxDist = s.maxDist;
    cam.minDist = s.minDist;
    cam.zoomDamp = s.zoomDamp;
    cam.yawDamp = s.yawDamp;
    cam.targetYaw = 0;
    cam.targetDist = Math.min(cam.maxDist, Math.max(cam.minDist, cam.targetDist));
    g.speed = s.speed;
    g.gfx.cinematicDof = s.dof;
    g.gfx.cinematicBlur = s.blur;
    this.fadeEl?.remove();
    for (const b of this.barEls) b.remove();
    this.cardEl?.remove();
  }
}

const escText = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CSS = `
.dir-fade { position: fixed; inset: 0; background: #000; pointer-events: none; opacity: 0; }
.dir-bar { position: fixed; left: 0; right: 0; height: var(--h, 0); background: #000; pointer-events: none; }
.dir-bar.top { top: 0; } .dir-bar.bottom { bottom: 0; }
.dir-card { position: fixed; inset: 0; pointer-events: none; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; opacity: 0;
  font-family: var(--font, 'Rajdhani', sans-serif); color: #f2f6fa; text-shadow: 0 2px 24px rgba(0,0,0,.85), 0 0 2px rgba(0,0,0,.9); }
.dir-card small { font-size: clamp(12px, 1.2vw, 18px); letter-spacing: .5em; text-transform: uppercase; color: #ffb08a; margin-bottom: .6em; }
.dir-card b { font-size: clamp(34px, 6vw, 96px); font-weight: 700; letter-spacing: .2em; text-transform: uppercase; line-height: 1; }
.dir-card span { margin-top: .8em; font-size: clamp(13px, 1.4vw, 22px); letter-spacing: .3em; text-transform: uppercase; opacity: .85; }
.dir-card.lower { justify-content: flex-end; align-items: flex-start; text-align: left; padding: 0 0 18vh 7vw; }
.dir-card.lower b { font-size: clamp(26px, 3.6vw, 56px); }
`;

function ensureCss() {
  if (document.getElementById('dir-css')) return;
  const st = document.createElement('style');
  st.id = 'dir-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

// ---------------------------------------------------------------------------------------------
// Subjects

/** The busiest fight on the map (units with targets, weighted by enemies close by), or null. */
export function actionFocus(world: World, near?: { x: number; y: number; r: number }): { x: number; y: number; score: number } | null {
  let best: Unit | null = null, bestScore = 0;
  const us = world.units;
  for (const u of us) {
    if (!u.alive || u.kind === 'aircraft') continue;
    if (near && Math.hypot(u.x - near.x, u.y - near.y) > near.r) continue;
    let s = u.target ? 4 : 0;
    for (const o of us) {
      if (!o.alive || o === u) continue;
      const dx = o.x - u.x, dy = o.y - u.y;
      if (dx * dx + dy * dy < 49) s += o.owner !== u.owner ? 3 : 0.6;
    }
    if (s > bestScore) { bestScore = s; best = u; }
  }
  if (!best) return null;
  // centre on the fight (the units around the best one), not on one tank
  let sx = 0, sy = 0, n = 0;
  for (const o of us) {
    if (!o.alive || o.kind === 'aircraft') continue;
    if (Math.hypot(o.x - best.x, o.y - best.y) < 8) { sx += o.x; sy += o.y; n++; }
  }
  return { x: sx / n, y: sy / n, score: bestScore };
}

/** A living structure of one of `types` (owner faction optional), the first match in `types` order. */
export function findStructure(world: World, types: string[], faction?: string): Building | null {
  for (const t of types) {
    const b = world.buildings.find((x) => x.alive && x.bt.id === t && (!faction || x.owner.faction === faction));
    if (b) return b;
  }
  return null;
}

/** Centre of a player's base (construction yard, else the mean of its structures). */
export function baseOf(world: World, faction: string): { x: number; y: number } | null {
  const bs = world.buildings.filter((b) => b.alive && b.owner.faction === faction && !b.bt.wall && !b.bt.mine);
  if (!bs.length) return null;
  const fact = bs.find((b) => b.bt.id === 'fact');
  if (fact) return { x: fact.x, y: fact.y };
  return { x: bs.reduce((s, b) => s + b.x, 0) / bs.length, y: bs.reduce((s, b) => s + b.y, 0) / bs.length };
}

/** Centroid of the ships afloat (fighting ones count double), or null. */
export function fleetFocus(world: World): { x: number; y: number; n: number } | null {
  let sx = 0, sy = 0, w = 0, n = 0;
  for (const u of world.units) {
    if (!u.alive || u.kind !== 'naval') continue;
    const k = u.target ? 2 : 1;
    sx += u.x * k; sy += u.y * k; w += k; n++;
  }
  return n ? { x: sx / w, y: sy / w, n } : null;
}

/** The nuke in flight, if any. */
export function nukeInFlight(world: World): { x: number; y: number; tx: number; ty: number; t: number } | null {
  const p = world.projectiles.find((q) => q.alive && q.special === 'nuke');
  return p ? { x: p.x, y: p.y, tx: p.tx, ty: p.ty, t: p.t } : null;
}

// ---------------------------------------------------------------------------------------------
// Reusable shot shapes

/** Orbit a (moving) subject: yaw sweeps from a to b. */
export function orbit(subject: (d: Director) => { x: number; y: number } | null, o: { dist: number; dist2?: number; yaw: number; yaw2: number; dof?: number; blur?: number }) {
  return (d: Director, t: number): CamPose => {
    const s = subject(d);
    if (s) d.follow.to(s.x, s.y, d.dt);
    const e = ease(t);
    return { x: d.follow.x, y: d.follow.y, dist: lerp(o.dist, o.dist2 ?? o.dist, e), yaw: lerp(o.yaw, o.yaw2, t), dof: o.dof, blur: o.blur };
  };
}
