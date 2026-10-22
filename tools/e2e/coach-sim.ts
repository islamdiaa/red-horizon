/**
 * Which Field Manual alerts (src/ui/coach.ts ALERTS) a player of each kind gets, and when: headless matches of the
 * human stand-ins (tools/selfplay/standin.ts) against the AI, with the coaching watch running on the stand-in exactly
 * as the Hints panel runs it (every 10 ticks, alerts once a match, one a minute; nobody dismisses them). It shows
 * whether the alerts reach the players who need them (the newcomer) and stay quiet for the ones who don't.
 *
 *   node --import tsx tools/e2e/coach-sim.ts [--games 4] [--diff recruit,easy] [--vs newcomer,novice,casual] [--rules commander,classic] [--minutes 30]
 *   node --import tsx tools/e2e/coach-sim.ts --missions allied-01,soviet-01 [--levels recruit,easy,normal] [--vs newcomer,casual] [--games 2]
 *
 * --missions plays campaign missions instead (headlessGame, the stand-in as the player, the mission's level), with the
 * mission alerts only, as the Hints panel does in a mission.
 */
import type { Faction } from '../../src/data/rules';
import type { AIDifficulty } from '../../src/sim/ai';
import { ALERTS, AlertQueue, CoachWatch } from '../../src/ui/coach';
import { buildMatch, stepMatch, type MatchSpec, type PlayerSpec } from '../selfplay/lib';
import { StandIn, type ScriptedLevel, type StandInLevel } from '../selfplay/standin';
import { headlessGame } from '../../src/modes/headless';
import type { MissionLevel } from '../../src/sim/handicap';

const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const games = +arg('games', '4');
const diffs = arg('diff', 'recruit,easy').split(',') as AIDifficulty[];
const vs = arg('vs', 'newcomer,novice,casual').split(',') as StandInLevel[];
const rulesSets = arg('rules', 'commander').split(',');
const minutes = +arg('minutes', '30');

/** An alert's id: its text key for this player (some pick a wording by side or by what the player has). */
const alertKey = (i: number, m: ReturnType<typeof buildMatch>, slot: number, c: CoachWatch): string => {
  const a = ALERTS[i];
  return typeof a.text === 'function' ? a.text(m.players[slot], c, m) : a.text;
};

interface Row { rules: string; diff: AIDifficulty | MissionLevel; vs: StandInLevel; won: boolean | null; minutes: number; alerts: { key: string; t: number }[] }
const rows: Row[] = [];
const t0 = Date.now();
const missions = arg('missions', '').split(',').filter(Boolean);
const levels = arg('levels', 'recruit,easy,normal').split(',') as MissionLevel[];
// ---- campaign missions: the stand-in plays slot 0, the Field Manual's mission alerts run on it
for (const mission of missions) for (const level of levels) for (const lv of vs) for (let g = 0; g < games; g++) {
  const game = headlessGame({
    faction: 'allies', color: 0x3d7be0, opponents: [], mapSize: 64, water: 0.3, trees: 0.5, ore: 0.6, credits: 5000, startUnits: 'mcv', fog: true,
    timeOfDay: 'day', quality: 'low', seed: 7000 + g, mission, missionLevel: level,
  } as Parameters<typeof headlessGame>[0]);
  const w = game.world, p = game.local;
  const si = new StandIn(w, p, lv as ScriptedLevel, 7000 + g * 31);
  const c = new CoachWatch(), q = new AlertQueue();
  const alerts: { key: string; t: number }[] = [];
  const end = minutes * 60 * 20;
  while (!w.gameOver && w.tick < end) {
    si.tick();
    w.step();
    w.events.length = 0;
    if (w.mission) w.mission.events.length = 0;
    if (w.tick % 10) continue;
    const on = !p.defeated && !w.gameOver;
    if (on) c.update(w, p);
    const r = q.update(w, p, c, on ? 'mission' : false);
    if (r.fresh) { const a = ALERTS[r.idx]; alerts.push({ key: typeof a.text === 'function' ? a.text(p, c, w) : a.text, t: Math.round(w.time) }); }
  }
  const won = w.gameOver ? w.winnerTeam === p.team : null;
  rows.push({ rules: mission, diff: level, vs: lv, won, minutes: Math.round(w.time / 6) / 10, alerts });
  console.log(`${mission} ${level} ${lv} #${g}: ${won === null ? 'time' : won ? 'WIN' : 'loss'} ${(w.time / 60).toFixed(1)} min; ${alerts.map((a) => `${a.key}@${a.t}`).join(' ')}`);
}
for (const rules of missions.length ? [] : rulesSets) for (const diff of diffs) for (const lv of vs) for (let g = 0; g < games; g++) {
  const f: Faction = g % 2 ? 'soviet' : 'allies';
  const ai: PlayerSpec = { faction: f, difficulty: diff, label: 'ai' };
  const human: PlayerSpec = { faction: f === 'allies' ? 'soviet' : 'allies', difficulty: 'normal', standin: lv, label: lv };
  const players = g % 4 < 2 ? [ai, human] : [human, ai];
  const slot = players.indexOf(human);
  const spec: MatchSpec = { id: g, seed: 9100 + g * 7919 + diffs.indexOf(diff) * 31 + vs.indexOf(lv) * 101, map: 'land', size: 96, players, maxMinutes: minutes, commander: rules === 'commander' ? {} : undefined };
  const w = buildMatch(spec);
  const p = w.players[slot];
  const c = new CoachWatch(), q = new AlertQueue();
  const alerts: { key: string; t: number }[] = [];
  const end = minutes * 60 * 20;
  while (!w.gameOver && w.tick < end) {
    stepMatch(w);
    if (w.tick % 10) continue;
    const coach = !p.defeated && !w.gameOver;
    if (coach) c.update(w, p);
    const r = q.update(w, p, c, coach);
    if (r.fresh) alerts.push({ key: alertKey(r.idx, w, slot, c), t: Math.round(w.time) });
  }
  const won = w.gameOver ? w.winnerTeam === p.team : null;
  rows.push({ rules, diff, vs: lv, won, minutes: Math.round(w.time / 6) / 10, alerts });
  console.log(`${rules} ${diff} ${lv} #${g}: ${won === null ? 'time' : won ? 'WIN' : 'loss'} ${(w.time / 60).toFixed(1)} min; ${alerts.map((a) => `${a.key}@${a.t}`).join(' ')}`);
}

// per cell: how often each alert fired, and its median time
const cells = new Map<string, Row[]>();
for (const r of rows) { const k = `${r.rules} ${r.diff} ${r.vs}`; cells.set(k, [...(cells.get(k) ?? []), r]); }
console.log(`\n${rows.length} matches in ${Math.round((Date.now() - t0) / 1000)} s\n`);
console.log('| cell | wins | alerts per match | alerts (share of matches, median time) |');
console.log('|---|---|---|---|');
for (const [k, rs] of cells) {
  const keys = new Map<string, number[]>();
  for (const r of rs) for (const a of r.alerts) keys.set(a.key, [...(keys.get(a.key) ?? []), a.t]);
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const list = [...keys].sort((a, b) => b[1].length - a[1].length).map(([key, ts]) => `${key.replace('alerts.', '')} ${Math.round((100 * ts.length) / rs.length)}% @${Math.floor(med(ts) / 60)}:${String(med(ts) % 60).padStart(2, '0')}`);
  const per = rs.reduce((s, r) => s + r.alerts.length, 0) / rs.length;
  console.log(`| ${k} | ${rs.filter((r) => r.won).length}/${rs.length} | ${per.toFixed(1)} | ${list.join(', ')} |`);
}
