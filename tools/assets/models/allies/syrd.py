"""Allied shipyard (3x3, on water): a bright U of concrete piers on pilings with yellow safety edges and dock
lamps around the slipway, a destroyer hull under construction (hull number, welding glow 'glow:weld'), the
fabrication hall at the head of the slip (white walls, vaults with team stripes, the lit DOCK 3 door), offices and
a glazed control tower on the left pier, a big yellow gantry crane over the slip (parts gantry > gantryT), a
water-facing portal crane on the left pier head, the tower crane on the right pier (part 'jib'), containers,
fuel tanks, bollards, fenders, red / green harbour lights ('glow:harbour'), floodlight masts and the stack.
"""
import math
import os
import sys

import mathutils

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'syrd'
FACTION = 'allies'
KIND = 'structure'

TOP = 0.1


def build(m):
    setup(m, ao_dist=0.36, dirt_h=0.0)
    m.set_meta(footprint=(3, 3), height=1.0, radius=1.55)
    r = m.root

    wall = white()
    wall2 = offwhite()
    frm = frame()
    tr = trim()
    rf = roof()
    yel = yellow(wear=0.55)
    rail = rail_m()
    pier = tune(concrete(0xc3beb3, joints=(0.5, 0.5), grime=0.55, streaks=0.4, wear=0.6), ao=0.8)
    piling = tune(painted(0x4c4136, panels=None, wear=0.2, rust=0.6, grime=0.8, rough=0.9, metal=0.0), ao=0.9)
    weed = flat(0x2c3a26, 0.95)
    PL = steel(0x7d8792, panels=None)

    # ---- piers on pilings, yellow safety edges along the water, bollards, fenders, dock lamps
    for (x, z, w, d) in ((-1.12, -0.05, 0.66, 2.8), (1.12, -0.05, 0.66, 2.8), (0.0, -1.2, 1.58, 0.5)):
        _platform(r, pier, piling, weed, x, z, w, d)
    for s in (-1, 1):
        # inner edge (slip side) and outer edge: yellow lines on thin strips
        for ex in (0.8 * s, 1.44 * s):
            mark(m, r, solid(HAZ_Y), (ex - 0.02 * s, TOP, -0.05), (0.035, 2.72), pier, rough=0.6)
        mark(m, r, haz_img(10), (1.12 * s, TOP, 1.3), (0.6, 0.06), pier, rough=0.6)
        box(r, slab_m(0x85807a), (0.14, 0.08, 1.4), (0.6 * s, TOP - 0.04, -0.3), bevel=0.01)
        box(r, dark_m(), (0.025, 0.012, 1.4), (0.6 * s, TOP + 0.004, -0.3))
        for i in range(5):
            zz = -0.85 + i * 0.5
            cyl(r, dark_m(), 0.016, 0.034, (0.84 * s, TOP + 0.017, zz), r2=0.013, seg=8)
            box(r, rubber(), (0.03, 0.07, 0.06), (0.8 * s, TOP - 0.05, zz + 0.12), bevel=0.008)
        for zz in (-0.6, 0.25, 1.05):
            lamp_post(r, (0.86 * s, TOP, zz), 0.32, yaw=-s * math.pi / 2)
        # harbour lights at the pier heads (green starboard, red port)
        lx = 1.3 * s
        cyl(r, white(panels=None), 0.034, 0.32, (lx, TOP + 0.16, 1.2), r2=0.028, seg=10)
        for k, yy in enumerate((0.08, 0.2)):
            cyl(r, painted(0xc8231a if s < 0 else 0x2f9a4a, panels=None, wear=0.4), 0.036, 0.05, (lx, TOP + yy, 1.2), seg=10, caps=False)
        cyl(r, dark_m(), 0.042, 0.012, (lx, TOP + 0.32, 1.2), seg=10)
        sphere(r, glow_material('glow:harbour', 0x40ff70 if s > 0 else 0xff3020), 0.026, (lx, TOP + 0.35, 1.2), seg=10, rings=6)

    # ---- slipway ramp + the hull under construction
    F = T((0, 0.02, -0.3), (-0.065, 0, 0))

    def P(v):
        return tuple(F @ mathutils.Vector(v))
    box(r, slab_m(0x7e7a73), (0.92, 0.05, 1.6), P((0, 0, 0)), (-0.065, 0, 0), bevel=0.01)
    for i in range(8):
        box(r, metal(0x8a9096, rough=0.4), (0.88, 0.01, 0.022), P((0, 0.03, -0.72 + i * 0.205)), (-0.065, 0, 0))
    for s in (-1, 1):
        box(r, yel, (0.03, 0.02, 1.6), P((0.34 * s, 0.035, 0)), (-0.065, 0, 0))
    box(r, yel, (0.05, 0.012, 1.6), P((0, 0.032, 0)), (-0.065, 0, 0))
    _hull(m, r, rail)

    # ---- fabrication hall at the head of the slip
    hz = -1.2
    box(r, wall, (1.5, 0.42, 0.46), (0, TOP + 0.21, hz), bevel=0.02)
    box(r, tr, (1.53, 0.05, 0.49), (0, TOP + 0.405, hz), bevel=0.008)
    for i in range(3):
        x = -0.5 + i * 0.5
        arc = [(0.25 * math.cos(math.pi * k / 10), 0.11 * math.sin(math.pi * k / 10)) for k in range(11)]
        prism(r, steel(0xc3c9cf, panels=(0.1, 0.3), grime=0.5, streaks=0.5), arc, 0.5, (x, TOP + 0.43, hz))
        for dx in (-0.07, 0.07):
            box(r, tr, (0.05, 0.012, 0.5), (x + dx, TOP + 0.43 + 0.11 * math.cos(dx * 4) - 0.004, hz), (0, 0, -dx * 2.2))
    hfz = hz + 0.23
    box(r, black(), (0.72, 0.33, 0.01), (0, TOP + 0.165, hfz + 0.003))
    box(r, light_mat(WIN_WARM, 1.0, 'steady'), (0.6, 0.16, 0.004), (0, TOP + 0.1, hfz + 0.007))
    sh = corrugated(0x9aa4b0, along='x', pitch=0.024, rust=0.25, streaks=0.7)
    box(r, sh, (0.7, 0.14, 0.014), (0, TOP + 0.26, hfz + 0.012), bevel=0.003)
    box(r, frm, (0.8, 0.05, 0.05), (0, TOP + 0.355, hfz + 0.025), bevel=0.008)
    hazard_band(m, r, (0, TOP + 0.355, hfz + 0.051), (0.76, 0.04))
    for s in (-1, 1):
        box(r, frm, (0.04, 0.34, 0.04), (s * 0.38, TOP + 0.17, hfz + 0.02), bevel=0.006)
        glazing(m, r, (s * 0.58, TOP + 0.28, hfz + 0.004), (0.2, 0.07), 2, lit={0, 1} if s < 0 else {1}, color=WIN_WARM, emit=0.9)
    lit_sign(m, r, (0.58, TOP + 0.13, hfz + 0.03), (0.28, 0.08), 'DOCK 3', lights=0, emblem_kind=None)
    badge(m, r, 'anchor', (-0.58, TOP + 0.13, hfz + 0.002), 0.13, field='shield', plate=wall)
    # stack
    cyl(r, white(panels=None), 0.055, 0.2, (0.55, TOP + 0.52, -1.3), r2=0.045, seg=12)
    cyl(r, tr, 0.058, 0.03, (0.55, TOP + 0.58, -1.3), seg=12, caps=False)
    cyl(r, dark_m(), 0.047, 0.012, (0.55, TOP + 0.625, -1.3), seg=12)
    m.smoke('smoke0', (0.55, 0.74, -1.3))

    # ---- offices + control tower on the left pier
    ox, oz = -1.12, -0.55
    box(r, wall2, (0.48, 0.3, 0.62), (ox, TOP + 0.15, oz), bevel=0.016)
    box(r, tr, (0.52, 0.04, 0.66), (ox, TOP + 0.3, oz), bevel=0.008)
    box(r, rf, (0.46, 0.02, 0.6), (ox, TOP + 0.322, oz))
    glazing(m, r, (ox, TOP + 0.2, oz + 0.314), (0.36, 0.08), 3, lit={0, 2}, color=WIN_WARM, emit=0.9)
    glazing(m, r, (ox + 0.244, TOP + 0.2, oz), (0.5, 0.08), 4, facing='+x', lit={0, 2, 3}, color=WIN_WARM, emit=0.9)
    lit_doorway(m, r, (ox - 0.12, TOP, oz + 0.31), (0.12, 0.17))
    big_text(m, r, '3', (ox + 0.08, TOP + 0.332, oz + 0.12), 0.26, plate=tr)
    tx, tz = -1.2, -0.7
    box(r, wall, (0.22, 0.32, 0.22), (tx, TOP + 0.46, tz), bevel=0.012)
    box(r, glass(0x2b4762), (0.24, 0.08, 0.24), (tx, TOP + 0.66, tz))
    for fc, at_ in (('+z', (tx, TOP + 0.66, tz + 0.122)), ('+x', (tx + 0.122, TOP + 0.66, tz))):
        m.decal(lit_panes_img(3, 1, lit={0, 2}, color=WIN_COOL), at=at_, size=(0.22, 0.07), facing=fc, depth=0.01, team=0, emit=0.9)
    box(r, tr, (0.27, 0.035, 0.27), (tx, TOP + 0.715, tz), bevel=0.006)
    cyl(r, dark_m(), 0.007, 0.32, (tx - 0.05, TOP + 0.89, tz - 0.05), r2=0.003, seg=6)
    light(r, (tx - 0.05, TOP + 1.05, tz - 0.05), 0.012, 0xff2a1a, 'blink')
    floodlight(r, (tx + 0.1, TOP + 0.74, tz + 0.1), yaw=0.5, pitch=0.8, s=0.045)

    # ---- water-facing portal crane on the left pier head
    _portal_crane(m, r, yel, frm, rail, (-1.12, TOP, 0.9))

    # ---- gantry crane over the slip (moves along z), trolley (moves along x)
    g = m.part('gantry', at=(0, TOP, -0.25))
    span, gh = 1.2, 0.62
    for s in (-1, 1):
        lx = span / 2 * s
        for dz in (-0.08, 0.08):
            box(g, yel, (0.044, gh, 0.044), (lx, gh / 2, dz), bevel=0.007)
        box(g, yel, (0.05, 0.04, 0.26), (lx, 0.02, 0), bevel=0.008)
        for dz in (-0.1, 0.1):
            box(g, dark_m(), (0.06, 0.03, 0.06), (lx, 0.015, dz), bevel=0.005)
        for i in range(1, 4):
            bar(g, yel, (lx, gh * (i - 1) / 4 + 0.02, -0.08), (lx, gh * i / 4, 0.08), 0.016)
        m.decal(haz_img(2.5), at=(lx, 0.12, 0.103), size=(0.05, 0.1), facing='+z', part=g, depth=0.01, team=0, roll=math.pi / 2)
    for dz in (-0.055, 0.055):
        box(g, yel, (span + 0.12, 0.09, 0.045), (0, gh + 0.045, dz), bevel=0.009)
    box(g, dark_m(), (span + 0.12, 0.008, 0.08), (0, gh + 0.094, 0))
    m.decal(haz_img(span * 0.7 / 0.04), at=(0, gh + 0.045, 0.0785), size=(span * 0.7, 0.05), facing='+z', part=g, depth=0.01, team=0)
    box(g, tr, (0.1, 0.08, 0.09), (span / 2 - 0.09, gh - 0.04, 0.1), bevel=0.012)
    box(g, glass(0x2b4762), (0.08, 0.04, 0.004), (span / 2 - 0.09, gh - 0.035, 0.146))
    light(g, (-span / 2, gh + 0.1, 0), 0.014, 0xffa020, 'blink')
    light(g, (span / 2, gh + 0.1, 0), 0.014, 0xffa020, 'blink')
    for x in (-0.3, 0.3):
        floodlight(g, (x, gh - 0.005, 0.07), yaw=0.0, pitch=1.25, s=0.045)
    gt = m.part('gantryT', parent='gantry', at=(0, gh + 0.005, 0))
    box(gt, dark_m(), (0.12, 0.04, 0.16), (0, 0, 0), bevel=0.006)
    for dz in (-0.02, 0.02):
        bar(gt, dark_m(), (0, -0.01, dz), (0, -0.29, dz), 0.004)
    box(gt, dark_m(), (0.04, 0.025, 0.06), (0, -0.3, 0), bevel=0.004)
    box(gt, tr, (0.18, 0.045, 0.13), (0, -0.335, 0), bevel=0.008)

    # ---- tower crane on the right pier + the slewing jib
    cx, cz = 1.12, 0.1
    box(r, slab_m(0x7c7870), (0.22, 0.05, 0.22), (cx, TOP + 0.025, cz), bevel=0.01)
    for (dx, dz) in ((-0.055, -0.055), (0.055, -0.055), (-0.055, 0.055), (0.055, 0.055)):
        box(r, yel, (0.026, 0.63, 0.026), (cx + dx, TOP + 0.36, cz + dz), bevel=0.004)
    for i in range(5):
        y0_, y1_ = TOP + 0.06 + i * 0.12, TOP + 0.18 + i * 0.12
        for s in (-1, 1):
            bar(r, yel, (cx - 0.055, y0_, cz + 0.055 * s), (cx + 0.055, y1_, cz + 0.055 * s), 0.009)
            bar(r, yel, (cx + 0.055 * s, y0_, cz - 0.055), (cx + 0.055 * s, y1_, cz + 0.055), 0.009)
    j = m.part('jib', at=(cx, TOP + 0.68, cz), rot=(0, 2.2, 0))
    box(j, yel, (0.15, 0.09, 0.15), (0, 0, 0), bevel=0.014)
    box(j, tr, (0.08, 0.05, 0.004), (0.05, 0.0, 0.077))
    for dz in (-0.026, 0.026):
        bar(j, yel, (0.06, 0.04, dz), (0.86, 0.04, dz), 0.02)
    bar(j, yel, (0.06, 0.095, 0), (0.8, 0.075, 0), 0.018)
    for i in range(7):
        x0 = 0.08 + i * 0.11
        bar(j, yel, (x0, 0.04, -0.026), (x0 + 0.055, 0.085, 0), 0.008)
        bar(j, yel, (x0, 0.04, 0.026), (x0 + 0.055, 0.085, 0), 0.008)
    box(j, slab_m(0x8a857c), (0.13, 0.1, 0.1), (-0.15, 0.02, 0), bevel=0.01)
    bar(j, dark_m(), (0.76, 0.03, 0), (0.76, -0.33, 0), 0.004)
    box(j, painted(0xb8241a, panels=None, wear=0.6, rust=0.3), (0.12, 0.07, 0.07), (0.76, -0.38, 0), bevel=0.01)
    light(j, (0.85, 0.1, 0), 0.013, 0xff2a1a, 'blink')

    # ---- containers, fuel tanks, plate stacks, floodlight masts
    for (y, z, c) in ((0.05, 0.75, None), (0.15, 0.75, 0xe6e3da), (0.05, 0.62, 0xb8241a)):
        mat = tr if c is None else painted(c, panels=(0.06, 0.2), wear=0.6, rust=0.3)
        box(r, mat, (0.24, 0.1, 0.1), (1.12, TOP + y, z), bevel=0.008)
    stencil(m, r, 'USN', (1.12, TOP + 0.15, 0.80 + 0.001), 0.04, color=0x2a2e34, depth=0.01)
    for z in (-0.55, -0.8):
        cyl(r, white(panels=None), 0.09, 0.22, (1.15, TOP + 0.11, z), seg=14, bevel=0.008)
        cyl(r, tr, 0.093, 0.035, (1.15, TOP + 0.16, z), seg=14, caps=False)
    stencil(m, r, 'FUEL', (1.15, TOP + 0.09, -0.55 + 0.092), 0.035, color=0xc8231a, depth=0.02)
    for i in range(3):
        box(r, metal(0x8a9096, rough=0.5, rust=0.3), (0.3, 0.02, 0.2), (-1.1, TOP + 0.01 + i * 0.021, 0.3 + i * 0.01), bevel=0.003)
    for x in (-0.8, 0.8):
        cyl(r, gun_m(), 0.013, 0.62, (x, TOP + 0.31, -0.85), r2=0.01, seg=8)
        floodlight(r, (x, TOP + 0.62, -0.83), yaw=0.0, pitch=0.7, s=0.055)
        light(r, (x, TOP + 0.66, -0.85), 0.011, 0xff2a1a, 'blink')


