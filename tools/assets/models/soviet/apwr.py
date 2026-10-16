"""Soviet advanced power plant (3x3): two hyperboloid concrete cooling towers with red bands, crown lamps
and smoke (smoke0 / smoke1), the reactor containment with a ring catwalk and pulsing coolant ports, the
turbine hall with the ATOMIC POWER board, lit windows and a banner (steam0), pipe runs, transformers, a pylon.
Pivots: node --import tsx tools/assets/rig.ts apwr soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'apwr'
FACTION = 'soviet'
KIND = 'structure'

CYAN = 0x4ad8ff


def tower(m, r, P, name, x, z, h, rb, label):
    """Hyperboloid cooling tower on a ring of legs. Its open top reads from the RTS camera: a pale concrete lip,
    red / white bands right under it, red crown lamps and a bright steam-filled throat (lightly emissive, so it
    glows warm at night and stays clear of the runtime snow); smoke point on top."""
    conc = deep(concrete(0x9a958b, grime=0.8, streaks=1.0, wear=0.6, joints=(0.3, 0.12), soot=(Y0 + 0.1 + h * 0.97, Y0 + 0.1 + h * 1.02)), 0.75)
    rw, rt = rb * 0.58, rb * 0.68
    prof = [(rb, 0.0), (rb * 0.86, h * 0.18), (rb * 0.7, h * 0.42), (rw, h * 0.7), (rb * 0.6, h * 0.86), (rt, h)]
    seg = 22
    # leg ring (dark gap under the shell reads as the X-legs)
    cyl(r, P.conc_dk, rb + 0.04, 0.03, (x, Y0 + 0.015, z), seg=seg)
    cyl(r, P.void, rb - 0.01, 0.07, (x, Y0 + 0.065, z), seg=seg, caps=False)
    for k in range(12):
        a = k * math.pi * 2 / 12
        cx, cz = x + math.cos(a) * (rb - 0.015), z - math.sin(a) * (rb - 0.015)
        box(r, P.conc, (0.03, 0.08, 0.03), (cx, Y0 + 0.06, cz), (0, a, 0))
    lathe(r, conc, prof, (x, Y0 + 0.1, z), seg=seg, cap_top=False, cap_bottom=False)
    top_y = Y0 + 0.1 + h
    # dark sooty inner wall (reads as the open crater), the steam surface deep inside (lit from below)
    inner = deep(concrete(0x4e4b46, grime=0.9, streaks=0.4, wear=0.2), 0.9)
    lathe_in(r, inner, [(rw * 1.0, h * 0.72), (rt - 0.03, h * 0.93), (rt - 0.016, h)], (x, Y0 + 0.1, z), seg=seg)
    cyl(r, light_mat(0xd6dbe0, 0.26, 'steady'), rw * 1.01, 0.006, (x, Y0 + 0.1 + h * 0.72, z), seg=seg)
    # thick pale lip, red / white bands right under it (the flare faces out: no snow), crown lamps
    lathe(r, P.conc_lt, [(rt + 0.004, h - 0.012), (rt + 0.02, h - 0.004), (rt + 0.014, h + 0.012), (rt - 0.018, h + 0.012), (rt - 0.016, h)],
          (x, Y0 + 0.1, z), seg=seg, cap_top=False, cap_bottom=False, double=True)
    for (y0f, y1f, mat) in ((0.86, 0.9, P.band), (0.9, 0.935, P.white), (0.935, 0.975, P.band)):
        ra = rb * 0.6 + (rt - rb * 0.6) * ((y0f - 0.86) / 0.14)
        rbb = rb * 0.6 + (rt - rb * 0.6) * ((y1f - 0.86) / 0.14)
        cyl(r, mat, ra + 0.008, h * (y1f - y0f), (x, Y0 + 0.1 + h * (y0f + y1f) / 2, z), r2=rbb + 0.008, seg=seg, caps=False)
    for k in range(6):
        a = k * math.pi / 3 + math.pi / 6
        lamp(r, (x + math.cos(a) * (rt + 0.012), top_y + 0.01, z - math.sin(a) * (rt + 0.012)), 0.026)
    stencil(m, r, label, (x, Y0 + 0.1 + h * 0.45, z + rb * 0.78 + 0.01), 0.2, depth=0.06)
    m.smoke(name, (x, top_y + 0.02, z))


def build(m):
    m.set_meta(footprint=(3, 3), height=1.6, radius=1.55)
    look(m, ao_dist=0.42)
    P = Pal()
    r = m.root
    foundation(m, r, P, 3.0, 3.0)

    # ---- cooling towers (back)
    tower(m, r, P, 'smoke0', -0.74, -0.7, 1.32, 0.56, '1')
    tower(m, r, P, 'smoke1', 0.66, -0.82, 1.08, 0.48, '2')

    # ---- reactor containment (front left)
    rx, rz = -0.66, 0.62
    cyl(r, P.conc_dk, 0.53, 0.08, (rx, Y0 + 0.04, rz), r2=0.51, seg=24, bevel=0.01)
    cyl(r, P.wall, 0.47, 0.38, (rx, Y0 + 0.08 + 0.19, rz), r2=0.46, seg=24)
    dome(r, deep(painted(0xd2d0c8, wear=0.5, grime=0.7, rust=0.15, streaks=0.9, panels=None), 0.8), 0.46, (rx, Y0 + 0.46, rz), seg=24, rings=6)
    cyl(r, P.trim, 0.475, 0.045, (rx, Y0 + 0.44, rz), seg=24, caps=False)
    cyl(r, P.gun, 0.06, 0.1, (rx, Y0 + 0.95, rz), r2=0.05, seg=10)
    lamp(r, (rx, Y0 + 1.0, rz), 0.024)
    top_star(m, r, (rx, Y0 + 0.64, rz + 0.37), 0.3, facing='+z', emit=0.35, depth=0.14)
    # ring catwalk around the dome base
    cyl(r, P.grate, 0.56, 0.012, (rx, Y0 + 0.47, rz), seg=24)
    for k in range(16):
        a = k / 16 * math.pi * 2
        bar(r, P.rail, (rx + math.cos(a) * 0.55, Y0 + 0.47, rz - math.sin(a) * 0.55), (rx + math.cos(a) * 0.55, Y0 + 0.54, rz - math.sin(a) * 0.55), 0.008)
    cyl(r, P.rail, 0.552, 0.008, (rx, Y0 + 0.54, rz), seg=24, caps=False)
    # coolant ports (pulse) around the drum
    for i in range(10):
        a = (i / 10) * math.pi * 2 + 0.3
        nx, nz = math.cos(a), -math.sin(a)
        yaw = math.atan2(nx, nz)
        box(r, P.void, (0.06, 0.13, 0.01), (rx + nx * 0.468, Y0 + 0.26, rz + nz * 0.468), (0, yaw, 0))
        box(r, light_mat(CYAN, 2.4, 'pulse'), (0.04, 0.1, 0.008), (rx + nx * 0.474, Y0 + 0.26, rz + nz * 0.474), (0, yaw, 0))
    m.decal(trefoil(), at=(rx + 0.2, Y0 + 0.3, rz + 0.43), size=(0.11, 0.11), facing=0.43, part=r, depth=0.05, team=0)

    # ---- turbine / control hall (front right)
    bx, bz, bw, bd, bh = 0.62, 0.5, 0.98, 0.84, 0.58
    top, fz = hall(r, P, bx, bz, bw, bd, bh, wall=P.wall, parapet=0.04)
    x0, x1 = bx - bw / 2, bx + bw / 2
    pilasters(r, P.frame, [x0 + 0.03, x1 - 0.03], fz, Y0 + 0.13, top - 0.06, w=0.06, dz=0.045)
    slogan(m, r, (bx + 0.04, Y0 + 0.42, fz + 0.03), (0.72, 0.22), 'ATOMIC|POWER', lights=3)
    red_banner(m, r, (x0 + 0.11, top - 0.06, fz + 0.03), (0.15, 0.42))
    window_row(r, (bx + 0.04, Y0 + 0.21, fz), 4, (0.09, 0.08), 0.045, dark=(1,), strength=1.7)
    door(m, r, (x1 - 0.1, Y0, fz), (0.12, 0.22), kind='hatch')
    rivet_row(m, r, (x0 + 0.05, top - 0.085, fz), (x1 - 0.05, top - 0.085, fz))
    roof_lights(r, x0 + 0.04, bz - bd / 2 + 0.04, x1 - 0.04, fz - 0.04, top + 0.04, r=0.02)
    rt = top + 0.018
    ac_unit(r, (bx + 0.25, rt, bz - 0.15), 0.1, mat=P.wall_lt)
    ac_unit(r, (bx - 0.05, rt, bz - 0.17), 0.1, mat=P.wall_lt)
    box(r, P.wall_dk, (0.24, 0.14, 0.22), (0.32, rt + 0.07, 0.6), bevel=0.012)
    vent(m, r, (0.32, rt + 0.07, 0.71), (0.18, 0.09))
    cyl(r, P.steel, 0.03, 0.06, (0.32, rt + 0.17, 0.6), seg=8)
    m.steam('steam0', (0.32, 0.775, 0.6))
    m.steam('steam1', (-0.51, 1.04, 0.52))
    for i in range(2):
        vent(m, r, (x1, Y0 + 0.36, bz - 0.2 + i * 0.3), (0.16, 0.1), facing='+x')

    # ---- pipes between reactor, hall and towers; a glowing coolant channel
    pipe_run(r, P.rust, [(rx + 0.48, Y0 + 0.24, rz - 0.06), (x0, Y0 + 0.24, rz - 0.06)], 0.048)
    pipe_run(r, P.steel, [(rx + 0.42, Y0 + 0.13, rz - 0.26), (x0, Y0 + 0.13, rz - 0.26)], 0.036)
    pipe_run(r, P.steel, [(bx, Y0 + 0.2, bz - bd / 2), (bx, Y0 + 0.2, -0.3), (0.66, Y0 + 0.2, -0.36)], 0.04)
    pipe_run(r, P.rust, [(rx, Y0 + 0.3, rz - 0.5), (rx, Y0 + 0.3, -0.16)], 0.042)
    for (x, z, y) in ((x0 - 0.12, rz - 0.06, 0.24), (bx, -0.1, 0.2), (rx, -0.06, 0.3)):
        box(r, P.frame, (0.03, y, 0.03), (x, Y0 + y / 2, z + 0.06), bevel=0.004)
    box(r, P.void, (0.12, 0.02, 0.9), (0.0, Y0 + 0.01, 0.05))
    box(r, light_mat(CYAN, 2.2, 'pulse'), (0.08, 0.004, 0.86), (0.0, Y0 + 0.021, 0.05))

    # ---- transformers + pylon (right edge)
    for tzz in (-0.2, 0.16):
        tx = 1.22
        box(r, P.conc_dk, (0.24, 0.04, 0.26), (tx, Y0 + 0.02, tzz), bevel=0.006)
        box(r, P.wall_lt, (0.16, 0.2, 0.2), (tx, Y0 + 0.14, tzz), bevel=0.012)
        vent(m, r, (tx - 0.08, Y0 + 0.14, tzz), (0.16, 0.14), facing='-x', slats=8)
        for dx in (-0.045, 0.0, 0.045):
            cyl(r, flat(0x8a6a4a, 0.4), 0.012, 0.07, (tx, Y0 + 0.275, tzz + dx), seg=8)
        stencil(m, r, 'DANGER', (tx, Y0 + 0.16, tzz + 0.102), 0.028, color=0xf2b916)
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        bar(r, P.gun, (1.25 + sx * 0.1, Y0, 1.18 + sz * 0.1), (1.25 + sx * 0.03, Y0 + 0.7, 1.18 + sz * 0.03), 0.018)
    for y in (0.2, 0.42, 0.6):
        bar(r, P.gun, (1.25 - 0.1, Y0 + y, 1.18), (1.25 + 0.1, Y0 + y, 1.18), 0.014)
    bar(r, P.gun, (1.06, Y0 + 0.66, 1.18), (1.44, Y0 + 0.66, 1.18), 0.016)
    lamp(r, (1.25, Y0 + 0.72, 1.18), 0.018)
    drums(r, (-0.05, Y0, 1.18), 3)
    crates(r, P, (0.12, Y0, 0.86), 0.08, 2, 0.4)
    lamp_post(r, P, (1.36, Y0, 1.36), 0.42, yaw=math.pi)


_tre = {}


def trefoil():
    """Radiation warning plate: black trefoil on yellow."""
    if 't' in _tre:
        return _tre['t']
    from kit import decals as D
    cv = D.Canvas(160, 160, ss=2)
    c = 80
    cv.rect(0, 0, 160, 160, D.lin(0xf2b916))
    blk = D.lin(0x141414)
    for k in range(3):
        a0 = math.pi / 2 + k * 2 * math.pi / 3 - math.pi / 6
        pts = [(c, c)]
        for i in range(9):
            a = a0 + (math.pi / 3) * i / 8
            pts.append((c + math.cos(a) * 66, c + math.sin(a) * 66))
        cv.poly(pts, blk)
    cv.circle(c, c, 22, D.lin(0xf2b916))
    cv.circle(c, c, 14, blk)
    cv.roughen(0.2, seed=4)
    img = cv.image()
    _tre['t'] = img
    return img
