#!/usr/bin/env node
// Build HD models: runs Blender (one at a time, 4 threads) on tools/assets/models/**/<id>.py, writes
// public/models/<id>[.<faction>].glb and updates public/models/manifest.json.
//
//   node tools/assets/build.mjs powr            # every faction's powr (models/*/powr.py)
//   node tools/assets/build.mjs powr.soviet 3tnk
//   node tools/assets/build.mjs --all           # everything except models/test/
//   options: --quick (half-res atlas, few samples: iteration only, never commit)
//            --preview (Cycles stills next to the log: /tmp/rh-assets/<key>-rts.png, -close.png)
//            --threads N (default 4, max 6)  --out DIR (default public/models)
//            --min-mem MB (default 4096: wait until /proc/meminfo MemAvailable reaches it before each
//            Blender run, for shared machines; RH_MIN_MEM_MB overrides; 0 disables)
//            --list (print the model scripts and exit)
//            --reindex (rebuild manifest.json from the GLBs on disk: recovers entries lost to parallel builds)
// The manifest is merged per built model under a lock file (manifest.lock) and written atomically, so several
// builds can run at the same time.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const BLENDER = process.env.RH_BLENDER ?? join(process.env.RH_CACHE ?? join(homedir(), '.cache', 'red-horizon'), 'blender', 'blender');
const LOGS = process.env.RH_ASSET_LOGS ?? '/tmp/rh-assets';
const BUDGET = {
  structure: { bytes: 1_000_000, tris: 8000 }, defense: { bytes: 1_000_000, tris: 8000 }, naval: { bytes: 1_000_000, tris: 8000 },
  vehicle: { bytes: 400_000, tris: 5000 }, aircraft: { bytes: 400_000, tris: 5000 }, infantry: { bytes: 250_000, tris: 2500 },
  anim: { bytes: 800_000, tris: 0 }, // rig clip sets (vertex animation textures)
  nature: { bytes: 200_000, tris: 1200 },
};
const FACTION_BUDGET = 23_000_000;
const TOTAL_BUDGET = 45_000_000;

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const out = resolve(REPO, opt('--out', 'public/models'));
/** Nature models (models/nature: trees, rocks; render/vegetation.ts) keep their own folder and manifest. */
/** So do the rigged infantry (models/infantry: soldiers, dogs, the clip sets; render/models/infantry-hd.ts). */
const OWN_FOLDER = new Set(['nature', 'infantry']);
const outFor = (s) => (OWN_FOLDER.has(s.group) && !args.includes('--out') ? resolve(REPO, `public/models/${s.group}`) : out);
const threads = Math.max(1, Math.min(6, Number(opt('--threads', 4)) || 4));
const minMemMB = Number(opt('--min-mem', process.env.RH_MIN_MEM_MB ?? 4096));
const wanted = args.filter((a, i) => !a.startsWith('--') && !['--out', '--threads', '--min-mem'].includes(args[i - 1]));

/** MemAvailable in MB (Linux), or Infinity where /proc/meminfo is missing. */
function memAvailableMB() {
  try {
    const m = /MemAvailable:\s+(\d+)\s+kB/.exec(readFileSync('/proc/meminfo', 'utf8'));
    return m ? Number(m[1]) / 1024 : Infinity;
  } catch {
    return Infinity;
  }
}

/** Memory guard: block until MemAvailable >= minMemMB, polling every 30 s (protects other processes on a shared machine). */
async function waitForMemory(label) {
  if (!(minMemMB > 0)) return;
  let mb = memAvailableMB();
  while (mb < minMemMB) {
    console.log(`  waiting for memory before ${label}: ${Math.round(mb)} MB available, need ${minMemMB} MB (checking every 30 s)`);
    await new Promise((r) => setTimeout(r, 30000));
    mb = memAvailableMB();
  }
}

/** Every model script: { path, id, faction, group } (FACTION read from the script). */
function scripts() {
  const root = join(HERE, 'models');
  const list = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.py') && !f.startsWith('_')) {
        const src = readFileSync(p, 'utf8');
        const id = /^ID\s*=\s*['"]([^'"]+)['"]/m.exec(src)?.[1] ?? basename(f, '.py');
        const faction = /^FACTION\s*=\s*['"]([^'"]+)['"]/m.exec(src)?.[1] ?? null;
        list.push({ path: p, id, faction, group: relative(root, d), key: faction ? `${id}.${faction}` : id });
      }
    }
  };
  if (existsSync(root)) walk(root);
  return list.sort((a, b) => a.key.localeCompare(b.key));
}

