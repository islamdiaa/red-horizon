/**
 * What makes every skirmish different: battlefield events, the mutators' world effects, neutral tech
 * structures (neutral.ts) and dynamic difficulty. Everything lives in `World.variety` (null for Classic rules
 * without mutators or dynamic difficulty: the simulation is then exactly the classic one), runs inside the
 * deterministic tick (`varietyTick`, called at the end of World.step) and is saved with the world (`saveVariety`
 * / `loadVariety`, called by save.ts). It uses its own RNG, so event scheduling does not depend on the battle.
 *
 * Battlefield events (Commander rules, on by default): every 3-6 minutes, drawn from a shuffled bag:
 *   convoy   a neutral supply convoy crosses the map along the line fair to every base: escort it (right-click a
 *            truck) and whoever guarded it best is paid per truck delivered, or force-fire it to seize the cargo
 *   airdrop  a crate airdrop on a fair spot, announced 20 s ahead
 *   pilot    a downed pilot: the first infantry (engineers included) to reach him is rewarded, and he joins
 *   storm    a storm front grounds every aircraft for a minute (the renderer shows the existing storm weather)
 *   mercs    a mercenary squad offers its services for 60 s: 'battleEvent' / 'hire' command, once per commander
 *   surge    an ore surge floods the most contested ore field and spreads it
 * Each is announced through `VarietyState.news` (UI: toast, radio card, minimap ping, ui/variety-hud.ts).
 * Rewards are credits plus command points (the player's PlayerCmd when Commander rules give the player one,
 * otherwise their credit value).
 */
import { Rng } from '../core/rng';
import { BUILDINGS, UNITS } from '../data/rules';
import { MUTATOR_EFFECTS, mutatorNames, normaliseMutators } from '../modes/mutators';
import { Building, Unit } from './entities';
import { ORE_MAX, T } from './map';
import { neutralSites } from './mapgen';
import { Player } from './player';
import { DT, TICK_HZ, type Command } from './types';
import type { World } from './world';
import { aiNeutral, chargePowers, neutralTick, news, raiseSite, type AiCapture, type Site } from './neutral';
import { isLanded } from './aircraft';
import { grantCommandPoints as doctrinePoints } from './commander'; // command points

export type Rules = 'classic' | 'commander';
export type BattleEventKind = 'convoy' | 'airdrop' | 'pilot' | 'storm' | 'mercs' | 'surge';
export const EVENT_KINDS: BattleEventKind[] = ['convoy', 'airdrop', 'pilot', 'storm', 'mercs', 'surge'];

/** The variety options of a World (from GameSetup; see WorldOptions in world.ts). */
export interface VarietyOptions {
  rules?: Rules;
  mutators?: string[];
  /** Battlefield events; default on under Commander rules, never under Classic. */
  events?: boolean;
  dynamicDifficulty?: boolean;
  seed: number;
}

/** An announcement for the UI. `player` -1 = everybody; `event` links to a BattleEvent (mercenary offers). */
export interface NewsItem {
  seq: number;
  tick: number;
  kind: 'event' | 'site' | 'dyn';
  title: string;
  text: string;
  x: number;
  y: number;
  player: number;
  event?: number;
  phase?: string;
}

export interface BattleEvent {
  id: number;
  kind: BattleEventKind;
  phase: 'warn' | 'live';
  /** Tick it goes live, tick it times out. */
  at: number;
  until: number;
  x: number;
  y: number;
  r: number;
  // convoy
  route?: [number, number][];
  trucks?: number[];
  spawned?: number;
  /** Truck id -> owner id of its last attacker. */
  hit?: Record<string, number>;
  /** Escort score per player id. */
  esc?: Record<string, number>;
  delivered?: number;
  destroyed?: number;
  // airdrop
  crates?: number[];
  // pilot
  pilot?: number;
  // mercs
  price?: number;
  squad?: string[];
  label?: string;
  hired?: number[];
  /** AI player id -> tick it hires. */
  aiHire?: Record<string, number>;
  // AI plans: player id -> 'ambush' | 'escort'
  aiPlan?: Record<string, string>;
}

export interface VarietyState {
  rules: Rules;
  mutators: string[];
  events: boolean;
  dyn: boolean;
  /** RNG state of the schedule (when, and what kind): its own stream, so it never depends on the battle. */
  rng: number;
  /** RNG state of the events' content (where, which offer, AI choices) and of the mutators' crates. */
  rng2: number;
  /** Per player: [income, build] multipliers this module has applied to incomeBias / buildSpeed. */
  mult: [number, number][];
  /** Next event tick (0 = none). */
  next: number;
  bag: BattleEventKind[];
  seq: number;
  active: BattleEvent[];
  /** Events run so far. */
  count: number;
  news: NewsItem[];
  newsSeq: number;
  sites: Site[];
  captures: number;
  aiCaps: AiCapture[];
  crateSeq: number;
  vetMax: number;
  /** Bounty: kills already paid per player id ([units, structures]). */
  paid: [number, number][];
  /** Tick the storm ends (0 = no storm). */
  storm: number;
  /** Dynamic difficulty: level -4..4 (AI economy and aggression), the wave-value factor applied. */
  dd: { level: number; wave: number; harv: number[] };
  /** The neutral pseudo-player (id -1, not in world.players). Not serialised: rebuilt on load. */
  neutral: Player;
  /** Live Unit objects of event units (not serialised; refilled from the entities). */
  refs: Map<number, Unit>;
}

export const NEUTRAL_COLOR = 0x8f969e;
const WARN = 20 * TICK_HZ;
const CRATE_BASE = 7_000_000;

export function makeNeutral(w: World): Player {
  const p = new Player({ id: -1, name: 'Neutral', faction: 'allies', color: NEUTRAL_COLOR, team: -1, isHuman: false, cash: 0, mapCells: w.map.w * w.map.h });
  return p;
}

function rngOf(v: VarietyState, stream: 'rng' | 'rng2' = 'rng2'): Rng {
  const r = new Rng(1);
  (r as unknown as { s: number }).s = v[stream];
  return r;
}
function keep(v: VarietyState, r: Rng, stream: 'rng' | 'rng2' = 'rng2') {
  v[stream] = (r as unknown as { s: number }).s;
}

