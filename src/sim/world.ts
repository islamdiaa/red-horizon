import { BUILDINGS, REFUND_PERCENT, UNITS, getType, isBuildingType, type BuildingTypeDef, type Faction } from '../data/rules';
import type { AnnouncerKey, SfxKey } from '../audio/types';
import { Rng } from '../core/rng';
import { Building, Entity, Unit } from './entities';
import { GameMap, ORE_MAX } from './map';
import { PathFinder } from './pathfinding';
import { Player, queueKindOf } from './player';
import { DT, TICK_HZ, type Command, type GameEvent, type Order } from './types';
import { updateBuildingWeapons, updateProjectiles, updateUnitWeapons, type Projectile } from './combat';
import { resolveCollisions, unitSpeed, updateUnit } from './unitlogic';
import { updateProduction, recalcPlayerEconomy } from './production';
import { AIController, type AIDifficulty } from './ai';
import { updateSuperweapons, fireSuperweapon } from './superweapons';

export interface PlayerSetup {
  name: string;
  faction: Faction;
  color: number;
  team: number;
  isHuman: boolean;
  ai?: AIDifficulty;
}

export interface WorldOptions {
  map: GameMap;
  players: PlayerSetup[];
  credits: number;
  startUnits: 'mcv' | 'light' | 'heavy';
  fog: boolean;
  seed: number;
}

/** Spatial hash of units per map cell (rebuilt every tick). */
class UnitGrid {
  head: Int32Array;
  next: Int32Array = new Int32Array(1024);
  list: Unit[] = [];
  constructor(private w: number, private h: number) {
    this.head = new Int32Array(w * h).fill(-1);
  }
  rebuild(units: Unit[]) {
    this.head.fill(-1);
    if (this.next.length < units.length) this.next = new Int32Array(units.length * 2);
    this.list = units;
    for (let k = 0; k < units.length; k++) {
      const u = units[k];
      if (!u.alive) continue;
      const cx = Math.min(this.w - 1, Math.max(0, Math.floor(u.x)));
      const cy = Math.min(this.h - 1, Math.max(0, Math.floor(u.y)));
      const c = cy * this.w + cx;
      this.next[k] = this.head[c];
      this.head[c] = k;
    }
  }
  /** Calls fn for each unit whose cell intersects the circle. */
  query(x: number, y: number, r: number, fn: (u: Unit) => void) {
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(this.w - 1, Math.floor(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(this.h - 1, Math.floor(y + r));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let k = this.head[cy * this.w + cx]; k !== -1; k = this.next[k]) fn(this.list[k]);
      }
    }
  }
}

const circleCache = new Map<number, Int16Array>();
function circleOffsets(r: number): Int16Array {
  const key = Math.round(r * 4);
  let c = circleCache.get(key);
  if (c) return c;
  const pts: number[] = [];
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r + 0.5) pts.push(dx, dy);
  c = new Int16Array(pts);
  circleCache.set(key, c);
  return c;
}

export class World {
  map: GameMap;
  pathfinder: PathFinder;
  rng: Rng;
  tick = 0;
  players: Player[] = [];
  entities = new Map<number, Entity>();
  units: Unit[] = [];
  buildings: Building[] = [];
  projectiles: Projectile[] = [];
  events: GameEvent[] = [];
  grid: UnitGrid;
  ais: AIController[] = [];
  fog: boolean;
  gameOver = false;
  winnerTeam = -1;
  private nextId = 1;
  private commands: Command[] = [];
  private pathQueue: Unit[] = [];
  private dirtyLists = false;

  constructor(opts: WorldOptions) {
    this.map = opts.map;
    this.rng = new Rng(opts.seed ^ 0x5bd1e995);
    this.pathfinder = new PathFinder(this.map);
    this.grid = new UnitGrid(this.map.w, this.map.h);
    this.fog = opts.fog;
    const cells = this.map.w * this.map.h;
    opts.players.forEach((ps, i) => {
      const p = new Player({ id: i, name: ps.name, faction: ps.faction, color: ps.color, team: ps.team, isHuman: ps.isHuman, cash: opts.credits, mapCells: cells });
      this.players.push(p);
      if (ps.ai) this.ais.push(new AIController(this, p, ps.ai));
    });
    this.setupStart(opts.startUnits);
    for (const p of this.players) {
      recalcPlayerEconomy(this, p);
      this.updateVisibility(p);
      for (const o of p.buildOptions()) p.knownOptions.add(o);
    }
  }

