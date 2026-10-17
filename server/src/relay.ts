/**
 * The multiplayer relay: rooms with invite codes, the lobby, and lockstep command ordering. Transport-agnostic
 * (server/src/http.ts plugs WebSockets in; the tests plug in-process sockets) and clock-agnostic (every time
 * comes from `opts.now()`; `tick()` runs the timers), so it can be driven in virtual time.
 *
 * Lockstep: a seat sends `in` frames (commands for future ticks + a commit "nothing more for ticks <= upTo").
 * Tick T is closed when every active seat has committed it; closed ticks go out to everyone in one order
 * (tick, seat, arrival). The relay keeps every closed command of the match, so a client that reconnects - or
 * reloads the page and re-simulates from the start - gets them again.
 *
 * No accounts, no personal data: a seat is a random token, names and chat are cleaned and capped, IP addresses
 * stay in memory for rate limits only and are never logged.
 */
import {
  MAX_COMMIT_AHEAD, MAX_SLOTS, NET_HASH_EVERY, NET_PROTOCOL, DEFAULT_DELAY, delayFor, makeCode, parseClientMessage,
  type ClientMessage, type MatchStart, type RoomView, type ServerMessage, type SlotView, type TickCmd,
} from '../../src/net/protocol';
import { initialSlots, modeSlots, normaliseSettings, startProblem, type MatchSettings } from '../../src/net/settings';
import { cleanChat, cleanName } from '../../src/net/names';
import { KeyedLimiter, TokenBucket } from './limits';

export interface RelayConn {
  send(text: string): void;
  close(code: number, reason: string): void;
}

export interface RelayLimits {
  maxRooms: number;
  maxConns: number;
  maxConnsPerIp: number;
  /** Messages per second per connection (sustained / burst). */
  msgRate: number;
  msgBurst: number;
  /** Chat lines per second per connection (sustained / burst). */
  chatRate: number;
  chatBurst: number;
  /** Room creations and joins per IP per minute (code guessing). */
  joinPerMin: number;
  /** Malformed or over-limit messages tolerated before the connection is closed. */
  maxViolations: number;
  pingEveryMs: number;
  pongTimeoutMs: number;
  /** No tick closed for this long: tell everyone who we are waiting for. */
  stallNoticeMs: number;
  /** After this long, the other players may drop the stalled player (the AI takes over). */
  dropVoteMs: number;
  /** The relay drops a stalled player itself after this long (a disconnected one after reconnectGraceMs). */
  autoDropMs: number;
  reconnectGraceMs: number;
  lobbyIdleMs: number;
  /** A player whose connection dropped in the lobby keeps the seat this long (a reconnect takes it back). */
  lobbyGraceMs: number;
  overKeepMs: number;
  maxMatchMs: number;
  /** Commands one match may log (resume buffer). */
  maxLogCmds: number;
}

export const DEFAULT_LIMITS: RelayLimits = {
  maxRooms: 200, maxConns: 1000, maxConnsPerIp: 12, msgRate: 60, msgBurst: 160, chatRate: 0.7, chatBurst: 4, joinPerMin: 12,
  maxViolations: 40, pingEveryMs: 2000, pongTimeoutMs: 30000, stallNoticeMs: 2500, dropVoteMs: 20000, autoDropMs: 90000,
  reconnectGraceMs: 60000, lobbyIdleMs: 30 * 60_000, lobbyGraceMs: 20_000, overKeepMs: 10 * 60_000, maxMatchMs: 4 * 3600_000, maxLogCmds: 150_000,
};

export interface RelayOptions {
  now(): number;
  /** Uniform integer in [0, n) from a cryptographic source. */
  randInt(n: number): number;
  /** Random reconnect token (unguessable). */
  token(): string;
  limits?: Partial<RelayLimits>;
  /** Operational log (counts and events only; never names, chat, tokens or addresses). */
  log?(line: string): void;
}

interface Seat {
  id: number;
  token: string;
  name: string;
  slot: number;
  conn: Client | null;
  ready: boolean;
  faction: SlotView['faction'];
  doctrine: string | null;
  disconnectedAt: number;
  /** Replaced by the AI (match). */
  dropped: boolean;
  loaded: boolean;
  over: boolean;
}

interface Slot {
  kind: 'open' | 'closed' | 'ai';
  faction: SlotView['faction'];
  ai?: SlotView['ai'];
}

