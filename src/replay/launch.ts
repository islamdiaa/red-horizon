/**
 * Starting matches from maps, map codes and replays: the setup a replay is watched with, and the
 * URL test parameters (?autostart=1&map=<id> · &mapcode=<code> · &replay=<id>|latest[&view=<n>|obs]).
 */
import type { GameSetup, OpponentSetup } from '../game';
import type { Quality } from '../render/renderer';
import { getMapDef } from '../maps';
import { decodeMapCode } from '../maps/code';
import type { ReplayData } from './format';
import { getReplay, listReplays } from './store';

/** The GameSetup that watches a replay. */
export function playbackSetup(data: ReplayData, quality: Quality, extra: { view?: number } = {}): GameSetup {
  return { ...data.setup, quality, intro: false, demo: false, replay: { data, view: extra.view } };
}

/** Resize the opponent list to a player count (curated maps and map codes fix it). */
export function fitOpponents(opponents: OpponentSetup[], players: number): OpponentSetup[] {
  const out = opponents.slice(0, Math.max(1, players - 1)).map((o) => ({ ...o }));
  while (out.length < players - 1) out.push({ faction: 'random', difficulty: out[out.length - 1]?.difficulty ?? 'normal' });
  return out;
}

/** Apply map= / mapcode= / replay= test parameters to an autostart setup. */
export async function resolveTestSetup(params: URLSearchParams, setup: GameSetup): Promise<GameSetup> {
  const rid = params.get('replay');
  if (rid) {
    const data = rid === 'latest' ? (await listReplays())[0] ?? null : await getReplay(rid);
    if (data) {
      const v = params.get('view');
      return playbackSetup(data, setup.quality, { view: v === 'obs' ? -1 : v ? +v : undefined });
    }
    console.warn(`replay ${rid} not found; starting a normal match`);
  }
  const mapId = params.get('map');
  const def = mapId ? getMapDef(mapId) : undefined;
  if (def) return { ...setup, mapId: def.id, mapSize: def.size, climate: def.climate, opponents: fitOpponents(setup.opponents, def.players) };
  const code = params.get('mapcode');
  const p = code ? decodeMapCode(code) : null;
  if (p) return { ...setup, mapSize: p.size, water: p.water, trees: p.trees, ore: p.ore, climate: p.climate, seed: p.seed, opponents: fitOpponents(setup.opponents, p.players) };
  return setup;
}