  get time(): number {
    return this.tick * DT;
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  private setupStart(kind: WorldOptions['startUnits']) {
    const starts = this.map.startPositions;
    this.players.forEach((p, i) => {
      const s = starts[i % starts.length];
      const toward = Math.atan2(this.map.h / 2 - s.y, this.map.w / 2 - s.x);
      const mcv = this.addUnit('mcv', p, s.x, s.y);
      mcv.heading = mcv.prevHeading = toward;
      const extras: string[] = [];
      if (kind !== 'mcv') {
        const tank = p.faction === 'allies' ? '2tnk' : '3tnk';
        extras.push('e1', 'e1', 'e1', 'e3', tank);
        if (kind === 'heavy') extras.push('e1', 'e1', 'e3', tank, p.faction === 'allies' ? '1tnk' : '3tnk', p.faction === 'allies' ? 'jeep' : 'v2rl');
      }
      extras.forEach((id, k) => {
        const a = toward + (k - extras.length / 2) * 0.45;
        const r = UNITS[id].kind === 'infantry' ? 2.4 : 3.2;
        const pos = this.findFreeSpot(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, 4);
        const u = this.addUnit(id, p, pos[0], pos[1]);
        u.heading = u.prevHeading = u.turret = u.prevTurret = toward;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Entity management
  // ---------------------------------------------------------------------------
  getEntity(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  addUnit(typeId: string, owner: Player, x: number, y: number): Unit {
    const u = new Unit(this.nextId++, UNITS[typeId], owner, x, y);
    this.entities.set(u.id, u);
    this.units.push(u);
    if (u.ut.harvester) {
      u.order = { type: 'harvest' };
      u.hstate = 'seek';
    }
    return u;
  }

  addBuilding(typeId: string, owner: Player, cx: number, cy: number, instant = false): Building {
    const bt = BUILDINGS[typeId];
    const b = new Building(this.nextId++, bt, owner, cx, cy);
    if (instant) b.buildAnim = 1;
    this.entities.set(b.id, b);
    this.buildings.push(b);
    this.stampBuilding(b, true);
    // first factory of a kind becomes primary
    if (bt.factory && bt.factory !== 'building') {
      b.primary = !this.buildings.some((o) => o !== b && o.alive && o.owner === owner && o.bt.factory === bt.factory && o.primary);
    }
    owner.owned.set(typeId, (owner.owned.get(typeId) ?? 0) + 1);
    recalcPlayerEconomy(this, owner);
    return b;
  }

  private stampBuilding(b: Building, on: boolean) {
    const m = this.map;
    for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) {
      const x = b.cx + dx, y = b.cy + dy;
      if (!m.inBounds(x, y)) continue;
      const i = m.idx(x, y);
      m.occupant[i] = on ? b.id : 0;
      m.passableOverride[i] = 0;
    }
    if (on && b.bt.passable) for (const [px, py] of b.bt.passable) m.passableOverride[m.idx(b.cx + px, b.cy + py)] = 1;
    const reserve = (c: [number, number] | null) => {
      if (!c || !m.inBounds(c[0], c[1])) return;
      const i = m.idx(c[0], c[1]);
      m.reserved[i] = on ? Math.min(255, m.reserved[i] + 1) : Math.max(0, m.reserved[i] - 1);
    };
    reserve(b.dockCell());
    if (b.bt.factory && b.bt.factory !== 'building') reserve(b.exitCell());
  }

  /** Remove a building's footprint (death / sale / capture handled elsewhere). */
  private unstamp(b: Building) {
    this.stampBuilding(b, false);
    const n = (b.owner.owned.get(b.bt.id) ?? 1) - 1;
    b.owner.owned.set(b.bt.id, Math.max(0, n));
  }

  /** Kill an entity. `how` drives death visuals. */
  kill(e: Entity, how: 'normal' | 'blown' | 'burn' | 'electro' | 'bite' | 'crushed' | 'sold' = 'normal', killer?: Entity) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    this.dirtyLists = true;
    this.events.push({ e: 'death', id: e.id, x: e.x, y: e.y, how });
    const owner = e.owner;
    if (killer && killer.owner !== owner && how !== 'sold') {
      killer.kills++;
      if (e.kind === 'building') killer.owner.stats.buildingsKilled++;
      else killer.owner.stats.unitsKilled++;
    }
    if (e instanceof Building) {
      this.unstamp(e);
      if (how !== 'sold') {
        owner.stats.buildingsLost++;
        this.announce(owner, 'structure_lost', 3);
        this.spawnSurvivors(e, 0.5);
      }
      // release docked harvester
      if (e.dockOccupant) {
        const h = this.entities.get(e.dockOccupant) as Unit | undefined;
        if (h && h.alive) h.hstate = 'toRefinery';
      }
      recalcPlayerEconomy(this, owner);
    } else if (e instanceof Unit) {
      owner.stats.unitsLost++;
      if (how !== 'sold') this.announce(owner, 'unit_lost', 6);
      if (e.dockAt) {
        const r = this.entities.get(e.dockAt) as Building | undefined;
        if (r && r.dockOccupant === e.id) r.dockOccupant = 0;
      }
      // APC passengers die with it
      for (const p of e.passengers) { p.alive = false; }
    }
  }

  spawnSurvivors(b: Building, chance: number) {
    const n = Math.min(3, Math.floor(b.bt.cost / 700));
    for (let k = 0; k < n; k++) {
      if (!this.rng.chance(chance)) continue;
      const [x, y] = this.findFreeSpot(b.x + this.rng.range(-1, 1), b.y + b.h / 2 + 0.6, 3);
      const u = this.addUnit('e1', b.owner, x, y);
      u.heading = Math.PI / 2;
    }
  }

  private cleanupDead() {
    if (!this.dirtyLists) return;
    this.dirtyLists = false;
    this.units = this.units.filter((u) => {
      if (!u.alive) { this.entities.delete(u.id); return false; }
      return true;
    });
    this.buildings = this.buildings.filter((b) => {
      if (!b.alive) { this.entities.delete(b.id); return false; }
      return true;
    });
  }

  /** Nearest passable spot around (x, y) not crowded by units. */
  findFreeSpot(x: number, y: number, maxR: number, forVehicle = true): [number, number] {
    const m = this.map;
    const fx = Math.floor(x), fy = Math.floor(y);
    for (let r = 0; r <= maxR; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = fx + dx, cy = fy + dy;
        if (!m.passable(cx, cy)) continue;
        let crowd = 0;
        this.grid.query(cx + 0.5, cy + 0.5, 0.6, (u) => { if (u.alive && Math.floor(u.x) === cx && Math.floor(u.y) === cy) crowd++; });
        if (crowd > (forVehicle ? 0 : 2)) continue;
        const d = (cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2;
        if (d < bestD) { bestD = d; best = [cx + 0.5, cy + 0.5]; }
      }
      if (best) return best;
    }
    return [x, y];
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------
  issue(cmd: Command) {
    this.commands.push(cmd);
  }

  private ownedUnits(player: number, ids: number[]): Unit[] {
    const out: Unit[] = [];
    for (const id of ids) {
      const e = this.entities.get(id);
      if (e && e.alive && e instanceof Unit && e.owner.id === player) out.push(e);
    }
    return out;
  }

  private processCommand(cmd: Command) {
    const p = this.players[cmd.player];
    if (!p || p.defeated) return;
    switch (cmd.c) {
      case 'move': {
        const units = this.ownedUnits(cmd.player, cmd.units);
        if (!units.length) return;
        const dests = this.formation(units, cmd.x, cmd.y);
        // mixed groups travel together at the pace of their slowest member
        const ground = units.filter((u) => u.kind !== 'aircraft');
        const cap = ground.length > 1 ? Math.min(...ground.map((u) => unitSpeed(u))) * 1.05 : 0;
        units.forEach((u, k) => {
          const o: Order = { type: 'move', x: dests[k][0], y: dests[k][1], attackMove: !!cmd.attackMove };
          this.giveOrder(u, o, !!cmd.queue);
          if (!cmd.queue && u.kind !== 'aircraft') u.speedCap = cap;
        });
        break;
      }
      case 'attack': {
        const target = this.entities.get(cmd.target);
        if (!target || !target.alive) return;
        for (const u of this.ownedUnits(cmd.player, cmd.units)) {
          if (u.ut.engineer && target.kind === 'building') { this.giveOrder(u, { type: 'enter', target: target.id }); continue; }
          if (u.ut.c4 && target.kind === 'building' && p.isEnemy(target.owner)) { this.giveOrder(u, { type: 'enter', target: target.id }); continue; }
          if (!u.weapons.length) continue;
          this.giveOrder(u, { type: 'attack', target: target.id, forced: !!cmd.forced });
        }
        break;
      }
      case 'attackGround': {
        for (const u of this.ownedUnits(cmd.player, cmd.units)) {
          if (!u.weapons.length || u.ut.dog || u.ut.medic) continue;
          this.giveOrder(u, { type: 'attackGround', x: cmd.x, y: cmd.y });
        }
        break;
      }
      case 'stop':
        for (const u of this.ownedUnits(cmd.player, cmd.units)) {
          u.orderQueue.length = 0;
          this.setOrder(u, { type: 'idle' });
          u.guardX = u.x;
          u.guardY = u.y;
        }
        break;
      case 'scatter':
        for (const u of this.ownedUnits(cmd.player, cmd.units)) {
          const a = this.rng.range(0, Math.PI * 2);
          const [x, y] = this.findFreeSpot(u.x + Math.cos(a) * 2, u.y + Math.sin(a) * 2, 2, u.kind !== 'infantry');
          this.setOrder(u, { type: 'move', x, y, attackMove: false });
        }
        break;
      case 'deploy':
        for (const u of this.ownedUnits(cmd.player, cmd.units)) {
          if (u.ut.deploysInto || u.kind === 'aircraft') this.setOrder(u, { type: 'deploy' });
        }
        break;
      case 'harvest':
        for (const u of this.ownedUnits(cmd.player, cmd.units)) {
          if (!u.ut.harvester) continue;
          u.lastOreX = Math.floor(cmd.x);
          u.lastOreY = Math.floor(cmd.y);
          u.hstate = 'seek';
          this.setOrder(u, { type: 'harvest', x: cmd.x, y: cmd.y });
        }
        break;
      case 'enter': {
        const target = this.entities.get(cmd.target);
        if (!target || !target.alive) return;
        for (const u of this.ownedUnits(cmd.player, cmd.units)) {
          if (u.ut.harvester && target instanceof Building && target.bt.dock && target.owner === p) {
            u.hstate = 'toRefinery';
            u.dockAt = target.id;
            this.setOrder(u, { type: 'harvest' });
            continue;
          }
          this.giveOrder(u, { type: 'enter', target: target.id });
        }
        break;
      }
      case 'build': {
        if (!p.canBuild(cmd.type)) return;
        const t = getType(cmd.type);
        const q = p.queues[queueKindOf(t)];
        const count = cmd.count ?? 1;
        if (q.kind === 'structure') {
          if (q.items.length || q.ready) {
            // clicking the same paused item resumes it
            const it = q.items[0];
            if (it && it.type === cmd.type && it.paused) it.paused = false;
            return;
          }
          q.items.push({ type: cmd.type, progress: 0, paid: 0, paused: false });
          this.announce(p, 'building', 0);
        } else {
          for (let k = 0; k < count && q.items.length < 25; k++) {
            q.items.push({ type: cmd.type, progress: 0, paid: 0, paused: false });
          }
          const first = q.items.find((it) => it.type === cmd.type);
          if (first?.paused) first.paused = false;
          this.announce(p, 'training', 0);
        }
        break;
      }
      case 'pause': {
        const t = getType(cmd.type);
        const q = p.queues[queueKindOf(t)];
        const it = q.items.find((i) => i.type === cmd.type);
        if (it && q.items[0] === it) {
          it.paused = !it.paused;
          if (it.paused) this.announce(p, 'on_hold', 0);
        }
        break;
      }
      case 'cancel': {
        const t = getType(cmd.type);
        const q = p.queues[queueKindOf(t)];
        if (q.ready === cmd.type) {
          q.ready = null;
          p.refund(t.cost);
          this.announce(p, 'cancelled', 0);
          return;
        }
        // remove the last queued item of this type (refund what was paid)
        for (let k = q.items.length - 1; k >= 0; k--) {
          if (q.items[k].type === cmd.type) {
            p.refund(q.items[k].paid);
            q.items.splice(k, 1);
            this.announce(p, 'cancelled', 0);
            if (!cmd.all) break;
          }
        }
        break;
      }
      case 'place': {
        const q = p.queues.structure;
        if (q.ready !== cmd.type) return;
        if (!this.canPlace(p, cmd.type, cmd.cx, cmd.cy)) {
          this.announce(p, 'cannot_build_here', 1);
          return;
        }
        q.ready = null;
        const b = this.addBuilding(cmd.type, p, cmd.cx, cmd.cy);
        p.stats.buildingsBuilt++;
        this.events.push({ e: 'placed', id: b.id });
        this.clearFootprintUnits(b);
        break;
      }
      case 'sell': {
        const b = this.entities.get(cmd.building);
        if (!(b instanceof Building) || b.owner !== p || !b.active) return;
        b.selling = 0.9;
        this.events.push({ e: 'sfx', key: 'sell', x: b.x, y: b.y });
        this.announce(p, 'structure_sold', 0);
        break;
      }
      case 'repair': {
        const b = this.entities.get(cmd.building);
        if (!(b instanceof Building) || b.owner !== p || !b.active) return;
        if (b.hp >= b.maxHp) { b.repairing = false; return; }
        b.repairing = !b.repairing;
        if (b.repairing) this.announce(p, 'repairing', 0);
        break;
      }
      case 'rally': {
        const b = this.entities.get(cmd.building);
        if (!(b instanceof Building) || b.owner !== p || !b.bt.factory) return;
        b.rallyX = cmd.x;
        b.rallyY = cmd.y;
        break;
      }
      case 'primary': {
        const b = this.entities.get(cmd.building);
        if (!(b instanceof Building) || b.owner !== p || !b.bt.factory) return;
        for (const o of this.buildings) if (o.owner === p && o.bt.factory === b.bt.factory) o.primary = false;
        b.primary = true;
        this.announce(p, 'primary_selected', 0);
        break;
      }
      case 'superweapon':
        fireSuperweapon(this, p, cmd.kind, cmd.x, cmd.y, cmd.unit);
        break;
    }
  }

  /** Set (or queue with shift) an order. */
  giveOrder(u: Unit, o: Order, queue = false) {
    if (queue && (u.order.type !== 'idle' || u.orderQueue.length)) {
      u.orderQueue.push(o);
      return;
    }
    u.orderQueue.length = 0;
    this.setOrder(u, o);
  }

  setOrder(u: Unit, o: Order) {
    u.order = o;
    u.speedCap = 0;
    u.path = null;
    u.hasGoal = false;
    u.pathPending = false;
    u.chasing = false;
    u.stuckCount = 0;
    if (o.type !== 'attack') u.target = null;
    u.hasGroundTarget = false;
    if (u.ut.harvester && o.type !== 'harvest') {
      u.hstate = 'idle';
      this.releaseDock(u);
    }
    if (o.type === 'move') { u.guardX = o.x; u.guardY = o.y; }
  }

  releaseDock(u: Unit) {
    if (!u.dockAt) return;
    const r = this.entities.get(u.dockAt) as Building | undefined;
    if (r && r.dockOccupant === u.id) r.dockOccupant = 0;
    if (u.hstate !== 'toRefinery') u.dockAt = 0;
  }

  /** Destination slots for a group move. Keeps relative formation for tight groups. */
  formation(units: Unit[], x: number, y: number): [number, number][] {
    if (units.length === 1) return [[x, y]];
    let cx = 0, cy = 0;
    for (const u of units) { cx += u.x; cy += u.y; }
    cx /= units.length; cy /= units.length;
    let maxR = 0;
    for (const u of units) maxR = Math.max(maxR, Math.hypot(u.x - cx, u.y - cy));
    const tight = maxR < 2.5 + Math.sqrt(units.length) * 0.7;
    const taken = new Set<number>();
    const m = this.map;
    const slotKey = (sx: number, sy: number) => Math.floor(sx * 2) + Math.floor(sy * 2) * (m.w * 2 + 7);
    const claim = (px: number, py: number, inf: boolean): [number, number] => {
      // search outward for a free (sub)cell
      const step = inf ? 0.5 : 1;
      for (let r = 0; r < 12; r++) {
        let best: [number, number] | null = null, bestD = Infinity;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const sx = inf ? (Math.floor(px * 2) + dx) / 2 + 0.25 : Math.floor(px) + dx * step + 0.5;
          const sy = inf ? (Math.floor(py * 2) + dy) / 2 + 0.25 : Math.floor(py) + dy * step + 0.5;
          if (!m.passable(Math.floor(sx), Math.floor(sy))) continue;
          const key = inf ? slotKey(sx, sy) : -(Math.floor(sy) * m.w + Math.floor(sx)) - 1;
          // a vehicle slot occupies all 4 sub-slots of its cell
          if (taken.has(key)) continue;
          if (inf && taken.has(-(Math.floor(sy) * m.w + Math.floor(sx)) - 1)) continue;
          const d = (sx - px) ** 2 + (sy - py) ** 2;
          if (d < bestD) { bestD = d; best = [sx, sy]; }
        }
        if (best) {
          if (inf) {
            taken.add(slotKey(best[0], best[1]));
          } else {
            const ccx = Math.floor(best[0]), ccy = Math.floor(best[1]);
            taken.add(-(ccy * m.w + ccx) - 1);
            for (const ox of [0.25, 0.75]) for (const oy of [0.25, 0.75]) taken.add(slotKey(ccx + ox, ccy + oy));
          }
          return best;
        }
      }
      return [px, py];
    };
    // vehicles first (they need whole cells), closest to the target first
    const order = units.map((u, k) => k).sort((a, b) => {
      const ua = units[a], ub = units[b];
      if ((ua.kind === 'infantry') !== (ub.kind === 'infantry')) return ua.kind === 'infantry' ? 1 : -1;
      return Math.hypot(ua.x - x, ua.y - y) - Math.hypot(ub.x - x, ub.y - y);
    });
    const out: [number, number][] = new Array(units.length);
    const scale = tight ? 0.85 : 0;
    for (const k of order) {
      const u = units[k];
      const px = x + (u.x - cx) * scale, py = y + (u.y - cy) * scale;
      out[k] = claim(px, py, u.kind === 'infantry');
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------
  canPlace(p: Player, typeId: string, cx: number, cy: number): boolean {
    const bt = BUILDINGS[typeId];
    if (!bt) return false;
    const m = this.map;
    for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) {
      if (!m.buildable(cx + dx, cy + dy)) return false;
    }
    // enemy units block placement
    let blocked = false;
    this.grid.query(cx + bt.size[0] / 2, cy + bt.size[1] / 2, Math.max(bt.size[0], bt.size[1]), (u) => {
      if (!u.alive || u.owner === p || u.isAir) return;
      if (u.x >= cx && u.x < cx + bt.size[0] && u.y >= cy && u.y < cy + bt.size[1]) blocked = true;
    });
    if (blocked) return false;
    // dock / exit must be usable
    const need: [number, number][] = [];
    if (bt.dock) need.push([cx + bt.dock[0], cy + bt.dock[1]]);
    if (bt.factory && bt.factory !== 'building') {
      const e = bt.exit ?? [Math.floor(bt.size[0] / 2), bt.size[1]];
      need.push([cx + e[0], cy + e[1]]);
    }
    for (const [x, y] of need) if (!m.inBounds(x, y) || !m.passable(x, y)) return false;
    return this.isAdjacentToBase(p, bt, cx, cy);
  }

  isAdjacentToBase(p: Player, bt: BuildingTypeDef, cx: number, cy: number, gap = 2): boolean {
    for (const b of this.buildings) {
      if (!b.alive || b.owner !== p) continue;
      const gx = Math.max(b.cx - (cx + bt.size[0]), cx - (b.cx + b.w), 0);
      const gy = Math.max(b.cy - (cy + bt.size[1]), cy - (b.cy + b.h), 0);
      if (Math.max(gx, gy) <= gap) return true;
    }
    return false;
  }

  /** Push own units off a freshly placed footprint. */
  private clearFootprintUnits(b: Building) {
    for (const u of this.units) {
      if (!u.alive || u.isAir) continue;
      if (u.x >= b.cx && u.x < b.cx + b.w && u.y >= b.cy && u.y < b.cy + b.h) {
        const [x, y] = this.findFreeSpot(b.x, b.cy + b.h + 0.5, 6, u.kind !== 'infantry');
        u.x = u.prevX = x;
        u.y = u.prevY = y;
        this.setOrder(u, { type: 'idle' });
      }
    }
  }

  /** Construction Yard footprint top-left for an MCV deploying at (x, y). */
  deployCell(u: Unit): [number, number] {
    const bt = BUILDINGS[u.ut.deploysInto!];
    return [Math.round(u.x - bt.size[0] / 2), Math.round(u.y - bt.size[1] / 2)];
  }

  canDeploy(u: Unit): boolean {
    if (!u.ut.deploysInto) return false;
    const bt = BUILDINGS[u.ut.deploysInto];
    const [cx, cy] = this.deployCell(u);
    for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) {
      if (!this.map.buildable(cx + dx, cy + dy)) return false;
    }
    let blocked = false;
    this.grid.query(u.x, u.y, 2.5, (o) => {
      if (o === u || !o.alive || o.isAir) return;
      if (o.x >= cx && o.x < cx + bt.size[0] && o.y >= cy && o.y < cy + bt.size[1] && o.owner !== u.owner) blocked = true;
    });
    return !blocked;
  }

  deploy(u: Unit): boolean {
    if (!this.canDeploy(u)) return false;
    const [cx, cy] = this.deployCell(u);
    const p = u.owner;
    u.alive = false;
    this.dirtyLists = true;
    this.events.push({ e: 'death', id: u.id, x: u.x, y: u.y, how: 'sold' });
    const b = this.addBuilding(u.ut.deploysInto!, p, cx, cy);
    b.hp = Math.round(b.maxHp * u.healthFrac);
    this.events.push({ e: 'placed', id: b.id });
    this.events.push({ e: 'sfx', key: 'deploy', x: b.x, y: b.y });
    this.clearFootprintUnits(b);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Paths
  // ---------------------------------------------------------------------------
  requestPath(u: Unit, x: number, y: number) {
    u.goalX = x;
    u.goalY = y;
    u.hasGoal = true;
    if (!u.pathPending) {
      u.pathPending = true;
      this.pathQueue.push(u);
    }
  }

  private processPaths() {
    let budget = 40000;
    let n = 0;
    while (this.pathQueue.length && budget > 0 && n < 24) {
      const u = this.pathQueue.shift()!;
      if (!u.alive || !u.pathPending) continue;
      u.pathPending = false;
      n++;
      const path = this.pathfinder.find(Math.floor(u.x), Math.floor(u.y), Math.floor(u.goalX), Math.floor(u.goalY), 9000, u.exitBuilding);
      budget -= this.pathfinder.expandedLastSearch + 50;
      if (path && path.length) {
        const last = path[path.length - 1];
        if (Math.floor(last.x) === Math.floor(u.goalX) && Math.floor(last.y) === Math.floor(u.goalY)) {
          last.x = u.goalX;
          last.y = u.goalY;
        }
        u.path = path;
        u.pathIdx = 0;
        u.progressTimer = 0;
        u.progressDist = Math.hypot(u.goalX - u.x, u.goalY - u.y);
      } else {
        u.path = null;
        u.hasGoal = false;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Visibility
  // ---------------------------------------------------------------------------
  updateVisibility(p: Player) {
    const m = this.map;
    const vis = p.visible;
    vis.fill(0);
    if (!this.fog) {
      vis.fill(1);
      p.explored.fill(1);
      return;
    }
    const stamp = (x: number, y: number, r: number) => {
      const offs = circleOffsets(r);
      const fx = Math.floor(x), fy = Math.floor(y);
      for (let k = 0; k < offs.length; k += 2) {
        const cx = fx + offs[k], cy = fy + offs[k + 1];
        if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) continue;
        const i = cy * m.w + cx;
        vis[i] = 1;
        p.explored[i] = 1;
      }
    };
    for (const u of this.units) if (u.alive && u.owner.team === p.team) stamp(u.x, u.y, u.ut.sight + 0.5);
    for (const b of this.buildings) if (b.alive && b.owner.team === p.team) stamp(b.x, b.y, b.bt.sight + Math.max(b.w, b.h) / 2);
  }

  isVisible(p: Player, x: number, y: number): boolean {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (!this.map.inBounds(cx, cy)) return false;
    return p.visible[cy * this.map.w + cx] > 0;
  }

  /** Whether entity e is visible to player p. */
  canSee(p: Player, e: Entity): boolean {
    if (e.owner.team === p.team) return true;
    if (e instanceof Building) {
      for (let dy = 0; dy < e.h; dy++) for (let dx = 0; dx < e.w; dx++) {
        if (p.visible[(e.cy + dy) * this.map.w + e.cx + dx]) return true;
      }
      return false;
    }
    return this.isVisible(p, e.x, e.y);
  }

  // ---------------------------------------------------------------------------
  // Announcements
  // ---------------------------------------------------------------------------
  announce(p: Player, key: AnnouncerKey, throttleSec = 4) {
    const last = p.lastAnnounce.get(key) ?? -1e9;
    if ((this.tick - last) * DT < throttleSec) return;
    p.lastAnnounce.set(key, this.tick);
    this.events.push({ e: 'announce', player: p.id, key });
  }

  sfx(key: SfxKey, x: number, y: number) {
    this.events.push({ e: 'sfx', key, x, y });
  }

  // ---------------------------------------------------------------------------
  // Main tick
  // ---------------------------------------------------------------------------
  step() {
    this.tick++;
    for (const c of this.commands.splice(0)) this.processCommand(c);

    for (const u of this.units) { u.prevX = u.x; u.prevY = u.y; u.prevHeading = u.heading; u.prevTurret = u.turret; }
    for (const b of this.buildings) b.prevTurret = b.turret;

    this.grid.rebuild(this.units);

    for (const p of this.players) {
      if (p.defeated) continue;
      updateProduction(this, p);
      updateSuperweapons(this, p);
    }
    for (const b of this.buildings) if (b.alive) this.updateBuilding(b);
    this.processPaths();
    for (const u of this.units) {
      if (!u.alive) continue;
      updateUnit(this, u);
      if (u.alive) updateUnitWeapons(this, u);
    }
    resolveCollisions(this);
    updateProjectiles(this);
    this.cleanupDead();

    if (this.tick % 4 === 0) for (const p of this.players) this.updateVisibility(p);
    if (this.tick % 10 === 0) for (const p of this.players) recalcPlayerEconomy(this, p);
    if (this.tick % (TICK_HZ * 2) === 0) this.growOre();
    for (let k = 0; k < this.ais.length; k++) {
      if ((this.tick + k * 3) % 10 === 0) this.ais[k].think();
    }
    if (this.tick % TICK_HZ === 0) this.checkVictory();
  }

  private updateBuilding(b: Building) {
    if (b.buildAnim < 1) {
      b.buildAnim = Math.min(1, b.buildAnim + DT / 1.1);
      if (b.buildAnim >= 1) this.onBuildingComplete(b);
      return;
    }
    if (b.invulnerable > 0) b.invulnerable = Math.max(0, b.invulnerable - DT);
    if (b.selling >= 0) {
      b.selling -= DT;
      if (b.selling < 0) {
        const refund = Math.floor(b.bt.cost * REFUND_PERCENT * b.healthFrac);
        b.owner.refund(refund);
        b.owner.stats.spent += refund; // refund is not "negative spending" for stats
        this.spawnSurvivors(b, 1);
        this.kill(b, 'sold');
      }
      return;
    }
    // repair
    if (b.repairing) {
      b.repairTimer -= DT;
      if (b.repairTimer <= 0) {
        b.repairTimer = 0.3;
        const step = Math.max(1, Math.round(b.maxHp * 0.025));
        const cost = (b.bt.cost * 0.2 * step) / b.maxHp;
        if (b.hp >= b.maxHp) b.repairing = false;
        else if (b.owner.spend(cost)) {
          b.hp = Math.min(b.maxHp, b.hp + step);
          if (b.hp >= b.maxHp) b.repairing = false;
        } else {
          b.repairing = false;
          this.announce(b.owner, 'insufficient_funds', 6);
        }
      }
    }
    b.powered = !b.owner.lowPower || !b.bt.requiresPower;
    // doors
    if (b.doorHold > 0) { b.doorHold -= DT; b.door = Math.min(1, b.door + DT * 2.2); }
    else b.door = Math.max(0, b.door - DT * 1.4);
    b.load = Math.max(0, b.load - DT * 0.8);
    // service depot repairs vehicles on its pad
    if (b.bt.repairPad && this.tick % 10 === 0) {
      this.grid.query(b.x, b.y, 1.2, (u) => {
        if (!u.alive || u.owner !== b.owner || u.kind !== 'vehicle' || u.moving) return;
        if (Math.hypot(u.x - b.x, u.y - b.y) > 0.8 || u.hp >= u.maxHp) return;
        const step = Math.max(1, Math.round(u.maxHp * 0.06));
        const cost = (u.ut.cost * 0.2 * step) / u.maxHp;
        if (b.owner.spend(cost)) {
          u.hp = Math.min(u.maxHp, u.hp + step);
          this.sfx('repair', u.x, u.y);
        }
      });
    }
    updateBuildingWeapons(this, b);
  }

  private onBuildingComplete(b: Building) {
    const p = b.owner;
    this.events.push({ e: 'sfx', key: 'build_place', x: b.x, y: b.y });
    if (b.bt.freeUnit) {
      const fu = UNITS[b.bt.freeUnit];
      if (fu) {
        const dock = b.dockCell();
        const [x, y] = dock ? [dock[0] + 0.5, dock[1] + 0.5] : this.findFreeSpot(b.x, b.cy + b.h + 0.5, 4);
        const u = this.addUnit(fu.id, p, x, y);
        u.heading = u.prevHeading = -Math.PI / 2;
        p.stats.unitsBuilt++;
      }
    }
    recalcPlayerEconomy(this, p);
    this.checkNewOptions(p);
  }

  checkNewOptions(p: Player) {
    let fresh = false;
    for (const o of p.buildOptions()) {
      if (!p.knownOptions.has(o)) { p.knownOptions.add(o); fresh = true; }
    }
    if (fresh) this.announce(p, 'new_options', 2);
  }

  /** Ore regrows slowly inside its fields and occasionally spreads to neighbouring cells. */
  private growOre() {
    const m = this.map;
    const cells = m.oreFieldCells;
    if (!cells.length) return;
    const samples = Math.max(4, Math.round(cells.length * 0.012));
    for (let k = 0; k < samples; k++) {
      const i = cells[this.rng.int(0, cells.length - 1)];
      const o = m.ore[i];
      if (m.occupant[i] || m.tree[i]) continue;
      const cap = m.oreField[i] === 2 ? 5 : ORE_MAX;
      if (o < cap && this.rng.chance(m.oreField[i] === 2 ? 0.25 : 0.6)) m.setOre(i, o + 1);
      if (o >= 7 && this.rng.chance(0.06)) {
        const x = i % m.w, y = (i / m.w) | 0;
        const nx = x + this.rng.int(-1, 1), ny = y + this.rng.int(-1, 1);
        if (m.inBounds(nx, ny)) {
          const j = m.idx(nx, ny);
          if (!m.oreField[j] && m.buildable(nx, ny)) {
            m.oreField[j] = 1;
            cells.push(j);
            m.setOre(j, 1);
          }
        }
      }
    }
  }

  private checkVictory() {
    if (this.gameOver) return;
    for (const p of this.players) {
      if (p.defeated) continue;
      const alive = this.buildings.some((b) => b.alive && b.owner === p) || this.units.some((u) => u.alive && u.owner === p);
      if (!alive) {
        p.defeated = true;
        this.events.push({ e: 'eliminated', player: p.id });
      }
    }
    const teams = new Set(this.players.filter((p) => !p.defeated).map((p) => p.team));
    if (teams.size <= 1) {
      this.gameOver = true;
      this.winnerTeam = teams.size ? [...teams][0] : -1;
      this.events.push({ e: 'gameover', winnerTeam: this.winnerTeam });
    }
  }
}

export { isBuildingType };
