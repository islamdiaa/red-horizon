/**
 * Multiplayer lobby: create a room or join one by code or invite link, then the room itself - the players and
 * their seats, ready states, the match settings (the host edits, everyone sees them), AI seats, chat (escaped,
 * rate-limited, with mute) and the invite link. Starting the match hands the connection to the game
 * (src/net/game-link.ts).
 *
 * Privacy: nothing leaves the browser until the player creates or joins a room; then the relay sees a callsign
 * (shown to the room) and the connection. The callsign is kept in localStorage, the seat token for a rejoin
 * after a reload in sessionStorage (this tab only).
 */
import type { GameSetup } from '../game';
import type { Quality } from '../render/renderer';
import { esc, el, hexColor } from './dom';
import { ICONS } from './icons';
import { picto } from '../meta/art';
import { NetClient } from '../net/client';
import { BUILD_FINGERPRINT } from '../net/fingerprint';
import { inviteLink, relaySocketUrl, serverStatus, type ServerStatus } from '../net/endpoint';
import { MAX_SLOTS, normaliseCode, type MatchStart, type RoomView, type ServerMessage, type SlotView } from '../net/protocol';
import {
  CEASEFIRE_OPTIONS, CLIMATES, CREDIT_OPTIONS, MAP_SIZES, MODES, SLOT_COLORS, activeSlots, mapsFor, modeSlots, slotTeam, startProblem,
  type FactionPick, type MatchSettings, type NetMode,
} from '../net/settings';
import { matchSetup } from '../net/roster';
import { cleanName } from '../net/names';
import { setPendingMatch, currentLink } from '../net/game-link';
import { activeModSet } from '../mods';
import { MUTATORS, mutatorEligible } from '../modes/mutators';
import { doctrinesFor, doctrineUnlocked } from '../sim/doctrine';
import { loadProfile } from '../meta/profile';
import { rankIndexFor } from '../meta/ranks';
import { getMapDef } from '../maps';

export interface LobbyHost {
  play(k: 'click' | 'hover' | 'tab' | 'error' | 'ready_ping'): void;
  quality(): Quality;
  /** Back to the main menu. */
  back(): void;
  /** Start the match (build the Game for this setup). */
  start(setup: GameSetup): void;
}

const NAME_KEY = 'rh.net.name';
const SEAT_KEY = 'rh.net.seat';

