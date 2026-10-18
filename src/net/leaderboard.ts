/**
 * Verified leaderboards in the browser: record ranked runs (Daily Challenge, Survival, built-in challenges),
 * offer to submit a finished one, and read the tops. The server re-simulates every submitted run
 * (src/net/verify.ts) before ranking it.
 *
 * What is sent: the callsign, the run's commands and result, and a random per-browser id (kept in
 * localStorage so a player keeps one entry per board-day). Nothing is sent unless the player presses Submit.
 */
import type { Game } from '../game';
import { boardOfSetup, utcDay, type BoardInfo, type BoardKind, type Submission } from './boards';
import { RunRecorder } from './runrecord';
import { relayHttpUrl } from './endpoint';
import { cleanName } from './names';
import { SURVIVAL_VARIANTS, currentDailyDay, parseCoopId } from '../missions/special';
import { BUILTINS } from '../modes/builtins';
import tNet from '../i18n/en/net';
import { dt, fmtInt, trSource } from '../i18n/core';
import { esc, el } from '../ui/dom';
import { picto } from '../meta/art';

const PLAYER_KEY = 'rh.lb.id';
const NAME_KEY = 'rh.net.name';

/** The random id this browser submits with (not personal; reset by clearing site data). */
export function playerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      const b = new Uint8Array(18);
      crypto.getRandomValues(b);
      id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    return 'anonymous-player-0000';
  }
}

export function callsign(): string {
  try { return cleanName(localStorage.getItem(NAME_KEY) ?? 'Commander'); } catch { return 'Commander'; }
}
export function setCallsign(n: string) {
  try { localStorage.setItem(NAME_KEY, cleanName(n)); } catch { /* */ }
}

export interface TopEntry { rank: number; name: string; score: number; seconds: number; won: boolean; at: number; you?: boolean }
export interface TopResponse { board: BoardInfo; day: string; today: string; days: string[]; entries: TopEntry[] }

async function post(path: string, body: unknown, timeoutMs = 10_000): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(relayHttpUrl(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
    const ok = (res.headers.get('content-type') ?? '').includes('json');
    return { status: res.status, json: ok ? await res.json() as Record<string, unknown> : null };
  } finally {
    clearTimeout(t);
  }
}

/** A board's top for a day (default today). null = no leaderboard server. */
export async function fetchTop(kind: BoardKind, id: string, day?: string): Promise<TopResponse | null> {
  try {
    const r = await post('lb/top', { kind, id, day, player: playerId() });
    if (r.status !== 200 || !r.json || r.json.ok !== true) return null;
    return r.json as unknown as TopResponse;
  } catch {
    return null;
  }
}

/**
 * A board's title in the player's language (BoardInfo.title is the English the server builds; the leaderboard
 * screens show this instead).
 */
export function boardTitle(b: BoardInfo): string {
  if (b.kind === 'daily') return tNet('board.daily');
  if (b.kind === 'challenge') { const c = Object.prototype.hasOwnProperty.call(BUILTINS, b.id) ? BUILTINS[b.id] : undefined; return c ? dt('builtin', c.def.id, 'title', c.def.title) : b.title; }
  const v = SURVIVAL_VARIANTS.find((x) => x.id === b.id);
  if (v) return tNet('board.survival', { front: dt('mission', v.id, 'title', v.title) });
  const p = parseCoopId(b.id);
  if (!p || !p.allies.length) return b.title;
  return tNet('board.coop', { front: dt('mission', p.variant.id, 'title', p.variant.title), n: p.allies.length, level: p.allies[0].difficulty });
}

/** `error` is in the player's language (the server's English is translated on arrival). */
export type SubmitResult = { ok: true; rank: number; score: number; day: string; improved: boolean } | { ok: false; error: string };

/** Submit a finished run; the server verifies it (a long run takes a few seconds). */
export async function submitRun(sub: Submission): Promise<SubmitResult> {
  try {
    const r = await post('lb/submit', sub, 150_000);
    if (r.json && r.json.ok === true) return r.json as unknown as SubmitResult;
    return { ok: false, error: typeof r.json?.error === 'string' ? trSource(r.json.error) : tNet('submit.unavailable', { status: String(r.status) }) };
  } catch {
    return { ok: false, error: tNet('submit.unreachable') };
  }
}

// ---------------------------------------------------------------------------------------------------------
// recording in the game
// ---------------------------------------------------------------------------------------------------------

export interface PendingRun { board: BoardInfo; rec: RunRecorder; submitted: boolean }
const pendingRuns = new Map<string, PendingRun>();

/** The finished, not yet submitted run of a board (the leaderboard screen offers it). */
export function pendingRun(id: string): PendingRun | null {
  const p = pendingRuns.get(id);
  return p && !p.submitted && p.rec.result && p.rec.result.score > 0 ? p : null;
}

