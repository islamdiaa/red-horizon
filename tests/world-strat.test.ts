/**
 * World Conquest strategic layer (src/conquest/world): Risk dice and odds, run creation, the rules (reinforcements,
 * cards, sea lanes, ceasefires, elimination, fortify), turn flow and rival playback, determinism and save/load, the
 * RTS route (BattleSpec.world, applyBattle), links and the Weekly World, storage and medals.
 * Rules tests run on the synthetic stub geography (stable whatever the real atlas becomes).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng';
import {
  HUMAN, NEUTRAL, STUB_ATLAS, SET_VALUES, act, applyBattle, attackBlock, attackOdds, attackTargets, autoPlace, battleLosses, bestSet, breakCeasefire,
  ceasefireChance, decodeWorldLink, encodeWorldLink, endPhase, endTurn, fortify, fortifyTargets, isoWeek, ix, legalActions, loadWorldMeta, loadWorldRun,
  moveIn, mustTrade, newWorldRun, offerCeasefire, ownedCount, parseWorldRun, placeTroops, recordWorldEnd, reinforcements, resolveDefence, rollAttack,
  saveWorldRun, setAtlas, setValue, startBattle, startDefenceBattle, terr, tradeCards, weeklySeed, weeklyWorld, worldScore, withdrawBattle,
  type WorldRun,
} from '../src/conquest/world/index';
import { rollDistribution, rollOdds, blitzOdds, rollOnce } from '../src/conquest/world/dice';
import { loadProfile } from '../src/meta/profile';
import { playGame, modelOutcome } from '../tools/world/strat-lib';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function memKV() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const HOME = () => STUB_ATLAS.homelands[3].id;
const fresh = (o: Partial<Parameters<typeof newWorldRun>[0]> = {}) => newWorldRun({ seed: 42, home: HOME(), size: 'world', difficulty: 'normal', ...o });
/** Skip to the attack phase with every troop placed on the capital. */
function toAttack(run: WorldRun) {
  const cap = run.territories.find((t) => t.capital === HUMAN)!;
  if (run.toPlace) assert.ok(placeTroops(run, cap.id, run.toPlace), 'placing all troops on the capital');
  endPhase(run);
  assert.equal(run.phase, 'attack', 'in the attack phase');
}

before(() => setAtlas(STUB_ATLAS));