function blank(w: World, o: { rules: Rules; mutators: string[]; events: boolean; dyn: boolean; seed: number }): VarietyState {
  return {
    rules: o.rules, mutators: o.mutators, events: o.events, dyn: o.dyn,
    rng: ((o.seed ^ 0x3c6ef372) >>> 0) || 1, rng2: ((o.seed ^ 0x1f83d9ab) >>> 0) || 1, mult: w.players.map(() => [1, 1]), next: 0, bag: [], seq: 0, active: [], count: 0,
    news: [], newsSeq: 0, sites: [], captures: 0, aiCaps: [], crateSeq: 0, vetMax: 0, paid: w.players.map(() => [0, 0]), storm: 0,
    dd: { level: 0, wave: 1, harv: w.players.map(() => 0) }, neutral: makeNeutral(w), refs: new Map(),
  };
}

/**
 * Variety state for a new World (null = classic: nothing changes). Called by the World constructor after the
 * start units exist; a loaded game then overwrites everything with loadVariety.
 */
export function initVariety(w: World, o: VarietyOptions): VarietyState | null {
  const rules: Rules = o.rules === 'commander' ? 'commander' : 'classic';
  const mutators = normaliseMutators(o.mutators);
  const events = rules === 'commander' && o.events !== false;
  const dyn = !!o.dynamicDifficulty;
  if (rules === 'classic' && !mutators.length && !dyn) return null;
  const v = blank(w, { rules, mutators, events, dyn, seed: o.seed });
  w.variety = v;
  // mutators: economy multipliers and bans
  const ai = new Set(w.ais.map((a) => a.player));
  const banned = new Set<string>();
  w.players.forEach((p, i) => {
    let inc = 1, bld = 1;
    for (const id of mutators) {
      const e = MUTATOR_EFFECTS[id];
      if (!e) continue;
      inc *= e.income ?? 1;
      bld *= e.build ?? 1;
      if (ai.has(p)) { inc *= e.aiIncome ?? 1; bld *= e.aiBuild ?? 1; }
      for (const t of e.ban ?? []) banned.add(t);
    }
    setMult(v, p, i, inc, bld);
  });
  if (banned.size) {
    const all = [...Object.keys(BUILDINGS), ...Object.keys(UNITS)].filter((t) => !banned.has(t));
    for (const p of w.players) p.allowedTypes = new Set(p.allowedTypes ? [...p.allowedTypes].filter((t) => !banned.has(t)) : all);
  }
  if (rules === 'commander') {
    for (const s of neutralSites(w.map, w.players.length, o.seed)) {
      const site: Site = { type: s.type, cx: s.cx, cy: s.cy, id: 0, respawn: 0 };
      if (raiseSite(w, v, site)) v.sites.push(site);
    }
  }
  if (events) {
    const r = rngOf(v, 'rng');
    v.next = Math.round(r.range(180, 240) * TICK_HZ);
    keep(v, r, 'rng');
  }
  return v;
}

/** Set a player's variety multipliers (applied on top of whatever else set incomeBias / buildSpeed). */
function setMult(v: VarietyState, p: Player, i: number, inc: number, bld: number) {
  const [oi, ob] = v.mult[i] ?? [1, 1];
  p.incomeBias *= inc / oi;
  p.buildSpeed *= bld / ob;
  v.mult[i] = [inc, bld];
}

// =====================================================================================================
// Tick
// =====================================================================================================

export function varietyTick(w: World) {
  const v = w.variety;
  if (!v) return;
  if (v.mutators.length) mutatorsTick(w, v);
  if (v.rules === 'commander') {
    neutralTick(w, v);
    aiNeutral(w, v);
  }
  if (v.events) eventsTick(w, v);
  if (v.dyn && w.tick % (30 * TICK_HZ) === 0) dynamicTick(w, v);
}

function mutatorsTick(w: World, v: VarietyState) {
  const live = new Set<string>();
  let charge = 0;
  for (const id of v.mutators) {
    const e = MUTATOR_EFFECTS[id];
    if (e?.live) live.add(e.live);
    charge += e?.charge ?? 0;
  }
  const t = w.tick;
  if (live.has('veteran') && t % 10 === 3) {
    let max = v.vetMax;
    for (const u of w.units) {
      if (!u.alive || u.id <= v.vetMax) continue;
      if (u.id > max) max = u.id;
      if (u.owner.id < 0 || u.rank >= 1 || !u.weapons.length) continue;
      u.rank = 1;
      u.xp = Math.max(u.xp, Math.max(300, u.ut.cost));
    }
    v.vetMax = max;
  }
  if (live.has('rain')) {
    if (t % (30 * TICK_HZ) === 0) for (const p of w.players) if (!p.defeated) { p.cash += 400; w.events.push({ e: 'credits', player: p.id, amount: 400, x: -1, y: -1 }); }
    if (t % (45 * TICK_HZ) === 0 && w.crates.length < 6) dropCrate(w, v);
  }
  if (live.has('mega-crates')) {
    if (t % (20 * TICK_HZ) === 0 && w.crates.length < 8) dropCrate(w, v);
    megaCrates(w);
  }
  if (live.has('bounty') && t % 10 === 5) {
    w.players.forEach((p, i) => {
      const pd = v.paid[i] ?? (v.paid[i] = [0, 0]);
      const du = p.stats.unitsKilled - pd[0], db = p.stats.buildingsKilled - pd[1];
      if (du <= 0 && db <= 0) return;
      v.paid[i] = [p.stats.unitsKilled, p.stats.buildingsKilled];
      const amount = Math.max(0, du) * 100 + Math.max(0, db) * 300;
      if (amount && !p.defeated) { p.cash += amount; w.events.push({ e: 'credits', player: p.id, amount, x: -1, y: -1 }); }
    });
  }
  if (charge > 0 && t % 10 === 0) for (const p of w.players) chargePowers(w, p, charge, 10 * DT);
}

