"""Soviet ore silo (1x1): a fat ribbed steel silo on a concrete ring under a steep (60 degree) team-red conical roof
that stays clear of the runtime snow and carries a lit gold star facing the RTS camera, a beacon finial, red
bands, a catwalk ring at the eave, a ladder, the ore-level gauge on the front (part 'gauge' with the amber
glow:gauge bar, scaled by the game), a feed pipe and drums. Pivots: node --import tsx tools/assets/rig.ts silo soviet.
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
    m.set_meta(footprint=(1, 1), height=1.25, radius=0.5)
    look(m, ao_dist=0.28)
    P = Pal()
    r = m.root
    foundation(m, r, P, 1.0, 1.0)
    x, z, rad, h = 0.0, -0.04, 0.31, 0.6
    seg = 18
    cyl(r, P.conc_dk, rad + 0.07, 0.08, (x, Y0 + 0.04, z), r2=rad + 0.05, seg=seg, bevel=0.01)
    body = deep(painted(0x6c737b, panels=(0.3, 0.16), wear=0.7, grime=0.7, rust=0.4, streaks=1.0), 0.8)
    cyl(r, body, rad, h, (x, Y0 + 0.08 + h / 2, z), seg=seg)
    for k in range(9):
        a = (k / 9) * math.pi * 2 + 0.15
        box(r, P.frame, (0.026, h - 0.04, 0.026), (x + math.cos(a) * (rad + 0.005), Y0 + 0.08 + h / 2, z - math.sin(a) * (rad + 0.005)), (0, a, 0))
    cyl(r, P.red, rad + 0.014, 0.06, (x, Y0 + 0.08 + h * 0.18, z), seg=seg, caps=False)
    cyl(r, P.red, rad + 0.014, 0.06, (x, Y0 + 0.08 + h * 0.88, z), seg=seg, caps=False)
    # ---- the steep red cone roof with a lit star, a beacon on the finial
    ye = Y0 + 0.08 + h
    rr = rad + 0.04
    slope = math.radians(60)
    rise = rr * math.tan(slope)
    roof = team(wear=0.5, panels=(0.16, 0.12))
    lathe(r, roof, [(rr, 0.0), (rr * 0.5, rise * 0.5), (0.0, rise)], (x, ye, z), seg=seg, cap_top=False)
    cyl(r, P.dark, rr + 0.012, 0.03, (x, ye + 0.01, z), seg=seg, caps=False)
    top_star(m, r, (x, ye + rise * 0.36, z + rr * 0.62), 0.24, facing='+z', emit=0.4, depth=0.18)
    cyl(r, P.dark, 0.02, 0.1, (x, ye + rise + 0.03, z), seg=6)
    lamp(r, (x, ye + rise + 0.08, z), 0.026)
    # eave catwalk with posts, the ladder
    cyl(r, P.grate, rr + 0.07, 0.012, (x, ye - 0.035, z), seg=seg)
    for k in range(10):
        a = (k / 10) * math.pi * 2
        bar(r, P.rail, (x + math.cos(a) * (rr + 0.065), ye - 0.03, z - math.sin(a) * (rr + 0.065)), (x + math.cos(a) * (rr + 0.065), ye + 0.04, z - math.sin(a) * (rr + 0.065)), 0.008)
    cyl(r, P.rail, rr + 0.067, 0.008, (x, ye + 0.04, z), seg=seg, caps=False)
    for a in (0.5, 2.6, 4.7):
        lamp(r, (x + math.cos(a) * (rr + 0.07), ye + 0.045, z - math.sin(a) * (rr + 0.07)), 0.018)
    ladder(r, P.rail, (x + rad * 0.72, Y0 + 0.08, z + rad * 0.72), h - 0.03, facing=math.pi / 4)
    # ---- painted front: star crest and stencil beside the gauge
    m.decal(big_star(), at=(x + 0.15, Y0 + 0.38, z + 0.27), size=(0.18, 0.18), facing=0.55, part=r, depth=0.08, team=0)
    stencil(m, r, 'РУДА', (x - 0.15, Y0 + 0.4, z + 0.27), 0.055, facing=-0.55, depth=0.06)
    # ---- ore-level gauge (front): dark housing, scale marks, the amber bar (part 'gauge', scaled in y)
    box(r, P.dark, (0.08, 0.44, 0.03), (0, Y0 + 0.43, 0.262), bevel=0.006)
    for k in range(5):
        box(r, P.white, (0.02, 0.006, 0.004), (0.03, Y0 + 0.23 + k * 0.1, 0.279))
    g = m.part('gauge', at=(0, 0.24, 0.272))
    box(g, glow_material('glow:gauge', 0xffb030), (0.04, 0.4, 0.006), (0, 0.2, 0.008))
    # ---- feed pipe, drums
    pipe_run(r, P.steel, [(-0.29, Y0 + 0.14, 0.08), (-0.44, Y0 + 0.14, 0.08), (-0.44, Y0 + 0.02, 0.08)], 0.032)
    drums(r, (0.34, Y0, 0.34), 2)
