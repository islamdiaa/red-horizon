/**
 * Extra measurements for scripted scenarios (MatchSpec.probe), sampled while a match plays (lib.ts playMatch):
 *
 *  - teams: how AI teammates treat the human players on their team (2v2 with AI allies, co-op): do they come to the
 *           human's base when it is attacked, join or follow the human's attacks, sit idle, or mine the human's ore;
 *           and in free-for-alls, whom the AIs' waves go for (the human or each other).
 *  - naval: what each AI fields at sea (ships built and lost, value of enemy ships and shore targets destroyed by ships).
 *
 * Everything here only reads the world (no commands), so a probed match plays exactly like an unprobed one.
 */
import { Building, Unit } from '../../src/sim/entities';
import type { Player } from '../../src/sim/player';
import { TICK_HZ } from '../../src/sim/types';
import type { World } from '../../src/sim/world';

export interface TeamsProbe {
  /** Per human slot: attacks on the base (enemy force of $600+ within 13 cells of the yard), how many an AI teammate sent help to, and how many saw its army arrive within 150 s (median seconds to arrive). */
  baseAttacks: number;
  helpSent: number;
  helped: number;
  helpSeconds: number[];
  /** Human pushes (4+ combat units within 22 cells of an enemy base) and how many an AI teammate joined (its units at an enemy base within 90 s). */
  pushes: number;
  joined: number;
  /** AI teammates: samples (every 10 s after minute 8) with the whole army idle at home, of all samples. */
  allyIdle: number;
  allySamples: number;
  /** AI teammates' Ore Truck samples harvesting within 12 cells of a human teammate's refinery, of all harvesting samples. */
  allyOreNearHuman: number;
  allyOreSamples: number;
  /** Waves launched by each AI, by the player they went for: [ai slot, target slot, count]. */
  waveTargets: [number, number, number][];
  /** Minute each player was defeated (-1 = survived). */
  defeatedAt: number[];
}

export interface NavalProbe {
  /** Per player: ships built, ships lost, value destroyed by its ships (ships / everything else). */
  built: number[];
  lost: number[];
  killedShips: number[];
  killedOther: number[];
  /** Per player: whether it had a naval yard at any time. */
  yard: boolean[];
}

const ARMY = (u: Unit) => u.alive && u.weapons.length > 0 && !u.ut.harvester && !u.ut.deploysInto && !u.ut.supportPlane && u.kind !== 'aircraft' && u.kind !== 'naval';

function yardOf(w: World, p: Player): Building | undefined {
  return w.buildings.find((b) => b.alive && b.owner === p && b.bt.id === 'fact') ?? w.buildings.find((b) => b.alive && b.owner === p && !b.bt.wall && !b.bt.mine);
}

export class Probe {
  teams?: TeamsProbe;
  naval?: NavalProbe;
  private attackOpen: Map<number, number> = new Map(); // human slot -> tick the current attack began (-1 = helped)
  private sentFor = new Set<number>(); // attack start ticks help was sent for
  private pushOpen: Map<number, number> = new Map();
  private lastWaves = new Map<number, number>();
  private seenShips = new Set<number>();

  constructor(private w: World, kind: string) {
    const n = w.players.length;
    if (kind === 'teams') this.teams = { baseAttacks: 0, helpSent: 0, helped: 0, helpSeconds: [], pushes: 0, joined: 0, allyIdle: 0, allySamples: 0, allyOreNearHuman: 0, allyOreSamples: 0, waveTargets: [], defeatedAt: Array(n).fill(-1) };
    if (kind === 'naval') this.naval = { built: Array(n).fill(0), lost: Array(n).fill(0), killedShips: Array(n).fill(0), killedOther: Array(n).fill(0), yard: Array(n).fill(false) };
  }

  /** A unit or structure died (lib.ts wraps World.kill). */
  onKill(victim: Unit | Building, killer: Unit | Building | undefined) {
    const nv = this.naval;
    if (!nv) return;
    if (victim instanceof Unit && victim.kind === 'naval' && victim.owner.id >= 0) nv.lost[victim.owner.id]++;
    if (killer instanceof Unit && killer.kind === 'naval' && killer.owner.id >= 0 && killer.owner !== victim.owner) {
      if (victim instanceof Unit && victim.kind === 'naval') nv.killedShips[killer.owner.id] += victim.type.cost;
      else nv.killedOther[killer.owner.id] += victim.type.cost;
    }
  }

  /** Called after every world step. */
  step() {
    const w = this.w;
    if (w.tick % (5 * TICK_HZ) !== 0) return;
    if (this.naval) this.navalStep();
    if (this.teams) this.teamsStep();
  }

  private navalStep() {
    const w = this.w, nv = this.naval!;
    for (const u of w.units) {
      if (!u.alive || u.kind !== 'naval' || u.owner.id < 0 || this.seenShips.has(u.id)) continue;
      this.seenShips.add(u.id);
      nv.built[u.owner.id]++;
    }
    for (const b of w.buildings) if (b.alive && b.owner.id >= 0 && (b.bt.id === 'syrd' || b.bt.id === 'spen')) nv.yard[b.owner.id] = true;
  }

