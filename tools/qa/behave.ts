// Unit behaviour scenarios with numbers: what a player relies on, measured (before / after a change).
//   node --import tsx tools/qa/behave.ts [scenario|all] [-v]
// Each scenario builds a small map, gives orders the way the UI does and prints one line of metrics.
import { spawnProduced } from '../../src/sim/production';
import { DT, TICK_HZ, World, Unit, Building, makeWorld, flatMap, setTerrain, addTrees, addOre, unit, building, T, type Player } from './lib';

const V = process.argv.includes('-v');
const only = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'all';
const out: string[] = [];
const say = (s: string) => { out.push(s); console.log(s); };

/** Step the world; `each` runs once per second (return true to stop). Returns seconds elapsed. */
function runFor(w: World, secs: number, each?: (sec: number) => boolean | void): number {
  for (let t = 1; t <= secs * TICK_HZ; t++) {
    w.step();
    w.events.length = 0;
    if (t % TICK_HZ === 0 && each?.(t / TICK_HZ)) return t / TICK_HZ;
  }
  return secs;
}

/** Stall meter: unit-seconds where a living unit moved < 1 cell in 10 s without firing, while `busy(u)` holds. */
function stallMeter(w: World, ids: number[], busy: (u: Unit) => boolean) {
  const hist = new Map<number, [number, number, number][]>();
  let stalled = 0;
  const why = new Map<string, number>();
  return {
    sample() {
      for (const id of ids) {
        const u = w.entities.get(id) as Unit | undefined;
        if (!u || !u.alive) continue;
        const h = hist.get(id) ?? [];
        h.push([u.x, u.y, u.lastFireTick]);
        if (h.length > 11) h.shift();
        hist.set(id, h);
        if (h.length < 11 || !busy(u)) continue;
        const moved = Math.hypot(h[10][0] - h[0][0], h[10][1] - h[0][1]);
        const fired = u.lastFireTick > w.tick - 10 * TICK_HZ;
        if (moved < 1 && !fired) {
          stalled++;
          const o = u.order;
          const t = o.type === 'attack' ? w.entities.get(o.target) : undefined;
          const k = `${u.ut.id} ${o.type}${t ? ':' + (t instanceof Building ? t.bt.id : (t as Unit).ut.id) : ''}${u.path ? ' path' : u.pathPending ? ' pending' : ''}`;
          why.set(k, (why.get(k) ?? 0) + 1);
        }
      }
    },
    get stalled() { return stalled; },
    why: () => [...why].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} x${n}`).join(', '),
  };
}

const attackMoving = (u: Unit) => (u.order.type === 'move' && !!u.order.attackMove) || (u.order.type === 'attack' && !!u.order.resume);
const living = (w: World, ids: number[]) => ids.map((id) => w.entities.get(id) as Unit).filter((u) => u && u.alive);

function army(w: World, p: Player, types: string[], x: number, y: number, cols = 5): number[] {
  return types.map((t, k) => {
    const [fx, fy] = w.findFreeSpot(x + (k % cols) * 0.9, y + Math.floor(k / cols) * 0.9, 6, t !== 'e1' && t !== 'e3');
    return unit(w, p, t, fx, fy).id;
  });
}

const scenarios: Record<string, () => void> = {
  /** Attack-move along a river; enemy infantry stand on the far bank (seen, unreachable). */
  river() {
    const m = flatMap(64, 40);
    setTerrain(m, 0, 18, 63, 19, T.Water);
    const w = makeWorld(m, [{ faction: 'allies', human: true }, { faction: 'soviet', human: true }], { fog: true });
    const [me, foe] = w.players;
    const ids = army(w, me, ['e1', 'e1', 'e1', 'e1', 'e1', 'e1', 'e1', 'e1', 'e3', 'e3', '2tnk', '2tnk', '2tnk'], 3, 13);
    for (let k = 0; k < 4; k++) unit(w, foe, 'e1', 28 + k * 1.5, +(process.env.RY ?? 20.5));
    w.issue({ c: 'move', player: me.id, units: ids, x: 58, y: +(process.env.GY ?? 16), attackMove: true });
    const sm = stallMeter(w, ids, attackMoving);
    let arrived = -1;
    runFor(w, 240, (s) => { sm.sample(); const a = living(w, ids); if (a.every((u) => Math.hypot(u.x - 58, u.y - 15) < 6)) { arrived = s; return true; } });
    say(`river:   all arrived ${arrived}s (straight ~${(55 / 0.6).toFixed(0)}s at the e3 pace); stalled unit-s ${sm.stalled}; alive ${living(w, ids).length}/${ids.length}${V ? '; ' + sm.why() : ''}`);
  },
  /** Engineers, spies and Tanya entering structures from awkward spots (trees in the way, corners, crowded sides). */
  enter() {
    const cases: [string, string, (w: World, me: Player, foe: Player) => [Unit, Building]][] = [
      ['open side', 'e6', (w, me, foe) => [unit(w, me, 'e6', 15.5, 21.5), building(w, foe, 'powr', 20, 20)]],
      ['diagonal corner', 'e6', (w, me, foe) => [unit(w, me, 'e6', 19.4, 19.3), building(w, foe, 'powr', 20, 20)]],
      ['trees on the near side', 'e6', (w, me, foe) => { addTrees(w.map, 19, 19, 19, 23); return [unit(w, me, 'e6', 17.5, 21.5), building(w, foe, 'powr', 20, 20)]; }],
      ['wall of trees, way round', 'e6', (w, me, foe) => { addTrees(w.map, 18, 16, 18, 26); return [unit(w, me, 'e6', 15.5, 21.5), building(w, foe, 'powr', 20, 20)]; }],
      ['between two structures', 'e6', (w, me, foe) => { building(w, foe, 'powr', 23, 20); return [unit(w, me, 'e6', 22.5, 25.5), building(w, foe, 'powr', 20, 20)]; }],
      ['next to its own structure', 'e6', (w, me, foe) => { building(w, me, 'powr', 17, 20); return [unit(w, me, 'e6', 16.5, 23.5), building(w, foe, 'powr', 20, 20)]; }],
      ['crowded side', 'e6', (w, me, foe) => { for (let k = 0; k < 8; k++) unit(w, me, 'e1', 19.3, 19.6 + k * 0.4).stance = 'passive'; return [unit(w, me, 'e6', 16.5, 21.5), building(w, foe, 'powr', 20, 20)]; }],
      ['tanks parked all round', 'e6', (w, me, foe) => { for (let x = 19; x <= 22; x++) for (const y of [19, 22]) unit(w, me, '2tnk', x + 0.5, y + 0.5).stance = 'passive'; for (const x of [19, 22]) { unit(w, me, '2tnk', x + 0.5, 20.5).stance = 'passive'; unit(w, me, '2tnk', x + 0.5, 21.5).stance = 'passive'; } return [unit(w, me, 'e6', 15.5, 21.5), building(w, foe, 'powr', 20, 20)]; }],
      ['spy, far side', 'spy', (w, me, foe) => [unit(w, me, 'spy', 26.5, 25.5), building(w, foe, 'dome', 20, 20)]],
      ['tanya c4, behind trees', 'e7', (w, me, foe) => { addTrees(w.map, 19, 19, 23, 19); return [unit(w, me, 'e7', 21.5, 17.5), building(w, foe, 'powr', 20, 20)]; }],
    ];
    {
      const m = flatMap(48, 48);
      const w = makeWorld(m, [{ faction: 'allies', human: true }, { faction: 'soviet', human: true }], { fog: false });
      const [me, foe] = w.players;
      const b = building(w, foe, 'fact', 20, 20);
      const es = [0, 1, 2, 3, 4].map((k) => unit(w, me, 'e6', 14.5 + (k % 3) * 0.6, 21 + Math.floor(k / 3) * 0.6));
      w.issue({ c: 'enter', player: me.id, units: es.map((u) => u.id), target: b.id });
      let done = -1;
      runFor(w, 40, (s) => { if (es.every((u) => !u.alive)) { done = s; return true; } });
      say(`enter:   ${'5 engineers at once'.padEnd(26)} e6: ${done >= 0 ? 'all in after ' + done + 's' : `${es.filter((u) => u.alive).length} NOT IN after 40s`}`);
    }
    for (const [name, , mk] of cases) {
      const m = flatMap(48, 48);
      const w = makeWorld(m, [{ faction: 'allies', human: true }, { faction: 'soviet', human: true }], { fog: false });
      const [me, foe] = w.players;
      const [u, b] = mk(w, me, foe);
      if (u.ut.engineer) b.hp = b.maxHp * 0.2;
      w.issue({ c: u.ut.engineer || u.ut.spy ? 'enter' : 'attack', player: me.id, units: [u.id], target: b.id } as any);
      let done = -1;
      const hp0 = b.hp;
      runFor(w, 40, (s) => { if (!u.alive || b.owner !== foe || !b.alive || b.c4Timer > 0 || (u.ut.spy && u.order.type !== 'enter')) { done = s; return true; } });
      say(`enter:   ${name.padEnd(26)} ${u.ut.id}: ${done >= 0 ? `in after ${done}s (${b.owner !== foe ? "captured" : !b.alive ? "destroyed" : b.c4Timer > 0 ? "c4" : u.alive ? "spied" : "used up"}, hp ${Math.round(100 * b.hp / b.maxHp)}%)` : `NOT IN after 40s (at ${u.x.toFixed(1)},${u.y.toFixed(1)} d ${b.distTo(u.x, u.y).toFixed(2)} order ${u.order.type})`}${b.hp !== hp0 && !u.ut.engineer ? '' : ''}`);
    }
  },
  /** 30 / 60 mixed units through a 2- or 3-cell gap in a rock wall and over a 3-cell bridge, there and back. */
  choke() {
    const mixes: Record<string, string[]> = {
      inf30: [...Array(20).fill('e1'), ...Array(6).fill('e3'), '2tnk', '2tnk', '1tnk', 'jeep'],
      mix60: [...Array(30).fill('e1'), ...Array(10).fill('e3'), ...Array(12).fill('2tnk'), ...Array(4).fill('1tnk'), ...Array(4).fill('arty')],
    };
    for (const kind of ['gap2', 'gap3', 'bridge3']) for (const [mixName, mix] of Object.entries(mixes)) for (const human of [true, false]) for (const am of [false, true]) {
      const m = flatMap(90, 50);
      if (kind === 'bridge3') {
        setTerrain(m, 40, 0, 44, 49, T.Water);
        m.bridges = [{ cells: [], axis: 'x' }];
        for (let y = 23; y <= 25; y++) for (let x = 40; x <= 44; x++) m.bridges[0].cells.push([x, y]);
      } else {
        const g = kind === 'gap2' ? 2 : 3;
        setTerrain(m, 42, 0, 43, 49, T.Rock);
        setTerrain(m, 42, 24, 43, 24 + g - 1, T.Clear);
      }
      const w = makeWorld(m, [{ faction: 'allies', human }, { faction: 'soviet', human: true }], { fog: false });
      const [me] = w.players;
      const ids = army(w, me, mix, 8, 14, 8);
      const sm = stallMeter(w, ids, (u) => u.order.type === 'move');
      const legs: string[] = [];
      for (const [gx, gy] of [[78, 25], [8, 25]]) {
        w.issue({ c: 'move', player: me.id, units: ids, x: gx, y: gy, attackMove: am });
        let t = -1;
        const t0 = w.tick;
        runFor(w, 300, (sec) => { sm.sample(); const a = living(w, ids); if (a.every((u) => u.order.type === 'idle' && Math.hypot(u.x - gx, u.y - gy) < 9)) { t = sec; return true; } });
        const a = living(w, ids);
        const quit = a.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - gx, u.y - gy) >= 9).length;
        legs.push(t >= 0 ? `${t}s` : `NOT DONE (${a.filter((u) => Math.hypot(u.x - gx, u.y - gy) < 9).length}/${a.length} there, ${quit} gave up)`);
        void t0;
      }
      say(`choke:   ${kind} ${mixName} ${human ? 'human' : 'ai   '} ${am ? 'attack-move' : 'move       '} out ${legs[0]}, back ${legs[1]}; stalled unit-s ${sm.stalled}${V ? '; ' + sm.why() : ''}`);
    }
  },
  /** Ore Trucks: a near field that runs dry, a far one, one or two refineries, a crowd parked by the dock. */
  harvest() {
    const cases: [string, number, number, boolean][] = [['4 trucks 1 refinery', 4, 1, false], ['8 trucks 1 refinery', 8, 1, false], ['8 trucks 2 refineries', 8, 2, false], ['4 trucks, tanks parked at the dock', 4, 1, true]];
    for (const [name, nh, nr, crowd] of cases) {
      const m = flatMap(64, 64);
      addOre(m, 18, 8, 22, 12, 3); // small near field (25 cells x 3 bails): runs dry
      addOre(m, 40, 40, 47, 47, 9); // far field
      addTrees(m, 30, 20, 31, 36);
      const w = makeWorld(m, [{ faction: 'allies', human: true }, { faction: 'soviet', human: true }], { fog: false });
      const [me] = w.players;
      building(w, me, 'powr', 4, 4);
      building(w, me, 'powr', 4, 8);
      const refs = [building(w, me, 'proc', 10, 8)];
      if (nr > 1) refs.push(building(w, me, 'proc', 15, 16));
      for (let k = 0; k < 6; k++) building(w, me, 'silo', 1 + k, 1); // (storage: income isn't capped by full silos)
      for (const u of w.units.filter((x) => x.ut.harvester)) { u.alive = false; w.entities.delete(u.id); }
      w.units = w.units.filter((x) => x.alive);
      const hs: Unit[] = [];
      for (let k = 0; k < nh; k++) { const h = unit(w, me, 'harv', 9 + (k % 4) * 1.2, 14 + Math.floor(k / 4) * 1.2); hs.push(h); w.setOrder(h, { type: 'harvest' }); }
      if (crowd) for (let k = 0; k < 6; k++) unit(w, me, '2tnk', 10.5 + (k % 3), 12.5 + Math.floor(k / 3));
      const c0 = me.stats.harvested;
      let idle = 0, stuck = 0, firstFar = -1;
      const last = new Map<number, [number, number, number]>();
      runFor(w, 600, (sec) => {
        me.ore = 0; // (spent as it comes in: full silos never cap the income)
        for (const h of hs) {
          if (!h.alive) continue;
          if (h.order.type !== 'harvest' || h.hstate === 'idle' || (h.hstate === 'seek' && !h.path && !h.pathPending && h.waitTimer > 0)) idle++;
          const l = last.get(h.id);
          const busy = h.hstate === 'toOre' || h.hstate === 'toRefinery';
          if (l && busy && Math.hypot(h.x - l[0], h.y - l[1]) < 0.05) stuck++;
          last.set(h.id, [h.x, h.y, sec]);
          if (firstFar < 0 && h.hstate === 'harvesting' && h.x > 38) firstFar = sec;
        }
      });
      const nearLeft = [...Array(5)].reduce((s, _, dy) => s + [...Array(5)].reduce((t, __, dx) => t + m.ore[m.idx(18 + dx, 8 + dy)], 0), 0);
      say(`harvest: ${name.padEnd(34)} harvested $${Math.round(me.stats.harvested - c0)} in 10 min; idle truck-s ${idle}; motionless while travelling truck-s ${stuck}; near field left ${nearLeft}; first at far field ${firstFar}s`);
    }
  },
  /** A factory in a cramped base turning out 40 units, every one sent to the same rally point (as production does). */
  rally() {
    for (const kind of ['tanks', 'infantry', 'mixed']) {
      const m = flatMap(64, 64);
      const w = makeWorld(m, [{ faction: 'allies', human: true }, { faction: 'soviet', human: true }], { fog: false });
      const [me] = w.players;
      const weap = building(w, me, 'weap', 20, 20);
      const tent = building(w, me, 'tent', 25, 20);
      building(w, me, 'powr', 16, 20); building(w, me, 'powr', 20, 26); building(w, me, 'proc', 16, 25); building(w, me, 'powr', 28, 22);
      weap.rallyX = tent.rallyX = 23.5; weap.rallyY = tent.rallyY = 31.5;
      const ids: number[] = [];
      let n = 0, settled = -1, moveSecs = 0;
      runFor(w, 200, (sec) => {
        if (n < 40 && sec % 2 === 0) {
          const t = kind === 'tanks' ? '2tnk' : kind === 'infantry' ? 'e1' : n % 3 ? 'e1' : '2tnk';
          spawnProduced(w, me, t);
          const u = w.units[w.units.length - 1];
          ids.push(u.id); n++;
        }
        const a = living(w, ids);
        const busy = a.filter((u) => u.order.type === 'move' || u.moving).length;
        if (n >= 40) moveSecs += busy;
        if (n >= 40 && settled < 0 && busy === 0) settled = sec;
      });
      const a = living(w, ids);
      const far = a.filter((u) => Math.hypot(u.x - 23.5, u.y - 31.5) > 7).length;
      const door = a.filter((u) => weap.distTo(u.x, u.y) < 1.5 || tent.distTo(u.x, u.y) < 1.2).length;
      say(`rally:   ${kind.padEnd(9)} 40 units: all settled ${settled >= 0 ? settled - 80 + 's after the last one' : 'NEVER (' + a.filter((u) => u.order.type === 'move').length + ' still moving)'}; moving unit-s after the last ${moveSecs}; >7 cells off ${far}; blocking a door ${door}`);
    }
  },
  /** Aircraft sorties and rearming, an APC run, the service depot queue, an MCV on a blocked spot, unreachable orders. */
  support() {
    const newWorld = (w0 = 64, h0 = 64) => {
      const w = makeWorld(flatMap(w0, h0), [{ faction: 'allies', human: true }, { faction: 'soviet', human: true }], { fog: false });
      return { w, me: w.players[0], foe: w.players[1] };
    };
    // aircraft: two Longbows from two pads at a tank column 30 cells away, twice
    for (const [plane, pad, foeT] of [['heli', 'hpad', '3tnk'], ['mig', 'afld', '3tnk'], ['yak', 'afld', 'e1']] as const) {
      const { w, me, foe } = newWorld();
      const owner = plane === 'heli' ? me : foe, enemy = plane === 'heli' ? foe : me;
      const pads = [building(w, owner, pad, 6, 6), building(w, owner, pad, 6, 10)];
      const air = pads.map((p) => { const a = unit(w, owner, plane, p.x, p.y); a.altitude = 0; return a; });
      const tgts = [0, 1, 2, 3, 4, 5].map((k) => unit(w, enemy, foeT, 40 + (k % 3), 40 + Math.floor(k / 3)));
      for (const t of tgts) t.stance = 'passive';
      const sortie = () => { for (const a of air) { const t = tgts.find((x) => x.alive); if (t) w.issue({ c: 'attack', player: owner.id, units: [a.id], target: t.id }); } };
      const log: string[] = [];
      for (let k = 0; k < 2; k++) {
        sortie();
        let back = -1;
        const t0 = w.tick;
        runFor(w, 120, (sec) => { if (sec > 3 && air.every((a) => !a.alive || (a.altitude < 0.05 && a.ammo >= (a.ut.ammo ?? 0)))) { back = sec; return true; } });
        log.push(back >= 0 ? `sortie ${k + 1} back and rearmed ${back}s` : `sortie ${k + 1} NOT back/rearmed in 120s (${air.map((a) => `${a.order.type} alt ${a.altitude.toFixed(1)} ammo ${a.ammo}`).join('; ')})`);
        void t0;
      }
      say(`support: ${plane.padEnd(4)} from ${pad}: ${log.join(', ')}; targets left ${tgts.filter((t) => t.alive).length}/6`);
    }
    // APC: load five riflemen, drive 30 cells, unload
    {
      const { w, me } = newWorld();
      const apc = unit(w, me, 'apc', 10.5, 10.5);
      const inf = [0, 1, 2, 3, 4].map((k) => unit(w, me, 'e1', 13 + k * 0.6, 12));
      w.issue({ c: 'enter', player: me.id, units: inf.map((u) => u.id), target: apc.id });
      const tl = runFor(w, 30, () => apc.passengers.length === 5);
      w.issue({ c: 'move', player: me.id, units: [apc.id], x: 40.5, y: 40.5 });
      const tm = runFor(w, 60, () => !apc.path && !apc.pathPending && Math.hypot(apc.x - 40.5, apc.y - 40.5) < 1);
      w.issue({ c: 'deploy', player: me.id, units: [apc.id] });
      const tu = runFor(w, 20, () => apc.passengers.length === 0);
      const out = inf.filter((u) => u.alive && !u.transport && Math.hypot(u.x - 40.5, u.y - 40.5) < 3).length;
      say(`support: apc  loaded in ${tl}s, drove 42 cells in ${tm}s, unloaded in ${tu}s, ${out}/5 out next to it`);
    }
    // service depot: six damaged tanks sent to one depot
    {
      const { w, me } = newWorld();
      building(w, me, 'powr', 4, 4);
      const fix = building(w, me, 'fix', 20, 20);
      const tanks = [0, 1, 2, 3, 4, 5].map((k) => { const t = unit(w, me, '2tnk', 30 + (k % 3) * 1.2, 30 + Math.floor(k / 3) * 1.2); t.hp = t.maxHp * 0.3; return t; });
      w.issue({ c: 'enter', player: me.id, units: tanks.map((u) => u.id), target: fix.id });
      let all = -1;
      runFor(w, 400, (sec) => { if (tanks.every((t) => t.hp >= t.maxHp - 0.5)) { all = sec; return true; } });
      const waiting = tanks.filter((t) => t.hp < t.maxHp - 0.5).map((t) => `${t.order.type}@(${t.x.toFixed(0)},${t.y.toFixed(0)}) ${Math.round(100 * t.hp / t.maxHp)}%`);
      say(`support: fix  6 tanks at 30%: ${all >= 0 ? 'all repaired in ' + all + 's' : 'NOT all repaired in 400s: ' + waiting.join(', ')}; credits spent ${Math.round(10000 - me.credits)}`);
    }
    // MCV on a blocked spot: trees all round
    {
      const { w, me } = newWorld();
      addTrees(w.map, 18, 18, 22, 22);
      for (let y = 19; y <= 22; y++) for (let x = 20; x <= 20; x++) w.map.tree[w.map.idx(x, y)] = 0; // (a lane out to the south)
      const mcv = unit(w, me, 'mcv', 20.5, 20.5);
      w.issue({ c: 'deploy', player: me.id, units: [mcv.id] });
      runFor(w, 5);
      const r1 = mcv.alive ? `still an MCV (${mcv.order.type})` : 'deployed';
      w.issue({ c: 'move', player: me.id, units: [mcv.id], x: 30.5, y: 30.5 });
      runFor(w, 30);
      w.issue({ c: 'deploy', player: me.id, units: [mcv.id] });
      runFor(w, 5);
      say(`support: mcv  deploy among trees -> ${r1}; moved out and deployed -> ${mcv.alive ? 'NOT deployed' : 'deployed'} (${w.buildings.filter((b) => b.bt.id === 'fact').length} yard)`);
    }
    // unreachable: a tank ordered onto an island and into a lake, an infantry group onto water
    {
      const m = flatMap(64, 64);
      setTerrain(m, 30, 0, 37, 63, T.Water);
      setTerrain(m, 45, 20, 52, 27, T.Water);
      setTerrain(m, 48, 23, 49, 24, T.Clear); // an islet in the lake
      const w = makeWorld(m, [{ faction: 'allies', human: true }, { faction: 'soviet', human: true }], { fog: false });
      const [me] = w.players;
      const t1 = unit(w, me, '2tnk', 40.5, 30.5);
      const t2 = unit(w, me, '2tnk', 10.5, 30.5);
      const inf = [0, 1, 2, 3, 4, 5].map((k) => unit(w, me, 'e1', 12 + k * 0.6, 34));
      const pf = w.pathfinder as any; const f0 = pf.find.bind(pf); let searches = 0, nodes = 0;
      pf.find = (...a: any[]) => { const r = f0(...a); searches++; nodes += pf.expandedLastSearch; return r; };
      w.issue({ c: 'move', player: me.id, units: [t1.id], x: 48.5, y: 23.5 });
      w.issue({ c: 'move', player: me.id, units: [t2.id], x: 40.5, y: 50.5 });
      w.issue({ c: 'move', player: me.id, units: inf.map((u) => u.id), x: 33.5, y: 20.5 });
      let idleAt = -1;
      runFor(w, 90, (sec) => { if (idleAt < 0 && [t1, t2, ...inf].every((u) => u.order.type === 'idle')) idleAt = sec; });
      say(`support: unreachable orders (islet, far shore, open water): all stopped ${idleAt}s; tank1 ${Math.hypot(t1.x - 48.5, t1.y - 23.5).toFixed(1)} from goal, tank2 at x ${t2.x.toFixed(1)} (shore 29.5); ${searches} searches, ${nodes} nodes`);
    }
  },
  /** A fleet crossing a sea with islands, and a transport ferrying a squad from beach to beach. */
  naval() {
    const m = flatMap(80, 60);
    setTerrain(m, 10, 0, 69, 59, T.Water);
    setTerrain(m, 30, 10, 34, 25, T.Clear); setTerrain(m, 45, 30, 50, 52, T.Clear); setTerrain(m, 38, 26, 40, 28, T.Clear);
    const w = makeWorld(m, [{ faction: 'allies', human: true }, { faction: 'soviet', human: true }], { fog: false });
    const [me] = w.players;
    const fleet = ['dd', 'dd', 'dd', 'pt', 'pt', 'pt', 'ca', 'ca'].map((t, k) => { const u = unit(w, me, t, 14.5 + (k % 4) * 1.6, 20.5 + Math.floor(k / 4) * 1.6); return u; });
    for (const am of [false, true]) {
      const [gx, gy] = am ? [14.5, 22.5] : [63.5, 40.5];
      w.issue({ c: 'move', player: me.id, units: fleet.map((u) => u.id), x: gx, y: gy, attackMove: am });
      let t = -1;
      const sm = stallMeter(w, fleet.map((u) => u.id), (u) => u.order.type === 'move');
      runFor(w, 200, (sec) => { sm.sample(); if (fleet.every((u) => u.order.type === 'idle' && Math.hypot(u.x - gx, u.y - gy) < 7)) { t = sec; return true; } });
      say(`naval:   8 ships ${am ? 'back (attack-move)' : 'across (move)     '}: ${t >= 0 ? 'all there in ' + t + 's' : 'NOT all there: ' + fleet.filter((u) => Math.hypot(u.x - gx, u.y - gy) >= 7).map((u) => `${u.ut.id} ${u.order.type} (${u.x.toFixed(0)},${u.y.toFixed(0)})`).join(', ')}; stalled ship-s ${sm.stalled}`);
    }
    // transport: load a squad on the west beach, land it on the east shore
    const lst = unit(w, me, 'lst', 10.8, 40.5); // (beached: RA transports load at the shore)
    const squad = ['e1', 'e1', 'e3', 'e3', '2tnk'].map((t, k) => unit(w, me, t, 6.5 + (k % 3), 38.5 + Math.floor(k / 3)));
    w.issue({ c: 'enter', player: me.id, units: squad.map((u) => u.id), target: lst.id });
    const tl = runFor(w, 60, () => squad.every((u) => !!u.transport));
    w.issue({ c: 'move', player: me.id, units: [lst.id], x: 68.5, y: 40.5 });
    const tm = runFor(w, 120, () => !lst.path && !lst.pathPending && lst.order.type === 'idle');
    w.issue({ c: 'deploy', player: me.id, units: [lst.id] });
    const tu = runFor(w, 30, () => squad.every((u) => !u.transport));
    const ashore = squad.filter((u) => u.alive && !u.transport && u.x > 69).length;
    say(`naval:   transport loaded ${squad.filter((u) => u.transport || u.x > 69).length}/5 in ${tl}s, crossed in ${tm}s (at ${lst.x.toFixed(0)},${lst.y.toFixed(0)}), unloaded in ${tu}s, ${ashore}/5 ashore`);
  },
  /** Idle units under fire, enemies walking past, a raid on a structure next to them, a unit busy with a building. */
  guard() {
    const cases: [string, (w: World, me: Player, foe: Player) => { mine: Unit[]; foes: Unit[] }][] = [
      ['shelled by a V2 from 7 cells', (w, me, foe) => { const mine = ['2tnk', '2tnk', 'e1', 'e1', 'e3', 'e3'].map((t, k) => unit(w, me, t, 20 + (k % 3), 20 + Math.floor(k / 3))); const v = unit(w, foe, 'v2rl', 28.5, 21); w.setOrder(v, { type: 'attack', target: mine[0].id, forced: true }); v.stance = 'hold'; return { mine, foes: [v] }; }],
      ['tanks drive past at 4 cells', (w, me, foe) => { const f = [unit(w, foe, '3tnk', 10.5, 25), unit(w, foe, '3tnk', 9.5, 25)]; for (const x of f) { x.stance = 'passive'; w.setOrder(x, { type: 'move', x: 40.5, y: 25, attackMove: false }); } return { mine: ['2tnk', '2tnk', 'e3', 'e3'].map((t, k) => unit(w, me, t, 22 + k, 21)), foes: f }; }],
      ['raid on a power plant next to them', (w, me, foe) => { const b = building(w, me, 'powr', 22, 18); const f = [unit(w, foe, '3tnk', 30.5, 19.5)]; w.setOrder(f[0], { type: 'attack', target: b.id, forced: false }); return { mine: ['2tnk', 'e1', 'e1', 'e3'].map((t, k) => unit(w, me, t, 24.5 + k * 0.8, 22.5)), foes: f }; }],
      ['busy with a building, shot by a tank', (w, me, foe) => { const b = building(w, foe, 'powr', 24, 20); const mine = ['2tnk', '2tnk', 'e3', 'e3'].map((t, k) => unit(w, me, t, 18 + k * 0.9, 21)); w.issue({ c: 'attack', player: me.id, units: mine.map((u) => u.id), target: b.id }); return { mine, foes: [unit(w, foe, '3tnk', 22.5, 24.5)] }; }],
      ['attack-moving into a flame tower + barracks', (w, me, foe) => { building(w, foe, 'barr', 26, 19); const ft = building(w, foe, 'ftur', 24, 22); const mine = ['e1', 'e1', 'e1', 'e1', 'e3', 'e3', '2tnk', '2tnk'].map((t, k) => unit(w, me, t, 10 + (k % 4), 20 + Math.floor(k / 4))); w.issue({ c: 'move', player: me.id, units: mine.map((u) => u.id), x: 40, y: 21, attackMove: true }); return { mine, foes: [ft as any] }; }],
      ['attack-moving, shot by a tank', (w, me, foe) => { const mine = ['2tnk', '2tnk', 'e3', 'e3', 'e1', 'e1'].map((t, k) => unit(w, me, t, 8 + (k % 3), 20 + Math.floor(k / 3))); w.issue({ c: 'move', player: me.id, units: mine.map((u) => u.id), x: 40, y: 21, attackMove: true }); const f = [unit(w, foe, '3tnk', 24.5, 24.5)]; f[0].stance = 'hold'; return { mine, foes: f }; }],
    ];
    for (const [name, mk] of cases) {
      const w = makeWorld(flatMap(48, 48), [{ faction: 'allies', human: true }, { faction: 'soviet', human: true }], { fog: true });
      const [me, foe] = w.players;
      const { mine, foes } = mk(w, me, foe);
      let firstShot = -1, dead = -1;
      const t0 = w.tick;
      for (let t = 1; t <= 60 * TICK_HZ; t++) {
        w.step(); w.events.length = 0;
        if (firstShot < 0 && mine.some((u) => u.alive && u.lastFireTick === w.tick && u.target && foes.includes(u.target as Unit))) firstShot = t / TICK_HZ;
        if (foes.every((f) => !f.alive)) { dead = t / TICK_HZ; break; }
      }
      void t0;
      say(`guard:   ${name.padEnd(36)} first shot at it ${firstShot < 0 ? 'NEVER' : firstShot.toFixed(1) + 's'}; ${dead >= 0 ? 'killed in ' + dead.toFixed(0) + 's' : 'not killed in 60s'}; lost ${mine.filter((u) => !u.alive).length}/${mine.length}`);
    }
  },
};

for (const [k, f] of Object.entries(scenarios)) if (only === 'all' || only === k) f();
