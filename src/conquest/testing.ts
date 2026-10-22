/**
 * Test / screenshot helpers: runs with a forced battle, and mid-campaign runs advanced with simulated results.
 * Used by the ?conquest=... URL hooks (src/main.ts) and the headless tools.
 */
import type { Faction } from '../data/rules';
import { generateRun } from './generate';
import { attackTargets, neighbours, owned, territory, withRng, type ConquestRun } from './state';
import { addVeteran, availableBattles, finishRun, offerPerks, pickPerk, resolveBattle, startBattle } from './run';
import type { BattleKind, BattleOutcome, ConquestSetup } from './battle';
import { EVENT_BY_ID, chooseEvent } from './events';

/** A fresh run with a committed battle of the given kind (the territory is picked to suit it). */
export function runWithBattle(seed: number, faction: Faction, kind: BattleKind, doctrine = 'vanguard', difficulty?: ConquestRun['difficulty']): { run: ConquestRun; setup: ConquestSetup } {
  const run = generateRun({ seed, faction, doctrine, difficulty });
  let target: string;
  if (kind === 'defend') {
    const t = owned(run).find((x) => neighbours(run, x.id).some((n) => territory(run, n.id).owner === 'enemy')) ?? owned(run)[0];
    const from = neighbours(run, t.id).find((n) => territory(run, n.id).owner === 'enemy')?.id ?? neighbours(run, t.id)[0].id;
    run.threat = { target: t.id, from };
    target = t.id;
  } else if (kind === 'boss') {
    target = run.territories.find((t) => t.capital === 'enemy')!.id;
  } else {
    const opts = attackTargets(run).map((a) => territory(run, a.target)).filter((t) => t.owner === 'enemy');
    target = (kind === 'naval' ? opts.find((t) => t.coastal) : undefined)?.id ?? opts[0]?.id ?? attackTargets(run)[0].target;
  }
  const setup = startBattle(run, target, Math.min(run.warChest, 6000), { force: kind });
  return { run, setup };
}

/** A believable mid-campaign run: `turns` turns of mostly won battles (deterministic). */
export function midCampaignRun(seed: number, faction: Faction, turns = 6, doctrine = 'combined_arms'): ConquestRun {
  const run = generateRun({ seed, faction, doctrine, renown: 800 });
  for (let k = 0; k < turns && run.status === 'active'; k++) {
    if (run.perkChoice) pickPerk(run, run.perkChoice[0]);
    if (run.event) chooseEvent(run, 0);
    const opts = availableBattles(run);
    const pick = opts.find((o) => o.action === 'defend') ?? opts.filter((o) => territory(run, o.target).capital !== 'enemy').sort((a, b) => territory(run, a.target).strength - territory(run, b.target).strength)[0];
    if (!pick) break;
    const setup = startBattle(run, pick.target, Math.min(run.warChest, 4000));
    const won = pick.action === 'defend' || k % 4 !== 3;
    const S = setup.battle;
    const out: BattleOutcome = {
      battleId: S.id, won, time: 540 + k * 60, creditsLeft: 2500 + k * 300,
      objectives: [{ id: 'main', text: 'Primary objective', primary: true, state: won ? 'done' : 'failed' }, { id: 'swift', text: 'Win fast', primary: false, state: k % 2 ? 'done' : 'failed' }],
      survivors: S.core.filter((_, i) => won || i % 2 === 0).map((c) => ({ vet: c.vet, rank: Math.min(2, c.rank + (k % 3 === 0 ? 1 : 0)), xp: c.xp + 400 })),
      recruits: won ? [{ type: faction === 'allies' ? '2tnk' : '3tnk', rank: 1, xp: 900 }, { type: 'e3', rank: 1, xp: 320 }] : [],
      kills: 25 + k * 4, losses: 8 + k, superweaponDestroyed: false,
    };
    resolveBattle(run, out);
  }
  if (run.core.length < 4) for (const t of ['e3', faction === 'allies' ? 'arty' : 'v2rl']) addVeteran(run, t, 2);
  return run;
}

/** Put a run into a screenshot state: perk | event | report | summary | threat (others leave it as is). */
export function demoState(run: ConquestRun, what: string) {
  if (what !== 'perk') run.perkChoice = null;
  if (what !== 'event') run.event = null;
  if (what === 'perk') { if (!run.perkChoice) offerPerks(run); }
  else if (what === 'event') {
    const order = ['partisans', 'defection', 'convoy', 'superweapon', 'spy'];
    for (const id of order) {
      const def = EVENT_BY_ID[id];
      const ev = withRng(run, (rng) => def.prepare(run, rng));
      if (ev) { run.event = ev; break; }
    }
  } else if (what === 'report') run.reportSeen = false;
  else if (what === 'summary') finishRun(run, 'won', `${run.territories.find((t) => t.capital === 'enemy')!.name} has fallen. The war is won.`);
  else if (what === 'threat' && !run.threat) {
    const t = owned(run).find((x) => !x.capital && neighbours(run, x.id).some((n) => territory(run, n.id).owner === 'enemy'));
    if (t) run.threat = { target: t.id, from: neighbours(run, t.id).find((n) => territory(run, n.id).owner === 'enemy')!.id };
  }
  if (what !== 'report') run.reportSeen = true;
}
