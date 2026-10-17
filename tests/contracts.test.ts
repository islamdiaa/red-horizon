// Contracts, Commendations and cosmetic unlocks (src/meta/contracts.ts, src/meta/unlocks.ts, MetaTracker):
// deterministic rotation by date, progress from synthetic game events, rewards paid exactly once, rerolls,
// migration of old profiles and robustness against corrupted / imported profile data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import type { Entity } from '../src/sim/entities';
import type { GameEvent } from '../src/sim/types';
import { TICK_HZ } from '../src/sim/types';
import {
  CONTRACTS, CONTRACT_BY_ID, DAILY_COUNT, WEEKLY_COUNT, applyContractEvent, canReroll, contractDesc, contractReward, contractsFor, defaultContracts,
  normalizeContracts, refreshContracts, rerollContract, weekKey, type ContractSlot, type ContractsState,
} from '../src/meta/contracts';
import {
  COSMETICS, COSMETIC_BY_ID, DEFAULT_COSMETIC, claimCosmetic, equipCosmetic, equippedId, isUnlocked, markSeen, nextUnlock, unannouncedUnlocks, unlockStatus, unseenUnlocks, type UnlockCtx,
} from '../src/meta/unlocks';
import { PROFILE_KEY, PROFILE_VERSION, loadProfile, normalizeProfile, saveProfile, defaultProfile, type KV, type Profile } from '../src/meta/profile';
import { MetaTracker, RANKS, type UnlockInfo } from '../src/meta';
import { BattleReport } from '../src/meta/report';

