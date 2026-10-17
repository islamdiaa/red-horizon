/**
 * Dropped players: the AI takes over a human's side at a given tick, on every client at the same point of the
 * tick (before the world steps from it), so the takeover is part of the deterministic simulation. Replays of a
 * multiplayer match carry the drops (GameSetup.net.drops) and apply them the same way.
 */
import { AIController } from '../sim/ai';
import type { World } from '../sim/world';
import { hookStep } from '../replay/core';
import { TAKEOVER_AI, type NetSetup } from './roster';

/** Hand player `index` to the AI (idempotent). */
export function aiTakeover(world: World, index: number) {
  const p = world.players[index];
  if (!p || world.ais.some((a) => a.player === p)) return;
  p.isHuman = false;
  world.ais.push(new AIController(world, p, TAKEOVER_AI));
}

/** Replays: apply the recorded drops right before the world steps from their tick. Returns an unhook function. */
export function hookRecordedDrops(world: World, net: NetSetup): () => void {
  const drops = (net.drops ?? []).filter((d) => Array.isArray(d) && Number.isInteger(d[0]) && Number.isInteger(d[1])).slice().sort((a, b) => a[0] - b[0]);
  if (!drops.length) return () => {};
  let next = 0;
  while (next < drops.length && drops[next][0] < world.tick) next++;
  return hookStep(world, () => {
    while (next < drops.length && drops[next][0] <= world.tick) {
      if (drops[next][0] === world.tick) aiTakeover(world, drops[next][1]);
      next++;
    }
  }, null);
}
