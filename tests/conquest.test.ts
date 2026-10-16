/**
 * Conquest (roguelite campaign): run generation, map graph, turn logic, perks / research, veteran carry-over,
 * run save / resume, battle save / resume, meta progression, events, and a headless battle per mission type.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRun } from '../src/conquest/generate';
import {
  attackTargets, allowedTypes, coreCapacity, distances, neighbours, owned, territory, linkBetween, type ConquestRun,
} from '../src/conquest/state';
import {
  addVeteran, availableBattles, battleMods, capitalGate, buyResearch, computeScore, finishRun, offerPerks, pickPerk, planBattle, regroup, resolveBattle,
  researchFor, startBattle, withdraw,
} from '../src/conquest/run';
import { EVENTS, chooseEvent } from '../src/conquest/events';
import { BATTLE_KINDS, battleOutcome, type BattleOutcome } from '../src/conquest/battle';
import { loadMeta, loadRun, recordRunEnd, saveRun } from '../src/conquest/storage';
import { loadProfile } from '../src/meta/profile';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { TICK_HZ } from '../src/sim/types';
import { createConquestWorld, createConquestWorldForLoad, runConquestBattle } from '../tools/conquest-harness';
import { runWithBattle } from '../tools/conquesttest';
import type { World } from '../src/sim/world';

function memKV() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** A won (or lost) outcome for the run's committed battle where every deployed veteran survives. */
function fakeOutcome(run: ConquestRun, won: boolean, extra: Partial<BattleOutcome> = {}): BattleOutcome {
  const S = run.pending!.spec;
  return {
    battleId: S.id, won, time: 600, creditsLeft: 3000,
    objectives: [{ id: 'swift', text: 'Win fast', primary: false, state: won ? 'done' : 'failed' }],
    survivors: S.core.map((c) => ({ vet: c.vet, rank: c.rank, xp: c.xp })), recruits: [], kills: 20, losses: 5, superweaponDestroyed: false, ...extra,
  };
}

function worldHash(w: World): string {
  let h = 2166136261;
  const mix = (v: number) => { h ^= Math.round(v * 1000) | 0; h = Math.imul(h, 16777619); };
  mix(w.tick);
  for (const u of w.units) { mix(u.id); mix(u.x); mix(u.y); mix(u.hp); }
  for (const b of w.buildings) { mix(b.id); mix(b.hp); }
  for (const p of w.players) { mix(p.cash); mix(p.ore); }
  return (h >>> 0).toString(16) + ` u=${w.units.length} b=${w.buildings.length}`;
}

test('run generation is deterministic per seed and varies between seeds', () => {
  const a = generateRun({ seed: 1953, faction: 'allies', difficulty: 'normal', doctrine: 'vanguard' });
  const b = generateRun({ seed: 1953, faction: 'allies', difficulty: 'normal', doctrine: 'vanguard' });
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'same seed and options give the same run');
  const c = generateRun({ seed: 1954, faction: 'allies', difficulty: 'normal', doctrine: 'vanguard' });
  assert.notEqual(JSON.stringify(a.territories.map((t) => [t.id, t.x, t.y])), JSON.stringify(c.territories.map((t) => [t.id, t.x, t.y])), 'another seed draws another map');
  assert.equal(a.core.length, 5, 'the Vanguard doctrine starts with five veterans');
  assert.ok(a.core.every((v) => v.rank >= 1 && v.name), 'veterans have a rank and a call sign');
});

