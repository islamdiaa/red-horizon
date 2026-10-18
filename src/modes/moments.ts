/**
 * Automatic moment detection for "Make this a challenge": while a recorded match runs, keep a ring of
 * world snapshots (every 20 s, the last two minutes) and pin the ones just before interesting moments:
 *   swing     the worst minute: army value lost beyond what the enemy lost
 *   comeback  the local side's lowest point (strength share) — offered when it fell below 35 %
 *   nuke      an enemy atomic strike launched at the local side
 *   siege     a big enemy force inside the local base
 * Reads the world only (never steps or changes it). Snapshots are JSON strings (no live references).
 */
import type { World } from '../sim/world';
import type { Player } from '../sim/player';
import { serializeWorld } from '../sim/save';
import { TICK_HZ } from '../sim/types';
import type { ChallengeGoal, StartView } from './types';
import { MODES_EN, fillEn as en } from './text';

/** Moment challenge texts: English (stored in the challenge), translated where shown (trSource). */
const M = MODES_EN.moment;

export type MomentKind = 'swing' | 'comeback' | 'nuke' | 'siege';

export interface Moment {
  kind: MomentKind;
  /** Tick of the snapshot the challenge starts from. */
  tick: number;
  /** Tick the moment itself happened. */
  at: number;
  /** World snapshot (serializeWorld JSON). */
  json: string;
  view: StartView;
  /** How remarkable (ranking): value swung / enemy force size / ... */
  weight: number;
  /** Where it happened (camera focus, hold zones). */
  x: number;
  y: number;
  /** Extra numbers for the description. */
  info: Record<string, number>;
}

interface Snap { tick: number; json: string; view: StartView }
interface Sample { tick: number; army: number; foes: number; total: number; ftotal: number }

const SNAP_EVERY = 20 * TICK_HZ;
const SNAP_KEEP = 6;
const SAMPLE_EVERY = 2 * TICK_HZ;
const SWING_WINDOW = 60 * TICK_HZ;

export class MomentTracker {
  private ring: Snap[] = [];
  private samples: Sample[] = [];
  readonly moments: Partial<Record<MomentKind, Moment>> = {};
  private minShare = 1;
  private seenNukes = new Set<number>();
  private lastSiege = -1e9;
  private final = false;

  constructor(private world: World, private local: () => Player, private view: () => StartView) {}

  /** Call after every world step. */
  afterStep() {
    const w = this.world;
    if (w.gameOver) {
      // one last look at the final blow
      if (!this.final) { this.final = true; this.sample(); }
      return;
    }
    const t = w.tick;
    if (t % SAMPLE_EVERY === 0) this.sample();
    if (t % SNAP_EVERY === 0 && t > 0) this.snap();
    if (t % 10 === 5) this.checkNuke();
  }

  /** Take a snapshot now (tests; the ring keeps the last few). */
  snap() {
    const json = JSON.stringify(serializeWorld(this.world));
    this.ring.push({ tick: this.world.tick, json, view: this.view() });
    if (this.ring.length > SNAP_KEEP) this.ring.shift();
  }

  /** Latest snapshot taken at or before `tick`. */
  private snapBefore(tick: number): Snap | null {
    for (let i = this.ring.length - 1; i >= 0; i--) if (this.ring[i].tick <= tick) return this.ring[i];
    return null;
  }

  private values(): Sample {
    const w = this.world, me = this.local();
    let army = 0, foes = 0, total = 0, ftotal = 0;
    for (const u of w.units) {
      if (!u.alive || u.ut.harvester) continue;
      const v = u.weapons.length ? u.ut.cost : u.ut.cost * 0.3;
      if (u.owner.team === me.team) { if (u.weapons.length) army += v; total += v; } else if (me.isEnemy(u.owner)) { if (u.weapons.length) foes += v; ftotal += v; }
    }
    for (const b of w.buildings) {
      if (!b.alive || b.bt.wall || b.bt.mine) continue;
      const v = b.bt.cost * 0.5;
      if (b.owner.team === me.team) total += v; else if (me.isEnemy(b.owner)) ftotal += v;
    }
    return { tick: w.tick, army, foes, total, ftotal };
  }

  private pin(kind: MomentKind, snap: Snap, at: number, weight: number, x: number, y: number, info: Record<string, number>) {
    const cur = this.moments[kind];
    if (cur && cur.weight >= weight) return;
    this.moments[kind] = { kind, tick: snap.tick, at, json: snap.json, view: snap.view, weight, x, y, info };
  }

  private sample() {
    const s = this.values();
    this.samples.push(s);
    if (this.samples.length > 90) this.samples.shift();
    const t = s.tick;
    // swing: the worst stretch of the last minute (army we lost beyond what the enemy lost; production does not count)
    let worst: Sample | null = null, drop = 0;
    for (const p of this.samples) {
      if (p.tick < t - SWING_WINDOW || p === s) continue;
      const d = Math.max(0, p.army - s.army) - Math.max(0, p.foes - s.foes);
      if (d > drop) { drop = d; worst = p; }
    }
    if (worst && drop >= 2000) {
      const snap = this.snapBefore(worst.tick);
      if (snap) this.pin('swing', snap, t, drop, ...this.baseCentre(this.local()), { drop: Math.round(drop) });
    }
    // comeback: lowest share of total strength (after the opening)
    const share = s.total / Math.max(1, s.total + s.ftotal);
    if (t > 180 * TICK_HZ && share < this.minShare) {
      this.minShare = share;
      const snap = this.snapBefore(t);
      if (snap && share < 0.4) this.pin('comeback', snap, t, 1 - share, ...this.baseCentre(this.local()), { share: Math.round(share * 100) });
    }
    // siege: a big enemy force inside the base
    if (t - this.lastSiege > 180 * TICK_HZ) {
      const me = this.local();
      const [bx, by] = this.baseCentre(me);
      let inside = 0;
      for (const u of this.world.units) if (u.alive && u.weapons.length && !u.ut.harvester && me.isEnemy(u.owner) && u.kind !== 'aircraft' && Math.hypot(u.x - bx, u.y - by) < 14) inside += u.ut.cost;
      if (inside >= Math.max(2500, 0.75 * s.army)) {
        this.lastSiege = t;
        const snap = this.snapBefore(t - 8 * TICK_HZ);
        if (snap) this.pin('siege', snap, t, inside, bx, by, { value: Math.round(inside) });
      }
    }
  }

