#!/usr/bin/env node
// Terrain material builder: pinned CC0 Poly Haven scans -> game-ready tiling sets in public/textures/terrain/.
//
//   node tools/assets/terrain/build.mjs                 # fetch what's missing (md5-checked), bake every material
//   node tools/assets/terrain/build.mjs grass rock      # bake only these materials
//   node tools/assets/terrain/build.mjs --pin <id> ...  # pin Poly Haven ids (1k jpg: diffuse, nor_gl, arm, disp)
//   options: --size 512 (texels per side)  --fetch-only  --min-mem MB (default 2048)
//
// Inputs land in ~/.cache/red-horizon/textures/<id>/ (shared with tools/assets/fetch-textures.mjs, never in the
// repo); textures.json here pins every file's URL and md5. The bake (headless Blender, numpy) writes per material:
//   <name>.albedo.webp  RGB albedo (sRGB), crevice AO folded in, large-scale lighting flattened (less visible tiling)
//   <name>.nrm.webp     RGBA: R,G = tangent-space normal X,Y (OpenGL, +Y = image up), B = height, A = 128 + 127 x roughness
// and public/textures/terrain/manifest.json (files, bytes, hashes, average colours). The game reads the climate
// layer sets from src/render/terrain-materials.ts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const PIN_FILE = join(HERE, 'textures.json');
const CACHE_ROOT = process.env.RH_CACHE ?? join(homedir(), '.cache', 'red-horizon');
const CACHE = join(CACHE_ROOT, 'textures');
const BLENDER = process.env.RH_BLENDER ?? join(CACHE_ROOT, 'blender', 'blender');
const OUT = join(REPO, 'public', 'textures', 'terrain');
const API = 'https://api.polyhaven.com/files/';
/** Poly Haven map -> cache file name. */
const MAPS = { diffuse: 'Diffuse', normal: 'nor_gl', arm: 'arm', disp: 'Displacement' };

/**
 * The materials: name -> Poly Haven source and bake knobs.
 *  flatten: how much of the texture's large-scale brightness variation is removed (0..1; hides tiling)
 *  ao: how strongly the scan's AO darkens the albedo; rough: roughness remap [lo, hi] over the scan's roughness
 *  nstr: normal strength; hgamma: height contrast (< 1 lifts the low parts)
 */
const MATERIALS = {
  // temperate
  grass: { src: 'leafy_grass', flatten: 0.7, ao: 0.5, rough: [0.7, 1.0], nstr: 1.0 },
  meadow: { src: 'forrest_ground_01', flatten: 0.6, ao: 0.5, rough: [0.7, 1.0], nstr: 1.0 },
  dirt: { src: 'forest_ground_04', flatten: 0.6, ao: 0.6, rough: [0.7, 1.0], nstr: 1.0 },
  rock: { src: 'rock_face_03', flatten: 0.4, ao: 0.7, rough: [0.55, 0.95], nstr: 1.2 },
  sand: { src: 'coast_sand_01', flatten: 0.7, ao: 0.4, rough: [0.75, 1.0], nstr: 0.9 },
  gravel: { src: 'ganges_river_pebbles', flatten: 0.5, ao: 0.7, rough: [0.5, 0.95], nstr: 1.1 },
  asphalt: { src: 'asphalt_04', flatten: 0.7, ao: 0.5, rough: [0.55, 0.95], nstr: 1.0 },
  asphalt_snow: { src: 'asphalt_snow', flatten: 0.6, ao: 0.4, rough: [0.45, 0.9], nstr: 1.0 },
  mud: { src: 'brown_mud_02', flatten: 0.6, ao: 0.5, rough: [0.35, 0.9], nstr: 1.0 },
  snow: { src: 'snow_02', flatten: 0.6, ao: 0.4, rough: [0.45, 0.85], nstr: 0.9 },
  concrete: { src: 'cracked_concrete', flatten: 0.6, ao: 0.5, rough: [0.6, 0.95], nstr: 0.8 },
  // winter
  snow_wind: { src: 'snow_01', flatten: 0.6, ao: 0.4, rough: [0.45, 0.85], nstr: 1.0 },
  frozen_dirt: { src: 'rocks_ground_05', flatten: 0.5, ao: 0.6, rough: [0.55, 0.95], nstr: 1.0 },
  shore_grey: { src: 'coast_sand_05', flatten: 0.6, ao: 0.5, rough: [0.6, 1.0], nstr: 1.0 },
  frozen_mud: { src: 'brown_mud_rocks_01', flatten: 0.6, ao: 0.6, rough: [0.4, 0.9], nstr: 1.0 },
  // desert
  dune: { src: 'sand_01', flatten: 0.7, ao: 0.4, rough: [0.75, 1.0], nstr: 1.0 },
  cracked_earth: { src: 'mud_cracked_dry_03', flatten: 0.6, ao: 0.6, rough: [0.7, 1.0], nstr: 1.0 },
  desert_dirt: { src: 'dry_ground_rocks', flatten: 0.6, ao: 0.6, rough: [0.7, 1.0], nstr: 1.0 },
  sandstone: { src: 'cliff_side', flatten: 0.35, ao: 0.7, rough: [0.6, 0.95], nstr: 1.2 },
  desert_gravel: { src: 'rocky_trail_02', flatten: 0.5, ao: 0.6, rough: [0.6, 0.95], nstr: 1.0 },
  packed_sand: { src: 'gravel_road', flatten: 0.6, ao: 0.5, rough: [0.7, 1.0], nstr: 0.9 },
  shore_sand: { src: 'dense_sand', flatten: 0.7, ao: 0.4, rough: [0.7, 1.0], nstr: 0.9 },
};

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const SIZE = Number(opt('--size', 512));
const minMemMB = Number(opt('--min-mem', process.env.RH_MIN_MEM_MB ?? 2048));
const wanted = args.filter((a, i) => !a.startsWith('--') && !['--size', '--min-mem'].includes(args[i - 1]));

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const exists = (p) => stat(p).then(() => true, () => false);

