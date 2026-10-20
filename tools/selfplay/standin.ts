/**
 * Human stand-ins for the difficulty benchmarks (tools/selfplay/standins.ts): scripted players that play the way
 * real people of three skill levels do, through the same commands the UI sends (no AI hooks, no world.ais slot, so
 * none of the AI-only conveniences in src/sim/events.ts or src/sim/neutral.ts help them).
 *
 *  - novice:      a slow build with one refinery and two Ore Trucks, power only once it runs out, one pillbox, factories
 *                 often idle, a few small attack-moves late in the game, slow and partial reaction to raids;
 *  - casual:      a sensible build with two refinery lines (two trucks each), defences, power planned ahead, factories
 *                 mostly busy, a medium attack every few minutes, the whole home army answers a raid, repairs, and under
 *                 Commander rules Emergency Funds, Reinforcements, Tier 2 and an Ore Processor;
 *  - experienced: not scripted here: the frozen simulation-version-2 Normal AI (tools/selfplay/frozen) playing with a
 *                 human's economy (build speed and income 1.0), see lib.ts.
 *
 * They act every `every` seconds of attention (between world steps, like UI input), with a private seeded RNG, so a
 * match stays deterministic for its MatchSpec. Fixed on purpose: they are the yardstick, do not tune them to the AI.
 */
import { BUILDINGS, UNITS, type Faction } from '../../src/data/rules';
import { Rng } from '../../src/core/rng';
import { Building, Unit } from '../../src/sim/entities';
import type { Player } from '../../src/sim/player';
import { TICK_HZ } from '../../src/sim/types';
import type { World } from '../../src/sim/world';
import { POWERS, TIER_COST, powerReady, tierOpen } from '../../src/sim/commander';

export type StandInLevel = 'novice' | 'casual' | 'experienced';

interface Profile {
  /** Seconds of attention between actions. */
  every: number;
  /** Structure goals in order ([type, how many]); power is handled separately. */
  build: Record<Faction, [string, number][]>;
  /** Seconds of dawdling after placing a structure before the next one is started. */
  dawdle: number;
  /** Builds power ahead of need (casual) or only after `lowPowerFor` seconds of low power (novice). */
  planPower: boolean;
  lowPowerFor: number;
  /** Ore Trucks wanted per refinery, at most `maxTrucks`; how often the count is checked (s). */
  trucksPerRef: number;
  maxTrucks: number;
  truckCheck: number;
  /** Seconds between looks at the factories (they sit idle in between), and how many units a factory gets queued. */
  produceEvery: number;
  queueDepth: number;
  /** Queues one unit per look at the factories (the novice), or tops up every factory (the others). */
  onePerLook: boolean;
  /** Credits kept back from units while a structure is still on the list. */
  reserve: number;
  inf: Record<Faction, [string, number][]>;
  veh: Record<Faction, [string, number][]>;
  /** Infantry per vehicle the stand-in aims for. */
  infPerVeh: number;
  /** Attacks: earliest time (s), army value needed (+growth per wave), minimum gap between waves (s). */
  firstAttack: number;
  attackValue: number;
  attackGrowth: number;
  attackEvery: number;
  /** Share of the army (by value) that stays home when a wave leaves. */
  keepHome: number;
  /** Wave falls back home when it is down to this share of its units (0 = fights to the end). */
  retreatAt: number;
  /** Seconds before reacting to an intruder near the base, and the share of the home army sent. */
  defendDelay: number;
  defendShare: number;
  /** Repairs damaged structures, builds silos when storage is full. */
  repairs: boolean;
  silos: boolean;
  /** Commander rules: commander powers used (unlock order), Tier 2 at this time (0 = never), Ore Processor upgrade. */
  powers: string[];
  t2At: number;
  processor: boolean;
  /** Sets factory rally points in front of the base. */
  rally: boolean;
}

