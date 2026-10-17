/**
 * Worker pool for self-play: runs MatchSpecs on N worker threads (each a tsx-enabled Node worker running
 * worker.ts) and returns the results in spec order. Matches are independent and deterministic, so the pool
 * size only changes wall time.
 */
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import type { DuelResult, DuelSpec, MatchResult, MatchSpec } from './lib';

export function defaultWorkers(): number {
  const env = +(process.env.WORKERS ?? 0);
  if (env > 0) return env;
  // leave headroom for the other processes on the machine
  return Math.max(1, Math.min(12, availableParallelism() - 4));
}

export async function runPool(specs: MatchSpec[], opts?: { workers?: number; progress?: (done: number, total: number, r: MatchResult) => void }): Promise<MatchResult[]>;
export async function runPool(specs: DuelSpec[], opts?: { workers?: number; progress?: (done: number, total: number, r: DuelResult) => void }): Promise<DuelResult[]>;
export async function runPool(specs: (MatchSpec | DuelSpec)[], opts: { workers?: number; progress?: (done: number, total: number, r: any) => void } = {}): Promise<any[]> {
  const n = Math.max(1, Math.min(opts.workers ?? defaultWorkers(), specs.length));
  const out: any[] = new Array(specs.length);
  let next = 0, done = 0;
  const workers: Worker[] = [];
  await new Promise<void>((resolve, reject) => {
    if (!specs.length) { resolve(); return; }
    const feed = (w: Worker) => {
      if (next >= specs.length) { w.terminate(); return; }
      const k = next++;
      w.postMessage({ k, spec: specs[k] });
    };
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./worker-boot.mjs', import.meta.url));
      workers.push(w);
      w.on('message', (m: { k: number; result?: MatchResult | DuelResult; error?: string }) => {
        if (m.error) { reject(new Error(`job ${m.k} (seed ${specs[m.k].seed}): ${m.error}`)); return; }
        out[m.k] = m.result!;
        done++;
        opts.progress?.(done, specs.length, m.result!);
        if (done === specs.length) resolve();
        else feed(w);
      });
      w.on('error', reject);
      feed(w);
    }
  });
  for (const w of workers) void w.terminate();
  return out;
}
