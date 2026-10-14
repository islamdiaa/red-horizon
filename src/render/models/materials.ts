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

const bodyCache = new Map<number, THREE.MeshStandardMaterial>();

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

function makeBodyMaterial(teamHex: number, variant: number, powered: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: getDetailTexture(),
    vertexColors: true,
    metalness: 1,
    roughness: 1,
  });
  const uniforms = {
    uTeam: { value: conditionTeamColor(teamHex) },
    uScorch: { value: VARIANT_SCORCH[variant] ?? 0 },
    uFlash: { value: variant === BodyVariant.Electro ? new THREE.Color(0.9, 1.4, 3.2) : new THREE.Color(0, 0, 0) },
    uEmissive: { value: powered && variant < BodyVariant.Charred ? BODY_EMISSIVE_ON : BODY_EMISSIVE_OFF },
  };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTeam = uniforms.uTeam;
    shader.uniforms.uScorch = uniforms.uScorch;
    shader.uniforms.uFlash = uniforms.uFlash;
    shader.uniforms.uEmissive = uniforms.uEmissive;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 pbr;\nvarying vec4 vPbr;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvPbr = pbr;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uTeam;\nuniform float uScorch;\nuniform vec3 uFlash;\nuniform float uEmissive;\nvarying vec4 vPbr;',
      )
      .replace(
        '#include <map_fragment>',
        `vec4 dTex = texture2D( map, vMapUv );
float dSel = vPbr.w;
float emisK = dSel > 3.5 ? dSel - 4.0 : 0.0;
float detail = dSel < 0.5 ? dTex.r : ( dSel < 1.5 ? dTex.g : ( dSel < 2.5 ? dTex.b : 0.87 ) );
detail *= 1.15;
diffuseColor.rgb *= mix( vec3( 1.0 ), uTeam, vPbr.z ) * detail * ( emisK > 0.0 ? 0.3 : 1.0 );
float scorch = smoothstep( 1.0 - uScorch, 1.25 - uScorch, dTex.a ) * min( uScorch * 1.6, 1.0 );
diffuseColor.rgb *= 1.0 - 0.86 * scorch;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = clamp( vPbr.y * ( 1.45 - 0.45 * detail ) + scorch * 0.35, 0.04, 1.0 );',
      )
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.x * ( 1.0 - scorch * 0.8 );')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uFlash + vColor.rgb * emisK * uEmissive * ( 1.0 - scorch );',
      );
  };
  mat.customProgramCacheKey = () => 'rh-body-v3';
  mat.name = `body-${teamHex.toString(16)}-${variant}${powered ? '' : '-off'}`;
  return mat;
}

/** Shared body material per team colour, damage/death variant and powered state. */
export function bodyMaterial(teamHex: number, variant: number = BodyVariant.Normal, powered = true): THREE.MeshStandardMaterial {
  const key = teamHex * 16 + variant * 2 + (powered ? 0 : 1);
  let m = bodyCache.get(key);
  if (!m) {
    m = makeBodyMaterial(teamHex, variant, powered);
    bodyCache.set(key, m);
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
      trackMats.push(m);
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
  m.name = `fx-${key}`;
  fxCache.set(key, m);
  return m;
}
