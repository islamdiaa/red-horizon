/**
 * Hardened JSON parsing for files a player imports (maps, missions, mods, challenges, replays).
 *
 * Shared files are untrusted: whatever they contain must never run script, pollute prototypes or hang the
 * tab. Every importer parses through `parseUntrustedJson`, which
 *   - refuses oversized input before parsing,
 *   - drops `__proto__` / `constructor` / `prototype` keys (a deep merge of those would pollute
 *     Object.prototype),
 *   - neutralises markup in strings (`<` `>` `"` `'` become typographic look-alikes) and strips control and
 *     bidi-override characters,
 *   - caps string length, nesting depth and the total number of values.
 * The UI escapes text again where it builds HTML; this is the second line of defence.
 */

export interface UntrustedLimits {
  /** Maximum input size in characters. */
  maxChars: number;
  /** Maximum length of any one string value (longer strings are truncated). Saved worlds carry their
   *  typed arrays as base64 strings, so this defaults to the file-size cap; UI fields are capped again by
   *  each format's validator. */
  maxString: number;
  /** Maximum number of values (objects, arrays and primitives) in the document. */
  maxNodes: number;
  /** Maximum nesting depth of objects and arrays. */
  maxDepth: number;
}

export const DEFAULT_LIMITS: UntrustedLimits = { maxChars: 8 << 20, maxString: 8 << 20, maxNodes: 4_000_000, maxDepth: 64 };

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// C0 controls except tab / newline / carriage return, DEL, C1 controls, bidi overrides and isolates
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** Make an untrusted string inert: no markup, no control or bidi-override characters, bounded length. */
export function cleanText(s: string, maxLen = 4000): string {
  const t = s.length > maxLen ? s.slice(0, maxLen) : s;
  // markup and quote characters become typographic look-alikes, so a cleaned string is inert both as HTML
  // text and inside a quoted attribute
  return t.replace(CONTROL, '').replace(/</g, '‹').replace(/>/g, '›').replace(/"/g, '”').replace(/'/g, '’');
}

/** Thrown for input that breaks the limits; `message` is user-facing. */
export class UntrustedInputError extends Error {}

/**
 * Parse untrusted JSON text. Throws `UntrustedInputError` (too large / too deep / too many values) or
 * `SyntaxError` (not JSON). The result contains only plain objects, arrays, finite numbers, booleans,
 * null and cleaned strings.
 */
export function parseUntrustedJson(text: string, limits: Partial<UntrustedLimits> = {}): unknown {
  const L = { ...DEFAULT_LIMITS, ...limits };
  if (typeof text !== 'string') throw new UntrustedInputError('Not a text file.');
  if (text.length > L.maxChars) throw new UntrustedInputError(`File too large (${Math.round(L.maxChars / 1048576)} MB max).`);
  const raw: unknown = JSON.parse(text);
  let nodes = 0;
  const walk = (v: unknown, depth: number): unknown => {
    if (++nodes > L.maxNodes) throw new UntrustedInputError('File has too many entries.');
    if (typeof v === 'string') return cleanText(v, L.maxString);
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (v === null || typeof v === 'boolean') return v;
    if (depth >= L.maxDepth) throw new UntrustedInputError('File is nested too deeply.');
    if (Array.isArray(v)) {
      const out: unknown[] = new Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = walk(v[i], depth + 1);
      return out;
    }
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as object)) {
        if (FORBIDDEN_KEYS.has(k)) continue;
        out[cleanText(k, 200)] = walk((v as Record<string, unknown>)[k], depth + 1);
      }
      return out;
    }
    return null;
  };
  return walk(raw, 0);
}

/**
 * Gunzip untrusted bytes with a hard cap on the decompressed size (a few KB of gzip can expand to
 * gigabytes). Throws `UntrustedInputError` past the cap.
 */
export async function gunzipBounded(bytes: Uint8Array, maxBytes: number): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel();
      throw new UntrustedInputError('File expands to more data than a challenge can hold.');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(all);
}
