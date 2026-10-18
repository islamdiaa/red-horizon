/**
 * "Download HD content for offline play" (Settings): every HD model (both factions, infantry, nature) and every
 * climate's terrain textures, fetched once through the service worker so it keeps them (public/sw.js stores these
 * content-hashed files in a cache that survives app updates). The background prefetch skips Data Saver, slow and
 * metered connections (./network.ts); this is the player's explicit choice, so it runs on any connection.
 * No three.js here: the menu offers it before the engine has loaded.
 */
import { assetUrl } from './paths';

interface FileRef { file: string; hash?: string; bytes?: number }
export interface OfflineFile { url: string; bytes: number }
export interface OfflineProgress { done: number; total: number; bytes: number; totalBytes: number; failed: number }

async function json<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(assetUrl(path), { credentials: 'same-origin' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const ref = (dir: string, f: FileRef): OfflineFile => ({ url: assetUrl(`${dir}${f.file}`) + (f.hash ? `?v=${f.hash}` : ''), bytes: f.bytes ?? 0 });

/** Every optional content file, with its size where the manifest knows it. */
export async function offlineContent(): Promise<OfflineFile[]> {
  const [hd, inf, nature, terrain] = await Promise.all([
    json<{ models?: Record<string, FileRef> }>('models/manifest.json'),
    json<{ models?: Record<string, FileRef> }>('models/infantry/manifest.json'),
    json<{ models?: Record<string, FileRef> }>('models/nature/manifest.json'),
    json<{ materials?: Record<string, { files: Record<string, FileRef> }> }>('textures/terrain/manifest.json'),
  ]);
  const out: OfflineFile[] = [];
  for (const [dir, m] of [['models/', hd], ['models/infantry/', inf], ['models/nature/', nature]] as const) {
    if (!m?.models) continue;
    out.push({ url: assetUrl(`${dir}manifest.json`), bytes: 0 });
    for (const f of Object.values(m.models)) out.push(ref(dir, f));
  }
  if (terrain?.materials) {
    out.push({ url: assetUrl('textures/terrain/manifest.json'), bytes: 0 });
    for (const mat of Object.values(terrain.materials)) for (const f of Object.values(mat.files)) out.push(ref('textures/terrain/', f));
  }
  return out;
}

/** Can the content be kept for offline play (an active service worker controls the page)? */
export function offlineSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
}

let running: Promise<OfflineProgress> | null = null;

/**
 * Download everything (three files at a time), reporting progress. Asks the browser to keep the site's storage
 * (persistent storage) so it is not evicted under storage pressure. One run at a time; a second call joins it.
 */
export function downloadOfflineContent(onProgress?: (p: OfflineProgress) => void): Promise<OfflineProgress> {
  if (running) return running;
  running = (async () => {
    void navigator.storage?.persist?.().catch(() => false);
    const files = await offlineContent();
    const p: OfflineProgress = { done: 0, total: files.length, bytes: 0, totalBytes: files.reduce((s, f) => s + f.bytes, 0), failed: 0 };
    onProgress?.({ ...p });
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const f = files[next++];
        try {
          const r = await fetch(f.url, { credentials: 'same-origin' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          p.bytes += (await r.arrayBuffer()).byteLength; // the service worker keeps its own copy
        } catch {
          p.failed++;
        }
        p.done++;
        onProgress?.({ ...p });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    try { localStorage.setItem('rh.offlineHd', String(Date.now())); } catch { /* storage unavailable */ }
    return p;
  })().finally(() => { running = null; });
  return running;
}

/** When the player last downloaded the HD content (0 = never). */
export function offlineDownloadedAt(): number {
  try {
    return Number(localStorage.getItem('rh.offlineHd')) || 0;
  } catch {
    return 0;
  }
}

/** Total size of the optional content in MB (for the Settings label), or 0 when unknown. */
export async function offlineContentMB(): Promise<number> {
  const files = await offlineContent();
  return Math.round(files.reduce((s, f) => s + f.bytes, 0) / 1048576);
}
