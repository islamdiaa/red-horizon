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

/** Small contextual tips for new players. */
export class Hints {
  private el: HTMLElement;
  private idx = -1;
  private dismissed = new Set<number>();
  enabled = true;

  constructor(parent: HTMLElement, private world: World, private local: Player) {
    this.el = document.createElement('div');
    this.el.className = 'hint panel';
    this.el.addEventListener('click', () => { if (this.idx >= 0) this.dismissed.add(this.idx); this.show(-1); });
    parent.appendChild(this.el);
  }

  update() {
    if (!this.enabled) { this.show(-1); return; }
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
    this.el.innerHTML = `<span class="hint-ic">${ICONS.bulb}</span><span class="hint-body"><span class="hint-k">Field manual <i>${step}</i></span><span class="hint-t">${HINTS[i].text}</span></span><span class="hint-x" title="Dismiss">${ICONS.close}</span>`;
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
  }
}
