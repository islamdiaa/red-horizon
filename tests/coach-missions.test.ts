/**
 * The Field Manual in campaign missions (src/ui/coach.ts, src/ui/hints.ts): the battle and base-keeping alerts only
 * (no build-order tutorial, no economy race), and only advice the mission lets the player follow.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERTS, AlertQueue, CoachWatch } from '../src/ui/coach';
import type { World } from '../src/sim/world';
import type { Player } from '../src/sim/player';
import { building, run, sandbox, seconds } from './helpers';

/** Every alert raised over `secs` seconds, with the world flagged as a mission while the alerts are asked. */
function raised(w: World, p: Player, secs: number, mission: boolean): string[] {
  const c = new CoachWatch(), q = new AlertQueue();
  const keys: string[] = [];
  const real = w.mission;
  for (let i = 0; i < secs; i++) {
    run(w, seconds(1));
    if (mission) w.mission = {} as World['mission']; // (only its presence matters to the alerts; the sim never sees it)
    c.update(w, p);
    const r = q.update(w, p, c, mission ? 'mission' : true);
    if (r.fresh) { const a = ALERTS[r.idx]; keys.push(typeof a.text === 'function' ? a.text(p, c, w) : a.text); }
    w.mission = real;
  }
  return keys;
}

describe('Field Manual alerts in campaign missions', () => {
  test('a mission gets the base-keeping alerts but not the skirmish economy race or defence advice', () => {
    const base = () => {
      const s = sandbox({ w: 64, h: 64, credits: 5000 });
      building(s.world, 'fact', s.p0, 6, 54);
      building(s.world, 'fact', s.p1, 50, 8);
      building(s.world, 'proc', s.p0, 12, 50); // a refinery, no truck and no defence
      return s;
    };
    const sk = base(), skirmish = raised(sk.world, sk.p0, 9 * 60, false);
    assert.ok(skirmish.includes('alerts.defences'), `skirmish: the defence advice: ${skirmish}`);
    const ms = base(), mission = raised(ms.world, ms.p0, 9 * 60, true);
    assert.ok(mission.includes('alerts.noTrucksFactory'), `mission: no Ore Truck left is still worth saying: ${mission}`);
    for (const k of mission) {
      const a = ALERTS.find((x) => (typeof x.text === 'function' ? [x.text(ms.p0, new CoachWatch(), ms.world)] : [x.text]).includes(k as never));
      assert.ok(!a?.coach || a.mission, `mission: only alerts marked for missions (${k})`);
    }
    assert.ok(!mission.includes('alerts.defences') && !mission.includes('alerts.refinery') && !mission.includes('alerts.income'), `mission: no skirmish economy advice: ${mission}`);
  });

  test('a mission that rules out Ore Trucks never asks for one', () => {
    const { world: w, p0, p1 } = sandbox({ w: 64, h: 64, credits: 5000 });
    building(w, 'fact', p0, 6, 54);
    building(w, 'fact', p1, 50, 8);
    building(w, 'proc', p0, 12, 50);
    p0.allowedTypes = new Set(['powr', 'tent', 'e1']);
    const keys = raised(w, p0, 4 * 60, true);
    assert.ok(!keys.some((k) => k.startsWith('alerts.noTrucks')), `no truck advice when trucks can't be had: ${keys}`);
  });
});
