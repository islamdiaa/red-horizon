/**
 * The dice: a short, skippable roll (tap or any key skips; reduced motion shows the result without tumbling).
 * One roll shows both sets, the pairs compared highest first; Blitz flicks through its rolls with running totals.
 */
import type { DiceRoll } from '../../conquest/world/state';
import type { WorldApp } from './app';
import { dieHtml, esc, tW } from './view';

const sortDesc = (a: readonly number[]) => [...a].sort((x, y) => y - x);

export function showDice(app: WorldApp, rolls: DiceRoll[], o: { conquered: boolean; repulsed?: boolean }): Promise<void> {
  if (!rolls.length) return Promise.resolve();
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'wc-panel wc-dice';
    el.setAttribute('role', 'status');
    app.root.appendChild(el);
    let done = false;
    const timers: number[] = [];
    const finish = () => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      el.remove();
      resolve();
    };
    if ((window as unknown as { __wcHoldDice?: boolean }).__wcHoldDice) { (el as HTMLElement).dataset.hold = '1'; } // (screenshots)
    const onKey = (e: KeyboardEvent) => { if (e.key !== 'Tab') { e.preventDefault(); e.stopPropagation(); finish(); } };
    el.addEventListener('pointerdown', finish);
    window.addEventListener('keydown', onKey, true);
    const reduce = app.reduce;
    let attSum = 0, defSum = 0;
    const draw = (k: number, final: boolean) => {
      const r = rolls[k];
      attSum += r.attLoss; defSum += r.defLoss;
      const att = sortDesc(r.att), def = sortDesc(r.def);
      const pairs = Math.min(att.length, def.length);
      const attCls = att.map((v, i) => (i < pairs ? (v > def[i] ? 'won' : 'lost') : ''));
      const defCls = def.map((v, i) => (i < pairs ? (att[i] > v ? 'lost' : 'won') : ''));
      const roll = reduce ? '' : ' roll';
      el.innerHTML = `<div class="rows">
          <div class="lbl">${esc(tW('dice.you'))}</div><div class="set">${att.map((v, i) => dieHtml(v, `att${roll} ${final || reduce ? attCls[i] : ''}`)).join('')}</div>
          <div class="lbl">${esc(tW('dice.them'))}</div><div class="set">${def.map((v, i) => dieHtml(v, `def${roll} ${final || reduce ? defCls[i] : ''}`)).join('')}</div>
        </div>
        <div class="res"><span class="a">${esc(tW('attack.lossYou', { n: attSum }))}</span><span class="d">${esc(tW('attack.lossThem', { n: defSum }))}</span>${rolls.length > 1 ? `<span>${esc(tW('dice.rolls', { n: k + 1 }))}</span>` : ''}</div>
        ${final && o.conquered ? `<div class="big">${esc(tW('attack.conquered'))}</div>` : final && o.repulsed ? `<div class="big bad">${esc(tW('attack.repulsed'))}</div>` : ''}
        <div class="skip">${esc(tW('dice.skip'))}</div>`;
      if (!reduce && !final) {
        // mark the pairs once the dice land
        timers.push(window.setTimeout(() => {
          el.querySelectorAll('.wc-die.att').forEach((d, i) => attCls[i] && d.classList.add(attCls[i]));
          el.querySelectorAll('.wc-die.def').forEach((d, i) => defCls[i] && d.classList.add(defCls[i]));
        }, 420));
      }
    };
    if (reduce) {
      // the totals at once, then the last roll's dice
      for (let k = 0; k < rolls.length - 1; k++) { attSum += rolls[k].attLoss; defSum += rolls[k].defLoss; }
      draw(rolls.length - 1, true);
      if (!el.dataset.hold) timers.push(window.setTimeout(finish, 1100));
      return;
    }
    // a blitz flicks through at most ~8 rolls (the totals stay exact)
    const N = rolls.length;
    const shown = N <= 8 ? rolls.map((_, k) => k) : [0, 1, 2, ...Array.from({ length: 4 }, (_, j) => Math.round(3 + ((N - 5) * (j + 1)) / 5)), N - 1];
    let shownIdx = 0;
    const step = N === 1 ? 0 : 230;
    const next = () => {
      const k = shown[shownIdx];
      // (rolls skipped between shown ones still count in the totals)
      const prev = shownIdx ? shown[shownIdx - 1] : -1;
      for (let j = prev + 1; j < k; j++) { attSum += rolls[j].attLoss; defSum += rolls[j].defLoss; }
      const final = shownIdx === shown.length - 1;
      draw(k, final);
      shownIdx++;
      if (!final) timers.push(window.setTimeout(next, step));
      else if (!el.dataset.hold) timers.push(window.setTimeout(finish, N === 1 ? 1250 : 1400));
    };
    next();
  });
}
