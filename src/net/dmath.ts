/**
 * Portable math for runs that must reproduce exactly on another machine: multiplayer matches (every client) and
 * ranked runs (the browser and the leaderboard server).
 *
 * Why: JavaScript only fixes + - * / and sqrt bit for bit. Math.sin, cos, atan2, pow, log2... are left to the
 * engine, and engines differ in the last bit: Node 22 and Chromium 156 (both V8, different versions) disagree on
 * nearly every one of them. One differing bit in a unit's heading is enough to change a battle.
 *
 * These versions use only exactly specified operations (+ - * /, sqrt, floor, bit-level float access), with the
 * classic fdlibm algorithms and coefficients, so every engine computes the same results, within about an ulp of
 * the true value. `withPortableMath` swaps them into Math for the functions the simulation uses (sin, cos,
 * atan2, atan, hypot, pow, log2, exp, log) and restores the engine's afterwards. The simulation code itself
 * does not change: single-player games keep the engine's math, as before.
 */

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
// little-endian on every platform that runs the game: u32[1] = high word
const HI = 1, LO = 0;

/** 2^k for integer k (exact, via the exponent bits). */
function pow2(k: number): number {
  if (k > 1023) return pow2(1023) * pow2(k - 1023);
  if (k < -1022) return pow2(-1022) * pow2(k + 1022);
  u32[LO] = 0;
  u32[HI] = (k + 1023) << 20;
  return f64[0];
}

// ---------------------------------------------------------------------------------------------------------
// sin / cos (fdlibm k_sin, k_cos, rem_pio2 for moderate arguments)
// ---------------------------------------------------------------------------------------------------------
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
const INVPIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;

function kSin(x: number, y: number, iy: number): number {
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
function kCos(x: number, y: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z, w = 1 - hz;
  return w + (((1 - w) - hz) + (z * r - x * y));
}

let remY0 = 0, remY1 = 0;
/** x = n·π/2 + (remY0 + remY1); returns n. Three-part Cody-Waite reduction (|x| up to about 2^30). */
function remPio2(x: number): number {
  const n = Math.floor(x * INVPIO2 + 0.5);
  let r = x - n * PIO2_1, w = n * PIO2_1T;
  let y0 = r - w;
  let t = r;
  w = n * PIO2_2;
  r = t - w;
  w = n * PIO2_2T - ((t - r) - w);
  y0 = r - w;
  t = r;
  w = n * PIO2_3;
  r = t - w;
  w = n * PIO2_3T - ((t - r) - w);
  y0 = r - w;
  remY0 = y0;
  remY1 = (r - y0) - w;
  return n;
}

export function dsin(x: number): number {
  if (!(x - x === 0)) return NaN; // NaN, ±Infinity
  const a = x < 0 ? -x : x;
  if (a <= 0.7853981633974483) return a < 7.450580596923828e-9 ? x : kSin(x, 0, 0);
  const n = remPio2(x) & 3;
  if (n === 0) return kSin(remY0, remY1, 1);
  if (n === 1) return kCos(remY0, remY1);
  if (n === 2) return -kSin(remY0, remY1, 1);
  return -kCos(remY0, remY1);
}

export function dcos(x: number): number {
  if (!(x - x === 0)) return NaN;
  const a = x < 0 ? -x : x;
  if (a <= 0.7853981633974483) return a < 7.450580596923828e-9 ? 1 : kCos(x, 0);
  const n = remPio2(x) & 3;
  if (n === 0) return kCos(remY0, remY1);
  if (n === 1) return -kSin(remY0, remY1, 1);
  if (n === 2) return -kCos(remY0, remY1);
  return kSin(remY0, remY1, 1);
}

// ---------------------------------------------------------------------------------------------------------
// atan / atan2 (fdlibm s_atan, e_atan2)
// ---------------------------------------------------------------------------------------------------------
const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT0 = 3.33333333333329318027e-01, AT1 = -1.99999999998764832476e-01, AT2 = 1.42857142725034663711e-01,
  AT3 = -1.11111104054623557880e-01, AT4 = 9.09088713343650656196e-02, AT5 = -7.69187620504482999495e-02,
  AT6 = 6.66107313738753120669e-02, AT7 = -5.83357013379057348645e-02, AT8 = 4.97687799461593236017e-02,
  AT9 = -3.65315727442169155270e-02, AT10 = 1.62858201153657823623e-02;

export function datan(x: number): number {
  if (x !== x) return NaN;
  const neg = x < 0;
  let a = neg ? -x : x;
  if (a >= 7.378697629483821e19) return neg ? -(ATANHI[3] + ATANLO[3]) : ATANHI[3] + ATANLO[3];
  let id: number;
  if (a < 0.4375) {
    if (a < 3.725290298461914e-9) return x;
    id = -1;
  } else if (a < 1.1875) {
    if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); } else { id = 1; a = (a - 1) / (a + 1); }
  } else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); } else { id = 3; a = -1 / a; }
  const z = a * a, w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) { const r = a - a * (s1 + s2); return neg ? -r : r; }
  const r = ATANHI[id] - ((a * (s1 + s2) - ATANLO[id]) - a);
  return neg ? -r : r;
}

