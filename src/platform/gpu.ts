/**
 * GPU capability probing and automatic graphics-quality selection.
 *
 * detectQuality() combines a static classification of the WEBGL_debug_renderer_info string with
 * device signals (deviceMemory, hardwareConcurrency, screen size) and an optional ~300 ms
 * fragment-shader micro-benchmark, then caches the verdict in localStorage (keyed by GPU + UA,
 * so a new GPU, driver-reported name or browser re-detects).
 *
 * Heuristics (first matching GPU class sets the baseline, device signals can only lower it):
 *
 * | Signal                                                         | Verdict                     |
 * |----------------------------------------------------------------|-----------------------------|
 * | SwiftShader / llvmpipe / softpipe / "Basic Render Driver" /     | low  (software rasteriser)  |
 * |   failIfMajorPerformanceCaveat context refused                  |                             |
 * | Mobile UA or GPU (Adreno, Mali, PowerVR, Immortalis, Xclipse,   | low                         |
 * |   Tegra, Apple GPU on iOS/iPadOS)                               |                             |
 * |   ... recent flagship mobile (Adreno 7xx/8xx, Immortalis)       | medium                      |
 * | Intel HD Graphics (Gen 7-9, e.g. HD 4000/520/620), GMA          | low                         |
 * | Intel UHD / Iris / Iris Plus / Iris Xe                          | medium                      |
 * | Intel Arc (discrete)                                            | high                        |
 * | AMD APU ("Radeon(TM) Graphics", Vega 3-11, 610M/660M/680M)      | medium                      |
 * | AMD 760M/780M/880M/890M APUs                                    | medium (high via benchmark) |
 * | Apple M-series (macOS)                                          | high                        |
 * | NVIDIA GeForce GTX 10xx+/16xx, RTX, Quadro/RTX A-series         | high                        |
 * | NVIDIA MX / GT / GTX 6xx-9xx (old or entry-level)               | medium                      |
 * | AMD Radeon RX / Pro / R9 / Vega 56/64 / VII                     | high                        |
 * | AMD Radeon HD / R5 / R7                                         | medium                      |
 * | Unknown / masked string ("ANGLE (Unknown)", "Apple GPU" masked) | medium, benchmark decides   |
 * | navigator.deviceMemory <= 2 GB                                  | cap low                     |
 * | navigator.deviceMemory <= 4 GB                                  | cap medium                  |
 * | navigator.hardwareConcurrency <= 2                              | cap low                     |
 * | navigator.hardwareConcurrency <= 4                              | cap medium                  |
 * | Physical screen > ~7.5 Mpx (4K+) and baseline < high            | one level lower             |
 * | Small screen (shorter side < 500 CSS px)                        | cap medium                  |
 * | Benchmark score (M pixel-shader-iterations / ms):               |                             |
 * |   < 6 => low, < 35 => medium, otherwise high                    | min(baseline, benchmark)    |
 * |   (unknown GPU class: benchmark replaces the baseline)          |                             |
 *
 * Benchmark: a 32-iteration trig/hash fragment shader (~16 ALU ops per iteration) drawn into a
 * detached 64..1024 px canvas, synchronised with a 1-pixel readPixels per frame; compile time is
 * excluded (KHR_parallel_shader_compile). Score = million pixel-iterations per ms. Calibration:
 * headless Chromium + SwiftShader measured 0.002-0.004 (a single 1024^2 frame would take ~10 s, hence
 * the adaptive frame size); from ALU throughput plus ~0.3 ms sync overhead per frame, an Intel
 * UHD 620 lands around 10-15, Apple M1 / Iris Xe 40-70 and current discrete GPUs 80+ (the
 * sync overhead caps fast GPUs, which is fine: anything above 35 is 'high').
 */

export type QualityLevel = 'low' | 'medium' | 'high';
export type GpuTier = 'software' | 'mobile' | 'integrated' | 'discrete' | 'apple' | 'unknown';

