/**
 * Connection to the relay: create / join / resume a room, answer heartbeats, reconnect after a dropped
 * connection (resuming the seat with its token), and hand every server message to the listeners. DOM-free:
 * any WebSocket-like object works (the browser's, Node's global WebSocket, or the in-process sockets of the
 * tests), and timers can be injected for virtual time.
 */
import { NET_PROTOCOL, type ClientMessage, type RoomView, type ServerMessage } from './protocol';

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  now(): number;
}

export interface NetClientOptions {
  url: string;
  name: string;
  build: string;
  mods: string;
  socket?: (url: string) => SocketLike;
  timers?: Timers;
  /**
   * Give up reconnecting after this long. The relay hands a silent seat to the AI after its heartbeat timeout plus
   * its grace period (about 90 s); trying a while longer lets a player whose link comes back later still rejoin the
   * match and watch it (src/net/lockstep.ts: a dropped seat only watches).
   */
  reconnectForMs?: number;
  /**
   * Nothing at all from the relay for this long while connected means the link is dead: the relay pings every 2 s
   * and sends closed ticks many times a second in a match. TCP alone notices a silent link only when it next has to
   * deliver something, which can be long after the link is back, and meanwhile the player sees a frozen game with no
   * explanation. Then: show "reconnecting" and reconnect (resuming the seat). Default 7 s.
   */
  silentMs?: number;
  /** A new connection that is not welcomed within this long is abandoned and retried (no waiting out TCP's backoff). */
  connectTimeoutMs?: number;
}

export type ClientState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

const defaultTimers: Timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), now: () => Date.now() };

export class NetClient {
  state: ClientState = 'idle';
  code = '';
  seat = -1;
  token = '';
  room: RoomView | null = null;
  /** Why the connection ended for good ('' while it lives). */
  endReason = '';
  /** The last error the relay reported. */
  lastError: { code: string; msg: string } | null = null;
  /** Ticks we already have when resuming (the match session sets it). */
  have: () => number = () => -1;
  /**
   * Match messages that arrive before the match session exists (the world is still loading): kept from a
   * `start` or a resuming `welcome` until `takeBacklog()`.
   */
  private backlog: ServerMessage[] | null = null;
  /** A match session is listening (no backlog needed). */
  attached = false;
  private ws: SocketLike | null = null;
  private listeners = new Set<(m: ServerMessage) => void>();
  private stateListeners = new Set<(s: ClientState) => void>();
  private timers: Timers;
  private retry = 0;
  private retryTimer: unknown = null;
  private lostAt = 0;
  private hello: ClientMessage | null = null;
  private leaving = false;
  // liveness watchdog (silentMs / connectTimeoutMs)
  private watchdog: unknown = null;
  private lastRx = 0;
  private lastCheck = 0;
  private openedAt = 0;
  private welcomed = false;

  constructor(private o: NetClientOptions) {
    this.timers = o.timers ?? defaultTimers;
  }

