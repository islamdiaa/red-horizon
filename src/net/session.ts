/**
 * A running multiplayer match on one client: the relay connection (NetClient) plus the lockstep (Lockstep)
 * around a World. DOM-free: the browser game drives it from its frame loop (src/net/game-link.ts), the tests
 * and tools from a virtual clock.
 *
 * Pacing: in step with real time (20 ticks a second) while the relay keeps the next ticks closed. A client
 * that is far behind (a reload re-simulating the match, a tab that was in the background) catches up as fast
 * as its frame budget allows; meanwhile, and whenever the frame loop is not running (hidden tab), it commits
 * ahead of its own simulation (it issues no commands then), so the others are not held up.
 */
import type { Command } from '../sim/types';
import { DT } from '../sim/types';
import type { World } from '../sim/world';
import type { NetClient } from './client';
import { Lockstep } from './lockstep';
import type { MatchStart, ServerMessage } from './protocol';
import { netPlayers } from './roster';
import tNet from '../i18n/en/net';

export interface StallInfo { seat: number; name: string; ms: number; canDrop: boolean; gone: boolean; loading: boolean }
export interface DesyncInfo { tick: number; mine: string | null; hashes: [number, string][] }

export interface MatchSessionOptions {
  client: NetClient;
  world: World;
  start: MatchStart;
  localSeat: number | null;
  delay?: number;
  now?(): number;
  onExecute?(cmd: Command, tick: number): void;
  onDrop?(tick: number, player: number): void;
  /** A player surrendered (sim/resign.ts). */
  onResign?(tick: number, player: number): void;
  /** Anything happened worth re-rendering the status UI for (stall, desync, latency, connection). */
  onChange?(): void;
}

/** Catch-up mode when this many ticks are known but not simulated yet. */
const CATCHUP_AT = 12;
/** Ticks of waiting time a client keeps while the relay has not closed the next tick yet (see frame). */
export const WAIT_BANK = 5;

export class MatchSession {
  readonly ls: Lockstep;
  readonly world: World;
  readonly client: NetClient;
  readonly start: MatchStart;
  /** Interpolation factor between the last two ticks (for rendering). */
  alpha = 0;
  stall: StallInfo | null = null;
  desync: DesyncInfo | null = null;
  /** Round trips the relay measured, by seat (ms). */
  rtt = new Map<number, number>();
  catchingUp = false;
  /** Room closed / match ended by the relay. */
  ended = '';
  private acc = 0;
  private lastFrame = 0;
  /** Smoothed wall time between frames (ms). */
  private frameMs = 16;
  private unsub: () => void;
  private readonly now: () => number;
  private names = new Map<number, string>();
  /**
   * `loaded` is owed to the relay: the page has built the match, or the connection was resumed. It is sent once the
   * simulation has caught up, because the relay ignores this connection's heartbeat times until then (a page that
   * rebuilds and re-simulates the match after a reload answers late, which says nothing about the network).
   */
  private loadPending = false;
  /** Past the backlog: messages now arrive live (a resume's welcome then means a reconnect of this running page). */
  private attached = false;

