/**
 * Coaching that helps a newcomer finish a match they are winning and spend their money
 * (src/ui/coach.ts: the enemy structures the player has seen, the close-out alert, the bank reminder, alerts that
 * repeat at Recruit and Easy only), and the Classic layout's fallback on small windows (src/ui/layout-fit.ts).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERTS, AlertQueue, BANK_FROM, BANK_REPEAT, BANK_SECS, CLOSE_FROM, CoachWatch, MOVE_LOSSES, REPEAT_MAX, coachMode, coachTick, gentleLevel } from '../src/ui/coach';
import { classicFits } from '../src/ui/layout-fit';
import { DT } from '../src/sim/types';
import type { World } from '../src/sim/world';
import type { AIDifficulty } from '../src/sim/ai';
import { building, powerUp, run, sandbox, seconds, unit } from './helpers';

const at = (w: World, secs: number) => { w.tick = Math.round(secs / DT); };

describe('the enemy structures the player knows (no fog cheating)', () => {
  test('seen once, remembered under fog, forgotten when the player looks again and finds them gone', () => {
    const { world: w, p0, p1 } = sandbox({ w: 64, h: 64, fog: true });
    building(w, 'fact', p0, 6, 54);
    const plant = building(w, 'powr', p1, 50, 8);
    building(w, 'fact', p1, 54, 12);
    const c = new CoachWatch();
    run(w, 8);
    c.update(w, p0);
    assert.equal(c.known.size, 0, 'nothing of the enemy seen yet');
    const scout = unit(w, 'e1', p0, 47, 10);
    run(w, 8);
    c.update(w, p0);
    assert.ok(c.known.has(plant.id), `the scout sees the power plant (known: ${[...c.known.values()].map((k) => k.type)})`);
    w.kill(scout);
    run(w, 8);
    c.update(w, p0);
    w.kill(plant);
    run(w, 8);
    c.update(w, p0);
    assert.ok(c.known.has(plant.id), 'destroyed out of sight: still where the player last saw it');
    unit(w, 'e1', p0, 47, 10);
    run(w, 8);
    c.update(w, p0);
    assert.ok(!c.known.has(plant.id), 'looked again: gone');
    assert.ok(c.targets(w, p0).every((t) => Math.hypot(t.x - plant.x, t.y - plant.y) > 1), 'no target where nothing stands');
  });
});

describe('the close-out alert', () => {
  const setup = (fog = false) => {
    const s = sandbox({ w: 64, h: 64, fog });
    const { world: w, p0, p1 } = s;
    building(w, 'fact', p0, 6, 54);
    const foes = [building(w, 'fact', p1, 50, 8), building(w, 'powr', p1, 46, 8), building(w, 'powr', p1, 46, 12), building(w, 'tent', p1, 54, 14)];
    return { ...s, foes };
  };

  test('advantage: an army worth twice the enemy army and defences, from 8:00, with eight armed units', () => {
    const { world: w, p0, p1 } = setup();
    for (let i = 0; i < 10; i++) unit(w, '2tnk', p0, 10 + (i % 5), 40 + Math.floor(i / 5));
    unit(w, 'e1', p1, 52, 20);
    unit(w, 'e1', p1, 53, 20);
    const c = new CoachWatch();
    at(w, CLOSE_FROM - 30);
    c.update(w, p0);
    assert.equal(c.closeOut(w, p0), null, 'not before 8:00');
    at(w, CLOSE_FROM + 5);
    c.update(w, p0);
    assert.equal(c.closeOut(w, p0), 'advantage', 'ten tanks against two riflemen');
    const t = c.targets(w, p0);
    assert.ok(t.length === 3 && t.every((p) => p.x > 40 && p.y < 20), `three enemy structures to point at: ${JSON.stringify(t)}`);
    for (const u of w.units.filter((u) => u.owner === p0).slice(0, 3)) w.kill(u);
    c.update(w, p0);
    assert.equal(c.closeOut(w, p0), null, 'seven armed units are not enough to finish anyone');
  });

  test('finish: the enemy lost half its structures and the player\'s army is worth at least its army', () => {
    const { world: w, p0, p1, foes } = setup();
    for (let i = 0; i < 8; i++) unit(w, '2tnk', p0, 10 + (i % 4), 40 + Math.floor(i / 4));
    for (let i = 0; i < 6; i++) unit(w, '3tnk', p1, 50 + i, 22);
    const c = new CoachWatch();
    at(w, CLOSE_FROM + 60);
    c.update(w, p0);
    assert.equal(c.closeOut(w, p0), null, 'an even fight: no advice to go all in');
    w.kill(foes[1]);
    w.kill(foes[2]);
    c.update(w, p0);
    assert.equal(c.closeOut(w, p0), 'finish', 'two of its four structures gone, armies even');
    assert.deepEqual(c.targets(w, p0, 5).length, 2, 'the two structures left');
  });

  test('scout / explore: no known enemy structure to point at (fog)', () => {
    const { world: w, p0, p1 } = setup(true);
    for (let i = 0; i < 10; i++) unit(w, '2tnk', p0, 10 + (i % 5), 40 + Math.floor(i / 5));
    unit(w, 'e1', p1, 52, 20);
    const c = new CoachWatch();
    run(w, 8);
    at(w, CLOSE_FROM + 5);
    c.update(w, p0);
    assert.equal(c.known.size, 0, 'the enemy base was never seen');
    assert.equal(c.closeOut(w, p0), 'explore', 'far stronger, nothing found yet');
    const a = ALERTS.find((x) => x.repeat && x.targets)!;
    assert.equal(typeof a.text === 'function' ? a.text(p0, c, w) : a.text, 'alerts.closeExplore', 'the explore wording');
    assert.deepEqual(a.targets!(w, p0, c), [], 'nothing to ping');
  });
});

describe('alerts that repeat at Recruit and Easy only', () => {
  /** Run the coaching watch over a bank that never empties, against an AI of this level; the bank alerts raised. */
  const bank = (level: AIDifficulty, dismiss = false, looping = false) => {
    const { world: w, p0 } = sandbox({ w: 64, h: 64, ai: [undefined, level] });
    building(w, 'fact', p0, 6, 54);
    const tent = building(w, 'tent', p0, 12, 54);
    if (looping) p0.repeat.push('e1');
    assert.ok(gentleLevel(w, p0) === (level === 'recruit' || level === 'easy'), `${level} is ${gentleLevel(w, p0) ? '' : 'not '}gentle`);
    const c = new CoachWatch(), q = new AlertQueue();
    const raised: { key: string; t: number }[] = [];
    for (let t = 10; t <= 1800; t += 5) {
      at(w, t);
      p0.cash = 4000;
      c.update(w, p0);
      const r = q.update(w, p0, c, true);
      if (!r.fresh) continue;
      const a = ALERTS[r.idx];
      const key = typeof a.text === 'function' ? a.text(p0, c, w) : a.text;
      if (key.startsWith('alerts.bank')) { raised.push({ key, t }); if (dismiss) q.dismiss(); }
    }
    assert.ok(tent.alive, 'the barracks stands');
    return raised;
  };

  test('the bank reminder: after a minute of $1,500+, at most three times, three minutes apart', () => {
    const r = bank('recruit');
    assert.equal(r.length, REPEAT_MAX, `raised ${JSON.stringify(r)}`);
    assert.ok(r[0].t >= Math.max(BANK_SECS, BANK_FROM), `not before 3:00 nor a minute of money in the bank: ${r[0].t}`);
    for (let i = 1; i < r.length; i++) assert.ok(r[i].t - r[i - 1].t >= BANK_REPEAT, `three minutes apart: ${JSON.stringify(r)}`);
    assert.ok(r.every((x) => x.key === 'alerts.bankLoop'), 'nothing looping: Alt-click a card');
    assert.equal(bank('easy').length, REPEAT_MAX, 'Easy repeats too');
  });

  test('once at Normal and above, never again after a dismiss, a second factory once loops run', () => {
    assert.equal(bank('normal').length, 1, 'Normal: once a match');
    assert.equal(bank('brutal').length, 1, 'Brutal: once a match');
    assert.equal(bank('recruit', true).length, 1, 'dismissed: gone for the match');
    const r = bank('recruit', false, true);
    assert.ok(r.length >= 1 && r.every((x) => x.key === 'alerts.bankFactory'), `loops running: a second factory (${JSON.stringify(r)})`);
  });
});

