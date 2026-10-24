/**
 * Builds src/conquest/world/data/land110.ts, the World Conquest land outline, from Natural Earth's 1:110m land and
 * lakes polygons (public domain). Development time only: the game never fetches anything.
 *
 *   for f in land lakes; do curl -sSfL -o /some/empty/dir/ne_110m_$f.geojson \
 *     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/ne_110m_$f.geojson; done
 *   node --import tsx tools/world/geo-land.ts /some/empty/dir/ne_110m_land.geojson /some/empty/dir/ne_110m_lakes.geojson
 *
 * The inputs are checked against the pinned sha256s below. Output: every ring quantised to 0.01°, consecutive duplicates
 * and the closing point dropped, delta-encoded as zigzag base-64 varints (rings separated by '.'), plus the index of
 * each hole ring: the land's own (the Caspian Sea) and every lake (the Great Lakes, Victoria, Baikal...). About 15 KB
 * gzipped.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/';
const TAG = 'v5.1.2';
const PINS = {
  land: { file: 'ne_110m_land.geojson', sha256: '9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9' },
  lakes: { file: 'ne_110m_lakes.geojson', sha256: 'eb02ecc86c82004fccbf979058bfabbbd6c2d07968c7844d38eb1c9152d2ffc9' },
};
const Q = 100; // 0.01°
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'src/conquest/world/data/land110.ts');

const [landSrc, lakesSrc] = process.argv.slice(2);
if (!landSrc || !lakesSrc) { console.error('usage: node --import tsx tools/world/geo-land.ts <ne_110m_land.geojson> <ne_110m_lakes.geojson>'); process.exit(2); }
type Geo = { features: { properties: { name?: string }; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] } }[] };
const load = (src: string, pin: { file: string; sha256: string }): Geo => {
  const buf = fs.readFileSync(src);
  const digest = crypto.createHash('sha256').update(buf).digest('hex');
  if (digest !== pin.sha256) { console.error(`${src}: sha256 ${digest} != pinned ${pin.sha256} (${pin.file})`); process.exit(1); }
  return JSON.parse(buf.toString('utf8')) as Geo;
};
const land = load(landSrc, PINS.land), lakes = load(lakesSrc, PINS.lakes);

const enc = (v: number): string => {
  let z = v < 0 ? -v * 2 - 1 : v * 2;
  let o = '';
  do { let c = z & 31; z = Math.floor(z / 32); if (z) c |= 32; o += B64[c]; } while (z);
  return o;
};

const parts: string[] = [];
const holes: number[] = [];
let points = 0;
const lakeNames: string[] = [];
for (const [geo, isLake] of [[land, false], [lakes, true]] as [Geo, boolean][]) for (const f of geo.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates as number[][][]] : (f.geometry.coordinates as number[][][][]);
  if (isLake) lakeNames.push(f.properties.name ?? '?');
  for (const poly of polys) {
    poly.forEach((ring, ri) => {
      const pts: [number, number][] = [];
      for (const [lon, lat] of ring) {
        const x = Math.round(lon * Q), y = Math.round(lat * Q);
        const last = pts[pts.length - 1];
        if (last && last[0] === x && last[1] === y) continue;
        pts.push([x, y]);
      }
      if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      if (pts.length < 3) return;
      // a lake's outline (and an island inside it, if any) is a hole in the land; so is a land polygon's inner ring
      if (isLake ? ri === 0 : ri > 0) holes.push(parts.length);
      let px = 0, py = 0, s = '';
      for (const [x, y] of pts) { s += enc(x - px) + enc(y - py); px = x; py = y; }
      parts.push(s);
      points += pts.length;
    });
  }
}
const data = parts.join('.');
const body = `/**
 * World land outline for World Conquest: Natural Earth 1:110m land and lakes (ne_110m_land, ne_110m_lakes), public
 * domain (naturalearthdata.com, "Terms of use": all versions are in the public domain). Source: github.com/nvkelso/
 * natural-earth-vector, tag ${TAG}, geojson/${PINS.land.file} (sha256 ${PINS.land.sha256}) and
 * geojson/${PINS.lakes.file} (sha256 ${PINS.lakes.sha256}).
 * Fetched once at development time and converted by tools/world/geo-land.ts; nothing is downloaded at run time.
 *
 * Format: ${parts.length} rings, ${points} points. Rings are separated by '.'; each is a list of points [lon, lat] in
 * hundredths of a degree, every value relative to the previous point of the ring (the first to 0, 0), written as a
 * zigzag varint in base-64 digits (${B64.slice(0, 4)}...: 5 bits per digit, bit 6 = more digits follow). Decoded by
 * landRings() in ../geo.ts. LAND_HOLES lists the rings that are holes: the Caspian Sea (in the land data) and the
 * lakes (${lakeNames.join(', ')}).
 */
export const LAND_110 =
  '${data}';
export const LAND_HOLES: readonly number[] = [${holes.join(', ')}];
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
console.log(`${path.relative(ROOT, OUT)}: ${parts.length} rings, ${points} points, ${(body.length / 1024).toFixed(1)} KB, ${(zlib.gzipSync(body, { level: 9 }).length / 1024).toFixed(1)} KB gzipped`);
