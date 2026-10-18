/**
 * Challenge runtime ("Can you win from here?"): turns a ChallengeDef's goal into MissionRuntime objectives,
 * a time limit and a deterministic score. Runs inside the simulation tick; state lives in m.flags.ch (JSON).
 *
 * Goals: win (defeat every enemy before the time limit) · survive (stay in the fight until it runs out) ·
 * destroy (targets dead or captured before it runs out) · protect (targets alive when it runs out) ·
 * hold (sole control of a zone for N accumulated seconds before it runs out).
 * Score: 1000 for completing + a time / condition bonus + 25 per kill + 60 per structure destroyed,
 * − 15 per unit and − 50 per structure lost (failed attempts score 0). Stars: completed · par · clean.
 */
import { BUILDINGS, UNITS } from '../data/rules';
import type { MissionRuntime } from '../sim/mission';
import type { Entity } from '../sim/entities';
import { TICK_HZ } from '../sim/types';
import type { ChallengeDef, ChallengeGoal, ChallengeResult } from './types';
import { BUILTINS } from './builtins';
import { hillUnit } from './koth';
import { MODES_EN, fillEn as en } from './text';

// Objective texts, radio lines and results run inside the simulation: always English (src/modes/text.ts), translated
// by the screens that show them (trSource; keys modes.src.*). No i18n imports: the server bundles reach this file.
const S = MODES_EN.challenge;
const R = S.reason;

