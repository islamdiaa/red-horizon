/**
 * Full simulation save / load. The map terrain is regenerated from its seed; everything dynamic
 * (entities, players, queues, fog memory, ore, trees, AI state, mission script state, RNG) is
 * serialised so a restored game continues deterministically.
 */
import { BUILDINGS, UNITS, WEAPONS } from '../data/rules';
import { Building, Entity, Unit, WeaponSlot } from './entities';
import { ProductionQueue, type Player } from './player';
import { SUPER_KINDS } from './superweapons';
import type { Projectile } from './combat';
import type { World } from './world';
import type { MissionRuntime } from './mission';
import { newCtrlState } from './formation';
import { loadCommander, saveCommander } from './commander';
import { loadVariety, neutralOwner, saveVariety } from './events';
import { loadEcon, saveEcon } from './economy';

export const SAVE_VERSION = 1;

type Json = any;

// --- typed array <-> base64 -------------------------------------------------
// (a table encoder: the same text as btoa, about 15x faster than building a binary string for it; autosaves run
// it on every map layer and every player's explored map)
const B64 = new Uint8Array(64);
for (let i = 0; i < 64; i++) B64[i] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.charCodeAt(i);
const ascii = new TextDecoder();
function b64(arr: ArrayBufferView): string {
  const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const n = b.length, out = new Uint8Array(Math.ceil(n / 3) * 4);
  let o = 0, i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out[o++] = B64[v >> 18]; out[o++] = B64[(v >> 12) & 63]; out[o++] = B64[(v >> 6) & 63]; out[o++] = B64[v & 63];
  }
  if (i < n) {
    const v = (b[i] << 16) | ((i + 1 < n ? b[i + 1] : 0) << 8);
    out[o++] = B64[v >> 18]; out[o++] = B64[(v >> 12) & 63]; out[o++] = i + 1 < n ? B64[(v >> 6) & 63] : 61; out[o++] = 61; // '='
  }
  return ascii.decode(out);
}
/** Run-length code of a mostly flat array (fog visibility): [value, count, value, count, ...]. */
function rle(arr: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < arr.length;) {
    const v = arr[i];
    let j = i + 1;
    while (j < arr.length && arr[j] === v) j++;
    out.push(v, j - i);
    i = j;
  }
  return out;
}
function unrle(runs: unknown, into: Uint16Array): boolean {
  if (!Array.isArray(runs)) return false;
  let i = 0;
  for (let k = 0; k + 1 < runs.length && i < into.length; k += 2) {
    const v = runs[k], n = runs[k + 1];
    if (typeof v !== 'number' || typeof n !== 'number' || !(n >= 1)) return false;
    into.fill(v, i, Math.min(into.length, i + n));
    i += n;
  }
  return i === into.length;
}
function unb64<T extends Uint8Array | Int32Array | Uint16Array>(s: string, into: T) {
  const bin = atob(s);
  const bytes = new Uint8Array(into.buffer, into.byteOffset, into.byteLength);
  for (let i = 0; i < bytes.length && i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
}

const SKIP_ENTITY = new Set(['owner', 'ut', 'bt', 'weapons', 'target', 'passengers', 'kind']);

function serEntity(e: Entity): Json {
  const o: Json = { cls: e instanceof Building ? 'B' : 'U', type: e.type.id, owner: e.owner.id };
  const r = e as unknown as Record<string, unknown>;
  for (const k in r) { // (own fields only: the classes have no enumerable inherited members; twice as fast as Object.entries)
    const v = r[k];
    if (SKIP_ENTITY.has(k) || typeof v === 'function') continue;
    o[k] = v;
  }
  o.weapons = e.weapons.map((w) => ({ def: w.def.id, cooldown: w.cooldown, burstLeft: w.burstLeft, burstTimer: w.burstTimer }));
  o.target = e.target ? e.target.id : 0;
  if (e instanceof Unit) o.passengers = e.passengers.map((p) => p.id);
  return o;
}

function serPlayer(p: Player): Json {
  const o: Json = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'queues' || k === 'owned' || k === 'visible' || k === 'explored' || k === 'lastAnnounce' || k === 'knownOptions' || k === 'allowedTypes') continue;
    o[k] = v;
  }
  o.queues = Object.fromEntries(Object.entries(p.queues).map(([k, q]) => [k, { items: q.items, ready: q.ready, stalled: q.stalled }]));
  o.owned = [...p.owned.entries()];
  o.explored = b64(p.explored);
  o.visible = rle(p.visible); // as of its last refresh (every 4 ticks): recomputing it on load would change the game
  o.lastAnnounce = [...p.lastAnnounce.entries()];
  o.knownOptions = [...p.knownOptions];
  o.allowedTypes = p.allowedTypes ? [...p.allowedTypes] : null;
  return o;
}

