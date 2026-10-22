// Shared helpers for the real-GPU rig (runs inside the red-horizon-gpu-rig container, see README.md).
import { chromium, firefox, webkit } from 'playwright-core';

/** Chromium flags per GPU backend. Both use the host's Mesa driver through ANGLE. */
export const BACKENDS = {
  gl: ['--use-gl=angle', '--use-angle=gl-egl'],
  vulkan: ['--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};

/**
 * Firefox preferences for the rig: WebGL without the driver blocklist, WebRender, and autoplay allowed like
 * Chromium's flag below. Only the cross-browser image (Dockerfile.xb) ships Firefox and WebKit.
 */
export const FIREFOX_PREFS = {
  'webgl.force-enabled': true,
  'gfx.webrender.all': true,
  'media.autoplay.default': 0,
  'media.autoplay.blocking_policy': 0,
};

/**
 * Launch the browser under test. RIG_ENGINE=chromium (default), firefox or webkit; RIG_BACKEND picks Chromium's GPU
 * backend. `extra` is extra Chromium flags (ignored by the other engines). Headless Firefox has no WebGL in a container
 * and headless WebKit renders WebGL in software, so those two run headful on a display server when XB_HEADFUL=1
 * (tools/xb/rig.sh with XB_DISPLAY=weston: Wayland clients on the GPU). Chromium stays headless (ANGLE on the GPU).
 */
export async function launchGpu(backend = process.env.RIG_BACKEND ?? 'gl', extra = [], engine = process.env.RIG_ENGINE ?? 'chromium', { autoplay = true } = {}) {
  const headless = !process.env.XB_HEADFUL;
  // autoplay: false keeps each browser's own autoplay policy (audio needs a user gesture), as players have it
  const prefs = { ...FIREFOX_PREFS };
  if (!autoplay) { delete prefs['media.autoplay.default']; delete prefs['media.autoplay.blocking_policy']; }
  if (engine === 'firefox') return firefox.launch({ headless, firefoxUserPrefs: prefs });
  if (engine === 'webkit') return webkit.launch({ headless });
  // under the Wayland display server headless Chromium's GPU process falls back to SwiftShader: hide the display
  const env = { ...process.env };
  delete env.WAYLAND_DISPLAY;
  delete env.XDG_RUNTIME_DIR;
  return chromium.launch({
    args: ['--headless=new', '--ignore-gpu-blocklist', '--enable-gpu', ...(autoplay ? ['--autoplay-policy=no-user-gesture-required'] : []), ...(BACKENDS[backend] ?? BACKENDS.gl), ...extra],
    env,
  });
}

export { maskExtensionsScript, installProbe, setupBattle, openMatch } from '../xb/probe-core.mjs';
