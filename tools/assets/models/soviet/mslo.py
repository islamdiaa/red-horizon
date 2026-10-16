"""Soviet missile silo (2x1): a raised armoured silo block with hazard-striped sliding doors (parts doorL /
doorR, slid by the game) over the shaft, the missile (part 'missile', raised by the game) in white with a red
nose and team band, trefoil plates, the control bunker with red-lit slit windows, a radio mast and the red
warning lamps (glow:warn). Pivots: node --import tsx tools/assets/rig.ts mslo soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'mslo'
FACTION = 'soviet'
KIND = 'structure'


def build(m):
    m.set_meta(footprint=(2, 1), height=0.55, radius=1.05)
    look(m, ao_dist=0.3)
    P = Pal()
    r = m.root
    foundation(m, r, P, 2.0, 1.0)
    sx = -0.2
    # ---- silo block: concrete with a steel collar; the shaft
    # hollow block around the shaft opening (a solid block would bury the missile part: the bake culls
    # faces hidden at the rest pose)
    o = 0.23
    x0, x1, z0, z1 = -0.92, 0.52, -0.43, 0.43
    for (a0, a1, b0, b1) in ((x0, x1, o, z1), (x0, x1, z0, -o), (x0, sx - o, -o, o), (sx + o, x1, -o, o)):
        slab(r, P.conc, a0, a1, Y0, Y0 + 0.15, b0, b1, bevel=0.02)
    for (a0, a1, b0, b1) in ((sx - 0.33, sx + 0.33, o, 0.33), (sx - 0.33, sx + 0.33, -0.33, -o), (sx - 0.33, sx - o, -o, o), (sx + o, sx + 0.33, -o, o)):
        slab(r, P.wall_dk, a0, a1, Y0 + 0.15, Y0 + 0.162, b0, b1)
    cyl(r, P.void, 0.21, 0.004, (sx, Y0 + 0.002, 0), seg=16)
    for z in (0.31, -0.31):
        hazard_stripes(m, r, (sx, Y0 + 0.163, z), (0.64, 0.05), facing='+y')
    m.decal(trefoil_img(), at=(-0.78, Y0 + 0.151, 0.26), size=(0.13, 0.13), facing='+y', part=r, depth=0.02, team=0)
    m.decal(trefoil_img(), at=(0.36 - 0.0, Y0 + 0.151, -0.28), size=(0.1, 0.1), facing='+y', part=r, depth=0.02, team=0)
    m.decal(trefoil_img(), at=(-0.6, Y0 + 0.075, 0.431), size=(0.1, 0.1), facing='+z', part=r, depth=0.02, team=0)
    stencil(m, r, 'R-36', (-0.25, Y0 + 0.075, 0.431), 0.06, color=0xf2b916)
    for x in (-0.86, 0.46):
        for z in (-0.4, 0.4):
            box(r, P.frame, (0.06, 0.06, 0.06), (x, Y0 + 0.18, z), bevel=0.008)
    # ---- the missile (part, rises with the doors); kept short enough to hide under the closed doors
    mis = m.part('missile', at=(-0.2, -0.41, 0))
    body = painted(0xdedbd2, wear=0.35, rust=0.1, grime=0.35, streaks=0.4, panels=(0.2, 0.12), rough=0.45)
    cyl(mis, body, 0.1, 0.4, (0, 0.2, 0), seg=14)
    lathe(mis, P.red, [(0.1, 0.0), (0.09, 0.07), (0.06, 0.14), (0.0, 0.2)], (0, 0.4, 0), seg=14)
    cyl(mis, P.trim, 0.103, 0.04, (0, 0.3, 0), seg=14, caps=False)
    m.decal(soviet_star(), at=(0, 0.2, 0.1), size=(0.09, 0.09), facing='+z', part=mis, depth=0.04, team=0)
    stencil(m, mis, 'СССР', (0, 0.1, 0.1), 0.035, depth=0.04, color=0xa31c15)
    # ---- sliding doors (parts doorL / doorR at the procedural pivot; they slide along X)
    for (name, s) in (('doorL', -1), ('doorR', 1)):
        d = m.part(name, at=(-0.2, 0.19, 0))
        box(d, P.wall, (0.29, 0.05, 0.6), (s * 0.145, 0.02, 0), bevel=0.01)
        for i in range(3):
            box(d, P.dark, (0.014, 0.052, 0.54), (s * (0.05 + i * 0.075), 0.02, 0))
        box(d, P.trim, (0.03, 0.053, 0.6), (s * 0.015, 0.02, 0))
        m.decal(hazard_img(aspect=0.27 / 0.06), at=(s * 0.145, 0.047, 0.24), size=(0.27, 0.06), facing='+y', part=d, depth=0.01)
        m.decal(hazard_img(aspect=0.27 / 0.06), at=(s * 0.145, 0.047, -0.24), size=(0.27, 0.06), facing='+y', part=d, depth=0.01)
    # ---- control bunker (right)
    bx, bz = 0.68, -0.05
    top, fz = hall(r, P, bx, bz, 0.44, 0.62, 0.36, wall=P.wall, parapet=0.035)
    for x in (bx - 0.1, bx + 0.1):
        box(r, P.void, (0.12, 0.05, 0.01), (x, Y0 + 0.24, fz + 0.002))
        box(r, light_mat(0xff3a20, 1.8, 'steady'), (0.1, 0.035, 0.006), (x, Y0 + 0.24, fz + 0.006))
    door(m, r, (bx, Y0, fz), (0.12, 0.18), kind='hatch')
    crest(m, r, (bx + 0.15, Y0 + 0.12, fz + 0.002), 0.08)
    antenna(r, (bx + 0.1, top + 0.018, bz - 0.15), 0.36, light_color=None)
    lamp(r, (bx + 0.1, top + 0.38, bz - 0.15), 0.017)
    warn = glow_material('glow:warn', 0xff2a1a)
    for (x, y, z) in ((bx - 0.13, top + 0.04, fz - 0.05), (-0.88, Y0 + 0.16, 0.36), (0.48 - 0.0, Y0 + 0.16, -0.36), (-0.88, Y0 + 0.16, -0.36)):
        box(r, P.dark, (0.04, 0.025, 0.04), (x, y - 0.0125, z))
        sphere(r, warn, 0.022, (x, y + 0.012, z), seg=8, rings=5)
    pipe_run(r, P.dark, [(bx - 0.22, Y0 + 0.1, -0.2), (0.1, Y0 + 0.1, -0.2)], 0.02)
    red_banner(m, r, (bx - 0.14, top - 0.06, fz + 0.03), (0.12, 0.22))


_tre = {}


def trefoil_img():
    if 't' in _tre:
        return _tre['t']
    from kit import decals as D
    cv = D.Canvas(160, 160, ss=2)
    c = 80
    cv.circle(c, c, 78, D.lin(0xf2b916))
    blk = D.lin(0x141414)
    for k in range(3):
        a0 = math.pi / 2 + k * 2 * math.pi / 3 - math.pi / 6
        pts = [(c, c)]
        for i in range(9):
            a = a0 + (math.pi / 3) * i / 8
            pts.append((c + math.cos(a) * 66, c + math.sin(a) * 66))
        cv.poly(pts, blk)
    cv.circle(c, c, 22, D.lin(0xf2b916))
    cv.circle(c, c, 14, blk)
    cv.roughen(0.2, seed=4)
    img = cv.image()
    _tre['t'] = img
    return img
