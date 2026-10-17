"""Soviet ore smelter (2x2, Commander rules): a riveted blast furnace with a glowing tap hole and a molten runner,
its top gear, downcomer and dust catcher, a skip hoist up from the ore bin, a banded red-crowned stack (smoke0), a
casting house with the STEEL FOR VICTORY board, a banner and the molten glow in its bay (steam0), ingot stacks and
a ladle of melt. Layout and pivots: src/render/models/commander-structures.ts oreSmelter().
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _cmd import *  # noqa: E402,F401,F403

ID = 'smlt'
FACTION = 'soviet'
KIND = 'structure'
ATLAS = 512

MOLTEN = 0xff6a18


def build(m):
    D = Dress('soviet')
    P = D.P
    D.look(m, ao_dist=0.36)
    m.set_meta(footprint=(2, 2), height=1.6, radius=1.05)
    r = m.root

    SV.foundation(m, r, P, 2.0, 2.0)
    slab(r, P.tar, 0.2, 0.98, Y0, Y0 + 0.01, 0.4, 0.98)

    # ---- blast furnace (back left)
    fx, fzz = -0.42, -0.42
    box(r, P.conc_dk, (0.8, 0.18, 0.8), (fx, Y0 + 0.09, fzz), bevel=0.02)
    shell = SV.deep(painted(0x4a5058, panels=(0.18, 0.12), wear=0.7, grime=0.8, rust=0.45, streaks=1.0, rivets=True,
                            soot=(Y0 + 0.9, Y0 + 1.2)), 0.85)
    lathe(r, shell, [(0.335, 0.0), (0.345, 0.22), (0.305, 0.5), (0.245, 0.86), (0.205, 1.0)], (fx, Y0 + 0.18, fzz), seg=20)
    for (y, rr) in ((0.2, 0.35), (0.46, 0.315), (0.72, 0.275)):
        cyl(r, P.frame, rr, 0.03, (fx, Y0 + 0.18 + y, fzz), seg=20, caps=False)
    cyl(r, P.trim, 0.296, 0.06, (fx, Y0 + 0.18 + 0.58, fzz), r2=0.316, seg=20, caps=False)
    torus(r, P.rust, 0.38, 0.035, (fx, Y0 + 0.36, fzz), seg=20, tseg=8)
    for k in range(8):  # tuyeres from the bustle ring into the hearth
        a = k / 8 * math.pi * 2
        bar(r, P.rust, (fx + math.cos(a) * 0.38, Y0 + 0.36, fzz + math.sin(a) * 0.38), (fx + math.cos(a) * 0.33, Y0 + 0.26, fzz + math.sin(a) * 0.33), 0.022)
    # top gear: platform, charging house, uptakes, the downcomer to the dust catcher
    ft = Y0 + 1.18
    cyl(r, P.steel, 0.245, 0.06, (fx, ft + 0.03, fzz), r2=0.225, seg=16, bevel=0.006)
    box(r, P.wall_dk, (0.2, 0.16, 0.2), (fx, ft + 0.14, fzz), bevel=0.012)
    box(r, P.roof, (0.24, 0.025, 0.24), (fx, ft + 0.23, fzz), bevel=0.006)
    for (dx, dz) in ((-0.15, -0.12), (0.15, -0.12)):
        cyl_between(r, P.steel, (fx + dx, ft, fzz + dz), (fx + dx * 0.4, ft + 0.38, fzz + dz * 0.4), 0.034)
    pipe_run(r, P.rust, [(fx - 0.06, ft + 0.36, fzz - 0.05), (fx - 0.06, ft + 0.45, fzz - 0.05), (-0.92, ft + 0.45, fzz - 0.05), (-0.92, Y0 + 0.42, fzz - 0.05)], 0.04)
    cyl(r, P.wall_lt, 0.09, 0.32, (-0.92, Y0 + 0.25, fzz - 0.05), seg=12)
    lathe(r, P.wall_dk, [(0.09, 0.0), (0.04, 0.08), (0.0, 0.09)], (-0.92, Y0 + 0.41, fzz - 0.05), seg=12)
    rail_rect(r, P.rail, fx - 0.24, fzz - 0.24, fx + 0.24, fzz + 0.24, ft + 0.06, h=0.07, post=0.12, sides='s')
    SV.lamp(r, (fx + 0.12, ft + 0.255, fzz + 0.12), 0.018)
    # tap hole facing the camera: glowing mouth and the molten runner into the casting house
    box(r, P.void, (0.2, 0.14, 0.06), (fx, Y0 + 0.26, fzz + 0.33))
    box(r, light_mat(MOLTEN, 3.2, 'flicker'), (0.14, 0.09, 0.006), (fx, Y0 + 0.26, fzz + 0.363))
    box(r, P.conc_dk, (0.1, 0.04, 0.44), (fx, Y0 + 0.2, fzz + 0.55), bevel=0.006)
    box(r, light_mat(MOLTEN, 3.0, 'flicker'), (0.05, 0.004, 0.4), (fx, Y0 + 0.222, fzz + 0.55))

    # ---- stack (back right)
    box(r, P.conc_dk, (0.34, 0.08, 0.34), (0.55, Y0 + 0.04, -0.62), bevel=0.012)
    SV.stack(m, r, P, (0.55, Y0 + 0.08, -0.62), 1.47, 0.14, name='smoke0', r_top=0.1, lights=4, base=False, seg=18)
    pipe_run(r, P.rust, [(fx + 0.24, ft + 0.3, fzz), (0.4, ft + 0.3, fzz), (0.4, ft + 0.3, -0.62), (0.44, ft + 0.3, -0.62)], 0.04)

    # ---- ore bin + skip hoist up to the furnace top
    bx, bz = 0.62, 0.12
    box(r, P.wall_dk, (0.42, 0.24, 0.4), (bx, Y0 + 0.12, bz), bevel=0.016)
    lathe(r, P.wall_lt, [(0.08, 0.0), (0.18, 0.12), (0.19, 0.16)], (bx, Y0 + 0.24, bz), seg=4, rot=(0, math.pi / 4, 0), cap_top=False)
    ore_pile(r, (bx, Y0 + 0.3, bz), 0.12, 0.06, 5, seed=5)
    hazard_stripes(m, r, (bx, Y0 + 0.1, bz + 0.202), (0.38, 0.04))
    a = (bx - 0.12, Y0 + 0.3, bz - 0.1)
    b = (fx + 0.12, ft + 0.18, fzz + 0.02)
    bar(r, P.wall_dk, a, b, 0.12, 0.05)
    for s in (-1, 1):
        from mathutils import Vector
        va, vb = Vector(a), Vector(b)
        side = Vector((-(vb.z - va.z), 0, vb.x - va.x)).normalized() * 0.06 * s
        bar(r, P.frame, tuple(va + side + Vector((0, 0.04, 0))), tuple(vb + side + Vector((0, 0.04, 0))), 0.012, 0.05)
    for f in (0.3, 0.65):
        px_ = a[0] + (b[0] - a[0]) * f
        py_ = a[1] + (b[1] - a[1]) * f
        pz_ = a[2] + (b[2] - a[2]) * f
        bar(r, P.frame, (px_, Y0, pz_), (px_, py_ - 0.03, pz_), 0.028)

    # ---- casting house (front left): ribbed shed, open bay with the melt glow, board, banner
    cx, cz = -0.36, 0.56
    ctop, cfz = SV.hall(r, P, cx, cz, 0.96, 0.66, 0.38, wall=P.wall, plinth=0.1, parapet=0.04)
    SV.pilasters(r, P.frame, [cx - 0.45, cx - 0.04, cx + 0.45], cfz, Y0 + 0.1, ctop - 0.07, w=0.05, dz=0.035)
    box(r, P.void, (0.36, 0.22, 0.02), (cx + 0.2, Y0 + 0.11, cfz + 0.004))
    box(r, light_mat(MOLTEN, 3.0, 'flicker'), (0.3, 0.06, 0.006), (cx + 0.2, Y0 + 0.05, cfz + 0.016))
    box(r, light_mat(0xff8a30, 1.2, 'flicker'), (0.3, 0.14, 0.004), (cx + 0.2, Y0 + 0.15, cfz + 0.015))
    sign(m, r, (cx - 0.22, Y0 + 0.25, cfz + 0.03), (0.4, 0.17), 'STEEL FOR|VICTORY', board=P.board, lights=2)
    SV.red_banner(m, r, (cx + 0.2, ctop - 0.06, cfz + 0.03), (0.16, 0.24))
    roof_vent(r, (cx - 0.2, ctop + 0.02, cz - 0.1), 0.04)
    roof_vent(r, (cx + 0.22, ctop + 0.02, cz - 0.12), 0.04)
    m.steam('steam0', (cx + 0.22, ctop + 0.12, cz - 0.12))
    SV.roof_lights(r, cx - 0.44, cz - 0.3, cx + 0.44, cfz - 0.03, ctop + 0.03, r=0.018)
    stencil(m, r, '07', (cx - 0.36, Y0 + 0.09, cfz + 0.002), 0.06, color=0xe8b434)
    # ingot stacks (bright steel) and a ladle of melt on the apron
    ingot = metal(0x8a9098, rough=0.3, rust=0.1)
    for k in range(2):
        for i in range(3):
            box(r, ingot, (0.12, 0.028, 0.05), (0.34 + k * 0.2, Y0 + 0.014 + i * 0.028, 0.74 + (i % 2) * 0.02), (0, math.pi / 2 if i % 2 else 0, 0), bevel=0.006)
    lathe(r, P.dark, [(0.0, 0.0), (0.07, 0.01), (0.09, 0.09), (0.1, 0.1), (0.085, 0.1), (0.075, 0.03)], (0.82, Y0, 0.62), seg=12, cap_top=False)
    cyl(r, light_mat(MOLTEN, 3.0, 'flicker'), 0.082, 0.004, (0.82, Y0 + 0.094, 0.62), seg=12)
    SV.lamp_post(r, P, (0.9, Y0, 0.9), 0.38, yaw=math.pi / 2)
