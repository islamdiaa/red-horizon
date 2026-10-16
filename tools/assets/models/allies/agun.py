"""Allied AA gun (1x1): a round concrete revetment with a team band and sandbag rim, the traversing mount
(part 'turret': white armoured mount, team band, AA lettering, gunner seat, ammo boxes) and the elevating cradle (part
'elev', 0.95 rad) with twin long barrels (parts b0 / b1, muzzles m0 / m1).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'agun'
FACTION = 'allies'
KIND = 'defense'
ATLAS = 512  # small footprint: 512² already out-resolves the 3x3 structures' 1024²


def build(m):
    setup(m, ao_dist=0.25)
    m.set_meta(footprint=(1, 1), height=0.6, radius=0.5)
    r = m.root

    conc = tune(concrete(0xc0bcb1, joints=(0.3, 0.1), grime=0.7, streaks=0.9, wear=0.7), ao=0.85)
    armour = steel(0x8b96a1, panels=(0.12, 0.08), wear=0.7)
    armour_d = steel(0x6f7a85, panels=None, wear=0.7)
    tr = trim()
    bag = tune(cloth(0xa08f68, grime=0.6), ao=0.8)
    gm = gun_m(0x3a3f45)
    olive = painted(0x4f5a3a, panels=None, wear=0.6, rust=0.3)

    box(r, slab_m(0x8d887f), (0.96, Y0, 0.96), (0, Y0 / 2, 0), bevel=0.014)
    # revetment ring (outer wall) + team band + sandbags on the rim, the dark floor
    lathe(r, conc, [(0.44, 0.0), (0.43, 0.14), (0.4, 0.15), (0.33, 0.15), (0.32, 0.1), (0.32, 0.0)], (0, Y0, 0), seg=24, cap_top=False, cap_bottom=False)
    cyl(r, tr, 0.437, 0.03, (0, Y0 + 0.11, 0), r2=0.433, seg=24, caps=False)
    # the rim top painted in team colour: a bold ring from above
    lathe(r, tr, [(0.425, 0.0), (0.425, 0.006), (0.335, 0.006), (0.335, 0.0), (0.425, 0.0)], (0, Y0 + 0.15, 0), seg=24, cap_top=False, cap_bottom=False)
    for i in range(12):
        a = i / 12 * math.pi * 2
        box(r, bag, (0.09, 0.04, 0.055), (math.cos(a) * 0.375, Y0 + 0.17, math.sin(a) * 0.375), (0, -a + math.pi / 2, 0), bevel=0.013)
    cyl(r, dark_m(0x2e3135), 0.32, 0.02, (0, Y0 + 0.01, 0), seg=24)
    m.decal(_floor_img(), at=(0, Y0 + 0.02, 0), size=(0.62, 0.62), facing='+y', depth=0.01, team=0, rough=0.6)
    m.decal(haz_img(9), at=(0, Y0 + 0.07, 0.441), size=(0.3, 0.035), facing='+z', depth=0.03, team=0)
    for i in range(4):
        a = i / 4 * math.pi * 2 + math.pi / 4
        box(r, olive, (0.08, 0.05, 0.06), (math.cos(a) * 0.24, Y0 + 0.045, math.sin(a) * 0.24), (0, -a, 0), bevel=0.01)
    light(r, (0.3, Y0 + 0.19, -0.3), 0.015, 0xff2a1a, 'blink')
    crates(r, (0.36, Y0, 0.36), 2, 0.07)

    # ---- traversing mount
    t = m.part('turret', at=(0, 0.09, 0))
    cyl(t, gun_m(0x4a5058), 0.22, 0.06, (0, 0.03, 0), r2=0.2, seg=18, bevel=0.008)
    box(t, white(panels=(0.1, 0.08)), (0.2, 0.16, 0.3), (-0.03, 0.14, 0), bevel=0.028)
    box(t, tr, (0.206, 0.04, 0.306), (-0.03, 0.18, 0), bevel=0.007)
    box(t, armour_d, (0.035, 0.19, 0.34), (0.08, 0.18, 0), bevel=0.012)
    big_text(m, t, 'AA', (-0.06, 0.22, 0.0), 0.08, color=0x24272b, roll=math.pi / 2, depth=0.015)
    box(t, dark_m(), (0.05, 0.04, 0.05), (-0.1, 0.2, 0.14), bevel=0.01)
    box(t, dark_m(), (0.02, 0.06, 0.02), (-0.05, 0.25, 0.14), bevel=0.004)
    box(t, olive, (0.06, 0.06, 0.05), (-0.04, 0.09, -0.16), bevel=0.008)
    box(t, olive, (0.06, 0.06, 0.05), (-0.04, 0.09, 0.16), bevel=0.008)
    light(t, (-0.12, 0.215, -0.1), 0.01, 0xff2a1a, 'blink')
    # ---- elevating cradle with the twin barrels
    e = m.part('elev', parent='turret', at=(0.02, 0.18, 0), rot=(0, 0, 0.95))
    box(e, gm, (0.13, 0.065, 0.17), (0.0, 0, 0), bevel=0.016)
    box(e, armour_d, (0.06, 0.05, 0.08), (-0.08, 0.0, 0), bevel=0.01)
    for (i, z) in ((0, -0.055), (1, 0.055)):
        b = m.part(f'b{i}', parent='elev', at=(0.04, 0.0, z))
        barrel(b, gm, 0.38, 0.021)
        cyl(b, armour_d, 0.03, 0.06, (0.05, 0, 0), (0, 0, -math.pi / 2), seg=10, bevel=0.004)
        cyl(b, tr, 0.024, 0.025, (0.16, 0, 0), (0, 0, -math.pi / 2), seg=10, caps=False)
        m.muzzle(f'm{i}', (0.42, 0, z), part='elev')


def _floor_img():
    """Painted floor of the gun pit: a yellow ring with four tick marks (transparent elsewhere)."""
    from kit import decals as _D
    from _allied import _imgs
    if 'aafloor' in _imgs:
        return _imgs['aafloor']
    px = 256
    cv = _D.Canvas(px, px, ss=2)
    c = px / 2
    cv.circle(c, c, px * 0.47, _D.lin(HAZ_Y), r_in=px * 0.42)
    for kk in range(4):
        a = kk * math.pi / 2 + math.pi / 4
        x, y = c + math.cos(a) * px * 0.36, c + math.sin(a) * px * 0.36
        cv.circle(x, y, px * 0.035, _D.lin(HAZ_Y))
    cv.roughen(0.3, seed=19)
    _imgs['aafloor'] = cv.image()
    return _imgs['aafloor']
