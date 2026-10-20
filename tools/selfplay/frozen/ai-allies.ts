// Frozen copy of the simulation-version-2 skirmish AI (src/sim/ai-allies.ts at the masterpiece wave 2 commit), used by
// the self-play harness as the "experienced player" stand-in (tools/selfplay/standin.ts). Do not edit: it is a
// fixed yardstick, so the difficulty benchmarks stay comparable across AI changes.
/**
 * The Allied skirmish AI's own tools (called from AIController): the Allies win with what the Soviets don't have, so
 * this is where their commander plays to those strengths.
 *
 *  - Longbow strikes: helicopters hit what Hellfire missiles are for (tanks, V2 launchers, ore trucks, power plants
 *    (above all those feeding Tesla Coils) and refineries), never foot soldiers or defences, weigh every target
 *    against the anti-aircraft fire they know of around it and on the way there, stay out of enemy bases they have
 *    no fresh look at, back the army up where it is fighting, turn back from surprise flak and come home instead of
 *    loitering over the enemy.
 *  - Spies: one at a time for the enemy Radar Dome, whose shared radar then feeds the AI's intel (ai-intel.ts); a
 *    thief when a spied refinery shows a full enemy bank.
 *  - Artillery: howitzers in an assault fall back behind the tanks when the enemy gets close.
 *  - The Chronosphere: rescue an ore truck under fire, shift a fresh tank into the assault, or (as before) an
 *    expansion MCV to its ore field.
 *  - Power: Tesla Coils go dark without power, so known power plants rank higher as targets for the cruisers and
 *    the Longbows when the enemy relies on coils.
 *
 * Skirmish only (campaign missions are balanced around the classic AI). Easy gets the Longbow judgement and the
 * Tesla-aware targets (playing to its faction is not a tactic); the spies, the artillery drill and the Chronosphere
 * are for normal and up (easy has no superweapons). Nearly stateless: everything is derived from the world and the AI's intel each think; the few
 * counters (spies sent) live on the controller and are saved with it. Randomness: none.
 */
import { WEAPONS } from '../../../src/data/rules';
import type { KnownStructure } from './ai-intel';
import { Building, Unit, type Entity } from '../../../src/sim/entities';
import type { AIController } from './ai';
import { pickWeapon } from '../../../src/sim/combat';
import { superReady } from '../../../src/sim/superweapons';
import { TICK_HZ } from '../../../src/sim/types';

/** Whether the Allied tools are on for this AI (each tool has its own difficulty gate where it needs one). */
export function alliedTools(ai: AIController): boolean {
  return ai.p.faction === 'allies' && ai.skirmish && !!ai.tune.alliedOn;
}

/** Enemy Tesla Coils the AI knows of (they need power: their power plants become targets). */
export function knownCoils(ai: AIController): number {
  let n = 0;
  for (const s of ai.intel.structures.values()) if (s.type === 'tsla') n++;
  return n;
}

// ---------------------------------------------------------------------------------------------- Longbows

/** Anti-aircraft threat around a point: known AA structures and AA units seen there recently. */
function aaThreat(ai: AIController, x: number, y: number, fromX: number, fromY: number): number {
  const w = ai.world;
  let t = 0;
  for (const s of ai.intel.structures.values()) {
    if (!s.aa) continue;
    const reach = s.range + 1.5;
    if (Math.hypot(s.x - x, s.y - y) < reach) { t += 3; continue; }
    // on the way: closest approach of the flight line to the site
    const dx = x - fromX, dy = y - fromY, l = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, Math.min(l, ((s.x - fromX) * dx + (s.y - fromY) * dy) / l));
    if (Math.hypot(fromX + (dx / l) * k - s.x, fromY + (dy / l) * k - s.y) < reach - 0.5) t += 2;
  }
  const since = w.tick - TICK_HZ * 20;
  for (const s of ai.intel.units.values()) {
    if (s.seen < since || Math.hypot(s.x - x, s.y - y) > 8) continue;
    const e = w.entities.get(s.id);
    if (!(e instanceof Unit) || !e.alive) continue;
    if (e.weapons.some((sl) => sl.def.antiAir)) t += e.ut.cost >= 1000 ? 2 : 1;
  }
  return t;
}

/**
 * Inside an enemy base the AI only strikes what it can see the air defences around: with that enemy's radar shared
 * (a spied dome) or its structures there seen in the last 20 s. Anti-aircraft sites built since the last look would
 * otherwise wait unseen next to the target.
 */
