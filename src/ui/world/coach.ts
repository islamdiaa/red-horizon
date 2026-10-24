/**
 * The first-turn coach (Field Manual style, 5 short steps): place troops, pick the marked easy target, fight it
 * yourself (or roll), fortify and end the turn, watch the rivals. It gets a newcomer into an easy RTS battle within
 * about a minute. Shown on a player's first campaign only; "Got it" dismisses it for good.
 */
import { ICONS } from '../icons';
import type { WorldApp } from './app';
import type { TurnView } from './turn';
import { esc, tW } from './view';
import { W } from './api';

const KEY = 'rh.world.coach';
const STEPS = ['place', 'attack', 'fight', 'fortify', 'rivals'] as const;
type Step = typeof STEPS[number];

function stored(): number {
  try { return Math.max(0, Math.min(STEPS.length, parseInt(localStorage.getItem(KEY) ?? '0', 10) || 0)); } catch { return STEPS.length; }
}

/**
 * Battle kinds by how kind they are to a newcomer: a land assault, then a hold, then a capture (it needs an Engineer,
 * a unit a first-time player has not met: the coach says so), the rest, a sea crossing last.
 */
const KIND_RANK: Record<string, number> = { assault: 0, hold: 1, capture: 2, defend: 3, boss: 4, naval: 5 };

/**
 * The first battle to suggest, by KIND_RANK (assault, hold, capture, ..., a sea crossing only when nothing else
 * exists); among those the weakest defender against the biggest stack.
 */
export function easyTarget(run: import('../../conquest/world/state').WorldRun): { from: string; to: string; kind: string } | null {
  let best: { from: string; to: string; kind: string; score: number } | null = null;
  let list: { from: string; to: string; sea: boolean }[] = [];
  try { list = W.attackTargets(run); } catch { return null; }
  for (const a of list) {
    const f = run.territories.find((t) => t.id === a.from), t = run.territories.find((x) => x.id === a.to);
    if (!f || !t) continue;
    let kind = 'assault';
    try { kind = W.attackKind(run, a.from, a.to); } catch { /* */ }
    if (a.sea) kind = 'naval';
    const score = (KIND_RANK[kind] ?? 3) * 1000 + (t.owner === -1 ? 0 : 100) - Math.min(99, (f.troops - 1) / Math.max(1, t.troops));
    if (!best || score < best.score) best = { from: a.from, to: a.to, kind, score };
  }
  return best ? { from: best.from, to: best.to, kind: best.kind } : null;
}

export class Coach {
  private el: HTMLElement;
  private step: number;
  private shown: Step | null = null;
  private marked = false;
  /** The marked first battle's kind (a sea crossing or a capture gets its own coach line). */
  private kind = '';

  /** A coach for this turn screen, if the player still has steps to see. */
  static maybe(app: WorldApp, turn: TurnView): Coach | null {
    // test screens show the coach only when asked for (&coach=1), and never move the player's own progress
    if (app.demo && new URLSearchParams(location.search).get('coach') !== '1') return null;
    const n = stored();
    if (n >= STEPS.length || !app.run || app.run.turn > 3) return null;
    return new Coach(app, turn, n);
  }

  private constructor(private app: WorldApp, private turn: TurnView, step: number) {
    this.step = step;
    this.el = document.createElement('div');
    this.el.className = 'wc-coach';
    this.el.setAttribute('role', 'note');
    this.el.style.display = 'none';
    app.root.appendChild(this.el);
  }

  destroy() {
    this.el.remove();
    document.querySelectorAll('.wc-glow').forEach((e) => e.classList.remove('wc-glow'));
  }

  private advance(to: number) {
    if (to <= this.step) return;
    this.step = to;
    this.app.store.set(KEY, String(to));
    this.update();
  }

