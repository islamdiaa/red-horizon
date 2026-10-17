/**
 * Base-path helper: every runtime asset URL goes through assetUrl() so the game works from any
 * folder, not only from the site root.
 *
 * Vite's `base` decides where the build is served from:
 *  - `/` (the default): the site root (Docker, Vercel);
 *  - `/red-horizon/`: a sub-path on a shared host (`RH_BASE=/red-horizon/ npm run build`);
 *  - `./` (`npm run build:itch`, the desktop wrapper): relative to index.html, so the zip can be
 *    unpacked into any folder (itch.io serves each upload from its own CDN sub-folder).
 *
 * `import.meta.env.BASE_URL` is `./` in a relative build; a relative URL resolves against the
 * document, and index.html sits at the game's root, so `./models/x.glb` is right on the page.
 * Workers resolve URLs against their own script (in `assets/`), so assetUrl() returns an absolute
 * URL there. Never write a leading-slash literal such as `'/models/x.glb'`: it breaks every build
 * that is not served from the site root (tests/paths.test.ts greps for them).
 */

/** The configured base: `/`, `/sub/path/` or `./`. Always ends with `/`. */
export function baseUrl(): string {
  let b = '/';
  try {
    b = import.meta.env.BASE_URL || '/';
  } catch {
    // outside Vite (node tests): the site root
  }
  return b.endsWith('/') ? b : `${b}/`;
}

/** True for a relative base (`./`): the itch.io and desktop builds. */
export function isRelativeBase(base = baseUrl()): boolean {
  return base === './' || base === '' || base === '.';
}

/** The game's folder (where index.html lives) as an absolute URL ending in `/`, or null outside a browser. */
export function gameRoot(): string | null {
  try {
    if (typeof document !== 'undefined' && document.baseURI) return new URL('.', document.baseURI).href;
    // a worker: its script lives in `<root>/assets/`
    const loc = (globalThis as { location?: { href: string } }).location;
    if (loc?.href) return new URL('../', loc.href).href;
  } catch {
    // no location
  }
  return null;
}

/**
 * Join a base and a path inside it (pure; assetUrl() uses the build's base). A leading `/` or `./` on `path`
 * is ignored, so the result always stays inside the base; absolute URLs (`https:`, `blob:`, `data:`,
 * `//host`) are returned unchanged.
 */
export function joinBase(base: string, path: string): string {
  const s = String(path ?? '');
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(s)) return s;
  const p = s.replace(/^(?:\.\/|\/)+/, '');
  const b = isRelativeBase(base) ? './' : base.endsWith('/') ? base : `${base}/`;
  return b + p;
}

/**
 * The URL of a file in public/ (or anything under the game's root): `assetUrl('models/a.glb')` is
 * `/models/a.glb`, `/red-horizon/models/a.glb` or `./models/a.glb` depending on the build. In a worker a
 * relative base is resolved to an absolute URL (a worker resolves relative URLs against its own script).
 */
export function assetUrl(path: string): string {
  const base = baseUrl();
  if (isRelativeBase(base) && typeof document === 'undefined') {
    const root = gameRoot();
    if (root) return joinBase(root, path);
  }
  return joinBase(base, path);
}
