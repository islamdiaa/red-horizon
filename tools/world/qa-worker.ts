// Worker thread for tools/world/qa-pool.ts: each message names a module (relative to this folder) and an exported
// function, and gets back what the function returns for the job (or the error).
import { parentPort } from 'node:worker_threads';

const mods = new Map<string, Record<string, (job: unknown) => unknown>>();
parentPort!.on('message', async (m: { k: number; mod: string; fn: string; job: unknown }) => {
  let out: unknown;
  try {
    let mod = mods.get(m.mod);
    if (!mod) { mod = await import(new URL(m.mod, import.meta.url).href) as Record<string, (job: unknown) => unknown>; mods.set(m.mod, mod); }
    out = { ok: true, value: await mod[m.fn](m.job) };
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? `${e.message}\n${(e.stack ?? '').split('\n').slice(1, 6).join('\n')}` : String(e) };
  }
  parentPort!.postMessage({ k: m.k, out });
});
