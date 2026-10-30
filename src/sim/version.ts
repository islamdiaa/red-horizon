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
 *  2. Balance pass: Allied AI (Longbows, artillery, Chronosphere, gap generator, cruisers, spies
 *     and thieves, build order), Commander doctrine / power / economy numbers, the bunker firing slits.
 *  3. Difficulty overhaul: the Recruit level, the scaled-down skirmish levels (economy, tech, powers, events, derricks,
 *     waves, defences, rebuilding: src/sim/ai.ts DIFF), assist-only dynamic difficulty against Recruit and Easy.
 *  4. Quality pass: the Classic skirmish AI's own judgement (tank-first production, engagement estimates, safer
 *     harvesting: src/sim/ai-engage.ts, ai-harvest.ts), AI reachability and intel fixes, save/load continuing the
 *     exact game, passengers no longer targetable, vehicles giving way to each other in head-on jams, units walled
 *     in by structures stepping out.
 *  5. Gameplay pass: units return fire while attacking unarmed targets, blocked moves retry (RA PATH_RETRY), formations
 *     no longer wait on one laggard, service depots serve one vehicle at a time; Recruit and Easy field smaller, lighter
 *     armies that grow over the match, Normal builds at 1.0 / earns 1.05, the Classic AI hunts, besieges and plays for
 *     Tesla power, AI teammates help a human, refinery first when money is short (src/sim/ai*.ts, ai-team.ts); team-aware
 *     start positions (starts.ts); campaign difficulty with Red Alert's handicaps and per-mission tuning (handicap.ts,
 *     mission fixes in Allied 3, Iron Coast, Conquest captures, co-op waves, King of the Hill, the daily); surrender
 *     (resign.ts).
 *  6. Finishing matches: the Classic AI masses before its first wave (Hard holds it until 13:00), saves while its
 *     army is behind (Normal and Hard, first 25 minutes), shells defences its V2s and artillery outrange and takes more
 *     risk after 25 minutes; every skirmish AI hunts a beaten side's stragglers in search parties on a finer grid,
 *     surrenders when beaten and sells spares when broke; Recruit and Easy allies play support; team pushes and help
 *     sizes, AI bases keep refinery docks and factory exits clear, MCV deploy-spot search, depot repair reserve
 *     (src/sim/ai*.ts). Units never auto-target an unarmed invulnerable structure, enter orders try the other sides of a
 *     structure, a moving unit drops a dead target, a loaded game restores mission AI levels (combat.ts, unitlogic.ts,
 *     save.ts). Missions: per-level tuning across the campaign, no-base missions fail when nothing left can finish them
 *     (soviet-01, soviet-03), allied-05's trucks stay on the plain, Conquest's Easy naval harbour and Easy capital, and
 *     capital waves stop with the yard (src/missions, src/conquest).
 *  7. The Classic AI judges ore fields by the ore left in them and cares for its Ore Trucks by level (Hard
 *     turns them back from fire and the enemy's side, Brutal also moves them off mined-out fields), sends a late "luck"
 *     wave only when it outweighs the target's defences; beaten teams concede together; a broke AI pays for its truck
 *     first; new refinery docks and factory exits must lead to open ground; an MCV gives up a deploy spot it can't
 *     reach (src/sim/ai*.ts). An AI that took over a surrendered side can concede for it (resign.ts), a truck whose
 *     ore can't be reached searches again from where it stands (harvest.ts), units sealed in small pockets by friendly
 *     structures are moved out (world.ts), escort/guard units let go of dead targets (orders.ts). Missions: allied-05
 *     Hard/Brutal camp Tesla Coil, soviet-01 Brutal uplink, wolfpack Brutal subs and convoy speed, Conquest Easy bases
 *     and capital, capture-target locks, water structures placed clear of units, the Easy harbour before the fleet,
 *     Boot Camp beacons revealed, engineers count as structure breakers in the no-base lose rules.
 *  8. World Conquest: region battlefields (src/sim/mapgen-region.ts) with landmarks as rock cells
 *     (landmarks.ts), civilian buildings (civilian.ts, building types cv11-cv32), the ground round a landmark explored
 *     for every player and a cleared objective zone for hold battles (region-scenery.ts). World battles
 *     (BattleSpec.world, src/conquest/world) land extra tanks for a troop advantage and regulars that fill the core to
 *     five, and Recruit/Easy hold and naval battles are eased. All of it acts only on region maps and world battles:
 *     skirmish, campaign and Europe Conquest play as in version 7.
 */
export const SIM_VERSION = 8;

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
