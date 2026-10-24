/**
 * World Conquest setup: the homeland picker (globe + searchable list with each homeland's blurb, capital, starting
 * territories and zone), then the campaign options (doctrine, size, difficulty, Ironman, seed and challenge link),
 * the Weekly World, and a challenge link's prefill.
 */
import type { Faction } from '../../data/rules';
import type { WorldDifficulty, WorldSize } from '../../conquest/world/state';
import type { WorldHomeland } from '../../conquest/world/types';
import { alliedEmblem, sovietEmblem } from '../icons';
import { picto } from '../../meta/art';
import tCommon from '../../i18n/en/common';
import type { WorldApp, View } from './app';
import type { GlobeCell } from './globe';
import { W, type NewWorldOptions } from './api';
import { copyToClipboard, shareBase } from '../../share/links';
import { startBars, startRating, startWinRate, type StartRating } from './start';
import { diffDesc, diffName, esc, fmtInt, pct, homelandBlurb, homelandName, territoryName, tW, zoneName, continentName, landmarkName, SIDE_RGB } from './view';

const DIFFS: WorldDifficulty[] = ['recruit', 'easy', 'normal', 'hard', 'brutal'];
const CONTS = ['europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania'] as const;
const PREF = 'rh.world.setup';

interface Prefs { home?: string; faction?: Faction; size?: WorldSize; difficulty?: WorldDifficulty; ironman?: boolean; fog?: boolean }
function loadPrefs(): Prefs {
  try { const v = JSON.parse(localStorage.getItem(PREF) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const newSeed = () => (Math.random() * 0x7fffffff) >>> 0;

export interface SetupInit { link?: NewWorldOptions | null; step?: 1 | 2 }

export class SetupView implements View {
  private side: HTMLElement;
  private step: 1 | 2;
  private home: WorldHomeland;
  private faction: Faction;
  private factionChosen = false;
  private size: WorldSize;
  private difficulty: WorldDifficulty;
  private ironman: boolean;
  private fog: boolean;
  private seed = newSeed();
  private query = '';
  private cont: string = 'all';
  /** Show only homelands of this measured start difficulty (start.ts). */
  private startFilter: 'all' | StartRating = 'all';
  private link: NewWorldOptions | null;

  constructor(private app: WorldApp, init: SetupInit = {}) {
    const prefs = loadPrefs();
    const homes = app.geo.homelands;
    this.link = init.link ?? null;
    const guess = homes.find((h) => h.id === (this.link?.home ?? prefs.home)) ?? localeHome(app) ?? homes[0];
    this.home = guess;
    this.faction = this.link?.faction ?? prefs.faction ?? guess.faction;
    this.factionChosen = !!(this.link?.faction ?? prefs.faction);
    this.size = this.link?.size ?? prefs.size ?? 'blitz';
    this.difficulty = this.link?.difficulty ?? prefs.difficulty ?? (W.loadWorldMeta().runs ? 'normal' : 'easy');
    this.ironman = this.link?.ironman ?? prefs.ironman ?? false;
    this.fog = this.link?.fog ?? prefs.fog ?? false;
    if (this.link) this.seed = this.link.seed >>> 0;
    this.step = init.step ?? (this.link ? 2 : 1);
    app.root.classList.add('wc-setup');
    app.useSites(null);
    this.side = document.createElement('div');
    this.side.className = 'wc-panel wc-side';
    app.root.appendChild(this.side);
    this.render();
    this.paintGlobe(true);
  }

  destroy() {
    this.side.remove();
    this.app.root.classList.remove('wc-setup');
  }

  tipFor(id: string): string | null {
    const h = this.app.geo.homelands.find((x) => x.regions.includes(id));
    return h ? `<b>${esc(homelandName(h.id))}</b><small>${esc(territoryName(id))}</small>` : `<b>${esc(territoryName(id))}</b>`;
  }

  onPick(site: number) {
    const id = this.app.idOfSite(site);
    if (!id) return;
    const h = this.app.geo.homelands.find((x) => x.regions.includes(id) || x.capital === id);
    if (h && h !== this.home) { this.app.opts.play('tab'); this.choose(h, false); }
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') { if (this.step === 2 && !this.link) { this.step = 1; this.render(); } else this.app.back(); return true; }
    return false;
  }

  // ---------------------------------------------------------------------------------------------------
  private choose(h: WorldHomeland, fromList: boolean) {
    this.home = h;
    if (!this.factionChosen) this.faction = h.faction;
    this.render(fromList ? undefined : h.id);
    this.paintGlobe(false);
  }

  private paintGlobe(now: boolean) {
    const app = this.app, geo = app.geo;
    const homeSet = new Map<string, WorldHomeland>();
    for (const h of geo.homelands) for (const r of [h.capital, ...h.regions]) homeSet.set(r, h);
    const mine = new Set([this.home.capital, ...this.home.regions]);
    const col = this.faction === 'soviet' ? 0xd23a2c : 0x3d7be0;
    const cells: GlobeCell[] = app.sites.ids.map((id) => {
      const r = geo.regions[geo.byId.get(id) ?? -1] ?? { id, landmark: undefined };
      if (mine.has(r.id)) return { color: col, troops: 3, capital: r.id === this.home.capital, landmark: r.landmark, label: '' };
      const h = homeSet.get(r.id);
      if (h) return { color: 0x9c8a5a, troops: 0, capital: r.id === h.capital, label: '', small: true };
      return { color: 0x2a3644, troops: 0, dim: true };
    });
    app.paintCells(cells);
    const sites = [...mine].map((id) => app.siteOf(id)).filter((i) => i >= 0);
    app.globe.setMarks({ sel: app.siteOf(this.home.capital) });
    app.globe.frameSites(sites, now);
  }

  private render(scrollTo?: string) {
    document.body.classList.toggle('faction-soviet', this.faction === 'soviet');
    if (this.step === 1) this.renderHomes(scrollTo);
    else this.renderOptions();
  }

  // ---------------------------------------------------------------------------------------------------
  // Step 1: homeland
  // ---------------------------------------------------------------------------------------------------
  private renderHomes(scrollTo?: string) {
    const app = this.app, side = this.side;
    const keepScroll = side.querySelector('.wc-side-b')?.scrollTop ?? 0;
    const hadFocus = (document.activeElement as HTMLElement | null)?.dataset?.home ?? (document.activeElement?.classList.contains('wc-search') ? '#search' : null);
    const homes = app.geo.homelands.filter((h) => {
      const r = app.geo.regions[app.geo.byId.get(h.capital) ?? -1];
      if (this.cont !== 'all' && r?.continent !== this.cont) return false;
      if (this.startFilter !== 'all' && startRating(h.id, this.size) !== this.startFilter) return false;
      if (!this.query) return true;
      const q = norm(this.query);
      return norm(homelandName(h.id)).includes(q) || norm(h.name).includes(q) || (r && norm(continentName(r.continent)).includes(q)) || h.regions.some((id) => norm(territoryName(id)).includes(q));
    });
    const weekly = this.weeklyHtml();
    const run = app.run && app.run.status === 'active' ? app.run : null;
    side.innerHTML = `
      <div class="wc-side-h"><div class="wc-kick">${esc(tW('kick'))}</div><h1 class="wc-h1">${esc(tW('setup.title'))}</h1></div>
      <div class="wc-side-b">
        ${run ? `<div class="wc-note">${esc(tW('setup.inProgress', { home: homelandName(run.home), n: run.turn }))}<div style="margin-top:6px"><button class="wc-btn sm" data-act="resume">${esc(tW('setup.resume'))}</button></div></div>` : ''}
        ${weekly}
        <p class="wc-small wc-intro" style="margin:4px 0 8px">${esc(tW('setup.intro'))}</p>
        <input class="wc-search" type="search" data-search placeholder="${esc(tW('setup.search'))}" aria-label="${esc(tW('setup.search'))}" value="${esc(this.query)}">
        <div class="wc-conts" role="group" aria-label="${esc(tW('setup.search'))}">${['all', ...CONTS].map((c) => `<button data-cont="${c}" class="${this.cont === c ? 'on' : ''}" aria-pressed="${this.cont === c}">${esc(c === 'all' ? tW('setup.all') : continentName(c))}</button>`).join('')}</div>
        <div class="wc-conts" role="group" aria-label="${esc(tW('start.label'))}">${(['all', 'easy', 'medium', 'hard'] as const).map((r) => `<button data-start="${r}" class="${this.startFilter === r ? 'on' : ''}" aria-pressed="${this.startFilter === r}">${r === 'all' ? '' : startBars(r)}${esc(tW(`start.${r === 'all' ? 'any' : r}`))}</button>`).join('')}</div>
        <div class="wc-small" aria-live="polite" style="margin-bottom:6px">${esc(tW('setup.shown', { n: homes.length }))}</div>
        <div class="wc-homes" role="listbox" aria-label="${esc(tW('setup.homeland'))}">${homes.length ? homes.map((h) => this.homeHtml(h)).join('') : `<div class="wc-p">${esc(tW('setup.none'))}</div>`}</div>
      </div>
      <div class="wc-side-f">
        <div class="wc-small">${esc(this.summary())} · <a href="#" data-act="opts" style="color:rgb(var(--accent-rgb))">${esc(tW('setup.change'))}</a></div>
        <div class="wc-row2"><button class="wc-btn" data-act="back">${esc(tW('setup.back'))}</button><button class="wc-btn pri" data-act="begin">${picto('flag')}${esc(tW('setup.begin'))}</button></div>
      </div>`;
    const body = side.querySelector<HTMLElement>('.wc-side-b')!;
    body.scrollTop = keepScroll;
    const search = side.querySelector<HTMLInputElement>('[data-search]')!;
    search.oninput = () => { this.query = search.value; this.renderHomes(); };
    if (hadFocus === '#search') { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    side.querySelectorAll<HTMLElement>('[data-cont]').forEach((b) => (b.onclick = () => { this.cont = b.dataset.cont!; this.app.opts.play('tab'); this.renderHomes(); }));
    side.querySelectorAll<HTMLElement>('[data-start]').forEach((b) => (b.onclick = () => { this.startFilter = b.dataset.start as 'all' | StartRating; this.app.opts.play('tab'); this.renderHomes(); }));
    side.querySelectorAll<HTMLElement>('[data-home]').forEach((b) => {
      b.onclick = () => { const h = app.geo.homelands.find((x) => x.id === b.dataset.home)!; if (h !== this.home) { app.opts.play('click'); this.choose(h, true); } };
      b.onkeydown = (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const all = [...side.querySelectorAll<HTMLElement>('[data-home]')];
        const k = all.indexOf(b) + (e.key === 'ArrowDown' ? 1 : -1);
        all[Math.max(0, Math.min(all.length - 1, k))]?.focus();
      };
    });
    if (hadFocus && hadFocus !== '#search') side.querySelector<HTMLElement>(`[data-home="${CSS.escape(hadFocus)}"]`)?.focus();
    if (scrollTo) side.querySelector<HTMLElement>(`[data-home="${CSS.escape(scrollTo)}"]`)?.scrollIntoView({ block: 'nearest' });
    this.bindCommon();
  }

  private homeHtml(h: WorldHomeland): string {
    const on = h === this.home;
    const geo = this.app.geo;
    const cap = geo.regions[geo.byId.get(h.capital) ?? -1];
    const regs = [...new Set([h.capital, ...h.regions])];
    const lms = regs.map((id) => geo.regions[geo.byId.get(id) ?? -1]?.landmark).filter(Boolean) as string[];
    const zone = cap ? zoneName(cap.zone) : '';
    const rating = startRating(h.id, this.size);
    return `<button class="wc-home ${on ? 'on' : ''}" data-home="${esc(h.id)}" role="option" aria-selected="${on}">
      <div class="hd"><span class="wc-sw" style="background:rgb(${SIDE_RGB[h.faction]})"></span><b>${esc(homelandName(h.id))}</b>${rating ? `<span title="${esc(tW(`start.${rating}`))}">${startBars(rating)}</span>` : ''}<small>${esc(cap ? continentName(cap.continent) : '')}</small></div>
      ${on ? `<div class="more">${esc(homelandBlurb(h.id))}
        ${rating ? `<div class="wc-small" style="margin-top:4px">${startBars(rating)} <b>${esc(tW(`start.${rating}`))}</b> · ${esc(this.measured(h.id))}</div>` : ''}
        <div><span class="wc-chip gold">${picto('stars3')}${esc(tW('setup.capital'))}: ${esc(territoryName(h.capital))}</span>${zone ? `<span class="wc-chip">${esc(tW('setup.zone'))}: ${esc(zone)}</span>` : ''}</div>
        <div class="wc-small" style="margin-top:6px">${esc(tW('setup.regions'))}: ${regs.map((id) => esc(territoryName(id))).join(' · ')}</div>
        ${lms.length ? `<div>${lms.map((l) => `<span class="wc-chip gold">${picto('tower')}${esc(landmarkName(l))}</span>`).join('')}</div>` : ''}</div>` : ''}
    </button>`;
  }

  /** "65% of test campaigns won from here (Blitz, Normal)". */
  private measured(id: string): string {
    const r = startWinRate(id, this.size);
    return r == null ? '' : tW('start.measured', { pct: pct(r), size: tW(this.size === 'blitz' ? 'setup.blitz' : 'setup.world') });
  }

  private startLine(): string {
    const r = startRating(this.home.id, this.size);
    return r ? `<small class="wc-start">${startBars(r)} ${esc(tW(`start.${r}`))} · ${esc(this.measured(this.home.id))}</small>` : '';
  }

  private summary(): string {
    return [tW(this.size === 'blitz' ? 'setup.blitz' : 'setup.world'), diffName(this.difficulty), tCommon(this.faction === 'allies' ? 'faction.allies' : 'faction.soviet'), this.ironman ? tW('setup.ironman') : ''].filter(Boolean).join(' · ');
  }

  private weeklyHtml(): string {
    const wk = this.weekly();
    if (!wk) return '';
    const best = W.weeklyBest(W.loadWorldMeta(), W.weekKey(wk.year, wk.week))?.score;
    return `<div class="wc-weekly" title="${esc(tW('setup.weeklyDesc'))}"><div class="wk"><b>${esc(tW('setup.weekly'))} · ${esc(tW('setup.weeklyWeek', { n: wk.week }))}</b>
      <small>${esc(tW('setup.weeklyStart', { home: homelandName(wk.opts.home) }))} · ${esc(tW(wk.opts.size === 'blitz' ? 'setup.blitz' : 'setup.world'))} · ${esc(diffName(wk.opts.difficulty))} · ${esc(best ? tW('setup.weeklyBest', { n: fmtInt(best) }) : tW('setup.weeklyNone'))}</small></div>
      <button class="wc-btn gold sm" data-act="weekly" aria-label="${esc(tW('setup.weeklyPlay'))}">${picto('calendar')}${esc(tW('setup.weeklyPlay'))}</button></div>`;
  }

  private weekly(): { year: number; week: number; opts: NewWorldOptions } | null {
    try {
      const d = new Date();
      const { year, week } = W.isoWeek(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      const opts = W.weeklyWorld(year, week);
      return opts && this.app.geo.homelands.some((h) => h.id === opts.home) ? { year, week, opts } : null;
    } catch { return null; }
  }

  // ---------------------------------------------------------------------------------------------------
  // Step 2: options
  // ---------------------------------------------------------------------------------------------------
  private renderOptions() {
    const side = this.side;
    const keepScroll = side.querySelector('.wc-side-b')?.scrollTop ?? 0;
    const meta = W.loadWorldMeta();
    // a friend's challenge keeps their settings, so the scores compare (Change leaves the challenge)
    const lock = this.link ? ' disabled' : '';
    const seg = <T extends string>(name: string, vals: readonly T[], cur: T, label: (v: T) => string) =>
      `<div class="wc-seg" role="radiogroup" aria-label="${esc(name)}">${vals.map((v) => `<button role="radio" aria-checked="${v === cur}" data-${name}="${v}" class="${v === cur ? 'on' : ''}"${lock}>${esc(label(v))}</button>`).join('')}</div>`;
    side.innerHTML = `
      <div class="wc-side-h"><div class="wc-kick">${esc(tW('kick'))}</div><h1 class="wc-h1">${esc(tW('setup.options'))}</h1></div>
      <div class="wc-side-b">
        ${this.link ? `<div class="wc-note"><b>${esc(tW('setup.challenge'))}</b><br>${esc(tW('setup.challengeDesc', { home: homelandName(this.home.id) }))}</div>` : ''}
        <div class="wc-ter"><div class="tn"><small>${esc(tW('setup.homeland'))}</small><b>${esc(homelandName(this.home.id))}</b>${this.startLine()}</div><button class="wc-btn sm" data-act="${this.link ? 'unlink' : 'home'}">${esc(tW('setup.change'))}</button></div>
        <div class="wc-h4">${esc(tW('setup.side'))}</div>
        <div class="wc-facs">
          <button class="wc-fac allies ${this.faction === 'allies' ? 'on' : ''}" data-fac="allies" aria-pressed="${this.faction === 'allies'}"${lock}><span class="emb">${alliedEmblem()}</span><div><b>${esc(tCommon('faction.allies'))}</b><span>${esc(tW('setup.alliesBlurb'))}</span></div></button>
          <button class="wc-fac soviet ${this.faction === 'soviet' ? 'on' : ''}" data-fac="soviet" aria-pressed="${this.faction === 'soviet'}"${lock}><span class="emb">${sovietEmblem()}</span><div><b>${esc(tCommon('faction.soviet'))}</b><span>${esc(tW('setup.sovietBlurb'))}</span></div></button>
        </div>
        <div class="wc-h4">${esc(tW('setup.size'))}</div>
        ${seg('size', ['blitz', 'world'] as const, this.size, (v) => tW(v === 'blitz' ? 'setup.blitz' : 'setup.world'))}
        <p class="wc-small">${esc(tW(this.size === 'blitz' ? 'setup.blitzDesc' : 'setup.worldDesc'))}</p>
        <div class="wc-h4">${esc(tW('setup.difficulty'))}</div>
        ${seg('diff', DIFFS, this.difficulty, (v) => diffName(v))}
        <p class="wc-small">${esc(diffDesc(this.difficulty))}</p>
        ${this.difficulty === 'hard' || this.difficulty === 'brutal' ? `<label class="wc-toggle"><input type="checkbox" data-fog ${this.fog ? 'checked' : ''}${lock}><span><b>${esc(tW('setup.fog'))}</b><br><span class="wc-small">${esc(tW('setup.fogDesc'))}</span></span></label>` : ''}
        <label class="wc-toggle"><input type="checkbox" data-iron ${this.ironman ? 'checked' : ''}${lock}><span><b>${esc(tW('setup.ironman'))}</b><br><span class="wc-small">${esc(tW('setup.ironmanDesc'))}</span></span></label>
        <div class="wc-h4">${esc(tW('setup.seed'))}</div>
        <div class="wc-seed"><input data-seed value="${this.seed}" inputmode="numeric" aria-label="${esc(tW('setup.seed'))}"${lock ? ' readonly' : ''}>
          <button class="wc-btn icon" data-act="dice" title="${esc(tW('setup.newSeed'))}" aria-label="${esc(tW('setup.newSeed'))}"${lock}>${picto('crate')}</button>
          <button class="wc-btn sm" data-act="link">${picto('globe')}${esc(tW('setup.copyLink'))}</button></div>
        <div class="wc-h4">${esc(tW('setup.record'))}</div>
        <div class="wc-recs"><div><small>${esc(tW('setup.runs'))}</small><b>${fmtInt(meta.runs ?? 0)}</b></div><div><small>${esc(tW('setup.victories'))}</small><b>${fmtInt(meta.victories ?? 0)}</b></div><div><small>${esc(tW('setup.best'))}</small><b>${fmtInt(meta.bestScore ?? 0)}</b></div></div>
      </div>
      <div class="wc-side-f"><div class="wc-row2"><button class="wc-btn" data-act="${this.link ? 'back' : 'home'}">${esc(tW('setup.back'))}</button><button class="wc-btn pri" data-act="begin" data-focus>${picto('flag')}${esc(tW('setup.begin'))}</button></div></div>`;
    side.querySelector<HTMLElement>('.wc-side-b')!.scrollTop = keepScroll;
    const app = this.app;
    side.querySelectorAll<HTMLElement>('[data-fac]').forEach((b) => (b.onclick = () => { this.faction = b.dataset.fac as Faction; this.factionChosen = true; app.opts.play('tab'); this.render(); this.paintGlobe(false); }));
    side.querySelectorAll<HTMLElement>('[data-size]').forEach((b) => (b.onclick = () => { this.size = b.dataset.size as WorldSize; app.opts.play('tab'); this.render(); }));
    side.querySelectorAll<HTMLElement>('[data-diff]').forEach((b) => (b.onclick = () => { this.difficulty = b.dataset.diff as WorldDifficulty; app.opts.play('tab'); this.render(); }));
    side.querySelector<HTMLInputElement>('[data-iron]')!.onchange = (e) => { this.ironman = (e.target as HTMLInputElement).checked; };
    side.querySelector<HTMLInputElement>('[data-fog]')?.addEventListener('change', (e) => { this.fog = (e.target as HTMLInputElement).checked; });
    const seedIn = side.querySelector<HTMLInputElement>('[data-seed]')!;
    seedIn.onchange = () => { const v = parseInt(seedIn.value.replace(/\D/g, ''), 10); if (Number.isFinite(v)) this.seed = (v % 0x7fffffff) >>> 0; seedIn.value = String(this.seed); };
    side.querySelector<HTMLElement>('[data-act="dice"]')!.onclick = () => { this.seed = newSeed(); app.opts.play('click'); this.render(); };
    side.querySelector<HTMLElement>('[data-act="link"]')!.onclick = () => void this.copyLink();
    this.bindCommon();
  }

  private bindCommon() {
    const side = this.side, app = this.app;
    side.querySelectorAll<HTMLElement>('[data-act="back"]').forEach((b) => (b.onclick = () => app.back()));
    side.querySelectorAll<HTMLElement>('[data-act="home"]').forEach((b) => (b.onclick = () => { app.opts.play('click'); this.step = 1; this.render(this.home.id); }));
    side.querySelectorAll<HTMLElement>('[data-act="unlink"]').forEach((b) => (b.onclick = () => {
      app.opts.play('click');
      this.link = null;
      this.seed = newSeed();
      if (/[#&]world=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
      this.step = 1; this.render(this.home.id);
    }));
    side.querySelectorAll<HTMLElement>('[data-act="opts"]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); app.opts.play('click'); this.step = 2; this.render(); }));
    side.querySelectorAll<HTMLElement>('[data-act="begin"]').forEach((b) => (b.onclick = () => void this.begin(this.options())));
    side.querySelector<HTMLElement>('[data-act="weekly"]')?.addEventListener('click', () => { const wk = this.weekly(); if (wk) void this.begin(wk.opts, true); });
    side.querySelector<HTMLElement>('[data-act="resume"]')?.addEventListener('click', () => { app.opts.play('click'); app.nav.turn(); });
  }

  private options(): NewWorldOptions {
    const fog = this.fog && (this.difficulty === 'hard' || this.difficulty === 'brutal');
    return { seed: this.seed >>> 0, home: this.home.id, size: this.size, difficulty: this.difficulty, faction: this.faction, ironman: this.ironman, ...(fog ? { fog } : {}) };
  }

  private async copyLink() {
    const url = `${shareBase() ?? `${location.origin}${location.pathname}`}#${W.encodeWorldLink(this.options())}`;
    if (await copyToClipboard(url)) this.app.toast(tW('setup.copied'), 'good');
    else { history.replaceState(null, '', `#${W.encodeWorldLink(this.options())}`); this.app.toast(tW('setup.copyFailed'), 'bad'); }
  }

  private async begin(o: NewWorldOptions, weekly = false) {
    const app = this.app;
    if (app.run && app.run.status === 'active' && !(await app.confirm(tW('setup.abandonConfirm'), tW('setup.begin')))) return;
    app.opts.play('click');
    if (!weekly) app.store.set(PREF, JSON.stringify({ home: o.home, faction: o.faction, size: o.size, difficulty: o.difficulty, ironman: o.ironman, fog: this.fog } satisfies Prefs));
    if (/[#&]world=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    app.run = W.newWorldRun({ ...o, nonce: Date.now() });
    app.save();
    app.nav.turn({ fresh: true });
  }
}

/** Homeland ids by the ISO 3166 country of the browser's language (en-GB -> Britain, pt-BR -> Brazil, plain en -> US). */
export const HOME_ISO: Record<string, string> = {
  GB: 'britain', IE: 'ireland', FR: 'france', ES: 'spain', NL: 'low-countries', BE: 'low-countries', LU: 'low-countries', DE: 'germany',
  IT: 'italy', GR: 'greece', PL: 'poland', RU: 'soviet-union', UA: 'ukraine', SE: 'sweden', IS: 'iceland', TR: 'turkey', IR: 'iran',
  SA: 'arabia', AF: 'afghanistan', CN: 'china', JP: 'japan', MN: 'mongolia', IN: 'india', PK: 'pakistan', TH: 'thailand', VN: 'vietnam',
  ID: 'indonesia', PH: 'philippines', EG: 'egypt', MA: 'morocco', DZ: 'algeria', NG: 'nigeria', ET: 'ethiopia', CD: 'congo', CG: 'congo',
  ZA: 'south-africa', US: 'usa', CA: 'canada', MX: 'mexico', CU: 'cuba', BR: 'brazil', AR: 'argentina', CL: 'chile', PE: 'peru',
  VE: 'venezuela', AU: 'australia', NZ: 'new-zealand',
};
/** Where a first campaign starts when the language names no homeland: land neighbours and an easy first battle. */
const FALLBACK_HOME = 'france';

/** A first-time player starts at home: the homeland of the browser's language region (read locally, never sent). */
export function localeHomeId(lang: string | undefined): string | undefined {
  try {
    const region = lang ? new Intl.Locale(lang).maximize().region : undefined;
    return region ? HOME_ISO[region] : undefined;
  } catch { return undefined; }
}
function localeHome(app: WorldApp): WorldHomeland | undefined {
  const id = localeHomeId(typeof navigator !== 'undefined' ? navigator.language : undefined);
  return app.geo.homelands.find((h) => h.id === id) ?? app.geo.homelands.find((h) => h.id === FALLBACK_HOME);
}
