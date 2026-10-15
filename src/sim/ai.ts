import { BUILDINGS, UNITS, type BuildingTypeDef, type Faction } from '../data/rules';
import { Building, Entity, Unit } from './entities';
import type { Player } from './player';
import { buildSeconds } from './production';
import { pickWeapon } from './combat';
import { superReady } from './superweapons';
import { TICK_HZ } from './types';
import type { World } from './world';
import { aiNavalStructure, aiNavalThink, aiPlacement } from './ai-naval';
import { contentAI } from './ai-content';
import { apparentType } from './infiltration';

export type AIDifficulty = 'easy' | 'normal' | 'hard' | 'brutal';
/** Mission behaviour: passive = holds position only; defensive = builds and defends, never attacks. */
export type AIBehaviour = AIDifficulty | 'passive' | 'defensive';

interface DiffParams {
  buildSpeed: number;
  income: number;
  firstAttack: number;     // seconds before the first wave
  waveValue: number;       // army value needed for the first wave
  waveGrowth: number;
  defenses: number;
  reaction: number;        // fraction of army sent to defend
  superweapons: boolean;
}

const DIFF: Record<AIDifficulty, DiffParams> = {
  easy:   { buildSpeed: 0.65, income: 0.9, firstAttack: 600, waveValue: 3200, waveGrowth: 1200, defenses: 2, reaction: 0.4, superweapons: false },
  normal: { buildSpeed: 0.95, income: 1.0, firstAttack: 420, waveValue: 3500, waveGrowth: 1800, defenses: 3, reaction: 0.7, superweapons: true },
  hard:   { buildSpeed: 1.15, income: 1.15, firstAttack: 300, waveValue: 3500, waveGrowth: 2000, defenses: 4, reaction: 0.85, superweapons: true },
  brutal: { buildSpeed: 1.4, income: 1.35, firstAttack: 210, waveValue: 3500, waveGrowth: 2200, defenses: 5, reaction: 1, superweapons: true },
};

