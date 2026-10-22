/**
 * One skirmish set up exactly as the game sets it up (a Quick Battle roll, or the ?autostart test setup), a stand-in
 * as the human, and snapshots of both sides at given minutes: what the AI spent its money on, what it fields, which
 * caps held. Used to reproduce reports such as "the Recruit AI had 36 units and flame towers at minute 7".
 *
 *   node --import tsx tools/selfplay/trace.ts [--qb 77 | --autostart 77] [--diff recruit] [--faction allies]
 *        [--vs newcomer|novice|casual|experienced] [--rules commander|classic] [--mut id,id] [--at 3,5,7,10,15,20]
 *        [--minutes 45] [--personality id] [--map <curated id> (with --autostart)] [--vs ai:<level>: AI against AI]
 */
import type { Faction } from '../../src/data/rules';
import type { AIDifficulty } from '../../src/sim/ai';
import { rollQuickBattle } from '../../src/modes/quickbattle';
import { playMatch, type MatchSpec, type SkirmishSetup } from './lib';
import type { StandInLevel } from './standin';
import { PERSONALITIES } from '../../src/sim/ai-personality';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const diff = opt('diff', 'recruit') as AIDifficulty;
const faction = opt('faction', 'allies') as Faction;
const vsArg = opt('vs', 'newcomer');
// (--vs ai:<level>: an AI in the human's seat, for AI-vs-AI traces)
const vs = vsArg as StandInLevel;
const slot0AI = vsArg.startsWith('ai:') ? vsArg.slice(3) as AIDifficulty : null;
const at = opt('at', '3,5,7,10,12,15,20,25,30').split(',').map(Number);
const minutes = +opt('minutes', '45');

let setup: SkirmishSetup;
if (args.includes('--autostart')) {
  // main.ts ?autostart=1&seed=N&ai=<diff>&rules=commander[&mut=..]: 96x96, light start units, temperate, day
  const seed = +opt('autostart', '77');
  const mut = opt('mut', '');
  setup = {
    faction, opponents: [{ faction: faction === 'allies' ? 'soviet' : 'allies', difficulty: diff }], mapSize: 96, water: 0.5, trees: 0.5, ore: 0.6,
    credits: 10000, startUnits: 'light', fog: true, timeOfDay: 'day', seed, climate: 'temperate',
    rules: opt('rules', 'commander') === 'commander' ? 'commander' : undefined, mutators: mut ? mut.split(',') : undefined,
    mapId: opt('map', '') || undefined, events: true,
  };
} else {
  const qb = +opt('qb', '77');
  setup = rollQuickBattle(qb, { faction, color: 0, quality: 'low' as never, skill: diff }) as SkirmishSetup;
  if (opt('rules', 'commander') === 'classic') setup = { ...setup, rules: undefined, events: undefined };
  if (args.includes('--mut')) setup = { ...setup, mutators: opt('mut', '').split(',').filter(Boolean) };
}
// (--tune k=v,k=v: AITuning overrides for every AI, e.g. proSiege=2)
const tuneArg = opt('tune', '');
const tuning = Object.fromEntries(tuneArg.split(',').filter(Boolean).map((kv: string) => { const [k, v] = kv.split('='); return [k, +v]; }));
const withTune = (pers: unknown) => (tuneArg ? { ...(typeof pers === 'object' && pers ? pers : PERSONALITIES[(pers as string) ?? 'balanced'] ?? PERSONALITIES.balanced), tuning } : pers);
if (tuneArg) setup = { ...setup, opponents: setup.opponents.map((o) => ({ ...o, personality: withTune(o.personality) as never })) };
if (args.includes('--personality')) setup = { ...setup, opponents: setup.opponents.map((o) => ({ ...o, personality: opt('personality', 'balanced') })) };
console.log('setup:', JSON.stringify({ ...setup, quick: undefined }));
const spec: MatchSpec = {
  id: 0, seed: setup.seed, map: 'land', setup, maxMinutes: minutes, trace: at,
  players: [slot0AI ? { faction, difficulty: slot0AI, label: 'ai0', personality: withTune(undefined) as never } : { faction, difficulty: 'normal', standin: vs, label: vs }, { faction: setup.opponents[0].faction as Faction, difficulty: diff, label: 'ai' }],
};
const r = playMatch(spec);
const fmt = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' ');
for (let i = 0; i < (r.players[0].trace?.length ?? 0); i++) {
  for (const p of r.players) {
    const s = p.trace![i];
    console.log(`${String(s.min).padStart(4)} min ${p.label.padEnd(9)} $${String(s.credits).padStart(5)} harv ${s.harvested} other ${s.otherIncome} spent ${s.spent} | army $${s.army} (${s.armyN}) air $${s.air} naval $${s.naval} def ${s.defences} | bs ${s.buildSpeed} inc ${s.incomeBias}${s.waves !== undefined ? ` waves ${s.waves} ${s.state}` : ''}${s.dyn !== undefined ? ` dyn ${s.dyn}` : ''}`);
    console.log(`           units: ${fmt(s.units)}`);
    console.log(`           structures: ${fmt(s.structures)}`);
  }
}
for (const p of r.players) {
  console.log(`${p.label}: ${p.won ? 'WON' : p.defeated ? 'lost' : '-'} built ${fmt(p.built)}; structures ${fmt(p.structures)}; harvested ${p.harvested} spent ${p.spent} killed $${p.killedValue} lost $${p.lostValue}; first wave ${p.firstWaveMin?.toFixed(1)} scout ${p.firstScoutMin?.toFixed(1)} at enemy ${p.firstAtEnemyMin?.toFixed(1)} waves ${p.waves ?? '-'}`);
  console.log(`   kills by type ${fmt(p.killsByType)}; lost by type ${fmt(p.lostByType)}; chatter ${JSON.stringify(p.chatter ?? {})}`);
  if (p.cmdUses) console.log(`   powers ${JSON.stringify(p.cmdUses)} doctrine ${p.doctrine} econ ${JSON.stringify(p.econ)}`);
}
console.log(`${r.timedOut ? 'timeout' : `winner team ${r.winnerTeam}`} at ${r.minutes.toFixed(1)} min (${Math.round(r.wallMs / 1000)} s)`);
