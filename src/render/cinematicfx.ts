import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Cinematic lens: camera motion blur and depth of field in one full-resolution pass, active only while a
 * cinematic or photo mode asks for it (zero cost otherwise: the pass is skipped).
 *
 *  - Motion blur: every pixel's world position (scene depth) is reprojected into last frame's view; the
 *    screen-space velocity, scaled by the shutter, smears the image along the camera motion.
 *  - Depth of field: a 40-tap golden-angle gather whose disc follows the circle of confusion of each pixel
 *    (thin-lens CoC from view depth). Samples only count when their own CoC reaches the centre (sharp
 *    foreground never bleeds into the blurred background; blurred foreground does spill over the subject),
 *    and bright samples weigh more, so highlights open into bokeh discs.
 *
 * `focus` is a world-space distance from the camera; `autoFocus` 1 focuses on whatever is at the screen centre.
 */
export class CinematicPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private prevViewProj = new THREE.Matrix4();
  private hasPrev = false;
  inputSource: (() => THREE.Texture | null) | null = null;
  depthSource: (() => THREE.Texture | null) | null = null;
  /** 0..1 lens opening (0 = no depth of field). */
  aperture = 0;
  /** Focus distance (world units) when autoFocus is 0. */
  focus = 25;
  /** 0..1: focus on the screen centre instead of `focus`. */
  autoFocus = 1;
  /** 0..1 shutter (fraction of the frame's motion that is smeared). */
  shutter = 0;
  /** Set while warming up shaders: render even when nothing is active. */
  force = false;

  constructor(private camera: THREE.PerspectiveCamera) {
    super();
    this.material = new THREE.ShaderMaterial({
      name: 'cinematic-lens',
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uPrevViewProj: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uAperture: { value: 0 },
        uFocus: { value: 25 },
        uAutoFocus: { value: 1 },
        uShutter: { value: 0 },
        uMaxCoC: { value: 14 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tDepth;
        uniform mat4 uProjInv, uCamWorld, uPrevViewProj;
        uniform vec2 uTexel;
        uniform float uAperture, uFocus, uAutoFocus, uShutter, uMaxCoC;
        varying vec2 vUv;
        float viewDist(vec2 uv) {
          vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).x * 2.0 - 1.0, 1.0);
          return length(v.xyz / v.w);
        }
        void main() {
          vec3 base = texture2D(tColor, vUv).rgb;
          // camera motion: reproject into last frame
          vec2 vel = vec2(0.0);
          if (uShutter > 0.0) {
            float d = texture2D(tDepth, vUv).x;
            vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
            vec3 w = (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
            vec4 pc = uPrevViewProj * vec4(w, 1.0);
            vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
            vel = (vUv - puv) * uShutter;
            float vl = length(vel);
            if (vl > 0.06) vel *= 0.06 / vl;
          }
          if (uAperture <= 0.0) {
            if (uShutter <= 0.0) { gl_FragColor = vec4(base, 1.0); return; }
            // 16 taps along the motion, offset per pixel (noise instead of discrete copies; TAA smooths it)
            float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            vec3 acc = vec3(0.0);
            for (int i = 0; i < 16; i++) acc += texture2D(tColor, vUv - vel * ((float(i) + jit) / 16.0 - 0.5)).rgb;
            gl_FragColor = vec4(acc / 16.0, 1.0);
            return;
          }
          float focus = mix(uFocus, viewDist(vec2(0.5)), uAutoFocus);
          // circle of confusion in pixels (thin lens, scaled to the screen height)
          float z0 = viewDist(vUv);
          float scale = uAperture * uMaxCoC;
          float c0 = clamp(abs(z0 - focus) / max(z0, 0.5) * scale * 5.0, 0.0, uMaxCoC);
          vec3 acc = base;
          float wsum = 1.0;
          const int N = 40;
          for (int i = 0; i < N; i++) {
            float fi = float(i) + 0.5;
            float r = sqrt(fi / float(N)) * uMaxCoC;
            float a = fi * 2.39996323;
            vec2 o = vec2(cos(a), sin(a)) * r;
            vec2 suv = vUv + o * uTexel - vel * (fi / float(N) - 0.5);
            vec3 col = texture2D(tColor, suv).rgb;
            float zi = viewDist(suv);
            float ci = clamp(abs(zi - focus) / max(zi, 0.5) * scale * 5.0, 0.0, uMaxCoC);
            // a sample reaches the centre if its own disc covers the distance; behind the subject it is
            // limited by the centre's CoC (sharp subject edges stay sharp)
            float reach = zi < z0 ? ci : min(ci, c0);
            float w = smoothstep(r - 1.5, r + 0.5, reach);
            float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
            w *= 1.0 + min(l * l, 8.0) * 0.4;
            acc += col * w;
            wsum += w;
          }
          gl_FragColor = vec4(acc / wsum, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  get active(): boolean {
    return this.aperture > 0.001 || this.shutter > 0.001;
  }

  setSize(w: number, h: number) {
    this.material.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.material.uniforms.uMaxCoC.value = Math.max(6, Math.round(20 * (h / 1080)));
  }

  /** Remember the camera of this frame (call after rendering every frame, active or not). */
  endFrame() {
    this.prevViewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.hasPrev = true;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.tColor.value = this.inputSource?.() ?? readBuffer.texture;
    u.tDepth.value = this.depthSource?.() ?? null;
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(this.camera.matrixWorld);
    u.uPrevViewProj.value.copy(this.prevViewProj);
    u.uAperture.value = this.force ? Math.max(this.aperture, 0.5) : this.aperture;
    u.uFocus.value = this.focus;
    u.uAutoFocus.value = this.autoFocus;
    u.uShutter.value = this.hasPrev ? this.shutter : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Rain on the lens: in the rain, the camera of a cinematic moment (mission intro, nuke cam, finale,
// flourish) and photo mode collects drops on its lens. Never in normal play, never on Low.

/**
 * How much rain the lens should hold (pure; tests): the rain level during a cinematic moment or photo mode on
 * medium / high, otherwise 0.
 */
export function lensRainTarget(o: { quality: 'low' | 'medium' | 'high'; moment: boolean; rain: number }): number {
  if (o.quality === 'low' || !o.moment || !(o.rain > 0.02)) return 0;
  return Math.min(1, o.rain);
}

/**
 * Ease the lens rain towards `target`: drops gather over ~1.5 s, dry over ~3 s while the moment lasts, and are
 * gone within half a second once it ends (so none linger into normal play).
 */
export function stepLensRain(cur: number, target: number, dt: number, moment: boolean): number {
  const d = Math.max(0, Math.min(0.25, dt));
  if (target > cur) return Math.min(target, cur + d * 0.7);
  const rate = moment ? 0.35 : 2.2;
  return Math.max(target, cur - d * rate);
}

/**
 * Final-pass GLSL (renderer.ts, DISTORT): `lensRain(uv)` returns the screen offset (xy) the drops bend the
 * image by, a rim darkening (z) and a sky glint (w). `uLens` = (amount 0..1, time s, 1 = drops run down
 * (0 with reduced motion), aspect width / height).
 *
 * Two layers of beads sit on the glass (each a tiny lens: the scene behind it shows upside down and shrunk,
 * with a dark rim and a glint on top; they condense, sit a while and evaporate), and runners: heavier drops
 * that lurch down the glass in stick-slip steps, leaving a wet trail with beads behind them.
 */
export const LENS_RAIN_GLSL = /* glsl */ `
uniform vec4 uLens;
float lr_hash(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}
// one bead per cell (where the rain has put one): offset (p units), rim, glint; inside = 1 when covered
vec4 lr_beads(vec2 p, float cells, float amt, float t, float seed, out float inside) {
  inside = 0.0;
  vec2 g = p * cells;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h1 = lr_hash(id + seed), h2 = lr_hash(id + seed + 7.31), h3 = lr_hash(id + seed + 3.17);
  if (h1 > amt) return vec4(0.0);
  // condenses quickly, sits, then slowly evaporates
  float life = 4.0 + 10.0 * h2;
  float ph = fract(t / life + h3);
  float r = (0.14 + 0.22 * h2) * smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.72, 1.0, ph));
  if (r < 0.03) return vec4(0.0);
  vec2 c = (vec2(h3, h1 / max(amt, 1e-3)) - 0.5) * (1.0 - 2.4 * r);
  vec2 d = f - c;
  // not a perfect circle: water sags (fuller below) and the edge wobbles a little
  vec2 e = vec2(d.x, d.y * (d.y > 0.0 ? 1.12 : 0.92));
  float wob = 1.0 + 0.1 * sin(atan(e.y, e.x) * 3.0 + h2 * 6.28) * step(0.5, fract(h3 * 13.0));
  float k = length(e) / (r * wob);
  if (k >= 1.0) return vec4(0.0);
  // soft (anti-aliased) edge
  inside = smoothstep(1.0, 0.88, k);
  float cap = sqrt(1.0 - k * k);
  // a little lens: the image behind it, upside down and shrunk
  vec2 off = -d * (1.0 + 2.2 * cap) / cells;
  float glint = smoothstep(0.3, 0.0, length(d / r - vec2(-0.32, 0.4))) * cap * smoothstep(0.12, 0.25, r);
  return vec4(off, smoothstep(0.75, 0.97, k) * 0.6, glint) * inside;
}
// heavier drops running down the glass (one per column at most), with a beaded wet trail
vec4 lr_runner(vec2 p, float cols, float amt, float t, out float inside) {
  inside = 0.0;
  float cx = floor(p.x * cols);
  float h1 = lr_hash(vec2(cx, 1.7)), h2 = lr_hash(vec2(cx, 9.1)), h3 = lr_hash(vec2(cx, 4.3));
  if (h1 > amt * 0.7) return vec4(0.0);
  float period = 2.5 + 4.0 * h2;
  float tt = t + h3 * period;
  float cyc = floor(tt / period), ph = fract(tt / period);
  float hc = lr_hash(vec2(cx, cyc + 0.5));
  // stick-slip: it holds, then lurches down, five times per run
  float s = ph * 5.0;
  float slide = (floor(s) + smoothstep(0.35, 1.0, fract(s))) / 5.0;
  float y0 = 1.05 - 0.45 * hc;
  float y = y0 - slide * (0.9 + 0.5 * hc);
  float lx = (fract(p.x * cols) - 0.5) / cols;
  float x = (hc - 0.5) * 0.45 / cols + 0.05 / cols * sin(p.y * 17.0 + hc * 6.3);
  float r = (0.24 + 0.12 * h2) / cols;
  vec2 d = vec2(lx - x, p.y - y);
  d.y *= d.y > 0.0 ? 0.6 : 1.0; // a tear: longer above
  float k = length(d) / r;
  if (k < 1.0) {
    inside = smoothstep(1.0, 0.88, k);
    float cap = sqrt(1.0 - k * k);
    return vec4(-d * (1.0 + 2.0 * cap), smoothstep(0.75, 0.97, k) * 0.6, smoothstep(0.3, 0.0, length(d / r - vec2(-0.3, 0.35))) * cap) * inside;
  }
  float above = p.y - y;
  if (above <= 0.0 || above > y0 - y + 0.02) return vec4(0.0);
  float fade = 1.0 - smoothstep(0.0, 0.4, above);
  // beads left behind along the trail
  float seg = 0.032;
  float hb = lr_hash(vec2(cx * 3.1 + floor(above / seg), cyc));
  vec2 bd = vec2(lx - x, mod(above, seg) - seg * 0.5);
  float br = r * (0.22 + 0.2 * hb) * step(hb, 0.5 * fade + 0.1);
  float bk = br > 0.0 ? length(bd) / br : 2.0;
  if (bk < 1.0) {
    inside = smoothstep(1.0, 0.85, bk);
    float bc = sqrt(1.0 - bk * bk);
    return vec4(-bd * (1.0 + 2.0 * bc), smoothstep(0.7, 0.97, bk) * 0.5, 0.0) * inside;
  }
  // the wet streak itself: a faint, narrow lens
  float tw = r * 0.32 * fade;
  float tx = lx - x;
  if (abs(tx) < tw) {
    inside = 1.0;
    float q = tx / tw;
    return vec4(vec2(-tx * 1.5, 0.0), 0.25 * fade * q * q, 0.0);
  }
  return vec4(0.0);
}
vec4 lensRain(vec2 uv) {
  float amt = uLens.x;
  vec2 p = uv * vec2(uLens.w, 1.0);
  float t = uLens.y;
  vec4 res = vec4(0.0);
  float ins;
  // fine droplets, a few big drops over them, runners on top (each layer covers the ones below)
  vec4 f = lr_beads(p, 34.0, amt * 0.45, t, 0.0, ins);
  res = mix(res, f / max(ins, 1e-3), ins);
  f = lr_beads(p + 0.37, 13.0, amt * 0.26, t * 0.8, 11.0, ins);
  res = mix(res, f / max(ins, 1e-3), ins);
  if (uLens.z > 0.5) {
    f = lr_runner(p, 11.0, amt, t, ins);
    res = mix(res, f / max(ins, 1e-3), ins);
  }
  res.xy *= vec2(1.0 / uLens.w, 1.0);
  return res;
}
`;

// ---------------------------------------------------------------------------------------------
// Battle flourishes: a moment of slow motion under letterbox bars and a shallow lens when a
// superweapon lands on screen or an enemy's last structure falls. Never in normal combat, never with
// reduceMotion, never while another cinematic owns the screen. The player keeps full control.

const FLOURISH_CSS = `
.jf-bar { position: fixed; left: 0; right: 0; height: 7vh; background: #000; z-index: 37; pointer-events: none; transition: transform 0.45s cubic-bezier(.6,0,.2,1); }
.jf-bar.top { top: 0; transform: translateY(-100%); }
.jf-bar.bottom { bottom: 0; transform: translateY(100%); }
.jf-on .jf-bar { transform: none; }
`;

/** What a flourish needs from the game (structural: Game satisfies it). */
export interface FlourishHost {
  speed: number;
  readonly gfx: { cinematicDof: number; cinematicBlur: number };
}

export class Flourish {
  private bars: HTMLElement[] = [];
  private timers: number[] = [];
  private raf = 0;
  private active = false;
  private setSpeed = -1;
  private savedSpeed = 1;
  private lastAt = -1e9;

  constructor(private host: FlourishHost) {}

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Play a flourish for `seconds` of real time with the game slowed to `slow` × its speed. Returns false when
   * it was skipped (cooldown, another cinematic running, or already active).
   */
  play(seconds = 1.6, slow = 0.4, cooldown = 25): boolean {
    const now = performance.now() / 1000;
    if (this.active || now - this.lastAt < cooldown) return false;
    if (typeof document === 'undefined') return false;
    const body = document.body;
    if (body.classList.contains('cine-on') || body.classList.contains('cine-active')) return false;
    this.lastAt = now;
    this.active = true;
    if (!document.getElementById('jf-style')) {
      const st = document.createElement('style');
      st.id = 'jf-style';
      st.textContent = FLOURISH_CSS;
      document.head.appendChild(st);
    }
    const top = document.createElement('div');
    top.className = 'jf-bar top';
    const bottom = document.createElement('div');
    bottom.className = 'jf-bar bottom';
    body.append(top, bottom);
    this.bars = [top, bottom];
    requestAnimationFrame(() => body.classList.add('jf-on'));
    const h = this.host;
    this.savedSpeed = h.speed;
    this.setSpeed = Math.max(0.15, h.speed * slow);
    h.speed = this.setSpeed;
    this.lens(0.4, 0.2, 0.25);
    this.timers.push(window.setTimeout(() => this.end(true), seconds * 1000));
    return true;
  }

  /** End now. `restore` = put the game speed back (unless the player / another system changed it meanwhile). */
  end(restore: boolean): void {
    if (!this.active) return;
    this.active = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    const h = this.host;
    if (restore && Math.abs(h.speed - this.setSpeed) < 1e-9) h.speed = this.savedSpeed;
    this.setSpeed = -1;
    this.lens(0, 0, 0.6);
    document.body.classList.remove('jf-on');
    const bars = this.bars;
    this.bars = [];
    window.setTimeout(() => bars.forEach((b) => b.remove()), 500);
  }

  private lens(dof: number, blur: number, seconds: number): void {
    cancelAnimationFrame(this.raf);
    const g = this.host.gfx;
    const d0 = g.cinematicDof, b0 = g.cinematicBlur, t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / Math.max(1, seconds * 1000));
      const e = k * k * (3 - 2 * k);
      g.cinematicDof = d0 + (dof - d0) * e;
      g.cinematicBlur = b0 + (blur - b0) * e;
      if (k < 1) this.raf = requestAnimationFrame(step);
    };
    step();
  }

  dispose(): void {
    this.end(false);
    cancelAnimationFrame(this.raf);
  }
}
