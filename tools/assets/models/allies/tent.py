"""Allied barracks (2x2): an olive quonset hut with arched ribs, a team crown stripe and a big star roundel, a
white entrance block (lit doorway, BARRACKS sign, floodlights), white end walls with lit windows, sandbag
emplacements, a radio shack with an antenna and the flag (animated part 'flag').
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'tent'
FACTION = 'allies'
KIND = 'structure'


def build(m):
    setup(m)
    m.set_meta(footprint=(2, 2), height=1.0, radius=1.05)
    r = m.root

    wall = white()
    frm = frame()
    tr = trim()
    rf = roof()
    olive = tune(painted(0x5d6646, panels=(0.3, 0.12), wear=0.65, grime=0.6, rust=0.3, streaks=0.8, rough=0.6, metal=0.25), ao=0.85)
    olive_d = tune(painted(0x3f4630, panels=None, wear=0.75, grime=0.5, rust=0.35, rough=0.55, metal=0.3), ao=0.85)
    bag = tune(cloth(0xa08f68, grime=0.6), ao=0.8)
    rail = rail_m()

    # ---- foundation
    box(r, slab_m(0x9d988e), (1.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)
    box(r, asphalt(), (0.5, 0.01, 0.42), (0, Y0 + 0.005, 0.66), bevel=0.003)
    mark(m, r, solid(WHITE_TXT), (0, Y0 + 0.01, 0.85), (0.48, 0.025), asphalt(), rough=0.7)

    # ---- quonset hut along z on a footing
    R, Hh, L, hz = 0.52, 0.56, 1.2, -0.18
    yb = Y0 + 0.06
    box(r, slab_m(0x85807a), (R * 2 + 0.06, 0.06, L + 0.06), (0, Y0 + 0.03, hz), bevel=0.01)
    arc = [(R * math.cos(math.pi * k / 14), Hh * math.sin(math.pi * k / 14)) for k in range(15)]
    prism(r, olive, arc, L, (0, yb, hz))
    # ribs (arched bands)
    for i in range(7):
        z = hz - L / 2 + 0.03 + i * ((L - 0.06) / 6)
        outer = [((R + 0.014) * math.cos(math.pi * k / 10), (Hh + 0.014) * math.sin(math.pi * k / 10)) for k in range(11)]
        inner = [((R - 0.01) * math.cos(math.pi * k / 10), (Hh - 0.01) * math.sin(math.pi * k / 10)) for k in range(11)]
        prism(r, olive_d, outer + inner[::-1], 0.026, (0, yb, z))
    # team crown stripe + the big roof roundel (camera side of the crown) + vents
    stripe = [(R * 1.02 * math.cos(math.pi / 2 + t), Hh * 1.02 * math.sin(math.pi / 2 + t)) for t in (-0.16, -0.08, 0.0, 0.08, 0.16)]
    inner_s = [(R * 0.99 * math.cos(math.pi / 2 + t), Hh * 0.99 * math.sin(math.pi / 2 + t)) for t in (0.16, 0.08, 0.0, -0.08, -0.16)]
    prism(r, tr, stripe + inner_s, L * 0.98, (0, yb, hz))
    roundel(m, r, (0, yb + Hh + 0.02, hz + 0.12), 0.44, facing='+y', depth=0.08)
    for z in (hz - 0.45, hz - 0.2):
        roof_vent(r, (0.3, yb + Hh * 0.8, z), 0.032)
    # side windows (lit) under small hoods
    for s in (-1, 1):
        for i in range(3):
            z = hz - 0.38 + i * 0.36
            xw = s * (R * 0.86)
            yw = Hh * math.sin(math.acos(0.86)) + yb - 0.08
            box(r, olive_d, (0.03, 0.09, 0.13), (xw, yw + 0.02, z), (0, 0, -s * 0.5), bevel=0.004)
            box(r, light_mat(WIN_WARM, 1.0, 'steady'), (0.006, 0.06, 0.1), (xw + s * 0.012, yw + 0.02, z), (0, 0, -s * 0.5))

    # ---- end walls: white, the front one with lit windows
    for s in (-1, 1):
        z = hz + s * (L / 2 + 0.012)
        prism(r, wall, arc, 0.024, (0, yb, z))
    fz = hz + L / 2 + 0.024
    for s in (-1, 1):
        eagle_banner(m, r, (s * 0.38, yb + 0.31, fz + 0.004), (0.14, 0.27))
    # entrance block
    ew, eh, ed = 0.56, 0.5, 0.12
    ez = fz + ed / 2
    box(r, wall, (ew, eh, ed), (0, Y0 + eh / 2, ez), bevel=0.012)
    box(r, tr, (ew + 0.04, 0.05, ed + 0.04), (0, Y0 + eh + 0.01, ez), bevel=0.008)
    box(r, rf, (ew, 0.02, ed), (0, Y0 + eh + 0.045, ez))
    for x in (-ew / 2 + 0.02, ew / 2 - 0.02):
        box(r, frm, (0.04, eh - 0.02, 0.03), (x, Y0 + (eh - 0.02) / 2, ez + ed / 2 + 0.008), bevel=0.006)
    efz = ez + ed / 2
    lit_doorway(m, r, (0, Y0, efz), (0.2, 0.28))
    lit_sign(m, r, (0, Y0 + 0.42, efz + 0.012), (0.42, 0.1), 'BARRACKS', lights=0, emblem_kind=None)
    for s in (-1, 1):
        floodlight(r, (s * 0.2, Y0 + eh + 0.06, efz - 0.01), yaw=0.0, pitch=0.8, s=0.045)
        light(r, (s * 0.27, Y0 + eh + 0.06, ez - 0.03), 0.014, 0xf0f4ff, 'strobe')
    box(r, slab_m(0x7c7870), (ew + 0.14, 0.02, 0.12), (0, Y0 + 0.01, efz + 0.06), bevel=0.004)

    # ---- sandbag emplacements, a barrier, the flag
    _sandbags(r, bag, (-0.64, Y0, 0.8), 0.5, 0.0)
    _sandbags(r, bag, (0.64, Y0, 0.8), 0.5, 0.0)
    _sandbags(r, bag, (-0.88, Y0, 0.46), 0.42, math.pi / 2)
    box(r, white(panels=None), (0.04, 0.06, 0.04), (0.42, Y0 + 0.03, 0.66), bevel=0.004)
    bar(r, painted(0xc8231a, panels=None, wear=0.4), (0.42, Y0 + 0.07, 0.66), (0.06, Y0 + 0.07, 0.66), 0.02)
    m.decal(stripes_img(6, WHITE_TXT, None), at=(0.24, Y0 + 0.07, 0.671), size=(0.36, 0.02), facing='+z', depth=0.01, team=0)
    fx, fzz = 0.78, -0.78
    cyl(r, slab_m(0x8a857c), 0.05, 0.04, (fx, Y0 + 0.02, fzz), seg=10, bevel=0.006)
    cyl(r, metal(0xb0b4b8, rough=0.35, rust=0.1), 0.012, 1.0, (fx, Y0 + 0.5, fzz), r2=0.009, seg=8)
    sphere(r, metal(0xd8b040, rough=0.3), 0.018, (fx, Y0 + 1.01, fzz), seg=8, rings=5)
    f = m.part('flag', at=(0.78, 0.04 + 1.0, -0.78))
    _flag(m, f)

    # ---- radio shack with an antenna, stores, a lamp
    box(r, wall, (0.26, 0.24, 0.3), (-0.72, Y0 + 0.12, -0.7), bevel=0.01)
    box(r, tr, (0.3, 0.03, 0.34), (-0.72, Y0 + 0.255, -0.7), bevel=0.006)
    glazing(m, r, (-0.72, Y0 + 0.15, -0.549), (0.1, 0.06), 2, lit={0}, color=WIN_WARM, emit=0.9)
    cyl(r, dark_m(), 0.008, 0.6, (-0.78, Y0 + 0.27 + 0.3, -0.76), r2=0.004, seg=6)
    light(r, (-0.78, Y0 + 0.88, -0.76), 0.01, 0xff2a1a, 'blink')
    crates(r, (0.78, Y0, 0.18), 3, 0.1)
    drums(r, (-0.8, Y0, 0.08), 3, colors=(0x4f5a3a, 0x5a6646, 0x4f5a3a))
    lamp_post(r, (-0.86, Y0, 0.12 + 0.0), 0.38, yaw=0.0)


def _flag(m, f):
    """Flag cloth in the 'flag' part frame: hangs from the pole top (pivot) towards +x, eagle on both sides."""
    cl = cloth(team=True)
    w, h = 0.3, 0.18
    nx = 5
    for i in range(nx):
        u0, u1 = i / nx, (i + 1) / nx
        z0 = 0.016 * math.sin(u0 * math.pi * 1.5)
        z1 = 0.016 * math.sin(u1 * math.pi * 1.5)
        ang = math.atan2(z1 - z0, w / nx)
        box(f, cl, (w / nx + 0.003, h, 0.005), (0.01 + (u0 + u1) / 2 * w, -h / 2, (z0 + z1) / 2), (0, -ang, 0))
    for fc in ('+z', '-z'):
        m.decal(frame_img(w / h, 0.08), at=(0.01 + w / 2, -h / 2, 0), size=(w * 0.94, h * 0.9), facing=fc, part=f, depth=0.03, team=0, rough=0.8)
        m.decal(allied_eagle(), at=(0.01 + w / 2, -h / 2, 0), size=(h * 0.86, h * 0.86), facing=fc, part=f, depth=0.03, team=0, rough=0.75)


def _sandbags(r, mat, at, length, yaw):
    """Two staggered courses of chunky sandbags along local x (after yaw), at = centre on the ground."""
    x, y, z = at
    c, s = math.cos(yaw), math.sin(yaw)
    bl, bh, bd = 0.11, 0.05, 0.07
    for row in range(2):
        n = int(length / bl) - row
        off = (bl / 2) * row
        for i in range(n):
            t = -length / 2 + bl / 2 + off + i * bl
            px, pz = x + c * t, z - s * t
            box(r, mat, (bl * 0.96, bh, bd), (px, y + bh / 2 + row * bh * 0.92, pz), (0, yaw + (0.06 if i % 2 else -0.05), 0), bevel=0.016)
