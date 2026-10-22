/**
 * Client side of the lockstep (DOM-free; the browser game and the headless test clients both run it).
 *
 *  - Local commands are scheduled for tick `world.tick + delay` (never at or below what was already committed)
 *    and sent with a commit; nothing is applied locally until the relay hands the tick back, so every client
 *    applies the same commands, in the same order, at the same tick.
 *  - `canStep()` is true while the commands of the next tick are known (the relay closed it).
 *  - `beforeStep()` applies the tick's drops (AI takeovers) and commands, `afterStep()` reports a world hash every
 *    NET_HASH_EVERY ticks and notices the end of the match.
 */
import type { Command } from '../sim/types';
import type { World } from '../sim/world';
import { worldHash } from '../replay/hash';
import { sanitizeCommand } from './commands';
import { aiTakeover } from './takeover';
import { DEFAULT_DELAY, MAX_CMDS_PER_MSG, MAX_DELAY, MIN_DELAY, NET_HASH_EVERY, type ClientMessage, type ResumeInfo, type TickCmd } from './protocol';

export interface LockstepOptions {
  world: World;
  /** Relay seat -> World player index (humans of the match). */
  seatPlayer: Map<number, number>;
  /** Our seat (null: watching only). */
  localSeat: number | null;
  send(m: ClientMessage): void;
  delay?: number;
  /** Every command executed (all players), right before the step of `tick`: the replay recorder. */
  onExecute?(cmd: Command, tick: number): void;
  /** A player was handed to the AI at `tick`. */
  onDrop?(tick: number, player: number): void;
  /** A player surrendered at `tick` (sim/resign.ts); the local one then only watches. */
  onResign?(tick: number, player: number): void;
}

export type LockstepStatus = 'live' | 'over' | 'desync';

export class Lockstep {
  readonly world: World;
  delay: number;
  /** Every command for ticks <= confirmed is known. */
  confirmed = -1;
  /** Highest tick we promised the relay (nothing more of ours will run at or below it). */
  committed = -1;
  status: LockstepStatus = 'live';
  /** Our seat was replaced by the AI (or we only watch): no commands, no commits. */
  watching: boolean;
  /** Recent world hashes [tick, hash] (desync diagnostics). */
  readonly hashes: [number, string][] = [];
  /** Commands dropped by the checks (src/net/commands.ts). */
  rejected = 0;
  private incoming: TickCmd[] = [];
  private head = 0;
  private drops: [number, number][] = [];
  private outbox: [number, Command][] = [];
  private sent: [number, Command][] = [];
  private sentCommit = -1;
  private localPlayer: number;
  /** We surrendered: the command is on its way, nothing more of ours is issued. */
  private resigning = false;
  /** Players whose surrender was seen (onResign fires once each). */
  private resigned = new Set<number>();

  constructor(private o: LockstepOptions) {
    this.world = o.world;
    this.delay = o.delay ?? DEFAULT_DELAY;
    this.localPlayer = o.localSeat === null ? -1 : o.seatPlayer.get(o.localSeat) ?? -1;
    this.watching = this.localPlayer < 0;
  }

  /** A command of the local player: scheduled a few ticks ahead and queued for the relay. */
  issue(cmd: Command) {
    if (this.watching || this.resigning || this.status !== 'live') return;
    const t = Math.max(this.world.tick + this.delay, this.committed + 1);
    const c = { ...cmd, player: this.localPlayer } as Command;
    this.outbox.push([t, c]);
  }

  /** Surrender (sim/resign.ts): our last command. Afterwards we issue nothing; once it runs we only watch. */
  resign(): boolean {
    if (this.watching || this.resigning || this.status !== 'live') return false;
    this.issue({ c: 'resign', player: this.localPlayer });
    this.resigning = true;
    return true;
  }

  /** Our surrender is on its way or done. */
  get surrendered(): boolean {
    return this.resigning || this.resigned.has(this.localPlayer);
  }

  setDelay(d: number) {
    this.delay = Math.max(MIN_DELAY, Math.min(MAX_DELAY, Math.round(d)));
  }

  /** The commands of the current tick are known. */
  canStep(): boolean {
    return this.status === 'live' && this.world.tick <= this.confirmed;
  }

  /** Promise the relay nothing more of ours for ticks <= upTo. */
  commit(upTo: number) {
    if (!this.watching && upTo > this.committed) this.committed = upTo;
  }

