// Campaign difficulty (sim/handicap.ts): Red Alert's handicaps per level, who gets which, the hooks that apply them,
// Normal untouched, saves, the progress record and the challenge import that is already in the list.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/sim/mapgen';
import { World } from '../src/sim/world';
import { MissionRuntime } from '../src/sim/mission';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { worldHash } from '../src/replay/hash';
import { getMission } from '../src/missions';
import { MISSION_LEVELS, RA_HANDICAPS, assignHandicaps, computerHandicap, levelSummary, playerHandicap, type MissionLevel } from '../src/sim/handicap';
import { costOf } from '../src/sim/doctrine';
import { buildSeconds } from '../src/sim/production';
import { unitSpeed } from '../src/sim/unitlogic';
import { fire, impact } from '../src/sim/combat';
import { UNITS } from '../src/data/rules';
import { createMissionWorld, runMission } from '../tools/campaigntest';
import { loadLevel, missionLevelFor, recordResult, saveLevel, takesLevel, loadProgress } from '../src/missions/progress';
import { BUILTIN_LIST } from '../src/modes/builtins';
import { encodeChallengeFile, importChallenge } from '../src/modes/store';
import { headlessGame } from '../src/modes/headless';
import { challengeFromState } from '../src/modes/author';
import { snapshotWorld } from '../src/replay/branch';
import type { GameSetup } from '../src/game';
import type { Building } from '../src/sim/entities';

// a minimal localStorage (progress, the level preference, challenge storage fallback)
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};

function duel(): World {
  const map = generateMap({ size: 48, players: 2, seed: 9, water: 0.2, trees: 0.3, ore: 0.5 });
  return new World({
    map, credits: 5000, startUnits: 'none', fog: false, seed: 9,
    players: [
      { name: 'You', faction: 'allies', color: 0, team: 0, isHuman: true },
      { name: 'Foe', faction: 'soviet', color: 1, team: 1, isHuman: false },
      { name: 'Friend', faction: 'allies', color: 2, team: 0, isHuman: false },
    ],
  });
}

