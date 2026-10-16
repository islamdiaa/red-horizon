/**
 * Headless (DOM-free) world construction that mirrors src/game.ts step for step for skirmish-based setups
 * (generated / curated / custom maps, KOTH, branches, challenges) and scripted missions (co-op survival).
 * Used by the tests and tools to check that branches, challenges and modes replay deterministically.
 * Keep it in sync with the Game constructor (look for the [MODES] / [D] / [EDIT] tags there).
 */
import type { Faction } from '../data/rules';
import type { GameSetup } from '../game';
import { buildMap, loadCuratedMap } from '../maps';
import { getMission } from '../missions';
import { applyModSet } from '../mods/engine';
import { generateMap } from '../sim/mapgen';
import { MissionRuntime } from '../sim/mission';
import type { Player } from '../sim/player';
import { deserializeWorld } from '../sim/save';
import { World, type PlayerSetup } from '../sim/world';
import { ceasefireForSetup } from '../sim/ceasefire';
import { applyRoster, attachModeRuntime, prepareModeSetup, startModes } from './runtime';

const TEAM_COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d, 0xe07b2a, 0x8e4fd0, 0x2aa8a8, 0x9aa0aa];
const AI_NAMES = ['Gen. Volkov', 'Marshal Krukov', 'Col. Nadia', 'Gen. Stavros', 'Cdr. Bennett', 'Maj. Kane'];

export interface HeadlessGame {
  world: World;
  local: Player;
  setup: GameSetup;
}

/** Build the World a Game would build for this setup (without rendering, HUD or recorder). */
export function headlessGame(input: GameSetup): HeadlessGame {
  let setup = prepareModeSetup(input);
  applyModSet(setup.mods);
  const def = setup.mission ? getMission(setup.mission) ?? null : null;
  if (def) {
    const mp = def.map;
    setup = { ...setup, mapSize: mp.size, seed: mp.seed, water: mp.water ?? 0.5, trees: mp.trees ?? 0.5, ore: mp.ore ?? 0.6, climate: mp.climate ?? 'temperate', fog: def.fog ?? true, faction: def.players[0].faction };
  }
  const nPlayers = def ? def.map.players : 1 + setup.opponents.length;
  const curated = setup.customMap ? buildMap(setup.customMap) : !def && setup.mapId ? loadCuratedMap(setup.mapId) : null;
  const climate = curated?.climate ?? (setup.climate === 'winter' || setup.climate === 'desert' ? setup.climate : 'temperate') as 'temperate' | 'winter' | 'desert';
  const map = curated ?? generateMap({
    size: setup.mapSize, players: nPlayers, seed: setup.seed, ore: setup.ore,
    water: climate === 'desert' && setup.water < 0.9 ? Math.min(setup.water, 0.2) : setup.water,
    trees: climate === 'desert' ? setup.trees * 0.35 : climate === 'winter' ? Math.min(1, setup.trees * 1.2) : setup.trees,
  });
  map.climate = climate;
  const rngFaction = (i: number): Faction => ((setup.seed >> i) & 1 ? 'allies' : 'soviet');
  const used = new Set([setup.color]);
  const players: PlayerSetup[] = [{ name: 'Commander', faction: setup.faction, color: setup.color, team: 0, isHuman: true }];
  setup.opponents.forEach((o, i) => {
    const color = TEAM_COLORS.find((c) => !used.has(c))!;
    used.add(color);
    players.push({ name: AI_NAMES[(setup.seed + i) % AI_NAMES.length], faction: o.faction === 'random' ? rngFaction(i + 1) : o.faction, color, team: i + 1, isHuman: false, ai: o.difficulty });
  });
  if (def) {
    players.length = 0;
    def.players.forEach((ps, i) => players.push({
      name: ps.name, faction: ps.faction, color: ps.color ?? TEAM_COLORS[i], team: ps.team ?? i, isHuman: i === 0,
      ai: i === 0 ? undefined : ps.ai === 'passive' || ps.ai === 'defensive' || !ps.ai ? 'normal' : ps.ai,
    }));
  }
  if (!def) applyRoster(players, setup);
  if (!def && (setup.seed & 2)) map.startPositions.reverse();
  const world = new World({
    map, players, credits: def ? (def.credits ?? 5000) : setup.credits, startUnits: def ? 'none' : setup.startUnits,
    startUnitsPer: def ? def.players.map((_, i) => (i === 0 ? def.startUnits ?? 'none' : 'none')) : undefined,
    creditsPer: def ? def.players.map((ps, i) => (i === 0 ? def.credits : ps.credits ?? 5000)) : undefined,
    fog: setup.fog, seed: setup.seed,
    ceasefireUntil: ceasefireForSetup(setup, !!def),
  });
  let local = world.players[0];
  attachModeRuntime(world, setup, !!def);
  if (setup.load) deserializeWorld(world, setup.load.world, world.mission);
  if (!def) local = startModes(world, setup);
  if (def) {
    const rt = new MissionRuntime(world, def);
    world.mission = rt;
    def.players.forEach((ps, i) => { if (i > 0 && ps.ai) rt.setAI(i, ps.ai); });
    if (def.allowedBuild) rt.allowBuild(def.allowedBuild);
    if (!setup.load) def.setup(rt);
    if (setup.load) deserializeWorld(world, setup.load.world, rt);
    for (const p of world.players) { world.updateVisibility(p); for (const o of p.buildOptions()) p.knownOptions.add(o); }
  }
  return { world, local, setup };
}

/** Step a world n ticks, draining events and mission events (as the frame loop does). */
export function run(world: World, ticks: number, before?: () => void) {
  for (let t = 0; t < ticks && !world.gameOver; t++) {
    before?.();
    world.step();
    world.events.length = 0;
    if (world.mission) world.mission.events.length = 0;
  }
}
