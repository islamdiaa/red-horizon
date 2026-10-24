/**
 * The RTS route: fight an attack (or the defence of a capital or wonder) as a real battle instead of rolling dice.
 *
 * startBattle freezes a BattleSpec with a `world` field (the region, the troops on both sides, the look) that goes
 * through the existing GameSetup.conquest -> conquestMission path. Troop counts set the battle: the defenders set
 * the garrison strength (1-6), the attackers' advantage lands as extra tanks and funds. applyBattle maps the result
 * back: no dice luck, light losses for a win, and the rewards dice never give: veterans, war chest, research, a
 * chance at a card, perks after capitals and wonders, and score.
 */
import { BUILDINGS, UNITS } from '../../data/rules';
import type { AIDifficulty } from '../../sim/ai';
import { isSeaBattle, type BattleKind, type BattleMap, type BattleMods, type BattleOutcome, type BattleSpec, type ConquestSetup, type CoreSlot } from '../battle';
import { regionBattlefield } from '../../sim/mapgen-region';
import { CALLSIGNS, COMMANDERS, LOCKED_TYPES, PERKS, RESEARCH, perkDef, type Difficulty, type PersonalityId } from '../data';
import type { Veteran } from '../state';
import { regionById } from './atlas';
import { BATTLE } from '../../i18n/en/conquest-battle';
import { fill as en } from '../text';
import { attackOdds } from './odds';
import { attackBlock, conquer, drawCard, emit, linkOf, wonderSum, checkEnd, bookLosses } from './rules';
import { HUMAN, NEUTRAL, hashStr, mix, tIndex, terr, withRng, type WorldEvent, type WorldReport, type WorldRun } from './state';
import type { CardKind, WorldClimate } from './types';

