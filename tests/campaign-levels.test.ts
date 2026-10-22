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
