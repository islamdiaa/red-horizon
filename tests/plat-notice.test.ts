// A browser drawing WebGL without the graphics card (hardware acceleration off, a blocklisted driver,
// a VM) ran the game at 0.3-0.7 fps with its clock at 3-4 % of real time and a frozen loading screen for minutes,
// and nothing told the player why. src/platform/webgl.ts now recognises it and shows a dismissible notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkSupportRetrying, isSlowRenderer, type SupportResult } from '../src/platform/webgl.ts';
import tErrors from '../src/i18n/en/errors.ts';

const ok = (renderer: string, caveat = false): SupportResult => ({ ok: true, message: '', detail: '', warnings: [], renderer, caveat });

test('software rasterisers and performance-caveat contexts count as slow renderers', () => {
  const slow = [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', // Chrome, no GPU
    'llvmpipe (LLVM 20.1.2, 256 bits)', // Firefox on Linux, no GPU
    'ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)', // Windows WARP
    'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0), or similar', // Firefox on WARP
  ];
  for (const r of slow) assert.equal(isSlowRenderer(ok(r)), true, `${r} should be a slow renderer`);
  // a real GPU whose context the browser flagged (hardware acceleration off, blocklisted driver)
  assert.equal(isSlowRenderer(ok('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', true)), true, 'a caveat context is slow');
});

test('real GPUs and failed checks get no notice', () => {
  const fast = [
    'ANGLE (Intel, Mesa Intel(R) Graphics (ADL-S GT1), OpenGL ES 3.2)',
    'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple GPU', 'Adreno (TM) 650', 'Mali-G78',
    'Intel(R) HD Graphics, or similar',
  ];
  for (const r of fast) assert.equal(isSlowRenderer(ok(r)), false, `${r} should not be a slow renderer`);
  assert.equal(isSlowRenderer({ ok: false, reason: 'no-webgl', message: '', detail: '', warnings: [] }), false, 'no notice when the game cannot start at all');
  assert.equal(isSlowRenderer(ok('')), false, 'an unknown renderer without a caveat gets no notice');
});

test('the notice text exists in English and every locale', () => {
  for (const k of ['title', 'body', 'advice', 'dismiss'] as const) assert.ok(tErrors(`slowGpu.${k}`, { game: 'X' }).length > 3, `en errors.slowGpu.${k}`);
  for (const l of ['de', 'es', 'fr', 'pt-BR', 'ru', 'zh-CN']) {
    const j = JSON.parse(fs.readFileSync(new URL(`../src/i18n/locales/${l}.json`, import.meta.url), 'utf8'));
    for (const k of ['title', 'body', 'advice', 'dismiss']) assert.ok(typeof j[`errors.slowGpu.${k}`] === 'string' && j[`errors.slowGpu.${k}`].length > 0, `${l}: errors.slowGpu.${k}`);
    assert.ok(j['errors.slowGpu.body'].includes('{game}'), `${l}: body keeps the {game} placeholder`);
  }
});

// Found in the net lab: on a cold start, Chrome and Edge on Windows (Direct3D 11) sometimes fail the
// first WebGL 2 context (2 of ~8 first launches after a long idle) and the player got the "can't start" page. The
// check now retries on a fresh canvas after 0.5 s and 1.5 s before giving up.
const failed = (msg: string): SupportResult => ({ ok: false, reason: 'context-failed', message: 'x', detail: msg, warnings: [] });

test('a context that fails at first but comes up on a retry starts the game', async () => {
  const seq = [failed('GPU process starting'), failed('still starting'), ok('ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)')];
  const waits: number[] = [];
  let calls = 0;
  const r = await checkSupportRetrying([500, 1500], () => seq[Math.min(calls++, seq.length - 1)], async (ms) => { waits.push(ms); });
  assert.equal(r.ok, true, 'the third attempt succeeds');
  assert.equal(calls, 3, 'three attempts');
  assert.deepEqual(waits, [500, 1500], 'waits 0.5 s, then 1.5 s');
  assert.ok(r.warnings.some((w) => /attempt 3/.test(w) && /GPU process starting/.test(w)), `the earlier failures are kept for diagnostics: ${r.warnings.join(' / ')}`);
});

test('a context that never comes up still reports context-failed, with every attempt', async () => {
  let calls = 0;
  const r = await checkSupportRetrying([500, 1500], () => failed(`creation error ${++calls}`), async () => {});
  assert.equal(r.ok, false, 'gives up');
  assert.equal(r.reason, 'context-failed', 'same reason');
  assert.equal(calls, 3, 'three attempts in all');
  assert.match(r.detail, /attempt 1: creation error 1\nattempt 2: creation error 2\nattempt 3: creation error 3/, `detail lists every attempt: ${r.detail}`);
  // the default schedule outlasts Chrome's ~10 s block of every page's 3D APIs after a GPU-process loss
  const waits: number[] = [];
  await checkSupportRetrying(undefined, () => failed('Web page caused context loss and was blocked'), async (ms) => { waits.push(ms); });
  assert.ok(waits.reduce((a, b) => a + b, 0) >= 11000 && waits.length >= 3, `default retries span more than 10 s: ${waits.join(',')}`);
});

test('no retry for a browser without WebGL 2, or when it works the first time', async () => {
  for (const first of [{ ok: false, reason: 'webgl1-only', message: 'x', detail: 'd', warnings: [] } as SupportResult, ok('Apple GPU')]) {
    let calls = 0;
    const waits: number[] = [];
    const r = await checkSupportRetrying([500, 1500], () => { calls++; return first; }, async (ms) => { waits.push(ms); });
    assert.equal(calls, 1, `${first.reason ?? 'ok'}: one attempt`);
    assert.deepEqual(waits, [], `${first.reason ?? 'ok'}: no waiting`);
    assert.deepEqual(r, first, `${first.reason ?? 'ok'}: the result unchanged`);
  }
});