export interface GpuInfo {
  /** Unmasked vendor (WEBGL_debug_renderer_info) or the masked one. */
  vendor: string;
  /** Unmasked renderer string, e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)". */
  renderer: string;
  webgl2: boolean;
  maxTextureSize: number;
  /** The browser refused a context with failIfMajorPerformanceCaveat (software / blocklisted GPU). */
  majorPerformanceCaveat: boolean;
}

export interface GpuClass {
  tier: GpuTier;
  baseline: QualityLevel;
  reason: string;
}

export interface QualityDecision {
  quality: QualityLevel;
  tier: GpuTier;
  renderer: string;
  reasons: string[];
  /** Benchmark score (higher is faster), if it ran. */
  score?: number;
  fromCache: boolean;
}

export interface DeviceSignals {
  userAgent: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  /** Physical screen pixels (width * height * dpr^2). */
  screenPixels?: number;
  /** Shorter side of the screen in CSS pixels. */
  screenMinSide?: number;
}

const LEVELS: QualityLevel[] = ['low', 'medium', 'high'];
const rank = (q: QualityLevel) => LEVELS.indexOf(q);
const minQ = (a: QualityLevel, b: QualityLevel): QualityLevel => (rank(a) <= rank(b) ? a : b);
const lower = (q: QualityLevel): QualityLevel => LEVELS[Math.max(0, rank(q) - 1)];

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

let cachedInfo: GpuInfo | null = null;

/** Read vendor/renderer strings from a context (prefers the unmasked debug strings). */
export function readGpuStrings(gl: WebGLRenderingContext | WebGL2RenderingContext): { vendor: string; renderer: string } {
  let vendor = '', renderer = '';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? '');
      renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '');
    }
  } catch { /* extension deprecated in some browsers */ }
  // Firefox (and future Chrome) expose a sanitised name directly through RENDERER.
  if (!renderer) renderer = String(gl.getParameter(gl.RENDERER) ?? '');
  if (!vendor) vendor = String(gl.getParameter(gl.VENDOR) ?? '');
  return { vendor, renderer };
}

function releaseContext(gl: WebGLRenderingContext | WebGL2RenderingContext | null) {
  try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
}

/**
 * Probe the GPU once (cached). Pass the game's own context to avoid creating a throwaway one.
 * Never throws; returns empty strings when WebGL is unavailable.
 */
export function getGpuInfo(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): GpuInfo {
  if (cachedInfo && !gl) return cachedInfo;
  const info: GpuInfo = { vendor: '', renderer: '', webgl2: false, maxTextureSize: 0, majorPerformanceCaveat: false };
  if (typeof document === 'undefined') return info;
  let own: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  try {
    let ctx = gl ?? null;
    if (!ctx) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      own = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) as WebGL2RenderingContext | null;
      if (!own) {
        info.majorPerformanceCaveat = true;
        own = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGL2RenderingContext | WebGLRenderingContext | null;
      }
      ctx = own;
    }
    if (ctx) {
      Object.assign(info, readGpuStrings(ctx));
      info.webgl2 = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext;
      info.maxTextureSize = Number(ctx.getParameter(ctx.MAX_TEXTURE_SIZE)) || 0;
    }
  } catch { /* ignore */ }
  releaseContext(own);
  if (!gl) cachedInfo = info;
  return info;
}

// ---------------------------------------------------------------------------
// Classification (pure, unit-tested in tests/platform.test.ts)
// ---------------------------------------------------------------------------

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render driver|microsoft basic|mesa offscreen|virgl|vmware svga|parallels/i;
const MOBILE_UA = /android|iphone|ipad|ipod|mobile|silk|kindle/i;

