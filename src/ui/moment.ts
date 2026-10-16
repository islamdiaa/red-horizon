/**
 * Replay player: "This moment" panel. From the paused replay moment, either take command of any player
 * (a branch: a new live game from this exact state) or turn the moment into a challenge (side, goal,
 * time limit) to save, play or export.
 */
import type { Game } from '../game';
import type { AIDifficulty } from '../sim/ai';
import { Building } from '../sim/entities';
import { DT } from '../sim/types';
import type { ReplayData } from '../replay/format';
import { snapshotWorld } from '../replay/branch';
import { challengeFromState, defaultTitle, notableTargets, sourceAI } from '../modes/author';
import { goalText } from '../modes/challenge';
import { exportChallenge, saveChallenge } from '../modes/store';
import type { ChallengeDef, ChallengeGoal, ChallengeGoalKind } from '../modes/types';
import { formatTime } from '../core/util';
import { ICONS, factionEmblem } from './icons';
import { el, esc, hexColor } from './dom';
import { picto } from '../meta';
import { ensureModesCss } from './modes-css';

export interface MomentPanelOptions {
  game: Game;
  data: ReplayData;
  /** Player being viewed (-1 = observer). */
  view: number;
  tab: 'take' | 'challenge';
  onTake(local: number, ai: AIDifficulty): void;
  onPlayChallenge(c: ChallengeDef): void;
  onClose(): void;
}

const DIFFS: [AIDifficulty, string][] = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['brutal', 'Brutal']];
const GOALS: [ChallengeGoalKind, string, string][] = [
  ['win', 'Win', 'defeat every enemy'], ['survive', 'Survive', 'stay in the fight'], ['destroy', 'Destroy', 'a target structure'],
  ['protect', 'Protect', 'keep a structure'], ['hold', 'Hold', 'the area in view'],
];

