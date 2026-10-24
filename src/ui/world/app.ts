/**
 * The World Conquest screen shell: one root element, one globe shared by every view (setup, turn, endings), the
 * modal / toast / confirm helpers and the run's persistence. Views (setup.ts, turn.ts, end.ts) mount into it.
 */
import type { SaveData } from '../../sim/save';
import type { ConquestSetup } from '../../conquest/battle';
import type { WorldRun } from '../../conquest/world/state';
import { focusTrap, srAnnounce } from '../a11y';
import { reducedMotion } from '../dom';
import { Globe, type GlobeCell } from './globe';
import { allSites, geography, runSites, type Geography, type Sites } from './data';
import { injectCss } from './css';
import { WorldStore } from './store';
import { esc, hex, powerColor, tW, NEUTRAL_COLOR } from './view';
import { landmarkIcon } from './icons';

/** The interface sounds the world screens use (src/audio SfxKey names). */
export type WorldSfx = 'click' | 'tab' | 'error' | 'ready_ping' | 'promote' | 'milestone';

export interface WorldUiOptions {
  play(k: WorldSfx): void;
  quality: 'low' | 'medium' | 'high';
  /** Back to the main menu. */
  onBack(): void;
  /** Start a battle (main.ts deployConquest). */
  onDeploy(setup: ConquestSetup): void;
  /** Resume a battle from its save game. */
  onResume(save: SaveData): void;
  /** Tests / screenshots: ?world=<demo> (debug builds or ?debug=1 only, see entry.ts demoAllowed). */
  demo?: string;
}

export interface View { destroy(): void; onKey?(e: KeyboardEvent): boolean; onPick?(site: number): void; onHover?(site: number, x: number, y: number): void }

export class WorldApp {
  readonly root: HTMLElement;
  readonly stage: HTMLElement;
  readonly globe: Globe;
  readonly geo: Geography;
  /** The globe's current sites (every region on the setup screen, the run's map in a campaign). */
  sites: Sites;
  run: WorldRun | null = null;
  view: View | null = null;
  /** The views (set by index.ts, which imports them all: no import cycles between the views). */
  nav!: { setup(init?: { step?: 1 | 2 }): void; turn(o?: { fresh?: boolean }): void; end(): void };
  private modals: { el: HTMLElement; close(): void }[] = [];
  private untrap: (() => void) | null = null;
  private toasts: HTMLElement;
  private tip: HTMLElement;
  private closed = false;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  readonly reduce = reducedMotion();
  /** A test screen (?world=<state>): nothing is written to the player's storage (store.ts). */
  readonly demo: boolean;
  readonly store: WorldStore;

  constructor(readonly opts: WorldUiOptions) {
    this.demo = !!opts.demo && opts.demo !== 'ui';
    this.store = new WorldStore(this.demo);
    injectCss();
    this.geo = geography();
    this.root = document.createElement('div');
    this.root.className = 'wc';
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', tW('title'));
    this.stage = document.createElement('div');
    this.stage.className = 'wc-stage';
    this.root.appendChild(this.stage);
    this.globe = new Globe({
      quality: opts.quality, reducedMotion: this.reduce,
      onPick: (i) => this.view?.onPick?.(i),
      onHover: (i, x, y) => { this.view?.onHover?.(i, x, y); this.showTip(i, x, y); },
      icon: (id) => landmarkIcon(id, () => this.globe.setCells(this.cellsCache)),
    });
    this.globe.el.setAttribute('role', 'img');
    this.stage.appendChild(this.globe.el);
    this.sites = allSites();
    this.globe.setWorld(this.sites.world);
    this.globe.el.setAttribute('aria-label', tW('a11y.globe', { n: this.sites.ids.length }));
    this.toasts = document.createElement('div');
    this.toasts.className = 'wc-toasts';
    this.toasts.setAttribute('aria-live', 'polite');
    this.tip = document.createElement('div');
    this.tip.className = 'wc-tip';
    this.tip.style.display = 'none';
    this.stage.appendChild(this.tip);
    this.root.appendChild(this.toasts);
    document.body.appendChild(this.root);
    this.untrap = focusTrap(this.root, { initial: false, restore: false });
    window.addEventListener('keydown', this.keyHandler);
    (window as unknown as { __world?: WorldApp }).__world = this; // (tests: tools/e2e, screenshots)
  }

  // ---------------------------------------------------------------------------------------------------
  /** Show the setup screen's world (null) or a run's map on the globe. */
  useSites(run: WorldRun | null) {
    const s = run ? runSites(run) : allSites();
    if (s.key === this.sites.key) return;
    this.sites = s;
    this.globe.setWorld(s.world);
    this.globe.el.setAttribute('aria-label', tW('a11y.globe', { n: run ? run.territories.length : s.ids.length }));
  }

  setView(v: View | null) {
    this.view?.destroy();
    this.view = v;
  }

  save() {
    this.store.save(this.run);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.setView(null);
    for (const m of [...this.modals]) m.close();
    window.removeEventListener('keydown', this.keyHandler);
    this.untrap?.();
    this.globe.dispose();
    this.root.remove();
    document.body.classList.remove('faction-soviet');
    if ((window as unknown as { __world?: WorldApp }).__world === this) delete (window as unknown as { __world?: WorldApp }).__world;
  }

  back() {
    this.opts.play('click');
    this.close();
    this.opts.onBack();
  }