const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16, PI_O2 = 1.5707963267948965580e+00, PI_O4 = 7.8539816339744827900e-01;

export function datan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x === 1) return datan(y);
  const yneg = y < 0 || (y === 0 && 1 / y < 0), xneg = x < 0 || (x === 0 && 1 / x < 0);
  const m = (yneg ? 1 : 0) | (xneg ? 2 : 0);
  if (y === 0) return m === 0 || m === 1 ? y : m === 2 ? PI : -PI;
  if (x === 0) return yneg ? -PI_O2 : PI_O2;
  const xinf = x === Infinity || x === -Infinity, yinf = y === Infinity || y === -Infinity;
  if (xinf) {
    if (yinf) return m === 0 ? PI_O4 : m === 1 ? -PI_O4 : m === 2 ? 3 * PI_O4 : -3 * PI_O4;
    return m === 0 ? 0 : m === 1 ? -0 : m === 2 ? PI : -PI;
  }
  if (yinf) return yneg ? -PI_O2 : PI_O2;
  const ay = yneg ? -y : y, ax = xneg ? -x : x;
  const ratio = ay / ax;
  let z: number;
  if (ratio > 1.152921504606847e18) z = PI_O2 + 0.5 * PI_LO;
  else if (xneg && ratio < 8.673617379884035e-19) z = 0;
  else z = datan(ratio);
  if (m === 0) return z;
  if (m === 1) return -z;
  if (m === 2) return PI - (z - PI_LO);
  return (z - PI_LO) - PI;
}

// ---------------------------------------------------------------------------------------------------------
// exp / log / log2 / pow (fdlibm e_exp, e_log)
// ---------------------------------------------------------------------------------------------------------
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INVLN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
  P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;

export function dexp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const a = x < 0 ? -x : x;
  if (a < 3.725290298461914e-9) return 1 + x;
  let k = 0, hi = x, lo = 0;
  if (a > 0.34657359027997264) {
    k = Math.floor(INVLN2 * x + 0.5);
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
  }
  const r = hi - lo, t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((r * c) / (c - 2) - r);
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  return y * pow2(k);
}

const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01,
  LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01, LG7 = 1.479819860511658591e-01;

/** x = 2^e · m with m in [sqrt(1/2), sqrt(2)); sets `logE`, returns m - 1. */
let logE = 0;
function split(x: number): number {
  f64[0] = x;
  let hx = u32[HI];
  let e = (hx >>> 20) - 1023;
  if (e === -1023) { f64[0] = x * 18014398509481984; hx = u32[HI]; e = (hx >>> 20) - 1023 - 54; } // subnormal
  u32[HI] = (hx & 0x000fffff) | 0x3ff00000;
  let m = f64[0];
  if (m > 1.4142135623730951) { m *= 0.5; e++; }
  logE = e;
  return m - 1;
}

