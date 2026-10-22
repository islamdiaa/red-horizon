// Compares look grids (tools/xb/look-core.mjs) against a reference renderer, scene by scene:
//   node tools/xb/compare.mjs <reference look-*.json> <other look-*.json...>
// Per scene: mean absolute difference per channel (0-255), the mean signed luminance shift (a gamma / exposure
// difference shows as a consistent shift), the share of grid cells off by more than 24 levels, and the worst cell.
// Grids are small (80x45 means), so particles and TAA jitter average out; a broken pass shows as large regions.
import fs from 'node:fs';
import path from 'node:path';

const [refFile, ...others] = process.argv.slice(2);
if (!refFile || !others.length) { console.error('usage: node tools/xb/compare.mjs <reference.json> <other.json...>'); process.exit(2); }
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const ref = load(refFile);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
let worstVerdict = 0;
for (const f of others) {
  const o = load(f);
  console.log(`\n${path.basename(f)} vs ${path.basename(refFile)}`);
  console.log('scene'.padEnd(18), 'dR'.padStart(6), 'dG'.padStart(6), 'dB'.padStart(6), 'dLum'.padStart(7), 'off>24'.padStart(8), 'worst'.padStart(6), ' verdict');
  for (const [scene, a] of Object.entries(ref)) {
    const b = o[scene];
    if (!b?.cells || !a?.cells) { console.log(scene.padEnd(18), 'missing'); continue; }
    const n = Math.min(a.cells.length, b.cells.length) / 3;
    const d = [0, 0, 0];
    let dl = 0, off = 0, worst = 0;
    for (let i = 0; i < n; i++) {
      const ca = a.cells.slice(i * 3, i * 3 + 3), cb = b.cells.slice(i * 3, i * 3 + 3);
      let m = 0;
      for (let c = 0; c < 3; c++) { const x = Math.abs(ca[c] - cb[c]); d[c] += x; m = Math.max(m, x); }
      dl += lum(...cb) - lum(...ca);
      if (m > 24) off++;
      worst = Math.max(worst, m);
    }
    const share = off / n;
    // ok: same picture; minor: tone / detail differences; BAD: a large part of the frame differs
    const verdict = share > 0.25 || Math.abs(dl / n) > 20 ? 2 : share > 0.08 || Math.abs(dl / n) > 8 ? 1 : 0;
    worstVerdict = Math.max(worstVerdict, verdict);
    console.log(scene.padEnd(18), ...d.map((x) => (x / n).toFixed(1).padStart(6)), (dl / n).toFixed(1).padStart(7), `${(share * 100).toFixed(1)}%`.padStart(8), String(worst).padStart(6), ' ' + ['ok', 'minor', 'BAD'][verdict]);
  }
}
process.exitCode = worstVerdict === 2 ? 3 : 0;