test('territories form a connected graph with land borders and sea lanes', () => {
  for (const seed of [1, 2, 3, 42, 777, 2024]) {
    for (const faction of ['allies', 'soviet'] as const) {
      const run = generateRun({ seed, faction });
      const n = run.territories.length;
      assert.ok(n >= 22 && n <= 28, `seed ${seed}: ${n} territories`);
      const keys = new Set<string>();
      for (const l of run.links) {
        assert.notEqual(l.a, l.b, 'no self links');
        const k = [l.a, l.b].sort().join(':');
        assert.ok(!keys.has(k), `duplicate link ${k}`);
        keys.add(k);
      }
      const reach = distances(run, run.territories[0].id);
      assert.equal(reach.size, n, `seed ${seed} ${faction}: every territory is reachable`);
      for (const t of run.territories) assert.ok(neighbours(run, t.id).length >= 1, `${t.name} has a neighbour`);
      const pc = run.territories.find((t) => t.capital === 'player')!, ec = run.territories.find((t) => t.capital === 'enemy')!;
      assert.equal(pc.owner, 'player', 'the player holds its capital');
      assert.equal(ec.owner, 'enemy', 'the enemy holds its capital');
      assert.ok(owned(run).length >= 2, 'the player starts with a few territories');
      assert.ok(attackTargets(run).length >= 1, 'something to attack on turn one');
      assert.ok((distances(run, pc.id).get(ec.id) ?? 0) >= 3, 'the enemy capital is a few steps away');
      // Britain and the continent only meet by sea
      const l = linkBetween(run, 'london', 'paris');
      if (l) assert.ok(l.sea, 'London-Paris is a sea lane');
    }
  }
});

test('battles: planning, rewards, perks and research feed back into the run', () => {
  const run = generateRun({ seed: 99, faction: 'soviet', doctrine: 'combined_arms' });
  const target = attackTargets(run).map((a) => territory(run, a.target)).find((t) => t.owner === 'enemy')!;
  const spec = planBattle(run, target.id, 4000);
  assert.equal(spec.mods.tanks, 2, 'Combined Arms (Armoured Spearhead) adds two tanks');
  assert.equal(spec.credits, 2500 + 4000, 'battle funds = allotment + committed war chest');
  assert.ok(spec.allowed.includes('barr') && !spec.allowed.includes('4tnk') && !spec.allowed.includes('tsla'), 'locked tech is not buildable before research');
  const chest = run.warChest, rp = run.rp, turn = run.turn;
  startBattle(run, target.id, 4000);
  assert.equal(run.warChest, chest - 4000, 'committed funds leave the war chest');
  const rep = resolveBattle(run, fakeOutcome(run, true))!;
  assert.ok(rep.captured && territory(run, target.id).owner === 'player', 'a won attack captures the territory');
  assert.ok(rep.loot > 0 && rep.rp >= 1, 'capture pays loot and research points');
  assert.ok(run.warChest >= chest - 4000 + 3000 + rep.loot, 'credits left and loot return to the war chest');
  assert.ok(run.rp >= rp + rep.rp, 'research points added');
  assert.equal(run.turn, turn + 1, 'the next turn begins');
  // perks
  run.perkChoice = null;
  offerPerks(run);
  assert.equal(run.perkChoice?.length, 3, 'three perks on offer');
  run.perkChoice = ['iron_will', ...(run.perkChoice ?? [])].slice(0, 3);
  const mm = run.moraleMax;
  assert.ok(pickPerk(run, 'iron_will'), 'perk picked');
  assert.equal(run.moraleMax, mm + 1, 'Iron Will raises maximum morale');
  run.perks.push('ore_boom', 'elite_paratroopers', 'hardened_core');
  const mods = battleMods(run, false);
  assert.ok(Math.abs(mods.income - 1.2) < 1e-9, 'Ore Boom: +20% harvest income');
  assert.equal(mods.drops.filter((d) => d.rank === 2).length, 2, 'Elite Paratroopers: two elite sticks');
  assert.ok(coreCapacity(run) >= 9, 'Hardened Core: +3 slots');
  // research
  run.rp = 10;
  const tesla = researchFor(run).find((r) => r.id === 'tesla')!;
  assert.ok(buyResearch(run, 'tesla'), 'research bought');
  assert.equal(run.rp, 10 - tesla.cost, 'research costs points');
  assert.ok(allowedTypes(run, ['tsla', 'barr', '4tnk']).includes('tsla'), 'Tesla Coils unlocked');
  assert.ok(!buyResearch(run, 'mammoth'), 'prerequisites are enforced (needs the tech centre)');
  assert.ok(!researchFor(run).some((r) => r.id === 'special_forces'), 'Allied-only research is hidden from Soviets');
});

