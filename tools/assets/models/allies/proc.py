"""Allied ore refinery (3x3): the white processing hall with the lit ORE PROCESSING sign, a hooded intake with
the furnace glow ('glow:proc') over the conveyor rollers (animated parts roll0..roll4), ORE 1 roof lettering and a
crusher house (steam1), two tall white ore silos with team bands and a conveyor gallery, the steel processing
tower with furnace ports and a stack (smoke0), the control room (steam0), the dock lane with green guide lamps
('glow:dock') and an ore stockpile.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'proc'
FACTION = 'allies'
KIND = 'structure'


def build(m):
    setup(m)
    m.set_meta(footprint=(3, 3), height=1.45, radius=1.55)
    r = m.root

    wall = white()
    wall2 = offwhite()
    frm = frame()
    tr = trim()
    rf = roof()
    stl = steel()
    clad = corrugated(0x7f8a95, pitch=0.03, rust=0.25, streaks=0.9)
    yel = yellow()
    rail = rail_m()
    pipe_m = steel(0x8d99a6, panels=None)

    # ---- foundation, dock lane
    box(r, slab_m(0x9d988e), (2.98, Y0, 2.98), (0, Y0 / 2, 0), bevel=0.02)
    box(r, asphalt(), (0.95, 0.02, 1.3), (0, Y0 + 0.01, 0.82), bevel=0.006)
    for s in (-1, 1):
        hazard_band(m, r, (s * 0.44, Y0 + 0.02, 0.82), (1.26, 0.05), facing='+y', roll=math.pi / 2, base=asphalt())
    for i in range(4):
        mark(m, r, solid(HAZ_Y), (0, Y0 + 0.02, 0.45 + i * 0.25), (0.3, 0.035), asphalt(), rough=0.6)
        for s in (-1, 1):
            cyl(r, dark_m(), 0.02, 0.02, (s * 0.4, Y0 + 0.03, 0.4 + i * 0.3), seg=8)
            sphere(r, glow_material('glow:dock', 0x40ff70), 0.016, (s * 0.4, Y0 + 0.045, 0.4 + i * 0.3), seg=8, rings=5)

    # ---- processing hall (back centre)
    hz, hw, hd, hh = -0.66, 1.26, 1.42, 1.02
    fz = hz + hd / 2
    top = block(m, r, 0, hz, hw, hd, hh, wall=wall, cornice=tr, roof_m=rf, cap=frm,
                pilasters=(-hw / 2 + 0.03, -0.36, 0.36, hw / 2 - 0.03), side_pilasters=(hz - 0.4, hz + 0.1), cornice_h=0.065)
    rt = Y0 + hh
    # intake hood + opening with the furnace glow, hazard lintel
    prism(r, steel(0x8a95a0, panels=(0.2, 0.2)), [(0.0, 0.18), (0.36, 0.4), (0.36, 0.52), (0.0, 0.52)], 0.62, (0, Y0, fz - 0.02), (0, -math.pi / 2, 0), bevel=0.006)
    for s in (-1, 1):
        prism(r, frm, [(0.0, 0.18), (0.36, 0.4), (0.36, 0.52), (0.0, 0.52)], 0.03, (s * 0.325, Y0, fz - 0.02), (0, -math.pi / 2, 0))
    box(r, black(), (0.52, 0.32, 0.02), (0, Y0 + 0.2, fz + 0.005))
    box(r, glow_material('glow:proc', 0xff7a22), (0.44, 0.06, 0.01), (0, Y0 + 0.1, fz + 0.016))
    box(r, light_mat(0xff8a30, 1.2, 'flicker'), (0.4, 0.1, 0.004), (0, Y0 + 0.25, fz + 0.016))
    m.decal(haz_img(0.62 / 0.05), at=(0, Y0 + 0.46, fz + 0.36), size=(0.62, 0.11), facing='+z', depth=0.02, team=0)
    # conveyor bed + the rollers
    box(r, frm, (0.46, 0.05, 0.4), (0, Y0 + 0.025, fz + 0.2), bevel=0.006)
    for s in (-1, 1):
        box(r, yel, (0.025, 0.07, 0.42), (s * 0.235, Y0 + 0.06, fz + 0.2), bevel=0.004)
    for i in range(5):
        rl = m.part(f'roll{i}', at=(0, 0.09, 0.1 + i * 0.07))
        cyl(rl, metal(0x9aa2ab, rough=0.35), 0.022, 0.42, (0, 0, 0), (0, 0, math.pi / 2), seg=10)
        box(rl, dark_m(), (0.42, 0.008, 0.006), (0, 0.02, 0))
    # sign, windows, floodlights, strobes
    lit_sign(m, r, (0, Y0 + 0.8, fz + 0.03), (0.86, 0.17), 'ORE PROCESSING', lights=3)
    for s in (-1, 1):
        glazing(m, r, (s * 0.49, Y0 + 0.62, fz + 0.004), (0.18, 0.12), 2, lit={0} if s < 0 else {0, 1}, color=WIN_WARM, emit=0.9)
        floodlight(r, (s * 0.5, top + 0.035, fz - 0.03), yaw=0.0, pitch=0.8, s=0.055)
        strobe(r, (s * (hw / 2 - 0.03), top + 0.04, hz - hd / 2 + 0.03))
    for s in (-1, 1):
        eagle_banner(m, r, (s * 0.49, Y0 + 0.5, fz + 0.03), (0.17, 0.36))
    rivet_row(m, r, (-hw / 2 + 0.05, top - 0.1, fz + 0.001), (hw / 2 - 0.05, top - 0.1, fz + 0.001))
    # roof: roundel, crusher house (steam1), AC, vents
    big_text(m, r, 'ORE 1', (0.24, rt + 0.016, hz + 0.36), 0.15, plate=trim())
    box(r, stl, (0.5, 0.22, 0.44), (-0.2, rt + 0.13, hz - 0.25), bevel=0.016)
    box(r, rf, (0.54, 0.025, 0.48), (-0.2, rt + 0.25, hz - 0.25), bevel=0.006)
    grille(m, r, (-0.2, rt + 0.263, hz - 0.25), (0.3, 0.2), facing='+y')
    vent(m, r, (-0.2, rt + 0.13, hz - 0.03), (0.32, 0.12), facing='+z')
    m.steam('steam1', (-0.2, 1.345, -0.91))
    ac_unit(r, (0.36, rt + 0.016, hz - 0.1), 0.11)
    roof_vent(r, (0.36, rt + 0.016, hz - 0.45), 0.04)

    # ---- ore silos (left) + conveyor gallery onto the hall roof
    sx = -1.06
    s1 = _silo(m, r, sx, -1.0, 0.27, 1.2, tr, frm, rail, 'ORE')
    _silo(m, r, sx, -0.36, 0.25, 1.02, tr, frm, rail, 'ORE 2')
    gx0, gx1 = sx + 0.18, -0.62
    gy0, gy1 = s1 - 0.1, rt + 0.12
    L = math.hypot(gx1 - gx0, gy1 - gy0)
    a = math.atan2(gy1 - gy0, gx1 - gx0)
    box(r, clad, (L, 0.1, 0.13), ((gx0 + gx1) / 2, (gy0 + gy1) / 2, -0.84), (0, 0, a), bevel=0.01)
    box(r, tr, (L, 0.02, 0.14), ((gx0 + gx1) / 2 - math.sin(a) * 0.05, (gy0 + gy1) / 2 + math.cos(a) * 0.05, -0.84), (0, 0, a))
    bar(r, frm, ((gx0 + gx1) / 2, Y0, -0.84), ((gx0 + gx1) / 2, (gy0 + gy1) / 2 - 0.05, -0.84), 0.03)
    for z in (-1.0, -0.36):
        pipe_run(r, pipe_m, [(sx + 0.25, Y0 + 0.24, z), (-0.63, Y0 + 0.24, z)], 0.035)

    # ---- processing tower (right back): clad steel, furnace ports, stack (smoke0), catwalk
    tx, tz, tw, td, th = 1.0, -0.88, 0.56, 0.6, 1.2
    box(r, slab_m(0x8d887f), (tw + 0.04, 0.1, td + 0.04), (tx, Y0 + 0.05, tz), bevel=0.012)
    box(r, clad, (tw, th - 0.1, td), (tx, Y0 + 0.1 + (th - 0.1) / 2, tz), bevel=0.01)
    box(r, tr, (tw + 0.05, 0.06, td + 0.05), (tx, Y0 + th - 0.03, tz), bevel=0.01)
    box(r, rf, (tw - 0.02, 0.02, td - 0.02), (tx, Y0 + th + 0.005, tz))
    for x in (tx - tw / 2, tx + tw / 2):
        for z in (tz - td / 2, tz + td / 2):
            box(r, wall, (0.05, th - 0.1, 0.05), (x, Y0 + 0.1 + (th - 0.1) / 2, z), bevel=0.008)
    tfz = tz + td / 2
    for y in (0.47, 0.62):
        box(r, frm, (0.34, 0.08, 0.02), (tx, Y0 + y, tfz + 0.01), bevel=0.004)
        box(r, glow_material('glow:proc', 0xff7a22), (0.3, 0.05, 0.01), (tx, Y0 + y, tfz + 0.02))
    catwalk(m, r, (tx, Y0 + 0.82, tfz + 0.05), 0.5, 0.09, axis='x', rail=rail, sides=(False, True))
    stack_m = tune(concrete(0xd8d5cc, grime=0.6, streaks=1.0, joints=(0.6, 0.12), soot=(1.55, 1.76)), ao=0.8)
    chimney(m, r, (tx + 0.1, Y0 + th + 0.01, tz - 0.08), 0.5, 0.085, 0.066, mat=stack_m, band_mat=tr, cap=dark_m(), smoke='smoke0',
            bands=[(0.45, 0.1), (0.72, 0.08)], lights=2, glow_ring=False, light_r=0.012)
    pipe_run(r, pipe_m, [(tx - tw / 2, Y0 + 0.75, tz - 0.1), (0.63, Y0 + 0.75, tz - 0.1)], 0.04)
    stencil(m, r, 'P-2', (tx - 0.12, Y0 + 0.95, tfz + 0.002), 0.07, color=WHITE_TXT)

    # ---- control room (right front)
    cx, cz, cw, cd, ch = 1.0, 0.3, 0.56, 0.6, 0.44
    ctop = block(m, r, cx, cz, cw, cd, ch, wall=wall2, cornice=tr, roof_m=rf, cap=frm, pilasters=(cx - cw / 2 + 0.025, cx + cw / 2 - 0.025))
    cfz = cz + cd / 2
    glazing(m, r, (cx + 0.06, Y0 + 0.29, cfz + 0.004), (0.34, 0.1), 3, lit={0, 1}, color=WIN_COOL, emit=0.9)
    lit_doorway(m, r, (cx - 0.17, Y0, cfz), (0.12, 0.2))
    stencil(m, r, '04', (cx + 0.18, Y0 + 0.14, cfz + 0.002), 0.07, color=0x2a2e34)
    hazard_band(m, r, (cx + 0.06, Y0 + 0.07, cfz + 0.022), (0.36, 0.04))
    ac_unit(r, (cx + 0.05, ctop, cz - 0.08), 0.1, rot=0.3)
    m.steam('steam0', (1.05, 0.615, 0.22))
    cyl(r, dark_m(), 0.01, 0.42, (cx + 0.2, ctop + 0.21, cz + 0.18), r2=0.005, seg=6)
    light(r, (cx + 0.2, ctop + 0.43, cz + 0.18), 0.012, 0xff2a1a, 'blink')
    dish(r, (cx - 0.15, ctop, cz + 0.12), 0.07, mat=white(panels=None), yaw=1.0, pitch=0.6)

    # ---- ore stockpile (left front) behind low walls
    lathe(r, tune(concrete(0x8a6a3e, grime=0.4, streaks=0.0, wear=0.3, tex='rough_concrete', rough=0.95), ao=0.9),
          [(0.36, 0.0), (0.3, 0.07), (0.2, 0.13), (0.08, 0.17), (0.0, 0.18)], (-0.98, Y0, 0.74), seg=12, cap_bottom=False)
    gold = light_mat(0xe8b434, 0.25, 'steady')
    for i, (dx, dz, s) in enumerate(((-0.12, 0.05, 0.05), (0.1, -0.08, 0.045), (0.02, 0.15, 0.04), (-0.2, -0.12, 0.035), (0.18, 0.12, 0.04), (0.0, -0.02, 0.05))):
        y = Y0 + 0.18 * max(0.0, 1 - (math.hypot(dx, dz) / 0.36) ** 1.4) - 0.01
        cyl(r, gold, s, s * 2.2, (-0.98 + dx, y + s, 0.74 + dz), (0.3 * (i % 3 - 1), i * 1.1, 0.2), r2=0.0, seg=5)
    box(r, slab_m(0x85807a), (0.8, 0.12, 0.06), (-0.98, Y0 + 0.06, 1.13), bevel=0.012)
    box(r, slab_m(0x85807a), (0.06, 0.12, 0.62), (-0.6, Y0 + 0.06, 0.8), bevel=0.012)
    hazard_band(m, r, (-0.98, Y0 + 0.08, 1.161), (0.7, 0.04))
    drums(r, (0.8, Y0, 0.86), 3)
    lamp_post(r, (0.62, Y0, 1.32), 0.4, yaw=math.pi)
    lamp_post(r, (-0.62, Y0, 1.32), 0.4, yaw=math.pi)


def _silo(m, r, x, z, rad, h, tr, frm, rail, label):
    """Tall white ore silo: plinth, panelled shell with dark hoops, team band, conical roof, ring catwalk."""
    shell = white(panels=(0.22, 0.2))
    cyl(r, slab_m(0x7c7870), rad + 0.045, 0.08, (x, Y0 + 0.04, z), r2=rad + 0.035, seg=20, bevel=0.008)
    cyl(r, shell, rad, h, (x, Y0 + 0.08 + h / 2, z), seg=20)
    for f in (0.3, 0.6):
        cyl(r, frm, rad + 0.01, 0.022, (x, Y0 + 0.08 + h * f, z), seg=20, caps=False)
    cyl(r, tr, rad + 0.012, 0.09, (x, Y0 + 0.08 + h * 0.83, z), seg=20, caps=False)
    top = Y0 + 0.08 + h
    lathe(r, steel(0x8a95a0, panels=None), [(rad + 0.02, 0.0), (rad * 0.8, 0.07), (rad * 0.3, 0.15), (0.0, 0.17)], (x, top, z), seg=20, cap_bottom=False)
    cyl(r, frm, 0.05, 0.06, (x, top + 0.18, z), seg=10)
    # ring catwalk + rail just under the roof, a cage ladder on the camera side
    cyl(r, tread(), rad + 0.08, 0.012, (x, top - 0.04, z), seg=20)
    for k in range(10):
        a = k / 10 * math.pi * 2
        bar(r, rail, (x + math.cos(a) * (rad + 0.075), top - 0.034, z + math.sin(a) * (rad + 0.075)),
            (x + math.cos(a) * (rad + 0.075), top + 0.03, z + math.sin(a) * (rad + 0.075)), 0.007)
    cyl(r, rail, rad + 0.078, 0.008, (x, top + 0.03, z), seg=20, caps=False)
    ladder(r, rail, (x + rad * 0.72, Y0 + 0.08, z + rad * 0.72), h - 0.06, facing=math.pi / 4, rung=0.07)
    stencil(m, r, label, (x, Y0 + 0.08 + h * 0.45, z + rad + 0.002), 0.08, color=0x2a2e34, wear=0.3)
    light(r, (x, top + 0.22, z), 0.012, 0xff2a1a, 'blink')
    return top