const ALL_TYPES = [...Object.keys(BUILDINGS), ...Object.keys(UNITS)];
export const ALLOTMENT = 2500;
export const RETURN_CAP = 15000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Calendar of a world run: turn 1 is March 1953, one month a turn (the battle's date line). */
export function worldDate(turn: number): string {
  const k = 2 + turn - 1;
  return `${MONTHS[((k % 12) + 12) % 12]} ${1953 + Math.floor(k / 12)}`;
}

/** Battle personality of a rival (the RTS commander's style). */
const BATTLE_PERSONALITY: Record<string, PersonalityId> = { holder: 'fortress', aggressor: 'steamroller', turtle: 'siege', opportunist: 'raider', naval: 'naval', human: 'steamroller' };

/** Garrison strength 1-6 from the defenders, eased by a big advantage and stiffened by a small one. */
export function garrisonStrength(attackers: number, defenders: number): number {
  const d = defenders;
  let s = d <= 1 ? 1 : d <= 2 ? 2 : d <= 4 ? 3 : d <= 7 ? 4 : d <= 11 ? 5 : 6;
  if (attackers >= 3 * d) s--;
  else if (attackers < d) s++;
  return Math.max(1, Math.min(6, s));
}

/** The run's difficulty as the battle scripts know it (Recruit plays the Easy package). */
export function battleDifficulty(run: WorldRun): Difficulty {
  return run.difficulty === 'recruit' || run.difficulty === 'easy' ? 'easy' : run.difficulty === 'normal' ? 'normal' : 'hard';
}

function aiLevel(run: WorldRun, strength: number): AIDifficulty {
  const off = { recruit: -2, easy: -1, normal: 0, hard: 1, brutal: 1 }[run.difficulty];
  const base = strength <= 3 ? 0 : strength <= 5 ? 1 : 2;
  return (['recruit', 'easy', 'normal', 'hard', 'brutal'] as const)[Math.max(0, Math.min(4, base + off + 1))];
}

const BATTLE_KIND_REGION: Record<BattleKind, 'attack' | 'defend' | 'hold' | 'naval' | 'boss'> = { assault: 'attack', capture: 'attack', hold: 'hold', defend: 'defend', naval: 'naval', boss: 'boss' };

/** The battle type for an attack on a territory. */
export function attackKind(run: WorldRun, fromId: string, toId: string): BattleKind {
  const to = terr(run, toId);
  const l = linkOf(run, tIndex(run, fromId), tIndex(run, toId));
  if (to.capital !== undefined && to.owner !== NEUTRAL && to.capital === to.owner) return 'boss';
  // (neutrals have no fleet: across a sea lane a neutral territory is a landing, fought on land; a rival's coast is a
  // naval battle. Island homelands' first targets are all across the sea, and naval battles are the hardest kind for
  // a newcomer)
  if (l?.sea && to.owner !== NEUTRAL) return 'naval';
  if (to.landmark) return 'hold';
  return (hashStr(to.id) % 3) === 0 ? 'capture' : 'assault';
}

function allowedFor(run: WorldRun): string[] {
  const unlocked = new Set<string>();
  for (const r of RESEARCH) if (run.army.research.includes(r.id)) for (const u of r.unlocks ?? []) unlocked.add(u);
  return ALL_TYPES.filter((t) => !LOCKED_TYPES.has(t) || unlocked.has(t));
}
const hasPerk = (run: WorldRun, id: string) => run.army.perks.includes(id);
const hasResearch = (run: WorldRun, id: string) => run.army.research.includes(id);

export function worldCoreCapacity(run: WorldRun): number {
  return 6 + (hasPerk(run, 'hardened_core') ? 3 : 0) + (hasResearch(run, 'academy') ? 3 : 0);
}

function battleMods(run: WorldRun, sea: boolean): BattleMods {
  const drops: { at: number; rank: number }[] = [];
  if (hasPerk(run, 'elite_paratroopers')) drops.push({ at: 90, rank: 2 }, { at: 360, rank: 2 });
  if (hasResearch(run, 'airborne')) drops.push({ at: 150, rank: 1 });
  drops.sort((a, b) => a.at - b.at);
  const ports = run.territories.filter((t) => t.owner === HUMAN && t.port).length;
  return {
    buildSpeed: 1 + (hasResearch(run, 'assembly') ? 0.15 : 0) + (hasPerk(run, 'assembly_rush') ? 0.2 : 0),
    income: 1 + (hasResearch(run, 'ore_refining') ? 0.15 : 0) + (hasPerk(run, 'ore_boom') ? 0.2 : 0),
    tanks: hasPerk(run, 'armoured_spearhead') ? 2 : 0,
    outpost: hasPerk(run, 'forward_outpost'),
    commandos: hasPerk(run, 'commandos'),
    engineers: hasPerk(run, 'engineer_corps') ? 3 : 0,
    drill: hasPerk(run, 'drill_sergeants'),
    tankAces: hasPerk(run, 'tank_aces'),
    bounty: hasPerk(run, 'scavengers'),
    cheapNavy: hasPerk(run, 'cheap_navy'),
    recon: hasPerk(run, 'recon_flights'),
    superCharge: hasPerk(run, 'superweapon_priority') ? 0.4 : 0,
    fortified: hasPerk(run, 'fortified_lines'),
    escorts: sea ? 2 + (ports ? 2 : 0) : 0,
    drops,
  };
}

/** The battle scripts' climate (briefing text only; the battlefield itself keeps the region's, tropical included). */
const scriptClimate = (c: WorldClimate) => (c === 'tropical' ? 'temperate' : c);

export interface BattlePlan {
  kind: BattleKind;
  action: 'attack' | 'defend';
  from: string;
  to: string;
  attacker: number;
  defender: number;
  attackers: number;
  defenders: number;
  strength: number;
  ai: AIDifficulty;
}

function plan(run: WorldRun, fromId: string, toId: string, action: 'attack' | 'defend', troops?: number): BattlePlan {
  const from = terr(run, fromId), to = terr(run, toId);
  const attackers = Math.max(1, Math.min(from.troops - 1, Math.floor(troops ?? from.troops - 1)));
  const defenders = to.troops;
  const kind: BattleKind = action === 'defend' ? 'defend' : attackKind(run, fromId, toId);
  let strength = action === 'defend' ? garrisonStrength(defenders, attackers) : garrisonStrength(attackers, defenders);
  if (kind === 'boss') strength = Math.max(3, strength);
  return { kind, action, from: fromId, to: toId, attacker: from.owner, defender: to.owner, attackers, defenders, strength, ai: aiLevel(run, strength) };
}

/** What fighting this attack gives, next to the dice (the battle dialog's preview). */
export function battlePreview(run: WorldRun, fromId: string, toId: string, troops?: number) {
  const P = plan(run, fromId, toId, 'attack', troops);
  const to = terr(run, toId);
  return {
    ...P,
    warChest: run.army.warChest,
    loot: lootFor(run, to.capital !== undefined, !!to.landmark),
    cardChance: P.kind === 'boss' ? 1 : 0.35,
    scoreMult: 2,
    veterans: run.army.core.length,
    dice: attackOdds(run, fromId, toId),
  };
}

function lootFor(run: WorldRun, capital: boolean, wonder: boolean): number {
  const value = 1 + (capital ? 2 : 0) + (wonder ? 1 : 0);
  return Math.round((600 + 500 * value) * (1 + wonderSum(run, HUMAN, 'income') / 100) * (hasPerk(run, 'plunder') ? 1.5 : 1));
}

function buildSpec(run: WorldRun, P: BattlePlan, committed: number): BattleSpec {
  const to = terr(run, P.to);
  const enemyPower = P.action === 'attack' ? P.defender : P.attacker;
  const region = regionById(P.to);
  const climate: WorldClimate = region?.climate ?? 'temperate';
  const terrain = region?.terrain ?? 'plains';
  const neutral = enemyPower === NEUTRAL;
  const rival = neutral ? null : run.powers[enemyPower];
  const seed = mix(mix(run.seed, hashStr(P.to)), run.turn * 7919 + run.stats.battlesWon * 31 + run.stats.battlesLost * 17 + run.stats.defencesWon * 13 + run.stats.defencesLost * 7) >>> 0;
  // the region's battlefield (src/sim/mapgen-region.ts): its climate, terrain, features, towns and landmark
  const rmap = regionBattlefield({
    kind: BATTLE_KIND_REGION[P.kind], terrain, climate, culture: region?.culture ?? 'western', features: [...(region?.features ?? [])],
    ...(to.landmark ? { landmark: to.landmark } : {}), seed, strength: P.strength, players: P.kind === 'boss' ? 3 : 2, region: P.to,
  });
  const map = rmap as unknown as BattleMap;
  const label = rmap.label;
  const sea = isSeaBattle({ map });
  const core: CoreSlot[] = run.army.core
    .filter((v) => UNITS[v.type] && UNITS[v.type].kind !== 'aircraft' && (UNITS[v.type].kind !== 'naval' || sea))
    .map((v) => ({ vet: v.id, type: v.type, rank: v.rank, xp: v.xp, name: v.name }));
  // regulars fill the core army up to five units (the standing army a five-veteran core gave Europe Conquest)
  const STANDING = [run.faction === 'allies' ? '2tnk' : '3tnk', run.faction === 'allies' ? '2tnk' : '3tnk', 'e3', 'e3', run.faction === 'allies' ? 'jeep' : 'v2rl'];
  const regulars = STANDING.slice(Math.min(5, core.length));
  const mine = P.action === 'attack' ? P.attackers : P.defenders;
  const theirs = P.action === 'attack' ? P.defenders : P.attackers;
  const extraTanks = Math.max(0, Math.min(4, Math.floor((mine - theirs) / 3)));
  const credits = ALLOTMENT + Math.max(0, Math.min(committed, run.army.warChest)) + 150 * Math.min(30, mine) + (hasPerk(run, 'war_bonds') ? 1500 : 0);
  const difficulty = battleDifficulty(run);
  const PAR: Record<BattleKind, number> = { assault: 900, capture: 840, hold: 720, defend: 900, naval: 900, boss: 1500 };
  const enemyFaction = rival?.faction ?? (run.faction === 'allies' ? 'soviet' : 'allies');
  return {
    v: 1,
    id: `${run.id}-w${run.turn}-${P.to}-${run.stats.battlesWon + run.stats.battlesLost + run.stats.defencesWon + run.stats.defencesLost}`,
    runId: run.id,
    territory: P.to,
    name: region?.name ?? P.to,
    from: P.action === 'attack' ? regionById(P.from)?.name ?? P.from : '',
    fromId: P.from,
    kind: P.kind,
    turn: run.turn,
    date: worldDate(run.turn),
    faction: run.faction,
    enemy: neutral ? (run.faction === 'allies' ? 'soviet' : 'allies') : enemyFaction,
    neutral,
    commander: rival?.commander || (neutral ? en(BATTLE.neutralForce, { territory: region?.name ?? P.to }) : COMMANDERS[enemyFaction][0].name),
    personality: neutral ? 'fortress' : BATTLE_PERSONALITY[rival!.personality] ?? 'steamroller',
    strength: P.strength,
    ai: neutral ? 'easy' : P.kind === 'boss' && difficulty === 'easy' ? 'recruit' : P.ai,
    terrain,
    climate: scriptClimate(climate),
    map,
    mapLabel: label,
    credits,
    enemyCredits: P.kind === 'boss' ? (difficulty === 'easy' ? 6000 : 10000) : 1500 + 900 * P.strength,
    core,
    allowed: allowedFor(run),
    mods: battleMods(run, sea),
    partisans: false,
    superweapon: P.kind === 'boss' && difficulty !== 'easy' ? (enemyFaction === 'soviet' ? 'iron' : 'chrono') : null,
    fort: P.action === 'defend' ? Math.min(2, Math.floor(P.defenders / 4)) : 0,
    parTime: PAR[P.kind] + 60 * Math.max(0, P.strength - 3),
    difficulty,
    world: {
      run: run.id, from: P.from, to: P.to, action: P.action, kind: BATTLE_KIND_REGION[P.kind], attackers: P.attackers, defenders: P.defenders,
      attacker: P.attacker, defender: P.defender, climate, culture: region?.culture ?? 'western', features: [...(region?.features ?? [])],
      ...(to.landmark ? { landmark: to.landmark } : {}), extraTanks, regulars,
    },
  };
}

export function pendingSetup(run: WorldRun): ConquestSetup | null {
  return run.pending ? { runId: run.id, territory: run.pending.to, battle: run.pending.spec } : null;
}

/** Commit to fighting an attack as an RTS battle. */
export function startBattle(run: WorldRun, fromId: string, toId: string, opts: { troops?: number; commit?: number } = {}): ConquestSetup | null {
  if (run.pending) return pendingSetup(run);
  if (run.current !== HUMAN || attackBlock(run, fromId, toId, HUMAN)) return null;
  const P = plan(run, fromId, toId, 'attack', opts.troops);
  const committed = Math.max(0, Math.min(Math.round(opts.commit ?? Math.min(run.army.warChest, 8000)), run.army.warChest));
  const spec = buildSpec(run, P, committed);
  run.army.warChest -= committed;
  run.conquest = null;
  run.pending = { spec, action: 'attack', from: fromId, to: toId, attacker: HUMAN, defender: P.defender, attackers: P.attackers, defenders: P.defenders, committed };
  return pendingSetup(run);
}

/** Fight the defence a rival's attack is waiting on (run.defence). */
export function startDefenceBattle(run: WorldRun, opts: { commit?: number } = {}): ConquestSetup | null {
  if (run.pending) return pendingSetup(run);
  const D = run.defence;
  if (!D || run.status !== 'active') return null;
  const from = terr(run, D.from), to = terr(run, D.to);
  if (from.owner !== D.power || to.owner !== HUMAN || from.troops < 2) { run.defence = null; return null; }
  const P = plan(run, D.from, D.to, 'defend');
  const committed = Math.max(0, Math.min(Math.round(opts.commit ?? Math.min(run.army.warChest, 6000)), run.army.warChest));
  const spec = buildSpec(run, P, committed);
  run.army.warChest -= committed;
  run.pending = { spec, action: 'defend', from: D.from, to: D.to, attacker: D.power, defender: HUMAN, attackers: P.attackers, defenders: P.defenders, committed };
  return pendingSetup(run);
}

// =====================================================================================================
// The result
// =====================================================================================================
/**
 * Troop losses of a battle (pure; the headless harnesses use it too). share = the human's share of the
 * casualties (losses / (losses + kills)). A win is cheap, a loss still grinds the other side down.
 */
export function battleLosses(action: 'attack' | 'defend', won: boolean, attackers: number, defenders: number, share: number, swift = false): { attLoss: number; defLoss: number } {
  const c = Math.max(0, Math.min(1, share));
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
  // (dice cost an attacker about 0.85 troops per defender over a blitz; a won battle 0.2-0.8 of that by casualties)
  if (action === 'attack') {
    if (won) {
      let attLoss = clamp(defenders * (0.2 + 0.6 * c), 0, attackers - 1);
      if (swift) attLoss = Math.floor(attLoss / 2);
      return { attLoss, defLoss: defenders };
    }
    return { attLoss: clamp(attackers * (0.55 + 0.35 * c), 1, attackers), defLoss: clamp(attackers * (1 - c) * 0.5, 0, defenders - 1) };
  }
  // the human defends
  // (a repelled attack falls back: it loses 30-70% of its troops, not the whole stack)
  if (won) return { attLoss: clamp(attackers * (0.3 + 0.4 * (1 - c)), 1, attackers), defLoss: clamp(attackers * c * 0.4, 0, defenders - 1) };
  return { attLoss: clamp(defenders * (0.3 + 0.5 * (1 - c)), 0, attackers - 1), defLoss: defenders };
}

function addVeteran(run: WorldRun, type: string, rank: number, xp = 0): Veteran | null {
  if (!UNITS[type] || run.army.core.length >= worldCoreCapacity(run)) return null;
  const used = new Set(run.army.core.map((v) => v.name));
  const name = withRng(run, (rng) => {
    const free = CALLSIGNS.filter((c) => !used.has(c));
    return free.length ? rng.pick(free) : `${rng.pick(CALLSIGNS)} ${run.army.nextVet}`;
  });
  const v: Veteran = { id: run.army.nextVet++, type, rank: Math.max(1, Math.min(2, rank)), xp: Math.round(xp), name, battles: 0, joined: run.turn };
  run.army.core.push(v);
  return v;
}

/** Offer three perks (after a capital or wonder won in battle). */
function offerPerks(run: WorldRun) {
  const seen = new Set<string>();
  const pool = PERKS.filter((p) => {
    if (seen.has(p.id) || run.army.perks.includes(p.id)) return false;
    const d = perkDef(p.id, run.faction)!;
    if (d.faction && d.faction !== run.faction) return false;
    if (d.needs && !run.army.research.includes(d.needs)) return false;
    seen.add(p.id);
    return true;
  });
  if (!pool.length) { run.army.warChest += 2000; return; }
  run.army.perkChoice = withRng(run, (rng) => rng.shuffle(pool.map((p) => p.id)).slice(0, 3));
}

export function pickWorldPerk(run: WorldRun, id: string): boolean {
  if (!run.army.perkChoice?.includes(id)) return false;
  run.army.perks.push(id);
  run.army.perkChoice = null;
  return true;
}

export function buyWorldResearch(run: WorldRun, id: string): boolean {
  const r = RESEARCH.find((x) => x.id === id && (!x.faction || x.faction === run.faction));
  if (!r || run.army.research.includes(id) || (r.needs ?? []).some((n) => !run.army.research.includes(n)) || run.army.rp < r.cost) return false;
  run.army.rp -= r.cost;
  run.army.research.push(id);
  return true;
}

/** Apply a finished RTS battle: troops, territory, veterans, war chest, research, card chance, score. */
export function applyBattle(run: WorldRun, outcome: BattleOutcome, events?: WorldEvent[]): WorldReport | null {
  const p = run.pending;
  if (!p || outcome.battleId !== p.spec.id) return null;
  const S = p.spec;
  const from = terr(run, p.from), to = terr(run, p.to);
  const won = outcome.won;
  const share = outcome.losses / Math.max(1, outcome.losses + outcome.kills);
  const swift = outcome.objectives.some((o) => o.id === 'swift' && o.state === 'done');
  const report: WorldReport = {
    from: p.from, to: p.to, action: p.action, won, captured: false, attLoss: 0, defLoss: 0, moved: 0, warChest: 0, rp: 0, card: null,
    score: 0, veterans: [], perkOffered: false,
  };
  // ---- veterans (the core army carries over between battles)
  const deployed = new Set(S.core.map((c) => c.vet));
  for (const v of [...run.army.core]) {
    if (!deployed.has(v.id)) continue;
    const surv = outcome.survivors.find((s) => s.vet === v.id);
    if (surv) {
      const before = v.rank;
      v.rank = Math.max(1, Math.min(2, Math.max(v.rank, surv.rank)));
      v.xp = Math.max(v.xp, surv.xp);
      v.battles++;
      if (won && hasPerk(run, 'field_promotions') && v.rank < 2) v.rank++;
      report.veterans.push({ id: v.id, name: v.name, type: v.type, rank: v.rank, fate: v.rank > before ? 'promoted' : 'survived' });
    } else {
      run.army.core.splice(run.army.core.indexOf(v), 1);
      report.veterans.push({ id: v.id, name: v.name, type: v.type, rank: v.rank, fate: 'lost' });
    }
  }
  for (const r of outcome.recruits) {
    const v = addVeteran(run, r.type, r.rank, r.xp);
    if (!v) break;
    report.veterans.push({ id: v.id, name: v.name, type: v.type, rank: v.rank, fate: 'recruit' });
  }
  run.army.warChest += Math.min(RETURN_CAP, outcome.creditsLeft);
  run.stats.kills += outcome.kills;
  run.stats.losses += outcome.losses;
  run.pending = null;
  // ---- troops and territory
  const stillValid = from.owner === p.attacker && to.owner === p.defender && from.troops >= 2;
  const attackers = Math.min(p.attackers, Math.max(1, from.troops - 1));
  const L = battleLosses(p.action, won, attackers, to.troops, share, swift);
  report.attLoss = L.attLoss;
  report.defLoss = L.defLoss;
  if (stillValid) {
    bookLosses(run, p.attacker, p.defender, L.attLoss, L.defLoss);
    if (p.action === 'attack') run.stats.diceAttacks--; // (bookLosses counts an attack; this one was fought)
    from.troops -= L.attLoss;
    to.troops -= L.defLoss;
    if (to.troops <= 0) {
      to.troops = 0;
      conquer(run, tIndex(run, p.from), tIndex(run, p.to), Math.max(1, from.troops - 1), events);
      report.captured = p.action === 'attack';
      report.moved = to.troops;
      if (p.action === 'attack') run.conquest = { from: p.from, to: p.to, min: 1, max: Math.max(1, from.troops - 1 + to.troops), moved: to.troops };
    }
    emit(run, events, { kind: 'battle', power: p.attacker, from: p.from, to: p.to, won: p.action === 'attack' ? won : !won, attLoss: L.attLoss, defLoss: L.defLoss });
  }
  // ---- rewards (fighting pays: no dice luck, plus these)
  const capital = to.capital !== undefined, wonder = !!to.landmark;
  if (won) {
    if (p.action === 'attack') run.stats.battlesWon++; else run.stats.defencesWon++;
    report.warChest = p.action === 'attack' ? lootFor(run, capital, wonder) : 800 + 300 * (capital ? 2 : 1);
    report.rp = 1 + (capital ? 1 : 0) + (wonder ? 1 : 0);
    const cardChance = S.kind === 'boss' ? 1 : p.action === 'attack' ? 0.35 : 0.25;
    if (withRng(run, (rng) => rng.chance(cardChance))) report.card = drawCard(run, HUMAN, events) as CardKind;
    report.score = S.kind === 'boss' ? 1200 : p.action === 'attack' ? 300 : 250;
    if (p.action === 'attack' && report.captured && (capital || wonder)) { offerPerks(run); report.perkOffered = !!run.army.perkChoice; }
  } else {
    if (p.action === 'attack') run.stats.battlesLost++; else run.stats.defencesLost++;
    report.warChest = 0;
    report.rp = 0;
    report.score = 50;
  }
  run.army.warChest += report.warChest;
  run.army.rp += report.rp;
  run.battleScore = (run.battleScore ?? 0) + report.score;
  if (p.action === 'defend') { run.defence = null; }
  run.report = report;
  checkEnd(run, events);
  return report;
}

/** Abandon the committed battle: it counts as lost (half the committed funds come back). */
export function withdrawBattle(run: WorldRun, events?: WorldEvent[]): WorldReport | null {
  const p = run.pending;
  if (!p) return null;
  return applyBattle(run, {
    battleId: p.spec.id, won: false, time: 0, creditsLeft: Math.round(p.committed / 2), objectives: [],
    survivors: p.spec.core.map((c) => ({ vet: c.vet, rank: c.rank, xp: c.xp })), recruits: [], kills: 0, losses: 1, superweaponDestroyed: false,
  }, events);
}

