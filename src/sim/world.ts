import { BUILDINGS, REFUND_PERCENT, UNITS, getType, isBuildingType, type BuildingTypeDef, type Faction } from '../data/rules';
import type { AnnouncerKey, SfxKey } from '../audio/types';
import { Rng } from '../core/rng';
import { Building, Entity, Unit } from './entities';
import { GameMap, ORE_MAX, T } from './map';
import { PathFinder } from './pathfinding';
import { Player, queueKindOf } from './player';
import { DT, TICK_HZ, type Command, type GameEvent, type Order } from './types';
import { pickWeapon, updateBuildingWeapons, updateProjectiles, updateUnitWeapons, type Projectile } from './combat';
import { engineerCanEnter, pathRemaining, resolveCollisions, unitSpeed, updateUnit } from './unitlogic';
import { updateProduction, recalcPlayerEconomy, QUEUE_LIMIT } from './production';
import { repeatCommand } from './repeat';
import { AIController, type AIDifficulty } from './ai';
import type { Personality } from './ai-personality';
import { updateSuperweapons, fireSuperweapon } from './superweapons';
import type { MissionRuntime } from './mission';
import { navalDeploy, navalLaunchOk, placeNaval, sonarPulse, updateNaval } from './naval';
import { contentPostMove, contentPreTick, contentStepUnit, contentVisibility } from './content';
import { canInfiltrate } from './infiltration';
import { deployMinelayer, orderMinefield } from './mines';
import { initBridges, orderRepairBridge, type Bridge } from './bridges';
import { aftermathDeploy, aftermathKilled, aftermathStepUnit, chronoJump } from './aftermath';
import { formationMove, newCtrlState, type CtrlState } from './formation';
import { ordersCommand, ordersPreTick } from './orders';
import { CEASEFIRE_WARNING } from './ceasefire';
import { commanderCommand, commanderKill, commanderSpawn, commanderTick, initCommander, type CommanderState } from './commander';
import { costOf } from './doctrine';
import { initVariety, varietyCommand, varietyTick, type VarietyState } from './events';
import { resignCommand } from './resign'; // surrender
import { econCombat, econCommand, econKilled, econSight, econTick, initEcon, outpostSiteOk, type EconState } from './economy';
import { initRegionScenery } from './region-scenery'; // World Conquest region battlefields (MAPS)

export type DeathHow = 'normal' | 'blown' | 'burn' | 'electro' | 'bite' | 'crushed' | 'sold';

/**
 * Why a structure can't be placed: terrain = off-map / water / rock / trees / ore under the footprint;
 * occupied = structures or enemy units in the way; exit = a dock or factory exit (ours or another
 * structure's) would be blocked; distance = too far from the base; no-yard = no Construction Yard.
 */
export type PlacementIssue = 'terrain' | 'occupied' | 'exit' | 'distance' | 'no-yard';

const NEIGHBOURS4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** World.walledIn: a ground unit whose failed path search found at most this many cells to move in, closed off by structures, is moved out. */
const SEALED_POCKET = 8;

/** Walls must stay within this many cells of a non-wall own structure. */
export const WALL_REACH = 10;

/**
 * Cost of fully repairing a structure, as a fraction of its price (RA RepairPercent). Selling refunds a
 * flat REFUND_PERCENT whatever the damage (as in RA), so repairing and then selling never makes money.
 */
export const STRUCTURE_REPAIR_PERCENT = 0.2;

export interface PlayerSetup {
  name: string;
  faction: Faction;
  color: number;
  team: number;
  isHuman: boolean;
  ai?: AIDifficulty;
  /** Commander personality of an AI player (id or full trait object, ai-personality.ts); default = balanced. */
  personality?: string | Personality;
}

export interface WorldOptions {
  map: GameMap;
  players: PlayerSetup[];
  credits: number;
  startUnits: 'mcv' | 'light' | 'heavy' | 'none';
  /** Per-player override of the starting kit (missions). */
  startUnitsPer?: ('mcv' | 'light' | 'heavy' | 'none')[];
  /** Per-player starting credits (missions). */
  creditsPer?: (number | undefined)[];
  fog: boolean;
  seed: number;
  /**
   * Skirmish build-up time (ceasefire.ts): tick at which the ceasefire ends, CEASEFIRE_UNLIMITED (-1) for the
   * whole match, 0 / undefined = none.
   */
  ceasefireUntil?: number;
  /**
   * Skirmish rules (sim/commander.ts): 'commander' = doctrines, command points and commander powers;
   * 'classic' / undefined = pure Red Alert (missions, campaigns, old saves and replays).
   */
  rules?: 'classic' | 'commander';
  /** Doctrine id per player (null: a human plays without one, an AI picks its own; 'none': no doctrine). */
  doctrines?: (string | null)[];
  /** Skirmish mutators (modes/mutators.ts), battlefield events (default on under Commander rules) and dynamic difficulty (sim/events.ts). */
  mutators?: string[];
  events?: boolean;
  dynamicDifficulty?: boolean;
  /** Commander economy and tech tiers (sim/economy.ts): on with Commander rules unless false. */
  econ?: boolean;
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
  /** Bonus crates lying on the map. */
  crates: { id: number; x: number; y: number }[] = [];
  /** Bridges from the map, with their state (bridges.ts); intact decks are passable via map.bridgeAt. */
  bridges: Bridge[] = [];
  cratesEnabled = true;
  private crateTimer = 60;
  events: GameEvent[] = [];
  grid: UnitGrid;
  ais: AIController[] = [];
  fog: boolean;
  gameOver = false;
  winnerTeam = -1;
  /** Scripted mission driving this world (campaign / survival / challenges). */
  mission: MissionRuntime | null = null;
  /** Formations in transit (formation.ts); saved. */
  ctrl: CtrlState = newCtrlState();
  /** Build-up time (ceasefire.ts): end tick, -1 = unlimited, 0 = none; saved. */
  ceasefireUntil = 0;
  /** Commander rules state (sim/commander.ts); null = Classic rules. Saved. */
  commander: CommanderState | null = null;
  /** Mutators, battlefield events, neutral tech structures, dynamic difficulty (sim/events.ts); null = none. Saved. */
  variety: VarietyState | null = null;
  /** Commander economy: tech tiers, research, upgrades (sim/economy.ts); null = Classic rules. Saved. */
  econ: EconState | null = null;
  private nextId = 1;
  /** Projectile ids (their own namespace; renderers key effects by them). */
  nextProjectileId = 1;
  private commands: Command[] = [];
  private pathQueue: Unit[] = [];
  private dirtyLists = false;
  /** updateVisibility scratch (not saved): per cell, the last pass that stamped a circle from it and its radius. */
  private visPass = 0;
  private readonly visSeenPass: Int32Array;
  private readonly visSeenR: Float64Array;
  /**
   * During the combat phase of a tick lethal damage only marks the victim; it is removed at the end of
   * the phase so everybody fires "simultaneously" (no advantage for entities that happen to update first).
   * Always empty between ticks.
   */
  deferDeaths = false;
  private pendingDeaths: { e: Entity; how: DeathHow; killer?: Entity }[] = [];