/** Classify a renderer string into a tier and a baseline quality. */
export function classifyGpu(rendererRaw: string, userAgent = ''): GpuClass {
  const r = rendererRaw.replace(/\s+/g, ' ').trim();
  const mobileUa = MOBILE_UA.test(userAgent) || (/macintosh/i.test(userAgent) && /mobile/i.test(userAgent));
  if (!r) return { tier: 'unknown', baseline: 'medium', reason: 'GPU name unavailable' };
  if (SOFTWARE.test(r)) return { tier: 'software', baseline: 'low', reason: `software rasteriser (${r})` };

  // ---- mobile GPU families
  if (/adreno|mali|powervr|immortalis|xclipse|tegra|videocore|vivante/i.test(r)) {
    const adreno = /adreno[^0-9]*(\d{3})/i.exec(r);
    if (/immortalis/i.test(r) || (adreno && +adreno[1] >= 730)) return { tier: 'mobile', baseline: 'medium', reason: `flagship mobile GPU (${r})` };
    return { tier: 'mobile', baseline: 'low', reason: `mobile GPU (${r})` };
  }
  if (/apple/i.test(r) && !/apple m\d/i.test(r)) {
    if (mobileUa) return { tier: 'mobile', baseline: 'low', reason: 'Apple mobile GPU' };
    // Safari masks the name as "Apple GPU" on every Mac: Apple Silicon or AMD/Intel Macs alike.
    return { tier: 'unknown', baseline: 'medium', reason: 'masked Apple GPU' };
  }
  if (/apple m\d/i.test(r)) return { tier: 'apple', baseline: 'high', reason: `Apple Silicon (${r})` };

  // ---- Intel
  if (/intel/i.test(r)) {
    if (/\barc\b/i.test(r)) return { tier: 'discrete', baseline: 'high', reason: `Intel Arc (${r})` };
    if (/iris|uhd/i.test(r)) return { tier: 'integrated', baseline: 'medium', reason: `Intel integrated (${r})` };
    return { tier: 'integrated', baseline: 'low', reason: `older Intel integrated (${r})` };
  }

  // ---- NVIDIA
  if (/nvidia|geforce|quadro|rtx|gtx/i.test(r)) {
    if (/\bmx\s?\d{3}|\bgt\s?\d{3,4}\b|gtx\s?[6-9]\d{2}\b|gtx\s?titan\b|\bnvs\b/i.test(r)) {
      return { tier: 'discrete', baseline: 'medium', reason: `entry-level / older NVIDIA (${r})` };
    }
    return { tier: 'discrete', baseline: 'high', reason: `NVIDIA discrete (${r})` };
  }

  // ---- AMD
  if (/amd|radeon|ati\b/i.test(r)) {
    if (/\b(7[6-9]0m|8[89]0m)\b/i.test(r)) return { tier: 'integrated', baseline: 'medium', reason: `fast AMD APU (${r})` };
    if (/radeon\s*\(tm\)\s*graphics|radeon graphics|vega\s*(3|6|8|10|11)\b|\b6[1-8]0m\b|radeon\s*r[2-7]\b|\br[57]\s?(2|3)\d{2}\b|radeon hd/i.test(r)) {
      return { tier: 'integrated', baseline: /radeon hd/i.test(r) ? 'low' : 'medium', reason: `AMD APU / older Radeon (${r})` };
    }
    if (/\brx\b|radeon pro|\br9\b|vega\s*(56|64)|radeon vii|\bw\d{4}\b/i.test(r)) return { tier: 'discrete', baseline: 'high', reason: `AMD discrete (${r})` };
    return { tier: 'unknown', baseline: 'medium', reason: `unrecognised AMD GPU (${r})` };
  }

  if (/qualcomm|snapdragon/i.test(r)) return { tier: 'integrated', baseline: 'medium', reason: `Snapdragon PC (${r})` };
  return { tier: 'unknown', baseline: 'medium', reason: `unrecognised GPU (${r})` };
}

/** Map a benchmark score to a level (see table above). */
export function benchmarkLevel(score: number): QualityLevel {
  return score < 6 ? 'low' : score < 35 ? 'medium' : 'high';
}

