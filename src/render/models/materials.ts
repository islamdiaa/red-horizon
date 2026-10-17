/**
 * Shared procedural textures and material caches for the model library.
 *
 * Almost every model surface uses ONE "body" material per team colour (+ a few damage variants).
 * Per-vertex attributes select the look of each part:
 *   - `color` (vec3, linear): base albedo
 *   - `pbr`   (vec4): x = metalness, y = roughness, z = team-colour mask (0..1),
 *                     w = detail channel (0 = metal panels, 1 = concrete, 2 = fabric, 3 = none)
 * The detail map is a packed data texture (R metal panels/rivets, G concrete, B fabric, A scorch mask).
 * This lets a whole tank/building body render in a single draw call while still mixing team paint,
 * gunmetal, rubber, glass, concrete, canvas, etc.
 */
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Tileable value noise helpers (deterministic)
// ---------------------------------------------------------------------------------------------

function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise; `period` lattice cells across the texture. u,v in 0..1. */
function vnoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const wrap = (n: number) => ((n % period) + period) % period;
  const a = hash(wrap(x0), wrap(y0), seed);
  const b = hash(wrap(x0 + 1), wrap(y0), seed);
  const c = hash(wrap(x0), wrap(y0 + 1), seed);
  const d = hash(wrap(x0 + 1), wrap(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(u: number, v: number, period: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u, v, p, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------------------------------------
// Packed detail texture (R metal, G concrete, B fabric, A scorch mask)
// ---------------------------------------------------------------------------------------------

let detailTex: THREE.DataTexture | null = null;

export function getDetailTexture(): THREE.DataTexture {
  if (detailTex) return detailTex;
  const S = 256;
  const data = new Uint8Array(S * S * 4);

  // Metal panel layout: rows of panels with staggered vertical seams.
  const rows = [
    { y0: 0, y1: 84, xs: [0, 110, 196] },
    { y0: 84, y1: 170, xs: [52, 150] },
    { y0: 170, y1: 256, xs: [0, 88, 180] },
  ];
  // Concrete cracks (random walks) rasterised into a mask.
  const crack = new Float32Array(S * S);
  let rs = 12345;
  const rnd = () => {
    rs = (Math.imul(rs, 1103515245) + 12345) | 0;
    return ((rs >>> 8) & 0xffff) / 65535;
  };
  for (let c = 0; c < 7; c++) {
    let x = rnd() * S;
    let y = rnd() * S;
    let a = rnd() * Math.PI * 2;
    const len = 30 + rnd() * 70;
    for (let i = 0; i < len; i++) {
      a += (rnd() - 0.5) * 0.7;
      x += Math.cos(a);
      y += Math.sin(a);
      const ix = ((Math.round(x) % S) + S) % S;
      const iy = ((Math.round(y) % S) + S) % S;
      crack[iy * S + ix] = 1;
    }
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const i = (y * S + x) * 4;

      // ---- R: painted metal panels
      let m = 0.87 + (fbm(u, v, 8, 3, 1) - 0.5) * 0.07;
      const grime = fbm(u, v, 4, 3, 9);
      m -= Math.max(0, grime - 0.55) * 0.35;
      const row = rows.find((r) => y >= r.y0 && y < r.y1)!;
      const dyTop = y - row.y0;
      let seam = dyTop; // distance to horizontal seam
      let dSeamX = 999;
      for (const sx of row.xs) {
        const d = Math.min(Math.abs(x - sx), Math.abs(x - sx - S), Math.abs(x - sx + S));
        dSeamX = Math.min(dSeamX, d);
      }
      seam = Math.min(seam, dSeamX);
      if (seam < 1) m *= 0.55;
      else if (seam < 2) m = Math.min(1, m * 1.12);
      else if (seam < 4) m *= 0.97;
      // rivets along horizontal seams
      if (dyTop >= 4 && dyTop <= 8) {
        const rx = (x + 3) % 12;
        const dx = rx - 6;
        const dy = dyTop - 6;
        const d2 = dx * dx + dy * dy;
        if (d2 <= 1.2) m = Math.min(1, m * 1.13);
        else if (d2 <= 4) m *= 0.78;
      }
      // fine scratches
      const scratch = vnoise(u * 3.0, v * 0.25, 64, 77);
      if (scratch > 0.93) m = Math.min(1, m * 1.06);

      // ---- G: concrete
      let c = 0.84 + (fbm(u, v, 8, 4, 31) - 0.5) * 0.22;
      c += (hash(x, y, 5) - 0.5) * 0.08; // speckle
      if (hash(x >> 1, y >> 1, 8) > 0.985) c -= 0.12; // pits
      const jx = Math.min(x % 128, 128 - (x % 128));
      const jy = Math.min(y % 128, 128 - (y % 128));
      const j = Math.min(jx, jy);
      if (j < 1) c *= 0.6;
      else if (j < 2) c *= 0.85;
      if (crack[y * S + x]) c *= 0.7;
      c -= Math.max(0, fbm(u, v, 3, 2, 55) - 0.6) * 0.3; // water stains

      // ---- B: fabric / organic
      let f = 0.86 + (fbm(u, v, 16, 3, 61) - 0.5) * 0.12;
      f += (((x >> 1) + (y >> 1)) & 1 ? 0.035 : -0.035);
      f -= Math.max(0, grime - 0.6) * 0.25;

      // ---- A: scorch mask (low frequency blotches)
      const s = clamp01((fbm(u, v, 4, 4, 91) - 0.3) * 2.2);

      data[i] = Math.round(clamp01(m) * 255);
      data[i + 1] = Math.round(clamp01(c) * 255);
      data[i + 2] = Math.round(clamp01(f) * 255);
      data[i + 3] = Math.round(s * 255);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  detailTex = tex;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Damage / weathering texture (R cracks, G missing-panel mask, B grime streaks, A dust mottling)
// ---------------------------------------------------------------------------------------------

let damageTex: THREE.DataTexture | null = null;

/**
 * Tileable 256² damage map sampled by every body material (box-projected UVs, so walls get vertical
 * streaks): R = branching crack network, G = blotchy "missing panel" mask (the shader cuts holes with an
 * ember rim at a threshold), B = rain / soot streaks running down walls, A = dust mottling for top faces.
 */
export function getDamageTexture(): THREE.DataTexture {
  if (damageTex) return damageTex;
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const crack = new Float32Array(S * S);
  let rs = 987654;
  const rnd = () => {
    rs = (Math.imul(rs, 1103515245) + 12345) | 0;
    return ((rs >>> 8) & 0xffff) / 65535;
  };
  const stamp = (x: number, y: number, w: number) => {
    const r = Math.ceil(w + 1);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        const v = Math.max(0, 1 - Math.max(0, d - w * 0.5) / 0.9);
        if (v <= 0) continue;
        const ix = (((Math.round(x) + dx) % S) + S) % S;
        const iy = (((Math.round(y) + dy) % S) + S) % S;
        const k = iy * S + ix;
        if (v > crack[k]) crack[k] = v;
      }
    }
  };
  const walk = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    for (let i = 0; i < len; i++) {
      a += (rnd() - 0.5) * 0.55;
      x += Math.cos(a);
      y += Math.sin(a);
      stamp(x, y, w * (1 - (i / len) * 0.6));
      if (depth < 2 && rnd() < 0.045) walk(x, y, a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.6), len * 0.45, w * 0.7, depth + 1);
    }
  };
  for (let c = 0; c < 11; c++) walk(rnd() * S, rnd() * S, rnd() * Math.PI * 2, 30 + rnd() * 70, 0.5 + rnd() * 0.6, 0);
  // missing panels: a few panel-shaped rectangles with ragged edges
  const rects: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const w = 14 + rnd() * 24;
    const h = 10 + rnd() * 18;
    rects.push([rnd() * S, rnd() * S, w, h]);
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const i = (y * S + x) * 4;
      // G: panel loss mask (0.5 = intact, > 0.665 hole, 0.6 .. 0.665 burnt rim)
      let g = 0.5 + Math.max(0, fbm(u, v, 5, 4, 201) - 0.68) * 1.2;
      for (const [rx, ry, rw, rh] of rects) {
        const dx = Math.min(Math.abs(x - rx), S - Math.abs(x - rx));
        const dy = Math.min(Math.abs(y - ry), S - Math.abs(y - ry));
        const edge = Math.max(dx - rw / 2, dy - rh / 2);
        const jag = (vnoise(u, v, 32, 207) - 0.5) * 7;
        const k = clamp01(1 - (edge + jag) / 6);
        g = Math.max(g, 0.5 + 0.32 * k);
      }
      // B: streaks (vertical in box-projected wall UVs: u along the wall, v up)
      const streak = clamp01((vnoise(u, v * 0.12, 48, 211) - 0.45) * 2.4) * (0.55 + 0.45 * fbm(u, v, 3, 2, 213));
      // A: dust mottling
      const dust = clamp01((fbm(u, v, 6, 3, 217) - 0.35) * 1.8);
      data[i] = Math.round(clamp01(crack[y * S + x]) * 255);
      data[i + 1] = Math.round(clamp01(g) * 255);
      data[i + 2] = Math.round(streak * 255);
      data[i + 3] = Math.round(dust * 255);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  damageTex = tex;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Track tread texture (one link per tile along U)
// ---------------------------------------------------------------------------------------------

let treadTex: THREE.CanvasTexture | null = null;

function getTreadTexture(): THREE.CanvasTexture {
  if (treadTex) return treadTex;
  const W = 32;
  const H = 64;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#34343a';
  g.fillRect(0, 0, W, H);
  // guide edges
  g.fillStyle = '#2a2a2e';
  g.fillRect(0, 0, W, 6);
  g.fillRect(0, H - 6, W, 6);
  // grouser bar (raised cleat)
  g.fillStyle = '#5c5c62';
  g.fillRect(6, 6, 12, H - 12);
  g.fillStyle = '#7b7b82';
  g.fillRect(6, 6, 3, H - 12);
  g.fillStyle = '#1e1e22';
  g.fillRect(18, 6, 2, H - 12);
  // link gap
  g.fillStyle = '#121214';
  g.fillRect(W - 3, 0, 3, H);
  // centre guide horn
  g.fillStyle = '#6a6a70';
  g.fillRect(22, H / 2 - 4, 6, 8);
  // pins
  g.fillStyle = '#8a8a90';
  g.fillRect(W - 6, 2, 3, 3);
  g.fillRect(W - 6, H - 5, 3, 3);
  // grime noise
  const img = g.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const n = 0.85 + hash(x, y, 3) * 0.25;
      img.data[k] = Math.min(255, img.data[k] * n * 1.04);
      img.data[k + 1] = Math.min(255, img.data[k + 1] * n * 0.98);
      img.data[k + 2] = Math.min(255, img.data[k + 2] * n * 0.92);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  treadTex = tex;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Body material (uber material, one per team colour & damage variant)
// ---------------------------------------------------------------------------------------------

export const BodyVariant = { Normal: 0, Damaged: 1, Wrecked: 2, Charred: 3, Electro: 4 } as const;

const VARIANT_SCORCH = [0, 0.38, 0.62, 1.0, 0.0];
/** Ember glow in cracks and panel holes per variant (burning wrecks glow, charred ones smoulder). */
const VARIANT_EMBER = [0, 0.15, 1.0, 0.45, 0.0];

/** Clock shared by every body material (ember flicker). Advance it with setBodyTime(). */
const uBodyTime = { value: 0 };

/** Advance the shared body-material clock (seconds); the destruction system calls it each frame. */
export function setBodyTime(t: number): void {
  uBodyTime.value = t;
}

/** [STRUCT] Climate snow cover shared by every body material (0 = none, 1 = deep winter). */
const uRhSnow = { value: 0 };

/**
 * [STRUCT] Snow that has settled on models: 1 for the winter climate, 0 elsewhere. Settles on up-facing
 * surfaces (scaled per part by Mat.snow and per model by NB.snow; kept out of crevices). Falling snow is
 * added on top by the weather surface patch (uWxSnow). The bridge renderer sets it from the map climate.
 */
export function setModelSnow(k: number): void {
  uRhSnow.value = Math.max(0, Math.min(1, k));
}

/** [HD] The clock and settled-snow uniforms shared by every body material (HD materials bind them too). */
export const BODY_SHARED_UNIFORMS = { uBodyTime, uRhSnow };

/** [STRUCT] Current settled-snow level (thumbnails render clean and restore it afterwards). */
export function getModelSnow(): number {
  return uRhSnow.value;
}

/** [STRUCT] Body shader detail: 0 = Low preset (no edge wear / streak / bump work), 1 = full. */
let bodyDetail = 1;

/** [STRUCT] Switch the body shader detail (recompiles the cached body materials when it changes). */
export function setBodyDetail(level: number): void {
  const l = level > 0 ? 1 : 0;
  if (l === bodyDetail) return;
  bodyDetail = l;
  for (const m of bodyCache.values()) {
    m.defines = l ? {} : { RH_LOW: '' };
    m.needsUpdate = true;
  }
}

const bodyCache = new Map<number, THREE.MeshStandardMaterial>();

/**
 * Optional shader patch applied to every lit model material (body variants and tracks), both the ones
 * already created and future ones. The engine installs the weather surface patch here so all damage
 * variants share ONE program (a variant created mid-battle must not compile a new shader).
 */
let litPatch: ((m: THREE.MeshStandardMaterial) => void) | null = null;

export function setLitMaterialPatch(fn: ((m: THREE.MeshStandardMaterial) => void) | null): void {
  if (fn === litPatch) return;
  litPatch = fn;
  if (!fn) return;
  for (const m of bodyCache.values()) applyLitPatch(m);
  for (const m of trackMats ?? []) applyLitPatch(m);
  for (const m of extraLit) applyLitPatch(m); // [HD]
}

/** [HD] Other lit model materials (HD models, hd.ts): patched like the body materials, now and later. */
const extraLit = new Set<THREE.MeshStandardMaterial>();
export function registerLitMaterial(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  extraLit.add(m);
  return applyLitPatch(m);
}

function applyLitPatch(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  if (litPatch && !m.userData.wx) {
    m.userData.wx = true;
    litPatch(m);
  }
  return m;
}

/** HDR multiplier of steady emissive parts baked into the body (windows, lamps) when powered / unpowered. */
export const BODY_EMISSIVE_ON = 2.6;
export const BODY_EMISSIVE_OFF = 0.12;

/**
 * Condition a raw team colour so it reads as military paint rather than neon plastic:
 * partially desaturate toward its luminance and cap the brightest channel (linear space).
 */
export function conditionTeamColor(hex: number): THREE.Color {
  const team = new THREE.Color(hex);
  const lum = team.r * 0.2126 + team.g * 0.7152 + team.b * 0.0722;
  team.lerp(new THREE.Color(lum, lum, lum), 0.28);
  const mx = Math.max(team.r, team.g, team.b);
  if (mx > 0.48) team.multiplyScalar(0.48 / mx);
  return team;
}

// [META] Cosmetic paint schemes (render only; src/meta/unlocks.ts, applied by src/meta/cosmetics.ts): the local
// player's units can wear a paint scheme (Arctic White, Desert Tan, Night Black, Parade Gloss...) with a hint of
// the team colour showing through. Body materials (procedural and HD) read their team colour and gloss from
// shared values per team colour, so a scheme change repaints existing materials in place: no recompile.
export interface PaintScheme { base: [number, number, number] | null; keep: number; gain: number; gloss: number }
const teamColorVals = new Map<string, THREE.Color>();
const teamGlossVals = new Map<number, { value: number }>();
let paintHex = -1;
let paintNow: PaintScheme | null = null;
function paintTeamColor(out: THREE.Color, hex: number, scale: number): THREE.Color {
  out.copy(conditionTeamColor(hex));
  const p = hex === paintHex ? paintNow : null;
  if (p) {
    out.multiplyScalar(p.gain);
    if (p.base) out.setRGB(p.base[0] + (out.r - p.base[0]) * p.keep, p.base[1] + (out.g - p.base[1]) * p.keep, p.base[2] + (out.b - p.base[2]) * p.keep);
  }
  return out.multiplyScalar(scale);
}
/** [META] The shared uTeam value of a team colour (`scale`: HD bodies divide out their baked grey). */
export function teamUniform(hex: number, scale = 1): { value: THREE.Color } {
  const key = `${hex}|${scale}`;
  let c = teamColorVals.get(key);
  if (!c) teamColorVals.set(key, (c = paintTeamColor(new THREE.Color(), hex, scale)));
  return { value: c };
}
/** [META] The shared gloss uniform of a team colour (0 = as modelled, 1 = polished paint). */
export function teamGlossUniform(hex: number): { value: number } {
  let u = teamGlossVals.get(hex);
  if (!u) teamGlossVals.set(hex, (u = { value: hex === paintHex && paintNow ? paintNow.gloss : 0 }));
  return u;
}
/** [META] Repaint the models of one team colour with a scheme (null: factory colours). One scheme at a time. */
export function setPaintScheme(hex: number, scheme: PaintScheme | null): void {
  const prev = paintHex;
  paintHex = scheme ? hex : -1;
  paintNow = scheme;
  for (const [key, c] of teamColorVals) {
    const [h, sc] = key.split('|').map(Number);
    if (h === prev || h === hex) paintTeamColor(c, h, sc);
  }
  for (const [h, u] of teamGlossVals) u.value = h === paintHex && paintNow ? paintNow.gloss : 0;
}

function makeBodyMaterial(teamHex: number, variant: number, powered: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: getDetailTexture(),
    vertexColors: true,
    metalness: 1,
    roughness: 1,
  });
  if (!bodyDetail) mat.defines = { RH_LOW: '' };
  const uniforms = {
    uTeam: teamUniform(teamHex), // [META] shared per team colour (paint schemes)
    uRhGloss: teamGlossUniform(teamHex), // [META]
    uScorch: { value: VARIANT_SCORCH[variant] ?? 0 },
    uEmber: { value: VARIANT_EMBER[variant] ?? 0 },
    uFlash: { value: variant === BodyVariant.Electro ? new THREE.Color(0.9, 1.4, 3.2) : new THREE.Color(0, 0, 0) },
    uEmissive: { value: powered && variant < BodyVariant.Charred ? BODY_EMISSIVE_ON : BODY_EMISSIVE_OFF },
    uDmg: { value: getDamageTexture() },
    uBodyTime,
    uRhSnow,
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        // [STRUCT] wear: edge wear, streaks, cavity, snow/seed (see builder.ts wearAttr); vRhP: model-space
        // position for snow noise; vRhPh: per-instance phase of animated emissive lights
        '#include <common>\nattribute vec4 pbr;\nattribute vec4 wear;\nvarying vec4 vPbr;\nvarying vec4 vWear;\nvarying vec3 vRhN;\nvarying vec3 vRhP;\nvarying float vRhPh;',
      )
      .replace('#include <color_vertex>', '#include <color_vertex>\nvPbr = pbr;\nvWear = wear;')
      // model-space normal after skinning: "up" for top-face dust (models stand upright)
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvRhN = objectNormal;')
      .replace(
        '#include <project_vertex>',
        `vRhP = transformed;
{
  vec2 rhO = modelMatrix[3].xz;
  #ifdef USE_INSTANCING
    rhO += instanceMatrix[3].xz;
  #endif
  vRhPh = fract( sin( dot( rhO, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2832;
}
#include <project_vertex>`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uTeam;
uniform float uRhGloss;
uniform float uScorch;
uniform float uEmber;
uniform vec3 uFlash;
uniform float uEmissive;
uniform sampler2D uDmg;
uniform float uBodyTime;
uniform float uRhSnow;
varying vec4 vPbr;
varying vec4 vWear;
varying vec3 vRhN;
varying vec3 vRhP;
varying float vRhPh;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 dTex = texture2D( map, vMapUv );
vec4 dmgT = texture2D( uDmg, vMapUv * 0.43 );
float dSel = vPbr.w;
float emisK = dSel > 3.5 ? dSel - 4.0 : 0.0;
float surfK = emisK > 0.0 ? 0.0 : 1.0;
float detail = dSel < 0.5 ? dTex.r : ( dSel < 1.5 ? dTex.g : ( dSel < 2.5 ? dTex.b : 0.87 ) );
detail *= 1.15;
diffuseColor.rgb *= mix( vec3( 1.0 ), uTeam, vPbr.z ) * detail * ( emisK > 0.0 ? 0.3 : 1.0 );
float rhUp = clamp( normalize( vRhN ).y, 0.0, 1.0 );
// [STRUCT] material flags packed above the roughness (builder.ts MAT_*): camo, mud, soot
float rhFlags = floor( vPbr.y * 0.5 + 0.0001 );
float rhRough = vPbr.y - 2.0 * rhFlags;
float rhCamoF = mod( rhFlags, 2.0 );
float rhMudF = mod( floor( rhFlags * 0.5 ), 2.0 );
float rhSootF = floor( rhFlags * 0.25 );
// [STRUCT] weathering v5: per-part tone, large-scale mottling, cavity occlusion
float rhSeed = fract( vWear.w );
float rhSnowK = floor( vWear.w + 0.001 ) * ( 1.0 / 7.0 );
float rhVar = texture2D( uDmg, vMapUv * 0.083 + rhSeed * 0.7 ).a;
diffuseColor.rgb *= mix( 1.0, ( 0.92 + 0.15 * rhSeed ) * ( 0.88 + 0.24 * rhVar ), surfK * ( 1.0 - vPbr.z * 0.6 ) );
diffuseColor.rgb *= 1.0 - 0.62 * vWear.z * surfK;
// weathering: soot / rain streaks down walls, dust settled on top faces
diffuseColor.rgb *= 1.0 - 0.17 * dmgT.b * ( 1.0 - rhUp ) * surfK;
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.16, 0.13, 0.09 ), rhUp * rhUp * dmgT.a * 0.24 * surfK * step( dSel, 2.5 ) );
float rhMetal = step( dSel, 0.5 ) * step( vPbr.x, 0.8 );
float rhChip = 0.0;
#ifndef RH_LOW
// rust (painted metal) and grime (concrete) streaks running down from the top edge of each part
float rhStreak = clamp( vWear.y * smoothstep( 0.2, 0.7, dmgT.b + 0.25 * rhVar - 0.1 ) * ( 1.0 - rhUp ) * surfK, 0.0, 1.0 );
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * mix( vec3( 0.5, 0.48, 0.46 ), vec3( 0.66, 0.34, 0.17 ), rhMetal ), rhStreak * 0.8 );
// worn chamfered edges: paint chipped to bare steel, concrete scuffed lighter, plus a catch-light
float rhWn = texture2D( map, vMapUv * 3.1 + 0.37 ).a;
rhChip = clamp( vWear.x * smoothstep( 0.25, 0.55, rhWn * 0.7 + rhVar * 0.5 ), 0.0, 1.0 ) * surfK;
diffuseColor.rgb *= 1.0 + 0.16 * min( vWear.x, 1.0 ) * surfK;
#endif
float scorch = smoothstep( 1.0 - uScorch, 1.25 - uScorch, dTex.a ) * min( uScorch * 1.6, 1.0 );
diffuseColor.rgb *= 1.0 - 0.86 * scorch;
// damage stages: cracks from 'damaged' on, burnt-through missing panels with glowing rims when 'wrecked'
float rhCrack = smoothstep( 0.42, 0.9, dmgT.r ) * smoothstep( 0.25, 0.4, uScorch ) * surfK;
float rhHoleK = smoothstep( 0.5, 0.62, uScorch ) * surfK;
float rhHole = smoothstep( 0.665, 0.7, dmgT.g ) * rhHoleK;
float rhRim = clamp( smoothstep( 0.6, 0.665, dmgT.g ) * rhHoleK - rhHole, 0.0, 1.0 );
diffuseColor.rgb *= 1.0 - 0.82 * rhCrack;
diffuseColor.rgb = mix( diffuseColor.rgb * ( 1.0 - 0.65 * rhRim ), vec3( 0.012, 0.01, 0.009 ), rhHole );
float rhSnow = 0.0;
float rhSn2 = 0.0;
if ( uRhSnow > 0.0 ) {
  float rhSn = texture2D( uDmg, vRhP.xz * 0.9 + 0.13 ).a;
  rhSn2 = texture2D( map, vRhP.xz * 3.7 ).a;
  rhSnow = smoothstep( 0.55, 0.85, rhUp + ( rhSn2 - 0.5 ) * 0.08 );
  // thinner where occluded (under ledges, against walls) and a soft wind-blown unevenness
  rhSnow *= uRhSnow * rhSnowK * surfK * ( 1.0 - smoothstep( 0.2, 0.7, vWear.z ) * 0.85 ) * ( 1.0 - rhHole ) * ( 1.0 - scorch * 0.7 );
  rhSnow = clamp( rhSnow * ( 0.74 + 0.26 * smoothstep( 0.0, 0.6, rhSn ) ), 0.0, 1.0 );
}`,
      )
      .replace(
        '#include <color_fragment>',
        // [STRUCT] colour replacements go after the vertex colour is applied: bare steel in paint chips, snow
        `#include <color_fragment>
