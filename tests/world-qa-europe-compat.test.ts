// World Conquest QA: the Europe Conquest stays playable and its saved runs keep loading (round 6 contract). The
// fixture holds two runs saved by round 5 (simulation version 7, tools/world/fixtures/europe-run-v7.json): one
// between battles, one with a battle committed (a player who quit mid-battle resumes it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadRun, saveRun } from '../src/conquest/storage';
import { availableBattles, pendingSetup, resolveBattle, startBattle } from '../src/conquest/run';
import { conquestMission, type BattleOutcome } from '../src/conquest/battle';
import type { ConquestRun } from '../src/conquest/state';

const FIX = JSON.parse(readFileSync(new URL('../tools/world/fixtures/europe-run-v7.json', import.meta.url), 'utf8')) as { idle: ConquestRun; pending: ConquestRun };
const kvWith = (run: unknown) => { const m = new Map<string, string>([['rh.conquest.run', JSON.stringify(run)]]); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };

const win = (spec: { id: string; core: { vet: number; rank: number; xp: number }[] }): BattleOutcome => ({
  battleId: spec.id, won: true, time: 600, creditsLeft: 2000,
  objectives: [{ id: 'main', text: 'Primary objective', primary: true, state: 'done' }],
  survivors: spec.core.map((c) => ({ vet: c.vet, rank: c.rank, xp: c.xp + 100 })), recruits: [], kills: 20, losses: 4, superweaponDestroyed: false,
});

test('a round-5 Europe Conquest run between battles loads and plays on', () => {
  const run = loadRun(kvWith(FIX.idle) as never);
  assert.ok(run, 'the saved run loads');
  assert.equal(run!.status, 'active', 'still active');
  const opts = availableBattles(run!);
  assert.ok(opts.length > 0, 'it offers battles');
  const setup = startBattle(run!, opts[0].target, Math.min(run!.warChest, 3000));
  const def = conquestMission(setup);
  assert.ok(def.players.length >= 2 && def.map, 'the battle builds a mission');
  resolveBattle(run!, win(setup.battle));
  assert.ok(saveRun(run!, kvWith(null) as never), 'and saves again');
});

test('a round-5 Europe Conquest run saved mid-battle resumes that battle', () => {
  const run = loadRun(kvWith(FIX.pending) as never);
  assert.ok(run, 'the saved run loads');
  const setup = pendingSetup(run!);
  assert.ok(setup, 'its committed battle is still there');
  const def = conquestMission(setup!);
  assert.ok(def.players.length >= 2, 'the committed battle builds a mission');
  const report = resolveBattle(run!, win(setup!.battle));
  assert.ok(report, 'the battle result is applied');
});
