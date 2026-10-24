// World Conquest QA: region battlefields. For every GEO region x battle kind, generate the battlefield the way a
// world battle does (MAPS' regionBattlefield) and check what a player would notice:
//   - generation time (contract: under 1.5 s on this host);
//   - a ground path between every pair of starts (8-connected, no corner cutting, as the pathfinder moves);
//   - ore reachable from every start (and how much, near and in all);
//   - the landmark seals nothing: blocking its footprint loses no area beyond the footprint itself (no sealed
//     pocket, no start or ore field cut off);
//   - the landmark is on screen in the starting camera of an attack battle (RTSCamera at the default zoom, 16:9 and
//     a portrait phone), and not under black shroud at the start.
//
//   node --import tsx tools/world/qa-battlefields.ts [--regions all|id,id] [--kinds attack,defend,...] [--seeds 2]
//        [--out file.json]          (WORKERS=n threads, default 6)
//   node --import tsx tools/world/qa-battlefields.ts --selftest      (the checks on plain skirmish maps)
import { QA_OUT } from './qa-pool'; // (results default to screenshots/world-qa/ in the repo: git-ignored)
import * as THREE from 'three';
import type { GameMap } from '../../src/sim/map';
import { RTSCamera } from '../../src/render/camera';

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Ground cells reachable from (sx, sy): 8-connected without cutting corners, as src/sim/pathfinding.ts moves. */
export function reach(map: GameMap, sx: number, sy: number, pass: (i: number) => boolean = (i) => map.passableIdx(i)): Uint8Array {
  const n = map.w * map.h, seen = new Uint8Array(n), q = new Int32Array(n);
  const x0 = Math.max(0, Math.min(map.w - 1, Math.floor(sx))), y0 = Math.max(0, Math.min(map.h - 1, Math.floor(sy)));
  let s = y0 * map.w + x0;
  if (!pass(s)) { // (a start inside a structure footprint: begin from the nearest open cell)
    let best = -1, bd = Infinity;
    for (let r = 1; r < 6 && best < 0; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const j = y * map.w + x, d = dx * dx + dy * dy;
      if (pass(j) && d < bd) { bd = d; best = j; }
    }
    if (best < 0) return seen;
    s = best;
  }
  let qh = 0, qt = 0;
  seen[s] = 1; q[qt++] = s;
  while (qh < qt) {
    const i = q[qh++], x = i % map.w, y = (i / map.w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const j = ny * map.w + nx;
      if (seen[j] || !pass(j)) continue;
      if (dx && dy && (!pass(y * map.w + nx) || !pass(ny * map.w + x))) continue; // no corner cutting
      seen[j] = 1; q[qt++] = j;
    }
  }
  return seen;
}

export function count(a: Uint8Array): number { let n = 0; for (let i = 0; i < a.length; i++) n += a[i]; return n; }

/** Ore cells a truck from this reach can harvest (on a reachable cell or next to one), and those within `near` cells of (sx, sy). */
export function oreReach(map: GameMap, r: Uint8Array, sx: number, sy: number, near = 24): { cells: number; near: number } {
  let cells = 0, nearN = 0;
  for (let i = 0; i < map.ore.length; i++) {
    if (!map.ore[i]) continue;
    const x = i % map.w, y = (i / map.w) | 0;
    let ok = !!r[i];
    for (const [dx, dy] of DIRS) { if (ok) break; const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && r[ny * map.w + nx]) ok = true; }
    if (!ok) continue;
    cells++;
    if (Math.hypot(x + 0.5 - sx, y + 0.5 - sy) <= near) nearN++;
  }
  return { cells, near: nearN };
}

/** Every pair of starts joined by a ground path. */
export function startsConnected(map: GameMap, starts = map.startPositions, pass?: (i: number) => boolean): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (let a = 0; a < starts.length; a++) {
    const r = reach(map, starts[a].x, starts[a].y, pass);
    for (let b = a + 1; b < starts.length; b++) {
      const j = Math.floor(starts[b].y) * map.w + Math.floor(starts[b].x);
      // (a start cell under a structure: any reachable cell within 3 of it counts)
      let ok = !!r[j];
      for (let dy = -3; dy <= 3 && !ok; dy++) for (let dx = -3; dx <= 3 && !ok; dx++) {
        const x = Math.floor(starts[b].x) + dx, y = Math.floor(starts[b].y) + dy;
        if (x >= 0 && y >= 0 && x < map.w && y < map.h && r[y * map.w + x]) ok = true;
      }
      if (!ok) missing.push(`${a}-${b}`);
    }
  }
  return { ok: !missing.length, missing };
}

