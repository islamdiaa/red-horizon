"""Allied power plant (2x2): white turbine hall with the lit POWER STATION sign, an eagle banner and a roof
roundel, the steel-clad boiler house with two white smokestacks (team bands, aviation lights; smoke0 / smoke1),
glowing turbine vents, roof machinery (steam0 / steam1) and a fenced transformer yard.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'powr'
FACTION = 'allies'
KIND = 'structure'


def build(m):
    setup(m)
    m.set_meta(footprint=(2, 2), height=1.55, radius=1.05)
    r = m.root

    wall = white()
    frm = frame()
    tr = trim()
    rf = roof()
    stl = steel()
    stl_lt = steel(0x9aa4ae, panels=(0.24, 0.2))
    clad = corrugated(0x7f8a95, pitch=0.03, rust=0.25, streaks=0.9)
    rail = rail_m()
    pipe_m = steel(0x8d99a6, panels=None)

    # ---- foundation
    box(r, slab_m(0x9d988e), (1.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)
    box(r, asphalt(), (1.9, 0.012, 0.24), (0, Y0 + 0.006, 0.85), bevel=0.003)
    hazard_band(m, r, (0, Y0, 0.955), (1.9, 0.04), facing='+y', base=slab_m(0x9d988e))

    # ---- turbine hall (front)
    hx, hz, hw, hd, hh = -0.08, 0.3, 1.62, 0.66, 0.64
    fz = hz + hd / 2
    ex = hx + hw / 2
    top = block(m, r, hx, hz, hw, hd, hh, wall=wall, cornice=tr, roof_m=rf, cap=frm,
                pilasters=(hx - hw / 2 + 0.03, hx - 0.52, hx + 0.42, ex - 0.03), side_pilasters=(hz - 0.2, hz + 0.14), cornice_h=0.065)
    rt = Y0 + hh
    hazard_band(m, r, (hx - 0.05, Y0 + 0.075, fz + 0.022), (hw - 0.2, 0.05))
    lit_sign(m, r, (hx - 0.05, Y0 + 0.44, fz + 0.03), (0.86, 0.2), 'POWER STATION', lights=3)
    eagle_banner(m, r, (hx - hw / 2 + 0.16, top - 0.08, fz + 0.03), (0.2, 0.46))
    window_row(r, (hx - 0.05, Y0 + 0.21, fz), 4, (0.09, 0.085), 0.055, lit=WIN_WARM, dark=(2,))
    lit_doorway(m, r, (hx + 0.6, Y0, fz), (0.18, 0.27))
    window(r, (hx + 0.6, Y0 + 0.47, fz), (0.1, 0.08), lit=WIN_WARM)
    stencil(m, r, 'G-1', (hx + 0.6, Y0 + 0.37, fz + 0.002), 0.045, color=0x2a2e34, wear=0.2)
    junction_box(r, (hx + 0.36, Y0 + 0.25, fz), (0.07, 0.09, 0.03), conduit=0.1)
    downpipe(r, pipe_m, (hx - hw / 2 + 0.08, 0, fz), Y0 + 0.1, top - 0.05)
    rivet_row(m, r, (hx - hw / 2 + 0.05, top - 0.1, fz + 0.001), (ex - 0.05, top - 0.1, fz + 0.001))
    # east wall: turbine vents with an orange glow (pulse), a steam main, a cabinet
    for i in range(3):
        z = hz - 0.2 + i * 0.17
        vent(m, r, (ex, Y0 + 0.34, z), (0.12, 0.1), facing='+x')
        box(r, light_mat(0xff7a22, 1.5, 'pulse'), (0.006, 0.024, 0.1), (ex + 0.006, Y0 + 0.24, z))
    pipe_run(r, pipe_m, [(ex + 0.05, Y0 + 0.5, hz - hd / 2 + 0.02), (ex + 0.05, Y0 + 0.5, fz - 0.05), (ex + 0.05, Y0 + 0.12, fz - 0.05)], 0.026)
    cyl(r, painted(0xb8241a, wear=0.5, panels=None), 0.03, 0.008, (ex + 0.08, Y0 + 0.5, hz + 0.05), (0, 0, math.pi / 2), seg=10)
    # roof: big star roundel, turbine housing with stiffeners, louvre box, AC units, relief valves, floodlights
    roundel(m, r, (hx - 0.56, rt + 0.016, hz + 0.02), 0.42, facing='+y', plate=steel(0x7d8792, panels=None))
    cyl(r, stl_lt, 0.12, 0.6, (hx + 0.02, rt + 0.018, hz - 0.06), (0, 0, math.pi / 2), seg=16)
    for dx in (-0.25, -0.08, 0.09, 0.26):
        box(r, frm, (0.016, 0.135, 0.255), (hx + 0.02 + dx, rt + 0.08, hz - 0.06))
    box(r, stl, (0.26, 0.15, 0.24), (hx + 0.56, rt + 0.09, hz - 0.08), bevel=0.014)
    grille(m, r, (hx + 0.56, rt + 0.165, hz - 0.08), (0.2, 0.18), facing='+y')
    vent(m, r, (hx + 0.56, rt + 0.09, hz + 0.04), (0.2, 0.09), facing='+z')
    ac_unit(r, (hx + 0.32, rt + 0.018, hz + 0.2), 0.1)
    for (x, z, h) in ((-0.03, 0.1, 0.12), (0.4, 0.24, 0.05)):
        cyl(r, pipe_m, 0.016, h, (x, rt + 0.018 + h / 2, z), seg=8)
        cyl(r, painted(0xb8241a, wear=0.4, panels=None), 0.027, 0.018, (x, rt + 0.018 + h, z), seg=10)
    m.steam('steam0', (-0.03, 0.795, 0.1))
    m.steam('steam1', (0.4, 0.875, 0.24))
    for x in (hx - hw / 2 + 0.06, ex - 0.06):
        floodlight(r, (x, top + 0.035, fz - 0.03), yaw=0.0, pitch=0.7, s=0.05)
    rail_rect(r, rail, hx - hw / 2 + 0.04, hz - hd / 2 + 0.04, ex - 0.04, fz - 0.04, top + 0.03, h=0.06, post=0.16, sides='e')

    # ---- boiler house (back left): steel clad, white corner columns, the stacks rise from it
    bx, bz, bw, bd, bh = -0.36, -0.47, 1.04, 0.76, 0.98
    box(r, slab_m(0x8d887f), (bw + 0.05, 0.14, bd + 0.05), (bx, Y0 + 0.07, bz), bevel=0.012)
    box(r, clad, (bw, bh - 0.14, bd), (bx, Y0 + 0.14 + (bh - 0.14) / 2, bz), bevel=0.008)
    btop = Y0 + bh
    box(r, tr, (bw + 0.05, 0.06, bd + 0.05), (bx, btop - 0.03, bz), bevel=0.01)
    box(r, rf, (bw - 0.02, 0.02, bd - 0.02), (bx, btop + 0.006, bz))
    for x in (bx - bw / 2, bx + bw / 2):
        for z in (bz - bd / 2, bz + bd / 2):
            box(r, wall, (0.06, bh - 0.1, 0.06), (x, Y0 + 0.1 + (bh - 0.1) / 2, z), bevel=0.01)
    bfz = bz + bd / 2
    roundel(m, r, (bx + 0.12, btop + 0.018, bz + 0.2), 0.3, facing='+y', plate=steel(0x7d8792, panels=None))
    glazing(m, r, (bx + 0.05, Y0 + 0.87, bfz + 0.004), (0.6, 0.08), 6, lit={0, 2, 3, 5}, color=WIN_WARM, emit=0.8)
    catwalk(m, r, (bx + 0.05, Y0 + 0.72, bfz + 0.05), bw - 0.14, 0.09, axis='x', rail=rail, sides=(False, True))
    ladder(r, rail, (bx + bw / 2, Y0 + 0.14, bz + 0.1), bh - 0.2, facing='+x', rung=0.07)
    for x in (bx - bw / 2 + 0.04, bx + bw / 2 - 0.04):
        strobe(r, (x, btop + 0.03, bfz - 0.02))
    # stacks: white concrete, team bands, a red aviation band, sooty crowns, red lights
    band = trim(wear=0.5)
    for (name, x, z, h, rad) in (('smoke0', -0.63, -0.59, 0.86, 0.165), ('smoke1', -0.11, -0.61, 0.7, 0.15)):
        top_y = btop + 0.02 + h
        shell = tune(concrete(0xd8d5cc, grime=0.6, streaks=1.0, wear=0.5, joints=(0.6, 0.12), soot=(top_y - 0.28, top_y - 0.02)), ao=0.8)
        cyl(r, slab_m(0x7c7870), rad + 0.06, 0.1, (x, btop + 0.05, z), r2=rad + 0.025, seg=20, bevel=0.01)
        chimney(m, r, (x, btop + 0.02, z), h, rad, rad * 0.76, mat=shell, band_mat=band, cap=dark_m(), smoke=name,
                bands=[(0.34, 0.07), (0.62, 0.06)], lights=3, ladder_side=-math.pi / 2, glow_ring=False)
        cyl(r, painted(0xb8241a, wear=0.45, panels=None, streaks=0.9), rad * 0.79 + 0.004, h * 0.07, (x, btop + 0.02 + h * 0.86, z), r2=rad * 0.77 + 0.004, seg=20, caps=False)

    # ---- feed pipes boiler -> hall on stands
    pipe_run(r, pipe_m, [(bx + bw / 2, Y0 + 0.52, bz + 0.1), (0.3, Y0 + 0.52, bz + 0.1), (0.3, Y0 + 0.52, hz - hd / 2)], 0.038)
    pipe_run(r, steel(0x6d7a87, panels=None), [(bx + bw / 2, Y0 + 0.38, bz - 0.16), (0.21, Y0 + 0.38, bz - 0.16), (0.21, Y0 + 0.38, hz - hd / 2)], 0.03)
    for (x, z, y) in ((0.3, bz + 0.1, 0.52), (0.21, bz - 0.16, 0.38)):
        box(r, frm, (0.03, y, 0.03), (x + 0.045, Y0 + y / 2, z))
        box(r, frm, (0.09, 0.02, 0.03), (x, Y0 + y - 0.045, z))

    # ---- transformer yard (back right)
    for tx in (0.5, 0.78):
        tz = -0.66
        box(r, slab_m(0x7c7870), (0.22, 0.04, 0.26), (tx, Y0 + 0.02, tz), bevel=0.006)
        box(r, painted(0x6f7d6a, panels=None, wear=0.5, rust=0.3), (0.16, 0.2, 0.2), (tx, Y0 + 0.14, tz), bevel=0.012)
        for s in (-1, 1):
            vent(m, r, (tx + s * 0.08, Y0 + 0.14, tz), (0.16, 0.14), facing='+x' if s > 0 else '-x', slats=8)
        for dx in (-0.045, 0.0, 0.045):
            cyl(r, flat(0xd6d2c8, 0.4), 0.013, 0.08, (tx + dx, Y0 + 0.28, tz), seg=8)
        hazard_band(m, r, (tx, Y0 + 0.2, tz + 0.1 + 0.002), (0.15, 0.03))
        stencil(m, r, 'DANGER', (tx, Y0 + 0.13, tz + 0.1 + 0.002), 0.03, color=0xd8231a)
    for x in (0.4, 0.88):
        bar(r, rail, (x, Y0, -0.42), (x, Y0 + 0.62, -0.42), 0.024)
    bar(r, rail, (0.38, Y0 + 0.6, -0.42), (0.9, Y0 + 0.6, -0.42), 0.022)
    for x in (0.52, 0.76):
        pipe(r, dark_m(), (x, Y0 + 0.6, -0.42), (x, Y0 + 0.31, -0.62), 0.004, flanges=False)
    light(r, (0.9, Y0 + 0.64, -0.42), 0.014, 0xff2a1a, 'blink')
    railing(r, yellow(), (0.3, Y0, -0.94), (0.94, Y0, -0.94), h=0.1)
    railing(r, yellow(), (0.94, Y0, -0.94), (0.94, Y0, -0.1), h=0.1)

    # ---- yard clutter, a lamp
    drums(r, (0.8, Y0, 0.76), 3)
    crates(r, (-0.86, Y0, 0.8), 2, 0.08)
    lamp_post(r, (0.38, Y0, 0.88), 0.4, yaw=math.pi)