export function dlog(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  const f = split(x), k = logE;
  const s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6)), t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1, hfsq = 0.5 * f * f;
  return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
}

export function dlog2(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  const f = split(x), k = logE;
  if (f === 0) return k; // exact powers of two
  const s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6)), t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1, hfsq = 0.5 * f * f;
  const ln1pf = f - (hfsq - s * (hfsq + R));
  return k + ln1pf * INVLN2;
}

export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  if (y === 1) return x;
  if (y === 2) return x * x;
  if (x === 1) return 1;
  if (y === 0.5 && x >= 0 && x !== Infinity) return Math.sqrt(x);
  if (y === Infinity || y === -Infinity) {
    const ax = x < 0 ? -x : x;
    if (ax === 1) return 1;
    return (ax > 1) === (y > 0) ? Infinity : 0;
  }
  const yi = Math.floor(y) === y;
  if (yi && y <= 64 && y >= -64) { // exact integer powers by squaring
    let n = y < 0 ? -y : y, b = x, r = 1;
    while (n > 0) { if (n & 1) r *= b; b *= b; n >>>= 1; }
    return y < 0 ? 1 / r : r;
  }
  if (x === 0) return y > 0 ? (x === 0 && 1 / x < 0 && yi && Math.floor(y / 2) * 2 !== y ? -0 : 0) : (1 / x < 0 && yi && Math.floor(y / 2) * 2 !== y ? -Infinity : Infinity);
  if (x < 0) {
    if (!yi) return NaN;
    const r = dexp(y * dlog(-x));
    return Math.floor(y / 2) * 2 !== y ? -r : r;
  }
  if (x === Infinity) return y > 0 ? Infinity : 0;
  return dexp(y * dlog(x));
}

/** sqrt(x² + y² + …) with exactly rounded steps (scaled for very large or small values). */
export function dhypot(...v: number[]): number {
  let max = 0, nan = false;
  for (const x of v) {
    const a = x < 0 ? -x : x;
    if (a === Infinity) return Infinity;
    if (a !== a) nan = true;
    else if (a > max) max = a;
  }
  if (nan) return NaN;
  if (max === 0) return 0;
  if (max > 1e150 || max < 1e-150) {
    let s = 0;
    for (const x of v) { const q = x / max; s += q * q; }
    return max * Math.sqrt(s);
  }
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

// ---------------------------------------------------------------------------------------------------------
// switching Math over
// ---------------------------------------------------------------------------------------------------------
type MathFns = Pick<Math, 'sin' | 'cos' | 'atan' | 'atan2' | 'exp' | 'log' | 'log2' | 'pow' | 'hypot'>;
const native: MathFns = { sin: Math.sin, cos: Math.cos, atan: Math.atan, atan2: Math.atan2, exp: Math.exp, log: Math.log, log2: Math.log2, pow: Math.pow, hypot: Math.hypot };
const portable: MathFns = { sin: dsin, cos: dcos, atan: datan, atan2: datan2, exp: dexp, log: dlog, log2: dlog2, pow: dpow, hypot: dhypot };
let depth = 0;

/** Switch Math to the portable functions (nested calls count). */
export function enterPortableMath() {
  if (depth++ === 0) Object.assign(Math, portable);
}
/** Back to the engine's functions once every enter has its exit. */
export function exitPortableMath() {
  if (depth > 0 && --depth === 0) Object.assign(Math, native);
}
export function portableMathOn(): boolean {
  return depth > 0;
}

let gameHold = false;
/** The running game needs portable math (main.ts: multiplayer matches and ranked runs, until the next game). */
export function setGamePortableMath(on: boolean) {
  if (on === gameHold) return;
  gameHold = on;
  if (on) enterPortableMath(); else exitPortableMath();
}

/** Run `fn` with portable math. */
export function withPortableMath<T>(fn: () => T): T {
  enterPortableMath();
  try { return fn(); } finally { exitPortableMath(); }
}