/** A crate on a random open cell away from the bases (credits rain, mega crates). */
function dropCrate(w: World, v: VarietyState, x0?: number, y0?: number, r = 0): number {
  const m = w.map;
  const rng = rngOf(v);
  let id = 0;
  for (let tries = 0; tries < 40 && !id; tries++) {
    const x = r ? Math.floor((x0 ?? 0) + rng.range(-r, r)) : rng.int(3, m.w - 4);
    const y = r ? Math.floor((y0 ?? 0) + rng.range(-r, r)) : rng.int(3, m.h - 4);
    if (!m.passable(x, y) || m.ore[m.idx(x, y)] || w.crates.some((c) => Math.floor(c.x) === x && Math.floor(c.y) === y)) continue;
    if (!r && m.startPositions.some((s) => Math.hypot(s.x - x, s.y - y) < 10)) continue;
    v.crateSeq++;
    id = CRATE_BASE + v.crateSeq;
    w.crates.push({ id, x: x + 0.5, y: y + 0.5 });
  }
  keep(v, rng);
  return id;
}

/** Mega Crates: money crates pay double, unit crates bring a second unit (reads this tick's crate events). */
function megaCrates(w: World) {
  for (const ev of w.events) {
    if (ev.e !== 'crate' || (ev as { mega?: boolean }).mega) continue;
    (ev as { mega?: boolean }).mega = true;
    const p = w.players[ev.player];
    if (!p) continue;
    if (ev.reward === 'money') { p.cash += ev.amount; ev.amount *= 2; }
    else if (ev.reward === 'unit') {
      const pool = p.faction === 'allies' ? ['2tnk', 'jeep', 'arty'] : ['3tnk', 'v2rl', '3tnk'];
      const [sx, sy] = w.findFreeSpot(ev.x, ev.y, 4);
      w.addUnit(pool[(w.tick + p.id) % pool.length], p, sx, sy);
    }
  }
}

// =====================================================================================================
// Battlefield events
// =====================================================================================================

/** Where the active players' bases are (construction yard, else first structure, else start). */
function homes(w: World): { p: Player; x: number; y: number }[] {
  const out: { p: Player; x: number; y: number }[] = [];
  for (const p of w.players) {
    if (p.defeated) continue;
    let b: Building | undefined;
    for (const o of w.buildings) if (o.alive && o.owner === p && !o.bt.tech && !o.bt.wall && !o.bt.mine && (!b || o.bt.id === 'fact')) { b = o; if (o.bt.id === 'fact') break; }
    const s = w.map.startPositions[p.id % Math.max(1, w.map.startPositions.length)];
    out.push({ p, x: b ? b.x : s?.x ?? w.map.w / 2, y: b ? b.y : s?.y ?? w.map.h / 2 });
  }
  return out;
}

/** Cells every base can reach on foot (from the first base). */
function reachFrom(w: World, hs: { x: number; y: number }[]): Uint8Array {
  const m = w.map;
  const n = m.w * m.h;
  const seen = new Uint8Array(n);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (const h of hs.slice(0, 1)) {
    const i = m.idx(Math.min(m.w - 1, Math.max(0, Math.floor(h.x))), Math.min(m.h - 1, Math.max(0, Math.floor(h.y))));
    seen[i] = 1; q[qt++] = i;
  }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % m.w, y = (i / m.w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (seen[j] || !m.terrainPassable(j)) continue;
      seen[j] = 1; q[qt++] = j;
    }
  }
  return seen;
}

/** A passable spot every base can reach that is (nearly) equally far from all of them, or null. */
export function fairPoint(w: World, rng: Rng, minHome = 12): [number, number] | null {
  const hs = homes(w);
  if (!hs.length) return null;
  const m = w.map;
  const reach = reachFrom(w, hs);
  let best: [number, number] | null = null, bestScore = Infinity;
  for (let k = 0; k < 400; k++) {
    const x = rng.int(4, m.w - 5), y = rng.int(4, m.h - 5);
    const i = m.idx(x, y);
    if (!reach[i] || !m.passable(x, y) || m.occupant[i]) continue;
    let lo = Infinity, hi = 0;
    for (const h of hs) { const d = Math.hypot(h.x - x - 0.5, h.y - y - 0.5); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    if (lo < minHome) continue;
    // fair first, then not too far out of everybody's way
    const score = (hi - lo) + lo * 0.04 + rng.next() * 1.5;
    if (score < bestScore) { bestScore = score; best = [x + 0.5, y + 0.5]; }
  }
  return best;
}

/** Nearest passable, reachable cell to (x, y) within r. */
function snap(w: World, reach: Uint8Array, x: number, y: number, r = 12): [number, number] | null {
  const m = w.map;
  const fx = Math.floor(x), fy = Math.floor(y);
  for (let d = 0; d <= r; d++) {
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      const cx = fx + dx, cy = fy + dy;
      if (!m.inBounds(cx, cy) || !m.passable(cx, cy) || !reach[m.idx(cx, cy)]) continue;
      return [cx + 0.5, cy + 0.5];
    }
  }
  return null;
}

/** Convoy route: across the map through the centre, along the line fair to the first two bases. */
export function convoyRoute(w: World, rng: Rng): [number, number][] | null {
  const hs = homes(w);
  if (hs.length < 2) return null;
  const m = w.map;
  const reach = reachFrom(w, hs);
  const cx = m.w / 2, cy = m.h / 2;
  let dx: number, dy: number;
  if (hs.length === 2) {
    const ax = hs[1].x - hs[0].x, ay = hs[1].y - hs[0].y, l = Math.hypot(ax, ay) || 1;
    dx = -ay / l; dy = ax / l;
  } else if (rng.chance(0.5)) { dx = 1; dy = 0; } else { dx = 0; dy = 1; }
  if (rng.chance(0.5)) { dx = -dx; dy = -dy; }
  // the far ends: as close to the edges as the line allows
  const L = Math.min(Math.abs(dx) > 1e-6 ? (m.w / 2 - 3) / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? (m.h / 2 - 3) / Math.abs(dy) : Infinity);
  const a = snap(w, reach, cx - dx * L, cy - dy * L);
  const mid = snap(w, reach, cx, cy, 16);
  const b = snap(w, reach, cx + dx * L, cy + dy * L);
  if (!a || !b || !mid || Math.hypot(a[0] - b[0], a[1] - b[1]) < m.w * 0.5) return null;
  return [a, mid, b];
}

