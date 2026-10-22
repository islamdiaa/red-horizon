/**
 * Conquest turn logic: planning and committing battles, applying their results (territory, veterans, war chest,
 * research points, morale, perk offers), the enemy phase (counterattacks, escalation, superweapon strikes),
 * income and events, research and perks, and the final score. Pure functions over the run JSON; every random
 * decision uses the run's own RNG so a run replays identically from its seed and choices.
 */
import { BUILDINGS, UNITS } from '../data/rules';
import type { AIDifficulty } from '../sim/ai';
import { CALLSIGNS, PERKS, PERSONALITIES, RESEARCH, perkDef, type PerkDef, type ResearchDef } from './data';
import { battleMap, isSeaBattle, type BattleKind, type BattleMods, type BattleOutcome, type BattleSpec, type ConquestSetup, type CoreSlot } from './battle';
import { rollEvent } from './events';
import {
  allowedTypes, attackTargets, capitalOf, climateOf, coreCapacity, dateOf, findTerritory, hasPerk, hasResearch, log, neighbours, owned,
  personalityOf, resCount, territory, withRng,
  type BattleReport, type ConquestRun, type Score, type Territory, type Veteran, type VetChange,
} from './state';
import { RUN as T } from '../i18n/en/conquest-run'; // the English stored in the run (translated where shown)
import { BATTLE } from '../i18n/en/conquest-battle';
import { fill as en } from './text';

const ALL_TYPES = [...Object.keys(BUILDINGS), ...Object.keys(UNITS)];
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
/** Battle funds every battle gets on top of what the war chest commits. */
export const ALLOTMENT = 2500;
/** Most credits a battle can send back to the war chest. */
export const RETURN_CAP = 15000;

// =====================================================================================================
// Core army
// =====================================================================================================
/** Add a veteran to the core army (null when it is full). */
export function addVeteran(run: ConquestRun, type: string, rank: number, xp = 0): Veteran | null {
  if (!UNITS[type] || run.core.length >= coreCapacity(run)) return null;
  const used = new Set(run.core.map((v) => v.name));
  const name = withRng(run, (rng) => {
    const free = CALLSIGNS.filter((c) => !used.has(c));
    return free.length ? rng.pick(free) : `${rng.pick(CALLSIGNS)} ${run.nextVet}`;
  });
  const v: Veteran = { id: run.nextVet++, type, rank: Math.max(1, Math.min(2, rank)), xp: Math.round(xp), name, battles: 0, joined: run.turn };
  run.core.push(v);
  return v;
}

// =====================================================================================================
// Perks & research
// =====================================================================================================
/** Perks that could be offered now (faction, renown, research, not owned yet). */
export function perkPool(run: ConquestRun): PerkDef[] {
  const seen = new Set<string>();
  const out: PerkDef[] = [];
  for (const p of PERKS) {
    if (seen.has(p.id) || run.perks.includes(p.id)) continue;
    const d = perkDef(p.id, run.faction)!;
    if (d.faction && d.faction !== run.faction) continue;
    if ((d.renown ?? 0) > run.renown) continue;
    if (d.needs && !run.research.includes(d.needs)) continue;
    seen.add(p.id);
    out.push(d);
  }
  return out;
}

/** Offer a choice of three perks (stored in the run until picked). */
export function offerPerks(run: ConquestRun) {
  const pool = perkPool(run);
  if (!pool.length) { run.warChest += 2000; log(run, 'perk', T.log.noPerk); return; }
  run.perkChoice = withRng(run, (rng) => {
    const left = [...pool], out: string[] = [];
    while (out.length < 3 && left.length) {
      let r = rng.next() * left.reduce((s, p) => s + (p.weight ?? 1), 0);
      let k = 0;
      for (; k < left.length - 1; k++) { r -= left[k].weight ?? 1; if (r <= 0) break; }
      out.push(left[k].id);
      left.splice(k, 1);
    }
    return out;
  });
}

