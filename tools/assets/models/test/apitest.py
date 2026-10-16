"""kit regression for the polish-round APIs: m.look, decal normal= / rot=, facing=normal_rot(...), torus,
lathe_in, lathe(double=True), sector, loft, glazing (mullions with emit=0), team_paint, m.part(ground=False)."""
import math

from mathutils import Vector

from kit import *
from kit.core import euler3

ID = 'apitest'
KIND = 'structure'
ATLAS = 512


def _check():
    for f in ('+z', '-z', '+x', '-x', '+y', '-y'):
        n = euler3(facing_rot(f)) @ Vector((0, 0, 1))
        A, B = euler3(normal_rot(tuple(n))), euler3(facing_rot(f))
        assert max(abs(A[i][j] - B[i][j]) for i in range(3) for j in range(3)) < 1e-6, (f, normal_rot(tuple(n)))
    n = Vector((0.3, 0.8, 0.5)).normalized()
    assert (euler3(normal_rot(n)) @ Vector((0, 0, 1)) - n).length < 1e-6
    assert facing_rot((0.1, 0.2, 0.3)) == (0.1, 0.2, 0.3)
    print('[apitest] normal_rot / facing_rot checks passed', flush=True)


def build(m):
    _check()
    m.look(edge_light=0.09, ao_distance=0.4, ao=0.7)
    m.set_meta(footprint=(2, 2), height=0.8, radius=1.0)
    r = m.root
    conc = concrete()
    steel = metal(0x6a6e74)
    # ground slab with a square silo opening at (-0.5, 0.4)
    slab(r, conc, -1, 1, 0, 0.05, -1, 0.25)
    slab(r, conc, -1, 1, 0, 0.05, 0.55, 1)
    slab(r, conc, -1, -0.65, 0, 0.05, 0.25, 0.55)
    slab(r, conc, -0.35, 1, 0, 0.05, 0.25, 0.55)
    lathe_in(r, steel, [(0.15, -0.5), (0.15, 0.05)], at=(-0.5, 0, 0.4), seg=16, cap_bottom=True)
    # the missile rests below ground: its AO is baked without the ground plane
    mis = m.part('missile', at=(-0.5, -0.45, 0.4), ground=False, cull=False)
    cyl(mis, painted(0xd8d8d2, panels=None), 0.06, 0.36, (0, 0.18, 0), seg=12)
    dome(mis, painted(0xd8d8d2, panels=None), 0.06, (0, 0.36, 0), seg=12, rings=4)
    sector(mis, painted(0xb02018, panels=None), 0.0615, 0.0615, 0.04, 0.32, 0.0, math.pi / 2, seg=4,
           rot=(0, 0, math.pi / 2))
    # hip-roofed block (loft) with decals on the sloped roof faces
    loft(r, painted(0x6a7078, panels=(0.2, 0.15)), [
        (0.05, [(-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3)]),
        (0.45, [(-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3)]),
        (0.65, [(-0.18, -0.18), (0.18, -0.18), (0.18, 0.18), (-0.18, 0.18)]),
    ], at=(0.4, 0, -0.4), bevel=0.008)
    m.decal(soviet_star(), at=(0.4, 0.55, -0.16), size=0.13, normal=(0, 0.12, 0.2), depth=0.03)
    m.decal(text(['API']), at=(0.64, 0.55, -0.4), size=0.16, rot=normal_rot((0.2, 0.12, 0)), depth=0.03)
    stencil(m, r, 'ЛУЧ', (0.16, 0.55, -0.4), 0.05, facing=normal_rot((-0.2, 0.12, 0)))
    glazing(m, r, (0.4, 0.26, -0.097), (0.5, 0.14), 6, 2, dark_panes={1, 4, 8})
    m.decal(team_paint(0.6), at=(0.7, 0.36, -0.4), size=(0.5, 0.06), facing='+x', depth=0.02, team=1)
    m.decal(team_paint(1.25), at=(0.7, 0.26, -0.4), size=(0.5, 0.06), facing='+x', depth=0.02, team=1)
    # tori: one lying on the slab, one standing on a post facing +z
    torus(r, steel, 0.18, 0.03, at=(0.4, 0.08, 0.5), seg=20, tseg=8)
    cyl(r, steel, 0.02, 0.11, (0.4, 0.105, 0.5), seg=8)
    torus(r, team(panels=None), 0.12, 0.025, at=(0.4, 0.3, 0.5), rot=(math.pi / 2, 0, 0), seg=20, tseg=8)
    # an open double-sided tank shell (inside visible over the rim)
    lathe(r, painted(0x707a6a, panels=None), [(0.16, 0.05), (0.19, 0.32)], at=(-0.45, 0, -0.45), cap_top=False,
          double=True)
    # a solid pie wedge (sector caps=True)
    sector(r, painted(0x9a8a50, panels=None), 0.12, 0.12, -0.75, -0.55, 0.0, math.pi * 0.75, seg=5,
           at=(0, 0.14, 0.82), caps=True)
