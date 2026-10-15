// Shared helpers for the browser audits in tests/perf (not part of `npm test`).
// Starts a private Vite dev server (no HMR / watching, own dep cache) and headless Chromium.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function startServer(port = 5190) {
  const server = await createServer({
    root, configFile: false, logLevel: 'warn', cacheDir: `/tmp/rh-vite-cache-${port}`,
    server: { port, strictPort: true, hmr: false, watch: null, host: '127.0.0.1' },
    optimizeDeps: { include: ['three', 'three/examples/jsm/postprocessing/GTAOPass.js', 'three/examples/jsm/postprocessing/EffectComposer.js'] },
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${port}/` };
}

export async function launch(extraArgs = []) {
  return chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...extraArgs],
    env: { ...process.env, LD_LIBRARY_PATH: path.join(root, 'tools/nsslibs/lib') },
  });
}

// ---------------------------------------------------------------------------
// Minimal source-map support (VLQ decode) so profiles report original file:line.
// ---------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64I = Object.fromEntries([...B64].map((c, i) => [c, i]));

function decodeMappings(mappings) {
  // returns per generated line: sorted [genCol, srcIdx, srcLine, srcCol]
  const lines = [];
  let srcIdx = 0, srcLine = 0, srcCol = 0;
  for (const lineStr of mappings.split(';')) {
    const segs = [];
    let genCol = 0;
    for (const seg of lineStr.split(',')) {
      if (!seg) continue;
      const vals = [];
      let shift = 0, value = 0;
      for (const ch of seg) {
        const d = B64I[ch];
        value += (d & 31) << shift;
        if (d & 32) shift += 5;
        else { vals.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0; }
      }
      genCol += vals[0];
      if (vals.length >= 4) { srcIdx += vals[1]; srcLine += vals[2]; srcCol += vals[3]; segs.push([genCol, srcIdx, srcLine, srcCol]); }
    }
    lines.push(segs);
  }
  return lines;
}

const mapCache = new Map();

/** Load the source map of a served module (inline data: URL or sibling .map). */
export async function loadSourceMap(url) {
  if (mapCache.has(url)) return mapCache.get(url);
  let result = null;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const m = /\/\/[#@] sourceMappingURL=(\S+)\s*$/.exec(text);
    let map = null;
    if (m) {
      if (m[1].startsWith('data:')) map = JSON.parse(Buffer.from(m[1].split(',')[1], 'base64').toString('utf8'));
      else map = await (await fetch(new URL(m[1], url))).json();
    }
    if (map) result = { sources: map.sources.map((s) => new URL(s, new URL(map.sourceRoot || '', url)).pathname), lines: decodeMappings(map.mappings) };
  } catch { /* unmapped */ }
  mapCache.set(url, result);
  return result;
}

/** Map a 0-based generated (line, column) to "src/file.ts:line" (1-based), or null. */
export function originalPosition(sm, line, column) {
  const segs = sm?.lines[line];
  if (!segs || !segs.length) return null;
  let best = segs[0];
  for (const s of segs) { if (s[0] <= column) best = s; else break; }
  const file = sm.sources[best[1]];
  return { file, line: best[2] + 1 };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
