"""Allied mobile radar jammer (mrj): team-painted 6x6 truck (scrolling tyres) with the driver, an off-white
electronics shelter with team roof and band, door, vents, AC units and a ladder, a generator with its exhaust
(smoke 'exhaust'), and the telescoping mast (part 'mast', stretched by the game) carrying the spinning jammer
array (part 'array') with green tips ('glow:jam'). Pivots: node --import tsx tools/assets/rig.ts mrj.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = 'mrj'
FACTION = 'allies'
KIND = 'vehicle'


def crew(p, P, at, helmet):
    x, y, z = at
    box(p, P.canvas, (0.042, 0.052, 0.062), (x, y + 0.026, z), bevel=0.008)
    sphere(p, painted(0xd0a080, panels=None, wear=0.0, rust=0.0, rough=0.7, metal=0.0), 0.016, (x + 0.006, y + 0.066, z), seg=8, rings=4)
    dome(p, helmet, 0.022, (x + 0.004, y + 0.068, z), seg=8, rings=3, h=0.018)


def build(m):
    m.set_meta(height=0.62, radius=0.44, snow=0.3)
    r = m.root
    P = Pal('allies')
    white = painted(0xd2cfc4, panels=(0.12, 0.1), wear=0.55, rust=0.06, grime=0.45, streaks=0.5, rough=0.55, metal=0.15, var=0.08)

    wr, ww = 0.066, 0.054
    for x in (0.27, -0.08, -0.26):
        for s in (-1, 1):
            wheel(r, P, wr, ww, (x, wr, 0.16 * s), s)
    box(r, P.dark, (0.84, 0.05, 0.22), (-0.02, 0.085, 0), bevel=0.008)
    # ---- cab
    cab = [(0.18, 0.09), (0.42, 0.09), (0.432, 0.162), (0.382, 0.252), (0.2, 0.262)]
    side_prism(r, P.hull, cab, 0.3, bevel=0.015)
    box(r, P.glass, (0.062, 0.062, 0.252), (0.405, 0.216, 0), (0, 0, 0.98))
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        box(r, P.glass, (0.09, 0.046, 0.006), (0.3, 0.215, 0.151 * s))
        box(r, P.black, (0.006, 0.036, 0.026), (0.41, 0.23, 0.166 * s))
        camo(m, r, (0.3, 0.13, 0.151 * s), (0.22, 0.07), f, seed=111 + s, n=2)
        for x in (0.27, -0.08, -0.26):
            box(r, P.dark2, (0.145, 0.012, 0.068), (x, 0.136, 0.16 * s), bevel=0.004)
        headlight(r, (0.432, 0.142, 0.105 * s), 0.016, guard=P.black)
    emblem(m, r, 'allied_star', (0.3, 0.215, 0.152), 0.05, facing='+z')
    crew(r, P, (0.33, 0.15, -0.06), P.dark2)
    box(r, P.gun, (0.022, 0.022, 0.27), (0.442, 0.1, 0), bevel=0.004)
    grille(m, r, (0.433, 0.125, 0.0), (0.16, 0.035), facing='+x', n=3)
    marker(r, (0.3, 0.264, 0.0), 0.011, AMBER, '+y', mode='blink', strength=2.6)
    # ---- electronics shelter
    box(r, white, (0.46, 0.2, 0.3), (-0.12, 0.215, 0), bevel=0.014)
    box(r, P.trim_flat, (0.48, 0.022, 0.32), (-0.12, 0.326, 0), bevel=0.006)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        box(r, P.trim_flat, (0.46, 0.036, 0.006), (-0.12, 0.272, 0.151 * s), bevel=0.002)
        grille(m, r, (-0.28, 0.2, 0.151 * s), (0.08, 0.1), facing=f, n=4)
        box(r, P.dark, (0.09, 0.14, 0.006), (-0.04, 0.19, 0.151 * s), bevel=0.002)
        box(r, P.steel, (0.008, 0.014, 0.008), (-0.005, 0.19, 0.156 * s))
        box(r, P.gun, (0.07, 0.06, 0.04), (0.05, 0.25, 0.17 * s), bevel=0.006)
        cyl(r, P.black, 0.022, 0.004, (0.05, 0.25, 0.19 * s), ROT_Z, seg=10)
        hazard_stripes(m, r, (-0.12, 0.123, 0.151 * s), (0.44, 0.022), facing=f)
    for z in (0.07, 0.11):
        bar(r, P.steel, (-0.356, 0.12, z), (-0.356, 0.32, z), 0.006)
    for k in range(5):
        bar(r, P.steel, (-0.356, 0.14 + k * 0.04, 0.07), (-0.356, 0.14 + k * 0.04, 0.11), 0.005)
    tail_lights(r, -0.354, 0.15, 0.12)
    hazard_stripes(m, r, (-0.354, 0.12, -0.05), (0.18, 0.025), facing='-x')
    emblem(m, r, 'allied_star', (-0.25, 0.338, 0.0), 0.08, facing='+y')
    deck_strips(m, r, -0.36, 0.12, 0.337, 0.16)
    deck_strips(m, r, 0.2, 0.382, 0.258, 0.15, rear=False, width=0.012)
    # generator + exhaust on the back
    box(r, P.gun, (0.06, 0.07, 0.1), (-0.36, 0.16, -0.06), bevel=0.008)
    cyl(r, P.exhaust, 0.01, 0.06, (-0.36, 0.22, 0.06), seg=6)
    box(r, P.gun, (0.06, 0.07, 0.1), (-0.36, 0.16, 0.06), bevel=0.008)
    m.point('exhaust', (-0.36, 0.22, 0.06), kind='smoke')
    whip(r, P, (0.2, 0.262, -0.11), 0.2, pennant=True)

    # ---- mast (telescopes) + array (spins)
    cyl(r, P.gun, 0.032, 0.04, (-0.12, 0.345, 0), r2=0.028, seg=10, bevel=0.004)
    mast = m.part('mast', at=(-0.12, 0.36, 0))
    cyl(mast, P.steel, 0.016, 0.2, (0, 0.1, 0), r2=0.012, seg=8)
    for k in range(3):
        cyl(mast, P.dark, 0.019, 0.008, (0, 0.04 + k * 0.06, 0), seg=8)
    arr = m.part('array', parent='mast', at=(0, 0.2, 0))
    box(arr, P.gun, (0.3, 0.018, 0.032), (0, 0, 0), bevel=0.005)
    box(arr, P.gun, (0.032, 0.018, 0.3), (0, 0, 0), bevel=0.005)
    cyl(arr, P.dark, 0.022, 0.03, (0, 0.015, 0), seg=10)
    glow_j = glow_material('glow:jam', 0x50ff70)
    for (x, z) in ((0.14, 0), (-0.14, 0), (0, 0.14), (0, -0.14)):
        cyl(arr, white, 0.006, 0.16, (x, 0.07, z), seg=6)
        for k in range(3):
            box(arr, white, (0.055, 0.005, 0.005), (x, 0.02 + k * 0.05, z), (0, math.atan2(z, x) + PI / 2, 0))
        sphere(arr, glow_j, 0.01, (x, 0.155, z), seg=6, rings=4)
