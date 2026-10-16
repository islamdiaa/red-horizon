"""Allied radar dome (2x2): the white operations block (lit window band, RADAR CONTROL sign, roof roundel,
antennas), a lattice tower with team-colour hoops carrying a panelled white geodesic radome with a star and a
beacon, and the rotating search dish on its pedestal (animated part 'dish').
"""
import math
import os
import sys

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
    lat = steel(0x7c8792, panels=None)
    rail = rail_m()

    box(r, slab_m(0x9d988e), (1.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)

    # ---- operations block across the front
    bx, bz, bw, bd, bh = -0.12, 0.42, 1.56, 0.84, 0.5
    fz = bz + bd / 2
    top = block(m, r, bx, bz, bw, bd, bh, wall=wall, cornice=tr, roof_m=rf, cap=frm,
                pilasters=(bx - bw / 2 + 0.03, bx - 0.46, bx + 0.38, bx + bw / 2 - 0.03), side_pilasters=(bz - 0.2, bz + 0.2))
    rt = Y0 + bh
    glazing(m, r, (bx - 0.05, Y0 + 0.26, fz + 0.004), (0.8, 0.1), 7, lit={0, 1, 3, 4, 6}, color=WIN_COOL, emit=0.9)
    lit_sign(m, r, (bx - 0.05, Y0 + 0.4, fz + 0.03), (0.62, 0.11), 'RADAR CONTROL', lights=2, emblem_kind=None)
    roundel(m, r, (bx - 0.64, Y0 + 0.3, fz + 0.002), 0.2, plate=wall)
    lit_doorway(m, r, (bx + 0.56, Y0, fz), (0.15, 0.25))
    hazard_band(m, r, (bx - 0.05, Y0 + 0.07, fz + 0.022), (0.86, 0.045))
    rivet_row(m, r, (bx - bw / 2 + 0.05, top - 0.09, fz + 0.001), (bx + bw / 2 - 0.05, top - 0.09, fz + 0.001))
    for x in (bx - bw / 2 + 0.05, bx + bw / 2 - 0.05):
        strobe(r, (x, top + 0.04, fz - 0.02))
    # roof: roundel, AC units, a small dish, antennas
    roundel(m, r, (bx - 0.4, rt + 0.016, bz + 0.06), 0.4, facing='+y', plate=steel(0x7d8792, panels=None))
    ac_unit(r, (bx + 0.08, rt + 0.016, bz + 0.12), 0.1)
    dish(r, (bx + 0.36, rt + 0.016, bz + 0.16), 0.09, mat=white(panels=None), yaw=-0.4, pitch=0.5)
    for (ax_, az_, h) in ((bx + 0.62, bz - 0.25, 0.42), (bx + 0.52, bz - 0.28, 0.3)):
        cyl(r, dark_m(), 0.008, h, (ax_, rt + 0.016 + h / 2, az_), r2=0.004, seg=6)
        light(r, (ax_, rt + 0.016 + h, az_), 0.01, 0xff2a1a, 'blink')
    floodlight(r, (bx + 0.2, top + 0.035, fz - 0.03), yaw=0.0, pitch=0.8, s=0.05)

    # ---- lattice tower with the radome (back right)
    tx, tz, th = 0.32, -0.5, 1.06
    b0, b1 = 0.3, 0.13
    box(r, slab_m(0x7c7870), (0.72, 0.06, 0.72), (tx, Y0 + 0.03, tz), bevel=0.012)
    yb = Y0 + 0.06
    legs = []
    for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        a = (tx + b0 * sx, yb, tz + b0 * sz)
        b = (tx + b1 * sx, Y0 + th, tz + b1 * sz)
        cyl_between(r, lat, a, b, 0.02, seg=8)
        box(r, slab_m(0x85807a), (0.09, 0.05, 0.09), (a[0], yb + 0.02, a[2]), bevel=0.008)
        legs.append((a, b))
    nlev = 4
    for i in range(nlev):
        f0, f1 = i / nlev, (i + 1) / nlev
        w0 = b0 + (b1 - b0) * f0
        w1 = b0 + (b1 - b0) * f1
        y1 = yb + (th - 0.06) * f0
        y2 = yb + (th - 0.06) * f1
        for (p0, p1) in (((-1, 1), (1, 1)), ((1, 1), (1, -1)), ((1, -1), (-1, -1)), ((-1, -1), (-1, 1))):
            bar(r, lat, (tx + p0[0] * w0, y1, tz + p0[1] * w0), (tx + p1[0] * w1, y2, tz + p1[1] * w1), 0.01)
        # hoop frame at each level (team at the middle)
        hm = tr if i == 1 else frm
        for (p0, p1) in (((-1, 1), (1, 1)), ((1, 1), (1, -1)), ((1, -1), (-1, -1)), ((-1, -1), (-1, 1))):
            bar(r, hm, (tx + p0[0] * w1, y2, tz + p0[1] * w1), (tx + p1[0] * w1, y2, tz + p1[1] * w1), 0.022 if i == 1 else 0.014)
    ladder(r, rail, (tx, yb, tz + 0.22), th - 0.06, rung=0.075)
    # platform, railing, the radome
    py = Y0 + th
    cyl(r, stl, 0.3, 0.06, (tx, py + 0.03, tz), r2=0.27, seg=20, bevel=0.008)
    for k in range(12):
        a = k / 12 * math.pi * 2
        bar(r, rail, (tx + math.cos(a) * 0.3, py + 0.06, tz + math.sin(a) * 0.3), (tx + math.cos(a) * 0.3, py + 0.13, tz + math.sin(a) * 0.3), 0.007)
    cyl(r, rail, 0.302, 0.008, (tx, py + 0.13, tz), seg=20, caps=False)
    cyl(r, tr, 0.27, 0.06, (tx, py + 0.09, tz), r2=0.26, seg=20, bevel=0.006)
    radome = white(panels=(0.07, 0.06), grime=0.45, streaks=0.7, wear=0.4)
    sphere(r, radome, 0.31, (tx, py + 0.33, tz), seg=24, rings=14)
    roundel(m, r, (tx, py + 0.36, tz + 0.31), 0.26, depth=0.06)
    roundel(m, r, (tx, py + 0.64, tz), 0.24, facing='+y', depth=0.05)
    light(r, (tx, py + 0.645, tz), 0.018, 0xff2a1a, 'blink')
    for a in (0.6, 2.5, 4.4):
        strobe(r, (tx + math.cos(a) * 0.29, py + 0.15, tz - math.sin(a) * 0.29), r=0.013)
    floodlight(r, (tx - 0.22, py + 0.09, tz + 0.22), yaw=-0.6, pitch=0.9, s=0.045)

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
    # the bowl: tilted towards +x, a feed horn on a tripod
    import mathutils
    rot = (0.0, 0.0, -1.15)
    F = T((0.03, 0.13, 0), rot)
    bowl = white(panels=None, grime=0.45)
    lathe(d, bowl, [(0.0, 0.0), (0.1, 0.012), (0.18, 0.045), (0.25, 0.095), (0.255, 0.105), (0.24, 0.1), (0.17, 0.058), (0.09, 0.028), (0.0, 0.016)],
          tuple(F @ mathutils.Vector((0, 0, 0))), seg=20, rot=rot, cap_top=False, cap_bottom=False)  # closed shell: both faces visible
    lathe(d, frm, [(0.25, 0.09), (0.262, 0.1), (0.262, 0.112), (0.248, 0.108)], tuple(F @ mathutils.Vector((0, 0, 0))), seg=20, rot=rot,
          cap_top=False, cap_bottom=False)
    tip = tuple(F @ mathutils.Vector((0, 0.2, 0)))
    for k in range(3):
        a = k / 3 * math.pi * 2
        base = tuple(F @ mathutils.Vector((math.cos(a) * 0.16, 0.05, math.sin(a) * 0.16)))
        bar(d, dark_m(), base, tip, 0.006)
    sphere(d, gun_m(), 0.022, tip, seg=8, rings=5)
    pipe_run(r, dark_m(), [(px + 0.23, Y0 + 0.1, pz), (bx - 0.3, Y0 + 0.1, pz), (bx - 0.3, Y0 + 0.1, bz - bd / 2)], 0.02)
    lamp_post(r, (0.86, Y0, 0.0), 0.4, yaw=-math.pi / 2)
    drums(r, (0.78, Y0, -0.9 + 0.05), 2)
