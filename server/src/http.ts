/**
 * The HTTP side of the server: the WebSocket endpoint of the relay and the leaderboard API, behind origin
 * checks, size limits, per-address rate limits and strict response headers.
 *
 *   GET  {base}/healthz        liveness (also tells the game whether leaderboards are on)
 *   GET  {base}/ws             WebSocket upgrade: the multiplayer relay
 *   POST {base}/lb/submit      a run to verify and rank
 *   POST {base}/lb/top         a board's top for a day (GET with a query string works too)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { Relay } from './relay';
import { KeyedLimiter } from './limits';
import type { ServerConfig } from './config';
import { LeaderboardStore } from './leaderboard/store';
import { VerifyQueue } from './leaderboard/queue';
import { MAX_CLIENT_MSG, NET_PROTOCOL } from '../../src/net/protocol';
import { BUILD_FINGERPRINT } from '../../src/net/fingerprint';
import { boardInfo, parseSubmission, utcDay } from '../../src/net/boards';
import { parseUntrustedJson } from '../../src/platform/untrusted';

export interface RelayServer {
  server: Server;
  relay: Relay;
  store: LeaderboardStore | null;
  queue: VerifyQueue | null;
  close(): Promise<void>;
}

const MAX_BODY = 1 << 20;

export function createRelayServer(cfg: ServerConfig, deps: { queue?: VerifyQueue; store?: LeaderboardStore; log?: (s: string) => void } = {}): RelayServer {
  const log = deps.log ?? ((s: string) => console.log(`[relay] ${s}`));
  const relay = new Relay({ now: () => Date.now(), randInt: (n) => randomInt(n), token: () => randomBytes(18).toString('base64url'), limits: cfg.limits, log });
  const store = cfg.lb.enabled ? deps.store ?? new LeaderboardStore({ file: cfg.lb.file, top: cfg.lb.top, keepDays: cfg.lb.keepDays }) : null;
  const queue = cfg.lb.enabled ? deps.queue ?? new VerifyQueue({ maxQueue: cfg.lb.maxQueue, timeoutMs: cfg.lb.timeoutMs, maxTicks: cfg.lb.maxTicks, memoryMb: cfg.lb.workerMb }) : null;
  const submits = new KeyedLimiter(cfg.lb.perHour / 3600, Math.min(cfg.lb.perHour, 10));
  const reads = new KeyedLimiter(2, 30);

  const clientIp = (req: IncomingMessage): string => {
    const xr = cfg.trustProxy ? req.headers['x-real-ip'] : undefined;
    const v = (Array.isArray(xr) ? xr[0] : xr)?.split(',')[0].trim();
    return v || req.socket.remoteAddress || 'unknown';
  };

  /** null = no Origin header; true / false = allowed or not. */
  const originOk = (req: IncomingMessage): boolean | null => {
    const origin = req.headers.origin;
    if (!origin) return null;
    if (cfg.allowedOrigins.includes(origin)) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  };

  const send = (req: IncomingMessage, res: ServerResponse, status: number, body: unknown) => {
    const text = JSON.stringify(body);
    const h: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer',
    };
    const origin = req.headers.origin;
    if (origin && cfg.allowedOrigins.includes(origin)) { h['Access-Control-Allow-Origin'] = origin; h['Vary'] = 'Origin'; }
    res.writeHead(status, h);
    res.end(text);
  };

  /** The request body as text, or null when it is larger than `max` (the rest is drained, up to a hard cap). */
  const readBody = (req: IncomingMessage, max: number): Promise<string | null> => new Promise((resolve) => {
    let size = 0, over = false;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { req.destroy(); resolve(null); }, 15_000);
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { over = true; chunks.length = 0; }
      if (size > max * 4) { clearTimeout(timer); req.destroy(); resolve(null); return; }
      if (!over) chunks.push(c);
    });
    req.on('end', () => { clearTimeout(timer); resolve(over ? null : Buffer.concat(chunks).toString('utf8')); });
    req.on('error', () => { clearTimeout(timer); resolve(null); });
  });

  const route = (path: string) => (path.startsWith(cfg.base + '/') ? path.slice(cfg.base.length) : null);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const p = route(url.pathname);
      const ip = clientIp(req);
      if (originOk(req) === false) return send(req, res, 403, { ok: false, error: 'Origin not allowed.' });
      if (req.method === 'OPTIONS' && p) {
        const origin = req.headers.origin;
        if (origin && cfg.allowedOrigins.includes(origin)) {
          res.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600', Vary: 'Origin' });
        } else res.writeHead(204);
        res.end();
        return;
      }
      if (p === '/healthz' && (req.method === 'GET' || req.method === 'POST')) return send(req, res, 200, { ok: true, proto: NET_PROTOCOL, build: BUILD_FINGERPRINT, lb: !!store });
      if (p === '/lb/top' && (req.method === 'GET' || req.method === 'POST')) {
        if (!store) return send(req, res, 404, { ok: false, error: 'Leaderboards are off on this server.' });
        if (!reads.take(ip, Date.now())) return send(req, res, 429, { ok: false, error: 'Too many requests.' });
        let q: Record<string, unknown> = Object.fromEntries(url.searchParams);
        if (req.method === 'POST') {
          const body = await readBody(req, 4096);
          try { q = (parseUntrustedJson(body ?? '', { maxChars: 4096, maxNodes: 64, maxDepth: 3 }) ?? {}) as Record<string, unknown>; } catch { return send(req, res, 400, { ok: false, error: 'Bad request.' }); }
        }
        const info = boardInfo(q.kind, q.id);
        if (!info) return send(req, res, 404, { ok: false, error: 'Unknown leaderboard.' });
        const today = utcDay(Date.now());
        const day = typeof q.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.day) ? q.day : today;
        const player = typeof q.player === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(q.player) ? q.player : undefined;
        return send(req, res, 200, { ok: true, board: info, day, today, days: store.days(info.id).slice(0, 14), entries: store.list(info.id, day, player) });
      }
      if (p === '/lb/submit' && req.method === 'POST') {
        if (!store || !queue) return send(req, res, 404, { ok: false, error: 'Leaderboards are off on this server.' });
        if (!submits.take(ip, Date.now())) return send(req, res, 429, { ok: false, error: 'Too many submissions. Try again later.' });
        const body = await readBody(req, MAX_BODY);
        if (body === null) return send(req, res, 413, { ok: false, error: 'The run is too large.' });
        let raw: unknown;
        try { raw = parseUntrustedJson(body, { maxChars: MAX_BODY, maxNodes: 400_000, maxDepth: 8, maxString: 200 }); } catch { return send(req, res, 400, { ok: false, error: 'Bad request.' }); }
        const sub = parseSubmission(raw);
        if (typeof sub === 'string') return send(req, res, 400, { ok: false, error: sub });
        if (sub.build !== BUILD_FINGERPRINT) return send(req, res, 409, { ok: false, error: 'Your game version differs from the leaderboard server\'s. Reload to update.' });
        const now = Date.now(), today = utcDay(now);
        let day = today;
        if (sub.kind === 'daily') {
          const near = [utcDay(now - 86400_000), today, utcDay(now + 86400_000)];
          if (!near.includes(sub.day)) return send(req, res, 422, { ok: false, error: 'That Daily Challenge is closed.' });
          day = sub.day;
        }
        const r = await queue.submit(sub);
        if (!r.ok) return send(req, res, 'busy' in r ? 503 : 422, { ok: false, error: r.reason });
        const placed = store.add(sub.id, day, { n: sub.name, s: r.score, t: r.ticks, w: r.won, a: now, player: sub.player });
        log(`run verified (${sub.kind})`);
        return send(req, res, 200, { ok: true, score: r.score, day, rank: placed.rank, improved: placed.improved });
      }
      send(req, res, 404, { ok: false, error: 'Not found.' });
    } catch {
      if (!res.headersSent) send(req, res, 500, { ok: false, error: 'Server error.' });
      else res.end();
    }
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MSG * 3, perMessageDeflate: false, clientTracking: false });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const ok = originOk(req);
    if (route(url.pathname) !== '/ws' || ok === false || (ok === null && !cfg.allowNoOrigin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const ip = clientIp(req);
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const handle = relay.connect({
        send: (t) => { if (ws.bufferedAmount > 4 << 20) { ws.terminate(); return; } ws.send(t); }, // a reader that never reads
        close: (code, reason) => { try { ws.close(code, reason); } catch { ws.terminate(); } },
      }, ip);
      if (!handle) return;
      ws.on('message', (data, binary) => handle.message(binary ? '' : data.toString()));
      ws.on('close', () => handle.close());
      ws.on('error', () => { /* close follows */ });
    });
  });

  const timer = setInterval(() => relay.tick(), 250);
  timer.unref?.();
  const pruneTimer = setInterval(() => { store?.prune(utcDay(Date.now())); submits.prune(Date.now()); reads.prune(Date.now()); }, 3600_000);
  pruneTimer.unref?.();

  return {
    server, relay, store, queue,
    close: () => new Promise((resolve) => {
      clearInterval(timer);
      clearInterval(pruneTimer);
      relay.close();
      try { store?.flush(); } catch { /* read-only or full disk: nothing more to do */ }
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}
