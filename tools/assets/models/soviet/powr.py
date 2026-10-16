"""Soviet power plant (2x2): turbine hall with the POWER / OUR STRENGTH slogan, steel-clad boiler house with two
banded smokestacks (smoke0 / smoke1), transformer yard, feed pipes, roof machinery (steam0 / steam1).
Hero model of the HD pipeline: see tools/assets/README.md.
"""
import math

from kit import *

ID = 'powr'
FACTION = 'soviet'
KIND = 'structure'

Y0 = 0.05  # top of the foundation slab


def build(m):
    m.set_meta(footprint=(2, 2), height=1.55, radius=1.05)
    r = m.root

    conc = concrete(0x8e8980, joints=(0.5, 0.25))
    conc_dark = concrete(0x6e6a63, grime=0.7)
    steel = painted(0x666e76, panels=(0.2, 0.16), wear=0.6, rust=0.25, streaks=0.75)
    steel_lt = painted(0x6a7077, panels=(0.24, 0.2), wear=0.6, rust=0.3)
    clad = corrugated(0x4f555c, pitch=0.03, rust=0.3, streaks=0.9)
    trim = team(wear=0.55, panels=None)
    dark = metal(0x2b2e33, rough=0.5, rust=0.3)
    frame = painted(0x2f3236, wear=0.7, rust=0.3, panels=None)
    pipe_m = rusty(0x5a4a3c, 0.55)
    pipe_s = metal(0x5a6068, rough=0.45, rust=0.35)
    roof_m = concrete(0x5c5a55, grime=0.75, streaks=0.2, joints=(0.4, 0.4), tex='rough_concrete')
    rail = metal(0x34373b, rough=0.5)

    # ---- foundation: slab with a chamfered kerb and a darker apron in front of the hall
    box(r, conc, (1.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)
    box(r, conc_dark, (1.9, 0.012, 0.24), (0, Y0 + 0.006, 0.85), bevel=0.004)

    # ---- turbine hall (front): concrete plinth, steel walls with pilasters, team cornice, parapet roof
    hx, hz, hw, hd, hh = -0.08, 0.3, 1.64, 0.66, 0.66
    fz = hz + hd / 2
    ex = hx + hw / 2
    box(r, conc, (hw + 0.05, 0.13, hd + 0.05), (hx, Y0 + 0.065, hz), bevel=0.014)
    box(r, steel, (hw, hh - 0.13, hd), (hx, Y0 + 0.13 + (hh - 0.13) / 2, hz), bevel=0.01)
    top = Y0 + hh
    box(r, trim, (hw + 0.06, 0.055, hd + 0.06), (hx, top - 0.03, hz), bevel=0.01)
    box(r, roof_m, (hw - 0.02, 0.02, hd - 0.02), (hx, top + 0.008, hz))
    for (x0, x1, z0, z1) in ((hx - hw / 2, ex, fz - 0.025, fz + 0.025), (hx - hw / 2, ex, hz - hd / 2 - 0.025, hz - hd / 2 + 0.025),
                             (hx - hw / 2 - 0.025, hx - hw / 2 + 0.025, hz - hd / 2, fz), (ex - 0.025, ex + 0.025, hz - hd / 2, fz)):
        slab(r, frame, x0, x1, top, top + 0.04, z0, z1, bevel=0.006)
    # pilasters (front and right side) and a plinth hazard band
    for x in (hx - hw / 2 + 0.025, hx - 0.42, hx + 0.32, ex - 0.025):
        box(r, frame, (0.05, hh - 0.08, 0.04), (x, Y0 + 0.08 + (hh - 0.08) / 2 - 0.03, fz + 0.016), bevel=0.008)
    for z in (hz - 0.2, hz + 0.12):
        box(r, frame, (0.04, hh - 0.08, 0.05), (ex + 0.016, Y0 + 0.08 + (hh - 0.08) / 2 - 0.03, z), bevel=0.008)
    hazard_stripes(m, r, (hx, Y0 + 0.075, fz + 0.025), (hw - 0.08, 0.04))
    # front: the slogan board, a red banner, lit windows, the roller door, cabinets, down pipes, rivets
    sign(m, r, (hx - 0.03, Y0 + 0.44, fz + 0.035), (0.84, 0.28), 'POWER|OUR STRENGTH',
         board=painted(0x9a1a14, wear=0.45, rust=0.2, streaks=0.5, panels=None), lights=3, emblem='soviet')
    banner(m, r, (hx - 0.64, top - 0.075, fz + 0.035), (0.18, 0.42), emblem='soviet')
    window_row(r, (hx - 0.03, Y0 + 0.19, fz), 4, (0.085, 0.07), 0.06, dark=(2,))
    door(m, r, (hx + 0.56, Y0 + 0.0, fz), (0.22, 0.3), kind='roller', hazard_frame=True)
    window(r, (hx + 0.56, Y0 + 0.48, fz), (0.1, 0.08))
    stencil(m, r, 'ES-1', (hx + 0.56, Y0 + 0.385, fz + 0.002), 0.045)
    junction_box(r, (hx + 0.38, Y0 + 0.24, fz), (0.07, 0.09, 0.03), conduit=0.1)
    downpipe(r, pipe_s, (hx - hw / 2 + 0.07, 0, fz), Y0 + 0.13, top - 0.04)
    downpipe(r, pipe_s, (ex - 0.07, 0, fz), Y0 + 0.13, top - 0.04)
    rivet_row(m, r, (hx - hw / 2 + 0.05, top - 0.085, fz), (ex - 0.05, top - 0.085, fz))
    # right side: turbine vents (glowing, pulse), a steam main with a valve wheel, a cabinet
    for i in range(3):
        z = hz - 0.2 + i * 0.16
        vent(m, r, (ex, Y0 + 0.32, z), (0.12, 0.09), facing='+x')
        box(r, light_mat(0xff6a1a, 1.4, 'pulse'), (0.006, 0.02, 0.1), (ex + 0.006, Y0 + 0.235, z))
    pipe_run(r, pipe_m, [(ex + 0.05, Y0 + 0.5, hz - hd / 2 + 0.02), (ex + 0.05, Y0 + 0.5, fz - 0.04), (ex + 0.05, Y0 + 0.13, fz - 0.04)], 0.026)
    cyl(r, painted(0xa3241a, wear=0.5, panels=None), 0.03, 0.008, (ex + 0.08, Y0 + 0.5, hz + 0.05), (0, 0, math.pi / 2), seg=10)
    junction_box(r, (ex, Y0 + 0.5, hz - 0.28), (0.06, 0.08, 0.03), facing='+x')
    for x in (hx - hw / 2 + 0.04, ex - 0.04):
        light(r, (x, top + 0.04, fz - 0.04), 0.017, 0xff2a1a, 'blink')
    # roof machinery: turbine housing with stiffeners, louvre box, AC units, steam relief valves, rails
    rt = top + 0.018
    cyl(r, steel_lt, 0.12, 0.64, (hx - 0.2, rt, hz - 0.04), (0, 0, math.pi / 2), seg=16)
    for dx in (-0.26, -0.09, 0.08, 0.25):
        box(r, frame, (0.016, 0.135, 0.255), (hx - 0.2 + dx, rt + 0.062, hz - 0.04), bevel=0.003)
    box(r, steel, (0.3, 0.15, 0.24), (hx + 0.48, rt + 0.075, hz - 0.06), bevel=0.014)
    grille(m, r, (hx + 0.48, rt + 0.15, hz - 0.06), (0.24, 0.18), facing='+y')
    vent(m, r, (hx + 0.48, rt + 0.075, hz + 0.06), (0.22, 0.09), facing='+z')
    ac_unit(r, (hx + 0.22, rt, hz + 0.19), 0.1)
    ac_unit(r, (hx - 0.66, rt, hz + 0.17), 0.09, rot=0.3)
    roof_vent(r, (hx - 0.66, rt, hz - 0.14), 0.035)
    roof_vent(r, (hx + 0.1, rt, hz - 0.22), 0.028)
    for (x, z, h) in ((-0.03, 0.1, 0.12), (0.4, 0.24, 0.05)):
        cyl(r, pipe_s, 0.016, h, (x, rt + h / 2, z), seg=8)
        cyl(r, trim, 0.027, 0.018, (x, rt + h, z), seg=10)
    m.steam('steam0', (-0.03, 0.795, 0.1))
    m.steam('steam1', (0.4, 0.875, 0.24))
    rail_rect(r, rail, hx - hw / 2 + 0.04, hz - hd / 2 + 0.04, ex - 0.04, fz - 0.04, top + 0.04, h=0.06, post=0.16, sides='es')

    # ---- boiler house (back left): taller, clad in corrugated steel, the stacks rise from it
    bx, bz, bw, bd, bh = -0.36, -0.47, 1.04, 0.76, 1.0
    box(r, conc, (bw + 0.05, 0.17, bd + 0.05), (bx, Y0 + 0.085, bz), bevel=0.014)
    box(r, clad, (bw, bh - 0.17, bd), (bx, Y0 + 0.17 + (bh - 0.17) / 2, bz), bevel=0.008)
    btop = Y0 + bh
    box(r, trim, (bw + 0.05, 0.05, bd + 0.05), (bx, btop - 0.025, bz), bevel=0.01)
    box(r, roof_m, (bw - 0.02, 0.02, bd - 0.02), (bx, btop + 0.008, bz))
    for x in (bx - bw / 2, bx + bw / 2):
        for z in (bz - bd / 2, bz + bd / 2):
            box(r, frame, (0.055, bh - 0.12, 0.055), (x, Y0 + 0.12 + (bh - 0.12) / 2, z), bevel=0.01)
    for x in (bx - 0.18, bx + 0.18):
        box(r, frame, (0.035, bh - 0.2, 0.03), (x, Y0 + 0.17 + (bh - 0.2) / 2, bz + bd / 2 + 0.012), bevel=0.006)
    bfz = bz + bd / 2
    window_row(r, (bx + 0.2, Y0 + 0.84, bfz), 2, (0.07, 0.07), 0.06)
    catwalk(m, r, (bx + 0.05, Y0 + 0.68, bfz + 0.05), bw - 0.14, 0.09, axis='x')
    ladder(r, rail, (bx + bw / 2, Y0 + 0.17, bz + 0.12), 0.84, facing='+x', cage=True)
    stencil(m, r, '01', (bx - 0.36, Y0 + 0.47, bfz + 0.002), 0.13)
    banner(m, r, (bx - 0.02, btop - 0.075, bfz + 0.012), (0.18, 0.34), emblem='soviet')
    downpipe(r, pipe_s, (bx - bw / 2 + 0.06, 0, bfz), Y0 + 0.17, btop - 0.05)
    junction_box(r, (bx + bw / 2, Y0 + 0.4, bz - 0.2), (0.07, 0.1, 0.03), facing='+x', conduit=0.12)
    # stacks: dark steel, three red bands, sooty tops, crowns with blinking red lights, smoke points
    band = painted(0xa01812, wear=0.45, rust=0.25, streaks=0.9, panels=None)
    for (name, x, z, h, rad) in (('smoke0', -0.63, -0.59, 0.88, 0.165), ('smoke1', -0.11, -0.61, 0.72, 0.15)):
        top_y = btop + 0.02 + h
        stack = painted(0x3f4347, panels=(0.3, 0.12), wear=0.55, rust=0.35, streaks=1.0, soot=(top_y - 0.3, top_y - 0.02))
        cyl(r, conc_dark, rad + 0.06, 0.1, (x, btop + 0.05, z), r2=rad + 0.025, seg=20, bevel=0.01)
        chimney(m, r, (x, btop + 0.02, z), h, rad, rad * 0.8, mat=stack, band_mat=band, cap=dark, smoke=name,
                bands=[(0.42, 0.06), (0.6, 0.07), (0.78, 0.07)], lights=4, ladder_side=-math.pi / 2)
    # ---- feed pipes between the boiler house and the hall, on stands
    pipe_run(r, pipe_m, [(bx + bw / 2, Y0 + 0.52, bz + 0.1), (0.3, Y0 + 0.52, bz + 0.1), (0.3, Y0 + 0.52, hz - hd / 2)], 0.038)
    pipe_run(r, pipe_s, [(bx + bw / 2, Y0 + 0.38, bz - 0.16), (0.21, Y0 + 0.38, bz - 0.16), (0.21, Y0 + 0.38, hz - hd / 2)], 0.03)
    for (x, z, y) in ((0.3, bz + 0.1, 0.52), (0.21, bz - 0.16, 0.38), (0.25, -0.08, 0.38)):
        box(r, frame, (0.03, y, 0.03), (x + 0.045, Y0 + y / 2, z), bevel=0.004)
        box(r, frame, (0.09, 0.02, 0.03), (x, Y0 + y - 0.045, z))
    cyl(r, painted(0xa3241a, wear=0.5, panels=None), 0.034, 0.008, (0.3, Y0 + 0.52, bz + 0.3), seg=10)

    # ---- transformer yard (back right): two transformers, a gantry, a fence
    for tx in (0.5, 0.78):
        tz = -0.66
        box(r, conc_dark, (0.22, 0.04, 0.26), (tx, Y0 + 0.02, tz), bevel=0.006)
        box(r, steel_lt, (0.16, 0.2, 0.2), (tx, Y0 + 0.14, tz), bevel=0.012)
        for s in (-1, 1):
            vent(m, r, (tx + s * 0.08, Y0 + 0.14, tz), (0.16, 0.14), facing='+x' if s > 0 else '-x', slats=8)
        for dx in (-0.045, 0.0, 0.045):
            cyl(r, flat(0x8a6a4a, 0.4), 0.012, 0.07, (tx + dx, Y0 + 0.275, tz), seg=8)
            for k in range(3):
                cyl(r, flat(0x6a4a34, 0.35), 0.018, 0.01, (tx + dx, Y0 + 0.255 + k * 0.022, tz), seg=8)
        stencil(m, r, 'DANGER', (tx, Y0 + 0.16, tz + 0.1 + 0.002), 0.03, color=0xf2b916)
    for x in (0.4, 0.88):
        bar(r, rail, (x, Y0, -0.42), (x, Y0 + 0.62, -0.42), 0.024)
    bar(r, rail, (0.38, Y0 + 0.6, -0.42), (0.9, Y0 + 0.6, -0.42), 0.022)
    for x in (0.52, 0.76):
        pipe(r, dark, (x, Y0 + 0.6, -0.42), (x, Y0 + 0.31, -0.62), 0.004, flanges=False)
    pipe(r, dark, (0.64, Y0 + 0.6, -0.42), (0.6, Y0 + hh - 0.05, hz - hd / 2), 0.004, flanges=False)
    railing(r, rail, (0.3, Y0, -0.94), (0.94, Y0, -0.94), h=0.1)
    railing(r, rail, (0.94, Y0, -0.94), (0.94, Y0, -0.1), h=0.1)
    light(r, (0.9, Y0 + 0.64, -0.42), 0.014, 0xff2a1a, 'blink')

    # ---- yard clutter and a lamp post
    for i, (x, z) in enumerate(((0.82, 0.8), (0.9, 0.74), (0.86, 0.88))):
        cyl(r, painted(0x7a1d16 if i != 1 else 0x3e4a2c, wear=0.6, rust=0.5, panels=None), 0.04, 0.11, (x, Y0 + 0.055, z), seg=12, bevel=0.004)
    for (x, z, s) in ((-0.86, 0.82, 0.09), (-0.78, 0.86, 0.07)):
        box(r, painted(0x5a5236, wear=0.5, panels=None), (s, s, s), (x, Y0 + s / 2, z), bevel=0.006)
    bar(r, rail, (0.38, Y0, 0.88), (0.38, Y0 + 0.42, 0.88), 0.016)
    box(r, dark, (0.07, 0.02, 0.04), (0.38, Y0 + 0.42, 0.86))
    box(r, light_mat(0xffe0b0, 1.8, 'steady'), (0.05, 0.006, 0.03), (0.38, Y0 + 0.41, 0.86))
