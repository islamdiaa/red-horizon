"""Allied camo pillbox (1x1): a dug-in hexagonal bunker under layered camouflage netting with foliage clumps,
an earth berm, the embrasure lip with a faint glow and a machine gun (muzzle m0), sandbags and net poles.
Deliberately low-contrast (it hides); the procedural cloak shimmer effect is kept.
"""
import math
import os
import random
import sys

import mathutils

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'hbox'
FACTION = 'allies'
KIND = 'defense'
ATLAS = 512


def net_dome(p, mat, rad, h, seed, at=(0, 0, 0), yaw=0.0, seg=20, rings=6):
    """Irregular sagging dome (camo net over poles) built from a displaced lathe."""
    rnd = random.Random(seed)
    import bmesh
    from kit import shapes as _S

    def build(bm):
        rows = []
        for j in range(rings + 1):
            v = j / rings
            row = []
            for i in range(seg):
                a = 2 * math.pi * i / seg
                n = 1 + 0.12 * math.sin(a * 5 + seed) + 0.08 * math.sin(a * 9 + seed * 2.3) + 0.08 * math.sin(v * 7 + a * 3 + seed)
                sag = 1 - 0.18 * math.sin(v * math.pi) * (0.5 + 0.5 * math.cos(a * 4 + seed))
                rr = math.cos(v * math.pi / 2) * rad * n
                yy = math.sin(v * math.pi / 2) * h * sag
                row.append(bm.verts.new((math.cos(a) * rr, yy, -math.sin(a) * rr)))
            rows.append(row)
        for j in range(rings):
            for i in range(seg):
                k = (i + 1) % seg
                bm.faces.new((rows[j][i], rows[j][k], rows[j + 1][k], rows[j + 1][i]))
        vs = [v for row in rows for v in row]
        bmesh.ops.remove_doubles(bm, verts=vs, dist=1e-4)
        vs = [v for v in vs if v.is_valid]
        fs = list({f for v in vs for f in v.link_faces})
        for f in fs:
            f.normal_update()
            if f.normal.dot(f.calc_center_median()) < 0:
                f.normal_flip()
        return vs
    return _S._emit(p, mat, build, T(at, (0, yaw, 0)))


def build(m):
    setup(m, ao_dist=0.25)
    m.set_meta(footprint=(1, 1), height=0.32, radius=0.5, keep=['fx:add:66ccff:0.4'], snow=0.8)
    r = m.root

    conc = tune(concrete(0x6e6a5e, joints=(0.3, 0.12), grime=0.8, streaks=0.6, wear=0.6), ao=0.9)
    conc_l = tune(concrete(0x8a857a, grime=0.7, streaks=0.5, wear=0.6), ao=0.9)
    earth = tune(concrete(0x5a4a32, grime=0.5, streaks=0.0, wear=0.2, tex='rough_concrete', rough=0.98), ao=0.9)
    def netm(c):  # fine panel seams read as the net's mesh
        return tune(painted(c, panels=(0.022, 0.015), rivets=False, wear=0.0, rust=0.0, grime=0.5, streaks=0.2, rough=0.95, metal=0.0, var=0.25), ao=0.9)
    net, net_d, net_b = netm(0x5a6440), netm(0x3d452b), netm(0x6d5b3a)
    leaf = tune(painted(0x3f5a26, panels=None, wear=0.0, rust=0.0, grime=0.4, streaks=0.0, rough=0.9, metal=0.0), ao=0.9)
    leaf_l = tune(painted(0x5d7a32, panels=None, wear=0.0, rust=0.0, grime=0.4, streaks=0.0, rough=0.9, metal=0.0), ao=0.9)
    bag = tune(cloth(0x8f805c, grime=0.6), ao=0.85)
    wood = painted(0x6a5838, panels=None, wear=0.2, rust=0.0, rough=0.9, metal=0.0)

    # earth berm + the dug-in bunker
    lathe(r, earth, [(0.45, 0.0), (0.37, 0.06), (0.25, 0.1), (0.0, 0.11)], (0, -0.02, 0), seg=14, scale=(1, 1, 0.92), cap_bottom=False)
    hexp = [(math.cos(i / 6 * math.pi * 2 + math.pi / 6) * 0.3, math.sin(i / 6 * math.pi * 2 + math.pi / 6) * 0.3) for i in range(6)]
    prism(r, conc, hexp, 0.13, (0, 0.065, 0), (-math.pi / 2, 0, 0), bevel=0.02)
    # embrasure lip toward +x
    box(r, conc, (0.12, 0.09, 0.26), (0.33, 0.065, 0), bevel=0.016)
    box(r, conc_l, (0.13, 0.025, 0.28), (0.335, 0.12, 0), bevel=0.008)
    box(r, black(), (0.012, 0.032, 0.18), (0.392, 0.085, 0))
    box(r, light_mat(0xffc27a, 0.9, 'flicker'), (0.004, 0.01, 0.13), (0.398, 0.085, 0))
    cyl(r, gun_m(0x2a2d31), 0.008, 0.1, (0.43, 0.085, 0.03), (0, 0, -math.pi / 2), seg=8)
    m.muzzle('m0', (0.47, 0.085, 0.03), part='root')
    # netting layers + foliage clumps
    net_dome(r, net, 0.42, 0.24, 1.3)
    net_dome(r, net_d, 0.3, 0.27, 4.1, at=(-0.06, 0, 0.05), yaw=0.7)
    net_dome(r, net_b, 0.22, 0.25, 7.7, at=(0.08, 0, -0.1), yaw=2.1)
    for i in range(5):
        a = i / 5 * math.pi * 2 + 0.3
        cyl(r, wood, 0.007, 0.06, (math.cos(a) * 0.43, 0.03, math.sin(a) * 0.43), seg=5)
    leaves = [(0.26, 0.24, 0.09, 0), (-0.3, 0.18, 0.08, 1), (-0.1, -0.33, 0.07, 0), (0.05, 0.3, 0.06, 1), (-0.02, 0.0, 0.08, 1),
              (0.28, -0.25, 0.07, 0), (-0.36, -0.12, 0.06, 1), (0.12, -0.12, 0.07, 0), (-0.16, 0.12, 0.07, 0), (0.16, 0.1, 0.06, 1),
              (-0.22, -0.2, 0.06, 1)]
    for (x, z, s, k) in leaves:
        yy = 0.25 * math.sqrt(max(0.0, 1 - (math.hypot(x, z) / 0.44) ** 2))
        s *= 0.75
        sphere(r, leaf_l if k else leaf, s, (x, yy, z), seg=7, rings=4, scale=(1.4, 0.5, 1.2), rot=(x * 3, z * 4, 0))
        sphere(r, leaf if k else leaf_l, s * 0.7, (x + s * 0.7, yy + s * 0.15, z - s * 0.5), seg=7, rings=4, scale=(1.3, 0.55, 1.2))
    # sandbags flanking the embrasure
    for (cz, yaw) in ((0.24, -0.5), (-0.24, 0.5)):
        for k in range(2):
            t_ = (k - 0.5) * 0.105
            box(r, bag, (0.1, 0.05, 0.065), (0.36 + math.cos(yaw) * t_, 0.025, cz - math.sin(yaw) * t_), (0, yaw, 0), bevel=0.015)
        box(r, bag, (0.1, 0.05, 0.065), (0.36, 0.07, cz), (0, yaw + 0.1, 0), bevel=0.015)
