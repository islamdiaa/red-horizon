// Headless campaign harness. Mirrors src/game.ts world setup (incl. climate map tweaks).
//   node --import tsx tools/campaigntest.ts <missionId|allies|soviet|all> [minutes=40] [pilot=auto|idle|generic] [-v]
// pilot=auto uses the mission-specific autopilot from tools/campaign-pilots.ts (falls back to generic),
// pilot=idle does nothing (useful to check lose conditions), generic = AI base builder + periodic attack-moves.
import { generateMap } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import { MissionRuntime, type MissionDef } from '../src/sim/mission';
import { AIController } from '../src/sim/ai';
import { campaignMissions, getMission } from '../src/missions';
import { TICK_HZ } from '../src/sim/types';
import { PILOTS, genericPilot, type Pilot } from './campaign-pilots';
import './campaign-pilots-allied';
import './campaign-pilots-soviet';
import './campaign-pilots-special';

const TEAM_COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d];

export function createMissionWorld(def: MissionDef) {
  const mp = def.map;
  const climate = mp.climate ?? 'temperate';
  const water = mp.water ?? 0.5, trees = mp.trees ?? 0.5;
  const map = generateMap({
    size: mp.size, players: mp.players, seed: mp.seed, ore: mp.ore ?? 0.6,
    water: climate === 'desert' ? Math.min(water, 0.2) : water,
    trees: climate === 'desert' ? trees * 0.35 : climate === 'winter' ? Math.min(1, trees * 1.2) : trees,
  });
  map.climate = climate;
  const players: PlayerSetup[] = def.players.map((ps, i) => ({
    name: ps.name, faction: ps.faction, color: ps.color ?? TEAM_COLORS[i], team: ps.team ?? i, isHuman: i === 0,
    ai: i === 0 ? undefined : ps.ai === 'passive' || ps.ai === 'defensive' || !ps.ai ? 'normal' : ps.ai,
  }));
  const world = new World({
    map, players, credits: def.credits ?? 5000, startUnits: 'none',
    startUnitsPer: def.players.map((_, i) => (i === 0 ? def.startUnits ?? 'none' : 'none')),
    creditsPer: def.players.map((ps, i) => (i === 0 ? def.credits : ps.credits ?? 5000)),
    fog: def.fog ?? true, seed: mp.seed,
  });
  const rt = new MissionRuntime(world, def);
  world.mission = rt;
  def.players.forEach((ps, i) => { if (i > 0 && ps.ai) rt.setAI(i, ps.ai); });
  if (def.allowedBuild) rt.allowBuild(def.allowedBuild);
  def.setup(rt);
  for (const p of world.players) { world.updateVisibility(p); for (const o of p.buildOptions()) p.knownOptions.add(o); }
  // JITTER=n perturbs the simulation RNG so repeated runs explore different outcomes
  for (let k = 0; k < +(process.env.JITTER ?? 0); k++) world.rng.next();
  return { world, rt };
}

export interface RunResult {
  id: string; won: boolean; ended: boolean; time: number; reason: string | null; stars: number; objectives: string[]; error?: string;
}