  private checkNuke() {
    const me = this.local();
    for (const p of this.world.projectiles) {
      if (p.special !== 'nuke' || !p.alive || this.seenNukes.has(p.id) || !me.isEnemy(p.owner)) continue;
      this.seenNukes.add(p.id);
      const snap = this.snapBefore(this.world.tick - 3 * TICK_HZ) ?? this.snapBefore(this.world.tick);
      if (snap) this.pin('nuke', snap, this.world.tick, 5000, p.tx, p.ty, { tx: p.tx, ty: p.ty });
    }
  }

  private baseCentre(me: Player): [number, number] {
    const bs = this.world.buildings.filter((b) => b.alive && b.owner === me && !b.bt.wall && !b.bt.mine);
    const fact = bs.find((b) => b.bt.id === 'fact');
    if (fact) return [fact.x, fact.y];
    if (bs.length) return [bs.reduce((s, b) => s + b.x, 0) / bs.length, bs.reduce((s, b) => s + b.y, 0) / bs.length];
    const s = this.world.map.startPositions[me.id % this.world.map.startPositions.length];
    return [s.x, s.y];
  }

  /** The moments worth offering at the end of the match, best first (at most `max`). */
  offers(won: boolean, max = 3): Moment[] {
    const out: Moment[] = [];
    const order: MomentKind[] = ['nuke', 'siege', 'comeback', 'swing'];
    for (const k of order) {
      const m = this.moments[k];
      if (!m) continue;
      if (k === 'comeback' && !(m.info.share <= 35)) continue;
      if (k === 'comeback' && !won) m.info.lost = 1;
      out.push(m);
    }
    return out.slice(0, max);
  }
}

/** Structure entries of a serialized world (owner, type, id, position) — to pick goal targets for a snapshot. */
export function stateStructures(state: unknown): { id: number; type: string; owner: number; x: number; y: number }[] {
  const s = state as { entities?: { cls: string; id: number; type: string; owner: number; x: number; y: number; alive?: boolean }[] };
  return (s.entities ?? []).filter((e) => e.cls === 'B' && e.alive !== false).map((e) => ({ id: e.id, type: e.type, owner: e.owner, x: e.x, y: e.y }));
}

/** Goal, time limit and texts for a moment's challenge. */
export function momentGoal(m: Moment, side: number, state: unknown): { goal: ChallengeGoal; timeLimit: number; title: string; text: string; par?: { time?: number; losses?: number } } {
  const at = (t: number) => `${Math.floor(t / TICK_HZ / 60)}:${String(Math.floor(t / TICK_HZ) % 60).padStart(2, '0')}`;
  const own = stateStructures(state).filter((b) => b.owner === side);
  const yard = (exclude?: [number, number, number]) => {
    const ok = own.filter((b) => !exclude || Math.hypot(b.x - exclude[0], b.y - exclude[1]) > exclude[2]);
    return ok.find((b) => b.type === 'fact') ?? ok.find((b) => b.type === 'weap') ?? ok.find((b) => b.type === 'proc') ?? null;
  };
  switch (m.kind) {
    case 'nuke': {
      const keep = yard([m.info.tx, m.info.ty, 6]);
      if (keep) return { goal: { kind: 'protect', targets: [keep.id], label: M.nuke.goalKeep }, timeLimit: 180, title: M.nuke.title,
        text: en(M.nuke.textKeep, { at: at(m.at) }), par: { losses: 8 } };
      return { goal: { kind: 'survive', label: M.nuke.goalSurvive }, timeLimit: 240, title: M.nuke.title,
        text: en(M.nuke.textSurvive, { at: at(m.at) }), par: { losses: 10 } };
    }
    case 'siege': {
      const keep = yard();
      if (keep) return { goal: { kind: 'protect', targets: [keep.id], label: M.siege.goalKeep }, timeLimit: 180, title: M.siege.title,
        text: en(M.siege.textKeep, { at: at(m.at), money: `$${m.info.value.toLocaleString('en-US')}` }), par: { losses: 8 } };
      return { goal: { kind: 'survive', label: M.siege.goalSurvive }, timeLimit: 180, title: M.siege.title, text: en(M.siege.textSurvive, { at: at(m.at) }), par: { losses: 8 } };
    }
    case 'comeback':
      return { goal: { kind: 'win', label: M.comeback.goal }, timeLimit: 900, title: M.comeback.title,
        text: en(m.info.lost ? M.comeback.text : M.comeback.textWon, { at: at(m.at), share: String(m.info.share) }), par: { time: 540 } };
    case 'swing':
    default:
      return { goal: { kind: 'win', label: M.swing.goal }, timeLimit: 900, title: M.swing.title,
        text: en(M.swing.text, { at: at(m.at), money: `$${(m.info.drop ?? 0).toLocaleString('en-US')}` }), par: { time: 600 } };
  }
}
