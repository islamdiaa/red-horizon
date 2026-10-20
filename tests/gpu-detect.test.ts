// Quality auto-detection for Intel integrated GPUs: Mesa names recent ones by codename, without "UHD" or "Iris";
// the desktop UHD 7x0 parts are too slow for Medium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGpu } from '../src/platform/gpu.ts';

const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

test('Intel integrated GPUs: Mesa codenames and the desktop UHD 7x0', () => {
  const cases: [string, string][] = [
    // desktop UHD 770 (measured on the real-GPU rig: about 17 FPS on Low at 1920x1080 in a 150-unit battle)
    ['ANGLE (Intel, Mesa Intel(R) Graphics (RPL-S), OpenGL ES 3.2)', 'low'],
    ['ANGLE (Intel, Vulkan 1.4.335 (Intel(R) Graphics (RPL-S) (0x0000A780)), Intel open-source Mesa driver)', 'low'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 770 (0x0000A780) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low'],
    ['ANGLE (Intel, Mesa Intel(R) Graphics (RPL-P), OpenGL 4.6)', 'medium'],
    ['ANGLE (Intel, Mesa Intel(R) Graphics (ADL GT2), OpenGL 4.6)', 'medium'],
    ['ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL 4.6)', 'medium'],
    ['ANGLE (Intel, Mesa Intel(R) Graphics (MTL), OpenGL 4.6)', 'medium'],
    ['ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)', 'medium'],
    ['ANGLE (Intel, Mesa Intel(R) HD Graphics 520 (SKL GT2), OpenGL 4.6)', 'low'],
    ['ANGLE (Intel, Mesa Intel(R) UHD Graphics (JSL), OpenGL 4.6)', 'medium'],
    ['ANGLE (Intel, Mesa Intel(R) Graphics (JSL), OpenGL 4.6)', 'low'],
  ];
  for (const [r, want] of cases) {
    const c = classifyGpu(r, LINUX);
    assert.equal(c.tier, 'integrated', `${r}: ${c.reason}`);
    assert.equal(c.baseline, want, `${r}: ${c.reason}`);
  }
});
