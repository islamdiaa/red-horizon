/**
 * Skirmish setup UI for the variety systems: the "Rules" tab of the skirmish panel (rules, doctrine slot,
 * game mode, build-up time, battlefield events, dynamic difficulty, mutators), the mutator picker, the Quick Battle
 * roll and its loading-screen card. The controls (seg / toggle / field) come from menu.ts so everything matches.
 */
import type { Faction } from '../data/rules';
import type { GameSetup } from '../game';
import { picto } from '../meta';
import { loadProfile } from '../meta/profile';
import { callSign, ensureRoster, loadRivals, rivalDifficulty, saveRivals } from '../meta/rivals';
import { MUTATORS, MUTATOR_BY_ID, mutatorEligible, normaliseMutators, surpriseMutators, toggleMutator, type MutatorContext } from '../modes/mutators';
import { quickSkill, rollQuickBattle, type QuickInfo } from '../modes/quickbattle';
import { difficultyIndex } from '../modes/difficulty';
import { PERSONALITIES } from '../sim/ai-personality';
import { el as h, esc } from './dom';
import { ICONS } from './icons';
import { resolveRivalOpponent } from './rivals';
import tVar from '../i18n/en/variety';
import tCommon from '../i18n/en/common';
import { trSource } from '../i18n/core';
import { mutatorDesc, mutatorName, personalityName } from '../i18n/names';

/** The skirmish preferences this module reads and writes (a slice of menu.ts SkirmishPrefs). */
export interface RulesPrefs {
  rules?: 'classic' | 'commander';
  mutators?: string[];
  events?: boolean;
  /** The player's explicit choice; undefined = the default (on when every AI is Recruit or Easy, modes/difficulty.ts). */
  dynamicDifficulty?: boolean;
  /** the player's doctrine (null = none / AI picks for AIs). */
  doctrine?: string | null;
}

type Opt<T> = [T, string, string?];
export interface Controls {
  seg<T extends string | number | boolean>(options: Opt<T>[], value: T, onChange: (v: T) => void, cls?: string): HTMLElement;
  toggle(value: boolean, onChange: (v: boolean) => void): HTMLButtonElement;
  field(label: string, icon: string, control: HTMLElement, cls?: string): HTMLElement;
  play(k: 'click' | 'tab' | 'error'): void;
}

/**
 * Doctrine picker slot: ui/doctrine-picker.ts registers a component that renders into the host. Without one the slot
 * shows a note. `onChange` stores the pick in the skirmish prefs (deployed as GameSetup.doctrines[0]).
 */
export type DoctrineSlot = (host: HTMLElement, ctx: { faction: Faction; value: string | null; onChange(id: string | null): void; enabled: boolean }) => void;
let doctrineSlot: DoctrineSlot | null = null;
export function registerDoctrineSlot(fn: DoctrineSlot | null) {
  doctrineSlot = fn;
}