const CSS = `
.lob { position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(2,5,9,.5), rgba(0,0,0,.86)); backdrop-filter: blur(3px); animation: screenIn .45s var(--ease) both; }
.lob.leaving { animation: screenOut .3s var(--ease) both; }
.lob-panel { position: relative; width: min(74rem, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow: auto; border-radius: 1rem; padding: 1.3rem 1.5rem 1.4rem; display: flex; flex-direction: column; gap: 1rem; }
.lob-panel.narrow { width: min(46rem, calc(100vw - 2rem)); }
.lob-head { display: flex; align-items: center; gap: .9rem; }
.lob-head h2 { margin: 0; font-size: 1.6rem; letter-spacing: .24em; text-transform: uppercase; color: #fff; line-height: 1; }
.lob-head small { display: block; font-size: max(.66rem, 8.5px); font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: var(--accent); margin-bottom: .3rem; }
.lob-head .sp { flex: 1; }
.lob-pill { display: inline-flex; align-items: center; gap: .4rem; padding: .3rem .65rem; border-radius: 1rem; font-size: .75rem; letter-spacing: .14em; text-transform: uppercase; color: var(--text-2); border: 1px solid var(--line-2); background: rgba(255,255,255,.04); }
.lob-pill i { width: .5rem; height: .5rem; border-radius: 50%; background: var(--muted); } .lob-pill.ok i { background: var(--ok); box-shadow: 0 0 .5rem var(--ok); } .lob-pill.bad i { background: var(--danger); }
.lob-sec { display: flex; flex-direction: column; gap: .55rem; }
.lob-label { font-size: max(.66rem, 8.5px); font-weight: 700; letter-spacing: .26em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: .5rem; }
.lob-label::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, var(--line-2), transparent); }
.lob input[type=text] { height: 2.6rem; border-radius: .55rem; border: 1px solid var(--line-2); background: rgba(0,0,0,.35); color: var(--text); font: 600 1rem var(--font); letter-spacing: .06em; padding: 0 .8rem; user-select: text; min-width: 0; }
.lob input[type=text]:focus { outline: none; border-color: rgba(var(--accent-rgb), .7); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), .15); }
.lob input.code { font-family: var(--mono); font-size: 1.3rem; letter-spacing: .35em; text-transform: uppercase; width: 11rem; text-align: center; }
.lob-row { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
.lob-modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: .55rem; }
.lob-mode { padding: .75rem .8rem; border-radius: .7rem; border: 1px solid var(--line-2); background: rgba(255,255,255,.03); cursor: pointer; text-align: left; color: var(--text); transition: all .18s var(--ease); }
.lob-mode b { display: block; font-size: 1.05rem; letter-spacing: .12em; text-transform: uppercase; } .lob-mode span { font-size: .8rem; color: var(--muted); line-height: 1.3; display: block; margin-top: .2rem; }
.lob-mode:hover { border-color: rgba(var(--accent-rgb), .5); } .lob-mode.on { border-color: rgba(var(--accent-rgb), .9); background: rgba(var(--accent-rgb), .13); box-shadow: 0 0 1rem rgba(var(--accent-rgb), .2); }
.lob-note { font-size: .8rem; color: var(--muted); line-height: 1.45; }
.lob-err { padding: .55rem .8rem; border-radius: .55rem; border: 1px solid rgba(var(--danger-rgb), .5); background: rgba(var(--danger-rgb), .12); color: #ffd2cc; font-size: .9rem; }
.lob-code { display: flex; align-items: center; gap: .6rem; padding: .4rem .5rem .4rem .9rem; border-radius: .7rem; border: 1px solid rgba(var(--accent-rgb), .45); background: rgba(var(--accent-rgb), .08); }
.lob-code b { font-family: var(--mono); font-size: 1.5rem; letter-spacing: .3em; color: #fff; font-weight: 400; }
.lob-grid { display: grid; grid-template-columns: 1fr 1.05fr; gap: 1rem; flex-shrink: 0; }
.lob-slots { display: flex; flex-direction: column; gap: .45rem; }
.lob-slot { display: flex; align-items: center; gap: .6rem; min-height: 3.3rem; padding: .45rem .6rem; border-radius: .65rem; border: 1px solid var(--line-2); background: rgba(255,255,255,.03); }
.lob-slot.me { border-color: rgba(var(--accent-rgb), .6); background: rgba(var(--accent-rgb), .08); }
.lob-slot.closed { opacity: .45; }
.lob-slot .sw { width: .5rem; align-self: stretch; border-radius: .3rem; background: var(--c); box-shadow: 0 0 .6rem var(--c); }
.lob-slot .tm { font: 700 .65rem var(--font); letter-spacing: .2em; color: var(--muted); width: 3.1rem; text-transform: uppercase; }
.lob-slot .nm { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.lob-slot .nm b { font-size: 1.02rem; letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lob-slot .nm small { font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.lob-slot .st { font: 700 .7rem var(--font); letter-spacing: .18em; text-transform: uppercase; padding: .25rem .5rem; border-radius: .4rem; border: 1px solid var(--line-2); color: var(--muted); }
.lob-slot .st.ready { color: var(--ok); border-color: rgba(var(--ok-rgb), .5); background: rgba(var(--ok-rgb), .1); }
.lob-slot .st.off { color: var(--warn); border-color: rgba(var(--warn-rgb), .5); }
.lob select { height: 2.2rem; border-radius: .5rem; border: 1px solid var(--line-2); background: #0b1118; color: var(--text); font: 600 .85rem var(--font); letter-spacing: .05em; padding: 0 .45rem; cursor: pointer; max-width: 12rem; }
.lob select:disabled { opacity: .8; cursor: default; }
.lob-ib { width: 2.1rem; height: 2.1rem; border-radius: .5rem; border: 1px solid var(--line-2); background: rgba(255,255,255,.04); cursor: pointer; display: grid; place-items: center; font-size: 1rem; color: var(--text-2); flex-shrink: 0; }
.lob-ib:hover { color: #fff; border-color: rgba(var(--accent-rgb), .6); } .lob-ib.on { color: var(--warn); border-color: rgba(var(--warn-rgb), .5); } .lob-ib.danger:hover { border-color: rgba(var(--danger-rgb), .7); color: #ffb3a8; }
.lob-set { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: .4rem .6rem; align-items: center; font-size: .9rem; }
.lob-set select { width: 100%; max-width: none; }
.lob-set .wide { grid-column: 2 / -1; }
.lob-set > span { color: var(--muted); font-size: .7rem; letter-spacing: .14em; text-transform: uppercase; white-space: nowrap; }
.lob-set > b { font-weight: 600; color: var(--text); }
.lob-muts { display: flex; flex-wrap: wrap; gap: .35rem; max-height: 8.6rem; overflow-y: auto; }
.lob-mut { display: inline-flex; align-items: center; gap: .35rem; padding: .25rem .55rem; border-radius: 1rem; border: 1px solid var(--line-2); font-size: .78rem; color: var(--text-2); background: rgba(255,255,255,.03); cursor: pointer; }
.lob-mut.on { color: #fff; border-color: rgba(var(--accent-rgb), .8); background: rgba(var(--accent-rgb), .16); }
.lob-mut:disabled { cursor: default; }
.lob-chat { display: flex; flex-direction: column; gap: .4rem; }
.lob-log { height: 8rem; overflow-y: auto; padding: .5rem .6rem; border-radius: .6rem; border: 1px solid var(--line); background: rgba(0,0,0,.3); display: flex; flex-direction: column; gap: .2rem; font-size: .9rem; user-select: text; }
.lob-log .ln b { margin-right: .4rem; } .lob-log .sys { color: var(--muted); font-style: italic; }
.lob-chat form { display: flex; gap: .4rem; } .lob-chat form input { flex: 1; }
.lob-foot { display: flex; align-items: center; gap: .7rem; }
.lob-foot .why { flex: 1; text-align: right; color: var(--muted); font-size: .85rem; letter-spacing: .06em; }
.lob-foot .btn-primary { height: 3rem; font-size: 1.05rem; padding: 0 1.6rem; min-width: 14rem; }
.lob-foot .btn-primary:disabled { filter: grayscale(.8) brightness(.7); cursor: not-allowed; transform: none; }
.lob-tip { position: fixed; z-index: 40; padding: .35rem .7rem; border-radius: .45rem; background: #111a24; border: 1px solid rgba(var(--ok-rgb), .5); color: var(--ok); font-size: .8rem; letter-spacing: .1em; pointer-events: none; animation: netIn .2s var(--ease) both; }
@media (max-width: 900px) { .lob-grid { grid-template-columns: 1fr; } .lob-modes { grid-template-columns: repeat(2, 1fr); } }
`;

