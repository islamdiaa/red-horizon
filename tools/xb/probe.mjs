// WebGL2 capabilities per browser engine (inside the cross-browser rig, or anywhere Playwright runs):
// renderer string, the extensions the game uses, limits, and whether a half / float colour buffer really renders.
//   node tools/xb/probe.mjs [engines=chromium,firefox,webkit] [url=about:blank]
// Prints one JSON line per engine. RIG_BACKEND picks Chromium's backend (tools/gpu-rig/lib.mjs).
import { launchGpu } from '../gpu-rig/lib.mjs';

const [engArg = 'chromium,firefox,webkit', url = 'about:blank'] = process.argv.slice(2);
const WANT = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'KHR_parallel_shader_compile',
  'EXT_disjoint_timer_query_webgl2', 'WEBGL_lose_context', 'WEBGL_debug_renderer_info', 'EXT_texture_filter_anisotropic',
  'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_etc', 'WEBGL_compressed_texture_astc', 'OVR_multiview2', 'EXT_float_blend'];

export function probeWebgl(want) {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  if (!gl) return { webgl2: false, webgl1: !!document.createElement('canvas').getContext('webgl') };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const all = gl.getSupportedExtensions() || [];
  // render a red quad into an RGBA16F and an RGBA32F target and read it back
  const colourBuffer = (internal, type) => {
    gl.getExtension('EXT_color_buffer_float');
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, 4, 4);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    let read = null;
    if (status === gl.FRAMEBUFFER_COMPLETE) {
      gl.clearColor(2.5, 0.25, -1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const px = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
      read = [...px].map((v) => +v.toFixed(3));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
    return { complete: status === gl.FRAMEBUFFER_COMPLETE, read, err: gl.getError() };
  };
  const prec = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  return {
    webgl2: true,
    vendor: gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
    renderer: gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    has: Object.fromEntries(want.map((n) => [n, all.includes(n)])),
    extCount: all.length,
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    maxVertUniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
    maxFragUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    maxVaryings: gl.getParameter(gl.MAX_VARYING_VECTORS),
    maxTexUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    highFloat: [prec.rangeMin, prec.rangeMax, prec.precision],
    rgba16f: colourBuffer(gl.RGBA16F),
    rgba32f: colourBuffer(gl.RGBA32F),
    dpr: devicePixelRatio,
    ua: navigator.userAgent,
    features: {
      serviceWorker: 'serviceWorker' in navigator, secure: isSecureContext, fullscreen: !!document.documentElement.requestFullscreen,
      pointerLock: !!document.documentElement.requestPointerLock, audioCtx: typeof AudioContext, offscreen: typeof OffscreenCanvas,
      memory: !!performance.memory, gamepad: !!navigator.getGamepads, share: !!navigator.share, wakeLock: !!navigator.wakeLock,
      storagePersist: !!navigator.storage?.persist, workers: typeof Worker, idle: typeof requestIdleCallback,
    },
  };
}

for (const engine of engArg.split(',')) {
  let browser;
  try {
    browser = await launchGpu(undefined, [], engine);
    const page = await browser.newPage();
    if (url !== 'about:blank') await page.goto(url, { waitUntil: 'load' });
    const info = await page.evaluate(probeWebgl, WANT);
    console.log(JSON.stringify({ engine, version: browser.version(), ...info }));
  } catch (e) {
    console.log(JSON.stringify({ engine, fail: String(e).split('\n').slice(0, 3).join(' | ') }));
  }
  await browser?.close();
}
