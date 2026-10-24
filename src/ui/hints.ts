import type { Player } from '../sim/player';
import type { World } from '../sim/world';
import { ICONS } from './icons';
import { esc } from './dom';
import { isTouchDevice } from './touch';
import { fillKeys } from './keymap';
import { ARIA_TEXT } from './a11y-strings';
import { ALERTS, AlertQueue, CoachWatch, coachTick } from './coach';
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
  'alerts.bankLoop': 'touch.bankLoop', 'alerts.closeFinish': 'touch.closeFinish', 'alerts.closeAdvantage': 'touch.closeAdvantage',
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
  /**
   * Radar pings and camera moves for alerts that point at places (the close-out alert's last known enemy structures),
   * set by the game; without it those alerts show no Show button.
   */
  pointAt: { ping(x: number, y: number): void; look(x: number, y: number): void } | null = null;
  /** The places the alert on show points at, and the one Show looks at next. */
  private spots: { x: number; y: number }[] = [];
  private spot = 0;
  /** Counts renders (data-seq), so a reader can tell a repeated alert from the same one still on show. */
  private seq = 0;

  /** What the match taught so far (the results screen's advice). */
  lessons() { return this.coach.lessons(); }

  constructor(parent: HTMLElement, private world: World, private local: Player) {
    this.el = document.createElement('div');
    this.el.className = 'hint panel';
    this.el.addEventListener('click', (e) => {
      // Show: the camera goes to the next place the alert points at (and the radar pings it again)
      if ((e.target as HTMLElement | null)?.closest?.('.hint-go')) { this.lookNext(); return; }
      // a touch screen dismisses with the × only: taps and drags on the map next to the panel land on it too
      if (isTouchDevice() && !(e.target as HTMLElement | null)?.closest?.('.hint-x')) return;
      if (this.alerts.current >= 0) { this.alerts.dismiss(); this.idx = -2; this.update(); return; }
      if (this.idx >= 0) this.dismissed.add(this.idx);
      this.idx = -2; // (so show(-1) always takes the panel down, also one put up without a step: render())
      this.show(-1);
    });
    parent.appendChild(this.el);
  }

  update() {
    const w = this.world, p = this.local;
    // the coaching watch follows the match even with the Field Manual off; campaign missions get the battle lessons
    // only (the tutorial's build order is the mission's business); nothing once the player is out (coach.ts coachMode)
    const al = coachTick(this.coach, this.alerts, w, p, this.enabled);
    if (!this.enabled || p.resigned || !p.isHuman) { this.show(-1); return; } // (a surrendered side: nothing to teach)
    // a live situational alert takes priority over the tutorial
    if (al.idx >= 0) {
      if (!al.fresh) return;
      const a = ALERTS[al.idx];
      const key = forDevice(typeof a.text === 'function' ? a.text(p, this.coach, w) : a.text);
      this.el.dataset.hint = key; // (for tests and the play matrix: which hint is up)
      // the bank reminder: the unit cards show their loop buttons while it is up (they otherwise appear on hover)
      document.body.classList.toggle('coach-loop', key === 'alerts.bankLoop' || key === 'touch.bankLoop');
      // places to point at: pinged on the radar now, and a Show button that takes the camera there
      this.spots = (this.pointAt && a.targets?.(w, p, this.coach)) || [];
      this.spot = 0;
      for (const s of this.spots) this.pointAt!.ping(s.x, s.y);
      const go = this.spots.length ? `<button type="button" class="hint-go" data-x="${this.spots[0].x.toFixed(1)}" data-y="${this.spots[0].y.toFixed(1)}">${tHints.html('show')}</button>` : '';
      this.render(`<span class="hint-k">${tHints.html('report')}</span><span class="hint-t">${fillKeys(tHints.html(key, { shift: tCommon('keys.shift'), alt: tCommon('keys.alt'), ...a.vars?.(w, p, this.coach) }))}</span>${go}`); // (the active key bindings)
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
    document.body.classList.remove('coach-loop');
    if (i < 0) { this.el.classList.remove('on'); return; }
    this.el.dataset.hint = HINTS[i].text;
    const step = `${i + 1}/${HINTS.length}`;
    this.render(`<span class="hint-k">${tHints.html('manual')} <i>${step}</i></span><span class="hint-t">${fillKeys(tHints.html(forDevice(HINTS[i].text)))}</span>`); // (the active key bindings)
  }

  /** The Show button: look at the next place the alert points at (they take turns), and ping it. */
  private lookNext() {
    const s = this.spots[this.spot % Math.max(1, this.spots.length)];
    if (!s || !this.pointAt) return;
    this.pointAt.look(s.x, s.y);
    this.pointAt.ping(s.x, s.y);
    this.spot++;
    const n = this.spots[this.spot % this.spots.length];
    const b = this.el.querySelector<HTMLElement>('.hint-go');
    if (b) { b.dataset.x = n.x.toFixed(1); b.dataset.y = n.y.toFixed(1); }
  }

  private render(body: string) {
    this.el.dataset.seq = String(++this.seq);
    this.el.innerHTML = `<span class="hint-ic">${ICONS.bulb}</span><span class="hint-body">${body}</span><span class="hint-x" title="${esc(ARIA_TEXT.dismiss)}">${ICONS.close}</span>`;
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
  }
}