interface Match {
  start: MatchStart;
  startedAt: number;
  closed: number;
  committed: Map<number, number>;
  pending: [number, number, number, unknown][];
  seq: number;
  log: TickCmd[];
  drops: [number, number][];
  hashes: Map<number, Map<number, string>>;
  lastAdvance: number;
  stallSeat: number;
  delay: number;
  lastLat: number;
  /** Closing pace: never faster than real time (plus a burst), even when every client idles ahead. */
  pace: TokenBucket;
  ended: string | null;
}

interface Room {
  code: string;
  phase: RoomView['phase'];
  host: number;
  build: string;
  mods: string;
  settings: MatchSettings;
  slots: Slot[];
  seats: Map<number, Seat>;
  nextSeat: number;
  createdAt: number;
  activity: number;
  overAt: number;
  match: Match | null;
  banned: Set<string>;
}

class Client {
  room: Room | null = null;
  seat: Seat | null = null;
  violations = 0;
  closed = false;
  pingN = 0;
  pingAt = 0;
  lastPong: number;
  rtt = 0;
  jitter = 0;
  msgs: TokenBucket;
  chat: TokenBucket;
  constructor(readonly id: number, readonly conn: RelayConn, readonly ip: string, now: number, l: RelayLimits) {
    this.lastPong = now;
    this.msgs = new TokenBucket(l.msgRate, l.msgBurst, now);
    this.chat = new TokenBucket(l.chatRate, l.chatBurst, now);
  }
}

export interface ClientHandle {
  message(text: string): void;
  close(): void;
}

export class Relay {
  readonly limits: RelayLimits;
  private rooms = new Map<string, Room>();
  private clients = new Set<Client>();
  private perIp = new Map<string, number>();
  private joins: KeyedLimiter;
  private nextId = 1;
  /** Counters for /healthz and tests. */
  stats = { rooms: 0, conns: 0, matches: 0, desyncs: 0, drops: 0, rejected: 0 };

  constructor(private opts: RelayOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.joins = new KeyedLimiter(this.limits.joinPerMin / 60, this.limits.joinPerMin);
  }

  get roomCount() { return this.rooms.size; }
  get connCount() { return this.clients.size; }

  /** A new connection (origin already checked by the transport). Returns null when it is refused. */
  connect(conn: RelayConn, ip: string): ClientHandle | null {
    const l = this.limits, now = this.opts.now();
    if (this.clients.size >= l.maxConns || (this.perIp.get(ip) ?? 0) >= l.maxConnsPerIp) {
      this.stats.rejected++;
      conn.send(JSON.stringify({ t: 'error', code: 'busy', msg: 'The server is full. Try again later.' } satisfies ServerMessage));
      conn.close(1013, 'busy');
      return null;
    }
    const c = new Client(this.nextId++, conn, ip, now, l);
    this.clients.add(c);
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    this.stats.conns = this.clients.size;
    return { message: (text) => this.onMessage(c, text), close: () => this.onClose(c) };
  }

  // ---------------------------------------------------------------------------------------------------------
  // plumbing
  // ---------------------------------------------------------------------------------------------------------

  private send(c: Client | null | undefined, m: ServerMessage) {
    if (!c || c.closed) return;
    try { c.conn.send(JSON.stringify(m)); } catch { /* the transport closes it */ }
  }

  private broadcast(room: Room, m: ServerMessage) {
    const text = JSON.stringify(m);
    for (const s of room.seats.values()) if (s.conn && !s.conn.closed) { try { s.conn.conn.send(text); } catch { /* closing */ } }
  }

  private error(c: Client, code: string, msg: string) {
    this.send(c, { t: 'error', code, msg });
  }

  private violation(c: Client, why: string) {
    c.violations++;
    if (c.violations > this.limits.maxViolations) this.kill(c, 1008, `policy: ${why}`);
  }

  private kill(c: Client, code: number, reason: string) {
    if (c.closed) return;
    try { c.conn.close(code, reason.slice(0, 100)); } catch { /* already gone */ }
    this.onClose(c);
  }

