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
import { RUN } from '../i18n/en/conquest-run'; // the English stored in the run (translated where shown)
import { fill as en } from './text';

const E = RUN.event;

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
const tName = (run: ConquestRun, ev: PendingEvent) => findTerritory(run, ev.territory)?.name ?? E.theFront;
/** An event line with the event's territory filled in. */
const at = (template: string, run: ConquestRun, ev: PendingEvent) => en(template, { territory: tName(run, ev) });
const mainTank = (run: ConquestRun) => (run.faction === 'allies' ? '2tnk' : '3tnk');
const enemyTank = (run: ConquestRun) => (run.enemy === 'allies' ? '2tnk' : '3tnk');

/** Enemy territories bordering ours. */
function frontier(run: ConquestRun): Territory[] {
  return attackTargets(run).map((a) => territory(run, a.target)).filter((t) => t.owner === 'enemy' && !t.capital);
}

export const EVENTS: EventDef[] = [
  {
    id: 'partisans', title: E.partisans.title, icon: 'flag', weight: 1.2,
    prepare(run, rng) {
      const f = frontier(run).filter((t) => !t.partisans);
      return f.length ? { id: 'partisans', territory: rng.pick(f).id } : null;
    },
    text: (run, ev) => at(E.partisans.text, run, ev),
    choices: () => [
      {
        label: E.partisans.arm, hint: E.partisans.armHint, cost: 1500,
        apply(run, ev, rng) {
          pay(run, 1500);
          const t = territory(run, ev.territory!);
          t.partisans = true;
          if (rng.chance(odds(run, 0.5))) { t.strength = Math.max(1, t.strength - 1); return en(E.partisans.spread, { territory: t.name, n: t.strength }); }
          return en(E.partisans.armed, { territory: t.name });
        },
      },
      {
        label: E.partisans.intel, hint: E.partisans.intelHint,
        apply(run, ev) { run.rp += 1; return at(E.partisans.intelDone, run, ev); },
      },
      { label: E.partisans.ignore, hint: E.nothing, apply: (run, ev) => at(E.partisans.crushed, run, ev) },
    ],
  },
  {
    id: 'convoy', title: E.convoy.title, icon: 'crate', weight: 1.3,
    prepare: () => ({ id: 'convoy' }),
    text: () => E.convoy.text,
    choices: (run) => [
      { label: E.convoy.chest, hint: '+$3,000', apply(r) { r.warChest += 3000; r.stats.creditsEarned += 3000; return E.convoy.chestDone; } },
      { label: E.convoy.labs, hint: E.convoy.labsHint, apply(r) { r.rp += 2; return E.convoy.labsDone; } },
      {
        label: E.convoy.arm, hint: E.convoy.armHint,
        apply(r) {
          const v = addVeteran(r, mainTank(r), 1);
          if (v) return en(E.convoy.armDone, { vet: v.name });
          r.warChest += 800;
          return E.convoy.armFull;
        },
      },
    ],
  },
  {
    id: 'superweapon', title: E.superweapon.title, icon: 'nuke', weight: 0.8,
    prepare(run, rng) {
      if (run.superThreat || run.turn < 4) return null;
      const opts = run.territories.filter((t) => t.owner === 'enemy' && !t.capital);
      if (!opts.length) return null;
      const kind = rng.pick(['nuke', 'iron', 'chrono'] as const);
      return { id: 'superweapon', territory: rng.pick(opts).id, data: { kind } };
    },
    text: (run, ev) => at(ev.data?.kind === 'nuke' ? E.superweapon.textNuke : E.superweapon.text, run, ev),
    choices: () => [
      {
        label: E.superweapon.raid, hint: E.superweapon.raidHint, cost: 2500,
        apply(run, ev, rng) {
          pay(run, 2500);
          if (rng.chance(odds(run, 0.6))) { run.rp += 1; return E.superweapon.raidDone; }
          run.superThreat = { territory: ev.territory!, turns: 3, kind: ev.data!.kind };
          return at(E.superweapon.raidFailed, run, ev);
        },
      },
      {
        label: E.superweapon.push, hint: E.superweapon.pushHint,
        apply(run, ev) { run.superThreat = { territory: ev.territory!, turns: 3, kind: ev.data!.kind }; return at(E.superweapon.pushDone, run, ev); },
      },
    ],
  },
  {
    id: 'defection', title: E.defection.title, icon: 'user', weight: 0.9,
    prepare(run, rng) {
      const f = frontier(run);
      return f.length ? { id: 'defection', territory: rng.pick(f).id, data: { rank: rng.chance(0.3) ? 'General' : 'Colonel' } } : null;
    },
    text: (run, ev) => at(ev.data?.rank === 'General' ? E.defection.textGeneral : E.defection.textColonel, run, ev),
    choices: () => [
      {
        label: E.defection.welcome, hint: E.defection.welcomeHint,
        apply(run, ev, rng) {
          if (rng.chance(hasPerk(run, 'partisans') ? 0.05 : 0.2)) { pay(run, 1500); return E.defection.trap; }
          const a = addVeteran(run, enemyTank(run), 1), b = addVeteran(run, enemyTank(run), 2);
          const names = [a, b].filter(Boolean).map((v) => v!.name);
          return names.length === 2 ? en(E.defection.joined2, { a: names[0], b: names[1] }) : names.length ? en(E.defection.joined1, { a: names[0] }) : E.defection.full;
        },
      },
      {
        label: E.defection.maps, hint: E.defection.mapsHint,
        apply(run, ev) {
          const t = territory(run, ev.territory!);
          t.strength = Math.max(1, t.strength - 2);
          return en(E.defection.mapsDone, { territory: t.name, n: t.strength });
        },
      },
      { label: E.defection.refuse, hint: E.nothing, apply: () => E.defection.refused },
    ],
  },
  {
    id: 'breakthrough', title: E.breakthrough.title, icon: 'chart', weight: 1,
    prepare: () => ({ id: 'breakthrough' }),
    text: () => E.breakthrough.text,
    choices: () => [
      { label: E.breakthrough.fund, hint: E.breakthrough.fundHint, cost: 2000, apply(r) { pay(r, 2000); r.rp += 3; return E.breakthrough.funded; } },
      { label: E.breakthrough.shelve, hint: E.breakthrough.shelveHint, apply(r) { r.rp += 1; return E.breakthrough.shelved; } },
    ],
  },
  {
    id: 'winter', title: E.winter.title, icon: 'snow', weight: 1,
    prepare(run) { const m = (2 + run.turn - 1) % 12; return m === 11 || m <= 1 ? { id: 'winter' } : null; },
    text: () => E.winter.text,
    choices: () => [
      { label: E.winter.gear, hint: E.cost1500, cost: 1500, apply(r) { pay(r, 1500); return E.winter.gearDone; } },
      {
        label: E.winter.endure, hint: E.winter.endureHint,
        apply(r) { const loss = Math.round(r.warChest * 0.2); pay(r, loss); return en(E.winter.endured, { money: money(loss) }); },
      },
    ],
  },
  {
    id: 'mercenaries', title: E.mercenaries.title, icon: 'coin', weight: 0.8,
    prepare: (run) => (run.core.length < 12 ? { id: 'mercenaries' } : null),
    text: () => E.mercenaries.text,
    choices: (run) => [
      {
        label: E.mercenaries.hire, hint: E.mercenaries.hireHint, cost: 2500,
        apply(r) {
          pay(r, 2500);
          const got = [addVeteran(r, mainTank(r), 1), addVeteran(r, 'e3', 1), addVeteran(r, r.faction === 'allies' ? 'jeep' : 'v2rl', 1)].filter(Boolean).map((v) => v!.name);
          const [a, b, c] = got;
          return got.length >= 3 ? en(E.mercenaries.hired3, { a, b, c }) : got.length === 2 ? en(E.mercenaries.hired2, { a, b }) : got.length ? en(E.mercenaries.hired1, { a }) : E.mercenaries.full;
        },
      },
      { label: E.mercenaries.decline, hint: E.nothing, apply: () => E.mercenaries.declined },
    ],
  },
  {
    id: 'profiteer', title: E.profiteer.title, icon: 'money', weight: 0.7,
    prepare: (run) => (run.perkChoice ? null : { id: 'profiteer' }),
    text: () => E.profiteer.text,
    choices: () => [
      { label: E.profiteer.buy, hint: E.profiteer.buyHint, cost: 4000, apply(r) { pay(r, 4000); offerPerks(r); return E.profiteer.bought; } },
      { label: E.profiteer.report, hint: E.profiteer.reportHint, apply(r) { r.warChest += 800; return E.profiteer.reported; } },
    ],
  },
  {
    id: 'spy', title: E.spy.title, icon: 'spy', weight: 0.9,
    prepare: () => ({ id: 'spy' }),
    text: () => E.spy.text,
    choices: (run) => [
      { label: E.spy.interrogate, hint: E.spy.interrogateHint, apply(r) { r.rp += 2; return E.spy.interrogated; } },
      {
        label: E.spy.turn, hint: run.threat ? E.spy.turnThreatHint : E.spy.turnHint,
        apply(r) {
          if (r.threat) { const t = findTerritory(r, r.threat.target); r.threat = null; return en(E.spy.calledOff, { territory: t?.name ?? E.spy.ourLines }); }
          r.pursuit = false;
          for (const t of frontier(r)) if (t.strength > 1 && t.value === 1) { t.strength--; break; }
          return E.spy.fed;
        },
      },
      { label: E.spy.trade, hint: E.spy.tradeHint, apply(r) { r.warChest += 2000; return E.spy.traded; } },
    ],
  },
  {
    id: 'refugees', title: E.refugees.title, icon: 'user', weight: 0.7,
    prepare: (run) => (run.morale < run.moraleMax ? { id: 'refugees' } : null),
    text: () => E.refugees.text,
    choices: () => [
      { label: E.refugees.shelter, hint: E.refugees.shelterHint, cost: 1000, apply(r) { pay(r, 1000); r.morale = Math.min(r.moraleMax, r.morale + 1); return E.refugees.sheltered; } },
      { label: E.refugees.push, hint: E.nothing, apply: () => E.refugees.pushed },
    ],
  },
  {
    id: 'hero', title: E.hero.title, icon: 'medal', weight: 0.8,
    prepare(run, rng) {
      const vets = run.core.filter((v) => v.rank < 2);
      return vets.length ? { id: 'hero', data: { vet: rng.pick(vets).id } } : null;
    },
    text: (run, ev) => { const v = run.core.find((x) => x.id === ev.data?.vet); return en(E.hero.text, { vet: v?.name ?? 'A veteran', unit: UNITS[v?.type ?? 'e1']?.name ?? 'unit' }); },
    choices: () => [
      { label: E.hero.promote, hint: E.hero.promoteHint, apply(r, ev) { const v = r.core.find((x) => x.id === ev.data?.vet); if (v) v.rank = 2; return en(E.hero.promoted, { vet: v?.name ?? 'The veteran' }); } },
      { label: E.hero.train, hint: E.hero.trainHint, apply(r) { r.rp += 1; r.warChest += 1000; return E.hero.trained; } },
    ],
  },
  {
    id: 'sabotage', title: E.sabotage.title, icon: 'bridge', weight: 0.7,
    prepare: (run) => (owned(run).length >= 4 ? { id: 'sabotage' } : null),
    text: () => E.sabotage.text,
    choices: () => [
      { label: E.sabotage.repair, hint: E.cost1500, cost: 1500, apply(r) { pay(r, 1500); return E.sabotage.repaired; } },
      { label: E.sabotage.reroute, hint: E.sabotage.rerouteHint, apply(r) { r.rp = Math.max(0, r.rp - 1); return E.sabotage.rerouted; } },
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
