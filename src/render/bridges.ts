/**
 * Bridges (World.bridges): stone arch bridges (temperate grey / desert sandstone) or steel truss
 * bridges (winter, snow-capped), spanning their water cells along their axis with piers down into
 * the water and ramps onto both banks. Damage shows as scorching and missing parapets / truss
 * members; when a bridge dies its deck segments break away one after another and splash into the
 * river, leaving pier stumps; an engineer repair rebuilds it.
 *
 *   const bridges = new BridgeRenderer({ heightAt: (x, y) => map.heightAt(x, y), climate, effects });
 *   scene.add(bridges.group);
 *   bridges.update(world.bridges, dt, time);   // every frame
 *   bridges.deckHeightAt(x, y)                 // deck top for ground units crossing (null = no bridge)
 *
 * Each bridge is built once (one skinned draw call using the shared body material; every deck
 * segment is a bone so the collapse costs nothing extra).
 */
import * as THREE from 'three';
import { NB, makeTemplate, instantiate, type Mat, type ModelTemplate } from './models/builder';
import type { ModelAnimState, ModelInstance } from './models/types';
import { M, G, prismXY, prismXZ, lamp, railLine, warnLight } from './models/parts';
import { healthVariant } from './models/anim';
import { setModelSnow } from './models/materials';
import { WATER_LEVEL } from '../sim/map';
import type { Effects } from './effects';
import type { EmitterHandle } from './effects/types';

export interface BridgeState {
  id: number;
  cells: [number, number][];
  axis: 'x' | 'y';
  hp: number;
  maxHp: number;
  alive: boolean;
}

export type BridgeClimate = 'temperate' | 'winter' | 'desert';

interface Style {
  stone: Mat;
  stoneDark: Mat;
  road: Mat;
  truss: boolean;
}

const STYLES: Record<BridgeClimate, Style> = {
  temperate: {
    stone: { c: 0xa29b8e, m: 0, r: 0.9, d: 1 },
    stoneDark: { c: 0x6c675f, m: 0, r: 0.92, d: 1 },
    road: { c: 0x6c665c, m: 0, r: 0.88, d: 1, uv: 5 },
    truss: false,
  },
  desert: {
    stone: { c: 0xc2a67a, m: 0, r: 0.92, d: 1 },
    stoneDark: { c: 0x8e7656, m: 0, r: 0.94, d: 1 },
    road: { c: 0x9a8462, m: 0, r: 0.9, d: 1, uv: 5 },
    truss: false,
  },
  winter: {
    stone: { c: 0x8a8c8e, m: 0, r: 0.9, d: 1 },
    stoneDark: { c: 0x66686a, m: 0, r: 0.92, d: 1 },
    road: { c: 0x4c4d50, m: 0, r: 0.86, d: 1, uv: 4 },
    truss: true,
  },
};
const STEEL: Mat = { c: 0x4d5d5c, m: 0.62, r: 0.45, d: 0 };
const STEEL_DARK: Mat = { c: 0x353d3e, m: 0.6, r: 0.5, d: 0 };
const SNOW: Mat = { c: 0xe6edf2, m: 0, r: 0.75, d: 3 };
const NEUTRAL = new THREE.Color(0x8a8a8a);

interface Built {
  id: number;
  model: ModelInstance;
  tpl: ModelTemplate;
  segs: THREE.Object3D[];
  rails: THREE.Object3D[];
  ruin: THREE.Object3D | null;
  // geometry in map space
  axis: 'x' | 'y';
  a0: number;
  a1: number;
  c0: number;
  c1: number;
  deckY: number;
  hL: number;
  hR: number;
  ramp: number;
  // state
  alive: boolean;
  hpFrac: number;
  collapseT: number;
  splashed: Uint8Array;
  fallDelay: Float32Array;
  fallSpin: Float32Array;
  smoke: EmitterHandle | null;
  seen: boolean;
}

const RAMP = 0.7;
const _v = new THREE.Vector3();