/**
 * Does blocking `cells` (a landmark footprint) seal anything? Compares the ground reach of each start with the
 * cells open and blocked: the area lost beyond the footprint itself is a sealed pocket (or a cut-off route).
 */
export function sealCheck(map: GameMap, cells: number[], starts = map.startPositions): { lost: number; startsCut: string[]; oreLost: number } {
  const block = new Set(cells);
  const open = (i: number) => block.has(i) ? map.terrainPassable(i) : map.passableIdx(i); // the footprint as plain ground
  const shut = (i: number) => !block.has(i) && map.passableIdx(i);
  let lost = 0, oreLost = 0;
  const s0 = starts[0];
  const a = reach(map, s0.x, s0.y, open), b = reach(map, s0.x, s0.y, shut);
  for (let i = 0; i < a.length; i++) if (a[i] && !b[i] && !block.has(i)) { lost++; if (map.ore[i]) oreLost++; }
  const startsCut = startsConnected(map, starts, shut).missing.filter((m) => !startsConnected(map, starts, open).missing.includes(m));
  return { lost, startsCut, oreLost };
}

/**
 * Where a ground point lands on screen in the starting camera (src/game.ts: focus on the start + (0, 1), the drop-in
 * settles at distance 20): normalised device coordinates (x, y in -1..1 when on screen).
 */
