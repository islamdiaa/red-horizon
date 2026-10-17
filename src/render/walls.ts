import * as THREE from 'three';
import { hash2 } from '../core/rng';
import type { World } from '../sim/world';
import type { FogOfWar } from './fog';
import type { Player } from '../sim/player';
import { NB, makeTemplate } from './models/builder';
import { M, S, FSTYLE, banner, floodlight, ladder, mergeChild, warnLight, type Fac } from './models/parts';
import { bodyMaterialInstanced, freshBodyMaterial, shadowDepthMaterial } from './models/materials';

/**
 * Auto-connecting walls, rendered with instancing and the shared body material (weathering, snow,
 * team colour): concrete walls get watch towers at their ends and corners and team banners on some spans,
 * sandbags and barbed wire stay low. A post sits at every wall cell, arms (length 0.5 along +X) reach toward
 * each connected neighbour. One instanced mesh per (kind, piece, owner colour / faction) that is in use.
 */

type WallKind = 'sbag' | 'barb' | 'brik';
type Piece = 'post' | 'tower' | 'arm' | 'armBanner';
const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

const SAND = { c: 0xb09a6a, m: 0, r: 0.95, d: 2, uv: 5, snow: 1 };
const SAND_DARK = { c: 0x8e7a52, m: 0, r: 0.96, d: 2, uv: 5, snow: 1 };
const WIRE = { c: 0x5a5650, m: 0.6, r: 0.5, d: 0, snow: 0.2 };

/** One rounded sandbag: a squashed low-poly sphere. */
function bag(nb: NB, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, dark: boolean): void {
  nb.add(new THREE.SphereGeometry(0.5, 7, 4), dark ? SAND_DARK : SAND, { p: [x, y, z], s: [sx, sy, sz], r: [0, ry, 0] });
}

