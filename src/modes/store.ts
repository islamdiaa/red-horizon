/**
 * Challenge storage and files.
 *  - Challenges: IndexedDB "rh-challenges" / "challenges" (keyed by id), localStorage "rh.challenges" fallback.
 *  - Personal bests: localStorage "rh.challenge.bests" ({ [id]: ChallengeBest }).
 *  - Files (.rhchallenge.json): { "rhchallenge": 1, "title", "encoding": "gzip+base64", "data": "<base64 gzip of the ChallengeDef JSON>" }
 *    when CompressionStream is available, else { "rhchallenge": 1, "title", "challenge": {...} }. Both import.
 */
import { BUILTINS, BUILTIN_LIST } from './builtins';
import type { ChallengeDef, ChallengeResult } from './types';
import { gunzipBounded, parseUntrustedJson, UntrustedInputError } from '../platform/untrusted';
import tModes from '../i18n/en/modes';

const DB = 'rh-challenges';
const STORE = 'challenges';
const LS_KEY = 'rh.challenges';
const BEST_KEY = 'rh.challenge.bests';
export const FILE_EXT = '.rhchallenge.json';
/** Stored (non built-in) challenges kept. */
export const MAX_CHALLENGES = 40;

export interface ChallengeBest {
  attempts: number;
  completed: number;
  bestScore: number;
  bestStars: number;
  /** Fastest completion (seconds). */
  bestTime: number | null;
  lastAt: number;
}

export function isChallengeDef(x: unknown): x is ChallengeDef {
  const c = x as ChallengeDef;
  return !!c && typeof c === 'object' && c.v === 1 && typeof c.id === 'string' && typeof c.title === 'string' && !!c.setup && typeof c.setup === 'object'
    && typeof c.setup.seed === 'number' && typeof c.side === 'number' && !!c.goal && ['win', 'survive', 'destroy', 'protect', 'hold'].includes(c.goal.kind)
    && typeof c.timeLimit === 'number' && (c.state !== undefined || (typeof c.builtin === 'string'));
}

// ---- IndexedDB with a localStorage fallback ---------------------------------------------
let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}
function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
function lsRead(): ChallengeDef[] {
  try {
    const list = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(isChallengeDef) : [];
  } catch {
    return [];
  }
}
function lsWrite(list: ChallengeDef[]) {
  for (let n = list.length; n >= 0; n--) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, n))); return; } catch { /* quota: fewer */ }
  }
}
const newestFirst = (a: ChallengeDef, b: ChallengeDef) => b.createdAt - a.createdAt;

/** Stored challenges (made or imported), newest first. Built-ins are BUILTIN_LIST. */
export async function listChallenges(): Promise<ChallengeDef[]> {
  const db = await openDb();
  if (db) {
    try { return ((await tx<ChallengeDef[]>(db, 'readonly', (s) => s.getAll() as IDBRequest<ChallengeDef[]>)) ?? []).filter(isChallengeDef).sort(newestFirst); } catch { /* fall through */ }
  }
  return lsRead().sort(newestFirst);
}

/** A challenge by id (built-ins included). */
export async function getChallenge(id: string): Promise<ChallengeDef | null> {
  if (BUILTINS[id]) return BUILTINS[id].def;
  return (await listChallenges()).find((c) => c.id === id) ?? null;
}

export async function saveChallenge(c: ChallengeDef): Promise<void> {
  if (BUILTINS[c.id]) return;
  const db = await openDb();
  if (db) {
    try {
      await tx(db, 'readwrite', (s) => { s.put(c); });
      const stale = (await listChallenges()).slice(MAX_CHALLENGES);
      if (stale.length) await tx(db, 'readwrite', (s) => { for (const x of stale) s.delete(x.id); });
      return;
    } catch { /* fall back */ }
  }
  const list = lsRead().filter((x) => x.id !== c.id);
  list.unshift(c);
  lsWrite(list.sort(newestFirst).slice(0, MAX_CHALLENGES));
}

export async function deleteChallenge(id: string): Promise<void> {
  const db = await openDb();
  if (db) { try { await tx(db, 'readwrite', (s) => { s.delete(id); }); } catch { /* ignore */ } }
  const list = lsRead();
  if (list.some((c) => c.id === id)) lsWrite(list.filter((c) => c.id !== id));
}

