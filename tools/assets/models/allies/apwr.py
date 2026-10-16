"""Allied advanced power plant (3x3): two white hyperbolic cooling towers (team and aviation bands, a big star
roundel and numbers, stilted air inlets, sooty insides; smoke0 / smoke1), the reactor containment with a
panelled white dome, a team ring, pulsing coolant ports and a ring catwalk (steam1), the control hall with the
lit REACTOR 2 sign (steam0), a glowing coolant channel, transformers and a pylon.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403
from _allied import _imgs  # noqa: E402

ID = 'apwr'
FACTION = 'allies'
KIND = 'structure'

COOL = 0x56dcff


def build(m):
    setup(m)
    m.set_meta(footprint=(3, 3), height=1.6, radius=1.55)
    r = m.root

    wall = white()
    wall2 = offwhite()
    frm = frame()
    tr = trim()
    rf = roof()
    stl = steel()
    rail = rail_m()
    pipe_m = steel(0x8d99a6, panels=None)

    box(r, slab_m(0x9d988e), (2.98, Y0, 2.98), (0, Y0 / 2, 0), bevel=0.02)

    # ---- cooling towers
    _tower(m, r, 'smoke0', -0.74, -0.7, 1.46 - Y0 - 0.11, 0.56, '1', roundel_size=0.42)
    _tower(m, r, 'smoke1', 0.66, -0.82, 1.22 - Y0 - 0.11, 0.48, '2', roundel_size=0.34)

    # ---- reactor containment (front left)
    rx, rz = -0.66, 0.62
    cyl(r, slab_m(0x85807a), 0.53, 0.08, (rx, Y0 + 0.04, rz), r2=0.52, seg=28, bevel=0.01)
    cyl(r, wall2, 0.48, 0.38, (rx, Y0 + 0.08 + 0.19, rz), seg=28)
    cyl(r, frm, 0.485, 0.02, (rx, Y0 + 0.1, rz), seg=28, caps=False)
    cyl(r, tr, 0.49, 0.05, (rx, Y0 + 0.44, rz), seg=28, caps=False)
    dome(r, white(panels=(0.1, 0.07), grime=0.5, streaks=0.8, wear=0.45), 0.475, (rx, Y0 + 0.46, rz), seg=28, rings=8)
    cyl(r, gun_m(), 0.11, 0.03, (rx, Y0 + 0.93, rz), seg=14, bevel=0.005)
    cyl(r, gun_m(), 0.05, 0.1, (rx, Y0 + 0.99, rz), r2=0.06, seg=10)
    light(r, (rx, Y0 + 1.045, rz), 0.018, 0xff2a1a, 'blink')
    roundel(m, r, (rx, Y0 + 0.62, rz + 0.43), 0.24, depth=0.06)
    m.steam('steam1', (-0.51, 1.04, 0.52))
    # ring catwalk at the dome base
    cyl(r, tread(), 0.57, 0.014, (rx, Y0 + 0.47, rz), seg=28)
    for k in range(16):
        a = k / 16 * math.pi * 2
        bar(r, yellow(), (rx + math.cos(a) * 0.56, Y0 + 0.477, rz + math.sin(a) * 0.56), (rx + math.cos(a) * 0.56, Y0 + 0.54, rz + math.sin(a) * 0.56), 0.007)
    cyl(r, yellow(), 0.562, 0.008, (rx, Y0 + 0.54, rz), seg=28, caps=False)
    # coolant ports (pulsing cyan) round the drum; a trefoil plate on the camera side
    for i in range(10):
        a = i / 10 * math.pi * 2 + 0.3
        cx_, cz_ = rx + math.cos(a) * 0.482, rz - math.sin(a) * 0.482
        box(r, frm, (0.06, 0.13, 0.014), (cx_, Y0 + 0.26, cz_), (0, a + math.pi / 2, 0))
        box(r, light_mat(COOL, 1.6, 'pulse'), (0.04, 0.1, 0.006), (cx_ + math.cos(a) * 0.009, Y0 + 0.26, cz_ - math.sin(a) * 0.009), (0, a + math.pi / 2, 0))
    _trefoil(m, r, (rx + 0.2, Y0 + 0.3, rz + 0.445), 0.11, yaw=0.42)
    ladder(r, rail, (rx - 0.33, Y0 + 0.08, rz + 0.35), 0.4, facing=-0.75, rung=0.07)

    # ---- control hall (front right)
    bx, bz, bw, bd, bh = 0.62, 0.5, 0.98, 0.84, 0.56
    fz = bz + bd / 2
    top = block(m, r, bx, bz, bw, bd, bh, wall=wall, cornice=tr, roof_m=rf, cap=frm,
                pilasters=(bx - bw / 2 + 0.03, bx + 0.12, bx + bw / 2 - 0.03), side_pilasters=(bz - 0.2, bz + 0.2))
    rt = Y0 + bh
    lit_sign(m, r, (bx - 0.05, Y0 + 0.44, fz + 0.03), (0.66, 0.14), 'REACTOR 2', lights=2)
    glazing(m, r, (bx - 0.1, Y0 + 0.24, fz + 0.004), (0.5, 0.1), 4, lit={0, 1, 3}, color=WIN_WARM, emit=0.9)
    lit_doorway(m, r, (bx + 0.34, Y0, fz), (0.14, 0.23))
    hazard_band(m, r, (bx - 0.05, Y0 + 0.07, fz + 0.022), (0.86, 0.045))
    floodlight(r, (bx + 0.45, top + 0.035, fz - 0.03), yaw=0.0, pitch=0.8, s=0.05)
    for x in (bx - bw / 2 + 0.05, bx + bw / 2 - 0.05):
        strobe(r, (x, top + 0.035, bz - bd / 2 + 0.04))
    ac_unit(r, (bx + 0.25, rt + 0.016, bz - 0.15), 0.1)
    ac_unit(r, (bx - 0.02, rt + 0.016, bz - 0.15), 0.1)
    box(r, stl, (0.24, 0.14, 0.22), (bx - 0.3, rt + 0.086, bz + 0.1), bevel=0.012)
    grille(m, r, (bx - 0.3, rt + 0.157, bz + 0.1), (0.18, 0.16), facing='+y')
    m.steam('steam0', (0.32, 0.775, 0.6))
    rivet_row(m, r, (bx - bw / 2 + 0.05, top - 0.09, fz + 0.001), (bx + bw / 2 - 0.05, top - 0.09, fz + 0.001))

    # ---- pipes between reactor, hall and towers; the coolant channel
    pipe_run(r, pipe_m, [(rx + 0.48, Y0 + 0.24, rz - 0.06), (bx - bw / 2, Y0 + 0.24, bz - 0.06)], 0.045)
    pipe_run(r, steel(0x6d7a87, panels=None), [(rx + 0.42, Y0 + 0.13, rz - 0.26), (bx - bw / 2, Y0 + 0.13, bz - 0.26)], 0.035)
    pipe_run(r, pipe_m, [(bx, Y0 + 0.2, bz - bd / 2), (bx, Y0 + 0.2, -0.32), (0.66, Y0 + 0.2, -0.32)], 0.04)
    pipe_run(r, steel(0x6d7a87, panels=None), [(rx, Y0 + 0.3, rz - 0.5), (rx, Y0 + 0.3, -0.12)], 0.04)
    for (x, z) in ((0.0, -0.06), (bx, -0.1), (rx, 0.0)):
        box(r, frm, (0.03, 0.2, 0.03), (x, Y0 + 0.1, z))
    box(r, black(), (0.13, 0.02, 0.92), (0.0, Y0 + 0.01, 0.05))
    box(r, light_mat(COOL, 1.4, 'pulse'), (0.08, 0.004, 0.86), (0.0, Y0 + 0.022, 0.05))
    for s in (-1, 1):
        box(r, frm, (0.02, 0.03, 0.92), (s * 0.075, Y0 + 0.015, 0.05))

    # ---- transformers and a pylon along the right edge
    for tz in (-0.2, 0.16):
        tx = 1.22
        box(r, slab_m(0x7c7870), (0.26, 0.04, 0.22), (tx, Y0 + 0.02, tz), bevel=0.006)
        box(r, painted(0x6f7d6a, panels=None, wear=0.5, rust=0.3), (0.2, 0.2, 0.16), (tx, Y0 + 0.14, tz), bevel=0.012)
        for s in (-1, 1):
            vent(m, r, (tx, Y0 + 0.14, tz + s * 0.08), (0.16, 0.14), facing='+z' if s > 0 else '-z', slats=8)
        for dz in (-0.045, 0.0, 0.045):
            cyl(r, flat(0xd6d2c8, 0.4), 0.013, 0.08, (tx, Y0 + 0.28, tz + dz), seg=8)
        stencil(m, r, 'DANGER', (tx, Y0 + 0.13, tz + 0.08 + 0.003), 0.028, color=0xd8231a)
    px, pz, ph = 1.25, 1.18, 0.7
    for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        bar(r, gun_m(), (px + sx * 0.07, Y0, pz + sz * 0.07), (px + sx * 0.02, Y0 + ph, pz + sz * 0.02), 0.012)
    for k in (1, 2, 3):
        y = Y0 + ph * k / 4
        w = 0.07 - 0.05 * k / 4
        bar(r, gun_m(), (px - w, y, pz + w), (px + w, y, pz + w), 0.008)
    for y in (Y0 + ph * 0.82, Y0 + ph):
        bar(r, gun_m(), (px - 0.13, y, pz), (px + 0.13, y, pz), 0.014)
        for s in (-1, 1):
            cyl(r, flat(0xd6d2c8, 0.4), 0.009, 0.04, (px + s * 0.12, y - 0.025, pz), seg=6)
    light(r, (px, Y0 + ph + 0.02, pz), 0.012, 0xff2a1a, 'blink')
    drums(r, (-0.05, Y0, 1.18), 3)
    crates(r, (0.12, Y0, 0.86), 2, 0.08)
    lamp_post(r, (1.36, Y0, 1.36), 0.42, yaw=math.pi)


def _tower(m, r, name, x, z, h, rb, label, roundel_size=0.4):
    """Hyperbolic cooling tower standing on stilts: white concrete shell with formwork joints, a team band and a
    red aviation band near the top, a dark sooty inside, rim lights, a ladder, a big roundel and a number."""
    y0 = Y0
    stilt = 0.11
    shell = tune(concrete(0xd3cfc5, grime=0.55, streaks=1.0, wear=0.5, joints=(0.5, 0.1)), ao=0.75)
    prof = [(rb, 0), (rb * 0.86, h * 0.25), (rb * 0.72, h * 0.58), (rb * 0.69, h * 0.75), (rb * 0.72, h * 0.94), (rb * 0.74, h)]
    # stilts + dark air inlet
    cyl(r, black(), rb * 0.97, stilt, (x, y0 + stilt / 2, z), seg=24, caps=False)
    for i in range(14):
        a = i / 14 * math.pi * 2
        box(r, slab_m(0x8d887f), (0.04, stilt, 0.04), (x + math.cos(a) * rb * 0.99, y0 + stilt / 2, z - math.sin(a) * rb * 0.99), (0, a, 0))
    lathe(r, shell, [(pr, py + stilt) for (pr, py) in prof], (x, y0, z), seg=24, cap_top=False, cap_bottom=False)
    cyl(r, slab_m(0x8d887f), rb + 0.012, 0.03, (x, y0 + stilt + 0.015, z), seg=24, caps=False)
    top = y0 + stilt + h
    rt_ = rb * 0.74
    # rim + inside
    lathe(r, slab_m(0x9a958c), [(rt_ - 0.02, -0.004), (rt_ + 0.012, -0.004), (rt_ + 0.012, 0.012), (rt_ - 0.02, 0.012)], (x, top, z), seg=24, cap_top=False, cap_bottom=False)
    soot = tune(concrete(0x3a3734, grime=0.3, streaks=0.2, wear=0.1), ao=0.95)
    lathe_in(r, soot, [(rt_ - 0.02, top + 0.01), (rt_ * 0.95, top - 0.12), (rt_ * 0.9, top - 0.3)], (x, 0, z), seg=24)
    cyl(r, black(), rt_ * 0.9, 0.004, (x, top - 0.3, z), seg=24)
    # bands: team near the top, red aviation band, a thin white separator
    def band(mat, y_frac, hh):
        yy = y0 + stilt + h * y_frac
        rr = _rad_at(prof, h * y_frac)
        rr2 = _rad_at(prof, h * y_frac + hh)
        cyl(r, mat, rr + 0.006, hh, (x, yy + hh / 2, z), r2=rr2 + 0.006, seg=24, caps=False)
    band(trim(), 0.84, 0.075)
    band(painted(0xb8241a, wear=0.45, panels=None, streaks=0.9), 0.72, 0.05)
    # big roundel + number on the camera face
    yr = y0 + stilt + h * 0.5
    rr = _rad_at(prof, h * 0.5)
    roundel(m, r, (x, yr, z + rr + 0.004), roundel_size, depth=0.12)
    stencil(m, r, label, (x + rr * 0.62, yr - 0.24, z + rr * 0.86), 0.16, color=0x2a2e34, wear=0.35, depth=0.12)
    # rim lights, ladder
    for a in (0.8, 2.4, 3.9, 5.5):
        light(r, (x + math.cos(a) * rt_, top + 0.025, z - math.sin(a) * rt_), 0.018, 0xff2a1a, 'blink')
    ladder(r, rail_m(), (x - rb * 0.62, y0 + stilt, z + rb * 0.62), h * 0.95, facing=-math.pi / 4, rung=0.08)
    m.smoke(name, (x, top, z))


def _rad_at(prof, y):
    for (r0, y0), (r1, y1) in zip(prof, prof[1:]):
        if y0 <= y <= y1:
            t = (y - y0) / max(1e-6, y1 - y0)
            return r0 + (r1 - r0) * t
    return prof[-1][0]


def _trefoil(m, r, at, size, yaw=0.0):
    """Radiation warning plate: yellow square with a black trefoil (decal)."""
    from kit import decals as _D
    key = 'trefoil'
    if key not in _imgs:
        px = 128
        cv = _D.Canvas(px, px, ss=2)
        cv.rect(0, 0, px, px, _D.lin(HAZ_Y))
        c = px / 2
        k = _D.lin(0x111111)
        cv.circle(c, c, px * 0.08, k)
        for i in range(3):
            a0 = math.pi / 2 + i * 2 * math.pi / 3 - math.pi / 6
            pts = [(c + math.cos(a0) * px * 0.13, c + math.sin(a0) * px * 0.13)]
            for j in range(7):
                a = a0 + (math.pi / 3) * j / 6
                pts.append((c + math.cos(a) * px * 0.42, c + math.sin(a) * px * 0.42))
            pts.append((c + math.cos(a0 + math.pi / 3) * px * 0.13, c + math.sin(a0 + math.pi / 3) * px * 0.13))
            cv.poly([(c, c)] + pts, k)
        cv.circle(c, c, px * 0.11, _D.lin(HAZ_Y), r_in=px * 0.08)
        _imgs[key] = cv.image()
    box(r, frame(), (size * 1.1, size * 1.1, 0.01), at, (0, yaw, 0))
    import mathutils
    F = T(at, (0, yaw, 0))
    m.decal(_imgs[key], at=tuple(F @ mathutils.Vector((0, 0, 0.0055))), size=(size, size), facing=yaw, depth=0.01, team=0, rough=0.6)