def _portal_crane(m, r, yel, frm, rail, at):
    """Level-luffing portal crane: four legs straddling the pier, a machinery house with a team band and a cab,
    a long lattice jib reaching out over the water (+z), a counterweight and a hook block."""
    x, y, z = at
    h = 0.34
    for (dx, dz) in ((-0.16, -0.12), (0.16, -0.12), (-0.16, 0.12), (0.16, 0.12)):
        bar(r, yel, (x + dx, y, z + dz), (x + dx * 0.55, y + h, z + dz * 0.55), 0.03)
        box(r, dark_m(), (0.06, 0.03, 0.08), (x + dx, y + 0.015, z + dz), bevel=0.005)
    for dz in (-0.12, 0.12):
        bar(r, yel, (x - 0.16, y + 0.12, z + dz), (x + 0.16, y + 0.12, z + dz), 0.018)
    m.decal(haz_img(4), at=(x, y + 0.12, z + 0.13), size=(0.32, 0.03), facing='+z', depth=0.01, team=0)
    cyl(r, frm, 0.11, 0.03, (x, y + h + 0.015, z), seg=14, bevel=0.005)
    hy = y + h + 0.03
    house = white(panels=(0.08, 0.06))
    box(r, house, (0.2, 0.13, 0.26), (x, hy + 0.065, z - 0.02), bevel=0.014)
    box(r, trim(), (0.205, 0.035, 0.265), (x, hy + 0.11, z - 0.02), bevel=0.006)
    box(r, glass(0x2b4762), (0.12, 0.05, 0.004), (x, hy + 0.06, z + 0.111))
    m.decal(lit_panes_img(3, 1, lit={0, 1}, color=WIN_WARM), at=(x, hy + 0.06, z + 0.114), size=(0.12, 0.05), facing='+z', depth=0.008, team=0, emit=0.9)
    box(r, slab_m(0x8a857c), (0.16, 0.1, 0.1), (x, hy + 0.05, z - 0.2), bevel=0.01)
    # jib: two chords + lacing, rising out over the water
    root = mathutils.Vector((x, hy + 0.08, z + 0.1))
    tip = mathutils.Vector((x + 0.08, hy + 0.32, z + 0.6))
    for dx in (-0.025, 0.025):
        bar(r, yel, tuple(root + mathutils.Vector((dx, 0, 0))), tuple(tip + mathutils.Vector((dx * 0.6, 0, 0))), 0.018)
    top_root = root + mathutils.Vector((0, 0.06, 0))
    bar(r, yel, tuple(top_root), tuple(tip + mathutils.Vector((0, 0.03, 0))), 0.016)
    for i in range(6):
        t0, t1 = i / 6, (i + 1) / 6
        a = root.lerp(tip, t0)
        b = top_root.lerp(tip + mathutils.Vector((0, 0.03, 0)), t1)
        bar(r, yel, tuple(a + mathutils.Vector((-0.025, 0, 0))), tuple(b), 0.008)
        bar(r, yel, tuple(a + mathutils.Vector((0.025, 0, 0))), tuple(b), 0.008)
    bar(r, frm, tuple(tip), tuple(tip - mathutils.Vector((0, 0.3, 0))), 0.005)
    box(r, painted(0xb8241a, panels=None, wear=0.5), (0.05, 0.05, 0.05), tuple(tip - mathutils.Vector((0, 0.32, 0))), bevel=0.008)
    light(r, tuple(tip + mathutils.Vector((0, 0.05, 0))), 0.013, 0xff2a1a, 'blink')
    floodlight(r, (x, hy + 0.14, z + 0.1), yaw=0.0, pitch=0.9, s=0.045)