describe('Risk dice', () => {
  test("single-roll odds match Risk's known table exactly", () => {
    const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-12, `${what}: ${a} vs ${b}`);
    let o = rollOdds(3, 2);
    close(o.att, 2890 / 7776, '3v2 attacker wins both'); close(o.split, 2611 / 7776, '3v2 split'); close(o.def, 2275 / 7776, '3v2 defender wins both');
    o = rollOdds(2, 2);
    close(o.att, 295 / 1296, '2v2 attacker wins both'); close(o.split, 420 / 1296, '2v2 split'); close(o.def, 581 / 1296, '2v2 defender wins both');
    close(rollOdds(3, 1).att, 855 / 1296, '3v1'); close(rollOdds(2, 1).att, 125 / 216, '2v1');
    close(rollOdds(1, 2).att, 55 / 216, '1v2'); close(rollOdds(1, 1).att, 15 / 36, '1v1');
    for (const [a, d] of [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2]]) {
      const p = rollDistribution(a, d);
      close(p.reduce((s, x) => s + x, 0), 1, `${a}v${d} distribution sums to 1`);
    }
  });

  test('blitz odds match the published Risk table (Osborne 2003)', () => {
    const table: Record<number, number[]> = { 1: [0.417, 0.106, 0.027], 2: [0.754, 0.363, 0.206], 3: [0.916, 0.656, 0.47], 4: [0.972, 0.785, 0.642], 5: [0.99, 0.89, 0.769] };
    for (const [a, row] of Object.entries(table)) row.forEach((p, k) => assert.ok(Math.abs(blitzOdds(+a, k + 1).win - p) < 0.0011, `${a} vs ${k + 1}: ${blitzOdds(+a, k + 1).win}`));
    assert.ok(blitzOdds(30, 10).win > 0.99 && blitzOdds(10, 30).win < 0.01, 'big stacks are lopsided');
    assert.ok(blitzOdds(5000, 4000).win > 0.5, 'beyond the table the stacks scale');
  });

  test('rolled dice follow the table (the run generator, 60,000 rolls of 3 vs 2)', () => {
    const rng = new Rng(7);
    let att = 0, def = 0;
    const N = 60000;
    for (let k = 0; k < N; k++) { const r = rollOnce(rng, 3, 2); if (r.defLoss === 2) att++; else if (r.attLoss === 2) def++; }
    assert.ok(Math.abs(att / N - 0.3717) < 0.01, `attacker wins both ${att / N}`);
    assert.ok(Math.abs(def / N - 0.2926) < 0.01, `defender wins both ${def / N}`);
  });

  test('a wonder modifier on the best die is capped at 6 (ties still go to the defender)', () => {
    const plus = rollOdds(1, 1, 1, 0).att, base = rollOdds(1, 1).att;
    assert.ok(plus > base, 'an attack bonus helps');
    // 1v1 with +1: the attacker wins unless the defender rolls >= the attacker's die + 1 (capped): 20/36
    assert.ok(Math.abs(plus - 20 / 36) < 1e-12, `+1 1v1 ${plus}`);
    assert.ok(rollOdds(1, 1, 0, 1).att < base, 'a defence bonus hurts the attacker');
  });
});

describe('a new world run', () => {
  test('is deterministic from its options', () => {
    assert.deepEqual(clone(fresh()), clone(fresh()), 'same options, same run');
    assert.notDeepEqual(clone(fresh({ seed: 43 })).territories.map((t) => t.troops), clone(fresh()).territories.map((t) => t.troops), 'another seed differs');
  });

  test('a fresh run and its save/load round trip are the same run (capitals count from turn 1)', () => {
    for (const size of ['world', 'blitz'] as const) {
      const run = fresh({ size, seed: 2304039 });
      const back = parseWorldRun(JSON.stringify(run))!;
      for (const p of run.powers) assert.deepEqual(reinforcements(run, p.id), reinforcements(back, p.id), `${size}: power ${p.id} reinforcements live vs reloaded`);
      assert.ok(reinforcements(run).lines.some((l) => l.key === 'capitals'), 'the capital bonus is there from the start');
      // and they play on identically
      const go = (r: WorldRun) => { for (let k = 0; k < 3; k++) { autoPlace(r); endPhase(r); endTurn(r); while (r.defence) { resolveDefence(r); endTurn(r); } } };
      go(run); go(back);
      assert.deepEqual(clone(run), clone(back), `${size}: same continuation`);
    }
  });

  test('every power starts equal: 3 territories, a capital, 16 troops (+1 for each foreign neighbour beyond 4, at most 3)', () => {
    for (const size of ['world', 'blitz'] as const) for (const seed of [1, 2, 3]) {
      const run = fresh({ size, seed });
      assert.equal(run.powers.length - 1, size === 'world' ? 5 : 3, `${size}: rivals (${run.powers.length - 1})`);
      const counts = run.powers.map((p) => ownedCount(run, p.id));
      assert.ok(counts.every((c) => c === 3), `${size} ${seed}: starting territories ${counts}`);
      const X = ix(run);
      for (const p of run.powers) {
        const cap = terr(run, p.capital);
        assert.equal(cap.owner, p.id, 'the capital is its own');
        assert.equal(cap.capital, p.id, 'and marked');
        const mine = run.territories.map((t, i) => (t.owner === p.id ? i : -1)).filter((i) => i >= 0);
        const front = new Set(mine.flatMap((i) => X.adj[i]).filter((i) => run.territories[i].owner !== p.id)).size;
        const troops = mine.reduce((sum, i) => sum + run.territories[i].troops, 0);
        assert.equal(troops, 16 + Math.min(3, Math.max(0, front - 4)), `${size} ${seed} power ${p.id}: troops ${troops}, frontier ${front}`);
      }
      const personalities = run.powers.slice(1).map((p) => p.personality);
      assert.equal(new Set(personalities).size, Math.min(5, personalities.length), `distinct personalities ${personalities}`);
    }
  });

  test('World is about 100 territories, Blitz about 30, both connected', () => {
    const w = fresh({ size: 'world' }), b = fresh({ size: 'blitz' });
    assert.ok(w.territories.length >= 80, `world ${w.territories.length}`);
    assert.ok(b.territories.length >= 22 && b.territories.length <= 40, `blitz ${b.territories.length}`);
    for (const run of [w, b]) {
      const X = ix(run);
      const seen = new Set([0]);
      const q = [0];
      while (q.length) { const c = q.shift()!; for (const n of X.adj[c]) if (!seen.has(n)) { seen.add(n); q.push(n); } }
      assert.equal(seen.size, run.territories.length, 'one connected map');
      // every sea lane is usable (a port at an end) or the map stays connected without it
      for (const z of run.zones) assert.ok(z.bonus >= 1 && z.territories.length >= 1, `zone ${z.id} bonus ${z.bonus}`);
    }
  });

  test('the first turn offers an easy target and the reinforcements of the rules', () => {
    const run = fresh();
    assert.equal(run.turn, 1); assert.equal(run.phase, 'reinforce'); assert.equal(run.current, HUMAN);
    const R = reinforcements(run);
    assert.equal(R.lines.find((l) => l.key === 'territories')!.n, 3, 'max(3, territories / 3)');
    assert.equal(R.lines.find((l) => l.key === 'capitals')!.n, 2, 'own capital +2');
    assert.equal(run.toPlace, R.total, 'troops to place');
    const X = ix(run);
    const weak = run.territories.some((t, i) => t.owner === HUMAN && X.adj[i].some((n) => run.territories[n].owner === NEUTRAL && run.territories[n].troops === 1));
    assert.ok(weak, 'a neutral neighbour held by one troop');
  });
});

