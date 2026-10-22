/**
 * King of the Hill (skirmish option): a hill zone near the map centre. A team with units on it while no
 * other team has any accumulates hill time; enemies inside contest it (nobody scores). First team to the
 * target wins; wiping everybody else out still wins too.
 *
 * Runs as MissionRuntime scripting inside the deterministic tick (state in m.flags.koth, JSON), so it is
 * saved, replayed and branched with the world. AI players contest the hill through "hill squads": a share of
 * each AI's ground army is attack-moved onto the hill and kept there; no hook into src/sim/ai*.ts.
 */
import { floodReach } from '../sim/mapgen';
import type { MissionRuntime } from '../sim/mission';
import type { Unit } from '../sim/entities';
import type { World } from '../sim/world';
import { TICK_HZ } from '../sim/types';
import type { KothState } from './types';
import { MODES_EN, fillEn as en } from './text';

// Objectives and radio lines run inside the simulation: English (src/modes/text.ts), translated where shown (trSource).
const K = MODES_EN.koth;

export const KOTH_MINUTES = [2, 3, 5, 8];
export const KOTH_DEFAULT_MINUTES = 5;
/** Ticks between hill checks (4 per second). */
export const KOTH_CHECK = 5;
/** Seconds before the AI starts sending hill squads. */
const SQUAD_DELAY = 30;

/** Curated maps can pin their hill (MapDef.hill or this table: [x, y, r] in cells). */
const HILLS: Record<string, [number, number, number]> = {};

export function hillRadius(mapW: number): number {
  return Math.round((3.5 + mapW / 40) * 2) / 2;
}

/**
 * The hill: the open, passable spot reachable from every base that is fairest (most equidistant from the
 * starts), preferring the map centre. Deterministic (map only).
 */
export function findHill(world: World, mapId?: string, defHill?: [number, number, number]): { x: number; y: number; r: number } {
  const pinned = defHill ?? (mapId ? HILLS[mapId] : undefined);
  if (pinned) return { x: pinned[0], y: pinned[1], r: pinned[2] };
  const map = world.map;
  const r = hillRadius(map.w);
  const starts = map.startPositions.slice(0, Math.max(1, world.players.length));
  const reach = starts.map((s) => floodReach(map, Math.floor(s.x), Math.floor(s.y)));
  const cx = map.w / 2, cy = map.h / 2;
  const R = Math.ceil(r);
  const pick = (needReach: boolean) => {
    let best: { x: number; y: number } | null = null, bestScore = Infinity;
    for (let y = R + 1; y < map.h - R - 1; y++) {
      for (let x = R + 1; x < map.w - R - 1; x++) {
        if (!map.passable(x, y)) continue;
        const i = map.idx(x, y);
        if (needReach && !reach.every((rc) => rc[i])) continue;
        const px = x + 0.5, py = y + 0.5;
        // cheap pre-filter: far from the centre can't win
        const dc = Math.hypot(px - cx, py - cy);
        if (dc * 0.35 > bestScore) continue;
        let lo = Infinity, hi = -Infinity;
        for (const s of starts) { const d = Math.hypot(px - s.x, py - s.y); lo = Math.min(lo, d); hi = Math.max(hi, d); }
        let open = 0, n = 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          n++;
          if (map.passable(x + dx, y + dy)) open++;
        }
        const score = (hi - lo) + 0.35 * dc + (1 - open / n) * 14;
        if (score < bestScore) { bestScore = score; best = { x: px, y: py }; }
      }
    }
    return best;
  };
  const at = pick(true) ?? pick(false) ?? { x: cx, y: cy };
  // a symmetric map with an obstacle in the middle (lake, rocks): no single open spot is fair, so the hill
  // is the centre itself, widened until it takes in enough ground every base can reach
  const spread = (x: number, y: number) => {
    let lo = Infinity, hi = -Infinity;
    for (const s of starts) { const d = Math.hypot(x - s.x, y - s.y); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    return hi - lo;
  };
  if (starts.length > 1 && spread(at.x, at.y) > Math.max(6, map.w * 0.06) && spread(cx, cy) < 2) {
    for (let rr = r; rr <= r + 9; rr += 0.5) {
      const RR = Math.ceil(rr);
      let open = 0, n = 0;
      for (let dy = -RR; dy <= RR; dy++) for (let dx = -RR; dx <= RR; dx++) {
        if (dx * dx + dy * dy > rr * rr) continue;
        n++;
        const x = Math.floor(cx + dx), y = Math.floor(cy + dy);
        if (map.inBounds(x, y) && map.passable(x, y) && reach.every((rc) => rc[map.idx(x, y)])) open++;
      }
      if (open >= n * 0.3) return { x: cx, y: cy, r: rr };
    }
  }
  return { x: at.x, y: at.y, r };
}