  private teamsStep() {
    const w = this.w, t = this.teams!;
    const players = w.players;
    for (const p of players) if (p.defeated && t.defeatedAt[p.id] < 0) t.defeatedAt[p.id] = Math.round(w.time / 6) / 10;
    // waves and whom they went for
    for (const ai of w.ais as unknown as { player: Player; waves?: number; stageTarget?: [number, number] }[]) {
      const was = this.lastWaves.get(ai.player.id) ?? 0;
      if ((ai.waves ?? 0) > was && ai.stageTarget) {
        const [tx, ty] = ai.stageTarget;
        let best: Building | null = null, bd = Infinity;
        for (const b of w.buildings) {
          if (!b.alive || !ai.player.isEnemy(b.owner) || b.bt.wall || b.bt.mine) continue;
          const d = Math.hypot(b.x - tx, b.y - ty);
          if (d < bd) { bd = d; best = b; }
        }
        if (best) {
          const row = t.waveTargets.find((r) => r[0] === ai.player.id && r[1] === best!.owner.id);
          if (row) row[2]++; else t.waveTargets.push([ai.player.id, best.owner.id, 1]);
        }
      }
      this.lastWaves.set(ai.player.id, ai.waves ?? 0);
    }
    const aiIds = new Set((w.ais as unknown as { player: Player }[]).map((a) => a.player.id));
    for (const h of players) {
      if (!h.isHuman || h.defeated) continue;
      const mates = players.filter((p) => p !== h && !p.defeated && p.team === h.team && aiIds.has(p.id));
      if (!mates.length) continue;
      const yard = yardOf(w, h);
      // --- attacks on the human's base and whether a teammate's army came
      if (yard) {
        let threat = 0;
        for (const u of w.units) if (ARMY(u) && h.isEnemy(u.owner) && u.owner.id >= 0 && Math.hypot(u.x - yard.x, u.y - yard.y) < 13) threat += u.ut.cost;
        const open = this.attackOpen.get(h.id);
        if (threat >= 600) {
          if (open === undefined) { this.attackOpen.set(h.id, w.tick); t.baseAttacks++; }
          else if (open >= 0) {
            const ais = (w.ais as unknown as { player: Player; lastMateHelp?: number }[]).filter((a) => mates.includes(a.player));
            if (!this.sentFor.has(open) && ais.some((a) => (a.lastMateHelp ?? -1) >= open)) { this.sentFor.add(open); t.helpSent++; }
            const came = w.units.some((u) => ARMY(u) && mates.includes(u.owner) && Math.hypot(u.x - yard.x, u.y - yard.y) < 14);
            if (came && w.tick - open <= 150 * TICK_HZ) { t.helped++; t.helpSeconds.push((w.tick - open) / TICK_HZ); this.attackOpen.set(h.id, -1); }
          }
        } else if (open !== undefined && (open < 0 || w.tick - open > 150 * TICK_HZ || !this.sentFor.has(open))) this.attackOpen.delete(h.id);
      }
      // --- the human's pushes and whether a teammate joined
      const enemyYards = w.buildings.filter((b) => b.alive && b.bt.id === 'fact' && h.isEnemy(b.owner) && b.owner.id >= 0);
      const atEnemy = (p: Player, min: number) => enemyYards.some((y) => w.units.filter((u) => ARMY(u) && u.owner === p && Math.hypot(u.x - y.x, u.y - y.y) < 22).length >= min);
      const push = this.pushOpen.get(h.id);
      if (atEnemy(h, 4)) {
        if (push === undefined) { this.pushOpen.set(h.id, w.tick); t.pushes++; }
        else if (push >= 0 && w.tick - push <= 90 * TICK_HZ && mates.some((m) => atEnemy(m, 2))) { t.joined++; this.pushOpen.set(h.id, -1); }
      } else if (push !== undefined && (push < 0 || w.tick - push > 90 * TICK_HZ)) this.pushOpen.delete(h.id);
      // --- idle teammates and ore
      if (w.time >= 480 && w.tick % (10 * TICK_HZ) === 0) {
        for (const m of mates) {
          const army = w.units.filter((u) => ARMY(u) && u.owner === m);
          const my = yardOf(w, m);
          if (!army.length || !my) continue;
          t.allySamples++;
          if (army.every((u) => (u.order.type === 'idle' || u.order.type === 'guard') && Math.hypot(u.x - my.x, u.y - my.y) < 18)) t.allyIdle++;
        }
        const refs = w.buildings.filter((b) => b.alive && b.owner === h && b.bt.id === 'proc');
        for (const u of w.units) {
          if (!u.alive || !u.ut.harvester || !mates.includes(u.owner) || u.hstate !== 'harvesting') continue;
          t.allyOreSamples++;
          if (refs.some((r) => Math.hypot(r.x - u.x, r.y - u.y) < 12)) t.allyOreNearHuman++;
        }
      }
    }
  }
}