export function runMission(def: MissionDef, minutes: number, pilotMode: string, verbose: boolean): RunResult {
  const { world, rt } = createMissionWorld(def);
  const log = (s: string) => { if (verbose) console.log(`  [${fmt(world.time)}] ${s}`); };
  let pilot: Pilot | null = null;
  if (pilotMode === 'auto') pilot = PILOTS[def.id] ?? genericPilot;
  else if (pilotMode === 'generic') pilot = genericPilot;
  const state: Record<string, any> = {};
  let error: string | undefined;
  const maxTicks = minutes * 60 * TICK_HZ;
  const known = new Map<number, string>();
  try {
    for (let t = 0; t < maxTicks && !world.gameOver; t++) {
      world.step();
      if (pilot && t % 10 === 0) pilot(world, rt, state, log);
      if (verbose) {
        if (t % 10 === 0) for (const u of world.units) known.set(u.id, `${u.owner.id}:${u.ut.id}`);
        for (const ev of world.events) {
          if (ev.e === 'death' && ev.how !== 'sold') {
            const k = known.get(ev.id);
            if (k && k.startsWith('0:') && process.env.DEATHS) log(`death ${k} at ${ev.x.toFixed(1)},${ev.y.toFixed(1)} (${ev.how})`);
          }
        }
      }
      for (const ev of rt.events) {
        if (ev.e === 'objective') log(`objective ${ev.change}: ${ev.objective.text} ${ev.objective.progress ?? ''}`);
        else if (ev.e === 'message') log(`radio ${ev.speaker}: ${ev.text.slice(0, 90)}`);
        else if (ev.e === 'end') log(`END won=${ev.won} ${ev.reason ?? ''}`);
        else if (ev.e === 'timer' && ev.label) log(`timer ${ev.label} ${Math.round(ev.seconds ?? 0)}s`);
      }
      rt.events.length = 0;
      world.events.length = 0;
      if (verbose && t % (TICK_HZ * 120) === 0 && t > 0) report(world, log);
    }
  } catch (e) {
    error = (e as Error).stack ?? String(e);
  }
  const optional = rt.objectives.filter((o) => !o.primary);
  const fast = !def.parTime || world.time <= def.parTime;
  const stars = rt.won ? 1 + (fast ? 1 : 0) + (optional.every((o) => o.state === 'done') ? 1 : 0) : 0;
  return {
    id: def.id, won: rt.won, ended: rt.ended, time: world.time, reason: rt.endReason, stars,
    objectives: rt.objectives.map((o) => `${o.primary ? '' : '(opt)'}${o.id}:${o.state}${o.progress ? '[' + o.progress + ']' : ''}`), error,
  };
}

function report(world: World, log: (s: string) => void) {
  for (const p of world.players) {
    const us = world.units.filter((u) => u.alive && u.owner === p);
    const bs = world.buildings.filter((b) => b.alive && b.owner === p && !b.bt.wall);
    const cnt: Record<string, number> = {};
    for (const u of us) cnt[u.ut.id] = (cnt[u.ut.id] ?? 0) + 1;
    log(`  P${p.id} ${p.name} team${p.team} $${p.credits} pow ${p.powerOut}/${p.powerUse} bld ${bs.length} units ${us.length} ${p.defeated ? 'DEFEATED' : ''} :: ${Object.entries(cnt).map(([k, v]) => k + 'x' + v).join(' ')}`);
    if (process.env.BLD && (p.id === 0 || process.env.BLD === 'all')) log(`     bld: ${bs.map((b) => b.bt.id).join(',')} | queues: ${Object.values(p.queues).map((q) => q.kind[0] + ':' + (q.ready ?? '') + q.items.map((i) => i.type).join('+')).join(' ')}`);
  }
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

const isMain = process.argv[1]?.endsWith('campaigntest.ts');
if (isMain) {
  const arg = process.argv[2] ?? 'all';
  const minutes = +(process.argv[3] ?? 40);
  const pilotMode = process.argv[4] ?? 'auto';
  const verbose = process.argv.includes('-v');
  const defs = arg === 'all' ? [...campaignMissions('allies'), ...campaignMissions('soviet')]
    : arg === 'allies' || arg === 'soviet' ? campaignMissions(arg) : [getMission(arg)!];
  for (const def of defs) {
    if (!def) { console.log('unknown mission', arg); continue; }
    const t0 = performance.now();
    const r = runMission(def, minutes, pilotMode, verbose);
    const ms = performance.now() - t0;
    console.log(`${r.id.padEnd(11)} ${r.error ? 'ERROR' : r.ended ? (r.won ? 'WIN ' : 'LOSE') : 'TIMEOUT'} ${fmt(r.time)} par ${fmt(def.parTime ?? 0)} stars ${r.stars} ${r.reason ? '(' + r.reason + ') ' : ''}| ${r.objectives.join(' ')} [${(ms / 1000).toFixed(1)}s]`);
    if (r.error) console.log(r.error);
  }
}