const CSS = `
.vr-tabs { display: flex; gap: .35rem; align-items: stretch; }
.vr-tab { flex: 1; display: flex; align-items: center; gap: .5rem; height: 2.1rem; padding: 0 .7rem; border-radius: .5rem; border: 1px solid var(--line); background: rgba(0,0,0,.25);
  color: var(--muted); font: 700 .74rem var(--font); letter-spacing: .2em; text-transform: uppercase; cursor: pointer; transition: all .2s var(--ease); white-space: nowrap; min-width: 0; }
.vr-tab svg { font-size: .95rem; flex-shrink: 0; }
.vr-tab em { margin-left: auto; font-style: normal; font-size: .68rem; letter-spacing: .08em; color: var(--text-2); text-transform: none; overflow: hidden; text-overflow: ellipsis; }
.vr-tab:hover { color: var(--text); border-color: var(--line-2); }
.vr-tab.on { color: #fff; border-color: rgba(var(--accent-rgb), .7); background: linear-gradient(180deg, rgba(var(--accent-rgb), .28), rgba(var(--accent-rgb), .08)); box-shadow: 0 0 .9rem rgba(var(--accent-rgb), .25); }
.vr-tab.on em { color: var(--accent-hi); }
.mp-grid.vr-hidden { display: none; }
.vr-tabbed .mp-col > .sec-title { display: none; }
.vr-rules .tp.disabled { opacity: .4; pointer-events: none; }
.vr-mut { display: flex; flex-direction: column; gap: .35rem; padding: .45rem .5rem .5rem; border-radius: .55rem; background: rgba(0,0,0,.28); border: 1px solid var(--line); min-height: 0; }
.vr-mut-head { display: flex; align-items: center; gap: .45rem; font: 700 .7rem var(--font); letter-spacing: .2em; text-transform: uppercase; color: var(--muted); }
.vr-mut-head svg { color: var(--accent); font-size: .95rem; }
.vr-mut-head b { margin-left: auto; color: var(--text-2); letter-spacing: .08em; }
.vr-chips { display: flex; flex-wrap: wrap; gap: .3rem; max-height: 4.5rem; overflow: hidden; }
.vr-chip { display: inline-flex; align-items: center; gap: .3rem; height: 1.55rem; padding: 0 .45rem; border-radius: .4rem; border: 1px solid rgba(var(--accent-rgb), .45); background: rgba(var(--accent-rgb), .12);
  color: var(--text); font: 600 .72rem var(--font); letter-spacing: .04em; cursor: pointer; }
.vr-chip svg { font-size: .85rem; color: var(--accent); }
.vr-chip:hover { border-color: rgba(var(--danger-rgb), .7); background: rgba(var(--danger-rgb), .14); }
.vr-none { font-size: .76rem; color: var(--dim); padding: .15rem 0; }
.vr-mut-btns { display: grid; grid-template-columns: 1fr 1fr; gap: .35rem; }
.vr-btn { display: inline-flex; align-items: center; justify-content: center; gap: .4rem; height: 1.95rem; border-radius: .45rem; border: 1px solid var(--line-2); background: rgba(255,255,255,.04);
  color: var(--text-2); font: 700 .72rem var(--font); letter-spacing: .14em; text-transform: uppercase; cursor: pointer; transition: all .2s var(--ease); }
.vr-btn:hover { color: #fff; border-color: rgba(var(--accent-rgb), .7); background: rgba(var(--accent-rgb), .16); }
.vr-btn svg { font-size: .95rem; }
.vr-doctrine { min-height: 2.55rem; display: flex; align-items: stretch; }
.vr-doctrine > .vr-note { flex: 1; display: flex; align-items: center; gap: .5rem; padding: 0 .65rem; border-radius: .55rem; background: rgba(0,0,0,.28); border: 1px dashed var(--line-2); font-size: .76rem; color: var(--muted); }
.vr-off { opacity: .4; filter: saturate(.3); pointer-events: none; }
/* mutator picker */
.vr-picker { position: absolute; inset: 0; z-index: 6; display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(2,5,9,.55), rgba(0,0,0,.85));
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: fadeIn .25s var(--ease) both; }
.vr-picker.leaving { animation: rhFadeOut .25s var(--ease) both; pointer-events: none; }
.vr-ppanel { position: relative; width: min(66rem, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); display: flex; flex-direction: column; gap: .7rem; padding: 1.1rem 1.2rem; }
.vr-pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr)); gap: .45rem; overflow-y: auto; min-height: 0; padding: .15rem; scrollbar-width: thin; }
.vr-card { position: relative; display: grid; grid-template-columns: 2.1rem 1fr; gap: .1rem .6rem; align-items: start; text-align: left; padding: .5rem .6rem; border-radius: .6rem; border: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(255,255,255,.035), rgba(0,0,0,.2)); color: var(--text); cursor: pointer; transition: all .18s var(--ease); font-family: var(--font); }
.vr-card .vr-ic { grid-row: span 2; width: 2.1rem; height: 2.1rem; border-radius: .5rem; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; color: var(--muted); background: rgba(0,0,0,.3); border: 1px solid var(--line); }
.vr-card b { font-size: .86rem; letter-spacing: .08em; text-transform: uppercase; }
.vr-card p { margin: 0; font-size: .74rem; line-height: 1.3; color: var(--muted); }
.vr-card i { position: absolute; right: .45rem; top: .4rem; font-style: normal; font-size: .6rem; letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }
.vr-card:hover { border-color: var(--line-2); transform: translateY(-1px); }
.vr-card.on { border-color: rgba(var(--accent-rgb), .8); background: linear-gradient(180deg, rgba(var(--accent-rgb), .22), rgba(var(--accent-rgb), .06)); box-shadow: 0 0 1rem rgba(var(--accent-rgb), .22); }
.vr-card.on .vr-ic { color: #fff; border-color: rgba(var(--accent-rgb), .8); background: rgba(var(--accent-rgb), .35); }
.vr-card.on p { color: var(--text-2); }
.vr-card:disabled { opacity: .35; cursor: not-allowed; transform: none; }
.vr-pfoot { display: flex; gap: .5rem; align-items: center; }
.vr-pfoot small { color: var(--muted); font-size: .76rem; margin-right: auto; }
.vr-pfoot .vr-btn { padding: 0 .9rem; }
.vr-pfoot .vr-btn.primary { color: #fff; border-color: rgba(var(--accent-rgb), .8); background: rgba(var(--accent-rgb), .3); }
/* quick battle loading card */
.qb-card { position: absolute; left: 50%; top: 12%; transform: translateX(-50%); width: min(30rem, 88vw); padding: 1rem 1.2rem 1.1rem; border-radius: .9rem; z-index: 2;
  background: linear-gradient(180deg, rgba(20,28,39,.92), rgba(8,12,18,.94)); border: 1px solid rgba(var(--accent-rgb), .45); box-shadow: 0 0 2.5rem rgba(var(--accent-rgb), .18), 0 1rem 3rem rgba(0,0,0,.6);
  font-family: var(--font); color: var(--text); text-align: left; animation: qbIn .5s var(--spring) both; }
@keyframes qbIn { from { opacity: 0; transform: translate(-50%, .8rem) scale(.97); } }
.qb-card small { display: block; font-size: .64rem; font-weight: 700; letter-spacing: .34em; text-transform: uppercase; color: var(--accent); }
.qb-card h3 { margin: .1rem 0 .7rem; font-size: 1.35rem; letter-spacing: .16em; text-transform: uppercase; }
.qb-row { display: grid; grid-template-columns: 7rem 1fr; gap: .6rem; padding: .32rem 0; border-top: 1px solid var(--line); font-size: .86rem; animation: qbRow .4s var(--ease) both; }
.qb-row span { color: var(--muted); font-size: .66rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; align-self: center; }
.qb-row b { color: #fff; font-weight: 600; letter-spacing: .04em; }
@keyframes qbRow { from { opacity: 0; transform: translateX(-.5rem); } }
/* compact skirmish panel (laptops: 1366 x 768) */
.mm-panel .deploy { position: sticky; bottom: 0; z-index: 3; }
@media (max-height: 880px) {
  .mm-panel { gap: .6rem; padding-top: 1rem; padding-bottom: .9rem; }
  .mm-panel .faction-card { height: 5.9rem; padding: .55rem .8rem; }
  .mm-panel .fc-traits { display: none; }
  .mm-panel .map-row { padding-top: .35rem; padding-bottom: .35rem; }
  .mm-panel .field { gap: .2rem; }
  .mm-panel .mp-grid { row-gap: .5rem; }
  .mm-panel .mp-col { gap: .45rem; }
}
@media (max-height: 880px) {
  .mm-left .mm-tag { margin-bottom: 1rem; font-size: .88rem; }
  .mm-nav.dense { gap: .22rem; }
  .mm-nav.dense .mm-nav-btn { height: 2.2rem; }
}
@media (max-height: 800px) {
  .mm-left .mm-tag { display: none; }
  .mm-left .game-title { font-size: 4.6rem; }
}
@media (max-height: 700px) {
  .mm-panel .faction-card { height: 4.4rem; }
  .mm-panel .fc-desc { display: none; }
}
@media (prefers-reduced-motion: reduce) { .qb-card, .qb-row { animation: none; } }
body.reduce-motion .qb-card, body.reduce-motion .qb-row { animation: none; }
`;