describe('campaign difficulty: Red Alert handicaps', () => {
  test('the five levels follow RA\'s FineDiffControl slider; Normal has no handicap', () => {
    assert.deepEqual([...MISSION_LEVELS], ['recruit', 'easy', 'normal', 'hard', 'brutal'], 'level order');
    assert.equal(playerHandicap('normal'), null, 'Normal: no player handicap');
    assert.equal(computerHandicap('normal'), null, 'Normal: no computer handicap');
    assert.equal(playerHandicap('recruit'), RA_HANDICAPS.easy, 'Recruit = player Easy');
    assert.equal(computerHandicap('recruit'), RA_HANDICAPS.difficult, 'Recruit = computer Difficult');
    assert.equal(playerHandicap('easy'), null, 'Easy: the player plays straight');
    assert.equal(computerHandicap('easy'), RA_HANDICAPS.difficult, 'Easy: computer Difficult');
    assert.equal(playerHandicap('hard'), null, 'Hard: the player plays straight');
    assert.equal(computerHandicap('hard'), RA_HANDICAPS.easy, 'Hard: computer Easy');
    assert.equal(playerHandicap('brutal'), RA_HANDICAPS.difficult, 'Brutal = player Difficult');
    assert.equal(computerHandicap('brutal'), RA_HANDICAPS.easy, 'Brutal = computer Easy');
    // the RULES.INI numbers
    assert.deepEqual({ ...RA_HANDICAPS.easy }, { section: 'easy', firepower: 1.2, rof: 0.8, ground: 1.2, air: 1.2, cost: 0.8 }, '[Easy] (Armor left out)');
    assert.deepEqual({ ...RA_HANDICAPS.difficult }, { section: 'difficult', firepower: 0.8, rof: 1.2, ground: 0.8, air: 0.8, cost: 1 }, '[Difficult] (Armor left out)');
    assert.deepEqual(levelSummary('normal'), [], 'Normal shows no handicap');
    assert.deepEqual(levelSummary('recruit').map((s) => s.side), ['you', 'enemy'], 'Recruit shows both sides');
    assert.equal(levelSummary('hard')[0].firepower, 20, 'Hard: the enemy +20% firepower');
  });

  test('the human\'s team gets the player\'s handicap, its enemies the computer\'s; a team change follows', () => {
    const w = duel();
    const [you, foe, friend] = w.players;
    assignHandicaps(w.players, you, 'recruit');
    assert.equal(you.hc, RA_HANDICAPS.easy, 'human: player handicap');
    assert.equal(friend.hc, RA_HANDICAPS.easy, 'ally: player handicap');
    assert.equal(foe.hc, RA_HANDICAPS.difficult, 'enemy: computer handicap');
    assert.ok(!Object.keys(you).includes('hc'), 'non-enumerable: saves carry no extra player field');
    assignHandicaps(w.players, you, 'normal');
    assert.ok(!you.hc && !foe.hc && !friend.hc, 'Normal clears every handicap');
    const rt = new MissionRuntime(w, { ...getMission('allied-01')!, setup() {}, update() {} });
    w.mission = rt;
    rt.setLevel('hard');
    assert.equal(rt.level, 'hard', 'the runtime keeps the level');
    assert.equal(foe.hc, RA_HANDICAPS.easy, 'Hard: the enemy plays RA Easy');
    rt.setTeam(2, 1); // the friend defects
    assert.equal(friend.hc, RA_HANDICAPS.easy, 'a defector takes the enemy handicap');
    rt.setTeam(2, 0);
    assert.equal(friend.hc, undefined, 'and back: the player side plays straight at Hard');
  });

  test('the hooks: price and build time, speed, reload, damage dealt', () => {
    const w = duel();
    const [you, foe] = w.players;
    const tank = UNITS['2tnk'];
    const price = costOf(you, tank), time = buildSeconds(w, you, '2tnk');
    const mine = w.addUnit('2tnk', you, 10.5, 10.5), theirs = w.addUnit('3tnk', foe, 12.5, 10.5);
    const speed = unitSpeed(mine);
    assignHandicaps(w.players, you, 'recruit');
    assert.equal(costOf(you, tank), Math.round(tank.cost * 0.8), 'Recruit: 20% cheaper');
    assert.ok(Math.abs(buildSeconds(w, you, '2tnk') - time * 0.8) < 1e-9, 'build time follows the price');
    assert.ok(Math.abs(unitSpeed(mine) - speed * 1.2) < 1e-9, '20% faster on the ground');
    assert.equal(costOf(foe, UNITS['3tnk']), UNITS['3tnk'].cost, 'the computer\'s Difficult section keeps prices');
    // reload
    const slot = mine.weapons[0];
    fire(w, mine, slot, theirs, theirs.x, theirs.y);
    const quick = slot.cooldown;
    assignHandicaps(w.players, you, 'normal');
    fire(w, mine, slot, theirs, theirs.x, theirs.y);
    assert.ok(Math.abs(quick - slot.cooldown * 0.8) < 1e-9, 'Recruit reloads in 80% of the time');
    // damage: a direct hit from the human on the enemy, then back
    const hit = (from: typeof mine, to: typeof mine) => { to.hp = to.maxHp; impact(w, from.weapons[0].def, from, to, to.x, to.y, 0); return to.maxHp - to.hp; };
    const plainOut = hit(mine, theirs), plainIn = hit(theirs, mine);
    assignHandicaps(w.players, you, 'recruit');
    assert.ok(Math.abs(hit(mine, theirs) - plainOut * 1.2) < 1e-6, 'Recruit: +20% firepower');
    assert.ok(Math.abs(hit(theirs, mine) - plainIn * 0.8) < 1e-6, 'Recruit: the enemy hits 20% softer (armour itself is untouched)');
  });

  test('Normal plays bit for bit as before, and a level survives a save', () => {
    const def = getMission('allied-01')!;
    const steps = (w: World, n: number) => { for (let t = 0; t < n; t++) { w.step(); w.events.length = 0; if (w.mission) w.mission.events.length = 0; } };
    const a = createMissionWorld(def), b = createMissionWorld(def, { level: 'normal' });
    steps(a.world, 1200); steps(b.world, 1200);
    assert.equal(worldHash(a.world), worldHash(b.world), 'Normal = no level at all');
    assert.ok(!('__level' in b.rt.flags), 'Normal stores nothing');
    for (const level of ['recruit', 'brutal'] as MissionLevel[]) {
      const c = createMissionWorld(def, { level });
      steps(c.world, 600);
      const saved = JSON.parse(JSON.stringify(serializeWorld(c.world)));
      steps(c.world, 600);
      const d = createMissionWorld(def);
      deserializeWorld(d.world, saved, d.rt);
      assert.equal(d.rt.level, level, `${level}: the save carries the level`);
      assert.ok(d.world.players[0].hc || d.world.players[1].hc, `${level}: handicaps restored after loading`);
      steps(d.world, 600);
      assert.equal(worldHash(d.world), worldHash(c.world), `${level}: a loaded game continues identically`);
    }
    const n = createMissionWorld(def);
    steps(n.world, 1200);
    assert.notEqual(worldHash(createMissionWorld(def, { level: 'hard' }).world), worldHash(n.world), 'sanity: a level changes the game');
  });

  test('which missions take a level, the remembered pick, and the hardest level won', () => {
    for (const id of ['allied-01', 'soviet-07', 'wolfpack', 'ironcoast']) assert.ok(takesLevel(getMission(id)!), `${id} takes the campaign level`);
    for (const id of ['bootcamp', 'survival', 'daily', 'survival:coop:hard']) assert.ok(!takesLevel(getMission(id)!), `${id} keeps its own difficulty`);
    mem.clear();
    assert.equal(loadLevel(), 'easy', 'a new commander starts on Easy');
    recordResult('soviet-01', { won: true, stars: 1, time: 300 });
    assert.equal(loadLevel(), 'normal', 'one who has won missions before (at Normal) starts on Normal');
    mem.clear();
    saveLevel('easy');
    assert.equal(loadLevel(), 'easy', 'remembered');
    assert.equal(missionLevelFor(getMission('allied-02')!), 'easy', 'a campaign mission starts at the pick');
    assert.equal(missionLevelFor(getMission('survival')!), 'normal', 'survival stays at Normal (its leaderboard)');
    recordResult('allied-01', { won: true, stars: 2, time: 600, level: 'easy' });
    recordResult('allied-01', { won: true, stars: 1, time: 700, level: 'recruit' });
    assert.equal(loadProgress()['allied-01'].level, 'easy', 'the hardest level won is kept');
    assert.equal(loadProgress()['allied-01'].stars, 2, 'stars do not depend on the level');
    recordResult('allied-01', { won: false, stars: 0, time: 100, level: 'brutal' });
    assert.equal(loadProgress()['allied-01'].level, 'easy', 'a loss records no level');
    recordResult('allied-01', { won: true, stars: 3, time: 500, level: 'hard' });
    assert.equal(loadProgress()['allied-01'].level, 'hard', 'a harder win replaces it');
  });

  test('a new player who never touches the picker keeps the level they won at', () => {
    mem.clear();
    recordResult('allied-01', { won: true, stars: 2, time: 600, level: 'easy' });
    assert.equal(loadLevel(), 'easy', 'won Grey Dawn at Easy: the next mission starts at Easy, not Normal');
    assert.equal(missionLevelFor(getMission('allied-02')!), 'easy', 'the next campaign mission plays at Easy');
    recordResult('survival', { won: true, stars: 1, time: 900, score: 5000, level: 'normal' });
    assert.equal(loadLevel(), 'easy', 'a survival win (no campaign level) does not move it');
    recordResult('allied-02', { won: false, stars: 0, time: 300, level: 'recruit' });
    assert.equal(loadLevel(), 'easy', 'a loss does not move it');
    recordResult('allied-02', { won: true, stars: 1, time: 700, level: 'recruit' });
    assert.equal(loadLevel(), 'recruit', 'the last win counts, even an easier one');
    saveLevel('hard');
    recordResult('allied-03', { won: true, stars: 1, time: 400, level: 'normal' });
    assert.equal(loadLevel(), 'hard', 'an explicit pick wins over the last win');
    mem.clear();
    recordResult('allied-01', { won: true, stars: 2, time: 600, level: 'easy' });
    recordResult('soviet-01', { won: true, stars: 1, time: 300 });
    assert.equal(loadLevel(), 'normal', 'a win from before the levels existed (no level) still means Normal');
  });

  test('a five-wave Survival run (recorded without a level) leaves a new player on Easy', () => {
    mem.clear();
    // (game.ts records the run as lost at its level, then the meta layer completes the operation without one)
    recordResult('survival', { won: false, stars: 0, time: 900, score: 1234, level: 'normal' });
    recordResult('survival', { won: true, stars: 1, time: 900, score: 1234 });
    assert.ok(loadProgress().survival?.completed && !loadProgress().survival.level, 'the record carries no level');
    assert.equal(loadLevel(), 'easy', 'Survival says nothing about the campaign level');
    recordResult('allied-01', { won: true, stars: 1, time: 600 });
    assert.equal(loadLevel(), 'normal', 'a campaign win without a level still means Normal');
  });
});