test('defeats cost morale, unanswered counterattacks take territory, and the run can be lost', () => {
  const run = generateRun({ seed: 5, faction: 'allies' });
  const t = attackTargets(run)[0];
  startBattle(run, t.target, 0);
  const m = run.morale;
  resolveBattle(run, fakeOutcome(run, false));
  assert.equal(run.morale, m - 1, 'a lost battle costs morale');
  // a declared counterattack that is not answered takes the territory
  const mine = owned(run).find((x) => !x.capital && neighbours(run, x.id).some((n) => territory(run, n.id).owner === 'enemy'));
  if (mine) {
    run.threat = { target: mine.id, from: neighbours(run, mine.id).find((n) => territory(run, n.id).owner === 'enemy')!.id };
    assert.ok(availableBattles(run).some((b) => b.action === 'defend' && b.target === mine.id), 'the threatened territory can be defended');
    regroup(run);
    assert.equal(territory(run, mine.id).owner, 'enemy', 'ignoring the counterattack loses the territory');
  }
  // morale collapse ends the run
  run.morale = 1;
  const next = attackTargets(run)[0];
  startBattle(run, next.target, 0);
  resolveBattle(run, fakeOutcome(run, false));
  assert.equal(run.status, 'lost', 'morale 0 ends the run');
  assert.ok(run.score && run.score.total >= 0, 'a finished run is scored');
});

test('veterans carry over: spawned with their rank, survivors kept, the fallen lost, promotions recruited', () => {
  const run = generateRun({ seed: 31, faction: 'allies', doctrine: 'vanguard' });
  const target = attackTargets(run).map((a) => territory(run, a.target)).find((t) => t.owner === 'enemy' && t.objective !== 'naval')!;
  const setup = startBattle(run, target.id, 3000, { force: 'assault' });
  assert.equal(setup.battle.core.length, 5, 'the whole core army deploys');
  const { world, rt } = createConquestWorld(setup);
  const core = rt.flags.core as Record<number, number>;
  const ids = Object.keys(core).map(Number);
  assert.equal(ids.length, 5, 'five veterans spawned');
  for (const id of ids) {
    const u = world.getEntity(id) as any;
    const v = run.core.find((x) => x.id === core[id])!;
    assert.ok(u?.alive, 'veteran on the field');
    assert.equal(u.ut.id, v.type, 'right unit type');
    assert.equal(u.rank, v.rank, 'rank carried over');
  }
  const elite = run.core.find((v) => v.rank === 2)!;
  // two veterans fall, one is promoted, a rookie earns a promotion
  const [a, b, c] = ids.filter((id) => core[id] !== elite.id);
  world.kill(world.getEntity(a)!, 'normal');
  world.kill(world.getEntity(b)!, 'normal');
  (world.getEntity(c) as any).rank = 2;
  const rookie = world.units.find((u) => u.alive && u.owner.id === 0 && u.ut.id === 'e1' && !core[u.id])!;
  rookie.rank = 1;
  for (let t = 0; t < 5; t++) { world.step(); world.events.length = 0; }
  rt.win();
  const out = battleOutcome(world, setup.battle);
  assert.ok(out.won, 'battle won');
  assert.equal(out.survivors.length, 3, 'three veterans came home');
  assert.ok(out.recruits.some((r) => r.type === 'e1' && r.rank === 1), 'the promoted rifleman is a recruit');
  const lostIds = [core[a], core[b]];
  const promoted = core[c];
  const rep = resolveBattle(run, out)!;
  assert.ok(lostIds.every((id) => !run.core.some((v) => v.id === id)), 'fallen veterans leave the core army');
  assert.equal(run.core.find((v) => v.id === promoted)?.rank, 2, 'promotion kept');
  assert.ok(run.core.some((v) => v.type === 'e1' && v.joined === setup.battle.turn), 'recruit joined the core');
  assert.ok(rep.veterans.some((v) => v.fate === 'lost') && rep.veterans.some((v) => v.fate === 'recruit'), 'report lists the fates');
  // the next battle spawns the survivors again
  const next = attackTargets(run).map((x) => territory(run, x.target)).find((t) => t.owner === 'enemy' && t.objective !== 'naval')!;
  const s2 = planBattle(run, next.id, 0, { force: 'assault' });
  assert.equal(s2.core.length, run.core.length, 'every surviving veteran deploys in the next battle');
});

