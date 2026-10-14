import * as THREE from 'three';

/**
 * GPU copy of the ground height so the weather shaders can place splashes, ripples and fog on the
 * terrain without any per-frame CPU work.
 * R = height, G = height blurred over ~5 cells (used to find valleys for fog).
 */
export interface HeightField {
  texture: THREE.DataTexture;
  /** uv = xz * xform.xy + xform.zw */
  xform: THREE.Vector4;
  minH: number;
  maxH: number;
}

function boxBlur(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, tmp: Float32Array): void {
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

export function buildHeightField(getHeight: (x: number, z: number) => number, mapW: number, mapH: number): HeightField {
  const res = mapW * mapH > 192 * 192 ? 1 : 2;
  const tw = Math.ceil(mapW * res) + 1;
  const th = Math.ceil(mapH * res) + 1;
  const n = tw * th;
  const h = new Float32Array(n);
  let minH = Infinity, maxH = -Infinity;
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      const v = getHeight(Math.min(mapW, i / res), Math.min(mapH, j / res));
      h[j * tw + i] = v;
      if (v < minH) minH = v;
      if (v > maxH) maxH = v;
    }
  }
  const blur = new Float32Array(n);
  const tmp = new Float32Array(n);
  const r = Math.max(1, Math.round(5 * res));
  boxBlur(h, blur, tw, th, r, tmp);
  boxBlur(blur, blur, tw, th, r, tmp); // second pass ≈ tent filter (dst may alias src: tmp holds the pass)
  const data = new Uint16Array(n * 2);
  for (let i = 0; i < n; i++) {
    data[i * 2] = THREE.DataUtils.toHalfFloat(h[i]);
    data[i * 2 + 1] = THREE.DataUtils.toHalfFloat(blur[i]);
  }
  const texture = new THREE.DataTexture(data, tw, th, THREE.RGFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const xform = new THREE.Vector4(res / tw, res / th, 0.5 / tw, 0.5 / th);
  return { texture, xform, minH: isFinite(minH) ? minH : 0, maxH: isFinite(maxH) ? maxH : 0 };
}
