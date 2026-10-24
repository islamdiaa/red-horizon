/**
 * The accessible list view of the world: every territory of the run, grouped by bonus zone, as buttons a keyboard
 * or a screen reader can use exactly like taps on the globe (arrows move, Enter selects, Esc returns to the globe).
 */
import { ix } from '../../conquest/world/state';
import type { WorldApp } from './app';
import type { TurnView } from './turn';
import { esc, fmtInt, hex, ownerName, powerColor, territoryName, tW, zoneName } from './view';

export class ListView {
  readonly el: HTMLElement;
  private focusId: string | null = null;

  constructor(private app: WorldApp, private turn: TurnView) {
    this.el = document.createElement('div');
    this.el.className = 'wc-list';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', tW('list.title'));
    app.stage.appendChild(this.el);
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  destroy() { this.el.remove(); }

  focus() {
    const b = this.el.querySelector<HTMLElement>('.wc-row.sel') ?? this.el.querySelector<HTMLElement>('.wc-row');
    b?.focus();
  }

  render() {
    const run = this.app.run;
    if (!run) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && this.el.contains(active)) this.focusId = active.dataset.id ?? this.focusId;
    const X = ix(run);
    const sel = this.turn.sel;
    const targets = new Set(sel.src ? this.turn.targets(sel.src) : []);
    const scroll = this.el.scrollTop;
    this.el.innerHTML = `<h2 class="wc-h1">${esc(tW('list.title'))}</h2>` + run.zones.map((z, zi) => {
      const ts = X.zoneT[zi] ?? [];
      const holder = ts.length && ts.every((i) => run.territories[i].owner === run.territories[ts[0]].owner) ? run.territories[ts[0]].owner : null;
      return `<section aria-label="${esc(tW('list.zone', { zone: zoneName(z.id), n: z.bonus }))}"><h3>${holder != null && holder >= 0 ? `<span class="wc-sw" style="background:${hex(powerColor(run, holder))}"></span>` : ''}${esc(tW('list.zone', { zone: zoneName(z.id), n: z.bonus }))}</h3>
        ${ts.map((k) => {
          const t = run.territories[k];
          const tr = this.turn.shownTroops(k);
          const flags = [t.capital !== undefined ? tW('list.capital') : '', t.landmark ? tW('list.wonder') : '', targets.has(t.id) ? tW('list.target') : '', sel.src === t.id || sel.dst === t.id ? tW('list.source') : ''].filter(Boolean);
          const label = `${tW('list.row', { territory: territoryName(t.id), owner: ownerName(run, t.owner), n: tr ?? 0 })}${flags.length ? ` (${flags.join(', ')})` : ''}`;
          const cls = `${sel.src === t.id || sel.dst === t.id ? 'sel' : ''} ${targets.has(t.id) ? 'target' : ''}`;
          return `<button class="wc-row ${cls}" data-id="${esc(t.id)}" aria-label="${esc(label)}" aria-pressed="${sel.src === t.id || sel.dst === t.id}">
            <span class="wc-sw" style="background:${hex(powerColor(run, t.owner))}"></span><span class="nm">${t.capital !== undefined ? '★ ' : ''}${esc(territoryName(t.id))}</span><span class="ow">${esc(ownerName(run, t.owner))}</span><span class="tr">${tr == null ? '?' : fmtInt(tr)}</span></button>`;
        }).join('')}</section>`;
    }).join('');
    this.el.scrollTop = scroll;
    this.el.querySelectorAll<HTMLElement>('.wc-row').forEach((b) => (b.onclick = () => { this.focusId = b.dataset.id!; this.turn.pick(b.dataset.id!); }));
    if (this.focusId) this.el.querySelector<HTMLElement>(`.wc-row[data-id="${CSS.escape(this.focusId)}"]`)?.focus();
  }

  private onKey(e: KeyboardEvent) {
    const rows = [...this.el.querySelectorAll<HTMLElement>('.wc-row')];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    let j = -1;
    if (e.key === 'ArrowDown') j = Math.min(rows.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = rows.length - 1;
    else if (e.key === 'PageDown') j = Math.min(rows.length - 1, i + 8);
    else if (e.key === 'PageUp') j = Math.max(0, i - 8);
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    rows[j]?.focus();
    this.focusId = rows[j]?.dataset.id ?? null;
  }
}
