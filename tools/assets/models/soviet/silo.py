"""Soviet ore silo (1x1): a ribbed steel silo on a concrete ring with a conical cap, team band, ring catwalk,
ladder, a big crest and the ore-level gauge on the front (part 'gauge' with the amber glow:gauge bar, scaled by
the game), a feed pipe, drums, a red lamp. Pivots: node --import tsx tools/assets/rig.ts silo soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'silo'
FACTION = 'soviet'
KIND = 'structure'


def build(m):
    m.set_meta(footprint=(1, 1), height=1.15, radius=0.5)
    look(edge=0.28, ao_dist=0.26)
    P = Pal()
    r = m.root
    foundation(m, r, P, 1.0, 1.0)
    x, z, rad, h = 0.0, -0.04, 0.29, 0.86
    seg = 18
    cyl(r, P.conc_dk, rad + 0.06, 0.08, (x, Y0 + 0.04, z), r2=rad + 0.045, seg=seg, bevel=0.01)
    body = deep(painted(0x6c737b, panels=(0.3, 0.16), wear=0.7, grime=0.7, rust=0.4, streaks=1.0), 0.8)
    cyl(r, body, rad, h, (x, Y0 + 0.08 + h / 2, z), seg=seg)
    for k in range(9):
        a = (k / 9) * math.pi * 2 + 0.15
        box(r, P.frame, (0.024, h - 0.06, 0.024), (x + math.cos(a) * (rad + 0.004), Y0 + 0.08 + h / 2, z - math.sin(a) * (rad + 0.004)), (0, a, 0))
    for f in (0.28, 0.58):
        cyl(r, P.dark, rad + 0.013, 0.024, (x, Y0 + 0.08 + h * f, z), seg=seg, caps=False)
    cyl(r, P.trim, rad + 0.015, 0.085, (x, Y0 + 0.08 + h * 0.8, z), seg=seg, caps=False)
    top = Y0 + 0.08 + h
    lathe(r, P.wall_dk, [(rad + 0.025, 0.0), (rad * 0.8, 0.08), (rad * 0.3, 0.17), (0.0, 0.19)], (x, top, z), seg=seg)
    cyl(r, P.gun, 0.05, 0.06, (x, top + 0.2, z), seg=8)
    lamp(r, (x, top + 0.23, z), 0.022)
    cyl(r, P.grate, rad + 0.09, 0.012, (x, top - 0.03, z), seg=seg)
    for k in range(10):
        a = (k / 10) * math.pi * 2
        bar(r, P.rail, (x + math.cos(a) * (rad + 0.08), top - 0.025, z - math.sin(a) * (rad + 0.08)), (x + math.cos(a) * (rad + 0.08), top + 0.045, z - math.sin(a) * (rad + 0.08)), 0.007)
    cyl(r, P.rail, rad + 0.082, 0.008, (x, top + 0.045, z), seg=seg, caps=False)
    ladder(r, P.rail, (x + rad * 0.72, Y0 + 0.08, z + rad * 0.72), h - 0.03, facing=math.pi / 4)
    m.decal(big_star(), at=(x + 0.13, Y0 + 0.62, z + 0.26), size=(0.2, 0.2), facing=0.5, part=r, depth=0.08, team=0)
    stencil(m, r, 'РУДА', (x - 0.14, Y0 + 0.66, z + 0.255), 0.06, facing=-0.5, depth=0.06)
    # ---- ore-level gauge (front): dark housing, scale marks, the amber bar (part 'gauge', scaled in y)
    box(r, P.dark, (0.08, 0.44, 0.03), (0, Y0 + 0.43, 0.255), bevel=0.006)
    for k in range(5):
        box(r, P.white, (0.02, 0.006, 0.004), (0.03, Y0 + 0.23 + k * 0.1, 0.272))
    g = m.part('gauge', at=(0, 0.24, 0.272))
    box(g, glow_material('glow:gauge', 0xffb030), (0.04, 0.4, 0.006), (0, 0.2, 0))
    # ---- feed pipe, drums
    pipe_run(r, P.steel, [(-0.27, Y0 + 0.14, 0.08), (-0.44, Y0 + 0.14, 0.08), (-0.44, Y0 + 0.02, 0.08)], 0.03)
    drums(r, (0.32, Y0, 0.32), 2)