describe('the newcomer and Allied mission 1', () => {
  test('a newcomer-like pilot (attack-move at the objective, no micro) wins Grey Dawn on Recruit and Easy', () => {
    for (const level of ['recruit', 'easy'] as MissionLevel[]) {
      const r = runMission(getMission('allied-01')!, 25, 'newcomer', false, { level });
      assert.ok(r.won, `${level}: won (${r.reason ?? 'no end'} at ${Math.round(r.time)} s, ${r.objectives.join(' ')})`);
    }
  });
});

describe('challenge from a moment', () => {
  test('a challenger taking a surrendered seat starts fresh (no resigned flag); the other seats keep theirs', () => {
    const g = headlessGame({ faction: 'allies', color: 0, opponents: [{ faction: 'soviet', difficulty: 'normal' }], mapSize: 48, water: 0.2, trees: 0.3, ore: 0.5, credits: 5000, startUnits: 'mcv', fog: true, timeOfDay: 'day', quality: 'low', seed: 5 } as GameSetup);
    g.world.players[1].resigned = true;
    g.world.players[0].resigned = true;
    const state = snapshotWorld(g.world) as { players: Record<string, unknown>[] };
    assert.equal(state.players[1].resigned, true, 'the snapshot carries the surrender');
    const c = challengeFromState({ setup: g.setup, state, side: 1, goal: { kind: 'survive' }, timeLimit: 60, title: 'Seat' });
    const st = c.state as { players: Record<string, unknown>[] };
    assert.ok(!st.players[1].resigned, 'the challenger\'s seat is no longer surrendered');
    assert.equal(st.players[0].resigned, true, 'another seat that surrendered stays so');
  });
});

