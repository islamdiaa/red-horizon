// World Conquest region battlefields (MAPS): does the map change who wins? The same Conquest battle specs as the old
// (Europe) curve (src/conquest/testing.ts runWithBattle at strength 3, the core and money of a Europe run), played by
// the human-like pilots (tools/campaign-players.ts newcomer / casual) on the old generator's map and on a region
// battlefield of each climate (a GEO region of that climate, its features and landmark, rotating with the seed).
//
//   node --import tsx tools/world/maps-pilots.ts [--seeds 6] [--kinds assault,capture,hold] [--maps old,temperate,winter,desert,tropical]
//        [--cells easy:newcomer,easy:casual,normal:casual] [--minutes 30] [--out file.json]     (WORKERS=n, default 4)
import { runPool } from './qa-pool';

export interface PilotJob { seed: number; faction: 'allies' | 'soviet'; kind: 'assault' | 'capture' | 'hold' | 'defend'; pilot: 'newcomer' | 'casual'; difficulty: 'easy' | 'normal' | 'hard'; map: string; minutes: number }
export interface PilotRun extends PilotJob { won: boolean; ended: boolean; time: number; reason: string | null; region: string; landmark: string | null; size: number; error?: string }

export async function pilotOne(j: PilotJob): Promise<PilotRun> {
  const { runWithBattle } = await import('../../src/conquest/testing');
  const { runConquestBattle } = await import('../conquest-harness');
  const { regionBattlefield } = await import('../../src/sim/mapgen-region');
  const { WORLD_REGIONS } = await import('../../src/conquest/world/regions');
  const out: PilotRun = { ...j, won: false, ended: false, time: 0, reason: null, region: 'europe', landmark: null, size: 0 };
  try {
    const { setup } = runWithBattle(j.seed, j.faction, j.kind, 'vanguard', j.difficulty, 3);
    if (j.map !== 'old') {
      const pool = WORLD_REGIONS.filter((r) => r.climate === j.map);
      const r = pool[(j.seed * 7 + (j.faction === 'allies' ? 0 : 3) + j.kind.length) % pool.length];
      const b = setup.battle;
      const kind = j.kind === 'assault' || j.kind === 'capture' ? 'attack' : j.kind;
      b.map = regionBattlefield({ kind, terrain: r.terrain, climate: r.climate, culture: r.culture, features: [...r.features], landmark: r.landmark, seed: b.map.seed, strength: b.strength, players: b.map.players, region: r.id }) as never;
      (b as { climate: string }).climate = r.climate;
      b.terrain = r.terrain;
      out.region = r.id;
      out.landmark = r.landmark ?? null;
    }
    out.size = setup.battle.map.size;
    const res = runConquestBattle(setup, j.minutes, j.pilot);
    out.won = res.won; out.ended = res.ended; out.time = res.time; out.reason = res.reason; out.error = res.error;
  } catch (e) {
    out.error = e instanceof Error ? `${e.message} | ${(e.stack ?? '').split('\n').slice(1, 4).join(' | ')}` : String(e);
  }
  return out;
}

/** 95% Wilson interval of k wins in n. */
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

if (process.argv[1]?.endsWith('maps-pilots.ts')) {
  const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const seeds = +arg('seeds', '6');
  const kinds = arg('kinds', 'assault,capture,hold').split(',') as PilotJob['kind'][];
  const maps = arg('maps', 'old,temperate,winter,desert,tropical').split(',');
  const cells = arg('cells', 'easy:newcomer,easy:casual,normal:casual').split(',').map((c) => c.split(':') as [PilotJob['difficulty'], PilotJob['pilot']]);
  const minutes = +arg('minutes', '30');
  const jobs: PilotJob[] = [];
  for (const [difficulty, pilot] of cells) for (const kind of kinds) for (const map of maps) for (let s = 0; s < seeds; s++) for (const faction of ['allies', 'soviet'] as const) {
    jobs.push({ seed: 7 + s * 4, faction, kind, pilot, difficulty, map, minutes });
  }
  const t0 = Date.now();
  const res = await runPool<PilotJob, PilotRun>(new URL(import.meta.url).pathname, 'pilotOne', jobs, {
    workers: Math.max(1, Math.min(4, Number(process.env.WORKERS) || 4)),
    progress: (d, n) => { if (d % 20 === 0 || d === n) console.error(`${d}/${n} ${Math.round((Date.now() - t0) / 1000)} s`); },
  });
  const runs = res.map((r, k) => (r.ok ? r.value : { ...jobs[k], won: false, ended: false, time: 0, reason: null, region: '?', landmark: null, size: 0, error: r.error }));
  const out = arg('out', '');
  if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify(runs));
  console.log(`| level / pilot | kind | ${maps.join(' | ')} |\n|---|---|${maps.map(() => '---').join('|')}|`);
  for (const [difficulty, pilot] of cells) for (const kind of kinds) {
    console.log(`| ${difficulty} ${pilot} | ${kind} | ${maps.map((m) => {
      const rs = runs.filter((r) => r.difficulty === difficulty && r.pilot === pilot && r.kind === kind && r.map === m);
      const w = rs.filter((r) => r.won).length;
      const [lo, hi] = wilson(w, rs.length);
      return `${w}/${rs.length} (${Math.round(lo * 100)}-${Math.round(hi * 100)})`;
    }).join(' | ')} |`);
  }
  // all kinds pooled per map
  for (const [difficulty, pilot] of cells) {
    console.log(`| ${difficulty} ${pilot} | all | ${maps.map((m) => {
      const rs = runs.filter((r) => r.difficulty === difficulty && r.pilot === pilot && r.map === m);
      const w = rs.filter((r) => r.won).length;
      const [lo, hi] = wilson(w, rs.length);
      return `**${w}/${rs.length}** (${Math.round(lo * 100)}-${Math.round(hi * 100)})`;
    }).join(' | ')} |`);
  }
  const errs = runs.filter((r) => r.error);
  for (const r of errs.slice(0, 10)) console.error('ERROR', r.map, r.kind, r.pilot, r.seed, r.faction, String(r.error).slice(0, 300));
  console.error(`${runs.length} battles in ${Math.round((Date.now() - t0) / 1000)} s, ${errs.length} errors`);
}