  constructor(opts: WorldOptions) {
    this.map = opts.map;
    this.rng = new Rng(opts.seed ^ 0x5bd1e995);
    this.pathfinder = new PathFinder(this.map);
    this.grid = new UnitGrid(this.map.w, this.map.h);
    this.visSeenPass = new Int32Array(this.map.w * this.map.h);
    this.visSeenR = new Float64Array(this.map.w * this.map.h);
    this.fog = opts.fog;
    this.ceasefireUntil = opts.ceasefireUntil ?? 0;
    initBridges(this);
    const cells = this.map.w * this.map.h;
    opts.players.forEach((ps, i) => {
      const p = new Player({ id: i, name: ps.name, faction: ps.faction, color: ps.color, team: ps.team, isHuman: ps.isHuman, cash: opts.creditsPer?.[i] ?? opts.credits, mapCells: cells });
      this.players.push(p);
      if (ps.ai) this.ais.push(new AIController(this, p, ps.ai, ps.personality)); // personality
    });
    if (opts.rules === 'commander') initCommander(this, opts.doctrines, opts.seed); // before the starting units exist
    if (opts.rules === 'commander' && opts.econ !== false) initEcon(this); // tech tiers, upgrades, research
    this.setupStart(opts.startUnits, opts.startUnitsPer);
    initVariety(this, { rules: opts.rules, mutators: opts.mutators, events: opts.events, dynamicDifficulty: opts.dynamicDifficulty, seed: opts.seed }); // (null for Classic without options)
    initRegionScenery(this); // World Conquest region battlefields: landmarks explored, civilian buildings raised (MAPS; a no-op on other maps)
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
  private setupStart(defKind: WorldOptions['startUnits'], per?: WorldOptions['startUnitsPer']) {
    const starts = this.map.startPositions;
    this.players.forEach((p, i) => {
      const kind = per?.[i] ?? defKind;
      if (kind === 'none') return;
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
    if (u.kind === 'naval') placeNaval(this, u);
    if (u.ut.harvester) {
      u.order = { type: 'harvest' };
      u.hstate = 'seek';
    }
    if (this.commander) commanderSpawn(this, u); // doctrine weapons / health, Elite Training
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
    // tech / factory availability is granted when construction completes (instant: right away)
    if (instant) this.countBuilding(b);
    if (this.commander) commanderSpawn(this, b); // doctrine weapons / health
    recalcPlayerEconomy(this, owner);
    return b;
  }

  /** Count a completed structure in its owner's tech (prerequisites, factories). */
  private countBuilding(b: Building) {
    if (b.counted) return;
    b.counted = true;
    b.owner.owned.set(b.bt.id, (b.owner.owned.get(b.bt.id) ?? 0) + 1);
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
    if (b.bt.factory && b.bt.factory !== 'building' && !b.bt.water) reserve(b.exitCell());
  }

  /** Remove a building's footprint (death / sale / capture handled elsewhere). */
  private unstamp(b: Building) {
    this.stampBuilding(b, false);
    if (!b.counted) return;
    b.counted = false;
    const n = (b.owner.owned.get(b.bt.id) ?? 1) - 1;
    b.owner.owned.set(b.bt.id, Math.max(0, n));
  }

  /** Lethal damage: kill now, or at the end of the combat phase while deaths are deferred. */
  lethal(e: Entity, how: DeathHow, killer?: Entity) {
    if (this.deferDeaths) this.pendingDeaths.push({ e, how, killer });
    else this.kill(e, how, killer);
  }

  private flushDeaths() {
    if (!this.pendingDeaths.length) return;
    const list = this.pendingDeaths;
    this.pendingDeaths = [];
    for (const d of list) this.kill(d.e, d.how, d.killer);
  }

  /** Kill an entity. `how` drives death visuals. */
  kill(e: Entity, how: DeathHow = 'normal', killer?: Entity) {
    if (!e.alive) return;
    // a mine going off / being shot is no "structure lost"
    if (e instanceof Building && e.bt.mine) how = 'sold';
    if (this.commander) commanderKill(this, e, how, killer); // command points
    if (this.econ && e instanceof Building) econKilled(this, e, how); // bunker garrison out, upgrade / research refunded
    // a dog sniffed out a disguised spy
    if (e instanceof Unit && e.ut.spy && e.disguise >= 0 && killer instanceof Unit && killer.ut.dog) this.announce(killer.owner, 'spy_detected', 4);
    e.alive = false;
    e.hp = 0;
    this.dirtyLists = true;
    this.events.push({ e: 'death', id: e.id, x: e.x, y: e.y, how });
    const owner = e.owner;
    if (killer && killer.owner !== owner && how !== 'sold') {
      killer.kills++;
      if (e.kind === 'building') killer.owner.stats.buildingsKilled++;
      else killer.owner.stats.unitsKilled++;
      if (killer instanceof Unit && killer.alive) this.grantXp(killer, e.type.cost * (e.kind === 'building' ? 0.6 : 1));
    }
    if (e instanceof Building) {
      this.unstamp(e);
      if (how !== 'sold') {
        owner.stats.buildingsLost++;
        this.announce(owner, 'structure_lost', 3);
        this.spawnSurvivors(e, 0.5);
        if (e.bt.factory === 'naval') { owner.yardsLost++; owner.yardLostTick = this.tick; }
      }
      // release docked harvester
      if (e.dockOccupant) {
        const h = this.entities.get(e.dockOccupant) as Unit | undefined;
        if (h && h.alive) h.hstate = 'toRefinery';
      }
      recalcPlayerEconomy(this, owner);
    } else if (e instanceof Unit) {
      owner.stats.unitsLost++;
      if (how !== 'sold') this.announce(owner, e.kind === 'naval' ? 'naval_unit_lost' : 'unit_lost', 6);
      if (e.dockAt) {
        const r = this.entities.get(e.dockAt) as Building | undefined;
        if (r && r.dockOccupant === e.id) r.dockOccupant = 0;
      }
      // APC passengers die with it
      for (const p of e.passengers) {
        p.alive = false;
        p.transport = 0;
        this.entities.delete(p.id);
        owner.stats.unitsLost++;
      }
      e.passengers.length = 0;
      if (e.ut.demolition) aftermathKilled(this, e, how); // a demolition truck goes off
    }
  }

  /** Remove a unit without it counting as lost (support aircraft leaving the map). */
  despawn(u: Unit) {
    if (!u.alive) return;
    u.alive = false;
    u.hp = 0;
    this.dirtyLists = true;
    this.events.push({ e: 'death', id: u.id, x: u.x, y: u.y, how: 'sold' });
  }

  /** Veterancy: experience from kills; veteran at its own cost destroyed, elite at three times that. */
  grantXp(u: Unit, amount: number) {
    if (u.rank >= 2) return;
    u.xp += amount;
    const vet = Math.max(300, u.ut.cost), elite = Math.max(900, u.ut.cost * 3);
    const rank = u.xp >= elite ? 2 : u.xp >= vet ? 1 : 0;
    if (rank > u.rank) {
      u.rank = rank;
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.25);
      this.events.push({ e: 'promoted', id: u.id, rank });
      this.announce(u.owner, 'unit_promoted', 4);
      this.sfx('promote', u.x, u.y);
    }
  }

  spawnSurvivors(b: Building, chance: number) {
    const n = Math.min(3, Math.floor(b.bt.cost / 700));
    for (let k = 0; k < n; k++) {
      if (!this.rng.chance(chance)) continue;
      const [x, y] = this.findFreeSpot(b.x + this.rng.range(-1, 1), b.y + b.h / 2 + 0.6, 3);
      if (!this.map.passable(Math.floor(x), Math.floor(y))) continue; // a naval yard far from the shore
      const u = this.addUnit('e1', b.owner, x, y);
      u.heading = Math.PI / 2;
    }
  }

  private cleanupDead() {
    if (!this.dirtyLists) return;
    this.dirtyLists = false;
    this.units = this.units.filter((u) => {
      if (!u.alive) { this.entities.delete(u.id); return false; }
      return !u.transport;
    });
    this.buildings = this.buildings.filter((b) => {
      if (!b.alive) { this.entities.delete(b.id); return false; }
      return true;
    });
  }

  /** Nearest passable spot around (x, y) not crowded by units. */
  findFreeSpot(x: number, y: number, maxR: number, forVehicle = true, naval = false): [number, number] {
    const m = this.map;
    const fx = Math.floor(x), fy = Math.floor(y);
    for (let r = 0; r <= maxR; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = fx + dx, cy = fy + dy;
        if (!(naval ? m.navalPassable(cx, cy) : m.passable(cx, cy))) continue;
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
        if (formationMove(this, units, cmd)) break; // group moves in formation
        const dests = this.formation(units, cmd.x, cmd.y);
        // mixed groups travel together at the pace of their slowest member
        const ground = units.filter((u) => u.kind !== 'aircraft' && u.kind !== 'naval');
        const cap = ground.length > 1 ? Math.min(...ground.map((u) => unitSpeed(u))) * 1.05 : 0;
        units.forEach((u, k) => {
          const o: Order = { type: 'move', x: dests[k][0], y: dests[k][1], attackMove: !!cmd.attackMove };
          this.giveOrder(u, o, !!cmd.queue);
          if (!cmd.queue && u.kind !== 'aircraft' && u.kind !== 'naval') u.speedCap = cap;
        });
        break;
      }
      case 'attack': {
        const target = this.entities.get(cmd.target);
        if (!target || !target.alive || (target.cloaked && !this.canSee(p, target))) return;
        for (const u of this.ownedUnits(cmd.player, cmd.units)) {
          if (u.ut.engineer && target instanceof Building) {
            if (engineerCanEnter(u, target)) this.giveOrder(u, { type: 'enter', target: target.id });
            continue;
          }
          if (u.ut.c4 && target.kind === 'building' && p.isEnemy(target.owner)) { this.giveOrder(u, { type: 'enter', target: target.id }); continue; }
          if (u.ut.spy || u.ut.thief) {
            if (target instanceof Building && canInfiltrate(u, target)) this.giveOrder(u, { type: 'enter', target: target.id });
            continue;
          }
          // refuse targets none of the unit's weapons can hurt (rifles vs walls, dogs vs tanks)
          if (!u.weapons.length || !pickWeapon(u, target)) continue;
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
          const [x, y] = this.findFreeSpot(u.x + Math.cos(a) * 2, u.y + Math.sin(a) * 2, 2, u.kind !== 'infantry', u.kind === 'naval');
          this.setOrder(u, { type: 'move', x, y, attackMove: false });
        }
        break;
      case 'deploy':
        for (const u of this.ownedUnits(cmd.player, cmd.units)) {
          if (aftermathDeploy(this, u)) continue; // M.A.D. charge, demolition truck, chrono tank
          if (u.kind === 'naval') navalDeploy(this, u);
          else if (u.ut.passengers && u.kind !== 'aircraft') this.unload(u);
          else if (u.ut.minelayer) deployMinelayer(this, u);
          else if (u.ut.deploysInto || u.kind === 'aircraft') this.setOrder(u, { type: 'deploy' });
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
            if (u.dockAt && u.dockAt !== target.id) { u.hstate = 'idle'; this.releaseDock(u); }
            u.hstate = 'toRefinery';
            u.dockAt = target.id;
            this.setOrder(u, { type: 'harvest' });
            continue;
          }
          if (u.ut.engineer && target instanceof Building && !engineerCanEnter(u, target)) continue;
          if ((u.ut.spy || u.ut.thief) && target instanceof Building && !canInfiltrate(u, target)) continue;
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
          for (let k = 0; k < count && q.items.length < QUEUE_LIMIT; k++) {
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
          p.refund(costOf(p, t)); // doctrine price (= t.cost under Classic rules)
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
        const placed = [b];
        // walls: extra segments along a dragged line, each paid on placement
        if (b.bt.wall && cmd.cx2 !== undefined && cmd.cy2 !== undefined) {
          for (const [x, y] of wallLine(cmd.cx, cmd.cy, cmd.cx2, cmd.cy2).slice(1, 24)) {
            if (!this.canPlace(p, cmd.type, x, y)) continue;
            // a friendly unit standing here must be able to step out, or the segment is skipped
            if (!this.canClearCell(x, y)) continue;
            if (!p.spend(costOf(p, b.bt))) { this.announce(p, 'insufficient_funds', 3); break; } // doctrine price
            const w = this.addBuilding(cmd.type, p, x, y);
            p.stats.buildingsBuilt++;
            this.events.push({ e: 'placed', id: w.id });
            placed.push(w);
          }
        }
        // nudge own units out of every new footprint (after the whole line exists, so nobody is
        // pushed into a later segment)
        for (const w of placed) this.clearFootprintUnits(w);
        break;
      }
      case 'sell': {
        const b = this.entities.get(cmd.building);
        if (!(b instanceof Building) || b.owner !== p || !b.active || b.bt.mine) return; // (mines re-arm for free: no selling them)
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
        b.rallyUnit = 0;
        break;
      }
      case 'stance': {
        // behaviour per stance lives in unit logic; the command just records it
        for (const id of cmd.units) {
          const u = this.entities.get(id);
          if (u instanceof Unit && u.owner === p && u.alive) u.stance = cmd.stance;
        }
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
      case 'mine':
        orderMinefield(this, this.ownedUnits(cmd.player, cmd.units), cmd.x, cmd.y);
        break;
      case 'repairBridge':
        orderRepairBridge(this, this.ownedUnits(cmd.player, cmd.units), cmd.bridge);
        break;
      case 'chronoJump': // aftermath.ts
        chronoJump(this, p, cmd.unit, cmd.x, cmd.y);
        break;
      case 'patrol': case 'guard': case 'formation': case 'rallyUnit': case 'queuePlan': // orders.ts
        ordersCommand(this, cmd);
        break;
      case 'commanderPower': case 'unlockPower': // commander powers (commander.ts)
        commanderCommand(this, cmd);
        break;
      case 'repeat': // repeat production (repeat.ts)
        repeatCommand(this, p, cmd);
        break;
      case 'battleEvent': // answer a battlefield event (events.ts)
        varietyCommand(this, cmd);
        break;
      case 'upgrade': case 'research': case 'evacuate': // Commander economy (economy.ts)
        if (this.econ) econCommand(this, cmd);
        break;
      case 'resign': resignCommand(this, cmd.player); break; // surrender (resign.ts)
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
    u.waitTimer = 0;
  }

  releaseDock(u: Unit) {
    if (!u.dockAt) return;
    const r = this.entities.get(u.dockAt) as Building | undefined;
    if (r && r.dockOccupant === u.id) r.dockOccupant = 0;
    if (u.hstate !== 'toRefinery') u.dockAt = 0;
  }

  /** Destination slots for a group move. Keeps relative formation for tight groups. */
  formation(units: Unit[], x: number, y: number): [number, number][] {
    // (a lone ship still gets a water slot: a click on the shore sends it to the nearest water)
    if (units.length === 1 && (units[0].kind !== 'naval' || this.map.navalPassable(Math.floor(x), Math.floor(y)))) return [[x, y]];
    let cx = 0, cy = 0;
    for (const u of units) { cx += u.x; cy += u.y; }
    cx /= units.length; cy /= units.length;
    let maxR = 0;
    for (const u of units) maxR = Math.max(maxR, Math.hypot(u.x - cx, u.y - cy));
    const tight = maxR < 2.5 + Math.sqrt(units.length) * 0.7;
    const taken = new Set<number>();
    const m = this.map;
    const slotKey = (sx: number, sy: number) => Math.floor(sx * 2) + Math.floor(sy * 2) * (m.w * 2 + 7);
    const claim = (px: number, py: number, inf: boolean, nav = false): [number, number] => {
      // search outward for a free (sub)cell
      const step = inf ? 0.5 : 1;
      for (let r = 0; r < 12; r++) {
        let best: [number, number] | null = null, bestD = Infinity;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const sx = inf ? (Math.floor(px * 2) + dx) / 2 + 0.25 : Math.floor(px) + dx * step + 0.5;
          const sy = inf ? (Math.floor(py * 2) + dy) / 2 + 0.25 : Math.floor(py) + dy * step + 0.5;
          if (!(nav ? m.navalPassable(Math.floor(sx), Math.floor(sy)) : m.passable(Math.floor(sx), Math.floor(sy)))) continue;
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
      out[k] = claim(px, py, u.kind === 'infantry', u.kind === 'naval');
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------
  canPlace(p: Player, typeId: string, cx: number, cy: number): boolean {
    return this.placementIssue(p, typeId, cx, cy) === null;
  }

  /** Why a structure can't be placed at (cx, cy) (top-left footprint cell), or null if it can. */
  placementIssue(p: Player, typeId: string, cx: number, cy: number): PlacementIssue | null {
    const bt = BUILDINGS[typeId];
    if (!bt) return 'terrain';
    // the Construction Yard builds everything: none (alive and finished) = nothing can be placed
    if (!p.hasFactoryFor(typeId)) return 'no-yard';
    const m = this.map;
    let occupied = false, reserved = false;
    for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!m.inBounds(x, y)) return 'terrain';
      const i = m.idx(x, y);
      const t = m.terrain[i];
      if (bt.water ? !m.navalTerrain(i) : (t !== T.Clear && t !== T.Sand && t !== T.Dirt) || m.tree[i] || m.ore[i]) return 'terrain';
      if (m.occupant[i]) occupied = true;
      else if (m.reserved[i]) reserved = true;
    }
    if (occupied) return 'occupied';
    // enemy units block placement (own units are moved out of the way)
    let blocked = false;
    this.grid.query(cx + bt.size[0] / 2, cy + bt.size[1] / 2, Math.max(bt.size[0], bt.size[1]), (u) => {
      if (!u.alive || u.owner === p || u.isAir) return;
      if (u.x >= cx && u.x < cx + bt.size[0] && u.y >= cy && u.y < cy + bt.size[1]) blocked = true;
    });
    if (blocked) return 'occupied';
    // another structure's dock / exit is kept clear, and our own must be usable
    if (reserved) return 'exit';
    const need: [number, number][] = [];
    if (bt.dock) need.push([cx + bt.dock[0], cy + bt.dock[1]]);
    if (bt.factory && bt.factory !== 'building' && !bt.water) {
      const e = bt.exit ?? [Math.floor(bt.size[0] / 2), bt.size[1]];
      need.push([cx + e[0], cy + e[1]]);
    }
    if (bt.water && bt.factory && !navalLaunchOk(m, bt, cx, cy)) return 'exit';
    for (const [x, y] of need) if (!m.inBounds(x, y) || !m.passable(x, y) || !this.hasOpenSide(bt, cx, cy, x, y)) return 'exit';
    if (this.sealsDockOrExit(bt, cx, cy)) return 'exit';
    // base adjacency: structures need a (non-wall) structure within 2 cells. Walls may be placed
    // up to 6 cells from any own structure, wall chains included, but never more than 10 cells
    // from a real (non-wall) structure, so sandbag lines can't creep a base across the map.
    if (bt.wall || bt.gate) { // (fortress gates go into wall lines: sim/economy.ts)
      if (!this.isAdjacentToBase(p, bt, cx, cy, 6) || !this.isAdjacentToBase(p, bt, cx, cy, WALL_REACH, true)) return 'distance';
    } else if (!this.isAdjacentToBase(p, bt, cx, cy, 2, true) && !(bt.outpost && this.econ && outpostSiteOk(this, p, bt, cx, cy))) return 'distance'; // (mining outposts: by any ore field in view)
    return null;
  }

  /** Whether an own structure lies within `gap` cells of the footprint (optionally ignoring walls). */
  isAdjacentToBase(p: Player, bt: BuildingTypeDef, cx: number, cy: number, gap = 2, ignoreWalls = false): boolean {
    for (const b of this.buildings) {
      if (!b.alive || b.owner !== p || b.bt.mine || b.bt.tech || (ignoreWalls && b.bt.wall)) continue; // captured tech structures don't extend the base
      if (b.bt.outpost && bt.category !== 'defense') continue; // a mining outpost only extends the base for defences
      const gx = Math.max(b.cx - (cx + bt.size[0]), cx - (b.cx + b.w), 0);
      const gy = Math.max(b.cy - (cy + bt.size[1]), cy - (b.cy + b.h), 0);
      if (Math.max(gx, gy) <= gap) return true;
    }
    return false;
  }

  /**
   * Whether a footprint at (cx, cy) would wall in an existing dock / factory exit cell, i.e. leave it
   * with no open side (harvesters could never reach the refinery pad, vehicles never leave the factory).
   */
  private sealsDockOrExit(bt: BuildingTypeDef, cx: number, cy: number): boolean {
    const m = this.map;
    const inside = (x: number, y: number) => x >= cx && x < cx + bt.size[0] && y >= cy && y < cy + bt.size[1];
    for (let y = cy - 1; y <= cy + bt.size[1]; y++) for (let x = cx - 1; x <= cx + bt.size[0]; x++) {
      if (inside(x, y) || !m.inBounds(x, y) || !m.reserved[m.idx(x, y)]) continue;
      // a reserved cell bordering the footprint: it must keep at least one open neighbour
      if (!this.hasOpenSide(bt, cx, cy, x, y)) return true;
    }
    return false;
  }

  /** Cell (x, y) keeps a passable orthogonal neighbour outside a footprint at (cx, cy). */
  private hasOpenSide(bt: BuildingTypeDef, cx: number, cy: number, x: number, y: number): boolean {
    for (const [dx, dy] of NEIGHBOURS4) {
      const nx = x + dx, ny = y + dy;
      if (nx >= cx && nx < cx + bt.size[0] && ny >= cy && ny < cy + bt.size[1]) continue;
      if (this.map.passable(nx, ny)) return true;
    }
    return false;
  }

  /** A friendly ground unit standing in cell (x, y) could be moved out (wall segments). */
  private canClearCell(x: number, y: number): boolean {
    for (const u of this.units) {
      if (!u.alive || u.isAir || Math.floor(u.x) !== x || Math.floor(u.y) !== y) continue;
      const [fx, fy] = this.findFreeSpot(x + 0.5, y + 1.5, 6, u.kind !== 'infantry');
      const ix = Math.floor(fx), iy = Math.floor(fy);
      if ((ix === x && iy === y) || !this.map.passable(ix, iy)) return false;
    }
    return true;
  }

  /** Push own units off a freshly placed footprint. */
  private clearFootprintUnits(b: Building) {
    for (const u of this.units) {
      if (!u.alive || u.isAir) continue;
      if (u.x >= b.cx && u.x < b.cx + b.w && u.y >= b.cy && u.y < b.cy + b.h) {
        const [x, y] = this.findFreeSpot(b.x, b.cy + b.h + 0.5, 6, u.kind !== 'infantry', u.kind === 'naval');
        u.x = u.prevX = x;
        u.y = u.prevY = y;
        if (u.madStage > 0) { u.targetX = u.guardX = x; u.targetY = u.guardY = y; } // a deployed M.A.D. Tank is held at its anchor (aftermath.ts): move that too
        this.setOrder(u, { type: 'idle' });
      }
    }
  }

  /** The unit lists changed outside a tick's own bookkeeping (a unit went into a bunker: sim/economy.ts). */
  listsChanged() {
    this.dirtyLists = true;
  }

  /** Put an infantry unit inside a transport. */
  board(u: Unit, apc: Unit): boolean {
    if (!apc.alive || apc.passengers.length >= (apc.ut.passengers ?? 0)) return false;
    // a Chinook has to be on the ground to take passengers
    if (apc.kind === 'aircraft' && apc.altitude > 0.05) return false;
    // infantry ride anything; a naval transport (LST) also carries vehicles
    if (u.kind !== 'infantry' && !(apc.kind === 'naval' && u.kind === 'vehicle')) return false;
    apc.passengers.push(u);
    u.transport = apc.id;
    this.setOrder(u, { type: 'idle' });
    this.dirtyLists = true;
    this.events.push({ e: 'death', id: u.id, x: u.x, y: u.y, how: 'sold' });
    this.sfx('door', apc.x, apc.y);
    return true;
  }

  /**
   * A passenger / garrison back on the map. One that went in during this same tick is still listed (the lists are
   * only pruned at the end of the tick): it must not be listed twice.
   */
  rejoin(u: Unit) {
    if (!this.units.includes(u)) this.units.push(u);
  }

  /** Drop all passengers next to a transport. */
  unload(apc: Unit) {
    if (!apc.passengers.length) return;
    for (const p of apc.passengers) {
      const [x, y] = this.findFreeSpot(apc.x - Math.cos(apc.heading) * 0.8, apc.y - Math.sin(apc.heading) * 0.8, 3, false);
      p.x = p.prevX = x;
      p.y = p.prevY = y;
      p.transport = 0;
      p.guardX = x;
      p.guardY = y;
      p.heading = p.prevHeading = apc.heading + Math.PI;
      this.rejoin(p);
    }
    apc.passengers.length = 0;
    this.sfx('door', apc.x, apc.y);
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
    // per-tick node budget: one big search may overrun it, later requests then wait for the next tick
    let budget = 40000;
    // per-search budget: enough to explore the whole map, so long detours (around a big lake on a
    // 128x128 map) are found instead of returning a partial path into a dead end
    const maxNodes = Math.max(9000, this.map.w * this.map.h);
    let n = 0;
    while (this.pathQueue.length && budget > 0 && n < 24) {
      const u = this.pathQueue.shift()!;
      if (!u.alive || !u.pathPending) continue;
      u.pathPending = false;
      const sx = Math.floor(u.x), sy = Math.floor(u.y), gx = Math.floor(u.goalX), gy = Math.floor(u.goalY);
      // the same unreachable request again within 2s (e.g. an order re-pathing every tick): don't search again
      const key = ((sy * this.map.w + sx) * this.map.h + gy) * this.map.w + gx;
      if (key === u.pathFailKey && this.tick - u.pathFailTick < TICK_HZ * 2) {
        u.path = null;
        u.hasGoal = false;
        continue;
      }
      n++;
      const path = this.pathfinder.find(sx, sy, gx, gy, maxNodes, u.exitBuilding, u.kind === 'naval' ? 'naval' : 'ground', this.econ ? u.owner.team : -1); // (own fortress gates)
      budget -= this.pathfinder.expandedLastSearch + 50;
      const last = path && path.length ? path[path.length - 1] : null;
      const reached = !!last && Math.floor(last.x) === gx && Math.floor(last.y) === gy;
      if (!reached && !(sx === gx && sy === gy)) { u.pathFailKey = key; u.pathFailTick = this.tick; }
      if (path && path.length) {
        if (reached) {
          last!.x = u.goalX;
          last!.y = u.goalY;
        }
        u.path = path;
        u.pathIdx = 0;
        u.progressTimer = 0;
        u.progressDist = pathRemaining(u);
      } else {
        u.path = null;
        u.hasGoal = false;
        if (this.pathfinder.expandedLastSearch <= SEALED_POCKET && !(sx === gx && sy === gy)) this.walledIn(u);
      }
    }
  }

  /**
   * A ground unit whose cell has no way out because structures went up all round it (an AI base growing around a
   * parked tank): it can never get a path again, so it is moved to the nearest free spot, as a placement on top of
   * it would have done. Ground boxed in by terrain alone (a unit dropped on an islet) is left as it is.
   * Version 7: also a unit sealed in a pocket of a few cells (SEALED_POCKET) that structures close off: it goes to the
   * nearest open cell beyond the structures, over ground only they block (never across water, rock or trees). A Hard AI
   * ringed a damaged tank by its Service Depot with defences, two cells to move in, for five minutes.
   */
  private walledIn(u: Unit) {
    if (u.kind === 'aircraft' || u.kind === 'naval' || u.exitBuilding || u.madStage > 0) return;
    const m = this.map, cx = Math.floor(u.x), cy = Math.floor(u.y);
    if (!m.inBounds(cx, cy)) return;
    // the open ground it can still reach (orthogonal steps: a path never cuts a structure's corner)
    const pocket = [m.idx(cx, cy)];
    let enemyWall = false;
    for (let h = 0; h < pocket.length; h++) {
      const i = pocket[h], x = i % m.w, y = (i / m.w) | 0;
      for (const [dx, dy] of NEIGHBOURS4) {
        if (!m.inBounds(x + dx, y + dy)) continue;
        const j = m.idx(x + dx, y + dy);
        if (!m.passableIdx(j)) {
          const b = m.occupant[j] ? this.entities.get(m.occupant[j]) : undefined;
          if (b && u.owner.isEnemy(b.owner)) enemyWall = true;
          continue;
        }
        if (pocket.includes(j)) continue;
        if (pocket.length >= SEALED_POCKET) return; // (room to move: not sealed in)
        pocket.push(j);
      }
    }
    let to: [number, number] | null = null;
    if (pocket.length === 1) {
      if (!NEIGHBOURS4.some(([dx, dy]) => m.inBounds(cx + dx, cy + dy) && m.occupant[m.idx(cx + dx, cy + dy)] && m.terrainPassable(m.idx(cx + dx, cy + dy)))) return;
      to = this.findFreeSpot(u.x, u.y, 6, u.kind !== 'infantry');
    } else {
      // (a pocket the enemy's structures close: a trap it built, as in Red Alert; the unit stays)
      if (enemyWall) return;
      // out through the structures: the nearest open cell, stepping over structure cells only
      const seen = new Set(pocket), q = [...pocket], room = u.kind !== 'infantry' ? 0 : 2;
      for (let h = 0; h < q.length && !to && q.length < 600; h++) {
        const i = q[h], x = i % m.w, y = (i / m.w) | 0;
        for (const [dx, dy] of NEIGHBOURS4) {
          const nx = x + dx, ny = y + dy;
          if (!m.inBounds(nx, ny)) continue;
          const j = m.idx(nx, ny);
          if (seen.has(j) || !m.terrainPassable(j)) continue;
          seen.add(j);
          q.push(j);
          if (!m.passableIdx(j)) continue; // (a structure: go on through it)
          let crowd = 0;
          this.grid.query(nx + 0.5, ny + 0.5, 0.6, (o) => { if (o.alive && Math.floor(o.x) === nx && Math.floor(o.y) === ny) crowd++; });
          if (crowd <= room) { to = [nx + 0.5, ny + 0.5]; break; }
        }
      }
    }
    if (!to || (Math.floor(to[0]) === cx && Math.floor(to[1]) === cy)) return;
    u.x = u.prevX = to[0];
    u.y = u.prevY = to[1];
    this.requestPath(u, u.goalX, u.goalY); // (on to where it was going)
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
    // a circle stamped again from the same cell with no larger radius adds nothing (infantry stand several to a cell,
    // structures never move): skip it, the result is the same
    const pass = ++this.visPass;
    const seenPass = this.visSeenPass, seenR = this.visSeenR;
    const stamp = (x: number, y: number, r: number) => {
      const fx = Math.floor(x), fy = Math.floor(y);
      if (fx >= 0 && fy >= 0 && fx < m.w && fy < m.h) {
        const c = fy * m.w + fx;
        if (seenPass[c] === pass && seenR[c] >= r) return;
        seenPass[c] = pass;
        seenR[c] = r;
      }
      const offs = circleOffsets(r);
      for (let k = 0; k < offs.length; k += 2) {
        const cx = fx + offs[k], cy = fy + offs[k + 1];
        if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) continue;
        const i = cy * m.w + cx;
        vis[i] = 1;
        p.explored[i] = 1;
      }
    };
    for (const u of this.units) if (u.alive && u.owner.team === p.team) stamp(u.x, u.y, u.ut.sight + 0.5);
    for (const b of this.buildings) if (b.alive && b.owner.team === p.team) stamp(b.x, b.y, b.upgrades ? b.bt.sight + Math.max(b.w, b.h) / 2 + econSight(b) : b.bt.sight + Math.max(b.w, b.h) / 2); // (Satellite Uplink)
    contentVisibility(this, p);
  }

  isVisible(p: Player, x: number, y: number): boolean {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (!this.map.inBounds(cx, cy)) return false;
    return p.visible[cy * this.map.w + cx] > 0;
  }

  /** Whether entity e is visible to player p. */
  canSee(p: Player, e: Entity): boolean {
    if (e.owner.team === p.team) return true;
    if (e instanceof Unit && e.transport) return false; // inside a transport or a bunker: out of sight (and out of reach)
    // detected (sensor ship nearby, sonar pulse): visible even through fog; cloaked and undetected: hidden
    if (e.revealedTo & (1 << p.id)) return true;
    if (e.cloaked) return false;
    if (e instanceof Building) {
      for (let dy = 0; dy < e.h; dy++) for (let dx = 0; dx < e.w; dx++) {
        if (p.visible[(e.cy + dy) * this.map.w + e.cx + dx]) return true;
      }
      return false;
    }
    return this.isVisible(p, e.x, e.y);
  }

  /** Sonar pulse (support power): enemy submarines surface and are revealed to `p`'s team for `seconds`. */
  revealCloaked(p: Player, seconds: number) {
    sonarPulse(this, p, seconds);
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
    if (this.ceasefireUntil > 0) this.ceasefireNews();
    // commands (placement, free spots, scatter) query the unit grid: give them where the units are now, not where
    // they were at the start of the previous tick (a restored save has no grid until the rebuild below)
    if (this.commands.length) this.grid.rebuild(this.units);
    for (const c of this.commands.splice(0)) this.processCommand(c);

    for (const u of this.units) { u.prevX = u.x; u.prevY = u.y; u.prevHeading = u.heading; u.prevTurret = u.turret; }
    for (const b of this.buildings) b.prevTurret = b.turret;

    this.grid.rebuild(this.units);
    updateNaval(this);

    for (const p of this.players) {
      if (p.defeated) continue;
      updateProduction(this, p);
      updateSuperweapons(this, p);
    }
    contentPreTick(this);
    ordersPreTick(this); // formations, build plans
    if (this.commander) commanderTick(this); // command points, timed power effects, barrages
    if (this.econ) econTick(this); // upgrades, research, gates, repairs and recharges
    this.deferDeaths = true;
    for (const b of this.buildings) if (b.alive) this.updateBuilding(b);
    this.processPaths();
    // update units starting at a random index (alternating direction) so no side systematically
    // moves / aims first because its entities happen to be older
    const units = this.units, n = units.length;
    const start = n > 1 ? this.rng.int(0, n - 1) : 0;
    if (this.tick & 1) {
      for (let k = 0; k < n; k++) this.stepUnit(units[(start + n - k) % n]);
    } else {
      for (let k = 0; k < n; k++) this.stepUnit(units[(start + k) % n]);
    }
    resolveCollisions(this);
    if (this.econ) econCombat(this); // bunker garrisons fire
    contentPostMove(this);
    updateProjectiles(this);
    this.deferDeaths = false;
    this.flushDeaths();
    this.cleanupDead();

    if (this.tick % 4 === 0) for (const p of this.players) this.updateVisibility(p);
    if (this.tick % 10 === 0) for (const p of this.players) recalcPlayerEconomy(this, p);
    if (this.tick % (TICK_HZ * 2) === 0) this.growOre();
    for (let k = 0; k < this.ais.length; k++) {
      if ((this.tick + k * 3) % 10 === 0) this.ais[k].think();
    }
    if (this.tick % TICK_HZ === 0) this.checkVictory();
    if (this.cratesEnabled) this.updateCrates();
    this.mission?.tick();
    if (this.variety) { varietyTick(this); this.cleanupDead(); } // mutators, battlefield events, tech structures, dynamic difficulty (engineers that went in, despawned convoys: off the lists)
  }

  /** Timed build-up: the one-minute warning and the end of the ceasefire, announced to the humans. */
  private ceasefireNews() {
    const left = this.ceasefireUntil - this.tick;
    const key: AnnouncerKey | null = left === CEASEFIRE_WARNING * TICK_HZ ? 'ceasefire_warning' : left === 0 ? 'ceasefire_over' : null;
    if (key) for (const p of this.players) if (p.isHuman && !p.defeated) this.announce(p, key, 0);
  }

  private stepUnit(u: Unit) {
    if (!u.alive) return;
    if (contentStepUnit(this, u)) return;
    if (aftermathStepUnit(this, u)) return;
    updateUnit(this, u);
    if (u.alive) updateUnitWeapons(this, u);
  }

  private updateCrates() {
    this.crateTimer -= DT;
    if (this.crateTimer <= 0 && this.crates.length < 3) {
      this.crateTimer = this.rng.range(45, 80);
      const m = this.map;
      for (let tries = 0; tries < 40; tries++) {
        const x = this.rng.int(2, m.w - 3), y = this.rng.int(2, m.h - 3);
        if (!m.passable(x, y) || m.ore[m.idx(x, y)]) continue;
        if (m.startPositions.some((s) => Math.hypot(s.x - x, s.y - y) < 12)) continue;
        this.crates.push({ id: this.nextId++, x: x + 0.5, y: y + 0.5 });
        break;
      }
    }
    if (!this.crates.length || this.tick % 4 !== 0) return;
    for (let k = this.crates.length - 1; k >= 0; k--) {
      const c = this.crates[k];
      let taker: Unit | null = null;
      this.grid.query(c.x, c.y, 0.8, (u) => { if (!taker && u.alive && !u.isAir && u.owner.id >= 0 && Math.hypot(u.x - c.x, u.y - c.y) < 0.5) taker = u; }); // (neutral convoys / pilots don't take crates)
      if (!taker) continue;
      this.crates.splice(k, 1);
      this.collectCrate(taker, c.x, c.y);
    }
  }

  private collectCrate(u: Unit, x: number, y: number) {
    const p = u.owner;
    const r = this.rng.next();
    if (r < 0.4) {
      const amount = this.rng.int(4, 10) * 250;
      p.cash += amount;
      this.events.push({ e: 'crate', x, y, player: p.id, reward: 'money', amount });
    } else if (r < 0.6) {
      const pool = p.faction === 'allies' ? ['1tnk', '2tnk', 'jeep', 'arty'] : ['3tnk', '3tnk', 'v2rl', '4tnk'];
      const [sx, sy] = this.findFreeSpot(x, y, 3);
      const nu = this.addUnit(this.rng.pick(pool), p, sx, sy);
      nu.heading = nu.prevHeading = u.heading;
      this.events.push({ e: 'crate', x, y, player: p.id, reward: 'unit', amount: 0 });
      this.announce(p, 'reinforcements', 0);
    } else if (r < 0.8) {
      for (const o of this.units) if (o.alive && o.owner === p && Math.hypot(o.x - x, o.y - y) < 5) o.hp = o.maxHp;
      this.events.push({ e: 'crate', x, y, player: p.id, reward: 'heal', amount: 0 });
    } else {
      const R = 14;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const cx = Math.floor(x) + dx, cy = Math.floor(y) + dy;
        if (this.map.inBounds(cx, cy) && dx * dx + dy * dy <= R * R) p.explored[this.map.idx(cx, cy)] = 1;
      }
      this.events.push({ e: 'crate', x, y, player: p.id, reward: 'reveal', amount: 0 });
    }
    this.sfx('crate', x, y);
  }

  private updateBuilding(b: Building) {
    if (b.c4Timer > 0) {
      b.c4Timer -= DT;
      if (b.c4Timer <= 0) {
        this.detonateC4(b);
        if (!b.alive) return;
      }
    }
    if (b.buildAnim < 1) {
      b.buildAnim = Math.min(1, b.buildAnim + DT / (b.bt.wall ? 0.35 : 1.1));
      if (b.buildAnim >= 1) this.onBuildingComplete(b);
      return;
    }
    if (b.invulnerable > 0) b.invulnerable = Math.max(0, b.invulnerable - DT);
    if (b.selling >= 0) {
      b.selling -= DT;
      if (b.selling < 0) {
        const refund = Math.floor(costOf(b.owner, b.bt) * REFUND_PERCENT); // doctrine price (= bt.cost under Classic rules)
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
        const cost = (b.bt.cost * STRUCTURE_REPAIR_PERCENT * step) / b.maxHp;
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

  /** A planted C4 charge goes off: the structure is destroyed whoever planted it and wherever they are now. */
  private detonateC4(b: Building) {
    b.c4Timer = 0;
    const by = this.entities.get(b.c4By);
    const owner = this.players[b.c4Owner];
    b.c4By = 0;
    b.c4Owner = -1;
    if (b.invulnerable > 0) return; // the Iron Curtain shrugs it off
    const killer = by && by.alive ? by : undefined;
    // the demolition counts for the planting side even if the commando is gone
    if (!killer && owner && owner !== b.owner) owner.stats.buildingsKilled++;
    this.kill(b, 'blown', killer);
  }

  private onBuildingComplete(b: Building) {
    const p = b.owner;
    this.countBuilding(b);
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

  /** End the game in favour of a team (-1 = nobody). */
  endGame(winnerTeam: number) {
    if (this.gameOver) return;
    this.gameOver = true;
    this.winnerTeam = winnerTeam;
    this.events.push({ e: 'gameover', winnerTeam });
  }

  private checkVictory() {
    if (this.gameOver) return;
    for (const p of this.players) {
      if (p.defeated) continue;
      const alive = this.buildings.some((b) => b.alive && b.owner === p && !b.bt.wall && !b.bt.mine && !b.bt.tech) || this.units.some((u) => u.alive && u.owner === p); // tech structures don't keep anyone alive
      if (!alive) {
        p.defeated = true;
        this.events.push({ e: 'eliminated', player: p.id });
      }
    }
    const teams = new Set(this.players.filter((p) => !p.defeated).map((p) => p.team));
    if (this.mission) {
      // scripted missions decide victory themselves (the runtime handles the human being wiped out)
      if (this.mission.def.winOnElimination && teams.size <= 1 && !this.players[0].defeated) this.mission.win();
      return;
    }
    if (teams.size <= 1) {
      this.gameOver = true;
      this.winnerTeam = teams.size ? [...teams][0] : -1;
      this.events.push({ e: 'gameover', winnerTeam: this.winnerTeam });
    }
  }
}

/** Cells of a straight wall line (horizontal, vertical or diagonal, whichever is dominant). */
export function wallLine(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const dx = x1 - x0, dy = y1 - y0;
  const out: [number, number][] = [];
  // snap to the dominant axis or a clean diagonal (a diagonal never runs past the cursor)
  let sx = Math.sign(dx), sy = Math.sign(dy);
  if (Math.abs(dx) > Math.abs(dy) * 2) sy = 0;
  else if (Math.abs(dy) > Math.abs(dx) * 2) sx = 0;
  const n = sx && sy ? Math.min(Math.abs(dx), Math.abs(dy)) : Math.max(Math.abs(dx), Math.abs(dy));
  for (let k = 0; k <= n; k++) out.push([x0 + sx * k, y0 + sy * k]);
  return out;
}

export { isBuildingType };
