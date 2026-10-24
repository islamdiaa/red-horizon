/**
 * World Conquest: the 3D globe (its own small three.js renderer and scene, independent of the battle engine).
 *
 * One sphere draws everything on the surface in a single shader pass:
 *  - a land mask (the world outline rasterised once into a texture) gives the coasts;
 *  - territories are the spherical Voronoi cells of the region sites, clipped to land. A small texture keeps the four
 *    nearest sites of every texel, and the fragment shader picks the nearest of those exactly, so cell borders and
 *    zone outlines stay crisp and anti-aliased (constant pixel width via fwidth) at every zoom;
 *  - a per-territory palette texture (owner colour + flags: selected, source, target, hover, dim) recolours the map
 *    without touching geometry.
 * Troop badges, capitals, landmark icons, arrows and sea lanes are drawn on a 2D overlay canvas, so they keep a
 * readable pixel size at every zoom. Nothing renders unless something changed (camera, state, an animation).
 */
import * as THREE from 'three';

// =====================================================================================================
// Public data
// =====================================================================================================
export interface GlobeSite {
  /** Region id. */
  id: string;
  lon: number;
  lat: number;
  /** Index of the zone (for zone outlines), -1 for none. */
  zone: number;
}

/** Per-territory display state. Territories are addressed by site index (a site = a territory). */
export interface GlobeCell {
  /** Fill colour, 0xRRGGBB. */
  color: number;
  troops: number;
  /** Out of play (not part of this run): drawn dim, no badge. */
  dim?: boolean;
  /** Capital of a power: a star badge. */
  capital?: boolean;
  /** Landmark id (for an icon). */
  landmark?: string;
  /** Hatched fill (rival powers), so owners differ by more than hue. */
  hatch?: boolean;
  /** Short owner mark drawn in the badge ring (e.g. a power's initial), optional. */
  mark?: string;
  /** Text instead of the troop count ('' = none). */
  label?: string;
  /** The player's own territory (front lines are drawn where it meets a rival's). */
  mine?: boolean;
  /** A small marker instead of a full badge (setup: other homelands). */
  small?: boolean;
}

export interface GlobeArrow {
  from: number;
  to: number;
  kind: 'option' | 'go' | 'rival' | 'fortify' | 'lane' | 'threat';
  /** CSS colour override. */
  color?: string;
  /** 0..1 progress for animated playback arrows (draws the arc up to this point). */
  t?: number;
}

export interface GlobeWorld {
  sites: GlobeSite[];
  /** Land outline as rings of [lon, lat]; holes (lakes) need the even-odd rule. */
  land: Array<Array<[number, number]>>;
  landRule?: 'evenodd' | 'nonzero';
  /**
   * The rules' cell raster (GEO's WorldMap.raster: equirectangular, row 0 = north; site index, -1 sea, -2 land of
   * nobody). When given, a texel's candidates are the labels of its 3x3 neighbourhood (cells never jump a sea, as in
   * the rules) and the exact bisector between them is still found per fragment; without it, plain nearest sites.
   */
  labels?: { w: number; h: number; label: Int16Array };
  /** Where to draw each site's badge (lon, lat), if not the site itself. */
  anchors?: Array<[number, number] | null>;
  /** Sea lanes (site index pairs), drawn faintly. */
  lanes?: Array<[number, number]>;
  /** Fragments farther than this (degrees) from every site are unclaimed land (remote islands). */
  maxReach?: number;
}

export interface GlobeOptions {
  /** 'low' = pixel ratio 1, no antialias. */
  quality?: 'low' | 'medium' | 'high';
  /** Tap / click on a territory (site index) or the sea (-1). */
  onPick?(site: number): void;
  /** Hover (desktop pointer): site index or -1. */
  onHover?(site: number, x: number, y: number): void;
  /** Landmark icon images (optional, filled in lazily). */
  icon?(landmark: string): CanvasImageSource | null;
  /** Reduced motion: no fly-to animation, no flowing dashes. */
  reducedMotion?: boolean;
}

const D2R = Math.PI / 180;
export const MAX_SITES = 255;
const FLAG = { sel: 1, source: 2, target: 4, hover: 8, dim: 16, hatch: 32, flash: 64, mine: 128 } as const;

export function lonLatToVec(lon: number, lat: number, out = new THREE.Vector3(), r = 1): THREE.Vector3 {
  const cl = Math.cos(lat * D2R);
  return out.set(cl * Math.sin(lon * D2R) * r, Math.sin(lat * D2R) * r, cl * Math.cos(lon * D2R) * r);
}
export function vecToLonLat(v: THREE.Vector3): [number, number] {
  const n = v.clone().normalize();
  return [Math.atan2(n.x, n.z) / D2R, Math.asin(Math.max(-1, Math.min(1, n.y))) / D2R];
}

// =====================================================================================================
// Texture builders (CPU, once per world)
// =====================================================================================================
/** Rasterise land rings into an equirectangular mask (0..255), lightly blurred so linear filtering gives smooth coasts. */
export function landMask(rings: GlobeWorld['land'], w = 2048, h = 1024, rule: 'evenodd' | 'nonzero' = 'nonzero'): Uint8Array {
  const out = new Uint8Array(w * h);
  let data: Uint8ClampedArray | null = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (g) {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.beginPath();
      for (const r of rings) {
        r.forEach(([lon, lat], k) => {
          const x = ((lon + 180) / 360) * w, y = ((90 - lat) / 180) * h;
          if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        g.closePath();
      }
      g.fill(rule);
      data = g.getImageData(0, 0, w, h).data;
    }
  }
  if (data) for (let i = 0; i < w * h; i++) out[i] = data[i * 4];
  else rasterRings(rings, w, h, out); // (tests: no canvas)
  // separable 3-tap box blur, horizontally wrapping
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) tmp[o + x] = (out[o + ((x + w - 1) % w)] + out[o + x] * 2 + out[o + ((x + 1) % w)]) >> 2;
  }
  for (let y = 0; y < h; y++) {
    const a = Math.max(0, y - 1) * w, b = y * w, c = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) out[b + x] = (tmp[a + x] + tmp[b + x] * 2 + tmp[c + x]) >> 2;
  }
  return out;
}