function runBlender(s) {
  mkdirSync(LOGS, { recursive: true });
  const log = join(LOGS, `${s.key}.log`);
  const a = ['-b', '--factory-startup', '-t', String(threads), '--python', join(HERE, 'kit', 'run.py'), '--', '--model', s.path, '--out', outFor(s), '--threads', String(threads)];
  if (flag('--quick')) a.push('--quick');
  if (flag('--preview')) a.push('--preview', join(LOGS, `${s.key}.png`));
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(BLENDER, a, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    const w = createWriteStream(log);
    let report = null;
    let buf = '';
    const onData = (d) => {
      w.write(d);
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.startsWith('RH_REPORT ')) report = JSON.parse(line.slice(10));
        else if (line.startsWith('[kit]') || /Error|Traceback|RH_FAILED/.test(line)) console.log(`  ${line}`);
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('close', (code) => { w.end(); res({ code, report, log, seconds: (Date.now() - t0) / 1000 }); });
  });
}

function sha(file) {
  return createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 10);
}

/** Read a GLB's JSON chunk. */
function glbJson(file) {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jl = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
}

/** Manifest entry from the GLB on disk (bytes, hash, the glTF extras metadata, triangles, parts, points). */
function entryFromGlb(file, extra = {}) {
  const j = glbJson(file);
  const root = j.nodes[j.scenes[j.scene ?? 0].nodes[0]];
  const rh = root.extras?.rh ?? {};
  let tris = 0;
  for (const m of j.meshes ?? []) for (const p of m.primitives) tris += (p.indices !== undefined ? j.accessors[p.indices].count : j.accessors[p.attributes.POSITION].count) / 3;
  const parts = [];
  const points = [];
  const walk = (i) => {
    const n = j.nodes[i];
    if (i !== j.scenes[j.scene ?? 0].nodes[0] && n.extras?.rh_point) points.push(n.name);
    if ((n === root || n.extras?.rh_part) && (n.children ?? []).some((c) => j.nodes[c].mesh !== undefined)) parts.push(n.name);
    for (const c of n.children ?? []) walk(c);
  };
  walk(j.scenes[j.scene ?? 0].nodes[0]);
  const textures = {};
  for (const im of j.images ?? []) textures[im.name] = j.bufferViews[im.bufferView].byteLength;
  const name = basename(file);
  const key = name.replace(/\.glb$/, '');
  const id = rh.id ?? key.split('.')[0];
  const faction = rh.faction ?? (key.includes('.') ? key.split('.').slice(1).join('.') : null);
  return {
    key,
    entry: {
      file: name, bytes: statSync(file).size, hash: sha(file), type: id, faction: faction ?? null, kind: rh.kind ?? 'structure',
      tris: Math.round(tris), parts, points: points.sort(), atlas: rh.atlas, textures, ...extra,
    },
  };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Serialised read-merge-write of manifest.json (several builds may run at once). An O_EXCL lock file (stale after
 * 60 s), the manifest re-read under the lock, only `entries` (key -> entry, or null = delete) merged in, then an
 * atomic tmp + rename.
 */
async function updateManifest(manPath, entries) {
  const lock = manPath.replace(/manifest\.json$/, 'manifest.lock');
  for (let t = 0; ; t++) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 60000) { unlinkSync(lock); continue; } // stale (a crashed run)
      } catch { continue; }
      if (t % 20 === 19) console.log('  waiting for the manifest lock...');
      await sleepMs(250);
    }
  }
  try {
    const man = existsSync(manPath) ? JSON.parse(readFileSync(manPath, 'utf8')) : { version: 1, models: {} };
    man.version = 1;
    man.models ??= {};
    for (const [k, e] of Object.entries(entries)) {
      if (e === null) delete man.models[k];
      else man.models[k] = e;
    }
    man.models = Object.fromEntries(Object.entries(man.models).sort(([a], [b]) => a.localeCompare(b)));
    const tmp = `${manPath}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(man, null, 2) + '\n');
    renameSync(tmp, manPath);
    return man;
  } finally {
    try { unlinkSync(lock); } catch { /* already gone */ }
  }
}

/** --reindex: rebuild the manifest from the GLBs on disk (recovers entries lost to concurrent writes). */
async function reindex(manPath) {
  const old = existsSync(manPath) ? JSON.parse(readFileSync(manPath, 'utf8')).models ?? {} : {};
  const entries = {};
  for (const f of readdirSync(out).filter((f) => f.endsWith('.glb')).sort()) {
    try {
      const { key, entry } = entryFromGlb(join(out, f), old[f.replace(/\.glb$/, '')]?.seconds !== undefined ? { seconds: old[f.replace(/\.glb$/, '')].seconds } : {});
      entries[key] = entry;
    } catch (e) {
      console.log(`  skipped ${f}: ${e.message}`);
    }
  }
  for (const k of Object.keys(old)) if (!entries[k]) entries[k] = null; // stale entries whose GLB is gone
  const man = await updateManifest(manPath, entries);
  const added = Object.keys(entries).filter((k) => entries[k] && !old[k]);
  const removed = Object.keys(entries).filter((k) => entries[k] === null);
  console.log(`reindexed ${Object.keys(man.models).length} models` + (added.length ? `; recovered: ${added.join(', ')}` : '') + (removed.length ? `; dropped (no GLB): ${removed.join(', ')}` : ''));
  return man;
}

function printSet(man) {
  const per = {};
  let total = 0;
  for (const e of Object.values(man.models)) { per[e.faction ?? 'neutral'] = (per[e.faction ?? 'neutral'] ?? 0) + e.bytes; total += e.bytes; }
  console.log(`\nset: ${(total / 1e6).toFixed(2)} MB total (budget ${TOTAL_BUDGET / 1e6} MB); ` + Object.entries(per).map(([f, b]) => `${f} ${(b / 1e6).toFixed(2)} MB${b > FACTION_BUDGET ? ' OVER' : ''}`).join(', '));
}

async function main() {
  const all = scripts();
  if (flag('--list')) { for (const s of all) console.log(`${s.key.padEnd(22)} ${relative(REPO, s.path)}`); return; }
  mkdirSync(out, { recursive: true });
  const manPath = join(out, 'manifest.json');
  if (flag('--reindex')) { printSet(await reindex(manPath)); return; }
  if (!existsSync(BLENDER)) { console.error(`Blender not found at ${BLENDER}: run tools/assets/setup-blender.sh`); process.exit(1); }
  let todo;
  if (flag('--all')) todo = all.filter((s) => s.group !== 'test');
  else todo = all.filter((s) => wanted.some((w) => w === s.key || w === s.id || resolve(w) === s.path));
  if (!todo.length) { console.error('nothing to build (try --list)'); process.exit(1); }
  const rows = [];
  let failures = 0;
  let man = null;
  for (const s of todo) {
    console.log(`> ${s.key}  (${relative(REPO, s.path)})`);
    await waitForMemory(s.key);
    const r = await runBlender(s);
    if (r.code !== 0 || !r.report) { failures++; console.log(`  FAILED (exit ${r.code}), log: ${r.log}`); continue; }
    const rep = r.report;
    const extra = { seconds: rep.seconds };
    if (rep.quick) extra.quick = true;
    const { key, entry } = entryFromGlb(join(outFor(s), rep.file), extra);
    entry.tris = rep.tris;
    entry.parts = rep.parts;
    entry.points = rep.points;
    // merged into the manifest right away (under the lock), so a later failure or a parallel run loses nothing
    if (s.group !== 'test') man = await updateManifest(outFor(s) === out ? manPath : join(outFor(s), 'manifest.json'), { [key]: entry });
    rows.push([key, entry]);
  }
  console.log('\nmodel                  tris    KB   budget  time');
  for (const [k, e] of rows) {
    const b = BUDGET[e.kind] ?? BUDGET.structure;
    const over = (e.bytes > b.bytes ? ' BYTES>' + Math.round(b.bytes / 1000) + 'KB' : '') + (e.tris > b.tris ? ' TRIS>' + b.tris : '');
    console.log(`${k.padEnd(22)} ${String(e.tris).padStart(5)} ${String(Math.round(e.bytes / 1024)).padStart(5)}  ${over ? 'OVER' + over : 'ok'.padEnd(6)} ${e.seconds}s${e.quick ? '  (QUICK: do not commit)' : ''}`);
  }
  if (man) printSet(man);
  if (failures) process.exit(1);
}

main();
