/**
 * A multiplayer match inside the browser game: drives the Game's simulation through the lockstep session
 * (Game.net), records every player's commands into the match replay, and shows the network state - latency,
 * who everybody is waiting for (with the drop vote), reconnecting, catching up, chat, and the desync dialog.
 */
import type { Game } from '../game';
import type { Command } from '../sim/types';
import { esc, el } from '../ui/dom';
import { ICONS } from '../ui/icons';
import { saveReplay } from '../replay/store';
import type { NetClient } from './client';
import type { MatchStart } from './protocol';
import { MatchSession } from './session';
import type { NetLink } from './types';
import tNet from '../i18n/en/net';
import { trSource } from '../i18n/core';

const REASON_KEYS: Record<string, Parameters<typeof tNet>[0]> = {
  kicked: 'reason.kicked', empty: 'reason.empty', idle: 'reason.idle', over: 'reason.over', 'server shutting down': 'reason.shutdown',
  desync: 'reason.desync', 'everyone left': 'reason.everyoneLeft', 'time limit': 'reason.timeLimit', finished: 'reason.finished',
  'connection lost': 'reason.lost', closed: 'reason.closed',
};

/** Why a connection ended, for players: the relay's and the client's reason words, translated (else as sent). */
export function reasonText(reason: string): string {
  const k = Object.prototype.hasOwnProperty.call(REASON_KEYS, reason) ? REASON_KEYS[reason] : undefined;
  return k ? tNet(k) : trSource(reason);
}

export interface NetMatchHost {
  /** Leave the match (and the room): back to the main menu. */
  quit(): void;
  play(k: 'click' | 'error' | 'ready_ping'): void;
}