describe('the Classic layout on small windows (src/ui/layout-fit.ts)', () => {
  test('Classic shows where its sidebar fits; Modern stands in on narrow, short or portrait windows', () => {
    const fits: Record<string, boolean> = { '390x844': false, '600x900': false, '768x1024': false, '844x390': false, '800x600': true, '1024x768': true, '1280x720': true, '1920x1080': true, '2560x1440': true };
    for (const [size, want] of Object.entries(fits)) {
      const [w, h] = size.split('x').map(Number);
      assert.equal(classicFits(w, h), want, `${size}: Classic ${want ? 'fits' : 'does not fit'}`);
    }
    assert.ok(classicFits(1920, 1080, 1.5), 'the largest interface size still fits a 1080p window');
  });
});

describe('when coaching applies', () => {
  test('not for a side that surrendered or that an AI runs', () => {
    const { world: w, p0 } = sandbox({ w: 48, h: 48 });
    assert.equal(coachMode(w, p0), true, 'a skirmish player is coached');
    p0.resigned = true;
    assert.equal(coachMode(w, p0), false, 'surrendered (a team game hands the side to an AI)');
    p0.resigned = false;
    p0.isHuman = false;
    assert.equal(coachMode(w, p0), false, 'an AI-run side');
  });

  test('the watch keeps up while the Field Manual is off: turned back on, old losses raise nothing', () => {
    const { world: w, p0, p1 } = sandbox({ w: 64, h: 64, credits: 5000 });
    building(w, 'fact', p0, 6, 54);
    building(w, 'fact', p1, 50, 8);
    powerUp(w, p1, 54, 14);
    building(w, 'ftur', p1, 40, 30);
    const c = new CoachWatch(), q = new AlertQueue();
    const raised: string[] = [];
    const tick = (on: boolean) => { const r = coachTick(c, q, w, p0, on); if (r.fresh) { const a = ALERTS[r.idx]; raised.push(typeof a.text === 'function' ? a.text(p0, c, w) : a.text); } };
    const soldiers = Array.from({ length: 6 }, (_, i) => unit(w, 'e1', p0, 38 + (i % 3) * 0.6, 32 + Math.floor(i / 3) * 0.6));
    w.issue({ c: 'move', player: p0.id, units: soldiers.map((s) => s.id), x: 50, y: 10 });
    for (let i = 0; i < 60 && soldiers.some((s) => s.alive); i++) { run(w, seconds(0.5)); tick(false); }
    assert.ok(soldiers.filter((s) => !s.alive).length >= MOVE_LOSSES, 'the riflemen died walking past the tower, the Field Manual off');
    assert.deepEqual(raised, [], 'nothing raised while off');
    for (let i = 0; i < 300; i++) { run(w, seconds(1)); tick(false); }
    for (let i = 0; i < 30; i++) { run(w, seconds(1)); tick(true); }
    assert.ok(!raised.includes('alerts.attackMove') && !raised.some((k) => k.startsWith('alerts.infantryDefence')), `five minutes later, back on: no stale alert (${raised})`);
    assert.ok(c.lessons().armedLost >= MOVE_LOSSES, 'the results advice still knows about those losses');
  });
});

