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
import type { AIController } from '../../src/sim/ai';
import { waveNeeds } from '../../src/sim/ai-engage';

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

/**
 * 'ai': what each skirmish AI thinks and does (a diagnosis of the Classic levels): every 30 s its army (all, and
 * idle at home), the enemies' true land army, its own estimate of it (Classic, ai-engage.ts), what its next wave would
 * need, its state; every wave it launched (value, how it ended, what it killed and lost); Ore Trucks it lost and where.
 */
export interface AIProbe {
  series: { slot: number; min: number; army: number; idle: number; enemyArmy: number; est: number; need: number; state: string; bank: number; structures: number; known: number; hunt: boolean }[];
  waves: { slot: number; min: number; value: number; endMin: number; end: string; killed: number; lost: number; reached: boolean }[];
  /** Ore Trucks lost: minute, and where (distance to its own yard vs the nearest enemy yard: home < 18 cells, enemy side, middle). */
  harvLost: { slot: number; min: number; where: 'home' | 'mid' | 'enemy' }[];
  /** Every player at the end: what is left of it (structures and units by type), its bank, how far its structures and units are spread from its yard (or their centre), structures placed after minute 15. */
  end: { slot: number; structures: Record<string, number>; units: Record<string, number>; credits: number; spreadB: number; spreadU: number; lateBuilt: number; yard: boolean }[];
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
  ai?: AIProbe;
  private openWave = new Map<number, AIProbe['waves'][number] & { ids: Set<number> }>();
  private attackOpen: Map<number, number> = new Map(); // human slot -> tick the current attack began (-1 = helped)
  private sentFor = new Set<number>(); // attack start ticks help was sent for
  private pushOpen: Map<number, number> = new Map();
  private lastWaves = new Map<number, number>();
  private seenShips = new Set<number>();

  constructor(private w: World, kind: string) {
    const n = w.players.length;
    if (kind === 'teams') this.teams = { baseAttacks: 0, helpSent: 0, helped: 0, helpSeconds: [], pushes: 0, joined: 0, allyIdle: 0, allySamples: 0, allyOreNearHuman: 0, allyOreSamples: 0, waveTargets: [], defeatedAt: Array(n).fill(-1) };
    if (kind === 'ai') this.ai = { series: [], waves: [], harvLost: [], end: [] };
    if (kind === 'naval') this.naval = { built: Array(n).fill(0), lost: Array(n).fill(0), killedShips: Array(n).fill(0), killedOther: Array(n).fill(0), yard: Array(n).fill(false) };
  }

  /** A unit or structure died (lib.ts wraps World.kill). */
  onKill(victim: Unit | Building, killer: Unit | Building | undefined) {
    if (this.ai) this.aiKill(victim, killer);
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
    if (this.ai) this.aiStep();
  }

  private lateBuilt = new Map<number, number>();

  /** Called once after the match (lib.ts). */
  finish() {
    const w = this.w, pr = this.ai;
    if (!pr) return;
    for (const p of w.players) {
      const structures: Record<string, number> = {}, units: Record<string, number> = {};
      const bs = w.buildings.filter((b) => b.alive && b.owner === p && !b.bt.wall && !b.bt.mine);
      const us = w.units.filter((u) => u.alive && u.owner === p && !u.ut.supportPlane);
      for (const b of bs) structures[b.bt.id] = (structures[b.bt.id] ?? 0) + 1;
      for (const u of us) units[u.ut.id] = (units[u.ut.id] ?? 0) + 1;
      const yard = bs.find((b) => b.bt.id === 'fact');
      const all = [...bs, ...us];
      const cx = yard ? yard.x : all.reduce((s, e) => s + e.x, 0) / Math.max(1, all.length), cy = yard ? yard.y : all.reduce((s, e) => s + e.y, 0) / Math.max(1, all.length);
      const spread = (es: { x: number; y: number }[]) => Math.round(es.reduce((m, e) => Math.max(m, Math.hypot(e.x - cx, e.y - cy)), 0));
      pr.end.push({ slot: p.id, structures, units, credits: Math.round(p.credits), spreadB: spread(bs), spreadU: spread(us), lateBuilt: this.lateBuilt.get(p.id) ?? 0, yard: !!yard });
    }
  }

