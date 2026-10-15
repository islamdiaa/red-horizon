// Shared helpers for headless QA tests. Run tests with: node --import tsx tools/qa/<name>.ts
import { GameMap, T } from '../../src/sim/map';
import { generateMap } from '../../src/sim/mapgen';
import { World, type PlayerSetup } from '../../src/sim/world';
import { TICK_HZ, DT, type Command } from '../../src/sim/types';
import { Building, Unit, type Entity } from '../../src/sim/entities';
import type { Player } from '../../src/sim/player';
import type { Faction } from '../../src/data/rules';
import type { AIDifficulty } from '../../src/sim/ai';

export { TICK_HZ, DT, World, Building, Unit, GameMap, T, generateMap };
export type { Entity, Player, Command };

// ---------------------------------------------------------------------------
// Result reporting
// ---------------------------------------------------------------------------
export interface CheckResult { name: string; ok: boolean; detail: string }
export const results: CheckResult[] = [];

export function check(name: string, ok: boolean, detail = ''): boolean {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
  return ok;
}
export function info(msg: string) {
  console.log(`      ${msg}`);
}
export function summary(): number {
  const fail = results.filter((r) => !r.ok);
  console.log(`\n== ${results.length - fail.length}/${results.length} checks passed`);
  for (const f of fail) console.log(`   FAILED: ${f.name}  ${f.detail}`);
  return fail.length;
}

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------
/** A flat, open map (all clear terrain). Optional rectangular ore patches. */
export function flatMap(w = 48, h = 48, opts: { starts?: { x: number; y: number }[] } = {}): GameMap {
  const m = new GameMap(w, h);
  m.startPositions = opts.starts ?? [{ x: 8.5, y: h - 8.5 }, { x: w - 8.5, y: 8.5 }];
  return m;
}

export function addOre(m: GameMap, x0: number, y0: number, x1: number, y1: number, bails = 9, gems = false) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = m.idx(x, y);
    m.oreField[i] = gems ? 2 : 1;
    m.ore[i] = bails;
    m.gems[i] = gems ? 1 : 0;
    m.oreFieldCells.push(i);
  }
}

export function setTerrain(m: GameMap, x0: number, y0: number, x1: number, y1: number, t: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.terrain[m.idx(x, y)] = t;
}
export function addTrees(m: GameMap, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.tree[m.idx(x, y)] = 1;
}

export interface QaPlayer { faction: Faction; ai?: AIDifficulty; human?: boolean; team?: number }

export function makeWorld(map: GameMap, players: QaPlayer[] = [{ faction: 'allies', human: true }, { faction: 'soviet' }], opts: { credits?: number; fog?: boolean; seed?: number; keepStart?: boolean; startUnits?: 'mcv' | 'light' | 'heavy' } = {}): World {
  const setups: PlayerSetup[] = players.map((p, i) => ({ name: `P${i}`, faction: p.faction, color: 0xffffff, team: p.team ?? i, isHuman: !!p.human, ai: p.ai }));
  const w = new World({ map, players: setups, credits: opts.credits ?? 10000, startUnits: opts.startUnits ?? 'mcv', fog: opts.fog ?? false, seed: opts.seed ?? 1 });
  w.cratesEnabled = false;
  if (!opts.keepStart) removeAllUnits(w);
  return w;
}

/** Remove all units silently (no stats, no events). */
export function removeAllUnits(w: World) {
  for (const u of w.units) { u.alive = false; w.entities.delete(u.id); }
  w.units.length = 0;
}

/** Remove an entity silently. */
export function remove(w: World, e: Entity) {
  e.alive = false;
  w.entities.delete(e.id);
  if (e instanceof Unit) w.units = w.units.filter((u) => u !== e);
}

/** Instantly complete a building at cell (cx, cy). If `complete`, run its completion logic (free units etc.). */
export function building(w: World, p: Player, type: string, cx: number, cy: number, complete = true): Building {
  const b = w.addBuilding(type, p, cx, cy, false);
  if (complete) {
    b.buildAnim = 0.999;
    (w as any).updateBuilding(b); // triggers onBuildingComplete
  }
  return b;
}

export function unit(w: World, p: Player, type: string, x: number, y: number, heading = 0): Unit {
  const u = w.addUnit(type, p, x, y);
  u.heading = u.prevHeading = u.turret = u.prevTurret = heading;
  return u;
}