  /** Send queued commands and the commit (when either changed). */
  flush() {
    if (this.watching || this.status !== 'live') { this.outbox.length = 0; return; }
    if (this.committed <= this.sentCommit) return;
    // A command goes out with the commit that covers its tick, never before: then "the relay has our commit for
    // tick T" means exactly "it has all our commands up to T", which makes resending after a reconnect exact. (No
    // cost: the relay cannot close the tick before that commit anyway.)
    const ready = this.outbox.filter(([t]) => t <= this.committed);
    this.outbox = this.outbox.filter(([t]) => t > this.committed);
    // more than a frame's worth: several messages, each committing the ticks it completes (never splitting a tick,
    // so each message stays "all of our commands up to its commit"); a tick with more than a message's worth of
    // commands keeps the first ones (no player issues that many orders in 50 ms)
    let i = 0;
    do {
      let j = Math.min(ready.length, i + MAX_CMDS_PER_MSG);
      if (j < ready.length) { const t = ready[j][0]; let k = j; while (k > i && ready[k - 1][0] === t) k--; if (k > i) j = k; else { while (j < ready.length && ready[j][0] === t) j++; ready.splice(i + MAX_CMDS_PER_MSG, j - i - MAX_CMDS_PER_MSG); j = i + MAX_CMDS_PER_MSG; } }
      const part = ready.slice(i, j);
      const upTo = j < ready.length ? ready[j][0] - 1 : this.committed;
      this.o.send({ t: 'in', upTo, cmds: part });
      for (const p of part) this.sent.push(p);
      i = j;
    } while (i < ready.length);
    this.sentCommit = this.committed;
  }

  /** Closed ticks from the relay. */
  receive(m: { to: number; cmds: TickCmd[]; drops?: [number, number][] }) {
    const from = this.confirmed;
    for (const c of m.cmds) if (c[0] > from) this.incoming.push(c);
    for (const d of m.drops ?? []) if (d[0] >= this.world.tick && !this.drops.some((x) => x[0] === d[0] && x[1] === d[1])) this.drops.push(d);
    if (m.to > this.confirmed) this.confirmed = m.to;
    if (this.sent.length) this.sent = this.sent.filter(([t]) => t > this.confirmed);
  }

  /** After a reconnect: re-send what the relay never got, continue from its commit for our seat. */
  resume(info: ResumeInfo) {
    this.setDelay(info.delay);
    if (info.dropped) { this.watching = true; this.outbox.length = 0; this.sent.length = 0; return; }
    const lost = this.sent.filter(([t]) => t > info.committed);
    this.sent = this.sent.filter(([t]) => t <= info.committed);
    this.outbox = [...lost, ...this.outbox];
    this.sentCommit = info.committed;
    if (info.committed > this.committed) this.committed = info.committed;
  }

  /** Right before world.step(): this tick's AI takeovers and commands. */
  beforeStep() {
    const w = this.world, t = w.tick;
    if (this.drops.length) {
      for (const d of this.drops) {
        if (d[0] !== t) continue;
        const player = this.o.seatPlayer.get(d[1]);
        if (player === undefined) continue;
        aiTakeover(w, player);
        if (player === this.localPlayer) { this.watching = true; this.outbox.length = 0; }
        this.o.onDrop?.(t, player);
      }
      this.drops = this.drops.filter((d) => d[0] > t);
    }
    const inc = this.incoming;
    while (this.head < inc.length && inc[this.head][0] <= t) {
      const [ct, seat, raw] = inc[this.head++];
      if (ct !== t) continue;
      const player = this.o.seatPlayer.get(seat);
      const cmd = player === undefined ? null : sanitizeCommand(raw, player);
      if (!cmd) { this.rejected++; continue; }
      this.o.onExecute?.(cmd, t);
      w.issue(cmd);
    }
    if (this.head > 4096) { this.incoming = inc.slice(this.head); this.head = 0; }
  }

  /**
   * Right after world.step(): the periodic hash report, and the end of the match. Returns the hash it reported
   * (or null).
   */
  afterStep(): string | null {
    const w = this.world;
    let h: string | null = null;
    for (const p of w.players) {
      if (!p.resigned || this.resigned.has(p.id)) continue;
      this.resigned.add(p.id);
      // (the relay no longer waits for a seat that surrendered: we stop committing too)
      if (p.id === this.localPlayer) { this.watching = true; this.outbox.length = 0; this.sent.length = 0; }
      this.o.onResign?.(w.tick, p.id);
    }
    if (w.tick % NET_HASH_EVERY === 0) {
      h = worldHash(w);
      this.hashes.push([w.tick, h]);
      if (this.hashes.length > 64) this.hashes.shift();
      this.o.send({ t: 'hash', tick: w.tick, h });
    }
    if (w.gameOver && this.status === 'live') {
      this.status = 'over';
      this.o.send({ t: 'over', tick: w.tick, winner: w.winnerTeam });
    }
    return h;
  }

  /** Our own hash at a tick, if still remembered. */
  hashAt(tick: number): string | null {
    return this.hashes.find((h) => h[0] === tick)?.[1] ?? null;
  }

  /** Commands queued locally that the relay has not confirmed yet. */
  get pendingLocal(): number {
    return this.outbox.length + this.sent.length;
  }
}

export { DEFAULT_DELAY };
