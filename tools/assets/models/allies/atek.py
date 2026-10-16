"""Allied tech centre (2x2): a stepped white research block with a glass curtain wall (cool lab light), the set
back laboratory floor with lit windows and the RESEARCH sign, a white observatory dome with a slit and a team
ring, the rotating satellite dish (animated part 'dish'), an antenna array, a roof roundel, floodlights, an
eagle banner and gas cylinders in the yard.
"""
import math
import os
import sys

import mathutils

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'atek'
FACTION = 'allies'
KIND = 'structure'


def build(m):
    setup(m)
    m.set_meta(footprint=(2, 2), height=1.15, radius=1.05)
    r = m.root

    wall = white()
    wall2 = offwhite()
    frm = frame()
    tr = trim()
    rf = roof()
    rail = rail_m()

    box(r, slab_m(0x9d988e), (1.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)
    box(r, asphalt(), (0.5, 0.01, 0.36), (0.56, Y0 + 0.005, 0.76), bevel=0.003)

    # ---- lower block with the glass curtain wall
    bx, bz, bw, bd, bh = 0.0, -0.12, 1.66, 1.2, 0.46
    fz = bz + bd / 2
    top = block(m, r, bx, bz, bw, bd, bh, wall=wall, cornice=tr, roof_m=rf, cap=frm, pilasters=(-bw / 2 + 0.03, bw / 2 - 0.03),
                side_pilasters=(bz - 0.3, bz + 0.3), cornice_h=0.06)
    rt = Y0 + bh
    gw, gh = 1.36, 0.27
    glazing(m, r, (-0.08, Y0 + 0.235, fz + 0.004), (gw, gh), 9, lit={0, 1, 3, 4, 6, 8}, color=0xa6e4ff, emit=0.85)
    for i in range(10):
        x = -0.08 - gw / 2 + i * gw / 9
        box(r, frm, (0.022, gh + 0.02, 0.03), (x, Y0 + 0.235, fz + 0.015), bevel=0.004)
    box(r, frm, (gw + 0.03, 0.022, 0.035), (-0.08, Y0 + 0.235 + gh / 2 + 0.01, fz + 0.016), bevel=0.004)
    box(r, frm, (gw + 0.03, 0.016, 0.03), (-0.08, Y0 + 0.235, fz + 0.016))
    lit_doorway(m, r, (0.7, Y0, fz), (0.14, 0.24))
    hazard_band(m, r, (-0.08, Y0 + 0.07, fz + 0.022), (gw, 0.04))
    eagle_banner(m, r, (-0.73, top - 0.08, fz + 0.03), (0.17, 0.36))
    for x in (-bw / 2 + 0.06, bw / 2 - 0.06):
        floodlight(r, (x, top + 0.03, fz - 0.03), yaw=0.0, pitch=0.8, s=0.05)
    roundel(m, r, (-0.5, rt + 0.016, 0.24), 0.36, facing='+y', plate=steel(0x7d8792, panels=None))
    ac_unit(r, (0.52, rt + 0.016, 0.18), 0.1)

    # ---- upper laboratory floor (set back)
    ux, uz, uw, ud, uh = -0.22, -0.3, 1.0, 0.74, 0.34
    box(r, wall2, (uw, uh, ud), (ux, rt + uh / 2, uz), bevel=0.016)
    box(r, tr, (uw + 0.04, 0.04, ud + 0.04), (ux, rt + uh - 0.01, uz), bevel=0.008)
    box(r, rf, (uw - 0.02, 0.02, ud - 0.02), (ux, rt + uh + 0.012, uz))
    utop = rt + uh + 0.022
    ufz = uz + ud / 2
    glazing(m, r, (ux, rt + 0.17, ufz + 0.004), (0.86, 0.13), 5, lit={0, 2, 3}, color=0xa6e4ff, emit=0.85)
    lit_sign(m, r, (ux, rt + 0.04, ufz + 0.035), (0.5, 0.075), 'RESEARCH', lights=0, emblem_kind=None)
    for x in (ux - uw / 2 + 0.02, ux + uw / 2 - 0.02):
        box(r, frm, (0.04, uh - 0.03, 0.04), (x, rt + (uh - 0.03) / 2, ufz), bevel=0.006)
    # antenna array, a small dish, a beacon
    for i in range(3):
        h = 0.25 + i * 0.07
        cyl(r, dark_m(), 0.008, h, (ux + 0.12 + i * 0.12, utop + h / 2, uz + 0.1), r2=0.004, seg=6)
        for k in range(2):
            bar(r, dark_m(), (ux + 0.12 + i * 0.12 - 0.035, utop + h * (0.55 + 0.25 * k), uz + 0.1), (ux + 0.12 + i * 0.12 + 0.035, utop + h * (0.55 + 0.25 * k), uz + 0.1), 0.005)
        light(r, (ux + 0.12 + i * 0.12, utop + h, uz + 0.1), 0.009, 0xff2a1a, 'blink')
    dish(r, (ux + 0.3, utop, uz - 0.18), 0.08, mat=white(panels=None), yaw=-0.6, pitch=0.6)
    light(r, (ux + 0.46, utop + 0.01, uz - 0.33), 0.016, 0xff2a1a, 'blink')
    rail_rect(r, rail, ux - uw / 2 + 0.03, uz - ud / 2 + 0.03, ux + uw / 2 - 0.03, uz + ud / 2 - 0.03, utop, h=0.05, post=0.15, sides='s')

    # ---- the rotating satellite dish
    d = m.part('dish', at=(ux - 0.3, 0.855, uz - 0.1))
    cyl(d, gun_m(), 0.03, 0.12, (0, 0.06, 0), r2=0.02, seg=10)
    rot = (0.0, 0.0, 1.0)
    F = T((0.03, 0.15, 0), rot)
    o = tuple(F @ mathutils.Vector((0, 0, 0)))
    lathe(d, white(panels=None, grime=0.45), [(0.0, 0.0), (0.08, 0.012), (0.15, 0.04), (0.2, 0.075), (0.205, 0.085), (0.19, 0.08), (0.14, 0.05), (0.07, 0.024), (0.0, 0.014)], o, seg=18,
          rot=rot, cap_top=False, cap_bottom=False)  # closed shell: both faces visible
    lathe(d, tr, [(0.2, 0.07), (0.212, 0.08), (0.212, 0.092), (0.198, 0.088)], o, seg=18, rot=rot, cap_top=False, cap_bottom=False)
    tip = tuple(F @ mathutils.Vector((0, 0.17, 0)))
    for k in range(3):
        a = k / 3 * math.pi * 2
        bar(d, dark_m(), tuple(F @ mathutils.Vector((math.cos(a) * 0.13, 0.04, math.sin(a) * 0.13))), tip, 0.005)
    sphere(d, gun_m(), 0.018, tip, seg=8, rings=5)

    # ---- observatory dome (right back)
    ox, oz = 0.52, -0.42
    cyl(r, wall2, 0.27, 0.11, (ox, rt + 0.055, oz), seg=24, bevel=0.008)
    cyl(r, tr, 0.275, 0.035, (ox, rt + 0.095, oz), seg=24, caps=False)
    dome(r, white(panels=(0.08, 0.07), grime=0.45, streaks=0.7), 0.265, (ox, rt + 0.11, oz), seg=24, rings=7)
    # the slit: a dark band over the crown + a lit strip inside, facing the camera
    m.decal(solid(0x1b1d20), at=(ox, rt + 0.35, oz + 0.1), size=(0.08, 0.36), facing='+y', depth=0.22, team=0, rough=0.5)
    m.decal(solid(0xa6e4ff), at=(ox, rt + 0.35, oz + 0.1), size=(0.03, 0.32), facing='+y', depth=0.22, team=0, rough=0.3, emit=0.9)
    roundel(m, r, (ox, rt + 0.2, oz + 0.262), 0.13, depth=0.04)
    strobe(r, (ox + 0.2, rt + 0.13, oz + 0.18), r=0.012)

    # ---- yard: gas cylinders, crates
    for x in (-0.85, -0.74):
        cyl(r, white(panels=None), 0.045, 0.2, (x, Y0 + 0.1, 0.78), seg=12)
        sphere(r, white(panels=None), 0.045, (x, Y0 + 0.2, 0.78), seg=10, rings=5)
        cyl(r, tr, 0.048, 0.02, (x, Y0 + 0.14, 0.78), seg=12, caps=False)
    crates(r, (0.8, Y0, 0.78), 2, 0.09)
    lamp_post(r, (0.3, Y0, 0.86), 0.38, yaw=math.pi)