  /** Every message from the relay (after the client's own bookkeeping). Returns an unsubscribe function. */
  on(fn: (m: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onState(fn: (s: ClientState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  create(settings: unknown) {
    this.open({ t: 'hello', proto: NET_PROTOCOL, build: this.o.build, mods: this.o.mods, name: this.o.name, create: { settings } });
  }

  join(code: string) {
    this.open({ t: 'hello', proto: NET_PROTOCOL, build: this.o.build, mods: this.o.mods, name: this.o.name, join: code });
  }

  /** Take a seat back (after a reload: code and token kept by the page). */
  resume(code: string, token: string) {
    this.code = code;
    this.token = token;
    this.open(this.resumeHello());
  }

  /** Messages kept since the match started or resumed; stops keeping them. */
  takeBacklog(): ServerMessage[] {
    const b = this.backlog ?? [];
    this.backlog = null;
    return b;
  }

  send(m: ClientMessage) {
    if (this.ws && this.ws.readyState === 1 && this.state === 'open') {
      try { this.ws.send(JSON.stringify(m)); } catch { /* reconnect handles it */ }
    }
  }

  /** Leave the room for good. */
  leave() {
    this.leaving = true;
    this.send({ t: 'bye' });
    this.shutdown('left');
  }

  /** Drop the connection without leaving (tests: a network failure). */
  simulateDrop() {
    try { this.ws?.close(4000, 'test'); } catch { /* */ }
  }

  private resumeHello(): ClientMessage {
    return { t: 'hello', proto: NET_PROTOCOL, build: this.o.build, mods: this.o.mods, name: this.o.name, resume: { code: this.code, token: this.token, have: this.have() } };
  }

  private setState(s: ClientState) {
    if (this.state === s) return;
    this.state = s;
    for (const f of this.stateListeners) f(s);
  }

  private open(hello: ClientMessage) {
    this.hello = hello;
    this.setState(this.state === 'reconnecting' ? 'reconnecting' : 'connecting');
    let ws: SocketLike;
    try {
      ws = this.o.socket ? this.o.socket(this.o.url) : (new WebSocket(this.o.url) as unknown as SocketLike);
    } catch {
      this.lost();
      return;
    }
    this.ws = ws;
    this.openedAt = this.lastRx = this.timers.now();
    this.welcomed = false;
    this.startWatchdog();
    ws.onopen = () => {
      if (this.ws !== ws) return;
      try { ws.send(JSON.stringify(hello)); } catch { /* onclose follows */ }
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastRx = this.timers.now();
      if (typeof ev.data !== 'string') return;
      let m: ServerMessage;
      try { m = JSON.parse(ev.data) as ServerMessage; } catch { return; }
      if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
      this.handle(m);
    };
    ws.onclose = () => { if (this.ws === ws) this.lost(); };
    ws.onerror = () => { /* onclose follows */ };
  }

  private handle(m: ServerMessage) {
    switch (m.t) {
      case 'welcome':
        this.welcomed = true;
        this.code = m.code;
        this.seat = m.seat;
        this.token = m.token;
        this.room = m.room;
        this.retry = 0;
        this.lostAt = 0;
        this.setState('open');
        break;
      case 'room':
        this.room = m.room;
        break;
      case 'ping':
        this.send({ t: 'pong', n: m.n });
        return;
      case 'error':
        this.lastError = { code: m.code, msg: m.msg };
        break;
      case 'closed':
        this.endReason = m.reason;
        this.leaving = true;
        break;
    }
    if (!this.attached && (m.t === 'start' || (m.t === 'welcome' && m.resume))) this.backlog = [m];
    else if (this.backlog && !this.attached && (m.t === 'tick' || m.t === 'lat' || m.t === 'stall' || m.t === 'desync')) this.backlog.push(m);
    for (const f of this.listeners) f(m);
  }

  /** The socket closed: reconnect if we hold a seat, otherwise we are done. */
  private lost() {
    this.ws = null;
    if (this.leaving || !this.token || this.lastError?.code === 'no-room' || this.lastError?.code === 'build') { this.shutdown(this.endReason || this.lastError?.code || 'closed'); return; }
    const now = this.timers.now();
    if (!this.lostAt) this.lostAt = now;
    if (now - this.lostAt > (this.o.reconnectForMs ?? 180_000)) { this.shutdown('connection lost'); return; }
    this.setState('reconnecting');
    const wait = Math.min(5000, 400 * 2 ** this.retry++);
    this.retryTimer = this.timers.setTimeout(() => { this.retryTimer = null; if (this.state === 'reconnecting') this.open(this.resumeHello()); }, wait);
  }

  /** Check the connection every second (see silentMs). */
  private startWatchdog() {
    if (this.watchdog) return;
    this.lastCheck = this.timers.now();
    this.watchdog = this.timers.setTimeout(this.check, 1000);
  }

  private check = () => {
    this.watchdog = null;
    if (this.state === 'closed' || this.state === 'idle') return;
    const now = this.timers.now();
    // this check itself ran late (a busy main thread, a throttled background tab): messages may be queued behind it,
    // so start counting again rather than call the link dead
    if (now - this.lastCheck > 3000) { this.lastRx = now; if (!this.welcomed) this.openedAt = now; }
    this.lastCheck = now;
    const ws = this.ws;
    if (ws) {
      const dead = this.welcomed ? now - this.lastRx > (this.o.silentMs ?? 7000) : now - this.openedAt > (this.o.connectTimeoutMs ?? 10_000);
      if (dead) {
        this.ws = null; // (its late events are ignored)
        try { ws.close(4001, 'silent'); } catch { /* */ }
        this.lost();
      }
    }
    if ((this.state as ClientState) !== 'closed') this.watchdog = this.timers.setTimeout(this.check, 1000); // (lost() may have closed it)
  };

  private shutdown(reason: string) {
    if (this.retryTimer) { this.timers.clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.watchdog) { this.timers.clearTimeout(this.watchdog); this.watchdog = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(1000, 'bye'); } catch { /* */ } }
    if (!this.endReason) this.endReason = reason;
    this.setState('closed');
  }
}
