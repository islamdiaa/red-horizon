"""Soviet ore refinery (3x3): the processing hall with a hazard-striped intake hopper and a furnace slot
(glow:proc) over the conveyor rollers (parts roll0..roll4, spun by the game) facing the dock lane with green
guide lamps (glow:dock); ORE FOR THE MOTHERLAND board and banners; two ribbed storage silos with an inclined
conveyor gallery; a furnace tower with a banded stack (smoke0); control room (steam0); ore stockpile.
Pivots: node --import tsx tools/assets/rig.ts proc soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'proc'
FACTION = 'soviet'
KIND = 'structure'


def silo(m, r, P, x, z, rad, h, seg=16, label='РУДА'):
    """Ribbed storage silo with a conical cap, team band, ring catwalk, ladder. Returns the cap top y."""
    cyl(r, P.conc_dk, rad + 0.05, 0.08, (x, Y0 + 0.04, z), r2=rad + 0.035, seg=seg, bevel=0.01)
    body = deep(painted(0x6c737b, panels=(0.3, 0.16), wear=0.7, grime=0.7, rust=0.4, streaks=1.0), 0.8)
    cyl(r, body, rad, h, (x, Y0 + 0.08 + h / 2, z), seg=seg)
    for k in range(8):
        a = (k / 8) * math.pi * 2 + 0.2
        box(r, P.frame, (0.022, h - 0.08, 0.022), (x + math.cos(a) * (rad + 0.004), Y0 + 0.08 + h / 2, z - math.sin(a) * (rad + 0.004)), (0, a, 0))
    for f in (0.3, 0.6):
        cyl(r, P.dark, rad + 0.012, 0.022, (x, Y0 + 0.08 + h * f, z), seg=seg, caps=False)
    cyl(r, P.trim, rad + 0.014, 0.08, (x, Y0 + 0.08 + h * 0.82, z), seg=seg, caps=False)
    cyl(r, P.red, rad + 0.012, 0.1, (x, Y0 + 0.08 + h * 0.94, z), seg=seg, caps=False)
    ttop = Y0 + 0.08 + h
    lathe(r, P.wall_dk, [(rad + 0.025, 0.0), (rad * 0.8, 0.08), (rad * 0.3, 0.16), (0.0, 0.18)], (x, ttop, z), seg=seg)
    cyl(r, P.gun, 0.05, 0.06, (x, ttop + 0.19, z), seg=8)
    lamp(r, (x, ttop + 0.22, z), 0.02)
    cyl(r, P.grate, rad + 0.09, 0.012, (x, ttop - 0.03, z), seg=seg)
    for k in range(10):
        a = (k / 10) * math.pi * 2
        bar(r, P.rail, (x + math.cos(a) * (rad + 0.08), ttop - 0.025, z - math.sin(a) * (rad + 0.08)), (x + math.cos(a) * (rad + 0.08), ttop + 0.04, z - math.sin(a) * (rad + 0.08)), 0.006)
    ladder(r, P.rail, (x + rad * 0.72, Y0 + 0.08, z + rad * 0.72), h - 0.03, facing=math.pi / 4)
    m.decal(big_star(), at=(x, Y0 + 0.08 + h * 0.62, z + rad), size=(0.24, 0.24), facing='+z', part=r, depth=0.08, team=0)
    stencil(m, r, label, (x, Y0 + 0.08 + h * 0.36, z + rad), 0.1, depth=0.06)
    return ttop + 0.18


def build(m):
    m.set_meta(footprint=(3, 3), height=1.45, radius=1.55)
    look(m)
    P = Pal()
    r = m.root

    foundation(m, r, P, 3.0, 3.0)

    # ---- dock lane (front centre): kerbed pad, hazard edges, green guide lamps (glow:dock)
    box(r, P.conc_dk, (0.95, 0.03, 1.22), (0, Y0 + 0.015, 0.86), bevel=0.01)
    for s in (-1, 1):
        m.decal(hazard_img(aspect=20), at=(s * 0.44, Y0 + 0.031, 0.86), size=(1.2, 0.06), facing='+y', part=r, depth=0.01, roll=math.pi / 2)
        for i in range(4):
            z = 0.4 + i * 0.3
            box(r, P.dark, (0.035, 0.02, 0.035), (s * 0.43, Y0 + 0.04, z))
            sphere(r, glow_material('glow:dock', 0x3aff6a), 0.017, (s * 0.43, Y0 + 0.06, z), seg=6, rings=4)
    for i in range(4):
        stripe(m, r, (0, Y0 + 0.031, 0.45 + i * 0.25), (0.3, 0.04), facing='+y', color=0xd8a21c)

    # ---- processing hall (back centre)
    hz, hw, hd, hh = -0.66, 1.26, 1.42, 1.02
    top, fz = hall(r, P, 0, hz, hw, hd, hh, wall=P.wall, parapet=0.045)
    pilasters(r, P.frame, [-hw / 2 + 0.03, hw / 2 - 0.03], fz, Y0 + 0.13, top - 0.06, w=0.07, dz=0.05)
    # intake: hopper (sloped steel hood) over a dark mouth with the furnace slot and the conveyor
    prism(r, P.wall_dk, [(0.0, 0.2), (0.38, 0.42), (0.38, 0.54), (0.0, 0.54)], 0.66, (0, Y0, fz - 0.02), rot=(0, -math.pi / 2, 0))
    box(r, P.void, (0.54, 0.32, 0.02), (0, Y0 + 0.17, fz + 0.006))
    box(r, glow_material('glow:proc', 0xff6a1a), (0.48, 0.06, 0.01), (0, Y0 + 0.09, fz + 0.018))
    for s in (-1, 1):
        box(r, P.frame, (0.06, 0.4, 0.42), (s * 0.33, Y0 + 0.2, fz + 0.2), bevel=0.01)
        m.decal(hazard_img(aspect=0.4 / 0.05), at=(s * 0.33, Y0 + 0.2, fz + 0.412), size=(0.4, 0.05), facing='+z', part=r, depth=0.01, roll=math.pi / 2)
    hazard_stripes(m, r, (0, Y0 + 0.38, fz + 0.03), (0.6, 0.05))
    for i in range(5):
        rp = m.part(f'roll{i}', at=(0, 0.09, 0.1 + i * 0.07))
        cyl(rp, P.steel, 0.022, 0.5, (0, 0, 0), (0, 0, math.pi / 2), seg=8)
        box(rp, P.dark, (0.5, 0.008, 0.008), (0, 0.02, 0))
    box(r, P.dark, (0.58, 0.05, 0.4), (0, Y0 + 0.01, 0.27), bevel=0.006)
    # slogan + banners
    slogan(m, r, (0, Y0 + 0.8, fz + 0.03), (0.84, 0.28), 'ORE FOR THE|MOTHERLAND', lights=3)
    for s in (-1, 1):
        red_banner(m, r, (s * 0.52, top - 0.07, fz + 0.03), (0.17, 0.56))
    window_row(r, (0, Y0 + 0.58, fz), 3, (0.09, 0.07), 0.05, dark=(1,), strength=2.1)
    rivet_row(m, r, (-hw / 2 + 0.05, top - 0.09, fz), (hw / 2 - 0.05, top - 0.09, fz))
    roof_lights(r, -hw / 2 + 0.04, hz - hd / 2 + 0.04, hw / 2 - 0.04, fz - 0.04, top + 0.045, r=0.021)
    # roof: crusher house (steam1), grille, AC, vents
    rt = top + 0.018
    box(r, P.wall_dk, (0.5, 0.24, 0.44), (-0.2, rt + 0.12, hz - 0.25), bevel=0.016)
    box(r, P.roof, (0.54, 0.025, 0.48), (-0.2, rt + 0.25, hz - 0.25), bevel=0.004)
    box(r, P.trim, (0.55, 0.03, 0.49), (-0.2, rt + 0.225, hz - 0.25), bevel=0.004)
    grille(m, r, (-0.2, rt + 0.12, hz - 0.25 + 0.22), (0.3, 0.14))
    cyl(r, P.steel, 0.035, 0.06, (-0.2, rt + 0.29, hz - 0.25), seg=8)
    m.steam('steam1', (-0.2, 1.345, -0.91))
    ac_unit(r, (0.4, rt, hz + 0.45), 0.1, mat=P.wall_lt)
    top_star(m, r, (-0.1, rt + 0.001, hz + 0.32), 0.62, emit=0.35)
    roof_vent(r, (0.36, rt, hz - 0.45), 0.04)
    roof_vent(r, (0.2, rt, hz - 0.1), 0.035)

    # ---- silos (left back) + inclined conveyor gallery onto the hall roof
    sx = -1.06
    t1 = silo(m, r, P, sx, -1.0, 0.27, 1.2)
    silo(m, r, P, sx, -0.36, 0.25, 1.02, label='02')
    gy0, gy1 = t1 - 0.2, rt + 0.1
    a = (sx + 0.24, gy0, -0.84)
    b = (-0.63, gy1, -0.84)
    bar(r, P.wall_dk, a, b, 0.13, 0.15)
    bar(r, P.trim, (a[0], a[1] + 0.08, a[2]), (b[0], b[1] + 0.08, b[2]), 0.14, 0.02)
    bar(r, light_mat(0xffc27a, 2.0, 'steady'), (a[0], a[1], a[2] + 0.066), (b[0], b[1], b[2] + 0.066), 0.03, 0.004)
    for t in (0.0, 1.0):
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        bar(r, P.frame, (x, Y0 if t == 0 else rt, -0.84), (x, y - 0.06, -0.84), 0.03)
    for z in (-1.0, -0.36):
        pipe_run(r, P.rust, [(sx + 0.25, Y0 + 0.24, z), (-0.63, Y0 + 0.24, z)], 0.035)

    # ---- furnace tower (right back) with the stack (smoke0) and furnace windows (glow:proc)
    tx, tz = 1.0, -0.88
    ttop, tfz = hall(r, P, tx, tz, 0.56, 0.6, 1.2, wall=P.clad, parapet=0.04)
    pilasters(r, P.frame, [tx - 0.25, tx + 0.25], tfz, Y0 + 0.13, ttop - 0.06, w=0.06, dz=0.045)
    for y in (0.47, 0.62, 0.77):
        box(r, P.void, (0.34, 0.07, 0.01), (tx, Y0 + y, tfz + 0.002))
        box(r, glow_material('glow:proc', 0xff6a1a), (0.3, 0.05, 0.01), (tx, Y0 + y, tfz + 0.008))
    stencil(m, r, 'FURNACE 3', (tx, Y0 + 0.3, tfz + 0.002), 0.06, color=0xe8b434)
    catwalk(m, r, (tx, Y0 + 0.9, tfz + 0.05), 0.5, 0.09, axis='x')
    stack(m, r, P, (tx + 0.1, ttop + 0.02, tz - 0.08), 0.5, 0.095, name='smoke0', r_top=0.072, lights=4,
          bands=[(0.5, 0.09), (0.72, 0.09)])
    pipe_run(r, P.steel, [(tx - 0.28, Y0 + 0.75, tz - 0.1), (0.63, Y0 + 0.75, tz - 0.1)], 0.04)
    lamp(r, (tx + 0.24, ttop + 0.045, tfz - 0.04), 0.02)

    # ---- control room (right front): lit windows, mast, steam0
    cx, cz = 1.0, 0.3
    ctop, cfz = hall(r, P, cx, cz, 0.56, 0.6, 0.46, wall=P.wall_lt, parapet=0.035)
    window_row(r, (cx + 0.05, Y0 + 0.3, cfz), 3, (0.1, 0.09), 0.04, dark=(2,), strength=2.1)
    door(m, r, (cx - 0.19, Y0, cfz), (0.12, 0.22), kind='hatch')
    stencil(m, r, '04', (cx + 0.18, Y0 + 0.15, cfz + 0.002), 0.07, color=0xe8b434)
    ac_unit(r, (cx + 0.05, ctop + 0.018, cz - 0.08), 0.1, mat=P.wall_lt)
    antenna(r, (cx + 0.2, ctop + 0.018, cz + 0.18), 0.4, light_color=None)
    lamp(r, (cx + 0.2, ctop + 0.42, cz + 0.18), 0.018)
    m.steam('steam0', (1.05, 0.615, 0.22))
    lamp(r, (cx - 0.24, ctop + 0.035, cfz - 0.03), 0.02)

    # ---- ore stockpile (left front) behind a low wall + a hopper
    ore = painted(0x8a6a34, wear=0.1, grime=0.5, rust=0.6, streaks=0.0, rough=0.9, metal=0.0, panels=None, tex='rusty_metal_02')
    dome(r, ore, 0.36, (-0.98, Y0, 0.74), seg=12, rings=4, h=0.17)
    dome(r, ore, 0.18, (-0.78, Y0, 0.94), seg=10, rings=3, h=0.1)
    gold = light_mat(0xe8b43c, 0.55, 'steady')  # ore crystals read bright gold like the ore field (lit, not metal)
    for (x, z, h, rx, rz) in ((-1.05, 0.7, 0.2, 0.3, -0.2), (-0.92, 0.82, 0.16, -0.25, 0.3), (-1.12, 0.86, 0.14, 0.2, 0.35),
                              (-0.84, 0.66, 0.15, -0.35, -0.25), (-0.98, 0.58, 0.13, 0.1, -0.4), (-0.76, 0.92, 0.12, -0.3, 0.2)):
        cyl(r, gold, 0.035, h, (x, Y0 + 0.1 + h / 2, z), (rx, 0.4, rz), r2=0.0, seg=4)
    box(r, P.conc, (0.8, 0.12, 0.06), (-0.98, Y0 + 0.06, 1.14), bevel=0.012)
    box(r, P.conc, (0.06, 0.12, 0.64), (-0.6, Y0 + 0.06, 0.8), bevel=0.012)
    drums(r, (0.8, Y0, 0.86), 3)
    lamp_post(r, P, (0.62, Y0, 1.32), 0.42, yaw=math.pi / 2)
    lamp_post(r, P, (-0.62, Y0, 1.32), 0.42, yaw=math.pi / 2)
