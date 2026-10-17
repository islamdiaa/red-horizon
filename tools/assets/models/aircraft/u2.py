"""Spy plane (u2, U-2 style high-altitude reconnaissance; flies the spy-plane support power), dressed for the RTS
camera: a slim satin-black fuselage and very long glider wings with bright worn leading edges, broad team-colour
bands near the wingtips and on the fin, recognition marks on the wing tops, the narrow canopy, intakes at the
wing roots, the camera bay glazing under the nose, wingtip skids with red / green lamps, the white strobe on the
fin ('glow:strobe') and the exhaust smoke point. Pivots: node --import tsx tools/assets/rig.ts u2.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _ak import *  # noqa: E402,F401,F403

ID = 'u2'
FACTION = 'soviet'
KIND = 'aircraft'

CY = 0.09


def build(m):
    m.set_meta(height=0.26, radius=0.9, snow=0.15)
    m.ground = False
    m.look(edge_light=0.1, ao_distance=0.14)
    r = m.root
    P = AirPal('soviet')
    blk = painted(0x26292d, panels=None, wear=0.45, rust=0.0, grime=0.25, streaks=0.2, rough=0.42, metal=0.35, var=0.06)
    blk_dk = painted(0x1d1f22, panels=None, wear=0.4, rust=0.0, grime=0.25, rough=0.5, metal=0.3, var=0.05)

    body = [
        (-0.5, CY + 0.002, 0.016, 0.018, 0.016),
        (-0.44, CY + 0.004, 0.024, 0.026, 0.024),
        (-0.25, CY + 0.006, 0.04, 0.042, 0.04),
        (0.0, CY + 0.004, 0.048, 0.05, 0.048),
        (0.2, CY + 0.002, 0.045, 0.046, 0.046),
        (0.34, CY - 0.004, 0.032, 0.03, 0.034),
        (0.42, CY - 0.008, 0.014, 0.014, 0.016),
        (0.445, CY - 0.01, 0.0, 0.0, 0.0),
    ]
    xloft(r, blk, body, seg=14, ex=2.0)
    sphere(r, P.glass, 0.028, (0.23, CY + 0.038, 0), seg=12, rings=6, scale=(2.2, 0.8, 0.85))
    box(r, blk_dk, (0.005, 0.024, 0.046), (0.18, CY + 0.042, 0), bevel=0.002)
    sphere(r, P.glass, 0.016, (0.28, CY - 0.038, 0), seg=10, rings=5, scale=(1.6, 0.8, 1.0))
    cyl(r, P.steel, 0.002, 0.05, (0.47, CY - 0.01, 0), ROT_X, seg=4)
    for s in (-1, 1):
        xloft(r, blk, [(-0.02, CY + 0.012, 0.0, 0.0, 0.0), (0.0, CY + 0.012, 0.018, 0.02, 0.016), (0.08, CY + 0.012, 0.022, 0.024, 0.02),
                       (0.1, CY + 0.012, 0.02, 0.022, 0.018)], seg=10, at=(0, 0, 0.045 * s))
        cyl(r, P.black, 0.016, 0.004, (0.101, CY + 0.012, 0.045 * s), ROT_X, seg=10)
    cyl(r, P.dark, 0.02, 0.03, (-0.515, CY + 0.002, 0), ROT_X, r2=0.016, seg=10)
    cyl(r, P.soot, 0.014, 0.003, (-0.531, CY + 0.002, 0), ROT_X, seg=10)
    m.smoke('ex', (-0.535, CY, 0))

    # ---- long glider wings, tailplane, fin
    wing(r, blk, [(0.085, 0.04), (0.035, 0.955), (-0.02, 0.955), (-0.065, 0.04), (-0.065, -0.04), (-0.02, -0.955),
                  (0.035, -0.955), (0.085, -0.04)], CY - 0.006, 0.014, bevel=0.004)
    wing(r, blk, [(-0.37, 0.02), (-0.45, 0.175), (-0.495, 0.175), (-0.475, 0.02), (-0.475, -0.02), (-0.495, -0.175), (-0.45, -0.175),
                  (-0.37, -0.02)], CY + 0.012, 0.008)
    fin(r, blk, [(-0.31, CY + 0.02), (-0.465, CY + 0.02), (-0.505, CY + 0.18), (-0.43, CY + 0.18)], 0.0, 0.013, bevel=0.003)
    strobe(r, (-0.485, CY + 0.186, 0), 0.008, WHITE_L)
    for s in (-1, 1):
        # team bands near the tips, recognition marks, skids, lamps
        team_shade(m, r, (0.005, CY + 0.002, 0.79 * s), (0.12, 0.13), '+y', TEAM_NEUTRAL, depth=0.03)
        roundel(m, r, P, (0.01, CY + 0.002, 0.52 * s), 0.1, depth=0.03)
        team_shade(m, r, (-0.44, CY + 0.13, 0.007 * s), (0.08, 0.06), '+z' if s > 0 else '-z', TEAM_NEUTRAL, depth=0.02)
        box(r, blk_dk, (0.07, 0.024, 0.008), (0.0, CY - 0.024, 0.95 * s), bevel=0.003)
        lamp(r, (0.0, CY - 0.002, 0.962 * s), 0.012, GREEN if s > 0 else RED, 'steady', 3.6, '+z' if s > 0 else '-z')
        strip(m, r, (0.082, CY + 0.002, 0.05 * s), (0.034, CY + 0.002, 0.945 * s), '+y', 0.012)
        strip(m, r, (-0.375, CY + 0.017, 0.025 * s), (-0.448, CY + 0.017, 0.17 * s), '+y', 0.008)
    lamp(r, (-0.51, CY + 0.06, 0), 0.007, WHITE_L, 'steady', 3.0, '-x')
    strip(m, r, (-0.35, CY + 0.058, 0), (0.15, CY + 0.054, 0), '+y', 0.008, color=0x45494e)

    # ---- bicycle gear
    bar(r, P.dark, (0.12, CY - 0.04, 0), (0.12, 0.018, 0), 0.01)
    wheel(r, P, (0.12, 0.018, 0), 0.018, 0.014)
    bar(r, P.dark, (-0.3, CY - 0.03, 0), (-0.3, 0.014, 0), 0.008)
    wheel(r, P, (-0.3, 0.014, 0), 0.014, 0.012)