export class BridgeRenderer {
  readonly group = new THREE.Group();
  private built = new Map<number, Built>();
  private readonly wl: number;
  private readonly style: Style;
  private readonly fx: Effects | null;
  private readonly heightAt: (x: number, y: number) => number;
  private readonly anim: ModelAnimState = {
    time: 0, dt: 0, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: 1,
    door: 0, load: 0, harvesting: false, charge: 0, dying: 0,
  };

  constructor(opts: { heightAt: (x: number, y: number) => number; climate?: BridgeClimate; waterLevel?: number; effects?: Effects | null }) {
    this.heightAt = opts.heightAt;
    this.wl = opts.waterLevel ?? WATER_LEVEL;
    this.style = STYLES[opts.climate ?? 'temperate'];
    this.fx = opts.effects ?? null;
    // the bridge renderer is created per map with its climate: winter maps get snow on every model
    setModelSnow(opts.climate === 'winter' ? 1 : 0);
    this.group.name = 'bridges';
  }

  /** Deck top height for a ground unit at map (x, y), or null when no intact bridge is there. */
  deckHeightAt(x: number, y: number): number | null {
    for (const b of this.built.values()) {
      if (!b.alive) continue;
      const a = b.axis === 'x' ? x : y;
      const c = b.axis === 'x' ? y : x;
      if (c < b.c0 || c > b.c1 || a < b.a0 - b.ramp || a > b.a1 + b.ramp) continue;
      const top = b.deckY + 0.01;
      if (a < b.a0) return top + (b.hL + 0.02 - top) * ((b.a0 - a) / b.ramp);
      if (a > b.a1) return top + (b.hR + 0.02 - top) * ((a - b.a1) / b.ramp);
      return top;
    }
    return null;
  }

  update(list: readonly BridgeState[], dt: number, time: number): void {
    for (const b of this.built.values()) b.seen = false;
    for (const s of list) {
      let b = this.built.get(s.id);
      if (!b) {
        if (!s.cells.length) continue;
        b = this.build(s);
        this.built.set(s.id, b);
      }
      b.seen = true;
      const frac = s.maxHp > 0 ? Math.max(0, Math.min(1, s.hp / s.maxHp)) : 1;
      if (b.alive && !s.alive) this.startCollapse(b);
      else if (!b.alive && s.alive) this.rebuild(b);
      b.alive = s.alive;
      if (s.alive) this.applyDamage(b, frac);
    }
    for (const [id, b] of this.built) {
      if (!b.seen) {
        this.destroy(b);
        this.built.delete(id);
      }
    }
    for (const b of this.built.values()) {
      if (!b.alive) this.animateCollapse(b, dt);
      this.anim.time = time;
      this.anim.dt = dt;
      this.anim.health = b.alive ? b.hpFrac : 0.1;
      b.model.update(this.anim);
    }
  }

  dispose(): void {
    for (const b of this.built.values()) this.destroy(b);
    this.built.clear();
    this.group.removeFromParent();
  }

  // -------------------------------------------------------------------------------------------

  private destroy(b: Built): void {
    b.smoke?.dispose();
    b.model.dispose();
    b.tpl.skin?.geo.dispose();
  }

  private applyDamage(b: Built, frac: number): void {
    if (Math.abs(frac - b.hpFrac) < 1e-3) return;
    b.hpFrac = frac;
    // parapets / truss members go missing as the bridge takes damage (deterministic order)
    const lost = frac > 0.75 ? 0 : frac > 0.5 ? 0.25 : frac > 0.25 ? 0.5 : 0.7;
    b.rails.forEach((r, i) => {
      const h = ((i * 7919) % 101) / 101;
      r.scale.setScalar(h < lost ? 1e-4 : 1);
    });
    const wantSmoke = frac < 0.3 && !!this.fx;
    if (wantSmoke && !b.smoke && this.fx) b.smoke = this.fx.createEmitter('smoke', this.centre(b, _v).setY(b.deckY + 0.1));
    if (!wantSmoke && b.smoke) {
      b.smoke.dispose();
      b.smoke = null;
    }
    b.smoke?.setIntensity(0.6);
  }

