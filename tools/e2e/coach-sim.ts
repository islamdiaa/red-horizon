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
 *
 * --respond none,coached plays each skirmish twice on the same seed: as it is (the stand-in ignores the Field Manual)
 * and with a stand-in that also does what the round-4 alerts say, the way the UI newcomer (tools/e2e/profiles.mjs)
 * does: the bank reminder -> loop a rifleman and a tank (Alt-click), then a second War Factory; the close-out alert ->
 * every armed unit attack-moves to the first structure it points at (each time it comes). The table then also shows
 * timeouts, the share of the time with $1,000+ in the bank (the matrix's "idle $ %"), and when close-out first came.
 */
import type { Faction } from '../../src/data/rules';
import type { AIDifficulty } from '../../src/sim/ai';
import { ALERTS, AlertQueue, CoachWatch } from '../../src/ui/coach';
import { loopFactory } from '../../src/sim/repeat';
import type { Player } from '../../src/sim/player';
import type { World } from '../../src/sim/world';
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
// 'bank' / 'close': the coached stand-in following only the bank reminder / only the close-out alert
const responds = arg('respond', 'none').split(',') as ('none' | 'coached' | 'bank' | 'close')[];

/** A stand-in that also follows the round-4 alerts (see the header). */
class Coached {
  private loop = false;
  private factory2 = false;
  private tries = 0;
  constructor(private w: World, private p: Player, private only: 'bank' | 'close' | null = null) {}
  onAlert(key: string, targets: { x: number; y: number }[]) {
    if ((this.only === 'bank' && key.startsWith('alerts.close')) || (this.only === 'close' && key.startsWith('alerts.bank'))) return;
    if (key === 'alerts.bankLoop') this.loop = true;
    if (key === 'alerts.bankFactory') { this.loop = true; this.factory2 = true; }
    const armed = () => this.w.units.filter((u) => u.alive && u.owner === this.p && u.weapons.length && !u.ut.harvester);
    if (key.startsWith('alerts.close') && targets.length) {
      const ids = armed().map((u) => u.id);
      if (ids.length) this.w.issue({ c: 'move', player: this.p.id, units: ids, x: targets[0].x, y: targets[0].y, attackMove: true });
    } else if (key === 'alerts.closeScout' || key === 'alerts.closeExplore') {
      // "send a few units to explore the dark parts of the map": three of them, to the far side of the map from home
      const yard = this.w.buildings.find((b) => b.alive && b.owner === this.p) ?? armed()[0];
      const m = this.w.map;
      const few = armed().slice(0, 3).map((u) => u.id);
      if (yard && few.length) this.w.issue({ c: 'move', player: this.p.id, units: few, x: m.w - yard.x, y: m.h - yard.y, attackMove: true });
    }
  }
  /** Every check: keep the loops on (a lost factory drops them), and get the second War Factory started. */
  tick() {
    const w = this.w, p = this.p;
    if (this.loop) {
      const tank = p.faction === 'soviet' ? '3tnk' : '1tnk';
      for (const t of ['e1', tank]) {
        if (p.repeat.includes(t) || !p.canBuild(t)) continue;
        const f = loopFactory(w, p, t);
        if (f) w.issue({ c: 'repeat', player: p.id, type: t, building: f.id, on: true });
      }
    }
    if (this.factory2 && this.tries < 6 && p.has('weap') && w.buildings.filter((b) => b.alive && b.owner === p && b.bt.id === 'weap').length < 2
      && !p.queues.structure.items.length && !p.queues.structure.ready && p.canBuild('weap') && p.credits >= 2000) {
      this.tries++;
      w.issue({ c: 'build', player: p.id, type: 'weap' });
    }
  }
}

/** An alert's id: its text key for this player (some pick a wording by side or by what the player has). */
const alertKey = (i: number, m: ReturnType<typeof buildMatch>, slot: number, c: CoachWatch): string => {
  const a = ALERTS[i];
  return typeof a.text === 'function' ? a.text(m.players[slot], c, m) : a.text;
};

interface Row { rules: string; diff: AIDifficulty | MissionLevel; vs: StandInLevel; won: boolean | null; minutes: number; alerts: { key: string; t: number }[]; respond?: string; bankPct?: number }
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
for (const rules of missions.length ? [] : rulesSets) for (const diff of diffs) for (const lv of vs) for (let g = 0; g < games; g++) for (const respond of responds) {
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
  const coached = respond === 'none' ? null : new Coached(w, p, respond === 'coached' ? null : respond);
  let banked = 0, checks = 0;
  while (!w.gameOver && w.tick < end) {
    stepMatch(w);
    if (w.tick % 10) continue;
    const coach = !p.defeated && !w.gameOver;
    if (coach) { c.update(w, p); checks++; if (p.credits >= 1000) banked++; }
    const r = q.update(w, p, c, coach);
    if (r.fresh) {
      const key = alertKey(r.idx, w, slot, c);
      alerts.push({ key, t: Math.round(w.time) });
      coached?.onAlert(key, ALERTS[r.idx].targets?.(w, p, c) ?? []);
    }
    coached?.tick();
  }
  const won = w.gameOver ? w.winnerTeam === p.team : null;
  const bankPct = Math.round((100 * banked) / Math.max(1, checks));
  rows.push({ rules, diff, vs: lv, won, minutes: Math.round(w.time / 6) / 10, alerts, respond, bankPct });
  console.log(`${rules} ${diff} ${lv}${responds.length > 1 ? ` ${respond}` : ''} #${g}: ${won === null ? 'time' : won ? 'WIN' : 'loss'} ${(w.time / 60).toFixed(1)} min, bank ${bankPct}%; ${alerts.map((a) => `${a.key}@${a.t}`).join(' ')}`);
}

// per cell: how often each alert fired, and its median time
const cells = new Map<string, Row[]>();
for (const r of rows) { const k = `${r.rules} ${r.diff} ${r.vs}${r.respond && responds.length > 1 ? ` ${r.respond}` : ''}`; cells.set(k, [...(cells.get(k) ?? []), r]); }
console.log(`\n${rows.length} matches in ${Math.round((Date.now() - t0) / 1000)} s\n`);
console.log('| cell | wins | timeouts | bank $1k+ % | alerts per match | alerts (share of matches, median time) |');
console.log('|---|---|---|---|---|---|');
for (const [k, rs] of cells) {
  const keys = new Map<string, number[]>();
  for (const r of rs) for (const a of r.alerts) keys.set(a.key, [...(keys.get(a.key) ?? []), a.t]);
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const list = [...keys].sort((a, b) => b[1].length - a[1].length).map(([key, ts]) => `${key.replace('alerts.', '')} ${Math.round((100 * ts.length) / rs.length)}% @${Math.floor(med(ts) / 60)}:${String(med(ts) % 60).padStart(2, '0')}`);
  const per = rs.reduce((s, r) => s + r.alerts.length, 0) / rs.length;
  const bank = rs.filter((r) => r.bankPct !== undefined);
  const bankAvg = bank.length ? Math.round(bank.reduce((s, r) => s + (r.bankPct ?? 0), 0) / bank.length) : '-';
  console.log(`| ${k} | ${rs.filter((r) => r.won).length}/${rs.length} | ${rs.filter((r) => r.won === null).length} | ${bankAvg} | ${per.toFixed(1)} | ${list.join(', ')} |`);
}