/**
 * Record a ranked run in this game (main.ts, once the Game exists). `tainted`: test parameters changed the
 * world outside the command stream, so the run cannot be verified.
 */
export function attachLeaderboard(game: Game, opts: { tainted?: boolean; play?(k: 'click'): void } = {}) {
  const board = boardOfSetup(game.setup);
  if (!board || opts.tainted) return;
  const day = board.kind === 'daily' ? String(game.world.mission?.flags.day ?? currentDailyDay()) : utcDay(Date.now());
  const rec = new RunRecorder(game.world, board, day);
  const orig = game.issue.bind(game);
  game.issue = (cmd) => { if (!game.setup.replay) rec.record(cmd); orig(cmd); };
  const entry: PendingRun = { board, rec, submitted: false };
  rec.onEnd = (r) => {
    if (r.score <= 0 || rec.spoiled) return;
    pendingRuns.set(board.id, entry);
    // after the end screens have come up
    window.setTimeout(() => offerSubmit(entry, opts.play), 6500);
  };
}

/** The floating "submit to the global leaderboard" card. */
function offerSubmit(run: PendingRun, play?: (k: 'click') => void) {
  if (run.submitted || document.querySelector('.lbs-card')) return;
  ensureCss();
  const r = run.rec.result!;
  const card = el('div', 'lbs-card panel');
  card.innerHTML = `<div class="lbs-h">${picto('trophy', 'ic')}<div><small>${tNet.html('submit.kicker', { board: boardTitle(run.board) })}</small><b>${tNet.html('submit.score', { score: fmtInt(r.score) })}</b></div></div>
    <p>${tNet.html('submit.ask')}</p>
    <div class="lbs-row"><input type="text" maxlength="20" value="${esc(callsign())}" spellcheck="false" autocomplete="off"><button class="btn" data-a="go">${tNet.html('submit.submit')}</button><button class="btn" data-a="no">${tNet.html('submit.notNow')}</button></div>
    <div class="lbs-msg"></div>`;
  document.body.appendChild(card);
  const input = card.querySelector('input') as HTMLInputElement;
  input.onkeydown = (e) => e.stopPropagation();
  const msg = card.querySelector('.lbs-msg') as HTMLElement;
  (card.querySelector('[data-a="no"]') as HTMLElement).onclick = () => { play?.('click'); card.remove(); };
  (card.querySelector('[data-a="go"]') as HTMLButtonElement).onclick = async (e) => {
    play?.('click');
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    setCallsign(input.value);
    msg.textContent = tNet('submit.verifying');
    const res = await submitAndMark(run, input.value);
    msg.className = `lbs-msg ${res.ok ? 'ok' : 'bad'}`;
    msg.textContent = res.ok ? (res.rank ? tNet('submit.ranked', { rank: res.rank }) : tNet('submit.unranked')) : res.error;
    if (res.ok) setTimeout(() => card.remove(), 6000); else b.disabled = false;
  };
}

/** Submit a pending run (the card or the leaderboard screen). */
export async function submitAndMark(run: PendingRun, name: string): Promise<SubmitResult> {
  const sub = run.rec.submission(cleanName(name), playerId());
  if (!sub) return { ok: false, error: tNet('submit.cannot') };
  const res = await submitRun(sub);
  if (res.ok) run.submitted = true;
  return res;
}

const CSS = `
.lbs-card { position: fixed; right: 1.2rem; bottom: 1.2rem; z-index: 40; width: 25rem; border-radius: .9rem; padding: .9rem 1rem; display: flex; flex-direction: column; gap: .6rem; animation: panelIn .45s var(--spring) both; }
.lbs-h { display: flex; gap: .7rem; align-items: center; } .lbs-h .ic { font-size: 1.8rem; color: var(--gold); }
.lbs-h small { display: block; font-size: .65rem; letter-spacing: .22em; text-transform: uppercase; color: var(--accent); } .lbs-h b { font-size: 1.25rem; letter-spacing: .08em; }
.lbs-card p { margin: 0; font-size: .85rem; color: var(--text-2); line-height: 1.4; }
.lbs-row { display: flex; gap: .4rem; } .lbs-row input { flex: 1; min-width: 0; height: 2.4rem; border-radius: .5rem; border: 1px solid var(--line-2); background: rgba(0,0,0,.35); color: var(--text); font: 600 .95rem var(--font); padding: 0 .6rem; user-select: text; }
.lbs-row .btn { height: 2.4rem; padding: 0 .7rem; font-size: .72rem; }
.lbs-msg { font-size: .85rem; color: var(--muted); min-height: 1em; } .lbs-msg.ok { color: var(--ok); } .lbs-msg.bad { color: #ffb3a8; }
`;
function ensureCss() {
  if (document.getElementById('lbs-style')) return;
  const s = document.createElement('style');
  s.id = 'lbs-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}