export function stepN(w: World, n: number, each?: (t: number) => boolean | void) {
  for (let t = 0; t < n; t++) {
    w.step();
    w.events.length = 0;
    if (each && each(t) === true) return t;
  }
  return n;
}
export function run(w: World, seconds: number, each?: (t: number) => boolean | void) {
  return stepN(w, Math.round(seconds * TICK_HZ), each);
}
/** Step until predicate is true or timeout; returns seconds elapsed or -1. */
export function until(w: World, maxSeconds: number, pred: () => boolean, collectEvents?: (ev: any) => void): number {
  const n = Math.round(maxSeconds * TICK_HZ);
  for (let t = 0; t < n; t++) {
    w.step();
    if (collectEvents) for (const e of w.events) collectEvents(e);
    w.events.length = 0;
    if (pred()) return (t + 1) / TICK_HZ;
  }
  return -1;
}

/** Step and collect all events. */
export function runCollect(w: World, seconds: number): any[] {
  const out: any[] = [];
  const n = Math.round(seconds * TICK_HZ);
  for (let t = 0; t < n; t++) {
    w.step();
    out.push(...w.events);
    w.events.length = 0;
  }
  return out;
}

export const alive = (e: Entity | undefined | null) => !!e && e.alive;
export const cell = (u: { x: number; y: number }) => `(${u.x.toFixed(2)},${u.y.toFixed(2)})`;

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------
export interface InvariantIssue { kind: string; detail: string }

export function invariants(w: World): InvariantIssue[] {
  const out: InvariantIssue[] = [];
  const m = w.map;
  for (const p of w.players) {
    if (!Number.isFinite(p.cash) || !Number.isFinite(p.ore)) out.push({ kind: 'nan-credits', detail: `${p.name} cash=${p.cash} ore=${p.ore}` });
    if (p.cash < -0.01) out.push({ kind: 'negative-cash', detail: `${p.name} cash=${p.cash.toFixed(2)}` });
    if (p.ore < -0.01) out.push({ kind: 'negative-ore', detail: `${p.name} ore=${p.ore}` });
    if (p.ore > p.storage + 0.01) out.push({ kind: 'ore-over-storage', detail: `${p.name} ore=${p.ore} storage=${p.storage}` });
  }
  for (const u of w.units) {
    if (!u.alive) continue;
    if (!Number.isFinite(u.x) || !Number.isFinite(u.y) || !Number.isFinite(u.hp)) out.push({ kind: 'nan-unit', detail: `${u.ut.id}#${u.id} ${u.x},${u.y} hp=${u.hp}` });
    if (u.hp > u.maxHp + 0.01) out.push({ kind: 'hp-over-max', detail: `${u.ut.id}#${u.id} hp=${u.hp}/${u.maxHp}` });
    if (u.x < 0 || u.y < 0 || u.x > m.w || u.y > m.h) out.push({ kind: 'out-of-bounds', detail: `${u.ut.id}#${u.id} ${cell(u)}` });
    if (u.kind !== 'aircraft' || u.altitude < 0.05) {
      const cx = Math.floor(u.x), cy = Math.floor(u.y);
      if (m.inBounds(cx, cy)) {
        const i = m.idx(cx, cy);
        const occ = m.occupant[i];
        if (occ && !m.passableOverride[i] && occ !== u.exitBuilding) {
          const b = w.entities.get(occ) as Building | undefined;
          // aircraft landed on their own pad are fine
          const onPad = u.kind === 'aircraft' && b && b.bt.factory === 'aircraft';
          if (!onPad) out.push({ kind: 'unit-in-building', detail: `${u.ut.id}#${u.id} ${cell(u)} inside ${b?.bt.id}#${occ}` });
        }
        if (u.kind !== 'aircraft' && !m.terrainPassable(i)) out.push({ kind: 'unit-in-terrain', detail: `${u.ut.id}#${u.id} ${cell(u)} terrain=${m.terrain[i]} tree=${m.tree[i]}` });
      }
    }
    if (u.transport) out.push({ kind: 'passenger-in-units', detail: `${u.ut.id}#${u.id}` });
  }
  for (const b of w.buildings) {
    if (!b.alive) continue;
    if (!Number.isFinite(b.hp)) out.push({ kind: 'nan-building', detail: `${b.bt.id}#${b.id}` });
    if (b.hp > b.maxHp + 0.01) out.push({ kind: 'hp-over-max', detail: `${b.bt.id}#${b.id} hp=${b.hp}/${b.maxHp}` });
  }
  for (const pr of w.projectiles) if (pr.alive && (!Number.isFinite(pr.x) || !Number.isFinite(pr.y))) out.push({ kind: 'nan-projectile', detail: `${pr.weapon.id}` });
  return out;
}

export function fmtTime(sec: number) {
  if (sec < 0) return 'never';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