const CSS = `
.net-chip { position: fixed; top: 3.6rem; right: 1rem; z-index: 6; display: flex; align-items: center; gap: .45rem; padding: .3rem .4rem .3rem .65rem; border-radius: .6rem;
  font: 600 .78rem var(--font); letter-spacing: .08em; color: var(--text-2); background: var(--glass-flat); border: 1px solid var(--line-2); pointer-events: auto; }
.net-chip i { width: .55rem; height: .55rem; border-radius: 50%; background: var(--ok); box-shadow: 0 0 .5rem currentColor; flex-shrink: 0; }
.net-chip i.warn { background: var(--warn); } .net-chip i.bad { background: var(--danger); }
.net-chip b { color: var(--text); font-family: var(--mono); font-weight: 400; }
.net-chip button { width: 1.8rem; height: 1.8rem; border-radius: .45rem; border: 1px solid var(--line-2); background: rgba(255,255,255,.04); cursor: pointer; display: grid; place-items: center; font-size: .95rem; color: var(--text-2); }
.net-chip button:hover { color: #fff; border-color: rgba(var(--accent-rgb), .6); }
.net-chip button.on { color: var(--warn); }
.net-banner { position: fixed; top: 6.3rem; left: 50%; transform: translateX(-50%); z-index: 7; min-width: 22rem; max-width: 40rem; padding: .7rem 1rem; border-radius: .8rem; display: flex; align-items: center; gap: .8rem;
  background: var(--glass); border: 1px solid rgba(var(--warn-rgb), .45); box-shadow: 0 .8rem 2rem rgba(0,0,0,.5); font-size: .95rem; color: var(--text); pointer-events: auto; animation: netIn .3s var(--ease) both; }
.net-banner .sp { flex: 1; } .net-banner small { display: block; color: var(--muted); font-size: .75rem; letter-spacing: .12em; text-transform: uppercase; margin-bottom: .15rem; }
.net-banner .spin { width: 1.1rem; height: 1.1rem; border-radius: 50%; border: 2px solid rgba(var(--warn-rgb), .3); border-top-color: var(--warn); animation: netSpin 1s linear infinite; flex-shrink: 0; }
.net-banner button { height: 2.1rem; padding: 0 .8rem; border-radius: .5rem; cursor: pointer; font: 700 .72rem var(--font); letter-spacing: .18em; text-transform: uppercase; color: #fff; border: 1px solid rgba(var(--danger-rgb), .6); background: rgba(var(--danger-rgb), .2); }
.net-banner .bar { height: 3px; border-radius: 2px; background: rgba(255,255,255,.1); margin-top: .4rem; overflow: hidden; } .net-banner .bar i { display: block; height: 100%; background: var(--accent); }
.net-chat { position: fixed; left: 1rem; bottom: 15rem; z-index: 6; width: 24rem; display: flex; flex-direction: column; gap: .25rem; pointer-events: none; }
.net-chat .ln { align-self: flex-start; max-width: 100%; padding: .25rem .55rem; border-radius: .45rem; background: rgba(5,8,12,.72); font-size: .88rem; color: var(--text); text-shadow: 0 1px 2px #000; animation: netIn .25s var(--ease) both; overflow-wrap: anywhere; }
.net-chat .ln b { margin-right: .35rem; } .net-chat .ln.sys { color: var(--warn); }
.net-chat .ln.old { opacity: 0; transition: opacity 1.2s; }
.net-chat form { pointer-events: auto; display: flex; gap: .3rem; }
.net-chat input { flex: 1; height: 2.2rem; border-radius: .5rem; border: 1px solid rgba(var(--accent-rgb), .5); background: rgba(5,8,12,.88); color: var(--text); font: 500 .9rem var(--font); padding: 0 .6rem; user-select: text; }
.net-dialog .menu-panel { width: 34rem; }
.net-dialog p { margin: 0; color: var(--text-2); line-height: 1.45; }
.net-dialog code { font-family: var(--mono); color: var(--text); background: rgba(255,255,255,.06); padding: .1rem .35rem; border-radius: .3rem; }
.net-dialog table { width: 100%; border-collapse: collapse; font-size: .9rem; } .net-dialog td { padding: .3rem .2rem; border-bottom: 1px solid var(--line); } .net-dialog td:last-child { text-align: right; }
.net-dialog .row { display: flex; gap: .6rem; flex-wrap: wrap; } .net-dialog .row .btn { flex: 1; }
.net-dialog .ok { color: var(--ok); }
@keyframes netIn { from { opacity: 0; transform: translate(-50%, -.5rem); } }
.net-chat .ln { animation-name: netInL; } @keyframes netInL { from { opacity: 0; transform: translateX(-.5rem); } }
@keyframes netSpin { to { transform: rotate(360deg); } }
body.rh-net .speed-ctl { display: none !important; }
`;

