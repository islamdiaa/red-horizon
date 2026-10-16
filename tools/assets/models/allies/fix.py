"""Allied service depot (3x3): the octagonal repair pad (hazard ring, star roundel, green guide lamps on
'glow:pad'), four yellow repair arms with welding tips ('glow:weld') and an overhead gantry with a hoist, the
white workshop at the back (two roller bays, one open and lit, the SERVICE sign, roundels, banners), open tool
sheds either side and floodlight poles at the front corners.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'fix'
FACTION = 'allies'
KIND = 'structure'


def build(m):
    setup(m)
    m.set_meta(footprint=(3, 3), height=0.95, radius=1.55)
    r = m.root

    wall = white()
    wall2 = offwhite()
    frm = frame()
    tr = trim()
    rf = roof()
    yel = yellow()
    rail = rail_m()

    box(r, slab_m(0x9d988e), (2.98, Y0, 2.98), (0, Y0 / 2, 0), bevel=0.02)
    box(r, asphalt(), (2.2, 0.01, 1.0), (0, Y0 + 0.005, 0.95), bevel=0.003)
    for x in (-0.6, 0.0, 0.6):
        mark(m, r, solid(HAZ_Y), (x, Y0 + 0.01, 1.0), (0.035, 0.6), asphalt(), rough=0.6)

    # ---- the octagonal pad
    oct_ = [(math.cos(i / 8 * math.pi * 2 + math.pi / 8) * 0.64, math.sin(i / 8 * math.pi * 2 + math.pi / 8) * 0.64) for i in range(8)]
    prism(r, gun_m(0x4a5058), oct_, 0.06, (0, Y0 + 0.03, 0), (-math.pi / 2, 0, 0), bevel=0.012)
    inner = [(x * 0.88, z * 0.88) for (x, z) in oct_]
    prism(r, tread(0x50565c), inner, 0.012, (0, Y0 + 0.064, 0), (-math.pi / 2, 0, 0))
    m.decal(_ring_img(), at=(0, Y0 + 0.071, 0), size=(1.1, 1.1), facing='+y', depth=0.03, team=0, rough=0.6)
    roundel(m, r, (0, Y0 + 0.071, 0), 0.5, facing='+y', depth=0.03)
    for i in range(8):
        a = i / 8 * math.pi * 2
        x, z = math.cos(a) * 0.6, math.sin(a) * 0.6
        cyl(r, dark_m(), 0.022, 0.012, (x, Y0 + 0.066, z), seg=8)
        sphere(r, glow_material('glow:pad', 0x40ff70), 0.017, (x, Y0 + 0.074, z), seg=8, rings=5)

    # ---- workshop (back)
    wz, wd, ww, wh = -1.02, 0.8, 2.8, 0.66
    fz = wz + wd / 2
    top = block(m, r, 0, wz, ww, wd, wh, wall=wall, cornice=tr, roof_m=rf, cap=frm,
                pilasters=(-ww / 2 + 0.03, -1.1, -0.4, 0.4, 1.1, ww / 2 - 0.03))
    rt = Y0 + wh
    for (x, open_) in ((-0.75, True), (0.75, False)):
        if open_:
            box(r, black(), (0.6, 0.42, 0.01), (x, Y0 + 0.21, fz + 0.003))
            box(r, light_mat(WIN_WARM, 1.0, 'steady'), (0.5, 0.2, 0.004), (x, Y0 + 0.12, fz + 0.007))
            sh = corrugated(0x8792a0, along='x', pitch=0.026, rust=0.3, streaks=0.85)
            box(r, sh, (0.58, 0.18, 0.014), (x, Y0 + 0.33, fz + 0.012), bevel=0.003)
            box(r, yel, (0.58, 0.022, 0.02), (x, Y0 + 0.24, fz + 0.015), bevel=0.004)
        else:
            door(m, r, (x, Y0, fz), (0.6, 0.42), kind='roller')
        for s in (-1, 1):
            box(r, frm, (0.04, 0.46, 0.05), (x + s * 0.32, Y0 + 0.23, fz + 0.025), bevel=0.008)
        box(r, frm, (0.7, 0.06, 0.06), (x, Y0 + 0.45, fz + 0.03), bevel=0.01)
        hazard_band(m, r, (x, Y0 + 0.45, fz + 0.061), (0.68, 0.05))
        light(r, (x - 0.36, Y0 + 0.5, fz + 0.04), 0.017, 0xffa020, 'blink')
    lit_sign(m, r, (0, Y0 + 0.5, fz + 0.03), (0.6, 0.15), 'SERVICE', lights=2)
    glazing(m, r, (0, Y0 + 0.24, fz + 0.004), (0.36, 0.1), 3, lit={0, 2}, color=WIN_WARM, emit=0.9)
    for x in (-1.24, 1.24):
        roundel(m, r, (x, Y0 + 0.4, fz + 0.002), 0.2, plate=wall)
    rivet_row(m, r, (-ww / 2 + 0.05, top - 0.09, fz + 0.001), (ww / 2 - 0.05, top - 0.09, fz + 0.001))
    # roof: roundel, AC, vents, mast
    roundel(m, r, (-0.3, rt + 0.016, wz + 0.02), 0.48, facing='+y', plate=steel(0x7d8792, panels=None))
    ac_unit(r, (-0.95, rt + 0.016, wz - 0.1), 0.11)
    ac_unit(r, (0.35, rt + 0.016, wz - 0.12), 0.11)
    roof_vent(r, (0.95, rt + 0.016, wz + 0.1), 0.04)
    cyl(r, dark_m(), 0.01, 0.42, (1.25, rt + 0.016 + 0.21, wz - 0.25), r2=0.005, seg=6)
    light(r, (1.25, rt + 0.45, wz - 0.25), 0.012, 0xff2a1a, 'blink')
    for x in (-ww / 2 + 0.05, ww / 2 - 0.05):
        strobe(r, (x, top + 0.035, fz - 0.02))

    # ---- open tool sheds either side, facing the pad
    for s in (-1, 1):
        sx = 1.12 * s
        stop = block(m, r, sx, -0.12, 0.46, 0.82, 0.42, wall=wall2, cornice=tr, roof_m=rf, cap=frm)
        face = '-x' if s > 0 else '+x'
        xf = sx - 0.232 * s
        box(r, black(), (0.01, 0.3, 0.62), (xf - 0.002 * s, Y0 + 0.15, -0.12))
        box(r, light_mat(WIN_WARM, 0.8, 'steady'), (0.004, 0.16, 0.48), (xf - 0.006 * s, Y0 + 0.13, -0.12))
        for k in range(3):
            box(r, yel, (0.014, 0.014, 0.58), (xf - 0.01 * s, Y0 + 0.06 + k * 0.09, -0.12))
        hazard_band(m, r, (xf - 0.004 * s, Y0 + 0.335, -0.12), (0.64, 0.035), facing=face)
        ac_unit(r, (sx, stop, -0.3), 0.08, rot=math.pi / 2)
        drums(r, (sx - 0.05 * s, Y0, 0.5), 3, colors=(0xa3241a, 0x5a6646, 0x2f5f9a) if s > 0 else (0x4f5a3a, 0x9a8f2a, 0x5a5f66))

    # ---- repair arms on four posts, the overhead gantry with a hoist
    for (x, z) in ((-0.78, -0.56), (0.78, -0.56), (-0.78, 0.7), (0.78, 0.7)):
        cyl(r, gun_m(), 0.065, 0.08, (x, Y0 + 0.04, z), r2=0.06, seg=12, bevel=0.006)
        cyl(r, yel, 0.033, 0.42, (x, Y0 + 0.29, z), r2=0.028, seg=12)
        m.decal(haz_img(2.5), at=(x, Y0 + 0.14, z + 0.03 * (1 if z > 0 else -1)), size=(0.07, 0.04), facing='+z' if z > 0 else '-z', depth=0.04, team=0)
        yaw = math.atan2(-z, x) + math.pi
        import mathutils
        F = T((x, Y0 + 0.5, z), (0, yaw, 0))

        def P(v):
            return tuple(F @ mathutils.Vector(v))
        box(r, yel, (0.07, 0.07, 0.07), P((0, 0, 0)), (0, yaw, 0), bevel=0.012)
        box(r, yel, (0.42, 0.04, 0.04), P((0.21, 0.02, 0)), (0, yaw, -0.35), bevel=0.008)
        box(r, yel, (0.2, 0.035, 0.035), P((0.43, -0.07, 0)), (0, yaw, -1.0), bevel=0.008)
        box(r, dark_m(), (0.045, 0.055, 0.045), P((0.5, -0.17, 0)), (0, yaw, 0), bevel=0.008)
        bar(r, dark_m(), P((0.12, 0.02, 0.03)), P((0.42, -0.1, 0.03)), 0.008)
        sphere(r, glow_material('glow:weld', 0x60e0ff), 0.015, P((0.5, -0.205, 0)), seg=8, rings=5)
    for s in (-1, 1):
        box(r, yel, (0.06, 0.86, 0.06), (s * 0.84, Y0 + 0.43, -0.48), bevel=0.01)
        hazard_band(m, r, (s * 0.84, Y0 + 0.2, -0.448), (0.3, 0.05), roll=math.pi / 2)
        light(r, (s * 0.84, Y0 + 0.9, -0.48), 0.017, 0xffa020, 'blink')
    box(r, yel, (1.76, 0.08, 0.07), (0, Y0 + 0.86, -0.48), bevel=0.012)
    hazard_band(m, r, (0, Y0 + 0.86, -0.4435), (1.6, 0.05))
    box(r, dark_m(), (0.11, 0.07, 0.11), (0.2, Y0 + 0.8, -0.48), bevel=0.01)
    bar(r, dark_m(), (0.2, Y0 + 0.77, -0.48), (0.2, Y0 + 0.47, -0.48), 0.005)
    box(r, yel, (0.05, 0.05, 0.05), (0.2, Y0 + 0.45, -0.48), bevel=0.008)
    floodlight(r, (-0.4, Y0 + 0.86 - 0.05, -0.44), yaw=0.0, pitch=1.1, s=0.05)
    floodlight(r, (0.55, Y0 + 0.86 - 0.05, -0.44), yaw=0.0, pitch=1.1, s=0.05)

    # ---- front corner floodlight poles, crates
    for s in (-1, 1):
        cyl(r, dark_m(), 0.013, 0.62, (s * 1.32, Y0 + 0.31, 1.3), r2=0.01, seg=8)
        cyl(r, frm, 0.04, 0.04, (s * 1.32, Y0 + 0.02, 1.3), seg=8, bevel=0.005)
        floodlight(r, (s * 1.32, Y0 + 0.62, 1.28), yaw=(-2.4 if s > 0 else 2.4), pitch=0.6, s=0.05)
    crates(r, (-1.22, Y0, 1.0), 3, 0.1)


def _ring_img():
    """Hazard ring for the repair pad: yellow / black segments between two radii (transparent elsewhere)."""
    from kit import decals as _D
    from _allied import _imgs
    if 'padring' in _imgs:
        return _imgs['padring']
    px = 512
    cv = _D.Canvas(px, px, ss=2)
    c = px / 2
    n = 24
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        pts = []
        for j in range(5):
            a = a0 + (a1 - a0) * j / 4
            pts.append((c + math.cos(a) * px * 0.49, c + math.sin(a) * px * 0.49))
        for j in range(4, -1, -1):
            a = a0 + (a1 - a0) * j / 4 + 0.08
            pts.append((c + math.cos(a) * px * 0.42, c + math.sin(a) * px * 0.42))
        col = HAZ_Y if k % 2 == 0 else 0x18181a
        tris = [(pts[0], pts[i], pts[i + 1]) for i in range(1, len(pts) - 1)]
        cv.fill(cv.cover(tris), _D.lin(col), 1.0)
    cv.roughen(0.25, seed=13)
    _imgs['padring'] = cv.image()
    return _imgs['padring']
