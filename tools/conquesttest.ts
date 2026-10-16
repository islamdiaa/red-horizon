// Headless Conquest battles with autopilots.
//   node --import tsx tools/conquesttest.ts [kind|all] [seed=7] [faction=allies] [minutes=25] [-v]
import { resolveBattle } from '../src/conquest/run';
import { BATTLE_KINDS, type BattleKind } from '../src/conquest/battle';
import { runConquestBattle } from './conquest-harness';

export { runWithBattle } from '../src/conquest/testing';
import { runWithBattle } from '../src/conquest/testing';

const isMain = process.argv[1]?.endsWith('conquesttest.ts');
if (isMain) {
  const arg = process.argv[2] ?? 'all';
  const seed = +(process.argv[3] ?? 7);
  const faction = (process.argv[4] ?? 'allies') as 'allies' | 'soviet';
  const minutes = +(process.argv[5] ?? 25);
  const kinds = arg === 'all' ? BATTLE_KINDS : [arg as BattleKind];
  for (const kind of kinds) {
    const t0 = performance.now();
    const { run, setup } = runWithBattle(seed, faction, kind);
    const S = setup.battle;
    const r = runConquestBattle(setup, minutes);
    const ms = performance.now() - t0;
    console.log(`${kind.padEnd(8)} ${S.name.padEnd(12)} ${S.mapLabel.padEnd(20)} str ${S.strength} ${S.ai.padEnd(6)} ${S.personality.padEnd(11)} → ${r.error ? 'ERROR' : r.ended ? (r.won ? 'WIN ' : 'LOSE') : 'TIMEOUT'} ${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')} ${r.reason ?? ''} | ${r.objectives.join(' ')} [${(ms / 1000).toFixed(1)}s]`);
    if (r.error) console.log(r.error);
    const rep = resolveBattle(run, r.outcome);
    if (process.argv.includes('-v') && rep) console.log('   report', JSON.stringify({ captured: rep.captured, lost: rep.lost, loot: rep.loot, rp: rep.rp, returned: rep.returned, vets: rep.veterans.map((v) => `${v.name}:${v.fate}`) }));
  }
}
