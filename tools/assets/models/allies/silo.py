"""Allied ore silo (1x1): a white panelled silo with dark hoops, a team band, a star roundel, a conical roof
with a beacon and a ring catwalk, the glowing ore-level gauge (animated part 'gauge', 'glow:gauge'), a feed
pipe and drums.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'silo'
FACTION = 'allies'
KIND = 'structure'
ATLAS = 512  # small footprint: 512² already out-resolves the 3x3 structures' 1024²


def build(m):
    setup(m, ao_dist=0.3)
    m.set_meta(footprint=(1, 1), height=1.15, radius=0.5)
    r = m.root

    frm = frame()
    tr = trim()
    rail = rail_m()
    shell = white(panels=(0.2, 0.18))

    box(r, slab_m(0x8d887f), (0.96, Y0, 0.96), (0, Y0 / 2, 0), bevel=0.014)
    x, z, rad, h = 0.0, -0.04, 0.29, 0.86
    cyl(r, slab_m(0x7c7870), rad + 0.045, 0.08, (x, Y0 + 0.04, z), r2=rad + 0.035, seg=24, bevel=0.008)
    cyl(r, shell, rad, h, (x, Y0 + 0.08 + h / 2, z), seg=24)
    for f in (0.12, 0.5):
        cyl(r, frm, rad + 0.01, 0.024, (x, Y0 + 0.08 + h * f, z), seg=24, caps=False)
    cyl(r, tr, rad + 0.012, 0.085, (x, Y0 + 0.08 + h * 0.9, z), seg=24, caps=False)
    top = Y0 + 0.08 + h
    lathe(r, steel(0x8a95a0, panels=None), [(rad + 0.025, 0.0), (rad * 0.8, 0.07), (rad * 0.3, 0.15), (0.0, 0.17)], (x, top, z), seg=24, cap_bottom=False)
    cyl(r, frm, 0.05, 0.06, (x, top + 0.18, z), seg=10)
    light(r, (x, top + 0.215, z), 0.016, 0xff2a1a, 'blink')
    # ring catwalk + rail under the roof, ladder on the side
    cyl(r, tread(), rad + 0.08, 0.012, (x, top - 0.04, z), seg=24)
    for k in range(12):
        a = k / 12 * math.pi * 2
        bar(r, rail, (x + math.cos(a) * (rad + 0.075), top - 0.034, z + math.sin(a) * (rad + 0.075)),
            (x + math.cos(a) * (rad + 0.075), top + 0.03, z + math.sin(a) * (rad + 0.075)), 0.007)
    cyl(r, rail, rad + 0.078, 0.008, (x, top + 0.03, z), seg=24, caps=False)
    ladder(r, rail, (x + rad * 0.72, Y0 + 0.08, z + rad * 0.72), h - 0.06, facing=math.pi / 4, rung=0.07)
    strobe(r, (x - rad - 0.06, top - 0.02, z + 0.05), r=0.012)
    # front: roundel, gauge housing + the animated gauge bar, ORE stencil, hazard band
    roundel(m, r, (x, Y0 + 0.08 + h * 0.74, z + rad + 0.004), 0.22, depth=0.04)
    box(r, frm, (0.08, 0.44, 0.03), (0, Y0 + 0.4 - 0.01, 0.262), bevel=0.006)
    box(r, black(), (0.05, 0.41, 0.004), (0, Y0 + 0.39, 0.278))
    for k in range(5):
        box(r, flat(0xe8e4da, 0.5), (0.018, 0.004, 0.003), (0.034, Y0 + 0.2 + k * 0.1, 0.279))
    g = m.part('gauge', at=(0, 0.24, 0.272))
    box(g, glow_material('glow:gauge', 0xffa020), (0.036, 0.4, 0.006), (0, 0.2, 0.01))
    stencil(m, r, 'ORE', (0.17, Y0 + 0.56, 0.2), 0.06, facing=0.6, color=0xe8b51a, depth=0.04)
    hazard_band(m, r, (x, Y0 + 0.04, z + rad + 0.04), (0.3, 0.05), depth=0.03)
    # feed pipe, drums
    pipe_run(r, steel(0x8d99a6, panels=None), [(-0.27, Y0 + 0.14, 0.08), (-0.42, Y0 + 0.14, 0.08), (-0.42, Y0 + 0.02, 0.08)], 0.03)
    drums(r, (0.3, Y0, 0.3), 2)
