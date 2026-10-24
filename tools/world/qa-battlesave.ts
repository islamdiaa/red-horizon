// World Conquest QA: save / load of a World battle in progress (the autosave a player resumes from, rh.save.conquest).
// Each scenario builds a world battle the way the game does (STRAT's startBattle -> tools/conquest-harness.ts, the
// region battlefield regenerated from the spec), plays it with the strike-force autopilot, saves, loads into a fresh
// world and plays both on (tools/qa/modesave.ts runScenario: hash right after the load, every 10 ticks after, the
// serialised state at the end), and also checks what the hash does not cover: every civilian building keeps its
// look (`scenery`, the culture style the renderer reads) and the landmarks are the same after the load.
//
//   node --import tsx tools/world/qa-battlesave.ts [--regions 12] [--quick]      (one process; ~1-3 s a scenario)
import type { Json } from '../../src/sim/save';

export interface BsJob { region: string; kind: 'naval' | 'land'; seed: number; difficulty: string; quick?: boolean }
export interface BsResult { name: string; ok: boolean; notes: string[]; ms: number; ended: string; scenery: string; kind: string }

export async function battleSaveOne(j: BsJob): Promise<BsResult> {
  const W = await import('../../src/conquest/world/index');
  const { createConquestWorld, PILOTS } = await import('../conquest-harness');
  const { runScenario } = await import('../qa/modesave');
  const { serializeWorld, deserializeWorld } = await import('../../src/sim/save');
  const { AIController } = await import('../../src/sim/ai');
  const run = W.newWorldRun({ seed: j.seed, home: W.atlas().homelands[j.seed % W.atlas().homelands.length].id, size: 'world', difficulty: j.difficulty as never });
  const T = run.territories, ti = T.findIndex((t) => t.id === j.region), X = W.ix(run);
  if (ti < 0) return { name: `${j.region}`, ok: true, notes: ['(not in this run)'], ms: 0, ended: '-', scenery: '-', kind: '-' };
  const nb = X.adj[ti].map((n, k) => ({ n, sea: X.sea[ti][k] }));
  const pick = nb.find((x) => x.sea === (j.kind === 'naval') && T[x.n].capital === undefined) ?? nb[0];
  const from = T[pick.n], to = T[ti];
  from.owner = 0; from.troops = 8; to.owner = to.capital ?? run.powers.find((p) => p.id !== 0 && p.alive)!.id; to.troops = 4;
  if (pick.sea && !from.port && !to.port) from.port = true;
  run.turn = Math.max(2, run.turn); run.current = 0; run.phase = 'attack'; run.toPlace = 0; run.pending = null; run.defence = null; // (turn 1 is the opening month: no attacks on powers)
  const setup = W.startBattle(run, from.id, to.id);
  if (!setup) return { name: `${j.region}`, ok: false, notes: ['startBattle gave nothing'], ms: 0, ended: '-', scenery: '-', kind: '-' };
  const frozen = JSON.parse(JSON.stringify(setup));
  const kind = setup.battle.kind;
  const name = `world ${kind} ${j.region} s${j.seed} ${j.difficulty}`;
  const scenery = (w: { buildings: { alive: boolean; scenery?: unknown; bt: { id: string }; id: number }[] }) => w.buildings.filter((b) => b.alive && /^cv\d\d$/.test(b.bt.id)).map((b) => `${b.id}:${JSON.stringify(b.scenery ?? null)}`).sort().join(' ');
  const landmarks = (w: { map: { landmarks: unknown[] } }) => JSON.stringify(w.map.landmarks);
  const sc = {
    name, replay: false,
    make(load?: Json) {
      const { world, rt } = createConquestWorld(JSON.parse(JSON.stringify(frozen)), !!load);
      if (load) {
        // (as tools/qa/modesave.ts resumeExtraAIs: the autopilot's own base brain joined during play; recreate it first)
        for (const as of (load as { ais?: { player: number; difficulty: string }[] }).ais ?? []) if (!world.ais.some((a) => a.player.id === as.player)) world.ais.push(new AIController(world, world.players[as.player], as.difficulty as never));
        deserializeWorld(world, load, rt);
        for (const p of world.players) for (const o of p.buildOptions()) p.knownOptions.add(o); // (as game.ts)
      }
      return world;
    },
    driver: (w: never) => { const s: Record<string, unknown> = { boosted: true }; const brain = (w as unknown as { ais: { player: { id: number } }[] }).ais.find((a) => a.player.id === 0); if (brain) s.brain = brain; return () => { const ww = w as unknown as { tick: number; mission: unknown; gameOver: boolean }; if (ww.tick % 10 === 1 && ww.mission && !ww.gameOver) (PILOTS[kind] as (a: unknown, b: unknown, c: unknown) => void)(ww, ww.mission, s); }; },
    saveAt: Math.round((j.quick ? 45 : 90) * 20), after: Math.round((j.quick ? 45 : 90) * 20),
  };
  const r = runScenario(sc as never);
  // what the world hash does not cover: the civilian buildings' looks and the landmarks, through a save
  const A = sc.make();
  for (let k = 0; k < 200; k++) A.step();
  const save = JSON.parse(JSON.stringify(serializeWorld(A)));
  const B = sc.make(save);
  const sa = scenery(A as never), sb = scenery(B as never);
  const notes = [...r.notes];
  const nCiv = A.buildings.filter((b) => b.alive && /^cv\d\d$/.test(b.bt.id)).length;
  let sceneryNote = `ok (${nCiv} civilian buildings)`;
  if (sa !== sb) {
    const lost = B.buildings.filter((b) => b.alive && /^cv\d\d$/.test(b.bt.id) && !(b as { scenery?: unknown }).scenery).length;
    sceneryNote = `${lost}/${A.buildings.filter((b) => b.alive && /^cv\d\d$/.test(b.bt.id)).length} civilian buildings lost their look after the load`;
    notes.push(sceneryNote);
  }
  if (landmarks(A as never) !== landmarks(B as never)) notes.push('landmarks differ after the load');
  return { name, ok: notes.length === 0, notes, ms: Math.round(r.ms), ended: r.ended, scenery: sceneryNote, kind };
}

if (process.argv[1]?.endsWith('qa-battlesave.ts')) {
  const { sweepRegions } = await import('./qa-battlefields');
  const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const n = +arg('regions', '12');
  const { regions } = await sweepRegions();
  const step = Math.max(1, Math.floor(regions.length / n));
  const picks = regions.filter((_, i) => i % step === 0).slice(0, n);
  const diffs = ['easy', 'normal', 'hard'];
  let ok = 0, all = 0;
  for (const [i, rg] of picks.entries()) for (const kind of (rg.features.includes('coast') || rg.features.includes('harbour') ? ['land', 'naval'] : ['land']) as BsJob['kind'][]) {
    const r = await battleSaveOne({ region: rg.id, kind, seed: 31 + i * 7, difficulty: diffs[i % 3], quick: process.argv.includes('--quick') });
    all++; if (r.ok) ok++;
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name} (${r.ended}, ${r.ms} ms, scenery ${r.scenery})${r.notes.length ? ': ' + r.notes.slice(0, 3).join(' ; ') : ''}`);
  }
  console.log(`world battle save/load: ${ok}/${all} identical`);
}