let cssDone = false;
export function ensureVarietyCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'variety-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Short label of the rules for the tab ("Commander · 2 mutators"). `dynDefault`: dynamic difficulty's default. */
export function rulesSummary(p: RulesPrefs, dynDefault = false): string {
  const n = normaliseMutators(p.mutators).length;
  const parts = [tCommon(p.rules === 'classic' ? 'rules.classic' : 'rules.commander')];
  if (n) parts.push(tVar('summary.mutators', { n }));
  if (p.dynamicDifficulty ?? dynDefault) parts.push(tVar('summary.dynamic'));
  return parts.join(' · ');
}

/**
 * Wire the "Battlefield | Rules" tabs into the skirmish panel. `grid` is the existing two-column battlefield grid;
 * `mode` and `buildup` are menu.ts's King of the Hill and build-up fields (moved into the Rules tab).
 */
export function rulesTabs(prefs: RulesPrefs, ctl: Controls, ctx: {
  grid: HTMLElement;
  mode: HTMLElement;
  buildup: HTMLElement;
  faction(): Faction;
  mutatorContext(): MutatorContext;
  /** Host for overlays (the menu screen). */
  host(): HTMLElement | null;
  setEsc(fn: (() => void) | null): void;
  /** Dynamic difficulty's default for the current opponents (used until the player flips the toggle). */
  dynamicDefault?(): boolean;
}): { tabs: HTMLElement; rules: HTMLElement; refresh(): void; syncDynamic(): void } {
  ensureVarietyCss();
  prefs.rules ??= 'commander';
  prefs.events ??= true;
  prefs.mutators = normaliseMutators(prefs.mutators);
  const tabs = h('div', 'vr-tabs');
  const tBf = h('button', 'vr-tab on', `${ICONS.map}<span>${tVar.html('tab.battlefield')}</span>`);
  const tRules = h('button', 'vr-tab', `${picto('chevrons', 'ic')}<span>${tVar.html('tab.rules')}</span><em></em>`);
  tabs.append(tBf, tRules);
  const rules = h('div', 'mp-grid vr-rules vr-hidden');
  ctx.grid.classList.add('vr-tabbed');
  const show = (r: boolean) => {
    tBf.classList.toggle('on', !r);
    tRules.classList.toggle('on', r);
    ctx.grid.classList.toggle('vr-hidden', r);
    rules.classList.toggle('vr-hidden', !r);
    ctl.play('tab');
  };
  tBf.onclick = () => show(false);
  tRules.onclick = () => show(true);

  const left = h('div', 'mp-col');
  const right = h('div', 'mp-col');
  rules.append(left, right);
  // rules
  const commanderOnly: HTMLElement[] = [];
  const refresh = () => {
    const cmd = prefs.rules !== 'classic';
    for (const e of commanderOnly) e.classList.toggle('vr-off', !cmd);
    syncDynamic();
    renderDoctrine();
    renderMutators();
  };
  const rulesField = ctl.field(tVar.html('rules.field'), picto('chevrons', 'ic'), ctl.seg<'commander' | 'classic'>([['commander', esc(tCommon('rules.commander')), picto('chevrons', 'ic')], ['classic', esc(tCommon('rules.classic')), ICONS.target]], prefs.rules, (v) => { prefs.rules = v; refresh(); }, 'with-ic'));
  rulesField.title = tVar('rules.tip');
  left.appendChild(rulesField);
  // doctrine picker slot
  const docHost = h('div', 'vr-doctrine');
  const docField = ctl.field(tVar.html('rules.doctrine'), ICONS.flag, docHost);
  commanderOnly.push(docField);
  left.appendChild(docField);
  const renderDoctrine = () => {
    docHost.innerHTML = '';
    if (doctrineSlot) {
      doctrineSlot(docHost, { faction: ctx.faction(), value: prefs.doctrine ?? null, onChange: (id) => { prefs.doctrine = id; }, enabled: prefs.rules !== 'classic' });
    } else {
      docHost.appendChild(h('div', 'vr-note', `${ICONS.info}<span>${tVar.html(prefs.rules === 'classic' ? 'rules.commanderOnly' : 'rules.doctrinesArrive')}</span>`));
    }
  };
  left.append(ctx.mode, ctx.buildup);
  // toggles
  const toggles = h('div', 'toggle-pair');
  const tp = (icon: string, label: string, tip: string, v: boolean, fn: (v: boolean) => void): HTMLElement => {
    const t = h('label', 'tp', `${icon}<span>${label}</span>`);
    t.title = tip;
    t.appendChild(ctl.toggle(v, fn));
    toggles.appendChild(t);
    return t;
  };
  const evT = tp(picto('flag', 'ic'), tVar.html('rules.events'), tVar('rules.eventsTip'), prefs.events !== false, (v) => { prefs.events = v; refresh(); });
  commanderOnly.push(evT);
  // dynamic difficulty: follows the opponents' levels until the player chooses (then the choice is kept)
  const dynDefault = () => !!ctx.dynamicDefault?.();
  const dynOn = () => prefs.dynamicDifficulty ?? dynDefault();
  let dynShown = dynOn();
  const onDyn = (v: boolean) => { prefs.dynamicDifficulty = v; dynShown = v; refresh(); };
  const dynT = tp(picto('chart', 'ic'), tVar.html('rules.dynamic'), tVar('rules.dynamicTip'), dynShown, onDyn);
  function syncDynamic() {
    (tRules.querySelector('em') as HTMLElement).textContent = rulesSummary(prefs, dynDefault());
    if (dynOn() === dynShown) return;
    dynShown = dynOn();
    dynT.querySelector('.toggle')?.replaceWith(ctl.toggle(dynShown, onDyn));
  }
  right.appendChild(toggles);
  // mutators
  const mut = h('div', 'vr-mut');
  right.appendChild(mut);
  const renderMutators = () => {
    const ids = normaliseMutators(prefs.mutators);
    prefs.mutators = ids;
    mut.innerHTML = `<div class="vr-mut-head">${picto('gear', 'ic')}<span>${tVar.html('mutators.title')}</span><b>${ids.length ? tVar.html('mutators.active', { n: ids.length }) : tVar.html('mutators.off')}</b></div>`;
    const chips = h('div', 'vr-chips');
    if (!ids.length) chips.appendChild(h('div', 'vr-none', tVar.html('mutators.none', { n: MUTATORS.length })));
    for (const id of ids) {
      const m = MUTATOR_BY_ID[id];
      const c = h('button', 'vr-chip', `${picto(m.icon, 'ic')}<span>${esc(mutatorName(m))}</span>`);
      c.title = tVar('mutators.chipTip', { desc: mutatorDesc(m) });
      c.onclick = () => { prefs.mutators = toggleMutator(ids, id); ctl.play('click'); refresh(); };
      chips.appendChild(c);
    }
    mut.appendChild(chips);
    const btns = h('div', 'vr-mut-btns');
    const pick = h('button', 'vr-btn', `${ICONS.plus}<span>${tVar.html('mutators.choose')}</span>`);
    pick.onclick = () => openMutatorPicker(prefs, ctl, ctx, refresh);
    const dice = h('button', 'vr-btn', `${ICONS.dice}<span>${tVar.html('mutators.surprise')}</span>`);
    dice.title = tVar('mutators.surpriseTip');
    dice.onclick = () => { prefs.mutators = surpriseMutators(Math.floor(Math.random() * 1e9), ctx.mutatorContext()); ctl.play('click'); refresh(); };
    btns.append(pick, dice);
    mut.appendChild(btns);
  };
  refresh();
  return { tabs, rules, refresh, syncDynamic };
}