function nextKind(v: VarietyState, rng: Rng): BattleEventKind {
  if (!v.bag.length) v.bag = rng.shuffle([...EVENT_KINDS]);
  return v.bag.shift()!;
}

function eventsTick(w: World, v: VarietyState) {
  if (v.next && w.tick >= v.next) {
    if (v.active.some((e) => e.phase === 'live' && e.kind !== 'storm')) v.next = w.tick + 30 * TICK_HZ; // one at a time
    else {
      const sched = rngOf(v, 'rng'), rng = rngOf(v);
      let ev: BattleEvent | null = null;
      for (let tries = 0; tries < EVENT_KINDS.length && !ev; tries++) ev = plan(w, v, nextKind(v, sched), rng);
      v.next = w.tick + Math.round(sched.range(180, 360) * TICK_HZ);
      keep(v, sched, 'rng');
      keep(v, rng);
      if (ev) { v.active.push(ev); v.count++; }
    }
  }
  for (let k = v.active.length - 1; k >= 0; k--) {
    const ev = v.active[k];
    if (ev.phase === 'warn') {
      if (w.tick >= ev.at) { ev.phase = 'live'; start(w, v, ev); }
      continue;
    }
    if (update(w, v, ev)) v.active.splice(k, 1);
  }
  if (w.tick % (5 * TICK_HZ) === 11) aiEvents(w, v);
}

const MERC_OFFERS: { label: string; price: number; squad: string[] }[] = [
  { label: 'two Medium Tanks and three riflemen', price: 1500, squad: ['2tnk', '2tnk', 'e1', 'e1', 'e1'] },
  { label: 'three Rangers and two rocket soldiers', price: 1200, squad: ['jeep', 'jeep', 'jeep', 'e3', 'e3'] },
  { label: 'two Heavy Tanks', price: 1500, squad: ['3tnk', '3tnk'] },
  { label: 'a V2 battery and four grenadiers', price: 1400, squad: ['v2rl', 'v2rl', 'e2', 'e2', 'e2', 'e2'] },
  { label: 'a Mammoth Tank', price: 1800, squad: ['4tnk'] },
];

function plan(w: World, v: VarietyState, kind: BattleEventKind, rng: Rng): BattleEvent | null {
  const id = ++v.seq;
  const base = { id, kind, phase: 'warn' as const, at: w.tick + WARN, until: 0, x: -1, y: -1, r: 0 };
  switch (kind) {
    case 'convoy': {
      const route = convoyRoute(w, rng);
      if (!route) return null;
      const [x, y] = route[0];
      news(w, v, 'Supply convoy inbound', 'A neutral supply convoy will cross the battlefield in 20 seconds. Escort it (right-click a truck) and get paid for every truck delivered, or force-fire it (Ctrl + right-click) to seize its cargo.', x, y, -1, 'event', { event: id, phase: 'warn' });
      return { ...base, x, y, r: 3, until: w.tick + WARN + 300 * TICK_HZ, route, trucks: [], spawned: 0, hit: {}, esc: {}, delivered: 0, destroyed: 0, aiPlan: {} };
    }
    case 'airdrop': {
      const pt = fairPoint(w, rng, 14);
      if (!pt) return null;
      news(w, v, 'Supply airdrop', 'Cargo planes will drop crates on the marked zone in 20 seconds. First come, first served.', pt[0], pt[1], -1, 'event', { event: id, phase: 'warn' });
      return { ...base, x: pt[0], y: pt[1], r: 3.5, until: w.tick + WARN + 150 * TICK_HZ, crates: [] };
    }
    case 'pilot': {
      const pt = fairPoint(w, rng, 14);
      if (!pt) return null;
      news(w, v, 'Pilot down', 'A pilot ejected over no man\'s land. The first infantry (or engineer) to reach him wins a reward, and he joins up.', pt[0], pt[1], -1, 'event', { event: id, phase: 'warn' });
      return { ...base, at: w.tick + 5 * TICK_HZ, x: pt[0], y: pt[1], r: 1.5, until: w.tick + 5 * TICK_HZ + 150 * TICK_HZ };
    }
    case 'storm': {
      if (v.storm > w.tick) return null;
      news(w, v, 'Storm front', 'A storm front reaches the battlefield in 20 seconds: every aircraft will be grounded for a minute.', -1, -1, -1, 'event', { event: id, phase: 'warn' });
      return { ...base, until: w.tick + WARN + 60 * TICK_HZ };
    }
    case 'mercs': {
      const offer = MERC_OFFERS[rng.int(0, MERC_OFFERS.length - 1)];
      const ev: BattleEvent = { ...base, phase: 'live', at: w.tick, until: w.tick + 60 * TICK_HZ, price: offer.price, squad: [...offer.squad], label: offer.label, hired: [], aiHire: {} };
      // AI commanders decide now (deterministically) whether, and when, to hire
      for (const ai of w.ais) {
        const p = ai.player;
        if (p.defeated || ai.behaviour !== 'full') continue;
        if (p.credits >= offer.price + 300 && rng.chance((0.35 + ai.d.skill * 0.4) * (ai.d.events ?? 1))) ev.aiHire![p.id] = w.tick + Math.round(rng.range(4, 40) * TICK_HZ);
      }
      news(w, v, 'Mercenaries for hire', `A mercenary company offers ${offer.label} for $${offer.price.toLocaleString('en-US')}. The offer stands for 60 seconds.`, -1, -1, -1, 'event', { event: id, phase: 'offer' });
      return ev;
    }
    case 'surge': {
      const pt = surgeField(w, rng);
      if (!pt) return null;
      news(w, v, 'Ore surge', 'Seismic readings: the marked ore field is about to surge. It will be the richest ground on the map.', pt[0], pt[1], -1, 'event', { event: id, phase: 'warn' });
      return { ...base, x: pt[0], y: pt[1], r: 5, until: w.tick + WARN + TICK_HZ };
    }
  }
}