test('run save / resume round-trips through storage and continues identically', () => {
  const kv = memKV();
  const run = generateRun({ seed: 4242, faction: 'soviet', doctrine: 'logistics' });
  const t = attackTargets(run)[0].target;
  startBattle(run, t, 2000);
  resolveBattle(run, fakeOutcome(run, true));
  assert.ok(saveRun(run, kv), 'saved');
  const back = loadRun(kv)!;
  assert.deepEqual(back, run, 'loaded run equals the saved one');
  // the RNG state travels with it: both copies make the same decisions from here
  const a = clone(run), b = back;
  for (let k = 0; k < 2; k++) {
    a.threat = null; b.threat = null; // (an ignored counterattack on the capital would end the run)
    regroup(a); regroup(b);
  }
  assert.equal(a.status, 'active', 'still active');
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'resumed run continues identically');
  // a committed battle survives a reload as well
  const c = clone(a);
  const tgt = availableBattles(c)[0];
  const setup = startBattle(c, tgt.target, 1000);
  saveRun(c, kv);
  const d = loadRun(kv)!;
  assert.deepEqual(d.pending?.spec, setup.battle, 'the frozen battle spec is restored');
  withdraw(d);
  assert.equal(d.pending, null, 'withdrawing resolves the battle');
});

test('a saved conquest battle resumes deterministically', () => {
  const { setup } = runWithBattle(12, 'allies', 'hold');
  const A = createConquestWorld(setup);
  for (let t = 0; t < TICK_HZ * 100; t++) { A.world.step(); A.world.events.length = 0; A.rt.events.length = 0; }
  const json = JSON.stringify(serializeWorld(A.world));
  const B = createConquestWorldForLoad(setup);
  deserializeWorld(B.world, JSON.parse(json), B.rt);
  assert.deepEqual(B.rt.objectives, A.rt.objectives, 'objectives restored');
  assert.deepEqual(B.rt.flags.core, A.rt.flags.core, 'core veteran map restored');
  for (let t = 0; t < TICK_HZ * 120; t++) {
    A.world.step(); A.world.events.length = 0; A.rt.events.length = 0;
    B.world.step(); B.world.events.length = 0; B.rt.events.length = 0;
  }
  assert.equal(worldHash(B.world), worldHash(A.world), 'the reloaded battle stays in sync');
});

test('meta progression: renown, titles, unlocks and commander XP, counted once per run', () => {
  const kv = memKV();
  const run = generateRun({ seed: 8, faction: 'allies', difficulty: 'hard' });
  run.stats.battlesWon = 9;
  run.stats.capturedValue = 14;
  finishRun(run, 'won', 'Moscow has fallen.');
  const s = recordRunEnd(run, kv, 1000)!;
  assert.ok(s.xp > 0, 'commander XP awarded');
  assert.equal(loadProfile(kv).xp, s.xp, 'XP lands on the shared profile');
  const meta = loadMeta(kv);
  assert.equal(meta.runs, 1, 'run counted');
  assert.equal(meta.victories, 1, 'victory counted');
  assert.ok(meta.renown > 0 && meta.renown === run.score!.renown, 'renown from the score');
  assert.ok(meta.titles.includes('liberator') && meta.titles.includes('iron_marshal'), 'victory titles earned');
  assert.ok(s.unlocks.some((u) => u.startsWith('Title:')), 'unlocks listed');
  recordRunEnd(run, kv, 2000);
  assert.equal(loadMeta(kv).runs, 1, 'recording again does not double count');
  assert.equal(loadProfile(kv).xp, s.xp, 'XP is not granted twice');
  const score = computeScore(run);
  assert.ok(score.lines.some((l) => l.label === 'Victory'), 'victory bonus in the score');
});

