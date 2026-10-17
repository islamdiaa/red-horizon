/**
 * Verification queue: re-simulating a run costs CPU, so the server runs one at a time, in a worker thread with
 * a memory cap and a hard time limit, and turns submissions away (instead of queueing without bound) when a few
 * are already waiting.
 */
import { Worker } from 'node:worker_threads';
import type { Submission } from '../../../src/net/boards';
import type { VerifyResult } from '../../../src/net/verify';

export interface QueueOptions {
  /** Submissions waiting behind the running one before new ones are turned away. */
  maxQueue: number;
  /** Time limit per verification (ms). */
  timeoutMs: number;
  maxTicks: number;
  /** Worker heap cap (MB). */
  memoryMb?: number;
  /** Run in this thread instead of a worker (tests). */
  inline?: (sub: Submission, maxTicks: number, deadline: number) => VerifyResult;
}

export type QueueResult = VerifyResult | { ok: false; reason: string; busy: true };

const devWorker = import.meta.url.endsWith('.ts');
const WORKER_URL = new URL(devWorker ? './worker-dev.mjs' : './verify-worker.mjs', import.meta.url);

export class VerifyQueue {
  private q: { sub: Submission; resolve: (r: QueueResult) => void }[] = [];
  private running = false;
  /** Counters for /healthz and tests. */
  stats = { verified: 0, rejected: 0, busy: 0, timeouts: 0 };

  constructor(private o: QueueOptions) {}

  get waiting(): number { return this.q.length; }
  get busy(): boolean { return this.running; }

  submit(sub: Submission): Promise<QueueResult> {
    if (this.q.length >= this.o.maxQueue) {
      this.stats.busy++;
      return Promise.resolve({ ok: false, reason: 'The leaderboard server is busy verifying other runs. Try again in a minute.', busy: true });
    }
    return new Promise((resolve) => {
      this.q.push({ sub, resolve });
      this.pump();
    });
  }

  private pump() {
    if (this.running) return;
    const job = this.q.shift();
    if (!job) return;
    this.running = true;
    const done = (r: QueueResult) => {
      if (r.ok) this.stats.verified++; else this.stats.rejected++;
      job.resolve(r);
      this.running = false;
      this.pump();
    };
    const deadline = Date.now() + this.o.timeoutMs;
    if (this.o.inline) {
      let r: VerifyResult;
      try { r = this.o.inline(job.sub, this.o.maxTicks, deadline); } catch { r = { ok: false, reason: 'The run could not be simulated.' }; }
      setImmediate(() => done(r));
      return;
    }
    let settled = false;
    const finish = (r: QueueResult) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); done(r); };
    const worker = new Worker(WORKER_URL, {
      workerData: { sub: job.sub, maxTicks: this.o.maxTicks, deadline },
      resourceLimits: { maxOldGenerationSizeMb: this.o.memoryMb ?? 384 },
    });
    // a hard stop a little after the soft deadline the simulation polls
    const timer = setTimeout(() => { this.stats.timeouts++; finish({ ok: false, reason: 'Verification took too long.' }); }, this.o.timeoutMs + 2000);
    worker.once('message', (r: VerifyResult) => { if (!r.ok && /too long/.test(r.reason)) this.stats.timeouts++; finish(r); });
    worker.once('error', () => finish({ ok: false, reason: 'The run could not be simulated.' }));
    worker.once('exit', (code) => finish({ ok: false, reason: code ? 'The run could not be simulated.' : 'No result.' }));
  }
}
