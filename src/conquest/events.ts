/**
 * Random events between turns: a situation, two or three choices, and outcomes that may be gambles
 * (rolled with the run's RNG, so they are deterministic per seed and choice).
 */
import type { Rng } from '../core/rng';
import { UNITS } from '../data/rules';
import { PERKS, perkDef } from './data';
import {
  attackTargets, findTerritory, hasPerk, log, owned, territory, withRng,
  type ConquestRun, type PendingEvent, type Territory,
} from './state';
import { addVeteran, offerPerks } from './run';

export interface EventChoice {
  label: string;
  /** One-line consequence shown on the button. */
  hint: string;
  /** Credits it costs (button disabled if the war chest is short). */
  cost?: number;
  /** Apply it; returns the outcome text. */
  apply(run: ConquestRun, ev: PendingEvent, rng: Rng): string;
}

export interface EventDef {
  id: string;
  title: string;
  icon: string;
  weight: number;
  /** Whether it can happen now; may fill in the event's territory / data. */
  prepare(run: ConquestRun, rng: Rng): PendingEvent | null;
  text(run: ConquestRun, ev: PendingEvent): string;
  choices(run: ConquestRun, ev: PendingEvent): EventChoice[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
/** Gamble odds, better with partisan contacts. */
const odds = (run: ConquestRun, p: number) => Math.min(0.95, p + (hasPerk(run, 'partisans') ? 0.2 : 0));
const pay = (run: ConquestRun, c: number) => { run.warChest = Math.max(0, run.warChest - c); };
const tName = (run: ConquestRun, ev: PendingEvent) => findTerritory(run, ev.territory)?.name ?? 'the front';
const mainTank = (run: ConquestRun) => (run.faction === 'allies' ? '2tnk' : '3tnk');
const enemyTank = (run: ConquestRun) => (run.enemy === 'allies' ? '2tnk' : '3tnk');

/** Enemy territories bordering ours. */
function frontier(run: ConquestRun): Territory[] {
  return attackTargets(run).map((a) => territory(run, a.target)).filter((t) => t.owner === 'enemy' && !t.capital);
}

export const EVENTS: EventDef[] = [
  {
    id: 'partisans', title: 'Partisan Uprising', icon: 'flag', weight: 1.2,
    prepare(run, rng) {
      const f = frontier(run).filter((t) => !t.partisans);
      return f.length ? { id: 'partisans', territory: rng.pick(f).id } : null;
    },
    text: (run, ev) => `Resistance fighters in ${tName(run, ev)} have risen against the occupation. They ask for weapons, and for us to come soon.`,
    choices: () => [
      {
        label: 'Arm the partisans', hint: '$1,500 · they fight beside you when you attack', cost: 1500,
        apply(run, ev, rng) {
          pay(run, 1500);
          const t = territory(run, ev.territory!);
          t.partisans = true;
          if (rng.chance(odds(run, 0.5))) { t.strength = Math.max(1, t.strength - 1); return `The uprising spreads: ${t.name}'s garrison is weakened (strength ${t.strength}) and partisans will join our attack.`; }
          return `The partisans are armed and waiting for our attack on ${t.name}.`;
        },
      },
      {
        label: 'Ask for intelligence', hint: '+1 research point',
        apply(run, ev) { run.rp += 1; return `Partisan couriers bring maps and codes from ${tName(run, ev)}. +1 research point.`; },
      },
      { label: 'Stay out of it', hint: 'Nothing happens', apply: (run, ev) => `The uprising in ${tName(run, ev)} is crushed. Some say we could have helped.` },
    ],
  },
  {
    id: 'convoy', title: 'Supply Convoy', icon: 'crate', weight: 1.3,
    prepare: () => ({ id: 'convoy' }),
    text: () => 'A supply convoy has reached the front intact. Logistics asks where you want it.',
    choices: (run) => [
      { label: 'The war chest', hint: '+$3,000', apply(r) { r.warChest += 3000; r.stats.creditsEarned += 3000; return 'The convoy is sold off to the quartermasters: +$3,000.'; } },
      { label: 'The laboratories', hint: '+2 research points', apply(r) { r.rp += 2; return 'Precision instruments for the labs: +2 research points.'; } },
      {
        label: 'Arm the core army', hint: 'A veteran tank joins the core',
        apply(r) {
          const v = addVeteran(r, mainTank(r), 1);
          if (v) return `A veteran tank crew joins the core army: ${v.name}.`;
          r.warChest += 800;
          return 'The core army is full; the tank is sold to another division. +$800.';
        },
      },
    ],
  },
  {
    id: 'superweapon', title: 'Superweapon Threat', icon: 'nuke', weight: 0.8,
    prepare(run, rng) {
      if (run.superThreat || run.turn < 4) return null;
      const opts = run.territories.filter((t) => t.owner === 'enemy' && !t.capital);
      if (!opts.length) return null;
      const kind = rng.pick(['nuke', 'iron', 'chrono'] as const);
      return { id: 'superweapon', territory: rng.pick(opts).id, data: { kind } };
    },
    text: (run, ev) => `Intelligence confirms the enemy is readying a ${ev.data?.kind === 'nuke' ? 'nuclear missile silo' : ev.data?.kind === 'iron' ? 'superweapon' : 'superweapon'} in ${tName(run, ev)}. In three turns it will strike one of our territories.`,
    choices: () => [
      {
        label: 'Commando raid', hint: '$2,500 · 60% to destroy it', cost: 2500,
        apply(run, ev, rng) {
          pay(run, 2500);
          if (rng.chance(odds(run, 0.6))) { run.rp += 1; return 'The commandos blew the site sky-high and brought back blueprints. +1 research point.'; }
          run.superThreat = { territory: ev.territory!, turns: 3, kind: ev.data!.kind };
          return `The raid failed. The weapon in ${tName(run, ev)} is still being readied: capture the territory or destroy it in battle.`;
        },
      },
      {
        label: 'Accelerate the offensive', hint: 'It strikes in 3 turns unless you take the territory',
        apply(run, ev) { run.superThreat = { territory: ev.territory!, turns: 3, kind: ev.data!.kind }; return `Every attack on ${tName(run, ev)} now has a superweapon to destroy. Three turns.`; },
      },
    ],
  },
  {
    id: 'defection', title: 'Defection', icon: 'user', weight: 0.9,
    prepare(run, rng) {
      const f = frontier(run);
      return f.length ? { id: 'defection', territory: rng.pick(f).id, data: { rank: rng.chance(0.3) ? 'General' : 'Colonel' } } : null;
    },
    text: (run, ev) => `A ${ev.data?.rank ?? 'Colonel'} of the enemy garrison in ${tName(run, ev)} offers to defect with his tank crews. It could be a trap.`,
    choices: () => [
      {
        label: 'Welcome him', hint: 'Enemy tanks join your core (20% trap)',
        apply(run, ev, rng) {
          if (rng.chance(hasPerk(run, 'partisans') ? 0.05 : 0.2)) { pay(run, 1500); return 'It was a trap! Saboteurs hit our depots before vanishing: -$1,500.'; }
          const a = addVeteran(run, enemyTank(run), 1), b = addVeteran(run, enemyTank(run), 2);
          return `The defectors drive their tanks across the line${a || b ? `: ${[a, b].filter(Boolean).map((v) => v!.name).join(' and ')} join the core army` : ', but the core army is full'}.`;
        },
      },
      {
        label: 'Demand his maps', hint: 'Weaken the garrison',
        apply(run, ev) {
          const t = territory(run, ev.territory!);
          t.strength = Math.max(1, t.strength - 2);
          return `His maps expose the defences of ${t.name}: garrison strength now ${t.strength}.`;
        },
      },
      { label: 'Refuse', hint: 'Nothing happens', apply: () => 'We send him back across the line. Trust is a luxury.' },
    ],
  },
  {
    id: 'breakthrough', title: 'Scientific Breakthrough', icon: 'chart', weight: 1,
    prepare: () => ({ id: 'breakthrough' }),
    text: () => 'Our scientists report a breakthrough, but scaling it up will be expensive.',
    choices: () => [
      { label: 'Fund it', hint: '$2,000 · +3 research points', cost: 2000, apply(r) { pay(r, 2000); r.rp += 3; return 'The programme is funded: +3 research points.'; } },
      { label: 'Shelve it', hint: '+1 research point', apply(r) { r.rp += 1; return 'The notes are filed for later: +1 research point.'; } },
    ],
  },
  {
    id: 'winter', title: 'Harsh Winter', icon: 'snow', weight: 1,
    prepare(run) { const m = (2 + run.turn - 1) % 12; return m === 11 || m <= 1 ? { id: 'winter' } : null; },
    text: () => 'The cold is biting. Fuel lines freeze and engines will not start. The men need winter gear.',
    choices: () => [
      { label: 'Buy winter gear', hint: '$1,500', cost: 1500, apply(r) { pay(r, 1500); return 'Greatcoats and antifreeze reach the front. The army stays fit.'; } },
      {
        label: 'Endure', hint: 'Lose 20% of the war chest',
        apply(r) { const loss = Math.round(r.warChest * 0.2); pay(r, loss); return `Frostbite and frozen engines cost us ${money(loss)} in repairs.`; },
      },
    ],
  },
  {
    id: 'mercenaries', title: 'Mercenary Offer', icon: 'coin', weight: 0.8,
    prepare: (run) => (run.core.length < 12 ? { id: 'mercenaries' } : null),
    text: () => 'A freelance armoured company offers its services. Veterans, every one of them, and they do not come cheap.',
    choices: (run) => [
      {
        label: 'Hire them', hint: '$2,500 · three veterans join the core', cost: 2500,
        apply(r) {
          pay(r, 2500);
          const got = [addVeteran(r, mainTank(r), 1), addVeteran(r, 'e3', 1), addVeteran(r, r.faction === 'allies' ? 'jeep' : 'v2rl', 1)].filter(Boolean);
          return got.length ? `${got.map((v) => v!.name).join(', ')} sign the contract.` : 'The core army is full; the mercenaries take the money and run.';
        },
      },
      { label: 'Decline', hint: 'Nothing happens', apply: () => 'The mercenaries move on to the next war.' },
    ],
  },
  {
    id: 'profiteer', title: 'War Profiteer', icon: 'money', weight: 0.7,
    prepare: (run) => (run.perkChoice ? null : { id: 'profiteer' }),
    text: () => 'A smuggler offers rare equipment and expertise, for a price. Military police would love to meet him.',
    choices: () => [
      { label: 'Buy his wares', hint: '$4,000 · choose a perk', cost: 4000, apply(r) { pay(r, 4000); offerPerks(r); return 'The crates are opened: choose your new advantage.'; } },
      { label: 'Report him', hint: '+$800 reward', apply(r) { r.warChest += 800; return 'The profiteer is arrested. The bounty pays $800.'; } },
    ],
  },
  {
    id: 'spy', title: 'Spy Captured', icon: 'spy', weight: 0.9,
    prepare: () => ({ id: 'spy' }),
    text: () => 'Military police caught an enemy spy photographing our depots.',
    choices: (run) => [
      { label: 'Interrogate him', hint: '+2 research points', apply(r) { r.rp += 2; return 'He talks: enemy codes and equipment specs. +2 research points.'; } },
      {
        label: 'Turn him', hint: run.threat ? 'Call off the enemy counterattack' : 'Feed the enemy false plans',
        apply(r) {
          if (r.threat) { const t = findTerritory(r, r.threat.target); r.threat = null; return `False reports convince the enemy to call off the attack on ${t?.name ?? 'our lines'}.`; }
          r.pursuit = false;
          for (const t of frontier(r)) if (t.strength > 1 && t.value === 1) { t.strength--; break; }
          return 'Fed false plans, the enemy shifts troops away from the front.';
        },
      },
      { label: 'Trade him', hint: '+$2,000', apply(r) { r.warChest += 2000; return 'Exchanged for one of ours and a briefcase of cash: +$2,000.'; } },
    ],
  },
  {
    id: 'refugees', title: 'Refugee Columns', icon: 'user', weight: 0.7,
    prepare: (run) => (run.morale < run.moraleMax ? { id: 'refugees' } : null),
    text: () => 'Columns of civilians flee the fighting. Sheltering them would cost supplies, but the men would remember it.',
    choices: () => [
      { label: 'Shelter them', hint: '$1,000 · +1 morale', cost: 1000, apply(r) { pay(r, 1000); r.morale = Math.min(r.moraleMax, r.morale + 1); return 'The refugees are fed and sheltered. Morale rises.'; } },
      { label: 'Push on', hint: 'Nothing happens', apply: () => 'The army has no time to spare.' },
    ],
  },
  {
    id: 'hero', title: 'A Hero Emerges', icon: 'medal', weight: 0.8,
    prepare(run, rng) {
      const vets = run.core.filter((v) => v.rank < 2);
      return vets.length ? { id: 'hero', data: { vet: rng.pick(vets).id } } : null;
    },
    text: (run, ev) => { const v = run.core.find((x) => x.id === ev.data?.vet); return `${v?.name ?? 'A veteran'} (${UNITS[v?.type ?? 'e1']?.name ?? 'unit'}) turned the tide in the last engagement. The men speak of nothing else.`; },
    choices: () => [
      { label: 'Promote to elite', hint: 'Elite rank', apply(r, ev) { const v = r.core.find((x) => x.id === ev.data?.vet); if (v) v.rank = 2; return `${v?.name ?? 'The veteran'} is promoted to elite.`; } },
      { label: 'Train recruits', hint: '+1 research point, +$1,000', apply(r) { r.rp += 1; r.warChest += 1000; return 'Hard-won lessons spread through the army: +1 research point and +$1,000.'; } },
    ],
  },
  {
    id: 'sabotage', title: 'Rail Sabotage', icon: 'bridge', weight: 0.7,
    prepare: (run) => (owned(run).length >= 4 ? { id: 'sabotage' } : null),
    text: () => 'Enemy saboteurs have blown a railway bridge behind our lines. Supplies are piling up at the break.',
    choices: () => [
      { label: 'Repair it at once', hint: '$1,500', cost: 1500, apply(r) { pay(r, 1500); return 'Engineers rebuild the bridge in two days.'; } },
      { label: 'Reroute the trains', hint: 'Lose a research point', apply(r) { r.rp = Math.max(0, r.rp - 1); return 'Supplies take the long way round; the labs wait. -1 research point.'; } },
    ],
  },
];

export const EVENT_BY_ID: Record<string, EventDef> = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

/** Roll a random event for the turn (or none). */
export function rollEvent(run: ConquestRun): PendingEvent | null {
  return withRng(run, (rng) => {
    if (run.turn < 2 || !rng.chance(0.55)) return null;
    const cands: { ev: PendingEvent; w: number }[] = [];
    for (const def of EVENTS) {
      const ev = def.prepare(run, rng);
      if (ev) cands.push({ ev, w: def.weight });
    }
    if (!cands.length) return null;
    let r = rng.next() * cands.reduce((s, c) => s + c.w, 0);
    for (const c of cands) { r -= c.w; if (r <= 0) return c.ev; }
    return cands[cands.length - 1].ev;
  });
}

/** Resolve the pending event with a choice; returns the outcome text. */
export function chooseEvent(run: ConquestRun, index: number): string {
  const ev = run.event;
  if (!ev) return '';
  const def = EVENT_BY_ID[ev.id];
  const choice = def?.choices(run, ev)[index];
  if (!def || !choice) return '';
  if (choice.cost && run.warChest < choice.cost) return '';
  const text = withRng(run, (rng) => choice.apply(run, ev, rng));
  run.event = null;
  log(run, 'event', `${def.title}: ${text}`);
  return text;
}

export { PERKS, perkDef };
