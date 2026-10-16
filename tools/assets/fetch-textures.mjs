#!/usr/bin/env node
// [PIPE] Fetch the pinned CC0 Poly Haven materials used as *inputs* by the HD-model kit (tools/assets/kit).
//
//   node tools/assets/fetch-textures.mjs                 # download what's missing, verify every md5
//   node tools/assets/fetch-textures.mjs --pin <id> ...  # add / re-pin materials from the Poly Haven API
//
// Files land in ~/.cache/red-horizon/textures/<id>/<map>.<ext> (never in the repo). textures.json pins id,
// resolution, maps and the md5 of every file; a mismatch is an error (re-pin deliberately with --pin).
// Poly Haven assets are CC0 (https://polyhaven.com/license); credited in tools/assets/README.md.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PIN_FILE = join(HERE, 'textures.json');
const CACHE = join(process.env.RH_CACHE ?? join(homedir(), '.cache', 'red-horizon'), 'textures');
const API = 'https://api.polyhaven.com/files/';
/** Maps the kit uses: albedo, OpenGL normal, packed AO / roughness / metalness. */
const MAPS = { diffuse: 'Diffuse', normal: 'nor_gl', arm: 'arm' };

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const exists = (p) => stat(p).then(() => true, () => false);

async function pin(ids, res = '1k', fmt = 'jpg') {
  const doc = JSON.parse(await readFile(PIN_FILE, 'utf8').catch(() => '{"source":"Poly Haven (CC0)","textures":[]}'));
  for (const id of ids) {
    const r = await fetch(API + encodeURIComponent(id));
    if (!r.ok) throw new Error(`${id}: API HTTP ${r.status}`);
    const files = await r.json();
    const entry = { id, res, maps: {} };
    for (const [key, ph] of Object.entries(MAPS)) {
      const f = files[ph]?.[res]?.[fmt];
      if (!f) throw new Error(`${id}: no ${ph} ${res} ${fmt}`);
      entry.maps[key] = { file: `${key}.${fmt}`, url: f.url, md5: f.md5, size: f.size };
    }
    doc.textures = doc.textures.filter((t) => t.id !== id).concat(entry).sort((a, b) => a.id.localeCompare(b.id));
    console.log(`pinned ${id}`);
  }
  await writeFile(PIN_FILE, JSON.stringify(doc, null, 2) + '\n');
}

async function fetchAll() {
  const doc = JSON.parse(await readFile(PIN_FILE, 'utf8'));
  let got = 0, ok = 0;
  for (const t of doc.textures) {
    const dir = join(CACHE, t.id);
    await mkdir(dir, { recursive: true });
    for (const m of Object.values(t.maps)) {
      const out = join(dir, m.file);
      if (await exists(out)) {
        if (md5(await readFile(out)) === m.md5) { ok++; continue; }
        console.warn(`${t.id}/${m.file}: md5 mismatch, re-downloading`);
      }
      // only Poly Haven's download host
      if (!/^https:\/\/dl\.polyhaven\.org\//.test(m.url)) throw new Error(`refusing non-Poly Haven URL ${m.url}`);
      const r = await fetch(m.url);
      if (!r.ok) throw new Error(`${m.url}: HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const h = md5(buf);
      if (h !== m.md5) throw new Error(`${t.id}/${m.file}: md5 ${h} != pinned ${m.md5}`);
      await writeFile(out + '.part', buf);
      await rename(out + '.part', out);
      got++;
    }
  }
  console.log(`textures: ${got} downloaded, ${ok} already verified, in ${CACHE}`);
  // decal fonts (OFL, from google/fonts at a pinned commit, sha256-checked): build-time inputs only
  const FONTS = join(dirname(CACHE), 'fonts');
  let fgot = 0, fok = 0;
  for (const f of doc.fonts ?? []) {
    const dir = join(FONTS, f.id);
    await mkdir(dir, { recursive: true });
    for (const m of Object.values(f.files)) {
      const out = join(dir, m.file);
      if (await exists(out) && sha256(await readFile(out)) === m.sha256) { fok++; continue; }
      if (!/^https:\/\/raw\.githubusercontent\.com\/google\/fonts\//.test(m.url)) throw new Error(`refusing non-google/fonts URL ${m.url}`);
      const r = await fetch(m.url);
      if (!r.ok) throw new Error(`${m.url}: HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const h = sha256(buf);
      if (h !== m.sha256) throw new Error(`${f.id}/${m.file}: sha256 ${h} != pinned ${m.sha256}`);
      await writeFile(out + '.part', buf);
      await rename(out + '.part', out);
      fgot++;
    }
  }
  if (doc.fonts?.length) console.log(`fonts: ${fgot} downloaded, ${fok} already verified, in ${FONTS}`);
}

const args = process.argv.slice(2);
if (args[0] === '--pin') await pin(args.slice(1));
else await fetchAll();
