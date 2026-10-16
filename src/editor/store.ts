/**
 * Editor documents (custom maps + their optional missions): IndexedDB ("rh-editor" / "docs", keyed by
 * id), falling back to localStorage ("rh.editor.docs") where IndexedDB is unavailable, with an
 * in-memory copy that the menus read synchronously (initEditorStore() loads it at start-up).
 *
 * Also the `.rhmap.json` file format:
 *   { "format": "rhmap", "version": 1, "map": MapDef, "mission"?: MissionSpec }
 * (a bare MapDef — e.g. a curated map's source — is accepted on import too).
 */
import { checkMapDef, newCustomId, playerCount, setCustomMaps, isCustomMapId } from '../maps/custom';
import type { MapDef } from '../maps/format';
import type { MissionDef } from '../sim/mission';
import { AI_MODES, PORTRAITS, customMissionDef, type CustomMissionSetup, type MissionSpec } from './mission';
import type { EditorDoc } from './doc';
import { parseUntrustedJson, UntrustedInputError } from '../platform/untrusted';

const DB = 'rh-editor';
const STORE = 'docs';
const LS_KEY = 'rh.editor.docs';
const DRAFT_KEY = 'rh.editor.draft';
export const RHMAP_FORMAT = 'rhmap';
export const RHMAP_VERSION = 1;

export interface RhMapFile {
  format: 'rhmap';
  version: number;
  map: MapDef;
  mission?: MissionSpec | null;
}

const docs = new Map<string, EditorDoc>();
let ready: Promise<void> | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;
const listeners = new Set<() => void>();

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

const hasLs = () => { try { return typeof localStorage !== 'undefined'; } catch { return false; } };

function lsRead(): EditorDoc[] {
  if (!hasLs()) return [];
  try {
    const list = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function lsWrite() {
  if (!hasLs()) return;
  try { localStorage.setItem(LS_KEY, JSON.stringify([...docs.values()])); } catch (e) { console.warn('editor: map not saved (storage full?)', e); }
}

/** A stored document, checked (bad entries are dropped rather than crashing the menus). */
function clean(d: unknown): EditorDoc | null {
  const o = d as EditorDoc;
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !isCustomMapId(o.id)) return null;
  const { def } = checkMapDef(o.map);
  if (!def) return null;
  def.id = o.id;
  const mission = o.mission ? sanitizeMission(o.mission) : null;
  return { id: o.id, map: def, mission: Array.isArray(mission) ? null : mission, createdAt: +o.createdAt || Date.now(), updatedAt: +o.updatedAt || Date.now() };
}

function publish() {
  setCustomMaps(listDocs().filter((d) => d.map.players >= 2).map((d) => d.map));
  for (const l of listeners) l();
}

/** Load every stored document into memory (call once at start-up; later calls return the same promise). */
export function initEditorStore(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const db = await openDb();
    let list: unknown[] = [];
    if (db) {
      try { list = (await tx<unknown[]>(db, 'readonly', (s) => s.getAll() as IDBRequest<unknown[]>)) ?? []; } catch { list = lsRead(); }
    } else list = lsRead();
    for (const d of list) { const c = clean(d); if (c) docs.set(c.id, c); }
    publish();
  })();
  return ready;
}

