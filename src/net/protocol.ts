/**
 * Multiplayer wire protocol, shared by the browser client (src/net/client.ts), the headless clients of the
 * tests and the relay server (server/src/relay.ts). DOM-free and dependency-free.
 *
 * Messages are JSON text frames with a type field `t`. The relay never trusts a client: every inbound frame
 * goes through `parseClientMessage` (size, shape, bounds), and the commands inside are reduced to plain,
 * bounded data (`safeCommandShape`). The clients apply the strict, deterministic per-command checks
 * (src/net/commands.ts) when they execute a tick, so every client drops exactly the same commands.
 *
 * Lockstep in one paragraph: each client runs the whole simulation. A command issued at local tick W is
 * scheduled for tick W + delay and sent to the relay along with a commit ("I will send nothing more for ticks
 * <= upTo"). The relay closes a tick once every active seat has committed it and fans the closed ticks out, in
 * one order (tick, seat, arrival), to everyone. A client may step from tick T only when T is closed.
 */
import type { AIDifficulty } from '../sim/ai';
import type { FactionPick, MatchSettings } from './settings';

/** Bump when a message changes shape or meaning; the relay refuses other versions. (2: input delay up to 15 ticks,
 *  surrender.) */
export const NET_PROTOCOL = 2;
/** Players per room (humans and AI). */
export const MAX_SLOTS = 4;
/** Clients report a world hash every this many ticks (5 s). */
export const NET_HASH_EVERY = 100;
/**
 * Input delay bounds in ticks (100-750 ms at 20 Hz). The relay picks the delay (delayFor) and every client clamps what
 * it is told to the same bounds (Lockstep.setDelay): one table for both sides. Up to 15 ticks the match keeps real
 * time on links up to about 650 ms round trip; beyond that it slows down instead.
 */
export const MIN_DELAY = 2;
export const MAX_DELAY = 15;
export const DEFAULT_DELAY = 3;
/** Invite codes: no 0/O, 1/I/L look-alikes. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
/** Largest client frame the relay accepts (bytes of UTF-16 text; the ws layer caps raw bytes the same). */
export const MAX_CLIENT_MSG = 16 * 1024;
export const MAX_NAME = 20;
export const MAX_CHAT = 160;
/** Commands per `in` frame. */
export const MAX_CMDS_PER_MSG = 32;
/** Units named in one command (a box selection of a big army). */
export const MAX_UNITS_PER_CMD = 400;
/** A client may commit at most this far past the closed tick (legit clients stay within delay + 1). */
export const MAX_COMMIT_AHEAD = 40;

export type SlotKind = 'open' | 'closed' | 'human' | 'ai';

export interface SlotView {
  kind: SlotKind;
  /** Seat id of the human in this slot. */
  seat?: number;
  name?: string;
  ready?: boolean;
  connected?: boolean;
  /** A human replaced by the AI mid-match. */
  dropped?: boolean;
  faction: FactionPick;
  ai?: AIDifficulty;
  /** Commander rules doctrine (sim/doctrine.ts) the player picked, null = none. */
  doctrine?: string | null;
}

export type RoomPhase = 'lobby' | 'match' | 'over';

export interface RoomView {
  code: string;
  phase: RoomPhase;
  /** Seat id of the host (settings, AI slots, start). */
  host: number;
  /** Game build fingerprint and mod set hash every member shares. */
  build: string;
  mods: string;
  settings: MatchSettings;
  slots: SlotView[];
}

/** [tick, seat, command] as fanned out by the relay. */
export type TickCmd = [number, number, unknown];

// ---------------------------------------------------------------------------------------------------------
// client -> relay
// ---------------------------------------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'hello'; proto: number; build: string; mods: string; name: string; create?: { settings?: unknown }; join?: string; resume?: { code: string; token: string; have: number } }
  | { t: 'settings'; settings: unknown }
  | { t: 'slot'; slot: number; kind: 'open' | 'closed' | 'ai'; ai?: AIDifficulty; faction?: FactionPick }
  | { t: 'me'; faction?: FactionPick; doctrine?: string | null; ready?: boolean; slot?: number }
  | { t: 'chat'; text: string }
  | { t: 'kick'; seat: number }
  | { t: 'start' }
  | { t: 'loaded' }
  | { t: 'in'; upTo: number; cmds: [number, unknown][] }
  | { t: 'hash'; tick: number; h: string }
  | { t: 'drop'; seat: number }
  /** `f`: the client's frame time (ms): a ping waits about half of it for the page's next turn (see Relay.onPong). */
  | { t: 'pong'; n: number; f?: number }
  | { t: 'over'; tick: number; winner: number }
  | { t: 'lobby' }
  | { t: 'bye' };

