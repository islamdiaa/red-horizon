/**
 * [UNITS] Unit-only modelling kit: faction paint schemes, level-of-detail blocks and the recurring pieces of
 * military hardware (running gear, fenders, skirts, stowage, hatches with commanders, exhausts, lights, tow
 * hooks, muzzle brakes, smoke dischargers, camouflage, appliqué plates...).
 *
 * Everything still lands in the model's single merged body (plus the existing 'track' slot of the root node),
 * so none of this costs a draw call. Close-up detail goes in `near()` blocks (dropped from the distant body);
 * `far()` blocks hold cheap stand-ins that only the distant body draws.
 *
 * Conventions as in types.ts: units face +X, left = -Z, right = +Z, ground at y = 0.
 */
import * as THREE from 'three';
import { NB, boxGeo, type Glow, type Mat, type V3 } from './builder';
import { M, G, prismXY, flatXZ, trackBelt } from './parts';
import { FACTION_DRESSED } from './structures';

/**
 * [UNITS] Unit types both sides build that dress per faction (Soviet / Allied helmet, rifle, kit): index.ts
 * builds one template per faction for every id in STRUCT's FACTION_DRESSED set, so they join it here.
 */
export const FACTION_DRESSED_UNITS = ['e1', 'e3', 'e6', 'harv', 'mcv', 'tran', 'mnly'];
for (const id of FACTION_DRESSED_UNITS) FACTION_DRESSED.add(id);

// ---------------------------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------------------------

/** Faction paint schemes: Soviet olive drab with team-colour panels, Allied team paint with dark camouflage. */
export const P = {
  /** Soviet olive drab (hull, turret). */
  sov: { c: 0x66704a, m: 0.3, r: 0.6, d: 0 },
  sovDark: { c: 0x4a5236, m: 0.3, r: 0.64, d: 0 },
  sovLight: { c: 0x78825a, m: 0.28, r: 0.58, d: 0 },
  /** Allied dark steel for lower hulls and running gear. */
  allyDark: { c: 0x3a3f45, m: 0.4, r: 0.56, d: 0 },
  allySteel: { c: 0x5b636b, m: 0.42, r: 0.5, d: 0 },
  /** Allied hull: team paint a shade deeper than M.team (reads as paint, not plastic). */
  allyTeam: { c: 0xbebebe, m: 0.3, r: 0.5, t: 0.9, d: 0 },
  /** Camouflage blotches over Allied team paint. */
  camoDark: { c: 0x23262b, m: 0.25, r: 0.64, d: 0 },
  camoTan: { c: 0x857654, m: 0.2, r: 0.68, d: 0 },
  /** Running gear. */
  wheel: { c: 0x3a3d40, m: 0.5, r: 0.5, d: 0 },
  rubber: { c: 0x19191b, m: 0, r: 0.92, d: 2 },
  hub: { c: 0x8a9096, m: 0.8, r: 0.35, d: 0 },
  /** Gear and stowage. */
  canvasOlive: { c: 0x6b6844, m: 0, r: 0.9, d: 2 },
  canvasTan: { c: 0x9a8a62, m: 0, r: 0.9, d: 2 },
  jerry: { c: 0x4c5636, m: 0.35, r: 0.5, d: 0 },
  jerryRed: { c: 0x8a2a1e, m: 0.35, r: 0.5, d: 0 },
  log: { c: 0x5e4630, m: 0, r: 0.88, d: 2 },
  rust: { c: 0x6a4a34, m: 0.4, r: 0.8, d: 0 },
  exhaust: { c: 0x2b2420, m: 0.55, r: 0.72, d: 0 },
  lens: { c: 0x9fb8c8, m: 0.6, r: 0.08, d: 3 },
  /** Crew. */
  crewCloth: { c: 0x4b4a38, m: 0, r: 0.86, d: 2 },
  tanker: { c: 0x2c2620, m: 0, r: 0.8, d: 2 },
} satisfies Record<string, Mat>;

export type Faction = 'sov' | 'ally';

/** Hull / turret paint of a faction (Allied = team paint). */
export function hullPaint(f: Faction): Mat {
  return f === 'sov' ? P.sov : M.team;
}
/** Darker secondary paint (lower hull, mantlets). */
export function hullDark(f: Faction): Mat {
  return f === 'sov' ? P.sovDark : M.teamDark;
}
/** Panel paint that carries the team colour on a faction hull. */
export function teamPanel(f: Faction): Mat {
  return f === 'sov' ? M.team : M.teamLight;
}

// ---------------------------------------------------------------------------------------------
// Level of detail blocks
// ---------------------------------------------------------------------------------------------

type Snap = Map<NB, Map<string, number>>;

function snapshot(nb: NB, out: Snap = new Map()): Snap {
  const m = new Map<string, number>();
  for (const [slot, list] of nb.parts) m.set(slot, list.length);
  out.set(nb, m);
  for (const c of nb.children) snapshot(c, out);
  return out;
}