/** The mutator picker overlay: every mutator as a card, toggled on click; "Surprise me", "Clear", "Done". */
export function openMutatorPicker(prefs: RulesPrefs, ctl: Controls, ctx: { mutatorContext(): MutatorContext; host(): HTMLElement | null; setEsc(fn: (() => void) | null): void }, done: () => void) {
  const host = ctx.host();
  if (!host) return;
  ensureVarietyCss();
  const ov = h('div', 'vr-picker');
  const pnl = h('div', 'menu-panel panel vr-ppanel');
  pnl.appendChild(h('div', 'mp-head', `<span class="mp-ic">${picto('gear', 'ic')}</span><div><small>${tVar.html('mutators.kicker')}</small><h2>${tVar.html('mutators.title')}</h2></div>`));
  const grid = h('div', 'vr-pgrid');
  const close = () => {
    ov.classList.add('leaving');
    setTimeout(() => ov.remove(), 260);
    ctx.setEsc(null);
    done();
  };
  const render = () => {
    grid.innerHTML = '';
    const c = ctx.mutatorContext();
    const on = normaliseMutators(prefs.mutators);
    for (const m of MUTATORS) {
      const ok = mutatorEligible(m, c);
      const b = h('button', 'vr-card' + (on.includes(m.id) ? ' on' : ''), `<span class="vr-ic">${picto(m.icon, 'ic')}</span><b>${esc(mutatorName(m))}</b><p>${esc(mutatorDesc(m))}</p><i>${m.daily ? tVar.html('mutators.daily') : esc(tCommon('new'))}</i>`) as HTMLButtonElement;
      if (!ok) {
        b.disabled = true;
        b.title = tVar(m.id === 'blizzard' ? 'mutators.onlyWinter' : m.id === 'sandstorm' ? 'mutators.onlyDesert' : m.id === 'storm-front' ? 'mutators.onlyTemperate' : m.id === 'tesla-only' ? 'mutators.onlySoviet' : m.id === 'pillbox-line' ? 'mutators.onlyAllied' : 'mutators.unavailable');
      }
      b.onclick = () => { prefs.mutators = toggleMutator(on, m.id); ctl.play('click'); render(); };
      grid.appendChild(b);
    }
    count.textContent = on.length ? tVar('mutators.count', { n: on.length }) : tVar('mutators.hint');
  };
  const foot = h('div', 'vr-pfoot');
  const count = h('small', '');
  const dice = h('button', 'vr-btn', `${ICONS.dice}<span>${tVar.html('mutators.surprise')}</span>`);
  dice.onclick = () => { prefs.mutators = surpriseMutators(Math.floor(Math.random() * 1e9), ctx.mutatorContext()); ctl.play('click'); render(); };
  const clear = h('button', 'vr-btn', `${ICONS.close}<span>${tVar.html('mutators.clear')}</span>`);
  clear.onclick = () => { prefs.mutators = []; ctl.play('click'); render(); };
  const ok = h('button', 'vr-btn primary', `${ICONS.check}<span>${tVar.html('mutators.done')}</span>`);
  ok.onclick = close;
  foot.append(count, dice, clear, ok);
  pnl.append(grid, foot);
  ov.appendChild(pnl);
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
  host.appendChild(ov);
  ctx.setEsc(close);
  render();
}

