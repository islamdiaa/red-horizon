// World Conquest QA: random-policy fuzz of the strategic layer (round 6 contract: "no softlocks ... at least 2,000
// random-policy runs, every homeland included"). Each run starts a world from one homeland, size and difficulty and
// plays the human's side with a seeded random policy over legalActions() (placing, trading, attacking by one roll,
// a blitz or an RTS battle with a made-up result, moving in, fortifying, ceasefires, defence choices, ending phases
// and turns) until the run ends. After every action it checks:
//   - no softlock: an active run always offers a legal action, and every turn ends within a step budget;
//   - invariants: every territory has an owner that exists and at least 1 troop; a rival is alive exactly while it
//     owns a territory; troop totals move only by what the events say (placed, lost to dice, moved); cards are
//     conserved (drawn - 3 x traded = held, elimination hands them over); no NaN / Infinity / undefined in the JSON;
//     the link graph is consistent; the diary is capped;
//   - termination: every run ends (won / lost) by its turn cap (rules.ts TURN_LIMIT).
//
//   node --import tsx tools/world/qa-fuzz.ts [--runs 2000] [--seed0 1] [--sizes world,blitz] [--diffs all]
//        [--homes all|id,id] [--fight 0.08] [--out dir]           (WORKERS=n threads, default 6)
// Writes <out>/fuzz.json (every run) and fuzz.md (the summary), default screenshots/world-qa/fuzz-<seed0> (git-ignored).
import { QA_OUT } from './qa-pool'; // (results default to screenshots/world-qa/ in the repo: git-ignored)
import { Rng } from '../../src/core/rng';
import type { WorldRun, WorldEvent } from '../../src/conquest/world/state';

export type Api = typeof import('../../src/conquest/world/index');
let API: Api | null = null;
/** The strategic API (the barrel: it registers GEO's geography as the atlas). */
export async function api(): Promise<Api> { return (API ??= await import('../../src/conquest/world/index')); }

export interface FuzzJob { home: string; size: 'world' | 'blitz'; difficulty: string; seed: number; policy: number; fight: number; /** 0..1: share of decisions made sensibly (auto-placement, the best attack while its odds are good) */ skill?: number; /** keep the action trace (debug) */ trace?: boolean }
export interface FuzzResult extends FuzzJob {
  status: string; ending: string | null; turns: number; steps: number; ms: number;
  violations: string[]; softlock: string | null; error: string | null;
  battles: number; dice: number; blitz: number; ceasefires: number; trades: number; conquered: number; eliminated: number[];
  /** territories the human held at the end, and the most it held */
  held: number; peak: number; trace?: string[];
}

const NAN_PATH = (v: unknown, path = 'run', out: string[] = [], depth = 0): string[] => {
  if (out.length > 3 || depth > 12) return out;
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(`${path}=${v}`); return out; }
  if (v === undefined) { out.push(`${path}=undefined`); return out; }
  if (Array.isArray(v)) { v.forEach((x, i) => NAN_PATH(x, `${path}[${i}]`, out, depth + 1)); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (x === undefined) continue; NAN_PATH(x, `${path}.${k}`, out, depth + 1); }
  return out;
};