const PROFILES: Record<'novice' | 'casual', Profile> = {
  novice: {
    every: 4,
    build: {
      allies: [['powr', 1], ['tent', 1], ['proc', 1], ['weap', 1], ['powr', 2], ['pbox', 1], ['dome', 1]],
      soviet: [['powr', 1], ['barr', 1], ['proc', 1], ['weap', 1], ['powr', 2], ['ftur', 1], ['dome', 1]],
    },
    dawdle: 25,
    planPower: false,
    lowPowerFor: 45,
    trucksPerRef: 2,
    maxTrucks: 2,
    truckCheck: 120,
    produceEvery: 25,
    queueDepth: 1,
    onePerLook: true,
    reserve: 300,
    inf: { allies: [['e1', 70], ['e3', 30]], soviet: [['e1', 70], ['e2', 30]] },
    veh: { allies: [['1tnk', 55], ['2tnk', 45]], soviet: [['3tnk', 100]] },
    infPerVeh: 1.5,
    firstAttack: 840,
    attackValue: 3000,
    attackGrowth: 500,
    attackEvery: 420,
    keepHome: 0,
    retreatAt: 0,
    defendDelay: 15,
    defendShare: 0.5,
    repairs: false,
    silos: false,
    powers: [],
    t2At: 0,
    processor: false,
    rally: false,
  },
  casual: {
    every: 2,
    build: {
      allies: [['powr', 1], ['tent', 1], ['proc', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['pbox', 1], ['gun', 1], ['fix', 1], ['gun', 2], ['pbox', 2]],
      soviet: [['powr', 1], ['barr', 1], ['proc', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['ftur', 1], ['tsla', 1], ['fix', 1], ['tsla', 2], ['ftur', 2]],
    },
    dawdle: 6,
    planPower: true,
    lowPowerFor: 10,
    trucksPerRef: 2,
    maxTrucks: 5,
    truckCheck: 30,
    produceEvery: 5,
    queueDepth: 2,
    onePerLook: false,
    reserve: 500,
    inf: { allies: [['e1', 45], ['e3', 45], ['medi', 10]], soviet: [['e1', 45], ['e3', 35], ['e2', 20]] },
    veh: { allies: [['2tnk', 70], ['1tnk', 15], ['arty', 15]], soviet: [['3tnk', 75], ['v2rl', 15], ['4tnk', 10]] },
    infPerVeh: 1,
    firstAttack: 480,
    attackValue: 4000,
    attackGrowth: 800,
    attackEvery: 240,
    keepHome: 0.2,
    retreatAt: 0.25,
    defendDelay: 3,
    defendShare: 1,
    repairs: true,
    silos: true,
    powers: ['funds', 'repair', 'rally', 'reinforce'],
    t2At: 600,
    processor: true,
    rally: true,
  },
};

const DEFENCES = new Set(['pbox', 'hbox', 'gun', 'ftur', 'tsla', 'agun', 'sam']);

export class StandIn {
  readonly pr: Profile;
  private rng: Rng;
  private next = 0;
  private lastPlaced = -9999;
  private lowSince = -1;
  private lastTruckCheck = -9999;
  private lastProduce = -9999;
  private lastWave = -9999;
  private waves = 0;
  private wave = new Set<number>();
  private waveSize = 0;
  private threatSince = -1;
  private lastDefend = -9999;
  /** Enemy structures this player has seen (id -> position), as the fogged map shows them. */
  private seen = new Map<number, [number, number]>();
  private rallied = new Set<number>();

  constructor(public world: World, public p: Player, public level: 'novice' | 'casual', seed: number) {
    this.pr = PROFILES[level];
    this.rng = new Rng((seed ^ Math.imul(p.id + 7, 0x2545f491)) >>> 0);
    // (attention is staggered per player, like two people at two keyboards)
    this.next = Math.round(this.rng.range(0.5, 2) * TICK_HZ);
  }

  /** Called before every world step (UI input arrives between ticks). */
  tick() {
    const w = this.world;
    if (this.p.defeated || w.tick < this.next) return;
    this.next = w.tick + Math.round(this.pr.every * TICK_HZ * this.rng.range(0.75, 1.25));
    this.look();
    this.deploy();
    this.placeReady();
    this.structures();
    this.trucks();
    this.produce();
    this.defend();
    this.attack();
    this.upkeep();
    if (w.commander) this.commander();
  }

  // ---------------------------------------------------------------------------------------------- helpers
  private mine(): Building[] {
    return this.world.buildings.filter((b) => b.alive && b.owner === this.p);
  }
  private units(): Unit[] {
    return this.world.units.filter((u) => u.alive && u.owner === this.p);
  }
  private count(t: string): number {
    let n = 0;
    for (const b of this.world.buildings) if (b.alive && b.owner === this.p && b.bt.id === t) n++;
    const q = this.p.queues.structure;
    if (q.ready === t) n++;
    for (const it of q.items) if (it.type === t) n++;
    return n;
  }
  private army(): Unit[] {
    return this.units().filter((u) => u.weapons.length && !u.ut.harvester && !u.ut.deploysInto && u.kind !== 'aircraft' && u.kind !== 'naval' && !u.transport);
  }
  private home(): [number, number] {
    const yard = this.mine().find((b) => b.bt.id === 'fact');
    if (yard) return [yard.x, yard.y];
    const s = this.world.map.startPositions[this.p.id % this.world.map.startPositions.length];
    return [s.x, s.y];
  }
  /** Where the enemy base is: the nearest seen enemy structure, else the nearest other start position. */
  private enemyHome(): [number, number] {
    const [hx, hy] = this.home();
    let best: [number, number] | null = null, bd = Infinity;
    for (const [id, pos] of this.seen) {
      const b = this.world.entities.get(id);
      if (!(b instanceof Building) || !b.alive) { this.seen.delete(id); continue; }
      const d = Math.hypot(pos[0] - hx, pos[1] - hy);
      if (d < bd) { bd = d; best = pos; }
    }
    if (best) return best;
    const starts = this.world.map.startPositions;
    let s = starts[0], sd = -1;
    for (let i = 0; i < starts.length; i++) {
      const o = this.world.players[i];
      if (!o || o === this.p || o.defeated || !this.p.isEnemy(o)) continue;
      const d = Math.hypot(starts[i].x - hx, starts[i].y - hy);
      if (sd < 0 || d < sd) { sd = d; s = starts[i]; }
    }
    return [s.x, s.y];
  }
  private look() {
    const w = this.world, m = w.map;
    for (const b of w.buildings) {
      if (!b.alive || !this.p.isEnemy(b.owner) || b.bt.wall || b.bt.mine || this.seen.has(b.id)) continue;
      const i = m.idx(Math.floor(b.x), Math.floor(b.y));
      if (!w.fog || this.p.visible[i] > 0) this.seen.set(b.id, [b.x, b.y + b.h / 2 + 0.5]);
    }
  }
  private pick(mix: [string, number][]): string | null {
    const opts = mix.filter(([t]) => this.p.canBuild(t));
    if (!opts.length) return null;
    let r = this.rng.next() * opts.reduce((s, [, x]) => s + x, 0);
    for (const [t, x] of opts) { r -= x; if (r <= 0) return t; }
    return opts[0][0];
  }

  // ---------------------------------------------------------------------------------------------- base
  private deploy() {
    if (this.p.has('fact')) return;
    const mcv = this.units().find((u) => u.ut.deploysInto);
    if (!mcv || mcv.order.type === 'deploy' || mcv.moving || mcv.path) return;
    if (this.world.canDeploy(mcv)) this.world.issue({ c: 'deploy', player: this.p.id, units: [mcv.id] });
    else this.world.issue({ c: 'move', player: this.p.id, units: [mcv.id], x: mcv.x + this.rng.range(-3, 3), y: mcv.y + this.rng.range(-3, 3) });
  }

  private placeReady() {
    const q = this.p.queues.structure;
    if (!q.ready) return;
    const spot = this.spot(q.ready);
    if (spot) {
      this.world.issue({ c: 'place', player: this.p.id, type: q.ready, cx: spot[0], cy: spot[1] });
      this.lastPlaced = this.world.tick;
    } else this.world.issue({ c: 'cancel', player: this.p.id, type: q.ready });
  }

  /** A compact spot near the yard (refineries toward the ore, defences toward the enemy). */
  private spot(type: string): [number, number] | null {
    const w = this.world, bt = BUILDINGS[type];
    const [hx, hy] = this.home();
    const [ex, ey] = this.enemyHome();
    const l = Math.hypot(ex - hx, ey - hy) || 1;
    const dx = (ex - hx) / l, dy = (ey - hy) / l;
    let cx = hx, cy = hy;
    const def = DEFENCES.has(type);
    if (def) { const side = this.rng.range(-1, 1) * 4; cx = hx + dx * 7 - dy * side; cy = hy + dy * 7 + dx * side; }
    else if (type === 'proc') {
      const ore = this.nearestOre(hx, hy);
      if (ore) { cx = (hx + ore[0]) / 2; cy = (hy + ore[1]) / 2; }
    }
    let best: [number, number] | null = null, bs = Infinity;
    const ox = Math.round(cx - bt.size[0] / 2), oy = Math.round(cy - bt.size[1] / 2);
    for (let ry = -12; ry <= 12; ry++) for (let rx = -12; rx <= 12; rx++) {
      const s = Math.hypot(rx, ry) + this.rng.next() * 0.3;
      if (s >= bs) continue;
      const px = ox + rx, py = oy + ry;
      if (!w.canPlace(this.p, type, px, py)) continue;
      if (!def && !this.margin(type, px, py)) continue;
      bs = s;
      best = [px, py];
    }
    return best;
  }
  private margin(type: string, px: number, py: number): boolean {
    const m = this.world.map, [sw, sh] = BUILDINGS[type].size;
    for (let y = py - 1; y <= py + sh; y++) for (let x = px - 1; x <= px + sw; x++) {
      if (x >= px && x < px + sw && y >= py && y < py + sh) continue;
      if (m.inBounds(x, y) && m.occupant[m.idx(x, y)]) return false;
    }
    return true;
  }
  private nearestOre(x: number, y: number): [number, number] | null {
    const m = this.world.map;
    let best: [number, number] | null = null, bd = Infinity;
    for (const i of m.oreFieldCells) {
      if (!m.ore[i]) continue;
      const cx = i % m.w, cy = (i / m.w) | 0;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = [cx + 0.5, cy + 0.5]; }
    }
    return best;
  }

  private structures() {
    const w = this.world, p = this.p, pr = this.pr, q = p.queues.structure;
    if (!p.has('fact') || q.items.length || q.ready) return;
    if (w.tick - this.lastPlaced < pr.dawdle * TICK_HZ) return;
    // power: the novice only notices once the lights go out for a while
    if (p.lowPower) { if (this.lowSince < 0) this.lowSince = w.tick; } else this.lowSince = -1;
    const goal = pr.build[p.faction].find(([t, n]) => this.count(t) < n && p.canBuild(t));
    const drain = goal ? Math.max(0, -BUILDINGS[goal[0]].power) : 0;
    const needPower = pr.planPower ? p.powerOut - p.powerUse - drain < 10 : this.lowSince >= 0 && w.tick - this.lowSince > pr.lowPowerFor * TICK_HZ;
    if (needPower) {
      const t = pr.planPower && p.canBuild('apwr') && this.count('powr') >= 2 ? 'apwr' : 'powr';
      if (p.canBuild(t)) { w.issue({ c: 'build', player: p.id, type: t }); return; }
    }
    if (pr.silos && p.storage > 0 && p.ore >= p.storage * 0.9 && p.canBuild('silo') && this.count('silo') < 3) { w.issue({ c: 'build', player: p.id, type: 'silo' }); return; }
    if (goal && p.credits >= Math.min(BUILDINGS[goal[0]].cost, 1500) * 0.6) w.issue({ c: 'build', player: p.id, type: goal[0] });
  }

  private trucks() {
    const w = this.world, p = this.p, pr = this.pr;
    if (w.tick - this.lastTruckCheck < pr.truckCheck * TICK_HZ) return;
    this.lastTruckCheck = w.tick;
    const refs = this.count('proc');
    const want = Math.min(pr.maxTrucks, Math.round(refs * pr.trucksPerRef));
    const have = this.units().filter((u) => u.ut.harvester).length + p.queues.vehicle.items.filter((i) => i.type === 'harv').length;
    if (have < want && p.canBuild('harv')) w.issue({ c: 'build', player: p.id, type: 'harv', count: Math.min(2, want - have) });
  }

  private produce() {
    const w = this.world, p = this.p, pr = this.pr;
    if (w.tick - this.lastProduce < pr.produceEvery * TICK_HZ) return;
    this.lastProduce = w.tick;
    const pending = pr.build[p.faction].some(([t, n]) => this.count(t) < n && p.canBuild(t));
    const reserve = pending ? pr.reserve + 400 : pr.reserve;
    if (p.credits < reserve) return;
    const units = this.army();
    const inf = units.filter((u) => u.kind === 'infantry').length, veh = units.filter((u) => u.kind === 'vehicle').length;
    const iq = p.queues.infantry, vq = p.queues.vehicle;
    if (vq.items.length < pr.queueDepth && p.has('weap') && (inf >= veh * pr.infPerVeh || !p.has('tent') && !p.has('barr'))) {
      const t = this.pick(pr.veh[p.faction]);
      if (t) { w.issue({ c: 'build', player: p.id, type: t }); if (pr.onePerLook) return; }
    }
    if (iq.items.length < pr.queueDepth && (inf < (veh + 1) * pr.infPerVeh + 2 || !p.has('weap'))) {
      const t = this.pick(pr.inf[p.faction]);
      if (t) w.issue({ c: 'build', player: p.id, type: t });
    }
    if (pr.rally) {
      const [hx, hy] = this.home(), [ex, ey] = this.enemyHome();
      const l = Math.hypot(ex - hx, ey - hy) || 1;
      for (const b of this.mine()) {
        if (!b.bt.factory || b.bt.factory === 'building' || b.bt.factory === 'aircraft' || b.bt.factory === 'naval' || this.rallied.has(b.id)) continue;
        this.rallied.add(b.id);
        w.issue({ c: 'rally', player: p.id, building: b.id, x: hx + ((ex - hx) / l) * 6, y: hy + ((ey - hy) / l) * 6 });
      }
    }
  }

  private upkeep() {
    const p = this.p;
    if (!this.pr.repairs || p.credits < 600) return;
    const b = this.mine().find((s) => s.active && !s.repairing && s.healthFrac < 0.6 && !s.bt.wall);
    if (b) this.world.issue({ c: 'repair', player: p.id, building: b.id });
  }

  // ---------------------------------------------------------------------------------------------- army
  private waveUnits(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.wave) {
      const u = this.world.entities.get(id);
      if (u instanceof Unit && u.alive) out.push(u); else this.wave.delete(id);
    }
    return out;
  }

  private defend() {
    const w = this.world, p = this.p, pr = this.pr;
    const [hx, hy] = this.home();
    let threat: Unit | null = null;
    for (const u of w.units) {
      if (!u.alive || !p.isEnemy(u.owner) || u.isAir || u.ut.supportPlane || u.kind === 'naval') continue;
      if (Math.hypot(u.x - hx, u.y - hy) > 13) continue;
      if (w.fog && !(p.visible[w.map.idx(Math.floor(u.x), Math.floor(u.y))] > 0)) continue;
      threat = u;
      break;
    }
    if (!threat) { this.threatSince = -1; return; }
    if (this.threatSince < 0) this.threatSince = w.tick;
    if (w.tick - this.threatSince < pr.defendDelay * TICK_HZ || w.tick - this.lastDefend < 8 * TICK_HZ) return;
    this.lastDefend = w.tick;
    const homeArmy = this.army().filter((u) => !this.wave.has(u.id) && (pr.defendShare >= 1 || u.order.type === 'idle'))
      .sort((a, b) => Math.hypot(a.x - threat!.x, a.y - threat!.y) - Math.hypot(b.x - threat!.x, b.y - threat!.y));
    const send = homeArmy.slice(0, Math.ceil(homeArmy.length * pr.defendShare)).map((u) => u.id);
    if (send.length) w.issue({ c: 'move', player: p.id, units: send, x: threat.x, y: threat.y, attackMove: true });
  }

  private attack() {
    const w = this.world, p = this.p, pr = this.pr;
    const wave = this.waveUnits();
    if (wave.length) {
      if (pr.retreatAt > 0 && wave.length <= Math.max(1, this.waveSize * pr.retreatAt)) {
        const [hx, hy] = this.home();
        w.issue({ c: 'move', player: p.id, units: wave.map((u) => u.id), x: hx, y: hy });
        this.wave.clear();
        return;
      }
      // units that got where they were sent and see nothing: on to the next structure they know of
      const idle = wave.filter((u) => u.order.type === 'idle' && !u.target);
      if (idle.length >= Math.max(1, wave.length * 0.5)) {
        const [tx, ty] = this.nextTarget(idle[0].x, idle[0].y);
        w.issue({ c: 'move', player: p.id, units: idle.map((u) => u.id), x: tx, y: ty, attackMove: true });
      }
      return;
    }
    if (w.time < pr.firstAttack || w.tick - this.lastWave < pr.attackEvery * TICK_HZ) return;
    const army = this.army().filter((u) => u.order.type === 'idle' || u.order.type === 'guard');
    const value = army.reduce((s, u) => s + u.ut.cost, 0);
    if (value < pr.attackValue + this.waves * pr.attackGrowth) return;
    // the wave: everything idle but the share that stays home (cheapest units stay)
    const sorted = army.slice().sort((a, b) => b.ut.cost - a.ut.cost || a.id - b.id);
    const send: Unit[] = [];
    let v = 0;
    for (const u of sorted) { if (v >= value * (1 - pr.keepHome)) break; send.push(u); v += u.ut.cost; }
    const [tx, ty] = this.enemyHome();
    this.wave = new Set(send.map((u) => u.id));
    this.waveSize = send.length;
    this.lastWave = w.tick;
    this.waves++;
    w.issue({ c: 'move', player: p.id, units: send.map((u) => u.id), x: tx, y: ty, attackMove: true });
  }

  private nextTarget(x: number, y: number): [number, number] {
    let best: [number, number] | null = null, bd = Infinity;
    for (const [id, pos] of this.seen) {
      const b = this.world.entities.get(id);
      if (!(b instanceof Building) || !b.alive) { this.seen.delete(id); continue; }
      const d = Math.hypot(pos[0] - x, pos[1] - y);
      if (d < bd) { bd = d; best = pos; }
    }
    if (best) return best;
    // nothing known: sweep toward the enemy start, then a random corner of the map
    const e = this.enemyHome();
    if (Math.hypot(e[0] - x, e[1] - y) > 6) return e;
    const m = this.world.map;
    return [this.rng.range(4, m.w - 4), this.rng.range(4, m.h - 4)];
  }

  // ---------------------------------------------------------------------------------------------- Commander rules
  private commander() {
    const w = this.world, p = this.p, pr = this.pr, c = p.cmd;
    if (w.econ && p.econ) {
      const yard = this.mine().find((b) => b.bt.id === 'fact' && b.active && !b.task);
      if (pr.t2At && p.econ.tier < 2 && w.time >= pr.t2At && yard && p.credits >= 1600) w.issue({ c: 'upgrade', player: p.id, building: yard.id, upgrade: 'cy_t2' });
      if (pr.processor && p.econ.tier >= 2 && p.credits >= 1500) {
        const ref = this.mine().find((b) => b.bt.id === 'proc' && b.active && !b.task && !b.upgrades?.includes('proc_processor'));
        if (ref) w.issue({ c: 'upgrade', player: p.id, building: ref.id, upgrade: 'proc_processor' });
      }
    }
    if (!c || !pr.powers.length) return;
    // unlock the next power on the list once the points and the tier allow
    const want = pr.powers.find((id) => !c.unlocked.includes(id) && POWERS[id as keyof typeof POWERS]?.factions.includes(p.faction));
    if (want) {
      const d = POWERS[want as keyof typeof POWERS];
      if (tierOpen(c, d.tier) && c.points + 1e-9 >= TIER_COST[d.tier]) w.issue({ c: 'unlockPower', player: p.id, power: want });
    }
    const ready = (id: string) => c.unlocked.includes(id) && powerReady(w, c, id);
    if (ready('funds') && p.credits < 800) { w.issue({ c: 'commanderPower', player: p.id, power: 'funds' }); return; }
    const underAttack = this.threatSince >= 0;
    const [hx, hy] = this.home();
    if (ready('reinforce')) {
      const wave = this.waveUnits();
      if (underAttack) { w.issue({ c: 'commanderPower', player: p.id, power: 'reinforce', x: hx, y: hy }); return; }
      if (wave.length >= 4) {
        const cx = wave.reduce((s, u) => s + u.x, 0) / wave.length, cy = wave.reduce((s, u) => s + u.y, 0) / wave.length;
        w.issue({ c: 'commanderPower', player: p.id, power: 'reinforce', x: cx, y: cy });
        return;
      }
    }
    if (ready('repair')) {
      const hurt = this.army().filter((u) => u.healthFrac < 0.6 && Math.hypot(u.x - hx, u.y - hy) < 14);
      if (hurt.length >= 4) { w.issue({ c: 'commanderPower', player: p.id, power: 'repair', x: hurt[0].x, y: hurt[0].y }); return; }
    }
    if (ready('rally')) {
      const wave = this.waveUnits();
      const fighting = wave.filter((u) => u.target);
      if (fighting.length >= 5) w.issue({ c: 'commanderPower', player: p.id, power: 'rally', x: fighting[0].x, y: fighting[0].y });
    }
  }
}

/** Unit ids a stand-in level builds (for reports). */
export function standInUnits(level: 'novice' | 'casual', faction: Faction): string[] {
  const pr = PROFILES[level];
  return [...pr.inf[faction], ...pr.veh[faction]].map(([t]) => t).filter((t) => UNITS[t]);
}