  /** Something happened on the turn screen. */
  event(k: string) {
    const s = STEPS[this.step];
    if (s === 'place' && k === 'phase:attack') this.advance(1);
    else if (s === 'attack' && k === 'target') this.advance(2);
    else if ((s === 'fight' || s === 'attack') && (k === 'fight' || k === 'roll')) this.advance(3);
    else if (s === 'fortify' && (k === 'endTurn' || k === 'fortify')) this.advance(k === 'endTurn' ? 4 : 3);
    else if (s === 'rivals' && k === 'endTurn') this.advance(5);
  }

  /** Show the current step if it fits the phase (called on every refresh). */
  update() {
    const run = this.app.run;
    document.querySelectorAll('.wc-glow').forEach((e) => e.classList.remove('wc-glow'));
    if (!run || this.step >= STEPS.length || run.status !== 'active') { this.hide(); return; }
    let s: Step = STEPS[this.step];
    // a step that does not fit the phase waits (or is skipped when the player is ahead of it)
    if (s === 'place' && run.phase !== 'reinforce') { this.step = 1; this.app.store.set(KEY, '1'); s = 'attack'; }
    if ((s === 'attack' || s === 'fight') && run.phase === 'fortify') { this.step = 3; this.app.store.set(KEY, '3'); s = 'fortify'; }
    if (s === 'rivals' && run.turn >= 2) { this.advance(5); return; } // (shown while the rivals played: done once your turn is back)
    const ok = (s === 'place' && run.phase === 'reinforce') || ((s === 'attack' || s === 'fight') && run.phase === 'attack' && !run.conquest)
      || (s === 'fortify' && (run.phase === 'fortify' || run.phase === 'attack') && !run.conquest) || s === 'rivals';
    if (!ok || run.pending) { this.hide(); return; }
    if (s === 'attack' && !this.marked) this.markTarget();
    const sel = this.turn.sel;
    if (s === 'attack' && sel.src && sel.dst) { this.advance(2); return; }
    this.show(s);
    // point at the control the step talks about
    const glow = s === 'place' ? (run.toPlace ? '[data-act="all"]' : '[data-act="next"]') : s === 'fight' ? '[data-act="fight"]' : s === 'fortify' ? (run.phase === 'attack' ? '[data-act="fortify"]' : '[data-act="end"]') : null;
    if (glow) this.app.root.querySelector(glow)?.classList.add('wc-glow');
  }

  /** Mark the easiest first battle (easyTarget) and select where it starts from, so the next tap shows its odds. */
  private markTarget() {
    this.marked = true;
    const run = this.app.run!;
    const pick = easyTarget(run);
    if (!pick) return;
    this.kind = pick.kind;
    this.turn.sel = { src: pick.from, dst: null };
    this.turn.coachTarget = pick.to;
    this.app.globe.frameSites([this.app.siteOf(pick.from), this.app.siteOf(pick.to)]);
    queueMicrotask(() => this.turn.refresh());
  }

  private show(s: Step) {
    if (this.shown === s && this.el.style.display !== 'none') return;
    this.shown = s;
    const n = STEPS.indexOf(s) + 1;
    this.el.innerHTML = `<span class="ic">${ICONS.bulb}</span><div><div class="k">${esc(tW('coach.kick'))} · ${esc(tW('coach.step', { n, total: STEPS.length }))}</div><div class="t">${tW.html(s === 'fight' && this.kind === 'naval' ? 'coach.fightNaval' : s === 'fight' && this.kind === 'capture' ? 'coach.fightCapture' : `coach.${s}`)}</div>
      <button class="wc-btn sm" data-skip>${esc(tW('coach.skip'))}</button></div>`;
    this.el.style.display = '';
    this.el.querySelector<HTMLElement>('[data-skip]')!.onclick = () => { this.app.opts.play('click'); this.step = STEPS.length; this.app.store.set(KEY, String(STEPS.length)); this.hide(); document.querySelectorAll('.wc-glow').forEach((e) => e.classList.remove('wc-glow')); };
    this.app.announce(this.el.querySelector('.t')?.textContent ?? '');
  }

  private hide() {
    this.el.style.display = 'none';
    this.shown = null;
  }
}
