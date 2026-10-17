/**
 * Building share links: where they point and how they reach the clipboard / the system share sheet.
 *
 * A link points at the page the game runs from (`https://host/path/#share=…`). Relative builds (itch.io,
 * the desktop app) run from an address nobody else can open, so they point at the public web version
 * instead when the build knows it (RH_SITE_URL at build time, see vite.config.ts); without one, sharing
 * falls back to files.
 */
import { isRelativeBase } from '../platform/paths';
import { encodeSharePayload, linkReach, shareFragment, type ShareKind, SHARE_LIMITS } from './codec';

/** The public web address baked in at build time (RH_SITE_URL / Vercel), or ''. */
export function siteUrl(): string {
  try {
    const u: unknown = import.meta.env.RH_SITE_URL;
    return typeof u === 'string' ? u : '';
  } catch {
    return '';
  }
}

/** The address share links point at (no query, no fragment), or null when links can't be opened by others. */
export function shareBase(): string | null {
  const site = siteUrl();
  if (typeof location === 'undefined') return site || null;
  const web = location.protocol === 'https:' || location.protocol === 'http:';
  // itch.io serves the game from its CDN inside an iframe: that address isn't the page people visit
  const embedded = (() => { try { return window.top !== window; } catch { return true; } })();
  if (site && (isRelativeBase() || !web || embedded)) return site;
  if (!web || embedded) return null;
  return `${location.origin}${location.pathname}`;
}

export interface ShareLink {
  /** The link, or null when it is too long (or there is no address to point at). */
  url: string | null;
  /** Length of the full link in characters. */
  chars: number;
  reach: 'chat' | 'browser' | 'too-long';
  /** Why there is no link (too long / no public address / browser support), for the UI. */
  problem?: 'too-long' | 'no-address' | 'unsupported';
}

/** Encode `data` as a share link of `kind`. Never throws. */
export async function makeShareLink(kind: ShareKind, title: string, data: unknown): Promise<ShareLink> {
  const base = shareBase();
  if (typeof CompressionStream === 'undefined') return { url: null, chars: 0, reach: 'too-long', problem: 'unsupported' };
  let payload: string;
  try {
    payload = await encodeSharePayload(kind, title, data);
  } catch {
    return { url: null, chars: 0, reach: 'too-long', problem: 'unsupported' };
  }
  const frag = shareFragment(payload);
  const chars = (base ?? '').length + frag.length;
  if (payload.length > SHARE_LIMITS.maxFragmentChars) return { url: null, chars, reach: 'too-long', problem: 'too-long' };
  if (!base) return { url: null, chars, reach: linkReach(chars), problem: 'no-address' };
  return { url: base + frag, chars, reach: linkReach(chars) };
}

/** Copy text to the clipboard (async API, then the legacy fallback). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* blocked: try the fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** The system share sheet (mobile, some desktops) for a link. */
export function canShareLink(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareLinkNatively(title: string, text: string, url: string): Promise<boolean> {
  try {
    await navigator.share({ title, text, url });
    return true;
  } catch {
    return false; // cancelled or refused
  }
}
