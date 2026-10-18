/**
 * Procedural run generation: a seed picks ~26 well-spread regions of Europe, turns them into territories
 * (Voronoi cells over the land), links them by land borders and sea lanes, and deals out owners, garrisons,
 * resources, enemy fronts and the starting kit. Same seed + options = the same run, byte for byte.
 */
import { Rng } from '../core/rng';
import type { Faction } from '../data/rules';
import { REGIONS, REGION_BY_ID, buildMesh, coastCells, isLand, landBorders, partition, proj, seaRoutes, type Pt, type RegionDef, type Terrain } from './geo';
import { COMMANDERS, DOCTRINES, SUPREME, type Difficulty, type ResourceKind } from './data';
import { addVeteran } from './run';
import { RUN_VERSION, distances, emptyStats, type ConquestRun, type EnemyFront, type Link, type Territory, type AttackObjective } from './state';
import { RUN } from '../i18n/en/conquest-run'; // the English stored in the run (translated where shown)
import { fill as en } from './text';

export interface NewRunOptions {
  seed: number;
  faction: Faction;
  difficulty?: Difficulty;
  doctrine?: string;
  /** Wall-clock start (UI only; not part of the deterministic content). */
  now?: number;
  /** Meta renown (unlocks perks for the pool). */
  renown?: number;
}

/** Minimum spacing between territory sites (projected px). */
const SPACING = 52;

/** Pick the run's regions: capitals and anchors first, then a well-spread random subset. */
function pickRegions(rng: Rng, capitals: string[], target: number): RegionDef[] {
  const chosen: RegionDef[] = [];
  const pos = (r: RegionDef) => proj(r.lon, r.lat);
  const fits = (r: RegionDef, d: number) => chosen.every((c) => { const a = pos(c), b = pos(r); return Math.hypot(a[0] - b[0], a[1] - b[1]) >= d; });
  for (const id of capitals) chosen.push(REGION_BY_ID[id]);
  for (const r of REGIONS) if (r.core && !chosen.includes(r) && fits(r, SPACING * 0.8)) chosen.push(r);
  const rest = rng.shuffle(REGIONS.filter((r) => !chosen.includes(r)));
  for (let d = SPACING + 8; chosen.length < target && d >= SPACING - 16; d -= 8) {
    for (const r of rest) {
      if (chosen.length >= target) break;
      if (!chosen.includes(r) && fits(r, d)) chosen.push(r);
    }
  }
  return chosen;
}

const TERRAIN_SWAP: Partial<Record<Terrain, Terrain[]>> = {
  plains: ['forest', 'steppe', 'river'],
  forest: ['plains', 'lakes'],
  steppe: ['plains', 'river'],
  river: ['plains', 'lakes'],
  lakes: ['forest', 'river'],
  urban: ['plains', 'river'],
};

function objectiveFor(rng: Rng, terrain: Terrain, coastal: boolean): AttackObjective {
  const r = rng.next();
  if ((terrain === 'coast' || terrain === 'islands') && coastal && r < 0.45) return 'naval';
  if (terrain === 'urban') return r < 0.6 ? 'capture' : r < 0.8 ? 'hold' : 'assault';
  if (terrain === 'river' || terrain === 'plains' || terrain === 'steppe') return r < 0.35 ? 'hold' : r < 0.5 ? 'capture' : 'assault';
  return r < 0.15 ? 'capture' : r < 0.3 ? 'hold' : 'assault';
}

const RES_HINT: Record<string, ResourceKind> = {
  caucasus: 'oil', bucharest: 'oil', rostov: 'oil', stalingrad: 'oil', ruhr: 'industry', silesia: 'industry', kharkov: 'industry', saxony: 'industry', midlands: 'industry',
  leningrad: 'science', paris: 'science', london: 'science', moscow: 'science', vienna: 'science', gorky: 'industry', hamburg: 'port', murmansk: 'port', odessa: 'port',
  normandy: 'port', crimea: 'port', bavaria: 'airfield', kursk: 'airfield', warsaw: 'manpower', kiev: 'manpower', budapest: 'manpower',
};

// operation codenames ("Operation Iron Tide") are names: not translated
const CODE_A = ['Iron', 'Red', 'Northern', 'Steel', 'Thunder', 'Crimson', 'Silent', 'Winter', 'Broken', 'Golden', 'Black', 'Burning', 'Distant', 'Last', 'Grey'];
const CODE_B = ['Tide', 'Dawn', 'Hammer', 'Storm', 'Lance', 'Anvil', 'Gale', 'Spear', 'Horizon', 'Citadel', 'Avalanche', 'Sabre', 'Harvest', 'Bastion', 'Rampart'];

