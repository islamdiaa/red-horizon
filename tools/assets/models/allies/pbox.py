"""Allied pillbox (1x1): a hexagonal white-washed concrete bunker with a team band, chamfered firing slits
glowing on every face, a machine gun out of the east slit (muzzle m0), a roof with a hatch, periscope, sandbag
ring and floodlight, a star roundel on the front and sandbags at the back.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'pbox'
FACTION = 'allies'
KIND = 'defense'
ATLAS = 512  # small footprint: 512² already out-resolves the 3x3 structures' 1024²


def hexp(rad, rot=math.pi / 6):
    return [(math.cos(i / 6 * math.pi * 2 + rot) * rad, math.sin(i / 6 * math.pi * 2 + rot) * rad) for i in range(6)]


def build(m):
    setup(m, ao_dist=0.25)
    m.set_meta(footprint=(1, 1), height=0.4, radius=0.5)
    r = m.root

    conc = tune(concrete(0xc9c5ba, joints=(0.3, 0.12), grime=0.7, streaks=0.9, wear=0.7), ao=0.85)
    conc2 = slab_m(0x9a958c)
    tr = trim()
    frm = frame()
    bag = tune(cloth(0xa08f68, grime=0.6), ao=0.8)

    box(r, slab_m(0x8d887f), (0.96, Y0, 0.96), (0, Y0 / 2, 0), bevel=0.014)
    # bunker body (y up prisms)
    prism(r, conc2, hexp(0.43), 0.05, (0, Y0 + 0.025, 0), (-math.pi / 2, 0, 0), bevel=0.012)
    prism(r, conc, hexp(0.4), 0.2, (0, Y0 + 0.05 + 0.1, 0), (-math.pi / 2, 0, 0), bevel=0.03)
    prism(r, tr, hexp(0.385), 0.03, (0, Y0 + 0.235, 0), (-math.pi / 2, 0, 0), bevel=0.006)
    cyl(r, conc, 0.35, 0.06, (0, Y0 + 0.28, 0), seg=6, bevel=0.022)  # create_cone starts at +y: already aligned with the body
    top = Y0 + 0.31
    # firing slits on every face (dark recess + warm glow inside), concrete hoods
    for i in range(6):
        a = i / 6 * math.pi * 2
        x, z = math.cos(a) * 0.343, -math.sin(a) * 0.343
        yaw = a + math.pi / 2
        box(r, black(), (0.17, 0.04, 0.03), (x, Y0 + 0.155, z), (0, yaw, 0))
        box(r, light_mat(0xffc27a, 1.2, 'flicker'), (0.13, 0.014, 0.006), (x * 0.985, Y0 + 0.155, z * 0.985), (0, yaw, 0))
        box(r, conc2, (0.2, 0.02, 0.05), (x * 1.04, Y0 + 0.185, z * 1.04), (0, yaw, 0), bevel=0.006)
    # machine gun out of the east slit
    cyl(r, gun_m(0x2a2d31), 0.009, 0.16, (0.38, Y0 + 0.155, 0.0), (0, 0, -math.pi / 2), seg=8)
    cyl(r, gun_m(0x2a2d31), 0.014, 0.035, (0.45, Y0 + 0.155, 0.0), (0, 0, -math.pi / 2), seg=8)
    m.muzzle('m0', (0.3, 0.19, 0), part='root')
    # roof: hatch, periscope, sandbag ring, floodlight, beacon
    cyl(r, gun_m(), 0.065, 0.025, (0.08, top + 0.012, 0.06), seg=12, bevel=0.005)
    bar(r, gun_m(), (0.02, top + 0.03, 0.06), (0.14, top + 0.03, 0.06), 0.012)
    box(r, dark_m(), (0.03, 0.07, 0.03), (-0.1, top + 0.035, -0.08), bevel=0.004)
    box(r, glass(0x2b4762), (0.026, 0.012, 0.004), (-0.1, top + 0.06, -0.064))
    for i in range(6):
        a = i / 6 * math.pi * 2 + 0.5
        bx, bz = math.cos(a) * 0.27, -math.sin(a) * 0.27
        box(r, bag, (0.1, 0.045, 0.06), (bx, top + 0.022, bz), (0, a + math.pi / 2, 0), bevel=0.014)
    floodlight(r, (-0.14, top + 0.03, 0.16), yaw=0.6, pitch=0.6, s=0.04)
    light(r, (0.15, top + 0.01, -0.14), 0.013, 0xff2a1a, 'blink')
    roundel(m, r, (0, Y0 + 0.11, 0.35), 0.11, depth=0.05)
    # sandbags at the back, a crate stack
    for (cx, cz, yaw) in ((-0.3, -0.36, 0.6), (0.32, -0.36, -0.6)):
        for k in range(3):
            t_ = (k - 1) * 0.105
            box(r, bag, (0.1, 0.05, 0.065), (cx + math.cos(yaw) * t_, Y0 + 0.025, cz - math.sin(yaw) * t_), (0, yaw, 0), bevel=0.015)
        for k in range(2):
            t_ = (k - 0.5) * 0.105
            box(r, bag, (0.1, 0.05, 0.065), (cx + math.cos(yaw) * t_, Y0 + 0.07, cz - math.sin(yaw) * t_), (0, yaw + 0.08, 0), bevel=0.015)
    crates(r, (-0.36, Y0, 0.3), 2, 0.07)
