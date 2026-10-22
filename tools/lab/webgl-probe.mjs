// WebGL flag matrix: which browser flags/prefs give WebGL2, and on which backend (the unmasked
// renderer string). Meant for the GPU-less lab VMs, where Windows only has Direct3D 11 WARP
// (the "Microsoft Basic Render Driver") and Linux only has SwiftShader / llvmpipe.
//   tools/lab/lab.sh run <vm> tools/lab/webgl-probe.mjs [browsers]
//   (Windows: also LAB_DESKTOP=1 to run headed in the signed-in desktop session)
// Writes $OUT_DIR/webgl-probe.json and prints one JSON line per combination.
import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUT_DIR ?? 'out';
const win = process.platform === 'win32';
const headless = process.env.HEADED !== '1';
const which = (process.argv[2] ?? (win ? 'chrome,msedge,chromium,firefox,moz-firefox' : 'chromium,chrome,firefox,moz-firefox,webkit')).split(',');
fs.mkdirSync(OUT, { recursive: true });

const chromeFlagSets = win ? [
  [],
  ['--ignore-gpu-blocklist'],
  ['--use-angle=d3d11'],
  ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
  ['--use-angle=d3d11-warp'],
  ['--use-angle=d3d11-warp', '--ignore-gpu-blocklist'],
  ['--use-gl=angle', '--use-angle=d3d11-warp', '--ignore-gpu-blocklist'],
  ['--enable-unsafe-swiftshader'],
  ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
] : [
  [],
  ['--ignore-gpu-blocklist'],
  ['--enable-unsafe-swiftshader'],
  ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  ['--use-angle=gl', '--ignore-gpu-blocklist'],
];
const firefoxPrefSets = win ? [
  {},
  { 'webgl.force-enabled': true },
  { 'webgl.force-enabled': true, 'webgl.angle.force-warp': true },
  { 'webgl.force-enabled': true, 'webgl.angle.force-warp': true, 'layers.d3d11.force-warp': true },
] : [
  {},
  { 'webgl.force-enabled': true },
];

const probe = () => {
  const out = {};
  for (const kind of ['webgl2', 'webgl']) {
    let gl = null;
    try { gl = document.createElement('canvas').getContext(kind); } catch { /* reported as null */ }
    if (!gl) { out[kind] = null; continue; }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    out[kind] = {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      shading: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      floatRT: !!gl.getExtension('EXT_color_buffer_float'),
      parallelCompile: !!gl.getExtension('KHR_parallel_shader_compile'),
    };
  }
  return out;
};

// chrome://gpu "Graphics Feature Status" and the GL_RENDERER line (Chromium family only).
async function chromeGpuPage(browser) {
  try {
    const page = await browser.newPage();
    await page.goto('chrome://gpu', { timeout: 30000 });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => {
      const root = document.querySelector('info-view')?.shadowRoot;
      return root ? [...root.children].map((e) => e.innerText ?? '').join('\n') : document.body.innerText;
    });
    await page.close();
    const pick = (re) => text.match(re)?.[1]?.trim().slice(0, 200);
    return {
      webgl: pick(/WebGL:\s*([^\n]+)/), webgl2: pick(/WebGL2:\s*([^\n]+)/), gpuCompositing: pick(/Compositing:\s*([^\n]+)/),
      glRenderer: pick(/GL_RENDERER\s+([^\n]+)/), angleBackend: pick(/displayType\s+([^\n]+)/),
    };
  } catch (e) {
    return { error: String(e.message ?? e).split('\n')[0] };
  }
}

async function one(name, launch, variant, isChromium) {
  const r = { browser: name, variant, headless };
  let browser;
  try {
    browser = await launch();
    r.version = browser.version();
    const page = await browser.newPage();
    await page.goto('data:text/html,<title>probe</title>');
    r.gl = await page.evaluate(probe);
    if (isChromium) r.chromeGpu = await chromeGpuPage(browser);
  } catch (e) {
    r.failure = String(e?.message ?? e).split('\n')[0];
  } finally {
    await browser?.close().catch(() => {});
  }
  console.log(JSON.stringify(r));
  return r;
}

const results = [];
for (const name of which) {
  if (['chrome', 'msedge', 'chromium'].includes(name)) {
    for (const args of chromeFlagSets) {
      const channel = name === 'chromium' ? undefined : name;
      results.push(await one(name, () => chromium.launch({ headless, channel, args }), args.join(' ') || '(none)', true));
    }
  } else if (name === 'firefox' || name === 'moz-firefox') {
    for (const prefs of firefoxPrefSets) {
      // -wait-for-browser: on Windows the stock firefox.exe is a launcher that hands off and exits.
      const extra = name === 'moz-firefox' ? { channel: 'moz-firefox', args: win ? ['-wait-for-browser'] : [], ...(win ? {} : { executablePath: '/usr/bin/firefox' }) } : {};
      results.push(await one(name, () => firefox.launch({ headless, firefoxUserPrefs: prefs, ...extra }), JSON.stringify(prefs), false));
    }
  } else if (name === 'webkit') {
    results.push(await one(name, () => webkit.launch({ headless }), '(none)', false));
  }
}
fs.writeFileSync(path.join(OUT, `webgl-probe-${headless ? 'headless' : 'headed'}.json`), JSON.stringify({ platform: process.platform, headless, results }, null, 2));
