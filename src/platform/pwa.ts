/**
 * Progressive Web App support: registers public/sw.js in production builds only.
 *
 * The service worker URL carries a build id (`sw.js?v=<entry chunk file name>`): Vite content-
 * hashes the entry chunk, so every deploy yields a new worker script URL, a new cache name and a
 * clean-up of the previous caches. Updates never swap assets under a running game: a new worker
 * waits until applyUpdate() (or until every tab is closed).
 */

export interface PwaOptions {
  /** A new version finished installing and is waiting; call apply() to switch (reloads the page). */
  onUpdateReady?: (apply: () => void) => void;
  /** The first install finished: the game now works offline. */
  onOfflineReady?: () => void;
}

/**
 * Build id = the content-hashed file name of the entry chunk (index-<hash>), read from the page's
 * module <script> (falls back to this module's own URL; 'dev' when unbundled).
 */
export function buildId(): string {
  const fromUrl = (u: string | null | undefined) => {
    try {
      const file = new URL(u ?? '', location.href).pathname.split('/').pop() ?? '';
      return /-[\w-]{6,}\.js$/.test(file) ? file.replace(/\.js$/, '') : null;
    } catch {
      return null;
    }
  };
  const entry = typeof document !== 'undefined' ? document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src : null;
  return fromUrl(entry) ?? fromUrl(import.meta.url) ?? 'dev';
}

/** Same-origin resources this page already loaded (lazy chunks, workers, fonts...), for warming the cache. */
function loadedResources(): string[] {
  try {
    return performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => { try { const url = new URL(u); return url.origin === location.origin && !url.pathname.endsWith('/sw.js'); } catch { return false; } });
  } catch {
    return [];
  }
}

let registration: ServiceWorkerRegistration | null = null;

/**
 * Register the service worker (production only, HTTPS or localhost). Resolves to the
 * registration, or null when disabled/unsupported. Never throws.
 */
export async function registerServiceWorker(opts: PwaOptions = {}): Promise<ServiceWorkerRegistration | null> {
  if (!import.meta.env.PROD) return null;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) return null;
  if (document.readyState !== 'complete') await new Promise<void>((r) => window.addEventListener('load', () => r(), { once: true }));
  const base = import.meta.env.BASE_URL || '/';
  try {
    const hadController = !!navigator.serviceWorker.controller;
    const reg = await navigator.serviceWorker.register(`${base}sw.js?v=${encodeURIComponent(buildId())}`, { scope: base });
    registration = reg;

    const apply = () => {
      const waiting = reg.waiting;
      if (!waiting) return;
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      waiting.postMessage({ type: 'SKIP_WAITING' });
    };
    const watch = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state !== 'installed') return;
        if (navigator.serviceWorker.controller || hadController) opts.onUpdateReady?.(apply);
        else opts.onOfflineReady?.();
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) opts.onUpdateReady?.(apply);
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));

    // cache whatever this page already pulled in (lazy chunks, workers) once a worker is active
    navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ type: 'CACHE_URLS', urls: loadedResources() })).catch(() => {});
    // look for new deploys when the tab comes back after a while
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck > 30 * 60 * 1000) {
        lastCheck = Date.now();
        reg.update().catch(() => {});
      }
    });
    return reg;
  } catch (e) {
    console.warn('[pwa] service worker registration failed', e);
    return null;
  }
}

/** Remove the worker and its caches (e.g. a "reset offline data" option). */
export async function unregisterServiceWorker(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('red-horizon-')).map((k) => caches.delete(k)));
  } catch { /* ignore */ }
  registration = null;
}

export const serviceWorkerRegistration = () => registration;