// =====================================================================================================
// Quick Battle
// =====================================================================================================

/** Roll a Quick Battle for the commander: their side, their skill level, sometimes one of their rivals. */
export function quickBattleSetup(o: { faction: Faction; color: number; quality: GameSetup['quality']; doctrine?: string | null }, seed = Math.floor(Math.random() * 1e9)): GameSetup {
  let skill = quickSkill(null);
  try { skill = quickSkill(loadProfile().stats); } catch { /* storage unavailable */ }
  let rival: { name: string; opponent: GameSetup['opponents'][number] } | undefined;
  try {
    if ((seed % 100) < 35) {
      const store = loadRivals();
      ensureRoster(store);
      saveRivals(store);
      const near = store.rivals.filter((r) => r.status === 'active' && Math.abs(difficultyIndex(rivalDifficulty(r)) - difficultyIndex(skill)) <= 1);
      const r = near.length ? near[seed % near.length] : undefined;
      if (r) {
        // (never above the commander's level: rollQuickBattle caps it too)
        const opp = resolveRivalOpponent({ faction: 'random', difficulty: rivalDifficulty(r), rivalId: r.id }, skill);
        if (opp.rival) rival = { name: callSign(r), opponent: { ...opp, faction: opp.faction } };
      }
    }
  } catch { /* rivals unavailable: a personality instead */ }
  return rollQuickBattle(seed, { ...o, skill, rival });
}

