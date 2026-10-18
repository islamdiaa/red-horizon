#!/usr/bin/env node
// Download the pinned interface fallback fonts (tools/fonts/fonts.json) into ~/.cache/red-horizon/fonts/<id>/,
// verifying each file's sha256. Only raw.githubusercontent.com/google/fonts URLs are accepted.
//   node tools/fonts/fetch.mjs
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(await readFile(join(here, 'fonts.json'), 'utf8'));
const CACHE = join(homedir(), '.cache', 'red-horizon', 'fonts');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const exists = (p) => access(p).then(() => true, () => false);

let got = 0, ok = 0;
for (const f of doc.fonts) {
  const dir = join(CACHE, f.id);
  await mkdir(dir, { recursive: true });
  for (const m of Object.values(f.files)) {
    const out = join(dir, m.file);
    if (await exists(out) && sha256(await readFile(out)) === m.sha256) { ok++; continue; }
    if (!/^https:\/\/raw\.githubusercontent\.com\/google\/fonts\/[0-9a-f]{40}\//.test(m.url)) throw new Error(`refusing unpinned or non-google/fonts URL ${m.url}`);
    const r = await fetch(m.url);
    if (!r.ok) throw new Error(`${m.url}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const h = sha256(buf);
    if (h !== m.sha256) throw new Error(`${f.id}/${m.file}: sha256 ${h} != pinned ${m.sha256}`);
    await writeFile(out + '.part', buf);
    await rename(out + '.part', out);
    got++;
  }
}
console.log(`fonts: ${got} downloaded, ${ok} already verified, in ${CACHE}`);
