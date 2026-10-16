// Round-5 strategic AI: intel without map-hack, scouting, counter-composition, retreats, personalities,
// determinism with personalities, and the persistent rivals (src/meta/rivals.ts).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Faction } from '../src/data/rules';
import { generateMap } from '../src/sim/mapgen';
import { World } from '../src/sim/world';
import { AIController, type AIDifficulty } from '../src/sim/ai';
import { PERSONALITIES, resolvePersonality, trait, withTweaks, type Personality } from '../src/sim/ai-personality';
import { counterWeights } from '../src/sim/ai-counter';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import {
  counterPlan, defaultRivals, ensureRoster, habitsFor, loadRivals, nemesisOf, prepareRivalOpponent, recordHabits, recordRivalBattle, saveRivals,
  RIVALS_KEY, type MatchHabits,
} from '../src/meta/rivals';
import type { KV } from '../src/meta/profile';
import { building, run, sandbox, seconds, stateHash, unit, powerUp } from './helpers';

/** A generated skirmish with AI personalities (players get factions alternately). */
function match(opts: { seed: number; size?: number; ai: AIDifficulty[]; pers?: (string | Personality | undefined)[]; factions?: Faction[]; sea?: boolean; fog?: boolean }): World {
  const n = opts.ai.length;
  const map = generateMap({ size: opts.size ?? 64, players: n, seed: opts.seed, water: opts.sea ? 1 : 0.5, trees: 0.5, ore: 0.6 });
  const factions = opts.factions ?? (['allies', 'soviet', 'allies', 'soviet'] as Faction[]);
  return new World({
    map, credits: 10000, startUnits: 'light', fog: opts.fog ?? true, seed: opts.seed,
    players: opts.ai.map((d, i) => ({ name: `P${i}`, faction: factions[i], color: 0, team: i, isHuman: false, ai: d, personality: opts.pers?.[i] })),
  });
}

const aiOf = (w: World, i: number) => w.ais.find((a) => a.player.id === i)!;

/** Every cell of a known structure's footprint was explored by its owner's side, or the AI could not know it. */
function knowledgeIsLegit(w: World, ai: AIController): string[] {
  const bad: string[] = [];
  const m = w.map, ex = ai.player.explored;
  for (const s of ai.intel.structures.values()) {
    let seen = false;
    for (let y = s.cy; y < s.cy + s.h && !seen; y++) for (let x = s.cx; x < s.cx + s.w; x++) if (ex[m.idx(x, y)]) { seen = true; break; }
    if (!seen) bad.push(`${s.type}#${s.id}`);
  }
  return bad;
}