describe('challenge import', () => {
  test('a built-in challenge is already in the list: no copy, the list is told so', async () => {
    const b = BUILTIN_LIST[0];
    const file = new File([await encodeChallengeFile(b, false)], 'x.rhchallenge.json');
    const r = await importChallenge(file);
    assert.equal(r.already, 'builtin', 'reported as already there');
    assert.equal(r.challenge.id, b.id, 'the built-in itself (its card is shown)');
  });
});

describe('missions without a base end when the forces that can finish them are gone (RA)', () => {
  test('First Snow: with every heavy tank and the V2 lost while a gun stands, the strike has failed', () => {
    const { world, rt } = createMissionWorld(getMission('soviet-01')!);
    for (const u of world.units.filter((u) => u.alive && u.owner.id === 0 && (u.ut.id === '3tnk' || u.ut.id === 'v2rl'))) world.kill(u, 'sold');
    assert.ok(world.units.some((u) => u.alive && u.owner.id === 0), 'the infantry company is still there');
    for (let t = 0; t < 40 && !rt.ended; t++) world.step();
    assert.ok(rt.ended && !rt.won, `lost at once (ended ${rt.ended}, won ${rt.won})`);
    assert.match(rt.endReason ?? '', /Riflemen alone/, `the reason names it (${rt.endReason})`);
  });
  test('First Snow: a tank left keeps the mission open', () => {
    const { world, rt } = createMissionWorld(getMission('soviet-01')!);
    const tanks = world.units.filter((u) => u.alive && u.owner.id === 0 && u.ut.id === '3tnk');
    for (const u of [...tanks.slice(1), ...world.units.filter((u) => u.alive && u.owner.id === 0 && u.ut.id === 'v2rl')]) world.kill(u, 'sold');
    for (let t = 0; t < 40; t++) world.step();
    assert.ok(!rt.ended, 'one heavy tank can still take the hill: no defeat');
  });
  test('structure breakers: dogs and medics cannot take a camp; riflemen and engineers can', async () => {
    const { structureBreakers } = await import('../src/missions/common');
    const { world, rt } = createMissionWorld(getMission('soviet-03')!);
    for (const u of world.units.filter((u) => u.alive && u.owner.id === 0 && !u.ut.dog)) world.kill(u, 'sold');
    world.step();
    assert.ok(world.units.some((u) => u.alive && u.owner.id === 0 && u.ut.dog), 'dogs left');
    assert.equal(structureBreakers(rt, 0).length, 0, 'dogs cannot damage a structure');
    rt.spawnUnit(0, 'e1', rt.start(0).x, rt.start(0).y);
    assert.equal(structureBreakers(rt, 0).length, 1, 'a rifleman can');
    rt.spawnUnit(0, 'e6', rt.start(0).x, rt.start(0).y);
    assert.equal(structureBreakers(rt, 0).length, 2, 'an engineer can (entering wrecks a third of a structure, then captures it)');
  });
  test('Thunderhead: a raid down to an engineer after the hold is not lost', async () => {
    const { captureBuilding } = await import('../src/sim/unitlogic');
    const { world, rt } = createMissionWorld(getMission('soviet-03')!);
    // (the station taken and held: the camp is what is left)
    const eng = world.units.find((u) => u.alive && u.owner.id === 0 && u.ut.engineer)!;
    captureBuilding(world, world.getEntity(rt.flags.station) as Building, eng);
    for (let t = 0; t < 40; t++) world.step();
    assert.equal(rt.state('capture'), 'done', 'the station is ours');
    rt.complete('hold');
    for (const u of world.units.filter((u) => u.alive && u.owner.id === 0)) world.kill(u, 'sold');
    rt.spawnUnit(0, 'e6', rt.start(0).x, rt.start(0).y);
    for (let t = 0; t < 40; t++) world.step();
    assert.ok(!rt.ended, `an engineer can still capture the camp: no defeat (${rt.endReason})`);
    for (const u of world.units.filter((u) => u.alive && u.owner.id === 0)) world.kill(u, 'sold');
    for (let t = 0; t < 40; t++) world.step();
    assert.ok(rt.ended && !rt.won, `with nobody left it is lost (ended ${rt.ended}, won ${rt.won})`);
  });
});

