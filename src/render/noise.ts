import * as THREE from 'three';
import { hash2 } from '../core/rng';

/** Shared GLSL helpers (value noise / fbm). */
export const NOISE_GLSL = /* glsl */ `
float rh_hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float rh_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = rh_hash(i), b = rh_hash(i + vec2(1.0, 0.0));
  float c = rh_hash(i + vec2(0.0, 1.0)), d = rh_hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float rh_fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * rh_noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
`;

let noiseTex: THREE.DataTexture | null = null;

/**
 * Tileable value-noise texture (256², repeat, mipmapped). Channel k holds noise with a lattice of
 * 16·2^k cells across the texture, so with uv = p / 16:
 *   r            ≈ rh_noise(p)          (one tap instead of four hashes)
 *   dot(t, W4)   ≈ rh_fbm(p)            (four octaves in one tap, W4 = vec4(.533,.267,.133,.067))
 * Shared by the terrain, water and atmosphere shaders.
 */
export function getNoiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const lat = (period: number, seed: number) => {
    const v = new Float32Array(period * period);
    for (let i = 0; i < v.length; i++) v[i] = hash2(i % period, (i / period) | 0, seed);
    return v;
  };
  for (let c = 0; c < 4; c++) {
    const period = 16 << c;
    const v = lat(period, 977 + c * 31);
    const cell = S / period;
    for (let y = 0; y < S; y++) {
      const fy = y / cell, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      const y0 = (iy % period) * period, y1 = ((iy + 1) % period) * period;
      for (let x = 0; x < S; x++) {
        const fx = x / cell, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % period, x1 = (ix + 1) % period;
        const a = v[y0 + x0], b = v[y0 + x1], cc = v[y1 + x0], d = v[y1 + x1];
        const n = a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
        data[(y * S + x) * 4 + c] = Math.round(n * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  noiseTex = tex;
  return tex;
}

/** GLSL helpers over getNoiseTexture() (declare `uniform sampler2D tNoise;` first). */
export const TNOISE_GLSL = /* glsl */ `
float tn_noise(vec2 p) { return texture2D(tNoise, p * 0.0625).r; }
float tn_fbm(vec2 p) { return dot(texture2D(tNoise, p * 0.0625), vec4(0.5333, 0.2667, 0.1333, 0.0667)); }
`;
