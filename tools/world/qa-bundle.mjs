// World Conquest QA: the bundle budget (the mode is a lazy chunk; at most +5 KB gzipped on the
// initial bundle and +350 KB gzipped for the mode's JS and data). The initial bundle is what index.html loads up
// front: its entry script, every modulepreload and the stylesheets. Sizes are `gzip -9` of each file, as
// `gzip -c dist/assets/<chunk>.js | wc -c` measures them.
//
//   node tools/world/qa-bundle.mjs <dist> [<baseline dist>]      prints the initial bundle and the chunks new since the baseline
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const gz = (f) => zlib.gzipSync(fs.readFileSync(f), { level: 9 }).length;

export function bundle(dist) {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const initial = [...new Set([...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
  const all = fs.readdirSync(path.join(dist, 'assets')).filter((f) => /\.(js|css)$/.test(f)).map((f) => `assets/${f}`);
  const size = Object.fromEntries(all.map((f) => [f, gz(path.join(dist, f))]));
  const stem = (f) => f.replace(/^assets\//, '').replace(/-[\w-]{8}\.(js|css)$/, '.$1');
  return { initial, all, size, stem, initialGz: initial.reduce((s, f) => s + (size[f] ?? 0), 0) };
}

if (process.argv[1]?.endsWith('qa-bundle.mjs')) {
  const [dist, base] = process.argv.slice(2);
  const a = bundle(dist);
  console.log(`initial bundle: ${a.initial.length} files, ${(a.initialGz / 1024).toFixed(1)} KB gzipped`);
  if (base) {
    const b = bundle(base);
    console.log(`baseline:       ${b.initial.length} files, ${(b.initialGz / 1024).toFixed(1)} KB gzipped  -> delta ${((a.initialGz - b.initialGz) / 1024).toFixed(2)} KB (budget +5 KB)`);
    const bStems = new Map(b.all.map((f) => [b.stem(f), f]));
    const aInit = new Set(a.initial.map(a.stem)), bInit = new Set(b.initial.map(b.stem));
    console.log('initial-bundle changes (gzip bytes):');
    for (const f of a.initial) { const o = bStems.get(a.stem(f)); const d = a.size[f] - (o ? b.size[o] : 0); if (Math.abs(d) > 40 || !bInit.has(a.stem(f))) console.log(`  ${a.stem(f).padEnd(34)} ${String(a.size[f]).padStart(8)} ${d >= 0 ? '+' : ''}${d}${bInit.has(a.stem(f)) ? '' : '  (new in the initial bundle)'}`); }
    for (const s of bInit) if (!aInit.has(s)) console.log(`  ${s.padEnd(34)} (left the initial bundle)`);
    let lazyNew = 0;
    console.log('lazy chunks new or grown (gzip bytes):');
    for (const f of a.all) {
      if (aInit.has(a.stem(f))) continue;
      const o = bStems.get(a.stem(f));
      const d = a.size[f] - (o ? b.size[o] : 0);
      if (d > 200) { lazyNew += d; console.log(`  ${a.stem(f).padEnd(34)} ${String(a.size[f]).padStart(8)} +${d}${o ? '' : '  (new)'}`); }
    }
    // (chunks get renamed between builds: what moved between chunks shows up as new above, so the budget is the net)
    const lazyA = a.all.filter((f) => !aInit.has(a.stem(f))).reduce((t, f) => t + a.size[f], 0);
    const lazyB = b.all.filter((f) => !bInit.has(b.stem(f))).reduce((t, f) => t + b.size[f], 0);
    const loc = (d, x) => d.all.filter((f) => /^assets\/(de|es|fr|pt-BR|ru|zh-CN)-/.test(f)).reduce((t, f) => t + d.size[f], 0);
    console.log(`lazy chunks new or grown: ${(lazyNew / 1024).toFixed(1)} KB gzipped (gross, renames included)`);
    console.log(`lazy total: ${(lazyA / 1024).toFixed(1)} KB vs ${(lazyB / 1024).toFixed(1)} KB -> net +${((lazyA - lazyB) / 1024).toFixed(1)} KB gzipped, of which the six locale catalogues +${((loc(a) - loc(b)) / 1024).toFixed(1)} KB (a player loads one); budget for the mode: 350 KB`);
  }
}
