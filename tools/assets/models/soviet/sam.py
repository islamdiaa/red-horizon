"""Soviet SAM site (2x1): sloped concrete berms (their 60 degree faces toward the RTS camera stay clear of the
runtime snow: red band, hazard ends and a lit star), an exaggerated launcher (part 'turret' on a team-banded
drum, the elevating cradle 'elev' and two big white missiles with red noses 'ms0' / 'ms1', hidden by the game
while reloading; muzzles m0 / m1), the radar van with the spinning antenna (part 'radar'), a spare-missile
crate, the ПВО stencil and red lamps. Pivots: node --import tsx tools/assets/rig.ts sam soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'sam'
FACTION = 'soviet'
KIND = 'defense'


def missile(m, p, P, z):
    """Big SAM along +X from the part pivot (rides part ms0 / ms1)."""
    body = painted(0xe2dfd6, wear=0.3, rust=0.08, grime=0.3, streaks=0.25, panels=None, rough=0.45)
    cyl(p, body, 0.04, 0.46, (0.23, 0.0, z), (0, 0, -math.pi / 2), seg=10)
    lathe(p, P.red, [(0.04, 0.0), (0.032, 0.06), (0.0, 0.13)], (0.46, 0, z), seg=10, rot=(0, 0, -math.pi / 2))
    cyl(p, P.red, 0.041, 0.05, (0.06, 0, z), (0, 0, -math.pi / 2), seg=10, caps=False)
    cyl(p, P.dark, 0.03, 0.03, (-0.012, 0, z), (0, 0, -math.pi / 2), seg=8)
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        prism(p, P.dark, [(0.0, 0.03), (0.1, 0.03), (0.03, 0.095), (0.0, 0.095)], 0.007, (0.0, 0, z), rot=(a, 0, 0))
        prism(p, P.dark, [(0.32, 0.03), (0.37, 0.03), (0.35, 0.065), (0.32, 0.065)], 0.006, (0.0, 0, z), rot=(a, 0, 0))


def berm(r, P, x0, x1, z, side, h=0.15, top=0.07, slope=math.radians(60)):
    """Concrete berm along x from x0 to x1 at z; its outer face (toward +z when side > 0) slopes at `slope`."""
    run = h / math.tan(slope)
    # profile in the (z, y) plane, extruded along x
    if side > 0:
        pts = [(-top / 2 - 0.02, 0.0), (top / 2 + run, 0.0), (top / 2, h), (-top / 2, h)]
    else:
        pts = [(-top / 2 - run, 0.0), (top / 2 + 0.02, 0.0), (top / 2, h), (-top / 2, h)]
    # prism extrudes the XY outline along local z: map outline x -> world z via a yaw of -90 degrees
    prism(r, P.conc, [(-a, b) for (a, b) in pts], x1 - x0, ((x0 + x1) / 2, Y0, z), rot=(0, math.pi / 2, 0), bevel=0.01)
    return run


def build(m):
    m.set_meta(footprint=(2, 1), height=0.64, radius=1.0)
    look(m, ao_dist=0.28)
    P = Pal()
    r = m.root
    foundation(m, r, P, 2.0, 1.0)
    slope = math.radians(60)
    # ---- berms: back, two sides, two front wings (gap in the middle for the crew)
    berm(r, P, -0.92, 0.92, -0.38, -1)
    for s in (-1, 1):
        box(r, P.conc, (0.09, 0.15, 0.64), (s * 0.88, Y0 + 0.075, -0.02), bevel=0.02)
        run = berm(r, P, s * 0.33, s * 0.92, 0.36, 1) if s > 0 else berm(r, P, -0.92, -0.33, 0.36, 1)
        cx = s * 0.625
        # red band + hazard ends + a lit star on the camera-facing slope
        fzc = 0.36 + 0.035 + run / 2
        m.decal(solid(0xa31c15), at=(cx, Y0 + 0.075, fzc), size=(0.56, 0.1), facing='+z', part=r, depth=0.06, team=0, emit=0.3)
        m.decal(hazard_img(aspect=0.1 / 0.12), at=(s * 0.37, Y0 + 0.075, fzc), size=(0.1, 0.12), facing='+z', part=r, depth=0.06)
        lamp(r, (s * 0.88, Y0 + 0.15, -0.36), 0.024)
        lamp(r, (s * 0.35, Y0 + 0.15, 0.36), 0.022)
    top_star(m, r, (0.625, Y0 + 0.08, 0.36 + 0.035 + 0.045), 0.15, facing='+z', emit=0.4, depth=0.08)
    top_star(m, r, (0.0, Y0 + 0.001, 0.34), 0.26, emit=0.35, depth=0.02)
    roof_paint(m, r, (0.6, Y0 + 0.181, -0.12), (0.28, 0.34))
    stencil(m, r, 'ПВО', (-0.625, Y0 + 0.08, 0.36 + 0.035 + 0.045), 0.09, color=0xf2eee4, depth=0.08)
    red_banner(m, r, (-0.2, Y0 + 0.15, -0.38 + 0.035 + 0.01), (0.16, 0.13))

    # ---- radar van (right back) + the spinning antenna part
    box(r, P.wall, (0.3, 0.18, 0.36), (0.6, Y0 + 0.09, -0.12), bevel=0.016)
    box(r, P.trim, (0.305, 0.03, 0.365), (0.6, Y0 + 0.16, -0.12), bevel=0.005)
    window(r, (0.6, Y0 + 0.1, -0.12 + 0.18), (0.09, 0.05), strength=2.2)
    vent(m, r, (0.75, Y0 + 0.09, -0.12), (0.18, 0.08), facing='+x')
    rd = m.part('radar', at=(0.6, 0.22, -0.12))
    cyl(rd, P.dark, 0.014, 0.06, (0, 0.03, 0), seg=6)
    box(rd, P.gun, (0.04, 0.15, 0.26), (0.0, 0.11, 0), (0, 0, 0.3), bevel=0.006)
    m.decal(grille_img(aspect=0.26 / 0.14, n=4), at=(0.024, 0.11, 0), size=(0.25, 0.13), facing='+x', part=rd, depth=0.015)
    lamp(rd, (0.0, 0.2, 0.0), 0.016)
    antenna(r, (0.7, Y0 + 0.18, -0.25), 0.24, light_color=None)
    lamp(r, (0.7, Y0 + 0.42, -0.25), 0.018)

    # ---- spare missile crate (left), drums
    box(r, P.olive, (0.44, 0.09, 0.2), (-0.55, Y0 + 0.045, -0.15), bevel=0.012)
    top_star(m, r, (-0.55, Y0 + 0.091, -0.15), 0.1, ring=False, emit=0.35)
    stencil(m, r, '9М38', (-0.55, Y0 + 0.045, -0.049), 0.04, color=0xf2b916)
    drums(r, (-0.35, Y0, 0.12), 2, colors=(0x4f5636, 0x4f5636))

    # ---- the launcher: turret (yaw) -> elev (cradle) -> ms0 / ms1 (missiles)
    cyl(r, P.dark, 0.23, 0.04, (0, Y0 + 0.02, 0), seg=18, r2=0.22)
    t = m.part('turret', at=(0, 0.08, 0))
    cyl(t, P.gun, 0.18, 0.08, (0, 0.04, 0), r2=0.17, seg=16)
    cyl(t, P.trim, 0.182, 0.035, (0, 0.05, 0), seg=16, caps=False)
    roof_paint(m, t, (0, 0.081, 0), (0.34, 0.34))
    box(t, P.wall, (0.24, 0.13, 0.22), (-0.05, 0.14, 0), bevel=0.022)
    roof_paint(m, t, (-0.05, 0.206, 0), (0.2, 0.18))
    for z in (-0.13, 0.13):
        box(t, P.wall_lt, (0.07, 0.19, 0.045), (0.0, 0.2, z), bevel=0.01)
    lamp(t, (-0.14, 0.205, 0.0), 0.016)
    e = m.part('elev', parent='turret', at=(0, 0.26, 0), rot=(0, 0, 0.55))
    box(e, P.gun, (0.5, 0.022, 0.26), (0.13, -0.035, 0), bevel=0.006)
    box(e, P.dark, (0.08, 0.08, 0.29), (-0.02, 0, 0), bevel=0.012)
    for (i, z) in ((0, -0.075), (1, 0.075)):
        ms = m.part(f'ms{i}', parent='elev', at=(-0.06, 0.012, 0))
        missile(m, ms, P, z)
        m.muzzle(f'm{i}', (0.46, 0.012, z), part='elev')