class MemKV implements KV {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('strategic AI: intel and scouting (no map-hack)', () => {
  test('starts blind, scouts the enemy base and only knows what its side has seen', () => {
    const w = match({ seed: 7, ai: ['normal', 'normal'] });
    run(w, 10);
    for (const ai of w.ais) assert.equal(ai.intel.structures.size, 0, `P${ai.player.id} knows no enemy structure at the start`);
    let foundAt = -1;
    for (let t = 0; t < seconds(420) && foundAt < 0; t++) {
      w.step();
      w.events.length = 0;
      if (aiOf(w, 0).intel.foundTick >= 0) foundAt = w.time;
    }
    assert.ok(foundAt > 0, 'the enemy base was found within 7 minutes');
    for (const ai of w.ais) assert.deepEqual(knowledgeIsLegit(w, ai), [], `P${ai.player.id} knows only explored structures`);
    const scouted = aiOf(w, 0).chatter.some((c) => c.kind === 'scouted');
    assert.ok(scouted || aiOf(w, 0).chatter.some((c) => c.kind === 'attack'), 'scout report or an attack on what was found');
  });

  test('a structure hidden in an unexplored corner is unknown (and never an attack target) until seen', () => {
    const w = match({ seed: 11, ai: ['hard', 'hard'] });
    const enemy = w.players[1];
    const m = w.map;
    // an enemy power plant far from both bases on open ground
    let spot: [number, number] | null = null;
    for (let r = 0; r < 20 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r; dx++) {
      const cx = 3 + dx + r, cy = m.h - 6 - r + dy;
      if (cx < 1 || cy < 1 || cx > m.w - 3 || cy > m.h - 3) continue;
      if (m.buildable(cx, cy) && m.buildable(cx + 1, cy) && m.buildable(cx, cy + 1) && m.buildable(cx + 1, cy + 1)) { spot = [cx, cy]; break; }
    }
    assert.ok(spot, 'found a spot');
    const hidden = building(w, 'powr', enemy, spot![0], spot![1]);
    const ai = aiOf(w, 0);
    let wasTarget = false;
    for (let t = 0; t < seconds(120); t++) {
      w.step();
      w.events.length = 0;
      const seen = ai.player.explored[m.idx(hidden.cx, hidden.cy)] || ai.player.explored[m.idx(hidden.cx + 1, hidden.cy + 1)];
      if (!seen) {
        assert.ok(!ai.intel.structures.has(hidden.id), 'unexplored structure is unknown');
        const tgt = ai.pickAttackTarget();
        if (tgt && Math.hypot(tgt[0] - hidden.x, tgt[1] - hidden.y) < 2) wasTarget = true;
      }
    }
    assert.ok(!wasTarget, 'never picked as an attack target while unexplored');
  });

  test('fog-free games and missions keep the classic all-seeing AI', () => {
    const w = match({ seed: 3, ai: ['normal', 'normal'], fog: false });
    run(w, 30);
    assert.ok(aiOf(w, 0).intel.omniscient, 'omniscient without fog');
    assert.ok(aiOf(w, 0).intel.structures.size > 0, 'knows the enemy base at once');
  });
});

describe('strategic AI: counter-composition', () => {
  test('rocket soldiers are favoured against armour, small arms against infantry, AA against aircraft', () => {
    const s = sandbox({ ai: ['hard', undefined], factions: ['allies', 'soviet'], fog: false });
    const { world, p0, p1 } = s;
    building(world, 'fact', p0, 4, 4);
    powerUp(world, p0, 4, 10, 1);
    building(world, 'tent', p0, 10, 4);
    building(world, 'proc', p0, 14, 4);
    building(world, 'weap', p0, 4, 16);
    const ai = aiOf(world, 0);
    const mix: string[] = ['e1', 'e3', 'dog'];
    // enemy armour column
    const tanks = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => unit(world, '3tnk', p1, 30.5 + (k % 4), 30.5 + Math.floor(k / 4)));
    ai.intel.update();
    const vsArmour = counterWeights(mix, ai.intel, 1.5);
    assert.ok(vsArmour.get('dog')! < vsArmour.get('e3')!, `vs armour: dogs (can't bite tanks) ${vsArmour.get('dog')!.toFixed(2)} < rockets ${vsArmour.get('e3')!.toFixed(2)}`);
    for (const t of tanks) world.kill(t);
    run(world, 2);
    ai.intel.units.clear();
    // enemy infantry horde
    for (let k = 0; k < 30; k++) unit(world, 'e1', p1, 30.5 + (k % 6) * 0.5, 30.5 + Math.floor(k / 6) * 0.5);
    ai.intel.update();
    const vsInf = counterWeights(['e1', 'e3', 'dog'], ai.intel, 1.5);
    assert.ok(vsInf.get('e3')! < vsInf.get('e1')!, `vs infantry: e3 ${vsInf.get('e3')!.toFixed(2)} < e1 ${vsInf.get('e1')!.toFixed(2)}`);
    assert.ok(vsInf.get('e3')! / vsInf.get('e1')! < vsArmour.get('e3')! / vsArmour.get('e1')!, 'rockets rate relatively higher against armour than against infantry');
    // the AI's own production mix follows
    const before = ai.mix([['e1', 45], ['e3', 35]]);
    assert.ok(before[0][1] / before[1][1] > 45 / 35, 'AI mix shifts towards riflemen against an infantry horde');
    // aircraft: only units with anti-air weapons count
    ai.intel.units.clear();
    for (let k = 0; k < 6; k++) unit(world, 'hind', p1, 20.5 + k, 20.5);
    ai.intel.update();
    const vsAir = counterWeights(['e1', 'e3', '2tnk'], ai.intel, 1.5);
    assert.ok(vsAir.get('e3')! > vsAir.get('2tnk')! && vsAir.get('e3')! > vsAir.get('e1')!, `vs air: rockets first (${[...vsAir].map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')})`);
  });

  test('anti-aircraft defences go up once enemy aircraft have been seen', () => {
    const s = sandbox({ ai: ['hard', undefined], factions: ['soviet', 'allies'], fog: false, credits: 20000 });
    const { world, p0, p1 } = s;
    building(world, 'fact', p0, 4, 4);
    powerUp(world, p0, 4, 10, 3);
    building(world, 'barr', p0, 10, 4);
    building(world, 'proc', p0, 14, 4);
    building(world, 'weap', p0, 4, 16);
    building(world, 'dome', p0, 18, 10);
    for (let k = 0; k < 3; k++) unit(world, 'heli', p1, 40.5 + k, 40.5);
    let sam = false;
    for (let t = 0; t < seconds(90) && !sam; t++) {
      world.step();
      world.events.length = 0;
      sam = world.buildings.some((b) => b.owner === p0 && b.bt.id === 'sam') || p0.queues.structure.items.some((i) => i.type === 'sam') || p0.queues.structure.ready === 'sam';
    }
    assert.ok(sam, 'a SAM site is built or queued');
  });
});

