import type { Player } from '../sim/player';
import type { World } from '../sim/world';
import { ICONS } from './icons';
import { esc } from './dom';
import { fillKeys } from './keymap';
import { ARIA_TEXT } from './a11y-strings';
import tHints from '../i18n/en/hints';

type HintKey = Parameters<typeof tHints>[0];

interface Hint {
  /** The text (src/i18n/en/hints.ts), looked up when shown. */
  text: HintKey;
  /** Shown while this returns true; dismissed for good once `done` returns true. */
  done(w: World, p: Player): boolean;
}

const HINTS: Hint[] = [
  { text: 'steps.deploy', done: (w, p) => p.has('fact') || w.time > 240 },
  { text: 'steps.power', done: (w, p) => p.has('powr') || p.has('apwr') || w.time > 300 },
  { text: 'steps.refinery', done: (w, p) => p.has('proc') || w.time > 420 },
  { text: 'steps.barracks', done: (w, p) => p.has('tent') || p.has('barr') || w.time > 480 },
  { text: 'steps.factory', done: (w, p) => p.has('weap') || w.time > 600 },
  { text: 'steps.radar', done: (w, p) => p.has('dome') || w.time > 720 },
  { text: 'steps.keys', done: (w) => w.time > 900 },
];

/** Situational warnings: shown (above the tutorial steps) while `when` holds, at most once per match. */
interface Alert {
  text: HintKey;
  when(w: World, p: Player): boolean;
}

const hasDefences = (w: World, p: Player) => w.buildings.some((b) => b.alive && b.owner === p && !b.bt.wall && !!b.bt.primary);

const ALERTS: Alert[] = [
  {
    text: 'alerts.storage',
    when: (_w, p) => p.storage > 0 && p.ore >= p.storage - 1,
  },
  {
    text: 'alerts.defences',
    when: (w, p) => w.time > 210 && w.time < 600 && !hasDefences(w, p) && w.buildings.some((b) => b.alive && b.owner === p && b.bt.id === 'proc'),
  },
  // Commander economy (sim/economy.ts)
  {
    text: 'alerts.tier2',
    when: (w, p) => !!p.econ && p.econ.tier === 1 && w.time > 240 && p.credits >= 1000 && p.has('proc') && (p.has('tent') || p.has('barr')) && !w.buildings.some((b) => b.owner === p && b.task),
  },
  {
    text: 'alerts.research',
    when: (w, p) => !!p.econ && !Object.keys(p.econ.levels).length && w.buildings.some((b) => b.alive && b.owner === p && b.bt.id === 'rlab' && b.buildAnim >= 1 && !b.task),
  },
];

/** Small contextual tips for new players. */
export class Hints {
  private el: HTMLElement;
  private idx = -1;
  private dismissed = new Set<number>();
  /** Alerts already shown (index -> still showing). */
  private alertShown = new Map<number, boolean>();
  private alertIdx = -1;
  enabled = true;

  constructor(parent: HTMLElement, private world: World, private local: Player) {
    this.el = document.createElement('div');
    this.el.className = 'hint panel';
    this.el.addEventListener('click', () => {
      if (this.alertIdx >= 0) { this.alertShown.set(this.alertIdx, false); this.alertIdx = -1; this.idx = -2; this.update(); return; }
      if (this.idx >= 0) this.dismissed.add(this.idx);
      this.show(-1);
    });
    parent.appendChild(this.el);
  }

  update() {
    if (!this.enabled) { this.show(-1); return; }
    // a live situational alert takes priority over the tutorial
    if (this.alertIdx >= 0) {
      if (this.alertShown.get(this.alertIdx) && ALERTS[this.alertIdx].when(this.world, this.local)) return;
      this.alertShown.set(this.alertIdx, false);
      this.alertIdx = -1;
      this.idx = -2; // force the tutorial step to redraw
    }
    for (let i = 0; i < ALERTS.length; i++) {
      if (this.alertShown.has(i) || !ALERTS[i].when(this.world, this.local)) continue;
      this.alertShown.set(i, true);
      this.alertIdx = i;
      this.render(`<span class="hint-k">${tHints.html('report')}</span><span class="hint-t">${tHints.html(ALERTS[i].text)}</span>`);
      return;
    }
    let next = -1;
    for (let i = 0; i < HINTS.length; i++) {
      if (this.dismissed.has(i)) continue;
      if (HINTS[i].done(this.world, this.local)) { this.dismissed.add(i); continue; }
      next = i;
      break;
    }
    this.show(next);
  }

  private show(i: number) {
    if (i === this.idx) return;
    this.idx = i;
    if (i < 0) { this.el.classList.remove('on'); return; }
    const step = `${i + 1}/${HINTS.length}`;
    this.render(`<span class="hint-k">${tHints.html('manual')} <i>${step}</i></span><span class="hint-t">${fillKeys(tHints.html(HINTS[i].text))}</span>`); // (the active key bindings)
  }

  private render(body: string) {
    this.el.innerHTML = `<span class="hint-ic">${ICONS.bulb}</span><span class="hint-body">${body}</span><span class="hint-x" title="${esc(ARIA_TEXT.dismiss)}">${ICONS.close}</span>`;
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
  }
}
