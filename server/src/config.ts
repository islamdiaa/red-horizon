/** Server configuration from environment variables (all optional; see docs/MULTIPLAYER.md). */
import type { RelayLimits } from './relay';

export interface ServerConfig {
  port: number;
  host: string;
  /** URL prefix of every route ('/relay': the game's nginx proxies /relay to this server). */
  base: string;
  /** Browser origins allowed besides the server's own host (a game hosted elsewhere, e.g. on Vercel). */
  allowedOrigins: string[];
  /** Behind a reverse proxy: take the client address from X-Real-IP (rate limits only; never stored). */
  trustProxy: boolean;
  /** Accept WebSocket connections without an Origin header (tools and tests; browsers always send one). */
  allowNoOrigin: boolean;
  lb: {
    enabled: boolean;
    file: string | null;
    timeoutMs: number;
    maxQueue: number;
    maxTicks: number;
    top: number;
    keepDays: number;
    /** Submissions per address per hour. */
    perHour: number;
    /** Heap cap of the verification worker (MB). */
    workerMb: number;
  };
  limits: Partial<RelayLimits>;
}

function int(env: Record<string, string | undefined>, key: string, def: number, lo: number, hi: number): number {
  const v = Number(env[key]);
  return env[key] !== undefined && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : def;
}
const flag = (env: Record<string, string | undefined>, key: string, def: boolean) => (env[key] === undefined ? def : /^(1|true|yes|on)$/i.test(env[key]!));

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const base = ('/' + (env.RELAY_BASE ?? 'relay').replace(/^\/+|\/+$/g, '')).replace(/^\/$/, '');
  return {
    port: int(env, 'RELAY_PORT', 8787, 1, 65535),
    host: env.RELAY_HOST ?? '0.0.0.0',
    base,
    allowedOrigins: (env.RELAY_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    trustProxy: flag(env, 'RELAY_TRUST_PROXY', false),
    allowNoOrigin: flag(env, 'RELAY_ALLOW_NO_ORIGIN', false),
    lb: {
      enabled: flag(env, 'LB_ENABLED', true),
      file: env.LB_FILE === '' ? null : env.LB_FILE ?? './data/leaderboard.json',
      timeoutMs: int(env, 'LB_TIMEOUT_MS', 60_000, 1000, 600_000),
      maxQueue: int(env, 'LB_QUEUE', 4, 0, 100),
      maxTicks: int(env, 'LB_MAX_TICKS', 20 * 60 * 90, 100, 20 * 60 * 120),
      top: int(env, 'LB_TOP', 50, 5, 500),
      keepDays: int(env, 'LB_KEEP_DAYS', 30, 1, 3650),
      perHour: int(env, 'LB_SUBMITS_PER_HOUR', 30, 1, 10_000),
      workerMb: int(env, 'LB_WORKER_MB', 384, 64, 4096),
    },
    limits: {
      maxRooms: int(env, 'RELAY_MAX_ROOMS', 200, 1, 100_000),
      maxConns: int(env, 'RELAY_MAX_CONNECTIONS', 1000, 1, 1_000_000),
      maxConnsPerIp: int(env, 'RELAY_MAX_PER_IP', 12, 1, 10_000),
      reconnectGraceMs: int(env, 'RELAY_RECONNECT_GRACE_MS', 60_000, 5_000, 3_600_000),
      dropVoteMs: int(env, 'RELAY_DROP_VOTE_MS', 20_000, 2_000, 3_600_000),
      autoDropMs: int(env, 'RELAY_AUTO_DROP_MS', 90_000, 5_000, 3_600_000),
    },
  };
}