export function onStoreChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Every document, most recently edited first. */
export function listDocs(): EditorDoc[] {
  return [...docs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getDoc(id: string): EditorDoc | undefined {
  return docs.get(id);
}

export async function saveDoc(doc: EditorDoc): Promise<void> {
  const copy = JSON.parse(JSON.stringify(doc)) as EditorDoc;
  copy.map.id = copy.id;
  copy.map.players = playerCount(copy.map);
  docs.set(copy.id, copy);
  publish();
  const db = await openDb();
  if (db) {
    try { await tx(db, 'readwrite', (s) => { s.put(copy); }); return; } catch { /* fall back */ }
  }
  lsWrite();
}

export async function deleteDoc(id: string): Promise<void> {
  docs.delete(id);
  publish();
  const db = await openDb();
  if (db) {
    try { await tx(db, 'readwrite', (s) => { s.delete(id); }); return; } catch { /* fall back */ }
  }
  lsWrite();
}

// ---- working draft (survives a reload / crash; not listed) --------------------------------------------
export function saveDraft(doc: EditorDoc) {
  if (!hasLs()) return;
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(doc)); } catch { /* quota */ }
}
export function loadDraft(): EditorDoc | null {
  if (!hasLs()) return null;
  try { return clean(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')); } catch { return null; }
}

// ---- custom missions for the campaign screen and deploys ---------------------------------------------
/** Custom missions (documents with a mission), as MissionDefs for the Special operations list. */
export function customMissionDefs(): MissionDef[] {
  return listDocs().filter((d) => d.mission).map((d) => customMissionDef({ ...d.mission!, id: d.id }, d.map));
}

/** What a GameSetup needs to start the custom mission `id` (null if it isn't one). */
export function customMissionSetup(id: string): { customMission: CustomMissionSetup; customMap: MapDef } | null {
  const d = docs.get(id);
  if (!d?.mission) return null;
  return { customMission: { ...JSON.parse(JSON.stringify(d.mission)), id: d.id }, customMap: JSON.parse(JSON.stringify(d.map)) };
}

// ---- .rhmap.json -----------------------------------------------------------------------------------
export function docToFile(doc: EditorDoc): RhMapFile {
  const f: RhMapFile = { format: RHMAP_FORMAT, version: RHMAP_VERSION, map: JSON.parse(JSON.stringify(doc.map)) };
  if (doc.mission) f.mission = JSON.parse(JSON.stringify(doc.mission));
  return f;
}

export function fileName(doc: EditorDoc): string {
  const slug = doc.map.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
  return `${slug}.rhmap.json`;
}

/**
 * Read a `.rhmap.json` (or a bare MapDef). Imported maps always get a fresh custom id, so importing
 * never overwrites a map you already have.
 */
export function parseRhMap(text: string): { doc: EditorDoc | null; errors: string[] } {
  let data: unknown;
  try { data = parseUntrustedJson(text, { maxChars: 4 << 20 }); } catch (e) {
    return { doc: null, errors: [e instanceof UntrustedInputError ? e.message : 'Not a map file (invalid JSON).'] };
  }
  const o = data as Partial<RhMapFile> & Record<string, unknown>;
  if (!o || typeof o !== 'object') return { doc: null, errors: ['Not a map file.'] };
  let mapPart: unknown = o;
  let missionPart: unknown = null;
  if (o.format !== undefined || o.map !== undefined) {
    if (o.format !== RHMAP_FORMAT) return { doc: null, errors: [`Unknown format "${String(o.format)}" (expected "${RHMAP_FORMAT}").`] };
    if (typeof o.version !== 'number' || o.version > RHMAP_VERSION) return { doc: null, errors: [`Map file version ${String(o.version)} is newer than this build reads (${RHMAP_VERSION}).`] };
    mapPart = o.map;
    missionPart = o.mission ?? null;
  }
  const { def, errors } = checkMapDef(mapPart);
  if (!def) return { doc: null, errors: errors.map((e) => 'Map ' + e) };
  def.id = newCustomId();
  let mission: MissionSpec | null = null;
  if (missionPart) {
    const m = sanitizeMission(missionPart);
    if (Array.isArray(m)) return { doc: null, errors: m.map((e) => 'Mission ' + e) };
    mission = m;
  }
  const now = Date.now();
  return { doc: { id: def.id, map: def, mission, createdAt: now, updatedAt: now }, errors: [] };
}

/** Type-check a mission spec from a file (references are checked by checkMission). */
export function sanitizeMission(x: unknown): MissionSpec | string[] {
  const errors: string[] = [];
  const o = x as Record<string, unknown>;
  if (!o || typeof o !== 'object') return ['not an object'];
  const str = (v: unknown, d = '') => (typeof v === 'string' ? v.slice(0, 2000) : d);
  const num = (v: unknown, d: number, lo = -1e9, hi = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const optNum = (v: unknown, lo = -1e9, hi = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
  const arr = (v: unknown, what: string): unknown[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) { errors.push(`${what}: expected a list`); return []; }
    return v;
  };
  const players = arr(o.players, 'players').slice(0, 8).map((p) => {
    const q = p as Record<string, unknown>;
    return {
      name: str(q?.name, 'Player').slice(0, 40), faction: q?.faction === 'soviet' ? 'soviet' : 'allies', team: Math.round(num(q?.team, 0, 0, 7)),
      ai: AI_MODES.includes(q?.ai as never) ? q.ai : 'normal', credits: Math.round(num(q?.credits, 5000, 0, 1e6)),
      startUnits: (['none', 'mcv', 'light', 'heavy'] as const).includes(q?.startUnits as never) ? q.startUnits : 'none',
    } as MissionSpec['players'][number];
  });
  if (!players.length) errors.push('players: at least the human player');
  const placements = arr(o.placements, 'placements').slice(0, 2000).map((p) => {
    const q = p as Record<string, unknown>;
    const pl: MissionSpec['placements'][number] = { kind: q?.kind === 'structure' ? 'structure' : 'unit', type: str(q?.type), player: Math.round(num(q?.player, 0, 0, 7)), x: num(q?.x, 0, 0, 512), y: num(q?.y, 0, 0, 512) };
    if (typeof q?.tag === 'string' && q.tag.trim()) pl.tag = q.tag.trim().slice(0, 30);
    const h = optNum(q?.health, 0.01, 1);
    if (h !== undefined) pl.health = h;
    return pl;
  });
  const objectives = arr(o.objectives, 'objectives').slice(0, 50).map((p, i) => {
    const q = p as Record<string, unknown>;
    const kinds = ['destroyAll', 'destroy', 'survive', 'reach', 'protect', 'build'];
    const ob: MissionSpec['objectives'][number] = { id: str(q?.id, 'o' + (i + 1)).slice(0, 30) || 'o' + (i + 1), kind: (kinds.includes(q?.kind as string) ? q.kind : 'destroyAll') as never, text: str(q?.text).slice(0, 200), primary: q?.primary !== false };
    if (q?.hidden === true) ob.hidden = true;
    if (typeof q?.tag === 'string') ob.tag = q.tag;
    if (typeof q?.type === 'string') ob.type = q.type;
    for (const k of ['player', 'seconds', 'x', 'y', 'r', 'count'] as const) { const v = optNum(q?.[k], 0, 1e6); if (v !== undefined) ob[k] = v; }
    return ob;
  });
  const whens = ['start', 'time', 'objectiveDone', 'objectiveFailed', 'destroyed', 'area'];
  const dos = ['message', 'reinforce', 'credits', 'reveal', 'objective', 'ai', 'attack', 'win', 'lose'];
  const triggers = arr(o.triggers, 'triggers').slice(0, 100).map((p, i) => {
    const q = p as Record<string, unknown>;
    const t: MissionSpec['triggers'][number] = { id: str(q?.id, 't' + (i + 1)).slice(0, 30) || 't' + (i + 1), when: (whens.includes(q?.when as string) ? q.when : 'start') as never, actions: [] };
    if (typeof q?.objective === 'string') t.objective = q.objective;
    if (typeof q?.tag === 'string') t.tag = q.tag;
    for (const k of ['seconds', 'x', 'y', 'r', 'player'] as const) { const v = optNum(q?.[k], 0, 1e6); if (v !== undefined) t[k] = v; }
    t.actions = (Array.isArray(q?.actions) ? q.actions : []).slice(0, 20).map((a: unknown) => {
      const b = a as Record<string, unknown>;
      const act: MissionSpec['triggers'][number]['actions'][number] = { kind: (dos.includes(b?.kind as string) ? b.kind : 'message') as never };
      if (typeof b?.speaker === 'string') act.speaker = b.speaker.slice(0, 40);
      if (PORTRAITS.includes(b?.portrait as never)) act.portrait = b.portrait as never;
      if (typeof b?.text === 'string') act.text = b.text.slice(0, 400);
      if (Array.isArray(b?.units)) act.units = (b.units as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, 40);
      if (typeof b?.objective === 'string') act.objective = b.objective;
      if (AI_MODES.includes(b?.mode as never)) act.mode = b.mode as never;
      for (const k of ['player', 'x', 'y', 'tx', 'ty', 'amount', 'r'] as const) { const v = optNum(b?.[k], -1e6, 1e6); if (v !== undefined) act[k] = v; }
      return act;
    });
    return t;
  });
  const lines = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 1000)).slice(0, 20) : []);
  if (errors.length) return errors;
  return {
    title: str(o.title, 'Custom Operation').slice(0, 60), codename: str(o.codename, 'CUSTOM').slice(0, 30), location: str(o.location).slice(0, 60),
    briefing: lines(o.briefing), tips: lines(o.tips),
    timeOfDay: o.timeOfDay === 'dusk' || o.timeOfDay === 'night' ? o.timeOfDay : 'day', weather: str(o.weather, 'auto').slice(0, 10),
    dayCycle: o.dayCycle !== false, fog: o.fog !== false, parTime: Math.round(num(o.parTime, 0, 0, 36000)),
    players, placements, objectives, triggers,
  };
}

/** Test hook: empty the in-memory store. */
export function resetEditorStore() {
  docs.clear();
  ready = Promise.resolve();
  publish();
}