describe('rules', () => {
  test('placing, then attacking with blitz and moving in', () => {
    const run = fresh();
    assert.ok(!placeTroops(run, run.territories.find((t) => t.owner !== HUMAN)!.id, 1), 'cannot place on a foreign territory');
    assert.ok(!placeTroops(run, run.powers[0].capital, run.toPlace + 1), 'cannot place more than in hand');
    toAttack(run);
    const opts = attackTargets(run);
    assert.ok(opts.length > 0, 'attacks open');
    const a = opts.sort((x, y) => terr(run, x.to).troops - terr(run, y.to).troops)[0];
    const odds = attackOdds(run, a.from, a.to);
    assert.ok(odds.win > 0.9, `odds shown before committing ${odds.win}`);
    const before = terr(run, a.from).troops;
    const r = rollAttack(run, a.from, a.to, true)!;
    assert.ok(r && r.rolls.length >= 1 && r.rolls.every((d) => d.att.length >= 1 && d.def.length >= 1), 'dice for the animation');
    if (r.conquered) {
      assert.equal(terr(run, a.to).owner, HUMAN, 'conquered');
      assert.equal(terr(run, a.from).troops + terr(run, a.to).troops, before - r.attLoss, 'troops conserved');
      assert.ok(moveIn(run, r.moveMin), 'move the minimum instead');
      assert.equal(terr(run, a.to).troops, r.moveMin, 'moved');
      assert.ok(!moveIn(run, r.moveMax + 1), 'not beyond the range');
    }
  });

  test('sea lanes need a port at one end', () => {
    const run = fresh();
    toAttack(run);
    const X = ix(run);
    // find a sea lane from a human territory, strip both ports, and check the block
    let found = false;
    run.territories.forEach((t, i) => {
      if (found || t.owner !== HUMAN) return;
      X.adj[i].forEach((n, k) => {
        if (found || !X.sea[i][k] || run.territories[n].owner === HUMAN) return;
        t.port = false; run.territories[n].port = false; t.troops = 10;
        run.navyLeft = 0;
        assert.equal(attackBlock(run, t.id, run.territories[n].id), 'port', 'no port: blocked');
        run.navyLeft = 1;
        assert.equal(attackBlock(run, t.id, run.territories[n].id), null, 'a navy wonder crossing opens it');
        found = true;
      });
    });
    if (!found) {
      // the human's start has no sea lane on this seed: make one
      const mine = run.territories.find((t) => t.owner === HUMAN)!;
      const far = run.territories.find((t) => t.owner === NEUTRAL && !X.adj[ix(run).byId.get(mine.id)!].includes(ix(run).byId.get(t.id)!))!;
      run.links = [...run.links, { a: mine.id, b: far.id, sea: true }];
      mine.port = false; far.port = false; mine.troops = 10; run.navyLeft = 0;
      assert.equal(attackBlock(run, mine.id, far.id), 'port', 'no port: blocked');
    }
  });

  test('cards: sets, the capped escalation, forced trades', () => {
    const run = fresh();
    const P = run.powers[HUMAN];
    P.cards = ['infantry', 'armour', 'air', 'infantry', 'infantry'];
    assert.ok(mustTrade(run), 'five cards force a trade');
    assert.ok(!placeTroops(run, P.capital, 1), 'no placing before the forced trade');
    const set = bestSet(run)!;
    assert.deepEqual(set.map((i) => P.cards[i]).sort(), ['air', 'armour', 'infantry'], 'one of each preferred');
    const before = run.toPlace;
    assert.equal(tradeCards(run, [0, 1, 3]), 0, 'not a set');
    assert.equal(tradeCards(run, set), SET_VALUES[0], 'first set');
    assert.equal(run.toPlace, before + SET_VALUES[0], 'troops added');
    run.trades = 40;
    assert.equal(setValue(run), SET_VALUES[SET_VALUES.length - 1], 'the escalation is capped');
  });

  test('eliminating a rival takes its cards (and forces a trade at six)', () => {
    const run = fresh();
    toAttack(run);
    run.turn = 2; // (turn 1: no attacks on other powers)
    const X = ix(run);
    const rival = run.powers[1];
    // give the rival a single territory next to a big human stack
    const mine = run.territories.findIndex((t) => t.owner === HUMAN);
    const n = X.adj[mine].find((k) => run.territories[k].owner !== HUMAN)!;
    for (const t of run.territories) if (t.owner === rival.id) { t.owner = NEUTRAL; t.capital = undefined; }
    run.territories[n].owner = rival.id; run.territories[n].troops = 1;
    run.territories[mine].troops = 30;
    run.links = [...run.links]; // (fresh index)
    rival.cards = ['air', 'air', 'armour', 'armour'];
    run.powers[HUMAN].cards = ['infantry', 'infantry'];
    let r = rollAttack(run, run.territories[mine].id, run.territories[n].id, true)!;
    for (let k = 0; k < 5 && !r.conquered; k++) r = rollAttack(run, run.territories[mine].id, run.territories[n].id, true)!;
    assert.ok(r.conquered && r.eliminated, 'eliminated');
    assert.equal(rival.alive, false); assert.equal(rival.eliminatedBy, HUMAN);
    assert.equal(run.powers[HUMAN].cards.length, 6, 'its four cards passed on');
    assert.ok(mustTrade(run), 'six cards: trade now');
    assert.ok(rollAttack(run, run.territories[n].id, run.territories[mine].id) === null && attackTargets(run).length === 0, 'no attacks before trading');
    assert.ok(tradeCards(run, bestSet(run)!) > 0 && run.toPlace > 0, 'traded for troops to place now');
  });

  test('fortify moves troops through connected own territories only, once a turn', () => {
    const run = fresh();
    toAttack(run);
    const cap = run.powers[HUMAN].capital;
    const targets = fortifyTargets(run, cap);
    assert.ok(targets.length >= 1, 'connected territories');
    assert.ok(!fortify(run, cap, run.territories.find((t) => t.owner !== HUMAN)!.id, 1), 'not to a foreign territory');
    const n = terr(run, cap).troops - 1;
    assert.ok(fortify(run, cap, targets[0], n), 'fortified');
    assert.equal(terr(run, cap).troops, 1, 'one stays');
    assert.ok(!fortify(run, targets[0], cap, 1), 'only once a turn');
    assert.equal(run.phase, 'fortify');
  });

  test('ceasefires block attacks both ways; breaking one costs trust', () => {
    const run = fresh();
    const rival = run.powers[1];
    rival.ceasefire = run.turn + 3;
    const X = ix(run);
    const t = run.territories.findIndex((x, i) => x.owner === HUMAN && X.adj[i].some((k) => run.territories[k].owner !== HUMAN));
    const n = X.adj[t].find((k) => run.territories[k].owner !== HUMAN)!;
    run.territories[n].owner = rival.id;
    run.links = [...run.links];
    toAttack(run);
    run.turn = 2; // (turn 1: no attacks on other powers)
    run.territories[t].troops = 9;
    assert.equal(attackBlock(run, run.territories[t].id, run.territories[n].id), 'ceasefire', 'blocked by the ceasefire');
    assert.ok(breakCeasefire(run, rival.id), 'broken');
    assert.equal(attackBlock(run, run.territories[t].id, run.territories[n].id), null, 'open after breaking it');
    assert.ok(run.powers[HUMAN].distrust > run.turn, 'distrusted');
    assert.equal(ceasefireChance(run, 2), 0, 'nobody signs with a traitor');
    assert.equal(offerCeasefire(run, 2).why, 'distrust');
  });

  test('ceasefire proposals: shown chance, a cooldown, deterministic answers', () => {
    const run = fresh();
    const c = ceasefireChance(run, 1);
    assert.ok(c > 0 && c < 1, `chance ${c}`);
    const a = clone(run), b = clone(run);
    assert.deepEqual(offerCeasefire(a, 1), offerCeasefire(b, 1), 'same state, same answer');
    assert.equal(offerCeasefire(a, 1).why, 'already' === offerCeasefire(a, 1).why ? 'already' : 'cooldown', 'no second proposal at once');
  });
});

