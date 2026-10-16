/**
 * Watch one self-play match in the terminal: per-player economy / army snapshots every 2 minutes and the AI's
 * decisions as they happen (waves, flanks, raids, fall-backs, expansions, superweapons; from AIController.chatter).
 *
 *   node --import tsx tools/selfplay/inspect.ts [seed] [map=land|sea|<curated id>] [p0] [p1] [minutes]
 *   player spec: <faction>:<difficulty>[:<personality>|:legacy], e.g. allies:hard:rusher soviet:normal:legacy
 */
import type { Faction } from '../../src/data/rules';
import type { AIDifficulty } from '../../src/sim/ai';
import { TICK_HZ } from '../../src/sim/types';
import { buildMatch, type MatchSpec, type PlayerSpec } from './lib';

const seed = +(process.argv[2] ?? 1);
const mapArg = process.argv[3] ?? 'land';
const parse = (s: string): PlayerSpec => {
  const [f, d, x] = s.split(':');
  return { faction: f as Faction, difficulty: (d ?? 'normal') as AIDifficulty, legacy: x === 'legacy', personality: x && x !== 'legacy' ? x : undefined };
};
const players = [parse(process.argv[4] ?? 'allies:normal'), parse(process.argv[5] ?? 'soviet:normal')];
const minutes = +(process.argv[6] ?? 45);
const spec: MatchSpec = {
  id: 0, seed, map: mapArg === 'land' || mapArg === 'sea' ? mapArg : 'curated', curated: mapArg === 'land' || mapArg === 'sea' ? undefined : mapArg,
  players, maxMinutes: minutes,
};
const w = buildMatch(spec);
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const seenChat = new Map<number, number>();
const snapshot = () => {
  console.log(`--- ${fmt(w.time)}`);
  for (const p of w.players) {
    const army = w.units.filter((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester);
    const value = Math.round(army.reduce((s, u) => s + u.ut.cost * u.healthFrac, 0));
    const ai: any = w.ais.find((a) => a.player === p);
    const kinds: Record<string, number> = {};
    for (const u of army) kinds[u.ut.id] = (kinds[u.ut.id] ?? 0) + 1;
    const blds = w.buildings.filter((b) => b.alive && b.owner === p && !b.bt.wall && !b.bt.mine);
    const known = ai?.intel ? ` intel ${ai.intel.structures.size}s/${ai.intel.units.size}u` : '';
    console.log(`  P${p.id} ${p.faction} ${players[p.id].legacy ? 'legacy' : players[p.id].personality ?? 'default'} $${p.credits} harv ${Math.round(p.stats.harvested)} army $${value} (${army.length}) bld ${blds.length} refs ${blds.filter((b) => b.bt.id === 'proc').length} def ${blds.filter((b) => b.weapons.length).length} | state ${ai?.state}/${ai?.stage} wave ${ai?.wave?.size} next ${ai?.nextWaveValue}${known}${p.defeated ? ' DEFEATED' : ''}`);
    console.log(`     ${Object.entries(kinds).map(([k, v]) => `${k}x${v}`).join(' ')}`);
  }
};
for (let t = 1; t <= minutes * 60 * TICK_HZ; t++) {
  w.step();
  w.events.length = 0;
  for (const ai of w.ais as any[]) {
    if (!ai.chatter) continue;
    const from = seenChat.get(ai.player.id) ?? 0;
    for (const c of ai.chatter) {
      if (c.tick <= from) continue;
      console.log(`  [${fmt(c.tick / TICK_HZ)}] P${ai.player.id} ${c.kind}${c.x !== undefined ? ` @${c.x.toFixed(0)},${c.y.toFixed(0)}` : ''}`);
    }
    if (ai.chatter.length) seenChat.set(ai.player.id, ai.chatter[ai.chatter.length - 1].tick);
  }
  if (t % (TICK_HZ * 120) === 0) snapshot();
  if (w.gameOver) break;
}
snapshot();
console.log(w.gameOver ? `winner team ${w.winnerTeam} at ${fmt(w.time)}` : 'timeout');
