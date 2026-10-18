/**
 * Is the connection fit for optional background downloads (the offline prefetch of HD models, terrain textures and
 * nature models)? Not with the browser's Data Saver on, not on a slow connection (effectiveType slow-2g / 2g / 3g),
 * and not on a metered one (cellular, or the old `metered` flag). There the content still loads lazily, when a match
 * needs it; the player can download everything explicitly from Settings ("Download HD content for offline play").
 * Browsers without the Network Information API (Firefox, Safari) report nothing, so they count as unmetered.
 */
export interface ConnectionInfo {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
  metered?: boolean;
}

export function connectionInfo(): ConnectionInfo | null {
  if (typeof navigator === 'undefined') return null;
  return ((navigator as Navigator & { connection?: ConnectionInfo }).connection) ?? null;
}

/** Why background downloads are off ('' when they are fine). */
export function backgroundDownloadBlocker(c: ConnectionInfo | null = connectionInfo()): '' | 'save-data' | 'slow' | 'metered' {
  if (!c) return '';
  if (c.saveData) return 'save-data';
  if (c.effectiveType && /(^|-)2g$|^3g$/.test(c.effectiveType)) return 'slow';
  if (c.metered || c.type === 'cellular') return 'metered';
  return '';
}

export function backgroundDownloadsAllowed(c: ConnectionInfo | null = connectionInfo()): boolean {
  return backgroundDownloadBlocker(c) === '';
}
