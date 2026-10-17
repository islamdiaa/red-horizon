"""Soviet missile submarine (msub), dressed for the RTS camera: a bigger near-black round hull, the lighter casing
with bright worn edges and limber holes, the sail forward (team band, white number, red stars, fairwater planes),
periscopes / snorkel / red strobe (part 'masts'), and the raised missile deck aft: six tubes in two rows with
team-red rims and white missile noses, each under its own hinged hatch ('hatch0'-'hatch5', swung open by the game
to fire; muzzles m0-m5 point up), a team panel with the gold star on a team disc, bow planes, the cruciform stern
and the seven-blade brass propeller ('prop'). The procedural submerged 'ghost' outline is kept. Everything hangs
under 'hull' (the game dives it). Pivots: node --import tsx tools/assets/rig.ts msub.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nk import *  # noqa: E402,F401,F403

ID = 'msub'
FACTION = 'soviet'
KIND = 'naval'
ATLAS = 512


def build(m):
    m.set_meta(height=0.32, radius=0.7, keep=['fx:add:3fa8ff:0.32'], snow=0.15)
    m.ground = False
    m.look(edge_light=0.09, ao_distance=0.12)
    P = SubPal('soviet')
    hl = m.part('hull')
    H = Hull(stations(1.5, 0.24, 0.045, 0.01, 0.1, 0.32, 0.16, 0.0, n=16, round_=True))
    H.add(hl, P, top=P.hull, deck=P.hull, boot=P.hull, bottom=P.hull_flat)
    dy = H.deck_at(0)

    # ---- casing
    loft(hl, P.casing, [(dy - 0.004, [(-0.5, -0.042), (0.56, -0.034), (0.56, 0.034), (-0.5, 0.042)]),
                        (dy + 0.017, [(-0.49, -0.036), (0.55, -0.029), (0.55, 0.029), (-0.49, 0.036)])], bevel=0.004)
    for s in (-1, 1):
        for i in range(11):
            box(hl, P.black, (0.03, 0.006, 0.004), (-0.44 + i * 0.09, dy - 0.012, (H.half_at(-0.44 + i * 0.09) * 0.62) * s))
    for x in (0.45, 0.1, -0.5):
        cyl(hl, P.black, 0.012, 0.004, (x, dy + 0.018, 0), seg=10)
    edge_strip(m, hl, (0.36, dy + 0.017, 0.028), (0.54, dy + 0.017, 0.026), '+y', 0.008, depth=0.01)
    edge_strip(m, hl, (0.36, dy + 0.017, -0.028), (0.54, dy + 0.017, -0.026), '+y', 0.008, depth=0.01)

    # ---- sail + masts
    sx = 0.28
    sub_sail(m, hl, P, sx, dy + 0.01, '711')
    sub_masts(m, 'hull', P, (sx, dy + 0.145, 0))

    # ---- raised missile deck with six tubes and hatches
    mx = -0.12
    prism(hl, P.casing, [(-0.32, 0.0), (0.1, 0.0), (0.07, 0.05), (-0.29, 0.05)], 0.13, (mx, dy + 0.005, 0), bevel=0.006)
    for s in (-1, 1):
        edge_strip(m, hl, (mx - 0.28, dy + 0.055, 0.061 * s), (mx + 0.06, dy + 0.055, 0.061 * s), '+y', 0.008, depth=0.01)
    team_shade(m, hl, (mx - 0.11, dy + 0.055, 0), (0.36, 0.125), '+y', TEAM_NEUTRAL, depth=0.01)
    roundel(m, hl, P, (mx + 0.035, dy + 0.055, 0), 0.06, depth=0.01)
    k = 0
    for i in range(3):
        for s in (-1, 1):
            x = mx - 0.19 + i * 0.11
            z = 0.032 * s
            cyl(hl, P.team, 0.026, 0.006, (x, dy + 0.056, z), seg=14)
            cyl(hl, P.black, 0.021, 0.004, (x, dy + 0.059, z), seg=12)
            lathe(hl, P.white, [(0.012, 0.0), (0.01, 0.014), (0.0, 0.026)], (x, dy + 0.04, z), seg=10)
            hp = m.part(f'hatch{k}', parent='hull', at=(x - 0.022, dy + 0.06, z))
            cyl(hp, P.casing, 0.022, 0.008, (0.022, 0.004, 0), seg=14, bevel=0.002)
            box(hp, P.dark, (0.01, 0.01, 0.014), (0.002, 0.004, 0), bevel=0.002)
            m.point(f'm{k}', (x, dy + 0.08, z), part='hull', rot=(0, 0, PI / 2), kind='muzzle')
            k += 1

    # ---- bow planes, stern
    for s in (-1, 1):
        box(hl, P.hull_flat, (0.06, 0.007, 0.07), (0.55, -0.02, 0.11 * s), bevel=0.002)
    sub_stern(m, hl, P, -0.69, -0.76, 7, span=0.09)
    m.smoke('exhaust', (0.23, 0.245, 0))
