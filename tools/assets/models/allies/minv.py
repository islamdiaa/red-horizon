"""Allied anti-tank mine (laid by the Allied minelayer): an olive pressure-plate mine half buried in a patch of
disturbed earth, a carry handle, a yellow safety tab and the blinking arming light ('glow:arm'). The
procedural cloak shimmer (owner only) is kept.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'minv'
FACTION = 'allies'
KIND = 'defense'
ATLAS = 256


def build(m):
    setup(m, ao_dist=0.08, dirt_h=0.0)
    m.set_meta(footprint=(1, 1), height=0.12, radius=0.2, keep=['fx:add:66ccff:0.4'], snow=0.5)
    r = m.root
    dirt = tune(concrete(0x4a3b28, grime=0.4, streaks=0.0, wear=0.2, tex='rough_concrete', rough=0.98), ao=0.9)
    olive = tune(painted(0x4a5236, panels=None, wear=0.7, rust=0.4, grime=0.6, streaks=0.2, rough=0.6, metal=0.3), ao=0.85)
    olive_d = tune(painted(0x353b26, panels=None, wear=0.6, rust=0.4, grime=0.5, rough=0.6, metal=0.3), ao=0.85)
    lathe(r, dirt, [(0.2, 0.0), (0.15, 0.01), (0.06, 0.014), (0.0, 0.015)], (0, 0, 0), seg=12, scale=(1, 1, 0.85), cap_bottom=False)
    cyl(r, olive, 0.11, 0.035, (0, 0.022, 0), r2=0.12, seg=16, bevel=0.006)
    cyl(r, olive_d, 0.1, 0.01, (0, 0.044, 0), r2=0.095, seg=16)
    cyl(r, dark_m(), 0.04, 0.012, (0, 0.052, 0), r2=0.035, seg=12, bevel=0.002)
    cyl(r, metal(0x9aa2ab, rough=0.4), 0.012, 0.008, (0, 0.061, 0), seg=8)
    for k in range(6):
        a = k / 6 * math.pi * 2
        cyl(r, dark_m(), 0.006, 0.006, (math.cos(a) * 0.075, 0.051, math.sin(a) * 0.075), seg=6)
    lathe(r, dark_m(), [(0.03 + 0.005 * math.cos(t), 0.005 * math.sin(t)) for t in [i * math.pi / 3 for i in range(7)]],
          (0.112, 0.035, 0), seg=8, rot=(math.pi / 2, 0, 0), cap_top=False, cap_bottom=False)
    box(r, yellow(), (0.05, 0.004, 0.014), (-0.05, 0.05, 0.05), (0, 0.6, 0))
    stencil(m, r, 'AT', (0.02, 0.0505, -0.045), 0.025, facing='+y', color=0xe8b51a, depth=0.01)
    sphere(r, glow_material('glow:arm', 0xff2a1a), 0.008, (0.06, 0.052, -0.05), seg=6, rings=4)
    sphere(r, dirt, 0.05, (-0.1, 0.012, 0.06), seg=6, rings=3, scale=(1.4, 0.4, 1))