function tag(nb: NB, snap: Snap, lod: 0 | 1): void {
  const before = snap.get(nb);
  for (const [slot, list] of nb.parts) {
    const from = before?.get(slot) ?? 0;
    for (let i = from; i < list.length; i++) list[i].userData.lod = lod;
  }
  for (const c of nb.children) tag(c, snap, lod);
}

/** Everything `fn` adds to `nb` (and to nodes it creates) is close-up detail: dropped from the distant body. */
export function near(nb: NB, fn: () => void): void {
  const s = snapshot(nb);
  fn();
  tag(nb, s, 0);
}

/** Everything `fn` adds is a cheap stand-in drawn by the distant body only. */
export function far(nb: NB, fn: () => void): void {
  const s = snapshot(nb);
  fn();
  tag(nb, s, 1);
}

// ---------------------------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------------------------

const ROT_X: V3 = [0, 0, -Math.PI / 2];
const ROT_Z: V3 = [Math.PI / 2, 0, 0];

const _eA = new THREE.Euler();
const _eB = new THREE.Euler();
const _qA = new THREE.Quaternion();

/** Euler (XYZ, as AddOpts.r expects) of R = Ry(yaw) * Rx(tilt) * Rz(roll): tilt / roll first, then yaw. */
export function rotYX(yaw: number, tilt: number, roll = 0): V3 {
  _qA.setFromEuler(_eA.set(tilt, yaw, roll, 'YXZ'));
  _eB.setFromQuaternion(_qA, 'XYZ');
  return [_eB.x, _eB.y, _eB.z];
}

/** Euler (XYZ) of R = Ry(yaw) * Rz(rz): pitch about Z first, then yaw. */
export function rotYZ(yaw: number, rz: number): V3 {
  _qA.setFromEuler(_eA.set(0, yaw, rz, 'YZX'));
  _eB.setFromQuaternion(_qA, 'XYZ');
  return [_eB.x, _eB.y, _eB.z];
}

/** Rotation that turns a flat XZ decal (normal +Y, "up" toward -Z) to face outward along yaw, upright. */
export function decalRot(yaw: number): V3 {
  return rotYX(yaw, Math.PI / 2);
}

const gearCache = new Map<string, THREE.BufferGeometry>();
/** Flat toothed disc in the XY plane facing +Z (drive sprockets). */
export function gearDisc(r: number, teeth: number): THREE.BufferGeometry {
  const key = `${r.toFixed(4)},${teeth}`;
  let g = gearCache.get(key);
  if (!g) {
    const s = new THREE.Shape();
    const n = teeth * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = i % 2 ? r * 0.8 : r;
      if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    s.closePath();
    g = new THREE.ShapeGeometry(s);
    gearCache.set(key, g);
  }
  return g;
}

/** Squashed octahedron hub cap facing ±Z (8 triangles). */
export function hubZ(nb: NB, mat: Mat, r: number, p: V3, depth = 0.4): void {
  nb.add(HUB, mat, { p, s: [r, r, r * depth] });
}
const HUB = new THREE.OctahedronGeometry(1, 0);
/** Bolt head: open four-sided pyramid (4 triangles). */
const BOLT = new THREE.ConeGeometry(1, 0.8, 4, 1, true);

/**
 * Plate lying on the profile segment a -> b (side view x, y), `width` along Z centred at z, thickness t,
 * facing up / outward. Glacis plates, engine decks, sloped armour.
 */