describe('Boot Camp: the first drills point at something the player can see', () => {
  test('the beacon starts uncovered and framed with the squad; the scouts are uncovered when their drill starts', () => {
    const { world, rt } = createMissionWorld(getMission('bootcamp')!);
    const me = world.players[0], m = world.map;
    const seen = (x: number, y: number) => !!me.explored[m.idx(Math.floor(x), Math.floor(y))];
    assert.ok(seen(rt.flags.bx, rt.flags.by), 'the beacon cell is explored at the start');
    // (the framing comes after the opening fly-over: with the first radio lines, at one second)
    const cams: { x: number; y: number }[] = [];
    for (let t = 0; t < 30; t++) { world.step(); for (const e of rt.events) if (e.e === 'camera') cams.push(e as { x: number; y: number }); rt.events.length = 0; }
    assert.ok(cams.length > 0, 'the first drill frames the camera');
    const s = rt.start(0), c = cams[cams.length - 1];
    const k = 0.6;
    assert.ok(Math.abs(c.x - (s.x + (rt.flags.bx - s.x) * k)) < 0.01 && Math.abs(c.y - (s.y + (rt.flags.by - s.y) * k)) < 0.01, `between the squad and the beacon, towards the beacon (${c.x},${c.y})`);
    const scouts = rt.livingUnits(rt.flags.scouts);
    assert.ok(scouts.some((u) => !seen(u.x, u.y)), 'the scouts start in the dark');
    for (const u of world.units.filter((u) => u.alive && u.owner.id === 0)) { u.x = rt.flags.bx; u.y = rt.flags.by; }
    for (let t = 0; t < 40; t++) world.step();
    assert.equal(rt.flags.step, 'fight', 'the squad at the beacon starts the fight drill');
    for (const u of rt.livingUnits(rt.flags.scouts)) assert.ok(seen(u.x, u.y), `scout at ${u.x.toFixed(1)},${u.y.toFixed(1)} uncovered`);
  });
});