describe('strategic AI: tactics', () => {
  test('badly damaged vehicles leave the assault for the service depot', () => {
    const s = sandbox({ ai: ['hard', undefined], factions: ['allies', 'soviet'], fog: false, w: 64, h: 64 });
    const { world, p0, p1 } = s;
    building(world, 'fact', p0, 4, 4);
    powerUp(world, p0, 4, 10, 2);
    const fix = building(world, 'fix', p0, 10, 4);
    building(world, 'proc', p1, 50, 50);
    const tanks = [0, 1, 2, 3, 4].map((k) => unit(world, '2tnk', p0, 36.5 + k, 36.5));
    const ai = aiOf(world, 0);
    ai.state = 'attack';
    ai.stage = 'assault';
    ai.wave = new Set(tanks.map((t) => t.id));
    ai.waveStart = 5;
    ai.waveValueStart = 4000;
    ai.stageTarget = [51, 52];
    tanks[0].hp = tanks[0].maxHp * 0.15;
    run(world, seconds(3));
    assert.ok(ai.repairs.has(tanks[0].id), 'the wreck is pulled out for repairs');
    assert.ok(!ai.wave.has(tanks[0].id), 'and leaves the wave');
    run(world, seconds(25));
    assert.ok(tanks[0].alive && (tanks[0].order.type === 'enter' || fix.distTo(tanks[0].x, tanks[0].y) < 6 || tanks[0].hp > tanks[0].maxHp * 0.15), 'heading for (or at) the depot');
  });

  test('harassment raids and expansions happen for the personalities that like them', () => {
    const w = match({ seed: 21, size: 96, ai: ['hard', 'hard'], pers: ['guerrilla', 'tycoon'] });
    let raid = false, expand = false;
    for (let t = 0; t < seconds(16 * 60) && !(raid && expand); t++) {
      w.step();
      w.events.length = 0;
      if (t % 200 === 0) {
        raid ||= aiOf(w, 0).chatter.some((c) => c.kind === 'harass');
        expand ||= aiOf(w, 1).expansions > 0 || aiOf(w, 1).chatter.some((c) => c.kind === 'expand');
      }
      if (w.gameOver) break;
    }
    assert.ok(raid, 'the guerrilla raids');
    assert.ok(expand, 'the tycoon expands');
  });
});