/** The ore field most equally far from every base (and not inside one), as a point. */
function surgeField(w: World, rng: Rng): [number, number] | null {
  const m = w.map;
  const hs = homes(w);
  if (!hs.length || !m.oreFieldCells.length) return null;
  let best: [number, number] | null = null, bestScore = Infinity;
  const cells = m.oreFieldCells;
  for (let k = 0; k < 160; k++) {
    const i = cells[rng.int(0, cells.length - 1)];
    const x = (i % m.w) + 0.5, y = Math.floor(i / m.w) + 0.5;
    let lo = Infinity, hi = 0;
    for (const h of hs) { const d = Math.hypot(h.x - x, h.y - y); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    if (lo < 14) continue;
    const score = hi - lo + rng.next();
    if (score < bestScore) { bestScore = score; best = [x, y]; }
  }
  return best;
}

function start(w: World, v: VarietyState, ev: BattleEvent) {
  const rng = rngOf(v);
  switch (ev.kind) {
    case 'airdrop': {
      for (let k = 0; k < 5; k++) { const id = dropCrate(w, v, ev.x, ev.y, ev.r); if (id) ev.crates!.push(id); }
      w.sfx('plane_flyby', ev.x, ev.y);
      news(w, v, 'Crates on the ground', 'The airdrop has landed: grab the crates.', ev.x, ev.y, -1, 'event', { event: ev.id, phase: 'start' });
      break;
    }
    case 'pilot': {
      const [x, y] = w.findFreeSpot(ev.x, ev.y, 3, false);
      const u = w.addUnit('e1', v.neutral, x, y);
      u.weapons = [];
      u.stance = 'passive';
      ev.x = x; ev.y = y;
      ev.pilot = u.id;
      v.refs.set(u.id, u);
      break;
    }
    case 'storm': {
      v.storm = ev.until;
      news(w, v, 'Storm front', 'The storm has arrived: all aircraft are grounded.', -1, -1, -1, 'event', { event: ev.id, phase: 'start' });
      break;
    }
    case 'surge': {
      const m = w.map;
      const R = Math.ceil(ev.r);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = Math.floor(ev.x) + dx, y = Math.floor(ev.y) + dy;
        const d = Math.hypot(dx, dy);
        if (!m.inBounds(x, y) || d > ev.r) continue;
        const i = m.idx(x, y);
        if (m.oreField[i]) { m.setOre(i, ORE_MAX); continue; }
        const t = m.terrain[i];
        if (d > ev.r - 1 || m.tree[i] || m.occupant[i] || m.reserved[i] || (t !== T.Clear && t !== T.Sand && t !== T.Dirt) || !rng.chance(0.7)) continue;
        const gem = d < 1.6;
        m.oreField[i] = gem ? 2 : 1;
        m.oreFieldCells.push(i);
        if (gem) m.gems[i] = 1;
        m.setOre(i, gem ? 6 : rng.int(4, ORE_MAX));
        if (m.terrain[i] === T.Sand) m.terrain[i] = T.Clear;
      }
      news(w, v, 'Ore surge', 'The ore field has surged: fresh ore and gems for whoever holds it.', ev.x, ev.y, -1, 'event', { event: ev.id, phase: 'start' });
      break;
    }
    default:
      break;
  }
  keep(v, rng);
}

/** Look up an event unit (cached Unit object, also once dead and gone from the entities). */
function unitRef(w: World, v: VarietyState, id: number): Unit | undefined {
  let u = v.refs.get(id);
  if (!u) {
    const e = w.entities.get(id);
    if (e instanceof Unit) { u = e; v.refs.set(id, u); }
  }
  return u;
}

/** Owner id of whoever last hurt `u` (-1 = nobody / gone). */
function lastHitter(w: World, u: Unit): number {
  const e = u.lastAttacker ? w.entities.get(u.lastAttacker) : undefined;
  return e && e.owner.id >= 0 ? e.owner.id : -1;
}

/** Advance a live event; true when it is over. */
function update(w: World, v: VarietyState, ev: BattleEvent): boolean {
  switch (ev.kind) {
    case 'convoy': return updateConvoy(w, v, ev);
    case 'airdrop': {
      if (w.tick % 10) return false;
      const ids = new Set(w.crates.map((c) => c.id));
      ev.crates = ev.crates!.filter((id) => ids.has(id));
      if (!ev.crates.length) return true;
      if (w.tick >= ev.until) { w.crates = w.crates.filter((c) => !ev.crates!.includes(c.id)); return true; }
      return false;
    }
    case 'pilot': {
      const u = ev.pilot ? unitRef(w, v, ev.pilot) : undefined;
      if (!u || !u.alive) {
        v.refs.delete(ev.pilot ?? 0);
        const by = u ? lastHitter(w, u) : -1;
        news(w, v, 'Pilot lost', by >= 0 ? `${w.players[by]?.name ?? 'Someone'} shot the downed pilot.` : 'The downed pilot did not make it.', ev.x, ev.y, -1, 'event', { event: ev.id, phase: 'end' });
        return true;
      }
      if (w.tick % 5) return false;
      let rescuer: Unit | null = null, bestD = 1.6;
      w.grid.query(u.x, u.y, 2, (o) => {
        if (!o.alive || o.kind !== 'infantry' || o.owner.id < 0 || o.transport || o.owner.defeated) return;
        const d = Math.hypot(o.x - u.x, o.y - u.y);
        if (d < bestD) { bestD = d; rescuer = o; }
      });
      if (rescuer) {
        const p = (rescuer as Unit).owner;
        w.despawn(u);
        v.refs.delete(u.id);
        const nu = w.addUnit('e1', p, u.x, u.y);
        nu.rank = 1;
        nu.xp = 300;
        reward(w, v, p, 800, 2, `${p.name} rescued the downed pilot`, u.x, u.y, ev);
        return true;
      }
      if (w.tick >= ev.until) {
        w.despawn(u);
        v.refs.delete(u.id);
        news(w, v, 'Pilot evacuated', 'Nobody reached the downed pilot: he was picked up by his own side.', u.x, u.y, -1, 'event', { event: ev.id, phase: 'end' });
        return true;
      }
      return false;
    }
    case 'storm': {
      if (w.tick % 10 === 0) groundAircraft(w);
      if (w.tick >= ev.until) {
        v.storm = 0;
        news(w, v, 'Skies clearing', 'The storm has passed: aircraft may fly again.', -1, -1, -1, 'event', { event: ev.id, phase: 'end' });
        return true;
      }
      return false;
    }
    case 'mercs': {
      for (const [pid, at] of Object.entries(ev.aiHire ?? {})) {
        if (w.tick === at) hire(w, v, ev, w.players[+pid]);
      }
      if (w.tick >= ev.until) {
        news(w, v, 'Offer withdrawn', 'The mercenaries have moved on.', -1, -1, -1, 'event', { event: ev.id, phase: 'end' });
        return true;
      }
      return false;
    }
    case 'surge':
      return true;
  }
}