// ---------------------------------------------------------------------------------------------------------
// relay -> client
// ---------------------------------------------------------------------------------------------------------

export interface MatchStart {
  seed: number;
  /** The room as it was when the match started: the roster and the settings every client builds from. */
  room: RoomView;
}

export interface ResumeInfo {
  start: MatchStart;
  /** What the relay holds for this seat: commands for ticks above `committed` must be sent again. */
  committed: number;
  closed: number;
  /** The seat was replaced by the AI: watch only. */
  dropped: boolean;
  delay: number;
}

export type ServerMessage =
  | { t: 'welcome'; code: string; seat: number; token: string; room: RoomView; resume?: ResumeInfo }
  | { t: 'room'; room: RoomView }
  | { t: 'chat'; seat: number; name: string; text: string }
  | { t: 'start'; start: MatchStart; delay: number }
  | { t: 'tick'; to: number; cmds: TickCmd[]; drops?: [number, number][] }
  | { t: 'lat'; rtt: [number, number][]; delay: number }
  | { t: 'stall'; seat: number; ms: number; canDrop: boolean; gone: boolean; loading: boolean }
  | { t: 'desync'; tick: number; hashes: [number, string][] }
  | { t: 'ping'; n: number }
  | { t: 'error'; code: string; msg: string }
  | { t: 'closed'; reason: string };

// ---------------------------------------------------------------------------------------------------------
// validation (relay side; also used by the clients on what the relay sends)
// ---------------------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const KEY = /^[A-Za-z][A-Za-z0-9]{0,23}$/;
const ID = /^[A-Za-z0-9_\-:.]{0,64}$/;
const FACTION_PICKS = new Set(['allies', 'soviet', 'random']);
const AI_LEVELS = new Set(['recruit', 'easy', 'normal', 'hard', 'brutal']); // (= src/sim/ai.ts AI_DIFFICULTIES; a copy keeps the simulation out of the relay bundle)
export const isCode = (v: unknown): v is string => typeof v === 'string' && v.length === CODE_LENGTH && [...v].every((c) => CODE_ALPHABET.includes(c));

/**
 * Reduce an untrusted command to plain, bounded data: an object with an alphanumeric `c`, alphanumeric keys
 * and values that are finite numbers, booleans, short id-like strings, or small arrays of those (numbers,
 * [x, y] pairs, {type, cx, cy} plan items). Returns null when anything does not fit. Semantics are checked by
 * the clients (src/net/commands.ts); this keeps junk, huge payloads and prototype keys out of the relay.
 */
export function safeCommandShape(raw: unknown): Record<string, unknown> | null {
  if (!isObj(raw) || typeof raw.c !== 'string' || !KEY.test(raw.c)) return null;
  let nodes = 0;
  const val = (v: unknown, depth: number): unknown => {
    if (++nodes > 2000) throw new Error('too big');
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('nan'); return v; }
    if (typeof v === 'boolean' || v === null) return v;
    if (typeof v === 'string') { if (!ID.test(v)) throw new Error('str'); return v; }
    if (depth >= 3) throw new Error('deep');
    if (Array.isArray(v)) { if (v.length > MAX_UNITS_PER_CMD) throw new Error('long'); return v.map((x) => val(x, depth + 1)); }
    if (isObj(v)) {
      const o: Record<string, unknown> = {};
      const keys = Object.keys(v);
      if (keys.length > 16) throw new Error('keys');
      for (const k of keys) { if (!KEY.test(k)) throw new Error('key'); o[k] = val(v[k], depth + 1); }
      return o;
    }
    throw new Error('type');
  };
  try {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(raw);
    if (keys.length > 16) return null;
    for (const k of keys) {
      if (!KEY.test(k)) return null;
      out[k] = val(raw[k], 1);
    }
    return out;
  } catch {
    return null;
  }
}

