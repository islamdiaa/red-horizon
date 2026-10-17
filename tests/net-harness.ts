/**
 * Multiplayer test harness: an in-process relay (server/src/relay.ts) and headless clients (src/net) on a
 * virtual network with latency, jitter, induced delay and dropped connections, all on a virtual clock, so five
 * simulated minutes of a four-player match run in seconds.
 */
import { BUILDINGS } from '../src/data/rules';
import { headlessGame } from '../src/modes/headless';
import { NetClient, type SocketLike } from '../src/net/client';
import { MatchSession } from '../src/net/session';
import { matchSetup } from '../src/net/roster';
import type { MatchStart, RoomView, ServerMessage } from '../src/net/protocol';
import { BUILD_FINGERPRINT } from '../src/net/fingerprint';
import { worldHash } from '../src/replay/hash';
import { CommandFeeder, hookStep } from '../src/replay/core';
import type { Command } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { Relay, type RelayLimits } from '../server/src/relay';
import { Rng } from '../src/core/rng';
import { hookRecordedDrops } from '../src/net/takeover';
import { enterPortableMath } from '../src/net/dmath';

// multiplayer matches run with portable math on every client (as the game does)
enterPortableMath();

// ---------------------------------------------------------------------------------------------------------
// virtual clock and network
// ---------------------------------------------------------------------------------------------------------

export class VClock {
  t = 1_000_000;
  private q: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;
  now = () => this.t;
  at(at: number, fn: () => void) {
    this.q.push({ at, seq: this.seq++, fn });
  }
  setTimeout = (fn: () => void, ms: number) => { const e = { at: this.t + ms, seq: this.seq++, fn }; this.q.push(e); return e; };
  clearTimeout = (h: unknown) => { this.q = this.q.filter((e) => e !== h); };
  /** Run everything due up to now + ms, in time order. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.q.length; i++) {
        const e = this.q[i];
        if (e.at <= end && (best < 0 || e.at < this.q[best].at || (e.at === this.q[best].at && e.seq < this.q[best].seq))) best = i;
      }
      if (best < 0) break;
      const e = this.q.splice(best, 1)[0];
      if (e.at > this.t) this.t = e.at;
      e.fn();
    }
    this.t = end;
  }
  get timers() { return { setTimeout: this.setTimeout, clearTimeout: this.clearTimeout, now: this.now }; }
}

export interface Link { latency: number; jitter: number; extra: number; up: boolean }

/** A virtual network: client sockets wired to the relay with per-link one-way latency (ordered, like TCP). */
export class VNet {
  links = new Map<string, Link>();
  /** Messages the relay sent, by type (statistics for the tests). */
  sent = new Map<string, number>();
  constructor(readonly clock: VClock, readonly relay: Relay, private rng = new Rng(99)) {}

  link(name: string, latency = 30, jitter = 5): Link {
    const l = { latency, jitter, extra: 0, up: true };
    this.links.set(name, l);
    return l;
  }

