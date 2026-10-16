"""Allied helipad (2x2): a raised concrete pad with a team edge band, the big white H in a yellow ring,
hazard edges, a blinking edge-light ring ('glow:ring') and blue corner beacons, the control hut (lit windows,
PAD 2 stencil, floodlight, mast), fuel tanks on a cradle and the windsock (animated part 'sock').
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403
from _allied import _imgs  # noqa: E402

ID = 'hpad'
FACTION = 'allies'
KIND = 'structure'


def build(m):
    setup(m, ao_dist=0.3)
    m.set_meta(footprint=(2, 2), height=0.5, radius=1.05)
    r = m.root

    wall = white()
    frm = frame()
    tr = trim()
    rf = roof()
    rail = rail_m()

    box(r, slab_m(0x8d887f), (1.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)
    # ---- the pad: kerb, team band, dark landing surface, markings
    px, pz, ps, ph = -0.04, 0.04, 1.66, 0.07
    box(r, slab_m(0x9a958c, joints=(0.4, 0.4)), (ps, ph, ps), (px, Y0 + ph / 2, pz), bevel=0.022)
    box(r, tr, (ps + 0.012, 0.03, ps + 0.012), (px, Y0 + ph - 0.03, pz), bevel=0.006)
    surf = asphalt(0x45474b)
    box(r, surf, (ps - 0.1, 0.012, ps - 0.1), (px, Y0 + ph + 0.006, pz), bevel=0.003)
    yt = Y0 + ph + 0.012
    m.decal(_pad_img(), at=(px, yt, pz), size=(1.3, 1.3), facing='+y', depth=0.02, team=0, rough=0.6)
    for s in (-1, 1):
        hazard_band(m, r, (px, yt, pz + s * 0.74), (1.5, 0.06), facing='+y')
    for i in range(12):
        a = i / 12 * math.pi * 2
        x, z = px + math.cos(a) * 0.71, pz + math.sin(a) * 0.71
        cyl(r, dark_m(), 0.016, 0.01, (x, yt + 0.005, z), seg=8)
        sphere(r, glow_material('glow:ring', 0xf2f6ff), 0.012, (x, yt + 0.012, z), seg=8, rings=5)
    for (x, z) in ((-0.8, -0.72), (0.72, -0.72), (-0.8, 0.8), (0.72, 0.8)):
        cyl(r, dark_m(), 0.028, 0.04, (x, yt + 0.02, z), r2=0.024, seg=10)
        light(r, (x, yt + 0.04, z), 0.02, 0x40c8ff, 'blink', strength=3.0)

    # ---- control hut (back right) with a mast, floodlight
    cx, cz = 0.78, -0.76
    box(r, wall, (0.34, 0.3, 0.3), (cx, Y0 + 0.15, cz), bevel=0.014)
    box(r, tr, (0.38, 0.035, 0.34), (cx, Y0 + 0.31, cz), bevel=0.008)
    box(r, rf, (0.33, 0.02, 0.29), (cx, Y0 + 0.335, cz))
    glazing(m, r, (cx, Y0 + 0.2, cz + 0.154), (0.24, 0.09), 2, lit={0, 1}, color=WIN_COOL, emit=0.9)
    stencil(m, r, 'PAD 2', (cx + 0.172, Y0 + 0.16, cz), 0.05, facing='+x', color=0x2a2e34, depth=0.02)
    cyl(r, dark_m(), 0.009, 0.42, (cx + 0.08, Y0 + 0.345 + 0.21, cz - 0.06), r2=0.004, seg=6)
    for k in range(3):
        bar(r, dark_m(), (cx + 0.08 - 0.04, Y0 + 0.5 + k * 0.08, cz - 0.06), (cx + 0.08 + 0.04, Y0 + 0.5 + k * 0.08, cz - 0.06), 0.005)
    light(r, (cx + 0.08, Y0 + 0.77, cz - 0.06), 0.012, 0xff2a1a, 'blink')
    floodlight(r, (cx - 0.12, Y0 + 0.36, cz + 0.13), yaw=-0.6, pitch=0.9, s=0.05)
    strobe(r, (cx - 0.15, Y0 + 0.36, cz - 0.13), r=0.012)

    # ---- fuel tanks on a cradle (back left), pipe to the pad
    box(r, dark_m(), (0.4, 0.03, 0.3), (-0.86, Y0 + 0.015, -0.57))
    for z in (-0.66, -0.48):
        tank = white(panels=None)
        cyl(r, tank, 0.075, 0.34, (-0.86, Y0 + 0.11, z), (0, 0, math.pi / 2), seg=14)
        for xx in (-1.03, -0.69):
            sphere(r, tank, 0.075, (xx, Y0 + 0.11, z), seg=12, rings=6, scale=(0.4, 1, 1))
        cyl(r, tr, 0.078, 0.03, (-0.86, Y0 + 0.11, z), (0, 0, math.pi / 2), seg=14, caps=False)
        for xx in (-0.98, -0.74):
            box(r, frm, (0.03, 0.06, 0.12), (xx, Y0 + 0.03, z))
    stencil(m, r, 'AVGAS', (-0.86, Y0 + 0.11, -0.48 + 0.077), 0.035, color=0xd8231a, depth=0.02)
    pipe_run(r, steel(0x8d99a6, panels=None), [(-0.68, Y0 + 0.1, -0.57), (-0.6, Y0 + 0.1, -0.57), (-0.6, Y0 + 0.02, -0.4)], 0.015)

    # ---- windsock mast + the sock
    cyl(r, painted(0xe0ddd4, panels=None, wear=0.4), 0.009, 0.42, (0.86, Y0 + 0.21, 0.86), r2=0.007, seg=8)
    cyl(r, frm, 0.03, 0.03, (0.86, Y0 + 0.015, 0.86), seg=8)
    sk = m.part('sock', at=(0.86, 0.44, 0.86))
    red = painted(0xd02a1c, panels=None, wear=0.3, rough=0.85, metal=0.0)
    wh = painted(0xe8e4da, panels=None, wear=0.3, rough=0.85, metal=0.0)
    for k, (x0, x1, mat) in enumerate(((0.0, 0.05, red), (0.05, 0.1, wh), (0.1, 0.15, red))):
        r0 = 0.035 - 0.017 * (x0 / 0.15)
        r1 = 0.035 - 0.017 * (x1 / 0.15)
        cyl(sk, mat, r0, x1 - x0, ((x0 + x1) / 2 + 0.01, -0.01 * k, 0), (0, 0, -math.pi / 2 - 0.12), r2=r1, seg=8, caps=False)
    cyl(sk, dark_m(), 0.037, 0.006, (0.008, 0.0, 0), (0, 0, -math.pi / 2), seg=8, caps=False)

    # ---- gear by the hut
    crates(r, (0.5, Y0, -0.82), 2, 0.08)
    drums(r, (0.84, Y0, -0.36), 3)


def _pad_img():
    """Landing marking: yellow ring, a big white H, a small white star (transparent elsewhere)."""
    from kit import decals as _D
    if 'padmark' in _imgs:
        return _imgs['padmark']
    px = 512
    cv = _D.Canvas(px, px, ss=2)
    c = px / 2
    cv.circle(c, c, px * 0.49, _D.lin(HAZ_Y), r_in=px * 0.43)
    w = _D.lin(WHITE_TXT)
    cv.rect(c - px * 0.2, c - px * 0.24, c - px * 0.12, c + px * 0.24, w)
    cv.rect(c + px * 0.12, c - px * 0.24, c + px * 0.2, c + px * 0.24, w)
    cv.rect(c - px * 0.12, c - px * 0.04, c + px * 0.12, c + px * 0.04, w)
    pts = _D.star_points(c, c - px * 0.34, px * 0.05)
    tris = [((c, c - px * 0.34), pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
    cv.fill(cv.cover(tris), w, 1.0)
    cv.roughen(0.3, seed=21)
    _imgs['padmark'] = cv.image()
    return _imgs['padmark']
