"""Allied ore silo (1x1): a white panelled silo with dark hoops, a team band, ORE 3 stencils, a roof cone in white / team segments
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
    # the roof cone in alternating white / team segments: the silo's read from the RTS camera
    prof = [(rad + 0.03, 0.0), (rad * 0.8, 0.08), (rad * 0.3, 0.17), (0.0, 0.19)]
    nseg = 8
    for k in range(nseg):
        mat = tr if k % 2 == 0 else white(panels=None, grime=0.45)
        _cone_sector(r, mat, prof, (x, top, z), k * 2 * math.pi / nseg, (k + 1) * 2 * math.pi / nseg)
    cyl(r, frm, 0.05, 0.06, (x, top + 0.2, z), seg=10)
    light(r, (x, top + 0.235, z), 0.018, 0xff2a1a, 'blink')
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
    stencil(m, r, 'ORE 3', (x, Y0 + 0.08 + h * 0.76, z + rad + 0.004), 0.085, color=0x2a2e34, wear=0.25, depth=0.04)
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


def _cone_sector(p, mat, prof, at, a0, a1, steps=3):
    """One angular sector of a surface of revolution (profile [(r, y)...] bottom to top), outward faces."""
    import bmesh
    import mathutils
    from kit import shapes as _S

    def build(bm):
        rings = []
        for (rr, y) in prof:
            rings.append([bm.verts.new((math.cos(a0 + (a1 - a0) * i / steps) * rr, y, -math.sin(a0 + (a1 - a0) * i / steps) * rr)) for i in range(steps + 1)])
        for k in range(len(rings) - 1):
            A, B = rings[k], rings[k + 1]
            for i in range(steps):
                f = bm.faces.new((A[i], A[i + 1], B[i + 1], B[i]))
                f.normal_update()
                c = f.calc_center_median()
                if f.normal.dot(mathutils.Vector((c.x, 0.05, c.z))) < 0:
                    f.normal_flip()
        vs = [v for ring in rings for v in ring]
        bmesh.ops.remove_doubles(bm, verts=vs, dist=1e-6)
        vs = [v for v in vs if v.is_valid]
        _S._round_uv(bm, vs)
        return vs
    return _S._emit(p, mat, build, T(at))