function groundAircraft(w: World) {
  for (const u of w.units) {
    if (!u.alive || u.kind !== 'aircraft' || u.owner.id < 0 || u.sortie || u.ut.passengers || u.ut.supportPlane) continue;
    if (u.order.type === 'deploy' || (u.order.type === 'idle' && isLanded(u))) continue;
    u.orderQueue.length = 0;
    w.setOrder(u, { type: 'deploy' });
  }
}

const CONVOY_TRUCKS = 3;
const TRUCK_BOUNTY = 700;
const TRUCK_FARE = 900;

function updateConvoy(w: World, v: VarietyState, ev: BattleEvent): boolean {
  const route = ev.route!;
  const [ex, ey] = route[route.length - 1];
  // trucks roll in one after another
  if (ev.spawned! < CONVOY_TRUCKS && (w.tick - ev.at) >= ev.spawned! * 50) {
    const [sx, sy] = w.findFreeSpot(route[0][0], route[0][1], 4);
    const u = w.addUnit('truk', v.neutral, sx, sy);
    u.heading = u.prevHeading = Math.atan2(route[1][1] - sy, route[1][0] - sx);
    u.stance = 'passive';
    w.giveOrder(u, { type: 'move', x: route[1][0], y: route[1][1], attackMove: false });
    w.giveOrder(u, { type: 'move', x: ex, y: ey, attackMove: false }, true);
    ev.trucks!.push(u.id);
    v.refs.set(u.id, u);
    ev.spawned!++;
    if (ev.spawned === 1) news(w, v, 'Convoy on the move', 'The supply convoy has entered the battlefield.', sx, sy, -1, 'event', { event: ev.id, phase: 'start' });
  }
  const timeUp = w.tick >= ev.until;
  for (let k = ev.trucks!.length - 1; k >= 0; k--) {
    const id = ev.trucks![k];
    const u = unitRef(w, v, id);
    if (u && u.alive) {
      const by = lastHitter(w, u);
      if (by >= 0) ev.hit![id] = by;
      if (Math.hypot(u.x - ex, u.y - ey) < 2.5 || timeUp) {
        w.despawn(u);
        ev.trucks!.splice(k, 1);
        v.refs.delete(id);
        if (timeUp) continue;
        ev.delivered!++;
        // the commander who guarded it best is paid for the delivery
        let best = -1, bestScore = 30;
        for (const [pid, s] of Object.entries(ev.esc!)) if (s > bestScore) { bestScore = s; best = +pid; }
        const p = best >= 0 ? w.players[best] : undefined;
        if (p && !p.defeated) reward(w, v, p, TRUCK_FARE, 1, `${p.name} escorted a supply truck through`, u.x, u.y, ev);
        else news(w, v, 'Truck delivered', 'A supply truck made it across unescorted: nobody is paid.', u.x, u.y, -1, 'event', { event: ev.id, phase: 'reward' });
        continue;
      }
      // keep it rolling (a blocked or idle truck gets its route again)
      if (w.tick % 100 === 0 && u.order.type === 'idle') w.giveOrder(u, { type: 'move', x: ex, y: ey, attackMove: false });
      continue;
    }
    // destroyed: the cargo goes to whoever destroyed it
    ev.trucks!.splice(k, 1);
    v.refs.delete(id);
    ev.destroyed!++;
    const by = u ? lastHitter(w, u) : -1;
    const pid = by >= 0 ? by : ev.hit![id] ?? -1;
    const p = pid >= 0 ? w.players[pid] : undefined;
    if (p && !p.defeated) reward(w, v, p, TRUCK_BOUNTY, 1, `${p.name} seized a convoy truck's cargo`, u?.x ?? ev.x, u?.y ?? ev.y, ev);
  }
  // escort score: armed units of each commander close to the trucks
  if (w.tick % 20 === 0) {
    for (const id of ev.trucks!) {
      const u = unitRef(w, v, id);
      if (!u || !u.alive) continue;
      w.grid.query(u.x, u.y, 6, (o) => {
        if (!o.alive || o.owner.id < 0 || !o.weapons.length || o.ut.harvester || Math.hypot(o.x - u.x, o.y - u.y) > 6) return;
        // escorts that shoot the convoy don't count
        if (ev.hit![id] === o.owner.id) return;
        ev.esc![o.owner.id] = (ev.esc![o.owner.id] ?? 0) + 1;
      });
    }
  }
  if (ev.spawned! >= CONVOY_TRUCKS && !ev.trucks!.length) {
    news(w, v, 'Convoy gone', `The convoy is over: ${ev.delivered} truck${ev.delivered === 1 ? '' : 's'} delivered, ${ev.destroyed} destroyed.`, ex, ey, -1, 'event', { event: ev.id, phase: 'end' });
    return true;
  }
  return false;
}

/** Credits and command points for a commander (command points only when Commander rules gave the player a PlayerCmd). */
export function reward(w: World, v: VarietyState, p: Player, credits: number, points: number, text: string, x: number, y: number, ev?: BattleEvent) {
  p.cash += credits;
  w.events.push({ e: 'credits', player: p.id, amount: credits, x, y });
  const got = grantCommandPoints(w, p, points, text);
  news(w, v, 'Reward', `${text}: +$${credits.toLocaleString('en-US')}${got ? ` and ${points} command point${points === 1 ? '' : 's'}` : ''}.`, x, y, p.id, 'event', { event: ev?.id, phase: 'reward' });
}