function ensureCss() {
  if (document.getElementById('lob-style')) return;
  const s = document.createElement('style');
  s.id = 'lob-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function loadName(): string {
  try { return cleanName(localStorage.getItem(NAME_KEY) ?? 'Commander'); } catch { return 'Commander'; }
}
function saveName(n: string) {
  try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ }
}
interface SeatRecord { code: string; token: string; at: number }
function loadSeat(): SeatRecord | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(SEAT_KEY) ?? 'null') as SeatRecord | null;
    return r && typeof r.code === 'string' && typeof r.token === 'string' && Date.now() - r.at < 10 * 60_000 ? r : null;
  } catch { return null; }
}
function saveSeat(r: SeatRecord | null) {
  try { if (r) sessionStorage.setItem(SEAT_KEY, JSON.stringify(r)); else sessionStorage.removeItem(SEAT_KEY); } catch { /* */ }
}

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  try {
    const t = el('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}
function tip(anchor: HTMLElement, text: string) {
  const r = anchor.getBoundingClientRect();
  const t = el('div', 'lob-tip', esc(text));
  t.style.left = `${r.left}px`;
  t.style.top = `${r.top - 34}px`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1200);
}

/** The room code in the page's #join=CODE, if any. */
export function inviteFromHash(): string | null {
  const m = /[#&]join=([A-Za-z0-9]{6})/.exec(location.hash);
  return m ? normaliseCode(m[1]) : null;
}

const FACTION_LABEL: Record<FactionPick, string> = { allies: 'Allies', soviet: 'Soviets', random: 'Random' };
const AI_LABEL: Record<string, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', brutal: 'Brutal' };
const TERRAIN = [[0.15, 'Low'], [0.4, 'Normal'], [0.65, 'High']] as const;

let client: NetClient | null = null;
let root: HTMLElement | null = null;

/** Open the lobby (the main menu's Multiplayer entry, an invite link, or after a match). */
export function openLobby(host: LobbyHost, opts: { join?: string } = {}) {
  ensureCss();
  close();
  const view = new LobbyView(host);
  root = view.root;
  document.body.appendChild(view.root);
  if (client && client.state !== 'closed') view.attach(client);
  else view.connectScreen(opts.join);
}

/** After a match, before the game is disposed: keep its room connection for the lobby. */
export function keepConnection() {
  const link = currentLink();
  if (link) link.keep = true;
}

function close() {
  if (root) { const r = root; r.classList.add('leaving'); setTimeout(() => r.remove(), 300); }
  root = null;
}

class LobbyView {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  private c: NetClient | null = null;
  private offs: (() => void)[] = [];
  private chatLog: { seat: number; name: string; text: string; sys?: boolean }[] = [];
  private muted = new Set<number>();
  private muteAll = false;
  private lastChat = 0;
  private status: ServerStatus | null = null;
  private error = '';
  private mode: NetMode = '1v1';
  private starting = false;

  constructor(private host: LobbyHost) {
    this.root = el('div', 'lob');
    this.panel = el('div', 'lob-panel panel');
    this.root.appendChild(this.panel);
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input')) { e.stopPropagation(); this.leave(); }
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // connect
  // ---------------------------------------------------------------------------------------------------------

  connectScreen(join?: string) {
    this.detach();
    const seat = loadSeat();
    this.panel.className = 'lob-panel panel narrow';
    this.panel.innerHTML = `
      <div class="lob-head"><span class="mp-ic">${picto('globe', 'ic')}</span><div><small>Online · no account needed</small><h2>Multiplayer</h2></div><i class="sp"></i><span class="lob-pill" data-st><i></i>Checking server…</span></div>
      ${this.error ? `<div class="lob-err">${esc(this.error)}</div>` : ''}
      <div class="lob-sec"><div class="lob-label">Callsign</div>
        <div class="lob-row"><input type="text" data-k="name" maxlength="20" value="${esc(loadName())}" spellcheck="false" autocomplete="off" style="flex:1"></div>
        <div class="lob-note">Shown to the players in your room. No account, no e-mail, nothing stored on the server.</div></div>
      ${seat ? `<div class="lob-sec"><div class="lob-label">Your match</div><div class="lob-row"><button class="btn" data-a="rejoin" style="flex:1">${ICONS.replay}<span>Rejoin room ${esc(seat.code)}</span></button></div></div>` : ''}
      <div class="lob-sec"><div class="lob-label">Join a room</div>
        <div class="lob-row"><input type="text" class="code" data-k="code" maxlength="64" placeholder="CODE" value="${esc(join ?? '')}" spellcheck="false" autocomplete="off"><button class="btn" data-a="join" style="flex:1">${ICONS.arrowR}<span>${join ? `Join room ${esc(join)}` : 'Join'}</span></button></div>
        <div class="lob-note">Type the six-letter code, or paste an invite link.</div></div>
      <div class="lob-sec"><div class="lob-label">Create a room</div>
        <div class="lob-modes">${MODES.map((m) => `<button class="lob-mode${m.id === this.mode ? ' on' : ''}" data-mode="${m.id}"><b>${esc(m.name)}</b><span>${esc(m.desc)}</span></button>`).join('')}</div>
        <div class="lob-row"><button class="btn" data-a="create" style="flex:1">${ICONS.plus}<span>Create room</span></button></div></div>
      <div class="lob-foot"><button class="btn" data-a="back">${picto('back', 'ic')}<span>Back</span><kbd>Esc</kbd></button><span class="why">Lockstep over a relay · same build and mods for everyone</span></div>`;
    const name = this.panel.querySelector('[data-k="name"]') as HTMLInputElement;
    const code = this.panel.querySelector('[data-k="code"]') as HTMLInputElement;
    const go = (fn: (c: NetClient) => void) => {
      const n = cleanName(name.value);
      saveName(n);
      this.host.play('click');
      this.error = '';
      const c = new NetClient({ url: relaySocketUrl(), name: n, build: BUILD_FINGERPRINT, mods: activeModSet()?.hash ?? '' });
      client = c;
      this.attach(c);
      fn(c);
    };
    this.panel.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => (b.onclick = () => {
      this.mode = b.dataset.mode as NetMode;
      this.panel.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
      this.host.play('tab');
    }));
    (this.panel.querySelector('[data-a="create"]') as HTMLElement).onclick = () => go((c) => c.create({ mode: this.mode }));
    const join2 = () => {
      const cc = normaliseCode(code.value);
      if (!cc) { this.host.play('error'); code.focus(); return; }
      go((c) => c.join(cc));
    };
    (this.panel.querySelector('[data-a="join"]') as HTMLElement).onclick = join2;
    code.onkeydown = (e) => { if (e.key === 'Enter') join2(); };
    const rj = this.panel.querySelector('[data-a="rejoin"]') as HTMLElement | null;
    if (rj && seat) rj.onclick = () => go((c) => c.resume(seat.code, seat.token));
    (this.panel.querySelector('[data-a="back"]') as HTMLElement).onclick = () => this.leave();
    void serverStatus(true).then((s) => {
      this.status = s;
      const pill = this.panel.querySelector('[data-st]');
      if (!pill) return;
      pill.className = `lob-pill ${s.ok ? 'ok' : 'bad'}`;
      pill.innerHTML = `<i></i>${s.ok ? (s.build === BUILD_FINGERPRINT ? 'Server online' : 'Server online · other version') : 'Server unavailable'}`;
      if (!s.ok) this.panel.querySelectorAll<HTMLButtonElement>('[data-a="create"], [data-a="join"], [data-a="rejoin"]').forEach((b) => { b.disabled = true; b.title = 'No multiplayer server answers here (see docs/MULTIPLAYER.md to host one).'; });
    });
    (join ? this.panel.querySelector('[data-a="join"]') as HTMLElement : name)?.focus();
  }

  // ---------------------------------------------------------------------------------------------------------
  // the room
  // ---------------------------------------------------------------------------------------------------------

  attach(c: NetClient) {
    this.detach();
    this.c = c;
    this.offs.push(c.on((m) => this.onMessage(m)));
    this.offs.push(c.onState((s) => {
      if (s === 'closed') {
        const reason = c.lastError?.msg ?? (c.endReason === 'kicked' ? 'You were removed from the room.' : c.endReason && c.endReason !== 'left' ? `Disconnected (${c.endReason}).` : '');
        if (client === c) client = null;
        saveSeat(null);
        this.error = reason;
        this.connectScreen();
      } else this.render();
    }));
    if (c.room) {
      if (c.room.phase === 'over' && c.room.host === c.seat) c.send({ t: 'lobby' }); // back from a match: the host reopens the lobby
      this.render();
    } else this.panel.innerHTML = `<div class="lob-head"><span class="mp-ic">${picto('globe', 'ic')}</span><div><small>Multiplayer</small><h2>Connecting…</h2></div></div>`;
  }

  private detach() {
    for (const off of this.offs) off();
    this.offs = [];
    this.c = null;
  }

  private onMessage(m: ServerMessage) {
    const c = this.c!;
    switch (m.t) {
      case 'welcome':
        saveSeat({ code: m.code, token: m.token, at: Date.now() });
        if (m.resume) { this.begin(m.resume.start); return; }
        if (/[#&]join=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
        this.render();
        break;
      case 'room':
        if (c.room?.phase === 'over' && c.room.host === c.seat) c.send({ t: 'lobby' });
        this.render();
        break;
      case 'chat':
        this.chatLog.push({ seat: m.seat, name: m.name, text: m.text });
        if (this.chatLog.length > 60) this.chatLog.shift();
        if (m.seat !== c.seat) this.host.play('ready_ping');
        this.renderChat();
        break;
      case 'error':
        this.error = m.msg;
        if (c.state === 'open') { this.host.play('error'); this.render(); }
        break;
      case 'start':
        this.begin(m.start);
        break;
    }
  }

  /** The match starts (or resumes): build it with this connection. */
  private begin(start: MatchStart) {
    if (this.starting) return;
    this.starting = true;
    const c = this.c!;
    saveSeat({ code: c.code, token: c.token, at: Date.now() });
    const setup = matchSetup(start, c.seat, this.host.quality(), activeModSet());
    setPendingMatch({ client: c, start });
    this.detach();
    close();
    this.host.start(setup);
  }

  private leave() {
    this.host.play('click');
    if (this.c) { const c = this.c; this.detach(); c.leave(); if (client === c) client = null; saveSeat(null); }
    close();
    this.host.back();
  }

  private render() {
    const c = this.c;
    if (!c || !c.room) return;
    const room = c.room;
    const me = room.slots.find((s) => s.seat === c.seat);
    const isHost = room.host === c.seat;
    const s = room.settings;
    // keep what the player is typing across re-renders
    const typing = this.panel.querySelector('[data-chat] input') as HTMLInputElement | null;
    const draft = typing ? { value: typing.value, focus: document.activeElement === typing } : null;
    this.panel.className = 'lob-panel panel';
    const why = startProblem(room);
    const over = room.phase !== 'lobby';
    this.panel.innerHTML = `
      <div class="lob-head"><span class="mp-ic">${ICONS.people}</span><div><small>${isHost ? 'You host this room' : 'Multiplayer room'} · ${esc(MODES.find((x) => x.id === s.mode)?.name ?? s.mode)}</small><h2>Lobby</h2></div><i class="sp"></i>
        <div class="lob-code"><small style="font-size:.65rem;letter-spacing:.2em;color:var(--muted)">CODE</small><b data-code>${esc(room.code)}</b>
          <button class="lob-ib" data-a="copycode" title="Copy the code">${ICONS.copy}</button><button class="btn" data-a="invite" style="height:2.2rem">${ICONS.copy}<span>Copy invite link</span></button></div></div>
      ${this.error ? `<div class="lob-err">${esc(this.error)}</div>` : ''}
      ${over ? `<div class="lob-err" style="border-color:rgba(var(--warn-rgb),.5);background:rgba(var(--warn-rgb),.1);color:var(--text)">The last match is still finishing on another player's screen. ${isHost ? 'The lobby reopens when it ends.' : 'The host reopens the lobby when it ends.'}</div>` : ''}
      <div class="lob-grid">
        <div class="lob-sec"><div class="lob-label">Players</div><div class="lob-slots">${room.slots.map((sl, i) => this.slotHtml(room, sl, i, isHost)).join('')}</div>
          <div class="lob-sec lob-chat"><div class="lob-label">Chat <button class="lob-ib${this.muteAll ? ' on' : ''}" data-a="muteall" title="${this.muteAll ? 'Show chat' : 'Mute all chat'}" style="width:1.8rem;height:1.8rem">${this.muteAll ? ICONS.eyeOff : ICONS.eye}</button></div>
            <div class="lob-log" data-log></div>
            <form data-chat><input type="text" maxlength="160" placeholder="Say something (Enter)" autocomplete="off" spellcheck="false"><button class="btn" type="submit">Send</button></form></div></div>
        <div class="lob-sec"><div class="lob-label">Battle settings${isHost ? '' : ' · set by the host'}</div>${this.settingsHtml(room, isHost)}</div>
      </div>
      <div class="lob-foot"><button class="btn" data-a="leave">${ICONS.exit}<span>Leave</span></button>
        <span class="why">${esc(isHost ? why ?? 'Everyone is ready' : me?.ready ? 'Waiting for the host to start' : 'Get ready when you are')}</span>
        ${isHost ? `<button class="btn-primary" data-a="start" ${why || over ? 'disabled' : ''}><span>Start match</span>${ICONS.arrowR}</button>`
          : `<button class="btn-primary" data-a="ready" ${over ? 'disabled' : ''}><span>${me?.ready ? 'Not ready' : 'Ready'}</span>${ICONS.check}</button>`}</div>`;
    this.bind(room, isHost);
    this.renderChat();
    if (draft) {
      const inp = this.panel.querySelector('[data-chat] input') as HTMLInputElement;
      inp.value = draft.value;
      if (draft.focus) inp.focus();
    }
  }

  private slotHtml(room: RoomView, sl: SlotView, i: number, isHost: boolean): string {
    const c = this.c!, mode = room.settings.mode;
    const mine = sl.seat === c.seat;
    const color = hexColor(SLOT_COLORS[i]);
    const inMode = i < modeSlots(mode);
    const team = sl.kind === 'closed' || !inMode ? '' : mode === 'ffa' ? `P${i + 1}` : `Team ${'AB'[slotTeam(mode, i, sl.kind === 'open' ? 'human' : sl.kind)]}`;
    const fac = (cur: FactionPick, attr: string, enabled: boolean) => `<select ${attr} ${enabled ? '' : 'disabled'}>${(['random', 'allies', 'soviet'] as FactionPick[]).map((f) => `<option value="${f}"${f === cur ? ' selected' : ''}>${FACTION_LABEL[f]}</option>`).join('')}</select>`;
    if (sl.kind === 'human') {
      const tags = [sl.seat === room.host ? 'Host' : '', mine ? 'You' : ''].filter(Boolean).join(' · ');
      let doctrine = '';
      if (room.settings.rules === 'commander' && (sl.faction === 'allies' || sl.faction === 'soviet')) {
        const rank = (() => { try { return rankIndexFor(loadProfile().xp); } catch { return 0; } })();
        const list = doctrinesFor(sl.faction);
        doctrine = mine
          ? `<select data-me="doctrine" title="Doctrine"><option value="">No doctrine</option>${list.map((d) => `<option value="${esc(d.id)}"${d.id === sl.doctrine ? ' selected' : ''}${doctrineUnlocked(d, rank) ? '' : ' disabled'}>${esc(d.name)}</option>`).join('')}</select>`
          : sl.doctrine ? `<span class="st">${esc(list.find((d) => d.id === sl.doctrine)?.name ?? 'Doctrine')}</span>` : '';
      }
      const state = !sl.connected ? '<span class="st off">Reconnecting</span>' : `<span class="st${sl.ready ? ' ready' : ''}">${sl.ready ? 'Ready' : 'Not ready'}</span>`;
      const muted = this.muted.has(sl.seat!);
      return `<div class="lob-slot${mine ? ' me' : ''}" style="--c:${color}"><i class="sw"></i><span class="tm">${team}</span>
        <div class="nm"><b>${esc(sl.name ?? 'Commander')}</b><small>${esc(tags || 'Player')}</small></div>
        ${fac(sl.faction, mine ? 'data-me="faction"' : '', mine)}${doctrine}${state}
        ${!mine ? `<button class="lob-ib${muted ? ' on' : ''}" data-mute="${sl.seat}" title="${muted ? 'Unmute' : 'Mute'} this player's chat">${muted ? ICONS.eyeOff : ICONS.eye}</button>` : ''}
        ${isHost && !mine ? `<button class="lob-ib danger" data-kick="${sl.seat}" title="Remove from the room">${ICONS.close}</button>` : ''}</div>`;
    }
    if (!inMode) return `<div class="lob-slot closed" style="--c:#333"><i class="sw"></i><span class="tm"></span><div class="nm"><b>—</b><small>Not used in this mode</small></div></div>`;
    const kindSel = isHost && room.phase === 'lobby'
      ? `<select data-slot="${i}">${[['open', 'Open'], ['closed', 'Closed'], ...(mode === '1v1' ? [] : (['easy', 'normal', 'hard', 'brutal'] as const).map((d) => [`ai:${d}`, `AI · ${AI_LABEL[d]}`]))].map(([v, l]) => `<option value="${v}"${(sl.kind === 'ai' ? `ai:${sl.ai}` : sl.kind) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`
      : '';
    if (sl.kind === 'ai') {
      return `<div class="lob-slot" style="--c:${color}"><i class="sw"></i><span class="tm">${team}</span><div class="nm"><b>AI commander</b><small>${AI_LABEL[sl.ai ?? 'normal']}</small></div>
        ${fac(sl.faction, isHost ? `data-aifac="${i}"` : '', isHost)}${kindSel}</div>`;
    }
    const canMove = sl.kind === 'open' && room.phase === 'lobby';
    return `<div class="lob-slot${sl.kind === 'closed' ? ' closed' : ''}" style="--c:${color}"><i class="sw"></i><span class="tm">${team}</span>
      <div class="nm"><b>${sl.kind === 'open' ? 'Open seat' : 'Closed'}</b><small>${sl.kind === 'open' ? 'Waiting for a player' : 'Nobody plays here'}</small></div>
      ${sl.kind === 'open' && canMove ? `<button class="btn" data-move="${i}" style="height:2.1rem;font-size:.7rem">Sit here</button>` : ''}${kindSel}</div>`;
  }

  private settingsHtml(room: RoomView, isHost: boolean): string {
    const s = room.settings;
    const dis = isHost && room.phase === 'lobby' ? '' : 'disabled';
    const sel = (k: string, opts: [string | number, string][], cur: string | number) => `<select data-set="${k}" ${dis}>${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const n = Math.max(2, activeSlots(room).length);
    const maps: [string, string][] = [['gen', 'Generated battlefield'], ...mapsFor(Math.min(n, 4)).map((m): [string, string] => [m.id, `${m.name} · ${m.players} players`])];
    if (s.map !== 'gen' && !maps.some(([id]) => id === s.map)) { const d = getMapDef(s.map); maps.push([s.map, d ? `${d.name} · ${d.players} players` : s.map]); }
    const near = (v: number) => TERRAIN.reduce((a, b) => (Math.abs(b[0] - v) < Math.abs(a[0] - v) ? b : a))[0];
    const gen = s.map === 'gen';
    const muts = MUTATORS.filter((m) => mutatorEligible(m, { climate: s.climate, faction: 'allies' }) || mutatorEligible(m, { climate: s.climate, faction: 'soviet' }));
    return `<div class="lob-set">
      <span>Mode</span>${sel('mode', MODES.map((m) => [m.id, m.name]), s.mode)}
      <span>Rules</span>${sel('rules', [['commander', 'Commander'], ['classic', 'Classic']], s.rules)}
      <span>Map</span><div class="wide">${sel('map', maps, s.map)}</div>
      ${gen ? `<span>Size</span>${sel('size', MAP_SIZES.map((v) => [v, `${v} × ${v}`]), s.size)}
      <span>Climate</span>${sel('climate', CLIMATES.map((v) => [v, v[0].toUpperCase() + v.slice(1)]), s.climate)}
      <span>Water</span>${sel('water', TERRAIN.map(([v, l]) => [v, l]), near(s.water))}
      <span>Forests</span>${sel('trees', TERRAIN.map(([v, l]) => [v, l]), near(s.trees))}
      <span>Ore</span>${sel('ore', TERRAIN.map(([v, l]) => [v, l]), near(s.ore))}` : ''}
      <span>Credits</span>${sel('credits', CREDIT_OPTIONS.map((v) => [v, `$${v.toLocaleString('en-US')}`]), s.credits)}
      <span>Start with</span>${sel('startUnits', [['mcv', 'MCV only'], ['light', 'Light squad'], ['heavy', 'Heavy squad']], s.startUnits)}
      <span>Fog of war</span>${sel('fog', [['true', 'On'], ['false', 'Off']], String(s.fog))}
      <span>Build-up time</span>${sel('ceasefire', CEASEFIRE_OPTIONS.map((v) => [v, v ? `${v} min ceasefire` : 'None']), s.ceasefire)}
      ${s.rules === 'commander' ? `<span>Events</span>${sel('events', [['true', 'Battlefield events on'], ['false', 'Off']], String(s.events))}` : ''}
    </div>
    <div class="lob-label" style="margin-top:.3rem">Mutators${s.mutators.length ? ` · ${s.mutators.length}` : ''}</div>
    <div class="lob-muts">${(isHost ? muts : muts.filter((m) => s.mutators.includes(m.id))).map((m) => `<button class="lob-mut${s.mutators.includes(m.id) ? ' on' : ''}" data-mut="${esc(m.id)}" title="${esc(m.desc)}" ${dis}>${picto(m.icon, 'ic')}${esc(m.name)}</button>`).join('') || '<span class="lob-note">None</span>'}</div>`;
  }

  private bind(room: RoomView, isHost: boolean) {
    const c = this.c!, P = this.panel;
    const set = (patch: Partial<MatchSettings>) => { this.host.play('click'); this.error = ''; c.send({ t: 'settings', settings: { ...room.settings, ...patch } }); };
    P.querySelectorAll<HTMLSelectElement>('[data-set]').forEach((s) => (s.onchange = () => {
      const k = s.dataset.set as keyof MatchSettings;
      const v = s.value;
      set({ [k]: k === 'fog' || k === 'events' ? v === 'true' : ['size', 'water', 'trees', 'ore', 'credits', 'ceasefire'].includes(k) ? Number(v) : v } as Partial<MatchSettings>);
    }));
    P.querySelectorAll<HTMLButtonElement>('[data-mut]').forEach((b) => (b.onclick = () => {
      if (!isHost) return;
      const id = b.dataset.mut!;
      const cur = room.settings.mutators;
      set({ mutators: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    }));
    P.querySelectorAll<HTMLSelectElement>('[data-slot]').forEach((s) => (s.onchange = () => {
      const [kind, ai] = s.value.split(':');
      this.host.play('click');
      c.send({ t: 'slot', slot: Number(s.dataset.slot), kind: kind as 'open' | 'closed' | 'ai', ai: ai as 'easy' | undefined });
    }));
    P.querySelectorAll<HTMLSelectElement>('[data-aifac]').forEach((s) => (s.onchange = () => {
      const i = Number(s.dataset.aifac);
      c.send({ t: 'slot', slot: i, kind: 'ai', ai: room.slots[i].ai, faction: s.value as FactionPick });
    }));
    const fac = P.querySelector('[data-me="faction"]') as HTMLSelectElement | null;
    if (fac) fac.onchange = () => { this.host.play('click'); c.send({ t: 'me', faction: fac.value as FactionPick, doctrine: null }); };
    const doc = P.querySelector('[data-me="doctrine"]') as HTMLSelectElement | null;
    if (doc) doc.onchange = () => { this.host.play('click'); c.send({ t: 'me', doctrine: doc.value || null }); };
    P.querySelectorAll<HTMLElement>('[data-move]').forEach((b) => (b.onclick = () => { this.host.play('click'); c.send({ t: 'me', slot: Number(b.dataset.move) }); }));
    P.querySelectorAll<HTMLElement>('[data-kick]').forEach((b) => (b.onclick = () => { this.host.play('click'); c.send({ t: 'kick', seat: Number(b.dataset.kick) }); }));
    P.querySelectorAll<HTMLElement>('[data-mute]').forEach((b) => (b.onclick = () => {
      const seat = Number(b.dataset.mute);
      if (this.muted.has(seat)) this.muted.delete(seat); else this.muted.add(seat);
      this.host.play('click');
      this.render();
    }));
    (P.querySelector('[data-a="muteall"]') as HTMLElement).onclick = () => { this.muteAll = !this.muteAll; this.host.play('click'); this.render(); };
    (P.querySelector('[data-a="leave"]') as HTMLElement).onclick = () => this.leave();
    const cc = P.querySelector('[data-a="copycode"]') as HTMLElement;
    cc.onclick = () => void copy(room.code).then((ok) => tip(cc, ok ? 'Code copied' : 'Copy failed'));
    const inv = P.querySelector('[data-a="invite"]') as HTMLElement;
    inv.onclick = () => void copy(inviteLink(room.code)).then((ok) => { this.host.play('click'); tip(inv, ok ? 'Invite link copied' : 'Copy failed'); });
    const start = P.querySelector('[data-a="start"]') as HTMLButtonElement | null;
    if (start) start.onclick = () => { this.host.play('click'); this.error = ''; c.send({ t: 'start' }); };
    const ready = P.querySelector('[data-a="ready"]') as HTMLButtonElement | null;
    if (ready) ready.onclick = () => { const me = room.slots.find((s) => s.seat === c.seat); this.host.play('click'); c.send({ t: 'me', ready: !me?.ready }); };
    const form = P.querySelector('[data-chat]') as HTMLFormElement;
    const input = form.querySelector('input') as HTMLInputElement;
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const now = performance.now();
      if (now - this.lastChat < 900) { this.host.play('error'); return; } // (the relay limits too)
      this.lastChat = now;
      c.send({ t: 'chat', text });
      input.value = '';
    };
    input.onkeydown = (e) => e.stopPropagation();
  }

  private renderChat() {
    const log = this.panel.querySelector('[data-log]');
    if (!log) return;
    const room = this.c?.room;
    const color = (seat: number) => { const i = room?.slots.findIndex((s) => s.seat === seat) ?? -1; return i >= 0 && i < MAX_SLOTS ? hexColor(SLOT_COLORS[i]) : '#ccc'; };
    const lines = this.muteAll ? [] : this.chatLog.filter((l) => !this.muted.has(l.seat));
    log.innerHTML = lines.length
      ? lines.map((l) => `<div class="ln"><b style="color:${color(l.seat)}">${esc(l.name)}</b>${esc(l.text)}</div>`).join('')
      : `<div class="sys">${this.muteAll ? 'Chat muted.' : 'No messages yet. Share the invite link to bring a friend.'}</div>`;
    log.scrollTop = log.scrollHeight;
  }
}
