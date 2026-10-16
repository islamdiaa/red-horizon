"""Allied artillery (arty, M109 / M7 style): team-painted tracked carrier with dark camouflage, open-topped
gun house (part 'house') with its crew and ready rounds, elevated howitzer (part 'gun', tilted 0.2) with the
barrel 'b0' (long recoil along -X), muzzle brake, muzzle 'm0', recuperators, rear spades.
Pivots: node --import tsx tools/assets/rig.ts arty.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = 'arty'
FACTION = 'allies'
KIND = 'vehicle'


def crew(p, P, at, helmet):
    x, y, z = at
    box(p, P.canvas, (0.042, 0.052, 0.062), (x, y + 0.026, z), bevel=0.008)
    sphere(p, painted(0xd0a080, panels=None, wear=0.0, rust=0.0, rough=0.7, metal=0.0), 0.016, (x + 0.006, y + 0.066, z), seg=8, rings=4)
    dome(p, helmet, 0.022, (x + 0.004, y + 0.068, z), seg=8, rings=3, h=0.018)


def build(m):
    m.set_meta(height=0.4, radius=0.42, snow=0.3)
    r = m.root
    P = Pal('allies')
    brass = metal(0xc8a050, rough=0.3, rust=0.0, wear=0.1)

    L, H, W, Z = 0.64, 0.125, 0.11, 0.18
    running_gear(m, r, P, L, H, W, Z, 5, x0=-0.04, wheel_k=0.4, rollers=0)
    box(r, P.dark, (0.58, 0.06, 0.27), (-0.04, 0.08, 0), bevel=0.008)
    for s in (-1, 1):
        fender(r, P.hull_flat, 0.66, 0.125, 0.128, Z * s, x=-0.04, front=0.05, rear=0.04)
    hull = [(-0.372, 0.092), (0.222, 0.092), (0.302, 0.132), (0.242, 0.178), (-0.362, 0.178)]
    side_prism(r, P.hull, hull, 0.34, bevel=0.015)
    slope_plate(r, P.dark2, (0.302, 0.132), (0.242, 0.178), 0.26, t=0.008, inset=0.8)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        camo(m, r, (-0.06, 0.135, 0.171 * s), (0.5, 0.08), f, seed=71 + s, n=3, colors=(0x6a6a6a,))
        rivet_row(m, r, (-0.33, 0.165, 0.171 * s), (0.2, 0.165, 0.171 * s), facing=f, spacing=0.035, size=0.01)
        headlight(r, (0.284, 0.152, 0.1 * s), 0.015, guard=P.black)
        marker(r, (-0.376, 0.155, 0.13 * s), 0.011)
    tow_hooks(r, P, 0.31, 0.11, 0.08, 1)
    hull_shade(m, r, -0.372, 0.242, 0.178, 0.17, side_y=(0.1, 0.18), fenders=(0.66, 0.134, Z, 0.125, -0.04))
    top_star(m, r, 'allies', (0.19, 0.179, -0.05), 0.075)
    deck_strips(m, r, -0.362, 0.242, 0.178, 0.17, width=0.016)
    fender_strips(m, r, 0.66, 0.2425, 0.134, x=-0.04, width=0.014)
    for s in (-1, 1):
        lamp(r, (-0.35, 0.179, 0.15 * s), 0.011, RED, 'steady', 3.2, '+y')
    hatch_round(r, P.dark2, 0.025, (0.12, 0.178, 0.07))
    # rear spades (folded up)
    for s in (-1, 1):
        box(r, P.dark, (0.03, 0.085, 0.065), (-0.392, 0.12, 0.1 * s), (0, 0, 0.5), bevel=0.006)
    hazard_stripes(m, r, (-0.373, 0.12, 0.0), (0.12, 0.03), facing='-x')

    # ---- open-topped gun house: armoured walls, dark interior, team rims, crew, ready rounds
    h = m.part('house', at=(-0.1, 0.175, 0))
    hp = [(-0.24, 0.0), (0.1, 0.0), (0.172, 0.06), (0.122, 0.117), (-0.222, 0.117)]
    side_prism(h, P.hull, hp, 0.3, bevel=0.012)
    box(h, P.black, (0.25, 0.006, 0.25), (-0.06, 0.117, 0))
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        box(h, P.trim_flat, (0.35, 0.016, 0.034), (-0.05, 0.124, 0.135 * s), bevel=0.004)
        camo(m, h, (-0.04, 0.06, 0.1505 * s), (0.3, 0.1), f, seed=73 + s, n=2, colors=(0x6a6a6a,))
        emblem(m, h, 'allied_star', (-0.07, 0.058, 0.151 * s), 0.06, facing=f)
        number(m, h, '88', (0.06, 0.06, 0.151 * s), 0.03, f)
    box(h, P.dark2, (0.014, 0.05, 0.27), (-0.229, 0.14, 0), bevel=0.003)
    deck_strips(m, h, -0.222, 0.122, 0.118, 0.15, width=0.012)
    for i in range(4):
        cyl(h, brass, 0.0125, 0.06, (-0.18 + i * 0.03, 0.148, 0.09), seg=8)
    crate(h, P.jerry, (0.08, 0.04, 0.06), (-0.15, 0.137, -0.07), strap=P.black)
    crew(h, P, (-0.1, 0.117, -0.02), P.dark2)
    crew(h, P, (-0.19, 0.117, 0.04), P.dark2)
    whip(h, P, (-0.22, 0.117, -0.12), 0.2, pennant=True)
    marker(h, (-0.23, 0.13, 0.12), 0.012, AMBER, '+y', mode='blink', strength=3.2)

    # ---- elevated howitzer: mantlet, recuperators, long barrel with evacuator and a muzzle brake
    g = m.part('gun', at=(0.04, 0.27, 0), rot=(0, 0, 0.2))
    box(g, P.dark, (0.085, 0.064, 0.105), (-0.02, 0, 0), bevel=0.016)
    for z in (-0.03, 0.03):
        cyl(g, P.steel, 0.0095, 0.16, (0.08, -0.032, z), ROT_X, seg=8)
    b = m.part('b0', parent='gun', at=(0.02, 0, 0))
    gun_barrel(b, P, 0.52, 0.0202, (0, 0, 0), brake='t', sleeve=(0.3, 0.07))
    m.muzzle('m0', (0.56, 0, 0), part='gun')
