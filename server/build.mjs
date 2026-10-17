// Bundle the relay (and the verification worker) with the game engine it imports from ../src into two
// self-contained ES modules for Node: dist/relay.mjs and dist/verify-worker.mjs.
import { build } from 'esbuild';

const common = {
  bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false, minify: false, legalComments: 'none',
  // ws's optional native speed-ups are not installed; it falls back to plain JavaScript
  external: ['bufferutil', 'utf-8-validate'],
  // CommonJS dependencies (ws) need require() inside the ES module bundle
  banner: { js: "import { createRequire as __rhCreateRequire } from 'node:module'; const require = __rhCreateRequire(import.meta.url);" },
  logLevel: 'info',
};
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/relay.mjs' });
await build({ ...common, entryPoints: ['src/leaderboard/worker.ts'], outfile: 'dist/verify-worker.mjs' });