/** Parse and shape-check a client frame. Returns null for anything malformed (the relay counts and drops it). */
export function parseClientMessage(text: unknown): ClientMessage | null {
  if (typeof text !== 'string' || text.length > MAX_CLIENT_MSG) return null;
  let m: unknown;
  try { m = JSON.parse(text); } catch { return null; }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hello': {
      if (!isInt(m.proto, 0, 1e6) || !isStr(m.build, 80) || !isStr(m.mods, 80) || !isStr(m.name, 200)) return null;
      const out: ClientMessage = { t: 'hello', proto: m.proto, build: m.build, mods: m.mods, name: m.name };
      if (m.create !== undefined) {
        if (!isObj(m.create)) return null;
        out.create = { settings: m.create.settings };
      }
      if (m.join !== undefined) { if (!isCode(m.join)) return null; out.join = m.join; }
      if (m.resume !== undefined) {
        const r = m.resume;
        if (!isObj(r) || !isCode(r.code) || !isStr(r.token, 64) || !isInt(r.have, -1, 1e9)) return null;
        out.resume = { code: r.code, token: r.token, have: r.have };
      }
      if (+!!out.create + +!!out.join + +!!out.resume !== 1) return null;
      return out;
    }
    case 'settings':
      return isObj(m.settings) ? { t: 'settings', settings: m.settings } : null;
    case 'slot':
      if (!isInt(m.slot, 0, MAX_SLOTS - 1) || (m.kind !== 'open' && m.kind !== 'closed' && m.kind !== 'ai')) return null;
      if (m.ai !== undefined && !(typeof m.ai === 'string' && AI_LEVELS.has(m.ai))) return null;
      if (m.faction !== undefined && !(typeof m.faction === 'string' && FACTION_PICKS.has(m.faction))) return null;
      return { t: 'slot', slot: m.slot, kind: m.kind, ai: m.ai as AIDifficulty | undefined, faction: m.faction as FactionPick | undefined };
    case 'me': {
      const out: Extract<ClientMessage, { t: 'me' }> = { t: 'me' };
      if (m.faction !== undefined) { if (typeof m.faction !== 'string' || !FACTION_PICKS.has(m.faction)) return null; out.faction = m.faction as FactionPick; }
      if (m.doctrine !== undefined) { if (m.doctrine !== null && !(isStr(m.doctrine, 40) && ID.test(m.doctrine))) return null; out.doctrine = m.doctrine as string | null; }
      if (m.ready !== undefined) { if (typeof m.ready !== 'boolean') return null; out.ready = m.ready; }
      if (m.slot !== undefined) { if (!isInt(m.slot, 0, MAX_SLOTS - 1)) return null; out.slot = m.slot; }
      return out;
    }
    case 'chat':
      return isStr(m.text, 1000) ? { t: 'chat', text: m.text } : null;
    case 'kick':
      return isInt(m.seat, 0, 1e6) ? { t: 'kick', seat: m.seat } : null;
    case 'start': case 'loaded': case 'lobby': case 'bye':
      return { t: m.t };
    case 'in': {
      if (!isInt(m.upTo, -1, 1e9) || !Array.isArray(m.cmds) || m.cmds.length > MAX_CMDS_PER_MSG) return null;
      const cmds: [number, unknown][] = [];
      for (const e of m.cmds) {
        if (!Array.isArray(e) || e.length !== 2 || !isInt(e[0], 0, 1e9)) return null;
        const c = safeCommandShape(e[1]);
        if (!c) return null;
        cmds.push([e[0], c]);
      }
      return { t: 'in', upTo: m.upTo, cmds };
    }
    case 'hash':
      return isInt(m.tick, 0, 1e9) && typeof m.h === 'string' && /^[0-9a-f]{16}$/.test(m.h) ? { t: 'hash', tick: m.tick, h: m.h } : null;
    case 'drop':
      return isInt(m.seat, 0, 1e6) ? { t: 'drop', seat: m.seat } : null;
    case 'pong':
      if (!isInt(m.n, 0, 1e12) || (m.f !== undefined && !isInt(m.f, 0, 10_000))) return null;
      return m.f === undefined ? { t: 'pong', n: m.n } : { t: 'pong', n: m.n, f: m.f };
    case 'over':
      return isInt(m.tick, 0, 1e9) && isInt(m.winner, -1, 64) ? { t: 'over', tick: m.tick, winner: m.winner } : null;
    default:
      return null;
  }
}

/** Random invite code from a source of uniform integers in [0, n). */
export function makeCode(randInt: (n: number) => number): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randInt(CODE_ALPHABET.length)];
  return s;
}

/** Normalise what a player typed as a code (case, spaces, a pasted invite link). */
export function normaliseCode(input: string): string | null {
  const m = /(?:[#&?]join=)?([A-Za-z0-9]{6})\s*$/.exec(input.trim().replace(/[\s-]/g, ''));
  const c = m ? m[1].toUpperCase() : '';
  return isCode(c) ? c : null;
}

/**
 * Input delay (ticks) the relay recommends for the room's round-trip times: enough to cover the slowest
 * player's round trip plus jitter, within MIN_DELAY-MAX_DELAY (100-750 ms). A command issued at tick W runs at
 * W + delay; it must reach the relay, and the relay's closing of that tick must come back, before the issuing
 * client gets there: one round trip, the jitter on both legs, and a little for frames and timers.
 */
export function delayFor(maxRtt: number, maxJitter: number): number {
  const d = Math.ceil((maxRtt + 2 * maxJitter + 30) / 50);
  return Math.max(MIN_DELAY, Math.min(MAX_DELAY, d));
}
