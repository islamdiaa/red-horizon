import type { Player } from '../sim/player';
import type { World } from '../sim/world';
import { ICONS } from './icons';
import { esc } from './dom';
import { isTouchDevice } from './touch';
import { fillKeys } from './keymap';
import { ARIA_TEXT } from './a11y-strings';
import { ALERTS, AlertQueue, CoachWatch } from './coach';
import tHints from '../i18n/en/hints';
import tCommon from '../i18n/en/common';

type HintKey = Parameters<typeof tHints>[0];

interface Hint {
  /** The text (src/i18n/en/hints.ts), looked up when shown. */
  text: HintKey;
  /** Shown while this returns true; dismissed for good once `done` returns true. */
  done(w: World, p: Player): boolean;
}

/** Touch-screen wording of the steps and alerts that speak of clicks and keys. */
const TOUCH: Partial<Record<HintKey, HintKey>> = {
  'steps.deploy': 'touch.deploy', 'steps.power': 'touch.power', 'steps.barracks': 'touch.barracks', 'steps.factory': 'touch.factory', 'steps.keys': 'touch.keys',
  'alerts.idle': 'touch.idle', 'alerts.attackMove': 'touch.attackMove', 'alerts.together': 'touch.together', 'alerts.repair': 'touch.repair',
};
/** The wording for this device and HUD: touch screens speak of taps; the Modern HUD has a build bar, not a sidebar. */
const forDevice = (k: HintKey): HintKey => (isTouchDevice() ? TOUCH[k] ?? k : k === 'steps.power' && document.body.classList.contains('hud-modern') ? 'steps.powerBar' : k);

const HINTS: Hint[] = [
  { text: 'steps.deploy', done: (w, p) => p.has('fact') || w.time > 240 },
  { text: 'steps.power', done: (w, p) => p.has('powr') || p.has('apwr') || w.time > 300 },
  { text: 'steps.refinery', done: (w, p) => p.has('proc') || w.time > 420 },
  { text: 'steps.barracks', done: (w, p) => p.has('tent') || p.has('barr') || w.time > 480 },
  { text: 'steps.factory', done: (w, p) => p.has('weap') || w.time > 600 },
  { text: 'steps.radar', done: (w, p) => p.has('dome') || w.time > 720 },
  { text: 'steps.keys', done: (w) => w.time > 900 },
];

/** Small contextual tips for new players. */
export class Hints {
  private el: HTMLElement;
  private idx = -1;
  private dismissed = new Set<number>();
  /** Alerts already shown (index -> still showing). */
  /** The situational alerts (src/ui/coach.ts): which one is up, which were shown. */
  private alerts = new AlertQueue();
  private coach = new CoachWatch();
  enabled = true;

  /** What the match taught so far (the results screen's advice). */
  lessons() { return this.coach.lessons(); }

  constructor(parent: HTMLElement, private world: World, private local: Player) {
    this.el = document.createElement('div');
    this.el.className = 'hint panel';
    this.el.addEventListener('click', (e) => {
      // a touch screen dismisses with the × only: taps and drags on the map next to the panel land on it too
      if (isTouchDevice() && !(e.target as HTMLElement | null)?.closest?.('.hint-x')) return;
      if (this.alerts.current >= 0) { this.alerts.dismiss(); this.idx = -2; this.update(); return; }
      if (this.idx >= 0) this.dismissed.add(this.idx);
      this.show(-1);
    });
    parent.appendChild(this.el);
  }

  update() {
    if (!this.enabled) { this.show(-1); return; }
    const w = this.world, p = this.local;
    // campaign missions: the battle lessons only (the tutorial's build order is the mission's business)
    const coach = p.defeated || w.gameOver ? false : w.mission ? 'mission' : true;
    if (coach) this.coach.update(w, p);
    // a live situational alert takes priority over the tutorial
    const al = this.alerts.update(w, p, this.coach, coach);
    if (al.idx >= 0) {
      if (!al.fresh) return;
      const a = ALERTS[al.idx];
      const key = forDevice(typeof a.text === 'function' ? a.text(p, this.coach, w) : a.text);
      this.el.dataset.hint = key; // (for tests and the play matrix: which hint is up)
      this.render(`<span class="hint-k">${tHints.html('report')}</span><span class="hint-t">${fillKeys(tHints.html(key, { shift: tCommon('keys.shift'), alt: tCommon('keys.alt'), ...a.vars?.(w, p, this.coach) }))}</span>`); // (the active key bindings)
      this.idx = -2; // (the tutorial step redraws when the alert goes)
      return;
    }
    let next = -1;
    for (let i = 0; i < HINTS.length && !w.mission; i++) {
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
    this.el.dataset.hint = HINTS[i].text;
    const step = `${i + 1}/${HINTS.length}`;
    this.render(`<span class="hint-k">${tHints.html('manual')} <i>${step}</i></span><span class="hint-t">${fillKeys(tHints.html(forDevice(HINTS[i].text)))}</span>`); // (the active key bindings)
  }

  private render(body: string) {
    this.el.innerHTML = `<span class="hint-ic">${ICONS.bulb}</span><span class="hint-body">${body}</span><span class="hint-x" title="${esc(ARIA_TEXT.dismiss)}">${ICONS.close}</span>`;
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
  }
}