describe('commander personalities', () => {
  test('ten-plus distinct personalities; the default is balanced (neutral traits)', () => {
    const ids = Object.keys(PERSONALITIES);
    assert.ok(ids.length >= 10, `${ids.length} personalities`);
    const b = resolvePersonality(undefined);
    assert.equal(b.id, 'balanced');
    // (subterfuge was tuned down by self-play; everything else is neutral)
    for (const k of ['aggression', 'tech', 'air', 'naval', 'defence', 'harass', 'economy', 'infantry', 'artillery', 'superweapons', 'caution'] as const) assert.equal(b[k], 0.5, `${k} neutral`);
    assert.equal(trait(0.5, 0.2, 3), 1, 'neutral trait = multiplier 1');
    const t = withTweaks(PERSONALITIES.rusher, { traits: { aggression: 0.5 } });
    assert.equal(t.aggression, 1, 'tweaks clamp to 1');
    assert.notEqual(PERSONALITIES.rusher.aggression, 1, 'base untouched');
  });

  test('personalities play measurably differently from the same start', () => {
    const probe = (pers: string) => {
      const w = match({ seed: 5, size: 64, ai: ['normal', 'easy'], pers: [pers, 'balanced'] });
      const types = new Map<number, string>();
      let firstAttack = -1;
      for (let t = 0; t < seconds(12 * 60); t++) {
        w.step();
        w.events.length = 0;
        if (t % 20 === 0) for (const u of w.units) if (u.owner.id === 0 && !types.has(u.id)) types.set(u.id, u.ut.id);
        if (firstAttack < 0 && aiOf(w, 0).chatter.some((c) => c.kind === 'attack')) firstAttack = w.time;
        if (w.gameOver) break;
      }
      const p0 = w.players[0];
      const defences = w.buildings.filter((b) => b.owner === p0 && b.weapons.length).length;
      const count = (ids: string[]) => [...types.values()].filter((t) => ids.includes(t)).length;
      return { defences, firstAttack: firstAttack < 0 ? 1e9 : firstAttack, tanks: count(['1tnk', '2tnk', '3tnk', '4tnk']), air: count(['heli', 'hind', 'mig', 'yak']), arty: count(['arty', 'v2rl']), inf: count(['e1', 'e2', 'e3', 'e4']) };
    };
    const turtle = probe('turtle'), rusher = probe('rusher'), air = probe('airmarshal'), siege = probe('siege'), horde = probe('horde');
    assert.ok(turtle.defences > rusher.defences, `turtle builds more defences (${turtle.defences} vs ${rusher.defences})`);
    assert.ok(rusher.firstAttack < turtle.firstAttack, `rusher attacks earlier (${rusher.firstAttack.toFixed(0)} s vs ${turtle.firstAttack.toFixed(0)} s)`);
    assert.ok(air.air > rusher.air, `air marshal fields more aircraft (${air.air} vs ${rusher.air})`);
    assert.ok(siege.arty > rusher.arty, `siege master fields more artillery (${siege.arty} vs ${rusher.arty})`);
    assert.ok(horde.inf > rusher.inf, `human wave fields more infantry (${horde.inf} vs ${rusher.inf})`);
  });

  test('same seed and personalities => identical game; save / load mid-game continues identically', () => {
    const mk = () => match({ seed: 31, size: 64, ai: ['hard', 'hard'], pers: ['guerrilla', withTweaks(PERSONALITIES.turtle, { traits: { aggression: 0.2 } })] });
    const a = mk(), b = mk();
    run(a, seconds(7 * 60));
    run(b, seconds(7 * 60));
    assert.equal(stateHash(a), stateHash(b), 'same seed, same game');
    const c = mk();
    deserializeWorld(c, JSON.parse(JSON.stringify(serializeWorld(a))));
    assert.equal(aiOf(c, 0).personality.id, 'guerrilla', 'personality comes from the setup');
    assert.deepEqual(JSON.stringify(aiOf(c, 1).saveState()), JSON.stringify(aiOf(a, 1).saveState()), 'AI state restored');
    for (let t = 0; t < seconds(120); t++) {
      a.step(); a.events.length = 0;
      c.step(); c.events.length = 0;
    }
    assert.equal(stateHash(c), stateHash(a), 'restored game continues identically');
  });
});

