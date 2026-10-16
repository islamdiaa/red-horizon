"""Soviet tech centre (3x3): a brutalist chamfered concrete institute with a stepped octagonal tower and a
spire carrying the glowing red star (part 'star', turned by the game; glow:star), a glass laboratory dome
over a green reactor core (glow:core), radio masts with red lamps, the НАУКА — СИЛА board, banners, lit lab
windows (warm and green), gas tanks and sandbags in the yard. Pivots: node --import tsx tools/assets/rig.ts stek soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'stek'
FACTION = 'soviet'
KIND = 'structure'

GREEN = 0x5dffb0


def octo(w, d, c):
    """Chamfered rectangle outline (half extents w, d; chamfer c), counter-clockwise in XY."""
    return [(-w + c, -d), (w - c, -d), (w, -d + c), (w, d - c), (w - c, d), (-w + c, d), (-w, d - c), (-w, -d + c)]


def slabo(p, mat, w, d, c, h, at, bevel=0.01):
    """Chamfered (octagonal) slab: outline in XZ, height h, bottom at at.y."""
    x, y, z = at
    # prism outline (x, y) extruded along local z; rotate so local y -> -z and the extrusion -> +y
    prism(p, mat, [(px, -pz) for (px, pz) in octo(w, d, c)], h, (x, y + h / 2, z), rot=(-math.pi / 2, 0, 0), bevel=bevel)


def build(m):
    m.set_meta(footprint=(3, 3), height=1.8, radius=1.55)
    look(m, ao_dist=0.42)
    P = Pal()
    r = m.root
    foundation(m, r, P, 3.0, 3.0)
    conc = deep(concrete(0x8a867e, joints=(0.45, 0.15), grime=0.85, streaks=1.0, wear=0.75), 0.82)
    conc_dk = P.conc_dk

    # ---- main block (chamfered), team trim, roof
    bz = -0.35
    slabo(r, conc, 1.35, 0.85, 0.14, 0.46, (0, Y0, bz), bevel=0.014)
    slabo(r, P.trim, 1.37, 0.87, 0.15, 0.065, (0, Y0 + 0.39, bz), bevel=0.008)       # team band (proud of the wall)
    slabo(r, P.roof, 1.3, 0.8, 0.12, 0.02, (0, Y0 + 0.46, bz), bevel=0.0)            # roof, above the band
    fz = bz + 0.85  # 0.5
    # horizontal ribbon of lab windows (warm left, green right)
    for (x, col, seed) in ((-0.74, 0xffc27a, 21), (0.74, GREEN, 22)):
        glazing(m, r, (x, Y0 + 0.3, fz + 0.002), (0.66, 0.1), 6, 1, dark=0.35, seed=seed, lit=col, strength=1.7, t=0.16)
        box(r, P.frame, (0.7, 0.022, 0.035), (x, Y0 + 0.24, fz + 0.016), bevel=0.004)
    # entrance portal + crest
    box(r, P.wall_dk, (0.4, 0.24, 0.08), (0, Y0 + 0.12, fz + 0.04), bevel=0.012)
    box(r, P.void, (0.26, 0.18, 0.01), (0, Y0 + 0.09, fz + 0.081))
    box(r, P.trim, (0.44, 0.03, 0.1), (0, Y0 + 0.255, fz + 0.04), bevel=0.006)
    strip_light(r, (0, Y0 + 0.07, fz + 0.08), (0.2, 0.025), color=0xffd9a0, strength=1.8)
    # big crest on a raised red panel over the portal, wide banners either side
    box(r, P.red, (0.36, 0.26, 0.04), (0, Y0 + 0.385 - 0.13 + 0.13, fz + 0.02), bevel=0.008)
    crest(m, r, (0, Y0 + 0.385, fz + 0.041), 0.24)
    for s in (-1, 1):
        red_banner(m, r, (s * 0.33, Y0 + 0.44, fz + 0.03), (0.24, 0.42))
    tilt_sign(m, r, P, (0.62, Y0 + 0.48 + 0.05 + 0.13, 0.33), (0.84, 0.24), 'НАУКА — СИЛА', tilt=0.5, lights=3)
    for (x, z) in ((-1.3, bz - 0.77), (1.3, bz - 0.77), (-1.3, fz - 0.08), (1.3, fz - 0.08)):
        lamp(r, (x, Y0 + 0.48, z), 0.024)

    # ---- stepped octagonal tower + spire + the star part
    tz = -0.5
    ty0 = Y0 + 0.48
    slabo(r, conc, 0.42, 0.36, 0.08, 0.42, (0, ty0, tz), bevel=0.012)
    slabo(r, P.trim, 0.445, 0.385, 0.09, 0.06, (0, ty0 + 0.36, tz), bevel=0.008)
    slabo(r, P.roof, 0.4, 0.34, 0.07, 0.015, (0, ty0 + 0.42, tz), bevel=0.0)
    ty1 = ty0 + 0.435
    slabo(r, conc, 0.3, 0.26, 0.06, 0.24, (0, ty1, tz), bevel=0.01)
    slabo(r, P.trim, 0.325, 0.285, 0.065, 0.05, (0, ty1 + 0.19, tz), bevel=0.006)
    slabo(r, P.roof, 0.28, 0.24, 0.055, 0.015, (0, ty1 + 0.24, tz), bevel=0.0)
    ty2 = ty1 + 0.255
    tfz = tz + 0.36
    glazing(m, r, (0, ty0 + 0.12, tfz + 0.002), (0.56, 0.1), 5, 1, dark=0.4, seed=32, lit=GREEN, strength=1.8, t=0.16)
    sign(m, r, (0, ty0 + 0.27, tfz + 0.005), (0.5, 0.12), 'НИИ-7', board=P.board, lights=2, emblem='soviet')
    glazing(m, r, (0, ty1 + 0.1, tz + 0.262), (0.4, 0.09), 3, 1, dark=0.3, seed=33, strength=1.8, t=0.16)
    # spire
    cyl(r, painted(0x8a1612, wear=0.4, panels=None), 0.1, 0.34, (0, ty2 + 0.17, tz), r2=0.012, seg=8)
    cyl(r, metal(0xb08a3a, rough=0.35), 0.016, 0.12, (0, ty2 + 0.38, tz), r2=0.012, seg=6)
    for k in range(6):
        a = k * math.pi / 3
        lamp(r, (math.cos(a) * 0.27, ty2, tz - math.sin(a) * 0.23), 0.018)
    star = m.part('star', at=(0, 1.72, -0.5))
    star_mesh(star, glow_material('glow:star', 0xff2a1a), 0.1, 0.03, 0.0)
    star_mesh(star, metal(0xb08a3a, rough=0.35), 0.118, 0.018, -0.012)

    # ---- glass lab dome with a glowing core (left)
    dx, dz = -0.85, -0.45
    cyl(r, conc_dk, 0.37, 0.07, (dx, Y0 + 0.515, dz), r2=0.36, seg=20, bevel=0.008)
    cyl(r, P.trim, 0.35, 0.05, (dx, Y0 + 0.57, dz), seg=20, caps=False)
    sphere(r, glow_material('glow:core', GREEN), 0.13, (dx, Y0 + 0.69, dz), seg=12, rings=8)
    cyl(r, P.dark, 0.06, 0.1, (dx, Y0 + 0.6, dz), r2=0.05, seg=10)
    dome(r, glass(0x2a5a50), 0.335, (dx, Y0 + 0.57, dz), seg=18, rings=5)
    for i in range(6):
        a = i * math.pi / 6
        bar(r, P.gun, (dx + math.cos(a) * 0.34, Y0 + 0.57, dz - math.sin(a) * 0.34), (dx + math.cos(a) * 0.24, Y0 + 0.81, dz - math.sin(a) * 0.24), 0.012)
        bar(r, P.gun, (dx - math.cos(a) * 0.34, Y0 + 0.57, dz + math.sin(a) * 0.34), (dx - math.cos(a) * 0.24, Y0 + 0.81, dz + math.sin(a) * 0.24), 0.012)
    lamp(r, (dx, Y0 + 0.91, dz), 0.02)

    # ---- radio masts (right) with red lamps
    for (x, z, h) in ((0.98, -0.8, 0.85), (0.72, -0.25, 0.58)):
        for (sx, sz) in ((-1, -1), (1, -1), (0, 1)):
            bar(r, P.dark, (x + sx * 0.05, Y0 + 0.49, z + sz * 0.05), (x, Y0 + 0.49 + h, z), 0.012)
        for k in range(1, 4):
            y = Y0 + 0.49 + h * k / 4
            bar(r, P.red, (x - 0.04 * (1 - k / 4), y, z), (x + 0.04 * (1 - k / 4), y, z), 0.008)
        lamp(r, (x, Y0 + 0.49 + h, z), 0.02)
        lamp(r, (x, Y0 + 0.49 + h * 0.55, z), 0.014)

    # ---- roof plant
    rt = Y0 + 0.49
    ac_unit(r, (-0.25, rt, -0.95), 0.1, mat=P.wall_lt)
    ac_unit(r, (0.25, rt, -1.0), 0.1, mat=P.wall_lt)
    roof_vent(r, (0.5, rt, -0.9), 0.045)
    box(r, P.gun, (0.3, 0.1, 0.18), (-0.55, rt + 0.05, 0.2), bevel=0.015)
    pipe_run(r, P.rust, [(-0.55, rt + 0.12, 0.2), (-0.55, rt + 0.12, -0.2), (-0.42, rt + 0.12, -0.2)], 0.03)
    grille(m, r, (0.62, rt + 0.005, 0.1), (0.36, 0.22), facing='+y')

    # ---- yard: gas tanks, sandbags, a crate, lamp posts
    for x in (-1.0, -0.72):
        cyl(r, P.white, 0.1, 0.3, (x, Y0 + 0.17, 0.95), seg=14)
        sphere(r, P.white, 0.1, (x, Y0 + 0.32, 0.95), seg=14, rings=6)
        cyl(r, P.trim, 0.104, 0.035, (x, Y0 + 0.2, 0.95), seg=14, caps=False)
        box(r, P.conc_dk, (0.16, 0.04, 0.16), (x, Y0 + 0.02, 0.95), bevel=0.006)
        pipe(r, P.steel, (x, Y0 + 0.3, 0.86), (x, Y0 + 0.3, fz + 0.01), 0.022)
    sandbags(r, P, (0.6, Y0, 0.92), (1.2, Y0, 0.92), rows=2)
    crates(r, P, (0.55, Y0, 1.0), 0.11, 1)
    lamp_post(r, P, (1.36, Y0, 1.36), 0.44, yaw=math.pi)
    lamp_post(r, P, (-1.36, Y0, 1.36), 0.44, yaw=0.0)


def star_mesh(p, mat, R, t, z):
    """A five-pointed star plate facing +z (extruded thickness t), centred at (0, 0, z) of the part."""
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        rr = R if i % 2 == 0 else R * 0.42
        pts.append((math.cos(a) * rr, math.sin(a) * rr))
    prism(p, mat, pts, t, (0, 0, z))
