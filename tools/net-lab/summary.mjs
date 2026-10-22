// A table of net-lab match reports (match.mjs JSON): per run and peer, the round trip the relay measured, the input
// delay, input-to-action latency, the pace (ticks per second, 20 = real time) and the seconds spent stalled.
//   node tools/net-lab/summary.mjs <report.json | dir> [...]     (a dir: every *.json report in it)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
for (const a of process.argv.slice(2)) {
  if (statSync(a).isDirectory()) for (const f of readdirSync(a).sort()) { if (f.endsWith('.json')) files.push(join(a, f)); }
  else files.push(a);
}
const rows = [['run', 'peer', 'engine', 'rtt med ms', 'delay med (max) ticks', 'latency med / p95 ms', 'pace t/s', 'stall s', 'checks']];
for (const f of files) {
  let r;
  try { r = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  if (!r.peers || !r.tag) continue;
  const ok = r.failures?.length ? `FAIL ${r.failures.length}` : 'ok';
  for (const k of ['A', 'B']) {
    const p = r.peers[k];
    if (!p) continue;
    const eng = (r.engines ?? [])[k === 'A' ? 0 : 1] ?? '';
    rows.push([r.tag, k, eng, p.rttMs?.med ?? '-', p.delayTicks ? `${p.delayTicks.med} (${p.delayTicks.max})` : '-', p.latency ? `${p.latency.med} / ${p.latency.p95}` : '-', p.pace ?? '-', p.stallSeconds ?? '-', k === 'A' ? ok : '']);
  }
}
const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
for (const [i, r] of rows.entries()) {
  console.log('| ' + r.map((c, j) => String(c).padEnd(w[j])).join(' | ') + ' |');
  if (i === 0) console.log('|' + w.map((n) => '-'.repeat(n + 2)).join('|') + '|');
}