function baseBlind(ai: AIController, x: number, y: number, owner: number): boolean {
  if (ai.p.intel.radar.includes(owner)) return false;
  const since = ai.world.tick - TICK_HZ * 20;
  let n = 0, fresh = true;
  for (const s of ai.intel.structures.values()) {
    if (s.owner !== owner || Math.hypot(s.x - x, s.y - y) > 11) continue;
    n++;
    if (s.seen < since) fresh = false;
  }
  return n >= 3 && !fresh;
}

/** What a Longbow strike on this enemy is worth (0 = not a Longbow target). */
function strikeValue(ai: AIController, e: Entity, coils: number): number {
  if (e instanceof Unit) {
    if (e.isAir || e.kind === 'naval' || e.ut.supportPlane) return 0;
    if (e.kind === 'infantry') return 0; // (Hellfires are wasted on foot soldiers)
    let v = e.ut.cost * (0.6 + 0.8 * (1 - e.healthFrac)); // the half-dead first
    if (e.ut.harvester) v *= 1.5; // the enemy's income
    if (e.ut.noMovingFire || e.ut.id === 'v2rl') v *= 1.4; // V2s: fragile and deadly
    if (e.ut.id === 'mcv') v *= 1.6;
    return v;
  }
  if (e instanceof Building) {
    if (e.bt.wall || e.bt.mine || e.weapons.length) return 0; // (defences shoot back: the army's job)
    const dmg = 1 + 0.5 * (1 - e.healthFrac);
    // a power plant keeps the coils firing (an advanced plant feeds more of them)
    if (e.bt.power > 0 && e.active) return (600 + Math.min(2400, (e.bt.power / 100) * 700 * Math.min(3, coils))) * dmg;
    if (e.bt.dock) return 700 * dmg; // refineries: the income
    return Math.min(600, e.bt.cost * 0.3) * dmg;
  }
  return 0;
}

const isLongbow = (u: Unit) => u.kind === 'aircraft' && !u.ut.passengers && !!u.ut.primary && WEAPONS[u.ut.primary]?.projectile === 'missile' && u.owner.faction === 'allies';

/**
 * Longbow command (replaces the generic air strikes for the Allied AI). Returns false when it has nothing to do with
 * the aircraft (the generic code then handles them).
 */