/** The loading card's lines for a roll (modes/quickbattle.ts quickLines, in the active language). */
function quickCardLines(q: QuickInfo): { label: string; value: string }[] {
  const pers = !q.rival && q.personality ? PERSONALITIES[q.personality] : undefined;
  const opponent = pers ? personalityName(pers) : !q.rival && q.opponent === 'AI commander' ? tVar('quick.aiCommander') : q.opponent;
  const mutators = normaliseMutators(q.mutators).map((id) => mutatorName(MUTATOR_BY_ID[id]));
  return [
    { label: tVar('quick.battlefield'), value: [trSource(q.map), tVar(`quick.climate.${q.climate}`), tVar(`quick.time.${q.time}`)].join(' · ') },
    { label: tVar('quick.opponent'), value: [opponent, tCommon(`difficulty.${q.difficulty}`), ...(q.rival ? [tVar('quick.rival')] : [])].join(' · ') },
    { label: tVar('quick.rules'), value: tVar('quick.rulesValue') },
    { label: tVar('quick.mutators'), value: mutators.join(' · ') || tCommon('none') },
  ];
}

/** Show what a Quick Battle rolled on the loading screen (removed when the loading screen hides). */
export function showQuickCard(q: QuickInfo) {
  ensureVarietyCss();
  const root = document.getElementById('loading');
  if (!root) return;
  root.querySelector('.qb-card')?.remove();
  const card = h('div', 'qb-card', `<small>${tVar.html('quick.kicker')}</small><h3>${tVar.html('quick.title')}</h3>${quickCardLines(q).map((l, i) => `<div class="qb-row" style="animation-delay:${(0.15 + i * 0.12).toFixed(2)}s"><span>${esc(l.label)}</span><b>${esc(l.value)}</b></div>`).join('')}`);
  root.appendChild(card);
  const obs = new MutationObserver(() => {
    if (root.style.display === 'none') { card.remove(); obs.disconnect(); }
  });
  obs.observe(root, { attributes: true, attributeFilter: ['style'] });
}