// camouflage: blotches of a dark shade and a light tone (sand, or snow white in winter) over the team paint
if ( rhCamoF > 0.5 ) {
  vec2 rhCu = vMapUv * 0.3;
  float rhB1 = texture2D( uDmg, rhCu + 0.21 ).a;
  float rhB2 = texture2D( map, rhCu * 0.55 + 0.63 ).a;
  float rhCk = vPbr.z * surfK;
  float rhDark = smoothstep( 0.46, 0.52, rhB1 ) * rhCk;
  float rhLight = smoothstep( 0.5, 0.56, rhB2 ) * ( 1.0 - rhDark ) * rhCk;
  vec3 rhLightTone = mix( vec3( 0.42, 0.37, 0.26 ), vec3( 0.62, 0.65, 0.68 ), clamp( uRhSnow, 0.0, 1.0 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.42, rhDark );
  diffuseColor.rgb = mix( diffuseColor.rgb, rhLightTone * detail, rhLight );
}
// mud (winter: grey slush) caked on the lower hull with splatter above the line; exhaust soot
float rhMudK = 0.0;
float rhSootK = 0.0;
if ( rhMudF > 0.5 ) {
  float rhMn = texture2D( uDmg, vMapUv * 0.9 + 0.4 ).a;
  float rhMline = 0.07 + 0.06 * rhMn;
  rhMudK = ( 1.0 - smoothstep( rhMline - 0.03, rhMline, vRhP.y ) ) * surfK;
  rhMudK = max( rhMudK, step( 0.62, texture2D( map, vMapUv * 2.6 ).a ) * ( 1.0 - smoothstep( 0.1, 0.22, vRhP.y ) ) * 0.8 * surfK );
  vec3 rhMudC = mix( vec3( 0.16, 0.12, 0.08 ), vec3( 0.42, 0.44, 0.47 ), clamp( uRhSnow, 0.0, 1.0 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, rhMudC * ( 0.8 + 0.4 * rhMn ), rhMudK * 0.85 );
}
if ( rhSootF > 0.5 ) {
  rhSootK = ( 0.55 + 0.45 * texture2D( map, vMapUv * 1.7 + 0.2 ).a ) * surfK;
  diffuseColor.rgb *= 1.0 - 0.85 * rhSootK;
}
diffuseColor.rgb = mix( diffuseColor.rgb, mix( diffuseColor.rgb * 1.35 + 0.025, vec3( 0.42, 0.42, 0.43 ) * detail, rhMetal ), rhChip );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.76, 0.8, 0.87 ) * ( 0.93 + 0.1 * rhSn2 ), rhSnow );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        // the commented include is a hook: chained patches (weather gloss / snow cover) insert their code after it
        `float roughnessFactor = clamp( rhRough * ( 1.45 - 0.45 * detail ) + scorch * 0.35 + dmgT.b * 0.08 * ( 1.0 - rhUp ) + rhHole + rhCrack * 0.3, 0.04, 1.0 );
roughnessFactor = mix( roughnessFactor, mix( 0.62, 0.38, rhMetal ), rhChip * 0.8 );
roughnessFactor = clamp( roughnessFactor + ( rhSeed - 0.5 ) * 0.1 * surfK, 0.04, 1.0 );
roughnessFactor = mix( roughnessFactor, 0.95, max( rhMudK, rhSootK ) );
roughnessFactor = mix( roughnessFactor, 0.8, rhSnow );
#ifndef RH_LOW
roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.35, uRhGloss * vPbr.z * surfK ); // [META] parade gloss (not on Low)
#endif
// #include <roughnessmap_fragment>`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        'float metalnessFactor = mix( vPbr.x * ( 1.0 - scorch * 0.8 ) * ( 1.0 - rhHole ), 0.88, rhChip * rhMetal ) * ( 1.0 - rhSnow ) * ( 1.0 - 0.8 * max( rhMudK, rhSootK ) );',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
#ifndef RH_LOW
{
  // panel seams, rivets, concrete joints and cracks as a screen-space-derivative bump of the detail map;
  // fades out where the map is minified (far away) so it never shimmers
  vec2 rhDu = dFdx( vMapUv ), rhDv = dFdy( vMapUv );
  float rhTexel = max( dot( rhDu, rhDu ), dot( rhDv, rhDv ) ) * 65536.0;
  float rhFade = ( 1.0 - smoothstep( 1.0, 9.0, rhTexel ) ) * surfK * ( 1.0 - rhSnow * 0.8 );
  float rhH = ( detail - rhCrack * 0.6 - rhHole * 0.4 ) * 0.0035 * rhFade;
  vec2 dHdxy = vec2( dFdx( rhH ), dFdy( rhH ) );
  vec3 rhSx = dFdx( -vViewPosition ), rhSy = dFdy( -vViewPosition );
  vec3 rhR1 = cross( rhSy, normal ), rhR2 = cross( normal, rhSx );
  float rhDet = dot( rhSx, rhR1 ) * faceDirection;
  normal = normalize( abs( rhDet ) * normal - sign( rhDet ) * ( dHdxy.x * rhR1 + dHdxy.y * rhR2 ) );
}
#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// [STRUCT] baked emissive animation (Glow.a): 1 blink, 2 pulse, 3 fire flicker, 4 strobe
float rhEA = 1.0;
if ( emisK > 0.0 && vWear.x > 0.5 ) {
  float rhMode = floor( vWear.x );
  float rhPh = fract( vWear.x ) * 6.2832 + vRhPh;
  if ( rhMode < 1.5 ) rhEA = fract( uBodyTime * 0.625 + rhPh * 0.159 ) < 0.3 ? 1.0 : 0.05;
  else if ( rhMode < 2.5 ) rhEA = 0.45 + 0.55 * ( 0.5 + 0.5 * sin( uBodyTime * 2.4 + rhPh ) );
  else if ( rhMode < 3.5 ) rhEA = 0.7 + 0.3 * sin( uBodyTime * 13.0 + rhPh ) * sin( uBodyTime * 7.3 + rhPh * 1.7 );
  else rhEA = fract( uBodyTime * 1.4 + rhPh * 0.159 ) < 0.08 ? 1.6 : 0.03;
}
totalEmissiveRadiance += uFlash + vColor.rgb * emisK * uEmissive * rhEA * ( 1.0 - scorch );
if ( uEmber > 0.0 ) {
  float rhFl = 0.55 + 0.45 * sin( uBodyTime * 6.3 + dmgT.a * 31.0 + dTex.a * 17.0 );
  totalEmissiveRadiance += vec3( 1.7, 0.42, 0.08 ) * ( rhRim * rhRim * 0.9 + rhCrack * 0.15 * rhHoleK ) * rhFl * uEmber;
}`,
      );
  };
  mat.customProgramCacheKey = () => (bodyDetail ? 'rh-body-v5' : 'rh-body-v5-low');
  mat.name = `body-${teamHex.toString(16)}-${variant}${powered ? '' : '-off'}`;
  return mat;
}

/**
 * Shared body material per team colour, damage/death variant and powered state. Skinned and rigid bodies
 * get separate (identical) material objects: one material alternating between skinned and plain meshes
 * makes three re-resolve its program on every switch.
 */
export function bodyMaterial(teamHex: number, variant: number = BodyVariant.Normal, powered = true, skinned = false): THREE.MeshStandardMaterial {
  const key = teamHex * 32 + variant * 4 + (powered ? 0 : 2) + (skinned ? 1 : 0);
  let m = bodyCache.get(key);
  if (!m) {
    m = applyLitPatch(makeBodyMaterial(teamHex, variant, powered));
    if (skinned) m.name += '-sk';
    bodyCache.set(key, m);
  }
  return m;
}

const instCache = new Map<number, THREE.MeshStandardMaterial>();

/**
 * [STRUCT] Body material for instanced meshes (walls): same shader and team colour as bodyMaterial, but its
 * own material object (three re-resolves the program when one material alternates instanced / plain).
 */
export function bodyMaterialInstanced(teamHex: number): THREE.MeshStandardMaterial {
  let m = instCache.get(teamHex);
  if (!m) {
    m = applyLitPatch(makeBodyMaterial(teamHex, BodyVariant.Normal, true));
    m.name += '-inst';
    instCache.set(teamHex, m);
    bodyCache.set(-2 - instCache.size, m);
  }
  return m;
}

/** [STRUCT] A fresh, uncached body material (for previews that dispose their materials). */
export function freshBodyMaterial(teamHex: number): THREE.MeshStandardMaterial {
  return makeBodyMaterial(teamHex, BodyVariant.Normal, true);
}

let debrisMat: THREE.MeshStandardMaterial | null = null;

/**
 * Body material for instanced debris (wheels, plates, track runs): the 'wrecked' look with per-instance
 * colour tint. Its own material object, since three re-resolves a program whenever one material alternates
 * between instanced and plain meshes.
 */
export function debrisMaterial(): THREE.MeshStandardMaterial {
  if (!debrisMat) {
    debrisMat = applyLitPatch(makeBodyMaterial(0xffffff, BodyVariant.Wrecked, false));
    debrisMat.name = 'body-debris';
    bodyCache.set(-1, debrisMat);
  }
  return debrisMat;
}

const depthMats: Record<string, THREE.MeshDepthMaterial> = {};

/**
 * Shared shadow-depth material for one kind of object (plain, skinned, instanced, instanced with colour),
 * for `mesh.customDepthMaterial`. three's single built-in depth material re-resolves its program (and
 * allocates a parameter object and cache key) whenever consecutive shadow casters differ in kind; a
 * material per kind never has to.
 */
export function shadowDepthMaterial(o: THREE.Object3D): THREE.MeshDepthMaterial {
  const im = o as THREE.InstancedMesh;
  const kind = (o as THREE.SkinnedMesh).isSkinnedMesh ? 'skinned' : im.isInstancedMesh ? (im.instanceColor ? 'instc' : 'inst') : 'plain';
  let m = depthMats[kind];
  if (!m) {
    m = new THREE.MeshDepthMaterial();
    m.name = `shadow-depth-${kind}`;
    depthMats[kind] = m;
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Glow material: unlit, vertex colour * HDR intensity (quantised & shared)
// ---------------------------------------------------------------------------------------------

const glowCache = new Map<number, THREE.MeshBasicMaterial>();
export const GLOW_STEPS = 16;

/** Shared emissive material. Intensity is quantised to 1/16 steps. */
export function glowMaterial(intensity: number): THREE.MeshBasicMaterial {
  const q = Math.max(0, Math.round(intensity * GLOW_STEPS));
  let m = glowCache.get(q);
  if (!m) {
    const k = q / GLOW_STEPS;
    m = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(k, k, k) });
    m.name = `glow-${k}`;
    glowCache.set(q, m);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Track materials: N shared phases of the scrolling tread
// ---------------------------------------------------------------------------------------------

export const TRACK_PHASES = 8;
let trackMats: THREE.MeshStandardMaterial[] | null = null;

export function trackMaterial(phase: number): THREE.MeshStandardMaterial {
  if (!trackMats) {
    const base = getTreadTexture();
    trackMats = [];
    for (let k = 0; k < TRACK_PHASES; k++) {
      const t = base.clone();
      t.offset.set(-k / TRACK_PHASES, 0);
      const m = new THREE.MeshStandardMaterial({ map: t, metalness: 0.55, roughness: 0.6, color: 0xffffff });
      m.name = `track-${k}`;
      trackMats.push(applyLitPatch(m));
    }
  }
  const i = ((Math.floor(phase * TRACK_PHASES) % TRACK_PHASES) + TRACK_PHASES) % TRACK_PHASES;
  return trackMats[i];
}

// ---------------------------------------------------------------------------------------------
// Transparent FX materials (rotor blur discs, energy fields)
// ---------------------------------------------------------------------------------------------

const fxCache = new Map<string, THREE.Material>();

let rotorTex: THREE.CanvasTexture | null = null;
function getRotorTexture(): THREE.CanvasTexture {
  if (rotorTex) return rotorTex;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(40,40,44,0.0)');
  grd.addColorStop(0.25, 'rgba(40,40,44,0.35)');
  grd.addColorStop(0.85, 'rgba(50,50,54,0.55)');
  grd.addColorStop(0.95, 'rgba(95,95,98,0.45)');
  grd.addColorStop(1, 'rgba(60,60,60,0.0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  g.fill();
  rotorTex = new THREE.CanvasTexture(cv);
  rotorTex.colorSpace = THREE.SRGBColorSpace;
  return rotorTex;
}

let softTex: THREE.CanvasTexture | null = null;
/** Soft radial falloff used for additive glow halos. */
export function getSoftTexture(): THREE.CanvasTexture {
  if (softTex) return softTex;
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  softTex = new THREE.CanvasTexture(cv);
  softTex.colorSpace = THREE.SRGBColorSpace;
  return softTex;
}

/**
 * Transparent FX material by key:
 *  'rotor'          – translucent spinning-rotor disc
 *  'add:<hex>:<i>'  – additive energy glow (vertex colour ignored), colour hex, HDR intensity i
 */
export function fxMaterial(key: string): THREE.Material {
  let m = fxCache.get(key);
  if (m) return m;
  if (key === 'rotor') {
    m = new THREE.MeshBasicMaterial({
      map: getRotorTexture(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: 0.85,
    });
  } else if (key.startsWith('add:')) {
    const [, hex, inten] = key.split(':');
    const c = new THREE.Color(parseInt(hex, 16)).multiplyScalar(parseFloat(inten));
    m = new THREE.MeshBasicMaterial({
      color: c,
      map: getSoftTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  } else if (key.startsWith('field:')) {
    // energy shell (fresnel-free cheap version): additive, no texture
    const [, hex, inten] = key.split(':');
    const c = new THREE.Color(parseInt(hex, 16)).multiplyScalar(parseFloat(inten));
    m = new THREE.MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  } else {
    m = new THREE.MeshBasicMaterial({ color: 0xff00ff });
  }
  // Flat discs / additive halos look identical in one pass. Without this three draws transparent
  // double-sided meshes twice and flags the material for a program re-check (string building) each time.
  m.forceSinglePass = true;
  m.name = `fx-${key}`;
  fxCache.set(key, m);
  return m;
}