/** Open cells on the hill that every base can reach, nearest the centre first (where AI squads stand). */
function hillSpots(world: World, hill: { x: number; y: number; r: number }): [number, number][] {
  const map = world.map;
  const starts = map.startPositions.slice(0, Math.max(1, world.players.length));
  const reach = starts.map((s) => floodReach(map, Math.floor(s.x), Math.floor(s.y)));
  const out: [number, number, number][] = [];
  const R = Math.ceil(hill.r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = Math.floor(hill.x + dx), y = Math.floor(hill.y + dy);
    if (!map.inBounds(x, y) || !map.passable(x, y)) continue;
    const d = Math.hypot(x + 0.5 - hill.x, y + 0.5 - hill.y);
    if (d > hill.r * 0.8 || !reach.every((rc) => rc[map.idx(x, y)])) continue;
    out.push([x + 0.5, y + 0.5, d]);
  }
  out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  // spread them out: every other cell of the nearest ones
  return out.filter((_, i) => i % 2 === 0).slice(0, 40).map(([x, y]) => [x, y]);
}

/** Units that hold (or contest) the hill: anything on the ground or water that is not a harvester / MCV. */
export function hillUnit(u: Unit): boolean {
  return u.alive && u.kind !== 'aircraft' && !u.transport && !u.parachute && !u.ut.harvester && !u.ut.deploysInto && !u.owner.defeated;
}

/** Armed ground units an AI can send to the hill. */
function squadUnit(u: Unit): boolean {
  return hillUnit(u) && u.weapons.length > 0 && (u.kind === 'infantry' || u.kind === 'vehicle');
}

export function teamName(world: World, team: number): string {
  const ps = world.players.filter((p) => p.team === team);
  return ps.map((p) => p.name).join(' & ') || en(K.team, { n: String(team + 1) });
}

