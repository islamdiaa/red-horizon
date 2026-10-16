"""Allied Ranger (jeep): team-painted open 4x4 with dark camouflage, scrolling tyres on four wheels, raked
windscreen, roll bar, driver, rear pintle MG with its gunner (part 'turret', gun 'b0', muzzle 'm0'), spare
wheel, jerry cans, shovel, headlights. Pivots: node --import tsx tools/assets/rig.ts jeep.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = 'jeep'
FACTION = 'allies'
KIND = 'vehicle'


def crew(p, P, at, helmet):
    x, y, z = at
    box(p, P.canvas, (0.042, 0.052, 0.062), (x, y + 0.026, z), bevel=0.008)
    sphere(p, painted(0xd0a080, panels=None, wear=0.0, rust=0.0, rough=0.7, metal=0.0), 0.016, (x + 0.006, y + 0.066, z), seg=8, rings=4)
    dome(p, helmet, 0.022, (x + 0.004, y + 0.068, z), seg=8, rings=3, h=0.018)


def build(m):
    m.set_meta(height=0.3, radius=0.32, snow=0.3)
    r = m.root
    P = Pal('allies')
    wr, ww = 0.066, 0.054
    for x in (0.175, -0.17):
        for s in (-1, 1):
            wheel(r, P, wr, ww, (x, wr, 0.145 * s), s)
    box(r, P.dark, (0.52, 0.04, 0.2), (0, 0.075, 0), bevel=0.008)
    tub = [(-0.292, 0.086), (0.27, 0.086), (0.306, 0.122), (0.3, 0.158), (0.08, 0.172), (0.04, 0.167), (-0.292, 0.167)]
    side_prism(r, P.hull, tub, 0.262, bevel=0.014)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        camo(m, r, (0.0, 0.125, 0.1315 * s), (0.5, 0.07), f, seed=51 + s, n=3)
        number(m, r, '7', (-0.2, 0.128, 0.1315 * s), 0.035, f)
    camo(m, r, (0.19, 0.165, 0), (0.17, 0.22), '+y', seed=53, n=2)
    for s in (-1, 1):
        edge_strip(m, r, (-0.285, 0.167, 0.124 * s), (0.05, 0.168, 0.124 * s), '+y', 0.012)
        edge_strip(m, r, (0.085, 0.171, 0.124 * s), (0.295, 0.159, 0.124 * s), '+y', 0.012)
    emblem(m, r, 'allied_star', (0.19, 0.166, 0.0), 0.075, facing='+y')
    # wheel arches
    for x in (0.175, -0.17):
        for s in (-1, 1):
            box(r, P.dark2, (0.16, 0.014, 0.072), (x, 0.152, 0.15 * s), bevel=0.005)
    # interior: floor, seats, driver, steering wheel
    box(r, P.black, (0.25, 0.008, 0.226), (-0.12, 0.168, 0))
    for z in (-0.06, 0.06):
        box(r, P.canvas, (0.06, 0.028, 0.07), (-0.0, 0.18, z), bevel=0.006)
        box(r, P.canvas, (0.016, 0.06, 0.07), (-0.035, 0.205, z), bevel=0.004)
    crew(r, P, (0.0, 0.186, -0.06), P.dark2)
    cyl(r, P.black, 0.022, 0.006, (0.045, 0.235, -0.06), (0, 0, 1.0), seg=8)
    # windscreen frame + glass, roll bar
    box(r, P.dark, (0.014, 0.085, 0.256), (0.072, 0.21, 0), (0, 0, 0.35), bevel=0.003)
    box(r, glass(0x2a3a4a), (0.006, 0.066, 0.232), (0.076, 0.21, 0), (0, 0, 0.35))
    for z in (-0.12, 0.12):
        cyl_between(r, P.dark, (-0.06, 0.167, z), (-0.06, 0.29, z * 0.85), 0.008, 6)
    cyl_between(r, P.dark, (-0.06, 0.29, -0.104), (-0.06, 0.29, 0.104), 0.008, 6)
    # grille, bumper with winch, lights
    grille(m, r, (0.307, 0.134, 0.0), (0.12, 0.04), facing='+x', n=3)
    box(r, P.gun, (0.022, 0.022, 0.28), (0.312, 0.098, 0), bevel=0.004)
    cyl(r, P.dark, 0.015, 0.07, (0.322, 0.1, 0), ROT_Z, seg=8)
    for s in (-1, 1):
        headlight(r, (0.302, 0.142, 0.092 * s), 0.016)
        marker(r, (-0.296, 0.14, 0.11 * s), 0.011)
    # spare wheel on the back, jerry cans, shovel, whip
    cyl(r, P.rubber, 0.052, 0.032, (-0.31, 0.16, 0), ROT_X, seg=12)
    cyl(r, P.dark2, 0.03, 0.036, (-0.31, 0.16, 0), ROT_X, seg=8)
    jerry_rack(r, P, 2, -0.25, 0.167, -0.098, yaw=0.0)
    box(r, P.wood, (0.16, 0.009, 0.009), (0.0, 0.14, 0.133))
    box(r, P.gun, (0.04, 0.005, 0.024), (0.09, 0.14, 0.133))
    whip(r, P, (-0.27, 0.167, 0.11), 0.22, pennant=True)

    # ---- pintle MG with its gunner
    t = m.part('turret', at=(-0.15, 0.18, 0))
    cyl(t, P.dark, 0.013, 0.08, (0, 0.04, 0), r2=0.011, seg=6)
    box(t, P.gun, (0.1, 0.028, 0.03), (0.02, 0.09, 0), bevel=0.006)
    box(t, P.dark2, (0.012, 0.062, 0.092), (0.07, 0.096, 0), bevel=0.003)
    box(t, P.jerry, (0.03, 0.022, 0.02), (-0.005, 0.075, -0.026))
    crew(t, P, (-0.06, 0.0, 0.0), P.dark2)
    b = m.part('b0', parent='turret', at=(0.07, 0.09, 0))
    cyl(b, P.black, 0.0065, 0.13, (0.065, 0, 0), ROT_X, seg=6)
    cyl(b, P.black, 0.0095, 0.05, (0.03, 0, 0), ROT_X, seg=8)
    m.muzzle('m0', (0.205, 0.09, 0))