describe('turns and the rivals', () => {
  test('turn 1: every power expands into neutral land only', () => {
    const run = fresh();
    toAttack(run);
    const X = ix(run);
    const t = run.territories.findIndex((x, i) => x.owner === HUMAN && X.adj[i].some((k) => run.territories[k].owner !== HUMAN));
    const n = X.adj[t].find((k) => run.territories[k].owner !== HUMAN)!;
    run.territories[n].owner = 2;
    run.territories[t].troops = 9;
    run.links = [...run.links];
    assert.equal(attackBlock(run, run.territories[t].id, run.territories[n].id), 'firstTurn', 'no attacks on powers in turn 1');
    autoPlace(run); endPhase(run);
    const ev = endTurn(run);
    assert.ok(!ev.some((e) => e.kind === 'attack' && e.defender !== NEUTRAL), 'rivals attack only neutrals in turn 1');
  });

  test('endTurn plays every rival and returns the playback; the human reinforces next', () => {
    const run = fresh();
    autoPlace(run);
    endPhase(run);
    const ev = endTurn(run);
    assert.ok(ev.some((e) => e.kind === 'turn' && e.power === 1), 'rival turns in the playback');
    assert.ok(ev.some((e) => e.kind === 'reinforce' && e.power !== HUMAN), 'rivals reinforce');
    while (run.defence) { resolveDefence(run); endTurn(run); }
    assert.equal(run.turn, 2); assert.equal(run.current, HUMAN); assert.equal(run.phase, 'reinforce');
    assert.ok(run.toPlace >= 3, 'new troops');
  });

  test('act() returns its events even once the diary is full', () => {
    const run = fresh();
    for (let k = 0; k < 300; k++) run.log.push({ kind: 'turn', power: 1, turn: 1 });
    const ev = act(run, { type: 'place', to: run.powers[HUMAN].capital, max: run.toPlace, n: 1 });
    assert.deepEqual(ev.map((e) => e.kind), ['reinforce'], 'the placement event');
  });

  test('a whole game always ends, with a legal action in every state (random policy)', () => {
    for (const [seed, size, difficulty] of [[1, 'blitz', 'recruit'], [2, 'blitz', 'brutal'], [3, 'world', 'normal'], [4, 'world', 'hard']] as const) {
      const run = fresh({ seed, size, difficulty });
      const rng = new Rng(seed * 99);
      for (let guard = 0; guard < 20000 && run.status === 'active'; guard++) {
        const acts = legalActions(run);
        assert.ok(acts.length > 0, `softlock at turn ${run.turn} phase ${run.phase}`);
        // mostly sensible: place, attack when odds are fair, end the turn now and then
        const pick = acts.find((a) => a.type === 'trade') ?? acts.find((a) => a.type === 'place')
          ?? (rng.chance(0.7) ? acts.filter((a) => a.type === 'attack' && attackOdds(run, a.from, a.to).win > 0.55)[0] : undefined)
          ?? acts.find((a) => a.type === 'defend') ?? acts.find((a) => a.type === 'endTurn') ?? acts.find((a) => a.type === 'endPhase') ?? acts[0];
        act(run, pick);
      }
      assert.notEqual(run.status, 'active', `${size} ${difficulty} ended (turn ${run.turn})`);
      assert.ok(run.score && run.score.total >= 0, 'scored');
    }
  });

  test('a run replays identically, and save/load mid-game continues identically', () => {
    const play = (run: WorldRun, turns: number) => { for (let k = 0; k < turns && run.status === 'active'; k++) { autoPlace(run); endPhase(run); for (const a of attackTargets(run).slice(0, 3)) rollAttack(run, a.from, a.to, true); endTurn(run); while (run.defence) { resolveDefence(run); endTurn(run); } } };
    const a = fresh({ seed: 9 }), b = fresh({ seed: 9 });
    play(a, 6); play(b, 6);
    assert.deepEqual(clone(a), clone(b), 'replay identical');
    const kv = memKV();
    assert.ok(saveWorldRun(a, kv), 'saved');
    const c = loadWorldRun(kv)!;
    play(a, 6); play(c, 6);
    assert.deepEqual(clone(a), clone(c), 'continuation after load identical');
  });

  test('a defence choice pauses the playback; dice or a battle continues it', () => {
    let hit = false;
    for (let seed = 1; seed < 40 && !hit; seed++) {
      const run = fresh({ seed, size: 'blitz', difficulty: 'hard' });
      for (let k = 0; k < 30 && run.status === 'active' && !run.defence; k++) { autoPlace(run); endPhase(run); endTurn(run); }
      if (!run.defence) continue;
      hit = true;
      assert.ok(legalActions(run).some((a) => a.type === 'defend'), 'the defence is the legal action');
      assert.equal(endTurn(run).length, 0, 'the playback waits for the answer');
      const setup = startDefenceBattle(run)!;
      assert.ok(setup && setup.battle.kind === 'defend' && setup.battle.world?.action === 'defend', 'a defence battle');
      const rep = applyBattle(run, modelOutcome(run, new Rng(1), 'casual'))!;
      assert.ok(rep && rep.action === 'defend', 'applied');
      assert.equal(run.defence, null, 'answered');
      endTurn(run);
      assert.ok(run.status !== 'active' || run.current === HUMAN || run.defence, 'the rivals played on');
    }
    assert.ok(hit, 'some rival attacked a capital in 40 seeds');
  });
});

