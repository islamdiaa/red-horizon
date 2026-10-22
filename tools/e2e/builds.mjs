// Production builds for the PWA update journey: A (the source as it is), then B, C... (the same game with a marker in
// the entry chunk, so each has its own content hash, build id and service-worker URL, like successive deploys).
//
//   node tools/e2e/builds.mjs <outA> <outB> [outC]
//
// Then: node tools/e2e/run.mjs pwa-update --serve <outA> --serve-b <outB>,<outC>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function makeBuild(outDir, tag = '') {
  const plugins = tag ? [{
    name: 'e2e-build-tag',
    // a statement in the entry module (comments would be minified away): a new content hash, nothing else changes
    transform(code, id) { return id.replace(/\\/g, '/').endsWith('/src/main.ts') ? { code: `${code}\n;globalThis.__rhBuildTag = ${JSON.stringify(tag)};\n`, map: null } : null; },
  }] : [];
  await build({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), logLevel: 'warn', plugins, build: { outDir: path.resolve(outDir), emptyOutDir: true } });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const outs = process.argv.slice(2);
  if (outs.length < 2) { console.error('usage: node tools/e2e/builds.mjs <outA> <outB> [outC ...]'); process.exit(2); }
  for (const [i, out] of outs.entries()) await makeBuild(out, i ? `e2e build ${String.fromCharCode(65 + i)} ${new Date().toISOString()}` : '');
  console.log(`builds: ${outs.map((o, i) => `${o} (${String.fromCharCode(65 + i)})`).join(', ')}`);
}