describe('no hidden information against people', () => {
  /** A won position (ten tanks against two riflemen, the enemy earning far more): the alerts raised over 20 minutes. */
  const run1v1 = (enemyAI: AIDifficulty | undefined) => {
    const { world: w, p0, p1 } = sandbox({ w: 64, h: 64, ai: [undefined, enemyAI] });
    building(w, 'fact', p0, 6, 54);
    building(w, 'proc', p0, 12, 54);
    for (const [x, y] of [[50, 8], [46, 8], [46, 12], [54, 14]]) building(w, 'powr', p1, x, y);
    for (let i = 0; i < 10; i++) unit(w, '2tnk', p0, 10 + (i % 5), 40 + Math.floor(i / 5));
    unit(w, 'e1', p1, 52, 20);
    unit(w, 'e1', p1, 53, 20);
    const c = new CoachWatch(), q = new AlertQueue();
    const raised: string[] = [];
    for (let t = 5; t <= 1200; t += 5) {
      at(w, t);
      p1.stats.harvested += 120; // ($1,440 a minute: far above the player's nothing)
      const r = coachTick(c, q, w, p0, true);
      if (r.fresh) { const a = ALERTS[r.idx]; raised.push(typeof a.text === 'function' ? a.text(p0, c, w) : a.text); }
    }
    return raised;
  };

  test('a 1v1 between two people: no close-out and no income alert', () => {
    const r = run1v1(undefined);
    assert.ok(!r.some((k) => k.startsWith('alerts.close') || k === 'alerts.income' || k.startsWith('alerts.attack')), `raised against a person: ${r}`);
    assert.ok(ALERTS.filter((a) => a.hidden).length >= 3, 'close-out, income and the first-wave warning are marked');
  });

  test('the same position against the computer: they come', () => {
    const r = run1v1('normal');
    assert.ok(r.some((k) => k.startsWith('alerts.close')), `close-out against the AI: ${r}`);
    assert.ok(r.includes('alerts.income'), `income against the AI: ${r}`);
  });
});
