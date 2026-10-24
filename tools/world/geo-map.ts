/**
 * World Conquest map preview: renders a run's territories (the rules' raster), sites (white), label anchors (red),
 * land borders (black) and sea lanes (yellow; long crossings orange) to an equirectangular PNG. No browser needed.
 *
 *   node --import tsx tools/world/geo-map.ts <out.png> [full | world:<seed> | blitz:<seed>:<homeland>] [x0 y0 x1 y1 scale]
 *
 * The crop is in raster pixels (0.25°: x = (lon + 180) * 4, y = (90 - lat) * 4), e.g. Europe: 620 70 900 230 4.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fullWorld, worldMap, type WorldMap } from '../../src/conquest/world/geo';

const [out, mode = 'full', ...crop] = process.argv.slice(2);
if (!out) { console.error('usage: node --import tsx tools/world/geo-map.ts <out.png> [full|world:<seed>|blitz:<seed>:<homeland>] [x0 y0 x1 y1 scale]'); process.exit(2); }
const [kind, seed, home] = mode.split(':');
const m: WorldMap = kind === 'full' ? fullWorld() : worldMap(Number(seed) >>> 0, kind === 'blitz' ? 'blitz' : 'world', home ?? 'britain');
const { w, h, label } = m.raster;
const [X0, Y0, X1, Y1, S] = [Number(crop[0] ?? 0), Number(crop[1] ?? 0), Number(crop[2] ?? w), Number(crop[3] ?? h), Number(crop[4] ?? 1)];
const OW = (X1 - X0) * S, OH = (Y1 - Y0) * S;
const img = Buffer.alloc(OW * OH * 3);
const colour = (k: number): number[] => {
  const a = (k * 137.508) % 360, l = 0.55 + ((k * 7) % 3) * 0.08, c = (1 - Math.abs(2 * l - 1)) * 0.55, x = c * (1 - Math.abs(((a / 60) % 2) - 1)), mm = l - c / 2;
  const [r, g, b] = a < 60 ? [c, x, 0] : a < 120 ? [x, c, 0] : a < 180 ? [0, c, x] : a < 240 ? [0, x, c] : a < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + mm) * 255));
};
for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
  const px = X0 + Math.floor(x / S), py = Y0 + Math.floor(y / S);
  const l = label[py * w + px];
  let c = l === -1 ? [30, 50, 80] : l === -2 ? [120, 120, 110] : colour(l);
  const right = label[py * w + Math.min(w - 1, px + 1)], down = label[Math.min(h - 1, py + 1) * w + px];
  if (l >= 0 && ((x % S === S - 1 && right !== l && right >= 0) || (y % S === S - 1 && down !== l && down >= 0))) c = [20, 20, 20];
  img.set(c, (y * OW + x) * 3);
}
const dot = (lon: number, lat: number, col: number[], r: number) => {
  const cx = ((((lon + 540) % 360) - 180 + 180) / 0.25 - X0) * S, cy = ((90 - lat) / 0.25 - Y0) * S;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = Math.round(cx + dx), yy = Math.round(cy + dy);
    if (xx >= 0 && yy >= 0 && xx < OW && yy < OH) img.set(col, (yy * OW + xx) * 3);
  }
};
for (const l of m.links) if (l.sea && l.path) for (let i = 0; i + 1 < l.path.length; i++) {
  const [a, b] = [l.path[i], l.path[i + 1]];
  for (let t = 0; t <= 20; t++) dot(a[0] + ((b[0] - a[0]) * t) / 20, a[1] + ((b[1] - a[1]) * t) / 20, l.long ? [255, 160, 0] : [255, 255, 0], 0);
}
for (const t of m.territories) { dot(t.site[0], t.site[1], [255, 255, 255], 2); dot(t.anchor[0], t.anchor[1], [255, 0, 0], 1); }
const raw = Buffer.alloc((OW * 3 + 1) * OH);
for (let y = 0; y < OH; y++) img.copy(raw, y * (OW * 3 + 1) + 1, y * OW * 3, (y + 1) * OW * 3);
const chunk = (t: string, d: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(OW, 0); ihdr.writeUInt32BE(OH, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out}: ${OW}x${OH}, ${m.territories.length} territories, ${m.links.length} links (${m.links.filter((l) => l.sea).length} sea)`);
