// A* pathfinding: straight paths, detours, unreachable goals, corner cutting, optimality.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GameMap, T } from '../src/sim/map';
import { PathFinder, type PathPoint } from '../src/sim/pathfinding';
import { paint } from './helpers';

const open = (w = 32, h = 32) => new GameMap(w, h);

/** Polyline length from the start cell centre through all waypoints. */
function pathLength(sx: number, sy: number, path: PathPoint[]): number {
  let len = 0, x = sx + 0.5, y = sy + 0.5;
  for (const p of path) { len += Math.hypot(p.x - x, p.y - y); x = p.x; y = p.y; }
  return len;
}

/**
 * Every point along every segment, widened by `r` to both sides, must stay in passable
 * cells: a unit following the path never clips a blocked cell or squeezes past a corner.
 */
function assertClear(m: GameMap, sx: number, sy: number, path: PathPoint[], r = 0.3) {
  let x = sx + 0.5, y = sy + 0.5;
  for (const p of path) {
    const dx = p.x - x, dy = p.y - y, len = Math.hypot(dx, dy);
    const nx = len ? (-dy / len) * r : 0, ny = len ? (dx / len) * r : 0;
    for (let s = 0; s <= Math.ceil(len * 20); s++) {
      const t = len ? s / Math.ceil(len * 20) : 1;
      for (const o of [-1, 0, 1]) {
        const qx = x + dx * t + nx * o, qy = y + dy * t + ny * o;
        assert.ok(m.passable(Math.floor(qx), Math.floor(qy)), `segment (${x},${y})->(${p.x},${p.y}) touches blocked cell (${Math.floor(qx)},${Math.floor(qy)})`);
      }
    }
    x = p.x; y = p.y;
  }
}

/** Reference Dijkstra over the same 8-connected, no-corner-cutting grid graph. */
function gridDistance(m: GameMap, sx: number, sy: number, tx: number, ty: number): number {
  const n = m.w * m.h, dist = new Float64Array(n).fill(Infinity), done = new Uint8Array(n);
  dist[m.idx(sx, sy)] = 0;
  for (;;) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; best = i; }
    if (best < 0) return Infinity;
    if (best === m.idx(tx, ty)) return bd;
    done[best] = 1;
    const x = best % m.w, y = (best / m.w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!m.passable(nx, ny)) continue;
      if (dx && dy && (!m.passable(x + dx, y) || !m.passable(x, y + dy))) continue;
      const nd = bd + (dx && dy ? Math.SQRT2 : 1);
      const j = m.idx(nx, ny);
      if (nd < dist[j]) dist[j] = nd;
    }
  }
}

