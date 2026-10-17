/**
 * Red Horizon relay and leaderboard server.
 *   node server/dist/relay.mjs            (built: npm run build in server/)
 *   node --import tsx server/src/main.ts  (development)
 * Configuration: environment variables (server/src/config.ts, docs/MULTIPLAYER.md).
 */
import { loadConfig } from './config';
import { createRelayServer } from './http';
import { BUILD_FINGERPRINT } from '../../src/net/fingerprint';

const cfg = loadConfig();
const srv = createRelayServer(cfg);
srv.server.listen(cfg.port, cfg.host, () => {
  console.log(`[relay] listening on ${cfg.host}:${cfg.port}${cfg.base} · build ${BUILD_FINGERPRINT} · leaderboards ${cfg.lb.enabled ? 'on' : 'off'}`);
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  console.log('[relay] shutting down');
  void srv.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
