/**
 * Where the relay and the leaderboard server live (browser only).
 *
 * Default: the game's own origin under `relay/` (the Docker image's nginx proxies it to the relay container),
 * so the strict CSP (`connect-src 'self'`) needs no change. A game hosted elsewhere (Vercel, a CDN) sets
 * VITE_RELAY_URL at build time, e.g. `https://relay.example.com/relay`, and adds that origin (https: and wss:)
 * to its connect-src (docs/MULTIPLAYER.md).
 */

function base(): URL {
  const configured = (import.meta.env?.VITE_RELAY_URL as string | undefined)?.trim();
  if (configured) return new URL(configured.endsWith('/') ? configured : configured + '/');
  return new URL('relay/', new URL(import.meta.env?.BASE_URL || '/', location.href));
}

/** WebSocket URL of the relay. */
export function relaySocketUrl(): string {
  const u = new URL('ws', base());
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.href;
}

/** HTTP URL of a server route ('healthz', 'lb/top', 'lb/submit'). */
export function relayHttpUrl(path: string): string {
  return new URL(path, base()).href;
}

/** An invite link for a room code (the game's own page with #join=CODE). */
export function inviteLink(code: string): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = `join=${code}`;
  return u.href;
}

export interface ServerStatus { ok: boolean; build?: string; lb?: boolean }

let cached: { at: number; s: Promise<ServerStatus> } | null = null;

/** Is a relay reachable (and does it run leaderboards)? Cached for a minute. */
export function serverStatus(force = false): Promise<ServerStatus> {
  if (!force && cached && performance.now() - cached.at < 60_000) return cached.s;
  const s = (async (): Promise<ServerStatus> => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      // (POST: the service worker caches same-origin GETs, and this must always ask the server)
      const res = await fetch(relayHttpUrl('healthz'), { method: 'POST', cache: 'no-store', signal: ctl.signal, credentials: 'omit' });
      clearTimeout(t);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return { ok: false };
      const j = await res.json() as { ok?: unknown; build?: unknown; lb?: unknown };
      return { ok: j.ok === true, build: typeof j.build === 'string' ? j.build : undefined, lb: j.lb === true };
    } catch {
      return { ok: false };
    }
  })();
  cached = { at: performance.now(), s };
  return s;
}
