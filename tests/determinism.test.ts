// Determinism: same seed + same command stream => bit-identical world state, which is what
// replays and lockstep multiplayer need. Also guards against hidden sources of nondeterminism.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BUILDINGS } from '../src/data/rules';
import type { Command } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { skirmish, stateHash, sandbox, unit, run, seconds, TICK_HZ } from './helpers';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * A scripted "human" player 0 (deploy, build a small base, train an army, attack) against a
 * normal AI. The script only reads world state, so it is itself deterministic.
 */
function scriptedHuman(world: World, log?: { tick: number; cmd: Command }[]) {
  const p = world.players[0];
  const enemyStart = world.map.startPositions[1];
  const order = ['powr', 'proc', 'tent', 'powr', 'weap', 'powr'];
  let built = 0;
  const issue = (cmd: Command) => { log?.push({ tick: world.tick, cmd }); world.issue(cmd); };
  return () => {
    const t = world.tick;
    if (t === 1) {
      const mcv = world.units.find((u) => u.owner === p && u.ut.deploysInto)!;
      issue({ c: 'deploy', player: p.id, units: [mcv.id] });
    }
    const q = p.queues.structure;
    if (p.has('fact') && !q.items.length && !q.ready && built < order.length && p.canBuild(order[built])) {
      issue({ c: 'build', player: p.id, type: order[built] });
    }
    if (q.ready) {
      const fact = world.buildings.find((b) => b.owner === p && b.bt.id === 'fact')!;
      const bt = BUILDINGS[q.ready];
      search: for (let r = 2; r < 12; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = fact.cx + dx * 2, cy = fact.cy + dy * 2;
          if (world.canPlace(p, bt.id, cx, cy)) { issue({ c: 'place', player: p.id, type: bt.id, cx, cy }); built++; break search; }
        }
      }
    }
    if (t % (TICK_HZ * 10) === 0) {
      if (p.canBuild('e1')) issue({ c: 'build', player: p.id, type: 'e1', count: 3 });
      if (p.canBuild('2tnk') && !p.queues.vehicle.items.length) issue({ c: 'build', player: p.id, type: '2tnk' });
    }
    if (t % (TICK_HZ * 60) === 0 && t >= TICK_HZ * 150) {
      const army = world.units.filter((u) => u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
      if (army.length) issue({ c: 'move', player: p.id, units: army, x: enemyStart.x, y: enemyStart.y, attackMove: true });
    }
  };
}

function scriptedGame(seed: number, ticks: number, every = 600) {
  const world = skirmish({ seed, size: 64, ai: [undefined, 'normal'] });
  const log: { tick: number; cmd: Command }[] = [];
  const script = scriptedHuman(world, log);
  const hashes: string[] = [];
  for (let t = 1; t <= ticks; t++) {
    script();
    world.step();
    world.events.length = 0;
    if (t % every === 0) hashes.push(stateHash(world));
  }
  return { world, hashes, log };
}

