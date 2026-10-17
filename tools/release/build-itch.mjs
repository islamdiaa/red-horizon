// npm run build:itch: a relative-base build zipped for itch.io (an "HTML" project: upload the zip and tick
// "This file will be played in the browser"). The zip has index.html at its root and runs from whatever
// folder itch.io serves it from. Output: dist-itch/ and release/red-horizon-itch-<version>.zip.
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { relativeBuild, root } from './relative-build.mjs';
import { listFiles, zipDir } from './zip.mjs';

const outDir = path.join(root, 'dist-itch');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
await relativeBuild(outDir);
const files = listFiles(outDir);
// itch.io's HTML upload rules: index.html at the root, at most 1,000 files, file names it can serve
const problems = [];
if (!files.includes('index.html')) problems.push('index.html is not at the root');
if (files.length > 1000) problems.push(`${files.length} files (itch.io accepts 1,000)`);
for (const f of files) {
  if (!/^[\w./-]+$/.test(f)) problems.push(`file name itch.io may not serve: ${f}`);
  if (statSync(path.join(outDir, f)).size > 200 * 1024 * 1024) problems.push(`over 200 MB: ${f}`);
}
const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
if (/(?:src|href)="\/(?!\/)/.test(html)) problems.push('index.html still has a root-absolute URL');
if (problems.length) {
  console.error('build:itch problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}
const zip = path.join(root, 'release', `red-horizon-itch-${pkg.version}.zip`);
const { bytes } = zipDir(outDir, zip);
console.log(`itch.io build: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB -> ${path.relative(root, zip)}`);