test('every event resolves deterministically for every choice', () => {
  const base = generateRun({ seed: 64, faction: 'soviet', doctrine: 'vanguard' });
  base.turn = 6;
  base.warChest = 20000;
  for (const def of EVENTS) {
    const probe = clone(base);
    const ev = (() => { let e = null; for (let k = 0; k < 30 && !e; k++) { probe.rng = (probe.rng + 7919) >>> 0; e = def.prepare(probe, { pick: (a: any[]) => a[0], chance: () => true, next: () => 0.5, int: (a: number) => a, range: (a: number) => a, shuffle: (a: any[]) => a } as any); } return e; })();
    if (!ev) continue; // not applicable to this run (e.g. winter events in spring)
    const n = def.choices(base, ev).length;
    for (let k = 0; k < n; k++) {
      const a = clone(base), b = clone(base);
      a.event = clone(ev); b.event = clone(ev);
      const ta = chooseEvent(a, k), tb = chooseEvent(b, k);
      assert.ok(ta.length > 0, `${def.id} choice ${k} has an outcome`);
      assert.equal(ta, tb, `${def.id} choice ${k} is deterministic`);
      assert.equal(JSON.stringify(a), JSON.stringify(b), `${def.id} choice ${k} leaves identical runs`);
      assert.equal(a.event, null, 'event cleared');
    }
  }
});

test('the enemy capital can only be assaulted from a broad front', () => {
  const run = generateRun({ seed: 21, faction: 'allies' });
  const cap = run.territories.find((t) => t.capital === 'enemy')!;
  // move the front right up to the capital
  const nb = neighbours(run, cap.id).map((n) => territory(run, n.id));
  nb[0].owner = 'player';
  const few = owned(run).length < capitalGate(run);
  if (few) assert.ok(!availableBattles(run).some((b) => b.target === cap.id), 'no assault before holding enough territory');
  for (const t of run.territories) if (owned(run).length < capitalGate(run) && t.owner !== 'player' && !t.capital) t.owner = 'player';
  const b = availableBattles(run).find((x) => x.target === cap.id);
  assert.ok(b, 'assault authorised once the gate is reached');
  assert.equal(planBattle(run, cap.id, 0).kind, 'boss', 'the capital is the boss battle');
});

test('veteran capacity is enforced', () => {
  const run = generateRun({ seed: 3, faction: 'allies' });
  const cap = coreCapacity(run);
  for (let k = 0; k < cap + 5; k++) addVeteran(run, '2tnk', 1);
  assert.equal(run.core.length, cap, 'core army never exceeds its capacity');
  assert.equal(new Set(run.core.map((v) => v.name)).size, run.core.length, 'call signs are unique');
});

for (const kind of BATTLE_KINDS) {
  test(`headless ${kind} battle: the autopilot wins and the result feeds the run`, () => {
    const { run, setup } = runWithBattle(kind === 'boss' ? 5 : 7, kind === 'naval' ? 'soviet' : 'allies', kind);
    assert.equal(setup.battle.kind, kind, 'battle kind');
    const r = runConquestBattle(setup, kind === 'defend' ? 16 : 22);
    assert.equal(r.error, undefined, `no script error: ${r.error}`);
    assert.ok(r.ended && r.won, `${kind} won (ended=${r.ended} reason=${r.reason} t=${Math.round(r.time)}s ${r.objectives.join(' ')})`);
    assert.ok(r.rt.objectives.some((o) => o.primary && o.state === 'done'), 'a primary objective completed');
    const rep = resolveBattle(run, r.outcome)!;
    assert.ok(rep && rep.won, 'report says won');
    if (kind === 'boss') assert.equal(run.status, 'won', 'taking the enemy capital wins the run');
    else if (kind === 'defend') assert.equal(territory(run, setup.territory).owner, 'player', 'defended territory kept');
    else assert.equal(territory(run, setup.territory).owner, 'player', 'territory captured');
  });
}
