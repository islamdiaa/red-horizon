// Before/after table for two play-matrix runs (tools/e2e/matrix.mjs results.jsonl files).
//
//   node tools/e2e/matrix-compare.mjs <before/results.jsonl> <after/results.jsonl> [out.md] [--flag id,id,... "note"]
// --flag marks cells (†) with a footnote, e.g. cells re-run on both builds after a bot fix.
import fs from 'node:fs';

const argv = process.argv.slice(2);
const fi = argv.indexOf('--flag');
const flagged = fi >= 0 ? new Set(argv[fi + 1].split(',')) : new Set();
const flagNote = fi >= 0 ? argv[fi + 2] ?? '' : '';
if (fi >= 0) argv.splice(fi, 3);
const [a, b, out] = argv;
if (!a || !b) { console.error('usage: node tools/e2e/matrix-compare.mjs <before.jsonl> <after.jsonl> [out.md]'); process.exit(2); }
const load = (f) => new Map(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]));
const A = load(a), B = load(b);
const mmss = (s) => (s === null || s === undefined ? '-' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const res = (r) => (r ? `${r.result}${r.simEnd ? ` ${mmss(r.simEnd)}` : ''}` : '—');
const fr = (r) => { if (!r?.frictions?.length) return '0'; const k = r.frictions.map((f) => f.kind); return [...new Set(k)].map((x) => `${x}×${k.filter((y) => y === x).length}`).join(' '); };
const ids = [...new Set([...A.keys(), ...B.keys()])];
const rows = [
  '| cell | before | after | 1st contact b/a | idle $ % b/a | foe @7:00 b/a | hints b/a | friction before | friction after |',
  '|---|---|---|---|---|---|---|---|---|',
];
const tally = (m) => { const t = { win: 0, loss: 0, timeout: 0, pass: 0, fail: 0, other: 0 }; for (const r of m.values()) t[r.result in t ? r.result : 'other']++; return t; };
for (const id of ids) {
  const x = A.get(id), y = B.get(id);
  const at7 = (r) => (r?.at7 ? `${r.at7.foeUnits}/${r.at7.foeDefences}` : '-');
  rows.push(`| ${id}${flagged.has(id) ? ' †' : ''} | ${res(x)} | ${res(y)} | ${mmss(x?.firstContact)} / ${mmss(y?.firstContact)} | ${x?.idleMoneyPct ?? '-'} / ${y?.idleMoneyPct ?? '-'} | ${at7(x)} / ${at7(y)} | ${(x?.hints ?? []).length} / ${(y?.hints ?? []).length} | ${fr(x)} | ${fr(y)} |`);
}
const ta = tally(A), tb = tally(B);
const text = `${rows.join('\n')}\n\n${flagged.size ? `† ${flagNote}\n\n` : ''}Before: ${JSON.stringify(ta)}\nAfter: ${JSON.stringify(tb)}\n`;
if (out) fs.writeFileSync(out, text);
console.log(text);