/** Scanline even-odd fill (fallback without a 2D canvas). */
function rasterRings(rings: GlobeWorld['land'], w: number, h: number, out: Uint8Array) {
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180;
    const xs: number[] = [];
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [lo1, la1] = r[j], [lo2, la2] = r[i];
        if ((la1 > lat) !== (la2 > lat)) xs.push(lo1 + ((lat - la1) / (la2 - la1)) * (lo2 - lo1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.round(((xs[k] + 180) / 360) * w)), x1 = Math.min(w, Math.round(((xs[k + 1] + 180) / 360) * w));
      for (let x = x0; x < x1; x++) out[y * w + x] = 255;
    }
  }
}

/**
 * For every texel of an equirectangular grid, the 4 nearest sites (indices, 255 = none), computed coarse-to-fine:
 * a coarse cell's candidate list holds every site within d4(centre) + 2 r(cell), which provably contains the 4
 * nearest sites of every texel inside it.
 */
export function nearestSites(sites: GlobeSite[], w = 512, h = 256): Uint8Array {
  const n = Math.min(sites.length, MAX_SITES);
  const sx = new Float64Array(n), sy = new Float64Array(n), sz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cl = Math.cos(sites[i].lat * D2R);
    sx[i] = cl * Math.sin(sites[i].lon * D2R); sy[i] = Math.sin(sites[i].lat * D2R); sz[i] = cl * Math.cos(sites[i].lon * D2R);
  }
  const out = new Uint8Array(w * h * 4).fill(255);
  if (!n) return out;
  const B = 8; // fine texels per coarse cell side
  const cw = Math.ceil(w / B), ch = Math.ceil(h / B);
  const vec = (u: number, v: number): [number, number, number] => {
    const lon = (u / w) * 360 - 180, lat = 90 - (v / h) * 180;
    const cl = Math.cos(lat * D2R);
    return [cl * Math.sin(lon * D2R), Math.sin(lat * D2R), cl * Math.cos(lon * D2R)];
  };
  const ang = (a: [number, number, number], i: number) => Math.acos(Math.max(-1, Math.min(1, a[0] * sx[i] + a[1] * sy[i] + a[2] * sz[i])));
  const cand: number[] = [];
  const dist = new Float64Array(n);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const u0 = cx * B, v0 = cy * B, u1 = Math.min(w, u0 + B), v1 = Math.min(h, v0 + B);
      const c = vec((u0 + u1) / 2, (v0 + v1) / 2);
      // the cell's angular radius: the farthest corner / edge midpoint from its centre
      let rc = 0;
      for (const [u, v] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1], [(u0 + u1) / 2, v0], [(u0 + u1) / 2, v1]] as const) {
        const q = vec(u, v);
        rc = Math.max(rc, Math.acos(Math.max(-1, Math.min(1, q[0] * c[0] + q[1] * c[1] + q[2] * c[2]))));
      }
      for (let i = 0; i < n; i++) dist[i] = ang(c, i);
      const sorted = Array.from(dist).sort((a, b) => a - b);
      const d4 = sorted[Math.min(3, n - 1)];
      cand.length = 0;
      for (let i = 0; i < n; i++) if (dist[i] <= d4 + 2 * rc + 1e-9) cand.push(i);
      for (let v = v0; v < v1; v++) {
        for (let u = u0; u < u1; u++) {
          const q = vec(u + 0.5, v + 0.5);
          let b0 = -1, b1 = -1, b2 = -1, b3 = -1, d0 = -2, d1 = -2, d2 = -2, d3 = -2;
          for (const i of cand) {
            const d = q[0] * sx[i] + q[1] * sy[i] + q[2] * sz[i];
            if (d > d3) {
              if (d > d0) { b3 = b2; d3 = d2; b2 = b1; d2 = d1; b1 = b0; d1 = d0; b0 = i; d0 = d; }
              else if (d > d1) { b3 = b2; d3 = d2; b2 = b1; d2 = d1; b1 = i; d1 = d; }
              else if (d > d2) { b3 = b2; d3 = d2; b2 = i; d2 = d; }
              else { b3 = i; d3 = d; }
            }
          }
          const o = (v * w + u) * 4;
          out[o] = b0 < 0 ? 255 : b0; out[o + 1] = b1 < 0 ? 255 : b1; out[o + 2] = b2 < 0 ? 255 : b2; out[o + 3] = b3 < 0 ? 255 : b3;
        }
      }
    }
  }
  return out;
}

/** Candidate texture from a label raster: up to 4 distinct site labels of each texel's 3x3 neighbourhood (255 = none). */
export function candidatesFromLabels(L: { w: number; h: number; label: Int16Array }): Uint8Array {
  const { w, h, label } = L;
  const out = new Uint8Array(w * h * 4).fill(255);
  const c = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      const self = label[y * w + x];
      if (self >= 0 && self < MAX_SITES) c[n++] = self; // (the texel's own label first: it survives a crowded neighbourhood)
      for (let dy = -1; dy <= 1 && n < 4; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1 && n < 4; dx++) {
          const v = label[yy * w + ((x + dx + w) % w)];
          if (v < 0 || v >= MAX_SITES) continue;
          let dup = false;
          for (let k = 0; k < n; k++) if (c[k] === v) { dup = true; break; }
          if (!dup) c[n++] = v;
        }
      }
      const o = (y * w + x) * 4;
      for (let k = 0; k < n; k++) out[o + k] = c[k];
    }
  }
  return out;
}