function buildPiece(kind: WallKind, piece: Piece, fac: Fac): NB {
  const fs = FSTYLE[fac];
  const r = new NB('root');
  r.snow = 1;
  r.cavity = true;
  r.ao = { h: 0.3, min: 0.6 };
  if (kind === 'sbag') {
    if (piece === 'post' || piece === 'tower') {
      for (let l = 0; l < 3; l++) for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + l * 0.6;
        bag(r, Math.cos(a) * 0.08, 0.07 + l * 0.1, Math.sin(a) * 0.08, 0.24, 0.12, 0.15, a, (k + l) % 2 === 0);
      }
    } else {
      for (let l = 0; l < 3; l++) for (let k = 0; k < 2; k++) bag(r, 0.13 + k * 0.25 + (l % 2) * 0.06, 0.07 + l * 0.1, 0, 0.26, 0.12, 0.17, 0, (k + l) % 2 === 1);
      if (piece === 'armBanner') {
        r.cyl(M.wood, 0.012, 0.014, 0.42, 0.3, 0.21, 0.1, { seg: 5 });
        banner(r, 'allies', 0.14, 0.18, [0.3, 0.4, 0.11], 0, true);
      }
    }
    return r;
  }
  if (kind === 'barb') {
    if (piece === 'post' || piece === 'tower') {
      r.cyl(M.wood, 0.025, 0.03, 0.5, 0, 0.25, 0, { seg: 5 });
      r.box(M.wood, 0.3, 0.025, 0.025, 0, 0.38, 0, { b: 0 });
      r.box(M.wood, 0.025, 0.025, 0.3, 0, 0.3, 0, { b: 0 });
      if (piece === 'tower') {
        r.box(S.signRed, 0.16, 0.1, 0.008, 0, 0.2, 0.035, { b: 0 });
        r.add(new THREE.OctahedronGeometry(0.02, 0), S.stencilWhite, { p: [0, 0.2, 0.04], s: [1, 1, 0.1] });
      }
    } else {
      for (let k = 0; k < 4; k++) r.add(new THREE.TorusGeometry(0.13, 0.008, 3, 12), WIRE, { p: [0.07 + k * 0.12, 0.15, 0], r: [0, Math.PI / 2, 0] });
      for (const y of [0.08, 0.3]) r.box(WIRE, 0.5, 0.005, 0.005, 0.25, y, 0, { b: 0 });
      if (piece === 'armBanner') r.box(S.signRed, 0.14, 0.08, 0.006, 0.25, 0.24, 0.02, { b: 0 });
    }
    return r;
  }
  // ---- concrete wall
  const wall = fac === 'soviet' ? S.sovWall : S.allWall;
  const dark = fs.wallDark;
  if (piece === 'post') {
    r.box(dark, 0.5, 0.08, 0.5, 0, 0.04, 0, { b: 0.015 });
    r.box(wall, 0.42, 0.8, 0.42, 0, 0.44, 0, { b: 0.025 });
    r.box(dark, 0.48, 0.06, 0.48, 0, 0.87, 0, { b: 0.012 });
    r.box(M.team, 0.44, 0.025, 0.44, 0, 0.8, 0, { b: 0.006 });
    r.box(dark, 0.18, 0.06, 0.18, 0, 0.93, 0, { b: 0.01 });
  } else if (piece === 'tower') {
    // watch tower: heavy pillar, lookout cabin with slit windows, roof, searchlight / red lamp
    r.box(dark, 0.6, 0.1, 0.6, 0, 0.05, 0, { b: 0.015 });
    r.box(wall, 0.5, 1.12, 0.5, 0, 0.62, 0, { b: 0.025 });
    for (const s of [-1, 1]) {
      r.box(dark, 0.07, 1.0, 0.07, s * 0.26, 0.55, 0.26, { b: 0.01 });
      r.box(dark, 0.07, 1.0, 0.07, s * 0.26, 0.55, -0.26, { b: 0.01 });
    }
    r.box(fs.steel, 0.64, 0.24, 0.64, 0, 1.3, 0, { b: 0.02 });
    for (const [x, z, ry] of [[0, 0.322, 0], [0, -0.322, 0], [0.322, 0, Math.PI / 2], [-0.322, 0, Math.PI / 2]]) {
      r.box(M.darker, 0.42, 0.06, 0.012, x, 1.32, z, { b: 0, r: [0, ry, 0] });
      r.box(fs.win, 0.3, 0.03, 0.006, x * 1.02, 1.32, z * 1.02, { b: 0, r: [0, ry, 0] });
    }
    r.box(M.team, 0.66, 0.03, 0.66, 0, 1.43, 0, { b: 0.006 });
    r.box(fs.roof, 0.72, 0.04, 0.72, 0, 1.46, 0, { b: 0.012 });
    r.box(dark, 0.2, 0.08, 0.2, 0, 1.52, 0, { b: 0.01 });
    if (fac === 'soviet') {
      warnLight(r, [0.3, 1.52, 0.3], false, 0.022);
      warnLight(r, [-0.3, 1.52, -0.3], false, 0.022);
      const st = new NB('_st', [0, 0.62, 0.252]);
      st.add(new THREE.ShapeGeometry(starShape(0.1)), S.stencilYellow, {});
      st.add(new THREE.ShapeGeometry(starShape(0.082)), M.red, { p: [0, 0, 0.003] });
      mergeChild(r, st);
    } else {
      floodlight(r, [0, 1.54, 0.2], 0, 0.6, 0.06);
      warnLight(r, [0.32, 1.5, -0.32], false, 0.018, { glow: 0xff3020, i: 2.2 });
      const st = new NB('_st', [0, 0.62, 0.252]);
      st.add(new THREE.ShapeGeometry(starShape(0.09)), M.white, {});
      mergeChild(r, st);
    }
    ladder(r, 1.15, [0.24, 0.08, -0.26], Math.PI);
  } else {
    // wall span from the post (x 0) toward the neighbour (x 0.5): body, coping, buttresses, merlons
    r.box(dark, 0.5, 0.06, 0.38, 0.25, 0.03, 0, { b: 0.012 });
    r.box(wall, 0.5, 0.68, 0.3, 0.25, 0.36, 0, { b: 0.02 });
    r.box(dark, 0.5, 0.05, 0.36, 0.25, 0.725, 0, { b: 0.012 });
    r.box(dark, 0.5, 0.02, 0.31, 0.25, 0.3, 0, { b: 0.004 });
    for (const s of [-1, 1]) r.box(dark, 0.07, 0.56, 0.06, 0.27, 0.3, s * 0.17, { b: 0.012 });
    for (const x of [0.12, 0.38]) r.box(wall, 0.12, 0.09, 0.3, x, 0.79, 0, { b: 0.012 });
    if (piece === 'armBanner') {
      banner(r, fac, 0.22, 0.44, [0.25, 0.7, 0.19], 0);
      banner(r, fac, 0.22, 0.44, [0.25, 0.7, -0.19], Math.PI);
    }
  }
  return r;
}

