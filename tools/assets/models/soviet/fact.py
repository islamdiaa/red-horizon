"""Soviet construction yard (3x3): sawtooth assembly hall (lit north-light glazing toward the camera) with the
BUILD FOR VICTORY board and a half-open assembly door, a command tower crowned by a lit control room and a big
red banner, a vehicle-bay annex, a yellow tower crane (part 'crane', animated by the game) over a prefab module
going up in the yard. steam0 on the hall roof. Pivots: node --import tsx tools/assets/rig.ts fact soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'fact'
FACTION = 'soviet'
KIND = 'structure'


def build(m):
    m.set_meta(footprint=(3, 3), height=1.7, radius=1.55)
    look()
    P = Pal()
    r = m.root

    # ---- foundation: slab, tarmac yard with hazard lanes
    foundation(m, r, P, 3.0, 3.0)
    slab(r, P.tar, -1.42, 0.62, Y0, Y0 + 0.01, 0.0, 1.42)
    for i in range(5):
        stripe(m, r, (-1.15 + i * 0.4, Y0 + 0.011, 0.12), (0.18, 0.04), facing='+y', color=0xd8a21c)
    hazard_stripes(m, r, (-0.4, Y0 + 0.011, 1.34), (1.9, 0.06), facing='+y')

    # ---- assembly hall (back left)
    hx, hz, hw, hd, hh = -0.48, -0.75, 1.8, 1.26, 0.92
    top, fz = hall(r, P, hx, hz, hw, hd, hh, wall=P.wall, parapet=0.0, roof=False)
    x0, x1 = hx - hw / 2, hx + hw / 2
    box(r, P.roof, (hw - 0.02, 0.02, hd - 0.02), (hx, top + 0.008, hz))
    # sawtooth roof: three teeth, steep lit glazing facing the camera (+z), steel backs, team ridge caps
    rt = top + 0.018
    nt = 3
    td = (hd - 0.06) / nt
    for i in range(nt):
        zc = hz - hd / 2 + 0.03 + td * (i + 0.5)
        th = 0.2
        prism(r, P.wall_dk, [(-td / 2, 0.0), (td / 2 - 0.02, 0.0), (td / 2 - 0.02, th), (td / 2 - 0.06, th)], hw - 0.08, (hx, rt, zc), rot=(0, -math.pi / 2, 0))
        gz = zc + td / 2 - 0.018
        glazing(m, r, (hx, rt + th / 2 + 0.005, gz), (hw - 0.14, th - 0.05), 14, 2, dark=0.55, seed=3 + i, strength=1.5, t=0.13)
        box(r, P.trim, (hw - 0.04, 0.03, 0.05), (hx, rt + th + 0.012, zc + td / 2 - 0.04), bevel=0.006)
    # front: pilasters, plinth hazard band, assembly door, slogan, banner, windows, lights
    pilasters(r, P.frame, [x0 + 0.03, x1 - 0.03], fz, Y0 + 0.13, top - 0.06, w=0.07, dz=0.05)
    pilasters(r, P.frame, [hz - 0.3, hz + 0.25], x1, Y0 + 0.13, top - 0.06, w=0.07, dz=0.05, facing='+x')
    dx, dw, dh = -0.78, 0.78, 0.64
    box(r, P.void, (dw, dh, 0.01), (dx, Y0 + dh / 2, fz + 0.001))
    # interior glimpse under the half-open shutter: warm work lights, a hull on a jig
    strip_light(r, (dx, Y0 + 0.27, fz - 0.003), (dw - 0.1, 0.03), color=0xffc27a, strength=2.0)
    box(r, P.olive, (0.42, 0.1, 0.02), (dx + 0.04, Y0 + 0.06, fz + 0.004), bevel=0.004)
    box(r, corrugated(0x5a5e63, along='x', pitch=0.024, rust=0.45, wear=0.6), (dw - 0.02, dh * 0.55, 0.014), (dx, Y0 + dh - dh * 0.275, fz + 0.012))
    box(r, P.yellow, (dw - 0.02, 0.03, 0.026), (dx, Y0 + dh * 0.45 - 0.01, fz + 0.016), bevel=0.004)
    box(r, P.wall_dk, (dw + 0.14, 0.09, 0.07), (dx, Y0 + dh + 0.045, fz + 0.03), bevel=0.012)
    for s in (-1, 1):
        box(r, P.wall_dk, (0.07, dh, 0.07), (dx + s * (dw / 2 + 0.035), Y0 + dh / 2, fz + 0.03), bevel=0.012)
        m.decal(hazard_img(aspect=dh / 0.05), at=(dx + s * (dw / 2 + 0.035), Y0 + dh / 2, fz + 0.066), size=(dh, 0.05), facing='+z', part=r, depth=0.01, roll=math.pi / 2)
        lamp(r, (dx + s * (dw / 2 + 0.035), Y0 + dh + 0.09, fz + 0.03), 0.022, 0xffa020, 'blink')
    m.decal(hazard_img(aspect=(dw + 0.14) / 0.05), at=(dx, Y0 + dh + 0.045, fz + 0.066), size=(dw + 0.14, 0.05), facing='+z', part=r, depth=0.01)
    stencil(m, r, '01', (dx + 0.26, Y0 + dh * 0.72, fz + 0.02), 0.11)
    slogan(m, r, (0.02, Y0 + 0.66, fz + 0.03), (0.62, 0.3), 'BUILD FOR|VICTORY', lights=3)
    red_banner(m, r, (x0 + 0.17, top - 0.07, fz + 0.03), (0.24, 0.6))
    window_row(r, (0.06, Y0 + 0.33, fz), 4, (0.1, 0.09), 0.05, dark=(2,), strength=2.1)
    door(m, r, (0.32, Y0, fz), (0.14, 0.24), kind='double')
    rivet_row(m, r, (x0 + 0.05, top - 0.09, fz), (x1 - 0.05, top - 0.09, fz))
    neon(r, x0 + 0.08, -0.38, top, fz)
    for x in (x0 + 0.04, x1 - 0.04):
        lamp(r, (x, top + 0.0, fz + 0.0), 0.022)
    downpipe(r, P.steel, (x1 - 0.12, 0, fz), Y0 + 0.13, top - 0.05)
    # right side of the hall: vents and a cabinet
    for i in range(2):
        vent(m, r, (x1, Y0 + 0.55, hz - 0.3 + i * 0.5), (0.18, 0.12), facing='+x')
    junction_box(r, (x1, Y0 + 0.3, hz + 0.0), (0.08, 0.11, 0.03), facing='+x', conduit=0.12)
    # roof back strip: AC, vent with the steam point
    roof_vent(r, (hx - 0.66, rt - 0.01, hz - 0.5), 0.045)
    m.steam('steam0', (-1.14, 1.08, -1.25))

    # ---- command tower (back right): the landmark
    tx, tz, tw, th_ = 1.0, -0.86, 0.66, 1.22
    ttop, tfz = hall(r, P, tx, tz, tw, tw, th_, wall=P.wall_dk, parapet=0.0, roof=False, cornice=False)
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(r, P.frame, (0.07, th_ - 0.1, 0.07), (tx + sx * (tw / 2), Y0 + 0.1 + (th_ - 0.1) / 2, tz + sz * (tw / 2)), bevel=0.012)
    # team-red vertical stripes down the tower's front corners (free decals)
    for sx in (-1, 1):
        stripe(m, r, (tx + sx * 0.25, Y0 + 0.62, tfz + 0.001), (0.05, 0.9), team_k=1)
    red_banner(m, r, (tx, Y0 + 1.12, tfz + 0.03), (0.34, 0.74))
    window_row(r, (tx, Y0 + 0.24, tfz), 2, (0.08, 0.09), 0.2, dark=(1,), strength=2.0)
    door(m, r, (tx + 0.2, Y0, tfz), (0.12, 0.2), kind='hatch')
    ladder(r, P.rail, (tx + tw / 2 + 0.035, Y0 + 0.1, tz + 0.12), th_ - 0.1, facing='+x', cage=True)
    # control room: deck slab, lit glazing band all round, mullions, overhanging roof with a team fascia
    cy = Y0 + th_
    box(r, P.wall, (tw + 0.12, 0.06, tw + 0.12), (tx, cy + 0.03, tz), bevel=0.014)
    box(r, glass(lit=0xffd08a, strength=1.8), (tw + 0.02, 0.19, tw + 0.02), (tx, cy + 0.155, tz))
    for k, (f, at) in enumerate((('+z', (tx, cy + 0.155, tz + tw / 2 + 0.012)), ('+x', (tx + tw / 2 + 0.012, cy + 0.155, tz)), ('-x', (tx - tw / 2 - 0.012, cy + 0.155, tz)))):
        m.decal(mullions(5, 1, aspect=(tw + 0.02) / 0.19, t=0.12, dark=0.3, seed=7 + k), at=at, size=(tw + 0.02, 0.19), facing=f, part=r, depth=0.02, emit=0.0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(r, P.frame, (0.035, 0.2, 0.035), (tx + sx * (tw / 2 + 0.012), cy + 0.155, tz + sz * (tw / 2 + 0.012)))
    box(r, P.roof, (tw + 0.18, 0.05, tw + 0.18), (tx, cy + 0.275, tz), bevel=0.012)
    box(r, P.trim, (tw + 0.19, 0.035, tw + 0.19), (tx, cy + 0.255, tz), bevel=0.008)
    stencil(m, r, 'ШТАБ', (tx, cy + 0.03, tz + tw / 2 + 0.061), 0.04, color=0xe8b434)
    rtop = cy + 0.3
    roof_lights(r, tx - tw / 2 - 0.06, tz - tw / 2 - 0.06, tx + tw / 2 + 0.06, tz + tw / 2 + 0.06, rtop, r=0.022)
    # mast with red lamps, dish, AC
    bar(r, P.dark, (tx + 0.18, rtop, tz - 0.16), (tx + 0.18, rtop + 0.44, tz - 0.16), 0.022)
    for k in range(3):
        y = rtop + 0.08 + k * 0.13
        bar(r, P.red, (tx + 0.13, y, tz - 0.16), (tx + 0.23, y, tz - 0.16), 0.012)
    lamp(r, (tx + 0.18, rtop + 0.44, tz - 0.16), 0.022)
    dish(r, (tx - 0.13, rtop, tz - 0.08), 0.12, mat=P.white, yaw=-2.2, pitch=0.6)
    ac_unit(r, (tx - 0.12, rtop, tz + 0.2), 0.09, mat=P.wall_lt)

    # ---- vehicle bay annex (right front) with a roller door
    ax, az, aw, ad, ah = 1.0, 0.06, 0.68, 0.62, 0.5
    atop, afz = hall(r, P, ax, az, aw, ad, ah, wall=P.wall, parapet=0.035)
    door(m, r, (ax - 0.08, Y0, afz), (0.36, 0.3), kind='roller', hazard_frame=True)
    stencil(m, r, '02', (ax + 0.24, Y0 + 0.34, afz + 0.002), 0.08, color=0xe8b434)
    window(r, (ax + 0.24, Y0 + 0.18, afz), (0.09, 0.08), strength=2.1)
    lamp(r, (ax - 0.32, atop + 0.035, afz - 0.02), 0.02)
    lamp(r, (ax + 0.32, atop + 0.035, afz - 0.02), 0.02)
    ac_unit(r, (ax - 0.12, atop + 0.018, az - 0.08), 0.1, mat=P.wall_lt)
    roof_vent(r, (ax + 0.2, atop + 0.018, az + 0.14), 0.035)
    for i in range(4):  # steps up the left side
        box(r, P.frame, (0.1, 0.03, 0.08), (ax - aw / 2 - 0.06, Y0 + 0.03 + i * 0.1, az + 0.18 - i * 0.08), bevel=0.003)
    # feed pipe from the hall to the annex
    pipe_run(r, P.rust, [(x1 + 0.0, Y0 + 0.6, hz + 0.3), (0.62, Y0 + 0.6, hz + 0.3), (0.62, Y0 + 0.6, az - ad / 2)], 0.032)
    box(r, P.frame, (0.03, 0.6, 0.03), (0.62, Y0 + 0.3, hz + 0.3 + 0.0), bevel=0.004)

    # ---- crane tower (front left): yellow lattice mast, the jib is the animated part 'crane'
    cx, cz, chh = -1.02, 0.6, 1.12
    box(r, P.conc_dk, (0.32, 0.07, 0.32), (cx, Y0 + 0.035, cz), bevel=0.012)
    yb = Y0 + 0.07
    L = 0.075
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        bar(r, P.yellow, (cx + sx * L, yb, cz + sz * L), (cx + sx * L, yb + chh - 0.04, cz + sz * L), 0.026)
    nlev = 8
    for i in range(nlev):
        y_a = yb + 0.04 + i * (chh - 0.1) / nlev
        y_b = y_a + (chh - 0.1) / nlev
        flip = 1 if i % 2 else -1
        for (a, b) in (((-L, -L), (L, -L)), ((-L, L), (L, L)), ((-L, -L), (-L, L)), ((L, -L), (L, L))):
            pa = (cx + a[0], y_a if flip > 0 else y_b, cz + a[1])
            pb = (cx + b[0], y_b if flip > 0 else y_a, cz + b[1])
            bar(r, P.yellow, pa, pb, 0.011)
    box(r, P.dark, (0.2, 0.04, 0.2), (cx, yb + chh - 0.02, cz), bevel=0.006)
    crane = m.part('crane', at=(-1.02, 1.22, 0.6), rot=(0, 0.6, 0))
    c = crane
    box(c, P.yellow, (0.2, 0.1, 0.2), (0, 0.05, 0), bevel=0.012)                  # slewing unit
    box(c, P.yellow, (0.1, 0.08, 0.11), (0.07, 0.07, 0.11), bevel=0.01)              # cab
    box(c, glass(lit=0xffd08a, strength=1.4), (0.082, 0.045, 0.006), (0.07, 0.08, 0.166))
    box(c, glass(lit=0xffd08a, strength=1.4), (0.006, 0.045, 0.08), (0.121, 0.08, 0.11))
    jl = 1.3
    for (y, z) in ((0.11, -0.04), (0.11, 0.04)):
        bar(c, P.yellow, (0.08, y, z), (jl, y, z), 0.022)
    bar(c, P.yellow, (0.08, 0.19, 0.0), (jl - 0.05, 0.13, 0.0), 0.02)
    n = 9
    for i in range(n):
        xa = 0.1 + i * (jl - 0.12) / n
        xb = xa + (jl - 0.12) / n
        yt = 0.19 - 0.06 * (xa / jl)
        for z in (-0.04, 0.04):
            bar(c, P.yellow, (xa, 0.11, z), (xb, yt, z * 0.2), 0.009)
    m.decal(hazard_img(aspect=8), at=(0.5, 0.11, 0.052), size=(0.48, 0.022), facing='+z', part=c, depth=0.01)
    box(c, P.yellow, (0.4, 0.035, 0.08), (-0.2, 0.11, 0), bevel=0.006)               # counter-jib
    box(c, P.conc_dk, (0.13, 0.11, 0.11), (-0.33, 0.085, 0), bevel=0.012)           # counterweight
    stencil(m, c, 'KB-60', (-0.33, 0.085, 0.056), 0.05, color=0xe8b434)
    bar(c, P.yellow, (0, 0.1, 0), (0, 0.34, 0), 0.026)                                # A-frame
    pipe(c, P.dark, (0, 0.33, 0), (jl * 0.92, 0.15, 0), 0.0035, flanges=False, seg=4)
    pipe(c, P.dark, (0, 0.33, 0), (-0.32, 0.14, 0), 0.0035, flanges=False, seg=4)
    lamp(c, (0, 0.345, 0), 0.02)
    lamp(c, (jl - 0.01, 0.13, 0), 0.02)
    box(c, P.dark, (0.06, 0.025, 0.09), (0.95, 0.09, 0), bevel=0.004)                # trolley
    pipe(c, P.dark, (0.95, 0.08, 0), (0.95, -0.4, 0), 0.003, flanges=False, seg=4)
    box(c, P.yellow, (0.035, 0.05, 0.035), (0.95, -0.42, 0), bevel=0.006)          # hook block
    box(c, P.wall_lt, (0.28, 0.06, 0.12), (0.95, -0.48, 0), bevel=0.01)            # a wall panel on the hook

    # ---- prefab module going up in the yard (steel frame, first panels, scaffold)
    sx, sz = -0.36, 0.56
    box(r, P.conc_dk, (0.58, 0.04, 0.52), (sx, Y0 + 0.02, sz), bevel=0.008)
    for (ddx, ddz) in ((-0.26, -0.23), (0.26, -0.23), (-0.26, 0.23), (0.26, 0.23)):
        box(r, P.frame, (0.035, 0.46, 0.035), (sx + ddx, Y0 + 0.27, sz + ddz), bevel=0.004)
    for y in (0.26, 0.49):
        for (w, d, ox, oz) in ((0.55, 0.03, 0, -0.23), (0.55, 0.03, 0, 0.23), (0.03, 0.49, -0.26, 0), (0.03, 0.49, 0.26, 0)):
            box(r, P.red, (w, 0.03, d), (sx + ox, Y0 + y, sz + oz), bevel=0.004)
    box(r, P.wall, (0.5, 0.22, 0.035), (sx, Y0 + 0.15, sz - 0.23), bevel=0.006)
    box(r, P.wall, (0.035, 0.22, 0.44), (sx - 0.26, Y0 + 0.15, sz), bevel=0.006)
    box(r, P.wall, (0.25, 0.2, 0.035), (sx - 0.12, Y0 + 0.37, sz - 0.23), bevel=0.006)
    box(r, painted(0x6a5a3a, wear=0.4, panels=None), (0.58, 0.014, 0.1), (sx, Y0 + 0.27, sz + 0.28))
    for ddx in (-0.27, 0.27):
        bar(r, P.rail, (sx + ddx, Y0, sz + 0.32), (sx + ddx, Y0 + 0.27, sz + 0.32), 0.012)
    ladder(r, P.rail, (sx + 0.2, Y0, sz + 0.33), 0.27, facing='+z')
    lamp(r, (sx + 0.26, Y0 + 0.5, sz + 0.23), 0.02, 0xffa020, 'blink')
    # materials: steel beams, wall panels, crates, drums, sandbags
    for i in range(3):
        box(r, P.steel, (0.5, 0.026, 0.045), (-0.12, Y0 + 0.024 + i * 0.027, 1.04 + (i % 2) * 0.05), bevel=0.004)
    for i in range(3):
        box(r, P.wall_dk, (0.34, 0.032, 0.22), (0.4, Y0 + 0.016 + i * 0.034, 1.02), (0, i * 0.08, 0), bevel=0.006)
    crates(r, P, (0.32, Y0, 0.66), 0.1, 3, 0.2)
    drums(r, (-0.6, Y0, 1.12), 3)
    sandbags(r, P, (0.72, Y0, 1.3), (1.22, Y0, 1.3), rows=2)
    lamp_post(r, P, (1.36, Y0, 1.32), 0.44, yaw=math.pi)
    lamp_post(r, P, (-1.38, Y0, 1.32), 0.44, yaw=0.0)