/** Structural invariants of a run (empty: all good). */
export function invariants(run: WorldRun): string[] {
  const bad: string[] = [];
  const ids = new Set(run.powers.map((p) => p.id));
  const owned = new Map<number, number>();
  const byId = new Set<string>();
  for (const t of run.territories) {
    if (byId.has(t.id)) bad.push(`duplicate territory ${t.id}`);
    byId.add(t.id);
    if (t.owner !== -1 && !ids.has(t.owner)) bad.push(`${t.id} owned by unknown power ${t.owner}`);
    if (!Number.isInteger(t.troops) || t.troops < 1) bad.push(`${t.id} has ${t.troops} troops`);
    owned.set(t.owner, (owned.get(t.owner) ?? 0) + 1);
    if (!run.zones.some((z) => z.id === t.zone)) bad.push(`${t.id} in unknown zone ${t.zone}`);
  }
  for (const p of run.powers) {
    const n = owned.get(p.id) ?? 0;
    if (p.id !== 0 && p.alive !== n > 0) bad.push(`power ${p.id} alive=${p.alive} with ${n} territories`);
    if (p.id === 0 && run.status === 'active' && n === 0) bad.push('the human holds nothing but the run is active');
    if (!byId.has(p.capital)) bad.push(`power ${p.id} capital ${p.capital} not a territory`);
    if (!p.alive && p.cards.length) bad.push(`eliminated power ${p.id} still holds ${p.cards.length} cards`);
  }
  if (!Number.isInteger(run.toPlace) || run.toPlace < 0) bad.push(`toPlace ${run.toPlace}`);
  if (!(run.fortifiesLeft >= 0)) bad.push(`fortifiesLeft ${run.fortifiesLeft}`);
  const seen = new Set<string>();
  for (const l of run.links) {
    if (!byId.has(l.a) || !byId.has(l.b) || l.a === l.b) bad.push(`bad link ${l.a}-${l.b}`);
    const k = l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`;
    if (seen.has(k)) bad.push(`duplicate link ${k}`);
    seen.add(k);
  }
  for (const z of run.zones) for (const id of z.territories) if (!byId.has(id)) bad.push(`zone ${z.id} lists unknown ${id}`);
  if (run.conquest) {
    const f = run.territories.find((t) => t.id === run.conquest!.from), to = run.territories.find((t) => t.id === run.conquest!.to);
    if (!f || !to || f.owner !== to.owner) bad.push(`conquest ${run.conquest.from}->${run.conquest.to} not held by one power`);
  }
  if (run.log.length > 240) bad.push(`log has ${run.log.length} entries`);
  bad.push(...NAN_PATH(run).map((s) => `non-finite ${s}`));
  return bad;
}

/** Every territory reachable from every other over the links (a world nobody can conquer would softlock a World win). */
export function connected(run: WorldRun): boolean {
  if (!run.territories.length) return false;
  const adj = new Map<string, string[]>();
  for (const l of run.links) { (adj.get(l.a) ?? adj.set(l.a, []).get(l.a)!).push(l.b); (adj.get(l.b) ?? adj.set(l.b, []).get(l.b)!).push(l.a); }
  const seen = new Set([run.territories[0].id]), q = [run.territories[0].id];
  while (q.length) for (const n of adj.get(q.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  return seen.size === run.territories.length;
}

const troops = (run: WorldRun) => run.territories.reduce((s, t) => s + t.troops, 0);
const cards = (run: WorldRun) => run.powers.reduce((s, p) => s + p.cards.length, 0);

/** What the events say the troop and card totals did. */
function ledger(events: WorldEvent[]) {
  let dT = 0, dC = 0, battle = false;
  for (const e of events) {
    if (e.kind === 'reinforce') dT += e.n;
    else if (e.kind === 'attack') dT -= e.attLoss + e.defLoss;
    else if (e.kind === 'card') dC += 1;
    else if (e.kind === 'trade') dC -= 3;
    else if (e.kind === 'battle') battle = true;
  }
  return { dT, dC, battle };
}

/** A made-up RTS result for the fight route (the battle itself is QA's battlefield tools' job). */
function fakeOutcome(spec: { id: string; core?: { vet: number; rank: number; xp: number }[] }, rng: Rng) {
  const won = rng.next() < 0.6;
  return {
    battleId: spec.id, won, time: 300 + Math.floor(rng.next() * 900), creditsLeft: Math.floor(rng.next() * 4000),
    objectives: [{ id: 'main', text: 'Primary objective', primary: true, state: won ? 'done' : 'failed' }],
    survivors: (spec.core ?? []).filter(() => rng.next() < 0.7).map((c) => ({ vet: c.vet, rank: c.rank, xp: c.xp + 50 })),
    recruits: [], kills: Math.floor(rng.next() * 40), losses: Math.floor(rng.next() * 30), superweaponDestroyed: false,
  };
}

/** One fuzz run (also the worker entry point). */
export async function fuzzOne(job: FuzzJob): Promise<FuzzResult> {
  const W = await api();
  const t0 = performance.now();
  const rng = new Rng(job.policy * 2654435761 + 17);
  const res: FuzzResult = { ...job, status: 'error', ending: null, turns: 0, steps: 0, ms: 0, violations: [], softlock: null, error: null, battles: 0, dice: 0, blitz: 0, ceasefires: 0, trades: 0, conquered: 0, eliminated: [], held: 0, peak: 0, ...(job.trace ? { trace: [] } : {}) };
  const viol = (s: string) => { if (res.violations.length < 12) res.violations.push(`t${run?.turn ?? 0}/s${res.steps}: ${s}`); };
  let run: WorldRun | null = null;
  try {
    run = W.newWorldRun({ seed: job.seed, home: job.home, size: job.size, difficulty: job.difficulty as never });
    for (const v of invariants(run)) viol(`at start: ${v}`);
    if (!connected(run)) viol('the territories are not all connected');
    const cap = (W as unknown as { TURN_LIMIT?: Record<string, number> }).TURN_LIMIT?.[job.size] ?? (job.size === 'world' ? 150 : 80);
    let stepsThisTurn = 0, lastTurn = run.turn;
    const MAX_STEPS = 400_000, TURN_STEPS = 4000;
    while (run.status === 'active') {
      if (++res.steps > MAX_STEPS) { res.softlock = `no end after ${MAX_STEPS} steps (turn ${run.turn})`; break; }
      if (run.turn !== lastTurn) { lastTurn = run.turn; stepsThisTurn = 0; }
      if (++stepsThisTurn > TURN_STEPS) { res.softlock = `turn ${run.turn} did not end in ${TURN_STEPS} steps (phase ${run.phase}, toPlace ${run.toPlace})`; break; }
      if (run.turn > cap + 1) { res.softlock = `past the turn cap ${cap} (turn ${run.turn})`; break; }
      const T0 = troops(run), C0 = cards(run);
      const st = policyStep(W, run, rng, job, res, viol);
      if (st.softlock) { res.softlock = st.softlock; break; }
      const { events, note } = st;
      if (job.trace) res.trace!.push(`${run.turn}:${run.phase}:${note}`.slice(0, 160));
      // ---- checks
      const L = ledger(events);
      if (!L.battle && !note.startsWith('fight')) {
        const dT = troops(run) - T0;
        if (events.length && dT !== L.dT) viol(`troops moved by ${dT}, the events say ${L.dT} (${note})`);
        const dC = cards(run) - C0;
        if (events.length && dC !== L.dC) viol(`cards moved by ${dC}, the events say ${L.dC} (${note})`);
      }
      for (const v of invariants(run)) viol(v);
      res.peak = Math.max(res.peak, run.territories.filter((t) => t.owner === 0).length);
      if (res.violations.length >= 12) break;
    }
    res.status = run.status;
    res.ending = run.ending ?? null;
    res.turns = run.turn;
    res.conquered = run.stats.conquered;
    res.eliminated = run.powers.filter((p) => !p.alive && p.id !== 0).map((p) => p.id);
    res.held = run.territories.filter((t) => t.owner === 0).length;
    if (run.status === 'active' && !res.softlock && res.violations.length < 12) res.softlock = 'stopped while active';
    if (run.turn > cap + 1) viol(`ended at turn ${run.turn}, past the cap ${cap}`);
  } catch (e) {
    res.error = e instanceof Error ? `${e.message} | ${(e.stack ?? '').split('\n').slice(1, 4).join(' | ')}` : String(e);
    res.turns = run?.turn ?? 0;
  }
  res.ms = Math.round(performance.now() - t0);
  return res;
}

type Act = ReturnType<Api['legalActions']>[number];

/** Counters a policy step bumps. */
export interface StepStats { battles: number; dice: number; blitz: number; ceasefires: number; trades: number }

/**
 * One step of the random policy on the human's side (or the RTS route for a pending defence). Returns the events
 * the step produced (for the ledger checks) and a note; `softlock` when no legal action exists.
 */
export function policyStep(W: Api, run: WorldRun, rng: Rng, job: Pick<FuzzJob, 'fight' | 'skill'>, res: StepStats, viol: (s: string) => void = () => {}): { events: WorldEvent[]; note: string; softlock?: string } {
  let events: WorldEvent[] = [];
  let note = '';
  // ---- the RTS route, now and then: a pending defence fought, or an attack fought (made-up result)
  if (run.defence && rng.next() < job.fight) {
    const setup = W.startDefenceBattle(run);
    if (!setup) { viol('startDefenceBattle gave nothing for a pending defence'); }
    else { res.battles++; note = `fight-defence ${run.defence?.to}`; W.applyBattle(run, fakeOutcome(setup.battle as never, rng) as never); }
    if (run.status === 'active' && !run.defence && run.current !== 0) events = W.endTurn(run);
    return { events, note };
  }
  const acts = W.legalActions(run);
  if (!acts.length) return { events, note, softlock: `no legal action (phase ${run.phase}, current ${run.current}, toPlace ${run.toPlace}, defence ${!!run.defence}, pending ${!!run.pending}, conquest ${!!run.conquest})` };
  // a sensible decision now and then (job.skill): place everything where a commander would, attack only at good odds
  if (job.skill && rng.next() < job.skill && !acts.some((a) => a.type === 'trade' || a.type === 'defend')) {
    if (acts.some((a) => a.type === 'place')) {
      const T0 = run.toPlace;
      note = 'autoPlace';
      if (!W.autoPlace(run)) viol(`autoPlace refused with ${T0} to place`);
      else events = [{ kind: 'reinforce', power: 0, to: '', n: T0 }];
      return { events, note };
    }
    const atk = acts.filter((a) => a.type === 'attack') as Extract<Act, { type: 'attack' }>[];
    let best: Extract<Act, { type: 'attack' }> | null = null, bw = 0;
    for (const a of atk) { const w = W.attackOdds(run, a.from, a.to).win; if (w > bw) { bw = w; best = a; } }
    if (best && bw >= 0.6) {
      res.blitz++;
      note = `smart blitz ${best.from}->${best.to} ${bw.toFixed(2)}`;
      const r = W.rollAttack(run, best.from, best.to, true);
      if (!r) viol(`rollAttack refused a legal attack ${best.from}->${best.to}`);
      else events = [{ kind: 'attack', power: 0, from: best.from, to: best.to, defender: -2, attLoss: r.attLoss, defLoss: r.defLoss, rolls: r.rolls.length, conquered: r.conquered }];
      return { events, note };
    }
    const end = acts.find((a) => a.type === 'endTurn');
    if (end && run.phase !== 'reinforce') { note = 'smart endTurn'; return { events: W.act(run, end), note }; }
  }
  const pick = choose(acts, rng, run);
  if (pick.type === 'attack' && rng.next() < job.fight && !run.pending) {
    const setup = W.startBattle(run, pick.from, pick.to);
    if (!setup) viol(`startBattle ${pick.from}->${pick.to} gave nothing for a legal attack`);
    else { res.battles++; note = `fight ${pick.from}->${pick.to}`; W.applyBattle(run, fakeOutcome(setup.battle as never, rng) as never); }
  } else if (pick.type === 'attack') {
    // a blitz or one roll, called directly: the result says what it cost (act()'s events come from the capped diary)
    const blitz = rng.next() < 0.5;
    if (blitz) res.blitz++; else res.dice++;
    note = `${blitz ? 'blitz' : 'roll'} ${pick.from}->${pick.to}`;
    const r = W.rollAttack(run, pick.from, pick.to, blitz, blitz ? undefined : 1 + Math.floor(rng.next() * pick.dice));
    if (!r) viol(`rollAttack refused a legal attack ${pick.from}->${pick.to}`);
    else events = [{ kind: 'attack', power: 0, from: pick.from, to: pick.to, defender: -2, attLoss: r.attLoss, defLoss: r.defLoss, rolls: r.rolls.length, conquered: r.conquered }, ...(r.eliminated ? [] : [])];
    if (r?.conquered && run.conquest && rng.next() < 0.3) W.moveIn(run, run.conquest.min + Math.floor(rng.next() * (run.conquest.max - run.conquest.min + 1)));
  } else if (pick.type === 'place' && rng.next() < 0.7) {
    const n = 1 + Math.floor(rng.next() * pick.max);
    note = `place ${n} ${pick.to}`;
    if (!W.placeTroops(run, pick.to, n)) viol(`placeTroops refused a legal placement ${pick.to} x${n}`);
    else events = [{ kind: 'reinforce', power: 0, to: pick.to, n }];
  } else if (pick.type === 'trade' && rng.next() < 0.7) {
    res.trades++;
    note = `trade ${pick.cards.join(',')}`;
    const n = W.tradeCards(run, pick.cards);
    if (!n) viol(`tradeCards refused a legal set ${pick.cards.join(',')}`);
    else events = [{ kind: 'trade', power: 0, cards: [], n }];
  } else {
    // the generic dispatcher (its events are checked only while the diary is under its cap: NOTE FOR STRAT)
    if (pick.type === 'trade') res.trades++;
    const a = withAmount(pick, rng);
    note = JSON.stringify(a);
    const full = run.log.length >= 200;
    events = W.act(run, a);
    if (full && a.type !== 'endTurn' && a.type !== 'endPhase' && a.type !== 'defend') events = [{ kind: 'battle', power: 0, from: '', to: '', won: false, attLoss: 0, defLoss: 0 }]; // (skip the ledger)
  }
  // diplomacy now and then (outside the dispatcher: offers and answers)
  if (run.status === 'active' && run.current === 0 && rng.next() < 0.01) {
    const rivals = run.powers.filter((p) => p.id !== 0 && p.alive);
    if (rivals.length) { const r = W.offerCeasefire(run, rivals[Math.floor(rng.next() * rivals.length)].id); if (r.accepted) res.ceasefires++; }
  }
  for (const o of [...(run.offers ?? [])]) if (rng.next() < 0.5) W.answerOffer(run, o.power, rng.next() < 0.5);
  return { events, note };
}


/** The random policy: mostly purposeful (place, attack), sometimes ending a phase early, so runs both progress and stall. */
function choose(acts: Act[], rng: Rng, run: WorldRun): Act {
  const of = (t: string) => acts.filter((a) => a.type === t);
  const one = <T>(l: T[]) => l[Math.floor(rng.next() * l.length)];
  const forced = acts.filter((a) => a.type === 'trade' || a.type === 'defend');
  if (forced.length && (rng.next() < 0.7 || acts.length === forced.length)) return one(forced);
  const atk = of('attack'), place = of('place'), fort = of('fortify'), mv = of('move');
  const end = [...of('endPhase'), ...of('endTurn')];
  if (place.length && rng.next() < 0.95) return one(place);
  if (mv.length && rng.next() < 0.15) return one(mv);
  if (atk.length && rng.next() < (run.turn < 40 ? 0.85 : 0.93)) {
    // favour attacks the attacker is likely to win, like a player would (but keep some silly ones)
    const strong = atk.filter((a) => { const f = run.territories.find((t) => t.id === (a as { from: string }).from)!, to = run.territories.find((t) => t.id === (a as { to: string }).to)!; return f.troops > to.troops; });
    return one(strong.length && rng.next() < 0.8 ? strong : atk);
  }
  if (fort.length && rng.next() < 0.4) return one(fort);
  if (end.length) return one(end);
  return one(acts);
}

/** Fill in a random amount for actions that take one (place / fortify / move). */
function withAmount(a: Act, rng: Rng): Act {
  const r = a as Record<string, unknown>;
  if ((a.type === 'place' || a.type === 'fortify') && typeof r.max === 'number') return { ...a, n: 1 + Math.floor(rng.next() * (r.max as number)) } as Act;
  if (a.type === 'move' && typeof r.n !== 'number') return a;
  return a;
}

/** Every homeland a run can start from (GEO's WORLD_HOMELANDS once it lands, else the strategic layer's own list). */
export function worldHomelandIds(W: Api): string[] {
  const w = W as unknown as Record<string, unknown>;
  const at = (w.atlas as (() => { homelands?: { id: string }[] }) | undefined)?.();
  if (at?.homelands?.length) return at.homelands.map((h) => h.id);
  for (const k of ['worldHomelands', 'homelands', 'homelandIds']) {
    const f = w[k];
    if (typeof f === 'function') { const l = (f as () => unknown[])(); if (Array.isArray(l) && l.length) return l.map((h) => (typeof h === 'string' ? h : (h as { id: string }).id)); }
  }
  throw new Error('no homeland list found in src/conquest/world/run (worldHomelands / homelands)');
}

// ------------------------------------------------------------------------------------------------ main
if (process.argv[1]?.endsWith('qa-fuzz.ts')) {
  const { runPool } = await import('./qa-pool');
  const fs = await import('node:fs');
  const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const W = await api();
  const { WORLD_DIFFICULTIES } = await import('../../src/conquest/world/state');
  const homes = arg('homes', 'all') === 'all' ? worldHomelandIds(W) : arg('homes', '').split(',');
  const sizes = arg('sizes', 'world,blitz').split(',') as FuzzJob['size'][];
  const diffs = arg('diffs', 'all') === 'all' ? WORLD_DIFFICULTIES : arg('diffs', '').split(',');
  const runs = +arg('runs', '2000'), seed0 = +arg('seed0', '1'), fight = +arg('fight', '0.08');
  const out = arg('out', `${QA_OUT}fuzz-${seed0}`);
  fs.mkdirSync(out, { recursive: true });
  const jobs: FuzzJob[] = [];
  for (let k = 0; jobs.length < runs; k++) for (const home of homes) for (const size of sizes) for (const difficulty of diffs) {
    if (jobs.length >= runs) break;
    const i = jobs.length;
    jobs.push({ home, size, difficulty, seed: seed0 + i * 7919, policy: seed0 + i, fight, skill: [0, 0.4, 0.8, 0.97][Math.floor(i / homes.length) % 4] });
  }
  console.log(`${jobs.length} runs: ${homes.length} homelands x ${sizes.join('/')} x ${diffs.join('/')}, fight ${fight}, workers ${process.env.WORKERS ?? 6}`);
  const t0 = Date.now();
  let bad = 0;
  const outs = await runPool<FuzzJob, FuzzResult>('./qa-fuzz.ts', 'fuzzOne', jobs, {
    progress: (d, n, o, j) => {
      const r = o.ok ? o.value : null;
      if (!r || r.error || r.softlock || r.violations.length) { bad++; console.log(`BAD ${j.home} ${j.size} ${j.difficulty} seed ${j.seed} policy ${j.policy}: ${r ? r.error ?? r.softlock ?? r.violations[0] : (o as { error: string }).error.split('\n')[0]}`); }
      if (d % 100 === 0 || d === n) console.log(`${d}/${n} done, ${bad} bad, ${Math.round((Date.now() - t0) / 1000)} s`);
    },
  });
  const rs = outs.map((o, i) => (o.ok ? o.value : { ...jobs[i], status: 'error', error: o.error } as FuzzResult));
  fs.writeFileSync(`${out}/fuzz.json`, JSON.stringify(rs));
  const pct = (a: number, b: number) => (b ? `${(100 * a / b).toFixed(1)}%` : '-');
  const lines = [`# World fuzz, seed0 ${seed0}: ${rs.length} runs (${Math.round((Date.now() - t0) / 1000)} s)`, ''];
  const clean = rs.filter((r) => !r.error && !r.softlock && !r.violations?.length);
  lines.push(`clean ${clean.length}/${rs.length}; errors ${rs.filter((r) => r.error).length}; softlocks ${rs.filter((r) => r.softlock).length}; invariant violations ${rs.filter((r) => r.violations?.length).length}`);
  lines.push(`ended won ${rs.filter((r) => r.status === 'won').length}, lost ${rs.filter((r) => r.status === 'lost').length}, still active ${rs.filter((r) => r.status === 'active').length}`);
  const endings = new Map<string, number>();
  for (const r of rs) endings.set(`${r.status}:${r.ending}`, (endings.get(`${r.status}:${r.ending}`) ?? 0) + 1);
  lines.push(`endings: ${[...endings].map(([k, n]) => `${k} ${n}`).join(', ')}`);
  lines.push('', '| size | difficulty | runs | won | lost | turns median / max | battles | dice | blitz | ms median / max |', '|---|---|---|---|---|---|---|---|---|---|');
  const med = (l: number[]) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
  for (const size of sizes) for (const d of diffs) {
    const g = rs.filter((r) => r.size === size && r.difficulty === d);
    if (!g.length) continue;
    lines.push(`| ${size} | ${d} | ${g.length} | ${pct(g.filter((r) => r.status === 'won').length, g.length)} | ${pct(g.filter((r) => r.status === 'lost').length, g.length)} | ${med(g.map((r) => r.turns))} / ${Math.max(...g.map((r) => r.turns))} | ${g.reduce((s, r) => s + (r.battles ?? 0), 0)} | ${g.reduce((s, r) => s + (r.dice ?? 0), 0)} | ${g.reduce((s, r) => s + (r.blitz ?? 0), 0)} | ${med(g.map((r) => r.ms))} / ${Math.max(...g.map((r) => r.ms))} |`);
  }
  lines.push('', '| skill | runs | won | lost | turns median / max |', '|---|---|---|---|---|');
  for (const sk of [...new Set(rs.map((r) => r.skill ?? 0))].sort()) { const g = rs.filter((r) => (r.skill ?? 0) === sk); lines.push(`| ${sk} | ${g.length} | ${pct(g.filter((r) => r.status === 'won').length, g.length)} | ${pct(g.filter((r) => r.status === 'lost').length, g.length)} | ${med(g.map((r) => r.turns))} / ${Math.max(...g.map((r) => r.turns))} |`); }
  lines.push('', '## Problems (first 40)');
  for (const r of rs.filter((r) => r.error || r.softlock || r.violations?.length).slice(0, 40)) lines.push(`- ${r.home} ${r.size} ${r.difficulty} seed ${r.seed} policy ${r.policy}: ${r.error ?? r.softlock ?? ''} ${(r.violations ?? []).slice(0, 3).join(' ; ')}`);
  const homesSeen = new Set(rs.map((r) => r.home));
  lines.push('', `homelands covered: ${homesSeen.size}/${homes.length}`);
  fs.writeFileSync(`${out}/fuzz.md`, lines.join('\n') + '\n');
  console.log(lines.slice(0, 20).join('\n'));
}