export function screenPoint(map: GameMap, focus: { x: number; y: number }, pt: { x: number; y: number }, lift: number, aspect: number, dist = 20): { x: number; y: number; z: number } {
  const cam = new RTSCamera(map.w, map.h, aspect);
  cam.heightAt = (x, y) => map.surfaceAt(x, y);
  cam.jumpTo(focus.x, focus.y);
  cam.dist = cam.targetDist = dist;
  cam.apply();
  const v = new THREE.Vector3(pt.x, map.surfaceAt(pt.x, pt.y) + lift, pt.y).project(cam.camera);
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Is the landmark in view? Its footprint centre at a third of a typical landmark's height must be inside the
 * screen and above the bottom HUD bar (y > -0.55 in NDC: the Modern bar and selection panel take the bottom ~20%).
 */
export function landmarkInView(map: GameMap, focus: { x: number; y: number; dist?: number }, centre: { x: number; y: number }, aspect: number, lift = 1.5): { inView: boolean; ndc: [number, number] } {
  const p = screenPoint(map, focus, centre, lift, aspect, focus.dist ?? 20); // (the start camera settles at startFocus.dist: game.ts)
  const inView = p.z < 1 && Math.abs(p.x) <= 0.92 && p.y >= -0.55 && p.y <= 0.92;
  return { inView, ndc: [+p.x.toFixed(2), +p.y.toFixed(2)] };
}

// ------------------------------------------------------------------------------------------------ the region sweep
export interface BfJob { region: string; kind: string; seed: number; strength: number; opts: Record<string, unknown> }
export interface BfResult {
  region: string; kind: string; seed: number; climate: string; culture: string; size: number; ms: number; landmark: string | null;
  paths: boolean; pathsNoBridges: boolean; pathsMissing: string[]; ore: { cells: number; near: number }[];
  seal: { lost: number; startsCut: string[]; oreLost: number } | null;
  view: Record<string, { inView: boolean; ndc: [number, number] }> | null; distance: number | null;
  shroud: { explored: number; of: number } | null; civilians: number; civilianSeal: number; makers: { paths: boolean; landmark: unknown };
  problems: string[]; error?: string;
}

const ASPECTS: Record<string, number> = { '1280x720': 1280 / 720, '800x600': 800 / 600, '390x844': 390 / 844, '844x390': 844 / 390 };

/** One region battlefield, generated and checked (the worker entry point). */
export async function bfOne(job: BfJob): Promise<BfResult> {
  const { generateRegion } = await import('../../src/sim/mapgen-region');
  const { LANDMARK_HEIGHTS } = await import('../../src/sim/landmarks');
  const { World } = await import('../../src/sim/world');
  const o = { ...job.opts, kind: job.kind, seed: job.seed, strength: job.strength, players: job.kind === 'boss' ? 3 : 2, region: job.region } as never;
  const r: BfResult = { region: job.region, kind: job.kind, seed: job.seed, climate: String(job.opts.climate), culture: String(job.opts.culture), size: 0, ms: 0, landmark: (job.opts.landmark as string) ?? null,
    paths: false, pathsNoBridges: false, pathsMissing: [], ore: [], seal: null, view: null, distance: null, shroud: null, civilians: 0, civilianSeal: 0, makers: { paths: false, landmark: null }, problems: [] };
  try {
    const t0 = performance.now();
    const g = generateRegion(o);
    r.ms = Math.round(performance.now() - t0);
    const map = g.map;
    r.size = map.w;
    r.makers = { paths: g.report.paths, landmark: g.report.landmark };
    // the World stands the civilian buildings and explores the landmark (sim/landmarks.ts initRegionScenery)
    const players = map.startPositions.map((_, i) => ({ name: `P${i}`, faction: (i ? 'soviet' : 'allies') as 'allies' | 'soviet', color: 0x3d7be0 + i, team: i, isHuman: i === 0, ai: i ? 'normal' as const : undefined }));
    const before = new Uint8Array(map.w * map.h); for (let i = 0; i < before.length; i++) before[i] = map.passableIdx(i) ? 1 : 0;
    const world = new World({ map, players, credits: 5000, startUnits: 'none', fog: true, seed: job.seed });
    r.civilians = world.buildings.filter((b) => b.alive && (b as { scenery?: unknown }).scenery).length;
    const sc = startsConnected(map);
    r.paths = sc.ok; r.pathsMissing = sc.missing;
    r.pathsNoBridges = startsConnected(map, map.startPositions, (i) => map.passableIdx(i) && !(map.terrain[i] === 1)).ok;
    r.ore = map.startPositions.map((s) => oreReach(map, reach(map, s.x, s.y), s.x, s.y, 14));
    // civilian buildings: ground they closed off from the human's start (beyond their own footprints)
    {
      const s0 = map.startPositions[0];
      const a = reach(map, s0.x, s0.y, (i) => !!before[i]), b = reach(map, s0.x, s0.y);
      let lost = 0; for (let i = 0; i < a.length; i++) if (a[i] && !b[i] && !map.occupant[i]) lost++;
      r.civilianSeal = lost;
      if (lost > 6) r.problems.push(`civilian buildings close off ${lost} cells`);
    }
    const L = g.landmark;
    if (L) {
      const cells: number[] = [];
      for (let y = L.cy; y < L.cy + L.h; y++) for (let x = L.cx; x < L.cx + L.w; x++) cells.push(y * map.w + x);
      r.seal = sealCheck(map, cells);
      const c = { x: L.cx + L.w / 2, y: L.cy + L.h / 2 };
      const h = (LANDMARK_HEIGHTS as Record<string, number>)[L.id] ?? 3;
      const focus = map.startFocus ?? { x: map.startPositions[0].x, y: map.startPositions[0].y + 1 }; // (with its settle distance)
      r.distance = +Math.hypot(c.x - map.startPositions[0].x, c.y - map.startPositions[0].y).toFixed(1);
      r.view = {};
      for (const [k, asp] of Object.entries(ASPECTS)) {
        // in view: at least half of its height shows (sampled up its centre line and its front corners), inside the
        // screen between the HUD bars; ndc = where its middle lands
        let shown = 0, n = 0;
        for (const [px, py] of [[c.x, c.y], [L.cx + 0.5, L.cy + L.h - 0.5], [L.cx + L.w - 0.5, L.cy + L.h - 0.5]]) for (let j = 0; j <= 10; j++) { n++; if (landmarkInView(map, focus, { x: px, y: py }, asp, (h * j) / 10).inView) shown++; }
        const mid = landmarkInView(map, focus, c, asp, h * 0.5);
        r.view[k] = { inView: shown / n >= 0.5, ndc: mid.ndc, share: +(shown / n).toFixed(2) } as never;
      }
      const p0 = world.players[0];
      let ex = 0; for (const i of cells) ex += p0.explored[i] ? 1 : 0;
      r.shroud = { explored: ex, of: cells.length };
      if (r.seal.lost > 0 || r.seal.startsCut.length) r.problems.push(`landmark seals ${r.seal.lost} cells${r.seal.startsCut.length ? `, cuts ${r.seal.startsCut.join(',')}` : ''}`);
      if (job.kind === 'attack' && !r.view['1280x720'].inView) r.problems.push(`landmark not in the 1280x720 start view (${Math.round(100 * (r.view['1280x720'] as { share: number }).share)}% of it shows, middle at ndc ${r.view['1280x720'].ndc})`);
      if (ex < cells.length) r.problems.push(`landmark under shroud at the start (${ex}/${cells.length} explored)`);
    }
    if (job.kind === 'naval') {
      // a naval battle: a sea route between the harbours (the water nearest each start)
      const water = (s: { x: number; y: number }) => { let best = -1, bd = Infinity; for (let i = 0; i < map.w * map.h; i++) if (map.navalTerrain(i)) { const d = Math.hypot(i % map.w - s.x, Math.floor(i / map.w) - s.y); if (d < bd) { bd = d; best = i; } } return best; };
      const a = water(map.startPositions[0]), b = water(map.startPositions[1]);
      const sea = a >= 0 && b >= 0 ? reach(map, a % map.w, Math.floor(a / map.w), (i) => map.navalTerrain(i)) : null;
      if (!sea || !sea[b]) r.problems.push('no sea route between the harbours');
    } else if (!r.paths) r.problems.push(`no ground path between starts ${r.pathsMissing.join(',')}`);
    if (r.ore.some((x) => x.cells < 30)) r.problems.push(`little reachable ore (${r.ore.map((x) => x.cells).join('/')})`);
    if (r.ms > 1500) r.problems.push(`generation ${r.ms} ms`);
  } catch (e) {
    r.error = e instanceof Error ? `${e.message} | ${(e.stack ?? '').split('\n').slice(1, 4).join(' | ')}` : String(e);
    r.problems.push('error');
  }
  return r;
}

/** The regions to sweep: GEO's WORLD_REGIONS once they exist, else the strategic layer's atlas (stub). */
export async function sweepRegions(): Promise<{ source: string; regions: { id: string; terrain: string; climate: string; culture: string; features: string[]; landmark?: string; continent: string }[] }> {
  try {
    const m = await import('../../src/conquest/world/regions' as string) as { WORLD_REGIONS?: unknown[] };
    if (Array.isArray(m.WORLD_REGIONS) && m.WORLD_REGIONS.length) return { source: 'GEO regions.ts', regions: m.WORLD_REGIONS as never };
  } catch { /* not there yet */ }
  const { atlas } = await import('../../src/conquest/world/atlas');
  return { source: `atlas ${atlas().version}`, regions: atlas().regions as never };
}

if (process.argv[1]?.endsWith('qa-battlefields.ts') && !process.argv.includes('--selftest')) {
  const fs = await import('node:fs');
  const { runPool } = await import('./qa-pool');
  const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const { source, regions: all } = await sweepRegions();
  const pickR = arg('regions', 'all');
  const regions = pickR === 'all' ? all : all.filter((r) => pickR.split(',').includes(r.id));
  const kinds = arg('kinds', 'attack,defend,hold,naval,boss').split(',');
  const seeds = +arg('seeds', '2');
  const jobs: BfJob[] = [];
  for (const rg of regions) for (const kind of kinds) for (let k = 0; k < seeds; k++) {
    jobs.push({ region: rg.id, kind, seed: 1000 + k * 7777 + jobs.length, strength: 1 + ((k + jobs.length) % 6), opts: { terrain: rg.terrain, climate: rg.climate, culture: rg.culture, features: rg.features, landmark: rg.landmark } });
  }
  console.log(`${jobs.length} battlefields: ${regions.length} regions (${source}) x ${kinds.join('/')} x ${seeds} seeds`);
  const t0 = Date.now();
  const outs = await runPool<BfJob, BfResult>('./qa-battlefields.ts', 'bfOne', jobs, { progress: (d, n, o) => { if (o.ok && o.value.problems.length) console.log(`BAD ${o.value.region} ${o.value.kind} seed ${o.value.seed}: ${o.value.problems.join('; ')}`); if (!o.ok) console.log(`ERR ${o.error.split('\n')[0]}`); if (d % 100 === 0 || d === n) console.log(`${d}/${n}`); } });
  const rs = outs.map((o) => (o.ok ? o.value : null)).filter(Boolean) as BfResult[];
  const out = arg('out', `${QA_OUT}battlefields`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(`${out}/battlefields.json`, JSON.stringify(rs));
  const med = (l: number[]) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
  const L: string[] = [`# Region battlefields (${source}): ${rs.length} generated in ${Math.round((Date.now() - t0) / 1000)} s, ${process.env.WORKERS ?? 6} workers`, ''];
  L.push(`clean ${rs.filter((r) => !r.problems.length).length}/${rs.length}; errors ${rs.filter((r) => r.error).length}`);
  L.push('', '| kind | n | gen ms median / max | paths | paths w/o bridges | ore cells min (start 0 / 1) | ore near min | landmark sealed | attack: landmark in view 1280x720 / 800x600 / 390x844 / 844x390 | under shroud | civilians median | civilian seal max |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const kind of kinds) {
    const g = rs.filter((r) => r.kind === kind);
    if (!g.length) continue;
    const lm = g.filter((r) => r.view);
    const v = (k: string) => `${lm.filter((r) => r.view![k].inView).length}/${lm.length}`;
    L.push(`| ${kind} | ${g.length} | ${med(g.map((r) => r.ms))} / ${Math.max(...g.map((r) => r.ms))} | ${g.filter((r) => r.paths).length} | ${g.filter((r) => r.pathsNoBridges).length} | ${Math.min(...g.map((r) => r.ore[0]?.cells ?? 0))} / ${Math.min(...g.map((r) => r.ore[1]?.cells ?? 0))} | ${Math.min(...g.map((r) => r.ore[0]?.near ?? 0))} | ${lm.filter((r) => r.seal && (r.seal.lost || r.seal.startsCut.length)).length}/${lm.length} | ${['1280x720', '800x600', '390x844', '844x390'].map(v).join(' / ')} | ${lm.filter((r) => r.shroud && r.shroud.explored < r.shroud.of).length} | ${med(g.map((r) => r.civilians))} | ${Math.max(...g.map((r) => r.civilianSeal))} |`);
  }
  L.push('', '| climate | n | gen ms median / max | clean |', '|---|---|---|---|');
  for (const c of [...new Set(rs.map((r) => r.climate))]) { const g = rs.filter((r) => r.climate === c); L.push(`| ${c} | ${g.length} | ${med(g.map((r) => r.ms))} / ${Math.max(...g.map((r) => r.ms))} | ${g.filter((r) => !r.problems.length).length} |`); }
  L.push('', '## Problems (first 60)');
  for (const r of rs.filter((r) => r.problems.length).slice(0, 60)) L.push(`- ${r.region} ${r.kind} seed ${r.seed} (${r.climate}${r.landmark ? `, ${r.landmark} at ${r.distance} cells` : ''}): ${r.problems.join('; ')}${r.error ? ` ${r.error}` : ''}`);
  fs.writeFileSync(`${out}/battlefields.md`, L.join('\n') + '\n');
  console.log(L.slice(0, 30).join('\n'));
}

// ------------------------------------------------------------------------------------------------ self test
if (process.argv[1]?.endsWith('qa-battlefields.ts') && process.argv.includes('--selftest')) {
  const { generateMap } = await import('../../src/sim/mapgen');
  for (const seed of [1, 2, 3]) for (const players of [2, 4]) {
    const t0 = performance.now();
    const map = generateMap({ size: 96, players, seed, water: 0.5, trees: 0.5, ore: 0.6 });
    const ms = performance.now() - t0;
    const sc = startsConnected(map);
    const ores = map.startPositions.map((s) => oreReach(map, reach(map, s.x, s.y), s.x, s.y));
    // a fake 3x3 landmark between the starts
    const mx = Math.floor((map.startPositions[0].x + map.startPositions[1].x) / 2), my = Math.floor((map.startPositions[0].y + map.startPositions[1].y) / 2);
    const cells: number[] = [];
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) cells.push((my + dy) * map.w + mx + dx);
    const seal = sealCheck(map, cells);
    const view = landmarkInView(map, { x: map.startPositions[0].x, y: map.startPositions[0].y + 1 }, { x: map.startPositions[0].x + 4, y: map.startPositions[0].y - 6 }, 16 / 9);
    console.log(`seed ${seed} ${players}p ${ms.toFixed(0)} ms: starts ${sc.ok ? 'ok' : sc.missing.join(',')}, ore ${ores.map((o) => `${o.cells}/${o.near}`).join(' ')}, seal lost ${seal.lost} cut ${seal.startsCut.join(',') || '-'}, view ${JSON.stringify(view)}`);
  }
}
