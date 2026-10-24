/**
 * Testing hook (MAPS): turn a Conquest battle into a World Conquest region battle of one GEO region, so screenshots,
 * the GPU rig and browser tests can open any region battlefield by URL:
 *   ?autostart=1&conquest=assault|capture|hold|defend|naval|boss&region=<region id>[&seed=N&faction=soviet]
 * (src/main.ts). The battle keeps its armies and script; its map becomes the region's battlefield.
 */
import type { BattleSpec } from '../conquest/battle';
import { regionBattlefield, type RegionKind } from '../sim/mapgen-region';

const KIND: Record<string, RegionKind> = { assault: 'attack', capture: 'attack', hold: 'hold', defend: 'defend', naval: 'naval', boss: 'boss' };

export async function useRegion(battle: BattleSpec, regionId: string): Promise<boolean> {
  const { WORLD_REGIONS } = await import('../conquest/world/regions');
  const r = WORLD_REGIONS.find((x) => x.id === regionId);
  if (!r) return false;
  const spec = regionBattlefield({
    kind: KIND[battle.kind] ?? 'attack', terrain: r.terrain, climate: r.climate, culture: r.culture, features: [...r.features],
    landmark: r.landmark, seed: battle.map.seed, strength: battle.strength, players: battle.map.players, region: r.id,
  });
  battle.map = spec as unknown as BattleSpec['map'];
  (battle as { climate: string }).climate = r.climate;
  battle.terrain = r.terrain;
  battle.mapLabel = spec.label;
  battle.name = r.name;
  return true;
}