export function pickPerk(run: ConquestRun, id: string): boolean {
  if (!run.perkChoice?.includes(id)) return false;
  run.perks.push(id);
  run.perkChoice = null;
  if (id === 'iron_will') { run.moraleMax++; run.morale = Math.min(run.moraleMax, run.morale + 1); }
  log(run, 'perk', en(T.log.perk, { perk: perkDef(id, run.faction)?.name ?? id }));
  return true;
}

export function researchFor(run: ConquestRun): ResearchDef[] {
  return RESEARCH.filter((r) => !r.faction || r.faction === run.faction);
}

export function researchState(run: ConquestRun, r: ResearchDef): 'done' | 'available' | 'locked' | 'expensive' {
  if (run.research.includes(r.id)) return 'done';
  if ((r.needs ?? []).some((n) => !run.research.includes(n))) return 'locked';
  return run.rp >= r.cost ? 'available' : 'expensive';
}

export function buyResearch(run: ConquestRun, id: string): boolean {
  const r = researchFor(run).find((x) => x.id === id);
  if (!r || researchState(run, r) !== 'available') return false;
  run.rp -= r.cost;
  run.research.push(id);
  log(run, 'research', en(T.log.research, { research: r.name }));
  return true;
}

// =====================================================================================================
// Battles
// =====================================================================================================
function aiFor(strength: number, difficulty: ConquestRun['difficulty']): AIDifficulty {
  const off = difficulty === 'easy' ? -1 : difficulty === 'hard' ? 1 : 0;
  // garrisons start with an established base while we land with an MCV: keep their AI a notch gentler. On an Easy run
  // the weakest garrisons (strength 1-3) play at Recruit: an Easy commander beat newcomers from an established base
  // (tools/conquesttest.ts --pilot newcomer --difficulty easy). Normal and Hard runs are unchanged.
  const base = strength <= 3 ? 0 : strength <= 5 ? 1 : 2;
  const k = Math.max(0, Math.min(4, base + off + 1));
  return (['recruit', 'easy', 'normal', 'hard', 'brutal'] as const)[k];
}

/** Perk / research / territory effects for a battle. */
export function battleMods(run: ConquestRun, sea: boolean): BattleMods {
  const drops: { at: number; rank: number }[] = [];
  if (hasPerk(run, 'elite_paratroopers')) drops.push({ at: 90, rank: 2 }, { at: 360, rank: 2 });
  if (hasResearch(run, 'airborne')) drops.push({ at: 150, rank: 1 });
  const airfields = Math.min(2, resCount(run, 'airfield'));
  for (let k = 0; k < airfields; k++) drops.push({ at: 240 + 240 * k, rank: 1 });
  drops.sort((a, b) => a.at - b.at);
  return {
    buildSpeed: 1 + (hasResearch(run, 'assembly') ? 0.15 : 0) + (hasPerk(run, 'assembly_rush') ? 0.2 : 0) + Math.min(0.2, 0.05 * resCount(run, 'industry')),
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
    escorts: sea ? 2 + (resCount(run, 'port') ? 2 : 0) : 0,
    drops,
  };
}

/** Territories the player must hold before High Command authorises the assault on the enemy capital. */
export function capitalGate(run: ConquestRun): number {
  return Math.min(10, Math.round(run.territories.length * 0.36));
}

/** Territories the player may fight for this turn: attacks on neighbours, or the defence of a threatened territory. */
export function availableBattles(run: ConquestRun): { target: string; action: 'attack' | 'defend'; from: string; sea: boolean }[] {
  if (run.status !== 'active') return [];
  const gate = owned(run).length >= capitalGate(run);
  const out: { target: string; action: 'attack' | 'defend'; from: string; sea: boolean }[] = attackTargets(run)
    .filter((a) => gate || territory(run, a.target).capital !== 'enemy')
    .map((a) => ({ ...a, action: 'attack' as const }));
  if (run.threat && territory(run, run.threat.target).owner === 'player') out.unshift({ target: run.threat.target, from: run.threat.from, sea: false, action: 'defend' });
  return out;
}

const PAR: Record<BattleKind, number> = { assault: 900, capture: 840, hold: 720, defend: 900, naval: 900, boss: 1500 };

