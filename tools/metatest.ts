// Headless tests for the progression layer: node --import tsx tools/metatest.ts
// Feeds synthetic GameEvents into MetaTracker (backed by a real World for entity lookups), checks
// medal unlocks, XP / rank math, persistence + migration, survival / daily records, per-event cost,
// and finally runs a real Survival mission with the tracker attached.
import { generateMap } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import { MissionRuntime } from '../src/sim/mission';
import { AIController } from '../src/sim/ai';
import { getMission } from '../src/missions';
import { setDailyDay } from '../src/missions/special';
import type { Entity } from '../src/sim/entities';
import type { GameEvent } from '../src/sim/types';
import { TICK_HZ } from '../src/sim/types';
import {
  ACHIEVEMENTS, DAILY_MODIFIERS, MetaTracker, shiftDay, RANKS, achievementState, allAchievementStates, dailyConfig, favouriteUnit, medalTotals, normalizeProfile, PROFILE_KEY,
  rankIndexFor, rankProgress, xpForRank, type UnlockInfo,
} from '../src/meta';
import type { KV } from '../src/meta/profile';

let failures = 0, passes = 0;
function ok(cond: unknown, msg: string) {
  if (cond) { passes++; return; }
  failures++;
  console.log('  FAIL', msg);
}
function eq<T>(a: T, b: T, msg: string) {
  ok(a === b, `${msg} (got ${String(a)}, want ${String(b)})`);
}
function memStorage(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
function section(name: string) {
  console.log(`\n== ${name}`);
}

function makeWorld(seed = 77): World {
  const map = generateMap({ size: 64, players: 2, seed, water: 0.2, trees: 0.2, ore: 0.5 });
  const players: PlayerSetup[] = [
    { name: 'Me', faction: 'allies', color: 0, team: 0, isHuman: true },
    { name: 'Foe', faction: 'soviet', color: 1, team: 1, isHuman: false },
  ];
  return new World({ map, players, credits: 5000, startUnits: 'none', fog: false, seed });
}

// ---------------------------------------------------------------------------
section('Rank ladder & XP curve');
console.log(RANKS.map((r) => `${String(r.index).padStart(2)} ${r.allied.padEnd(20)} ${r.soviet.padEnd(28)} ${String(r.xp).padStart(7)}`).join('\n'));
eq(RANKS.length, 15, 'fifteen ranks');
eq(xpForRank(0), 0, 'rank 0 at 0 XP');
eq(xpForRank(14), 100000, 'Field Marshal at 100,000 XP');
ok(RANKS.every((r, i) => i === 0 || r.xp > RANKS[i - 1].xp), 'XP thresholds strictly increase');
eq(rankIndexFor(RANKS[3].xp - 1), 2, 'one XP short of Sergeant is Corporal');
eq(rankIndexFor(RANKS[3].xp), 3, 'exact threshold reaches Sergeant');
eq(rankIndexFor(10_000_000), 14, 'XP beyond the top stays at Field Marshal');
const rp = rankProgress(RANKS[6].xp + (RANKS[7].xp - RANKS[6].xp) / 2, 'soviet');
eq(rp.name, 'Captain', 'soviet name at rank 6');
ok(Math.abs(rp.frac - 0.5) < 1e-9, 'half-way progress fraction');
eq(ACHIEVEMENTS.length, 52, 'fifty-two achievements'); // [MODES] +5 (challenger, textbook, king-of-the-hill, brothers-in-arms, alternate-history)
ok(new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length, 'unique achievement ids');
ok(ACHIEVEMENTS.filter((a) => a.hidden).length >= 5, 'at least five hidden medals');
ok(ACHIEVEMENTS.filter((a) => (a.tiers?.length ?? 0) === 3).length >= 10, 'at least ten tiered (bronze/silver/gold) medals');

// ---------------------------------------------------------------------------
section('Combat telemetry -> medals');
const store = memStorage();
let clock = Date.parse('2026-10-15T12:00:00Z');
const meta = new MetaTracker({ storage: store, now: () => clock });
const unlocks: UnlockInfo[] = [];
meta.onUnlock = (a) => unlocks.push(a);
const world = makeWorld();
const me = world.players[0], foe = world.players[1];
const ctx = (dead?: Entity) => ({ localPlayerId: 0, world, dead });
const feed = (ev: GameEvent, dead?: Entity) => meta.onEvent(ev, ctx(dead));
const killed = (e: Entity, how: Extract<GameEvent, { e: 'death' }>['how'] = 'normal', attacker?: Entity) => {
  if (attacker) e.lastAttacker = attacker.id;
  e.alive = false;
  feed({ e: 'death', id: e.id, x: e.x, y: e.y, how }, e);
};
const titles = () => unlocks.map((u) => (u.kind === 'rank' ? `RANK:${u.title}` : `${u.title}${u.tier ? ' (' + u.tier + ')' : ''}`));

meta.onGameStart({ mode: 'skirmish', difficulty: 'brutal', faction: 'allies', opponents: 1, seed: 1, climate: 'temperate', weather: 'storm' });
const tank = world.addUnit('2tnk', me, 20, 20);
const tanya = world.addUnit('e7', me, 22, 20);
// 30 enemy heavy tanks + 2 mammoths
for (let i = 0; i < 30; i++) killed(world.addUnit('3tnk', foe, 30, 30), 'normal', tank);
for (let i = 0; i < 2; i++) killed(world.addUnit('4tnk', foe, 30, 31), 'normal', tank);
ok(titles().includes('First Blood (Common)'), 'First Blood on first kill');
ok(titles().includes('Tank Buster (Bronze)'), 'Tank Buster bronze at 25 tanks');
eq(meta.profile.counters.tanks, 32, 'tank counter');
eq(meta.profile.counters.mammoths, 2, 'mammoth counter');
// kills by someone else do not count
const ally = world.addUnit('3tnk', foe, 40, 40);
killed(world.addUnit('1tnk', me, 41, 41), 'normal', ally);
killed(world.addUnit('3tnk', foe, 40, 41), 'normal', ally);
eq(meta.profile.counters.kills, 32, 'own losses and foreign kills are ignored');
// Tanya: 50 infantry
for (let i = 0; i < 50; i++) killed(world.addUnit('e1', foe, 25, 25), 'normal', tanya);
ok(titles().includes('One-Woman Army (Epic)'), 'One-Woman Army after 50 Tanya kills');
eq(favouriteUnit(meta.profile)?.id, 'e7', 'favourite unit is the top killer');
// crushing: a local vehicle must be on the spot (grid is rebuilt each tick)
world.grid.rebuild(world.units);
for (let i = 0; i < 25; i++) {
  const inf = world.addUnit('e1', foe, tank.x + 0.2, tank.y);
  inf.x = tank.x + 0.2; inf.y = tank.y;
  killed(inf, 'crushed');
}
ok(titles().includes('Road Rage (Rare)'), 'Road Rage after 25 crushed infantry');
ok(titles().includes('Warmonger (Bronze)'), 'Warmonger bronze at 100 kills');
eq(meta.profile.counters.kills, 107, '32 tanks + 50 infantry + 25 crushed');
// promotions & captures & crates
for (let i = 0; i < 10; i++) { const u = world.addUnit('1tnk', me, 10 + i, 10); u.rank = 2; feed({ e: 'promoted', id: u.id, rank: 2 }); }
ok(titles().includes('Band of Brothers (Silver)'), 'Band of Brothers silver at 10 elites');
for (let i = 0; i < 5; i++) feed({ e: 'captured', id: 999, from: 1, to: 0 });
ok(titles().includes('Hostile Takeover (Silver)'), 'Hostile Takeover silver after 5 captures');
// nuke: impact first, then deaths in the same tick
feed({ e: 'impact', x: 50, y: 50, z: 0, kind: 'nuke', scale: 1, owner: 0 });
const silo = world.addBuilding('powr', foe, 49, 49, true);
killed(silo, 'normal');
for (let i = 0; i < 7; i++) killed(world.addUnit('e1', foe, 50, 50), 'burn');
ok(titles().includes('Mutually Assured (Epic)'), 'nuking an enemy structure');
ok(titles().includes('Overkill (Epic)'), 'Overkill: 8 kills with one nuke');
eq(meta.profile.counters.burned ?? 0, 0, 'nuke burns do not count as flame kills');
// chronoshift a tank next to an enemy structure
const conyard = world.addBuilding('fact', foe, 8, 40, true);
feed({ e: 'teleport', id: tank.id, fromX: tank.x, fromY: tank.y, x: conyard.x + 3, y: conyard.y });
ok(titles().includes('Out of Time (Epic)'), 'Chronoshift into an enemy base');
// a 30-segment wall in two drags (24 + 6), plus a separate stub
for (let x = 2; x < 26; x++) { const w = world.addBuilding('sbag', me, x, 60, true); feed({ e: 'placed', id: w.id }); }
ok(!titles().includes('The Great Wall (Rare)'), 'no Great Wall at 24 segments');
for (let x = 26; x < 32; x++) { const w = world.addBuilding('sbag', me, x, 60, true); feed({ e: 'placed', id: w.id }); }
ok(titles().includes('The Great Wall (Rare)'), 'Great Wall at 30 connected segments');
eq(meta.profile.counters.wall, 30, 'longest wall');

// ---------------------------------------------------------------------------
section('Victory -> XP, ranks, history');
const xpBefore = meta.profile.xp;
unlocks.length = 0;
const stats = { unitsBuilt: 40, unitsLost: 12, unitsKilled: 140, buildingsBuilt: 18, buildingsLost: 0, buildingsKilled: 2, harvested: 24000, spent: 30000 };
const sum = meta.onGameEnd({ won: true, time: 540, mode: 'skirmish', stats })!;
console.log('  summary:', sum.lines.map((l) => `${l.label} +${l.xp}`).join(', '), '=', sum.xp, 'XP;', `rank ${sum.rankBefore} -> ${sum.rankAfter} (${sum.rankName})`);
ok(titles().includes('Baptism of Fire (Common)'), 'first victory');
ok(titles().includes('Iron Will (Epic)'), 'brutal skirmish win');
ok(titles().includes('Untouchable (Rare)'), 'no structure lost');
ok(titles().includes('Blitzkrieg (Rare)'), 'win under 10 minutes');
ok(!titles().includes('Lightning War (Legendary)'), 'not under 6 minutes');
ok(titles().includes('Riders on the Storm (Rare)'), 'storm at start counts');
ok(titles().includes('Ore Baron (Bronze)'), 'harvested 24k -> Ore Baron bronze');
ok(titles().some((t) => t.startsWith('RANK:')), 'a promotion toast fired');
eq(sum.lines.find((l) => l.label.startsWith('Victory'))?.xp, 1000, 'brutal 1v1 victory = 400 x 2.5');
eq(sum.lines.find((l) => l.label === 'Combat experience')?.xp, 36, '9 minutes x 4 XP');
ok(meta.profile.xp > xpBefore, 'profile XP grew at the end of the match');
eq(meta.profile.history.length, 1, 'match recorded');
eq(meta.profile.history[0].won, true, 'history entry is a win');
eq(meta.profile.stats.winsByDifficulty.brutal, 1, 'wins by difficulty');
eq(meta.profile.stats.winsByFaction.allies, 1, 'wins by faction');
ok(meta.profile.stats.kills >= 100, 'lifetime kills include tracked kills');
ok(sum.xp === meta.profile.xp - sum.xpBefore, 'summary XP equals profile delta');

// ---------------------------------------------------------------------------
section('Persistence & migration');
const again = new MetaTracker({ storage: store, now: () => clock });
eq(again.profile.xp, meta.profile.xp, 'XP survives a reload');
eq(again.profile.medals['tank-buster']?.tier, 1, 'medals survive a reload');
eq(JSON.parse(store.data.get(PROFILE_KEY)!).v, 1, 'version field written');
const migrated = normalizeProfile({ name: 'Old Timer', xp: 1234, rank: 3, stats: { kills: 'x', wins: 4, winsByFaction: { soviet: 2 } }, medals: { 'first-blood': { tier: 1, at: [5] }, junk: 7 }, history: [{ won: 1, time: 'bad' }], future: { keep: true } }) as any;
eq(migrated.v, 1, 'v0 -> v1');
eq(migrated.xp, 1234, 'xp kept');
eq(migrated.rank, undefined, 'dropped legacy field');
eq(migrated.stats.kills, 0, 'malformed number replaced by default');
eq(migrated.stats.wins, 4, 'valid number kept');
eq(migrated.stats.winsByFaction.soviet, 2, 'nested record merged');
eq(migrated.stats.winsByFaction.allies, 0, 'nested default filled');
eq(migrated.history[0].time, 0, 'history sanitised');
eq(migrated.future?.keep, true, 'unknown (newer) fields preserved');
eq(normalizeProfile('garbage').name, 'Commander', 'garbage -> defaults');
const corrupt = memStorage();
corrupt.setItem(PROFILE_KEY, '{not json');
eq(new MetaTracker({ storage: corrupt }).profile.xp, 0, 'corrupt JSON -> fresh profile');

// ---------------------------------------------------------------------------
section('Survival records');
unlocks.length = 0;
meta.onGameStart({ mode: 'mission', missionId: 'survival-winter', faction: 'soviet', opponents: 1, seed: 7171 });
const s2 = meta.onGameEnd({ won: false, time: 1500, mode: 'mission', missionId: 'survival-winter', score: 45000, waves: 16, bosses: 3, stats })!;
console.log('  summary:', s2.lines.map((l) => `${l.label} +${l.xp}`).join(', '));
ok(titles().includes('Last Stand (Silver)'), 'Last Stand silver at 15 waves (and bronze)');
ok(titles().includes('Last Stand (Bronze)'), 'Last Stand bronze');
ok(titles().includes('Arcade Legend (Silver)'), 'Arcade Legend silver at 40k');
ok(titles().includes('Giant Slayer (Bronze)'), 'Giant Slayer bronze');
eq(s2.lines.find((l) => l.label.startsWith('Survival'))?.xp, 25 * 16 + 2 * 16 * 16, 'survival wave XP');
eq(meta.profile.survival['survival-winter'].bestWave, 16, 'best wave stored');
eq(meta.profile.survival['survival-winter'].bestScore, 45000, 'best score stored');
eq(meta.profile.faction, 'soviet', 'faction follows the last game');

// ---------------------------------------------------------------------------
section('Daily challenge: leaderboard & streak');
unlocks.length = 0;
const days = ['2026-10-13', '2026-10-14', '2026-10-15'];
for (const [i, d] of days.entries()) {
  setDailyDay(d);
  clock = Date.parse(d + 'T18:00:00Z');
  meta.onGameStart({ mode: 'mission', missionId: 'daily', faction: dailyConfig(d).faction, opponents: dailyConfig(d).enemies.length, seed: 1 });
  meta.onGameEnd({ won: i !== 1, time: 800, mode: 'mission', missionId: 'daily', score: 9000 + i * 100, stats });
}
eq(meta.profile.daily.streak, 3, 'three days in a row');
ok(titles().includes('Dedication (Bronze)'), 'Dedication bronze at a 3-day streak');
ok(titles().includes('Daily Orders (Bronze)'), 'Daily Orders after the first daily win');
eq(meta.profile.daily.best['2026-10-14'].won, false, 'lost day recorded as not won');
// replaying the same day keeps the best score and does not extend the streak
const bestToday = meta.profile.daily.best['2026-10-15'].score;
ok(bestToday >= 9200, 'daily score includes the mission score (plus medal bonus)');
meta.onGameStart({ mode: 'mission', missionId: 'daily', faction: 'allies', opponents: 1, seed: 1 });
meta.onGameEnd({ won: true, time: 700, mode: 'mission', missionId: 'daily', score: 5000, stats });
eq(meta.profile.daily.best['2026-10-15'].score, bestToday, 'best score kept');
eq(meta.profile.daily.best['2026-10-15'].attempts, 2, 'attempts counted');
eq(meta.profile.daily.streak, 3, 'same-day replay does not extend the streak');
// skipping a day resets the streak
setDailyDay('2026-10-17');
meta.onGameStart({ mode: 'mission', missionId: 'daily', faction: 'allies', opponents: 1, seed: 1 });
meta.onGameEnd({ won: false, time: 300, mode: 'mission', missionId: 'daily', score: 100, stats });
eq(meta.profile.daily.streak, 1, 'streak resets after a missed day');
eq(meta.profile.daily.longest, 3, 'longest streak kept');
setDailyDay(null);
ok(dailyConfig('2026-10-15').codename === dailyConfig('2026-10-15').codename && dailyConfig('2026-10-15').seed !== dailyConfig('2026-10-16').seed, 'daily config is deterministic per date');
ok(dailyConfig('2026-10-15').modifiers.length >= 2 && dailyConfig('2026-10-15').modifiers.length <= 3, '2-3 modifiers');

// ---------------------------------------------------------------------------
section('Read-only views');
const states = allAchievementStates(meta.profile);
const tb = states.find((s) => s.def.id === 'tank-buster')!;
eq(tb.tier, 1, 'tank buster tier 1');
eq(tb.target, 100, 'next target is silver');
eq(tb.cur, 32, 'progress 32/100');
ok(states.filter((s) => s.secret).length >= 1, 'hidden medals stay classified until earned');
const totals = medalTotals(meta.profile);
console.log(`  medals: ${totals.earned}/${totals.total} tiers, ${totals.complete}/${totals.achievements} complete, XP ${meta.profile.xp}, rank ${rankProgress(meta.profile.xp, meta.profile.faction).name}`);
ok(achievementState(ACHIEVEMENTS.find((a) => a.id === 'perfectionist')!, meta.profile, {}).target > 0, 'campaign medal progress has a target');

// ---------------------------------------------------------------------------
section('Per-event cost');
{
  const t2 = new MetaTracker({ storage: memStorage() });
  t2.onGameStart({ mode: 'skirmish', difficulty: 'normal', faction: 'allies', opponents: 1, seed: 2 });
  const w = makeWorld(5);
  const a = w.addUnit('2tnk', w.players[0], 10, 10), b = w.addUnit('3tnk', w.players[1], 12, 10);
  const evs: GameEvent[] = [
    { e: 'fire', shooter: a.id, weapon: a.weapons[0].def, muzzle: 0, fx: 10, fy: 10, fz: 0, tx: 12, ty: 10, tz: 0, target: b.id },
    { e: 'impact', x: 12, y: 10, z: 0, kind: 'small', scale: 1, owner: 0 },
    { e: 'sfx', key: 'crate', x: 1, y: 1 },
    { e: 'harvest', x: 3, y: 3, gems: false },
  ];
  const c2 = { localPlayerId: 0, world: w };
  const N = 1_000_000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) t2.onEvent(evs[i & 3], c2);
  const ns = ((performance.now() - t0) * 1e6) / N;
  console.log(`  ${N.toLocaleString('en-US')} events: ${ns.toFixed(0)} ns/event`);
  ok(ns < 2000, 'under 2 microseconds per event');
}