/** Open the panel; returns a close function. */
export function openMomentPanel(o: MomentPanelOptions): () => void {
  ensureModesCss();
  const g = o.game, w = g.world, d = o.data;
  const tick = w.tick;
  const humans = w.players.filter((p) => p.isHuman).map((p) => p.id);
  let side = o.view >= 0 && !w.players[o.view]?.defeated ? o.view : d.local;
  let ai: AIDifficulty = sourceAI(d.setup);
  let tab = o.tab;
  let goal: ChallengeGoalKind = 'win';
  let limit = 900, duration = 180, holdSecs = 60, target = '';
  let title = '', titleEdited = false;
  const cam = g.gfx.cam;
  const zone = (() => { const [x, y] = w.findFreeSpot(cam.x, cam.y, 6); return { x, y, r: 5 }; })();

  const ov = el('div', 'mx-overlay');
  const panel = el('div', 'mx-panel panel');
  ov.appendChild(panel);
  document.body.appendChild(ov);
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  window.addEventListener('keydown', keys, true);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', keys, true);
    ov.classList.add('leaving');
    setTimeout(() => ov.remove(), 220);
    o.onClose();
  };
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });

  const render = () => {
    const over = w.gameOver;
    const me = w.players[side];
    const tg = notableTargets(w, side);
    const opts = goal === 'destroy' ? tg.enemy : goal === 'protect' ? tg.own : [];
    if (opts.length && !opts.some((x) => x.key === target)) target = (opts.find((x) => /:fact$/.test(x.key)) ?? opts[0]).key;
    if (!titleEdited) title = defaultTitle(d.mapName, tick, goal);
    const former = humans.filter((id) => id !== side);
    panel.innerHTML = `<div class="mx-head"><span class="mx-ic">${ICONS.replay}</span><div><small>${esc(d.mapName)} · ${formatTime(tick * DT)}</small><h2>This moment</h2></div>
        <button class="mx-x" data-a="close" title="Close (Esc)">${ICONS.close}</button></div>
      <div class="mx-tabs"><button class="mx-tab${tab === 'take' ? ' on' : ''}" data-tab="take">${ICONS.flag}<span>Take command</span></button>
        <button class="mx-tab${tab === 'challenge' ? ' on' : ''}" data-tab="challenge">${picto('trophy', 'ic')}<span>Make a challenge</span></button></div>
      <div class="mx-sec">${tab === 'take' ? 'Command' : 'Challenger plays'}</div>
      <div class="mo-players">${w.players.map((p) => {
        let army = 0, blds = 0;
        for (const u of w.units) if (u.alive && u.owner === p && u.weapons.length && !u.ut.harvester) army++;
        for (const b of w.buildings) if (b.alive && b.owner === p && b instanceof Building && !b.bt.wall) blds++;
        return `<button class="mo-pl${p.id === side ? ' on' : ''}${p.defeated ? ' dead' : ''}" data-side="${p.id}" ${p.defeated ? 'disabled' : ''} style="--c:${hexColor(p.color)}">
          <span class="em">${factionEmblem(p.faction)}</span><b>${esc(p.name)}</b><small><span>$${p.credits.toLocaleString('en-US')}</span><span>${army} units</span><span>${blds} bldg</span></small>${p.isHuman ? '<em>Recorded</em>' : ''}</button>`;
      }).join('')}</div>
      ${former.length ? `<div class="mx-sec">Their old commander</div><div class="mx-row"><span class="mx-note">${former.map((id) => `<b>${esc(w.players[id].name)}</b>`).join(', ')} will be played by the AI:</span>
        ${DIFFS.map(([k, l]) => `<button class="mx-chip${ai === k ? ' on' : ''}" data-ai="${k}">${l}</button>`).join('')}</div>` : ''}
      ${tab === 'take' ? `
        <div class="mx-sec">Rewind &amp; take command</div>
        <div class="mx-note">${over ? '<span class="bad">The match is already over at this moment. Rewind to an earlier point to take command.</span>'
          : `A new live game starts from this exact moment with you in command of <b>${esc(me?.name ?? '')}</b>; every other player is AI. It is recorded as a branch of this replay, so it shows under it in the Replays list.`}</div>
        <div class="mx-actions"><button class="btn-primary" data-a="take" ${over || !me || me.defeated ? 'disabled' : ''}>${ICONS.play}<span>Take command</span></button></div>`
      : `
        <div class="mx-sec">Goal</div>
        <div class="mo-goal">${GOALS.map(([k, l, s]) => `<button class="mx-chip${goal === k ? ' on' : ''}" data-goal="${k}">${l}<small>${s}</small></button>`).join('')}</div>
        <div class="mo-params">${params(opts)}</div>
        <div class="mx-sec">Title</div>
        <div class="mx-row"><input class="mx-input" data-a="title" maxlength="60" value="${esc(title)}"></div>
        <div class="mx-note" style="margin-top:.5rem">${esc(goalText(currentGoal(opts), currentLimit()))} · as ${esc(me?.name ?? '')}</div>
        <div class="mx-note bad" data-a="msg"></div>
        <div class="mx-actions"><button class="btn-primary" data-a="play" ${over ? 'disabled' : ''}>${ICONS.play}<span>Play now</span></button>
          <button class="btn" data-a="save" ${over ? 'disabled' : ''}>${ICONS.check}<span>Save</span></button><button class="btn" data-a="export" ${over ? 'disabled' : ''}>${ICONS.download}<span>Export</span></button></div>`}`;
    bind(opts);
  };

  const chips = (vals: number[], cur: number, attr: string, fmt = (v: number) => formatTime(v)) =>
    vals.map((v) => `<button class="mx-chip${cur === v ? ' on' : ''}" data-${attr}="${v}">${fmt(v)}</button>`).join('');
  const params = (opts: { key: string; label: string }[]) => {
    switch (goal) {
      case 'win': return `<div class="mx-row"><span class="mx-note">Time limit</span>${chips([300, 600, 900, 1200, 1800], limit, 'limit')}</div>`;
      case 'survive': return `<div class="mx-row"><span class="mx-note">Survive for</span>${chips([120, 180, 300, 480], duration, 'dur')}</div>`;
      case 'destroy': return opts.length ? `<div class="mx-row"><span class="mx-note">Target</span><select class="mx-select" data-a="target">${opts.map((x) => `<option value="${x.key}"${x.key === target ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
        <div class="mx-row"><span class="mx-note">Time limit</span>${chips([180, 300, 600, 900], limit, 'limit')}</div>` : '<div class="mx-note bad">No enemy structures to destroy at this moment.</div>';
      case 'protect': return opts.length ? `<div class="mx-row"><span class="mx-note">Protect</span><select class="mx-select" data-a="target">${opts.map((x) => `<option value="${x.key}"${x.key === target ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
        <div class="mx-row"><span class="mx-note">for</span>${chips([120, 180, 300, 480], duration, 'dur')}</div>` : '<div class="mx-note bad">This side has no structures to protect at this moment.</div>';
      case 'hold': return `<div class="mx-note">Zone: the point at the centre of your view (${zone.x.toFixed(0)}, ${zone.y.toFixed(0)}), radius ${zone.r}. Move the camera before opening this panel to choose another spot.</div>
        <div class="mx-row"><span class="mx-note">Hold for</span>${chips([30, 60, 90, 120, 180], holdSecs, 'hold')}<span class="mx-note">within</span>${chips([180, 300, 480, 600], limit, 'limit')}</div>`;
    }
  };
  const currentLimit = () => (goal === 'survive' || goal === 'protect' ? duration : limit);
  const currentGoal = (opts: { key: string; ids: number[]; label: string }[]): ChallengeGoal => {
    const t = opts.find((x) => x.key === target);
    switch (goal) {
      case 'win': return { kind: 'win' };
      case 'survive': return { kind: 'survive', seconds: duration };
      case 'destroy': return { kind: 'destroy', targets: t?.ids ?? [], label: t ? `Destroy: ${t.label} within ${formatTime(limit)}` : undefined };
      case 'protect': return { kind: 'protect', targets: t?.ids ?? [], label: t ? `Protect: ${t.label.replace(/ · .*$/, '')} for ${formatTime(duration)}` : undefined };
      case 'hold': return { kind: 'hold', seconds: holdSecs, x: zone.x, y: zone.y, r: zone.r };
    }
  };
  const build = (opts: { key: string; ids: number[]; label: string }[]): ChallengeDef | null => {
    const gl = currentGoal(opts);
    if ((gl.kind === 'destroy' || gl.kind === 'protect') && !gl.targets?.length) return null;
    return challengeFromState({
      setup: d.setup, state: snapshotWorld(w), side, ai, goal: gl, timeLimit: currentLimit(), title,
      view: { cam: { x: cam.x, y: cam.y, dist: cam.targetDist, yaw: cam.targetYaw }, hours: g.hours, ...weather(g) },
      description: `${goalText(gl, currentLimit())}. From ${d.mapName} at ${formatTime(tick * DT)}, as ${w.players[side]?.name ?? 'commander'}.`,
      par: gl.kind === 'win' || gl.kind === 'destroy' || gl.kind === 'hold' ? { time: Math.round(currentLimit() * 0.55) } : { losses: 8 },
      source: { kind: 'replay', replayId: d.id, tick, map: d.mapName },
    });
  };

  const bind = (opts: { key: string; ids: number[]; label: string }[]) => {
    const on = (sel: string, fn: (b: HTMLElement) => void) => panel.querySelectorAll<HTMLElement>(sel).forEach((b) => { b.onclick = () => fn(b); });
    on('[data-a="close"]', () => close());
    on('[data-tab]', (b) => { tab = b.dataset.tab as 'take' | 'challenge'; render(); });
    on('[data-side]', (b) => { side = +b.dataset.side!; render(); });
    on('[data-ai]', (b) => { ai = b.dataset.ai as AIDifficulty; render(); });
    on('[data-goal]', (b) => { goal = b.dataset.goal as ChallengeGoalKind; if (goal === 'destroy' || goal === 'hold') limit = Math.min(limit, 600); render(); });
    on('[data-limit]', (b) => { limit = +b.dataset.limit!; render(); });
    on('[data-dur]', (b) => { duration = +b.dataset.dur!; render(); });
    on('[data-hold]', (b) => { holdSecs = +b.dataset.hold!; render(); });
    const sel = panel.querySelector<HTMLSelectElement>('[data-a="target"]');
    if (sel) sel.onchange = () => { target = sel.value; render(); };
    const inp = panel.querySelector<HTMLInputElement>('[data-a="title"]');
    if (inp) inp.oninput = () => { title = inp.value; titleEdited = true; };
    const msg = (t: string, ok = false) => { const m = panel.querySelector<HTMLElement>('[data-a="msg"]'); if (m) { m.textContent = t; m.classList.toggle('bad', !ok); } };
    on('[data-a="take"]', () => { close(); o.onTake(side, ai); });
    on('[data-a="play"]', () => { const c = build(opts); if (!c) return msg('Pick a target first.'); void saveChallenge(c).catch(() => {}); close(); o.onPlayChallenge(c); });
    on('[data-a="save"]', (b) => {
      const c = build(opts);
      if (!c) return msg('Pick a target first.');
      saveChallenge(c).then(() => { msg('Saved: find it under Challenges › Scenario challenges.', true); b.setAttribute('disabled', ''); }).catch(() => msg('Could not save the challenge.'));
    });
    on('[data-a="export"]', () => { const c = build(opts); if (!c) return msg('Pick a target first.'); void exportChallenge(c); });
  };

  render();
  return close;
}

/** Weather sequence position of a running game (so a branch keeps the sky it had). */
export function weather(g: Game): { wxIdx?: number; wxTimer?: number } {
  const x = g as unknown as { wxIdx?: number; wxTimer?: number };
  return { wxIdx: x.wxIdx, wxTimer: x.wxTimer };
}