// =====================================================================================================
// Shaders
// =====================================================================================================
const VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vView;
void main() {
  vPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D candTex;
uniform sampler2D landTex;
uniform sampler2D siteTex;
uniform sampler2D terrTex;
uniform vec2 candSize;
uniform float time;
uniform float reach;
uniform vec3 accent;
uniform float px; // device pixels per CSS pixel (line widths)
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vView;

const float PI = 3.141592653589793;

vec4 siteAt(float i) { return texture2D(siteTex, vec2((i + 0.5) / 256.0, 0.5)); }
vec4 terrAt(float t) { return texture2D(terrTex, vec2((t + 0.5) / 256.0, 0.5)); }
bool flag(float a, float bit) { return mod(floor(a * 255.0 + 0.5) / bit, 2.0) >= 1.0; }

void main() {
  vec3 p = normalize(vPos);
  float lon = atan(p.x, p.z);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  float land = texture2D(landTex, uv).r;
  float landW = max(fwidth(land), 1e-4);
  float landA = smoothstep(-0.5, 0.5, (land - 0.5) / landW);
  float coastD = abs(land - 0.5) / landW; // pixels to the coastline

  // lighting: soft key light from the upper left of the view, plus a rim
  float ndl = clamp(dot(vNormalW, normalize(vec3(-0.35, 0.55, 0.75))), 0.0, 1.0);
  float rim = pow(1.0 - clamp(dot(vNormalW, vView), 0.0, 1.0), 2.4);
  float shade = 0.55 + 0.45 * ndl;

  // ocean: deep navy, a faint graticule every 15 degrees
  vec3 sea = mix(vec3(0.012, 0.035, 0.06), vec3(0.03, 0.09, 0.15), ndl);
  vec2 g = vec2(lon, lat) / (PI / 12.0);
  // (fwidth of a longitude taken with its seam on the other side: no line where atan wraps)
  vec2 gw = vec2(min(fwidth(lon), fwidth(atan(-p.x, -p.z))), fwidth(lat)) / (PI / 12.0);
  vec2 gd = abs(fract(g - 0.5) - 0.5) / max(gw, vec2(1e-4));
  float grid = 1.0 - smoothstep(0.0, 1.0, min(gd.x, gd.y));
  sea += accent * grid * 0.06;
  vec3 col = sea;

  if (land > 0.02) {
    // nearest site among this texel's candidates, the nearest site of another territory, of another zone
    vec4 c = floor(texture2D(candTex, uv) * 255.0 + 0.5);
    float ids[4];
    ids[0] = c.r; ids[1] = c.g; ids[2] = c.b; ids[3] = c.a;
    float bestD = -2.0; vec3 bestP = vec3(0.0); float bestT = 255.0; float bestZ = -1.0;
    for (int k = 0; k < 4; k++) {
      if (ids[k] > 254.5) continue;
      vec4 s = siteAt(ids[k]);
      float d = dot(p, s.xyz);
      if (d > bestD) { bestD = d; bestP = s.xyz; bestT = mod(s.w, 256.0); bestZ = floor(s.w / 256.0); }
    }
    // pixels to each bisector, from the exact screen-space gradient of the plane distance (continuous across
    // texels, unlike fwidth of a value whose candidate set changes)
    vec3 dpx = dFdx(p), dpy = dFdy(p);
    float tPix = 1e4, zPix = 1e4; float otherT = 255.0;
    for (int k = 0; k < 4; k++) {
      if (ids[k] > 254.5) continue;
      vec4 s = siteAt(ids[k]);
      float t = mod(s.w, 256.0), z = floor(s.w / 256.0);
      vec3 ab = bestP - s.xyz;
      float l = length(ab);
      if (l < 1e-6) continue;
      vec3 n = ab / l;
      float e = (bestD - dot(p, s.xyz)) / l;
      float px1 = e / max(length(vec2(dot(dpx, n), dot(dpy, n))), 1e-7);
      if (t != bestT && px1 < tPix) { tPix = px1; otherT = t; }
      if (z != bestZ && px1 < zPix) zPix = px1;
    }
    float far = acos(clamp(bestD, -1.0, 1.0));
    vec3 baseLand = vec3(0.10, 0.15, 0.19) * shade;
    vec3 lc = baseLand;
    float a = 0.0;
    vec4 tc = vec4(0.0);
    bool claimed = bestT < 254.5 && far < reach;
    if (claimed) {
      tc = terrAt(bestT);
      a = tc.a;
      bool dim = flag(a, 16.0);
      vec3 own = tc.rgb;
      if (dim) lc = baseLand * 1.1;
      else {
        float k = 0.62;
        if (flag(a, 1.0)) k = 0.95 + 0.05 * sin(time * 4.0);
        else if (flag(a, 2.0)) k = 0.88;
        else if (flag(a, 4.0)) k = 0.7 + 0.18 * (0.5 + 0.5 * sin(time * 3.2));
        if (flag(a, 8.0)) k = min(1.0, k + 0.18);
        lc = mix(baseLand, own * shade, k);
        if (flag(a, 32.0)) { // hatching (rival powers)
          float hh = mod(gl_FragCoord.x + gl_FragCoord.y, 9.0 * px);
          lc *= hh < 2.2 * px ? 0.72 : 1.0;
        }
        if (flag(a, 64.0)) lc = mix(lc, vec3(1.0, 0.95, 0.75), 0.35 + 0.35 * sin(time * 10.0));
      }
    }
    // borders: pixels to the nearest bisector (constant width at any zoom)
    float tLine = 1.0 - smoothstep(0.35 * px, 1.25 * px, tPix);
    float zLine = 1.0 - smoothstep(1.0 * px, 2.3 * px, zPix);
    float oa = otherT < 254.5 ? terrAt(otherT).a : 0.0;
    bool selEdge = claimed && (flag(a, 1.0) || (otherT < 254.5 && flag(oa, 1.0)));
    // the front: where your territory meets a rival's (orange, with a glow)
    bool front = claimed && otherT < 254.5 && ((flag(a, 128.0) && flag(oa, 32.0)) || (flag(oa, 128.0) && flag(a, 32.0)));
    lc = mix(lc, vec3(0.0), tLine * 0.55);
    lc = mix(lc, vec3(0.86, 0.92, 1.0), zLine * 0.55);
    if (front) {
      float fLine = 1.0 - smoothstep(0.8 * px, 1.9 * px, tPix);
      float fGlow = 1.0 - smoothstep(1.5 * px, 6.0 * px, tPix);
      lc = mix(lc, vec3(1.0, 0.62, 0.22), fGlow * 0.35);
      lc = mix(lc, vec3(1.0, 0.72, 0.3), fLine);
    }
    if (selEdge) {
      float sLine = 1.0 - smoothstep(1.2 * px, 2.6 * px, tPix);
      lc = mix(lc, vec3(1.0), sLine);
    }
    col = mix(sea, lc, landA);
  }
  // coastline glow
  float coast = 1.0 - smoothstep(0.0, 1.6 * px, coastD);
  col += accent * coast * 0.35;
  col += accent * rim * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`;

const ATMO_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ATMO_FRAG = /* glsl */ `
uniform vec3 accent;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(clamp(1.0 + dot(vN, vV) * 1.0, 0.0, 1.0), 3.0);
  float i = pow(1.0 - abs(dot(vN, vV)), 6.0);
  gl_FragColor = vec4(accent * (0.55 * i + 0.25 * f), 1.0);
}`;

// =====================================================================================================
// The globe
// =====================================================================================================
interface Badge { i: number; x: number; y: number; vis: number; r: number; dot?: boolean; pri: number }

export class Globe {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private g2: CanvasRenderingContext2D;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.05, 20);
  private mat: THREE.ShaderMaterial | null = null;
  private atmo: THREE.ShaderMaterial | null = null;
  private terrData = new Uint8Array(256 * 4);
  private terrTex: THREE.DataTexture | null = null;
  private textures: THREE.Texture[] = [];
  private world: GlobeWorld | null = null;
  private siteVec: THREE.Vector3[] = [];
  private cells: GlobeCell[] = [];
  private arrows: GlobeArrow[] = [];
  private flags: number[] = [];
  private landCpu: Uint8Array | null = null;
  private candCpu: Uint8Array | null = null;
  private candW = 512; private candH = 256;
  private anchorVec: THREE.Vector3[] = [];
  private landW = 1024; private landH = 512;
  private badges: Badge[] = [];
  // view: the camera looks at the globe centre from (lon, lat) at distance `dist`
  private lon = 10; private lat = 30; private dist = 3.1;
  private vLon = 0; private vLat = 0; // inertia (degrees / frame)
  private fly: { lon0: number; lat0: number; d0: number; lon1: number; lat1: number; d1: number; t: number; dur: number } | null = null;
  private dirty = true;
  private raf = 0;
  private alive = true;
  private last = 0;
  private t0 = performance.now();
  private pointers = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  private pinch0 = 0; private pinchDist0 = 0;
  private dragMoved = false;
  private hover = -1;
  private sel = -1;
  private accent = new THREE.Color(0x5ab4ff);
  private ro: ResizeObserver | null = null;
  private w = 1; private h = 1; private dpr = 1; private odpr = 1;
  private frames = 0; private fpsT = 0; fps = 0;
  /** Minimum and maximum camera distance (globe radii from the centre). */
  minDist = 1.3; maxDist = 4.2;
  private ctxLost = false;

  constructor(private opts: GlobeOptions = {}) {
    this.el = document.createElement('div');
    this.el.className = 'wg-globe';
    this.el.style.cssText = 'position:absolute;inset:0;overflow:hidden;touch-action:none;';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.el.append(this.canvas, this.overlay);
    this.g2 = this.overlay.getContext('2d')!;
    const low = opts.quality === 'low';
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !low, alpha: true, powerPreference: 'default', preserveDrawingBuffer: false });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the shader writes display colours
    } catch {
      this.renderer = null; // no WebGL: the list view still works
    }
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ctxLost = true; });
    this.canvas.addEventListener('webglcontextrestored', () => { this.ctxLost = false; this.rebuildTextures(); this.dirty = true; });
    this.bindInput();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.el);
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Whether WebGL is available (else only the list view works). */
  get ok(): boolean { return !!this.renderer; }

  setAccent(rgb: number) {
    this.accent.setHex(rgb);
    if (this.mat) (this.mat.uniforms.accent.value as THREE.Color).copy(this.accent);
    if (this.atmo) (this.atmo.uniforms.accent.value as THREE.Color).copy(this.accent);
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------------------------------
  // World and state
  // ---------------------------------------------------------------------------------------------------
  setWorld(world: GlobeWorld) {
    this.world = world;
    this.siteVec = world.sites.map((s) => lonLatToVec(s.lon, s.lat));
    this.anchorVec = world.sites.map((s, i) => { const a = world.anchors?.[i]; return a ? lonLatToVec(a[0], a[1]) : this.siteVec[i]; });
    this.rebuildTextures();
    this.dirty = true;
  }

  private rebuildTextures() {
    const world = this.world;
    if (!world) return;
    for (const t of this.textures) t.dispose();
    this.textures = [];
    const land = landMask(world.land, 2048, 1024, world.landRule);
    if (!this.renderer) { // (no GL: picking still needs the candidates)
      this.candW = world.labels ? world.labels.w : 512; this.candH = world.labels ? world.labels.h : 256;
      this.candCpu = world.labels ? candidatesFromLabels(world.labels) : nearestSites(world.sites, this.candW, this.candH);
    }
    // CPU copy for picking (downsampled 2x)
    this.landW = 1024; this.landH = 512;
    this.landCpu = new Uint8Array(this.landW * this.landH);
    for (let y = 0; y < this.landH; y++) for (let x = 0; x < this.landW; x++) this.landCpu[y * this.landW + x] = land[(y * 2) * 2048 + x * 2];
    if (!this.renderer) return;
    const landTex = new THREE.DataTexture(land, 2048, 1024, THREE.RedFormat, THREE.UnsignedByteType);
    landTex.wrapS = THREE.RepeatWrapping; landTex.wrapT = THREE.ClampToEdgeWrapping;
    landTex.magFilter = THREE.LinearFilter; landTex.minFilter = THREE.LinearFilter; landTex.generateMipmaps = false;
    landTex.needsUpdate = true;
    const cw = world.labels ? world.labels.w : 512, ch = world.labels ? world.labels.h : 256;
    this.candCpu = world.labels ? candidatesFromLabels(world.labels) : nearestSites(world.sites, cw, ch);
    this.candW = cw; this.candH = ch;
    const cand = new THREE.DataTexture(this.candCpu, cw, ch, THREE.RGBAFormat, THREE.UnsignedByteType);
    cand.magFilter = THREE.NearestFilter; cand.minFilter = THREE.NearestFilter; cand.generateMipmaps = false;
    cand.wrapS = THREE.RepeatWrapping;
    cand.needsUpdate = true;
    const sd = new Float32Array(256 * 4);
    world.sites.slice(0, MAX_SITES).forEach((s, i) => {
      const v = this.siteVec[i];
      sd[i * 4] = v.x; sd[i * 4 + 1] = v.y; sd[i * 4 + 2] = v.z;
      sd[i * 4 + 3] = i + 256 * (s.zone < 0 ? 255 : Math.min(254, s.zone));
    });
    const siteTex = new THREE.DataTexture(sd, 256, 1, THREE.RGBAFormat, THREE.FloatType);
    siteTex.magFilter = THREE.NearestFilter; siteTex.minFilter = THREE.NearestFilter; siteTex.generateMipmaps = false;
    siteTex.needsUpdate = true;
    this.terrTex = new THREE.DataTexture(this.terrData, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.terrTex.magFilter = THREE.NearestFilter; this.terrTex.minFilter = THREE.NearestFilter; this.terrTex.generateMipmaps = false;
    this.terrTex.needsUpdate = true;
    this.textures.push(landTex, cand, siteTex, this.terrTex);
    if (!this.mat) {
      this.mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          candTex: { value: cand }, landTex: { value: landTex }, siteTex: { value: siteTex }, terrTex: { value: this.terrTex },
          candSize: { value: new THREE.Vector2(cw, ch) }, time: { value: 0 }, reach: { value: world.labels ? Math.PI : (world.maxReach ?? 14) * D2R },
          accent: { value: this.accent.clone() }, px: { value: 1 },
        },
      });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 80), this.mat);
      this.scene.add(sphere);
      this.atmo = new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, uniforms: { accent: { value: this.accent.clone() } },
        side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      });
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 40), this.atmo);
      this.scene.add(halo);
    } else {
      const u = this.mat.uniforms;
      u.candTex.value = cand; u.landTex.value = landTex; u.siteTex.value = siteTex; u.terrTex.value = this.terrTex;
      u.reach.value = world.labels ? Math.PI : (world.maxReach ?? 14) * D2R;
      u.candSize.value.set(cw, ch);
    }
    this.writeTerr();
  }

  /** Per-site display state (index = site index). */
  setCells(cells: GlobeCell[]) {
    this.cells = cells;
    this.writeTerr();
  }

  setArrows(arrows: GlobeArrow[]) {
    this.arrows = arrows;
    this.dirty = true;
  }

  /** Highlight flags by site index: sel, source, target, flash. */
  setMarks(m: { sel?: number; sources?: number[]; targets?: number[]; flash?: number[] }) {
    const n = this.world?.sites.length ?? 0;
    this.flags = new Array(n).fill(0);
    this.sel = m.sel ?? -1;
    if (m.sel != null && m.sel >= 0) this.flags[m.sel] |= FLAG.sel;
    for (const i of m.sources ?? []) this.flags[i] |= FLAG.source;
    for (const i of m.targets ?? []) this.flags[i] |= FLAG.target;
    for (const i of m.flash ?? []) this.flags[i] |= FLAG.flash;
    this.writeTerr();
  }

  private writeTerr() {
    const d = this.terrData;
    d.fill(0);
    const n = Math.min(this.world?.sites.length ?? 0, MAX_SITES);
    for (let i = 0; i < n; i++) {
      const c = this.cells[i];
      let f = this.flags[i] ?? 0;
      if (i === this.hover) f |= FLAG.hover;
      if (!c || c.dim) f |= FLAG.dim;
      if (c?.hatch) f |= FLAG.hatch;
      if (c?.mine) f |= FLAG.mine;
      const col = c?.color ?? 0x334455;
      d[i * 4] = (col >> 16) & 255; d[i * 4 + 1] = (col >> 8) & 255; d[i * 4 + 2] = col & 255; d[i * 4 + 3] = f;
    }
    if (this.terrTex) this.terrTex.needsUpdate = true;
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------------------------------
  /** Point the camera at a place (animated unless reduced motion or `now`). */
  flyTo(lon: number, lat: number, dist?: number, now = false) {
    const d1 = Math.max(this.minDist, Math.min(this.maxDist, dist ?? this.dist));
    let dl = ((lon - this.lon + 540) % 360) - 180;
    if (now || this.opts.reducedMotion) { this.lon = this.lon + dl; this.lat = clampLat(lat); this.dist = d1; this.fly = null; this.dirty = true; return; }
    this.fly = { lon0: this.lon, lat0: this.lat, d0: this.dist, lon1: this.lon + dl, lat1: clampLat(lat), d1, t: 0, dur: 0.75 };
    this.vLon = this.vLat = 0;
    this.dirty = true;
  }

  /** Frame a set of sites (their centre, a distance that fits their spread). */
  frameSites(idx: number[], now = false, minDist = 1.85) {
    if (!idx.length) return;
    const c = new THREE.Vector3();
    for (const i of idx) if (this.anchorVec[i]) c.add(this.anchorVec[i]);
    if (c.lengthSq() < 1e-6) return;
    c.normalize();
    let spread = 0;
    for (const i of idx) if (this.anchorVec[i]) spread = Math.max(spread, Math.acos(Math.max(-1, Math.min(1, c.dot(this.anchorVec[i])))));
    const [lon, lat] = vecToLonLat(c);
    // distance so that `spread` (radians) fits in ~40% of the smaller view half-angle
    const half = (this.camera.fov / 2) * D2R * Math.min(1, this.camera.aspect);
    const want = 1 + Math.sin(Math.max(spread, 0.12)) / Math.tan(half * 0.8);
    this.flyTo(lon, lat, Math.max(minDist, this.minDist, Math.min(this.maxDist, want)), now);
  }

  zoomBy(f: number) {
    this.fly = null;
    this.dist = Math.max(this.minDist, Math.min(this.maxDist, 1 + (this.dist - 1) * f));
    this.dirty = true;
  }

  rotateBy(dLon: number, dLat: number) {
    this.fly = null;
    this.lon += dLon; this.lat = clampLat(this.lat + dLat);
    this.dirty = true;
  }

  get view() { return { lon: this.lon, lat: this.lat, dist: this.dist }; }

  // ---------------------------------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------------------------------
  private bindInput() {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
      if (this.pointers.size === 1) this.dragMoved = false;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDist0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.pinch0 = this.dist;
        this.dragMoved = true;
      }
      this.vLon = this.vLat = 0;
      this.fly = null;
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse') this.hoverAt(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 6) this.dragMoved = true;
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.dist = Math.max(this.minDist, Math.min(this.maxDist, 1 + (this.pinch0 - 1) * (this.pinchDist0 / d)));
        this.dirty = true;
        return;
      }
      if (!this.dragMoved) return;
      // degrees per pixel: the visible arc shrinks as the camera closes in
      const k = (this.camera.fov * (this.dist - 1)) / Math.max(1, this.h) / Math.max(0.3, this.dist - 0.4) * 1.9;
      const dl = -dx * k / Math.max(0.25, Math.cos(this.lat * D2R)), dt = dy * k;
      this.lon += dl; this.lat = clampLat(this.lat + dt);
      this.vLon = dl; this.vLat = dt;
      this.dirty = true;
    });
    const up = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 0 && !this.dragMoved && e.type === 'pointerup') {
        const r = this.el.getBoundingClientRect();
        const site = this.pickAt(e.clientX - r.left, e.clientY - r.top);
        this.opts.onPick?.(site);
        this.vLon = this.vLat = 0;
      }
      if (this.pointers.size === 1) { const q = [...this.pointers.values()][0]; q.x0 = q.x; q.y0 = q.y; }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.pointers.size) this.setHover(-1, 0, 0); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(Math.max(-1, Math.min(1, e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))));
      this.zoomBy(f);
    }, { passive: false });
  }

  private hoverAt(cx: number, cy: number) {
    const r = this.el.getBoundingClientRect();
    const x = cx - r.left, y = cy - r.top;
    this.setHover(this.pickAt(x, y), x, y);
  }

  private setHover(i: number, x: number, y: number) {
    if (i !== this.hover) {
      this.hover = i;
      this.writeTerr();
    }
    this.opts.onHover?.(i, x, y);
  }

  /** The site under a point of the element (CSS px), -1 for the sea or space. Badges win over the surface. */
  pickAt(x: number, y: number): number {
    if (!this.world) return -1;
    let best = -1, bd = 1e9;
    for (const b of this.badges) {
      if (b.vis < 0.5) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < (b.dot ? 7 : b.r + 6) && d < bd) { bd = d; best = b.i; }
    }
    if (best >= 0) return best;
    const ndc = new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1);
    const ray = new THREE.Raycaster();
    this.updateCamera();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const b = o.dot(d), c = o.lengthSq() - 1, disc = b * b - c;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    const p = o.clone().addScaledVector(d, t).normalize();
    return this.siteAt(p);
  }

  /** The territory (site) at a point of the unit sphere, honouring the land mask and the reach. */
  siteAt(p: THREE.Vector3): number {
    const [lon, lat] = vecToLonLat(p);
    let best = -1, bd = -2;
    if (this.world?.labels && this.candCpu) {
      // the same candidates as the shader (the rules' cells), then the nearest of them
      const x = Math.floor(((lon + 180) / 360) * this.candW) % this.candW, y = Math.max(0, Math.min(this.candH - 1, Math.floor(((90 - lat) / 180) * this.candH)));
      const o = (y * this.candW + ((x + this.candW) % this.candW)) * 4;
      for (let k = 0; k < 4; k++) {
        const i = this.candCpu[o + k];
        if (i === 255 || !this.siteVec[i]) continue;
        const d = this.siteVec[i].dot(p);
        if (d > bd) { bd = d; best = i; }
      }
      if (best < 0) return -1;
      return this.landAt(lon, lat) >= 100 || this.nearSiteBadge(best, p) ? best : -1;
    }
    this.siteVec.forEach((s, i) => { const d = s.dot(p); if (d > bd) { bd = d; best = i; } });
    if (best < 0) return -1;
    const land = this.landAt(lon, lat);
    const ang = Math.acos(Math.max(-1, Math.min(1, bd))) / D2R;
    if (land < 100 && ang > 2.2) return -1; // the sea (a tap right next to a small island's site still counts)
    if (ang > (this.world?.maxReach ?? 14)) return -1;
    return best;
  }

  /** A tap on the sea right next to a small island's site still counts. */
  private nearSiteBadge(i: number, p: THREE.Vector3): boolean {
    return Math.acos(Math.max(-1, Math.min(1, this.siteVec[i].dot(p)))) / D2R < 2.2;
  }

  private landAt(lon: number, lat: number): number {
    if (!this.landCpu) return 0;
    const x = Math.floor((((lon + 180) / 360) * this.landW) % this.landW), y = Math.max(0, Math.min(this.landH - 1, Math.floor(((90 - lat) / 180) * this.landH)));
    return this.landCpu[y * this.landW + ((x + this.landW) % this.landW)];
  }

  // ---------------------------------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------------------------------
  private resize() {
    const r = this.el.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const dev = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const q = this.opts.quality ?? 'medium';
    const dpr = Math.min(dev, q === 'low' ? 1 : q === 'medium' ? 1.5 : 2);
    const odpr = Math.min(dev, 2);
    if (w === this.w && h === this.h && dpr === this.dpr && odpr === this.odpr && this.overlay.width === Math.round(w * odpr)) return;
    this.w = w; this.h = h; this.dpr = dpr; this.odpr = odpr;
    this.renderer?.setPixelRatio(dpr);
    this.renderer?.setSize(w, h, false);
    this.overlay.width = Math.round(w * odpr); this.overlay.height = Math.round(h * odpr);
    this.camera.aspect = w / h;
    // portrait screens: a wider field of view so the globe still fits across
    this.camera.fov = w < h ? (2 * Math.atan(Math.tan((18 * Math.PI) / 180) / (w / h)) * 180) / Math.PI : 36;
    this.camera.updateProjectionMatrix();
    if (this.mat) this.mat.uniforms.px.value = dpr;
    this.dirty = true;
  }

  private updateCamera() {
    lonLatToVec(this.lon, this.lat, this.camera.position, this.dist);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  private animating(): boolean {
    return !!this.fly || Math.abs(this.vLon) + Math.abs(this.vLat) > 0.01 || this.flags.some((f) => f & (FLAG.target | FLAG.sel | FLAG.flash)) || this.arrows.some((a) => a.kind !== 'lane');
  }

  private frame(now: number) {
    if (!this.alive) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    if (!this.w || this.w < 2) this.resize();
    if (this.fly) {
      const f = this.fly;
      f.t += dt / f.dur;
      const k = f.t >= 1 ? 1 : 1 - Math.pow(1 - f.t, 3);
      this.lon = f.lon0 + (f.lon1 - f.lon0) * k; this.lat = f.lat0 + (f.lat1 - f.lat0) * k; this.dist = f.d0 + (f.d1 - f.d0) * k;
      if (f.t >= 1) this.fly = null;
      this.dirty = true;
    } else if (!this.pointers.size && Math.abs(this.vLon) + Math.abs(this.vLat) > 0.01) {
      this.lon += this.vLon; this.lat = clampLat(this.lat + this.vLat);
      this.vLon *= 0.92; this.vLat *= 0.92;
      this.dirty = true;
    }
    const anim = !this.opts.reducedMotion && this.animating();
    if (!this.dirty && !anim) return;
    this.dirty = false;
    this.updateCamera();
    const time = (now - this.t0) / 1000;
    if (this.mat) this.mat.uniforms.time.value = this.opts.reducedMotion ? 0 : time;
    if (this.renderer && !this.ctxLost && this.mat) this.renderer.render(this.scene, this.camera);
    this.drawOverlay(time);
    this.frames++;
    if (now - this.fpsT > 1000) { this.fps = (this.frames * 1000) / (now - this.fpsT || 1); this.frames = 0; this.fpsT = now; }
  }

  /** Force a render now (screenshots, the share card). */
  renderNow() {
    this.resize();
    this.updateCamera();
    if (this.renderer && this.mat) this.renderer.render(this.scene, this.camera);
    this.drawOverlay((performance.now() - this.t0) / 1000);
  }

  /** Project a unit-sphere point to CSS px; vis = how far it faces the camera (0 hidden .. 1 front). */
  private project(v: THREE.Vector3, out: { x: number; y: number; vis: number }) {
    const cam = this.camera.position;
    const facing = (v.dot(cam) - 1) / Math.max(1e-3, cam.length() - 1); // 0 at the horizon, 1 under the camera
    const p = v.clone().project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * this.w; out.y = (-p.y * 0.5 + 0.5) * this.h;
    out.vis = Math.max(0, Math.min(1, (facing - 0.03) * 7));
    return out;
  }

  /** Screen position (CSS px) of a site, null when it is on the far side. */
  screenOf(i: number): { x: number; y: number } | null {
    if (!this.anchorVec[i]) return null;
    this.updateCamera();
    const o = this.project(this.anchorVec[i], { x: 0, y: 0, vis: 0 });
    return o.vis > 0.2 ? { x: o.x, y: o.y } : null;
  }

  private drawOverlay(time: number) {
    const g = this.g2, s = this.odpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.overlay.width, this.overlay.height);
    g.setTransform(s, 0, 0, s, 0, 0);
    if (!this.world) return;
    const tmp = { x: 0, y: 0, vis: 0 };
    // sea lanes and arrows
    for (const l of this.world.lanes ?? []) this.drawArc(l[0], l[1], 'lane', undefined, 1, time);
    for (const a of this.arrows) this.drawArc(a.from, a.to, a.kind, a.color, a.t ?? 1, time);
    // badges: radius from the room around each one (so dense areas stay legible), drawn back to front
    const list: Badge[] = [];
    this.anchorVec.forEach((v, i) => {
      const c = this.cells[i];
      if (!c || c.dim) return;
      this.project(v, tmp);
      if (tmp.vis <= 0.02 || tmp.x < -30 || tmp.y < -30 || tmp.x > this.w + 30 || tmp.y > this.h + 30) return;
      const f = this.flags[i] ?? 0;
      // who keeps a full badge where they crowd: the selection and its targets, capitals, then the bigger armies
      const pri = (f & (FLAG.sel | FLAG.target | FLAG.source) ? 1e6 : 0) + (c.capital ? 1e4 : 0) + c.troops + (c.small ? -1e5 : 0);
      list.push({ i, x: tmp.x, y: tmp.y, vis: tmp.vis, r: 13, pri });
    });
    for (const b of list) {
      let nd = 1e9;
      for (const o of list) if (o !== b) nd = Math.min(nd, Math.hypot(o.x - b.x, o.y - b.y));
      b.r = Math.max(9, Math.min(14, nd * 0.48));
    }
    // declutter: a badge that would overlap a more important one shrinks to a dot (its count is in the tooltip and
    // the list view, and comes back as you zoom in), so every number on screen stays readable
    const placed: Badge[] = [];
    for (const b of [...list].sort((a, c) => c.pri - a.pri)) {
      if (placed.some((o) => Math.hypot(o.x - b.x, o.y - b.y) < (o.r + b.r) * 0.92)) b.dot = true;
      else placed.push(b);
    }
    this.badges = list;
    const zoomed = this.dist < 1.9;
    for (const b of list) if (b.dot) this.drawBadge(b, zoomed, time);
    for (const b of list) if (!b.dot) this.drawBadge(b, zoomed, time);
  }

  private drawArc(a: number, b: number, kind: GlobeArrow['kind'], color: string | undefined, upto: number, time: number) {
    const va = this.anchorVec[a], vb = this.anchorVec[b];
    if (!va || !vb) return;
    const g = this.g2;
    const ang = Math.acos(Math.max(-1, Math.min(1, va.dot(vb))));
    const lift = kind === 'lane' ? 0.015 + ang * 0.04 : 0.02 + ang * 0.12;
    const N = Math.max(8, Math.ceil(ang * 40));
    const pts: { x: number; y: number; vis: number }[] = [];
    const v = new THREE.Vector3();
    const sinA = Math.sin(ang) || 1;
    for (let k = 0; k <= N; k++) {
      const t = (k / N) * upto;
      // slerp, lifted above the surface
      const wa = Math.sin((1 - t) * ang) / sinA, wb = Math.sin(t * ang) / sinA;
      v.copy(va).multiplyScalar(wa).addScaledVector(vb, wb).normalize().multiplyScalar(1 + lift * Math.sin(Math.PI * t));
      pts.push(this.project(v, { x: 0, y: 0, vis: 0 }));
    }
    const vis = Math.min(pts[0].vis, pts[pts.length - 1].vis, ...pts.map((p) => p.vis));
    if (vis < 0.05 && kind === 'lane') return;
    if (pts.every((p) => p.vis < 0.05)) return;
    g.save();
    g.globalAlpha = Math.max(0.15, Math.min(1, vis * 1.5 + 0.2));
    g.lineCap = 'round'; g.lineJoin = 'round';
    const style = kind === 'lane' ? 'rgba(120,200,255,0.32)' : kind === 'go' ? '#ffdd78' : kind === 'rival' ? '#ff5a46' : kind === 'fortify' ? '#8dffb0' : 'rgba(255,236,170,0.85)';
    const width = kind === 'lane' ? 1.1 : kind === 'go' ? 4 : kind === 'rival' ? 3.4 : kind === 'fortify' ? 3 : kind === 'threat' ? 1.8 : 2.2;
    if (kind === 'threat') g.globalAlpha *= 0.75;
    g.strokeStyle = color ?? style;
    g.lineWidth = width;
    if (kind === 'lane') g.setLineDash([3, 5]);
    else if (kind === 'option') { g.setLineDash([4, 6]); g.lineDashOffset = this.opts.reducedMotion ? 0 : -time * 22; }
    else if (kind !== 'go') { g.setLineDash([10, 7]); g.lineDashOffset = this.opts.reducedMotion ? 0 : -time * 40; }
    if (kind === 'go' || kind === 'rival') { g.shadowColor = color ?? style; g.shadowBlur = 10; }
    // trim the ends so the arrow leaves and meets the badges
    const trimA = kind === 'lane' ? 0 : 14, trimB = kind === 'lane' ? 0 : 16;
    const path = trimPolyline(pts, trimA, upto >= 1 ? trimB : 0);
    if (path.length >= 2) {
      g.beginPath();
      path.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
      if (kind !== 'lane') {
        const p1 = path[path.length - 1], p0 = path[Math.max(0, path.length - 3)];
        const dir = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        const s = kind === 'go' ? 11 : 8.5;
        g.setLineDash([]);
        g.fillStyle = color ?? style;
        g.beginPath();
        g.moveTo(p1.x + Math.cos(dir) * s * 0.6, p1.y + Math.sin(dir) * s * 0.6);
        g.lineTo(p1.x + Math.cos(dir + 2.5) * s, p1.y + Math.sin(dir + 2.5) * s);
        g.lineTo(p1.x + Math.cos(dir - 2.5) * s, p1.y + Math.sin(dir - 2.5) * s);
        g.closePath();
        g.fill();
      }
    }
    g.restore();
  }

  private drawBadge(b: Badge, zoomed: boolean, time: number) {
    const g = this.g2, c = this.cells[b.i];
    const col = `#${c.color.toString(16).padStart(6, '0')}`;
    const r = c.small ? Math.min(b.r, 6) : b.r;
    const f = this.flags[b.i] ?? 0;
    g.save();
    g.globalAlpha = Math.min(1, b.vis * 1.4);
    if (b.dot) {
      g.fillStyle = col; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(b.x, b.y, 4, 0, Math.PI * 2); g.fill(); g.stroke();
      g.restore();
      return;
    }
    // landmark icon behind/above the badge
    if (c.landmark && this.opts.icon && (zoomed || r >= 11)) {
      const img = this.opts.icon(c.landmark);
      if (img) {
        const s = zoomed ? 30 : 20;
        try { g.drawImage(img, b.x - s / 2, b.y - r - s + 2, s, s); } catch { /* (a broken image) */ }
      }
    }
    if (f & FLAG.target && !this.opts.reducedMotion) {
      const k = (time * 0.9) % 1;
      g.strokeStyle = `rgba(255,236,170,${(0.8 * (1 - k)).toFixed(3)})`;
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(b.x, b.y, r + 3 + k * 12, 0, Math.PI * 2); g.stroke();
    }
    g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 4;
    g.fillStyle = 'rgba(6,9,14,0.9)';
    g.beginPath();
    if (c.capital) starPath(g, b.x, b.y, r * 1.35, r * 0.82);
    else g.arc(b.x, b.y, r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = f & FLAG.sel ? 3 : 2;
    g.strokeStyle = f & FLAG.sel ? '#ffffff' : col;
    g.stroke();
    const txt = c.label ?? (c.troops > 999 ? `${Math.round(c.troops / 100) / 10}k` : String(c.troops));
    const fs = Math.round(r * (txt.length >= 3 ? 0.92 : 1.1));
    g.font = `700 ${fs}px 'Share Tech Mono', ui-monospace, monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText(txt, b.x, b.y + 0.5);
    if (c.mark && r >= 11) {
      g.font = `700 ${Math.round(r * 0.6)}px 'Rajdhani', sans-serif`;
      g.fillStyle = col;
      g.fillText(c.mark, b.x + r * 0.95, b.y - r * 0.85);
    }
    g.restore();
  }

  /** Render the current view at a given size into a new 2D canvas (the share card), then restore the screen size. */
  capture(w: number, h: number): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const g = out.getContext('2d');
    if (!g) return out;
    this.w = w; this.h = h; this.odpr = 1; this.dpr = 1;
    this.renderer?.setPixelRatio(1);
    this.renderer?.setSize(w, h, false);
    this.overlay.width = w; this.overlay.height = h;
    this.camera.aspect = w / h; this.camera.fov = 36; this.camera.updateProjectionMatrix();
    if (this.mat) this.mat.uniforms.px.value = 1;
    this.updateCamera();
    if (this.renderer && this.mat && !this.ctxLost) this.renderer.render(this.scene, this.camera);
    this.drawOverlay((performance.now() - this.t0) / 1000);
    try { g.drawImage(this.canvas, 0, 0, w, h); g.drawImage(this.overlay, 0, 0, w, h); } catch { /* lost context */ }
    this.w = -1; // (forces the restore)
    this.resize();
    return out;
  }

  /** Copy the current view (globe + overlay) into a 2D context (share card). */
  drawInto(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    this.renderNow(); // (the GL buffer is only valid right after a render without preserveDrawingBuffer)
    try { g.drawImage(this.canvas, x, y, w, h); } catch { /* tainted / lost */ }
    try { g.drawImage(this.overlay, x, y, w, h); } catch { /* */ }
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    for (const t of this.textures) t.dispose();
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.mat?.dispose(); this.atmo?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss?.();
    this.renderer = null;
    this.el.remove();
  }
}

const clampLat = (l: number) => Math.max(-72, Math.min(78, l));

function starPath(g: CanvasRenderingContext2D, x: number, y: number, R: number, r: number) {
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r : R;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (k) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
}

function trimPolyline(pts: { x: number; y: number }[], a: number, b: number): { x: number; y: number }[] {
  const out = pts.map((p) => ({ x: p.x, y: p.y }));
  const cut = (list: { x: number; y: number }[], len: number) => {
    while (list.length >= 2 && len > 0) {
      const d = Math.hypot(list[1].x - list[0].x, list[1].y - list[0].y);
      if (d > len) { const k = len / d; list[0] = { x: list[0].x + (list[1].x - list[0].x) * k, y: list[0].y + (list[1].y - list[0].y) * k }; return list; }
      len -= d; list.shift();
    }
    return list;
  };
  cut(out, a);
  out.reverse();
  cut(out, b);
  return out.reverse();
}
