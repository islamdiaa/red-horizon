// Self-play worker thread: plays the matches the pool sends (see pool.ts).
import { parentPort } from 'node:worker_threads';
import { playDuel, playMatch, type DuelSpec, type MatchSpec } from './lib';

parentPort!.on('message', (m: { k: number; spec: MatchSpec | DuelSpec }) => {
  try {
    const result = 'players' in m.spec ? playMatch(m.spec) : playDuel(m.spec);
    parentPort!.postMessage({ k: m.k, result });
  } catch (e) {
    parentPort!.postMessage({ k: m.k, error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) });
  }
});