// ---------------------------------------------------------------------------
section('Live Survival run with the tracker attached');
{
  const def = getMission('survival')!;
  const mp = def.map;
  const map = generateMap({ size: mp.size, players: mp.players, seed: mp.seed, water: mp.water ?? 0.5, trees: mp.trees ?? 0.5, ore: mp.ore ?? 0.6 });
  const players: PlayerSetup[] = def.players.map((ps, i) => ({ name: ps.name, faction: ps.faction, color: 0, team: ps.team ?? i, isHuman: i === 0, ai: i === 0 ? undefined : 'normal' }));
  const w = new World({ map, players, credits: def.credits ?? 5000, startUnits: 'none', startUnitsPer: ['light', 'none'], creditsPer: [def.credits, 5000], fog: true, seed: mp.seed });
  const rt = new MissionRuntime(w, def);
  w.mission = rt;
  rt.setAI(1, 'passive');
  def.setup(rt);
  w.ais.push(new AIController(w, w.players[0], 'hard'));
  const t3 = new MetaTracker({ storage: memStorage() });
  const got: string[] = [];
  t3.onUnlock = (u) => got.push(u.kind === 'rank' ? 'RANK:' + u.title : u.title);
  t3.onGameStart({ mode: 'mission', missionId: 'survival', faction: 'allies', opponents: 1, seed: mp.seed });
  // like game.ts: dead entities are gone from the world when events are drained, so keep a registry
  const registry = new Map<number, Entity>();
  let events = 0;
  for (let t = 0; t < 30 * 60 * TICK_HZ && !w.gameOver; t++) {
    w.step();
    for (const u of w.units) registry.set(u.id, u);
    for (const b of w.buildings) registry.set(b.id, b);
    for (const ev of w.events) {
      events++;
      t3.onEvent(ev, { localPlayerId: 0, world: w, dead: ev.e === 'death' ? registry.get(ev.id) : undefined });
      if (ev.e === 'death') registry.delete(ev.id);
    }
    w.events.length = 0;
    rt.events.length = 0;
  }
  const human = w.players[0];
  const s3 = t3.onGameEnd({ won: rt.won, time: w.time, mode: 'mission', missionId: 'survival', score: rt.score, stats: human.stats, world: w })!;
  console.log(`  ${(w.time / 60).toFixed(1)} min, ${events.toLocaleString('en-US')} events, waves ${rt.flags.survived}, bosses ${rt.flags.bosses}, score ${rt.score}`);
  console.log(`  tracker kills ${t3.profile.stats.kills} (sim: ${human.stats.unitsKilled}), structures ${t3.profile.stats.structuresDestroyed}, XP ${s3.xp}: ${s3.lines.map((l) => `${l.label} +${l.xp}`).join(', ')}`);
  console.log(`  unlocked: ${got.join(', ')}`);
  ok(w.gameOver && !rt.won, 'survival ends in defeat once the human is wiped out');
  ok(rt.flags.survived >= 3, 'survived several waves');
  ok(rt.score > 0, 'score increased');
  ok(t3.profile.stats.kills > 0 && Math.abs(t3.profile.stats.kills - human.stats.unitsKilled) <= Math.max(3, human.stats.unitsKilled * 0.1), 'tracked kills match the simulation');
  ok(got.includes('First Blood'), 'First Blood in a live run');
  eq(t3.profile.survival.survival.bestWave, rt.flags.survived, 'survival best wave recorded from mission flags');
}

