// Prints the WebGL renderer for several Chromium GPU flag sets (inside the rig container).
import { chromium } from 'playwright-core';
const sets = {
  'angle-gl-egl': ['--use-gl=angle', '--use-angle=gl-egl'],
  'angle-vulkan': ['--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan'],
  'angle-gl': ['--use-angle=gl'],
  'egl': ['--use-gl=egl'],
};
const only = process.argv[2];
for (const [name, flags] of Object.entries(sets)) {
  if (only && only !== name) continue;
  let browser;
  try {
    browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu', '--headless=new', ...flags] });
    const page = await browser.newPage();
    const info = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return 'no webgl2';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return [gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR), gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        'exts:' + gl.getSupportedExtensions().filter((e) => /float|timer|lose|parallel/.test(e)).join(',')].join(' | ');
    });
    console.log(name.padEnd(14), info);
  } catch (e) { console.log(name.padEnd(14), 'FAILED', String(e).split('\n')[0]); }
  await browser?.close();
}
