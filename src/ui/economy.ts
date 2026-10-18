/**
 * Commander economy in the HUD (src/sim/economy.ts): the economy readout and the structure controls in the
 * selection panel.
 *
 *  - `EconomyReadout`: a compact chip next to the credits (Modern: the resources group; Classic: under the power
 *    bar) with the tech tier, ore income per minute, ore left near your docks and the Ore Truck count; the tooltip
 *    has the details (power surplus, idle trucks, how many loads are left).
 *  - `EconSelection`: for one selected own structure, its upgrade buttons (module icon, price, time, progress ring,
 *    lock reason), the research lab's "Research tree" button and current project, a bunker's garrison and the ore
 *    left around a refinery / outpost.
 *
 * Mouse, touch (taps) and the gamepad (D-pad focus reaches `#selpanel button`) all use the same buttons. Text from
 * the rules goes through `esc`. No per-frame allocations: refreshed by the HUD at ~8 Hz from cached keys.
 */
import { BUILDINGS, GEM_VALUE, GOLD_VALUE } from '../data/rules';
import type { Building } from '../sim/entities';
import type { Player } from '../sim/player';
import type { Command } from '../sim/types';
import type { World } from '../sim/world';
import { TIER_NAMES, UPGRADES, RESEARCH, SYNERGY, harvestCapacity, oreValueMul, tierOf, upgradesFor, type UpgradeDef } from '../sim/economy-data';
import { taskSeconds, upgradeCost, upgradeIssue, type EconIssue } from '../sim/economy';
import { ICONS } from './icons';
import { el, esc, tipHtml, type Tooltip } from './dom';
import tEcon from '../i18n/en/economy';
import { currentLang, dt, fmtList, fmtMoney, fmtPct } from '../i18n/core';
import { researchName, typeName, upgradeBlurb, upgradeEffect, upgradeName } from '../i18n/names';

// =====================================================================================================
// Module icons (the upgrade previewed on its button)
// =====================================================================================================