describe('round 5 level tuning (each measured: tools/campaign-levels.ts)', () => {
  test('First Snow: the radar transmits after four minutes at Brutal, five and a half below', () => {
    const uplink = (level: MissionLevel) => createMissionWorld(getMission('soviet-01')!, { level }).rt.timeLeft('uplink');
    assert.deepEqual([uplink('easy'), uplink('normal'), uplink('hard'), uplink('brutal')], [330, 330, 330, 240], 'uplink by level');
  });
  test('Dry Season: a Tesla Coil guards the mining camp at Hard and Brutal only', () => {
    const coils = (level: MissionLevel) => {
      const { world, rt } = createMissionWorld(getMission('allied-05')!, { level });
      const [cx, cy] = rt.flags.camp as [number, number];
      return world.buildings.filter((b) => b.alive && b.owner.id === 1 && b.bt.id === 'tsla' && Math.hypot(b.x - cx, b.y - cy) < 10).length;
    };
    assert.deepEqual([coils('easy'), coils('normal'), coils('hard'), coils('brutal')], [0, 0, 1, 1], 'camp coils by level');
  });
  test('Wolfpack at Brutal: five boats, convoys at a touch over their own pace (no speed cliff)', () => {
    const { world, rt } = createMissionWorld(getMission('wolfpack')!, { level: 'brutal' });
    for (let t = 0; t < 20 * 120; t++) world.step(); // (the first group sails at 1:15)
    const lst = world.units.filter((u) => u.alive && u.owner.id === 1 && u.ut.id === 'lst' && u.order.type === 'move');
    assert.ok(lst.length > 0, 'a convoy group is under way');
    for (const u of lst) assert.ok(Math.abs(u.speedCap - 1.15 * 1.015) < 1e-9, `convoy pace 1.15 x 1.015 (${u.speedCap})`);
    void rt;
  });
});

describe('round 4 level tuning (each measured: tools/campaign-levels.ts)', () => {
  const aiLevel = (w: World, id: number) => (w.ais.find((a) => a.player.id === id) as unknown as { difficulty: string } | undefined)?.difficulty;
  test('skirmish-AI enemies play a level lower at Hard and Brutal; the timers and boats follow the level', () => {
    for (const [mission, p] of [['soviet-04', 1], ['soviet-05', 1], ['allied-07', 1]] as const) {
      assert.equal(aiLevel(createMissionWorld(getMission(mission)!, { level: 'normal' }).world, p), 'easy', `${mission}: Easy commander at Normal`);
      for (const level of ['hard', 'brutal'] as MissionLevel[]) assert.equal(aiLevel(createMissionWorld(getMission(mission)!, { level }).world, p), 'recruit', `${mission}: Recruit commander at ${level}`);
    }
    const subs = (level: MissionLevel) => createMissionWorld(getMission('wolfpack')!, { level }).world.units.filter((u) => u.owner.id === 0 && u.ut.id === 'ss').length;
    assert.deepEqual([subs('normal'), subs('hard'), subs('brutal')], [4, 5, 5], 'Wolfpack: 4 / 5 / 5 submarines (round 5: Brutal with five, its convoys near their own pace)');
    const clock = (level: MissionLevel) => createMissionWorld(getMission('allied-05')!, { level }).rt.timeLeft('reserve');
    assert.deepEqual([clock('normal'), clock('hard'), clock('brutal')], [900, 780, 600], 'Dry Season: the reserve at 15, 13 and 10 minutes');
    const tanks = (level: MissionLevel) => createMissionWorld(getMission('allied-04')!, { level }).world.units.filter((u) => u.owner.id === 0 && u.ut.id === '2tnk').length;
    assert.deepEqual([tanks('easy'), tanks('normal'), tanks('hard')], [4, 4, 3], 'Looking Glass: a fourth Medium Tank up to Normal');
  });
});