describe('determinism', () => {
  const TICKS = seconds(240);

  test('same seed + same scripted commands => identical state hashes', () => {
    const a = scriptedGame(2024, TICKS);
    const b = scriptedGame(2024, TICKS);
    assert.ok(a.log.length > 10, `script issued commands (${a.log.length})`);
    assert.ok(a.world.buildings.filter((x) => x.owner.id === 0).length >= 4, 'scripted player built a base');
    assert.deepEqual(b.hashes, a.hashes);
  });

  test('replaying a recorded command log reproduces the game exactly', () => {
    const live = scriptedGame(77, TICKS);
    // fresh world, no script: feed the recorded commands back on the same ticks
    const world = skirmish({ seed: 77, size: 64, ai: [undefined, 'normal'] });
    const byTick = new Map<number, Command[]>();
    for (const { tick, cmd } of live.log) byTick.set(tick, [...(byTick.get(tick) ?? []), structuredClone(cmd)]);
    const hashes: string[] = [];
    for (let t = 1; t <= TICKS; t++) {
      for (const c of byTick.get(world.tick) ?? []) world.issue(c);
      world.step();
      world.events.length = 0;
      if (t % 600 === 0) hashes.push(stateHash(world));
    }
    assert.deepEqual(hashes, live.hashes);
  });

  test('two worlds stepped interleaved match the same worlds stepped one after another', () => {
    const sequential = [scriptedGame(5, seconds(120), 200).hashes, scriptedGame(6, seconds(120), 200).hashes];
    const wa = skirmish({ seed: 5, size: 64, ai: [undefined, 'normal'] });
    const wb = skirmish({ seed: 6, size: 64, ai: [undefined, 'normal'] });
    const sa = scriptedHuman(wa), sb = scriptedHuman(wb);
    const ha: string[] = [], hb: string[] = [];
    for (let t = 1; t <= seconds(120); t++) {
      sa(); wa.step(); wa.events.length = 0;
      sb(); wb.step(); wb.events.length = 0;
      if (t % 200 === 0) { ha.push(stateHash(wa)); hb.push(stateHash(wb)); }
    }
    assert.deepEqual(ha, sequential[0], 'world A unaffected by world B');
    assert.deepEqual(hb, sequential[1], 'world B unaffected by world A');
  });

  test('AI vs AI games are reproducible from the seed alone', () => {
    const play = () => {
      const w = skirmish({ seed: 31337, size: 64, ai: ['hard', 'normal'] });
      const hs: string[] = [];
      for (let t = 1; t <= seconds(420); t++) { w.step(); w.events.length = 0; if (t % 1200 === 0) hs.push(stateHash(w)); }
      return hs;
    };
    assert.deepEqual(play(), play());
  });

  test('the hash is sensitive: a different seed or one extra command diverges', () => {
    const a = scriptedGame(2024, seconds(60), 1200);
    const b = scriptedGame(2025, seconds(60), 1200);
    assert.notDeepEqual(a.hashes, b.hashes);
    const w1 = skirmish({ seed: 9, size: 64 }), w2 = skirmish({ seed: 9, size: 64 });
    const mcv = w2.units.find((u) => u.ut.deploysInto && u.owner.id === 0)!;
    assert.equal(stateHash(w1), stateHash(w2), 'identical before the command');
    w2.issue({ c: 'move', player: 0, units: [mcv.id], x: mcv.x + 3, y: mcv.y });
    run(w1, seconds(30));
    run(w2, seconds(30));
    assert.notEqual(stateHash(w1), stateHash(w2), 'moving the MCV before it deploys changes the game');
  });

  test('projectile ids are allocated per world', () => {
    const shoot = () => {
      const { world, p0, p1 } = sandbox();
      const tank = unit(world, '2tnk', p0, 10.5, 10.5);
      unit(world, '3tnk', p1, 14.5, 10.5);
      run(world, seconds(5));
      void tank;
      const ids: number[] = [];
      for (let k = 0; k < 400 && ids.length < 3; k++) {
        world.step();
        for (const p of world.projectiles) if (!ids.includes(p.id)) ids.push(p.id);
        world.events.length = 0;
      }
      return ids;
    };
    assert.deepEqual(shoot(), shoot());
  });
});

// ---------------------------------------------------------------------------
// Static guards
// ---------------------------------------------------------------------------

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.ts$/.test(f)) out.push(p);
  }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function scan(dirsOrFiles: string[], re: RegExp): string[] {
  const hits: string[] = [];
  for (const d of dirsOrFiles) {
    const abs = join(ROOT, d);
    let files: string[];
    try { files = statSync(abs).isDirectory() ? sources(abs) : [abs]; } catch { continue; }
    for (const f of files) {
      stripComments(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
        if (re.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
    }
  }
  return hits;
}

describe('determinism guards (static)', () => {
  test('simulation code never uses Math.random, Date.now or performance.now', () => {
    const hits = scan(['src/sim', 'src/data', 'src/core', 'src/missions'], /Math\.random|Date\.now|performance\.now|new Date\b/);
    assert.deepEqual(hits, []);
  });

  test('presentation code never consumes the simulation RNG', () => {
    const hits = scan(['src/render', 'src/ui', 'src/audio', 'src/game.ts', 'src/main.ts', 'src/cinematic.ts'], /world\.rng\b|\.world\.rng\b/);
    assert.deepEqual(hits, []);
  });

  test('simulation code does not import three.js or touch the DOM', () => {
    const hits = scan(['src/sim', 'src/data', 'src/core'], /from ['"]three|\bdocument\.|\bwindow\.|requestAnimationFrame/);
    assert.deepEqual(hits, []);
  });
});
