// Cross-browser regressions found by the browser matrix (tools/xb): behaviour that differs between Chromium, Firefox
// and WebKit and is decided in our own code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { classifyGpu, decideQuality, readGpuStrings } from '../src/platform/gpu.ts';
import { convolverNormalization, impulseResponse, impulseStart, mulberry32 } from '../src/audio/dsp.ts';
import { Synth } from '../src/audio/synth.ts';
import { isUpdate } from '../src/platform/pwa.ts';

const FF_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0';
const FF_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0';
const desk = { userAgent: FF_WIN, deviceMemory: 16, hardwareConcurrency: 16, screenPixels: 1920 * 1080, screenMinSide: 1080 };

test('Firefox GPU buckets ("..., or similar") let the benchmark decide instead of the bucket model', () => {
  // Firefox names every recent GeForce "GTX 980", every Intel GPU "HD Graphics", most Radeons "R9 200 Series"
  const cases: [string, string, string][] = [
    ['Intel(R) HD Graphics, or similar', FF_LINUX, 'integrated'],
    ['ANGLE (Intel, Intel(R) HD Graphics Direct3D11 vs_5_0 ps_5_0), or similar', FF_WIN, 'integrated'],
    ['NVIDIA GeForce GTX 980, or similar', FF_LINUX, 'discrete'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar', FF_WIN, 'discrete'],
    ['Radeon R9 200 Series, or similar', FF_LINUX, 'discrete'],
    ['Apple M1, or similar', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0', 'apple'],
  ];
  for (const [r, ua, tier] of cases) {
    const c = classifyGpu(r, ua);
    assert.equal(c.tier, tier, `${r}: tier (${c.reason})`);
    assert.equal(c.coarse, true, `${r}: coarse (${c.reason})`);
    assert.equal(c.baseline, 'medium', `${r}: baseline (${c.reason})`);
    // a fast GPU behind the bucket gets High, a slow one Low: the measurement decides, not the bucket's model
    assert.equal(decideQuality(c, { ...desk, userAgent: ua }, 80).quality, 'high', `${r}: fast GPU`);
    assert.equal(decideQuality(c, { ...desk, userAgent: ua }, 3).quality, 'low', `${r}: slow GPU`);
    assert.equal(decideQuality(c, { ...desk, userAgent: ua }).quality, 'medium', `${r}: no benchmark`);
  }
  // device caps still apply on top of the benchmark
  const ff = classifyGpu('NVIDIA GeForce GTX 980, or similar', FF_WIN);
  assert.equal(decideQuality(ff, { ...desk, hardwareConcurrency: 4 }, 80).quality, 'medium', 'a 4-thread CPU caps a coarse GPU at Medium');
  // software rasterisers stay Low, and names without the marker are classified as before
  assert.equal(classifyGpu('llvmpipe (LLVM 19.1.1, 256 bits), or similar', FF_LINUX).tier, 'software', 'llvmpipe bucket is software');
  assert.equal(classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', FF_WIN).coarse, undefined, 'a full name is not coarse');
  assert.equal(classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0, D3D11)', FF_WIN).baseline, 'medium', 'a real GTX 980 keeps its class');
});

test('HD infantry skinning: rhBone returns once (an early return made Direct3D\'s FXC warn X4000 through ANGLE)', () => {
  const src = fs.readFileSync(new URL('../src/render/models/infantry-hd.ts', import.meta.url), 'utf8');
  const body = /mat4 rhBone\( float bone \) \{([\s\S]*?)\n\}/.exec(src)?.[1]?.replace(/\/\/.*$/gm, '');
  assert.ok(body, 'the rhBone GLSL function is in infantry-hd.ts');
  assert.equal((body.match(/\breturn\b/g) ?? []).length, 1, 'rhBone has a single return statement');
  assert.ok(/return m;\s*$/.test(body.trim()), 'the return is the last statement');
});

// a minimal AudioBuffer for Node (the SFX code builds buffers without a context where it can)
class FakeAudioBuffer {
  numberOfChannels: number; length: number; sampleRate: number; private data: Float32Array[];
  constructor(o: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = o.numberOfChannels; this.length = o.length; this.sampleRate = o.sampleRate;
    this.data = Array.from({ length: o.numberOfChannels }, () => new Float32Array(o.length));
  }
  getChannelData(ch: number) { return this.data[ch]; }
}
(globalThis as unknown as { AudioBuffer: unknown }).AudioBuffer ??= FakeAudioBuffer;

test('offline SFX reverb: the start of the impulse response with a level correction, released after the render', () => {
  // the Web Audio normalisation (calculateNormalizationScale): constant 0.1 has RMS 0.1
  const flat = new FakeAudioBuffer({ numberOfChannels: 1, length: 1000, sampleRate: 48000 });
  flat.getChannelData(0).fill(0.1);
  const want = (0.00125 / 0.1) * (44100 / 48000);
  assert.ok(Math.abs(convolverNormalization(flat) / want - 1) < 1e-6, `normalisation ${convolverNormalization(flat)} vs ${want}`);

  const full = impulseResponse(48000, 'outdoor', 1) as unknown as AudioBuffer;
  const start = impulseStart(full, 24000);
  assert.equal(start.buffer.length, 24000, 'cut at the render length');
  const a = full.getChannelData(0), b = start.buffer.getChannelData(0);
  for (let i = 0; i < b.length; i += 997) assert.equal(b[i], a[i], `sample ${i} copied unscaled`);
  // normalised start x gain = the full response's normalised samples
  const k = convolverNormalization(start.buffer) * start.gain, kFull = convolverNormalization(full);
  assert.ok(Math.abs(k / kFull - 1) < 1e-9, `effective scale ${k} vs ${kFull}`);
  assert.ok(start.gain > 1, `the start of a decaying response has more power than the whole, so its correction is above 1 (${start.gain})`);

  // a fake context: offline renders get the short response behind a correction gain, a live context the full one
  const made: { normalize: boolean; buffer: AudioBuffer | null }[] = [];
  const ctx = (length?: number) => ({
    sampleRate: 48000, length,
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createConvolver: () => { const c = { normalize: true, buffer: null as AudioBuffer | null, connect() {}, disconnect() {} }; made.push(c); return c; },
  }) as unknown as BaseAudioContext;
  const out = { connect() {} } as unknown as AudioNode;
  const off = new Synth(ctx(30000), out, mulberry32(1));
  const input = off.reverb('huge');
  assert.notEqual(input, made[0] as unknown as AudioNode, 'offline: a correction gain in front of the convolver');
  assert.equal(made[0].normalize, true, 'offline: the convolver still normalises (normalize = false renders NaN in Firefox)');
  assert.equal(made[0].buffer?.length, 30000, 'offline: the response is cut at the render length');
  off.release();
  assert.equal(made[0].buffer, null, 'release() frees the kernels');
  const live = new Synth(ctx(undefined), out, mulberry32(1));
  assert.equal(live.reverb('huge'), made[1] as unknown as AudioNode, 'live context: straight into the convolver');
  assert.equal(made[1].buffer?.length, Math.floor(5.5 * 48000), 'live context: the whole response');
});

test('GPU name: Firefox\'s RENDERER is used as is (no deprecated debug extension), Chromium / WebKit use the extension', () => {
  const fakeGl = (renderer: string, unmasked: string) => {
    const asked: string[] = [];
    const gl = {
      RENDERER: 0x1f01, VENDOR: 0x1f00,
      getParameter: (p: number) => (p === 0x1f01 ? renderer : p === 0x1f00 ? 'Mozilla' : p === 0x9246 ? unmasked : p === 0x9245 ? 'Vendor' : null),
      getExtension: (n: string) => { asked.push(n); return { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 }; },
    } as unknown as WebGL2RenderingContext;
    return { gl, asked };
  };
  const ff = fakeGl('Intel(R) HD Graphics, or similar', 'unused');
  assert.equal(readGpuStrings(ff.gl).renderer, 'Intel(R) HD Graphics, or similar', 'Firefox: RENDERER');
  assert.deepEqual(ff.asked, [], 'Firefox: the deprecated extension is not requested (it logs a warning)');
  const cr = fakeGl('WebKit WebGL', 'ANGLE (Intel, Mesa Intel(R) Graphics (RPL-S), OpenGL ES 3.2)');
  assert.equal(readGpuStrings(cr.gl).renderer, 'ANGLE (Intel, Mesa Intel(R) Graphics (RPL-S), OpenGL ES 3.2)', 'Chromium: the unmasked name');
  assert.deepEqual(cr.asked, ['WEBGL_debug_renderer_info'], 'Chromium: the extension');
});

test('service worker: WebKit\'s first install is not taken for an update (it reloaded the page 10 s into a first visit)', () => {
  const v1 = { scriptURL: 'https://x/sw.js?v=index-aaaa1111' }, v2 = { scriptURL: 'https://x/sw.js?v=index-bbbb2222' };
  // first visit: no controller at load; WebKit has already activated (and claimed with) the same worker by the time
  // its 'installed' event arrives, Chromium and Firefox have no active worker yet
  assert.equal(isUpdate(false, v1, { ...v1 }), false, 'WebKit first install: the active worker is the installed one');
  assert.equal(isUpdate(false, null, v1), false, 'Chromium / Firefox first install');
  // a new deploy: the page loaded under the old worker, or the old worker is still active
  assert.equal(isUpdate(true, v1, v2), true, 'update while controlled');
  assert.equal(isUpdate(false, v1, v2), true, 'update after a first install in the same session');
});

test('service worker precache: Vite\'s base-relative chunk lists resolve against the scope (lazy chunks offline)', () => {
  const swRefs = (scope: string) => {
    const self = { registration: { scope }, location: new URL('sw.js?v=index-abcd1234', scope), addEventListener() {} };
    const ctx = vm.createContext({ self, URL, caches: {}, console });
    vm.runInContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), ctx);
    return ctx.bundleRefs as (text: string, base: string) => string[];
  };
  // a Vite entry chunk: the preload list of lazy chunks, written relative to the app's base
  const entry = 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/results-3LiLlJXG.js","assets/locker-2aLSWzpL.js","assets/index-x1.css"])))=>i.map(i=>d[i]);';
  const root = swRefs('https://game.example/')(entry, 'https://game.example/assets/index-abcd1234.js');
  assert.ok(root.includes('https://game.example/assets/results-3LiLlJXG.js'), `results chunk precached: ${root.join(' ')}`);
  assert.ok(!root.some((u) => u.includes('/assets/assets/')), 'no assets/assets/ (404) URLs');
  // a game hosted under a sub-path, and a file-relative reference
  const sub = swRefs('https://host.example/games/rh/')(entry + ' url(./font-a.woff2) import("../assets/clips-BlsGkcIv.js")', 'https://host.example/games/rh/assets/index-abcd1234.js');
  assert.ok(sub.includes('https://host.example/games/rh/assets/locker-2aLSWzpL.js'), `sub-path base: ${sub.join(' ')}`);
  assert.ok(sub.includes('https://host.example/games/rh/assets/clips-BlsGkcIv.js'), 'a ../ path stays relative to the chunk');
});