  private centre(b: Built, out: THREE.Vector3): THREE.Vector3 {
    const ac = (b.a0 + b.a1) / 2;
    const cc = (b.c0 + b.c1) / 2;
    return b.axis === 'x' ? out.set(ac, b.deckY, cc) : out.set(cc, b.deckY, ac);
  }

  private segWorld(b: Built, i: number, out: THREE.Vector3): THREE.Vector3 {
    const a = b.a0 + i + 0.5;
    const cc = (b.c0 + b.c1) / 2;
    return b.axis === 'x' ? out.set(a, this.wl, cc) : out.set(cc, this.wl, a);
  }

  private startCollapse(b: Built): void {
    b.collapseT = 0;
    b.splashed.fill(0);
    const n = b.segs.length;
    // break from a random spot and unzip outward
    const origin = Math.floor(((b.id * 2654435761) >>> 0) % Math.max(1, n));
    for (let i = 0; i < n; i++) {
      b.fallDelay[i] = Math.abs(i - origin) * 0.14 + (((i * 48271) % 97) / 97) * 0.12;
      b.fallSpin[i] = (i < origin ? -1 : 1) * (0.6 + ((i * 16807) % 53) / 53);
    }
    b.smoke?.dispose();
    b.smoke = null;
    if (this.fx) {
      const c = this.centre(b, _v);
      this.fx.explosion(c.clone(), 'large', 1.2);
      for (let i = 0; i < n; i += 2) this.fx.explosion(this.segWorld(b, i, new THREE.Vector3()).setY(b.deckY), 'medium', 0.8);
    }
    if (b.ruin) b.ruin.scale.setScalar(1);
  }

  private animateCollapse(b: Built, dt: number): void {
    if (b.collapseT < 0) return;
    b.collapseT += Math.min(dt, 0.1);
    const t = b.collapseT;
    let active = false;
    for (let i = 0; i < b.segs.length; i++) {
      const s = b.segs[i];
      const lt = t - b.fallDelay[i];
      if (lt <= 0) {
        active = true;
        // shudder before letting go
        s.rotation.x = Math.sin(t * 40 + i) * 0.01;
        continue;
      }
      const drop = 0.5 * 5.5 * lt * lt;
      s.position.y = b.deckY - drop;
      s.rotation.z = b.fallSpin[i] * Math.min(1.2, lt * 1.1);
      s.rotation.x = b.fallSpin[i] * 0.25 * Math.min(1, lt);
      if (!b.splashed[i] && b.deckY - drop < this.wl + 0.05) {
        b.splashed[i] = 1;
        if (this.fx) {
          const p = this.segWorld(b, i, new THREE.Vector3());
          this.fx.waterSplash(p, 1.6);
          this.fx.bubbles(p, 8, 0.3);
        }
      }
      if (b.deckY - drop < this.wl - 0.6) s.scale.setScalar(1e-4);
      else active = true;
    }
    if (!active) b.collapseT = -1;
  }

  private rebuild(b: Built): void {
    b.collapseT = -1;
    for (let i = 0; i < b.segs.length; i++) {
      const s = b.segs[i];
      s.position.y = b.deckY;
      s.rotation.set(0, 0, 0);
      s.scale.setScalar(1);
    }
    if (b.ruin) b.ruin.scale.setScalar(1e-4);
    b.hpFrac = -1;
    if (this.fx) this.fx.constructionBurst(this.centre(b, new THREE.Vector3()), b.a1 - b.a0);
  }

  // -------------------------------------------------------------------------------------------
  // Geometry