  /** A socket factory for a client on link `name`. */
  socket(name: string): (url: string) => SocketLike {
    return () => {
      const link = this.links.get(name) ?? this.link(name);
      const clock = this.clock;
      let open = false, closed = false, closing = false;
      let lastUp = 0, lastDown = 0;
      const delay = (last: number) => Math.max(last, clock.t + link.latency / 2 + link.extra + this.rng.next() * link.jitter);
      const s: SocketLike = {
        get readyState() { return closed ? 3 : closing ? 2 : open ? 1 : 0; },
        onopen: null, onmessage: null, onclose: null, onerror: null,
        send: (data: string) => {
          if (!open || closed || closing) return;
          if (!link.up) { doClose(); return; }
          lastUp = delay(lastUp);
          clock.at(lastUp, () => { if (!closed) handle?.message(data); });
        },
        close: () => doClose(),
      };
      // a close from either side arrives after what that side already sent (as on a TCP connection)
      const doClose = (fromRelay = false) => {
        if (closed || closing) return;
        closing = true;
        const at = Math.max(clock.t, fromRelay ? lastDown : lastUp) + 1;
        clock.at(at, () => { closed = true; handle?.close(); s.onclose?.({ code: 1006 }); });
      };
      const conn = {
        send: (text: string) => {
          if (closed || closing) return;
          const t = (JSON.parse(text) as ServerMessage).t;
          this.sent.set(t, (this.sent.get(t) ?? 0) + 1);
          lastDown = delay(lastDown);
          clock.at(lastDown, () => { if (!closed) s.onmessage?.({ data: text }); });
        },
        close: () => doClose(true),
      };
      let handle: ReturnType<Relay['connect']> = null;
      clock.at(clock.t + link.latency, () => {
        if (closed) return;
        if (!link.up) { doClose(); return; }
        handle = this.relay.connect(conn, `10.0.0.${[...this.links.keys()].indexOf(name) + 1}`);
        if (!handle) return;
        open = true;
        s.onopen?.();
      });
      return s;
    };
  }
}

export function makeRelay(clock: VClock, limits: Partial<RelayLimits> = {}, seed = 7) {
  const rng = new Rng(seed);
  let n = 0;
  return new Relay({ now: clock.now, randInt: (k) => Math.floor(rng.next() * k), token: () => `tok${(n++).toString(36)}${Math.floor(rng.next() * 1e9).toString(36)}`, limits });
}

// ---------------------------------------------------------------------------------------------------------
// headless players
// ---------------------------------------------------------------------------------------------------------

/** A scripted player for one side: deploy, build a base, train an army, attack (reads world state only). */
export function scriptedPlayer(world: World, me: number, issue: (c: Command) => void, seed = 1) {
  const p = world.players[me];
  const sov = p.faction === 'soviet';
  const order = ['powr', 'proc', sov ? 'barr' : 'tent', 'powr', 'weap'];
  let built = 0;
  const rng = new Rng(seed);
  const wave = 20 * (25 + Math.floor(rng.next() * 10));
  return () => {
    const t = world.tick;
    if (p.defeated) return;
    if (t === 2 + me) {
      const mcv = world.units.find((u) => u.owner === p && u.ut.deploysInto);
      if (mcv) issue({ c: 'deploy', player: me, units: [mcv.id] });
    }
    const q = p.queues.structure;
    if (p.has('fact') && !q.items.length && !q.ready && built < order.length && p.canBuild(order[built])) issue({ c: 'build', player: me, type: order[built] });
    if (q.ready && t % 7 === me) {
      const fact = world.buildings.find((b) => b.owner === p && b.bt.id === 'fact');
      const bt = BUILDINGS[q.ready];
      if (fact) {
        search: for (let r = 2; r < 12; r++) {
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const cx = fact.cx + dx * 2, cy = fact.cy + dy * 2;
            if (world.canPlace(p, bt.id, cx, cy)) { issue({ c: 'place', player: me, type: bt.id, cx, cy }); built++; break search; }
          }
        }
      }
    }
    if (t % 160 === me * 7) {
      if (p.canBuild('e1')) issue({ c: 'build', player: me, type: 'e1', count: 2 });
      const tank = sov ? '3tnk' : '2tnk';
      if (p.canBuild(tank) && !p.queues.vehicle.items.length) issue({ c: 'build', player: me, type: tank });
    }
    if (t % wave === 0 && t >= 20 * 100) {
      const army = world.units.filter((u) => u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
      const foe = world.players.find((o) => o.team !== p.team && !o.defeated);
      const target = foe && world.buildings.find((b) => b.owner === foe && b.alive);
      if (army.length && target) issue({ c: 'move', player: me, units: army, x: target.x, y: target.y, attackMove: true });
      if (army.length > 2) issue({ c: 'stance', player: me, units: army.slice(0, 2), stance: 'aggressive' });
    }
  };
}

export interface Peer {
  name: string;
  client: NetClient;
  session: MatchSession | null;
  world: World | null;
  start: MatchStart | null;
  bot: (() => void) | null;
  /** Commands executed by this peer's lockstep (the replay it would save). */
  executed: [number, Command][];
  drops: [number, number][];
  errors: string[];
  messages: ServerMessage[];
  /** Run frames (false: a frozen client, e.g. a hung tab). */
  running: boolean;
  /** Never report the match as loaded (a page still building it). */
  noLoad?: boolean;
}

export class Match {
  clock = new VClock();
  relay: Relay;
  net: VNet;
  peers: Peer[] = [];
  private relayTimer = 0;

  constructor(limits: Partial<RelayLimits> = {}) {
    this.relay = makeRelay(this.clock, limits);
    this.net = new VNet(this.clock, this.relay);
    this.clock.at(this.clock.t + 250, () => this.relayTick());
  }

  private relayTick() {
    this.relay.tick();
    this.clock.at(this.clock.t + 250, () => this.relayTick());
  }

