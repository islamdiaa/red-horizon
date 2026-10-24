/**
 * The World Conquest turn screen: the globe with every territory's troops, the phase stepper (Reinforce, Attack,
 * Fortify), a context panel per phase (placing troops, the odds panel with Roll / Blitz / Fight it, moving in after a
 * conquest, fortifying), the rivals' turn playback, defence choices, ceasefire offers, and the battle in progress.
 */
import type { WorldEvent, WorldRun, WTerritory } from '../../conquest/world/state';
import { ix } from '../../conquest/world/state';
import { LANDMARK_INFO } from '../../conquest/world/regions';
import type { LandmarkId } from '../../conquest/world/types';
import { readSave, type SaveData } from '../../sim/save';
import { picto } from '../../meta/art';
import { alliedEmblem, sovietEmblem } from '../icons';
import { fmtMoney, tx } from '../../i18n/core';
import type { View, WorldApp } from './app';
import type { GlobeArrow } from './globe';
import { W, type Odds } from './api';
import { showDice } from './dice';
import { cardName, tWorld, esc, fmtInt, hex, ownerName, pct, powerColor, powerName, territoryName, tW, zoneName, landmarkName } from './view';
import { landmarkIconUrl } from './icons';
import { openCards, openHelp, openLog, openMenu, openRivals, eventLine } from './drawers';
import { ListView } from './list';
import { Coach } from './coach';

type Sel = { src: string | null; dst: string | null };

export function showTurn(app: WorldApp, o: { fresh?: boolean } = {}) {
  app.setView(new TurnView(app, o));
}

export class TurnView implements View {
  private top: HTMLElement;
  private side: HTMLElement;
  private prompt: HTMLElement;
  /** The selection: a source territory and a target (attack / fortify). */
  sel: Sel = { src: null, dst: null };
  /** The coach's suggested first target (pulses on the globe, first in the target list). */
  coachTarget: string | null = null;
  private amount = 1;
  private busy = false;
  private list: ListView | null = null;
  private coach: Coach | null = null;
  private playing: { skip(): void } | null = null;
  private lastPhase = '';
  private resumes = 0;

  constructor(private app: WorldApp, o: { fresh?: boolean }) {
    const run = this.run;
    document.body.classList.toggle('faction-soviet', run.faction === 'soviet');
    this.top = document.createElement('div');
    this.top.className = 'wc-top';
    this.side = document.createElement('div');
    this.side.className = 'wc-panel wc-side';
    this.side.setAttribute('aria-live', 'off');
    this.prompt = document.createElement('div');
    this.prompt.className = 'wc-prompt';
    this.prompt.setAttribute('role', 'status');
    app.root.append(this.top, this.side);
    app.stage.appendChild(this.prompt);
    app.useSites(run);
    app.globe.minDist = 1.25;
    const mine = run.territories.filter((t) => t.owner === run.player).map((t) => app.siteOf(t.id));
    app.globe.frameSites(mine.length ? mine : run.territories.map((t) => app.siteOf(t.id)), !o.fresh);
    if (o.fresh) app.banner(tW('kick'), tW('top.turn', { n: run.turn }));
    this.coach = Coach.maybe(app, this);
    this.refresh();
    if (!app.globe.ok) this.toggleList(); // (no WebGL: the list view is the map)
    void this.resumeFlow();
  }

  get run(): WorldRun { return this.app.run!; }

  destroy() {
    this.playing?.skip();
    this.app.root.classList.remove('wc-playing', 'wc-tall');
    this.coach?.destroy();
    this.list?.destroy();
    this.top.remove();
    this.side.remove();
    this.prompt.remove();
    this.app.globe.setArrows([]);
  }

  // ---------------------------------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------------------------------
  private t(id: string | null): WTerritory | undefined {
    if (!id) return undefined;
    const i = ix(this.run).byId.get(id);
    return i == null ? undefined : this.run.territories[i];
  }
  private neighbours(id: string): string[] {
    const X = ix(this.run), i = X.byId.get(id);
    return i == null ? [] : X.adj[i].map((n) => this.run.territories[n].id);
  }
  private mine(t: WTerritory | undefined) { return !!t && t.owner === this.run.player; }
  /** Attackable neighbours of a territory (the rules' own check). */
  targets(src: string): string[] {
    const run = this.run;
    const s = this.t(src);
    if (!s || s.owner !== run.player || s.troops < 2) return [];
    return safe(() => W.attackTargets(run, src).map((a) => a.to), [] as string[]);
  }
  private fortifyTargets(src: string): string[] {
    const s = this.t(src);
    if (!s || s.owner !== this.run.player || s.troops < 2) return [];
    return safe(() => W.fortifyTargets(this.run, src), [] as string[]);
  }
  /** Troops a territory shows (fog: the last seen count of a rival's territory, null = unknown). */
  shownTroops(k: number): number | null {
    const run = this.run, t = run.territories[k];
    if (!run.fog || safe(() => W.troopsVisible(run, t.id), true)) return t.troops;
    const s = run.seen?.[run.player]?.[k];
    return s != null && s >= 0 ? s : null;
  }
  /** The best few attacks by odds (suggestions for the attack phase). */
  suggestions(n = 3): { from: string; to: string; odds: Odds }[] {
    const run = this.run, out: { from: string; to: string; odds: Odds }[] = [];
    for (const t of run.territories) {
      if (t.owner !== run.player || t.troops < 2) continue;
      for (const id of this.targets(t.id)) {
        const odds = safe(() => W.attackOdds(run, t.id, id), null);
        if (odds) out.push({ from: t.id, to: id, odds });
      }
    }
    return out.sort((a, b) => b.odds.win - a.odds.win || this.t(a.to)!.troops - this.t(b.to)!.troops).slice(0, n);
  }

  // ---------------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------------
  refresh() {
    const run = this.run;
    if (run.status !== 'active') { queueMicrotask(() => { if (this.app.view === this) this.app.nav.end(); }); return; }
    // drop a stale selection
    if (this.sel.src && !this.mine(this.t(this.sel.src))) this.sel = { src: null, dst: null };
    if (run.phase !== this.lastPhase) {
      if (this.lastPhase) this.app.announce(tW('a11y.phaseNow', { phase: tW(`phase.${run.phase}`) }));
      this.lastPhase = run.phase;
      this.sel = { src: run.phase === 'reinforce' ? this.sel.src : null, dst: null };
    }
    this.app.paint(run, (k) => this.shownTroops(k));
    this.marks();
    this.renderTop();
    this.renderSide();
    this.list?.render();
    this.coach?.update();
  }

