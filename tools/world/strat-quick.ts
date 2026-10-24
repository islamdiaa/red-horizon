// Quick serial matrix (no workers): pilots x difficulties x sizes over N seeds, homelands spread over the atlas.
//   node --import tsx tools/world/strat-quick.ts [--n 40] [--sizes blitz,world] [--pilots zone,greedy,cautious,dice] [--skill casual]
import { atlas } from '../../src/conquest/world/run';
import { playGame, rate, type PilotId, type Skill } from './strat-lib';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const n = +arg('n', '40');
const sizes = arg('sizes', 'blitz,world').split(',') as ('blitz' | 'world')[];
const pilots = arg('pilots', 'zone,greedy,cautious,dice').split(',') as PilotId[];
const diffs = arg('diffs', 'recruit,easy,normal,hard,brutal').split(',') as any[];
const skill = arg('skill', 'casual') as Skill;
const homes = atlas().homelands;
console.log(`| size | diff | ${pilots.join(' | ')} | turns (zone, won) | rival elim / game |`);
console.log(`|---|---|${pilots.map(() => '---').join('|')}|---|---|`);
for (const size of sizes) for (const difficulty of diffs) {
  const cells: string[] = [];
  let turns: number[] = [], elim = 0, games = 0;
  for (const pilot of pilots) {
    let w = 0;
    for (let s = 0; s < n; s++) {
      const r = playGame({ seed: 1000 + s * 7, home: homes[(s * 7) % homes.length].id, size, difficulty }, { pilot, skill });
      if (r.error) console.error(r.error.slice(0, 400));
      if (r.status === 'won') { w++; if (pilot === 'zone') turns.push(r.turns); }
      if (pilot === 'zone') { elim += r.eliminated.filter((e) => e.turn !== null).length; games++; }
    }
    cells.push(rate(w, n));
  }
  turns.sort((a, b) => a - b);
  console.log(`| ${size} | ${difficulty} | ${cells.join(' | ')} | ${turns.length ? `${turns[0]}-${turns[Math.floor(turns.length / 2)]}-${turns[turns.length - 1]}` : '-'} | ${(elim / games).toFixed(1)} |`);
}
