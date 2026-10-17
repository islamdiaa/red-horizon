import type { Player } from '../sim/player';
import type { World } from '../sim/world';
import { ICONS } from './icons';

interface Hint {
  text: string;
  /** Shown while this returns true; dismissed for good once `done` returns true. */
  done(w: World, p: Player): boolean;
}

const HINTS: Hint[] = [
  { text: 'Select your <b>MCV</b> and press <kbd>D</kbd> (or click it again) to deploy a Construction Yard.', done: (w, p) => p.has('fact') || w.time > 240 },
  { text: 'Build a <b>Power Plant</b> from the sidebar, then click the map to place it next to your base.', done: (w, p) => p.has('powr') || p.has('apwr') || w.time > 300 },
  { text: 'An <b>Ore Refinery</b> comes with an Ore Truck — your source of income.', done: (w, p) => p.has('proc') || w.time > 420 },
  { text: 'Train infantry at the <b>Barracks</b>. Right-click the ground to move, right-click enemies to attack.', done: (w, p) => p.has('tent') || p.has('barr') || w.time > 480 },
  { text: 'A <b>War Factory</b> unlocks tanks. Right-click the map with a factory selected to set a rally point.', done: (w, p) => p.has('weap') || w.time > 600 },
  { text: 'A <b>Radar Dome</b> powers the minimap. Keep an eye on your power bar — low power slows everything.', done: (w, p) => p.has('dome') || w.time > 720 },
  { text: 'Tip: <kbd>Ctrl</kbd>+<kbd>1-9</kbd> assigns control groups, <kbd>A</kbd> attack-moves, <kbd>Space</kbd> jumps to the last attack.', done: (w) => w.time > 900 },
];

/** Situational warnings: shown (above the tutorial steps) while `when` holds, at most once per match. */
interface Alert {
  text: string;
  when(w: World, p: Player): boolean;
}

const hasDefences = (w: World, p: Player) => w.buildings.some((b) => b.alive && b.owner === p && !b.bt.wall && !!b.bt.primary);

const ALERTS: Alert[] = [
  {
    text: '<b>Ore storage is full.</b> Refined ore beyond your capacity is lost — build an <b>Ore Silo</b> or spend your credits.',
    when: (_w, p) => p.storage > 0 && p.ore >= p.storage - 1,
  },
  {
    text: 'Enemy attack waves usually arrive within a few minutes. Cover your refinery with a <b>Pillbox</b>, <b>Turret</b> or <b>Flame Tower</b>.',
    when: (w, p) => w.time > 210 && w.time < 600 && !hasDefences(w, p) && w.buildings.some((b) => b.alive && b.owner === p && b.bt.id === 'proc'),
  },
  // Commander economy (sim/economy.ts)
  {
    text: 'Your Construction Yard can climb to <b>Tier 2</b>: select it and pick the upgrade. It opens the Research Lab, the Tech Centre, the Ore Purifier and more.',
    when: (w, p) => !!p.econ && p.econ.tier === 1 && w.time > 240 && p.credits >= 1000 && p.has('proc') && (p.has('tent') || p.has('barr')) && !w.buildings.some((b) => b.owner === p && b.task),
  },
  {
    text: 'Your <b>Research Lab</b> is idle: select it and open the <b>research tree</b>. Research upgrades your whole army.',
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
      this.render(`<span class="hint-k">Field report</span><span class="hint-t">${ALERTS[i].text}</span>`);
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
    this.render(`<span class="hint-k">Field manual <i>${step}</i></span><span class="hint-t">${HINTS[i].text}</span>`);
  }

  private render(body: string) {
    this.el.innerHTML = `<span class="hint-ic">${ICONS.bulb}</span><span class="hint-body">${body}</span><span class="hint-x" title="Dismiss">${ICONS.close}</span>`;
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
  }
}