export interface SaveData {
  version: number;
  /** Simulation version that wrote it (src/sim/version.ts). A save holds the whole world, so another version still
   *  loads and simply continues under the current rules; absent = before the stamp existed. */
  sim?: number;
  savedAt: number;
  world: Json;
  /** Game-level state (camera, clock, setup…) filled in by the Game. */
  game?: Json;
}

export function serializeWorld(w: World): Json {
  const W = w as any;
  const m = w.map;
  const ents: Json[] = [];
  // ghosts: entities already removed from the world that something still points at (a target that died this
  // tick); restored as dead objects so the loaded game holds exactly the same references and continues identically
  const ghosts: Json[] = [];
  const ghostIds = new Set<number>();
  const ghost = (t: Entity | null) => {
    if (!t || ghostIds.has(t.id) || w.entities.get(t.id) === t) return;
    ghostIds.add(t.id);
    const g = serEntity(t);
    g.target = 0; // (a dead entity's own target is never read)
    if (g.cls === 'U') g.passengers = [];
    ghosts.push(g);
  };
  for (const e of w.entities.values()) { ents.push(serEntity(e)); ghost(e.target); }
  // every projectile in the list, including the spent ones it prunes every 20 ticks (the list is part of the state)
  const projectiles = w.projectiles.map((p) => { ghost(p.target); return { ...p, weapon: p.weapon.id, owner: p.owner.id, target: p.target ? p.target.id : 0 }; });
  const ais = w.ais.map((ai) => {
    const a = ai as any;
    return {
      player: ai.player.id, difficulty: ai.difficulty, state: a.state, stage: a.stage, stageX: a.stageX, stageY: a.stageY,
      stageTarget: a.stageTarget, stageStart: a.stageStart, wave: [...a.wave], waveStart: a.waveStart, nextWaveValue: a.nextWaveValue,
      lastDefend: a.lastDefend, deployTries: a.deployTries, behaviour: a.behaviour, thinks: a.thinks, modeSet: a.modeSet,
      ext: a.saveState?.(), // intel, scouting, raids, expansions, flanks, repairs
    };
  });
  let mission: Json = null;
  if (w.mission) {
    const r = w.mission as any;
    mission = {
      id: w.mission.def.id, objectives: w.mission.objectives, flags: w.mission.flags, ended: r.ended, won: r.won, score: r.score,
      hudTimerKey: r.hudTimerKey, onceKeys: [...r.onceKeys], everyT: [...r.everyT.entries()], timers: [...r.timers.entries()],
    };
  }
  return {
    tick: w.tick, rng: (w.rng as any).s, nextId: W.nextId, nextProjectileId: w.nextProjectileId, fog: w.fog, gameOver: w.gameOver, winnerTeam: w.winnerTeam,
    crateTimer: W.crateTimer, crates: w.crates, cratesEnabled: w.cratesEnabled,
    ceasefireUntil: w.ceasefireUntil, // build-up time (ceasefire.ts)
    bridges: w.bridges.map((b) => ({ id: b.id, hp: b.hp, alive: b.alive })),
    ctrl: w.ctrl, // formations in transit
    commander: w.commander ? saveCommander(w.commander) : undefined, // Commander rules (absent = Classic)
    variety: w.variety ? saveVariety(w) : undefined, // mutators, events, tech structures (absent = none)
    econ: w.econ ? saveEcon(w.econ, w) : undefined, // Commander economy: tiers, research (absent = Classic)
    pathQueue: W.pathQueue.map((u: Unit) => u.id),
    // commands issued after the last step (AI thinks at the end of a tick) run at the start of the next one
    commands: W.commands,
    units: w.units.map((u) => u.id), buildings: w.buildings.map((b) => b.id),
    entities: ents, ghosts, projectiles, ais, mission,
    players: w.players.map(serPlayer),
    map: {
      terrain: b64(m.terrain), ore: b64(m.ore), gems: b64(m.gems), oreField: b64(m.oreField), tree: b64(m.tree),
      occupant: b64(m.occupant), reserved: b64(m.reserved), passableOverride: b64(m.passableOverride),
      oreFieldCells: m.oreFieldCells, startPositions: m.startPositions, oreVersion: m.oreVersion, treeVersion: m.treeVersion,
    },
  };
}

