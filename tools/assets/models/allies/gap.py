"""Allied gap generator (1x2): on the back cell an octagonal generator base and a tapered lattice tower
(team hoops) with a glowing conduit ('glow:gapc') up to the emitter cage, the purple orb ('glow:gap') and two
rotating rings (parts tower > ringA / ringB; the procedural haze effect is kept); on the front cell the white
transformer annex with cooling fins, insulators, GAP 1 roof lettering and a floodlight.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'gap'
FACTION = 'allies'
KIND = 'structure'

PURPLE = 0xb050ff


def torus(p, mat, R, t, at=(0, 0, 0), rot=None, seg=20, tseg=5):
    prof = [(R + t * math.cos(2 * math.pi * k / tseg), t * math.sin(2 * math.pi * k / tseg)) for k in range(tseg + 1)]
    return lathe(p, mat, prof, at, seg=seg, rot=rot, cap_top=False, cap_bottom=False)


def build(m):
    setup(m, ao_dist=0.3)
    m.set_meta(footprint=(1, 2), height=1.3, radius=0.8, keep=['fx:add:b050ff:1'])
    r = m.root

    wall = white()
    wall2 = offwhite()
    frm = frame()
    tr = trim()
    rf = roof()
    lat = steel(0x6f7a85, panels=None)
    gapc = glow_material('glow:gapc', PURPLE)

    box(r, slab_m(0x8d887f), (0.96, Y0, 1.96), (0, Y0 / 2, 0), bevel=0.016)

    # ---- tower (back cell)
    t = m.part('tower', at=(0, 0, -0.42))
    octo = [(0.3, -0.22), (0.3, 0.22), (0.22, 0.3), (-0.22, 0.3), (-0.3, 0.22), (-0.3, -0.22), (-0.22, -0.3), (0.22, -0.3)]
    prism(t, slab_m(0xa09b91), octo, 0.2, (0, Y0 + 0.1 - 0.01, 0), (-math.pi / 2, 0, 0), bevel=0.016)
    prism(t, steel(0x8a95a0, panels=(0.2, 0.2)), [(x * 0.8, z * 0.8) for (x, z) in octo], 0.04, (0, Y0 + 0.21, 0), (-math.pi / 2, 0, 0), bevel=0.008)
    prism(t, tr, [(x * 1.02, z * 1.02) for (x, z) in octo], 0.03, (0, Y0 + 0.17, 0), (-math.pi / 2, 0, 0))
    box(t, black(), (0.14, 0.12, 0.01), (0, Y0 + 0.07, 0.302))
    light(t, (0, Y0 + 0.155, 0.31), 0.011, 0xffd9a0, 'steady', facing='+z')
    for s in (-1, 1):
        grille(m, t, (0.302 * s, Y0 + 0.1, 0), (0.1, 0.08), facing='+x' if s > 0 else '-x')
    ty, th, b0, b1 = Y0 + 0.23, 0.78, 0.17, 0.07
    for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        cyl_between(t, lat, (b0 * sx, ty, b0 * sz), (b1 * sx, ty + th, b1 * sz), 0.014, seg=6)
    for i in range(4):
        f0, f1 = i / 4, (i + 1) / 4
        w0, w1 = b0 + (b1 - b0) * f0, b0 + (b1 - b0) * f1
        y1, y2 = ty + th * f0, ty + th * f1
        for (p0, p1) in (((-1, 1), (1, 1)), ((1, 1), (1, -1)), ((1, -1), (-1, -1)), ((-1, -1), (-1, 1))):
            bar(t, lat, (p0[0] * w0, y1, p0[1] * w0), (p1[0] * w1, y2, p1[1] * w1), 0.007)
            bar(t, tr if i % 2 == 0 else frm, (p0[0] * w1, y2, p0[1] * w1), (p1[0] * w1, y2, p1[1] * w1), 0.016 if i % 2 == 0 else 0.01)
    # conduit with glowing segments (energy rising)
    cyl(t, dark_m(), 0.03, th, (0, ty + th / 2, 0), r2=0.022, seg=8)
    for i in range(4):
        cyl(t, gapc, 0.028, 0.035, (0, ty + 0.12 + i * 0.17, 0), seg=8)
    light(t, (0.16, ty + 0.02, -0.16), 0.013, 0xff2a1a, 'blink')
    # emitter: collar, cage struts, the orb
    ey = ty + th + 0.12
    cyl(t, gun_m(), 0.08, 0.05, (0, ty + th + 0.02, 0), r2=0.06, seg=12, bevel=0.006)
    for i in range(4):
        a = i / 4 * math.pi * 2 + math.pi / 4
        bar(t, gun_m(), (math.cos(a) * 0.07, ty + th + 0.03, math.sin(a) * 0.07), (math.cos(a) * 0.12, ey + 0.02, math.sin(a) * 0.12), 0.012)
        sphere(t, gapc, 0.012, (math.cos(a) * 0.12, ey + 0.025, math.sin(a) * 0.12), seg=6, rings=4)
    sphere(t, glow_material('glow:gap', PURPLE), 0.075, (0, ey, 0), seg=14, rings=9)
    ra = m.part('ringA', parent='tower', at=(0, ey, 0), rot=(0.5, 0, 0))
    torus(ra, metal(0xb4bac0, rough=0.35, rust=0.05), 0.13, 0.01, seg=22, tseg=4)
    for i in range(4):
        a = i / 4 * math.pi * 2
        box(ra, tr, (0.035, 0.018, 0.025), (math.cos(a) * 0.13, 0, math.sin(a) * 0.13), (0, -a, 0))
    rb = m.part('ringB', parent='tower', at=(0, ey, 0), rot=(0, 0, 0.9))
    torus(rb, metal(0xb87333, rough=0.35, rust=0.1), 0.16, 0.008, seg=22, tseg=4)

    # ---- generator annex (front cell)
    ax, az, aw, ad, ah = 0.0, 0.48, 0.6, 0.42, 0.22
    box(r, wall2, (aw, ah, ad), (ax, Y0 + ah / 2, az), bevel=0.014)
    box(r, tr, (aw + 0.04, 0.035, ad + 0.04), (ax, Y0 + ah + 0.005, az), bevel=0.008)
    box(r, rf, (aw - 0.02, 0.02, ad - 0.02), (ax, Y0 + ah + 0.03, az))
    afz = az + ad / 2
    for i in range(6):
        box(r, gun_m(), (0.014, 0.16, 0.03), (-0.24 + i * 0.096, Y0 + 0.11, afz + 0.012))
    box(r, black(), (0.16, 0.14, 0.01), (0.12, Y0 + 0.07, afz + 0.03))
    box(r, light_mat(WIN_WARM, 0.9, 'steady'), (0.1, 0.08, 0.004), (0.12, Y0 + 0.06, afz + 0.034))
    hazard_band(m, r, (-0.08, Y0 + 0.17, afz + 0.03), (0.4, 0.03))
    big_text(m, r, 'GAP 1', (ax - 0.08, Y0 + ah + 0.042, az + 0.04), 0.11, plate=yellow(), color=0x24272b)
    for x in (0.1, 0.22):
        cyl(r, flat(0xd6d2c8, 0.4), 0.022, 0.07, (x, Y0 + ah + 0.07, az - 0.12), r2=0.018, seg=8)
        cyl(r, metal(0xb87333, rough=0.35), 0.008, 0.03, (x, Y0 + ah + 0.12, az - 0.12), seg=6)
    floodlight(r, (0.26, Y0 + ah + 0.05, afz - 0.03), yaw=0.0, pitch=0.8, s=0.04)
    sphere(r, gapc, 0.014, (-0.25, Y0 + ah + 0.05, afz - 0.04), seg=8, rings=5)
    # cable trench to the tower
    box(r, black(), (0.08, 0.012, 0.36), (0.0, Y0 + 0.006, 0.12))
    for z in (0.0, 0.12, 0.24):
        box(r, frm, (0.1, 0.008, 0.02), (0.0, Y0 + 0.012, z))