  private onKey(e: KeyboardEvent) {
    if (this.modals.length) {
      if (e.key === 'Escape') { e.preventDefault(); this.modals[this.modals.length - 1].close(); }
      return;
    }
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (this.view?.onKey?.(e)) { e.preventDefault(); return; }
    // globe keys
    const step = e.shiftKey ? 20 : 8;
    if (e.key === 'ArrowLeft') this.globe.rotateBy(-step, 0);
    else if (e.key === 'ArrowRight') this.globe.rotateBy(step, 0);
    else if (e.key === 'ArrowUp') this.globe.rotateBy(0, step * 0.6);
    else if (e.key === 'ArrowDown') this.globe.rotateBy(0, -step * 0.6);
    else if (e.key === '+' || e.key === '=') this.globe.zoomBy(0.8);
    else if (e.key === '-' || e.key === '_') this.globe.zoomBy(1.25);
    else return;
    e.preventDefault();
  }

  // ---------------------------------------------------------------------------------------------------
  // Globe state from the run
  // ---------------------------------------------------------------------------------------------------
  private cellsCache: GlobeCell[] = [];

  /** Colour the globe from a run (or the given display copy of it, during playback). */
  paint(run: WorldRun | null = this.run, troopsOf?: (i: number) => number | null) {
    const cells: GlobeCell[] = this.sites.ids.map(() => ({ color: 0x2a3644, troops: 0, dim: true }));
    if (run) {
      run.territories.forEach((t, k) => {
        const i = this.sites.index.get(t.id);
        if (i == null) return;
        const tr = troopsOf ? troopsOf(k) : t.troops;
        cells[i] = {
          color: powerColor(run, t.owner), troops: tr ?? 0, capital: t.capital !== undefined, landmark: t.landmark,
          hatch: t.owner !== run.player && t.owner >= 0, mine: t.owner === run.player, mark: tr == null ? '?' : undefined,
        };
      });
    }
    this.cellsCache = cells;
    this.globe.setCells(cells);
  }

  /** Paint arbitrary cells (setup screen). */
  paintCells(cells: GlobeCell[]) {
    this.cellsCache = cells;
    this.globe.setCells(cells);
  }

  siteOf(id: string): number { return this.sites.index.get(id) ?? -1; }
  idOfSite(i: number): string | null { return i >= 0 && i < this.sites.ids.length ? this.sites.ids[i] : null; }

  private showTip(i: number, x: number, y: number) {
    const id = this.idOfSite(i);
    const txt = id ? this.view && (this.view as { tipFor?(id: string): string | null }).tipFor?.(id) : null;
    if (!txt) { this.tip.style.display = 'none'; return; }
    this.tip.innerHTML = txt;
    this.tip.style.display = '';
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
  }

  // ---------------------------------------------------------------------------------------------------
  // Modals, toasts, confirm
  // ---------------------------------------------------------------------------------------------------
  modal(inner: string, cls = '', onClose?: () => void): { el: HTMLElement; dlg: HTMLElement; close(): void } {
    const host = document.createElement('div');
    host.className = 'wc-modal';
    host.innerHTML = `<div class="wc-panel wc-dlg ${cls}" role="dialog" aria-modal="true">${inner}<button class="wc-x" data-close aria-label="${esc(tW('setup.back'))}">×</button></div>`;
    document.body.appendChild(host);
    const dlg = host.firstElementChild as HTMLElement;
    const untrap = focusTrap(host, { initial: dlg.querySelector<HTMLElement>('[data-focus]') ?? undefined, restore: true });
    const entry = {
      el: host, dlg,
      close: () => {
        if (!host.isConnected) return;
        untrap();
        host.remove();
        this.modals = this.modals.filter((m) => m !== entry);
        onClose?.();
      },
    };
    host.addEventListener('pointerdown', (e) => { if (e.target === host) entry.close(); });
    host.querySelector<HTMLElement>('[data-close]')!.onclick = () => { this.opts.play('click'); entry.close(); };
    this.modals.push(entry);
    return entry;
  }

  get modalOpen() { return this.modals.length > 0; }

  confirm(text: string, yes: string, danger = true): Promise<boolean> {
    return new Promise((res) => {
      let done = false;
      const m = this.modal(`<p class="wc-p" style="margin-top:8px;padding-right:36px">${esc(text)}</p><div class="acts"><button class="wc-btn" data-no>${esc(tW('setup.back'))}</button><button class="wc-btn pri ${danger ? 'danger' : ''}" data-yes data-focus>${esc(yes)}</button></div>`, 'narrow', () => { if (!done) res(false); });
      m.el.querySelector<HTMLElement>('[data-no]')!.onclick = () => { done = true; m.close(); res(false); };
      m.el.querySelector<HTMLElement>('[data-yes]')!.onclick = () => { done = true; this.opts.play('click'); m.close(); res(true); };
    });
  }

  toast(text: string, kind: '' | 'good' | 'bad' | 'gold' = '') {
    const t = document.createElement('div');
    t.className = `wc-toast ${kind}`;
    t.textContent = text;
    this.toasts.appendChild(t);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => t.remove(), 3500);
    srAnnounce(text);
  }

  banner(kick: string, title: string, color?: number) {
    const b = document.createElement('div');
    b.className = 'wc-banner';
    b.innerHTML = `<small>${esc(kick)}</small><b${color != null ? ` style="color:${hex(color)}"` : ''}>${esc(title)}</b>`;
    this.root.appendChild(b);
    setTimeout(() => b.remove(), this.reduce ? 900 : 1700);
  }

  announce(text: string) { srAnnounce(text); }
}

export const NEUTRAL = NEUTRAL_COLOR;

/** The menu entry's badge for a real run (after a battle: no screen, no demo). */
export function writeBadge(run: WorldRun | null) {
  new WorldStore(false).badge(run);
}
