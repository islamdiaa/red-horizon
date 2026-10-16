/**
 * Installed mods and which are enabled (in order), kept in localStorage ("rh.mods"). Mods are small
 * JSON documents, so no IndexedDB is needed. Works without storage (tests): an in-memory copy is used.
 */
import { makeModSet, type ModFile, type ModSet } from './format';
import { checkMods } from './engine';

const KEY = 'rh.mods';

interface Stored {
  installed: ModFile[];
  /** Enabled mod ids, in application order. */
  enabled: string[];
}

let mem: Stored = { installed: [], enabled: [] };
let loaded = false;

function load(): Stored {
  if (loaded) return mem;
  loaded = true;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const s = JSON.parse(raw) as Stored;
      if (s && Array.isArray(s.installed) && Array.isArray(s.enabled)) mem = { installed: s.installed.filter((m) => m && typeof m.id === 'string'), enabled: s.enabled.filter((x) => typeof x === 'string') };
    }
  } catch { /* keep the in-memory default */ }
  return mem;
}

function persist() {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* quota / private mode */ }
}

export function installedMods(): ModFile[] {
  return load().installed.slice();
}

export function enabledModIds(): string[] {
  const s = load();
  return s.enabled.filter((id) => s.installed.some((m) => m.id === id));
}

export function isModEnabled(id: string): boolean {
  return enabledModIds().includes(id);
}

/** Install or replace a mod (keyed by id). Returns true when it replaced an older copy. */
export function installMod(mod: ModFile): boolean {
  const s = load();
  const i = s.installed.findIndex((m) => m.id === mod.id);
  const copy = JSON.parse(JSON.stringify(mod)) as ModFile;
  if (i >= 0) s.installed[i] = copy; else s.installed.push(copy);
  persist();
  return i >= 0;
}

export function removeMod(id: string) {
  const s = load();
  s.installed = s.installed.filter((m) => m.id !== id);
  s.enabled = s.enabled.filter((x) => x !== id);
  persist();
}

export function setModEnabled(id: string, on: boolean) {
  const s = load();
  s.enabled = s.enabled.filter((x) => x !== id);
  if (on) s.enabled.push(id);
  persist();
}

/** Move an enabled mod earlier (-1) or later (+1) in the application order. */
export function moveMod(id: string, dir: -1 | 1) {
  const s = load();
  const i = s.enabled.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= s.enabled.length) return;
  [s.enabled[i], s.enabled[j]] = [s.enabled[j], s.enabled[i]];
  persist();
}

/**
 * The mod set a new match starts with: every enabled mod, in order (null when none are enabled, or
 * when the combination doesn't validate — the Mods screen shows why).
 */
export function activeModSet(): ModSet | null {
  const s = load();
  const mods = enabledModIds().map((id) => s.installed.find((m) => m.id === id)!).filter(Boolean);
  if (!mods.length) return null;
  if (!checkMods(mods).ok) return null;
  return makeModSet(mods);
}

/** Test hook: forget everything (in memory). */
export function resetModStore(state: Stored = { installed: [], enabled: [] }) {
  mem = JSON.parse(JSON.stringify(state));
  loaded = true;
}
