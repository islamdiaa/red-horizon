"""Allied shipyard (3x3, on water): a U of concrete piers on pilings around the slipway with a hull under
construction (welding glow 'glow:weld'), the fabrication hall at the head of the slip (team vault roofs, a big
lit door, star), offices and a glazed control tower on the left pier, the yellow gantry crane over the slip
(parts gantry > gantryT), a tower crane on the right pier (part 'jib'), containers, fuel tanks, bollards,
fenders, harbour lights ('glow:harbour'), floodlight masts and the stack (smoke0).
"""
import math
import os
import sys

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
    yel = yellow()
    rail = rail_m()
    pier = tune(concrete(0xa29d92, joints=(0.5, 0.5), grime=0.7, streaks=0.5), ao=0.85)
    piling = tune(painted(0x4c4136, panels=None, wear=0.2, rust=0.6, grime=0.8, rough=0.9, metal=0.0), ao=0.9)
    weed = flat(0x2c3a26, 0.95)

    # ---- piers on pilings
    for (x, z, w, d) in ((-1.12, -0.05, 0.66, 2.8), (1.12, -0.05, 0.66, 2.8), (0.0, -1.2, 1.58, 0.5)):
        _platform(r, pier, piling, weed, x, z, w, d)
    for s in (-1, 1):
        box(r, slab_m(0x85807a), (0.14, 0.08, 1.4), (0.6 * s, TOP - 0.04, -0.3), bevel=0.01)
        box(r, dark_m(), (0.025, 0.012, 1.4), (0.6 * s, TOP + 0.004, -0.3))
        hazard_band(m, r, (1.12 * s, TOP, 1.15), (0.6, 0.04), facing='+y', base=pier)
        # bollards + fenders along the slip edges
        for i in range(5):
            zz = -0.85 + i * 0.5
            cyl(r, dark_m(), 0.014, 0.03, (0.82 * s, TOP + 0.015, zz), r2=0.012, seg=8)
            box(r, rubber(), (0.03, 0.07, 0.06), (0.8 * s, TOP - 0.05, zz + 0.12), bevel=0.008)
        # harbour lights at the pier heads (green starboard, red port)
        lx = 1.3 * s
        cyl(r, white(panels=None), 0.032, 0.3, (lx, TOP + 0.15, 1.2), r2=0.028, seg=10)
        cyl(r, painted(0xc8231a, panels=None, wear=0.4), 0.034, 0.05, (lx, TOP + 0.22, 1.2), seg=10, caps=False)
        cyl(r, dark_m(), 0.04, 0.012, (lx, TOP + 0.3, 1.2), seg=10)
        sphere(r, glow_material('glow:harbour', 0x40ff70 if s > 0 else 0xff3020), 0.024, (lx, TOP + 0.33, 1.2), seg=10, rings=6)
    # ---- slipway ramp + the hull under construction
    import mathutils
    F = T((0, 0.02, -0.3), (-0.065, 0, 0))

    def P(v):
        return tuple(F @ mathutils.Vector(v))
    box(r, slab_m(0x6e6a63), (0.92, 0.05, 1.6), P((0, 0, 0)), (-0.065, 0, 0), bevel=0.01)
    for i in range(8):
        box(r, metal(0x8a9096, rough=0.4), (0.88, 0.01, 0.022), P((0, 0.03, -0.72 + i * 0.205)), (-0.065, 0, 0))
    for s in (-1, 1):
        box(r, dark_m(), (0.03, 0.02, 1.6), P((0.34 * s, 0.035, 0)), (-0.065, 0, 0))
    box(r, yel, (0.05, 0.012, 1.6), P((0, 0.032, 0)), (-0.065, 0, 0))
    _hull(m, r, rail)

    # ---- fabrication hall at the head of the slip
    hz = -1.2
    box(r, wall, (1.5, 0.42, 0.46), (0, TOP + 0.21, hz), bevel=0.02)
    box(r, tr, (1.53, 0.04, 0.49), (0, TOP + 0.41, hz), bevel=0.008)
    for i in range(3):
        x = -0.5 + i * 0.5
        arc = [(0.25 * math.cos(math.pi * k / 10), 0.105 * math.sin(math.pi * k / 10)) for k in range(11)]
        prism(r, steel(0xa9b2bb, panels=(0.1, 0.3), grime=0.6, streaks=0.6), arc, 0.5, (x, TOP + 0.42, hz))
        box(r, tr, (0.05, 0.01, 0.5), (x, TOP + 0.528, hz))
    hfz = hz + 0.23
    box(r, black(), (0.72, 0.33, 0.01), (0, TOP + 0.165, hfz + 0.003))
    box(r, light_mat(WIN_WARM, 1.0, 'steady'), (0.6, 0.16, 0.004), (0, TOP + 0.1, hfz + 0.007))
    sh = corrugated(0x8792a0, along='x', pitch=0.024, rust=0.3, streaks=0.85)
    box(r, sh, (0.7, 0.14, 0.014), (0, TOP + 0.26, hfz + 0.012), bevel=0.003)
    box(r, frm, (0.8, 0.05, 0.05), (0, TOP + 0.355, hfz + 0.025), bevel=0.008)
    hazard_band(m, r, (0, TOP + 0.355, hfz + 0.051), (0.76, 0.04))
    for s in (-1, 1):
        box(r, frm, (0.04, 0.34, 0.04), (s * 0.38, TOP + 0.17, hfz + 0.02), bevel=0.006)
        glazing(m, r, (s * 0.58, TOP + 0.28, hfz + 0.004), (0.2, 0.07), 2, lit={0, 1} if s < 0 else {1}, color=WIN_WARM, emit=0.9)
    roundel(m, r, (-0.58, TOP + 0.13, hfz + 0.002), 0.12, plate=wall)
    lit_sign(m, r, (0.58, TOP + 0.13, hfz + 0.03), (0.28, 0.08), 'DRYDOCK', lights=0, emblem_kind=None)
    # stack
    cyl(r, white(panels=None), 0.055, 0.2, (0.55, TOP + 0.52, -1.3), r2=0.045, seg=12)
    cyl(r, tr, 0.058, 0.03, (0.55, TOP + 0.58, -1.3), seg=12, caps=False)
    cyl(r, dark_m(), 0.047, 0.012, (0.55, TOP + 0.625, -1.3), seg=12)
    m.smoke('smoke0', (0.55, 0.74, -1.3))

    # ---- offices + control tower on the left pier
    ox, oz = -1.12, -0.55
    box(r, wall2, (0.48, 0.3, 0.62), (ox, TOP + 0.15, oz), bevel=0.016)
    box(r, tr, (0.52, 0.035, 0.66), (ox, TOP + 0.3, oz), bevel=0.008)
    box(r, rf, (0.46, 0.02, 0.6), (ox, TOP + 0.32, oz))
    glazing(m, r, (ox, TOP + 0.2, oz + 0.314), (0.36, 0.08), 3, lit={0, 2}, color=WIN_WARM, emit=0.9)
    glazing(m, r, (ox + 0.244, TOP + 0.2, oz), (0.5, 0.08), 4, facing='+x', lit={0, 2, 3}, color=WIN_WARM, emit=0.9)
    lit_doorway(m, r, (ox - 0.12, TOP, oz + 0.31), (0.12, 0.17))
    tx, tz = -1.2, -0.7
    box(r, wall, (0.22, 0.32, 0.22), (tx, TOP + 0.46, tz), bevel=0.012)
    box(r, glass(0x2b4762), (0.24, 0.08, 0.24), (tx, TOP + 0.66, tz))
    for fc, at_ in (('+z', (tx, TOP + 0.66, tz + 0.122)), ('+x', (tx + 0.122, TOP + 0.66, tz))):
        m.decal(lit_panes_img(3, 1, lit={0, 2}, color=WIN_COOL), at=at_, size=(0.22, 0.07), facing=fc, depth=0.01, team=0, emit=0.9)
    box(r, tr, (0.27, 0.03, 0.27), (tx, TOP + 0.715, tz), bevel=0.006)
    cyl(r, dark_m(), 0.007, 0.32, (tx - 0.05, TOP + 0.89, tz - 0.05), r2=0.003, seg=6)
    light(r, (tx - 0.05, TOP + 1.05, tz - 0.05), 0.012, 0xff2a1a, 'blink')
    roundel(m, r, (ox + 0.08, TOP + 0.332, oz + 0.12), 0.22, facing='+y', plate=steel(0x7d8792, panels=None))

    # ---- gantry crane over the slip (moves along z), trolley (moves along x)
    g = m.part('gantry', at=(0, TOP, -0.25))
    span, gh = 1.2, 0.62
    for s in (-1, 1):
        lx = span / 2 * s
        for dz in (-0.07, 0.07):
            box(g, yel, (0.032, gh, 0.032), (lx, gh / 2, dz), bevel=0.005)
        box(g, yel, (0.04, 0.035, 0.22), (lx, 0.017, 0), bevel=0.006)
        for dz in (-0.08, 0.08):
            box(g, dark_m(), (0.05, 0.028, 0.05), (lx, 0.014, dz), bevel=0.004)
        for i in range(1, 4):
            bar(g, yel, (lx, gh * (i - 1) / 4 + 0.02, -0.07), (lx, gh * i / 4, 0.07), 0.012)
    for dz in (-0.05, 0.05):
        box(g, yel, (span + 0.1, 0.065, 0.035), (0, gh + 0.032, dz), bevel=0.007)
    box(g, dark_m(), (span + 0.1, 0.006, 0.07), (0, gh + 0.066, 0))
    m.decal(haz_img(span * 0.6 / 0.025), at=(0, gh + 0.02, 0.0685), size=(span * 0.6, 0.03), facing='+z', part=g, depth=0.01, team=0)
    box(g, yel, (0.08, 0.06, 0.07), (span / 2 - 0.08, gh - 0.05, 0.09), bevel=0.01)
    box(g, glass(0x2b4762), (0.07, 0.03, 0.004), (span / 2 - 0.08, gh - 0.045, 0.126))
    light(g, (-span / 2, gh + 0.075, 0), 0.012, 0xffa020, 'blink')
    floodlight(g, (0.2, gh - 0.01, 0.06), yaw=0.0, pitch=1.2, s=0.04)
    gt = m.part('gantryT', parent='gantry', at=(0, gh + 0.005, 0))
    box(gt, dark_m(), (0.1, 0.035, 0.14), (0, 0, 0), bevel=0.006)
    for dz in (-0.02, 0.02):
        bar(gt, dark_m(), (0, -0.01, dz), (0, -0.29, dz), 0.004)
    box(gt, dark_m(), (0.04, 0.025, 0.06), (0, -0.3, 0), bevel=0.004)
    box(gt, tr, (0.16, 0.04, 0.12), (0, -0.335, 0), bevel=0.008)

    # ---- tower crane on the right pier + the slewing jib
    cx, cz = 1.12, 0.1
    box(r, slab_m(0x7c7870), (0.2, 0.05, 0.2), (cx, TOP + 0.025, cz), bevel=0.01)
    for (dx, dz) in ((-0.05, -0.05), (0.05, -0.05), (-0.05, 0.05), (0.05, 0.05)):
        box(r, yel, (0.022, 0.63, 0.022), (cx + dx, TOP + 0.36, cz + dz), bevel=0.003)
    for i in range(5):
        y0_, y1_ = TOP + 0.06 + i * 0.12, TOP + 0.18 + i * 0.12
        for s in (-1, 1):
            bar(r, yel, (cx - 0.05, y0_, cz + 0.05 * s), (cx + 0.05, y1_, cz + 0.05 * s), 0.008)
            bar(r, yel, (cx + 0.05 * s, y0_, cz - 0.05), (cx + 0.05 * s, y1_, cz + 0.05), 0.008)
    j = m.part('jib', at=(cx, TOP + 0.68, cz), rot=(0, 2.2, 0))
    box(j, yel, (0.13, 0.08, 0.13), (0, 0, 0), bevel=0.012)
    box(j, glass(0x2b4762), (0.05, 0.04, 0.004), (0.05, 0.0, 0.067))
    for dz in (-0.022, 0.022):
        bar(j, yel, (0.06, 0.04, dz), (0.86, 0.04, dz), 0.016)
    bar(j, yel, (0.06, 0.085, 0), (0.8, 0.07, 0), 0.014)
    for i in range(7):
        x0 = 0.08 + i * 0.11
        bar(j, yel, (x0, 0.04, -0.022), (x0 + 0.055, 0.08, 0), 0.006)
        bar(j, yel, (x0, 0.04, 0.022), (x0 + 0.055, 0.08, 0), 0.006)
    box(j, slab_m(0x8a857c), (0.12, 0.09, 0.09), (-0.15, 0.02, 0), bevel=0.01)
    bar(j, dark_m(), (0.76, 0.03, 0), (0.76, -0.33, 0), 0.004)
    box(j, painted(0x4f5a3a, panels=None, wear=0.6, rust=0.3), (0.12, 0.07, 0.07), (0.76, -0.38, 0), bevel=0.01)
    light(j, (0.85, 0.09, 0), 0.012, 0xff2a1a, 'blink')

    # ---- containers, fuel tanks, plate stacks
    for (y, z, c) in ((0.05, 0.75, None), (0.15, 0.75, 0x4f5a3a), (0.05, 0.62, 0xb8241a)):
        mat = tr if c is None else painted(c, panels=(0.06, 0.2), wear=0.6, rust=0.4)
        box(r, mat, (0.24, 0.1, 0.1), (1.12, TOP + y, z), bevel=0.008)
    for z in (-0.55, -0.8):
        cyl(r, white(panels=None), 0.09, 0.22, (1.15, TOP + 0.11, z), seg=14, bevel=0.008)
        cyl(r, tr, 0.093, 0.03, (1.15, TOP + 0.16, z), seg=14, caps=False)
    for i in range(3):
        box(r, metal(0x7a8086, rough=0.5, rust=0.4), (0.3, 0.02, 0.2), (-1.1, TOP + 0.01 + i * 0.021, 0.45 + i * 0.01), bevel=0.003)
    crates(r, (-1.05, TOP, 0.85), 2, 0.09)
    # floodlight masts behind the slip
    for x in (-0.8, 0.8):
        cyl(r, gun_m(), 0.013, 0.62, (x, TOP + 0.31, -0.85), r2=0.01, seg=8)
        floodlight(r, (x, TOP + 0.62, -0.83), yaw=0.0, pitch=0.7, s=0.05)
    for x in (-1.12 + 0.3, 1.12 - 0.3):
        strobe(r, (x, TOP + 0.02, 1.32), r=0.012)


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
    """Destroyer hull on the slip: plated grey bow half with a red antifouling band, exposed rust ribs aft,
    keel blocks, scaffolding and two welding glows."""
    hullm = steel(0x9ca3aa, panels=(0.12, 0.06), wear=0.5, rust=0.3)
    anti = painted(0x7e2c24, panels=None, wear=0.4, rust=0.4)
    rib = rusty(0x6a4a34, 0.7)
    deck = tread(0x64686a)
    y = 0.2
    zb = -0.35
    tilt = -0.06
    import mathutils
    F = T((0, y, zb), (tilt, 0, 0))

    def P(v):
        return tuple(F @ mathutils.Vector(v))
    # plated forward hull: a tapered prism (bow toward +z), beam 0.34
    prof = [(-0.17, -0.06), (0.17, -0.06), (0.15, -0.12), (0.06, -0.16), (-0.06, -0.16), (-0.15, -0.12)]
    for (z0, z1, k) in ((0.0, 0.3, 1.0), (0.3, 0.52, 0.75), (0.52, 0.64, 0.4)):
        pr = [(px_ * k, py_) for (px_, py_) in prof]
        prism(r, hullm, pr, z1 - z0, P((0, 0.1, (z0 + z1) / 2)), (tilt, 0, 0))
    box(r, deck, (0.33, 0.012, 0.64), P((0, 0.045, 0.32)), (tilt, 0, 0))
    box(r, anti, (0.345, 0.03, 0.62), P((0, -0.04, 0.31)), (tilt, 0, 0))
    # exposed ribs aft
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
    roundel(m, r, P((0.0, 0.052, 0.38)), 0.14, facing='+y', depth=0.04)
