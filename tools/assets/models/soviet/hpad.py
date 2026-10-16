"""Soviet helipad (2x2): a raised armoured pad with a kerb, a big painted H and star, a yellow ring and
hazard edges, the edge-light ring (glow:ring), corner beacons, a control hut with lit windows and a radio mast,
fuel tanks on a cradle, the windsock (part 'sock', swung by the game).
Pivots: node --import tsx tools/assets/rig.ts hpad soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'hpad'
FACTION = 'soviet'
KIND = 'structure'


def build(m):
    m.set_meta(footprint=(2, 2), height=0.5, radius=1.05, snow=0.35)  # the pad is kept clear for the rotors
    look(edge=0.28, ao_dist=0.3)
    P = Pal()
    r = m.root
    foundation(m, r, P, 2.0, 2.0)
    px, pz, ph = -0.04, 0.04, 0.07
    box(r, P.wall_dk, (1.66, ph, 1.66), (px, Y0 + ph / 2, pz), bevel=0.022)
    for i in range(4):
        a = i * math.pi / 2
        m.decal(hazard_img(aspect=1.5 / 0.04), at=(px + math.sin(a) * 0.83, Y0 + ph / 2, pz + math.cos(a) * 0.83), size=(1.5, 0.04), facing=a, part=r, depth=0.04)
    pad = deep(concrete(0x5a5853, grime=0.7, streaks=0.2, wear=0.4, joints=(0.4, 0.4), tex='rough_concrete'), 0.75)
    box(r, pad, (1.56, 0.012, 1.56), (px, Y0 + ph + 0.006, pz))
    ty = Y0 + ph + 0.0125
    m.decal(pad_marks(), at=(px, ty, pz), size=(1.5, 1.5), facing='+y', part=r, depth=0.01, team=0)
    for s in (-1, 1):
        hazard_stripes(m, r, (px, ty, pz + 0.74 * s), (1.5, 0.06), facing='+y')
    for i in range(8):
        a = (i / 8) * math.pi * 2
        x, z = px + math.cos(a) * 0.7, pz - math.sin(a) * 0.7
        box(r, P.dark, (0.03, 0.012, 0.03), (x, ty + 0.006, z))
        sphere(r, glow_material('glow:ring', 0xfff2d6), 0.013, (x, ty + 0.016, z), seg=6, rings=4)
    for (x, z) in ((-0.8, -0.72), (0.72, -0.72), (-0.8, 0.8), (0.72, 0.8)):
        cyl(r, P.dark, 0.028, 0.04, (x, ty + 0.02, z), r2=0.024, seg=8)
        lamp(r, (x, ty + 0.04, z), 0.02)

    # ---- control hut (back right)
    cx, cz = 0.78, -0.76
    top, fz = hall(r, P, cx, cz, 0.36, 0.32, 0.32, wall=P.wall, parapet=0.03, plinth=0.08)
    window_row(r, (cx, Y0 + 0.2, fz), 2, (0.08, 0.08), 0.05, dark=(0,), strength=2.0)
    stencil(m, r, 'H-1', (cx, Y0 + 0.08, fz + 0.002), 0.035, color=0xf2b916)
    antenna(r, (cx + 0.08, top + 0.018, cz - 0.06), 0.42, light_color=None)
    lamp(r, (cx + 0.08, top + 0.44, cz - 0.06), 0.017)
    box(r, P.dark, (0.05, 0.035, 0.03), (cx - 0.12, top + 0.03, fz - 0.02), (0.3, -0.6, 0), bevel=0.004)
    box(r, light_mat(0xfff2d6, 3.0, 'steady'), (0.04, 0.025, 0.004), (cx - 0.12 + 0.008, top + 0.025, fz - 0.003), (0.3, -0.6, 0))
    # ---- fuel tanks on a cradle (left back), pipe to the pad
    box(r, P.dark, (0.4, 0.03, 0.3), (-0.86, Y0 + 0.015, -0.57), bevel=0.004)
    for z in (-0.66, -0.48):
        cyl(r, P.wall_lt, 0.075, 0.36, (-0.86, Y0 + 0.11, z), (0, 0, math.pi / 2), seg=12, bevel=0.006)
        cyl(r, P.trim, 0.079, 0.03, (-0.86, Y0 + 0.11, z), (0, 0, math.pi / 2), seg=12, caps=False)
    pipe_run(r, P.steel, [(-0.68, Y0 + 0.1, -0.57), (-0.6, Y0 + 0.1, -0.57), (-0.6, Y0 + 0.02, -0.4)], 0.016)
    # ---- windsock: pole + the sock part
    cyl(r, P.steel, 0.01, 0.42, (0.86, Y0 + 0.21, 0.86), r2=0.008, seg=6)
    sk = m.part('sock', at=(0.86, 0.44, 0.86))
    cyl(sk, cloth(0xd03018), 0.035, 0.09, (0.05, 0, 0), (0, 0, math.pi / 2), r2=0.026, seg=6, caps=False)
    cyl(sk, cloth(0xe8e4da), 0.026, 0.06, (0.125, 0, 0), (0, 0, math.pi / 2), r2=0.018, seg=6, caps=False)
    crates(r, P, (0.5, Y0, -0.82), 0.08, 2, 0.2)
    drums(r, (0.84, Y0, -0.36), 3)


_pm = {}


def pad_marks():
    """Pad paint: yellow ring, a big white H and a red star (one decal)."""
    if 'p' in _pm:
        return _pm['p']
    from kit import decals as D
    S = 512
    cv = D.Canvas(S, S, ss=2)
    c = S / 2
    cv.circle(c, c, S * 0.43, D.lin(0xe0b024), r_in=S * 0.39)
    wh = D.lin(0xe8e4da)
    cv.rect(c - S * 0.16, c - S * 0.17, c - S * 0.1, c + S * 0.17, wh)
    cv.rect(c + S * 0.1, c - S * 0.17, c + S * 0.16, c + S * 0.17, wh)
    cv.rect(c - S * 0.1, c - S * 0.03, c + S * 0.1, c + S * 0.03, wh)
    pts = D.star_points(c, S * 0.2, S * 0.07)
    tris = [((c, S * 0.2), pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
    cv.fill(cv.cover(tris), D.lin(0xb31e17), 1.0, None)
    cv.roughen(0.25, seed=9)
    img = cv.image()
    _pm['p'] = img
    return img