  constructor(private o: MatchSessionOptions) {
    this.world = o.world;
    this.client = o.client;
    this.start = o.start;
    this.now = o.now ?? (() => Date.now());
    const seatPlayer = new Map<number, number>();
    netPlayers(o.start).forEach((p, i) => { if (p.human && p.seat !== undefined) { seatPlayer.set(p.seat, i); this.names.set(p.seat, p.name); } });
    this.ls = new Lockstep({
      world: o.world, seatPlayer, localSeat: o.localSeat, delay: o.delay, send: (m) => o.client.send(m),
      onExecute: o.onExecute, onDrop: o.onDrop, onResign: o.onResign,
    });
    o.client.have = () => this.ls.confirmed;
    o.client.frameMs = () => this.frameMs;
    // what arrived while the world was being built (a resume's welcome and closed ticks), then live messages
    const backlog = o.client.takeBacklog();
    for (const m of backlog) this.onMessage(m);
    this.attached = true;
    o.client.attached = true;
    // (a session built synchronously inside the welcome's own dispatch would also get that welcome live: once is enough)
    this.unsub = o.client.on((m) => { if (!backlog.includes(m)) this.onMessage(m); });
  }

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case 'tick':
        this.ls.receive(m);
        this.idleCommit();
        return;
      case 'welcome':
        // a reconnect of this running page: say `loaded` again once caught up (a page that resumes after a reload says
        // it from its first frame: game-link.ts)
        if (m.resume) { this.ls.resume(m.resume); this.ls.flush(); if (this.attached) this.loadPending = true; }
        break;
      case 'lat':
        this.ls.setDelay(m.delay);
        this.rtt = new Map(m.rtt);
        break;
      case 'stall':
        this.stall = m.seat < 0 ? null : { seat: m.seat, name: this.names.get(m.seat) ?? tNet('player.someone'), ms: m.ms, canDrop: m.canDrop, gone: m.gone, loading: m.loading };
        break;
      case 'desync':
        this.ls.status = 'desync';
        this.desync = { tick: m.tick, mine: this.ls.hashAt(m.tick), hashes: m.hashes };
        break;
      case 'closed':
        this.ended = m.reason;
        break;
      case 'start':
        this.ls.setDelay(m.delay);
        return;
      default:
        return;
    }
    this.o.onChange?.();
  }

  /** The frame loop is not running (hidden tab) or the simulation lags far behind. */
  private idle(): boolean {
    return this.catchingUp || this.now() - this.lastFrame > 400;
  }

  /**
   * While the frame loop is not running or the simulation is catching up: commit ahead of our own simulation (we
   * issue nothing meanwhile) so the others keep playing. Does nothing while the client plays live.
   */
  idleCommit() {
    this.flushLoaded();
    if (this.ls.status !== 'live' || !this.idle()) return;
    this.ls.commit(this.ls.confirmed + this.ls.delay - 1);
    this.ls.flush();
  }

  /** A local command (scheduled a few ticks ahead). */
  issue(cmd: Command) {
    this.ls.issue(cmd);
  }

  /**
   * Advance the simulation for a frame of `dt` seconds: real-time pace while live, a time-boxed burst while
   * catching up. `step` runs one world step (and whatever the host does per step). Returns the steps taken.
   */
  frame(dt: number, step: () => void, budgetMs = 12): number {
    const ls = this.ls, w = this.world;
    const now = this.now();
    const gap = this.lastFrame ? Math.max(0, now - this.lastFrame) : 0;
    if (this.lastFrame) this.frameMs = this.frameMs * 0.9 + Math.min(gap, 1000) * 0.1; // (one long gap - a tab back from the background - counts as a slow frame, not as ten)
    this.lastFrame = now;
    // the frame's real length: the game caps its own dt (0.1 s), which would leave a machine drawing 3 frames a second
    // at a third of real time and then in catch-up bursts that skip the effects; up to the 12-tick budget, real time
    // decides
    dt = Math.max(dt, Math.min(gap / 1000, DT * 12));
    if (ls.status !== 'live') { this.alpha = 1; this.catchingUp = false; return 0; } // (over: nothing left to catch up)
    const known = ls.confirmed - w.tick + 1;
    if (!this.catchingUp && known > CATCHUP_AT + ls.delay) this.catchingUp = true;
    let steps = 0;
    const run = () => { ls.beforeStep(); step(); ls.afterStep(); steps++; };
    if (this.catchingUp) {
      const t0 = this.now();
      while (ls.canStep() && steps < 2000 && (steps < 4 || this.now() - t0 < budgetMs)) run();
      if (ls.confirmed - w.tick + 1 <= ls.delay + 2) { this.catchingUp = false; this.acc = 0; }
      this.alpha = 1;
    } else {
      this.acc = Math.min(this.acc + Math.max(0, dt), DT * 12);
      while (this.acc >= DT && ls.canStep() && steps < 12) { run(); this.acc -= DT; }
      // waiting for the relay: keep up to WAIT_BANK ticks of the time waited, so the match keeps real time on average. (It
      // kept one: then every hiccup of any player - a garbage collection, a slow frame - longer than the delay's margin
      // cost everybody that much for good, about 5-10 % of real time in real browsers. A longer stall, someone lost,
      // still resumes with at most a quarter-second step.)
      if (!ls.canStep()) this.acc = Math.min(this.acc, DT * WAIT_BANK);
      this.alpha = Math.min(1, this.acc / DT);
    }
    if (ls.status === 'live') ls.commit(this.catchingUp ? ls.confirmed + ls.delay - 1 : w.tick + ls.delay - 1 + this.frameSlack);
    ls.flush();
    this.flushLoaded();
    if (steps && this.o.onChange && (this.catchingUp || ls.status !== 'live')) this.o.onChange();
    return steps;
  }

  /**
   * Extra ticks to commit ahead on a machine that draws slowly. It commits once a frame, so at 3 frames a second the
   * others would wait up to a third of a second for each commit (the input delay covers the round trip, not this). It
   * commits that much further ahead instead: its own orders then run up to a frame later, which it could not show any
   * sooner, and nobody waits for it. 0 from 20 frames a second up.
   */
  get frameSlack(): number {
    return Math.min(8, Math.max(0, Math.ceil(this.frameMs / 50) - 1));
  }

  /** Tell the relay the match is loaded on this client (once it has caught up with the match: flushLoaded). */
  loaded() {
    this.loadPending = true;
    this.flushLoaded();
  }

  /** Far enough behind the closed ticks to re-simulate in catch-up mode (frame). */
  private behind(): boolean {
    return this.ls.confirmed - this.world.tick + 1 > CATCHUP_AT + this.ls.delay;
  }

  private flushLoaded() {
    if (!this.loadPending || this.catchingUp || this.behind()) return;
    this.loadPending = false;
    this.client.send({ t: 'loaded' });
  }

  /** Ask the relay to hand a stalled player to the AI. */
  dropStalled() {
    if (this.stall) this.client.send({ t: 'drop', seat: this.stall.seat });
  }

  /** Name of a seat's player. */
  nameOf(seat: number): string {
    return this.names.get(seat) ?? tNet('player.seat', { n: String(seat) });
  }

  dispose() {
    this.unsub();
    this.client.frameMs = () => 0;
    this.client.attached = false;
  }
}
