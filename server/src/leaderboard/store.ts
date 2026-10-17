/**
 * Leaderboard storage: one JSON file on a volume, no database. Per board, per UTC day, the top entries by score
 * (ties: the faster run, then the earlier submission). One entry per player and board-day (the best one).
 *
 * Bounded: `top` entries per board-day, `keepDays` days, `maxBoards` boards, and the file size; old days are
 * pruned first. Writes are debounced and atomic (temporary file + rename), so a crash never leaves half a file.
 * Holds no personal data: a cleaned nickname, the score, run length, a coarse timestamp and a salted hash of a
 * random per-browser id.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Entry {
  /** Name (cleaned), score, run length (ticks), won, submitted at (ms, to the minute), player key. */
  n: string;
  s: number;
  t: number;
  w: boolean;
  a: number;
  p: string;
}

export interface PublicEntry { rank: number; name: string; score: number; seconds: number; won: boolean; at: number; you?: boolean }

interface Data {
  v: 1;
  salt: string;
  boards: Record<string, Record<string, Entry[]>>;
}

export interface StoreOptions {
  file: string | null;
  top?: number;
  keepDays?: number;
  maxBoards?: number;
  maxBytes?: number;
  writeDelayMs?: number;
}

export class LeaderboardStore {
  private data: Data;
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly top: number;
  readonly keepDays: number;
  readonly maxBoards: number;
  readonly maxBytes: number;

  constructor(private o: StoreOptions) {
    this.top = o.top ?? 50;
    this.keepDays = o.keepDays ?? 30;
    this.maxBoards = o.maxBoards ?? 64;
    this.maxBytes = o.maxBytes ?? 4 << 20;
    this.data = this.load();
  }

  private load(): Data {
    const fresh: Data = { v: 1, salt: randomBytes(16).toString('hex'), boards: {} };
    if (!this.o.file) return fresh;
    try {
      const raw = JSON.parse(readFileSync(this.o.file, 'utf8')) as Data;
      if (raw && raw.v === 1 && typeof raw.salt === 'string' && raw.boards && typeof raw.boards === 'object') return raw;
    } catch { /* missing or unreadable: start empty */ }
    return fresh;
  }

  /** Salted key for a random player id (stable per server). */
  key(player: string): string {
    return createHash('sha256').update(this.data.salt).update(player).digest('base64url').slice(0, 16);
  }

  /** Add a verified run. Returns its rank (1-based) on the board-day, or 0 when it did not make the top. */
  add(board: string, day: string, e: Omit<Entry, 'p'> & { player: string }): { rank: number; improved: boolean } {
    const p = this.key(e.player);
    const boards = this.data.boards;
    if (!boards[board]) {
      if (Object.keys(boards).length >= this.maxBoards) return { rank: 0, improved: false };
      boards[board] = {};
    }
    const list = (boards[board][day] ??= []);
    const entry: Entry = { n: e.n, s: e.s, t: e.t, w: e.w, a: Math.floor(e.a / 60000) * 60000, p };
    const prev = list.findIndex((x) => x.p === p);
    if (prev >= 0) {
      if (!better(entry, list[prev])) return { rank: rankOf(list, p), improved: false };
      list.splice(prev, 1);
    }
    list.push(entry);
    list.sort(order);
    if (list.length > this.top) list.length = this.top;
    this.schedule();
    return { rank: rankOf(list, p), improved: true };
  }

  /** The top of a board-day (the player's own entry flagged). */
  list(board: string, day: string, player?: string): PublicEntry[] {
    const list = this.data.boards[board]?.[day] ?? [];
    const me = player ? this.key(player) : '';
    return list.map((x, i) => ({ rank: i + 1, name: x.n, score: x.s, seconds: Math.round(x.t / 20), won: x.w, at: x.a, ...(me && x.p === me ? { you: true } : {}) }));
  }

  /** Days that have entries on a board (newest first). */
  days(board: string): string[] {
    return Object.keys(this.data.boards[board] ?? {}).sort().reverse();
  }

  /** Drop days older than keepDays, then the oldest days until the file fits. */
  prune(today: string) {
    const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - this.keepDays * 86400_000).toISOString().slice(0, 10);
    for (const [b, days] of Object.entries(this.data.boards)) {
      for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
      if (!Object.keys(days).length) delete this.data.boards[b];
    }
    let text = JSON.stringify(this.data);
    while (text.length > this.maxBytes) {
      const all = Object.entries(this.data.boards).flatMap(([b, days]) => Object.keys(days).map((d) => [b, d] as const)).sort((x, y) => (x[1] < y[1] ? -1 : 1));
      if (!all.length) break;
      const [b, d] = all[0];
      delete this.data.boards[b][d];
      if (!Object.keys(this.data.boards[b]).length) delete this.data.boards[b];
      text = JSON.stringify(this.data);
    }
  }

  private schedule() {
    if (!this.o.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.o.writeDelayMs ?? 2000);
    this.timer.unref?.();
  }

  /** Write now (atomically). */
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.o.file) return;
    this.prune(new Date().toISOString().slice(0, 10));
    mkdirSync(dirname(this.o.file), { recursive: true });
    const tmp = `${this.o.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.o.file);
  }

  /** Serialized size (bytes of JSON). */
  get size(): number {
    return JSON.stringify(this.data).length;
  }
}

/** Higher score first; then the shorter run; then the earlier submission. */
function order(a: Entry, b: Entry): number {
  return b.s - a.s || a.t - b.t || a.a - b.a;
}
function better(a: Entry, b: Entry): boolean {
  return a.s > b.s || (a.s === b.s && a.t < b.t);
}
function rankOf(list: Entry[], p: string): number {
  return list.findIndex((x) => x.p === p) + 1;
}