export function alliedAir(ai: AIController): boolean {
  const w = ai.world, p = ai.p;
  const helis = ai.myUnits().filter((u) => isLongbow(u));
  if (!helis.length) return false;
  const pad = w.buildings.find((b) => b.alive && b.owner === p && b.bt.factory === 'aircraft');
  const [bx, by] = ai.baseCenter();
  const hx = pad?.x ?? bx, hy = pad?.y ?? by;
  const coils = knownCoils(ai);
  // where the army fights: the wave in its assault, or the base when it is under attack
  const defending = w.tick - ai.lastDefend < TICK_HZ * 8;
  let fx = NaN, fy = NaN;
  if (ai.state === 'attack' && ai.stage === 'assault') {
    const wave = ai.waveUnits();
    if (wave.length) { fx = wave.reduce((s, u) => s + u.x, 0) / wave.length; fy = wave.reduce((s, u) => s + u.y, 0) / wave.length; }
  }
  const score = (e: Entity, n: number): number => {
    const v = strikeValue(ai, e, coils);
    if (v <= 0) return -Infinity;
    if (baseBlind(ai, e.x, e.y, e.owner.id)) return -Infinity;
    const threat = aaThreat(ai, e.x, e.y, hx, hy);
    if (threat > Math.max(1, n * 0.7)) return -Infinity; // a strike that loses the helicopters isn't one
    let s = v / (1 + threat * 0.9);
    if (defending && Math.hypot(e.x - bx, e.y - by) < 18) s *= 2.2;
    else if (!Number.isNaN(fx) && Math.hypot(e.x - fx, e.y - fy) < 10) s *= 1.6;
    return s - Math.hypot(e.x - hx, e.y - hy) * 2;
  };
  const best = (n: number, nearX?: number, nearY?: number, r = Infinity): Entity | null => {
    let out: Entity | null = null, bestS = 250;
    for (const u of w.units) {
      if (!u.alive || !p.isEnemy(u.owner) || !ai.intel.sees(u)) continue;
      if (nearX !== undefined && Math.hypot(u.x - nearX, u.y - nearY!) > r) continue;
      const s = score(u, n);
      if (s > bestS) { bestS = s; out = u; }
    }
    for (const ks of ai.intel.structures.values()) {
      const b = w.entities.get(ks.id);
      if (!(b instanceof Building) || !b.alive || !p.isEnemy(b.owner)) continue;
      if (nearX !== undefined && Math.hypot(b.x - nearX, b.y - nearY!) > r) continue;
      const s = score(b, n);
      if (s > bestS) { bestS = s; out = b; }
    }
    return out;
  };
  // a strike running into more anti-aircraft fire than it bargained for turns back
  const flying = new Map<number, Unit[]>();
  for (const u of helis) if (u.order.type === 'attack') (flying.get(u.order.target) ?? flying.set(u.order.target, []).get(u.order.target)!).push(u);
  for (const group of flying.values()) {
    const abort = group.filter((u) => aaThreat(ai, u.x, u.y, u.x, u.y) > Math.max(1, group.length * 0.7) + 0.5).map((u) => u.id);
    if (abort.length) w.issue({ c: 'deploy', player: p.id, units: abort });
  }
  // helicopters left with missiles after their target died: the next target close by, else home
  for (const u of helis) {
    if (u.order.type !== 'idle' || u.ammo <= 0 || u.ammo >= (u.ut.ammo ?? 1) || u.altitude < 0.05) continue;
    if (Math.hypot(u.x - hx, u.y - hy) < 6) continue;
    const t = best(1, u.x, u.y, 7);
    if (t && pickWeapon(u, t)) w.issue({ c: 'attack', player: p.id, units: [u.id], target: t.id });
    else w.issue({ c: 'deploy', player: p.id, units: [u.id] });
  }
  if (ai.ceasefire) return true; // (build-up time: they wait on their pads)
  // idle and fully armed: on the pad, or hovering at a post
  const ready = helis.filter((u) => u.order.type === 'idle' && u.ammo >= (u.ut.ammo ?? 1));
  // (a pair at least, unless the base needs help now)
  if (!ready.length || (ready.length < 2 && !defending && helis.length > 1)) return true;
  const t = best(ready.length);
  if (t) {
    const ids = ready.filter((u) => pickWeapon(u, t)).map((u) => u.id);
    if (ids.length) w.issue({ c: 'attack', player: p.id, units: ids, target: t.id });
  }
  return true;
}

// ---------------------------------------------------------------------------------------------- Chronosphere

/**
 * Allied Chronosphere use beyond the expansion MCV (handled by the caller): rescue a loaded ore truck under fire far
 * from home, else shift a healthy tank from home into the assault. Returns true when it fired.
 */