  private marks() {
    const run = this.run, app = this.app, s = this.sel;
    const arrows: GlobeArrow[] = [];
    let targets: string[] = [], sources: string[] = [];
    if (run.phase === 'reinforce') {
      sources = run.territories.filter((t) => t.owner === run.player).map((t) => t.id);
    } else if (run.phase === 'attack') {
      if (run.conquest) arrows.push({ from: app.siteOf(run.conquest.from), to: app.siteOf(run.conquest.to), kind: 'go' });
      else if (s.src) {
        targets = this.targets(s.src);
        for (const id of targets) arrows.push({ from: app.siteOf(s.src), to: app.siteOf(id), kind: id === s.dst ? 'go' : 'option' });
      } else sources = run.territories.filter((t) => this.targets(t.id).length).map((t) => t.id);
    } else if (run.phase === 'fortify' && s.src) {
      targets = this.fortifyTargets(s.src);
      if (s.dst) arrows.push({ from: app.siteOf(s.src), to: app.siteOf(s.dst), kind: 'fortify' });
    }
    // an intel wonder shows the rivals' planned attacks on you
    if (safe(() => W.wonderSum(run, run.player, 'intel'), 0) > 0) {
      for (const i of safe(() => W.rivalIntentions(run), [] as { power: number; from: string; to: string }[])) arrows.push({ from: app.siteOf(i.from), to: app.siteOf(i.to), kind: 'threat', color: hex(powerColor(run, i.power)) });
    }
    // sea lanes of the run (faint) and the pending battle's front
    for (const l of run.links) if (l.sea) arrows.push({ from: app.siteOf(l.a), to: app.siteOf(l.b), kind: 'lane' });
    if (run.pending) arrows.push({ from: app.siteOf(run.pending.from), to: app.siteOf(run.pending.to), kind: 'go' });
    app.globe.setArrows(arrows.filter((a) => a.from >= 0 && a.to >= 0));
    const sel = s.dst ?? s.src;
    const hint = run.phase === 'attack' && !s.dst && this.coachTarget && targets.includes(this.coachTarget) ? [app.siteOf(this.coachTarget)] : [];
    app.globe.setMarks({
      sel: sel ? app.siteOf(sel) : undefined,
      sources: s.src ? [app.siteOf(s.src)] : run.phase === 'attack' ? sources.map((id) => app.siteOf(id)) : [],
      targets: targets.map((id) => app.siteOf(id)),
      flash: hint,
    });
  }