function ensureCss() {
  if (document.getElementById('net-style')) return;
  const s = document.createElement('style');
  s.id = 'net-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const mmss = (ticks: number) => { const s = Math.floor(ticks / 20); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Download text as a file (a same-origin blob: URL). */
export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export class GameLink implements NetLink {
  readonly session: MatchSession;
  /** Keep the room connection when the game is disposed (back to the lobby after the match). */
  keep = false;
  private chip: HTMLElement;
  private banner: HTMLElement | null = null;
  private bannerKey = '';
  private chat: HTMLElement;
  private dialog: HTMLElement | null = null;
  private timer = 0;
  private sentLoaded = false;
  private muted = false;
  private offs: (() => void)[] = [];
  private disposed = false;
  private names = new Map<number, string>();

  constructor(private game: Game, readonly client: NetClient, readonly start: MatchStart, private host: NetMatchHost) {
    ensureCss();
    document.body.classList.add('rh-net');
    for (const s of start.room.slots) if (s.kind === 'human' && s.seat !== undefined) this.names.set(s.seat, s.name ?? 'Commander'); // (as the roster names them)
    this.session = new MatchSession({
      client, world: game.world, start, localSeat: client.seat,
      onExecute: (cmd: Command) => game.recorder?.record(cmd), // every player's orders, at the tick they run: the match replay
      onDrop: (_tick, player) => {
        const net = game.setup.net!;
        (net.drops ??= []).push([_tick, player]);
        const name = game.world.players[player]?.name ?? tNet('player.someone');
        this.line(tNet('chat.left', { name }), true);
        if (player === game.local.id) this.spectate();
      },
      onChange: () => this.render(),
    });
    if (this.session.ls.watching) this.spectate();
    this.chip = el('div', 'net-chip');
    this.chat = el('div', 'net-chat');
    document.body.append(this.chip, this.chat);
    this.offs.push(client.on((m) => {
      if (m.t === 'chat') this.chatLine(m.seat, m.name, m.text);
      else if (m.t === 'lat' || m.t === 'stall' || m.t === 'room') this.render();
      else if (m.t === 'error' && m.code === 'chat-rate') this.line(trSource(m.msg), true);
    }));
    this.offs.push(client.onState(() => this.render()));
    // a hidden tab has no frames: keep committing (we issue nothing then) so the others play on
    this.timer = window.setInterval(() => { this.session.idleCommit(); this.render(); }, 250);
    this.render();
  }

  get active(): boolean {
    return this.session.ls.status === 'live';
  }

  get alpha(): number {
    return this.session.alpha;
  }

  issue(cmd: Command) {
    this.session.issue(cmd);
  }

  frame(dt: number, step: (fast: boolean) => void) {
    if (!this.sentLoaded) { this.sentLoaded = true; this.session.loaded(); }
    const was = this.session.catchingUp;
    this.session.frame(dt, () => step(this.session.catchingUp), this.session.catchingUp ? 30 : 12);
    if (was && !this.session.catchingUp) this.caughtUp();
    if (this.game.speed !== 1 && !this.game.world.gameOver) this.game.speed = 1; // one pace for everybody
  }

  /** After a catch-up without presentation: what the skipped events would have done to the scenery. */
  private caughtUp() {
    const w = this.game.world, cells: number[] = [];
    for (const b of w.buildings) for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) cells.push(w.map.idx(b.cx + dx, b.cy + dy));
    this.game.gfx.vegetation.hideCells(cells);
    this.game.gfx.fog.snap(this.game.local);
    this.render();
  }

  private spectate() {
    if (this.game.input) this.game.input.spectator = true;
    this.line(tNet('chat.watching'), true);
  }

  // ---------------------------------------------------------------------------------------------------------
  // status UI
  // ---------------------------------------------------------------------------------------------------------

  private render() {
    if (this.disposed || !this.session || !this.chip) return; // (the session replays its backlog while it is being built)
    if (this.session.ls.status === 'desync' && !this.dialog) { this.showDesync(); return; } // (the frame loop no longer calls us then)
    const s = this.session, ls = s.ls, c = this.client;
    const myRtt = s.rtt.get(c.seat) ?? 0;
    const cls = c.state !== 'open' ? 'bad' : myRtt > 220 ? 'warn' : '';
    const key = `${cls}|${Math.round(myRtt / 5)}|${ls.delay}|${this.muted}|${c.state}`;
    if (this.chip.dataset.k !== key) {
      this.chip.dataset.k = key;
      this.chip.innerHTML = `<i class="${cls}"></i><span>${c.state === 'open' ? tNet.html('chip.latency', { ms: Math.round(myRtt), delay: ls.delay * 50 }) : tNet.html('chip.offline')}</span>
        <button data-a="chat" title="${esc(tNet('chip.chat'))}">${ICONS.people}</button><button data-a="mute" class="${this.muted ? 'on' : ''}" title="${esc(tNet(this.muted ? 'chip.unmute' : 'chip.mute'))}">${this.muted ? ICONS.eyeOff : ICONS.eye}</button>`;
      (this.chip.querySelector('[data-a="chat"]') as HTMLElement).onclick = () => this.openChatInput();
      (this.chip.querySelector('[data-a="mute"]') as HTMLElement).onclick = () => { this.muted = !this.muted; this.host.play('click'); this.render(); };
    }
    // one banner at a time, most important first
    let bk = '', html = '', btn: { label: string; fn: () => void } | null = null;
    if (ls.status === 'desync') { bk = ''; }
    else if (c.state === 'reconnecting') { bk = 'rc'; html = `<span class="spin"></span><div class="sp"><small>${tNet.html('banner.lostKicker')}</small>${tNet.html('banner.reconnecting')}</div>`; }
    else if (c.state === 'closed' && ls.status === 'live') { bk = 'gone'; html = `<div class="sp"><small>${tNet.html('banner.goneKicker')}</small>${c.endReason ? tNet.html('banner.goneReason', { reason: reasonText(c.endReason) }) : tNet.html('banner.gone')}</div>`; btn = { label: tNet('banner.leave'), fn: () => this.host.quit() }; }
    else if (s.catchingUp) {
      const pct = Math.min(99, Math.round((100 * this.game.world.tick) / Math.max(1, ls.confirmed)));
      bk = `cu${pct}`; html = `<span class="spin"></span><div class="sp"><small>${tNet.html('banner.rejoinKicker')}</small>${tNet.html('banner.catchingUp', { pct })}<div class="bar"><i style="width:${pct}%"></i></div></div>`;
    } else if (s.stall && s.stall.seat !== c.seat && ls.status === 'live') {
      const st = s.stall, secs = Math.floor(st.ms / 1000);
      const why = st.loading ? 'banner.stallLoading' : st.gone ? 'banner.stallGone' : 'banner.stallSlow';
      bk = `st${st.seat}|${secs}|${st.canDrop}`;
      html = `<span class="spin"></span><div class="sp"><small>${tNet.html('banner.pausedKicker', { s: secs })}</small>${tNet.html(why, { name: st.name })}</div>`;
      if (st.canDrop) btn = { label: tNet('banner.drop'), fn: () => { this.host.play('click'); s.dropStalled(); } };
    }
    if (bk !== this.bannerKey) {
      this.bannerKey = bk;
      this.banner?.remove();
      this.banner = null;
      if (bk) {
        this.banner = el('div', 'net-banner', html);
        if (btn) { const b = el('button', '', esc(btn.label)); b.onclick = btn.fn; this.banner.appendChild(b); }
        document.body.appendChild(this.banner);
      }
    }
    // chat lines fade after a while
    const now = performance.now();
    for (const ln of this.chat.querySelectorAll<HTMLElement>('.ln')) if (now - +(ln.dataset.at ?? 0) > 12000) ln.classList.add('old');
    while (this.chat.querySelectorAll('.ln').length > 8) this.chat.querySelector('.ln')?.remove();
  }

  private line(text: string, sys = false) {
    const ln = el('div', 'ln' + (sys ? ' sys' : ''), esc(text));
    ln.dataset.at = String(performance.now());
    this.chat.insertBefore(ln, this.chat.querySelector('form'));
  }

  private chatLine(seat: number, name: string, text: string) {
    if (this.muted && seat !== this.client.seat) return;
    const slot = this.start.room.slots.findIndex((s) => s.seat === seat);
    const color = this.game.world.players.find((p) => p.name === name)?.color ?? 0xffffff;
    const ln = el('div', 'ln', `<b style="color:#${color.toString(16).padStart(6, '0')}">${esc(name)}</b>${esc(text)}`);
    ln.dataset.at = String(performance.now());
    ln.dataset.slot = String(slot);
    this.chat.insertBefore(ln, this.chat.querySelector('form'));
    this.render();
  }

  private openChatInput() {
    if (this.chat.querySelector('form')) { (this.chat.querySelector('input') as HTMLInputElement).focus(); return; }
    const f = el('form');
    const inp = el('input');
    inp.maxLength = 160;
    inp.placeholder = tNet('chat.placeholder');
    inp.autocomplete = 'off';
    f.appendChild(inp);
    const close = () => f.remove();
    f.onsubmit = (e) => {
      e.preventDefault();
      const text = inp.value.trim();
      if (text) this.client.send({ t: 'chat', text });
      close();
    };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); };
    inp.onblur = () => setTimeout(close, 150);
    this.chat.appendChild(f);
    inp.focus();
  }

  // ---------------------------------------------------------------------------------------------------------
  // desync
  // ---------------------------------------------------------------------------------------------------------

  private showDesync() {
    const d = this.session.desync;
    const g = this.game;
    g.paused = true; // the simulations disagree: nothing to gain from running on
    g.input?.setMode('normal');
    this.host.play('error');
    const rows = (d?.hashes ?? []).map(([seat, h]) => { const name = this.names.get(seat) ?? tNet('player.seat', { n: String(seat) }); return `<tr><td>${esc(seat === this.client.seat ? tNet('player.you', { name }) : name)}</td><td><code>${esc(h)}</code></td></tr>`; }).join('');
    const s = el('div', 'screen sub-screen dim net-dialog');
    s.innerHTML = `<div class="menu-panel panel">
      <div class="mp-head"><span class="mp-ic">${ICONS.warn}</span><div><small>${tNet.html('desync.kicker')}</small><h2>${tNet.html('desync.title')}</h2></div></div>
      <p>${tNet.html('desync.body')}</p>
      <table><tr><td>${tNet.html('desync.first')}</td><td><code>${tNet.html('desync.tick', { tick: String(d?.tick ?? '?') })}</code> · ${mmss(d?.tick ?? 0)}</td></tr>${rows}<tr><td>${tNet.html('desync.yourHash')}</td><td><code>${esc(d?.mine ?? tNet('desync.unknown'))}</code></td></tr></table>
      <div class="row"><button class="btn" data-a="save">${ICONS.history}<span>${tNet.html('desync.save')}</span></button><button class="btn" data-a="dl">${ICONS.download}<span>${tNet.html('desync.download')}</span></button></div>
      <div class="row"><button class="btn" data-a="leave">${ICONS.exit}<span>${tNet.html('desync.leave')}</span></button></div>
    </div>`;
    const data = () => {
      const r = g.recorder?.toData();
      if (!r) return null;
      return { ...r, result: 'abandoned' as const, setup: { ...r.setup, net: { ...g.setup.net!, drops: g.setup.net!.drops ?? [] } } };
    };
    (s.querySelector('[data-a="save"]') as HTMLButtonElement).onclick = (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      const r = data();
      if (!r) return;
      b.disabled = true;
      saveReplay(r).then(() => { b.innerHTML = `${ICONS.check}<span class="ok">${tNet.html('desync.saved')}</span>`; }).catch(() => { b.textContent = tNet('desync.saveFailed'); });
    };
    (s.querySelector('[data-a="dl"]') as HTMLButtonElement).onclick = () => {
      const r = data();
      if (r) downloadText(`red-horizon-desync-${d?.tick ?? 0}.json`, JSON.stringify(r));
    };
    (s.querySelector('[data-a="leave"]') as HTMLButtonElement).onclick = () => { this.host.play('click'); this.host.quit(); };
    document.body.appendChild(s);
    this.dialog = s;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.clearInterval(this.timer);
    for (const off of this.offs) off();
    this.session.dispose();
    this.chip.remove();
    this.chat.remove();
    this.banner?.remove();
    this.dialog?.remove();
    document.body.classList.remove('rh-net');
    if (!this.keep) this.client.leave();
  }
}

let pending: { client: NetClient; start: MatchStart } | null = null;
let current: GameLink | null = null;

/** The lobby hands over the connection and the start of the match the next Game is built for. */
export function setPendingMatch(p: { client: NetClient; start: MatchStart } | null) {
  pending = p;
}

/** The running multiplayer match, if any. */
export function currentLink(): GameLink | null {
  return current && !(current as unknown as { disposed: boolean }).disposed ? current : null;
}

/** Attach the pending match to a freshly built Game (main.ts, before game.start()). */
export function attachNetMatch(game: Game, host: NetMatchHost): GameLink | null {
  const net = game.setup.net;
  if (!net || game.setup.replay || !pending || pending.start.room.code !== net.room) return null;
  const link = new GameLink(game, pending.client, pending.start, host);
  pending = null;
  game.net = link;
  game.attachments.push(link);
  current = link;
  return link;
}