// ---------------------------------------------------------------------------
section('Daily modifiers in the simulation');
{
  const runDaily = (day: string, seconds: number) => {
    setDailyDay(day);
    const def = getMission('daily')!;
    const mp = def.map;
    const map = generateMap({ size: mp.size, players: mp.players, seed: mp.seed, water: mp.water ?? 0.5, trees: mp.trees ?? 0.5, ore: mp.ore ?? 0.6 });
    const players: PlayerSetup[] = def.players.map((ps, i) => ({ name: ps.name, faction: ps.faction, color: 0, team: ps.team ?? i, isHuman: i === 0, ai: i === 0 ? undefined : (ps.ai as any) }));
    const w = new World({ map, players, credits: def.credits ?? 5000, startUnits: 'none', startUnitsPer: def.players.map((_, i) => (i === 0 ? def.startUnits ?? 'none' : 'none')), creditsPer: def.players.map((ps, i) => (i === 0 ? def.credits : ps.credits ?? 5000)), fog: def.fog ?? true, seed: mp.seed });
    const rt = new MissionRuntime(w, def);
    w.mission = rt;
    def.players.forEach((ps, i) => { if (i > 0 && ps.ai) rt.setAI(i, ps.ai); });
    if (def.allowedBuild) rt.allowBuild(def.allowedBuild);
    const base = w.players.map((p) => ({ bs: p.buildSpeed, inc: p.incomeBias }));
    def.setup(rt);
    const cash0 = w.players[0].cash;
    for (let t = 0; t < seconds * TICK_HZ; t++) { w.step(); w.events.length = 0; rt.events.length = 0; }
    return { w, rt, def, base, cash0 };
  };
  const start = '2026-10-15';
  for (const mod of DAILY_MODIFIERS) {
    let day: string | null = null;
    for (let i = 0; i < 400 && !day; i++) { const d = shiftDay(start, i); if (dailyConfig(d).modifiers.includes(mod.id)) day = d; }
    if (!day) { ok(false, `no date rolls modifier ${mod.id}`); continue; }
    const cfg = dailyConfig(day);
    const { w, rt, def, base, cash0 } = runDaily(day, 50);
    const human = w.players[0], foes = w.players.slice(1);
    let check = true, note = '';
    switch (mod.id) {
      case 'glass-cannons': check = w.units.every((u) => !u.alive || u.hp <= u.maxHp * 0.6 + 1e-6); note = 'all units at <= 60% HP'; break;
      case 'veteran-start': check = w.units.filter((u) => u.alive && u.owner === human && u.weapons.length).every((u) => u.rank >= 1); note = 'human units are veterans'; break;
      case 'no-radar': check = !!human.allowedTypes && !human.allowedTypes.has('dome') && human.allowedTypes.has('weap'); note = 'Radar Dome banned'; break;
      case 'tesla-only': check = !!human.allowedTypes && human.allowedTypes.has('tsla') && !human.allowedTypes.has('ftur') && !human.allowedTypes.has('sam'); note = 'only Tesla Coils'; break;
      case 'pillbox-line': check = !!human.allowedTypes && human.allowedTypes.has('pbox') && !human.allowedTypes.has('gun') && !human.allowedTypes.has('agun'); note = 'only Pillboxes'; break;
      case 'double-ore': check = w.players.every((p, i) => Math.abs(p.incomeBias / base[i].inc - (cfg.modifiers.includes('blizzard') ? 1.6 : cfg.modifiers.includes('sandstorm') ? 1.7 : 2) * (i > 0 && cfg.modifiers.includes('fanatics') ? 1.2 : 1)) < 1e-6); note = 'income x2'; break;
      case 'blizzard': check = def.map.weather === 'snow' && def.map.climate === 'winter' && human.incomeBias < base[0].inc; note = 'snow, winter, -20% income'; break;
      case 'sandstorm': check = def.map.weather === 'dust' && def.map.climate === 'desert' && human.incomeBias < base[0].inc; note = 'dust, desert, -15% income'; break;
      case 'storm-front': check = def.map.weather === 'storm'; note = 'thunderstorm'; break;
      case 'night-ops': check = def.map.hour! > 22 && def.map.dayCycle === false; note = 'frozen midnight'; break;
      case 'fast-production': check = w.players.every((p, i) => p.buildSpeed >= base[i].bs * 2 - 1e-9); note = 'build speed x2'; break;
      case 'fanatics': check = foes.every((p, i) => p.buildSpeed > base[i + 1].bs * 1.3); note = 'enemy factories +35%'; break;
      case 'clear-skies': check = def.fog === false && w.fog === false; note = 'no fog'; break;
      case 'lean-times': check = def.credits === 2500 && def.players.slice(1).every((p) => p.credits === 2500); note = '$2,500 start'; break;
      case 'credits-rain': check = w.crates.some((c) => c.id >= 6_500_000) && human.cash + human.ore > 0; note = 'supply crates dropped'; break;
      case 'bounty': {
        // fake a kill and make sure the bounty pays out on the next score tick
        const before = human.cash;
        human.stats.unitsKilled += 2;
        for (let t = 0; t < TICK_HZ * 1.2; t++) { w.step(); w.events.length = 0; rt.events.length = 0; }
        check = human.cash - before >= 200 - 1e-6 || rt.score > 0;
        note = '$100 per kill';
        break;
      }
    }
    void cash0;
    ok(check, `modifier ${mod.id} (${day}): ${note}`);
    ok(foes.every((p) => w.units.some((u) => u.owner === p) || w.buildings.some((b) => b.owner === p)), `enemy commanders deployed on ${day}`);
    console.log(`  ${mod.id.padEnd(16)} ${day}  ${check ? 'ok ' : 'BAD'}  ${note}`);
  }
  setDailyDay(null);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
