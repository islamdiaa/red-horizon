"""Bake terrain materials (run by tools/assets/terrain/build.mjs inside headless Blender, which brings numpy and a
JPEG decoder):

    blender -b --factory-startup --python tools/assets/terrain/bake.py -- job.json

job.json: {size, cache, out, materials: {name: {src, flatten, ao, rough, nstr}}}. Writes <out>/<name>.albedo.png
(RGB, sRGB) and <out>/<name>.nrm.png (RGBA: normal X, normal Y, height, 128 + 127 x roughness) and prints one
'RH_TERRAIN {json}' line per material.
"""
import json
import os
import struct
import sys
import zlib

import bpy
import numpy as np


def load(path, noncolor):
    img = bpy.data.images.load(path)
    if noncolor:
        img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    # Blender stores rows bottom-up: flip to file order (top row first)
    return a.reshape(h, w, 4)[::-1].copy()


def down(a, size):
    h, w = a.shape[:2]
    f = w // size
    if f <= 1:
        return a
    return a[:size * f, :size * f].reshape(size, f, size, f, -1).mean(axis=(1, 3))


def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def box_wrap(a, r):
    """Box blur with wrap-around (tileable), radius r texels, along both axes."""
    for axis in (0, 1):
        n = a.shape[axis]
        c = np.cumsum(np.concatenate([np.take(a, range(n - r - 1, n), axis=axis), a, np.take(a, range(0, r), axis=axis)], axis=axis), axis=axis)
        hi = np.take(c, range(2 * r + 1, n + 2 * r + 1), axis=axis)
        lo = np.take(c, range(0, n), axis=axis)
        a = (hi - lo) / (2 * r + 1)
    return a


def blur(a, r):
    for _ in range(3):
        a = box_wrap(a, r)
    return a


def write_png(path, arr):
    """arr: (h, w, c) uint8, top row first; c = 3 (RGB) or 4 (RGBA)."""
    h, w, c = arr.shape
    raw = b''.join(b'\x00' + arr[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6 if c == 4 else 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def u8(x):
    return np.clip(np.round(x * 255.0), 0, 255).astype(np.uint8)


def bake(name, m, size, cache, out):
    d = os.path.join(cache, m['src'])
    alb = to_lin(down(load(os.path.join(d, 'diffuse.jpg'), False)[..., :3], size))
    nrm = down(load(os.path.join(d, 'normal.jpg'), True)[..., :3], size)
    arm = down(load(os.path.join(d, 'arm.jpg'), True)[..., :3], size)
    disp = down(load(os.path.join(d, 'disp.jpg'), True)[..., :1], size)[..., 0]

    # albedo: fold in crevice AO, then flatten the large-scale lighting / tone drift (it shows as a repeating
    # pattern when the texture tiles across a whole map)
    ao = arm[..., 0]
    alb = alb * (1.0 - m.get('ao', 0.5) * (1.0 - ao))[..., None]
    lum = alb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    big = blur(lum, max(4, size // 12))
    ratio = np.clip(lum.mean() / np.maximum(big, 1e-4), 0.5, 2.0) ** m.get('flatten', 0.5)
    alb = alb * ratio[..., None]
    avg = to_srgb(alb.reshape(-1, 3).mean(axis=0)).tolist()

    # normal (OpenGL convention, as on disk): renormalise after the downsample, optional strength
    n = nrm * 2.0 - 1.0
    k = m.get('nstr', 1.0)
    n[..., 0] *= k
    n[..., 1] *= k
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    # height: robust 1..99 % range -> 0..1
    lo, hi = np.percentile(disp, 1), np.percentile(disp, 99)
    hgt = np.clip((disp - lo) / max(hi - lo, 1e-4), 0.0, 1.0)
    # roughness remapped into the material's range, stored as 128 + 127 r (alpha never below 0.5: decoders that go
    # through a premultiplied canvas keep the colour channels intact)
    r0, r1 = m.get('rough', (0.6, 1.0))
    rough = r0 + (r1 - r0) * np.clip(arm[..., 1], 0.0, 1.0)

    write_png(os.path.join(out, f'{name}.albedo.png'), u8(to_srgb(alb)))
    packed = np.stack([n[..., 0] * 0.5 + 0.5, n[..., 1] * 0.5 + 0.5, hgt, (128.0 + 127.0 * rough) / 255.0], axis=-1)
    write_png(os.path.join(out, f'{name}.nrm.png'), u8(packed))
    print('RH_TERRAIN ' + json.dumps({'name': name, 'avg': [round(v, 4) for v in avg], 'rough': [round(float(rough.min()), 3), round(float(rough.max()), 3)]}), flush=True)


def main():
    job = json.load(open(sys.argv[sys.argv.index('--') + 1]))
    for name, m in job['materials'].items():
        bake(name, m, job['size'], job['cache'], job['out'])


try:
    main()
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(1)
