/**
 * Surrender. In Red Alert the options menu's Surrender (GOPTIONS.CPP) sends EventClass::DESTRUCT; the house is flagged
 * to die (HOUSE.CPP Flag_To_Die) and, after a short SavourDelay, Blowup_All gives every unit, ship, aircraft and
 * structure it owns full damage. Here it is an ordinary command, so in a multiplayer match every client applies it at
 * the same tick, and replays and the leaderboard's re-simulation reproduce it.
 *
 * The surrendering player is out: they count as beaten whatever their side does afterwards (Player.resigned, shown
 * on the results screen), and they issue nothing more. What happens to their forces:
 *  - **A human team-mate still plays** (2v2, co-op): the side fights on. The surrendering player's units and
 *    structures go to the AI, exactly as when a player leaves or drops (src/net/takeover.ts). This is the fairer of
 *    the two rules for a team: the team-mates did not choose to give up, and blowing up a base in the middle of
 *    theirs (shared defences, power, refineries) would punish them and would let one player wreck the team's game.
 *    It also keeps surrendering and leaving equivalent for the team, so nobody gains by rage-quitting instead.
 *  - **Nobody else on the side plays** (1v1, free for all, a team whose other humans are gone or have surrendered,
 *    single-player skirmish): the side concedes. As in RA, everything its players own is destroyed and they are
 *    defeated; the usual victory check then ends the match for the others (or a free for all goes on without them).
 *  - In a mission run (Survival, the Daily Challenge) the run ends as a loss: "Surrendered".
 */
import { AIController, type AIDifficulty } from './ai';
import type { Player } from './player';
import type { World } from './world';

/** The AI that takes over a side whose player left or surrendered while the team fights on (no economy bonus). */
export const TAKEOVER_AI: AIDifficulty = 'normal';

/** Hand a player's side to the AI (idempotent). Their orders stop; the AI plays their forces from the next think. */
export function handToAI(world: World, p: Player) {
  if (world.ais.some((a) => a.player === p)) return;
  p.isHuman = false;
  world.ais.push(new AIController(world, p, TAKEOVER_AI));
}

/** A human of `p`'s side, other than `p`, who is still playing. */
function teamPlaysOn(world: World, p: Player): boolean {
  return world.players.some((q) => q !== p && q.team === p.team && q.isHuman && !q.defeated && !q.resigned);
}

/** Everything a player owns is destroyed (RA's Blowup_All). Structures first: survivors and garrisons that come out of
 *  them are units, which the next pass takes too (passengers die with their transport). */
function destroyAll(world: World, q: Player) {
  for (let pass = 0; pass < 4; pass++) {
    let any = false;
    for (const b of world.buildings.slice()) if (b.alive && b.owner === q) { world.kill(b, 'normal'); any = true; }
    // (a demolition truck taken this way must not go off among the enemy: it is removed, not detonated)
    for (const u of world.units.slice()) if (u.alive && u.owner === q) { world.kill(u, u.ut.demolition ? 'sold' : 'normal'); any = true; }
    if (!any) break;
  }
}

/** World.processCommand: `player` surrenders. Ignored for a player who is already out, and after the end. */
export function resignCommand(world: World, player: number) {
  const p = world.players[player];
  if (!p || p.defeated || world.gameOver) return;
  // Once surrendered, a player issues nothing more (the relay drops anything from the seat after it, the lockstep sends
  // nothing). But the AI that took their side over (a team that fought on) may concede for it later, when nobody on the
  // side plays any more and it is beaten (ai.ts lastStand); its surrender used to be ignored here, and the side's last
  // Ore Truck or spy kept a finished match going (version 7).
  if (p.resigned && (p.isHuman || teamPlaysOn(world, p))) return;
  p.resigned = true;
  const mission = world.mission;
  if (!mission && teamPlaysOn(world, p)) { handToAI(world, p); return; }
  // the side concedes (in a mission only the player's own forces: the mission ends at once)
  const side = mission ? [p] : world.players.filter((q) => q.team === p.team && !q.defeated);
  for (const q of side) destroyAll(world, q);
  for (const q of side) {
    q.defeated = true;
    world.events.push({ e: 'eliminated', player: q.id });
  }
  if (mission && mission.human === p) mission.lose(SURRENDERED);
}

/** The reason a mission run ends with (English at the source, like every simulation text: trSource translates it). */
export const SURRENDERED = 'Surrendered';

/** Can `p` surrender now? (The interface offers it only then; the command itself checks the same.) */
export function canResign(world: World, p: Player | null | undefined): boolean {
  return !!p && !p.defeated && !p.resigned && !world.gameOver;
}