/**
 * Command points through the commander API (sim/commander.ts) when the player has a commander (Commander rules);
 * otherwise (Classic rules with events: never, but mods / branches may) the points are paid in credits.
 * Returns whether points were granted.
 */
export function grantCommandPoints(w: World, p: Player, n: number, reason = ''): boolean {
  if (w.commander && p.cmd) {
    doctrinePoints(w, p.id, n, reason);
    return true;
  }
  p.cash += n * 250;
  return false;
}

function hire(w: World, v: VarietyState, ev: BattleEvent, p: Player | undefined): boolean {
  if (!p || p.defeated || ev.kind !== 'mercs' || ev.phase !== 'live' || w.tick >= ev.until || ev.hired!.includes(p.id)) return false;
  if (!p.spend(ev.price!)) { w.announce(p, 'insufficient_funds', 2); return false; }
  ev.hired!.push(p.id);
  // they march in at the base
  const h = homes(w).find((x) => x.p === p);
  const bx = h?.x ?? w.map.w / 2, by = h?.y ?? w.map.h / 2;
  const toward = Math.atan2(w.map.h / 2 - by, w.map.w / 2 - bx);
  ev.squad!.forEach((t, k) => {
    const a = toward + (k - ev.squad!.length / 2) * 0.5;
    const [x, y] = w.findFreeSpot(bx + Math.cos(a) * 4.5, by + Math.sin(a) * 4.5, 5, UNITS[t].kind !== 'infantry');
    const u = w.addUnit(t, p, x, y);
    u.heading = u.prevHeading = u.turret = u.prevTurret = toward;
    p.stats.unitsBuilt++;
  });
  w.announce(p, 'reinforcements', 0);
  news(w, v, 'Mercenaries hired', `${p.name} hired the mercenaries (${ev.label}).`, bx, by, p.id, 'event', { event: ev.id, phase: 'reward' });
  return true;
}

/** 'battleEvent' command: a commander answers an event (hire the mercenaries). */
export function varietyCommand(w: World, cmd: Extract<Command, { c: 'battleEvent' }>) {
  const v = w.variety;
  const p = w.players[cmd.player];
  if (!v || !p) return;
  const ev = v.active.find((e) => e.id === cmd.event);
  if (ev && cmd.act === 'hire') hire(w, v, ev, p);
}

// =====================================================================================================
// AI and the events
// =====================================================================================================

function freeArmy(w: World, ai: World['ais'][number], x: number, y: number, range: number, max: number, infantryOnly = false): Unit[] {
  const busy = new Set<number>([...ai.wave, ...ai.raid, ...ai.flank, ...ai.escort, ...ai.repairs, ai.scout]);
  const out: Unit[] = [];
  for (const u of w.units) {
    if (!u.alive || u.owner !== ai.player || busy.has(u.id) || u.transport) continue;
    if (u.kind !== 'vehicle' && u.kind !== 'infantry') continue;
    if (infantryOnly ? u.kind !== 'infantry' : !u.weapons.length) continue;
    if (u.ut.harvester || u.ut.deploysInto || (u.ut.engineer && !infantryOnly) || u.ut.minelayer) continue;
    if (u.order.type !== 'idle' && u.order.type !== 'guard') continue;
    if (Math.hypot(u.x - x, u.y - y) > range) continue;
    out.push(u);
  }
  out.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || a.id - b.id);
  return out.slice(0, max);
}

function aiEvents(w: World, v: VarietyState) {
  for (const ev of v.active) {
    if (ev.phase !== 'live') continue;
    for (const ai of w.ais) {
      const p = ai.player;
      if (p.defeated || ai.behaviour !== 'full') continue;
      // (easier levels sit most events out: a fixed share, decided per event and player)
      if (((ev.id * 37 + p.id * 61) % 100) / 100 >= (ai.d.events ?? 1)) continue;
      if (ev.kind === 'convoy') {
        const trucks = ev.trucks!.map((id) => w.entities.get(id)).filter((u): u is Unit => u instanceof Unit && u.alive);
        if (!trucks.length) continue;
        let plan = ev.aiPlan![p.id];
        if (!plan) {
          const agg = ai.personality.aggression ?? 0.5;
          plan = ev.aiPlan![p.id] = ((ev.id * 7 + p.id * 13) % 100) / 100 < 0.35 + agg * 0.4 ? 'ambush' : 'escort';
        }
        const lead = trucks[0];
        const squad = freeArmy(w, ai, lead.x, lead.y, 40, 5);
        if (!squad.length) continue;
        if (plan === 'ambush') w.issue({ c: 'attack', player: p.id, units: squad.map((u) => u.id), target: lead.id, forced: true });
        else w.issue({ c: 'guard', player: p.id, units: squad.map((u) => u.id), target: lead.id });
      } else if (ev.kind === 'airdrop') {
        const squad = freeArmy(w, ai, ev.x, ev.y, 45, 3);
        if (squad.length) w.issue({ c: 'move', player: p.id, units: squad.map((u) => u.id), x: ev.x, y: ev.y, attackMove: true });
      } else if (ev.kind === 'pilot') {
        const squad = freeArmy(w, ai, ev.x, ev.y, 45, 1, true);
        if (squad.length) w.issue({ c: 'move', player: p.id, units: squad.map((u) => u.id), x: ev.x, y: ev.y });
      }
    }
  }
}

// =====================================================================================================
// Dynamic difficulty
// =====================================================================================================

export const DYN_STEP = { income: 0.06, build: 0.05, wave: 0.06 };
export const DYN_MAX = 4;

/** Army (+ some structure) value of a commander: what dynamic difficulty compares. */
function strength(w: World, p: Player): number {
  let v = 0;
  for (const u of w.units) if (u.alive && u.owner === p && u.weapons.length && !u.ut.harvester) v += u.ut.cost * u.healthFrac;
  for (const b of w.buildings) if (b.alive && b.owner === p && !b.bt.wall && !b.bt.mine && !b.bt.tech) v += b.bt.cost * 0.35;
  return v;
}