/** Combine GPU class, device signals and an optional benchmark score (pure). */
export function decideQuality(gpu: GpuClass, sig: DeviceSignals, score?: number): { quality: QualityLevel; reasons: string[] } {
  const reasons = [gpu.reason];
  let q = gpu.baseline;
  const mobile = MOBILE_UA.test(sig.userAgent) || gpu.tier === 'mobile';
  if (mobile && gpu.tier !== 'mobile' && q === 'high') { q = 'medium'; reasons.push('mobile device'); }
  if (sig.deviceMemory !== undefined) {
    if (sig.deviceMemory <= 2) { q = minQ(q, 'low'); reasons.push(`${sig.deviceMemory} GB RAM`); }
    else if (sig.deviceMemory <= 4 && q === 'high') { q = 'medium'; reasons.push(`${sig.deviceMemory} GB RAM`); }
  }
  if (sig.hardwareConcurrency !== undefined) {
    if (sig.hardwareConcurrency <= 2) { q = minQ(q, 'low'); reasons.push(`${sig.hardwareConcurrency} CPU threads`); }
    else if (sig.hardwareConcurrency <= 4 && q === 'high') { q = 'medium'; reasons.push(`${sig.hardwareConcurrency} CPU threads`); }
  }
  if (sig.screenMinSide !== undefined && sig.screenMinSide < 500 && q === 'high') { q = 'medium'; reasons.push('small screen'); }
  if (sig.screenPixels !== undefined && sig.screenPixels > 7.5e6 && gpu.baseline !== 'high' && q !== 'low') {
    q = lower(q);
    reasons.push(`${(sig.screenPixels / 1e6).toFixed(1)} Mpx display`);
  }
  if (score !== undefined && Number.isFinite(score)) {
    const b = benchmarkLevel(score);
    reasons.push(`benchmark ${score < 1 ? score.toPrecision(2) : score.toFixed(1)} => ${b}`);
    if (gpu.tier === 'unknown') {
      // the class told us nothing: trust the measurement, still bounded by memory / CPU caps
      const caps = decideQuality({ ...gpu, baseline: 'high' }, sig).quality;
      q = minQ(b, caps);
    } else q = minQ(q, b);
  }
  return { quality: q, reasons };
}

// ---------------------------------------------------------------------------
// Micro-benchmark
// ---------------------------------------------------------------------------

const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
// ~16 ALU ops per iteration: trig, fract-hash and a dependent chain the compiler cannot fold.
// The loop count is a small compile-time constant: software JITs (SwiftShader) unroll loops, and a
// large bound made the first compile take seconds.
const ITERS = 32;
const FS = `#version 300 es
precision highp float;
uniform float uSeed;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * 0.0137 + uSeed;
  vec3 c = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < ${ITERS}; i++) {
    uv = vec2(uv.x * 1.07 + sin(uv.y + a), uv.y * 0.93 + cos(uv.x - a));
    a = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    c += vec3(a, a * a, sqrt(a)) * 0.01;
  }
  o = vec4(c, 1.0);
}`;

export interface BenchmarkResult {
  /** Million pixel-iterations per millisecond (higher is faster). */
  score: number;
  frames: number;
  size: number;
  ms: number;
}

/**
 * Render a heavy fragment shader into a detached canvas for ~`budgetMs` and measure throughput.
 * Work per frame starts tiny and grows until a frame takes a few ms, so slow devices (software
 * rendering) never receive a multi-second draw call. Returns null if WebGL2 is unavailable.
 */
export async function runBenchmark(budgetMs = 300): Promise<BenchmarkResult | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'p');
    gl.linkProgram(prog);
    // Shader compilation is not what we measure (ANGLE/D3D can take 100+ ms for the first program):
    // with KHR_parallel_shader_compile wait for it without blocking, give up after 3 s.
    const par = gl.getExtension('KHR_parallel_shader_compile');
    if (par) {
      const until = performance.now() + 3000;
      while (!gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR)) {
        if (performance.now() > until) return null;
        await sleep(16);
      }
    }
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(prog) || 'link failed');
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uSeed = gl.getUniformLocation(prog, 'uSeed');
    const px = new Uint8Array(4);
    let size = 64;
    const draw = (seed: number) => {
      gl.viewport(0, 0, size, size);
      gl.uniform1f(uSeed, seed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // forces the GPU to finish
    };
    // warm-up (driver-side lazy compilation / state setup without the parallel-compile extension)
    draw(0);
    await sleep(0);
    const t0 = performance.now();
    // scale the work up until one frame costs >= 4 ms (or the canvas is full), so a slow device
    // (software rendering) never receives a huge draw call
    for (;;) {
      const s = performance.now();
      draw(1);
      const dt = performance.now() - s;
      if (dt >= 4 || size >= 1024 || performance.now() - t0 > budgetMs * 0.5) break;
      size *= 2;
    }
    // measure, yielding to the event loop every ~50 ms so the page stays responsive
    let frames = 0, work = 0;
    const start = performance.now();
    let sliceStart = start;
    while (performance.now() - t0 < budgetMs || frames < 3) {
      draw(2 + frames);
      frames++;
      work += size * size * ITERS;
      if (performance.now() - sliceStart > 50) {
        await sleep(0);
        sliceStart = performance.now();
      }
      if (performance.now() - t0 > budgetMs * 4) break; // hard stop for pathological devices
    }
    const ms = performance.now() - start;
    return { score: work / 1e6 / Math.max(ms, 0.001), frames, size, ms };
  } catch {
    return null;
  } finally {
    releaseContext(gl);
  }
}