async function pin(ids) {
  const doc = JSON.parse(await readFile(PIN_FILE, 'utf8').catch(() => '{"source":"Poly Haven (CC0)","textures":[]}'));
  for (const id of ids) {
    const r = await fetch(API + encodeURIComponent(id));
    if (!r.ok) throw new Error(`${id}: API HTTP ${r.status}`);
    const files = await r.json();
    const entry = { id, res: '1k', maps: {} };
    for (const [key, ph] of Object.entries(MAPS)) {
      const f = files[ph]?.['1k']?.jpg;
      if (!f) throw new Error(`${id}: no ${ph} 1k jpg`);
      entry.maps[key] = { file: `${key}.jpg`, url: f.url, md5: f.md5, size: f.size };
    }
    doc.textures = doc.textures.filter((t) => t.id !== id).concat(entry).sort((a, b) => a.id.localeCompare(b.id));
    console.log(`pinned ${id}`);
  }
  await writeFile(PIN_FILE, JSON.stringify(doc, null, 2) + '\n');
}

/** Download every pinned file that is missing or stale (md5) into the shared texture cache. */
async function fetchAll(ids) {
  const doc = JSON.parse(await readFile(PIN_FILE, 'utf8'));
  let got = 0, ok = 0;
  for (const t of doc.textures) {
    if (ids && !ids.has(t.id)) continue;
    const dir = join(CACHE, t.id);
    await mkdir(dir, { recursive: true });
    for (const m of Object.values(t.maps)) {
      const out = join(dir, m.file);
      if (await exists(out)) {
        if (md5(await readFile(out)) === m.md5) { ok++; continue; }
        console.warn(`${t.id}/${m.file}: md5 mismatch, re-downloading`);
      }
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
  console.log(`terrain textures: ${got} downloaded, ${ok} already verified, in ${CACHE}`);
}

function memAvailableMB() {
  try {
    const m = /MemAvailable:\s+(\d+)\s+kB/.exec(readFileSync('/proc/meminfo', 'utf8'));
    return m ? Number(m[1]) / 1024 : Infinity;
  } catch {
    return Infinity;
  }
}

async function waitForMemory() {
  while (minMemMB > 0 && memAvailableMB() < minMemMB) {
    console.log(`  waiting for memory: ${Math.round(memAvailableMB())} MB available, need ${minMemMB} MB`);
    await new Promise((r) => setTimeout(r, 30000));
  }
}

function webp(png, out, kind) {
  // normals / height / roughness: high quality; the roughness alpha lossy (its fine detail is lost at RTS distances anyway)
  const a = kind === 'albedo'
    ? ['-q', '84', '-m', '6', '-sharp_yuv', '-metadata', 'none']
    : ['-q', '84', '-m', '6', '-sharp_yuv', '-alpha_q', '60', '-exact', '-metadata', 'none'];
  const r = spawnSync('cwebp', [...a, png, '-o', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cwebp failed for ${png}: ${r.stderr}`);
}

async function main() {
  if (flag('--pin')) { await pin(wanted); return; }
  const names = wanted.length ? wanted : Object.keys(MATERIALS);
  for (const n of names) if (!MATERIALS[n]) throw new Error(`unknown material ${n} (one of ${Object.keys(MATERIALS).join(', ')})`);
  const doc = JSON.parse(readFileSync(PIN_FILE, 'utf8'));
  const pinned = new Set(doc.textures.map((t) => t.id));
  const missing = [...new Set(names.map((n) => MATERIALS[n].src))].filter((id) => !pinned.has(id));
  if (missing.length) throw new Error(`not pinned: ${missing.join(', ')} (node tools/assets/terrain/build.mjs --pin ${missing.join(' ')})`);
  await fetchAll(new Set(names.map((n) => MATERIALS[n].src)));
  if (flag('--fetch-only')) return;
  if (!existsSync(BLENDER)) throw new Error(`Blender not found at ${BLENDER}: run tools/assets/setup-blender.sh`);
  const tmp = join(tmpdir(), `rh-terrain-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const job = { size: SIZE, cache: CACHE, out: tmp, materials: Object.fromEntries(names.map((n) => [n, MATERIALS[n]])) };
  const jobFile = join(tmp, 'job.json');
  writeFileSync(jobFile, JSON.stringify(job));
  await waitForMemory();
  console.log(`baking ${names.length} materials at ${SIZE}px in Blender...`);
  const r = spawnSync(BLENDER, ['-b', '--factory-startup', '-t', '4', '--python', join(HERE, 'bake.py'), '--', jobFile], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const report = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('RH_TERRAIN ')).map((l) => JSON.parse(l.slice(11)));
  if (r.status !== 0 || report.length !== names.length) {
    console.error((r.stdout ?? '').slice(-4000), (r.stderr ?? '').slice(-4000));
    throw new Error(`bake failed (exit ${r.status})`);
  }
  const manPath = join(OUT, 'manifest.json');
  const man = existsSync(manPath) ? JSON.parse(readFileSync(manPath, 'utf8')) : { version: 1, materials: {} };
  man.version = 1;
  man.size = SIZE;
  man.source = 'Poly Haven (CC0), https://polyhaven.com; baked by tools/assets/terrain/build.mjs';
  for (const rep of report) {
    const e = { src: MATERIALS[rep.name].src, avg: rep.avg, files: {} };
    for (const kind of ['albedo', 'nrm']) {
      const file = `${rep.name}.${kind}.webp`;
      webp(join(tmp, `${rep.name}.${kind}.png`), join(OUT, file), kind);
      const buf = readFileSync(join(OUT, file));
      e.files[kind] = { file, bytes: buf.length, hash: createHash('sha1').update(buf).digest('hex').slice(0, 10) };
    }
    man.materials[rep.name] = e;
    console.log(`${rep.name.padEnd(14)} ${MATERIALS[rep.name].src.padEnd(22)} albedo ${(e.files.albedo.bytes / 1024).toFixed(0).padStart(4)} KB  nrm ${(e.files.nrm.bytes / 1024).toFixed(0).padStart(4)} KB  avg ${rep.avg.map((v) => v.toFixed(2)).join(',')}`);
  }
  man.materials = Object.fromEntries(Object.entries(man.materials).sort(([a], [b]) => a.localeCompare(b)));
  let total = 0;
  for (const e of Object.values(man.materials)) total += e.files.albedo.bytes + e.files.nrm.bytes;
  man.bytes = total;
  writeFileSync(manPath + '.tmp', JSON.stringify(man, null, 2) + '\n');
  renameSync(manPath + '.tmp', manPath);
  console.log(`set: ${Object.keys(man.materials).length} materials, ${(total / 1e6).toFixed(2)} MB (target about 5 MB)`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