/** [type, how many] goals in priority order. Power is handled separately. */
const GOALS: Record<Faction, [string, number][]> = {
  allies: [
    ['tent', 1], ['proc', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['gun', 1], ['pbox', 1], ['gun', 2],
    ['atek', 1], ['agun', 1], ['hpad', 1], ['fix', 1], ['hbox', 1], ['gun', 3], ['proc', 3], ['weap', 2], ['gun', 4], ['agun', 2], ['hpad', 2], ['pbox', 2], ['weaf', 1], ['pdox', 1], ['gap', 1], ['mslo', 1], ['gun', 6], ['pbox', 4], ['facf', 1], ['hbox', 2],
  ],
  soviet: [
    ['barr', 1], ['proc', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['ftur', 1], ['tsla', 1], ['kenn', 1],
    ['stek', 1], ['sam', 1], ['afld', 1], ['ftur', 2], ['tsla', 2], ['proc', 3], ['hpad', 1], ['weap', 2], ['fix', 1], ['sam', 2], ['tsla', 3], ['iron', 1], ['mslo', 1], ['tsla', 4], ['ftur', 4],
  ],
};

/** The first attack wave commits at most this multiple of the difficulty's wave value. */
const FIRST_WAVE_CAP = 1.3;

const DEFENSES = new Set(['gun', 'pbox', 'hbox', 'ftur', 'tsla']);
const AIR_DEFENSE = new Set(['agun', 'sam']);

const INF_MIX: Record<Faction, [string, number][]> = {
  allies: [['e1', 45], ['e3', 35], ['medi', 8], ['e7', 4]],
  soviet: [['e1', 40], ['e2', 22], ['e3', 25], ['e4', 10], ['dog', 6]],
};
const AIR_MIX: Record<Faction, [string, number][]> = {
  allies: [['heli', 1]],
  soviet: [['hind', 35], ['mig', 40], ['yak', 25]],
};
const VEH_MIX: Record<Faction, [string, number][]> = {
  allies: [['2tnk', 42], ['1tnk', 22], ['jeep', 12], ['arty', 16]],
  soviet: [['3tnk', 50], ['v2rl', 16], ['4tnk', 28]],
};

export class AIController {
  private d: DiffParams;
  private state: 'build' | 'attack' = 'build';
  private stage: 'gather' | 'assault' = 'assault';
  private stageX = 0;
  private stageY = 0;
  private stageTarget: [number, number] = [0, 0];
  private stageStart = 0;
  private wave = new Set<number>();
  private waveStart = 0;
  private nextWaveValue: number;
  private lastDefend = -9999;
  private deployTries = 0;
  private behaviour: 'full' | 'passive' | 'defensive' = 'full';

  get player(): Player {
    return this.p;
  }

  /** Switch behaviour mid-game (missions). */
  setMode(mode: AIBehaviour) {
    if (mode === 'passive' || mode === 'defensive') { this.behaviour = mode; return; }
    this.behaviour = 'full';
    this.difficulty = mode;
    this.d = DIFF[mode];
    this.p.buildSpeed = this.d.buildSpeed;
    this.p.incomeBias = this.d.income;
  }

  constructor(private world: World, private p: Player, public difficulty: AIDifficulty) {
    this.d = DIFF[difficulty];
    p.buildSpeed = this.d.buildSpeed;
    p.incomeBias = this.d.income;
    this.nextWaveValue = this.d.waveValue;
  }

  /** Think calls so far. Periodic tasks gate on this rather than world.tick: AIs think on staggered ticks. */
  thinks = 0;
  /** True once every `ticks` sim ticks of thinking (think() runs every 10 ticks). */
  private due(ticks: number) {
    return this.thinks % Math.max(1, Math.round(ticks / 10)) === 0;
  }

  think() {
    this.thinks++;
    const p = this.p;
    if (p.defeated) return;
    if (this.behaviour === 'passive') { this.defendOnly(); return; }
    this.handleMcv();
    this.placeReadyStructure();
    this.planStructures();
    this.planUnits();
    this.repairBase();
    aiNavalThink(this.world, this.p, this.thinks, this.difficulty, this.behaviour !== 'full');
    if (this.behaviour === 'defensive') { this.defendOnly(); return; }
    this.military();
    this.airStrikes();
    this.superweapons();
    contentAI(this);
  }

  // ---------------------------------------------------------------------------
  private myBuildings(): Building[] {
    return this.world.buildings.filter((b) => b.alive && b.owner === this.p);
  }
  private myUnits(): Unit[] {
    return this.world.units.filter((u) => u.alive && u.owner === this.p);
  }
  private count(type: string): number {
    let n = 0;
    for (const b of this.world.buildings) if (b.alive && b.owner === this.p && b.bt.id === type) n++;
    const q = this.p.queues.structure;
    if (q.ready === type) n++;
    if (q.items[0]?.type === type) n++;
    return n;
  }

  private baseCenter(): [number, number] {
    const fact = this.world.buildings.find((b) => b.alive && b.owner === this.p && b.bt.id === 'fact');
    if (fact) return [fact.x, fact.y];
    const bs = this.myBuildings();
    if (bs.length) return [bs.reduce((s, b) => s + b.x, 0) / bs.length, bs.reduce((s, b) => s + b.y, 0) / bs.length];
    const s = this.world.map.startPositions[this.p.id % this.world.map.startPositions.length];
    return [s.x, s.y];
  }

  private enemyCenter(): [number, number] | null {
    const [bx, by] = this.baseCenter();
    let best: [number, number] | null = null, bestD = Infinity;
    for (const b of this.world.buildings) {
      if (!b.alive || !this.p.isEnemy(b.owner) || b.bt.mine) continue;
      const d = Math.hypot(b.x - bx, b.y - by);
      if (d < bestD) { bestD = d; best = [b.x, b.y]; }
    }
    if (best) return best;
    for (const u of this.world.units) {
      if (!u.alive || !this.p.isEnemy(u.owner)) continue;
      const d = Math.hypot(u.x - bx, u.y - by);
      if (d < bestD) { bestD = d; best = [u.x, u.y]; }
    }
    return best;
  }

  private enemyDir(): [number, number] {
    const [bx, by] = this.baseCenter();
    const e = this.enemyCenter() ?? [this.world.map.w / 2, this.world.map.h / 2];
    const dx = e[0] - bx, dy = e[1] - by;
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }

  // ---------------------------------------------------------------------------
  private handleMcv() {
    if (this.p.has('fact')) return;
    const mcv = this.myUnits().find((u) => u.ut.deploysInto);
    if (!mcv || mcv.order.type === 'deploy' || mcv.moving || mcv.path) return;
    if (this.world.canDeploy(mcv)) {
      this.world.issue({ c: 'deploy', player: this.p.id, units: [mcv.id] });
    } else {
      this.deployTries++;
      const a = this.deployTries * 2.1;
      const r = 1.5 + this.deployTries * 0.5;
      this.world.issue({ c: 'move', player: this.p.id, units: [mcv.id], x: mcv.x + Math.cos(a) * r, y: mcv.y + Math.sin(a) * r });
    }
  }

  private placeReadyStructure() {
    const q = this.p.queues.structure;
    if (!q.ready) return;
    const spot = aiPlacement(this.world, this.p, BUILDINGS[q.ready]) ?? this.findPlacement(BUILDINGS[q.ready]);
    if (spot) this.world.issue({ c: 'place', player: this.p.id, type: q.ready, cx: spot[0], cy: spot[1] });
    else this.world.issue({ c: 'cancel', player: this.p.id, type: q.ready });
  }

  private planStructures() {
    const p = this.p;
    const q = p.queues.structure;
    if (q.items.length || q.ready || !p.has('fact')) return;
    const want = aiNavalStructure(this.world, p) ?? this.nextStructure();
    if (want) this.world.issue({ c: 'build', player: p.id, type: want });
  }

  /** The structure we want next, ignoring affordability. */
  private goalStructure(): string | null {
    const p = this.p;
    const surplus = p.powerOut - p.powerUse;
    const goal = GOALS[p.faction].find(([t, n]) => this.count(t) < n && p.canBuild(t) && this.allowed(t));
    const goalDrain = goal ? Math.max(0, -BUILDINGS[goal[0]].power) : 0;
    if (surplus < 20 || surplus - goalDrain < 0) return p.canBuild('apwr') && this.count('powr') >= 2 ? 'apwr' : 'powr';
    return goal ? goal[0] : null;
  }

  private nextStructure(): string | null {
    const p = this.p;
    // power first
    const surplus = p.powerOut - p.powerUse;
    const goal = GOALS[p.faction].find(([t, n]) => this.count(t) < n && p.canBuild(t) && this.allowed(t));
    const goalDrain = goal ? Math.max(0, -BUILDINGS[goal[0]].power) : 0;
    if (surplus < 20 || surplus - goalDrain < 0) {
      if (p.canBuild('apwr')) return 'apwr';
      if (p.canBuild('powr')) return 'powr';
    }
    if (p.ore > p.storage * 0.85 && p.storage > 0 && p.canBuild('silo') && this.count('silo') < 3) return 'silo';
    if (goal) {
      const t = BUILDINGS[goal[0]];
      if (p.credits >= Math.min(t.cost, 2000) * 0.5 || goal[0] === 'proc' || goal[0] === 'powr') return goal[0];
    }
    return null;
  }

  private allowed(t: string): boolean {
    if (AIR_DEFENSE.has(t)) {
      const enemyAir = this.world.units.some((u) => u.alive && u.kind === 'aircraft' && this.p.isEnemy(u.owner));
      return enemyAir || this.world.time > 720;
    }
    if (DEFENSES.has(t)) {
      let n = 0;
      for (const b of this.myBuildings()) if (DEFENSES.has(b.bt.id)) n++;
      return n < this.d.defenses + (this.world.time > 900 ? 2 : 0);
    }
    if (BUILDINGS[t].superweapon) return this.d.superweapons && this.world.time > 600;
    return true;
  }

  findPlacement(bt: BuildingTypeDef): [number, number] | null {
    const w = this.world;
    const m = w.map;
    const [bx, by] = this.baseCenter();
    const [ex, ey] = this.enemyDir();
    let cx = bx, cy = by;
    const isDef = DEFENSES.has(bt.id) || AIR_DEFENSE.has(bt.id);
    if (isDef) {
      const dist = 6 + w.rng.range(0, 3);
      const side = w.rng.range(-0.9, 0.9);
      cx = bx + ex * dist - ey * side * 4;
      cy = by + ey * dist + ex * side * 4;
    } else if (bt.id === 'proc') {
      const ore = this.nearestOre(bx, by);
      if (ore) { cx = (bx + ore[0]) / 2; cy = (by + ore[1]) / 2; }
    } else {
      // keep factories and tech behind the front line a bit
      cx = bx - ex * 2;
      cy = by - ey * 2;
    }
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    const R = 13;
    const ox = Math.round(cx - bt.size[0] / 2), oy = Math.round(cy - bt.size[1] / 2);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const px = ox + dx, py = oy + dy;
        const score = Math.hypot(dx, dy) + w.rng.next() * 0.5;
        if (score >= bestScore) continue;
        if (!w.canPlace(this.p, bt.id, px, py)) continue;
        if (!isDef && !this.hasMargin(bt, px, py)) continue;
        bestScore = score;
        best = [px, py];
      }
    }
    void m;
    return best;
  }

  /** Keep a one-cell walkway around non-defensive buildings so the base stays traversable. */
  private hasMargin(bt: BuildingTypeDef, px: number, py: number): boolean {
    const m = this.world.map;
    for (let y = py - 1; y <= py + bt.size[1]; y++) {
      for (let x = px - 1; x <= px + bt.size[0]; x++) {
        if (x >= px && x < px + bt.size[0] && y >= py && y < py + bt.size[1]) continue;
        if (!m.inBounds(x, y)) continue;
        const i = m.idx(x, y);
        if (m.occupant[i]) return false;
      }
    }
    // keep our own dock/exit cell in front free of ore-blocking neighbours
    return true;
  }

  private nearestOre(x: number, y: number): [number, number] | null {
    const m = this.world.map;
    let best: [number, number] | null = null, bestD = Infinity;
    for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
      if (!m.ore[m.idx(cx, cy)]) continue;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bestD) { bestD = d; best = [cx + 0.5, cy + 0.5]; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  private planUnits() {
    const p = this.p;
    const units = this.myUnits();
    const harvs = units.filter((u) => u.ut.harvester).length;
    const refs = this.count('proc');
    const wantHarv = Math.min(refs * 2, refs + 2);
    const vq = p.queues.vehicle;
    const iq = p.queues.infantry;
    const queuedHarv = vq.items.filter((i) => i.type === 'harv').length;
    if (harvs + queuedHarv < wantHarv && p.canBuild('harv')) {
      if (!vq.items.length || (vq.items.length < 2 && vq.items[0].type !== 'harv')) this.world.issue({ c: 'build', player: p.id, type: 'harv' });
      return;
    }
    // keep enough money for the next structure on the build list
    const next = p.queues.structure.items[0]?.type ?? (p.queues.structure.ready ? null : this.goalStructure());
    const nextCost = next ? BUILDINGS[next].cost : 0;
    const keyStruct = next === 'proc' || next === 'weap' || next === 'powr' || next === 'apwr';
    const early = this.world.time < 480;
    const reserve = keyStruct ? Math.min(early ? 2000 : 1200, nextCost * (early ? 0.8 : 0.6)) + 100 : early ? nextCost * 0.3 : 100;
    const underThreat = this.world.tick - this.lastDefend < TICK_HZ * 10;
    if (p.credits < reserve && !underThreat) return;
    const inf = units.filter((u) => u.kind === 'infantry').length;
    const veh = units.filter((u) => u.kind === 'vehicle' && !u.ut.harvester && !u.ut.deploysInto).length;
    const canVeh = p.has('weap');
    const infCap = this.world.time > 600 ? veh * 0.8 + 4 : veh * 1.5 + 6;
    if (!iq.items.length && (!canVeh || inf < infCap)) {
      const t = this.pick(INF_MIX[p.faction]);
      if (t) this.world.issue({ c: 'build', player: p.id, type: t, count: t === 'e1' ? 2 : 1 });
    }
    if (!vq.items.length && p.credits > reserve + 500) {
      const t = this.pick(VEH_MIX[p.faction]);
      if (t) this.world.issue({ c: 'build', player: p.id, type: t });
    }
    const aq = p.queues.aircraft;
    const air = units.filter((u) => u.kind === 'aircraft').length;
    if (!aq.items.length && p.credits > reserve + 1200 && air < 2 + this.d.defenses / 2) {
      const t = this.pick(AIR_MIX[p.faction]);
      if (t) this.world.issue({ c: 'build', player: p.id, type: t });
    }
  }

  private pick(mix: [string, number][]): string | null {
    const opts = mix.filter(([t]) => this.p.canBuild(t));
    if (!opts.length) return null;
    const total = opts.reduce((s, [, w]) => s + w, 0);
    let r = this.world.rng.next() * total;
    for (const [t, w] of opts) { r -= w; if (r <= 0) return t; }
    return opts[0][0];
  }

  private repairBase() {
    if (!this.due(TICK_HZ * 2)) return;
    if (this.p.credits < 500) return;
    for (const b of this.myBuildings()) {
      if (b.active && !b.repairing && b.healthFrac < 0.7) {
        this.world.issue({ c: 'repair', player: this.p.id, building: b.id });
        break;
      }
    }
  }

  /** Hold ground: idle units engage intruders near the base, nothing else. */
  private defendOnly() {
    const w = this.world;
    if (!this.due(TICK_HZ * 2)) return;
    const [bx, by] = this.baseCenter();
    let threat: Unit | null = null;
    for (const u of w.units) {
      if (!u.alive || !this.p.isEnemy(u.owner) || u.kind === 'naval' || (u.ut.spy && u.disguise >= 0) || u.ut.supportPlane) continue; // ships: see ai-naval.ts
      if (Math.hypot(u.x - bx, u.y - by) < 14) { threat = u; break; }
    }
    if (!threat) return;
    const ids = this.army().filter((u) => u.order.type === 'idle' && Math.hypot(u.x - threat!.x, u.y - threat!.y) < 16).map((u) => u.id);
    if (ids.length) w.issue({ c: 'move', player: this.p.id, units: ids, x: threat.x, y: threat.y, attackMove: true });
  }

  // ---------------------------------------------------------------------------
  private army(): Unit[] {
    return this.myUnits().filter((u) => u.weapons.length && !u.ut.harvester && !u.ut.deploysInto && !u.ut.medic && u.kind !== 'aircraft' && u.kind !== 'naval');
  }

  /** Aircraft strike harvesters, defences and soft targets when fully armed. */
  private airStrikes() {
    const w = this.world;
    if (!this.due(TICK_HZ * 4)) return;
    // idle and fully armed: landed on the pad or hovering at its post
    const ready = this.myUnits().filter((u) => u.kind === 'aircraft' && u.order.type === 'idle' && u.ammo >= (u.ut.ammo ?? 1));
    if (ready.length < 2) return;
    let best: Entity | null = null, bestScore = Infinity;
    const [bx, by] = this.baseCenter();
    for (const e of [...w.units, ...w.buildings] as Entity[]) {
      if (!e.alive || !this.p.isEnemy(e.owner)) continue;
      if ((e instanceof Building && e.bt.mine) || (e instanceof Unit && e.ut.spy && e.disguise >= 0)) continue; // unseen mines, disguised spies
      if (!pickWeapon(ready[0], e)) continue; // walls, aircraft in flight...
      // avoid heavily defended spots
      let aa = 0;
      for (const b of w.buildings) if (b.alive && b.owner === e.owner && (b.bt.id === 'sam' || b.bt.id === 'agun') && Math.hypot(b.x - e.x, b.y - e.y) < 8) aa++;
      let score = Math.hypot(e.x - bx, e.y - by) * 0.3 + aa * 25;
      if (e instanceof Unit && e.ut.harvester) score -= 20;
      if (e instanceof Building && apparentType(e, this.p).id === 'proc') score -= 10;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) w.issue({ c: 'attack', player: this.p.id, units: ready.map((u) => u.id), target: best.id });
  }

  private military() {
    const w = this.world;
    const p = this.p;
    const army = this.army();
    const [bx, by] = this.baseCenter();
    const [ex, ey] = this.enemyDir();
    const gx = bx + ex * 5, gy = by + ey * 5;

    // set rally points for factories
    if (this.due(TICK_HZ * 5)) {
      for (const b of this.myBuildings()) {
        if (b.bt.factory === 'naval') continue; // the naval AI keeps its own anchorage
        if (b.bt.factory === 'aircraft') {
          // aircraft wait on their pads (a ground rally point would leave them hovering there forever)
          if (b.rallyX >= 0) w.issue({ c: 'rally', player: p.id, building: b.id, x: -1, y: -1 });
          continue;
        }
        if (b.bt.factory && b.bt.factory !== 'building' && Math.hypot(b.rallyX - gx, b.rallyY - gy) > 2) {
          const spot = w.findFreeSpot(gx, gy, 5);
          w.issue({ c: 'rally', player: p.id, building: b.id, x: spot[0], y: spot[1] });
        }
      }
    }

    // --- defend the base
    let threat: Unit | null = null;
    for (const u of w.units) {
      if (!u.alive || !p.isEnemy(u.owner) || u.ut.harvester || u.kind === 'naval' || (u.ut.spy && u.disguise >= 0) || u.ut.supportPlane) continue;
      if (Math.hypot(u.x - bx, u.y - by) < 13) { threat = u; break; }
    }
    if (threat && w.tick - this.lastDefend > TICK_HZ * 4) {
      this.lastDefend = w.tick;
      const defenders = army.filter((u) => !this.wave.has(u.id) || this.state !== 'attack');
      const n = Math.ceil(defenders.length * this.d.reaction);
      const ids = defenders.sort((a, b) => Math.hypot(a.x - threat!.x, a.y - threat!.y) - Math.hypot(b.x - threat!.x, b.y - threat!.y)).slice(0, n).map((u) => u.id);
      if (ids.length) w.issue({ c: 'move', player: p.id, units: ids, x: threat.x, y: threat.y, attackMove: true });
      return;
    }

    // --- attack waves
    if (this.state === 'build') {
      const idle = army.filter((u) => u.order.type === 'idle' || u.order.type === 'guard');
      const value = idle.reduce((s, u) => s + u.ut.cost, 0);
      if (w.time >= this.d.firstAttack && value >= this.nextWaveValue) {
        const target = this.pickAttackTarget();
        if (target) {
          this.state = 'attack';
          // the first wave commits only about 1.3x the wave value (closest to the target first);
          // the rest stays home as defence. Later waves take every idle unit.
          let wave = idle;
          // (skirmish only: campaign missions are balanced around their scripted openings)
          if (this.nextWaveValue <= this.d.waveValue && !w.mission) {
            const cap = this.d.waveValue * FIRST_WAVE_CAP;
            const byDist = idle.slice().sort((a, b) => Math.hypot(a.x - target[0], a.y - target[1]) - Math.hypot(b.x - target[0], b.y - target[1]) || a.id - b.id);
            wave = [];
            let sum = 0;
            for (const u of byDist) {
              if (sum >= cap) break;
              if (sum + u.ut.cost > cap && sum >= this.d.waveValue) continue;
              wave.push(u);
              sum += u.ut.cost;
            }
          }
          this.wave = new Set(wave.map((u) => u.id));
          this.waveStart = this.wave.size;
          // gather at a staging point outside the enemy base first
          const k = 0.55;
          const spot = w.findFreeSpot(bx + (target[0] - bx) * k, by + (target[1] - by) * k, 6);
          this.stage = 'gather';
          this.stageX = spot[0];
          this.stageY = spot[1];
          this.stageTarget = target;
          this.stageStart = w.tick;
          w.issue({ c: 'move', player: p.id, units: [...this.wave], x: spot[0], y: spot[1], attackMove: true });
          this.nextWaveValue += this.d.waveGrowth;
        }
      } else if (this.due(TICK_HZ * 6)) {
        // gather idle units at the rally point
        const stray = idle.filter((u) => Math.hypot(u.x - gx, u.y - gy) > 6).map((u) => u.id);
        if (stray.length) w.issue({ c: 'move', player: p.id, units: stray, x: gx, y: gy });
      }
    } else {
      const alive = [...this.wave].map((id) => w.entities.get(id) as Unit | undefined).filter((u): u is Unit => !!u && u.alive);
      this.wave = new Set(alive.map((u) => u.id));
      if (alive.length <= Math.max(1, this.waveStart * 0.25)) {
        // wave broken: regroup
        this.state = 'build';
        const ids = alive.map((u) => u.id);
        if (ids.length) w.issue({ c: 'move', player: p.id, units: ids, x: gx, y: gy });
        return;
      }
      if (this.stage === 'gather') {
        const near = alive.filter((u) => Math.hypot(u.x - this.stageX, u.y - this.stageY) < 7).length;
        if (near >= alive.length * 0.75 || w.tick - this.stageStart > TICK_HZ * 60) {
          this.stage = 'assault';
          const t = this.pickAttackTarget(this.stageX, this.stageY) ?? this.stageTarget;
          w.issue({ c: 'move', player: p.id, units: alive.map((u) => u.id), x: t[0], y: t[1], attackMove: true });
        }
        return;
      }
      // keep pushing: idle wave units pick the next target
      const idle = alive.filter((u) => u.order.type === 'idle' && !u.target);
      if (idle.length && this.due(TICK_HZ * 3)) {
        const near = this.nearestEnemyBuilding(idle[0].x, idle[0].y);
        // walls in the way: blast through the nearest segment
        let wall: Building | null = null;
        for (const b of w.buildings) {
          if (b.alive && b.bt.wall && this.p.isEnemy(b.owner) && Math.hypot(b.x - idle[0].x, b.y - idle[0].y) < 3.5) { wall = b; break; }
        }
        // (only units that can breach it: small arms can't, and such orders are refused)
        const breakers = wall ? idle.filter((u) => pickWeapon(u, wall!)) : [];
        if (wall && breakers.length && (!near || Math.hypot(near.x - idle[0].x, near.y - idle[0].y) > 5)) {
          w.issue({ c: 'attack', player: p.id, units: breakers.map((u) => u.id), target: wall.id, forced: true });
        } else if (near && Math.hypot(near.x - idle[0].x, near.y - idle[0].y) < 12) {
          w.issue({ c: 'attack', player: p.id, units: idle.map((u) => u.id), target: near.id });
        } else {
          const target = this.pickAttackTarget(idle[0].x, idle[0].y);
          if (target) w.issue({ c: 'move', player: p.id, units: idle.map((u) => u.id), x: target[0], y: target[1], attackMove: true });
          else this.state = 'build';
        }
      }
    }
  }

  private nearestEnemyBuilding(x: number, y: number): Building | null {
    let best: Building | null = null, bestD = Infinity;
    for (const b of this.world.buildings) {
      if (!b.alive || !this.p.isEnemy(b.owner) || b.bt.wall || b.bt.mine) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  private pickAttackTarget(fromX?: number, fromY?: number): [number, number] | null {
    const w = this.world;
    const [bx, by] = fromX !== undefined ? [fromX, fromY!] : this.baseCenter();
    let best: [number, number] | null = null, bestScore = Infinity;
    for (const b of w.buildings) {
      if (!b.alive || !this.p.isEnemy(b.owner) || b.bt.wall || b.bt.mine) continue;
      let score = Math.hypot(b.x - bx, b.y - by);
      const look = apparentType(b, this.p); // decoys pass for the real thing
      if (look.id === 'proc' || look.factory) score -= 4;
      // steer around fortified spots
      if (b.weapons.length) score += 6;
      for (const d of w.buildings) if (d.alive && d.owner === b.owner && d.weapons.length && d !== b && Math.hypot(d.x - b.x, d.y - b.y) < 7) score += 3;
      if (score < bestScore) { bestScore = score; best = [b.x, b.y + b.h / 2 + 0.5]; }
    }
    if (best) return best;
    for (const u of w.units) {
      if (!u.alive || !this.p.isEnemy(u.owner)) continue;
      const score = Math.hypot(u.x - bx, u.y - by);
      if (score < bestScore) { bestScore = score; best = [u.x, u.y]; }
    }
    return best;
  }

  private superweapons() {
    const w = this.world;
    const p = this.p;
    if (!this.d.superweapons || !this.due(TICK_HZ)) return;
    if (superReady(w, p, 'nuke')) {
      // aim at the densest cluster of enemy structures
      let best: Building | null = null, bestScore = -1;
      for (const b of w.buildings) {
        if (!b.alive || !p.isEnemy(b.owner) || b.bt.mine) continue;
        let score = 0;
        for (const o of w.buildings) if (o.alive && o.owner === b.owner && Math.hypot(o.x - b.x, o.y - b.y) < 4) score += apparentType(o, p).cost;
        if (score > bestScore) { bestScore = score; best = b; }
      }
      if (best) w.issue({ c: 'superweapon', player: p.id, kind: 'nuke', x: best.x, y: best.y });
    }
    if (superReady(w, p, 'ironcurtain') && this.state === 'attack') {
      const tanks = [...this.wave].map((id) => w.entities.get(id) as Unit | undefined).filter((u): u is Unit => !!u && u.alive && u.kind === 'vehicle');
      if (tanks.length >= 3) w.issue({ c: 'superweapon', player: p.id, kind: 'ironcurtain', x: tanks[0].x, y: tanks[0].y });
    }
    if (superReady(w, p, 'chrono')) {
      const tank = this.army().find((u) => u.kind === 'vehicle' && u.ut.id === '2tnk');
      const t = this.pickAttackTarget();
      if (tank && t) {
        const spot = w.findFreeSpot(t[0] + 2, t[1] + 2, 4);
        w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x: spot[0], y: spot[1], unit: tank.id });
      }
    }
  }

  /** Expected seconds to build (unused helper kept for tuning). */
  eta(type: string) {
    return buildSeconds(this.world, this.p, type);
  }
}

export { UNITS };