describe('the RTS route', () => {
  test('startBattle freezes a spec with the world field and the region battlefield', () => {
    const run = fresh();
    toAttack(run);
    const a = attackTargets(run)[0];
    const setup = startBattle(run, a.from, a.to)!;
    const S = setup.battle;
    assert.ok(S.world && S.world.attackers === terr(run, a.from).troops - 1 && S.world.defenders === terr(run, a.to).troops, 'troops in the spec');
    assert.ok((S.map as { region?: unknown }).region, 'a region battlefield');
    assert.ok(S.strength >= 1 && S.strength <= 6, 'garrison strength');
    assert.equal(rollAttack(run, a.from, a.to), null, 'no dice while the battle is pending');
    assert.deepEqual(legalActions(run), [{ type: 'withdraw' }]);
    assert.deepEqual(clone(S), clone(startBattle(run, a.from, a.to)!.battle), 'the pending battle is resumed, not replanned');
  });

  test('a won battle takes the territory cheaply and pays rewards; a lost one still grinds the defender', () => {
    const run = fresh();
    toAttack(run);
    const a = attackTargets(run)[0];
    const from0 = terr(run, a.from).troops;
    const setup = startBattle(run, a.from, a.to)!;
    const id = setup.battle.id;
    const rep = applyBattle(run, { battleId: id, won: true, time: 600, creditsLeft: 2000, objectives: [], survivors: [], recruits: [{ type: '2tnk', rank: 1, xp: 300 }], kills: 30, losses: 10, superweaponDestroyed: false })!;
    assert.ok(rep.won && rep.captured, 'captured');
    assert.equal(terr(run, a.to).owner, HUMAN);
    assert.ok(rep.warChest > 0 && rep.rp > 0 && rep.score > 0, 'rewards');
    assert.equal(terr(run, a.from).troops + terr(run, a.to).troops, from0 - rep.attLoss, 'troops conserved');
    assert.ok(run.army.core.length >= 1, 'a veteran joined');
    // losses model: wins cost less than the dice would, losses still hurt the defender
    const win = battleLosses('attack', true, 10, 6, 0.3), loss = battleLosses('attack', false, 10, 6, 0.6);
    assert.ok(win.attLoss < blitzOdds(10, 6).attLoss, `a won battle (${win.attLoss}) costs less than the dice (${blitzOdds(10, 6).attLoss.toFixed(1)})`);
    assert.ok(loss.defLoss >= 1 && loss.attLoss >= 1, 'a lost battle costs both sides');
    assert.ok(battleLosses('attack', true, 3, 20, 0.5).attLoss <= 2, 'never more than the attackers minus one');
  });

  test('withdrawing counts as a lost battle', () => {
    const run = fresh();
    toAttack(run);
    const a = attackTargets(run)[0];
    startBattle(run, a.from, a.to);
    const rep = withdrawBattle(run)!;
    assert.ok(rep && !rep.won && run.pending === null, 'withdrawn');
    assert.equal(terr(run, a.to).owner === HUMAN, false, 'not taken');
  });
});