// ---- personal bests ------------------------------------------------------------------------
export function loadBests(): Record<string, ChallengeBest> {
  try {
    const v = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Record an attempt; returns the updated best and whether the score is a new personal best. */
export function recordAttempt(id: string, r: ChallengeResult, now = Date.now()): { best: ChallengeBest; newBest: boolean; previous: ChallengeBest | null } {
  const all = loadBests();
  const prev = all[id] ?? null;
  const b: ChallengeBest = prev ? { ...prev } : { attempts: 0, completed: 0, bestScore: 0, bestStars: 0, bestTime: null, lastAt: 0 };
  b.attempts++;
  b.lastAt = now;
  const newBest = r.won && r.score > b.bestScore;
  if (r.won) {
    b.completed++;
    b.bestScore = Math.max(b.bestScore, r.score);
    b.bestStars = Math.max(b.bestStars, r.stars);
    b.bestTime = b.bestTime === null ? r.time : Math.min(b.bestTime, r.time);
  }
  all[id] = b;
  try { localStorage.setItem(BEST_KEY, JSON.stringify(all)); } catch { /* storage full */ }
  return { best: b, newBest, previous: prev };
}

// ---- files ---------------------------------------------------------------------------------
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** File text for a challenge (gzip + base64 inside JSON when CompressionStream exists). */
export async function encodeChallengeFile(c: ChallengeDef, compress = true): Promise<string> {
  const json = JSON.stringify(c);
  if (compress && typeof CompressionStream !== 'undefined') {
    try {
      const gz = await pipe(new TextEncoder().encode(json), new CompressionStream('gzip'));
      return JSON.stringify({ rhchallenge: 1, title: c.title, encoding: 'gzip+base64', data: toBase64(gz) });
    } catch { /* fall back to plain */ }
  }
  return JSON.stringify({ rhchallenge: 1, title: c.title, challenge: c });
}

/** Read a challenge file's text (throws a user-facing message on a bad file). */
export async function decodeChallengeFile(text: string): Promise<ChallengeDef> {
  let doc: { rhchallenge?: number; encoding?: string; data?: string; challenge?: unknown };
  try { doc = parseUntrustedJson(text, { maxChars: 30 << 20, maxString: 30 << 20 }) as typeof doc; } catch (e) {
    throw new Error(e instanceof UntrustedInputError ? e.message : tModes('file.invalidJson'));
  }
  let c: unknown = doc;
  if (doc && doc.rhchallenge === 1) {
    if (doc.encoding === 'gzip+base64' && typeof doc.data === 'string') {
      if (typeof DecompressionStream === 'undefined') throw new Error(tModes('file.noDecompress'));
      try { c = parseUntrustedJson(await gunzipBounded(fromBase64(doc.data), 64 << 20), { maxChars: 64 << 20, maxString: 64 << 20 }); } catch (e) {
        throw new Error(e instanceof UntrustedInputError ? e.message : tModes('file.damaged'));
      }
    } else c = doc.challenge;
  }
  if (!isChallengeDef(c)) throw new Error(tModes('file.notChallenge'));
  if (c.builtin && !BUILTINS[c.builtin]) throw new Error(tModes('file.newer'));
  return c;
}

export function challengeFileName(c: ChallengeDef): string {
  const slug = c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'challenge';
  return `red-horizon-${slug}${FILE_EXT}`;
}

/** Download a challenge as a .rhchallenge.json file. */
export async function exportChallenge(c: ChallengeDef) {
  const blob = new Blob([await encodeChallengeFile(c)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = challengeFileName(c);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Import a .rhchallenge.json file and store it (an id that exists is replaced). */
export async function importChallengeFile(file: File): Promise<ChallengeDef> {
  return (await importChallenge(file)).challenge;
}

/**
 * Import a challenge file. `already` tells the list a card for it exists: a built-in (never stored again: an exported
 * built-in comes back as itself) or one of the player's own with the same id (refreshed in place).
 */
export async function importChallenge(file: File): Promise<{ challenge: ChallengeDef; already: 'builtin' | 'stored' | null }> {
  if (file.size > 30 * 1024 * 1024) throw new Error(tModes('file.tooLarge'));
  const c = await decodeChallengeFile(await file.text());
  if (BUILTINS[c.id]) return { challenge: BUILTINS[c.id].def, already: 'builtin' };
  let known = false;
  try { known = (await listChallenges()).some((x) => x.id === c.id); } catch { /* no storage */ }
  const stored: ChallengeDef = { ...c, source: { ...(c.source ?? { kind: 'import' }), kind: c.source?.kind ?? 'import' } };
  await saveChallenge(stored);
  return { challenge: stored, already: known ? 'stored' : null };
}

export { BUILTIN_LIST };