  private onClose(c: Client) {
    if (c.closed) return;
    c.closed = true;
    this.clients.delete(c);
    const n = (this.perIp.get(c.ip) ?? 1) - 1;
    if (n > 0) this.perIp.set(c.ip, n); else this.perIp.delete(c.ip);
    this.stats.conns = this.clients.size;
    const room = c.room, seat = c.seat;
    if (!room || !seat || seat.conn !== c) return;
    seat.conn = null;
    seat.disconnectedAt = this.opts.now();
    if (room.phase === 'lobby') this.broadcastRoom(room); // (the seat waits a little for a reconnect: roomTick)
    else {
      if (room.phase === 'over' && room.host === seat.id) { const next = [...room.seats.values()].find((s) => s.conn); if (next) room.host = next.id; } // someone can reopen the lobby
      this.broadcastRoom(room);
    }
  }

  private onMessage(c: Client, text: string) {
    if (c.closed) return;
    const now = this.opts.now();
    if (!c.msgs.take(now)) { this.violation(c, 'rate'); return; }
    const m = parseClientMessage(text);
    if (!m) { this.violation(c, 'malformed'); this.error(c, 'bad-message', 'Malformed message.'); return; }
    if (m.t === 'pong') { this.onPong(c, m.n, now); return; }
    if (m.t === 'hello') { this.onHello(c, m, now); return; }
    const room = c.room, seat = c.seat;
    if (!room || !seat || seat.conn !== c) { this.violation(c, 'no-room'); return; }
    room.activity = now;
    switch (m.t) {
      case 'settings': return this.onSettings(c, room, seat, m.settings);
      case 'slot': return this.onSlot(c, room, seat, m);
      case 'me': return this.onMe(c, room, seat, m);
      case 'chat': return this.onChat(c, room, seat, m.text, now);
      case 'kick': return this.onKick(c, room, seat, m.seat);
      case 'start': return this.onStart(c, room, seat, now);
      case 'loaded': seat.loaded = true; return;
      case 'in': return this.onIn(c, room, seat, m.upTo, m.cmds, now);
      case 'hash': return this.onHash(room, seat, m.tick, m.h);
      case 'drop': return this.onDropVote(c, room, seat, m.seat, now);
      case 'over': return this.onOver(room, seat, now);
      case 'lobby': return this.onBackToLobby(c, room, seat, now);
      case 'bye': return this.onBye(c, room, seat, now);
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // rooms and the lobby
  // ---------------------------------------------------------------------------------------------------------

  private view(room: Room): RoomView {
    const slots: SlotView[] = room.slots.map((s, i): SlotView => {
      const seat = [...room.seats.values()].find((x) => x.slot === i);
      if (seat) {
        return { kind: 'human', seat: seat.id, name: seat.name, ready: seat.ready || seat.id === room.host, connected: !!seat.conn, dropped: seat.dropped || undefined, faction: seat.faction, doctrine: seat.doctrine };
      }
      return { kind: s.kind, faction: s.faction, ai: s.kind === 'ai' ? s.ai ?? 'normal' : undefined };
    });
    return { code: room.code, phase: room.phase, host: room.host, build: room.build, mods: room.mods, settings: room.settings, slots };
  }

  private broadcastRoom(room: Room) {
    this.broadcast(room, { t: 'room', room: this.view(room) });
  }

  private newCode(): string {
    for (let i = 0; i < 50; i++) {
      const code = makeCode((n) => this.opts.randInt(n));
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('no free room code');
  }

  private onHello(c: Client, m: Extract<ClientMessage, { t: 'hello' }>, now: number) {
    if (c.room) { this.violation(c, 'hello-twice'); return; }
    if (m.proto !== NET_PROTOCOL) { this.error(c, 'version', 'This game version does not match the server. Reload the page to update.'); this.kill(c, 1008, 'protocol'); return; }
    if (!this.joins.take(c.ip, now)) { this.error(c, 'slow-down', 'Too many attempts. Wait a minute and try again.'); this.kill(c, 1008, 'join rate'); return; }
    const name = cleanName(m.name);
    if (m.resume) return this.onResume(c, m.resume, m.build, now);
    if (m.create) {
      if (this.rooms.size >= this.limits.maxRooms) { this.error(c, 'busy', 'The server is full. Try again later.'); this.kill(c, 1013, 'rooms'); return; }
      const settings = normaliseSettings(m.create.settings);
      const room: Room = {
        code: this.newCode(), phase: 'lobby', host: 0, build: m.build, mods: m.mods, settings,
        slots: initialSlots(settings.mode).map((s) => ({ kind: s.kind === 'human' ? 'open' : (s.kind as Slot['kind']), faction: s.faction, ai: s.ai })),
        seats: new Map(), nextSeat: 1, createdAt: now, activity: now, overAt: 0, match: null, banned: new Set(),
      };
      this.rooms.set(room.code, room);
      this.stats.rooms = this.rooms.size;
      const seat = this.addSeat(room, c, name, 0);
      room.host = seat.id;
      this.opts.log?.(`room created (${this.rooms.size} rooms)`);
      this.welcome(c, room, seat);
      return;
    }
    const room = m.join ? this.rooms.get(m.join) : undefined;
    if (!room) { this.joins.take(c.ip, now); this.error(c, 'no-room', 'No room with that code. Check the code or ask for a new invite.'); this.kill(c, 1000, 'no room'); return; }
    if (room.banned.has(c.ip)) { this.error(c, 'kicked', 'You were removed from this room.'); this.kill(c, 1000, 'banned'); return; }
    if (room.phase !== 'lobby') { this.error(c, 'in-progress', 'That match has already started.'); this.kill(c, 1000, 'started'); return; }
    if (m.build !== room.build) { this.error(c, 'build', 'Your game version differs from the host\'s. Both players need the same version (reload to update).'); this.kill(c, 1000, 'build'); return; }
    if (m.mods !== room.mods) { this.error(c, 'mods', room.mods ? 'This room plays with mods: enable the same mods to join.' : 'This room plays without mods: disable your mods to join.'); this.kill(c, 1000, 'mods'); return; }
    const free = room.slots.findIndex((s, i) => s.kind === 'open' && ![...room.seats.values()].some((x) => x.slot === i));
    if (free < 0) { this.error(c, 'full', 'The room is full.'); this.kill(c, 1000, 'full'); return; }
    const seat = this.addSeat(room, c, this.uniqueName(room, name), free);
    this.welcome(c, room, seat);
    this.broadcastRoom(room);
  }

  private uniqueName(room: Room, name: string): string {
    const taken = new Set([...room.seats.values()].map((s) => s.name));
    if (!taken.has(name)) return name;
    for (let i = 2; i < 10; i++) { const n = `${[...name].slice(0, 17).join('')} ${i}`; if (!taken.has(n)) return n; }
    return name;
  }

  private addSeat(room: Room, c: Client, name: string, slot: number): Seat {
    const seat: Seat = { id: room.nextSeat++, token: this.opts.token(), name, slot, conn: c, ready: false, faction: 'random', doctrine: null, disconnectedAt: 0, dropped: false, loaded: false, over: false };
    room.seats.set(seat.id, seat);
    c.room = room;
    c.seat = seat;
    return seat;
  }

  private welcome(c: Client, room: Room, seat: Seat) {
    this.send(c, { t: 'welcome', code: room.code, seat: seat.id, token: seat.token, room: this.view(room) });
  }

  private leaveLobby(room: Room, seat: Seat) {
    room.seats.delete(seat.id);
    if (!room.seats.size) { this.deleteRoom(room, 'empty'); return; }
    if (room.host === seat.id) room.host = [...room.seats.values()][0].id; // the next player hosts
    this.broadcastRoom(room);
  }

  private deleteRoom(room: Room, reason: string) {
    if (!this.rooms.has(room.code)) return;
    this.rooms.delete(room.code);
    this.stats.rooms = this.rooms.size;
    for (const s of room.seats.values()) {
      if (s.conn) { this.send(s.conn, { t: 'closed', reason }); s.conn.room = null; s.conn.seat = null; this.kill(s.conn, 1000, reason); }
    }
  }

  private onSettings(c: Client, room: Room, seat: Seat, raw: unknown) {
    if (room.phase !== 'lobby' || seat.id !== room.host) { this.violation(c, 'not-host'); return; }
    const next = normaliseSettings(raw);
    const n = modeSlots(next.mode);
    // a mode with fewer seats may not push players out: they would have nowhere to go
    if ([...room.seats.values()].length > n) { this.error(c, 'mode', 'Too many players for that mode.'); return; }
    if (next.mode !== room.settings.mode) {
      // re-seat the players in the first slots and rebuild the rest for the mode
      const fresh = initialSlots(next.mode);
      const seats = [...room.seats.values()].sort((a, b) => a.slot - b.slot);
      seats.forEach((s, i) => { s.slot = i; });
      room.slots = fresh.map((s, i) => (i < seats.length ? { kind: 'open', faction: 'random' } : { kind: s.kind === 'human' ? 'open' : (s.kind as Slot['kind']), faction: s.faction, ai: s.ai }));
    }
    room.settings = next;
    for (const s of room.seats.values()) if (s.id !== room.host) s.ready = false; // changed terms: everyone confirms again
    this.broadcastRoom(room);
  }

  private onSlot(c: Client, room: Room, seat: Seat, m: Extract<ClientMessage, { t: 'slot' }>) {
    if (room.phase !== 'lobby' || seat.id !== room.host) { this.violation(c, 'not-host'); return; }
    if (m.slot >= modeSlots(room.settings.mode) || [...room.seats.values()].some((s) => s.slot === m.slot)) return;
    if (m.kind === 'ai' && room.settings.mode === '1v1') return;
    const s = room.slots[m.slot];
    s.kind = m.kind;
    s.ai = m.kind === 'ai' ? m.ai ?? s.ai ?? 'normal' : undefined;
    if (m.faction) s.faction = m.faction;
    for (const x of room.seats.values()) if (x.id !== room.host) x.ready = false;
    this.broadcastRoom(room);
  }

  private onMe(c: Client, room: Room, seat: Seat, m: Extract<ClientMessage, { t: 'me' }>) {
    if (room.phase !== 'lobby') return;
    if (m.faction) seat.faction = m.faction;
    if (m.doctrine !== undefined) seat.doctrine = m.doctrine;
    if (m.ready !== undefined) seat.ready = m.ready;
    if (m.slot !== undefined && m.slot !== seat.slot) {
      const free = m.slot < modeSlots(room.settings.mode) && room.slots[m.slot].kind === 'open' && ![...room.seats.values()].some((s) => s.slot === m.slot);
      if (free) { seat.slot = m.slot; seat.ready = false; }
    }
    this.broadcastRoom(room);
  }

  private onChat(c: Client, room: Room, seat: Seat, raw: string, now: number) {
    if (!c.chat.take(now)) { this.error(c, 'chat-rate', 'You are sending messages too quickly.'); return; }
    const text = cleanChat(raw);
    if (!text) return;
    this.broadcast(room, { t: 'chat', seat: seat.id, name: seat.name, text });
  }

  private onKick(c: Client, room: Room, seat: Seat, target: number) {
    if (room.phase !== 'lobby' || seat.id !== room.host || target === seat.id) { this.violation(c, 'not-host'); return; }
    const t = room.seats.get(target);
    if (!t) return;
    if (t.conn) {
      room.banned.add(t.conn.ip);
      this.send(t.conn, { t: 'closed', reason: 'kicked' });
      const conn = t.conn;
      conn.room = null; conn.seat = null;
      this.kill(conn, 1000, 'kicked');
    }
    room.seats.delete(t.id);
    this.broadcastRoom(room);
  }

  // ---------------------------------------------------------------------------------------------------------
  // the match
  // ---------------------------------------------------------------------------------------------------------

  private onStart(c: Client, room: Room, seat: Seat, now: number) {
    if (room.phase !== 'lobby' || seat.id !== room.host) { this.violation(c, 'not-host'); return; }
    const view = this.view(room);
    const why = startProblem(view);
    if (why) { this.error(c, 'not-ready', why); return; }
    const start: MatchStart = { seed: 1 + this.opts.randInt(0x7ffffffe), room: { ...view, phase: 'match' } };
    room.phase = 'match';
    const committed = new Map<number, number>();
    for (const s of room.seats.values()) { committed.set(s.id, -1); s.loaded = false; s.over = false; s.dropped = false; }
    room.match = {
      start, startedAt: now, closed: -1, committed, pending: [], seq: 0, log: [], drops: [], hashes: new Map(),
      lastAdvance: now, stallSeat: -1, delay: DEFAULT_DELAY, lastLat: now, pace: new TokenBucket(20, 60, now), ended: null,
    };
    this.stats.matches++;
    this.opts.log?.(`match started (${room.seats.size} players)`);
    this.broadcast(room, { t: 'start', start, delay: room.match.delay });
  }

  /** Seats whose commits gate closing: in the match, not dropped, not finished. */
  private gating(room: Room): Seat[] {
    return [...room.seats.values()].filter((s) => !s.dropped && !s.over && room.match!.committed.has(s.id));
  }

  private onIn(c: Client, room: Room, seat: Seat, upTo: number, cmds: [number, unknown][], now: number) {
    const m = room.match;
    if (room.phase !== 'match' || !m || m.ended || seat.dropped || !m.committed.has(seat.id)) return;
    const prev = m.committed.get(seat.id)!;
    const cap = m.closed + MAX_COMMIT_AHEAD;
    for (const [t, cmd] of cmds) {
      // never for a tick that is already closed or was already committed (a correct client never does that)
      if (t <= m.closed || t <= prev || t > cap + MAX_COMMIT_AHEAD) { this.violation(c, 'late-command'); continue; }
      if (m.pending.length > 4000) { this.violation(c, 'pending'); continue; }
      m.pending.push([t, seat.id, m.seq++, cmd]);
    }
    if (upTo > prev) m.committed.set(seat.id, Math.min(upTo, cap));
    this.tryClose(room, now);
  }

  private tryClose(room: Room, now: number) {
    const m = room.match!;
    if (m.ended) return;
    const gate = this.gating(room);
    if (!gate.length) return;
    let target = Math.min(...gate.map((s) => m.committed.get(s.id)!));
    if (target <= m.closed) return;
    const allowed = m.pace.available(now);
    if (allowed <= 0) return;
    target = Math.min(target, m.closed + allowed);
    m.pace.take(now, target - m.closed);
    const out: Match['pending'] = [];
    const keep: Match['pending'] = [];
    for (const p of m.pending) (p[0] <= target ? out : keep).push(p);
    out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    m.pending = keep;
    const cmds: TickCmd[] = out.map((p) => [p[0], p[1], p[3]]);
    const drops = m.drops.filter((d) => d[0] > m.closed && d[0] <= target);
    m.closed = target;
    m.lastAdvance = now;
    for (const x of cmds) m.log.push(x);
    if (m.stallSeat >= 0) { m.stallSeat = -1; this.broadcast(room, { t: 'stall', seat: -1, ms: 0, canDrop: false, gone: false, loading: false }); }
    this.broadcast(room, drops.length ? { t: 'tick', to: target, cmds, drops } : { t: 'tick', to: target, cmds });
    if (m.log.length > this.limits.maxLogCmds) this.endMatch(room, 'The match log is full.', now);
  }

  private onHash(room: Room, seat: Seat, tick: number, h: string) {
    const m = room.match;
    if (!m || m.ended || tick % NET_HASH_EVERY !== 0 || tick > m.closed + 1) return;
    let e = m.hashes.get(tick);
    if (!e) {
      if (m.hashes.size > 4000) { const oldest = Math.min(...m.hashes.keys()); m.hashes.delete(oldest); }
      e = new Map();
      m.hashes.set(tick, e);
    }
    e.set(seat.id, h);
    const distinct = new Set(e.values());
    if (distinct.size > 1) {
      this.stats.desyncs++;
      this.opts.log?.(`desync at tick ${tick}`);
      this.broadcast(room, { t: 'desync', tick, hashes: [...e.entries()] });
      this.endMatch(room, 'desync', this.opts.now());
      return;
    }
    // everybody still in the match reported the same: forget it
    const want = [...room.seats.values()].filter((s) => !s.dropped && s.conn);
    if (want.every((s) => e!.has(s.id))) m.hashes.delete(tick);
  }

  private dropSeat(room: Room, seat: Seat, now: number, why: string) {
    const m = room.match;
    if (!m || seat.dropped || m.ended) return;
    seat.dropped = true;
    const at = m.closed + 1;
    m.drops.push([at, seat.id]);
    m.pending = m.pending.filter((p) => p[1] !== seat.id); // its commands for ticks still open go with it
    this.stats.drops++;
    this.opts.log?.(`player dropped (${why})`);
    this.broadcastRoom(room);
    // nobody left to play: the match is over
    if (!this.gating(room).length && ![...room.seats.values()].some((s) => !s.dropped && s.conn)) { this.endMatch(room, 'everyone left', now); return; }
    this.tryClose(room, now);
    // a drop at a tick nobody closes yet still has to reach the clients: send it with the next bundle (tryClose)
  }

  private onDropVote(c: Client, room: Room, seat: Seat, target: number, now: number) {
    const m = room.match;
    if (!m || seat.dropped || target === seat.id) return;
    const t = room.seats.get(target);
    if (!t || t.dropped) return;
    const stalledFor = now - m.lastAdvance;
    const gating = this.gating(room).filter((s) => m.committed.get(s.id)! <= m.closed);
    if (!gating.includes(t) || stalledFor < this.limits.dropVoteMs) { this.error(c, 'too-early', 'You can drop a player after they have stalled the match for a while.'); return; }
    this.dropSeat(room, t, now, 'vote');
  }

  private onOver(room: Room, seat: Seat, now: number) {
    const m = room.match;
    if (!m) return;
    seat.over = true;
    if ([...room.seats.values()].every((s) => s.over || s.dropped || !s.conn)) {
      room.phase = 'over';
      room.overAt = now;
      m.ended = m.ended ?? 'finished';
      this.broadcastRoom(room);
    } else this.tryClose(room, now);
  }

  private endMatch(room: Room, reason: string, now: number) {
    const m = room.match;
    if (m) m.ended = reason;
    room.phase = 'over';
    room.overAt = now;
    this.broadcastRoom(room);
  }

  private onBackToLobby(c: Client, room: Room, seat: Seat, now: number) {
    if (room.phase !== 'over' || seat.id !== room.host) { this.violation(c, 'not-host'); return; }
    for (const s of [...room.seats.values()]) {
      if (!s.conn) room.seats.delete(s.id);
      else { s.ready = false; s.dropped = false; s.over = false; s.loaded = false; }
    }
    room.match = null;
    room.phase = 'lobby';
    room.activity = now;
    this.broadcastRoom(room);
  }

  private onBye(c: Client, room: Room, seat: Seat, now: number) {
    if (room.phase === 'match') this.dropSeat(room, seat, now, 'left');
    c.room = null;
    c.seat = null;
    if (seat.conn === c) seat.conn = null;
    seat.disconnectedAt = now;
    if (room.phase !== 'match') this.leaveLobby(room, seat); // (after a match too: the room carries on without them)
    else this.broadcastRoom(room);
    this.kill(c, 1000, 'bye');
  }

  private onResume(c: Client, r: { code: string; token: string; have: number }, build: string, now: number) {
    const room = this.rooms.get(r.code);
    const seat = room ? [...room.seats.values()].find((s) => s.token === r.token) : undefined;
    if (!room || !seat) { this.error(c, 'no-room', 'That match is over or no longer exists.'); this.kill(c, 1000, 'no room'); return; }
    if (build !== room.build) { this.error(c, 'build', 'Your game version differs from this room\'s.'); this.kill(c, 1000, 'build'); return; }
    if (seat.conn && seat.conn !== c) { const old = seat.conn; old.room = null; old.seat = null; this.kill(old, 1000, 'replaced'); }
    seat.conn = c;
    c.room = room;
    c.seat = seat;
    const m = room.match;
    if (!m || room.phase === 'lobby') {
      this.welcome(c, room, seat);
      this.broadcastRoom(room);
      return;
    }
    this.send(c, {
      t: 'welcome', code: room.code, seat: seat.id, token: seat.token, room: this.view(room),
      resume: { start: m.start, committed: m.committed.get(seat.id) ?? -1, closed: m.closed, dropped: seat.dropped, delay: m.delay },
    });
    // everything closed after what the client has, in chunks that never split a tick (the drops ride with the
    // first chunk: a client applies each one when it reaches its tick)
    const from = Math.max(-1, Math.min(r.have, m.closed));
    const cmds = m.log.filter((x) => x[0] > from);
    const drops = m.drops.filter((d) => d[0] > from);
    const CHUNK = 2000;
    let i = 0;
    do {
      let j = Math.min(cmds.length, i + CHUNK);
      while (j < cmds.length && cmds[j][0] === cmds[j - 1][0]) j++;
      const to = j < cmds.length ? cmds[j - 1][0] : m.closed;
      this.send(c, i === 0 && drops.length ? { t: 'tick', to, cmds: cmds.slice(i, j), drops } : { t: 'tick', to, cmds: cmds.slice(i, j) });
      i = j;
    } while (i < cmds.length);
    this.broadcastRoom(room);
  }

  private onPong(c: Client, n: number, now: number) {
    if (n !== c.pingN || !c.pingAt) return;
    const rtt = Math.max(0, now - c.pingAt);
    c.pingAt = 0;
    c.lastPong = now;
    if (!c.rtt) c.rtt = rtt;
    c.jitter = c.jitter * 0.75 + Math.abs(rtt - c.rtt) * 0.25;
    c.rtt = c.rtt * 0.7 + rtt * 0.3;
  }

  // ---------------------------------------------------------------------------------------------------------
  // timers
  // ---------------------------------------------------------------------------------------------------------

  /** Heartbeats, latency and input delay, stalls and drops, room expiry. Call every ~250 ms. */
  tick() {
    const now = this.opts.now(), l = this.limits;
    for (const c of [...this.clients]) {
      // a player still building the match (a slow machine compiling shaders) may not answer for a while
      const loading = c.room?.phase === 'match' && !!c.seat && !c.seat.loaded;
      if (now - c.lastPong > l.pongTimeoutMs * (loading ? 6 : 1)) { this.kill(c, 1001, 'timeout'); continue; }
      if (!c.pingAt && now - c.lastPong >= l.pingEveryMs - 1) { c.pingN++; c.pingAt = now; this.send(c, { t: 'ping', n: c.pingN }); }
      else if (c.pingAt && now - c.pingAt > l.pingEveryMs * 2) { c.pingN++; c.pingAt = now; this.send(c, { t: 'ping', n: c.pingN }); }
    }
    this.joins.prune(now);
    for (const room of [...this.rooms.values()]) this.roomTick(room, now);
  }

  private roomTick(room: Room, now: number) {
    const l = this.limits;
    if (room.phase === 'lobby') {
      for (const s of [...room.seats.values()]) if (!s.conn && now - s.disconnectedAt > l.lobbyGraceMs) { this.leaveLobby(room, s); if (!this.rooms.has(room.code)) return; }
      if (now - room.activity > l.lobbyIdleMs) this.deleteRoom(room, 'idle');
      return;
    }
    if (room.phase === 'over') {
      if (now - room.overAt > l.overKeepMs || ![...room.seats.values()].some((s) => s.conn)) this.deleteRoom(room, 'over');
      return;
    }
    const m = room.match!;
    if (now - m.startedAt > l.maxMatchMs) { this.endMatch(room, 'time limit', now); return; }
    // disconnected players get a grace period to come back, then the AI takes over
    for (const s of room.seats.values()) {
      if (!s.conn && !s.dropped && s.disconnectedAt && now - s.disconnectedAt > l.reconnectGraceMs * (s.loaded ? 1 : 3)) this.dropSeat(room, s, now, 'disconnected');
    }
    if (room.phase !== 'match') return;
    if (!this.gating(room).length && ![...room.seats.values()].some((s) => s.conn && !s.dropped)) { this.endMatch(room, 'everyone left', now); return; }
    // input delay from the room's round trips
    if (now - m.lastLat >= 2000) {
      m.lastLat = now;
      const live = [...room.seats.values()].filter((s) => s.conn && !s.dropped && s.conn.rtt > 0);
      if (live.length) {
        const want = delayFor(Math.max(...live.map((s) => s.conn!.rtt)), Math.max(...live.map((s) => s.conn!.jitter)));
        m.delay = want > m.delay ? want : Math.max(want, m.delay - 1); // up at once, down a step at a time
        this.broadcast(room, { t: 'lat', rtt: live.map((s) => [s.id, Math.round(s.conn!.rtt)]), delay: m.delay });
      }
    }
    this.tryClose(room, now);
    // stalls: say who everybody waits for; drop them after a while
    const waited = now - m.lastAdvance;
    if (waited >= l.stallNoticeMs) {
      const lag = this.gating(room).filter((s) => m.committed.get(s.id)! <= m.closed);
      const s = lag.sort((a, b) => +!!a.conn - +!!b.conn)[0];
      if (s) {
        const loading = !s.loaded && m.closed < 0;
        m.stallSeat = s.id;
        this.broadcast(room, { t: 'stall', seat: s.id, ms: waited, canDrop: waited >= l.dropVoteMs, gone: !s.conn, loading });
        if (waited >= l.autoDropMs * (loading ? 2 : 1)) this.dropSeat(room, s, now, 'stalled');
      }
    }
  }

  /** Close everything (shutdown). */
  close() {
    for (const room of [...this.rooms.values()]) this.deleteRoom(room, 'server shutting down');
    for (const c of [...this.clients]) this.kill(c, 1001, 'shutdown');
  }
}

export { MAX_SLOTS };
