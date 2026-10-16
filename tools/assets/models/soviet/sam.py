"""Soviet SAM site (2x1): concrete revetments with hazard ends, the launcher (part 'turret', the elevating
cradle 'elev' and the two missiles 'ms0' / 'ms1', hidden by the game while reloading; muzzles m0 / m1), a radar
van with the spinning antenna (part 'radar'), a spare-missile crate, a banner and the ПВО stencil, red lamps.
Pivots: node --import tsx tools/assets/rig.ts sam soviet.
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
    """SAM along +X from the part pivot (rides part ms0 / ms1)."""
    body = painted(0xdedbd2, wear=0.35, rust=0.1, grime=0.35, streaks=0.3, panels=None, rough=0.45)
    cyl(p, body, 0.03, 0.42, (0.21, 0.0, z), (0, 0, -math.pi / 2), seg=10)
    lathe(p, P.red, [(0.03, 0.0), (0.024, 0.05), (0.0, 0.11)], (0.42, 0, z), seg=10, rot=(0, 0, -math.pi / 2))
    cyl(p, P.trim, 0.031, 0.035, (0.3, 0, z), (0, 0, -math.pi / 2), seg=10, caps=False)
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        prism(p, P.dark, [(0.0, 0.0), (0.075, 0.0), (0.02, 0.055), (0.0, 0.055)], 0.006, (0.0, 0, z), rot=(a, 0, 0))
        prism(p, P.dark, [(0.3, 0.0), (0.34, 0.0), (0.32, 0.032), (0.3, 0.032)], 0.005, (0.0, 0, z), rot=(a, 0, 0))


def build(m):
    m.set_meta(footprint=(2, 1), height=0.6, radius=1.0)
    look(edge=0.28, ao_dist=0.26)
    P = Pal()
    r = m.root
    foundation(m, r, P, 2.0, 1.0)

    # ---- revetments
    rv = P.conc
    box(r, rv, (1.72, 0.14, 0.09), (0, Y0 + 0.07, -0.37), bevel=0.02)
    for s in (-1, 1):
        box(r, rv, (0.09, 0.14, 0.74), (s * 0.87, Y0 + 0.07, 0), bevel=0.02)
        box(r, rv, (0.5, 0.14, 0.09), (s * 0.6, Y0 + 0.07, 0.37), bevel=0.02)
        hazard_stripes(m, r, (s * 0.6, Y0 + 0.08, 0.416), (0.48, 0.05))
        lamp(r, (s * 0.87, Y0 + 0.14, -0.37), 0.02)
        lamp(r, (s * 0.36, Y0 + 0.14, 0.37), 0.018)
    red_banner(m, r, (-0.2, Y0 + 0.135, -0.32), (0.16, 0.12))
    stencil(m, r, 'ПВО', (0.25, Y0 + 0.07, -0.323), 0.07)

    # ---- radar van (right) + the spinning antenna part
    box(r, P.wall, (0.3, 0.18, 0.38), (0.6, Y0 + 0.09, -0.12), bevel=0.016)
    box(r, P.trim, (0.305, 0.03, 0.385), (0.6, Y0 + 0.16, -0.12), bevel=0.005)
    window(r, (0.6, Y0 + 0.1, -0.12 + 0.19), (0.08, 0.05), strength=1.8)
    vent(m, r, (0.75, Y0 + 0.09, -0.12), (0.18, 0.08), facing='+x')
    rd = m.part('radar', at=(0.6, 0.22, -0.12))
    cyl(rd, P.dark, 0.012, 0.06, (0, 0.03, 0), seg=6)
    box(rd, P.gun, (0.035, 0.13, 0.22), (0.0, 0.1, 0), (0, 0, 0.3), bevel=0.006)
    m.decal(grille_img(aspect=0.22 / 0.12, n=4), at=(0.02, 0.1, 0), size=(0.21, 0.11), facing='+x', part=rd, depth=0.015)
    antenna(r, (0.7, Y0 + 0.18, -0.25), 0.22, light_color=None)
    lamp(r, (0.7, Y0 + 0.4, -0.25), 0.016)

    # ---- spare missile crate (left), drums
    box(r, P.olive, (0.44, 0.09, 0.2), (-0.55, Y0 + 0.045, -0.15), bevel=0.012)
    m.decal(soviet_star(), at=(-0.55, Y0 + 0.091, -0.15), size=(0.08, 0.08), facing='+y', part=r, depth=0.02, team=0)
    stencil(m, r, '9M', (-0.55, Y0 + 0.045, -0.049), 0.04, color=0xf2b916)
    drums(r, (-0.35, Y0, 0.15), 2, colors=(0x4f5636, 0x4f5636))

    # ---- the launcher: turret (yaw) -> elev (cradle) -> ms0 / ms1 (missiles)
    cyl(r, P.dark, 0.21, 0.04, (0, Y0 + 0.02, 0), seg=18, r2=0.2)
    t = m.part('turret', at=(0, 0.08, 0))
    cyl(t, P.gun, 0.16, 0.08, (0, 0.04, 0), r2=0.15, seg=16)
    box(t, P.wall, (0.22, 0.12, 0.2), (-0.04, 0.13, 0), bevel=0.02)
    box(t, P.trim, (0.225, 0.03, 0.205), (-0.04, 0.16, 0), bevel=0.005)
    for z in (-0.12, 0.12):
        box(t, P.wall_lt, (0.06, 0.18, 0.04), (0.0, 0.2, z), bevel=0.01)
    lamp(t, (-0.12, 0.19, 0.0), 0.014)
    e = m.part('elev', parent='turret', at=(0, 0.26, 0), rot=(0, 0, 0.55))
    box(e, P.gun, (0.46, 0.02, 0.24), (0.12, -0.03, 0), bevel=0.006)
    box(e, P.dark, (0.07, 0.07, 0.27), (-0.02, 0, 0), bevel=0.012)
    for (i, z) in ((0, -0.075), (1, 0.075)):
        ms = m.part(f'ms{i}', parent='elev', at=(-0.06, 0.012, 0))
        missile(m, ms, P, z)
        m.muzzle(f'm{i}', (0.46, 0.012, z), part='elev')