  peer(name: string, latency = 30, jitter = 5, bot = true): Peer {
    this.net.link(name, latency, jitter);
    const client = new NetClient({ url: 'ws://relay', name, build: BUILD_FINGERPRINT, mods: '', socket: this.net.socket(name), timers: this.clock.timers });
    const p: Peer = { name, client, session: null, world: null, start: null, bot: null, executed: [], drops: [], errors: [], messages: [], running: true };
    client.on((m) => {
      p.messages.push(m);
      if (m.t === 'error') p.errors.push(m.code);
      if (m.t === 'start') this.begin(p, m.start, bot);
      if (m.t === 'welcome' && m.resume && !p.session) this.begin(p, m.resume.start, bot);
    });
    this.peers.push(p);
    return p;
  }

  /** The start (or a resume) arrived: build the world and the session (as the browser does after loading). */
  begin(p: Peer, start: MatchStart, bot: boolean) {
    p.start = start;
    const setup = matchSetup(start, p.client.seat, 'low', null);
    const g = headlessGame(setup);
    p.world = g.world;
    p.session = new MatchSession({
      client: p.client, world: g.world, start, localSeat: p.client.seat, now: this.clock.now,
      onExecute: (cmd, t) => p.executed.push([t, cmd]), onDrop: (t, pl) => p.drops.push([t, pl]),
    });
    if (!p.noLoad) p.session.loaded(); // (the browser does it on the first frame)
    if (bot && setup.net!.local >= 0) p.bot = scriptedPlayer(g.world, setup.net!.local, (c) => p.session!.issue(c), p.name.length * 7 + setup.net!.local);
  }

  /** Advance virtual time by one frame for everyone. */
  frame(ms = 1000 / 60) {
    this.clock.advance(ms);
    for (const p of this.peers) {
      if (!p.session || !p.running) continue;
      p.session.frame(ms / 1000, () => { p.bot?.(); p.world!.step(); p.world!.events.length = 0; if (p.world!.mission) p.world!.mission.events.length = 0; });
    }
  }

  /** Run frames until `done` or a time limit (virtual ms). */
  until(done: () => boolean, maxMs: number, frameMs = 1000 / 60): boolean {
    const end = this.clock.t + maxMs;
    while (this.clock.t < end) {
      if (done()) return true;
      this.frame(frameMs);
    }
    return done();
  }

  /** Create a room with the first peer, join with the others, get everyone ready, start. */
  setupRoom(settings: Record<string, unknown>, ai: { slot: number; ai: 'easy' | 'normal' | 'hard' }[] = []): RoomView {
    const [host, ...rest] = this.peers;
    host.client.create(settings);
    if (!this.until(() => host.client.state === 'open', 2000)) throw new Error('host did not get a room');
    for (const a of ai) host.client.send({ t: 'slot', slot: a.slot, kind: 'ai', ai: a.ai });
    for (const p of rest) {
      p.client.join(host.client.code);
      if (!this.until(() => p.client.state === 'open', 2000)) throw new Error(`${p.name} could not join: ${p.errors.join(',')}`);
    }
    for (const p of rest) p.client.send({ t: 'me', ready: true, faction: 'random' });
    this.until(() => !!host.client.room && host.client.room.slots.every((s) => s.kind !== 'human' || s.ready), 2000);
    host.client.send({ t: 'start' });
    if (!this.until(() => this.peers.every((p) => !!p.session), 3000)) throw new Error(`no start: ${host.errors.join(',')}`);
    return host.client.room!;
  }

  minTick(): number {
    return Math.min(...this.peers.filter((p) => p.world && p.session && !p.session.ls.watching).map((p) => p.world!.tick));
  }
}

/** Replay what a peer executed into a fresh world (with the recorded drops): the multiplayer replay. */
export function replayExecuted(p: Peer, ticks: number): string {
  const setup = matchSetup(p.start!, p.client.seat, 'low', null);
  setup.net!.drops = p.drops.slice();
  const g = headlessGame(setup);
  const feeder = new CommandFeeder(g.world, p.executed, []);
  hookStep(g.world, () => feeder.beforeStep(), null);
  hookRecordedDrops(g.world, setup.net!); // (as game.ts does for replays)
  const world = g.world;
  while (world.tick < ticks) { world.step(); world.events.length = 0; if (world.mission) world.mission.events.length = 0; }
  return worldHash(world);
}

export { worldHash };