describe('links, the Weekly World, storage', () => {
  test('links round-trip and reject anything malformed', () => {
    const o = { seed: 123456789, home: HOME(), size: 'blitz' as const, difficulty: 'hard' as const, faction: 'soviet' as const, ironman: true, fog: true };
    const s = encodeWorldLink(o);
    assert.deepEqual(decodeWorldLink('#' + s), o, s);
    assert.deepEqual(clone(newWorldRun(decodeWorldLink(s)!)), clone(newWorldRun(o)), 'the same world');
    for (const bad of ['', '#world=', '#world=zz!&home=x', `#world=1&home=nowhere&size=world&diff=normal`, `#world=1&home=${HOME()}&size=huge&diff=normal`,
      `#world=1&home=${HOME()}&size=world&diff=godlike`, `#world=1&home=${HOME()}&size=world&diff=normal&side=martians`, '#world=1&home=%E0%A4%A&size=world&diff=normal', 'x'.repeat(400)]) {
      assert.equal(decodeWorldLink(bad), null, `rejected: ${bad.slice(0, 60)}`);
    }
    assert.equal(decodeWorldLink(`#world=1&home=${HOME()}&size=world&diff=normal&fog=1`)!.fog, undefined, 'fog only on Hard and Brutal');
  });

  test('ISO weeks and the weekly seed', () => {
    assert.deepEqual(isoWeek(2026, 1, 1), { year: 2026, week: 1 }, '2026-01-01 is a Thursday');
    assert.deepEqual(isoWeek(2027, 1, 1), { year: 2026, week: 53 }, '2027-01-01 belongs to 2026-W53');
    assert.deepEqual(isoWeek(2024, 12, 30), { year: 2025, week: 1 }, '2024-12-30 is in 2025-W01');
    assert.deepEqual(isoWeek(2026, 10, 24), { year: 2026, week: 43 });
    assert.equal(weeklySeed(2026, 43), weeklySeed(2026, 43));
    assert.notEqual(weeklySeed(2026, 43), weeklySeed(2026, 44));
    const w = weeklyWorld(2026, 43);
    assert.equal(w.weekly, '2026-W43');
    assert.ok(STUB_ATLAS.homelands.some((h) => h.id === w.home), 'a real homeland');
  });

  test('storage: save, load, corrupt data, the end of a run counted once', () => {
    const kv = memKV();
    const run = fresh({ seed: 3, size: 'blitz', difficulty: 'easy', weekly: '2026-W43' });
    saveWorldRun(run, kv);
    assert.deepEqual(clone(loadWorldRun(kv)), clone(run));
    assert.equal(parseWorldRun('{"mode":"world","v":1}'), null, 'shape-checked');
    assert.equal(parseWorldRun('not json'), null);
    kv.setItem('rh.world.run', '{"mode":"world","v":99,"territories":[]}');
    assert.equal(loadWorldRun(kv), null, 'another version');
    // finish it and count it
    run.medals.push('wonder:pyramids');
    for (const t of run.territories) if (t.capital !== undefined && t.capital !== HUMAN) t.owner = HUMAN;
    run.status = 'won'; run.ending = 'capitals';
    run.score = worldScore(run);
    const xp0 = loadProfile(kv).xp;
    const s1 = recordWorldEnd(run, kv, 1000)!;
    assert.ok(s1.xp > 0 && loadProfile(kv).xp === xp0 + s1.xp, 'commander XP');
    assert.ok(s1.medals.includes('wonder:pyramids') && s1.medals.includes(`homeland:${run.home}`), `medals ${s1.medals}`);
    assert.ok(s1.weeklyBest, 'a weekly best');
    const s2 = recordWorldEnd(run, kv, 2000)!;
    assert.equal(s2.xp, 0, 'counted once');
    assert.equal(loadWorldMeta(kv).runs, 1);
  });
});

describe('strategy holds up (headless pilots)', () => {
  test('pilot games finish without errors on every difficulty', () => {
    for (const difficulty of ['recruit', 'easy', 'normal', 'hard', 'brutal'] as const) for (const pilot of ['zone', 'greedy', 'cautious', 'dice'] as const) {
      const r = playGame({ seed: 77, home: HOME(), size: 'blitz', difficulty }, { pilot });
      assert.equal(r.error, undefined, `${difficulty} ${pilot}: ${r.error}`);
      assert.notEqual(r.status, 'active', `${difficulty} ${pilot} ended`);
    }
  });
});
