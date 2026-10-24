/**
 * World Conquest strategy holds up (headless pilots on the real geography, fixed seeds, so deterministic): a
 * zone-focused player beats a greedy one, the difficulty levels are ordered, and every game ends. The full tables
 * with 95% Wilson intervals come from tools/world/strat-bench.ts; this is the regression guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEO_ATLAS, HUMAN, NEUTRAL, attackKind, attackTargets, autoPlace, endPhase, ix, newWorldRun, setAtlas, atlas } from '../src/conquest/world/index';
import { playGame, type PilotId } from '../tools/world/strat-lib';

const homes = () => atlas().homelands;
function wins(n: number, size: 'world' | 'blitz', difficulty: 'recruit' | 'easy' | 'normal' | 'hard' | 'brutal', pilot: PilotId, diceOnly = false) {
  let w = 0;
  for (let k = 0; k < n; k++) {
    const r = playGame({ seed: 1000 + k * 7, home: homes()[(k * 7) % homes().length].id, size, difficulty }, { pilot, diceOnly });
    assert.equal(r.error, undefined, `${size} ${difficulty} ${pilot} seed ${1000 + k * 7}: ${r.error}`);
    assert.notEqual(r.status, 'active', `${size} ${difficulty} ${pilot} seed ${1000 + k * 7} ended`);
    if (r.status === 'won') w++;
  }
  return w;
}

test('a zone-focused player beats a greedy one (World, Normal, fighting key battles)', () => {
  setAtlas(GEO_ATLAS);
  const zone = wins(30, 'world', 'normal', 'zone'), greedy = wins(30, 'world', 'normal', 'greedy');
  assert.ok(zone > greedy, `zone ${zone}/30 vs greedy ${greedy}/30`);
});

test('the levels are ordered: Recruit > Normal > Brutal (Blitz, zone-focused, fighting key battles)', () => {
  setAtlas(GEO_ATLAS);
  const r = wins(20, 'blitz', 'recruit', 'zone'), n = wins(20, 'blitz', 'normal', 'zone'), b = wins(20, 'blitz', 'brutal', 'zone');
  assert.ok(r > n && n > b, `recruit ${r}/20, normal ${n}/20, brutal ${b}/20`);
  assert.ok(r >= 16, `Recruit is winnable for a sensible player (${r}/20)`);
});

test('every homeland has a land battle to fight in turn 1 (islands land on a neutral coast; naval battles are for rivals)', () => {
  setAtlas(GEO_ATLAS);
  for (const size of ['world', 'blitz'] as const) for (const h of homes()) {
    const run = newWorldRun({ seed: 3, home: h.id, size, difficulty: 'easy' });
    autoPlace(run); endPhase(run);
    const kinds = attackTargets(run).map((a) => attackKind(run, a.from, a.to));
    assert.ok(kinds.some((k) => k !== 'naval'), `${size} ${h.id}: turn-1 battles ${kinds.join(',') || 'none'}`);
  }
  // across a sea lane: a neutral coast is a landing, a rival's is a naval battle
  const run = newWorldRun({ seed: 3, home: 'britain', size: 'world', difficulty: 'easy' });
  const X = ix(run), T = run.territories;
  const a = T.findIndex((t, i) => t.owner === HUMAN && X.adj[i].some((n, k) => X.sea[i][k] && T[n].capital === undefined));
  const b = X.adj[a].find((n, k) => X.sea[a][k] && T[n].capital === undefined)!;
  T[b].owner = NEUTRAL; T[b].landmark = undefined;
  assert.notEqual(attackKind(run, T[a].id, T[b].id), 'naval', 'a neutral coast: a landing');
  T[b].owner = 1;
  assert.equal(attackKind(run, T[a].id, T[b].id), 'naval', "a rival's coast: a naval battle");
});