def _platform(r, pier, piling, weed, x, z, w, d):
    box(r, pier, (w, 0.08, d), (x, TOP - 0.04, z), bevel=0.014)
    box(r, slab_m(0x6e6a63), (w + 0.012, 0.025, d + 0.012), (x, TOP - 0.085, z), bevel=0.006)
    nx = max(2, round(w / 0.45))
    nz = max(2, round(d / 0.45))
    for i in range(nx):
        for k in range(nz):
            if 0 < i < nx - 1 and 0 < k < nz - 1:
                continue
            px = x - w / 2 + 0.05 + (w - 0.1) * i / (nx - 1)
            pz = z - d / 2 + 0.05 + (d - 0.1) * k / (nz - 1)
            cyl(r, piling, 0.032, 0.5, (px, TOP - 0.1 - 0.25, pz), r2=0.03, seg=6, caps=False)
            cyl(r, weed, 0.036, 0.04, (px, -0.005, pz), seg=6, caps=False)


def _hull(m, r, rail):
    """Destroyer hull on the slip: plated light-grey bow half with a red antifouling band and a big hull number,
    exposed rust ribs aft, keel blocks, scaffolding and two welding glows."""
    hullm = steel(0xaab1b8, panels=(0.12, 0.06), wear=0.5, rust=0.25)
    anti = painted(0x8e2c22, panels=None, wear=0.4, rust=0.4)
    rib = rusty(0x6a4a34, 0.7)
    deck = tread(0x6a6e72)
    tilt = -0.06
    F = T((0, 0.2, -0.35), (tilt, 0, 0))

    def P(v):
        return tuple(F @ mathutils.Vector(v))
    prof = [(-0.17, -0.06), (0.17, -0.06), (0.15, -0.12), (0.06, -0.16), (-0.06, -0.16), (-0.15, -0.12)]
    for (z0, z1, k) in ((0.0, 0.3, 1.0), (0.3, 0.52, 0.75), (0.52, 0.64, 0.4)):
        prism(r, hullm, [(px_ * k, py_) for (px_, py_) in prof], z1 - z0, P((0, 0.1, (z0 + z1) / 2)), (tilt, 0, 0))
    box(r, deck, (0.33, 0.012, 0.64), P((0, 0.045, 0.32)), (tilt, 0, 0))
    box(r, anti, (0.345, 0.03, 0.62), P((0, -0.04, 0.31)), (tilt, 0, 0))
    big_text(m, r, '12', P((0.0, 0.0515, 0.36)), 0.12, color=WHITE_TXT, depth=0.03)
    for s in (-1, 1):
        stencil(m, r, 'DD-12', P((s * 0.172, 0.01, 0.45)), 0.04, facing='+x' if s > 0 else '-x', color=WHITE_TXT, depth=0.03)
    for i in range(5):
        zz = -0.05 - i * 0.11
        for s in (-1, 1):
            bar(r, rib, P((s * 0.165, 0.04, zz)), P((s * 0.14, -0.05, zz)), 0.012)
        bar(r, rib, P((-0.15, -0.05, zz)), P((0.15, -0.05, zz)), 0.012)
    bar(r, rib, P((0, -0.06, 0.0)), P((0, -0.06, -0.55)), 0.016)
    for i in range(6):
        box(r, painted(0x4c4136, panels=None, wear=0.3, rust=0.5), (0.05, 0.07, 0.1), P((0, -0.1, -0.5 + i * 0.2)), (tilt, 0, 0))
    for s in (-1, 1):
        for i in range(3):
            sx = -0.45 + i * 0.4
            for dz in (0.0, 0.12):
                bar(r, rail, P((s * 0.22, -0.1, sx + dz)), P((s * 0.22, 0.12, sx + dz)), 0.008)
            for yy in (-0.04, 0.05, 0.11):
                box(r, painted(0x8a7552, panels=None, wear=0.3, rust=0.0, rough=0.85, metal=0.0), (0.04, 0.006, 0.14), P((s * 0.22, yy, sx + 0.06)), (tilt, 0, 0))
    sphere(r, glow_material('glow:weld', 0x60e0ff), 0.016, P((0.14, 0.06, -0.32)), seg=8, rings=5)
    sphere(r, glow_material('glow:weld', 0x60e0ff), 0.014, P((-0.15, 0.11, 0.1)), seg=8, rings=5)
