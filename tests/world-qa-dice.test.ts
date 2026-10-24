// World Conquest QA: the dice match Risk's known per-roll table (exact enumeration, no sampling), and the blitz
// odds match the Risk literature. The reference (tools/world/qa-dice.ts) is independent of the game's own dice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RISK_BLITZ, RISK_TABLE, blitzOdds, rollTable } from '../tools/world/qa-dice';
import { blitzOdds as gameBlitz, rollDistribution, rollOnce } from '../src/conquest/world/dice';
import { Rng } from '../src/core/rng';

test('reference: exact enumeration reproduces Risk\'s per-roll table (3v2, 3v1, 2v2, 2v1, 1v2, 1v1)', () => {
  for (const [key, want] of Object.entries(RISK_TABLE)) {
    const [a, d] = key.split('v').map(Number);
    const t = rollTable(a, d);
    assert.equal(t.total, want.total, `${key}: ${t.total} combinations, want ${want.total}`);
    assert.deepEqual(Object.fromEntries([...t.counts].sort()), want.counts, `${key}: outcome counts`);
  }
});

test('reference: blitz odds match the published Risk table', () => {
  for (const [att, def, p] of RISK_BLITZ) {
    const got = blitzOdds(att, def).win;
    assert.ok(Math.abs(got - p) <= 0.001, `${att} troops attacking ${def}: P(conquer) ${got.toFixed(4)}, want ${p}`);
  }
});

// ---------------------------------------------------------------------------------------------- the game's dice

/** A stand-in random generator that walks through every dice combination: die k of combination c shows ((c / 6^k) mod 6) + 1. */
function enumeratingRng(nDice: number) {
  let c = 0, k = 0;
  return {
    rng: { next: () => { const face = Math.floor(c / 6 ** k) % 6; k++; if (k === nDice) { k = 0; c++; } return (face + 0.5) / 6; } } as unknown as Rng,
    total: 6 ** nDice,
  };
}

test('the game\'s dice: every combination through rollOnce (the rolling path) gives Risk\'s per-roll table', () => {
  for (const [key, want] of Object.entries(RISK_TABLE)) {
    const [a, d] = key.split('v').map(Number);
    const { rng, total } = enumeratingRng(a + d);
    const counts: Record<string, number> = {};
    for (let i = 0; i < total; i++) {
      const r = rollOnce(rng, a, d);
      assert.ok(r.att.length === a && r.def.length === d && r.attLoss + r.defLoss === Math.min(a, d), `${key}: a roll has ${a} and ${d} dice and costs min(a, d) troops`);
      counts[`${r.attLoss},${r.defLoss}`] = (counts[`${r.attLoss},${r.defLoss}`] ?? 0) + 1;
    }
    assert.deepEqual(Object.fromEntries(Object.entries(counts).sort()), want.counts, `${key}: rollOnce outcome counts`);
  }
});

test('the game\'s dice: the odds shown before you commit are exact (single roll and blitz)', () => {
  for (const [key, want] of Object.entries(RISK_TABLE)) {
    const [a, d] = key.split('v').map(Number);
    const p = rollDistribution(a, d);
    for (const [k, n] of Object.entries(want.counts)) {
      const attLoss = +k.split(',')[0];
      assert.ok(Math.abs(p[attLoss] - n / want.total) < 1e-12, `${key}: P(attacker loses ${attLoss}) ${p[attLoss]} vs ${n}/${want.total}`);
    }
  }
  for (const [att, def, p] of RISK_BLITZ) {
    const got = gameBlitz(att - 1, def).win;
    assert.ok(Math.abs(got - p) <= 0.001, `blitz ${att} troops v ${def}: ${got.toFixed(4)}, want ${p}`);
  }
  for (let att = 2; att <= 30; att++) for (let def = 1; def <= 30; def++) {
    const got = gameBlitz(att - 1, def).win, want = blitzOdds(att, def).win;
    assert.ok(Math.abs(got - want) < 1e-9, `blitz ${att} v ${def}: game ${got} vs reference ${want}`);
  }
});

test('the game\'s dice: wonder modifiers on the best die (capped at 6) match the reference', () => {
  for (const [a, d] of [[3, 2], [3, 1], [2, 2], [2, 1], [1, 2], [1, 1]]) for (const am of [0, 1, 2]) for (const dm of [0, 1, 2]) {
    const ref = rollTable(a, d, { att: am, def: dm, cap: 6 });
    const p = rollDistribution(a, d, am, dm);
    for (const [k, n] of ref.counts) {
      const attLoss = +k.split(',')[0];
      assert.ok(Math.abs(p[attLoss] - n / ref.total) < 1e-12, `${a}v${d} att+${am} def+${dm}: P(attacker loses ${attLoss}) ${p[attLoss]} vs ${n / ref.total}`);
    }
    if (am || dm) for (let att = 2; att <= 12; att++) for (let def = 1; def <= 12; def++) {
      const got = gameBlitz(att - 1, def, am, dm).win, want = blitzOdds(att, def, { att: am, def: dm, cap: 6 }).win;
      assert.ok(Math.abs(got - want) < 1e-9, `blitz ${att} v ${def} att+${am} def+${dm}: game ${got} vs reference ${want}`);
    }
  }
});

test('the game\'s dice: the run\'s random generator rolls fair dice (60,000 rolls of 3 v 2 within 4 sigma)', () => {
  const rng = new Rng(20261024);
  const n = 60000, counts = [0, 0, 0];
  const faces = new Array(7).fill(0);
  for (let i = 0; i < n; i++) { const r = rollOnce(rng, 3, 2); counts[r.attLoss]++; for (const f of [...r.att, ...r.def]) faces[f]++; }
  const want = RISK_TABLE['3v2'];
  for (const [k, c] of Object.entries(want.counts)) {
    const p = c / want.total, got = counts[+k.split(',')[0]] / n, sd = Math.sqrt(p * (1 - p) / n);
    assert.ok(Math.abs(got - p) < 4 * sd, `3v2 ${k}: ${(got * 100).toFixed(2)}% vs ${(p * 100).toFixed(2)}% (4 sigma ${(400 * sd).toFixed(2)})`);
  }
  for (let f = 1; f <= 6; f++) assert.ok(Math.abs(faces[f] / (5 * n) - 1 / 6) < 4 * Math.sqrt((1 / 6) * (5 / 6) / (5 * n)), `face ${f}: ${faces[f]} of ${5 * n}`);
});
