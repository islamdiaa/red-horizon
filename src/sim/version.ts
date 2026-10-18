/**
 * Simulation version stamp.
 *
 * Replays store commands, not states: playing one back re-runs the simulation, so it only plays back exactly on a
 * build whose simulation behaves the same. Rules, AI, Commander numbers, economy, pathing, combat: any change to
 * what `World.step` does with the same commands is a new simulation version.
 *
 * **Bump `SIM_VERSION` whenever simulation behaviour changes** (the golden-hash tests in tests/ fail when it does:
 * update them in the same change). Replays, saves, challenges and branches record the version they were made
 * with (`sim`); the multiplayer and leaderboard build fingerprint includes it (src/net/fingerprint.ts), so peers and
 * the leaderboard server never mix versions.
 *
 * Loading something recorded with another version never fails: a save or a challenge carries the whole world state
 * and simply continues under the current rules; a replay plays back anyway and warns on its first state-hash
 * mismatch (src/replay/playback.ts), and the replay list marks it (src/ui/replay-tree.ts).
 *
 * History:
 *  1. Everything recorded before the stamp existed (no `sim` field).
 *  2. Masterpiece wave 2 balance pass: Allied AI (Longbows, artillery, Chronosphere, gap generator, cruisers, spies
 *     and thieves, build order), Commander doctrine / power / economy numbers, the bunker firing slits.
 */
export const SIM_VERSION = 2;

/** The version of records made before the stamp existed. */
export const LEGACY_SIM_VERSION = 1;

/** The simulation version a record (replay, save, challenge, branch) was made with. */
export function simVersionOf(rec: { sim?: unknown } | null | undefined): number {
  const v = rec?.sim;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1e6 ? v : LEGACY_SIM_VERSION;
}

/** Whether a record was made with another simulation version (it may not play back exactly). */
export function otherSimVersion(rec: { sim?: unknown } | null | undefined): boolean {
  return simVersionOf(rec) !== SIM_VERSION;
}
