// Before/after table for two play-matrix runs (tools/e2e/matrix.mjs results.jsonl files).
//
//   node tools/e2e/matrix-compare.mjs <before/results.jsonl> <after/results.jsonl> [out.md] [--flag id,id,... "note"] [--group] [--only <regex>]
// --flag marks cells (†) with a footnote, e.g. cells re-run on both builds after a bot fix.
// Either side may be several results.jsonl files, comma-separated (a later file's cell replaces an earlier one's).
// --group sums the seeds of a cell (ids ending in #2, #3...): games, wins / losses / timeouts, mean idle $ %.
// --only keeps the cells whose id matches.
import fs from 'node:fs';

const argv = process.argv.slice(2);
const flagArg = (n) => { const i = argv.indexOf(n); if (i < 0) return false; argv.splice(i, 1); return true; };
const valArg = (n) => { const i = argv.indexOf(n); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const group = flagArg('--group');
const only = valArg('--only');
const fi = argv.indexOf('--flag');
const flagged = fi >= 0 ? new Set(argv[fi + 1].split(',')) : new Set();
const flagNote = fi >= 0 ? argv[fi + 2] ?? '' : '';
if (fi >= 0) argv.splice(fi, 3);
const [a, b, out] = argv;
if (!a || !b) { console.error('usage: node tools/e2e/matrix-compare.mjs <before.jsonl> <after.jsonl> [out.md]'); process.exit(2); }
const load = (fs_) => new Map(fs_.split(',').flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((r) => !only || new RegExp(only).test(r.id)).map((r) => [r.id, r]));
const A = load(a), B = load(b);
const mmss = (s) => (s === null || s === undefined ? '-' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
if (group) {
  // per cell, all its seeds: games, results, mean share of the time with $1,000+ in the bank, median length
  const base = (id) => id.replace(/#\d+$/, '');
  const sum = (m) => {
    const g = new Map();
    for (const r of m.values()) { const k = base(r.id); g.set(k, [...(g.get(k) ?? []), r]); }
    return g;
  };
  const GA = sum(A), GB = sum(B);
  const cell = (rs) => {
    if (!rs?.length) return { txt: '—', idle: '-', len: '-' };
    const n = (x) => rs.filter((r) => r.result === x).length;
    const idle = rs.filter((r) => r.idleMoneyPct !== undefined);
    const lens = rs.map((r) => r.simEnd).filter((x) => x !== undefined).sort((p, q) => p - q);
    return { txt: `${rs.length}: ${n('win')}W ${n('loss')}L ${n('timeout')}T${rs.length - n('win') - n('loss') - n('timeout') ? ` ${rs.length - n('win') - n('loss') - n('timeout')}?` : ''}`, idle: idle.length ? Math.round(idle.reduce((s_, r) => s_ + r.idleMoneyPct, 0) / idle.length) : '-', len: lens.length ? mmss(lens[Math.floor(lens.length / 2)]) : '-' };
  };
  const rows = ['| cell | before (games: W L T) | after | idle $ % b/a | median length b/a |', '|---|---|---|---|---|'];
  const tot = { a: { n: 0, w: 0, t: 0 }, b: { n: 0, w: 0, t: 0 } };
  for (const k of [...new Set([...GA.keys(), ...GB.keys()])]) {
    const x = cell(GA.get(k)), y = cell(GB.get(k));
    rows.push(`| ${k} | ${x.txt} | ${y.txt} | ${x.idle} / ${y.idle} | ${x.len} / ${y.len} |`);
    for (const [side, g] of [['a', GA], ['b', GB]]) for (const r of g.get(k) ?? []) { tot[side].n++; if (r.result === 'win') tot[side].w++; if (r.result === 'timeout') tot[side].t++; }
  }
  const text = `${rows.join('\n')}\n\nBefore: ${tot.a.n} games, ${tot.a.w} wins, ${tot.a.t} timeouts. After: ${tot.b.n} games, ${tot.b.w} wins, ${tot.b.t} timeouts.\n`;
  if (out) fs.writeFileSync(out, text);
  console.log(text);
  process.exit(0);
}
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