export function slopePlate(nb: NB, mat: Mat, a: [number, number], b: [number, number], width: number, z: number, t = 0.01, inset = 0.9): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  let nx = -dy / len;
  let ny = dx / len;
  if (ny < 0 || (Math.abs(ny) < 1e-6 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const ang = Math.atan2(dy, dx);
  nb.box(mat, len * inset, t, width, (a[0] + b[0]) / 2 + nx * (t / 2), (a[1] + b[1]) / 2 + ny * (t / 2), z, { b: Math.min(0.004, t * 0.3), r: [0, 0, ang] });
}

/** Cylinder along X centred at p. */
export function cylX(nb: NB, mat: Mat, r: number, len: number, p: V3, seg = 8, open = false, r2 = r): void {
  nb.cyl(mat, r2, r, len, p[0], p[1], p[2], { r: ROT_X, seg, open });
}
/** Cylinder along Z centred at p. */
export function cylZ(nb: NB, mat: Mat, r: number, len: number, p: V3, seg = 8, open = false): void {
  nb.cyl(mat, r, r, len, p[0], p[1], p[2], { r: ROT_Z, seg, open });
}

/** Flat disc facing ±Z (side = sign) at p. */
export function discZ(nb: NB, mat: Mat, r: number, p: V3, side: number, seg = 8): void {
  nb.add(new THREE.CircleGeometry(r, seg), mat, { p, r: [0, side > 0 ? 0 : Math.PI, 0] });
}
/** Flat disc facing ±X at p. */
export function discX(nb: NB, mat: Mat, r: number, p: V3, side: number, seg = 8): void {
  nb.add(new THREE.CircleGeometry(r, seg), mat, { p, r: [0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0] });
}

/**
 * Box that is chamfered close up (bevel facets catch the light and take edge wear, 44 triangles) and plain
 * far away (12 triangles).
 */
export function cbox(nb: NB, mat: Mat, w: number, h: number, d: number, x: number, y: number, z: number, b = 0.01, r?: V3): void {
  far(nb, () => pbox(nb, mat, w, h, d, x, y, z, r));
  near(nb, () => nb.box(mat, w, h, d, x, y, z, { b, r }));
}

/** Plain (unchamfered) box: 12 triangles. */
export function pbox(nb: NB, mat: Mat, w: number, h: number, d: number, x: number, y: number, z: number, r?: V3): void {
  nb.box(mat, w, h, d, x, y, z, { b: 0, r });
}

// ---------------------------------------------------------------------------------------------
// Running gear
// ---------------------------------------------------------------------------------------------

export interface GearSpec {
  /** belt length, height, width, centre z of each belt */
  L: number;
  H: number;
  W: number;
  Z: number;
  /** road wheels per side */
  wheels: number;
  x?: number;
  /** road wheel radius as a fraction of H (default 0.36) */
  wheelK?: number;
  /** return rollers per side (close-up) */
  rollers?: number;
  /** draw wheel faces (false for hidden inner tracks) */
  faces?: boolean;
  link?: number;
}

/**
 * Track belts (scrolling 'track' slot of `nb`) with road wheels, drive sprocket, idler and return rollers.
 * Close up the wheels are rubber-tyred dishes with hubs; far away flat discs stand in for them.
 */
export function runningGear(nb: NB, o: GearSpec): void {
  const belt = trackBelt(o.L, o.H, o.W, 0.02, o.link ?? 0.05);
  const x0 = o.x ?? 0;
  const yC = o.H / 2;
  const nW = o.wheels;
  const wr = o.H * (o.wheelK ?? 0.36);
  const span = o.L - o.H * 1.15;
  for (const side of [-1, 1]) {
    const z = o.Z * side;
    nb.add(belt, M.dark, { p: [x0, yC, z], slot: 'track', keepUv: true });
    if (o.faces === false) continue;
    const face = z + side * o.W * 0.36;
    const wy = wr + 0.014;
    for (let i = 0; i < nW; i++) {
      const x = x0 - span / 2 + (span * i) / Math.max(1, nW - 1);
      far(nb, () => discZ(nb, P.wheel, wr, [x, wy, face + side * 0.004], side, 7));
      near(nb, () => {
        // rubber tyre rim, dished steel wheel face, hub cap
        discZ(nb, P.rubber, wr, [x, wy, face + side * 0.002], side, 8);
        discZ(nb, P.wheel, wr * 0.8, [x, wy, face + side * 0.006], side, 8);
        nb.add(BOLT, P.hub, { p: [x, wy, face + side * 0.008], s: [wr * 0.3, wr * 0.3, wr * 0.3], r: [side * Math.PI / 2, 0, 0] });
      });
    }
    // drive sprocket (front) and idler (rear)
    const sx = x0 + (o.L / 2 - o.H / 2);
    const ix = x0 - (o.L / 2 - o.H / 2);
    far(nb, () => {
      discZ(nb, M.gun, o.H * 0.4, [sx, yC, face + side * 0.004], side, 7);
      discZ(nb, M.gun, o.H * 0.36, [ix, yC, face + side * 0.004], side, 7);
    });
    near(nb, () => {
      // toothed sprocket and spoked idler
      nb.add(gearDisc(o.H * 0.46, 9), M.dark, { p: [sx, yC, face + side * 0.004], r: [0, side > 0 ? 0 : Math.PI, 0] });
      hubZ(nb, P.hub, o.H * 0.14, [sx, yC, face + side * 0.009]);
      discZ(nb, P.wheel, o.H * 0.38, [ix, yC, face + side * 0.004], side, 8);
      hubZ(nb, P.hub, o.H * 0.12, [ix, yC, face + side * 0.008]);
      const nr = o.rollers ?? 0;
      for (let k = 0; k < nr; k++) {
        const x = x0 - span / 2 + (span * (k + 0.5)) / nr;
        discZ(nb, P.wheel, o.H * 0.12, [x, o.H - o.H * 0.1, face], side, 6);
      }
    });
  }
}

/**
 * Track guard (fender) over a belt: a thin plate running the belt length with sloped front / rear mudguards.
 * y = top of the belt, z = belt centre.
 */
export function fender(nb: NB, mat: Mat, L: number, W: number, y: number, z: number, x = 0, front = 0.07, rear = 0.05): void {
  const t = 0.012;
  nb.box(mat, L - front - rear, t, W, x + (rear - front) / 2, y + t / 2, z, { b: 0.004 });
  // sloped mudguards
  pbox(nb, mat, front * 1.15, t, W, x + L / 2 - front / 2, y - front * 0.32, z, [0, 0, -0.62]);
  pbox(nb, mat, rear * 1.1, t, W, x - L / 2 + rear / 2, y - rear * 0.18, z, [0, 0, 0.38]);
}

/**
 * Side skirt of `n` armour panels hanging from the fender at z (outer face), alternating `matA` / `matB`.
 * Far away a single plate stands in for it.
 */
export function skirt(nb: NB, L: number, h: number, yTop: number, z: number, n: number, matA: Mat, matB: Mat = matA, x = 0, farMat: Mat = matA): void {
  const s = Math.sign(z) || 1;
  const t = 0.012;
  far(nb, () => nb.box(farMat, L, h, t, x, yTop - h / 2, z, { b: 0.004 }));
  near(nb, () => {
    const pw = L / n;
    for (let i = 0; i < n; i++) {
      const px = x - L / 2 + pw * (i + 0.5);
      nb.box(i % 2 ? matB : matA, pw - 0.006, h, t, px, yTop - h / 2, z, { b: 0.004 });
      // bolt heads along the top edge
      nb.add(BOLT, M.gun, { p: [px, yTop - 0.012, z + s * (t / 2 + 0.002)], s: 0.005, r: [s * Math.PI / 2, 0, 0] });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Hull fittings
// ---------------------------------------------------------------------------------------------

/** Pair of headlights (with brush guards close up) on the front face at x, mirrored at ±z. */
export function headlights(nb: NB, x: number, y: number, z: number, size = 0.014): void {
  for (const s of [-1, 1]) {
    nb.add(new THREE.CircleGeometry(size * 0.72, 6), G.head, { p: [x + 0.0045, y, z * s], r: [0, Math.PI / 2, 0] });
    near(nb, () => {
      // housing and a brush guard
      pbox(nb, M.dark, 0.02, size * 1.7, size * 1.9, x - 0.006, y, z * s);
      pbox(nb, M.dark, 0.004, 0.004, size * 2.2, x + 0.012, y + size * 0.6, z * s);
    });
  }
}

/** Pair of tail lights on the rear face (x < 0), mirrored at ±z. */
export function taillights(nb: NB, x: number, y: number, z: number): void {
  for (const s of [-1, 1]) {
    near(nb, () => pbox(nb, M.dark, 0.012, 0.02, 0.03, x + 0.004, y, z * s));
    nb.box(G.red, 0.006, 0.013, 0.02, x - 0.002, y, z * s, { b: 0, slot: 'glow' });
  }
}

/** Two tow hooks (close-up) on a face at x (front if dir > 0, rear if dir < 0). */
export function towHooks(nb: NB, x: number, y: number, z: number, dir: number): void {
  near(nb, () => {
    for (const s of [-1, 1]) {
      pbox(nb, M.dark, 0.02, 0.026, 0.01, x + dir * 0.01, y - 0.004, z * s, [0, 0, dir * 0.5]);
    }
  });
}

/** Steel tow cable coiled along a hull side / rear (close-up). */
export function towCable(nb: NB, x0: number, x1: number, y: number, z: number): void {
  near(nb, () => {
    cylX(nb, M.steel, 0.0055, Math.abs(x1 - x0), [(x0 + x1) / 2, y, z], 4, true);
    for (const x of [x0, x1]) pbox(nb, M.steel, 0.022, 0.014, 0.006, x, y, z);
  });
}

/** Jerry can standing upright, long side along X (handles + cap close up). */
export function jerrycan(nb: NB, x: number, y: number, z: number, mat: Mat = P.jerry, rotY = 0): void {
  const w = 0.046;
  const h = 0.062;
  const d = 0.02;
  nb.box(mat, w, h, d, x, y + h / 2, z, { b: 0.005, r: [0, rotY, 0] });
  near(nb, () => {
    // embossed X and the triple handle
    const c = Math.cos(rotY);
    const sn = Math.sin(rotY);
    const px = (dx: number) => x + dx * c;
    const pz = (dx: number) => z - dx * sn;
    pbox(nb, M.dark, 0.024, 0.008, 0.012, px(-0.006), y + h + 0.004, pz(-0.006), [0, rotY, 0]);
  });
}

/** Row of jerry cans in a rack along X. */
export function jerryRack(nb: NB, n: number, x: number, y: number, z: number, mat: Mat = P.jerry, rotY = 0): void {
  far(nb, () => pbox(nb, mat, n * 0.05 - 0.004, 0.062, 0.02, x, y + 0.031, z, [0, rotY, 0]));
  near(nb, () => {
    for (let i = 0; i < n; i++) jerrycan(nb, x + (i - (n - 1) / 2) * 0.05 * Math.cos(rotY), y, z - (i - (n - 1) / 2) * 0.05 * Math.sin(rotY), i % 3 === 2 ? P.jerryRed : mat, rotY);
    pbox(nb, M.dark, n * 0.05 + 0.01, 0.006, 0.026, x, y + 0.04, z, [0, rotY, 0]);
  });
}

/** Stowage bin with a lid seam and latches (close-up). */
export function stowBox(nb: NB, mat: Mat, w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): void {
  far(nb, () => pbox(nb, mat, w, h, d, x, y + h / 2, z, [0, rotY, 0]));
  near(nb, () => {
    nb.box(mat, w, h, d, x, y + h / 2, z, { b: w * d > 0.0095 ? Math.min(0.008, Math.min(w, h, d) * 0.2) : 0, r: [0, rotY, 0] });
    nb.box(M.dark, w * 1.01, 0.004, d * 1.01, x, y + h * 0.78, z, { b: 0, r: [0, rotY, 0] });
    if (w > 0.1) pbox(nb, M.steel, 0.01, 0.012, d * 1.04, x, y + h * 0.65, z, [0, rotY, 0]);
  });
}

/** Rolled tarp / bedroll lying along X with two straps. */
export function bedroll(nb: NB, mat: Mat, len: number, r: number, x: number, y: number, z: number, rotY = 0): void {
  const rot = rotYX(rotY, 0, Math.PI / 2);
  far(nb, () => nb.cyl(mat, r, r, len, x, y + r, z, { r: rot, seg: 5 }));
  near(nb, () => {
    nb.cyl(mat, r, r, len, x, y + r, z, { r: rot, seg: 7 });
    for (const k of [-0.28, 0.28]) {
      const dx = k * len;
      nb.cyl(M.webbing, r * 1.08, r * 1.08, 0.008, x + dx * Math.cos(rotY), y + r, z - dx * Math.sin(rotY), { r: rot, seg: 5, open: true });
    }
  });
}

/** Unditching log (Soviet tanks) carried across the rear deck along Z. */
export function unditchLog(nb: NB, len: number, r: number, x: number, y: number): void {
  cylZ(nb, P.log, r, len, [x, y + r, 0], 7);
  near(nb, () => {
    for (const s of [-1, 1]) {
      discZ(nb, P.canvasTan, r * 0.92, [x, y + r, (len / 2 + 0.001) * s], s, 7);
      nb.cyl(M.dark, r * 1.1, r * 1.1, 0.008, x, y + r, len * 0.36 * s, { r: ROT_Z, seg: 7, open: true });
    }
  });
}

/** External cylindrical fuel tank lying along X on a fender (Soviet style). */
export function fuelDrum(nb: NB, len: number, r: number, x: number, y: number, z: number, mat: Mat = P.sovDark): void {
  far(nb, () => cylX(nb, mat, r, len, [x, y + r, z], 5));
  near(nb, () => {
    cylX(nb, mat, r, len, [x, y + r, z], 8);
    nb.cyl(M.dark, r * 1.06, r * 1.06, 0.007, x, y + r, z, { r: ROT_X, seg: 8, open: true });
    discX(nb, M.dark, r * 0.3, [x + len / 2 + 0.002, y + r, z], 1, 5);
  });
}

/** Exhaust: muffler box with a short pipe pointing back / sideways; returns the outlet position. */
export function exhaust(nb: NB, x: number, y: number, z: number, side: number, mat: Mat = P.exhaust): V3 {
  pbox(nb, mat, 0.07, 0.03, 0.03, x, y, z);
  near(nb, () => nb.cyl(mat, 0.009, 0.011, 0.04, x - 0.04, y + 0.004, z + side * 0.006, { r: [0, 0, Math.PI / 2 + 0.25], seg: 6, open: true }));
  return [x - 0.062, y + 0.01, z + side * 0.006];
}

/** Engine deck louvres: dark plate with raised slats (slats close up). */
export function louvres(nb: NB, w: number, d: number, p: V3, slats = 6, mat: Mat = M.darker): void {
  pbox(nb, mat, w, 0.006, d, p[0], p[1], p[2]);
  near(nb, () => {
    slats = Math.min(slats, 5);
    for (let i = 0; i < slats; i++) {
      const x = p[0] - w / 2 + (w * (i + 0.5)) / slats;
      pbox(nb, M.gun, (w / slats) * 0.42, 0.01, d * 0.92, x, p[1] + 0.004, p[2], [0, 0, 0.35]);
    }
  });
}

/** Spare track links hung on a sloped glacis (close-up). `rotZ` = glacis slope. */
export function spareTracks(nb: NB, n: number, x: number, y: number, z: number, rotZ: number, w = 0.07): void {
  near(nb, () => {
    for (let i = 0; i < n; i++) {
      const dz = (i - (n - 1) / 2) * 0.026;
      pbox(nb, M.dark, 0.008, 0.02, w, x, y, z + dz, [0, Math.PI / 2, rotZ]);
    }
  });
}

/** Panel seam: thin dark strip on a face (close-up). */
export function seam(nb: NB, w: number, h: number, d: number, x: number, y: number, z: number, r?: V3): void {
  near(nb, () => pbox(nb, M.darker, w, h, d, x, y, z, r));
}

/** Row of bolt heads (close-up), from a to b. */
export function bolts(nb: NB, a: V3, b: V3, n: number, size = 0.007, mat: Mat = M.gun): void {
  near(nb, () => {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      nb.add(BOLT, mat, { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], s: size * 0.6 });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Turret fittings
// ---------------------------------------------------------------------------------------------

/**
 * Commander's cupola at p (top of the turret) with vision blocks and an open hatch lid; a crewman's head and
 * shoulders (tanker helmet / headset) look out of it. The crewman is a few triangles, so he shows far away too.
 */
export function cupola(nb: NB, mat: Mat, r: number, p: V3, opts: { crew?: boolean; lidSide?: number; crewMat?: Mat; helmet?: Mat } = {}): void {
  const [x, y, z] = p;
  const side = opts.lidSide ?? 1;
  far(nb, () => {
    nb.cyl(mat, r, r * 1.08, 0.026, x, y + 0.013, z, { seg: 7, open: true });
    pbox(nb, mat, r * 1.4, 0.008, r * 1.4, x - r * 0.25, y + 0.026 + r * 0.55, z + side * r * 0.8, [side * 1.25, 0, 0]);
  });
  near(nb, () => {
    nb.cyl(mat, r, r * 1.08, 0.026, x, y + 0.013, z, { seg: 10, open: true });
    nb.cyl(M.dark, r * 0.86, r * 0.86, 0.004, x, y + 0.026, z, { seg: 10, open: true });
    for (const a of [-0.45, 0.45]) pbox(nb, P.lens, 0.004, 0.008, 0.012, x + Math.cos(a) * r * 1.0, y + 0.018, z + Math.sin(a) * r * 1.0, [0, -a, 0]);
    // open lid tipped up behind the hatch
    nb.cyl(mat, r * 0.82, r * 0.82, 0.008, x - r * 0.25, y + 0.026 + r * 0.55, z + side * r * 0.75, { r: [side * 1.25, 0, 0], seg: 8 });
  });
  if (opts.crew !== false) {
    const cm = opts.crewMat ?? P.crewCloth;
    const hm = opts.helmet ?? P.tanker;
    pbox(nb, cm, 0.036, 0.03, 0.05, x, y + 0.038, z);
    far(nb, () => nb.sph(hm, 0.018, x, y + 0.068, z, { seg: 4 }));
    near(nb, () => {
      nb.sph(M.skin, 0.016, x + 0.002, y + 0.066, z, { seg: 6 });
      nb.sph(hm, 0.0185, x - 0.002, y + 0.071, z, { seg: 6, s: [1, 0.85, 1] });
      pbox(nb, P.lens, 0.006, 0.006, 0.024, x + 0.013, y + 0.081, z);
    });
  }
}

/**
 * Small marker lamp baked into the body (no draw call): red pulsing by default, phase-offset so a column of
 * tanks doesn't pulse in sync. Housing close up.
 */
export function markerLamp(nb: NB, p: V3, phase = 0.3, glow: Glow = { glow: 0xff2a18, i: 2.2 }): void {
  nb.add(new THREE.OctahedronGeometry(0.009, 0), { ...glow, a: 2 + (phase % 1) }, { p, lod: undefined });
  near(nb, () => pbox(nb, M.dark, 0.016, 0.006, 0.016, p[0], p[1] - 0.008, p[2]));
}

/** Plain round hatch with a hinge and handle (handle close up). */
export function roundHatch(nb: NB, mat: Mat, r: number, p: V3): void {
  far(nb, () => nb.add(new THREE.CircleGeometry(r, 7), mat, { p: [p[0], p[1] + 0.006, p[2]], r: [-Math.PI / 2, 0, 0] }));
  near(nb, () => {
    nb.cyl(mat, r, r * 1.06, 0.01, p[0], p[1] + 0.005, p[2], { seg: 8 });
    pbox(nb, M.steel, r * 1.1, 0.005, 0.006, p[0], p[1] + 0.012, p[2]);
    pbox(nb, M.dark, 0.012, 0.012, r * 1.2, p[0] - r * 0.9, p[1] + 0.008, p[2]);
  });
}

/** Pintle heavy machine gun (DShK / M2) on a cradle, pointing +X from p. */
export function pintleMG(nb: NB, p: V3, len = 0.12, shield = false, shieldMat: Mat = M.gun): void {
  const [x, y, z] = p;
  pbox(nb, M.gun, 0.05, 0.018, 0.016, x + 0.006, y + 0.034, z);
  far(nb, () => pbox(nb, M.dark, len, 0.008, 0.008, x + 0.03 + len / 2, y + 0.036, z));
  near(nb, () => {
    nb.cyl(M.dark, 0.005, 0.007, 0.03, x, y + 0.015, z, { seg: 5, open: true });
    cylX(nb, M.dark, 0.0045, len, [x + 0.03 + len / 2, y + 0.036, z], 5, true);
    pbox(nb, M.olive, 0.024, 0.016, 0.014, x - 0.004, y + 0.028, z + 0.016); // ammo can
    cylX(nb, M.dark, 0.0065, 0.016, [x + 0.03 + len - 0.01, y + 0.036, z], 5, true);
  });
  if (shield) pbox(nb, shieldMat, 0.008, 0.045, 0.06, x + 0.04, y + 0.04, z);
}

/** Bank of smoke grenade dischargers on a turret cheek at p, angled outward (side = ±1). */
export function smokeDischargers(nb: NB, p: V3, side: number, n = 3): void {
  near(nb, () => {
    pbox(nb, M.dark, 0.034, 0.016, 0.026, p[0], p[1], p[2], [side * 0.4, 0, 0]);
    for (let i = 0; i < n; i++) {
      const dx = (i - (n - 1) / 2) * 0.011;
      nb.cyl(M.gun, 0.0055, 0.0055, 0.03, p[0] + dx, p[1] + 0.012, p[2] + side * 0.006, { r: [side * 0.55, 0, 0.35], seg: 4, open: true });
    }
  });
}

/** Antenna base + whip (the whip is close-up detail). Optional pennant in team colour. */
export function whip(nb: NB, x: number, y: number, z: number, h: number, pennant = false): void {
  near(nb, () => {
    nb.cyl(M.dark, 0.008, 0.011, 0.018, x, y + 0.009, z, { seg: 5, open: true });
    nb.cyl(M.dark, 0.0018, 0.0035, h, x, y + 0.018 + h / 2, z, { seg: 3 });
    if (pennant) nb.add(flatXZ([[0, 0], [-0.05, -0.012], [0, -0.024]]), M.team, { p: [x, y + 0.018 + h, z], r: [Math.PI / 2, 0, 0] });
  });
}

/** Two-baffle muzzle brake at the end of a barrel along +X (x = barrel tip), radius r. */
export function muzzleBrake(nb: NB, x: number, r: number, y = 0, z = 0): void {
  far(nb, () => pbox(nb, M.dark, r * 3.4, r * 2.0, r * 2.6, x - r * 1.7, y, z));
  near(nb, () => {
    pbox(nb, M.dark, r * 3.4, r * 2.0, r * 2.6, x - r * 1.7, y, z);
    pbox(nb, M.darker, r * 0.55, r * 1.6, r * 2.7, x - r * 0.6, y, z);
  });
}

/** Bore evacuator / thermal sleeve bulge on a barrel at x along +X. */
export function evacuator(nb: NB, x: number, len: number, r: number, y = 0, z = 0, mat: Mat = M.gun): void {
  near(nb, () => nb.cyl(mat, r * 1.45, r * 1.45, len, x, y, z, { r: ROT_X, seg: 8, open: true }));
}

/** IR searchlight (box housing, glowing lens) on a bracket at p, facing +X. */
export function searchlight(nb: NB, p: V3, size = 0.026, lit = true): void {
  const [x, y, z] = p;
  far(nb, () => pbox(nb, M.dark, size * 1.3, size * 1.6, size * 1.6, x, y, z));
  nb.add(new THREE.CircleGeometry(size * 0.82, 6), lit ? G.white : P.lens, { p: [x + size * 0.66, y, z], r: [0, Math.PI / 2, 0] });
  near(nb, () => {
    cylX(nb, M.dark, size, size * 1.3, [x, y, z], 8, true);
    pbox(nb, M.dark, 0.01, size * 1.2, 0.01, x - size * 0.2, y - size * 1.1, z);
    for (const k of [-1, 1]) pbox(nb, M.dark, 0.004, 0.004, size * 2.2, x + size * 0.68, y + k * size * 0.5, z);
  });
}

/** Periscope block (close-up) on a turret roof at p, looking +X. */
export function periscope(nb: NB, p: V3, rotY = 0): void {
  near(nb, () => {
    nb.box(M.gun, 0.02, 0.014, 0.022, p[0], p[1] + 0.007, p[2], { b: 0, r: [0, rotY, 0] });
    pbox(nb, P.lens, 0.003, 0.007, 0.016, p[0] + 0.011 * Math.cos(rotY), p[1] + 0.009, p[2] - 0.011 * Math.sin(rotY), [0, rotY, 0]);
  });
}

/** Lifting eyes (close-up) at the given points. */
export function liftEyes(nb: NB, pts: V3[]): void {
  near(nb, () => {
    for (const p of pts) pbox(nb, M.gun, 0.014, 0.01, 0.004, p[0], p[1] + 0.004, p[2]);
  });
}

// ---------------------------------------------------------------------------------------------
// Plates and markings on prism outlines
// ---------------------------------------------------------------------------------------------

type P2 = [number, number];

/** Frame of edge i of a top-view outline (x, z): centre, length, yaw (rotation.y) and outward normal. */
export function edgeFrame(pts: P2[], i: number): { cx: number; cz: number; len: number; yaw: number; nx: number; nz: number } {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  // centroid to decide outward
  let gx = 0;
  let gz = 0;
  for (const p of pts) {
    gx += p[0] / pts.length;
    gz += p[1] / pts.length;
  }
  let nx = dz / len;
  let nz = -dx / len;
  const cx = (a[0] + b[0]) / 2;
  const cz = (a[1] + b[1]) / 2;
  if ((cx - gx) * nx + (cz - gz) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  // box local +Z -> outward normal
  const yaw = Math.atan2(nx, nz);
  return { cx, cz, len, yaw, nx, nz };
}

/**
 * Appliqué armour plate on edge i of a prismXZ outline: a slab of `frac` of the edge length, `h` tall, centred
 * at height y, standing `out` proud of the face. Returns the plate's outward normal.
 */
export function edgePlate(nb: NB, mat: Mat, pts: P2[], i: number, y: number, h: number, frac = 0.8, out = 0.006, t = 0.012, shift = 0): void {
  const f = edgeFrame(pts, i);
  const w = f.len * frac;
  const sx = Math.cos(f.yaw);
  const sz = -Math.sin(f.yaw);
  nb.box(mat, w, h, t, f.cx + f.nx * (out + t / 2 - 0.004) + sx * shift, y, f.cz + f.nz * (out + t / 2 - 0.004) + sz * shift, { b: Math.min(0.004, t * 0.3), r: [0, f.yaw, 0] });
}

/** Seeded pseudo-random generator. */
export function rng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Irregular blob polygon (top view, ~radius 1) for camouflage. */
function blob(rnd: () => number, n = 5): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
    const r = 0.65 + rnd() * 0.45;
    pts.push([Math.cos(a) * r, Math.sin(a) * r * (0.55 + rnd() * 0.25)]);
  }
  return pts;
}

/**
 * Camouflage blotches on a vertical face: `n` blobs scattered over a w x h rectangle centred at p, facing yaw
 * (rotation.y of a +Z-facing decal). Both levels of detail draw them (a few triangles each).
 */
export function camoFace(nb: NB, w: number, h: number, p: V3, yaw: number, n: number, seed: number, mats: Mat[] = [P.camoTan, P.camoDark]): void {
  const rnd = rng(seed);
  const sx = Math.cos(yaw);
  const sz = -Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const g = flatXZ(blob(rnd));
    const size = Math.min(w * 0.4, h * 0.85) * (0.85 + rnd() * 0.45);
    const u = (rnd() - 0.5) * (w - size * 1.2);
    const v = (rnd() - 0.5) * Math.max(0, h - size * 0.9);
    g.scale(size, 1, size * 0.9);
    // flat XZ (normal +Y) -> facing +Z, then yaw
    g.rotateX(Math.PI / 2);
    g.rotateY(yaw);
    nb.add(g, mats[i % mats.length], { p: [p[0] + sx * u, p[1] + v, p[2] + sz * u] });
  }
}

/** Camouflage on top of a horizontal surface (blobs lying flat) over a w x d area centred at p. */
export function camoTop(nb: NB, w: number, d: number, p: V3, n: number, seed: number, mats: Mat[] = [P.camoTan, P.camoDark], rotZ = 0): void {
  const rnd = rng(seed);
  for (let i = 0; i < n; i++) {
    const g = flatXZ(blob(rnd));
    const size = Math.min(w, d) * (0.3 + rnd() * 0.16);
    g.scale(size, 1, size);
    const u = (rnd() - 0.5) * (w - size);
    const v = (rnd() - 0.5) * Math.max(0, d - size);
    g.rotateY(rnd() * 3);
    g.rotateZ(rotZ);
    nb.add(g, mats[i % mats.length], { p: [p[0] + u * Math.cos(rotZ), p[1] + u * Math.sin(rotZ), p[2] + v] });
  }
}

/** Stencilled stripe band (team colour) wrapped on a vertical face: thin slab. */
export function stripe(nb: NB, mat: Mat, w: number, h: number, p: V3, yaw = 0): void {
  nb.box(mat, w, h, 0.003, p[0], p[1], p[2], { b: 0, r: [0, yaw, 0] });
}

/** Side profile (x, y) slab extruded along Z with a bevel (re-export convenience). */
export function slab(pts: P2[], depth: number, bevel = 0.01): THREE.BufferGeometry {
  return prismXY(pts, depth, bevel);
}

export { boxGeo };

/** Surface of revolution around Y without the radius-based segment cap of parts.lathe (close-up curves). */
export function latheFine(pts: [number, number][], seg: number): THREE.BufferGeometry {
  const ordered = pts[0][1] > pts[pts.length - 1][1] ? [...pts].reverse() : pts;
  return new THREE.LatheGeometry(
    ordered.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)),
    seg,
  );
}
