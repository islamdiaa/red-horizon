// ARCH: triangle counts, build times and sanity of every landmark and civilian style (headless, no WebGL).
//   node --import tsx tools/world/arch-stats.ts [landmarks|civ|all]
import { LANDMARK_IDS } from '../../src/conquest/world/types';
import { landmarkGeometry, landmarkModelled } from '../../src/render/landmarks';
import { civilianTris, STYLES } from '../../src/render/civilian';
import type { Culture } from '../../src/conquest/world/types';
import type { CivilianKind } from '../../src/sim/civilian';

const what = process.argv[2] ?? 'all';
if (what !== 'civ') {
  for (const id of LANDMARK_IDS) {
    const t0 = performance.now();
    const lo = landmarkGeometry(id, 'low');
    const t1 = performance.now();
    const hi = landmarkGeometry(id, 'high');
    const t2 = performance.now();
    const bb = hi.geo.boundingBox!;
    console.log(`${id.padEnd(18)} ${landmarkModelled(id) ? 'model' : '  -  '} low ${String(lo.tris).padStart(6)} (${(t1 - t0).toFixed(0)} ms)  high ${String(hi.tris).padStart(6)} (${(t2 - t1).toFixed(0)} ms)  size ${(bb.max.x - bb.min.x).toFixed(2)} x ${(bb.max.z - bb.min.z).toFixed(2)} x ${bb.max.y.toFixed(2)}`);
  }
}
if (what !== 'landmarks') {
  const kinds: CivilianKind[] = ['house', 'apartment', 'shop', 'hall', 'tower', 'farm', 'warehouse'];
  for (const st of Object.keys(STYLES) as Culture[]) {
    const t0 = performance.now();
    const row = kinds.map((k) => {
      let lo = 0, hi = 0;
      for (let s = 0; s < 6; s++) { lo = Math.max(lo, civilianTris(st, k, s, 'low')); hi = Math.max(hi, civilianTris(st, k, s, 'high')); }
      return `${k} ${lo}/${hi}`;
    });
    console.log(`${st.padEnd(16)} ${(performance.now() - t0).toFixed(0).padStart(5)} ms  ${row.join('  ')}`);
  }
}
