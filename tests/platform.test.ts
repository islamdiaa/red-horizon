// Platform layer logic that runs without a browser: GPU classification / quality decisions,
// the guarded main loop and the error ring buffer (DOM-free code paths of src/platform).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGpu, decideQuality, benchmarkLevel, type QualityLevel } from '../src/platform/gpu';
import { guardFrame, recordError, buildErrorReport, installErrorBoundary } from '../src/platform/errors';

const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

describe('classifyGpu', () => {
  const cases: [string, string, string, QualityLevel][] = [
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', WIN, 'software', 'low'],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', WIN, 'software', 'low'],
    ['ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'software', 'low'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'discrete', 'high'],
    ['ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4090/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 550.54, Unspecified Version)', WIN, 'discrete', 'high'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'discrete', 'high'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 960 Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'discrete', 'medium'],
    ['ANGLE (NVIDIA, NVIDIA GeForce MX450 Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'discrete', 'medium'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GT 1030 Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'discrete', 'medium'],
    ['ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'integrated', 'low'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'integrated', 'medium'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'integrated', 'medium'],
    ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'discrete', 'high'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'integrated', 'medium'],
    ['ANGLE (AMD, AMD Radeon(TM) RX Vega 10 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'integrated', 'medium'],
    ['ANGLE (AMD, AMD Radeon 780M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'integrated', 'medium'],
    ['ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'discrete', 'high'],
    ['ANGLE (AMD, AMD Radeon HD 7700 Series Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN, 'integrated', 'low'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)', MAC, 'apple', 'high'],
    ['Apple GPU', MAC, 'unknown', 'medium'],
    ['Apple GPU', IPHONE, 'mobile', 'low'],
    ['ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)', ANDROID, 'mobile', 'medium'],
    ['Mali-G52 MC2', ANDROID, 'mobile', 'low'],
    ['PowerVR Rogue GE8320', ANDROID, 'mobile', 'low'],
    ['', WIN, 'unknown', 'medium'],
    ['ANGLE (Unknown, Unknown Renderer, Unspecified Version)', WIN, 'unknown', 'medium'],
  ];
  for (const [renderer, ua, tier, baseline] of cases) {
    test(`${renderer || '(empty)'} -> ${tier}/${baseline}`, () => {
      const c = classifyGpu(renderer, ua);
      assert.equal(c.tier, tier, c.reason);
      assert.equal(c.baseline, baseline, c.reason);
    });
  }
});

describe('decideQuality', () => {
  const rtx = classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN);
  const uhd = classifyGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN);
  const unknown = classifyGpu('ANGLE (Unknown, Unknown Renderer)', WIN);
  const desk = { userAgent: WIN, deviceMemory: 16, hardwareConcurrency: 12, screenPixels: 1920 * 1080, screenMinSide: 1080 };

  test('a fast desktop stays high; benchmark agreeing keeps it', () => {
    assert.equal(decideQuality(rtx, desk).quality, 'high');
    assert.equal(decideQuality(rtx, desk, 120).quality, 'high');
  });
  test('low memory / few cores cap the level', () => {
    assert.equal(decideQuality(rtx, { ...desk, deviceMemory: 2 }).quality, 'low');
    assert.equal(decideQuality(rtx, { ...desk, deviceMemory: 4 }).quality, 'medium');
    assert.equal(decideQuality(rtx, { ...desk, hardwareConcurrency: 2 }).quality, 'low');
    assert.equal(decideQuality(rtx, { ...desk, hardwareConcurrency: 4 }).quality, 'medium');
  });
  test('a 4K screen drops integrated GPUs a level, but not discrete ones', () => {
    assert.equal(decideQuality(uhd, { ...desk, screenPixels: 3840 * 2160 }).quality, 'low');
    assert.equal(decideQuality(rtx, { ...desk, screenPixels: 3840 * 2160 }).quality, 'high');
  });
  test('the benchmark can only lower a known class, but decides an unknown one', () => {
    assert.equal(decideQuality(rtx, desk, 3).quality, 'low');
    assert.equal(decideQuality(uhd, desk, 500).quality, 'medium');
    assert.equal(decideQuality(unknown, desk, 500).quality, 'high');
    assert.equal(decideQuality(unknown, desk, 10).quality, 'medium');
    assert.equal(decideQuality(unknown, { ...desk, deviceMemory: 2 }, 500).quality, 'low', 'caps still apply');
  });
  test('benchmark thresholds', () => {
    assert.equal(benchmarkLevel(0.003), 'low');
    assert.equal(benchmarkLevel(12), 'medium');
    assert.equal(benchmarkLevel(80), 'high');
  });
  test('reasons explain the decision', () => {
    const d = decideQuality(rtx, { ...desk, deviceMemory: 2 }, 50);
    assert.ok(d.reasons.some((r) => r.includes('NVIDIA')), d.reasons.join('; '));
    assert.ok(d.reasons.some((r) => r.includes('2 GB')), d.reasons.join('; '));
    assert.ok(d.reasons.some((r) => r.startsWith('benchmark')), d.reasons.join('; '));
  });
});

describe('guardFrame', () => {
  test('isolated frame errors are swallowed and the loop keeps running', (t) => {
    t.mock.method(console, 'error', () => {});
    let calls = 0, fatal = 0;
    const g = guardFrame((n: number) => { calls++; if (n % 50 === 0) throw new Error(`glitch ${n}`); }, { onFatal: () => fatal++ });
    for (let i = 1; i <= 200; i++) g(i);
    assert.equal(calls, 200);
    assert.equal(fatal, 0);
    assert.equal(g.dead, false);
  });

  test('5 errors within 2 s stop the loop once and call onFatal once', (t) => {
    t.mock.method(console, 'error', () => {});
    let calls = 0, fatal = 0;
    const g = guardFrame(() => { calls++; throw new Error('broken frame'); }, { onFatal: () => fatal++ });
    for (let i = 0; i < 4; i++) g();
    assert.equal(g.dead, false, 'still alive after 4');
    g();
    assert.equal(g.dead, true);
    assert.equal(fatal, 1);
    for (let i = 0; i < 10; i++) g();
    assert.equal(calls, 5, 'fn no longer called once dead');
    g.reset();
    assert.equal(g.dead, false);
    g();
    assert.equal(calls, 6, 're-armed');
  });

  test('threshold and window are configurable', (t) => {
    t.mock.method(console, 'error', () => {});
    let fatal = 0;
    const g = guardFrame(() => { throw new Error('x'); }, { maxErrors: 2, windowMs: 10_000, onFatal: () => fatal++ });
    g();
    g();
    assert.equal(fatal, 1);
  });
});

describe('error ring buffer & report', () => {
  test('consecutive identical errors fold, capacity is bounded, report lists them', () => {
    installErrorBoundary({ capacity: 10, getContext: () => ({ tick: 4242, seed: 7 }) });
    const e = new RangeError('same thing');
    const a = recordError(e, 'manual');
    const b = recordError(e, 'manual');
    assert.equal(a, b);
    assert.equal(a!.count, 2);
    for (let i = 0; i < 30; i++) recordError(new Error(`distinct ${i}`), 'manual');
    const report = buildErrorReport();
    assert.ok(report.includes('distinct 29'), 'newest kept');
    assert.ok(!report.includes('distinct 5\n') && !report.includes('distinct 5 '), 'oldest evicted');
    assert.ok(report.includes('"tick":4242'), 'context included');
    assert.ok(/User agent:\s+\S/.test(report), 'user agent line');
    assert.ok(report.includes('GPU:'), 'GPU line');
  });

  test('noise from browser extensions and ResizeObserver is ignored', () => {
    assert.equal(recordError(new Error('ResizeObserver loop completed with undelivered notifications.')), null);
    assert.equal(recordError('Script error.'), null);
    assert.equal(recordError(new Error('boom'), 'error', 'chrome-extension://abc/content.js:1:1'), null);
  });

  test('non-Error throwables are recorded readably', () => {
    const r1 = recordError({ message: 'plain object', name: 'Custom' });
    assert.equal(r1?.name, 'Custom');
    const r2 = recordError(42);
    assert.equal(r2?.message, '42');
  });
});