const svg = (body: string) =>
  `<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** One pictogram per upgrade module: what gets bolted onto the structure. */
export const MODULE_ICONS: Record<string, string> = {
  cy_t2: svg('<path d="M4 21h16M6 21V9h5v12"/><path d="M8.5 9V4l9 2.5M8.5 4L17 13"/><path d="M17.5 6.5v6.5"/><path d="M15.5 13h4v3h-4z"/>'),
  cy_t3: svg('<path d="M4 21h16M8 21v-9h8v9"/><path d="M10 12V7h4v5"/><path d="M12 7V2.5"/><path d="M9.5 4.5a3.5 3.5 0 0 1 5 0"/><path d="M11 16h2"/>'),
  powr_turbine: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="1.6"/><path d="M12 10.4C11 7 12.5 5 14.5 4.6M13.4 12.8c3.2 1.3 4 3.6 3.3 5.4M10.6 12.8c-2.8 2-5.2 1.5-6.3 0"/>'),
  proc_processor: svg('<path d="M3 17h18"/><circle cx="6" cy="19" r="1.4"/><circle cx="12" cy="19" r="1.4"/><circle cx="18" cy="19" r="1.4"/><path d="M5 14l2.5-6h9l2.5 6z"/><path d="M12 8V3M9.5 5.5 12 3l2.5 2.5"/>'),
  barr_training: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/><path d="M19 5l-5.5 5.5"/>'),
  weap_assembly: svg('<circle cx="8" cy="9" r="3.5"/><circle cx="16.5" cy="13.5" r="2.5"/><path d="M8 4v1.5M8 12.5V14M3 9h1.5M11.5 9H13"/><path d="M3 20h18M5 20l1.5-2.5h11L19 20"/>'),
  weap_armor: svg('<path d="M4 7l8-4 8 4v6c0 4-3.6 7-8 8-4.4-1-8-4-8-8z"/><path d="M4 11h16M12 3v18"/>'),
  def_reinforced: svg('<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M6 10h12M6 14h12M10 10v4M14 6v4M14 14v4"/>'),
  dome_uplink: svg('<path d="M5 20h14"/><path d="M12 20v-5"/><path d="M5.5 12.5a7 7 0 0 0 9.9-9.9z"/><path d="M10.5 7.5l3-3"/><path d="M16 4a5 5 0 0 1 4 4M16 1.5a7.5 7.5 0 0 1 6.5 6.5"/>'),
};

/** Why an upgrade can't start (reasonText; 'tier' and 'prereq' name the tier / the missing structures). */
const ISSUE_TEXT: Partial<Record<EconIssue, Parameters<typeof tEcon>[0]>> = {
  after: 'reason.after',
  prereq: 'reason.missing',
  unique: 'reason.unique',
  busy: 'reason.busy',
  owned: 'reason.owned',
  inactive: 'reason.inactive',
};

const money = (n: number) => fmtMoney(Math.round(n));
/** A number with exactly `d` decimals in the active language ("12.5", "12,5", "20.0"). */
let fixedFmt: { lang: string; f: Intl.NumberFormat[] } | null = null;
function fixed(n: number, d: 0 | 1): string {
  const l = currentLang();
  if (!fixedFmt || fixedFmt.lang !== l) {
    try { fixedFmt = { lang: l, f: [0, 1].map((x) => new Intl.NumberFormat(l, { minimumFractionDigits: x, maximumFractionDigits: x })) }; } catch { return n.toFixed(d); }
  }
  return fixedFmt.f[d].format(n);
}
const kmoney = (n: number) => (n >= 10000 ? tEcon('kmoney', { n: fixed(n / 1000, n >= 100000 ? 0 : 1) }) : money(n));

/** A tech tier's name (sim/economy-data.ts TIER_NAMES, game data table techTier). */
export const tierName = (t: number): string => dt('techTier', String(t), 'name', TIER_NAMES[t] ?? '');
/** A translated .html() message with raw HTML put at its {slot} parameter (parameters are escaped otherwise). */
const SLOT = '\u0001';

/** Ore left (credits) within `r` cells of the player's docks, and how many full loads that is. */
export function oreNearDocks(world: World, p: Player, r = 12, only?: Building): { value: number; loads: number; cells: number } {
  const m = world.map;
  const docks: Building[] = [];
  if (only) docks.push(only);
  else for (const b of world.buildings) if (b.alive && b.owner === p && b.bt.dock && b.buildAnim >= 1) docks.push(b);
  let value = 0, cells = 0;
  if (!docks.length) return { value: 0, loads: 0, cells: 0 };
  const r2 = r * r;
  for (const i of m.oreFieldCells) {
    const o = m.ore[i];
    if (!o) continue;
    const x = i % m.w + 0.5, y = ((i / m.w) | 0) + 0.5;
    let near = false;
    for (const d of docks) if ((d.x - x) ** 2 + (d.y - y) ** 2 <= r2) { near = true; break; }
    if (!near) continue;
    cells++;
    value += o * (m.gems[i] ? GEM_VALUE : GOLD_VALUE);
  }
  const mul = p.econ ? oreValueMul(p, only ?? { upgrades: undefined }) : 1;
  const perLoad = harvestCapacity(p) * GOLD_VALUE;
  return { value: value * mul, loads: value / perLoad, cells };
}

// =====================================================================================================
// Economy readout
// =====================================================================================================

export class EconomyReadout {
  readonly el: HTMLElement;
  private tierEl: HTMLElement;
  private incEl: HTMLElement;
  private oreEl: HTMLElement;
  private harvEl: HTMLElement;
  /** (game seconds, ore harvested) samples, one per second, for the income per minute. */
  private samples: [number, number][] = [];
  private lastSample = -1;
  private oreT = 0;
  private ore = { value: 0, loads: 0, cells: 0 };
  private key = '';

  /** What was already announced (tier, research levels, upgrades installed) so only news pops a toast. */
  private seen = '';

  constructor(private world: World, private local: Player, onTier?: () => void, private toast?: (text: string) => void, private tooltip?: Tooltip) {
    injectCss();
    const e = el('div', 'econ-ro');
    e.innerHTML = `<button type="button" class="ero-tier"><small></small><b></b></button>
      <span class="ero-i ero-inc"><span class="ero-ic">${ICONS.coin}</span><b></b><small></small></span>
      <span class="ero-i ero-ore"><span class="ero-ic">${ICONS.ore}</span><b></b></span>
      <span class="ero-i ero-harv"><span class="ero-ic">${TRUCK}</span><b></b></span>`;
    this.el = e;
    this.tierEl = e.querySelector('.ero-tier b')!;
    this.incEl = e.querySelector('.ero-inc b')!;
    this.oreEl = e.querySelector('.ero-ore b')!;
    this.harvEl = e.querySelector('.ero-harv b')!;
    const tb = e.querySelector<HTMLButtonElement>('.ero-tier')!;
    tb.onclick = () => onTier?.();
  }

  /** Toasts for a new tier, finished research and installed upgrades (the sim only plays the announcer line). */
  private news(p: Player) {
    const e = p.econ;
    if (!e) return;
    let ups = 0;
    for (const b of this.world.buildings) if (b.alive && b.owner === p) ups += (b.upgrades?.length ?? 0) + ((b.hpBoost ?? 1) > 1 ? 1 : 0);
    let lv = 0;
    for (const id in e.levels) lv += e.levels[id];
    const key = `${e.tier}|${lv}|${ups}`;
    if (key === this.seen) return;
    const first = !this.seen;
    const [t0, l0, u0] = first ? [e.tier, lv, ups] : this.seen.split('|').map(Number);
    this.seen = key;
    if (first || !this.toast) { this.levels = { ...e.levels }; return; }
    if (e.tier > t0) this.toast(tEcon('news.tier', { n: e.tier, name: tierName(e.tier) }));
    if (lv > l0) for (const id in e.levels) if ((this.levels[id] ?? 0) < e.levels[id]) this.toast(tEcon('news.research', { name: RESEARCH[id] ? researchName(RESEARCH[id]) : id, level: e.levels[id] === 2 ? 'II' : 'I' }));
    if (ups > u0 && e.tier === t0) this.toast(tEcon('news.upgrade'));
    this.levels = { ...e.levels };
  }
  private levels: Record<string, number> = {};

  /** Income per minute over the last minute of game time (ore delivered). */
  incomePerMinute(): number {
    const s = this.samples;
    if (s.length < 2) return 0;
    const a = s[0], b = s[s.length - 1];
    const dt = b[0] - a[0];
    return dt > 0 ? ((b[1] - a[1]) * 60) / dt : 0;
  }

  update(dt: number) {
    const w = this.world, p = this.local;
    const t = w.time;
    if (Math.floor(t) !== this.lastSample) {
      this.lastSample = Math.floor(t);
      this.samples.push([t, p.stats.harvested]);
      while (this.samples.length > 2 && t - this.samples[0][0] > 60) this.samples.shift();
    }
    this.oreT -= dt;
    if (this.oreT <= 0) { this.oreT = 2; this.ore = oreNearDocks(w, p); }
    let harv = 0, idle = 0;
    for (const u of w.units) {
      if (!u.alive || u.owner !== p || !u.ut.harvester) continue;
      harv++;
      if (u.order.type !== 'harvest' || u.hstate === 'idle' || (u.hstate === 'seek' && u.waitTimer > 0.5)) idle++;
    }
    const tier = p.econ?.tier ?? 1;
    this.news(p);
    const inc = this.incomePerMinute();
    const key = `${tier}|${Math.round(inc / 10)}|${Math.round(this.ore.value / 100)}|${harv}|${idle}|${p.powerOut}|${p.powerUse}|${currentLang()}`;
    if (key === this.key) return;
    this.key = key;
    const tb = this.tierEl.parentElement!;
    tb.setAttribute('aria-label', tEcon('readout.tierAria'));
    tb.querySelector('small')!.textContent = tEcon('readout.tier');
    this.incEl.parentElement!.querySelector('small')!.textContent = tEcon('readout.perMin');
    this.tierEl.textContent = tEcon('tierShort', { n: tier });
    this.el.dataset.tier = String(tier);
    this.incEl.textContent = kmoney(inc);
    this.oreEl.textContent = kmoney(this.ore.value);
    this.oreEl.parentElement!.classList.toggle('low', this.ore.loads < 3 && harv > 0);
    this.harvEl.textContent = idle ? `${harv - idle}/${harv}` : String(harv);
    this.harvEl.parentElement!.classList.toggle('idle', idle > 0);
    const surplus = p.powerOut - p.powerUse;
    const bal = surplus >= 0 ? tEcon.html('tip.surplus', { n: surplus }) : `<span class="tt-bad">${tEcon.html('tip.short', { n: -surplus })}</span>`;
    const tip = tipHtml(esc(tEcon('tip.title')), `${tEcon.html('tip.tier', { n: tier, name: tierName(tier) })}${tier < 3 ? ` · ${tEcon.html('tip.tierUpgrade')}` : ''}<br>` +
      `${tEcon.html('tip.income', { money: money(inc) })}<br>` +
      `${tEcon.html('tip.ore', { money: money(this.ore.value), loads: Math.floor(this.ore.loads), cells: this.ore.cells })}${this.ore.loads < 3 && harv ? ` <span class="tt-bad">${tEcon.html('tip.runningOut')}</span>` : ''}<br>` +
      `${tEcon.html('tip.trucks', { n: harv })}${idle ? ` · <span class="tt-bad">${tEcon.html('tip.idle', { n: idle })}</span>` : ''}<br>` +
      tEcon.html('tip.power', { out: p.powerOut, use: p.powerUse, balance: SLOT }).replace(SLOT, bal), [[esc(tEcon('tip.click')), esc(tEcon('tip.clickResearch'))]]);
    this.el.dataset.tip = tip;
    this.tooltip?.refresh(this.el, tip); // (live while hovered)
  }
}

const TRUCK = svg('<path d="M2 16V8h11v8"/><path d="M13 11h4.5l3.5 3v2h-8"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/><path d="M4 8l2-3h5l2 3"/>');

// =====================================================================================================
// Selection panel: upgrades, research, garrison, ore
// =====================================================================================================

export interface EconSelHost {
  world: World;
  local: Player;
  issue(cmd: Command): void;
  sound(key: 'click' | 'error'): void;
  message(text: string, warn?: boolean): void;
  openResearch(lab: Building | null): void;
  /** The HUD tooltip, refreshed live while a button is hovered. */
  tip?: Tooltip;
}

/** Structures whose effect is always on: the line the selection panel shows for them. */
const PASSIVE: Record<string, 'passive.ore' | 'passive.logistics'> = { purf: 'passive.ore', smlt: 'passive.ore', lgst: 'passive.logistics' };

interface UpBtn { id: string; el: HTMLButtonElement; arc: SVGCircleElement; state: string }

/** The economy block of a single selected own structure (null when it has none). */
export class EconSelection {
  readonly el: HTMLElement;
  private btns: UpBtn[] = [];
  private info: HTMLElement;
  private key = '';

  static for(host: EconSelHost, b: Building): EconSelection | null {
    if (!host.world.econ || b.owner !== host.local) return null;
    const ups = upgradesFor(b.bt.id);
    if (!ups.length && b.bt.id !== 'rlab' && !b.bt.garrison && !b.bt.dock && !PASSIVE[b.bt.id]) return null;
    return new EconSelection(host, b, ups);
  }

  private constructor(private host: EconSelHost, private b: Building, ups: UpgradeDef[]) {
    injectCss();
    const box = el('div', 'econ-sel');
    this.el = box;
    if (ups.length) {
      const row = el('div', 'esel-ups');
      row.appendChild(el('span', 'esel-l', tEcon.html('sel.upgrades')));
      for (const u of ups) {
        const btn = el('button', 'esel-up', `<span class="esu-ic">${MODULE_ICONS[u.id] ?? ICONS.plus}</span>
          <svg class="esu-ring" viewBox="0 0 100 100"><circle class="arc" cx="50" cy="50" r="44" pathLength="100"/></svg>
          <span class="esu-cost"></span><span class="esu-st"></span>`);
        btn.type = 'button';
        btn.dataset.up = u.id;
        btn.setAttribute('aria-label', tEcon('sel.upgradeAria', { name: upgradeName(u) }));
        btn.onclick = () => this.click(u.id);
        btn.oncontextmenu = (e) => { e.preventDefault(); this.cancel(u.id); };
        row.appendChild(btn);
        this.btns.push({ id: u.id, el: btn, arc: btn.querySelector('.arc') as SVGCircleElement, state: '' });
      }
      box.appendChild(row);
    }
    if (b.bt.id === 'rlab') {
      const rb = el('button', 'esel-rs', `${ICONS.flag}<span>${tEcon.html('sel.researchTree')}</span>`);
      rb.type = 'button';
      rb.dataset.tip = tipHtml(tEcon.html('sel.researchTree'), tEcon.html('sel.researchTreeTip'));
      rb.onclick = () => { this.host.sound('click'); this.host.openResearch(this.b); };
      box.appendChild(rb);
    }
    this.info = el('div', 'esel-info');
    box.appendChild(this.info);
    this.refresh();
  }

  private click(id: string) {
    const { world, local } = this.host;
    const b = this.b;
    if (b.task?.kind === 'upgrade' && b.task.id === id) { this.cancel(id); return; }
    const issue = upgradeIssue(world, local, b, id);
    if (issue) {
      this.host.sound('error');
      if (issue !== 'owned') this.host.message(tEcon('sel.cannot', { name: upgradeName(UPGRADES[id]), reason: reasonText(local, id, issue) }), true);
      return;
    }
    this.host.sound('click');
    this.host.issue({ c: 'upgrade', player: local.id, building: b.id, upgrade: id });
  }

  private cancel(id: string) {
    const b = this.b;
    if (b.task?.kind !== 'upgrade' || b.task.id !== id) return;
    this.host.sound('click');
    this.host.issue({ c: 'upgrade', player: this.host.local.id, building: b.id, upgrade: id, cancel: true });
  }

  refresh() {
    const { world, local } = this.host;
    const b = this.b;
    for (const btn of this.btns) {
      const u = UPGRADES[btn.id];
      const t = b.task;
      const mine = t?.kind === 'upgrade' && t.id === btn.id;
      const issue = mine ? null : upgradeIssue(world, local, b, btn.id);
      const st = mine ? 'build' : issue === 'owned' ? 'done' : issue ? 'locked' : local.credits < upgradeCost(local, b.bt, btn.id) ? 'poor' : 'ready';
      const cost = upgradeCost(local, b.bt, btn.id);
      const pct = mine ? Math.floor(t!.progress * 100) : st === 'done' ? 100 : 0;
      const key = `${st}|${pct}|${cost}|${issue}`;
      if (key === btn.state) continue;
      btn.state = key;
      btn.el.dataset.state = st;
      btn.arc.style.strokeDashoffset = String(100 - pct);
      (btn.el.querySelector('.esu-cost') as HTMLElement).textContent = st === 'done' ? '' : st === 'build' ? fmtPct(pct / 100) : money(cost);
      const stEl = btn.el.querySelector('.esu-st') as HTMLElement;
      stEl.innerHTML = st === 'done' ? ICONS.check : st === 'locked' ? ICONS.lock : '';
      const secs = Math.ceil(taskSeconds(local, u.time));
      const syn = SYNERGY[local.cmd?.doctrine ?? ''] === btn.id;
      const status = st === 'done' ? `<span class="tt-ok">${tEcon.html('up.installed')}</span>`
        : st === 'build' ? tEcon.html('up.installing', { pct: fmtPct(pct / 100), money: money(t!.paid) })
        : st === 'locked' ? `<span class="tt-bad">${esc(reasonText(local, btn.id, issue!))}</span>`
        : st === 'poor' ? tEcon.html('up.poor', { need: SLOT }).replace(SLOT, `<span class="tt-bad">${tEcon.html('up.needMore', { money: money(cost - local.credits) })}</span>`) : tEcon.html('up.ready');
      const meta = `${money(cost)}${syn ? ` <span class="tt-ok">${tEcon.html('up.doctrineOff')}</span>` : ''} · ${tEcon.html('up.seconds', { s: secs })} · ${tEcon.html('up.tier', { n: u.tier })}${u.unique ? ` · ${tEcon.html('up.unique')}` : ''}`;
      const tip = tipHtml(esc(upgradeName(u)), `${esc(upgradeEffect(u))}<br><i>${esc(upgradeBlurb(u))}</i><br>${meta}<br>${status}`);
      btn.el.dataset.tip = tip;
      this.host.tip?.refresh(btn.el, tip);
    }
    const html = this.infoHtml();
    if (html !== this.key) { this.key = html; this.info.innerHTML = html; }
  }

  private infoHtml(): string {
    const b = this.b, p = this.host.local;
    let s = '';
    if (b.task?.kind === 'research') {
      const r = RESEARCH[b.task.id];
      s += xbar(ICONS.flag, tEcon.html('info.research'), b.task.progress, tEcon.html('info.researching', { name: researchName(r), level: b.task.level === 2 ? 'II' : 'I', pct: fmtPct(Math.floor(b.task.progress * 100) / 100) }));
    } else if (b.bt.id === 'rlab') {
      s += xbar(ICONS.flag, tEcon.html('info.research'), 0, tEcon.html('info.idle'), 'idle');
    }
    if (b.bt.garrison) {
      const n = b.garrison?.length ?? 0;
      let pips = '';
      for (let i = 0; i < b.bt.garrison; i++) pips += `<i class="${i < n ? 'on' : ''}"></i>`;
      s += `<div class="xbar pipsrow"><span class="xb-l">${ICONS.people}${tEcon.html('info.garrison')}</span><span class="pips">${pips}</span><span class="xb-v">${tEcon.html(n ? 'info.evacuate' : 'info.garrisonHint')}</span></div>`;
    }
    if (b.bt.dock) {
      const o = oreNearDocks(this.host.world, p, 10, b);
      s += xbar(ICONS.ore, tEcon.html('info.oreNearby'), Math.min(1, o.loads / 20), tEcon.html('info.ore', { money: money(o.value), loads: Math.floor(o.loads) }), o.loads < 3 ? 'hold' : 'ore');
    }
    if (PASSIVE[b.bt.id]) {
      const on = b.bt.id === 'lgst' || !p.lowPower;
      s += `<div class="xbar ${on ? 'ready' : 'hold'}"><span class="xb-l">${b.bt.id === 'lgst' ? ICONS.wrench : ICONS.coin}${tEcon.html(PASSIVE[b.bt.id])}</span><span class="xb-track"><i style="width:${on ? 100 : 0}%"></i></span><span class="xb-v">${tEcon.html(on ? 'info.active' : 'info.offline')}</span></div>`;
    }
    if (b.bt.id === 'fact' && p.econ) {
      s += `<div class="esel-tier">${[1, 2, 3].map((t) => `<span class="${t <= p.econ!.tier ? 'on' : ''}">${tEcon.html('tierShort', { n: t })}<small>${esc(tierName(t))}</small></span>`).join('<i></i>')}</div>`;
    }
    return s;
  }
}

function xbar(icon: string, label: string, frac: number, value: string, cls = ''): string {
  return `<div class="xbar ${cls}"><span class="xb-l">${icon}${label}</span><span class="xb-track"><i style="width:${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%"></i></span><span class="xb-v">${value}</span></div>`;
}

/** Player-facing reason an upgrade can't start. */
export function reasonText(p: Player, id: string, issue: EconIssue): string {
  const u = UPGRADES[id];
  if (issue === 'tier') return tEcon('reason.tier', { n: u.tier });
  if (issue === 'prereq' && u.prereq) {
    const miss = u.prereq.filter((r) => !r.split('|').some((a) => p.has(a))).map((r) => fmtList(r.split('|').map((a) => (BUILDINGS[a] ? typeName(BUILDINGS[a]) : a)).filter((n, i, arr) => arr.indexOf(n) === i), 'disjunction'));
    return tEcon('reason.prereq', { list: miss.join(', ') });
  }
  const k = ISSUE_TEXT[issue];
  return k ? tEcon(k) : tEcon('reason.unavailable');
}

/** "Requires T2" label for a build card locked only by its tier (null = not tier-locked). */
export function tierLock(p: Player, id: string): number | null {
  if (!p.econ) return null;
  const t = tierOf(id);
  return t > p.econ.tier ? t : null;
}

/** Count of own bunkers' occupants (army overview hooks may want it). */
export function garrisoned(world: World, p: Player): number {
  let n = 0;
  for (const b of world.buildings) if (b.alive && b.owner === p && b.garrison) n += b.garrison.length;
  return n;
}

// =====================================================================================================
// CSS
// =====================================================================================================

function injectCss() {
  if (document.getElementById('econ-style')) return;
  const st = document.createElement('style');
  st.id = 'econ-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const CSS = `
