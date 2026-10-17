"""Soviet attack submarine (ss), dressed for the RTS camera: a near-black round hull riding low, the lighter deck
casing with limber holes, bright worn casing edges and a team stripe with the gold star on a team disc aft of the
sail, the streamlined sail (team band, white number, red stars, dark bridge cockpit, fairwater planes), the
periscopes / snorkel / red strobe (part 'masts', above the water at periscope depth), bow planes, the cruciform
stern with the brass propeller ('prop', spun by the game), torpedo tube doors (muzzles m0-m3), hatches and a
capstan. The procedural owner-only surface 'ghost' outline is kept for the submerged state. Everything hangs
under 'hull' (the game dives it). Pivots: node --import tsx tools/assets/rig.ts ss.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nk import *  # noqa: E402,F401,F403

ID = 'ss'
FACTION = 'soviet'
KIND = 'naval'
ATLAS = 512


def build(m):
    m.set_meta(height=0.3, radius=0.62, keep=['fx:add:3fa8ff:0.32'], snow=0.15)
    m.ground = False
    m.look(edge_light=0.09, ao_distance=0.12)
    P = SubPal('soviet')
    hl = m.part('hull')
    H = Hull(stations(1.3, 0.2, 0.04, 0.01, 0.09, 0.3, 0.15, 0.0, n=14, round_=True))
    H.add(hl, P, top=P.hull, deck=P.hull, boot=P.hull, bottom=P.hull_flat)
    dy = H.deck_at(0)

    # ---- deck casing: lighter, edged, limber holes, team stripe + star aft of the sail
    loft(hl, P.casing, [(dy - 0.004, [(-0.43, -0.036), (0.47, -0.03), (0.47, 0.03), (-0.43, 0.036)]),
                        (dy + 0.016, [(-0.42, -0.03), (0.46, -0.025), (0.46, 0.025), (-0.42, 0.03)])], bevel=0.004)
    for s in (-1, 1):
        edge_strip(m, hl, (-0.41, dy + 0.016, 0.027 * s), (0.45, dy + 0.016, 0.023 * s), '+y', 0.008, depth=0.01)
        for i in range(10):
            box(hl, P.black, (0.03, 0.006, 0.004), (-0.38 + i * 0.09, dy - 0.012, (H.half_at(-0.38 + i * 0.09) * 0.62) * s))
    team_shade(m, hl, (-0.22, dy + 0.017, 0), (0.3, 0.03), '+y', TEAM_NEUTRAL, depth=0.012)
    roundel(m, hl, P, (-0.2, dy + 0.017, 0), 0.052, depth=0.012)
    for x in (0.3, -0.1, -0.35):
        cyl(hl, P.black, 0.012, 0.004, (x, dy + 0.017, 0), seg=10)
    cyl(hl, P.dark, 0.01, 0.012, (0.36, dy + 0.02, 0), seg=8)

    # ---- sail, masts
    sx = 0.08
    sub_sail(m, hl, P, sx, dy + 0.01, '415')
    sub_masts(m, 'hull', P, (sx, dy + 0.14, 0))

    # ---- bow planes, stern, torpedo tubes
    for s in (-1, 1):
        box(hl, P.hull_flat, (0.06, 0.007, 0.07), (0.48, -0.02, 0.1 * s), bevel=0.002)
        cyl(hl, P.black, 0.012, 0.004, (0.6, -0.025, 0.035 * s), (0, 0, PI / 2), seg=8)
    sub_stern(m, hl, P, -0.6, -0.66, 5, span=0.07)
    for i, z in enumerate((-0.03, 0.03, -0.03, 0.03)):
        m.point(f'm{i}', (0.66, -0.03, z), part='hull', kind='muzzle')
    m.smoke('exhaust', (0.03, 0.24, 0))