describe('PathFinder', () => {
  test('open ground: a single straight waypoint at the goal cell centre', () => {
    const m = open();
    const path = new PathFinder(m).find(2, 2, 20, 9)!;
    assert.ok(path, "path");
    assert.deepEqual(path, [{ x: 20.5, y: 9.5 }]);
  });

  test('start == goal returns the goal itself', () => {
    const m = open();
    assert.deepEqual(new PathFinder(m).find(5, 5, 5, 5), [{ x: 5.5, y: 5.5 }]);
  });

  test('detours around a rock wall through the only gap and stays clear of it', () => {
    const m = open();
    paint(m, 15, 0, 16, 31, T.Rock);
    // gap at the bottom
    paint(m, 15, 27, 16, 28, T.Clear);
    const pf = new PathFinder(m);
    const path = pf.find(3, 5, 28, 5)!;
    assert.ok(path && path.length >= 2, 'multi-segment detour');
    const last = path[path.length - 1];
    assert.deepEqual([last.x, last.y], [28.5, 5.5]);
    assertClear(m, 3, 5, path);
    // goes through the gap
    assert.ok(path.some((p) => p.y > 25), 'passes the gap');
    // string-pulled path is no longer than the optimal grid path
    const opt = gridDistance(m, 3, 5, 28, 5);
    const len = pathLength(3, 5, path);
    assert.ok(len <= opt * 1.002 + 1e-6, `smoothed ${len.toFixed(2)} <= grid optimum ${opt.toFixed(2)}`);
    assert.ok(len >= Math.hypot(25, 0), "len >= Math.hypot(25, 0)");
  });

  test('trees and water block movement like rock', () => {
    const m = open(20, 20);
    paint(m, 10, 0, 10, 19, T.Water);
    paint(m, 10, 15, 10, 15, T.Clear);
    m.tree[m.idx(10, 15)] = 1; // the only gap is a tree => unreachable
    const path = new PathFinder(m).find(2, 10, 17, 10)!;
    const last = path[path.length - 1];
    assert.ok(last.x < 10, 'never crosses the river');
    m.tree[m.idx(10, 15)] = 0;
    const path2 = new PathFinder(m).find(2, 10, 17, 10)!;
    assert.deepEqual(path2[path2.length - 1], { x: 17.5, y: 10.5 });
    assertClear(m, 2, 10, path2);
  });

  test('buildings block, but a factory being exited can be ignored', () => {
    const m = open(20, 20);
    for (let y = 8; y < 11; y++) for (let x = 8; x < 11; x++) m.occupant[m.idx(x, y)] = 42;
    const pf = new PathFinder(m);
    // unit standing inside building 42 (a vehicle rolling out of the war factory)
    assert.equal(pf.find(9, 9, 9, 15), null, 'boxed in by its own footprint');
    const out = pf.find(9, 9, 9, 15, 12000, 42)!;
    assert.deepEqual(out[out.length - 1], { x: 9.5, y: 15.5 });
    // ignoring is per-call only
    assert.equal(pf.find(9, 9, 9, 15), null);
  });

  test('unreachable goal: path ends at the closest reachable cell', () => {
    const m = open();
    // ring of rock around (24, 24), radius 3
    for (let y = 20; y <= 28; y++) for (let x = 20; x <= 28; x++) {
      if (Math.max(Math.abs(x - 24), Math.abs(y - 24)) === 3) m.terrain[m.idx(x, y)] = T.Rock;
    }
    const path = new PathFinder(m).find(3, 3, 24, 24)!;
    assert.ok(path && path.length, 'returns partial progress instead of null');
    const last = path[path.length - 1];
    const lx = Math.floor(last.x), ly = Math.floor(last.y);
    assert.ok(Math.max(Math.abs(lx - 24), Math.abs(ly - 24)) === 4, `stops just outside the ring, got (${lx},${ly})`);
    // the closest reachable cells (octile distance 4) are the middles of the ring's sides
    const dx = Math.abs(lx - 24), dy = Math.abs(ly - 24);
    assert.equal(Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy), 4, `(${lx},${ly}) is a closest cell`);
    assertClear(m, 3, 3, path);
  });

  test('blocked goal cell: stops next to it, never inside', () => {
    const m = open();
    m.occupant[m.idx(20, 20)] = 7;
    const path = new PathFinder(m).find(5, 20, 20, 20)!;
    const last = path[path.length - 1];
    assert.deepEqual([Math.floor(last.x), Math.floor(last.y)], [19, 20]);
  });

  test('a start cell with no passable neighbour returns null', () => {
    const m = open(10, 10);
    paint(m, 3, 3, 5, 5, T.Rock);
    m.terrain[m.idx(4, 4)] = T.Clear;
    assert.equal(new PathFinder(m).find(4, 4, 9, 9), null);
  });

  test('no corner cutting: a diagonal line of single blocked cells is a solid wall', () => {
    const m = open(24, 24);
    // anti-diagonal wall x + y = 12 over the whole top-left triangle
    for (let x = 0; x <= 12; x++) m.terrain[m.idx(x, 12 - x)] = T.Rock;
    const path = new PathFinder(m).find(2, 2, 10, 10)!;
    assert.ok(path, 'partial path');
    const last = path[path.length - 1];
    assert.ok(Math.floor(last.x) + Math.floor(last.y) < 12, `stayed inside the triangle, ended at (${last.x},${last.y})`);
    assertClear(m, 2, 2, path);
  });

  test('no corner cutting: squeezing diagonally between two touching corners is refused', () => {
    const m = open(12, 12);
    m.terrain[m.idx(5, 6)] = T.Rock;
    m.terrain[m.idx(6, 5)] = T.Rock;
    const path = new PathFinder(m).find(5, 5, 6, 6)!;
    assert.notDeepEqual(path, [{ x: 6.5, y: 6.5 }], 'must not take the diagonal shortcut');
    assert.ok(pathLength(5, 5, path) > 2.5, "pathLength(5, 5, path) > 2.5");
    assertClear(m, 5, 5, path);
  });

  test('a maze is solved optimally (smoothed path <= grid optimum)', () => {
    const m = open(40, 40);
    for (let k = 0; k < 6; k++) {
      const x = 5 + k * 5;
      paint(m, x, 0, x, 39, T.Rock);
      // alternate gaps top / bottom
      const gy = k % 2 ? 2 : 36;
      paint(m, x, gy, x, gy + 1, T.Clear);
    }
    const pf = new PathFinder(m);
    const path = pf.find(1, 20, 38, 20, 1e6)!;
    assert.deepEqual(path[path.length - 1], { x: 38.5, y: 20.5 });
    assertClear(m, 1, 20, path);
    const opt = gridDistance(m, 1, 20, 38, 20);
    const len = pathLength(1, 20, path);
    assert.ok(len <= opt * 1.002 + 1e-6, `smoothed ${len.toFixed(2)} vs optimum ${opt.toFixed(2)}`);
  });

  test('search budget: a capped search still returns progress towards the goal', () => {
    const m = open(128, 128);
    paint(m, 64, 0, 64, 126, T.Rock);
    const pf = new PathFinder(m);
    const path = pf.find(2, 2, 125, 2, 300)!;
    assert.ok(path && path.length, "path && path.length");
    assert.ok(pf.expandedLastSearch <= 301, "pf.expandedLastSearch <= 301");
  });
});