function starShape(rad: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rr = i % 2 === 0 ? rad : rad * 0.42;
    const x = Math.sin(a) * rr, y = Math.cos(a) * rr;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

/** Merged piece geometry (shared, built once per kind / piece / faction). */
function pieceGeo(kind: WallKind, piece: Piece, fac: Fac): THREE.BufferGeometry {
  const key = `${kind}|${piece}|${fac}`;
  let g = geoCache.get(key);
  if (!g) {
    const tpl = makeTemplate({ root: buildPiece(kind, piece, fac), height: 1, radius: 0.5 });
    g = tpl.skin!.geo;
    geoCache.set(key, g);
  }
  return g;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  n: number;
}

export class WallRenderer {
  readonly group = new THREE.Group();
  private batches = new Map<string, Batch>();
  private signature = -1;
  private dummy = new THREE.Object3D();
  private walls: import('../sim/entities').Building[] = [];

  constructor(private world: World, private fog: FogOfWar, private local: Player) {}

  /** Static preview for sidebar thumbnails: a short three-segment wall (owns its geometry and material). */
  static preview(kind: string, teamColor = 0x8a8a8a, faction: Fac = 'soviet'): THREE.Group {
    const k = kind as WallKind;
    const g = new THREE.Group();
    const mat = freshBodyMaterial(teamColor);
    const add = (piece: Piece, x: number, ry: number) => {
      const m = new THREE.Mesh(pieceGeo(k, piece, faction).clone(), mat);
      m.position.x = x;
      m.rotation.y = ry;
      g.add(m);
    };
    add('tower', -1, 0);
    add('post', 0, 0);
    add('tower', 1, 0);
    add('arm', -1, 0);
    add('arm', 0, Math.PI);
    add('armBanner', 0, 0);
    add('arm', 1, Math.PI);
    return g;
  }

  private batch(kind: WallKind, piece: Piece, team: number, fac: Fac, need: number): Batch {
    const key = `${kind}|${piece}|${team}|${fac}`;
    let b = this.batches.get(key);
    if (b && b.mesh.instanceMatrix.count >= need) return b;
    const cap = Math.max(32, 1 << Math.ceil(Math.log2(need + 1)));
    if (b) {
      this.group.remove(b.mesh);
      b.mesh.dispose();
    }
    const mesh = new THREE.InstancedMesh(pieceGeo(kind, piece, fac), bodyMaterialInstanced(team), cap);
    mesh.name = `wall:${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = shadowDepthMaterial(mesh);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false; // no empty instanced draw calls
    this.group.add(mesh);
    b = { mesh, n: 0 };
    this.batches.set(key, b);
    return b;
  }

  update() {
    const w = this.world;
    // signature of the wall set (allocation-free; runs every frame): ids plus a coarse exploration bit,
    // since the visibility of enemy walls depends on exploration
    let sig = 0, n = 0;
    for (const b of w.buildings) {
      if (!b.alive || !(b.bt.wall || b.bt.gate)) continue; // gates join the wall lines
      const seen = b.owner.team === this.local.team || this.fog.exploredAt(b.x, b.y) > 0.5 ? 1 : 2;
      sig = (Math.imul(sig ^ (b.id * 4 + seen), 0x9e3779b1) + n++) | 0;
    }
    sig = (sig ^ n) >>> 0;
    if (sig === this.signature) return;
    this.signature = sig;
    const walls = this.walls;
    walls.length = 0;
    for (const b of w.buildings) if (b.alive && b.bt.wall) walls.push(b);
    const m = w.map;
    const at = new Map<number, string>();
    for (const b of walls) at.set(m.idx(b.cx, b.cy), b.bt.id);
    for (const b of w.buildings) if (b.alive && b.bt.gate) at.set(m.idx(b.cx, b.cy), 'gate'); // any wall reaches into a gate
    // gather instance transforms per batch key first (counts decide the batch capacity)
    const lists = new Map<string, { kind: WallKind; piece: Piece; team: number; fac: Fac; mats: THREE.Matrix4[] }>();
    const push = (kind: WallKind, piece: Piece, team: number, fac: Fac, mat: THREE.Matrix4) => {
      const key = `${kind}|${piece}|${team}|${fac}`;
      let l = lists.get(key);
      if (!l) lists.set(key, (l = { kind, piece, team, fac, mats: [] }));
      l.mats.push(mat.clone());
    };
    const d = this.dummy;
    for (const b of walls) {
      if (b.owner.team !== this.local.team && this.fog.exploredAt(b.x, b.y) <= 0.5) continue;
      const kind = b.bt.id as WallKind;
      if (kind !== 'sbag' && kind !== 'barb' && kind !== 'brik') continue;
      const team = b.owner.color;
      const fac: Fac = b.owner.faction === 'soviet' ? 'soviet' : 'allies';
      const h = m.heightAt(b.x, b.y);
      // connections (orthogonal first; diagonals only where no orthogonal neighbour covers the corner)
      const links: [number, number][] = [];
      for (const [dx, dy] of DIRS) {
        const nx = b.cx + dx, ny = b.cy + dy;
        if (!m.inBounds(nx, ny)) continue;
        const nk = at.get(m.idx(nx, ny));
        if (nk !== b.bt.id && (nk !== 'gate' || (dx && dy))) continue; // gates: orthogonal arms only
        if (dx && dy && (at.get(m.idx(b.cx + dx, b.cy)) === b.bt.id || at.get(m.idx(b.cx, b.cy + dy)) === b.bt.id)) continue;
        links.push([dx, dy]);
      }
      const straight = links.length === 2 && links[0][0] === -links[1][0] && links[0][1] === -links[1][1];
      const hv = hash2(b.cx, b.cy);
      const tower = kind === 'brik' ? !straight || hv < 0.12 : hv < 0.15;
      d.position.set(b.x, h - 0.02, b.y);
      d.rotation.set(0, kind === 'brik' ? 0 : hv * 0.3, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      push(kind, tower ? 'tower' : 'post', team, fac, d.matrix);
      for (const [dx, dy] of links) {
        const len = Math.hypot(dx, dy);
        const flag = hash2(b.cx * 3 + dx + 7, b.cy * 3 + dy + 11) < (kind === 'brik' ? 0.3 : 0.12);
        d.position.set(b.x, h - 0.02, b.y);
        d.rotation.set(0, -Math.atan2(dy, dx), 0);
        d.scale.set(len, 1, 1);
        d.updateMatrix();
        push(kind, flag ? 'armBanner' : 'arm', team, fac, d.matrix);
      }
    }
    for (const bt of this.batches.values()) {
      bt.n = 0;
      bt.mesh.count = 0;
      bt.mesh.visible = false;
    }
    for (const l of lists.values()) {
      const bt = this.batch(l.kind, l.piece, l.team, l.fac, l.mats.length);
      for (let i = 0; i < l.mats.length; i++) bt.mesh.setMatrixAt(i, l.mats[i]);
      bt.n = l.mats.length;
      bt.mesh.count = bt.n;
      bt.mesh.visible = bt.n > 0;
      bt.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