// ---------------------------------------------------------------------------
// detectQuality (cached)
// ---------------------------------------------------------------------------

const CACHE_KEY = 'rh.quality.auto';
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;

interface CacheEntry { v: number; key: string; quality: QualityLevel; tier: GpuTier; reasons: string[]; score?: number; at: number }

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function deviceSignals(): DeviceSignals {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number };
  const scr = typeof screen !== 'undefined' ? screen : undefined;
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  return {
    userAgent: nav.userAgent ?? '',
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined,
    screenPixels: scr ? scr.width * scr.height * dpr * dpr : undefined,
    screenMinSide: scr ? Math.min(scr.width, scr.height) : undefined,
  };
}

/** Forget the cached verdict (e.g. from a "Re-detect" button in the settings menu). */
export function clearQualityCache() {
  try { storage()?.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

/** Full decision with reasons (for logs / a settings tooltip). */
export async function detectQualityDetailed(opts: { benchmark?: boolean; force?: boolean; budgetMs?: number } = {}): Promise<QualityDecision> {
  const info = getGpuInfo();
  const sig = deviceSignals();
  const key = `${info.renderer}|${sig.userAgent}`;
  const st = storage();
  if (!opts.force && st) {
    try {
      const c = JSON.parse(st.getItem(CACHE_KEY) ?? 'null') as CacheEntry | null;
      if (c && c.v === CACHE_VERSION && c.key === key && Date.now() - c.at < CACHE_TTL_MS && LEVELS.includes(c.quality)) {
        return { quality: c.quality, tier: c.tier, renderer: info.renderer, reasons: c.reasons, score: c.score, fromCache: true };
      }
    } catch { /* corrupt entry: re-detect */ }
  }
  let gpu = classifyGpu(info.renderer, sig.userAgent);
  if (info.majorPerformanceCaveat && gpu.tier !== 'software') {
    gpu = { tier: 'software', baseline: 'low', reason: `browser reports a major performance caveat (${info.renderer || 'unknown GPU'})` };
  }
  if (!info.webgl2) gpu = { tier: gpu.tier, baseline: 'low', reason: `${gpu.reason}; no WebGL2` };
  let score: number | undefined;
  // software rendering is decided without spending time on a benchmark
  if (opts.benchmark !== false && gpu.tier !== 'software' && info.webgl2) {
    const b = await runBenchmark(opts.budgetMs ?? 300);
    if (b) score = b.score;
  }
  const { quality, reasons } = decideQuality(gpu, sig, score);
  const entry: CacheEntry = { v: CACHE_VERSION, key, quality, tier: gpu.tier, reasons, score, at: Date.now() };
  try { st?.setItem(CACHE_KEY, JSON.stringify(entry)); } catch { /* quota / private mode */ }
  return { quality, tier: gpu.tier, renderer: info.renderer, reasons, score, fromCache: false };
}

/** Pick 'low' | 'medium' | 'high' for this device (cached in localStorage). */
export async function detectQuality(opts: { benchmark?: boolean; force?: boolean; budgetMs?: number } = {}): Promise<QualityLevel> {
  return (await detectQualityDetailed(opts)).quality;
}