  private renderTop() {
    const run = this.run, p = run.player;
    const owned = run.territories.filter((t) => t.owner === p);
    const troops = owned.reduce((a, t) => a + t.troops, 0);
    const phases = ['reinforce', 'attack', 'fortify'] as const;
    const at = phases.indexOf(run.phase);
    const cards = run.powers[p]?.cards.length ?? 0;
    const tradable = !!safe(() => W.bestSet(run), null);
    this.top.innerHTML = `
      <div class="wc-panel wc-turn"><span class="emb">${run.faction === 'soviet' ? sovietEmblem() : alliedEmblem()}</span><div><b>${esc(tW('top.turn', { n: run.turn }))}</b><small>${esc(tW('kick'))}</small></div></div>
      <div class="wc-panel wc-steps" role="list" aria-label="${esc(tW('top.turn', { n: run.turn }))}">${phases.map((ph, k) => `<div role="listitem" class="wc-step ${k === at ? 'on' : k < at ? 'done' : ''}" ${k === at ? 'aria-current="step"' : ''}><i>${k + 1}</i><span>${esc(tW(`phase.${ph}`))}</span></div>`).join('')}</div>
      <div class="wc-stats">
        <div class="wc-panel wc-stat">${picto('helmet')}<div><small>${esc(tW('top.troops'))}</small><b>${fmtInt(troops)}</b></div></div>
        <div class="wc-panel wc-stat">${picto('flag')}<div><small>${esc(tW('top.territories'))}</small><b>${owned.length}/${run.territories.length}</b></div></div>
      </div>
      <div class="wc-tools">
        <button class="wc-btn icon ${tradable ? 'gold' : ''}" data-tool="cards" title="${esc(tW('top.cards'))}" aria-label="${esc(tW('top.cards'))}: ${cards}">${picto('medal')}${cards ? `<em>${cards}</em>` : ''}</button>
        <button class="wc-btn icon" data-tool="rivals" title="${esc(tW('top.rivals'))}" aria-label="${esc(tW('top.rivals'))}">${picto('user')}</button>
        <button class="wc-btn icon" data-tool="log" title="${esc(tW('top.log'))}" aria-label="${esc(tW('top.log'))}">${picto('history')}</button>
        <button class="wc-btn icon" data-tool="list" title="${esc(tW(this.list ? 'top.globe' : 'top.list'))}" aria-label="${esc(tW(this.list ? 'top.globe' : 'top.list'))}" aria-pressed="${!!this.list}">${picto(this.list ? 'globe' : 'chart')}</button>
        <button class="wc-btn icon" data-tool="menu" title="${esc(tW('top.menu'))}" aria-label="${esc(tW('top.menu'))}">${picto('gear')}</button>
      </div>`;
    this.top.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => (b.onclick = () => this.tool(b.dataset.tool!)));
  }

  tool(k: string) {
    const app = this.app;
    if (this.busy && k !== 'list') return;
    app.opts.play('click');
    if (k === 'cards') openCards(app, () => this.refresh());
    else if (k === 'rivals') openRivals(app, () => this.refresh());
    else if (k === 'log') openLog(app);
    else if (k === 'menu') openMenu(app, this);
    else if (k === 'help') openHelp(app);
    else if (k === 'list') this.toggleList();
  }

  toggleList() {
    if (this.list) { this.list.destroy(); this.list = null; }
    else { this.list = new ListView(this.app, this); this.list.render(); this.list.focus(); }
    this.renderTop();
  }

  private setPrompt(text: string) {
    this.prompt.textContent = text;
    this.prompt.style.display = text ? '' : 'none';
  }

  private terCard(id: string, extra = ''): string {
    const t = this.t(id)!, run = this.run;
    const k = ix(run).byId.get(id)!;
    const tr = this.shownTroops(k);
    const icon = t.landmark ? landmarkIconUrl(t.landmark) : null;
    const zone = run.zones.find((z) => z.id === t.zone);
    const bits = [ownerName(run, t.owner), zone ? `${zoneName(zone.id)} +${zone.bonus}` : '', t.capital !== undefined ? tW('rivals.capital') : '', t.landmark ? landmarkName(t.landmark) : ''].filter(Boolean);
    const wonder = t.landmark ? wonderText(t.landmark) : '';
    if (wonder) extra = `<small style="color:#ffe08a">${esc(wonder)}</small>${extra}`;
    return `<div class="wc-ter" style="border-left:4px solid ${hex(powerColor(run, t.owner))}">${icon ? `<img src="${esc(icon)}" alt="">` : ''}<div class="tn"><b>${esc(territoryName(id))}</b><small>${esc(bits.join(' · '))}</small>${extra}</div><div class="tr">${tr == null ? '?' : fmtInt(tr)}</div></div>`;
  }

  renderSide() {
    const run = this.run;
    // phones: the sheet grows while the odds panel or the move-in is up (the numbers matter more than the map then)
    this.app.root.classList.toggle('wc-tall', !run.pending && run.phase === 'attack' && (!!run.conquest || !!(this.sel.src && this.sel.dst)));
    if (run.pending) return this.sidePending();
    if (run.phase === 'reinforce') return this.sideReinforce();
    if (run.phase === 'attack') return run.conquest ? this.sideMoveIn() : this.sideAttack();
    return this.sideFortify();
  }

  private head(kick: string, title: string) {
    return `<div class="wc-side-h"><div class="wc-kick">${esc(kick)}</div><h2 class="wc-h1">${esc(title)}</h2></div>`;
  }

  private bind(map: Record<string, () => void>) {
    for (const [k, fn] of Object.entries(map)) this.side.querySelectorAll<HTMLElement>(`[data-act="${k}"]`).forEach((b) => (b.onclick = () => { if (!this.busy) fn(); }));
  }

  // --- reinforce ---
  private sideReinforce() {
    const run = this.run;
    const r = safe(() => W.reinforcements(run), { total: run.toPlace, lines: [] });
    const must = safe(() => W.mustTrade(run), false);
    const best = safe(() => W.bestSet(run), null);
    const val = safe(() => W.setValue(run), 0);
    const src = this.sel.src && this.mine(this.t(this.sel.src)) ? this.sel.src : null;
    this.amount = Math.max(1, Math.min(run.toPlace, this.amount));
    this.side.innerHTML = `${this.head(tW('phase.reinforce'), tW('reinforce.toPlace'))}
      <div class="wc-side-b">
        <div class="wc-big" aria-live="polite">${fmtInt(run.toPlace)}</div>
        <div class="wc-h4">${esc(tW('reinforce.breakdown'))}</div>
        <div class="wc-lines">${r.lines.map((l) => `<div class="wc-line"><span>${esc(lineLabel(l))}</span><b>+${l.n}</b></div>`).join('')}</div>
        ${must ? `<div class="wc-warn">${esc(tW('reinforce.mustTrade'))}</div>` : ''}
        ${best ? `<button class="wc-btn gold" style="width:100%" data-act="trade">${picto('medal')}${esc(tW('reinforce.trade', { n: val }))}</button>` : ''}
        ${src ? this.terCard(src) : run.toPlace ? `<p class="wc-p">${esc(tW('reinforce.hint'))}</p>` : `<p class="wc-p">${esc(tW('reinforce.done'))}</p>`}
        ${src && run.toPlace ? '' : this.zonesHtml()}
        ${src && run.toPlace ? `<div class="wc-stepper"><button class="wc-btn" data-act="minus" aria-label="−">−</button><output aria-live="polite">${this.amount}</output><button class="wc-btn" data-act="plus" aria-label="+">+</button></div>
          <div class="wc-row2"><button class="wc-btn" data-act="place" ${must ? 'disabled' : ''}>${esc(tW('reinforce.place', { n: this.amount }))}</button><button class="wc-btn" data-act="all" ${must ? 'disabled' : ''}>${esc(tW('reinforce.placeAll', { n: run.toPlace }))}</button></div>` : ''}
      </div>
      <div class="wc-side-f"><button class="wc-btn pri" data-act="next" ${run.toPlace ? 'disabled' : ''}>${picto('crosshair')}${esc(tW('reinforce.toAttack'))}</button></div>`;
    this.setPrompt(run.toPlace ? (src ? '' : tW('reinforce.pick')) : '');
    this.side.querySelectorAll<HTMLElement>('[data-zone]').forEach((b) => (b.onclick = () => {
      const zi = ix(run).zoneIdx.get(b.dataset.zone!);
      if (zi == null) return;
      this.app.opts.play('tab');
      this.app.globe.frameSites((ix(run).zoneT[zi] ?? []).map((i) => this.app.siteOf(run.territories[i].id)));
    }));
    this.bind({
      minus: () => { this.amount = Math.max(1, this.amount - 1); this.app.opts.play('tab'); this.renderSide(); },
      plus: () => { this.amount = Math.min(run.toPlace, this.amount + 1); this.app.opts.play('tab'); this.renderSide(); },
      place: () => this.place(this.amount),
      all: () => this.place(run.toPlace),
      trade: () => openCards(this.app, () => this.refresh()),
      next: () => this.endPhase(),
    });
  }

  /** The zones you have a foothold in: how many of their territories you hold, and their bonus (Risk's continents). */
  private zonesHtml(): string {
    const run = this.run, X = ix(run);
    const rows = run.zones.map((z, zi) => {
      const ts = X.zoneT[zi] ?? [];
      const mine = ts.filter((i) => run.territories[i].owner === run.player).length;
      return { z, mine, all: ts.length };
    }).filter((r) => r.mine > 0).sort((a, b) => b.mine / b.all - a.mine / a.all || b.z.bonus - a.z.bonus).slice(0, 6);
    if (!rows.length) return '';
    return `<div class="wc-h4">${esc(tW('reinforce.zones'))}</div><div class="wc-sugg">${rows.map((r) => `<button data-zone="${esc(r.z.id)}"><span>${esc(zoneName(r.z.id))} · ${r.mine}/${r.all}</span><b style="color:${r.mine === r.all ? '#8dffb0' : '#ffe08a'}">+${r.z.bonus}</b></button>`).join('')}</div>`;
  }

  place(n: number) {
    const run = this.run, id = this.sel.src;
    if (!id || n < 1) return;
    if (!safe(() => W.placeTroops(run, id, Math.min(n, run.toPlace)), false)) return;
    this.app.opts.play('click');
    this.app.save();
    this.app.globe.setMarks({ sel: this.app.siteOf(id), flash: [this.app.siteOf(id)] });
    this.amount = 1;
    this.app.announce(tW('toast.placed', { n, territory: territoryName(id) }));
    this.refresh();
  }

  // --- attack ---
  private sideAttack() {
    const run = this.run, s = this.sel;
    let body = '';
    let prompt = '';
    if (!s.src) {
      const sugg = this.suggestions();
      prompt = tW('attack.hint');
      body = `<p class="wc-p">${esc(tW('attack.hint'))}</p>
        ${sugg.length ? `<div class="wc-h4">${esc(tW('attack.suggest'))}</div><div class="wc-sugg">${sugg.map((g) => `<button data-sugg="${esc(g.from)}|${esc(g.to)}"><span>${esc(tW('attack.arrow', { from: territoryName(g.from), to: territoryName(g.to) }))}</span><b>${pct(g.odds.win)}</b></button>`).join('')}</div>` : ''}`;
    } else if (!s.dst) {
      const tg = this.targets(s.src);
      prompt = tg.length ? tW('attack.pickTarget') : tW(this.t(s.src)!.troops < 2 ? 'attack.needTwo' : 'attack.noTargets');
      const blocked = this.neighbours(s.src).filter((id) => this.t(id)!.owner !== run.player && !tg.includes(id)).map((id) => [id, safe(() => W.attackBlock(run, s.src!, id), null)] as const).filter(([, why]) => why && why !== 'troops');
      body = `${this.terCard(s.src)}<p class="wc-p">${esc(prompt)}</p>
        ${blocked.length ? `<div class="wc-small" style="margin-top:8px">${esc(tW('attack.blocked'))}</div>${[...new Set(blocked.map(([, why]) => why))].map((why) => `<div class="wc-small">· ${esc(blocked.filter(([, w]) => w === why).map(([id]) => territoryName(id)).join(', '))}: ${esc(tx(`world.block.${why}`, undefined, String(why)))}</div>`).join('')}` : ''}
        ${tg.length ? `<div class="wc-sugg">${[...tg].sort((a, b) => (b === this.coachTarget ? 1 : 0) - (a === this.coachTarget ? 1 : 0)).map((id) => { const o = safe(() => W.attackOdds(run, s.src!, id), null); return `<button data-tgt="${esc(id)}"${id === this.coachTarget ? ' class="wc-hint"' : ''}><span>${id === this.coachTarget ? '★ ' : ''}${esc(territoryName(id))} · ${esc(ownerName(run, this.t(id)!.owner))}</span><b>${o ? pct(o.win) : ''}</b></button>`; }).join('')}</div>` : ''}`;
    } else {
      body = this.oddsHtml(s.src, s.dst);
    }
    this.side.innerHTML = `${this.head(tW('phase.attack'), s.src && s.dst ? tW('attack.arrow', { from: territoryName(s.src), to: territoryName(s.dst) }) : tW('phase.attack'))}
      <div class="wc-side-b">${body}</div>
      <div class="wc-side-f">${s.src && s.dst ? `<div class="wc-row2"><button class="wc-btn" data-act="roll" data-focus>${picto('crate')}${esc(tW('attack.roll'))}</button><button class="wc-btn" data-act="blitz" title="${esc(tW('attack.blitzDesc'))}">${picto('bolt')}${esc(tW('attack.blitz'))}</button></div>
        <button class="wc-btn gold pri" data-act="fight" title="${esc(tW('attack.fightDesc'))}">${picto('crosshair')}${esc(tW('attack.fight'))}</button>` : ''}
        <div class="wc-row2 ${s.src && s.dst ? 'wc-minor' : ''}"><button class="wc-btn" data-act="fortify">${esc(tW('attack.toFortify'))}</button><button class="wc-btn" data-act="end">${esc(tW('attack.endTurn'))}</button></div></div>`;
    this.setPrompt(s.dst ? '' : prompt);
    this.side.querySelectorAll<HTMLElement>('[data-sugg]').forEach((b) => (b.onclick = () => { const [f, t] = b.dataset.sugg!.split('|'); this.sel = { src: f, dst: t }; this.app.opts.play('click'); this.app.globe.frameSites([this.app.siteOf(f), this.app.siteOf(t)]); this.refresh(); }));
    this.side.querySelectorAll<HTMLElement>('[data-tgt]').forEach((b) => (b.onclick = () => this.pick(b.dataset.tgt!))); // (as a tap on the globe: the coach follows)
    this.bind({ roll: () => void this.roll(false), blitz: () => void this.roll(true), fight: () => void this.fight(), fortify: () => this.endPhase(), end: () => void this.endTurn() });
  }

  private oddsHtml(src: string, dst: string): string {
    const run = this.run;
    const o = safe(() => W.attackOdds(run, src, dst), null);
    const prev = safe(() => W.battlePreview(run, src, dst), null);
    const d = this.t(dst)!;
    const cease = d.owner > 0 && (run.powers[d.owner]?.ceasefire ?? 0) >= run.turn;
    const cls = !o ? '' : o.win >= 0.65 ? 'good' : o.win >= 0.4 ? 'mid' : 'bad';
    const roll = o?.roll;
    const two = (o?.attDice ?? 0) >= 2 && (o?.defDice ?? 0) >= 2;
    const side = (id: string) => { const t = this.t(id)!, k = ix(run).byId.get(id)!, tr = this.shownTroops(k); return `<div style="border-left:3px solid ${hex(powerColor(run, t.owner))}"><b>${esc(territoryName(id))}</b><small>${esc(ownerName(run, t.owner))}</small><span>${tr == null ? '?' : fmtInt(tr)}</span></div>`; };
    return `<div class="wc-vs">${side(src)}<i aria-hidden="true">${picto('sword')}</i>${side(dst)}</div>
      ${d.capital !== undefined && d.owner >= 0 && d.owner !== run.player ? `<div class="wc-note">${esc(tW('attack.capitalBoss'))}</div>` : ''}
      ${cease ? `<div class="wc-warn">${esc(tW('attack.ceasefireWarn', { power: powerName(run, d.owner) }))}</div>` : ''}
      ${o ? `<div class="wc-odds"><div class="wc-small">${esc(tW('attack.win'))}</div><div class="pct ${cls}">${pct(o.win)}</div><div class="wc-small">${esc(tW('attack.winDesc'))}</div>
        <div class="wc-line" style="margin-top:8px"><span>${esc(tW('attack.expLoss'))}</span><b>${esc(tW('attack.lossYou', { n: fmtInt(Math.round(o.attLoss)) }))} · ${esc(tW('attack.lossThem', { n: fmtInt(Math.round(o.defLoss)) }))}</b></div>
        ${roll ? `<div class="wc-small" style="margin-top:8px">${esc(tW('attack.perRoll'))} · ${esc(tW('attack.dice', { a: o.attDice, d: o.defDice }))}</div>
        <div class="wc-meter"><i style="width:${(roll.att * 100).toFixed(1)}%;background:#4dd88a"></i><i style="width:${(roll.split * 100).toFixed(1)}%;background:#ffd34d"></i><i style="width:${(roll.def * 100).toFixed(1)}%;background:#ff6a50"></i></div>
        <div class="wc-legend"><span><i class="wc-sw" style="background:#4dd88a"></i>${esc(tW(two ? 'attack.rollWin' : 'attack.rollWin1'))} ${pct(roll.att)}</span>${two ? `<span><i class="wc-sw" style="background:#ffd34d"></i>${esc(tW('attack.rollSplit'))} ${pct(roll.split)}</span>` : ''}<span><i class="wc-sw" style="background:#ff6a50"></i>${esc(tW(two ? 'attack.rollLose' : 'attack.rollLose1'))} ${pct(roll.def)}</span></div>` : ''}</div>` : ''}
      ${prev ? `<div class="wc-gives"><b>${esc(tW('attack.fightGives'))}</b>
        <div>${esc(tW('attack.fightNoLuck'))}</div><div>${esc(tW('attack.fightForces', { a: fmtInt(prev.attackers), d: fmtInt(prev.defenders) }))}</div>
        ${prev.loot ? `<div>${esc(tW('attack.fightChest', { money: fmtMoney(prev.loot) }))}</div>` : ''}${prev.cardChance ? `<div>${esc(tW('attack.fightCard', { pct: pct(prev.cardChance) }))}</div>` : ''}
        ${prev.scoreMult > 1 ? `<div>${esc(tW('attack.fightScore', { n: Math.round(prev.scoreMult * 10) / 10 }))}</div>` : ''}<div>${esc(tW('attack.fightVets'))}</div></div>` : ''}`;
  }

  async roll(blitz: boolean) {
    const run = this.run, { src, dst } = this.sel;
    if (!src || !dst || this.busy) return;
    this.busy = true;
    this.app.opts.play('click');
    try {
      const res = W.rollAttack(run, src, dst, blitz);
      if (!res) return;
      this.app.save();
      const t = this.t(src)!;
      const repulsed = !res.conquered && t.troops < 2;
      setTimeout(() => this.app.opts.play(res.conquered ? 'promote' : repulsed ? 'error' : 'tab'), this.app.reduce ? 0 : 450); // (as the dice land)
      await showDice(this.app, res.rolls, { conquered: res.conquered, repulsed: repulsed && blitz });
      if (res.conquered) {
        this.app.globe.setMarks({ sel: this.app.siteOf(dst), flash: [this.app.siteOf(dst)] });
        this.sel = { src: null, dst: null };
        this.coach?.event('roll');
      } else if (t.troops < 2) this.sel = { src: null, dst: null };
    } catch (e) {
      console.warn('roll failed', e);
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  private async fight() {
    const run = this.run, { src, dst } = this.sel;
    if (!src || !dst || this.busy) return;
    const d = this.t(dst)!;
    if (d.owner > 0 && (run.powers[d.owner]?.ceasefire ?? 0) >= run.turn && !(await this.app.confirm(tW('attack.ceasefireWarn', { power: powerName(run, d.owner) }), tW('attack.fight')))) return;
    this.app.opts.play('click');
    this.coach?.event('fight');
    const setup = W.startBattle(run, src, dst);
    if (!setup) return;
    this.app.save();
    this.deploy(setup);
  }

  private deploy(setup: Parameters<WorldApp['opts']['onDeploy']>[0]) {
    const app = this.app;
    app.close();
    app.opts.onDeploy(setup);
  }

  // --- move in after a conquest ---
  private sideMoveIn() {
    const run = this.run, c = run.conquest!;
    this.side.innerHTML = `${this.head(tW('attack.conquered'), tW('attack.arrow', { from: territoryName(c.from), to: territoryName(c.to) }))}
      <div class="wc-side-b">${this.terCard(c.to)}
        <div class="wc-h4">${esc(tW('attack.moveIn'))}</div>
        <div class="wc-stepper"><button class="wc-btn" data-act="mminus" aria-label="−" ${c.moved <= c.min ? 'disabled' : ''}>−</button><output aria-live="polite">${c.moved}</output><button class="wc-btn" data-act="mplus" aria-label="+" ${c.moved >= c.max ? 'disabled' : ''}>+</button></div>
        <input class="wc-range" type="range" min="${c.min}" max="${c.max}" value="${c.moved}" aria-label="${esc(tW('attack.moveIn'))}" data-move ${c.max <= c.min ? 'disabled' : ''}>
        <div class="wc-legend"><span>${c.min}</span><span>${c.max}</span></div>
      </div>
      <div class="wc-side-f"><button class="wc-btn pri" data-act="done" data-focus>${esc(tW('attack.moveDone'))}</button></div>`;
    this.setPrompt('');
    const set = (n: number) => { if (safe(() => W.moveIn(run, n), false)) { this.app.save(); this.refresh(); } };
    const range = this.side.querySelector<HTMLInputElement>('[data-move]')!;
    range.oninput = () => set(+range.value);
    this.bind({ mminus: () => set(c.moved - 1), mplus: () => set(c.moved + 1), done: () => { run.conquest = null; this.app.save(); this.app.opts.play('click'); this.refresh(); } });
  }

  // --- fortify ---
  private sideFortify() {
    const run = this.run, s = this.sel;
    const left = run.fortifiesLeft;
    let body = `<p class="wc-p">${esc(tW('fortify.hint'))}</p><div class="wc-chip ${left ? 'green' : ''}">${esc(left ? tW('fortify.left', { n: left }) : tW('fortify.none'))}</div>`;
    let prompt = left ? tW('fortify.hint') : '';
    if (left && s.src) {
      const src = this.t(s.src)!;
      body += this.terCard(s.src);
      if (!s.dst) { prompt = tW('fortify.pickTarget'); body += `<div class="wc-sugg">${this.fortifyTargets(s.src).map((id) => `<button data-tgt="${esc(id)}"><span>${esc(territoryName(id))}</span><b>${fmtInt(this.t(id)!.troops)}</b></button>`).join('')}</div>`; }
      else {
        prompt = '';
        const max = src.troops - 1;
        this.amount = Math.max(1, Math.min(max, this.amount || max));
        body += `${this.terCard(s.dst)}<div class="wc-stepper"><button class="wc-btn" data-act="fminus" aria-label="−">−</button><output aria-live="polite">${this.amount}</output><button class="wc-btn" data-act="fplus" aria-label="+">+</button></div>
          <input class="wc-range" type="range" min="1" max="${max}" value="${this.amount}" data-famt aria-label="${esc(tW('fortify.move', { n: this.amount }))}">
          <button class="wc-btn" style="width:100%" data-act="move" data-focus>${picto('chevrons')}${esc(tW('fortify.move', { n: this.amount }))}</button>`;
      }
    }
    this.side.innerHTML = `${this.head(tW('phase.fortify'), tW('phase.fortify'))}<div class="wc-side-b">${body}</div>
      <div class="wc-side-f"><button class="wc-btn pri" data-act="end">${picto('play')}${esc(tW('fortify.endTurn'))}</button></div>`;
    this.setPrompt(prompt);
    this.side.querySelectorAll<HTMLElement>('[data-tgt]').forEach((b) => (b.onclick = () => { this.sel.dst = b.dataset.tgt!; this.amount = this.t(this.sel.src)!.troops - 1; this.app.opts.play('click'); this.refresh(); }));
    const range = this.side.querySelector<HTMLInputElement>('[data-famt]');
    if (range) range.oninput = () => { this.amount = +range.value; this.renderSide(); };
    this.bind({
      fminus: () => { this.amount = Math.max(1, this.amount - 1); this.renderSide(); },
      fplus: () => { this.amount = Math.min(this.t(this.sel.src)!.troops - 1, this.amount + 1); this.renderSide(); },
      move: () => this.doFortify(),
      end: () => void this.endTurn(),
    });
  }

  private doFortify() {
    const run = this.run, { src, dst } = this.sel;
    if (!src || !dst) return;
    if (!safe(() => W.fortify(run, src, dst, this.amount), false)) return;
    this.app.opts.play('click');
    this.app.save();
    this.app.globe.setMarks({ sel: this.app.siteOf(dst), flash: [this.app.siteOf(dst)] });
    this.sel = { src: null, dst: null };
    this.coach?.event('fortify');
    this.refresh();
  }

  // --- a battle in progress ---
  private sidePending() {
    const run = this.run, p = run.pending!;
    this.side.innerHTML = `${this.head(tW('battle.inProgress'), tW('attack.arrow', { from: territoryName(p.from), to: territoryName(p.to) }))}
      <div class="wc-side-b">${this.terCard(p.from)}${this.terCard(p.to)}<p class="wc-p">${esc(tW('attack.fightForces', { a: fmtInt(p.attackers), d: fmtInt(p.defenders) }))}</p></div>
      <div class="wc-side-f">${this.battleSave() ? `<button class="wc-btn pri gold" data-act="resume">${picto('play')}${esc(tW('battle.resume'))}</button>` : ''}
        <div class="wc-row2"><button class="wc-btn ${this.battleSave() ? '' : 'pri gold'}" data-act="restart">${esc(tW('battle.restart'))}</button><button class="wc-btn danger" data-act="withdraw">${esc(tW('battle.withdraw'))}</button></div></div>`;
    this.setPrompt('');
    this.bind({
      resume: () => { const s = this.battleSave(); if (s) { this.app.opts.play('click'); const app = this.app; app.close(); app.opts.onResume(s); } },
      restart: () => { const setup = safe(() => W.pendingSetup(run), null); if (setup) this.deploy(setup); },
      withdraw: () => void this.app.confirm(tW('battle.withdrawConfirm'), tW('battle.withdraw')).then((ok) => { if (ok) { safe(() => W.withdrawBattle(run), undefined); this.app.save(); this.refresh(); void this.resumeFlow(); } }),
    });
  }

  /** The latest save game of the pending battle, if any. */
  private battleSave(): SaveData | null {
    const id = this.run.pending?.spec.id;
    if (!id) return null;
    let best: SaveData | null = null;
    for (const slot of ['conquest', 'auto', 'manual']) {
      const s = readSave(slot);
      // (the 'conquest' slot is shared with Europe Conquest: the run must match too)
      if (s?.game?.setup?.conquest?.battle?.id === id && s.game.setup.conquest.runId === this.run.id && (!best || s.savedAt > best.savedAt)) best = s;
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------------------------------
  tipFor(id: string): string | null {
    const run = this.run, k = ix(run).byId.get(id);
    if (k == null) return `<b>${esc(territoryName(id))}</b>`;
    const t = run.territories[k];
    const tr = this.shownTroops(k);
    return `<b>${esc(territoryName(id))}</b><small>${esc(ownerName(run, t.owner))} · ${tr == null ? '?' : fmtInt(tr)}</small>`;
  }

  onPick(site: number) {
    if (this.busy || this.run.pending) return;
    const id = this.app.idOfSite(site);
    this.pick(id);
  }

  /** Select a territory (globe tap, list view, keyboard). */
  pick(id: string | null) {
    const run = this.run, t = this.t(id);
    const s = this.sel;
    if (!id || !t) { if (s.src || s.dst) { this.sel = { src: null, dst: null }; this.refresh(); } return; }
    this.app.announce(tW('a11y.selected', { territory: territoryName(id) }));
    if (run.phase === 'reinforce') {
      if (!this.mine(t)) return;
      if (s.src === id && run.toPlace) { this.place(this.amount); return; } // a second tap places
      this.sel = { src: id, dst: null };
      this.app.opts.play('tab');
    } else if (run.phase === 'attack') {
      if (run.conquest) return;
      if (this.mine(t)) {
        this.sel = s.src === id ? { src: null, dst: null } : { src: id, dst: null };
      } else if (s.src && this.targets(s.src).includes(id)) {
        this.sel = { src: s.src, dst: id };
        this.coachTarget = null;
        this.coach?.event('target');
      } else {
        // an enemy territory: pick the strongest own neighbour that can attack it
        const from = this.neighbours(id).map((n) => this.t(n)!).filter((n) => this.mine(n) && this.targets(n.id).includes(id)).sort((a, b) => b.troops - a.troops)[0];
        if (!from) { this.whyNot(id); return; }
        this.sel = { src: from.id, dst: id };
        this.coachTarget = null;
        this.coach?.event('target');
      }
      this.app.opts.play('tab');
      if (this.sel.src && this.sel.dst) { const o = safe(() => W.attackOdds(run, this.sel.src!, this.sel.dst!), null); if (o) this.app.announce(`${tW('attack.arrow', { from: territoryName(this.sel.src), to: territoryName(this.sel.dst) })}. ${tW('attack.win')}: ${pct(o.win)}`); }
    } else {
      if (!run.fortifiesLeft) return;
      if (s.src && s.src !== id && this.fortifyTargets(s.src).includes(id)) { this.sel = { src: s.src, dst: id }; this.amount = this.t(s.src)!.troops - 1; }
      else if (this.mine(t) && t.troops >= 2) this.sel = s.src === id ? { src: null, dst: null } : { src: id, dst: null };
      else return;
      this.app.opts.play('tab');
    }
    this.refresh();
  }

  /** Say why a territory cannot be attacked (first turn, a ceasefire, no port, not adjacent, too few troops). */
  private whyNot(id: string) {
    const run = this.run;
    const own = this.neighbours(id).map((n) => this.t(n)!).filter((n) => this.mine(n)).sort((a, b) => b.troops - a.troops);
    const src = (this.sel.src && own.some((o) => o.id === this.sel.src) ? this.sel.src : own[0]?.id) ?? null;
    const why = src ? safe(() => W.attackBlock(run, src, id), null) ?? 'troops' : 'notAdjacent';
    const text = `${territoryName(id)}: ${tx(`world.block.${why}`, undefined, tW('attack.noTargets'))}`;
    this.app.toast(text, why === 'firstTurn' ? 'gold' : 'bad');
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.playing) { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { this.playing.skip(); return true; } return false; }
    if (this.busy) return false;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (this.list) { this.toggleList(); return true; }
      if (this.sel.dst) { this.sel.dst = null; this.refresh(); return true; }
      if (this.sel.src) { this.sel = { src: null, dst: null }; this.refresh(); return true; }
      openMenu(this.app, this);
      return true;
    }
    if (k === 'l') { this.toggleList(); return true; }
    if (k === 'c') { this.tool('cards'); return true; }
    if (k === 'r' && !this.sel.dst) { this.tool('rivals'); return true; }
    if (k === 'h' || e.key === '?') { this.tool('help'); return true; }
    if (this.run.phase === 'reinforce' && this.sel.src && (e.key === '+' || e.key === '=' || e.key === '-')) {
      this.amount = Math.max(1, Math.min(this.run.toPlace, this.amount + (e.key === '-' ? -1 : 1)));
      this.renderSide();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------------------------------
  // Phases, turns and the rivals' playback
  // ---------------------------------------------------------------------------------------------------
  endPhase() {
    const run = this.run;
    if (this.busy) return;
    if (run.phase === 'fortify') { void this.endTurn(); return; }
    this.app.opts.play('click');
    const ev = safe(() => W.endPhase(run), [] as WorldEvent[]);
    this.app.save();
    this.sel = { src: null, dst: null };
    this.lastPhase = run.phase; // (the coach may mark a target for the new phase right away)
    this.app.announce(tW('a11y.phaseNow', { phase: tW(`phase.${run.phase}`) }));
    this.coach?.event(`phase:${run.phase}`);
    if (run.phase === 'reinforce' && ev.length) void this.playback(ev); // (a phase that ended the turn)
    else this.refresh();
  }

  async endTurn() {
    const run = this.run;
    if (this.busy) return;
    this.app.opts.play('click');
    this.coach?.event('endTurn');
    this.sel = { src: null, dst: null };
    const before = JSON.parse(JSON.stringify(run)) as WorldRun;
    let ev: WorldEvent[] = [];
    try { ev = W.endTurn(run); } catch (e) { console.warn('endTurn failed', e); }
    this.app.save();
    await this.playback(ev, before);
  }

  /** Continue whatever the run is waiting on: a defence choice, then ceasefire offers. */
  async resumeFlow() {
    const run = this.run;
    if (run.status !== 'active') { this.refresh(); return; }
    if (run.defence && !run.pending) { await this.defence(); return; }
    // back from a defence battle in the middle of the rivals' turns: play the rest of them
    if (run.current !== run.player && !run.pending && this.resumes < 3) {
      const before = JSON.parse(JSON.stringify(run)) as WorldRun;
      let ev: WorldEvent[] = [];
      try { ev = W.endTurn(run); } catch (e) { console.warn('endTurn (resume) failed', e); }
      this.resumes = ev.length ? 0 : this.resumes + 1; // (never spin on a turn the rules cannot advance)
      this.app.save();
      await this.playback(ev, before);
      return;
    }
    if (run.offers?.length && !run.pending) await this.offers();
    this.refresh();
    // five cards or more: the tray opens by itself (a set must be traded before placing troops)
    if (run.phase === 'reinforce' && !run.pending && !this.app.modalOpen && safe(() => W.mustTrade(run), false)) openCards(this.app, () => this.refresh());
  }

  private async playback(ev: WorldEvent[], before?: WorldRun) {
    const app = this.app, run = this.run;
    const disp = before ?? (JSON.parse(JSON.stringify(run)) as WorldRun);
    const X = ix(disp);
    const tr = (id: string) => disp.territories[X.byId.get(id) ?? -1];
    const lost: string[] = [];
    const toasts: [string, '' | 'good' | 'bad' | 'gold'][] = [];
    for (const e of ev) {
      if (e.kind === 'conquer' && tr(e.to) && e.prev === run.player && e.power !== run.player) lost.push(e.to);
      if (e.kind === 'card' && e.power === run.player) toasts.push([tW('toast.card', { card: cardName(e.card) }), 'gold']);
      if (e.kind === 'zone' && e.power === run.player) toasts.push([tW('toast.zone', { zone: zoneName(e.zone), n: run.zones.find((z) => z.id === e.zone)?.bonus ?? 0 }), 'good']);
      if (e.kind === 'medal' && e.power === run.player) toasts.push([eventLine(run, e), 'gold']);
    }
    const rivalEvents = ev.filter((e) => e.power !== run.player && e.power >= 0 && ['turn', 'reinforce', 'attack', 'conquer', 'fortify', 'eliminated', 'ceasefire', 'break', 'refused'].includes(e.kind));
    if (rivalEvents.length && !app.reduce) {
      this.busy = true;
      this.setPrompt('');
      let skip = false;
      const bar = document.createElement('div');
      bar.className = 'wc-panel wc-play';
      bar.innerHTML = `<div class="who"></div><button class="wc-btn sm" data-skip>${picto('play')}${esc(tW('playback.skip'))}</button>`;
      app.stage.appendChild(bar);
      const who = bar.querySelector<HTMLElement>('.who')!;
      bar.querySelector<HTMLElement>('[data-skip]')!.onclick = () => { skip = true; };
      this.playing = { skip: () => { skip = true; } };
      app.root.classList.add('wc-playing');
      const per = Math.max(45, Math.min(260, 4200 / Math.max(1, rivalEvents.length))); // (a whole round of rivals in about 4-5 s)
      const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      const repaint = () => app.paint(disp, (k) => (disp.fog && disp.territories[k].owner !== run.player ? this.shownTroops(k) : disp.territories[k].troops));
      repaint();
      let reinforced: number[] = [];
      for (const e of rivalEvents) {
        if (skip) break;
        const color = powerColor(run, e.power);
        if (e.kind === 'turn') {
          who.innerHTML = `<span class="wc-sw" style="background:${hex(color)}"></span>${esc(tW('playback.turnOf', { power: powerName(run, e.power) }))}`;
          reinforced = [];
          await wait(per * 1.2);
          continue;
        }
        if (e.kind === 'reinforce') {
          const t = tr(e.to); if (t) t.troops += e.n;
          reinforced.push(app.siteOf(e.to));
          repaint();
          app.globe.setMarks({ flash: reinforced });
          await wait(per * 0.35);
          continue;
        }
        if (e.kind === 'attack') {
          const a = tr(e.from), d = tr(e.to);
          const steps = 6;
          for (let k = 1; k <= steps && !skip; k++) { app.globe.setArrows([{ from: app.siteOf(e.from), to: app.siteOf(e.to), kind: 'rival', color: hex(color), t: k / steps }]); await wait(per / steps); }
          if (a) a.troops = Math.max(1, a.troops - e.attLoss);
          if (d) d.troops = Math.max(0, d.troops - e.defLoss);
          repaint();
          app.globe.setMarks({ flash: [app.siteOf(e.to)] });
          await wait(per * 0.4);
          app.globe.setArrows([]);
          continue;
        }
        if (e.kind === 'conquer') {
          const a = tr(e.from), d = tr(e.to);
          if (d) { d.owner = e.power; d.troops = e.n; }
          if (a) a.troops = Math.max(1, a.troops - e.n);
          repaint();
          app.globe.setMarks({ flash: [app.siteOf(e.to)] });
          if (e.prev === run.player) app.globe.flyTo(d?.lon ?? 0, d?.lat ?? 0);
          await wait(per * (e.prev === run.player ? 2 : 0.6));
          continue;
        }
        if (e.kind === 'fortify') {
          const a = tr(e.from), d = tr(e.to);
          app.globe.setArrows([{ from: app.siteOf(e.from), to: app.siteOf(e.to), kind: 'fortify', color: hex(color) }]);
          if (a) a.troops -= e.n;
          if (d) d.troops += e.n;
          repaint();
          await wait(per * 0.6);
          app.globe.setArrows([]);
          continue;
        }
        if (e.kind === 'eliminated' || e.kind === 'break' || e.kind === 'ceasefire') {
          app.banner(tW('kick'), eventLine(run, e), color);
          await wait(per * 3);
        }
      }
      bar.remove();
      app.root.classList.remove('wc-playing');
      this.playing = null;
      this.busy = false;
    }
    // the real state
    for (const id of lost) toasts.unshift([tW('playback.lostOne', { territory: territoryName(id) }), 'bad']);
    if (rivalEvents.length && !lost.length && run.status === 'active' && !run.defence) toasts.unshift([tW('playback.quiet'), '']);
    for (const [text, kind] of toasts.slice(0, 4)) app.toast(text, kind);
    if (lost.length) app.opts.play('error'); else if (toasts.some(([, k]) => k === 'gold')) app.opts.play('ready_ping');
    if (run.status === 'active' && !run.defence && run.current === run.player && run.phase === 'reinforce') {
      app.banner(tW('playback.yourTurn'), tW('top.turn', { n: run.turn }));
      const mine = run.territories.filter((t) => t.owner === run.player).map((t) => app.siteOf(t.id));
      if (!lost.length) app.globe.frameSites(mine);
    }
    await this.resumeFlow();
  }

  /** A rival attacks one of your key territories: dice or fight it yourself. */
  private defence(): Promise<void> {
    const app = this.app, run = this.run, d = run.defence!;
    const odds = safe(() => W.attackOdds(run, d.from, d.to), null);
    const mine = this.t(d.to);
    app.globe.flyTo(mine?.lon ?? 0, mine?.lat ?? 0);
    app.globe.setArrows([{ from: app.siteOf(d.from), to: app.siteOf(d.to), kind: 'rival', color: hex(powerColor(run, d.power)) }]);
    return new Promise((resolve) => {
      let chosen = false;
      const m = app.modal(`<div class="wc-kick" style="color:#ff8a7a">${esc(tW('defence.title'))}</div><h2 class="wc-h1">${esc(territoryName(d.to))}</h2>
        <p class="wc-p">${esc(tW('defence.text', { power: powerName(run, d.power), n: fmtInt(d.attackers), from: territoryName(d.from), to: territoryName(d.to) }))}</p>
        ${this.terCard(d.to)}
        ${odds ? `<div class="wc-odds"><div class="wc-small">${esc(tW('defence.hold'))}</div><div class="pct ${1 - odds.win >= 0.6 ? 'good' : 1 - odds.win >= 0.35 ? 'mid' : 'bad'}">${pct(1 - odds.win)}</div></div>` : ''}
        <div class="acts"><button class="wc-btn" data-act="dice" data-focus>${picto('crate')}${esc(tW('defence.dice'))}</button><button class="wc-btn gold pri" data-act="fight">${picto('shield')}${esc(tW('defence.fight'))}</button></div>`, 'narrow', () => { if (!chosen) { chosen = true; void go('dice'); } });
      const go = async (how: 'dice' | 'fight') => {
        if (how === 'fight') {
          const setup = W.startDefenceBattle(run);
          if (!setup) { void go('dice'); return; }
          app.save();
          this.deploy(setup);
          resolve();
          return;
        }
        const before = JSON.parse(JSON.stringify(run)) as WorldRun;
        const r = safe(() => W.resolveDefence(run, 'dice'), null) as { rolls?: unknown } | WorldEvent[] | null;
        app.save();
        const rolls = r && !Array.isArray(r) && Array.isArray((r as { rolls?: unknown }).rolls) ? (r as { rolls: import('../../conquest/world/state').DiceRoll[] }).rolls : null;
        if (rolls) await showDice(app, rolls, { conquered: false });
        // the rest of the rivals' turns
        let ev: WorldEvent[] = Array.isArray(r) ? r : [];
        try { ev = ev.concat(W.endTurn(run)); } catch (e) { console.warn('endTurn after defence failed', e); }
        app.save();
        await this.playback(ev, before);
        resolve();
      };
      m.el.querySelector<HTMLElement>('[data-act="dice"]')!.onclick = () => { chosen = true; app.opts.play('click'); m.close(); void go('dice'); };
      m.el.querySelector<HTMLElement>('[data-act="fight"]')!.onclick = () => { chosen = true; app.opts.play('click'); m.close(); void go('fight'); };
    });
  }

  /** Rivals' ceasefire offers, one at a time. */
  private async offers() {
    const app = this.app, run = this.run;
    for (const o of [...(run.offers ?? [])]) {
      const yes = await new Promise<boolean>((resolve) => {
        let done = false;
        const m = app.modal(`<div class="wc-kick">${esc(tW('rivals.offerFrom'))}</div><h2 class="wc-h1" style="color:${hex(powerColor(run, o.power))}">${esc(powerName(run, o.power))}</h2>
          <p class="wc-p">${esc(tW('rivals.offerText', { power: powerName(run, o.power), n: o.turns }))}</p>
          <div class="acts"><button class="wc-btn" data-no>${esc(tW('rivals.declineOffer'))}</button><button class="wc-btn pri" data-yes data-focus>${esc(tW('rivals.acceptOffer'))}</button></div>`, 'narrow', () => { if (!done) resolve(false); });
        m.el.querySelector<HTMLElement>('[data-no]')!.onclick = () => { done = true; m.close(); resolve(false); };
        m.el.querySelector<HTMLElement>('[data-yes]')!.onclick = () => { done = true; app.opts.play('click'); m.close(); resolve(true); };
      });
      safe(() => W.answerOffer(run, o.power, yes), undefined);
      app.save();
    }
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch (e) { console.warn(e); return fallback; }
}

/** A wonder's effect while held (world.ts wonder.<kind>). */
function wonderText(id: string): string {
  const w = LANDMARK_INFO[id as LandmarkId]?.wonder;
  if (!w) return '';
  const n = 'add' in w ? w.add : 'pct' in w ? w.pct : 'every' in w ? w.every : 'dice' in w ? w.dice : 'turns' in w ? w.turns : 0;
  return tWorld(`wonder.${w.kind}` as Parameters<typeof tWorld>[0], { n });
}

function lineLabel(l: { key: string; n: number; zone?: string }): string {
  return tWorld(`reinforce.${l.key}` as Parameters<typeof tWorld>[0], { zone: l.zone ? zoneName(l.zone) : '' });
}