export function alliedChrono(ai: AIController): boolean {
  const w = ai.world, p = ai.p;
  if (!superReady(w, p, 'chrono') || ai.ceasefire) return false;
  const [bx, by] = ai.baseCenter();
  const refs = w.buildings.filter((b) => b.alive && b.owner === p && b.bt.dock && b.active);
  // an ore truck being shot at far from home: back next to a refinery, cargo and all
  if (refs.length) {
    for (const h of w.units) {
      if (!h.alive || h.owner !== p || !h.ut.harvester || w.tick - h.lastDamagedTick > TICK_HZ * 2 || h.healthFrac > 0.75) continue;
      if (Math.hypot(h.x - bx, h.y - by) < 18) continue;
      const r = refs.reduce((a, b) => (Math.hypot(b.x - h.x, b.y - h.y) < Math.hypot(a.x - h.x, a.y - h.y) ? b : a));
      const [x, y] = w.findFreeSpot(r.x, r.y + r.h / 2 + 1.5, 4);
      if (!w.map.passable(Math.floor(x), Math.floor(y))) continue;
      w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x, y, unit: h.id });
      ai.chronoSince = -1;
      ai.say('chrono', x, y);
      return true;
    }
  }
  // the assault: the best tank waiting at home joins it, right behind the front
  if (ai.state === 'attack' && ai.stage === 'assault') {
    const wave = ai.waveUnits();
    if (wave.length >= 4) {
      const cx = wave.reduce((s, u) => s + u.x, 0) / wave.length, cy = wave.reduce((s, u) => s + u.y, 0) / wave.length;
      const tank = ai.available()
        .filter((u) => u.kind === 'vehicle' && !ai.wave.has(u.id) && u.healthFrac > 0.8 && !u.ut.noMovingFire && u.ut.cost >= 700 && Math.hypot(u.x - bx, u.y - by) < 16)
        .sort((a, b) => b.ut.cost - a.ut.cost || a.id - b.id)[0];
      if (tank) {
        const dx = bx - cx, dy = by - cy, l = Math.hypot(dx, dy) || 1;
        const [x, y] = w.findFreeSpot(cx + (dx / l) * 2.5, cy + (dy / l) * 2.5, 4);
        if (w.map.passable(Math.floor(x), Math.floor(y))) {
          w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x, y, unit: tank.id });
          ai.wave.add(tank.id);
          ai.chronoSince = -1;
          ai.say('chrono', x, y);
          return true;
        }
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------- spies

/** Spies bought for the enemy Radar Dome at most (a dome guarded by dogs isn't worth a fortune in spies). */
const MAX_RADAR_SPIES = 3;

/**
 * A spy in the enemy Radar Dome shares its radar (sim/infiltration.ts): the AI's intel then follows that enemy's army
 * (ai-intel.ts). So once a dome is known, one spy at a time goes for it (ai-content.ts walks it in). A thief goes
 * after a bank the AI knows is full (a refinery spied earlier shows the enemy's credits).
 */
export function alliedSpies(ai: AIController) {
  const w = ai.world, p = ai.p;
  if (!ai.due(TICK_HZ * 3) || ai.ceasefire) return;
  // the radar spy on its way: into the dome once it is known, else into the enemy base to find it
  const spy = ai.radarSpy ? w.entities.get(ai.radarSpy) : undefined;
  if (ai.radarSpy && !(spy instanceof Unit && spy.alive && spy.owner === p)) ai.radarSpy = 0;
  if (!ai.radarSpy) {
    const fresh = w.units.find((u) => u.alive && u.owner === p && u.ut.spy && u.order.type !== 'enter' && w.tick - ai.lastSpy < TICK_HZ * 120);
    if (fresh && ai.spyTries > 0) ai.radarSpy = fresh.id;
  }
  if (ai.radarSpy) { guideSpy(ai, w.entities.get(ai.radarSpy) as Unit); return; }
  if (w.time < 200 || w.tick - ai.lastSpy < TICK_HZ * 90) return;
  // a thief only pays against a fat bank, and a spied refinery tells (half of it is stolen: RA)
  const rich = p.intel.credits.some((id) => w.players[id] && !w.players[id].defeated && w.players[id].credits >= 2500);
  if (rich && p.canBuild('thf') && p.credits > 700 && !w.units.some((u) => u.alive && u.owner === p && u.ut.thief) && !Object.values(p.queues).some((q) => q.items.some((it) => it.type === 'thf'))) {
    ai.lastSpy = w.tick;
    w.issue({ c: 'build', player: p.id, type: 'thf' });
    return;
  }
  if (ai.spyTries >= MAX_RADAR_SPIES || !p.canBuild('spy') || p.credits < 450) return;
  // a dome to spy: one we know of, or (four minutes in) the one the enemy base (found, or the likeliest start
  // position) surely has by now
  const [bx, by] = ai.baseCenter();
  const known = domeTarget(ai);
  if (!known && (w.time < 240 || !ai.intel.enemyBase(bx, by))) return;
  if (!known && w.players.every((o) => !p.isEnemy(o) || o.defeated || p.intel.radar.includes(o.id))) return;
  if (w.units.some((u) => u.alive && u.owner === p && u.ut.spy) || Object.values(p.queues).some((q) => q.items.some((it) => it.type === 'spy'))) return;
  ai.spyTries++;
  ai.lastSpy = w.tick;
  w.issue({ c: 'build', player: p.id, type: 'spy' });
}

/** The enemy Radar Dome to spy on (known, standing, its radar not shared yet), nearest the point. */
function domeTarget(ai: AIController, x?: number, y?: number): Building | null {
  const w = ai.world, p = ai.p;
  let best: Building | null = null, bestD = Infinity;
  for (const s of ai.intel.structures.values()) {
    if (s.type !== 'dome' || p.intel.radar.includes(s.owner)) continue;
    const b = w.entities.get(s.id);
    if (!(b instanceof Building) || !b.alive || !p.isEnemy(b.owner) || !b.bt.radar) continue; // (a decoy dome is no dome)
    const d = x === undefined ? 0 : Math.hypot(b.x - x, b.y - y!);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

function guideSpy(ai: AIController, spy: Unit) {
  const w = ai.world, p = ai.p;
  const dome = domeTarget(ai, spy.x, spy.y);
  if (dome) {
    if (spy.order.type !== 'enter' || spy.order.target !== dome.id) w.issue({ c: 'enter', player: p.id, units: [spy.id], target: dome.id });
    return;
  }
  if (spy.order.type !== 'idle') return;
  // no dome in sight yet: walk the enemy base, a different side each time
  const [bx, by] = ai.baseCenter();
  const e = ai.intel.enemyBase(bx, by);
  if (!e) return;
  const a = ((w.tick / (TICK_HZ * 20)) | 0) * 2.4;
  const [x, y] = w.findFreeSpot(e[0] + Math.cos(a) * 6, e[1] + Math.sin(a) * 6, 4);
  w.issue({ c: 'move', player: p.id, units: [spy.id], x, y });
}

// ---------------------------------------------------------------------------------------------- artillery

/**
 * Artillery in an assault stays behind the tanks: a howitzer with an enemy ground unit closer than its comfort
 * distance (inside its minimum range, or simply too close for 75 hit points) falls back past the nearest friendly
 * armour, and resumes firing from there (an idle wave unit picks the next target, ai.ts). Every 2 s.
 */
export function alliedArtillery(ai: AIController, alive: Unit[]) {
  const w = ai.world, p = ai.p;
  const guns = alive.filter((u) => u.ut.noMovingFire && u.kind === 'vehicle');
  if (!guns.length || guns.length === alive.length) return;
  const screen = alive.filter((u) => !u.ut.noMovingFire && u.kind === 'vehicle');
  const out = new Map<string, number[]>();
  for (const g of guns) {
    const min = g.weapons[0]?.def.minRange ?? 0;
    let near: Unit | null = null, nd = Math.max(3.5, min + 1.5);
    w.grid.query(g.x, g.y, nd, (o) => {
      if (!o.alive || !p.isEnemy(o.owner) || o.isAir || o.kind === 'naval' || !ai.intel.sees(o)) return;
      const d = Math.hypot(o.x - g.x, o.y - g.y);
      if (d < nd) { nd = d; near = o; }
    });
    if (!near) continue;
    const e = near as Unit;
    // back off along the line from the threat, through the nearest friendly tank if there is one
    let dx = g.x - e.x, dy = g.y - e.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    let tx = g.x + dx * 3.5, ty = g.y + dy * 3.5;
    const tank = screen.reduce<Unit | null>((b, u) => (!b || Math.hypot(u.x - g.x, u.y - g.y) < Math.hypot(b.x - g.x, b.y - g.y) ? u : b), null);
    if (tank && Math.hypot(tank.x - g.x, tank.y - g.y) < 8) { tx = tank.x + dx * 2.5; ty = tank.y + dy * 2.5; }
    const fx = Math.floor(tx), fy = Math.floor(ty);
    if (!w.map.inBounds(fx, fy) || !w.map.passable(fx, fy)) continue;
    const k = `${Math.round(tx)},${Math.round(ty)}`;
    (out.get(k) ?? out.set(k, []).get(k)!).push(g.id);
  }
  for (const [k, ids] of out) {
    const [x, y] = k.split(',').map(Number);
    w.issue({ c: 'move', player: p.id, units: ids, x: x + 0.5, y: y + 0.5 });
  }
}

// ---------------------------------------------------------------------------------------------- wave targets

/**
 * How much the defences covering a structure count against attacking it (pickAttackTarget): every known armed
 * structure of the same owner whose reach covers it, weighed by price (a Tesla Coil reaching 8.5 cells counts far
 * more than a flame tower). Score units are cells of detour, as in the caller.
 */
export function coilPenalty(known: KnownStructure[], s: KnownStructure): number {
  let pen = 0;
  for (const d of known) {
    if (!d.armed || d === s || d.owner !== s.owner || d.aa) continue;
    if (Math.hypot(d.x - s.x, d.y - s.y) < d.range + 1.5) pen += 1.5 + d.cost / 400;
  }
  return pen;
}