describe('persistent rivals', () => {
  const habits = (over: Partial<MatchHabits> = {}): MatchHabits => ({
    built: { '2tnk': 8000, e1: 1000 }, infantry: 1000, armour: 8000, artillery: 0, air: 0, naval: 0, defenceValue: 600, structureValue: 9000,
    rushMinute: 5, superweapons: 0, subterfuge: 0, ...over,
  });

  test('the roster is generated, persisted and reloaded', () => {
    const kv = new MemKV();
    const store = defaultRivals();
    ensureRoster(store, 1000);
    assert.equal(store.rivals.filter((r) => r.status === 'active').length, 4, 'four active rivals');
    assert.ok(new Set(store.rivals.map((r) => r.personality)).size === 4, 'distinct personalities');
    assert.ok(store.nemesis, 'a nemesis is chosen');
    saveRivals(store, kv);
    assert.ok(kv.getItem(RIVALS_KEY), 'stored under rh.rivals');
    const again = loadRivals(kv);
    assert.deepEqual(again.rivals.map((r) => r.id), store.rivals.map((r) => r.id), 'same roster after reload');
    assert.equal(loadRivals(new MemKV()).rivals.length, 0, 'empty store for a new profile');
  });

  test('a rival studies your habits and picks a counter-plan before the match', () => {
    const store = defaultRivals();
    ensureRoster(store, 1000);
    const r = nemesisOf(store)!;
    const blank = counterPlan(r, habitsFor(store, r));
    assert.ok(blank.notes[0].includes('no file'), 'no history: no counter-plan');
    for (let k = 0; k < 3; k++) recordHabits(store, habits());
    const plan = counterPlan(r, habitsFor(store, r));
    assert.ok(plan.notes.some((n) => n.includes('armour')), `counters a tank-heavy player (${plan.notes.join(' / ')})`);
    assert.ok(plan.notes.some((n) => n.includes('rush')), 'braces for an early rush');
    const prep = prepareRivalOpponent(store, r.id, 'Tester')!;
    assert.ok(prep.personality.prefer?.e3 && prep.personality.prefer.e3 > 1, 'rocket soldiers preferred');
    assert.ok(prep.personality.defence > resolvePersonality(r.personality).defence, 'more defences than its base personality');
    assert.ok(prep.rival.intro.length > 10, 'a pre-battle line is chosen');
    // the setup is plain JSON (replays / saves)
    assert.deepEqual(JSON.parse(JSON.stringify(prep)), prep, 'serialisable');
  });

  test('winning rivals are promoted, beaten ones demoted or killed, and new rivals rise', () => {
    const store = defaultRivals();
    ensureRoster(store, 1000);
    const r = nemesisOf(store)!;
    const w1 = recordRivalBattle(store, r.id, { rivalWon: true, minutes: 18, playerFaction: 'allies', habits: habits(), now: 2000 })!;
    assert.ok(w1.promoted && r.rank === 1 && r.wins === 1, 'promoted after a win');
    recordRivalBattle(store, r.id, { rivalWon: true, minutes: 9, playerFaction: 'allies', now: 3000 });
    assert.equal(r.rank, 2, 'promoted again');
    assert.ok(r.titles.length >= 1, `earned a title (${r.titles.join(', ')})`);
    const l1 = recordRivalBattle(store, r.id, { rivalWon: false, minutes: 25, playerFaction: 'allies', now: 4000 })!;
    assert.ok(l1.demoted || l1.killed, 'a defeat costs rank or life');
    if (!l1.killed) recordRivalBattle(store, r.id, { rivalWon: false, minutes: 20, playerFaction: 'allies', now: 5000 });
    assert.equal(r.status, 'dead', 'two defeats in a row: killed in action');
    assert.equal(store.rivals.filter((x) => x.status === 'active').length, 4, 'a new rival rose to fill the roster');
    assert.equal(r.history.length, 4, 'history kept');
    // the fallen may return, scarred
    let returned = false;
    for (let k = 0; k < 30 && !returned; k++) {
      const victim = store.rivals.find((x) => x.status === 'active' && x.id !== r.id)!;
      victim.status = 'dead';
      ensureRoster(store, 6000 + k);
      returned = r.status === 'active' && r.returns > 0;
    }
    assert.ok(returned, 'a dead rival comes back');
    assert.ok(r.traits.includes('Scarred') && r.titles.includes('the Returned'), 'scarred and titled');
  });
});