const fmt = (ticks: number) => {
  const s = Math.max(0, Math.round(ticks / TICK_HZ));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Start King of the Hill on a fresh world. */
export function kothSetup(m: MissionRuntime, minutes: number, mapId?: string, defHill?: [number, number, number]) {
  const w = m.world;
  const hill = findHill(w, mapId, defHill);
  const target = Math.round(Math.max(0.5, minutes) * 60 * TICK_HZ);
  const held: Record<string, number> = {};
  for (const p of w.players) held[p.team] = 0;
  const st: KothState = { x: hill.x, y: hill.y, r: hill.r, target, held, holder: -1, contested: false, present: [], squads: {}, last: -1, warned: {}, spots: hillSpots(w, hill) };
  m.flags.koth = st;
  m.flags.kothMsgT = -1e9;
  for (const p of w.players) m.reveal(p, hill.x, hill.y, hill.r + 3);
  m.objective('hill', en(K.objective, { time: fmt(target) }));
  m.say(MODES_EN.speaker.battleControl, en(K.intro, { time: fmt(target) }), 'eva');
}

/** Called every tick by the mode runtime. */
export function kothUpdate(m: MissionRuntime) {
  const st = m.flags.koth as KothState | undefined;
  const w = m.world;
  if (!st || m.ended || w.gameOver) return;
  const t = w.tick;
  if (m.human.defeated) {
    // (before the runtime's own "all forces lost": the winner is the surviving team with the most hill time)
    let best = -1, bestHeld = -1;
    const alive = [...new Set(w.players.filter((p) => !p.defeated).map((p) => p.team))].sort((a, b) => a - b);
    for (const team of alive) if ((st.held[team] ?? 0) > bestHeld) { bestHeld = st.held[team] ?? 0; best = team; }
    end(m, best, MODES_EN.challenge.reason.allLost);
    return;
  }
  if (t % KOTH_CHECK === 0) {
    const present = new Set<number>();
    for (const u of w.units) if (hillUnit(u) && Math.hypot(u.x - st.x, u.y - st.y) <= st.r) present.add(u.owner.team);
    const teams = [...present].sort((a, b) => a - b);
    st.present = teams;
    st.contested = teams.length > 1;
    const holder = teams.length === 1 ? teams[0] : -1;
    if (holder >= 0) st.held[holder] = (st.held[holder] ?? 0) + KOTH_CHECK;
    if (holder !== st.holder) {
      if (holder >= 0 && holder !== st.last) announceCapture(m, st, holder);
      st.holder = holder;
      if (holder >= 0) st.last = holder;
    }
    if (holder >= 0) {
      warn(m, st, holder);
      if (st.held[holder] >= st.target) {
        end(m, holder, holder === m.human.team ? en(K.youHeld, { time: fmt(st.target) }) : en(K.theyHeld, { team: teamName(w, holder), time: fmt(st.target) }));
        return;
      }
    }
  }
  if (t % TICK_HZ === 0) {
    // elimination (checkVictory flags the defeated earlier in this tick but leaves victory to the runtime)
    const alive = new Set(w.players.filter((p) => !p.defeated).map((p) => p.team));
    if (alive.size <= 1) {
      const team = alive.size ? [...alive][0] : -1;
      end(m, team, team === m.human.team ? MODES_EN.challenge.reason.enemiesDestroyed : MODES_EN.challenge.reason.overrun);
      return;
    }
  }
  if (t % KOTH_CHECK === 2) squads(m, st);
}

function end(m: MissionRuntime, team: number, reason: string) {
  if (m.ended) return;
  const won = team >= 0 && team === m.human.team;
  m.ended = true;
  m.won = won;
  m.endReason = reason;
  for (const o of m.objectives) if (o.primary && o.state === 'active') o.state = won ? 'done' : 'failed';
  m.events.push({ e: 'end', won, reason });
  m.world.endGame(team);
}

function message(m: MissionRuntime, text: string, force = false) {
  const t = m.world.tick;
  if (!force && t - (m.flags.kothMsgT ?? -1e9) < TICK_HZ * 12) return;
  m.flags.kothMsgT = t;
  m.say(MODES_EN.speaker.battleControl, text, 'eva');
}

function announceCapture(m: MissionRuntime, st: KothState, team: number) {
  if (team === m.human.team) message(m, K.weHold);
  else message(m, en(K.taken, { team: teamName(m.world, team) }));
  if (team !== m.human.team) m.announce('base_under_attack');
  void st;
}

function warn(m: MissionRuntime, st: KothState, team: number) {
  if (team === m.human.team) return;
  const f = st.held[team] / st.target;
  const step = f >= 0.9 ? 3 : f >= 0.75 ? 2 : f >= 0.5 ? 1 : 0;
  if (step > (st.warned[team] ?? 0)) {
    st.warned[team] = step;
    message(m, en(K.warning, { team: teamName(m.world, team), held: fmt(st.held[team]), target: fmt(st.target) }), true);
  }
}

/** How much of its army an AI level commits to the hill, relative to Normal (tools/campaign-koth.ts). */
const HILL_EFFORT: Record<string, number> = { recruit: 0.8, easy: 0.9, normal: 1, hard: 1.25, brutal: 1.4 };

/** Share of an AI's ground army (by value) assigned to the hill. */
function squadShare(st: KothState, team: number): number {
  let lead = 0;
  for (const [k, v] of Object.entries(st.held)) if (+k !== team) lead = Math.max(lead, v / st.target);
  if (lead >= 0.6) return 0.8;
  if (st.holder >= 0 && st.holder !== team) return 0.65;
  if (st.contested) return 0.6;
  return 0.45;
}

/** Point k of a squad's spread inside the hill. */
function spot(st: KothState, k: number): [number, number] {
  if (st.spots?.length) return st.spots[k % st.spots.length];
  const a = k * 2.399963, rr = Math.min(st.r * 0.6, 0.6 + 0.55 * Math.sqrt(k));
  return [st.x + Math.cos(a) * rr, st.y + Math.sin(a) * rr];
}

/** AI hill squads: assign every second, keep their orders on the hill every KOTH_CHECK ticks. */
function squads(m: MissionRuntime, st: KothState) {
  const w = m.world;
  if (w.time < SQUAD_DELAY) return;
  const assign = w.tick % TICK_HZ === 2;
  for (const ai of w.ais) {
    const p = ai.player;
    if (p.defeated || p.isHuman || p.id === m.humanId) continue;
    const key = String(p.id);
    let squad: Unit[] = [];
    for (const id of st.squads[key] ?? []) {
      const u = w.getEntity(id) as Unit | undefined;
      if (u && u.alive && u.owner === p && squadUnit(u)) squad.push(u);
    }
    if (assign) {
      const army = w.units.filter((u) => u.owner === p && squadUnit(u));
      const total = army.reduce((s, u) => s + u.ut.cost, 0);
      let have = squad.reduce((s, u) => s + u.ut.cost, 0);
      // (the AI's level sets how hard it contests the hill: Recruit sends a smaller squad, Hard and Brutal a larger one)
      const want = Math.min(0.9, squadShare(st, p.team) * (HILL_EFFORT[ai.difficulty] ?? 1)) * total;
      if (have < want && army.length >= 2) {
        const inSquad = new Set(squad.map((u) => u.id));
        const free = army.filter((u) => !inSquad.has(u.id)).sort((a, b) => {
          const ia = a.order.type === 'idle' || a.order.type === 'guard' ? 0 : 1, ib = b.order.type === 'idle' || b.order.type === 'guard' ? 0 : 1;
          return ia - ib || Math.hypot(a.x - st.x, a.y - st.y) - Math.hypot(b.x - st.x, b.y - st.y) || a.id - b.id;
        });
        for (const u of free) {
          if (have >= want) break;
          squad.push(u);
          have += u.ut.cost;
        }
      }
      st.squads[key] = squad.map((u) => u.id);
    }
    squad.forEach((u, k) => {
      const o = u.order;
      const d = Math.hypot(u.x - st.x, u.y - st.y);
      let ok: boolean;
      if (o.type === 'move') ok = Math.hypot(o.x - st.x, o.y - st.y) <= st.r;
      else if (o.type === 'attack') {
        const tg = w.getEntity(o.target);
        ok = !!tg && tg.alive && Math.hypot(tg.x - st.x, tg.y - st.y) <= st.r + 10 && d <= st.r + 12;
      } else ok = d <= st.r * 0.9 && (o.type === 'idle' || o.type === 'guard');
      if (!ok) {
        const [x, y] = spot(st, k);
        w.giveOrder(u, { type: 'move', x, y, attackMove: true });
      }
    });
  }
}

/** Hill time in seconds per team, sorted by most held (for HUDs and end screens). */
export function kothStandings(world: World, st: KothState): { team: number; name: string; color: number; seconds: number; frac: number; defeated: boolean }[] {
  const teams = [...new Set(world.players.map((p) => p.team))];
  return teams.map((team) => {
    const ps = world.players.filter((p) => p.team === team);
    const held = st.held[team] ?? 0;
    return { team, name: teamName(world, team), color: ps[0]?.color ?? 0xffffff, seconds: held / TICK_HZ, frac: Math.min(1, held / st.target), defeated: ps.every((p) => p.defeated) };
  }).sort((a, b) => b.seconds - a.seconds || a.team - b.team);
}