  private build(s: BridgeState): Built {
    const ax = s.axis;
    let a0 = Infinity;
    let a1 = -Infinity;
    let c0 = Infinity;
    let c1 = -Infinity;
    for (const [cx, cy] of s.cells) {
      const a = ax === 'x' ? cx : cy;
      const c = ax === 'x' ? cy : cx;
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a + 1);
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c + 1);
    }
    const ac = (a0 + a1) / 2;
    const cc = (c0 + c1) / 2;
    const toMap = (a: number, c: number): [number, number] => (ax === 'x' ? [a, c] : [c, a]);
    // bank height where the ramps touch down
    const hL = this.heightAt(...toMap(a0 - RAMP * 0.9, cc));
    const hR = this.heightAt(...toMap(a1 + RAMP * 0.9, cc));
    const wl = this.wl;
    const deckY = Math.max(wl + 0.36, Math.max(hL, hR) + 0.05);
    const L = a1 - a0;
    const W = c1 - c0;
    const st = this.style;

    const r = new NB('root');
    r.snow = 1; // bridges collect snow in winter
    const segs: string[] = [];
    const rails: string[] = [];
    const segN = Math.max(1, Math.round(L));
    const segLen = L / segN;
    const bottom = wl - 0.55;
    const halfW = W * 0.43;
    for (let i = 0; i < segN; i++) {
      const x = -L / 2 + segLen * (i + 0.5);
      const sg = r.node(`seg${i}`, [x, deckY, 0]);
      segs.push(`seg${i}`);
      const rl = sg.node(`rail${i}`);
      rails.push(`rail${i}`);
      if (st.truss) this.trussSegment(sg, rl, segLen, halfW, deckY, wl, i);
      else this.archSegment(sg, rl, segLen, halfW, deckY, wl, i, i < segN - 1);
    }
    // piers (stay standing when the deck falls) + cutwaters
    for (let i = 0; i <= segN; i++) {
      const x = -L / 2 + segLen * i;
      const end = i === 0 || i === segN;
      const top = st.truss ? deckY - 0.1 : wl + 0.08;
      const pw = end ? 0.24 : 0.2;
      r.box(st.stoneDark, pw, top - bottom, halfW * 2 - 0.02, x, (top + bottom) / 2, 0, { b: 0.015 });
      if (st.truss && !end) r.box(st.stone, pw + 0.04, 0.04, halfW * 2 + 0.02, x, top + 0.02, 0, { b: 0.008 });
      if (!end) {
        for (const sd of [-1, 1]) {
          r.add(
            prismXZ(
              [
                [-pw / 2, 0],
                [pw / 2, 0],
                [0, 0.16],
              ],
              wl + 0.12 - bottom,
              0.01,
            ),
            st.stoneDark,
            { p: [x, bottom, sd * (halfW - 0.01)], r: [0, sd > 0 ? 0 : Math.PI, 0] },
          );
        }
      }
    }
    // abutments + ramps onto the banks
    for (const sd of [-1, 1]) {
      const hEnd = sd < 0 ? hL : hR;
      const xe = sd * (L / 2);
      r.box(st.stone, 0.36, deckY - (hEnd - 0.25), halfW * 2 + 0.06, xe + sd * 0.12, (deckY + hEnd - 0.25) / 2 - 0.02, 0, { b: 0.02 });
      const dy = hEnd + 0.02 - deckY;
      const len = Math.hypot(RAMP, dy);
      r.box(st.road, len, 0.05, halfW * 2 - 0.08, xe + (sd * RAMP) / 2, deckY + dy / 2 - 0.02, 0, { b: 0.01, r: [0, 0, Math.atan2(dy, RAMP) * sd] });
      // parapets running down the ramp
      for (const zs of [-1, 1]) {
        r.box(st.truss ? STEEL_DARK : st.stone, len, st.truss ? 0.03 : 0.07, 0.05, xe + (sd * RAMP) / 2, deckY + dy / 2 + 0.035, zs * (halfW - 0.03), { b: 0.008, r: [0, 0, Math.atan2(dy, RAMP) * sd] });
      }
      if (!st.truss) {
        // gate lamps at both ends
        for (const zs of [-1, 1]) {
          r.cyl(M.dark, 0.012, 0.016, 0.3, xe, deckY + 0.15, zs * (halfW - 0.02), { seg: 6 });
          lamp(r, G.warm, [xe, deckY + 0.32, zs * (halfW - 0.02)], 0.022);
        }
      } else {
        // portal frame with a sign plate
        for (const zs of [-1, 1]) r.box(STEEL, 0.05, 0.5, 0.05, xe, deckY + 0.25, zs * halfW, { b: 0.006 });
        r.box(STEEL, 0.05, 0.06, halfW * 2, xe, deckY + 0.48, 0, { b: 0.006 });
        r.box(M.yellow, 0.01, 0.06, 0.24, xe + sd * 0.03, deckY + 0.42, 0, { b: 0 });
        r.box(SNOW, 0.07, 0.02, halfW * 2 + 0.04, xe, deckY + 0.52, 0, { b: 0.008 });
      }
    }
    // ruins shown after a collapse: jagged stubs on top of the piers
    const ruin = r.node('ruin');
    for (let i = 1; i < segN; i++) {
      const x = -L / 2 + segLen * i;
      const top = st.truss ? deckY - 0.1 : wl + 0.08;
      for (let k = 0; k < 3; k++) {
        const zz = (k - 1) * halfW * 0.55;
        ruin.box(st.stone, 0.12 + 0.04 * ((i + k) % 2), 0.06 + 0.05 * ((i * 3 + k) % 3), 0.14, x + ((k % 2) - 0.5) * 0.06, top + 0.04, zz, { b: 0.01, r: [0.2 * (k - 1), 0, 0.3 * ((i + k) % 2 ? 1 : -1)] });
      }
      ruin.box(M.rubber, 0.05, 0.02, halfW * 1.6, x, top + 0.01, 0, { b: 0 });
    }

    const tpl = makeTemplate({
      root: r,
      height: deckY + 0.4,
      radius: L / 2 + 0.7,
      muzzles: [],
      glow: { glow: 2 },
      anim: (c, s2) => healthVariant(c, s2),
    });
    const model = instantiate(tpl, NEUTRAL, `bridge:${s.id}`);
    model.root.position.set(...(ax === 'x' ? ([ac, 0, cc] as const) : ([cc, 0, ac] as const)));
    model.root.rotation.y = ax === 'x' ? 0 : -Math.PI / 2;
    this.group.add(model.root);
    const get = (n: string) => model.root.getObjectByName(n)!;
    const ruinObj = get('ruin') ?? null;
    if (ruinObj) ruinObj.scale.setScalar(1e-4);
    const segObjs = segs.map(get);
    const railObjs = rails.map(get);
    const built: Built = {
      id: s.id,
      model,
      tpl,
      segs: segObjs,
      rails: railObjs,
      ruin: ruinObj,
      axis: ax,
      a0,
      a1,
      c0,
      c1,
      deckY,
      hL,
      hR,
      ramp: RAMP,
      alive: true,
      hpFrac: -1,
      collapseT: -1,
      splashed: new Uint8Array(segObjs.length),
      fallDelay: new Float32Array(segObjs.length),
      fallSpin: new Float32Array(segObjs.length),
      smoke: null,
      seen: true,
    };
    if (!s.alive) {
      // already destroyed when first seen: show the ruin directly
      for (const o of segObjs) o.scale.setScalar(1e-4);
      if (ruinObj) ruinObj.scale.setScalar(1);
      built.alive = false;
    }
    return built;
  }

  /** Stone arch span (node origin at deck centre, y relative to the deck). */
  private archSegment(sg: NB, rl: NB, len: number, halfW: number, deckY: number, wl: number, i: number, refuge: boolean): void {
    const st = this.style;
    const yb = wl - 0.5 - deckY;
    const ys = wl + 0.03 - deckY;
    const yc = -0.1;
    const hx = len / 2;
    const leg = 0.085;
    const pts: [number, number][] = [
      [-hx, -0.05],
      [hx, -0.05],
      [hx, yb],
      [hx - leg, yb],
      [hx - leg, ys],
    ];
    const n = 8;
    for (let k = 1; k < n; k++) {
      const th = (k / n) * Math.PI;
      pts.push([(hx - leg) * Math.cos(th), ys + (yc - ys) * Math.sin(th)]);
    }
    pts.push([-(hx - leg), ys], [-(hx - leg), yb], [-hx, yb]);
    sg.add(prismXY(pts, halfW * 2 - 0.04, 0.012), st.stone);
    // voussoir ring (darker band around the arch) on both faces
    for (const sd of [-1, 1]) {
      for (let k = 1; k < n; k += 2) {
        const th = (k / n) * Math.PI;
        const px = (hx - leg + 0.02) * Math.cos(th);
        const py = ys + (yc - ys + 0.02) * Math.sin(th);
        sg.box(st.stoneDark, 0.05, 0.035, 0.012, px, py, sd * (halfW - 0.015), { b: 0, r: [0, 0, th - Math.PI / 2] });
      }
      // string course under the parapet
      sg.box(st.stoneDark, len, 0.025, 0.03, 0, -0.055, sd * (halfW - 0.005), { b: 0.004 });
    }
    // deck slab + cobbled road with kerbs and a crown seam
    sg.box(st.stone, len, 0.06, halfW * 2, 0, -0.03, 0, { b: 0.008 });
    sg.box(st.road, len, 0.012, halfW * 2 - 0.16, 0, 0.004, 0, { b: 0 });
    sg.box(st.stoneDark, len, 0.004, 0.02, 0, 0.011, 0, { b: 0 });
    for (const sd of [-1, 1]) sg.box(st.stone, len, 0.022, 0.05, 0, 0.011, sd * (halfW - 0.1), { b: 0.004 });
    // parapets with lighter capstones (lose pieces with damage)
    for (const sd of [-1, 1]) {
      rl.box(st.stone, len, 0.075, 0.055, 0, 0.037, sd * (halfW - 0.03), { b: 0.01 });
      rl.box(st.road, len + 0.004, 0.018, 0.07, 0, 0.083, sd * (halfW - 0.03), { b: 0.005 });
    }
    // iron railing on the parapets
    for (const sd of [-1, 1]) railLine(rl, [-hx, 0.092, sd * (halfW - 0.03)], [hx, 0.092, sd * (halfW - 0.03)], 0.045, M.dark);
    // pedestrian refuge bays over the cutwaters at the pier end, with lamp posts
    if (refuge) {
      for (const sd of [-1, 1]) {
        sg.add(
          prismXZ(
            [
              [-0.15, 0],
              [0.15, 0],
              [0.08, 0.13],
              [-0.08, 0.13],
            ],
            0.12,
            0.01,
          ),
          st.stone,
          { p: [len / 2, -0.04, sd * (halfW - 0.01)], r: [0, sd > 0 ? 0 : Math.PI, 0] },
        );
        sg.box(st.road, 0.2, 0.016, 0.1, len / 2, 0.088, sd * (halfW + 0.05), { b: 0.004 });
        sg.cyl(M.dark, 0.008, 0.011, 0.24, len / 2, 0.2, sd * (halfW + 0.06), { seg: 5 });
        sg.box(M.dark, 0.05, 0.012, 0.012, len / 2, 0.31, sd * (halfW + 0.06), { b: 0 });
        lamp(sg, G.warm, [len / 2, 0.33, sd * (halfW + 0.06)], 0.02);
      }
    }
    // weathering: moss line near the water
    sg.box({ c: 0x3a4a2a, m: 0, r: 1, d: 2 }, len - 0.02, 0.03, halfW * 2 - 0.02, 0, wl - deckY + 0.02, 0, { b: 0 });
  }

  /** Steel truss span (node origin at deck centre). */
  private trussSegment(sg: NB, rl: NB, len: number, halfW: number, deckY: number, wl: number, i: number): void {
    const st = this.style;
    void wl;
    const H = 0.34;
    const hx = len / 2;
    sg.box(M.concrete, len, 0.05, halfW * 2, 0, -0.025, 0, { b: 0.006 });
    sg.box(st.road, len, 0.01, halfW * 2 - 0.12, 0, 0.004, 0, { b: 0 });
    sg.box(M.yellow, len * 0.45, 0.004, 0.012, 0, 0.011, 0, { b: 0 });
    sg.box(STEEL_DARK, len, 0.07, halfW * 1.7, 0, -0.085, 0, { b: 0.006 });
    for (const sd of [-1, 1]) {
      const z = sd * halfW;
      // chords + end verticals
      sg.box(STEEL, len, 0.04, 0.04, 0, 0.02, z, { b: 0.004 });
      sg.box(STEEL, len, 0.04, 0.04, 0, H, z, { b: 0.004 });
      sg.box(STEEL, 0.035, H, 0.035, -hx + 0.02, H / 2, z, { b: 0.004 });
      // snow on the top chord and along the kerb
      sg.box(SNOW, len, 0.018, 0.05, 0, H + 0.028, z, { b: 0.006 });
      sg.box(SNOW, len, 0.02, 0.07, 0, 0.012, sd * (halfW - 0.08), { b: 0.008 });
      // diagonals (lose some with damage)
      const dl = Math.hypot(len, H);
      const ang = Math.atan2(H, len) * (i % 2 ? 1 : -1);
      rl.box(STEEL, dl, 0.025, 0.025, 0, H / 2, z, { b: 0, r: [0, 0, ang] });
      rl.box(STEEL_DARK, 0.025, H, 0.022, 0, H / 2, z, { b: 0 });
    }
    // overhead cross bracing
    sg.box(STEEL, 0.03, 0.03, halfW * 2, -hx + 0.02, H, 0, { b: 0.004 });
    const dz = Math.hypot(len, halfW * 2);
    rl.box(STEEL_DARK, dz, 0.02, 0.02, 0, H, 0, { b: 0, r: [0, Math.atan2(halfW * 2, len), 0] });
    if (i === 0) warnLight(sg, [-hx, H + 0.05, halfW], false, 0.016);
    // Warren web with mid verticals, gusset plates, a pedestrian railing inside the truss and lamps
    for (const sd of [-1, 1]) {
      const z = sd * halfW;
      const ang2 = Math.atan2(H, len / 2);
      const dl2 = Math.hypot(len / 2, H);
      rl.box(STEEL_DARK, dl2, 0.018, 0.018, -len / 4, H / 2, z, { b: 0, r: [0, 0, i % 2 ? -ang2 : ang2] });
      rl.box(STEEL_DARK, dl2, 0.018, 0.018, len / 4, H / 2, z, { b: 0, r: [0, 0, i % 2 ? ang2 : -ang2] });
      for (const x of [-hx + 0.02, 0]) {
        sg.box(STEEL_DARK, 0.07, 0.07, 0.008, x, 0.03, z + sd * 0.022, { b: 0 });
        sg.box(STEEL_DARK, 0.07, 0.07, 0.008, x, H - 0.01, z + sd * 0.022, { b: 0 });
      }
      railLine(sg, [-hx, 0.012, sd * (halfW - 0.1)], [hx, 0.012, sd * (halfW - 0.1)], 0.07, STEEL_DARK);
      if ((i + (sd > 0 ? 0 : 1)) % 2 === 0) {
        sg.cyl(M.dark, 0.007, 0.01, H - 0.04, 0, (H - 0.04) / 2, sd * (halfW - 0.05), { seg: 5 });
        sg.box(M.dark, 0.012, 0.012, 0.08, 0, H - 0.05, sd * (halfW - 0.09), { b: 0 });
        lamp(sg, { glow: 0xffd49a, i: 1.4 }, [0, H - 0.07, sd * (halfW - 0.13)], 0.018);
      }
    }
  }
}
