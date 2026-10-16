"""Allied mobile gap generator (mgg): team-painted tracked chassis with dark camouflage, two generator housings
with cooling fins, copper feeds and amber lamps, a turntable and the big spinning emitter dish (part 'dish';
the tilted bowl is part '_d' like the procedural rig) with a team inner face, struts and the purple emitter
('glow:gap'); the procedural haze ('fx') is kept. Pivots: node --import tsx tools/assets/rig.ts mgg.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = 'mgg'
FACTION = 'allies'
KIND = 'vehicle'


def build(m):
    m.set_meta(height=0.6, radius=0.4, snow=0.3, keep=['fx:add:b050ff:1'])
    r = m.root
    P = Pal('allies')
    copper = metal(0xb06a38, rough=0.35, rust=0.15, wear=0.3, metal=0.9)
    white = painted(0xd8d4c8, panels=None, wear=0.45, rust=0.05, grime=0.35, rough=0.5, metal=0.2, var=0.06)

    L, H, W, Z = 0.72, 0.125, 0.11, 0.2
    running_gear(m, r, P, L, H, W, Z, 5, wheel_k=0.4, rollers=0)
    box(r, P.dark, (0.64, 0.06, 0.3), (0, 0.08, 0), bevel=0.008)
    hull = [(-0.362, 0.092), (0.3, 0.092), (0.38, 0.142), (0.302, 0.238), (-0.358, 0.238)]
    side_prism(r, P.hull, hull, 0.37, bevel=0.017)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        fender(r, P.hull_flat, 0.74, 0.12, 0.13, Z * s, front=0.05, rear=0.04)
        camo(m, r, (-0.03, 0.17, 0.186 * s), (0.58, 0.11), f, seed=111 + s, n=3, colors=(0x6a6a6a,))
        number(m, r, '9', (0.2, 0.17, 0.1865 * s), 0.045, f)
        headlight(r, (0.362, 0.172, 0.13 * s), 0.016, guard=P.black)
        marker(r, (-0.366, 0.205, 0.15 * s), 0.011)
        # generator housings with fins, copper feeds, lamps
        box(r, P.dark2, (0.22, 0.072, 0.072), (-0.1, 0.272, 0.13 * s), bevel=0.012)
        for i in range(5):
            box(r, P.gun, (0.008, 0.062, 0.078), (-0.18 + i * 0.04, 0.272, 0.13 * s))
        cyl_between(r, copper, (0.0, 0.29, 0.13 * s), (0.07, 0.3, 0.04 * s), 0.009, 6)
        marker(r, (-0.2, 0.31, 0.13 * s), 0.012, AMBER, '+y', mode='pulse', strength=3.2)
    hull_shade(m, r, -0.37, 0.39, 0.238, 0.185, side_y=(0.1, 0.232), fenders=(0.74, 0.136, Z, 0.12, 0.0), deck=False)
    top_star(m, r, 'allies', (0.235, 0.239, 0.0), 0.1)
    deck_strips(m, r, -0.358, 0.302, 0.238, 0.185, width=0.016)
    fender_strips(m, r, 0.74, 0.255, 0.136, width=0.014)
    top_lamps(r, 0.28, -0.34, 0.238, 0.165, front=None)
    vent(m, r, (-0.27, 0.239, 0.0), (0.12, 0.12), facing='+y', slats=5, thick=0.008)
    tow_hooks(r, P, 0.38, 0.11, 0.1, 1)
    whip(r, P, (-0.33, 0.238, 0.16), 0.2, pennant=True)
    cyl(r, P.dark2, 0.026, 0.024, (0.24, 0.247, -0.1), seg=10, bevel=0.003)
    # turntable
    cyl(r, P.gun, 0.08, 0.04, (0.08, 0.258, 0), r2=0.07, seg=14, bevel=0.005)

    # ---- dish (spins) + tilted bowl
    d = m.part('dish', at=(0.08, 0.28, 0))
    cyl(d, P.dark, 0.02, 0.12, (0, 0.06, 0), r2=0.016, seg=8)
    box(d, P.gun, (0.05, 0.03, 0.04), (-0.03, 0.06, 0), bevel=0.006)
    b = m.part('_d', parent='dish', at=(0, 0.16, 0), rot=(0, 0, 0.5))
    lathe(b, white, [(0.0, 0.0), (0.07, 0.01), (0.13, 0.035), (0.172, 0.07), (0.166, 0.074), (0.128, 0.041), (0.069, 0.016), (0.0, 0.006)],
          (0, 0, 0), seg=18, cap_top=False, cap_bottom=False)
    # team-painted inner face: a thin closed lens lying on the concave side
    lathe(b, P.trim_flat, [(0.0, 0.0085), (0.068, 0.0185), (0.127, 0.0435), (0.163, 0.0755), (0.16, 0.0745), (0.124, 0.0415), (0.066, 0.0165), (0.0, 0.0065)],
          (0, 0, 0), seg=18, cap_top=False, cap_bottom=False)
    for i in range(3):
        a = i / 3 * 2 * PI
        cyl_between(b, P.black, (math.cos(a) * 0.15, 0.062, math.sin(a) * 0.15), (0, 0.17, 0), 0.004, 4)
    cyl(b, P.dark, 0.016, 0.03, (0, 0.18, 0), r2=0.012, seg=8)
    sphere(b, glow_material('glow:gap', 0xc070ff), 0.02, (0, 0.2, 0), seg=10, rings=6)
    for i in range(8):
        a = i / 8 * 2 * PI
        box(b, P.gun, (0.012, 0.01, 0.014), (math.cos(a) * 0.17, 0.072, math.sin(a) * 0.17), (0, -a, 0))