/** The battle the player would fight for a territory now (a preview until it is committed). */
export function planBattle(run: ConquestRun, targetId: string, committed = defaultCommit(run), opts: { force?: BattleKind } = {}): BattleSpec {
  const t = territory(run, targetId);
  let opt = availableBattles(run).find((b) => b.target === targetId);
  // (tests and tools may force a battle anywhere)
  if (!opt && opts.force) opt = { target: targetId, action: opts.force === 'defend' ? 'defend' : 'attack', from: neighbours(run, targetId)[0]?.id ?? targetId, sea: false };
  if (!opt) throw new Error(`no battle available at ${targetId}`);
  const action = opt.action;
  const from = findTerritory(run, opt.from);
  let kind: BattleKind;
  if (opts.force) kind = opts.force;
  else if (action === 'defend') kind = 'defend';
  else if (t.capital === 'enemy') kind = 'boss';
  else if (opt.sea || t.objective === 'naval') kind = t.coastal ? 'naval' : 'assault';
  else kind = t.objective;
  const neutral = t.owner === 'neutral';
  const spy = hasPerk(run, 'spy_network') ? 1 : 0;
  const strength = action === 'defend'
    ? Math.max(2, Math.min(6, (from?.strength ?? 3) + (run.difficulty === 'hard' ? 1 : 0) - spy))
    : Math.max(1, Math.min(6, t.strength - (t.capital ? 0 : spy)));
  const pers = neutral ? { commander: en(BATTLE.neutralForce, { territory: t.name }), personality: 'fortress' as const } : personalityOf(run, action === 'defend' && from ? from : t);
  const climate = climateOf(t, run.turn);
  const seed = ((run.seed * 31 + run.turn * 7919) ^ hashStr(t.id)) >>> 0;
  const { map, label } = battleMap(kind, t.terrain, climate, seed % 100000, strength);
  const sea = isSeaBattle({ map });
  const core: CoreSlot[] = run.core
    .filter((v) => UNITS[v.type] && UNITS[v.type].kind !== 'aircraft' && (UNITS[v.type].kind !== 'naval' || sea))
    .map((v) => ({ vet: v.id, type: v.type, rank: v.rank, xp: v.xp, name: v.name }));
  const credits = ALLOTMENT + Math.max(0, Math.min(committed, run.warChest)) + (hasPerk(run, 'war_bonds') ? 1500 : 0);
  const par = PAR[kind] + 60 * Math.max(0, strength - 3);
  return {
    v: 1,
    id: `${run.id}-t${run.turn}-${t.id}`,
    runId: run.id,
    territory: t.id,
    name: t.name,
    from: action === 'attack' ? from?.name ?? '' : '',
    fromId: from?.id ?? '',
    kind,
    turn: run.turn,
    date: dateOf(run.turn).label,
    faction: run.faction,
    enemy: neutral ? 'allies' : run.enemy,
    neutral,
    commander: pers.commander,
    personality: pers.personality,
    strength,
    ai: neutral ? 'easy' : aiFor(strength, run.difficulty),
    terrain: t.terrain,
    climate,
    map,
    mapLabel: label,
    credits,
    enemyCredits: kind === 'boss' ? 10000 : 1500 + 900 * strength,
    core,
    allowed: allowedTypes(run, ALL_TYPES),
    mods: battleMods(run, sea),
    partisans: action === 'attack' && !!t.partisans,
    superweapon: run.superThreat && run.superThreat.territory === t.id ? run.superThreat.kind : kind === 'boss' ? (run.enemy === 'soviet' ? 'iron' : 'chrono') : null,
    fort: action === 'defend' ? t.fort : 0,
    parTime: par,
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Default credits to commit: up to $8,000 of the war chest. */
export function defaultCommit(run: ConquestRun): number {
  return Math.min(run.warChest, 8000);
}

/** Commit to a battle: freeze its spec, take the funds out of the war chest. */
export function startBattle(run: ConquestRun, targetId: string, committed = defaultCommit(run), opts: { force?: BattleKind } = {}): ConquestSetup {
  if (run.pending) return pendingSetup(run)!;
  const c = Math.max(0, Math.min(Math.round(committed), run.warChest));
  const spec = planBattle(run, targetId, c, opts);
  const t = territory(run, targetId);
  run.warChest -= c;
  run.pending = { spec, action: spec.kind === 'defend' ? 'defend' : 'attack', committed: c };
  log(run, 'info', en(run.pending.action === 'defend' ? T.log.defending : T.log.attacking, { territory: t.name, map: spec.mapLabel.toLowerCase(), n: spec.strength }));
  return pendingSetup(run)!;
}

export function pendingSetup(run: ConquestRun): ConquestSetup | null {
  return run.pending ? { runId: run.id, territory: run.pending.spec.territory, battle: run.pending.spec } : null;
}

function captureTerritory(run: ConquestRun, t: Territory) {
  t.owner = 'player';
  t.captured = run.turn;
  t.strength = 0;
  t.fort = 0;
  t.partisans = false;
  run.stats.captured++;
  run.stats.capturedValue += t.value;
  run.stats.peakTerritories = Math.max(run.stats.peakTerritories, owned(run).length);
  if (run.threat && run.threat.from === t.id) run.threat = null;
  if (run.superThreat?.territory === t.id) { run.superThreat = null; log(run, 'win', en(T.log.swCaptured, { territory: t.name })); }
}

function loseTerritory(run: ConquestRun, t: Territory) {
  t.owner = 'enemy';
  t.strength = Math.max(2, Math.min(5, 2 + Math.floor(run.turn / 4)));
  t.fort = 0;
  t.captured = undefined;
  run.stats.lost++;
  if (t.capital === 'player') finishRun(run, 'lost', en(T.ending.capitalFell, { territory: t.name }));
}

/** Apply a finished battle to the run, then play the enemy phase and start the next turn. */
export function resolveBattle(run: ConquestRun, outcome: BattleOutcome): BattleReport | null {
  const p = run.pending;
  if (!p || outcome.battleId !== p.spec.id) return null;
  const S = p.spec;
  const t = territory(run, S.territory);
  const won = outcome.won;
  const report: BattleReport = {
    battleId: S.id, territory: t.id, name: t.name, kind: S.kind, action: p.action, won, time: outcome.time, par: S.parTime,
    captured: false, lost: false, committed: p.committed, returned: 0, loot: 0, bonus: [], rp: 0, morale: 0, veterans: [],
    objectives: outcome.objectives.map((o) => ({ text: o.text, primary: o.primary, state: o.state })), kills: outcome.kills, losses: outcome.losses,
    perkOffered: false, superweaponDestroyed: outcome.superweaponDestroyed,
  };
  // ---- the core army
  const deployed = new Set(S.core.map((c) => c.vet));
  for (const v of [...run.core]) {
    if (!deployed.has(v.id)) continue;
    const surv = outcome.survivors.find((s) => s.vet === v.id);
    const before = v.rank;
    if (surv) {
      v.rank = Math.max(1, Math.min(2, Math.max(v.rank, surv.rank)));
      v.xp = Math.max(v.xp, surv.xp);
      v.battles++;
      if (won && hasPerk(run, 'field_promotions') && v.rank < 2) v.rank++;
      report.veterans.push(change(v, before, v.rank > before ? 'promoted' : 'survived'));
      continue;
    }
    const recovered = hasResearch(run, 'field_recovery') && v.rank >= 2 && withRng(run, (rng) => rng.chance(0.5));
    if (recovered) {
      v.rank = 1;
      v.battles++;
      report.veterans.push(change(v, before, 'recovered'));
    } else {
      run.core.splice(run.core.indexOf(v), 1);
      run.stats.veteransLost++;
      report.veterans.push(change(v, before, 'lost'));
    }
  }
  for (const r of outcome.recruits) {
    const v = addVeteran(run, r.type, r.rank, r.xp);
    if (!v) break;
    report.veterans.push(change(v, 0, 'recruit'));
  }
  // ---- funds
  report.returned = Math.min(RETURN_CAP, outcome.creditsLeft);
  run.warChest += report.returned;
  run.stats.kills += outcome.kills;
  run.stats.losses += outcome.losses;
  // ---- the territory
  const done = (id: string) => outcome.objectives.some((o) => o.id === id && o.state === 'done');
  if (won) {
    run.stats.battlesWon++;
    if (p.action === 'attack') {
      captureTerritory(run, t);
      report.captured = true;
      report.loot = Math.round((600 + 700 * t.value) * (hasPerk(run, 'plunder') ? 1.5 : 1));
      report.rp = t.value + (t.res === 'science' ? 1 : 0);
      if (t.value >= 2 && run.morale < run.moraleMax) { run.morale++; report.morale = 1; }
    } else {
      run.stats.defended++;
      report.loot = 800 + 300 * t.value;
      report.rp = 1;
      t.fort = Math.min(2, t.fort + 1);
      run.threat = null;
    }
    if (done('swift')) {
      report.bonus.push({ label: T.bonus.swift, credits: 1000, rp: 0 });
      if (hasPerk(run, 'blitzkrieg')) report.bonus.push({ label: T.bonus.blitz, credits: 2000, rp: 1 });
    }
    if (done('veterans')) report.bonus.push({ label: T.bonus.veterans, credits: 500, rp: 0 });
    if (done('counter')) report.bonus.push({ label: T.bonus.counter, credits: 1000, rp: 0 });
  } else {
    run.stats.battlesLost++;
    run.morale--;
    report.morale = -1;
    if (p.action === 'defend') { loseTerritory(run, t); report.lost = true; run.threat = null; }
    else run.pursuit = true;
  }
  if (done('sw') || (outcome.superweaponDestroyed && run.superThreat?.territory === t.id)) {
    if (run.superThreat?.territory === t.id) run.superThreat = null;
    report.bonus.push({ label: T.bonus.superweapon, credits: 0, rp: 1 });
  }
  const bonusCredits = report.bonus.reduce((s, b) => s + b.credits, 0), bonusRp = report.bonus.reduce((s, b) => s + b.rp, 0);
  run.warChest += report.loot + bonusCredits;
  run.rp += report.rp + bonusRp;
  run.stats.creditsEarned += report.loot + bonusCredits;
  run.pending = null;
  run.report = report;
  run.reportSeen = false;
  run.armyAt = t.owner === 'player' ? t.id : findTerritory(run, S.fromId)?.owner === 'player' ? S.fromId : capitalOf(run, 'player').id;
  if (territory(run, run.armyAt).owner !== 'player') run.armyAt = capitalOf(run, 'player').id;
  log(run, won ? 'win' : 'loss', won
    ? en(p.action === 'defend' ? T.log.held : T.log.captured, { territory: t.name, time: fmt(outcome.time), money: money(report.loot + bonusCredits), rp: report.rp + bonusRp })
    : en(p.action === 'defend' ? T.log.lost : T.log.failed, { territory: t.name, morale: run.morale, max: run.moraleMax }));
  if (S.kind === 'boss' && won) {
    finishRun(run, 'won', en(T.ending.won, { territory: t.name }));
    return report;
  }
  if (won && p.action === 'attack' && t.value >= 2) { offerPerks(run); report.perkOffered = !!run.perkChoice; }
  checkDefeat(run);
  if (run.status === 'active') endTurn(run);
  if (run.status === 'active') beginTurn(run);
  return report;
}

function change(v: Veteran, before: number, fate: VetChange['fate']): VetChange {
  return { id: v.id, name: v.name, type: v.type, rank: v.rank, before, fate };
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Abandon the committed battle: it counts as lost (half the committed funds are recovered). */
export function withdraw(run: ConquestRun): BattleReport | null {
  const p = run.pending;
  if (!p) return null;
  const refund = Math.round(p.committed / 2);
  return resolveBattle(run, {
    battleId: p.spec.id, won: false, time: 0, creditsLeft: refund, objectives: [],
    survivors: p.spec.core.map((c) => ({ vet: c.vet, rank: c.rank, xp: c.xp })), recruits: [], kills: 0, losses: 0, superweaponDestroyed: false,
  });
}

/** Spend the turn resting and refitting instead of fighting. */
export function regroup(run: ConquestRun) {
  if (run.status !== 'active' || run.pending) return;
  run.warChest += 1500;
  run.rp += 1;
  log(run, 'info', T.log.regroup);
  run.report = null;
  run.reportSeen = true;
  endTurn(run);
  if (run.status === 'active') beginTurn(run);
}

// =====================================================================================================
// Turn structure
// =====================================================================================================
export function income(run: ConquestRun): { credits: number; rp: number; lines: { label: string; credits: number; rp: number }[] } {
  const lines: { label: string; credits: number; rp: number }[] = [];
  const mine = owned(run);
  lines.push({ label: en(T.income.territories, { n: mine.length }), credits: mine.reduce((s, t) => s + t.income, 0), rp: 0 });
  const oil = resCount(run, 'oil'), port = resCount(run, 'port'), sci = resCount(run, 'science');
  if (oil) lines.push({ label: en(T.income.oil, { n: oil }), credits: 600 * oil, rp: 0 });
  if (port) lines.push({ label: en(T.income.ports, { n: port }), credits: 300 * port, rp: 0 });
  if (sci) lines.push({ label: en(T.income.science, { n: sci }), credits: 0, rp: sci });
  if (hasPerk(run, 'lend_lease')) lines.push({ label: T.income.lendLease, credits: 1000, rp: 0 });
  if (hasResearch(run, 'logistics_net')) lines.push({ label: T.income.logistics, credits: 750, rp: 0 });
  return { credits: lines.reduce((s, l) => s + l.credits, 0), rp: lines.reduce((s, l) => s + l.rp, 0), lines };
}

function checkDefeat(run: ConquestRun) {
  if (run.status !== 'active') return;
  if (capitalOf(run, 'player').owner !== 'player') finishRun(run, 'lost', T.ending.capital);
  else if (run.morale <= 0) finishRun(run, 'lost', T.ending.morale);
  else if (!owned(run).length) finishRun(run, 'lost', T.ending.noTerritory);
}

/** The enemy phase: unanswered counterattacks land, superweapons fire, the front reinforces, a new attack is declared. */
export function endTurn(run: ConquestRun) {
  withRng(run, (rng) => {
    // an undefended territory under attack falls (unless its defences hold)
    if (run.threat) {
      const t = territory(run, run.threat.target);
      if (t.owner === 'player') {
        if (hasPerk(run, 'fortified_lines') && rng.chance(0.5)) log(run, 'win', en(T.log.fortified, { territory: t.name }));
        else if (t.fort >= 2 && rng.chance(0.35)) log(run, 'win', en(T.log.garrison, { territory: t.name }));
        else { loseTerritory(run, t); log(run, 'loss', en(T.log.overrun, { territory: t.name })); }
      }
      run.threat = null;
    }
    if (run.status !== 'active') return;
    // superweapon countdown
    const st = run.superThreat;
    if (st) {
      const src = territory(run, st.territory);
      if (src.owner !== 'enemy') run.superThreat = null;
      else if (--st.turns <= 0) {
        const targets = owned(run).filter((t) => !t.capital);
        const hit = targets.length ? rng.pick(targets) : capitalOf(run, 'player');
        const loss = Math.round(run.warChest * 0.2);
        run.warChest -= loss;
        hit.fort = 0;
        let vet = '';
        if (run.core.length) { const v = rng.pick(run.core); run.core.splice(run.core.indexOf(v), 1); run.stats.veteransLost++; vet = v.name; }
        const nuke = st.kind === 'nuke';
        log(run, 'threat', en(vet ? (nuke ? T.log.nukeVet : T.log.superVet) : nuke ? T.log.nuke : T.log.super, { src: src.name, territory: hit.name, money: money(loss), vet }));
        st.turns = 4;
      }
    }
    // every third turn the enemy reinforces the territories facing us
    if (run.turn % 3 === 0) {
      let n = 0;
      for (const t of run.territories) {
        if (t.owner !== 'enemy' || t.capital || t.strength >= 5) continue;
        if (!neighbours(run, t.id).some((x) => territory(run, x.id).owner === 'player')) continue;
        t.strength++;
        n++;
      }
      if (n) log(run, 'threat', T.log.reinforce);
    }
    // declare a counterattack
    if (run.turn >= 2) {
      const cands: { t: Territory; from: Territory; w: number }[] = [];
      for (const t of owned(run)) {
        const foes = neighbours(run, t.id).map((n) => territory(run, n.id)).filter((o) => o.owner === 'enemy');
        if (!foes.length) continue;
        const from = foes.reduce((a, b) => (b.strength > a.strength ? b : a));
        cands.push({ t, from, w: t.value + (t.capital ? 1 : 0) + (t.fort ? -0.5 : 0.5) });
      }
      if (cands.length) {
        const agg = Math.max(...cands.map((c) => PERSONALITIES[personalityOf(run, c.from).personality]?.aggression ?? 1));
        const diff = run.difficulty === 'easy' ? 0.7 : run.difficulty === 'hard' ? 1.25 : 1;
        const chance = Math.min(0.75, (0.16 + 0.045 * run.turn) * agg * diff + (run.pursuit ? 0.25 : 0));
        if (rng.chance(chance)) {
          let r = rng.next() * cands.reduce((s, c) => s + Math.max(0.2, c.w), 0);
          let pick = cands[0];
          for (const c of cands) { r -= Math.max(0.2, c.w); if (r <= 0) { pick = c; break; } }
          run.threat = { target: pick.t.id, from: pick.from.id };
          log(run, 'threat', en(T.log.massing, { from: pick.from.name, territory: pick.t.name }));
        }
      }
    }
    run.pursuit = false;
  });
  checkDefeat(run);
}

/** A new month: income, research points and maybe an event. */
export function beginTurn(run: ConquestRun) {
  run.turn++;
  const inc = income(run);
  run.warChest += inc.credits;
  run.rp += inc.rp;
  run.stats.creditsEarned += inc.credits;
  log(run, 'income', en(inc.rp ? T.log.incomeRp : T.log.income, { date: dateOf(run.turn).label, money: money(inc.credits), rp: inc.rp }));
  run.event = rollEvent(run);
}

// =====================================================================================================
// End of the run
// =====================================================================================================
export function computeScore(run: ConquestRun): Score {
  const lines: { label: string; value: number }[] = [];
  const add = (label: string, value: number) => { if (value) lines.push({ label, value: Math.round(value) }); };
  add(T.score.battles, 250 * run.stats.battlesWon);
  add(T.score.captured, 120 * run.stats.capturedValue);
  add(T.score.defences, 150 * run.stats.defended);
  add(T.score.held, 50 * owned(run).length);
  add(T.score.veterans, 40 * run.core.reduce((s, v) => s + v.rank, 0));
  add(T.score.warChest, run.warChest / 100);
  if (run.status === 'won') {
    add(T.score.victory, 5000);
    add(T.score.speed, Math.max(0, 30 - run.turn) * 150);
    add(T.score.morale, 300 * run.morale);
  }
  const multiplier = run.difficulty === 'easy' ? 0.75 : run.difficulty === 'hard' ? 1.4 : 1;
  const total = Math.round(lines.reduce((s, l) => s + l.value, 0) * multiplier);
  return { lines, multiplier, total, renown: Math.round(total / 20), xp: Math.min(6000, Math.round(total / 3)) };
}

export function finishRun(run: ConquestRun, status: 'won' | 'lost', ending: string) {
  if (run.status !== 'active') return;
  run.status = status;
  run.ending = ending;
  run.pending = null;
  run.threat = null;
  run.event = null;
  run.perkChoice = null;
  run.score = computeScore(run);
  log(run, status === 'won' ? 'win' : 'loss', ending);
}

export function abandonRun(run: ConquestRun) {
  finishRun(run, 'lost', T.ending.abandoned);
}
