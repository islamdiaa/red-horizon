/**
 * Share links without a server: a map, a challenge or a short replay travels inside the URL fragment,
 * `https://…/#share=1.<payload>`, where the payload is the JSON envelope gzipped (CompressionStream) and
 * base64url-encoded. Browsers never send the fragment to the server, so the host never sees what is shared
 * and nothing is stored anywhere but in the link itself.
 *
 * Decoding treats the fragment as hostile input:
 *  - the fragment length and alphabet are checked before anything is decoded;
 *  - the gzip stream is inflated with a hard cap (gunzipBounded: a few KB can expand to gigabytes);
 *  - the JSON goes through parseUntrustedJson (no prototype keys, inert strings, bounded size/depth/nodes);
 *  - only then is the envelope checked; each kind's own validator (map, challenge, replay) runs on import.
 *
 * Pure module (no DOM): the node tests run it directly.
 */
import { gunzipBounded, parseUntrustedJson, UntrustedInputError } from '../platform/untrusted';

export type ShareKind = 'map' | 'challenge' | 'replay';
export const SHARE_KINDS: readonly ShareKind[] = ['map', 'challenge', 'replay'];

/** The decoded content of a share link. */
export interface ShareEnvelope {
  /** Envelope version. */
  v: 1;
  k: ShareKind;
  /** Display title (cleaned again on decode). */
  t: string;
  /** The shared document: an .rhmap.json file, a ChallengeDef or a ReplayData. */
  d: unknown;
}

export const SHARE_VERSION = 1;
/** The fragment key: `#share=…`. */
export const SHARE_KEY = 'share';

export const SHARE_LIMITS = {
  /**
   * Longest fragment we create or accept. Browsers handle far longer URLs, but chat apps, mail clients and
   * QR codes do not, and a short replay of a few minutes compresses well under this.
   */
  maxFragmentChars: 32_000,
  /** Discord's 2,000-character message limit (minus room for the address): links up to this paste anywhere. */
  chatFriendlyChars: 1_900,
  /** Inflated JSON cap. */
  maxJsonBytes: 2 << 20,
  /** JSON value count cap (a short replay is a few thousand values; a challenge snapshot is mostly one base64 string). */
  maxNodes: 200_000,
  maxDepth: 40,
} as const;

/** Thrown for a share link that is malformed, too large or not ours; `message` is user-facing. */
export class ShareLinkError extends Error {}

const B64URL = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  if (!B64URL.test(s) || s.length % 4 === 1) throw new ShareLinkError('The share link is damaged.');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ShareLinkError('The share link is damaged.');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') throw new ShareLinkError('This browser cannot create share links.');
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Encode an envelope into the fragment payload (`1.<base64url gzip>`, without `#share=`). */
export async function encodeSharePayload(kind: ShareKind, title: string, data: unknown): Promise<string> {
  const env: ShareEnvelope = { v: SHARE_VERSION, k: kind, t: String(title ?? '').slice(0, 120), d: data };
  const gz = await gzip(new TextEncoder().encode(JSON.stringify(env)));
  return `${SHARE_VERSION}.${toBase64Url(gz)}`;
}

/** The full fragment, `#share=<payload>`. */
export function shareFragment(payload: string): string {
  return `#${SHARE_KEY}=${payload}`;
}

/** The share payload in a URL fragment (`#share=…`, possibly among other `&key=value` parts), or null. */
export function payloadFromHash(hash: string): string | null {
  if (typeof hash !== 'string' || !hash) return null;
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of h.split('&')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === SHARE_KEY) return part.slice(i + 1);
  }
  return null;
}

/**
 * Decode a share payload (the part after `#share=`). Throws ShareLinkError with a user-facing message for
 * anything malformed, oversized or of an unknown version / kind.
 */
export async function decodeSharePayload(payload: string): Promise<ShareEnvelope> {
  if (typeof payload !== 'string' || !payload) throw new ShareLinkError('The share link is empty.');
  if (payload.length > SHARE_LIMITS.maxFragmentChars) throw new ShareLinkError('The share link is too long.');
  const dot = payload.indexOf('.');
  if (dot < 1) throw new ShareLinkError('The share link is damaged.');
  const ver = payload.slice(0, dot);
  if (ver !== String(SHARE_VERSION)) throw new ShareLinkError(/^\d{1,3}$/.test(ver) && +ver > SHARE_VERSION ? 'This share link needs a newer version of the game.' : 'The share link is damaged.');
  const bytes = fromBase64Url(payload.slice(dot + 1));
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new ShareLinkError('The share link is damaged.');
  if (typeof DecompressionStream === 'undefined') throw new ShareLinkError('This browser cannot open share links.');
  let raw: unknown;
  try {
    const text = await gunzipBounded(bytes, SHARE_LIMITS.maxJsonBytes);
    raw = parseUntrustedJson(text, { maxChars: SHARE_LIMITS.maxJsonBytes, maxString: SHARE_LIMITS.maxJsonBytes, maxNodes: SHARE_LIMITS.maxNodes, maxDepth: SHARE_LIMITS.maxDepth });
  } catch (e) {
    if (e instanceof UntrustedInputError) throw new ShareLinkError('The share link holds more data than the game accepts.');
    throw new ShareLinkError('The share link is damaged.');
  }
  const env = raw as Partial<ShareEnvelope> | null;
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new ShareLinkError('Not a Red Horizon share link.');
  if (env.v !== SHARE_VERSION) throw new ShareLinkError(typeof env.v === 'number' && env.v > SHARE_VERSION ? 'This share link needs a newer version of the game.' : 'Not a Red Horizon share link.');
  if (typeof env.k !== 'string' || !SHARE_KINDS.includes(env.k as ShareKind)) throw new ShareLinkError('This share link holds something this version of the game cannot open.');
  if (!env.d || typeof env.d !== 'object' || Array.isArray(env.d)) throw new ShareLinkError('The share link is empty.');
  return { v: SHARE_VERSION, k: env.k as ShareKind, t: typeof env.t === 'string' ? env.t.slice(0, 120) : '', d: env.d };
}

/** How a link of `chars` characters travels. */
export function linkReach(chars: number): 'chat' | 'browser' | 'too-long' {
  if (chars > SHARE_LIMITS.maxFragmentChars) return 'too-long';
  return chars <= SHARE_LIMITS.chatFriendlyChars ? 'chat' : 'browser';
}
