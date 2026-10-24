/**
 * Top-down map thumbnails for the skirmish map picker: terrain with hill shading, forests, ore,
 * gems, bridges and numbered start positions, drawn to a 2D canvas from a GameMap.
 */
import { GameMap, T } from '../sim/map';

type RGB = [number, number, number];
const PALETTES: Record<GameMap['climate'], Record<number, RGB> & { tree: RGB }> = {
  temperate: { [T.Clear]: [74, 104, 54], [T.Water]: [22, 62, 92], [T.Rock]: [112, 108, 100], [T.Sand]: [170, 150, 106], [T.Dirt]: [108, 88, 60], tree: [34, 66, 32] },
  winter: { [T.Clear]: [206, 214, 224], [T.Water]: [118, 150, 176], [T.Rock]: [110, 114, 122], [T.Sand]: [172, 172, 176], [T.Dirt]: [138, 134, 132], tree: [62, 88, 80] },
  desert: { [T.Clear]: [190, 152, 98], [T.Water]: [40, 96, 108], [T.Rock]: [142, 96, 70], [T.Sand]: [218, 186, 132], [T.Dirt]: [160, 112, 74], tree: [96, 98, 52] },
  tropical: { [T.Clear]: [52, 96, 36], [T.Water]: [30, 84, 86], [T.Rock]: [92, 96, 82], [T.Sand]: [196, 178, 128], [T.Dirt]: [128, 72, 44], tree: [22, 62, 24] },
};

export const START_COLORS = ['#3d7be0', '#d23a2c', '#e0b030', '#3fa34d', '#e07b2a', '#8e4fd0'];

export interface PreviewOptions {
  /** Pixels per cell (default: fit `size` px). */
  size?: number;
  /** Draw numbered start markers (default true). */
  starts?: boolean;
  /** Marker colours per start index. */
  colors?: string[];
  /** Highlight this start (the local player). */
  highlight?: number;
}

/** Draw the map into the canvas (resized to `size`, default 256 px square). */
export function drawMapPreview(canvas: HTMLCanvasElement, map: GameMap, opts: PreviewOptions = {}) {
  const S = opts.size ?? 256;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const cells = document.createElement('canvas');
  cells.width = map.w;
  cells.height = map.h;
  const cctx = cells.getContext('2d')!;
  const img = cctx.createImageData(map.w, map.h);
  const pal = PALETTES[map.climate] ?? PALETTES.temperate;
  const bridges = new Set<number>();
  for (const b of map.bridges) for (const [x, y] of b.cells) bridges.add(map.idx(x, y));
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const i = map.idx(x, y);
      const t = map.terrain[i];
      let [r, g, b] = pal[t] ?? pal[T.Clear];
      const h0 = map.vertexHeight(x, y), h1 = map.vertexHeight(x + 1, y + 1);
      let shade = 1 + (h0 - h1) * 1.4 + (map.vertexHeight(x, y + 1) - map.vertexHeight(x + 1, y)) * 0.35;
      if (t === T.Water) shade = 0.75 + Math.max(-0.25, Math.min(0.3, (map.heightAt(x + 0.5, y + 0.5) + 0.6) * 0.6));
      shade = Math.max(0.55, Math.min(1.45, shade));
      if (map.tree[i]) [r, g, b] = pal.tree;
      if (map.ore[i]) {
        const k = 0.6 + (map.ore[i] / 9) * 0.4;
        [r, g, b] = map.gems[i] ? [190 * k, 100 * k, 235 * k] : [235 * k, 182 * k, 60 * k];
        shade = 1;
      }
      if (bridges.has(i)) { [r, g, b] = [150, 112, 70]; shade = 1; }
      img.data[i * 4] = r * shade;
      img.data[i * 4 + 1] = g * shade;
      img.data[i * 4 + 2] = b * shade;
      img.data[i * 4 + 3] = 255;
    }
  }
  cctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cells, 0, 0, S, S);
  if (opts.starts === false) return;
  const k = S / map.w;
  const colors = opts.colors ?? START_COLORS;
  map.startPositions.forEach((s, n) => {
    const x = s.x * k, y = s.y * k, r = Math.max(6, S * 0.042);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = colors[n % colors.length];
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.22);
    ctx.strokeStyle = n === opts.highlight ? '#ffffff' : 'rgba(255,255,255,0.75)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.round(r * 1.25)}px Rajdhani, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n + 1), x, y + r * 0.06);
  });
}

/** Thumbnail as a data URL (cached by key). */
const cache = new Map<string, string>();
export function mapPreviewUrl(key: string, build: () => GameMap, opts: PreviewOptions = {}): string {
  const k = `${key}|${opts.size ?? 256}|${opts.starts !== false}`;
  let url = cache.get(k);
  if (url) return url;
  const c = document.createElement('canvas');
  drawMapPreview(c, build(), opts);
  url = c.toDataURL('image/png');
  cache.set(k, url);
  if (cache.size > 40) cache.delete(cache.keys().next().value!);
  return url;
}
