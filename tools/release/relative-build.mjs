// A relative-base production build (Vite `base: './'`): the game runs from any folder, e.g. an itch.io
// upload, a sub-folder of a static host, or the desktop wrapper (desktop/). Shared by build-itch.mjs and
// desktop/scripts/prepare.mjs.
import { build } from 'vite';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The Content-Security-Policy the web deployment sends as a header (docker/security-headers.conf), minus
 * the directives a <meta> cannot carry (frame-ancestors: hosts like itch.io frame the game anyway).
 */
export function metaCsp() {
  const conf = readFileSync(path.join(root, 'docker/security-headers.conf'), 'utf8');
  const m = conf.match(/Content-Security-Policy\s+"([^"]+)"/);
  if (!m) throw new Error('CSP not found in docker/security-headers.conf');
  return m[1].split(';').map((d) => d.trim()).filter((d) => d && !/^(?:frame-ancestors|report-uri|report-to|sandbox)\b/.test(d)).join('; ');
}

/** Build into outDir with a relative base; inject the CSP as a <meta> tag. */
export async function relativeBuild(outDir, { csp = true, logLevel = 'warn' } = {}) {
  await build({ root, base: './', logLevel, build: { outDir, emptyOutDir: true } });
  const index = path.join(outDir, 'index.html');
  let html = readFileSync(index, 'utf8');
  if (csp && !html.includes('http-equiv="Content-Security-Policy"')) {
    html = html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${metaCsp()}" />`);
  }
  writeFileSync(index, html);
  // preview pages are dev tools, not part of the game
  for (const f of ['dev/preview-audio.html', 'dev/preview-effects.html', 'dev/preview-models.html', 'dev/preview-weather.html']) {
    const p = path.join(outDir, f);
    if (existsSync(p)) rmSync(p);
  }
  return outDir;
}