  /** A structure was placed (lib.ts). */
  onPlaced(b: Building) {
    if (this.ai && this.w.time >= 900) this.lateBuilt.set(b.owner.id, (this.lateBuilt.get(b.owner.id) ?? 0) + 1);
  }

  private aiKill(victim: Unit | Building, killer: Unit | Building | undefined) {
    const w = this.w;
    for (const wv of this.openWave.values()) {
      if (victim instanceof Unit && wv.ids.has(victim.id)) wv.lost += victim.type.cost;
      if (killer instanceof Unit && wv.ids.has(killer.id) && killer.owner !== victim.owner) wv.killed += victim.type.cost;
    }
    if (victim instanceof Unit && victim.ut.harvester && w.ais.some((a) => a.player === victim.owner)) {
      const own = yardOf(w, victim.owner);
      let enemy = Infinity;
      for (const b of w.buildings) if (b.alive && b.bt.id === 'fact' && victim.owner.isEnemy(b.owner)) enemy = Math.min(enemy, Math.hypot(b.x - victim.x, b.y - victim.y));
      const home = own ? Math.hypot(own.x - victim.x, own.y - victim.y) : Infinity;
      this.ai!.harvLost.push({ slot: victim.owner.id, min: Math.round(w.time / 6) / 10, where: home < 18 ? 'home' : enemy < home ? 'enemy' : 'mid' });
    }
  }

  private aiStep() {
    const w = this.w, pr = this.ai!;
    const min = Math.round(w.time / 6) / 10;
    for (const ai of w.ais as unknown as AIController[]) {
      if (typeof (ai as { waves?: number }).waves !== 'number' || !ai.army) continue;
      const slot = ai.player.id;
      if (ai.player.defeated) continue;
      // waves: open on launch, close when the AI is back to building
      const open = this.openWave.get(slot);
      if (open && ai.state !== 'attack') {
        const chat = ai.chatter.filter((c) => c.tick >= Math.round(open.min * 60 * TICK_HZ));
        open.end = chat.some((c) => c.kind === 'broken') ? 'broken' : chat.some((c) => c.kind === 'fallback') ? 'fallback' : 'done';
        open.endMin = min;
        const { ids, ...rec } = open;
        void ids;
        pr.waves.push(rec);
        this.openWave.delete(slot);
      }
      if (ai.state === 'attack' && !this.openWave.has(slot)) {
        const units = ai.waveUnits();
        this.openWave.set(slot, { slot, min, value: units.reduce((s, u) => s + u.ut.cost, 0), endMin: -1, end: 'open', killed: 0, lost: 0, reached: false, ids: new Set(units.map((u) => u.id)) });
      }
      const wv = this.openWave.get(slot);
      if (wv) {
        for (const u of ai.waveUnits()) wv.ids.add(u.id);
        if (!wv.reached && ai.waveUnits().some((u) => w.buildings.some((b) => b.alive && b.bt.id === 'fact' && ai.player.isEnemy(b.owner) && Math.hypot(b.x - u.x, b.y - u.y) < 16))) wv.reached = true;
      }
      if (w.tick % (30 * TICK_HZ) !== 0) continue;
      const army = ai.army();
      const value = army.reduce((s, u) => s + u.ut.cost, 0);
      const idle = ai.available().filter((u) => u.order.type === 'idle' || u.order.type === 'guard').reduce((s, u) => s + u.ut.cost, 0);
      let enemyArmy = 0;
      for (const u of w.units) if (ARMY(u) && ai.player.isEnemy(u.owner) && u.owner.id >= 0) enemyArmy += u.ut.cost;
      const target = ai.pickAttackTarget();
      const need = target && ai.classicPro ? waveNeeds(ai, target, 1) : 0;
      let structures = 0;
      for (const b of w.buildings) if (b.alive && b.owner === ai.player && !b.bt.wall && !b.bt.mine) structures += b.bt.cost;
      let known = 0;
      for (const k of ai.intel.structures.values()) if (!w.players[k.owner]?.defeated) known++;
      const hunt = typeof ai.huntNow === 'function' ? ai.huntNow() : false;
      pr.series.push({ slot, min, army: value, idle, enemyArmy, est: Math.round(ai.enemyEst), need: Math.round(need), state: `${ai.state}/${ai.stage}`, bank: ai.player.credits, structures, known, hunt });
    }
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
