"""Soviet V2 rocket launcher (v2rl): olive 6x6 truck (scrolling tyres) with team cab doors, crew, roof beacon
('glow:beacon', blinks while reloading), flatbed with stowage and stabiliser jacks, the erector rail (part
'rail', pivot at the rear, raised by the game) carrying the black-and-white quartered V2 (part 'rocket',
hidden while reloading) with a team-colour nose, muzzle 'm0'. Pivots: node --import tsx tools/assets/rig.ts v2rl.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = 'v2rl'
FACTION = 'soviet'
KIND = 'vehicle'


def crew(p, P, at, helmet):
    x, y, z = at
    box(p, P.dark2, (0.042, 0.052, 0.062), (x, y + 0.026, z), bevel=0.008)
    sphere(p, painted(0xd0a080, panels=None, wear=0.0, rust=0.0, rough=0.7, metal=0.0), 0.016, (x + 0.006, y + 0.066, z), seg=8, rings=4)
    dome(p, helmet, 0.022, (x + 0.004, y + 0.068, z), seg=8, rings=3, h=0.018)


def v2(m, p, P):
    """V2 lying along +X centred on the part origin: quartered paint, team nose with a red band, fins."""
    blk = painted(0x1c1c1e, panels=None, wear=0.45, rust=0.05, grime=0.3, rough=0.5, var=0.06)
    wht = painted(0xe2dfd4, panels=None, wear=0.35, rust=0.05, grime=0.35, rough=0.5, var=0.06)
    red = painted(0xb02418, panels=None, wear=0.35, rust=0.05, rough=0.45, var=0.06)
    R = 0.05
    for (x0, x1, r0, inv) in ((-0.25, -0.07, R * 0.9, False), (-0.07, 0.1, R, True)):
        for q in range(4):
            black = (q % 2 == 0) != inv
            a0 = PI / 4 + q * PI / 2
            sector(p, blk if black else wht, r0, R, x0, x1, a0, a0 + PI / 2, seg=3)
    lathe(p, P.trim_flat, [(R, 0.0), (R * 0.95, 0.04), (R * 0.75, 0.09), (R * 0.4, 0.13), (0.004, 0.155)], (0.1, 0, 0), seg=12, rot=ROT_X)
    cyl(p, red, R * 1.02, 0.014, (0.107, 0, 0), ROT_X, seg=12)
    cyl(p, P.black, R * 0.9, 0.04, (-0.27, 0, 0), ROT_X, r2=R * 0.9, seg=10)
    cyl(p, P.black, R * 0.55, 0.012, (-0.296, 0, 0), ROT_X, seg=10)
    for i in range(4):
        a = i * PI / 2 + PI / 4
        prism(p, blk if i % 2 else wht, [(-0.28, 0.0), (-0.16, 0.0), (-0.24, 0.078), (-0.285, 0.078)], 0.007, (0, 0, 0), rot=(a, 0, 0))


def build(m):
    m.set_meta(height=0.5, radius=0.46, snow=0.3)
    r = m.root
    P = Pal('soviet')
    wr, ww = 0.07, 0.058
    for x in (0.32, -0.14, -0.31):
        for s in (-1, 1):
            wheel(r, P, wr, ww, (x, wr, 0.165 * s), s)
    box(r, P.dark, (0.9, 0.05, 0.22), (-0.01, 0.09, 0), bevel=0.008)

    # ---- cab: olive with team doors, glazing, crew, roof hatch + beacon, bumper, lights
    cab = [(0.21, 0.1), (0.48, 0.1), (0.492, 0.176), (0.432, 0.278), (0.23, 0.288)]
    side_prism(r, P.hull, cab, 0.32, bevel=0.016)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        box(r, P.trim_flat, (0.15, 0.09, 0.008), (0.33, 0.162, 0.162 * s), bevel=0.003)
        box(r, P.glass, (0.1, 0.05, 0.006), (0.33, 0.236, 0.161 * s))
        emblem(m, r, 'soviet', (0.33, 0.165, 0.1665 * s), 0.05, facing=f)
        box(r, P.black, (0.006, 0.04, 0.03), (0.48, 0.25, 0.172 * s))
        # front fender over the front wheel
        box(r, P.hull_flat, (0.16, 0.014, 0.075), (0.32, 0.155, 0.165 * s), bevel=0.004)
    box(r, P.glass, (0.07, 0.072, 0.272), (0.452, 0.236, 0), (0, 0, 0.98))
    box(r, P.black, (0.008, 0.072, 0.008), (0.454, 0.236, 0), (0, 0, 0.98))
    crew(r, P, (0.37, 0.16, -0.07), P.dark)
    crew(r, P, (0.37, 0.16, 0.07), P.dark)
    box(r, P.top, (0.17, 0.014, 0.26), (0.33, 0.292, 0), bevel=0.005)
    top_star(m, r, 'soviet', (0.345, 0.3, -0.03), 0.125)
    cyl(r, P.black, 0.019, 0.012, (0.27, 0.3, 0.095), seg=8)
    dome(r, glow_material('glow:beacon', AMBER), 0.019, (0.27, 0.306, 0.095), seg=8, rings=3, h=0.024)
    grille(m, r, (0.489, 0.14, 0.0), (0.2, 0.04), facing='+x', n=3)
    box(r, P.gun, (0.022, 0.024, 0.31), (0.5, 0.11, 0), bevel=0.004)
    for s in (-1, 1):
        headlight(r, (0.49, 0.152, 0.115 * s), 0.017, guard=P.black)
    tow_hooks(r, P, 0.51, 0.1, 0.08, 1)
    whip(r, P, (0.24, 0.288, -0.12), 0.22, pennant=True)
    cyl(r, P.exhaust, 0.013, 0.16, (0.2, 0.26, 0.13), r2=0.012, seg=8)

    # ---- flatbed: deck, rear fenders, control box, stowage, jacks, hazard plate, tail lights
    box(r, P.dark2, (0.66, 0.036, 0.32), (-0.15, 0.13, 0), bevel=0.008)
    for x in (-0.14, -0.31):
        for s in (-1, 1):
            box(r, P.hull_flat, (0.15, 0.012, 0.075), (x, 0.158, 0.163 * s), bevel=0.004)
    box(r, P.gun, (0.12, 0.072, 0.24), (0.13, 0.184, 0), bevel=0.012)
    grille(m, r, (0.13, 0.221, 0.0), (0.08, 0.16), facing='+y', n=5)
    crate(r, P.trim_flat, (0.14, 0.042, 0.036), (-0.12, 0.17, 0.135), strap=P.black)
    crate(r, P.dark, (0.14, 0.042, 0.036), (-0.12, 0.17, -0.135), strap=P.black)
    jerry_rack(r, P, 2, 0.06, 0.148, -0.125, yaw=PI / 2)
    tail_lights(r, -0.482, 0.135, 0.13)
    # Soviet dress: light olive bed, red front wheel guards and a red tail band, gold number beside the rail
    paint(m, r, (-0.15, 0.148, 0.0), (0.66, 0.32), '+y', OLIVE_DECK, depth=0.01)
    for s in (-1, 1):
        red(m, r, (0.32, 0.162, 0.165 * s), (0.17, 0.08), '+y', depth=0.01)
    red(m, r, (-0.465, 0.148, 0.0), (0.035, 0.32), '+y', depth=0.01)
    deck_number(m, r, 'Р-12', (-0.33, 0.149, 0.097), 0.05, roll=0.0, depth=0.01)
    deck_strips(m, r, 0.23, 0.432, 0.285, 0.16, width=0.014)
    deck_strips(m, r, -0.48, 0.18, 0.148, 0.16, front=False, width=0.014)
    for s in (-1, 1):
        lamp(r, (-0.465, 0.149, 0.14 * s), 0.011, RED, 'steady', 3.2, '+y')
    stencil(m, r, 'ЗА РОДИНУ', (-0.12, 0.13, 0.1605), 0.03, facing='+z')
    stencil(m, r, 'ЗА РОДИНУ', (-0.12, 0.13, -0.1605), 0.03, facing='-z')
    hazard_stripes(m, r, (-0.481, 0.128, 0.0), (0.3, 0.03), facing='-x')
    for s in (-1, 1):
        box(r, P.gun, (0.032, 0.085, 0.032), (-0.44, 0.08, 0.15 * s), bevel=0.004)
        box(r, P.black, (0.055, 0.01, 0.055), (-0.44, 0.005, 0.15 * s))
    number(m, r, '12', (-0.3, 0.13, 0.1605), 0.03, '+z')

    # ---- erector rail (pivot at the rear) with cradles, hydraulic ram; the rocket rides on it
    rl = m.part('rail', at=(-0.42, 0.18, 0), rot=(0, 0, 0.42))
    box(rl, P.gun, (0.74, 0.026, 0.072), (0.37, 0.0, 0), bevel=0.006)
    for z in (-0.027, 0.027):
        box(rl, P.steel, (0.74, 0.009, 0.016), (0.37, 0.017, z))
    cyl(rl, P.dark, 0.026, 0.12, (0, 0, 0), ROT_Z, seg=10)
    for x in (0.15, 0.4, 0.62):
        box(rl, P.gun, (0.022, 0.052, 0.112), (x, 0.03, 0), bevel=0.004)
    cyl(rl, P.steel, 0.012, 0.16, (0.3, -0.06, 0), (0, 0, 0.6), seg=8)
    cyl(rl, P.dark2, 0.019, 0.08, (0.27, -0.09, 0), (0, 0, 0.6), seg=8)
    rk = m.part('rocket', parent='rail', at=(0.38, 0.062, 0))
    v2(m, rk, P)
    m.muzzle('m0', (0.68, 0.062, 0), part='rail')
