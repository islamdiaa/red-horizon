/**
 * Web Worker for the soundscape bank: renders ambience beds / events (./ambgen.ts) off the main
 * thread and transfers the raw PCM back; the main thread only wraps it in AudioBuffers.
 */
import { renderGen, type BankKey } from './ambgen';

interface Req { id: number; key: BankKey; v: number; seed: number }
const scope = self as unknown as { onmessage: ((e: MessageEvent<Req>) => void) | null; postMessage(m: unknown, transfer?: Transferable[]): void };

scope.onmessage = (e) => {
  const { id, key, v, seed } = e.data;
  const t0 = performance.now();
  try {
    const g = renderGen(key, v, seed);
    scope.postMessage({ id, key, v, sr: g.sr, ch: g.ch, ms: performance.now() - t0 }, g.ch.map((c) => c.buffer));
  } catch (err) {
    scope.postMessage({ id, key, v, error: String(err), ms: performance.now() - t0 });
  }
};
