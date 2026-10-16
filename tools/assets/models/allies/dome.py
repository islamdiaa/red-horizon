"""Allied radar dome (2x2): a bold white radar tower (octagonal concrete shaft, team band, lit window slits) on a
heavy plinth, a platform ring with railings and a ring of red / white lights, and the crisp geodesic radome
(flat-shaded facets with baked panel seams, a team base band, star roundels, a beacon); the operations block in
front (lit window band, RADAR CONTROL sign, eagle banner, R-2 roof lettering, antennas) and the rotating search
dish on its pedestal (animated part 'dish').
"""
import math
import os
import sys

import mathutils

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'dome'
FACTION = 'allies'
KIND = 'structure'


def build(m):
    setup(m)
    m.set_meta(footprint=(2, 2), height=1.75, radius=1.05)
    r = m.root

    wall = white()
    frm = frame()
    tr = trim()
    rf = roof()
    stl = steel()
    rail = rail_m()
    PL = steel(0x7d8792, panels=None)

    box(r, slab_m(0x9d988e), (1.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)

    # ---- operations block across the front
    bx, bz, bw, bd, bh = -0.12, 0.42, 1.56, 0.84, 0.5
    fz = bz + bd / 2
    top = block(m, r, bx, bz, bw, bd, bh, wall=wall, cornice=tr, roof_m=rf, cap=frm,
                pilasters=(bx - bw / 2 + 0.03, bx - 0.46, bx + 0.38, bx + bw / 2 - 0.03), side_pilasters=(bz - 0.2, bz + 0.2), cornice_h=0.065)
    rt = Y0 + bh
    glazing(m, r, (bx - 0.05, Y0 + 0.26, fz + 0.004), (0.8, 0.1), 7, lit={0, 1, 3, 4, 6}, color=WIN_COOL, emit=0.9)
    lit_sign(m, r, (bx - 0.05, Y0 + 0.4, fz + 0.03), (0.62, 0.11), 'RADAR CONTROL', lights=2, emblem_kind=None)
    eagle_banner(m, r, (bx - 0.64, top - 0.07, fz + 0.03), (0.15, 0.32))
    lit_doorway(m, r, (bx + 0.56, Y0, fz), (0.15, 0.25))
    hazard_band(m, r, (bx - 0.05, Y0 + 0.07, fz + 0.022), (0.86, 0.045))
    rivet_row(m, r, (bx - bw / 2 + 0.05, top - 0.1, fz + 0.001), (bx + bw / 2 - 0.05, top - 0.1, fz + 0.001))
    for x in (bx - bw / 2 + 0.05, bx + bw / 2 - 0.05):
        strobe(r, (x, top + 0.04, fz - 0.02))
    # roof: R-2 lettering on a team plate, an antenna farm, AC, a small dish, floodlights on the tower
    big_text(m, r, 'R-2', (bx - 0.42, rt + 0.016, bz + 0.08), 0.22, plate=tr)
    ac_unit(r, (bx + 0.08, rt + 0.016, bz + 0.14), 0.1)
    dish(r, (bx + 0.36, rt + 0.016, bz + 0.16), 0.09, mat=white(panels=None), yaw=-0.4, pitch=0.5)
    for (ax_, az_, h) in ((bx + 0.62, bz - 0.25, 0.46), (bx + 0.52, bz - 0.3, 0.34), (bx + 0.12, bz - 0.28, 0.28)):
        cyl(r, dark_m(), 0.008, h, (ax_, rt + 0.016 + h / 2, az_), r2=0.004, seg=6)
        for k in range(2):
            bar(r, dark_m(), (ax_ - 0.03, rt + h * (0.55 + 0.2 * k), az_), (ax_ + 0.03, rt + h * (0.55 + 0.2 * k), az_), 0.005)
        light(r, (ax_, rt + 0.016 + h, az_), 0.011, 0xff2a1a, 'blink')
    floodlight(r, (bx + 0.25, top + 0.035, bz - bd / 2 + 0.05), yaw=math.pi * 0.85, pitch=0.25, s=0.05)

    # ---- the radar tower (back right): plinth, octagonal shaft, team band, platform, lights, geodesic radome
    tx, tz = 0.32, -0.5
    py = Y0 + 1.06
    box(r, slab_m(0x8d887f), (0.66, 0.1, 0.66), (tx, Y0 + 0.05, tz), bevel=0.02)
    hazard_band(m, r, (tx, Y0 + 0.05, tz + 0.331), (0.5, 0.05))
    shaft = white(panels=(0.12, 0.16), grime=0.55, streaks=0.85)
    cyl(r, shaft, 0.25, py - Y0 - 0.16, (tx, Y0 + 0.1 + (py - Y0 - 0.16) / 2, tz), (0, math.pi / 8, 0), r2=0.2, seg=8, bevel=0.012)  # a flat face toward +z
    for k in range(8):  # dark steel ribs on the octagon corners (22.5 deg + k * 45 deg after the turn above)
        a = (k + 0.5) / 8 * math.pi * 2
        bar(r, frm, (tx + math.cos(a) * 0.255, Y0 + 0.1, tz - math.sin(a) * 0.255), (tx + math.cos(a) * 0.205, py - 0.07, tz - math.sin(a) * 0.205), 0.026)
    cyl(r, tr, 0.218, 0.09, (tx, py - 0.2, tz), (0, math.pi / 8, 0), r2=0.212, seg=8)
    for y in (0.3, 0.55, 0.78):
        glazing(m, r, (tx, Y0 + y, tz + 0.237 - y * 0.045), (0.09, 0.1), 1, lit={0} if y != 0.55 else set(), color=WIN_COOL, emit=0.9)
    stencil(m, r, '2', (tx + 0.15, Y0 + 0.62, tz + 0.15), 0.12, facing=0.785, color=0x2a2e34, depth=0.06)
    ladder(r, rail, (tx - 0.17, Y0 + 0.1, tz + 0.17), py - Y0 - 0.12, facing=-0.785, rung=0.075)
    # platform ring: deck, team fascia, railing, a ring of lights
    cyl(r, stl, 0.36, 0.06, (tx, py - 0.03, tz), r2=0.33, seg=24, bevel=0.01)
    cyl(r, tr, 0.364, 0.04, (tx, py - 0.035, tz), seg=24, caps=False)
    for k in range(16):
        a = k / 16 * math.pi * 2
        bar(r, rail, (tx + math.cos(a) * 0.345, py, tz + math.sin(a) * 0.345), (tx + math.cos(a) * 0.345, py + 0.07, tz + math.sin(a) * 0.345), 0.007)
    cyl(r, rail, 0.347, 0.008, (tx, py + 0.07, tz), seg=24, caps=False)
    for k in range(8):
        a = (k + 0.5) / 8 * math.pi * 2
        if k % 2:
            light(r, (tx + math.cos(a) * 0.37, py - 0.02, tz + math.sin(a) * 0.37), 0.016, 0xff2a1a, 'blink')
        else:
            strobe(r, (tx + math.cos(a) * 0.37, py - 0.02, tz + math.sin(a) * 0.37), r=0.014)
    for a in (0.6, 2.4):
        floodlight(r, (tx + math.cos(a) * 0.3, py + 0.02, tz + math.sin(a) * 0.3), yaw=-a + math.pi / 2, pitch=0.9, s=0.045)
    # the radome: team base band, geodesic shell, roundels, beacon
    cyl(r, tr, 0.3, 0.08, (tx, py + 0.04, tz), r2=0.29, seg=20, bevel=0.008)
    radome = tune(painted(0xedeae2, panels=None, wear=0.9, grime=0.35, rust=0.0, streaks=0.5, rough=0.5, metal=0.05, var=0.08), ao=0.6)
    rc = py + 0.33
    geodome(r, radome, 0.31, (tx, rc, tz), subdiv=3, cut=-0.62)
    roundel(m, r, (tx, rc + 0.04, tz + 0.31), 0.24, depth=0.07)
    roundel(m, r, (tx, rc + 0.31, tz), 0.22, facing='+y', depth=0.05)
    cyl(r, gun_m(), 0.03, 0.03, (tx, rc + 0.315, tz), seg=8)
    light(r, (tx, rc + 0.33, tz), 0.02, 0xff2a1a, 'blink', strength=3.0)

    # ---- the rotating search dish on its pedestal (back left)
    px, pz = -0.56, -0.48
    box(r, slab_m(0x85807a), (0.46, 0.12, 0.46), (px, Y0 + 0.06, pz), bevel=0.014)
    cyl(r, stl, 0.1, 0.34, (px, Y0 + 0.29, pz), r2=0.07, seg=12)
    box(r, stl, (0.2, 0.16, 0.18), (px + 0.12, Y0 + 0.2, pz + 0.12), bevel=0.014)
    grille(m, r, (px + 0.12, Y0 + 0.281, pz + 0.12), (0.16, 0.14), facing='+y')
    hazard_band(m, r, (px, Y0 + 0.08, pz + 0.231), (0.4, 0.045))
    d = m.part('dish', at=(px, 0.52, pz))
    cyl(d, gun_m(), 0.035, 0.08, (0, 0.0, 0), seg=12)
    box(d, gun_m(), (0.09, 0.04, 0.05), (0.0, 0.05, 0), bevel=0.008)
    box(d, frm, (0.07, 0.06, 0.08), (-0.1, 0.06, 0), bevel=0.008)
    light(d, (-0.1, 0.09, 0), 0.013, 0xff2a1a, 'blink')
    rot = (0.0, 0.0, -1.15)
    F = T((0.03, 0.13, 0), rot)
    o = tuple(F @ mathutils.Vector((0, 0, 0)))
    bowl = white(panels=None, grime=0.4)
    lathe(d, bowl, [(0.0, 0.0), (0.11, 0.013), (0.2, 0.05), (0.28, 0.105), (0.285, 0.117), (0.27, 0.112), (0.19, 0.064), (0.1, 0.031), (0.0, 0.018)],
          o, seg=22, rot=rot, cap_top=False, cap_bottom=False)  # closed shell: both faces visible
    lathe(d, tr, [(0.28, 0.1), (0.293, 0.112), (0.293, 0.126), (0.276, 0.121), (0.28, 0.1)], o, seg=22, rot=rot, cap_top=False, cap_bottom=False)
    tip = tuple(F @ mathutils.Vector((0, 0.22, 0)))
    for k in range(3):
        a = k / 3 * math.pi * 2
        bar(d, dark_m(), tuple(F @ mathutils.Vector((math.cos(a) * 0.17, 0.06, math.sin(a) * 0.17))), tip, 0.006)
    sphere(d, gun_m(), 0.024, tip, seg=8, rings=5)
    pipe_run(r, dark_m(), [(px + 0.23, Y0 + 0.1, pz), (bx - 0.3, Y0 + 0.1, pz), (bx - 0.3, Y0 + 0.1, bz - bd / 2)], 0.02)
    lamp_post(r, (0.86, Y0, 0.0), 0.4, yaw=-math.pi / 2)
    drums(r, (0.78, Y0, -0.9 + 0.05), 2)
