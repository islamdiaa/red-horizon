/**
 * Replay storage: the last MAX_REPLAYS matches in IndexedDB ("rh-replays" / "replays", keyed by id),
 * falling back to localStorage ("rh.replays") where IndexedDB is unavailable (private mode, tests).
 * Plus export to / import from .json files.
 */
import { MAX_REPLAYS, isReplayData, type ReplayData } from './format';
import { pruneTrees } from './branch'; // branches are pruned with their tree
import { parseUntrustedJson, UntrustedInputError } from '../platform/untrusted';

const DB = 'rh-replays';
const STORE = 'replays';
const LS_KEY = 'rh.replays';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
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

// ---- localStorage fallback ---------------------------------------------------------------
function lsRead(): ReplayData[] {
  try {
    const list = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(isReplayData) : [];
  } catch {
    return [];
  }
}
function lsWrite(list: ReplayData[]) {
  // keep dropping the oldest until it fits the quota
  for (let n = list.length; n >= 0; n--) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, n)));
      return;
    } catch { /* quota: try fewer */ }
  }
}

const newestFirst = (a: ReplayData, b: ReplayData) => b.createdAt - a.createdAt;
/** Pruning order: most recently stored first (an imported old match isn't dropped straight away). */
const recentFirst = (a: ReplayData, b: ReplayData) => (b.storedAt ?? b.createdAt) - (a.storedAt ?? a.createdAt);

// ---- API ----------------------------------------------------------------------------------
export async function listReplays(): Promise<ReplayData[]> {
  const db = await openDb();
  if (db) {
    try {
      const all = (await tx<ReplayData[]>(db, 'readonly', (s) => s.getAll() as IDBRequest<ReplayData[]>)) ?? [];
      return all.filter(isReplayData).sort(newestFirst);
    } catch { /* fall through */ }
  }
  return lsRead().sort(newestFirst);
}

export async function getReplay(id: string): Promise<ReplayData | null> {
  const db = await openDb();
  if (db) {
    try {
      const r = await tx<ReplayData>(db, 'readonly', (s) => s.get(id) as IDBRequest<ReplayData>);
      if (r && isReplayData(r)) return r;
    } catch { /* fall through */ }
  }
  return lsRead().find((r) => r.id === id) ?? null;
}

/** Store (or replace) a replay and prune the oldest beyond MAX_REPLAYS. */
export async function saveReplay(data: ReplayData): Promise<void> {
  data = { ...data, storedAt: Date.now() };
  const db = await openDb();
  if (db) {
    try {
      await tx(db, 'readwrite', (s) => { s.put(data); });
      const stale = pruneTrees(await listReplays(), MAX_REPLAYS).drop; // whole trees, most recently active first
      if (stale.length) await tx(db, 'readwrite', (s) => { for (const r of stale) s.delete(r.id); });
      return;
    } catch { /* fall back */ }
  }
  const list = lsRead().filter((r) => r.id !== data.id);
  list.push(data);
  lsWrite(pruneTrees(list, MAX_REPLAYS).keep.sort(recentFirst)); // whole trees
}

export async function deleteReplay(id: string): Promise<void> {
  const db = await openDb();
  if (db) {
    try { await tx(db, 'readwrite', (s) => { s.delete(id); }); } catch { /* ignore */ }
  }
  const list = lsRead();
  if (list.some((r) => r.id === id)) lsWrite(list.filter((r) => r.id !== id));
}

export function replayFileName(r: ReplayData): string {
  const d = new Date(r.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const slug = r.mapName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
  return `red-horizon-${slug}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

/** Download a replay as a .json file. */
export function exportReplay(r: ReplayData) {
  const blob = new Blob([JSON.stringify(r)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = replayFileName(r);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Read a replay file (throws a user-facing message on a bad file) and store it. */
export async function importReplayFile(file: File): Promise<ReplayData> {
  if (file.size > 20 * 1024 * 1024) throw new Error('File too large for a replay');
  let data: unknown;
  try {
    data = parseUntrustedJson(await file.text(), { maxChars: 20 << 20, maxString: 20 << 20 });
  } catch (e) {
    throw new Error(e instanceof UntrustedInputError ? e.message : 'Not a replay file (invalid JSON)');
  }
  if (!isReplayData(data)) throw new Error('Not a Red Horizon replay, or from an unsupported version');
  await saveReplay(data);
  return data;
}
