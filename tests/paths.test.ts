// Base-path support (src/platform/paths.ts): the game must run from the site root, a sub-path
// (`/red-horizon/`) and a relative base (`./`, itch.io / desktop). Every asset URL goes through assetUrl();
// a leading-slash asset literal anywhere in src/ would break the non-root builds.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetUrl, baseUrl, isRelativeBase, joinBase } from '../src/platform/paths';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('assetUrl', () => {
  test('outside Vite the base is the site root', () => {
    assert.equal(baseUrl(), '/', 'node falls back to /');
    assert.equal(assetUrl('models/manifest.json'), '/models/manifest.json', 'root-relative');
  });
  test('joins any base and stays inside it', () => {
    assert.equal(joinBase('/', 'fonts/a.woff2'), '/fonts/a.woff2', 'root');
    assert.equal(joinBase('/red-horizon/', 'models/a.glb'), '/red-horizon/models/a.glb', 'sub-path');
    assert.equal(joinBase('/red-horizon', 'models/a.glb'), '/red-horizon/models/a.glb', 'sub-path without the trailing slash');
    assert.equal(joinBase('./', 'models/a.glb'), './models/a.glb', 'relative');
    assert.equal(joinBase('', 'models/a.glb'), './models/a.glb', 'empty base = relative');
    assert.equal(joinBase('/red-horizon/', '/models/a.glb'), '/red-horizon/models/a.glb', 'a leading slash cannot escape the base');
    assert.equal(joinBase('./', './/models/a.glb'), './models/a.glb', 'leading ./ and slashes are dropped');
    assert.equal(joinBase('https://cdn.example/game/', 'og/x.jpg'), 'https://cdn.example/game/og/x.jpg', 'absolute base');
  });
  test('absolute URLs pass through', () => {
    for (const u of ['https://example.com/a.png', 'blob:https://x/1', 'data:image/png;base64,AA', '//cdn.example/x.js']) assert.equal(joinBase('./', u), u, u);
  });
  test('relative base detection', () => {
    assert.ok(isRelativeBase('./') && isRelativeBase('') && !isRelativeBase('/') && !isRelativeBase('/sub/'), 'only ./ and empty are relative');
  });
});

/** Every .ts / .css file under src/. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(?:ts|css)$/.test(f)) out.push(p);
  }
  return out;
}

describe('no root-absolute asset URLs in src', () => {
  // a quote / backtick / url( followed by "/" and a public folder or an asset file path
  const FOLDERS = /(["'`(])\/(?:models|fonts|icons|mods|screenshots|og|textures|sounds|audio|music|img|images|data|assets|manifest\.webmanifest|sw\.js|index\.html)(?=[/"'`)?#]|$)/g;
  const FILES = /(["'`(])\/[\w.-]+(?:\/[\w.-]+)*\.(?:glb|gltf|bin|png|jpe?g|webp|avif|gif|svg|ico|ktx2|woff2?|ttf|json|webmanifest|mp3|ogg|wav|webm|mp4|hdr|exr)(?=["'`)?#])/g;
  // path comparisons are fine: `url.pathname.endsWith('/sw.js')`
  const ALLOWED_BEFORE = /(?:endsWith|startsWith|includes|indexOf|lastIndexOf)\(\s*$/;
  test('every asset literal is base-relative (use assetUrl)', () => {
    const bad: string[] = [];
    for (const file of sources(path.join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const re of [FOLDERS, FILES]) {
        re.lastIndex = 0;
        for (let m = re.exec(text); m; m = re.exec(text)) {
          const before = text.slice(Math.max(0, m.index - 24), m.index + 1);
          if (ALLOWED_BEFORE.test(before.slice(0, -1))) continue;
          // comments are documentation, not URLs
          const lineStart = text.lastIndexOf('\n', m.index) + 1;
          const line = text.slice(lineStart, text.indexOf('\n', m.index) < 0 ? undefined : text.indexOf('\n', m.index));
          const col = m.index - lineStart;
          const comment = line.indexOf('//');
          if (/^\s*(?:\*|\/\*)/.test(line) || (comment >= 0 && comment < col && !/:\/\/$/.test(line.slice(0, comment + 2)))) continue;
          bad.push(`${path.relative(root, file)}:${text.slice(0, m.index).split('\n').length}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
    assert.deepEqual(bad, [], `root-absolute asset URLs (use assetUrl('…') from src/platform/paths.ts):\n${bad.join('\n')}`);
  });
  test('the grep catches what it should', () => {
    const hits = (s: string) => { FOLDERS.lastIndex = 0; FILES.lastIndex = 0; return FOLDERS.test(s) || FILES.test(s); };
    assert.ok(hits("fetch('/models/a.glb')"), 'a model path');
    assert.ok(hits('url("/fonts/x.woff2")'), 'a CSS font url');
    assert.ok(hits('`/textures/terrain/grass.webp`'), 'a texture template');
    assert.ok(hits("'/og/card.jpg'"), 'an image');
    assert.ok(!hits("split('/')"), 'a bare slash is not a URL');
    assert.ok(!hits("assetUrl('models/a.glb')"), 'base-relative paths pass');
  });
});
