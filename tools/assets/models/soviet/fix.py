"""Soviet service depot (3x3): the octagonal repair pad (green pad lights: glow:pad) under a yellow gantry with
a hoist, four repair arms with welding tips (glow:weld), the two-bay workshop at the back with the РЕМОНТ board,
banners and lit windows, side tool sheds, floodlight poles. Pivots: node --import tsx tools/assets/rig.ts fix soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'fix'
FACTION = 'soviet'
KIND = 'structure'


def build(m):
    m.set_meta(footprint=(3, 3), height=0.95, radius=1.55)
    look(edge=0.28, ao_dist=0.38)
    P = Pal()
    r = m.root
    foundation(m, r, P, 3.0, 3.0)
    oc = (0, math.pi / 8, 0)

    # ---- the octagonal pad (low: drivable)
    cyl(r, P.gun, 0.67, 0.05, (0, Y0 + 0.025, 0), oc, seg=8, bevel=0.012)
    cyl(r, P.dark, 0.57, 0.008, (0, Y0 + 0.054, 0), oc, seg=8)
    m.decal(pad_x(), at=(0, Y0 + 0.059, 0), size=(1.0, 1.0), facing='+y', part=r, depth=0.01, team=0)
    for i in range(8):
        a = (i / 8) * math.pi * 2
        x, z = math.cos(a) * 0.6, -math.sin(a) * 0.6
        sphere(r, glow_material('glow:pad', 0x3aff6a), 0.018, (x, Y0 + 0.06, z), seg=6, rings=4)
    for i in range(8):
        a = i * math.pi / 4
        m.decal(hazard_img(aspect=0.5 / 0.04), at=(math.sin(a) * 0.62, Y0 + 0.025, math.cos(a) * 0.62), size=(0.5, 0.04), facing=a, part=r, depth=0.04)

    # ---- back workshop: two bays, the board, banners, windows
    wz, wd, wh = -1.02, 0.8, 0.68
    top, fz = hall(r, P, 0, wz, 2.8, wd, wh, wall=P.wall, parapet=0.04)
    for x in (-0.75, 0.75):
        box(r, P.void, (0.62, 0.42, 0.012), (x, Y0 + 0.21, fz + 0.002))
        strip_light(r, (x, Y0 + 0.36, fz - 0.002), (0.5, 0.03), color=0xffc27a, strength=2.2)
        box(r, corrugated(0x50565d, along='x', pitch=0.04, rust=0.45, wear=0.65), (0.6, 0.2, 0.014), (x, Y0 + 0.32, fz + 0.012))
        box(r, P.yellow, (0.6, 0.025, 0.024), (x, Y0 + 0.215, fz + 0.016), bevel=0.003)
        box(r, P.wall_dk, (0.7, 0.06, 0.06), (x, Y0 + 0.45, fz + 0.025), bevel=0.01)
        m.decal(hazard_img(aspect=0.68 / 0.04), at=(x, Y0 + 0.45, fz + 0.056), size=(0.68, 0.04), facing='+z', part=r, depth=0.01)
        for s in (-1, 1):
            box(r, P.wall_dk, (0.05, 0.42, 0.05), (x + s * 0.335, Y0 + 0.21, fz + 0.02), bevel=0.008)
        lamp(r, (x - 0.36, Y0 + 0.49, fz + 0.03), 0.02, 0xffa020, 'blink')
    slogan(m, r, (0, Y0 + 0.45, fz + 0.03), (0.56, 0.22), 'РЕМОНТ', lights=2)
    for s in (-1, 1):
        red_banner(m, r, (s * 1.25, top - 0.06, fz + 0.03), (0.18, 0.46))
    window_row(r, (0, Y0 + 0.2, fz), 2, (0.08, 0.08), 0.06, strength=2.0)
    roof_lights(r, -1.36, wz - wd / 2 + 0.04, 1.36, fz - 0.04, top + 0.04)
    rt = top + 0.018
    ac_unit(r, (-0.9, rt, wz - 0.1), 0.1, mat=P.wall_lt)
    ac_unit(r, (0.3, rt, wz - 0.12), 0.1, mat=P.wall_lt)
    roof_vent(r, (1.0, rt, wz + 0.1), 0.04)
    antenna(r, (1.25, rt, wz - 0.25), 0.42, light_color=None)
    lamp(r, (1.25, rt + 0.42, wz - 0.25), 0.018)

    # ---- side tool sheds open toward the pad
    for s in (-1, 1):
        sx = 1.12 * s
        stop, _sf = hall(r, P, sx, -0.12, 0.46, 0.82, 0.42, wall=P.wall_dk, parapet=0.03)
        ix = sx - 0.232 * s
        box(r, P.void, (0.012, 0.3, 0.62), (ix, Y0 + 0.15, -0.12))
        for k in range(3):
            box(r, P.yellow, (0.014, 0.014, 0.56), (ix - 0.008 * s, Y0 + 0.06 + k * 0.09, -0.12))
        m.decal(hazard_img(aspect=0.64 / 0.035), at=(ix - 0.007 * s, Y0 + 0.33, -0.12), size=(0.64, 0.035), facing='-x' if s > 0 else '+x', part=r, depth=0.01)
        ac_unit(r, (sx, stop + 0.018, -0.3), 0.08, mat=P.wall_lt, rot=math.pi / 2)
        drums(r, (sx - 0.05 * s, Y0, 0.5), 3)

    # ---- repair arms on four posts + the gantry with a hoist
    for (x, z) in ((-0.78, -0.56), (0.78, -0.56), (-0.78, 0.7), (0.78, 0.7)):
        cyl(r, P.gun, 0.065, 0.08, (x, Y0 + 0.04, z), r2=0.055, seg=10, bevel=0.006)
        cyl(r, P.yellow, 0.032, 0.42, (x, Y0 + 0.29, z), r2=0.028, seg=10)
        yaw = math.atan2(-z, x) + math.pi
        from kit.core import T
        F = T((x, Y0 + 0.5, z), (0, yaw, 0))

        def at(p):
            return tuple(F @ v3(p))
        box(r, P.yellow, (0.065, 0.065, 0.065), at((0, 0, 0)), (0, yaw, 0), bevel=0.012)
        bar(r, P.yellow, at((0.0, 0.02, 0)), at((0.4, -0.12, 0)), 0.035)
        bar(r, P.yellow, at((0.4, -0.12, 0)), at((0.5, -0.17, 0)), 0.03)
        box(r, P.dark, (0.045, 0.05, 0.045), at((0.5, -0.19, 0)), (0, yaw, 0), bevel=0.008)
        sphere(r, glow_material('glow:weld', 0x7ae8ff), 0.016, at((0.5, -0.22, 0)), seg=6, rings=4)
        pipe(r, P.dark, at((0.02, -0.02, 0.03)), at((0.38, -0.14, 0.03)), 0.006, flanges=False, seg=5)
    for s in (-1, 1):
        box(r, P.yellow, (0.055, 0.86, 0.055), (s * 0.84, Y0 + 0.43, -0.48), bevel=0.008)
        m.decal(hazard_img(aspect=0.3 / 0.05), at=(s * 0.84, Y0 + 0.2, -0.452), size=(0.3, 0.05), facing='+z', part=r, depth=0.01, roll=math.pi / 2)
        lamp(r, (s * 0.84, Y0 + 0.9, -0.48), 0.02, 0xffa020, 'blink')
    box(r, P.yellow, (1.76, 0.08, 0.07), (0, Y0 + 0.86, -0.48), bevel=0.01)
    m.decal(hazard_img(aspect=1.7 / 0.04), at=(0, Y0 + 0.86, -0.444), size=(1.7, 0.04), facing='+z', part=r, depth=0.01)
    box(r, P.dark, (0.1, 0.06, 0.1), (0.2, Y0 + 0.8, -0.48), bevel=0.008)
    pipe(r, P.steel, (0.2, Y0 + 0.77, -0.48), (0.2, Y0 + 0.48, -0.48), 0.003, flanges=False, seg=4)
    box(r, P.dark, (0.04, 0.05, 0.04), (0.2, Y0 + 0.46, -0.48), bevel=0.006)

    # ---- floodlight poles at the front corners, crates
    for s in (-1, 1):
        bar(r, P.dark, (s * 1.32, Y0, 1.3), (s * 1.32, Y0 + 0.62, 1.3), 0.024)
        box(r, P.dark, (0.07, 0.05, 0.04), (s * 1.3, Y0 + 0.62, 1.27), (0.6, -s * 0.7, 0), bevel=0.006)
        box(r, light_mat(0xfff2d6, 3.0, 'steady'), (0.055, 0.04, 0.004), (s * 1.3 - s * 0.012, Y0 + 0.61, 1.256), (0.6, -s * 0.7, 0))
    crates(r, P, (-1.22, Y0, 1.0), 0.1, 3, 0.3)


_px = {}


def pad_x():
    """Pad paint: yellow ring and a yellow X."""
    if 'p' in _px:
        return _px['p']
    from kit import decals as D
    S = 384
    cv = D.Canvas(S, S, ss=2)
    c = S / 2
    y = D.lin(0xe0b024)
    cv.circle(c, c, S * 0.45, y, r_in=S * 0.4)
    w = S * 0.045
    for k in (1, -1):
        L = S * 0.36
        dx, dy = L * 0.7071, k * L * 0.7071
        nx, ny = -dy / L * w, dx / L * w
        cv.poly([(c - dx + nx, c - dy + ny), (c + dx + nx, c + dy + ny), (c + dx - nx, c + dy - ny), (c - dx - nx, c - dy - ny)], y)
    cv.roughen(0.25, seed=12)
    img = cv.image()
    _px['p'] = img
    return img