.econ-ro { display: flex; align-items: center; gap: 0.35rem; padding: 0.22rem 0.4rem; border-radius: 0.45rem; background: rgba(255, 255, 255, 0.035);
  border: 1px solid var(--line); font-family: var(--font); color: var(--text-2); white-space: nowrap; }
#sidebar .econ-ro { margin: 0.35rem 0 0; }
.ero-tier { all: unset; box-sizing: border-box; display: inline-flex; align-items: baseline; gap: 0.2rem; padding: 0.1rem 0.38rem; border-radius: 0.3rem; cursor: pointer;
  background: linear-gradient(180deg, rgba(var(--accent-rgb), 0.28), rgba(var(--accent-rgb), 0.08)); border: 1px solid rgba(var(--accent-rgb), 0.5); color: var(--accent-hi); }
.ero-tier:focus-visible, .ero-tier.gp-focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.ero-tier small { font-size: 0.5rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
.ero-tier b { font-family: var(--mono); font-weight: 400; font-size: 0.86rem; }
.econ-ro[data-tier="2"] .ero-tier { border-color: rgba(var(--gold-rgb), 0.55); color: #ffe7a0; background: linear-gradient(180deg, rgba(var(--gold-rgb), 0.24), rgba(var(--gold-rgb), 0.06)); }
.econ-ro[data-tier="3"] .ero-tier { border-color: rgba(255, 120, 90, 0.7); color: #ffc2b0; background: linear-gradient(180deg, rgba(255, 110, 80, 0.3), rgba(255, 110, 80, 0.08)); box-shadow: 0 0 0.6rem rgba(255, 110, 80, 0.35); }
.ero-i { display: inline-flex; align-items: center; gap: 0.18rem; font-size: 0.74rem; }
.ero-i b { font-family: var(--mono); font-weight: 400; color: var(--text); }
.ero-i small { font-size: 0.56rem; color: var(--muted); }
.ero-ic { display: flex; font-size: 0.82rem; color: var(--gold); }
.ero-harv .ero-ic { color: var(--accent); }
.ero-ore.low b { color: var(--warn); }
.ero-harv.idle b { color: #ff8a7a; }
body.hud-modern .rb-res .econ-ro { padding: 0.15rem 0.35rem; }

.econ-sel { display: flex; flex-direction: column; gap: 0.3rem; }
.econ-sel:empty { display: none; }
.esel-ups { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
.esel-l { font-size: 0.64rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-right: 0.15rem; }
.esel-up { all: unset; box-sizing: border-box; position: relative; width: 2.75rem; height: 2.75rem; border-radius: 0.45rem; cursor: pointer; display: grid; place-items: center;
  background: radial-gradient(circle at 50% 35%, rgba(var(--accent-rgb), 0.22), rgba(255, 255, 255, 0.03)); border: 1px solid rgba(var(--accent-rgb), 0.45); color: var(--accent-hi);
  transition: transform 0.15s var(--ease), border-color 0.2s, box-shadow 0.2s; }
.esel-up:hover, .esel-up.gp-focus { transform: translateY(-1px); border-color: var(--accent); box-shadow: 0 0 0.7rem rgba(var(--accent-rgb), 0.45); }
.esel-up:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.esel-up:active { transform: scale(0.95); }
.esu-ic { font-size: 1.25rem; display: flex; margin-top: -0.45rem; }
.esu-cost { position: absolute; left: 0; right: 0; bottom: 0.12rem; text-align: center; font-family: var(--mono); font-size: max(0.56rem, 8px); color: var(--gold); }
.esu-st { position: absolute; top: 0.08rem; right: 0.1rem; font-size: 0.7rem; display: flex; }
.esu-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); pointer-events: none; }
.esu-ring .arc { fill: none; stroke: var(--gold); stroke-width: 5; stroke-dasharray: 100; stroke-dashoffset: 100; transition: stroke-dashoffset 0.3s linear; opacity: 0; }
.esel-up[data-state="build"] .arc { opacity: 1; }
.esel-up[data-state="build"] { border-color: rgba(var(--gold-rgb), 0.7); animation: eselPulse 1.6s ease-in-out infinite; }
.esel-up[data-state="build"] .esu-cost { color: var(--text); }
.esel-up[data-state="done"] { color: var(--ok); border-color: rgba(var(--ok-rgb), 0.55); background: radial-gradient(circle at 50% 35%, rgba(var(--ok-rgb), 0.2), rgba(255, 255, 255, 0.02)); cursor: default; }
.esel-up[data-state="done"] .esu-ic { margin-top: 0; }
.esel-up[data-state="done"] .esu-st { color: var(--ok); }
.esel-up[data-state="locked"] { color: var(--dim); border-color: var(--line-2); background: rgba(255, 255, 255, 0.025); filter: saturate(0.3); }
.esel-up[data-state="locked"] .esu-cost { color: var(--dim); }
.esel-up[data-state="poor"] .esu-cost { color: #ff8a7a; }
@keyframes eselPulse { 50% { box-shadow: 0 0 0.75rem rgba(var(--gold-rgb), 0.45); } }
.esel-rs { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 0.35rem; align-self: flex-start; padding: 0.3rem 0.6rem; border-radius: 0.4rem; cursor: pointer;
  font-size: 0.74rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-hi); border: 1px solid rgba(var(--accent-rgb), 0.55);
  background: linear-gradient(180deg, rgba(var(--accent-rgb), 0.25), rgba(var(--accent-rgb), 0.07)); }
.esel-rs:hover, .esel-rs.gp-focus { box-shadow: 0 0 0.8rem rgba(var(--accent-rgb), 0.5); border-color: var(--accent); }
.esel-info { display: flex; flex-direction: column; gap: 0.3rem; }
.esel-info:empty { display: none; }
.esel-tier { display: flex; align-items: center; gap: 0.25rem; font-size: 0.7rem; color: var(--dim); }
.esel-tier span { display: inline-flex; flex-direction: column; align-items: center; padding: 0.1rem 0.4rem; border-radius: 0.3rem; border: 1px solid var(--line); font-family: var(--mono); line-height: 1.05; }
.esel-tier span small { font-family: var(--font); font-size: 0.5rem; letter-spacing: 0.14em; text-transform: uppercase; }
.esel-tier span.on { color: var(--gold); border-color: rgba(var(--gold-rgb), 0.55); background: rgba(var(--gold-rgb), 0.08); }
.esel-tier i { width: 0.8rem; height: 2px; background: var(--line-2); }
.bi-tier { position: absolute; top: 0.3rem; left: 0.3rem; z-index: 3; padding: 0.06rem 0.3rem; border-radius: 0.22rem; font-family: var(--mono); font-size: max(0.6rem, 8.5px);
  color: #ffe7a0; background: rgba(40, 28, 4, 0.85); border: 1px solid rgba(var(--gold-rgb), 0.6); letter-spacing: 0.04em; }
@media (prefers-reduced-motion: reduce) { .esel-up[data-state="build"] { animation: none; } }
`;