/** Restore a world (constructed for the same map seed / players) from serialised state. */
export function deserializeWorld(w: World, s: Json, mission?: MissionRuntime | null) {
  const W = w as any;
  const m = w.map;
  // --- map
  unb64(s.map.terrain, m.terrain); unb64(s.map.ore, m.ore); unb64(s.map.gems, m.gems); unb64(s.map.oreField, m.oreField);
  unb64(s.map.tree, m.tree); unb64(s.map.occupant, m.occupant); unb64(s.map.reserved, m.reserved); unb64(s.map.passableOverride, m.passableOverride);
  m.oreFieldCells = s.map.oreFieldCells;
  m.startPositions = s.map.startPositions;
  m.oreVersion = s.map.oreVersion + 1;
  m.treeVersion = s.map.treeVersion;
  // --- players
  const restoredVis = new Set<Player>();
  s.players.forEach((ps: Json, i: number) => {
    const p = w.players[i];
    for (const [k, v] of Object.entries(ps)) {
      if (k === 'queues' || k === 'owned' || k === 'explored' || k === 'visible' || k === 'lastAnnounce' || k === 'knownOptions' || k === 'allowedTypes' || k === 'id') continue;
      (p as any)[k] = v;
    }
    for (const [k, q] of Object.entries(ps.queues as Record<string, Json>)) {
      const pq = new ProductionQueue(k as any);
      pq.items = q.items; pq.ready = q.ready; pq.stalled = q.stalled;
      (p.queues as any)[k] = pq;
    }
    // older saves predate some support powers
    for (const k of SUPER_KINDS) { p.superCharge[k] ??= 0; p.superAnnounced[k] ??= false; }
    p.owned = new Map(ps.owned);
    unb64(ps.explored, p.explored);
    if (unrle(ps.visible, p.visible)) restoredVis.add(p); // (older saves: recomputed below)
    p.lastAnnounce = new Map(ps.lastAnnounce);
    p.knownOptions = new Set(ps.knownOptions);
    p.allowedTypes = ps.allowedTypes ? new Set(ps.allowedTypes) : null;
  });
  // --- entities
  w.entities.clear();
  const byId = new Map<number, Entity>();
  const ghosts = new Set<Json>(Array.isArray(s.ghosts) ? s.ghosts : []); // (none in older saves)
  for (const es of [...(s.entities as Json[]), ...ghosts]) {
    let e: Entity;
    const owner = es.owner < 0 ? neutralOwner(w, s.variety) : w.players[es.owner]; // neutral structures / event units
    if (es.cls === 'B') {
      e = new Building(es.id, BUILDINGS[es.type], owner, es.cx, es.cy);
    } else {
      e = new Unit(es.id, UNITS[es.type], owner, es.x, es.y);
    }
    for (const [k, v] of Object.entries(es)) {
      if (k === 'cls' || k === 'type' || k === 'owner' || k === 'weapons' || k === 'target' || k === 'passengers') continue;
      (e as any)[k] = v;
    }
    // older saves counted every placed structure in its owner's tech straight away
    if (e instanceof Building && es.counted === undefined) e.counted = true;
    e.weapons = (es.weapons as Json[]).map((ws) => {
      const slot = new WeaponSlot(WEAPONS[ws.def]);
      slot.cooldown = ws.cooldown; slot.burstLeft = ws.burstLeft; slot.burstTimer = ws.burstTimer;
      return slot;
    });
    byId.set(e.id, e);
    if (!ghosts.has(es)) w.entities.set(e.id, e);
  }
  for (const es of s.entities as Json[]) {
    const e = byId.get(es.id)!;
    e.target = es.target ? byId.get(es.target) ?? null : null;
    if (e instanceof Unit) e.passengers = (es.passengers as number[]).map((id) => byId.get(id) as Unit).filter(Boolean);
  }
  w.units = (s.units as number[]).map((id) => byId.get(id) as Unit).filter(Boolean);
  w.buildings = (s.buildings as number[]).map((id) => byId.get(id) as Building).filter(Boolean);
  // --- projectiles
  w.projectiles = (s.projectiles as Json[]).map((p) => ({
    ...p, weapon: WEAPONS[p.weapon], owner: w.players[p.owner], target: p.target ? byId.get(p.target) ?? null : null,
  })) as Projectile[];
  // --- world scalars
  w.tick = s.tick;
  (w.rng as any).s = s.rng;
  W.nextId = s.nextId;
  w.nextProjectileId = s.nextProjectileId ?? 1;
  w.fog = s.fog;
  w.gameOver = s.gameOver;
  w.winnerTeam = s.winnerTeam;
  W.crateTimer = s.crateTimer;
  w.crates = s.crates;
  w.cratesEnabled = s.cratesEnabled;
  // (saves from before the build-up option have no ceasefire)
  w.ceasefireUntil = typeof s.ceasefireUntil === 'number' ? s.ceasefireUntil : 0;
  // bridges (the map's list comes from the regenerated map; only their state is saved)
  m.bridgeAt.fill(0);
  for (const bs of (s.bridges ?? []) as Json[]) {
    const b = w.bridges[bs.id - 1];
    if (!b) continue;
    b.hp = bs.hp;
    b.alive = bs.alive;
  }
  for (const b of w.bridges) if (b.alive) for (const [x, y] of b.cells) m.bridgeAt[m.idx(x, y)] = b.id;
  W.commands = s.commands ? JSON.parse(JSON.stringify(s.commands)) : [];
  w.ctrl = s.ctrl ? JSON.parse(JSON.stringify(s.ctrl)) : newCtrlState();
  // the path queue exactly as it was (the units' pathPending / hasGoal flags came back with their fields): a request
  // made again here would turn on a goal a unit had given up, or revive a request it no longer wants
  W.pathQueue = [];
  for (const id of s.pathQueue as number[]) {
    const u = byId.get(id);
    if (u instanceof Unit) W.pathQueue.push(u);
  }
  // --- AI
  for (const as of s.ais as Json[]) {
    const ai = w.ais.find((a) => a.player.id === as.player) as any;
    if (!ai) continue;
    const p = ai.player as Player, keep = [p.buildSpeed, p.incomeBias];
    if (as.behaviour === 'full') ai.setMode(as.difficulty); else ai.setMode(as.behaviour);
    if (typeof as.modeSet === 'boolean') { ai.modeSet = as.modeSet; [p.buildSpeed, p.incomeBias] = keep; } // (the economy multipliers as they were: dynamic difficulty moves them)
    Object.assign(ai, { state: as.state, stage: as.stage, stageX: as.stageX, stageY: as.stageY, stageTarget: as.stageTarget, stageStart: as.stageStart, wave: new Set(as.wave), waveStart: as.waveStart, nextWaveValue: as.nextWaveValue, lastDefend: as.lastDefend, deployTries: as.deployTries, thinks: as.thinks ?? 0 });
    ai.loadState?.(as.ext);
  }
  // --- mission
  if (mission && s.mission) {
    const r = mission as any;
    mission.objectives.length = 0;
    mission.objectives.push(...s.mission.objectives);
    mission.flags = s.mission.flags;
    r.ended = s.mission.ended; r.won = s.mission.won; r.score = s.mission.score; r.hudTimerKey = s.mission.hudTimerKey;
    r.onceKeys = new Set(s.mission.onceKeys); r.everyT = new Map(s.mission.everyT); r.timers = new Map(s.mission.timers);
    mission.events.length = 0;
  }
  loadCommander(w, s.commander, s.projectiles); // Commander rules state (none in Classic saves)
  if (s.econ || w.econ) loadEcon(w, s.econ); // Commander economy (none in Classic and older saves)
  if (s.variety || w.variety) loadVariety(w, s.variety); // after the AI restored its economy (none in older saves)
  for (const p of w.players) if (!restoredVis.has(p)) w.updateVisibility(p);
}

// --- storage -----------------------------------------------------------------
const PREFIX = 'rh.save.';

export function writeSave(slot: string, data: SaveData): boolean {
  try {
    localStorage.setItem(PREFIX + slot, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function readSave(slot: string): SaveData | null {
  try {
    const s = localStorage.getItem(PREFIX + slot);
    if (!s) return null;
    const d = JSON.parse(s) as SaveData;
    return d.version === SAVE_VERSION ? d : null;
  } catch {
    return null;
  }
}

export function saveInfo(slot: string): { savedAt: number; label: string } | null {
  const d = readSave(slot);
  return d ? { savedAt: d.savedAt, label: d.game?.label ?? 'Saved game' } : null;
}

export function deleteSave(slot: string) {
  localStorage.removeItem(PREFIX + slot);
}