function dynamicTick(w: World, v: VarietyState) {
  const humans = w.players.filter((p) => p.isHuman && !p.defeated);
  const aiPlayers = w.ais.filter((a) => !a.player.defeated && !humans.some((h) => !h.isEnemy(a.player)));
  if (!humans.length || !aiPlayers.length) return;
  let hs = 0, as = 0;
  for (const p of humans) {
    const i = p.id;
    const harv = p.stats.harvested - (v.dd.harv[i] ?? 0);
    v.dd.harv[i] = p.stats.harvested;
    hs += strength(w, p) + harv * 0.5;
  }
  for (const a of aiPlayers) {
    const i = a.player.id;
    const harv = a.player.stats.harvested - (v.dd.harv[i] ?? 0);
    v.dd.harv[i] = a.player.stats.harvested;
    as += strength(w, a.player) + harv * 0.5;
  }
  hs /= humans.length;
  as /= aiPlayers.length;
  if (w.time < 120) return; // let the openings play out
  const ratio = (hs + 1500) / (as + 1500);
  let level = v.dd.level;
  if (ratio > 1.3) level++;
  else if (ratio < 0.77) level--;
  else if (ratio > 0.9 && ratio < 1.1) level -= Math.sign(level);
  level = Math.max(-DYN_MAX, Math.min(DYN_MAX, level));
  // assist only against recruit and easy opponents: it eases off a struggling commander, never pushes harder
  if (level > 0 && aiPlayers.every((a) => a.difficulty === 'recruit' || a.difficulty === 'easy')) level = 0;
  if (level === v.dd.level) return;
  const was = v.dd.level;
  v.dd.level = level;
  const wave = 1 - DYN_STEP.wave * level;
  for (const a of aiPlayers) {
    const i = a.player.id;
    const [mi, mb] = v.mult[i] ?? [1, 1];
    const [bi, bb] = [mi / (1 + DYN_STEP.income * was), mb / (1 + DYN_STEP.build * was)];
    setMult(v, a.player, i, bi * (1 + DYN_STEP.income * level), bb * (1 + DYN_STEP.build * level));
    a.nextWaveValue = Math.max(1200, Math.round(a.nextWaveValue * (wave / v.dd.wave)));
  }
  v.dd.wave = wave;
  const pct = Math.round(DYN_STEP.income * level * 100);
  news(w, v, 'Dynamic difficulty', level > was
    ? `You are pulling ahead: the enemy pushes harder (economy ${pct >= 0 ? '+' : ''}${pct}%).`
    : `The enemy eases off (economy ${pct >= 0 ? '+' : ''}${pct}%).`, -1, -1, -1, 'dyn');
}

/** UI summary of dynamic difficulty: level -4..4 and the AI economy change in percent. */
export function dynamicStatus(w: World): { on: boolean; level: number; pct: number } {
  const v = w.variety;
  if (!v?.dyn) return { on: false, level: 0, pct: 0 };
  return { on: true, level: v.dd.level, pct: Math.round(DYN_STEP.income * v.dd.level * 100) };
}

// =====================================================================================================
// Save / load
// =====================================================================================================

/** Serialisable state (everything but the neutral player and the unit cache), plus the economy multipliers. */
export function saveVariety(w: World): unknown {
  const v = w.variety;
  if (!v) return undefined;
  const { neutral: _n, refs: _r, ...rest } = v;
  return JSON.parse(JSON.stringify({ ...rest, econ: w.players.map((p) => [p.incomeBias, p.buildSpeed]) }));
}

/**
 * Restore the variety state of a saved world (deserializeWorld, after the AI restored its difficulty economy).
 * Creates the state if the World was built without it (a branch / challenge setup that lost its options).
 */
export function loadVariety(w: World, s: unknown) {
  if (!s || typeof s !== 'object') { w.variety = null; return; }
  const d = JSON.parse(JSON.stringify(s)) as Partial<VarietyState> & { econ?: [number, number][] };
  const neutral = w.variety?.neutral ?? makeNeutral(w);
  const base = w.variety ?? blank(w, { rules: d.rules ?? 'classic', mutators: d.mutators ?? [], events: !!d.events, dyn: !!d.dyn, seed: 1 });
  const v: VarietyState = { ...base, ...d, neutral, refs: new Map() } as VarietyState;
  delete (v as { econ?: unknown }).econ;
  w.variety = v;
  // the AI restored its difficulty's economy: put back what was in force (variety and anything else)
  d.econ?.forEach(([inc, bld], i) => {
    const p = w.players[i];
    if (p && typeof inc === 'number' && typeof bld === 'number') { p.incomeBias = inc; p.buildSpeed = bld; }
  });
  // neutral structures: the owner counts of the neutral player
  neutral.owned.clear();
  for (const b of w.buildings) if (b.owner === neutral && b.counted) neutral.owned.set(b.bt.id, (neutral.owned.get(b.bt.id) ?? 0) + 1);
}

/** The neutral player of a world being loaded (save.ts: entities owned by player -1). */
export function neutralOwner(w: World, saved: unknown): Player {
  if (!w.variety) {
    const d = (saved ?? {}) as Partial<VarietyState>;
    w.variety = blank(w, { rules: d.rules ?? 'commander', mutators: d.mutators ?? [], events: !!d.events, dyn: !!d.dyn, seed: 1 });
  }
  return w.variety.neutral;
}

/** Briefing line of a match's variety options (loading card, HUD tooltip). */
export function varietySummary(v: Pick<VarietyState, 'rules' | 'mutators' | 'events' | 'dyn'>): string {
  const parts = [v.rules === 'commander' ? 'Commander rules' : 'Classic rules'];
  if (v.events) parts.push('battlefield events');
  if (v.dyn) parts.push('dynamic difficulty');
  const m = mutatorNames(v.mutators);
  if (m.length) parts.push(m.join(', '));
  return parts.join(' · ');
}

/** Start a battlefield event of this kind now (tests, screenshots, debugging). Null when it can't be planned here. */
export function triggerEvent(w: World, kind: BattleEventKind): BattleEvent | null {
  const v = w.variety;
  if (!v) return null;
  const rng = rngOf(v);
  const ev = plan(w, v, kind, rng);
  keep(v, rng);
  if (ev) { v.active.push(ev); v.count++; }
  return ev;
}
