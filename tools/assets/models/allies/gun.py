"""Allied turret (1x1): an octagonal concrete emplacement with a hazard band and a steel ring, the faceted
armoured turret (animated part 'turret', team band, star, hatch, vision block) with the long cannon (part
'b0', recoils along -x; muzzle m0), sandbags, drums and warning lights.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'gun'
FACTION = 'allies'
KIND = 'defense'
ATLAS = 512  # small footprint: 512² already out-resolves the 3x3 structures' 1024²


def octp(rad, rot=math.pi / 8):
    return [(math.cos(i / 8 * math.pi * 2 + rot) * rad, math.sin(i / 8 * math.pi * 2 + rot) * rad) for i in range(8)]


def build(m):
    setup(m, ao_dist=0.25)
    m.set_meta(footprint=(1, 1), height=0.5, radius=0.5)
    r = m.root

    conc = tune(concrete(0xc0bcb1, joints=(0.3, 0.1), grime=0.7, streaks=0.9, wear=0.7), ao=0.85)
    armour = steel(0x8b96a1, panels=(0.12, 0.08), wear=0.7)
    armour_d = steel(0x6f7a85, panels=None, wear=0.7)
    tr = trim()
    frm = frame()
    bag = tune(cloth(0xa08f68, grime=0.6), ao=0.8)
    gm = gun_m(0x3a3f45)

    box(r, slab_m(0x8d887f), (0.96, Y0, 0.96), (0, Y0 / 2, 0), bevel=0.014)
    prism(r, conc, octp(0.42), 0.18, (0, Y0 + 0.09, 0), (-math.pi / 2, 0, 0), bevel=0.03)
    prism(r, gun_m(0x4a5058), octp(0.34), 0.05, (0, Y0 + 0.205, 0), (-math.pi / 2, 0, 0), bevel=0.01)
    hazard_band(m, r, (0, Y0 + 0.1, 0.389), (0.3, 0.04))
    cyl(r, dark_m(), 0.22, 0.03, (0, Y0 + 0.245, 0), r2=0.21, seg=20)
    for i in range(8):
        a = i / 8 * math.pi * 2 + math.pi / 8
        cyl(r, metal(0x9aa2ab, rough=0.35), 0.01, 0.01, (math.cos(a) * 0.3, Y0 + 0.234, math.sin(a) * 0.3), seg=6)
    light(r, (0.36, Y0 + 0.19, -0.22), 0.016, 0xff2a1a, 'blink')
    light(r, (-0.32, Y0 + 0.19, 0.2), 0.015, 0xff2a1a, 'blink')
    for k in range(3):
        box(r, bag, (0.1, 0.05, 0.065), (-0.3 + k * 0.06, Y0 + 0.025 + (k % 2) * 0.0, 0.38 - k * 0.03), (0, 0.4, 0), bevel=0.015)
    box(r, bag, (0.1, 0.05, 0.065), (-0.27, Y0 + 0.07, 0.37), (0, 0.45, 0), bevel=0.015)
    drums(r, (0.34, Y0, 0.3), 2)

    # ---- turret (rotates about y; barrel along +x)
    t = m.part('turret', at=(0, 0.31, 0))
    body = [(0.2, -0.1), (0.2, 0.1), (0.08, 0.2), (-0.16, 0.2), (-0.24, 0.12), (-0.24, -0.12), (-0.16, -0.2), (0.08, -0.2)]
    prism(t, armour, body, 0.13, (0, 0.065, 0), (-math.pi / 2, 0, 0), bevel=0.022)
    prism(t, tr, [(x * 1.03, z * 1.03) for (x, z) in body], 0.03, (0, 0.085, 0), (-math.pi / 2, 0, 0), bevel=0.004)
    top_ = [(0.1, -0.12), (0.1, 0.12), (-0.14, 0.13), (-0.18, 0.08), (-0.18, -0.08), (-0.14, -0.13)]
    prism(t, armour_d, top_, 0.035, (0, 0.145, 0), (-math.pi / 2, 0, 0), bevel=0.01)
    box(t, gm, (0.08, 0.09, 0.13), (0.21, 0.065, 0), bevel=0.016)
    cyl(t, dark_m(), 0.038, 0.016, (-0.08, 0.17, 0.06), seg=12, bevel=0.004)
    box(t, dark_m(), (0.035, 0.025, 0.055), (0.05, 0.168, -0.08), bevel=0.004)
    box(t, glass(0x2b4762), (0.004, 0.014, 0.045), (0.068, 0.168, -0.08))
    roundel(m, t, (-0.06, 0.1635, -0.035), 0.075, facing='+y', depth=0.02)
    for s in (-1, 1):
        roundel(m, t, (-0.05, 0.07, s * 0.2), 0.07, facing='+z' if s > 0 else '-z', depth=0.03)
    light(t, (-0.2, 0.16, 0.08), 0.01, 0xff2a1a, 'blink')
    b = m.part('b0', parent='turret', at=(0.23, 0.065, 0))
    barrel(b, gm, 0.38, 0.02)
    cyl(b, armour_d, 0.032, 0.06, (0.06, 0, 0), (0, 0, -math.pi / 2), seg=10)
    m.muzzle('m0', (0.62, 0.065, 0), part='turret')
