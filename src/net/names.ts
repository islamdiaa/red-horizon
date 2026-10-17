/**
 * Nicknames and chat lines from other players are untrusted text: cleaned with the importer rules
 * (src/platform/untrusted.ts cleanText: no markup, control or bidi characters) and length-capped. The relay
 * cleans them before anyone sees them; the UI escapes them again when it builds HTML.
 */
import { cleanText } from '../platform/untrusted';
import { MAX_CHAT, MAX_NAME } from './protocol';

/** A display name: cleaned, single-spaced, 1-20 characters ("Commander" when nothing is left). */
export function cleanName(raw: unknown): string {
  const s = cleanText(typeof raw === 'string' ? raw : '', 200).replace(/\s+/g, ' ').trim();
  const out = [...s].slice(0, MAX_NAME).join('').trim();
  return out || 'Commander';
}

/** A chat line: cleaned, single line, up to 160 characters ('' = nothing to send). */
export function cleanChat(raw: unknown): string {
  const s = cleanText(typeof raw === 'string' ? raw : '', 2000).replace(/\s+/g, ' ').trim();
  return [...s].slice(0, MAX_CHAT).join('').trim();
}