export function generateRun(opts: NewRunOptions): ConquestRun {
  const seed = opts.seed >>> 0;
  const rng = new Rng(seed ^ 0x2c1b3c6d);
  const faction = opts.faction;
  const enemy: Faction = faction === 'allies' ? 'soviet' : 'allies';
  const difficulty = opts.difficulty ?? 'normal';
  const doctrine = DOCTRINES.find((d) => d.id === opts.doctrine) ?? DOCTRINES[0];

  // ---- capitals: the Soviets hold Moscow; the Allies London or Paris
  const westCap = rng.chance(0.5) ? 'london' : 'paris';
  const playerCapId = faction === 'allies' ? westCap : 'moscow';
  const enemyCapId = faction === 'allies' ? 'moscow' : westCap;

  // ---- regions -> sites (jittered a little, kept on land and apart)
  const regions = pickRegions(rng, [playerCapId, enemyCapId, westCap === 'london' ? 'paris' : 'london'], rng.int(24, 28));
  const sites: Pt[] = [];
  const geo: { lon: number; lat: number }[] = [];
  for (const r of regions) {
    let lon = r.lon, lat = r.lat;
    if (!r.capital) {
      const jl = lon + rng.range(-0.45, 0.45), ja = lat + rng.range(-0.3, 0.3);
      const [x, y] = proj(jl, ja);
      if (isLand(x, y) && sites.every((s) => Math.hypot(s[0] - x, s[1] - y) > 34)) { lon = jl; lat = ja; }
    }
    const [sx, sy] = proj(lon, lat);
    sites.push([+sx.toFixed(2), +sy.toFixed(2)]);
    geo.push({ lon, lat });
  }

  // ---- adjacency: land borders, then sea lanes, then make sure everything is connected
  const mesh = buildMesh(seed);
  const part = partition(mesh, sites);
  const ids = regions.map((r) => r.id);
  const links: Link[] = [];
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const linked = new Set<string>();
  const add = (a: number, b: number, sea: boolean) => {
    if (a === b || linked.has(key(a, b))) return;
    linked.add(key(a, b));
    links.push({ a: ids[Math.min(a, b)], b: ids[Math.max(a, b)], sea });
  };
  const land = [...landBorders(mesh, part)].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  for (const [k, len] of land) if (len >= 8) { const [a, b] = k.split(':').map(Number); add(a, b, false); }
  const sea = [...seaRoutes(mesh, part)].filter(([k]) => !linked.has(k)).sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1));
  const seaCount = new Map<number, number>();
  for (const [k, d] of sea) {
    if (d > 105) continue;
    const [a, b] = k.split(':').map(Number);
    if ((seaCount.get(a) ?? 0) >= 3 || (seaCount.get(b) ?? 0) >= 3) continue;
    add(a, b, true);
    seaCount.set(a, (seaCount.get(a) ?? 0) + 1);
    seaCount.set(b, (seaCount.get(b) ?? 0) + 1);
  }
  // join disconnected pieces with the shortest sea route (or straight line) between them
  for (let guard = 0; guard < 30; guard++) {
    const reach = distances({ links }, ids[0]);
    if (reach.size >= ids.length) break;
    let best: [number, number] | null = null, bd = Infinity;
    for (const [k, d] of sea) {
      const [a, b] = k.split(':').map(Number);
      if (reach.has(ids[a]) !== reach.has(ids[b]) && d < bd) { bd = d; best = [a, b]; }
    }
    if (!best) {
      for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
        if (!reach.has(ids[i]) || reach.has(ids[j])) continue;
        const d = Math.hypot(sites[i][0] - sites[j][0], sites[i][1] - sites[j][1]);
        if (d < bd) { bd = d; best = [i, j]; }
      }
    }
    if (!best) break;
    add(best[0], best[1], true);
  }

  // ---- territories
  const territories: Territory[] = regions.map((r, i) => {
    const coastal = coastCells(mesh, part, i) >= 2;
    let terrain: Terrain = r.terrain;
    if (terrain === 'coast' && !coastal) terrain = 'plains';
    else if (terrain !== 'mountain' && terrain !== 'coast' && terrain !== 'islands' && !r.capital && rng.chance(0.22)) {
      const alt = TERRAIN_SWAP[terrain];
      if (alt) terrain = rng.pick(alt);
    }
    if (terrain === 'islands' && !coastal) terrain = 'plains';
    return {
      id: r.id, name: r.name, x: sites[i][0], y: sites[i][1], lon: +geo[i].lon.toFixed(3), lat: +geo[i].lat.toFixed(3),
      terrain, coastal, value: 1, income: 0, objective: 'assault' as AttackObjective, owner: 'enemy' as const, strength: 1, front: 0, fort: 0,
    };
  });
  const T = (id: string) => territories.find((t) => t.id === id)!;
  const pCap = T(playerCapId), eCap = T(enemyCapId);
  pCap.capital = 'player';
  eCap.capital = 'enemy';

  // ---- owners: the player holds the capital and its nearest neighbours, a few neutrals sit it out
  const dP = distances({ links }, pCap.id), dE = distances({ links }, eCap.id);
  pCap.owner = 'player';
  pCap.fort = 2; // the capital is ringed with defences
  const near = territories
    .filter((t) => dP.get(t.id) === 1 && t !== eCap && (dE.get(t.id) ?? 99) > 1)
    .sort((a, b) => Math.hypot(a.x - pCap.x, a.y - pCap.y) - Math.hypot(b.x - pCap.x, b.y - pCap.y));
  for (const t of near.slice(0, 4)) t.owner = 'player';
  let neutrals = 0;
  for (const t of rng.shuffle(territories.filter((t) => REGION_BY_ID[t.id].neutral && t.owner === 'enemy' && (dP.get(t.id) ?? 0) >= 2 && (dE.get(t.id) ?? 0) >= 2))) {
    if (neutrals >= 3 || !rng.chance(0.7)) continue;
    t.owner = 'neutral';
    neutrals++;
  }

  // ---- fronts: three enemy commanders split the enemy territories by bearing from the enemy capital
  const pool = rng.shuffle([...COMMANDERS[enemy]]);
  const fronts: EnemyFront[] = pool.slice(0, 3).map((c) => ({ commander: c.name, personality: c.personality }));
  const toPlayer = Math.atan2(pCap.y - eCap.y, pCap.x - eCap.x);
  const enemyTs = territories.filter((t) => t.owner === 'enemy' && t !== eCap);
  const bearing = (t: Territory) => { let a = Math.atan2(t.y - eCap.y, t.x - eCap.x) - toPlayer; while (a < -Math.PI) a += Math.PI * 2; while (a > Math.PI) a -= Math.PI * 2; return a; };
  enemyTs.sort((a, b) => bearing(a) - bearing(b)).forEach((t, k) => { t.front = Math.min(2, Math.floor((k * 3) / Math.max(1, enemyTs.length))); });
  const sup = SUPREME[enemy];
  const boss: EnemyFront = { commander: sup.name, personality: sup.personality };

  // ---- garrisons, value, income, resources, objectives
  for (const t of territories) {
    const a = dP.get(t.id) ?? 6, b = dE.get(t.id) ?? 6;
    const along = a / Math.max(1, a + b); // 0 at the player's capital, 1 at the enemy's
    if (t.owner === 'enemy') t.strength = Math.max(1, Math.min(5, Math.round(1 + along * 3.2 + rng.range(-0.45, 0.55))));
    else if (t.owner === 'neutral') t.strength = rng.int(1, 2);
    else t.strength = 0;
    if (t === eCap) t.strength = 6;
    t.value = t.capital ? 3 : Math.min(3, 1 + (t.terrain === 'urban' || rng.chance(0.3) ? 1 : 0) + (rng.chance(0.1) ? 1 : 0));
    const hint = RES_HINT[t.id];
    if (hint && rng.chance(0.75)) t.res = hint;
    else if (rng.chance(0.4)) {
      const opts: ResourceKind[] = ['oil', 'industry', 'science', 'manpower', 'airfield'];
      if (t.coastal) opts.push('port', 'port');
      t.res = rng.pick(opts);
    }
    if (t.res === 'port' && !t.coastal) t.res = 'industry';
    t.income = Math.round((250 + t.value * 150 + (t.terrain === 'urban' ? 150 : 0) + rng.int(0, 4) * 25) / 50) * 50;
    t.objective = t.capital ? 'assault' : objectiveFor(rng, t.terrain, t.coastal);
  }

  // ---- starting kit
  const diffCredits = difficulty === 'easy' ? 2000 : difficulty === 'hard' ? -1000 : 0;
  const run: ConquestRun = {
    v: RUN_VERSION,
    id: `cq-${seed.toString(36)}-${faction[0]}${difficulty[0]}`,
    seed, faction, enemy, difficulty, doctrine: doctrine.id,
    turn: 1, status: 'active', rng: (rng.next() * 4294967296) >>> 0,
    warChest: 6000 + diffCredits + (doctrine.credits ?? 0), rp: 2 + (doctrine.rp ?? 0),
    morale: difficulty === 'easy' ? 4 : 3, moraleMax: difficulty === 'easy' ? 4 : 3,
    perks: [...doctrine.perks], research: [...doctrine.research],
    territories, links, fronts, boss,
    core: [], nextVet: 1,
    threat: null, superThreat: null, pending: null, event: null, perkChoice: null, report: null, pursuit: false,
    log: [], stats: emptyStats(), startedAt: opts.now ?? 0, renown: opts.renown ?? 0,
    name: `Operation ${rng.pick(CODE_A)} ${rng.pick(CODE_B)}`, armyAt: pCap.id, reportSeen: true,
  };
  for (const c of doctrine.core ?? []) addVeteran(run, c[faction], c.rank);
  run.stats.peakTerritories = territories.filter((t) => t.owner === 'player').length;
  run.log.push({ turn: 1, kind: 'info', text: en(faction === 'allies' ? RUN.log.alliedStart : RUN.log.sovietStart, { territory: pCap.name, target: eCap.name }) });
  return run;
}
