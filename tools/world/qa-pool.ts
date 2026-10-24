// A small worker pool for the World Conquest QA tools: runs `mod`'s exported `fn` over jobs on WORKERS threads
// (default 6, the QA cap on this shared machine) and returns the results in job order.
import { Worker } from 'node:worker_threads';

/** Default output folder of the QA tools: screenshots/world-qa/ in the repository (git-ignored, like tools/e2e's). */
export const QA_OUT = new URL('../../screenshots/world-qa/', import.meta.url).pathname;

export function qaWorkers(): number { return Math.max(1, Math.min(6, Number(process.env.WORKERS) || 6)); }

export type PoolOut<R> = { ok: true; value: R } | { ok: false; error: string };

export async function runPool<J, R>(mod: string, fn: string, jobs: J[], opts: { workers?: number; progress?: (done: number, total: number, out: PoolOut<R>, job: J) => void } = {}): Promise<PoolOut<R>[]> {
  const out: PoolOut<R>[] = new Array(jobs.length);
  if (!jobs.length) return out;
  const n = Math.min(opts.workers ?? qaWorkers(), jobs.length);
  let next = 0, done = 0;
  const pool: Worker[] = [];
  await new Promise<void>((resolve, reject) => {
    const feed = (w: Worker) => {
      if (next >= jobs.length) return;
      const k = next++;
      w.postMessage({ k, mod, fn, job: jobs[k] });
    };
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./qa-boot.mjs', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 1536 } });
      pool.push(w);
      w.on('message', (m: { k: number; out: PoolOut<R> }) => {
        out[m.k] = m.out;
        done++;
        opts.progress?.(done, jobs.length, m.out, jobs[m.k]);
        if (done === jobs.length) resolve(); else feed(w);
      });
      w.on('error', reject);
      feed(w);
    }
  });
  await Promise.all(pool.map((w) => w.terminate()));
  return out;
}
