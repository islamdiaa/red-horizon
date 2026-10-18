import { backgroundDownloadsAllowed } from './network';

/** A list of same-origin URLs to cache for offline play (read from a manifest when it is needed). */
export type UrlList = () => Promise<string[]>;
const lists = new Set<UrlList>();
let timer = false;
let fired = false;

/**
 * Offline play: once a match runs, quietly ask the service worker to cache optional content (the terrain textures
 * of every climate, the nature and infantry models...); what the match itself uses is cached as it loads. Each list
 * is registered by the module that uses that content, so a preset that never shows it never downloads it. Fires once,
 * 45 s after the first registration (lists registered later go at once); best effort, production only (needs a
 * controlling service worker), and never with Data Saver on or on a slow or metered connection (./network.ts):
 * there content loads lazily, and Settings offers an explicit download (./offline.ts).
 */
export function prefetchOffline(list: UrlList, delayMs = 45000): void {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller || lists.has(list)) return;
  lists.add(list);
  if (fired) { send([list]); return; }
  if (timer) return;
  timer = true;
  setTimeout(() => { fired = true; send([...lists]); }, delayMs);
}

function send(ls: UrlList[]) {
  if (!backgroundDownloadsAllowed()) return; // (checked when it fires: the connection may have changed)
  void Promise.all(ls.map((f) => f().catch(() => [] as string[])))
    .then((l) => navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ type: 'CACHE_URLS', urls: l.flat() })))
    .catch(() => {});
}
