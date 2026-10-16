"""Allied pillbox (1x1): a hexagonal white-washed concrete bunker with a team band, chamfered firing slits
glowing on every face, a machine gun out of the east slit (muzzle m0), a roof with a hatch, periscope, sandbag
ring and floodlight, a team hex band and a big 07 on the overhanging white roof cap, sandbags at the back.
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
    # overhanging white roof cap: a deep shadow line over the slits, and a bold painted top
    cap = tune(concrete(0xdcd8cd, joints=(0.3, 0.3), grime=0.5, streaks=0.6, wear=0.6), ao=0.8)
    cyl(r, cap, 0.44, 0.065, (0, Y0 + 0.2825, 0), seg=6, bevel=0.024)
    top = Y0 + 0.315
    # firing slits on every face (dark recess + warm glow inside), concrete hoods
    for i in range(6):
        a = i / 6 * math.pi * 2
        x, z = math.cos(a) * 0.343, -math.sin(a) * 0.343
        yaw = a + math.pi / 2
        box(r, black(), (0.17, 0.04, 0.03), (x, Y0 + 0.155, z), (0, yaw, 0))
        box(r, light_mat(0xffc27a, 1.2, 'flicker'), (0.13, 0.014, 0.006), (x * 0.985, Y0 + 0.155, z * 0.985), (0, yaw, 0))
    # machine gun out of the east slit
    cyl(r, gun_m(0x2a2d31), 0.009, 0.16, (0.38, Y0 + 0.155, 0.0), (0, 0, -math.pi / 2), seg=8)
    cyl(r, gun_m(0x2a2d31), 0.014, 0.035, (0.45, Y0 + 0.155, 0.0), (0, 0, -math.pi / 2), seg=8)
    m.muzzle('m0', (0.3, 0.19, 0), part='root')
    # roof: team hex band + a big stencilled number, hatch, periscope, sandbags at the back, floodlight, beacon
    m.decal(_hexring_img(), at=(0, top, 0), size=(0.8, 0.8), facing='+y', depth=0.02, team=1, rough=0.55)
    m.decal(_hexring_img(edge=True), at=(0, top, 0), size=(0.8, 0.8), facing='+y', depth=0.02, team=0, rough=0.55)
    big_text(m, r, '07', (-0.06, top, 0.1), 0.2, color=0x24272b, wear=0.25, depth=0.02)
    cyl(r, gun_m(0x2c3035), 0.07, 0.028, (0.1, top + 0.014, -0.04), seg=12, bevel=0.006)
    bar(r, metal(0x9aa2ab, rough=0.35), (0.04, top + 0.032, -0.04), (0.16, top + 0.032, -0.04), 0.012)
    box(r, dark_m(), (0.035, 0.08, 0.035), (-0.12, top + 0.04, -0.12), bevel=0.005)
    box(r, glass(0x2b4762), (0.03, 0.014, 0.004), (-0.12, top + 0.068, -0.101))
    for i in range(3):
        a = math.pi / 2 + (i - 1) * 0.55
        bx, bz = math.cos(a) * 0.29, -math.sin(a) * 0.29
        box(r, bag, (0.11, 0.05, 0.065), (bx, top + 0.025, bz), (0, a + math.pi / 2, 0), bevel=0.015)
    floodlight(r, (-0.2, top + 0.03, 0.18), yaw=0.6, pitch=0.6, s=0.045)
    light(r, (0.2, top + 0.01, 0.16), 0.016, 0xff2a1a, 'blink')
    stencil(m, r, 'PB-7', (0, Y0 + 0.1, 0.35), 0.05, color=0x2a2e34, depth=0.04)
    # sandbags at the back, a crate stack
    for (cx, cz, yaw) in ((-0.3, -0.36, 0.6), (0.32, -0.36, -0.6)):
        for k in range(3):
            t_ = (k - 1) * 0.105
            box(r, bag, (0.1, 0.05, 0.065), (cx + math.cos(yaw) * t_, Y0 + 0.025, cz - math.sin(yaw) * t_), (0, yaw, 0), bevel=0.015)
        for k in range(2):
            t_ = (k - 0.5) * 0.105
            box(r, bag, (0.1, 0.05, 0.065), (cx + math.cos(yaw) * t_, Y0 + 0.07, cz - math.sin(yaw) * t_), (0, yaw + 0.08, 0), bevel=0.015)
    crates(r, (-0.36, Y0, 0.3), 2, 0.07)


def _hexring_img(edge=False):
    """Hexagonal band near the roof edge (team grey fill) or just its thin white inner outline (edge=True)."""
    from kit import decals as _D
    from _allied import _imgs
    key = ('hexring', edge)
    if key in _imgs:
        return _imgs[key]
    px = 256
    cv = _D.Canvas(px, px, ss=2)
    c = px / 2

    def hexm(rad):
        pts = [(c + math.cos(i / 6 * math.pi * 2 + math.pi / 6) * rad, c + math.sin(i / 6 * math.pi * 2 + math.pi / 6) * rad) for i in range(6)]
        return cv.cover([((c, c), pts[i], pts[(i + 1) % 6]) for i in range(6)])
    if edge:
        cv.fill(hexm(px * 0.375) & ~hexm(px * 0.355), _D.lin(WHITE_TXT), 1.0)
    else:
        cv.fill(hexm(px * 0.47) & ~hexm(px * 0.375), _D.lin(0xdadada), 1.0)
    cv.roughen(0.15, seed=4)
    _imgs[key] = cv.image()
    return _imgs[key]