interface ChState {
  t0: number;
  limit: number;
  s0: { k: number; bk: number; l: number; bl: number };
  held: number;
  targets: number[];
  /** Max hp of the targets at the start (protect: condition bonus). */
  hp0: number;
  zone: { x: number; y: number; r: number } | null;
  res?: ChallengeResult;
}

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** Objective line for a goal (English: the simulation's objective text; shown through trSource). */
export function goalText(goal: ChallengeGoal, timeLimit: number): string {
  switch (goal.kind) {
    case 'win': return goal.label ?? en(S.goal.win, { time: mmss(timeLimit) });
    case 'survive': return goal.label ?? en(S.goal.survive, { time: mmss(goal.seconds ?? timeLimit) });
    case 'destroy': return goal.label ?? en(S.goal.destroy, { time: mmss(timeLimit) });
    case 'protect': return goal.label ?? en(S.goal.protect, { time: mmss(timeLimit) });
    case 'hold': return goal.label ?? en(S.goal.hold, { hold: mmss(goal.seconds ?? 60), time: mmss(timeLimit) });
  }
}

/** Short goal tag for lists ("Win · 15:00"), English (src/ui/challenge-list.ts shows a translated one). */
export function goalTag(c: Pick<ChallengeDef, 'goal' | 'timeLimit'>): string {
  const k = c.goal.kind;
  const name = k === 'win' ? 'Win' : k === 'survive' ? 'Survive' : k === 'destroy' ? 'Destroy' : k === 'protect' ? 'Protect' : 'Hold';
  return k === 'hold' ? `${name} ${mmss(c.goal.seconds ?? 60)} · ${mmss(c.timeLimit)}` : `${name} · ${mmss(c.timeLimit)}`;
}

/** m:ss (challenge times). */
export const challengeClock = mmss;

/** Display name of an entity for objective texts ("Soviet Construction Yard"). */
export function entityLabel(e: Entity): string {
  const t = BUILDINGS[e.type.id] ?? UNITS[e.type.id];
  return t?.name ?? e.type.id;
}

/** Start the challenge: built-in stage (fresh world) or a loaded moment, objectives, timer. */
export function challengeSetup(m: MissionRuntime, c: ChallengeDef) {
  const w = m.world;
  let targets = (c.goal.targets ?? []).slice();
  let zone = c.goal.kind === 'hold' && c.goal.x !== undefined ? { x: c.goal.x, y: c.goal.y!, r: c.goal.r ?? 5 } : null;
  const b = c.builtin ? BUILTINS[c.builtin] : undefined;
  if (b) {
    const out = b.script(m);
    if (out.targets) targets = out.targets;
    if (out.zone) zone = out.zone;
  }
  const st = m.human.stats;
  const hp0 = targets.reduce((s, id) => s + (w.getEntity(id)?.maxHp ?? 0), 0);
  const ch: ChState = { t0: w.tick, limit: Math.round(c.timeLimit * TICK_HZ), s0: { k: st.unitsKilled, bk: st.buildingsKilled, l: st.unitsLost, bl: st.buildingsLost }, held: 0, targets, hp0, zone };
  m.flags.ch = ch;
  m.objective('goal', goalText(c.goal, c.timeLimit));
  if (c.goal.kind === 'hold') m.progress('goal', `0:00 / ${mmss(c.goal.seconds ?? 60)}`);
  if (ch.limit > 0) m.startTimer('limit', c.timeLimit, c.goal.kind === 'survive' || c.goal.kind === 'protect' ? S.timerHold : S.timerLeft);
  if (zone) { m.reveal(m.human, zone.x, zone.y, zone.r + 2); m.beacon(zone.x, zone.y); }
  for (const id of targets) {
    const e = w.getEntity(id);
    if (e) m.reveal(m.human, e.x, e.y, 3);
  }
  m.say(MODES_EN.speaker.challenge, c.description || goalText(c.goal, c.timeLimit), 'commander');
}

/** Called every tick by the mode runtime (also once more when another rule ended the game). */
export function challengeUpdate(m: MissionRuntime, c: ChallengeDef) {
  const ch = m.flags.ch as ChState | undefined;
  if (!ch || ch.res) return;
  const w = m.world;
  if (m.ended) { finalize(m, c, ch, m.won, m.endReason ?? (m.won ? R.victory : R.defeat)); return; }
  const b = c.builtin ? BUILTINS[c.builtin] : undefined;
  b?.update?.(m);
  const me = m.human;
  if (me.defeated) return finish(m, c, ch, false, R.allLost);
  const el = w.tick - ch.t0;
  const timeUp = ch.limit > 0 && el >= ch.limit;
  const goal = c.goal;
  switch (goal.kind) {
    case 'win':
      if (w.tick % TICK_HZ === 0) {
        const foes = w.players.filter((p) => me.isEnemy(p));
        if (foes.every((p) => p.defeated)) return finish(m, c, ch, true, R.enemiesDestroyed);
      }
      if (timeUp) return finish(m, c, ch, false, R.outOfTime);
      break;
    case 'destroy': {
      const left = ch.targets.filter((id) => { const e = w.getEntity(id); return !!e && e.alive && me.isEnemy(e.owner); });
      if (!left.length) return finish(m, c, ch, true, ch.targets.length > 1 ? R.targetsDestroyed : R.targetDestroyed);
      if (ch.targets.length > 1 && w.tick % TICK_HZ === 0) m.progress('goal', `${ch.targets.length - left.length} / ${ch.targets.length}`);
      if (timeUp) return finish(m, c, ch, false, R.outOfTime);
      break;
    }
    case 'protect': {
      const lost = ch.targets.find((id) => { const e = w.getEntity(id); return !e || !e.alive || me.isEnemy(e.owner); });
      if (lost !== undefined) return finish(m, c, ch, false, goal.label ? R.protectedLost : R.targetLost);
      if (timeUp) return finish(m, c, ch, true, R.heldOut);
      break;
    }
    case 'survive':
      if (timeUp || (goal.seconds && el >= goal.seconds * TICK_HZ)) return finish(m, c, ch, true, R.survived);
      break;
    case 'hold': {
      const need = (goal.seconds ?? 60) * TICK_HZ;
      if (ch.zone && w.tick % 5 === 0) {
        let mine = false, foe = false;
        for (const u of w.units) {
          if (!hillUnit(u) || Math.hypot(u.x - ch.zone.x, u.y - ch.zone.y) > ch.zone.r) continue;
          if (u.owner.team === me.team) mine = true; else if (me.isEnemy(u.owner)) foe = true;
        }
        if (mine && !foe) ch.held += 5;
        if (w.tick % (TICK_HZ * 2) === 0) {
          const held = mmss(ch.held / TICK_HZ), all = mmss(need / TICK_HZ);
          m.progress('goal', foe && mine ? en(S.contested, { held, need: all }) : `${held} / ${all}`);
        }
        if (w.tick % (TICK_HZ * 8) === 0) m.beacon(ch.zone.x, ch.zone.y);
      }
      if (ch.held >= need) return finish(m, c, ch, true, R.zoneHeld);
      if (timeUp) return finish(m, c, ch, false, R.outOfTime);
      break;
    }
  }
}

function finish(m: MissionRuntime, c: ChallengeDef, ch: ChState, won: boolean, reason: string) {
  finalize(m, c, ch, won, reason);
  if (m.ended) return;
  if (won) {
    m.endReason = reason;
    m.complete('goal');
    m.win();
  } else {
    m.fail('goal');
    m.lose(reason);
  }
}

/** Compute and store the result (and score) of the attempt. */
function finalize(m: MissionRuntime, c: ChallengeDef, ch: ChState, won: boolean, reason: string) {
  if (ch.res) return;
  const w = m.world, st = m.human.stats;
  const kills = st.unitsKilled - ch.s0.k, structuresKilled = st.buildingsKilled - ch.s0.bk;
  const losses = st.unitsLost - ch.s0.l, structuresLost = st.buildingsLost - ch.s0.bl;
  const time = (w.tick - ch.t0) / TICK_HZ;
  const kind = c.goal.kind;
  let bonus = 0;
  if (won) {
    if (kind === 'win' || kind === 'destroy' || kind === 'hold') bonus = c.timeLimit > 0 ? Math.round(1000 * Math.max(0, 1 - time / c.timeLimit)) : 500;
    else if (kind === 'protect') {
      const hp = ch.targets.reduce((s, id) => s + Math.max(0, w.getEntity(id)?.hp ?? 0), 0);
      bonus = Math.round(600 * (ch.hp0 > 0 ? Math.min(1, hp / ch.hp0) : 1));
    } else bonus = structuresLost === 0 ? 600 : Math.max(0, 600 - structuresLost * 120);
  }
  const score = won ? Math.max(100, 1000 + bonus + 25 * kills + 60 * structuresKilled - 15 * losses - 50 * structuresLost) : 0;
  const timed = kind === 'win' || kind === 'destroy' || kind === 'hold';
  const par = timed ? time <= (c.par?.time ?? c.timeLimit * 0.5) : losses <= (c.par?.losses ?? 8);
  const clean = structuresLost === 0 && kills + structuresKilled * 3 >= losses;
  const stars = won ? 1 + (par ? 1 : 0) + (clean ? 1 : 0) : 0;
  ch.res = { won, time, score, stars, kills, structuresKilled, losses, structuresLost, bonus, bonusLabel: timed ? S.bonus.time : kind === 'protect' ? S.bonus.condition : S.bonus.base, reason };
  m.score = score;
}

/** The result of a finished attempt (null while it runs). */
export function challengeResult(m: MissionRuntime | null | undefined): ChallengeResult | null {
  return ((m?.flags.ch as ChState | undefined)?.res) ?? null;
}