function memStorage(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const at = (day: string, h = 12) => Date.parse(`${day}T${String(h).padStart(2, '0')}:00:00Z`);
const ids = (s: ContractSlot[]) => s.map((x) => x.id).join(',');

function makeWorld(seed = 77): World {
  const map = generateMap({ size: 64, players: 2, seed, water: 0.2, trees: 0.2, ore: 0.5 });
  const players: PlayerSetup[] = [
    { name: 'Me', faction: 'allies', color: 0, team: 0, isHuman: true },
    { name: 'Foe', faction: 'soviet', color: 1, team: 1, isHuman: false },
  ];
  return new World({ map, players, credits: 5000, startUnits: 'none', fog: false, seed });
}
const stats = (over: Partial<Record<string, number>> = {}) => ({
  unitsBuilt: 0, unitsLost: 0, unitsKilled: 0, buildingsBuilt: 0, buildingsLost: 0, buildingsKilled: 0, harvested: 0, spent: 0, ...over,
});

// =============================================================================================
describe('contract catalogue', () => {
  test('ids are unique, every contract is offered somewhere and has valid targets', () => {
    assert.equal(new Set(CONTRACTS.map((c) => c.id)).size, CONTRACTS.length, 'unique ids');
    assert.ok(CONTRACTS.length >= 30, `a varied catalogue (${CONTRACTS.length})`);
    for (const c of CONTRACTS) {
      assert.ok((c.daily?.length ?? 0) + (c.weekly?.length ?? 0) > 0, `${c.id} offered`);
      for (const n of [...(c.daily ?? []), ...(c.weekly ?? [])]) assert.ok(Number.isInteger(n) && n >= 1, `${c.id} target ${n}`);
      assert.ok(!contractDesc({ id: c.id, n: 2, p: 0, done: false }).includes('{n}'), `${c.id} description filled in`);
    }
  });
  test('the requested goal types all exist', () => {
    const metrics = new Set(CONTRACTS.map((c) => c.metric));
    for (const m of ['win.allies', 'win.soviet', 'win.temperate', 'win.winter', 'win.desert', 'tanks', 'army', 'win.fast', 'win.hard', 'captures', 'superweapon', 'win.elite', 'ceasefire', 'stars3', 'rival', 'conquest']) {
      assert.ok(metrics.has(m), `metric ${m}`);
    }
  });
  test('weekly orders pay more than daily ones', () => {
    for (const c of CONTRACTS) {
      const d = contractReward(c.id, 'daily'), w = contractReward(c.id, 'weekly');
      assert.ok(d.xp > 0 && d.cmd > 0 && w.xp > d.xp && w.cmd > d.cmd, `${c.id} rewards`);
    }
  });
});

// =============================================================================================
describe('deterministic rotation by date', () => {
  test('the same day always gives the same orders, one per group', () => {
    for (const day of ['2026-10-17', '2026-01-01', '2027-03-09']) {
      const a = contractsFor('daily', day), b = contractsFor('daily', day);
      assert.deepEqual(a, b, `stable for ${day}`);
      assert.equal(a.length, DAILY_COUNT, 'three dailies');
      assert.deepEqual(a.map((s) => CONTRACT_BY_ID[s.id].group), ['combat', 'victory', 'ops'], 'one per group');
      for (const s of a) assert.ok(CONTRACT_BY_ID[s.id].daily!.includes(s.n), `${s.id} target ${s.n} is a daily target`);
      const w = contractsFor('weekly', weekKey(day));
      assert.equal(w.length, WEEKLY_COUNT, 'three weeklies');
      for (const s of w) assert.ok(CONTRACT_BY_ID[s.id].weekly!.includes(s.n), `${s.id} target ${s.n} is a weekly target`);
    }
  });
  test('orders rotate: different days differ, and over a month most contracts come up', () => {
    const seen = new Set<string>();
    let changes = 0;
    let prev = '';
    for (let i = 0; i < 30; i++) {
      const day = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
      const s = ids(contractsFor('daily', day));
      if (s !== prev) changes++;
      prev = s;
      for (const x of contractsFor('daily', day)) seen.add(x.id);
    }
    assert.ok(changes >= 25, `daily sets change from day to day (${changes}/30)`);
    assert.ok(seen.size >= 15, `variety over a month (${seen.size} different contracts)`);
  });
  test('week keys are Mondays', () => {
    assert.equal(weekKey('2026-10-17'), '2026-10-12', 'Saturday -> Monday');
    assert.equal(weekKey('2026-10-12'), '2026-10-12', 'Monday itself');
    assert.equal(weekKey('2026-10-18'), '2026-10-12', 'Sunday belongs to the week before');
    assert.equal(weekKey('2026-10-19'), '2026-10-19', 'next Monday');
  });
  test('refresh: a new day brings new dailies, weeklies persist until Monday', () => {
    const st = defaultContracts();
    assert.ok(refreshContracts(st, at('2026-10-14')), 'first refresh fills the sets');
    assert.ok(!refreshContracts(st, at('2026-10-14', 22)), 'same day: nothing changes');
    st.weekly[0].p = 1;
    const weekly = ids(st.weekly);
    assert.ok(refreshContracts(st, at('2026-10-15')), 'next day refreshes');
    assert.equal(st.day, '2026-10-15');
    assert.deepEqual(st.daily, contractsFor('daily', '2026-10-15'), 'dailies of the new day');
    assert.equal(ids(st.weekly), weekly, 'weeklies kept within the week');
    assert.equal(st.weekly[0].p, 1, 'weekly progress kept');
    refreshContracts(st, at('2026-10-19'));
    assert.equal(st.week, '2026-10-19', 'new week on Monday');
    assert.deepEqual(st.weekly, contractsFor('weekly', '2026-10-19'), 'fresh weeklies');
  });
});

// =============================================================================================
describe('progress and rewards', () => {
  test('applyContractEvent: sum, max, set, mode filters, and completion reported exactly once', () => {
    const st: ContractsState = { ...defaultContracts(), day: '2026-10-17', week: '2026-10-12',
      daily: [{ id: 'tank-hunter', n: 10, p: 0, done: false }, { id: 'hard-target', n: 1, p: 0, done: false }, { id: 'iron-fist', n: 20000, p: 0, done: false }],
      weekly: [{ id: 'world-tour', n: 3, p: 0, done: false }, { id: 'body-count', n: 350, p: 0, done: false }, { id: 'ore-rush', n: 80000, p: 0, done: false }] };
    const now = at('2026-10-17');
    for (let i = 0; i < 9; i++) assert.equal(applyContractEvent(st, { metric: 'tanks', mode: 'skirmish' }, now).length, 0, 'not yet');
    const done = applyContractEvent(st, { metric: 'tanks', mode: 'campaign' }, now);
    assert.deepEqual(done.map((s) => s.id), ['tank-hunter'], 'tenth tank completes it (any mode)');
    assert.equal(applyContractEvent(st, { metric: 'tanks', mode: 'skirmish' }, now).length, 0, 'completed contracts never report again');
    assert.equal(st.daily[0].p, 10, 'progress clamped to the target');
    // mode filter: Hard Target counts in skirmishes only
    assert.equal(applyContractEvent(st, { metric: 'win.hard', mode: 'campaign' }, now).length, 0, 'not in a campaign mission');
    assert.equal(applyContractEvent(st, { metric: 'win.hard', mode: 'skirmish' }, now).length, 1, 'in a skirmish');
    // max: the best army so far, not the sum
    applyContractEvent(st, { metric: 'army', amount: 12000, mode: 'skirmish' }, now);
    applyContractEvent(st, { metric: 'army', amount: 9000, mode: 'skirmish' }, now);
    assert.equal(st.daily[2].p, 12000, 'max keeps the best value');
    assert.equal(applyContractEvent(st, { metric: 'army', amount: 21000, mode: 'skirmish' }, now).length, 1, '$21k army completes Iron Fist');
    // set: distinct climates
    applyContractEvent(st, { metric: 'win.climate', key: 'winter', mode: 'skirmish' }, now);
    applyContractEvent(st, { metric: 'win.climate', key: 'winter', mode: 'daily' }, now);
    assert.equal(st.weekly[0].p, 1, 'the same climate twice counts once');
    applyContractEvent(st, { metric: 'win.climate', key: 'desert', mode: 'skirmish' }, now);
    assert.equal(applyContractEvent(st, { metric: 'win.climate', key: 'temperate', mode: 'conquest' }, now).length, 1, 'third climate completes World Tour');
    // garbage amounts are ignored
    applyContractEvent(st, { metric: 'kills', amount: NaN, mode: 'skirmish' }, now);
    applyContractEvent(st, { metric: 'kills', amount: -5, mode: 'skirmish' }, now);
    assert.equal(st.weekly[1].p, 0, 'NaN / negative amounts ignored');
  });

  test('MetaTracker: synthetic battle events drive contracts, mid-match toasts, XP and Commendations, paid once', () => {
    const store = memStorage();
    let clock = at('2026-10-17');
    // known contracts for today, stored before the battle (the same day keeps them)
    const stored = defaultProfile(clock);
    stored.contracts = { ...defaultContracts(), day: '2026-10-17', week: '2026-10-12',
      daily: [{ id: 'tank-hunter', n: 10, p: 0, done: false }, { id: 'hard-target', n: 1, p: 0, done: false }, { id: 'doomsday-clock', n: 1, p: 0, done: false }],
      weekly: [{ id: 'settle-the-score', n: 3, p: 0, done: false }, { id: 'hostile-takeover', n: 6, p: 0, done: false }, { id: 'iron-fist', n: 30000, p: 0, done: false }] };
    saveProfile(stored, store);
    const meta = new MetaTracker({ storage: store, now: () => clock });
    const toasts: UnlockInfo[] = [];
    meta.onUnlock = (a) => toasts.push(a);
    const world = makeWorld();
    const me = world.players[0], foe = world.players[1];
    meta.onGameStart({ mode: 'skirmish', difficulty: 'hard', faction: 'allies', opponents: 1, seed: 1, climate: 'winter', rivals: 1 });
    const c = meta.profile.contracts;
    assert.equal(c.day, '2026-10-17', 'today\'s orders in place at battle start');
    assert.equal(c.daily[0].id, 'tank-hunter', 'stored orders kept');
    const ctx = (dead?: Entity) => ({ localPlayerId: 0, world, dead });
    const feed = (ev: GameEvent, dead?: Entity) => meta.onEvent(ev, ctx(dead));
    const tank = world.addUnit('2tnk', me, 20, 20);
    const xp0 = meta.profile.xp, cmd0 = meta.profile.commendations;
    for (let i = 0; i < 10; i++) {
      const v = world.addUnit('3tnk', foe, 30, 30);
      v.lastAttacker = tank.id;
      v.alive = false;
      feed({ e: 'death', id: v.id, x: v.x, y: v.y, how: 'normal' }, v);
    }
    const hunter = c.daily[0];
    assert.ok(hunter.done, 'Tank Hunter complete after ten kills');
    const toast = toasts.find((t) => t.kind === 'contract');
    assert.ok(toast && toast.title === 'Tank Hunter', 'a "Contract complete" toast mid-match');
    const r = contractReward('tank-hunter', 'daily');
    assert.equal(meta.profile.commendations - cmd0, r.cmd, 'Commendations paid');
    assert.ok(meta.profile.xp - xp0 >= r.xp, 'contract XP paid');
    // more kills: no second payment
    const cmd1 = meta.profile.commendations;
    for (let i = 0; i < 5; i++) {
      const v = world.addUnit('3tnk', foe, 30, 30);
      v.lastAttacker = tank.id;
      v.alive = false;
      feed({ e: 'death', id: v.id, x: v.x, y: v.y, how: 'normal' }, v);
    }
    assert.equal(meta.profile.commendations, cmd1, 'no second payment');
    assert.equal(toasts.filter((t) => t.kind === 'contract' && t.title === 'Tank Hunter').length, 1, 'one toast');
    // a captured building, a launched nuke, an army sample
    feed({ e: 'captured', id: 999, from: 1, to: 0 });
    assert.equal(c.weekly[1].p, 1, 'capture counts');
    feed({ e: 'announce', player: 1, key: 'nuke_launched' });
    assert.ok(!c.daily[2].done, "the enemy's nuke does not count");
    feed({ e: 'announce', player: 0, key: 'nuke_launched' });
    assert.ok(c.daily[2].done, 'our atomic strike completes Doomsday Clock');
    meta.onSample({ world, local: 0, army: 31000 });
    assert.ok(c.weekly[2].done, 'a $31k army sample completes Iron Fist');
    // victory on Hard against a rival
    const summary = meta.onGameEnd({ won: true, time: 700, mode: 'skirmish', stats: stats({ unitsKilled: 15 }) as never, world });
    assert.ok(summary, 'summary');
    assert.ok(c.daily[1].done, 'Hard Target done by the win');
    assert.equal(c.weekly[0].p, 1, 'rival beaten');
    const list = summary!.contracts!;
    assert.ok(list.length === 6, 'all six contracts in the summary');
    assert.ok(list.slice(0, 5).every((x) => x.justDone || x.after > x.before), 'contracts that moved come first');
    const hunterRow = list.find((x) => x.id === 'tank-hunter')!;
    assert.ok(hunterRow.justDone && hunterRow.before === 0 && hunterRow.after === 10, 'before / after for the results screen');
    assert.equal(summary!.commendations, meta.profile.commendations - cmd0, 'Commendations earned this battle');
    // persisted: reload and replay the end: nothing is paid twice
    const saved = loadProfile(store);
    assert.equal(saved.commendations, meta.profile.commendations, 'Commendations saved');
    assert.ok(saved.contracts.daily[0].done, 'completion saved');
    const again = new MetaTracker({ storage: store, now: () => clock });
    const bal = again.profile.commendations;
    again.onGameStart({ mode: 'skirmish', difficulty: 'hard', faction: 'allies', opponents: 1, seed: 2 });
    again.onGameEnd({ won: true, time: 700, mode: 'skirmish', stats: stats() as never, world });
    assert.equal(again.profile.contracts.daily.filter((s) => s.done).length, 3, 'still done');
    assert.equal(again.profile.commendations - bal, 0, 'a second win pays nothing for completed contracts (rival weekly not done yet)');
    clock = at('2026-10-18');
  });

  test('mode-specific progress: campaign stars, Conquest, the daily challenge, scenario challenges, build-up ceasefire', () => {
    const store = memStorage();
    const clock = at('2026-10-17');
    const meta = new MetaTracker({ storage: store, now: () => clock });
    const world = makeWorld(3);
    const pin = (daily: ContractSlot[], weekly: ContractSlot[] = []) => {
      meta.profile.contracts.daily = daily;
      meta.profile.contracts.weekly = weekly.length ? weekly : [{ id: 'body-count', n: 350, p: 0, done: false }, { id: 'ore-rush', n: 80000, p: 0, done: false }, { id: 'production-line', n: 200, p: 0, done: false }];
    };
    // campaign mission, three stars
    meta.onGameStart({ mode: 'mission', missionId: 'allied-01', faction: 'allies', opponents: 1, seed: 1 });
    pin([{ id: 'textbook-operation', n: 1, p: 0, done: false }, { id: 'theatre-command', n: 1, p: 0, done: false }, { id: 'hold-the-line', n: 1, p: 0, done: false }]);
    meta.onGameEnd({ won: true, time: 600, mode: 'mission', missionId: 'allied-01', stars: 3, stats: stats({ harvested: 9000, unitsBuilt: 12 }) as never, world });
    assert.ok(meta.profile.contracts.daily[0].done, '3-star campaign mission counts');
    assert.ok(!meta.profile.contracts.daily[1].done, 'a campaign mission is no Conquest battle');
    assert.equal(meta.profile.contracts.weekly[1].p, 9000, 'ore harvested counts');
    assert.equal(meta.profile.contracts.weekly[2].p, 12, 'units built count');
    // Conquest battle (lost: playing counts)
    meta.onGameStart({ mode: 'mission', missionId: 'conquest', faction: 'soviet', opponents: 1, seed: 1 });
    meta.onGameEnd({ won: false, time: 300, mode: 'mission', missionId: 'conquest', stats: stats() as never, world });
    assert.ok(meta.profile.contracts.daily[1].done, 'a Conquest battle counts');
    // build-up ceasefire: three minutes after it ends, still standing
    meta.onGameStart({ mode: 'skirmish', difficulty: 'normal', faction: 'allies', opponents: 1, seed: 1 });
    world.ceasefireUntil = 100;
    world.tick = 100 + 179 * TICK_HZ;
    meta.onSample({ world, local: 0, army: 1000 });
    assert.ok(!meta.profile.contracts.daily[2].done, 'not yet');
    world.tick = 100 + 181 * TICK_HZ;
    meta.onSample({ world, local: 0, army: 1000 });
    assert.ok(meta.profile.contracts.daily[2].done, 'held the line');
    meta.abandon();
    // scenario challenge (no tracked match): via the medal counter
    pin([{ id: 'challenger', n: 1, p: 0, done: false }, { id: 'tank-hunter', n: 10, p: 0, done: false }, { id: 'blitz', n: 1, p: 0, done: false }]);
    meta.save();
    meta.addCounter('challenges', 1);
    assert.ok(meta.profile.contracts.daily[0].done, 'a completed scenario challenge counts');
  });
});

// =============================================================================================
describe('rerolls', () => {
  test('one free reroll a day, never on a finished contract, deterministic replacement from the same group', () => {
    const st = defaultContracts();
    const now = at('2026-10-17', 9);
    refreshContracts(st, now);
    const before = st.daily.map((s) => ({ ...s }));
    assert.ok(canReroll(st, now), 'a reroll is available');
    const copy = normalizeContracts(JSON.parse(JSON.stringify(st)));
    const slot = rerollContract(st, 'daily', 1, now);
    assert.ok(slot, 'rerolled');
    assert.notEqual(slot!.id, before[1].id, 'a different contract');
    assert.equal(CONTRACT_BY_ID[slot!.id].group, CONTRACT_BY_ID[before[1].id].group, 'same group');
    assert.ok(!st.daily.some((s, i) => i !== 1 && s.id === slot!.id), 'no duplicate');
    assert.equal(st.daily[0].id, before[0].id, 'other slots untouched');
    assert.deepEqual(rerollContract(copy, 'daily', 1, now), slot, 'deterministic for the day and slot');
    assert.equal(rerollContract(st, 'daily', 2, now + 3600e3), null, 'second reroll the same day refused');
    assert.equal(rerollContract(st, 'weekly', 0, now), null, 'the limit covers weekly contracts too');
    // next day: allowed again, but not on a finished contract
    const tomorrow = at('2026-10-18', 9);
    refreshContracts(st, tomorrow);
    st.daily[0].done = true;
    st.daily[0].p = st.daily[0].n;
    assert.equal(rerollContract(st, 'daily', 0, tomorrow), null, 'finished contracts cannot be rerolled');
    assert.ok(canReroll(st, tomorrow), 'refusal does not use up the reroll');
    assert.ok(rerollContract(st, 'weekly', 2, tomorrow), 'a weekly reroll the next day');
    assert.ok(!canReroll(st, tomorrow), 'used');
    assert.equal(rerollContract(st, 'daily', 9, at('2026-10-19')), null, 'bad index refused');
  });
});

// =============================================================================================
describe('profile migration and untrusted data', () => {
  test('v0 and v1 profiles migrate to v2 with their record intact', () => {
    const v1 = { v: 1, name: 'Old Hand', created: 5, faction: 'soviet', xp: 12345, stats: { games: 40, wins: 30 }, counters: { kills: 900 }, medals: { 'first-victory': { tier: 1, at: [1] } },
      history: [], daily: { best: {}, streak: 2, longest: 9, lastDay: '2026-10-01' }, survival: {}, climates: { winter: 3 }, future: { keep: true } };
    const p = normalizeProfile(v1);
    assert.equal(p.v, PROFILE_VERSION, 'upgraded');
    assert.equal(PROFILE_VERSION, 2, 'v2');
    assert.equal(p.xp, 12345, 'XP kept');
    assert.equal(p.stats.wins, 30, 'stats kept');
    assert.deepEqual(p.contracts, defaultContracts(), 'empty contracts');
    assert.equal(p.commendations, 0, 'no Commendations yet');
    assert.deepEqual(p.cosmetics, { owned: [], equipped: {}, seen: [], announced: [] }, 'empty cosmetics');
    assert.deepEqual((p as unknown as { future: unknown }).future, { keep: true }, 'fields from newer builds kept');
    // earned unlocks are derived from the record: an old veteran already has them
    const ctx: UnlockCtx = { profile: p, renown: 0 };
    assert.ok(isUnlocked('paint-desert', ctx) && isUnlocked('paint-arctic', ctx), '30 wins unlock Desert Tan and Arctic White');
    assert.ok(isUnlocked('banner-dawn', ctx), 'longest streak 9 unlocks Red Dawn');
    assert.ok(unannouncedUnlocks(ctx).length >= 4, 'and they are announced after the next battle');
    assert.ok(unseenUnlocks(ctx).length >= 4, 'and marked new in the Locker');
    markSeen(ctx, unseenUnlocks(ctx).map((d) => d.id));
    assert.equal(unseenUnlocks(ctx).length, 0, 'until looked at');
    const v0 = normalizeProfile({ name: 'Ancient', xp: 50, rank: 3 });
    assert.equal(v0.v, 2, 'v0 -> v2');
    assert.ok(!('rank' in v0), 'v0 rank field dropped');
  });

  test('corrupted or hostile profile data never breaks loading', () => {
    const garbage: unknown[] = [
      null, 42, 'x', [], { v: 'two' }, { v: 999, contracts: 'nope', commendations: 'lots', cosmetics: [1, 2] },
      { contracts: { day: '2026-10-17', daily: [{ id: 'nope', n: 1 }, null, 5], week: 'garbage', weekly: {}, rerollDay: 7, completed: -3, earned: Infinity } },
      { contracts: { day: '2026-10-17', daily: [{ id: 'tank-hunter', n: 9999, p: 1 }, { id: 'tank-hunter', n: 10 }, { id: 'blitz', n: 1 }] } },
      { commendations: 1e308, cosmetics: { owned: ['paint-night', 'paint-night', '__proto__', 'paint-arctic', 7], equipped: { paint: 'theme-jade', theme: 'theme-jade', voice: { x: 1 }, __proto__: 'x' }, seen: 'all' } },
      JSON.parse('{"__proto__": {"polluted": true}, "contracts": {"__proto__": {"polluted": true}}}'),
    ];
    for (const g of garbage) {
      const p = normalizeProfile(g);
      assert.ok(Array.isArray(p.contracts.daily) && Array.isArray(p.contracts.weekly), 'contract lists');
      assert.ok(Number.isFinite(p.commendations) && p.commendations >= 0 && p.commendations <= 1e6, `commendations sane (${p.commendations})`);
      assert.ok(p.contracts.completed >= 0 && Number.isFinite(p.contracts.earned), 'counters sane');
      for (const id of [...p.cosmetics.owned, ...p.cosmetics.seen, ...p.cosmetics.announced, ...Object.values(p.cosmetics.equipped)]) assert.ok(id && Object.hasOwn(COSMETIC_BY_ID, id), `known cosmetic ${id}`);
      refreshContracts(p.contracts, at('2026-10-17'));
      assert.equal(p.contracts.daily.length, 3, 'refresh repairs the sets');
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined, 'no prototype pollution');
    const c = normalizeProfile(garbage[8]).cosmetics;
    assert.deepEqual(c.owned, ['paint-night'], 'only Commendation items can be "owned", once');
    assert.deepEqual(c.equipped, { theme: 'theme-jade' }, 'equipped ids must match their slot');
    const bad = normalizeProfile(garbage[7]).contracts;
    assert.equal(bad.daily.length, 0, 'a set with invalid targets / duplicates is dropped (and regenerated)');
    // an equipped item that is not unlocked falls back to the default
    const p = normalizeProfile({ cosmetics: { equipped: { paint: 'paint-parade' } } });
    assert.equal(equippedId('paint', { profile: p, renown: 0 }), DEFAULT_COSMETIC.paint, 'locked equip ignored');
    // storage with broken JSON
    const store = memStorage();
    store.setItem(PROFILE_KEY, '{"contracts": [broken');
    assert.equal(loadProfile(store).contracts.daily.length, 0, 'broken JSON -> fresh profile');
  });
});

// =============================================================================================
describe('cosmetic unlocks', () => {
  test('catalogue covers every slot with a default and earned items', () => {
    for (const slot of Object.keys(DEFAULT_COSMETIC) as (keyof typeof DEFAULT_COSMETIC)[]) {
      const items = COSMETICS.filter((c) => c.slot === slot);
      assert.ok(items.length >= 4, `${slot}: ${items.length} items`);
      assert.equal(COSMETIC_BY_ID[DEFAULT_COSMETIC[slot]].req.kind, 'default', `${slot} default`);
    }
    for (const c of COSMETICS) if (c.slot === 'paint' && c.req.kind !== 'default') assert.ok(c.paint, `${c.id} paint spec`);
  });
  test('claiming spends Commendations once; equipping needs the unlock; the teaser points at the closest unlock', () => {
    const p: Profile = defaultProfile(0);
    const ctx: UnlockCtx = { profile: p, renown: 0 };
    assert.ok(!equipCosmetic(ctx, 'paint-night'), 'cannot equip unclaimed');
    assert.ok(!claimCosmetic(ctx, 'paint-night'), 'cannot afford');
    p.commendations = 45;
    assert.ok(claimCosmetic(ctx, 'paint-night'), 'claimed');
    assert.equal(p.commendations, 5, 'cost paid');
    assert.ok(!claimCosmetic(ctx, 'paint-night'), 'not twice');
    assert.equal(p.commendations, 5, 'paid once');
    assert.ok(!claimCosmetic(ctx, 'paint-arctic'), 'earned-only items cannot be bought');
    assert.ok(equipCosmetic(ctx, 'paint-night'), 'equip');
    assert.equal(equippedId('paint', ctx), 'paint-night', 'equipped');
    // teaser: one win short of Desert Tan
    p.stats.wins = 2;
    p.stats.games = 2;
    const t = nextUnlock(ctx)!;
    assert.ok(t, 'teaser');
    assert.equal(t.text, '1 more win → Desert Tan paint', t.text);
    p.stats.wins = 3;
    assert.ok(unlockStatus(COSMETIC_BY_ID['paint-desert'], ctx).unlocked, 'unlocked at three wins');
    p.xp = RANKS[2].xp;
    assert.ok(isUnlocked('theme-amber', ctx), 'rank unlock');
    assert.ok(!isUnlocked('theme-glacier', ctx) && isUnlocked('theme-glacier', { profile: p, renown: 250 }), 'Conquest renown unlock');
  });
});

// =============================================================================================
describe('battle report sampler', () => {
  test('samples every 10 s per player, tracks the MVP and feeds the tracker', () => {
    const world = makeWorld(5);
    const me = world.players[0], foe = world.players[1];
    const t1 = world.addUnit('2tnk', me, 20, 20), t2 = world.addUnit('1tnk', me, 21, 20);
    world.addUnit('3tnk', foe, 40, 40);
    t1.kills = 4; t2.kills = 6;
    const fed: number[] = [];
    const rep = new BattleReport(world, () => me, (s) => fed.push(s.army));
    for (let i = 0; i < 25 * TICK_HZ; i++) { world.tick++; rep.afterStep(); }
    assert.equal(rep.samples.length, 3, 'samples at 0, 10 and 20 s');
    assert.equal(rep.samples[0].players.length, 2, 'one entry per player');
    assert.ok(rep.samples[1].players[0].army > 0 && fed.length === 3, 'army value sampled and reported');
    const mvp = rep.mvp();
    assert.ok(mvp && mvp.type === '1tnk' && mvp.kills === 6, 'MVP: most kills');
  });
});
