"""Soviet strike jet (mig, MiG-29 style), dressed for the RTS camera: a broad team-painted lifting body and swept
wings with darker team-shade camouflage over a pale blue-grey belly, gold stars on team discs on both wing tops,
the bubble canopy, the dark radome, two widely spaced engines with box intakes under the leading-edge extensions
and dark nozzles with the afterburner glow (animated 'glow:ab' slot), canted twin fins with red stars,
stabilators, white R-27 missiles under the wings (muzzles m0 / m1), red / green wingtip lamps and a red beacon.
Pivots: node --import tsx tools/assets/rig.ts mig.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _ak import *  # noqa: E402,F401,F403

ID = 'mig'
FACTION = 'soviet'
KIND = 'aircraft'

CY = 0.09


def build(m):
    m.set_meta(height=0.24, radius=0.45, snow=0.15)
    m.ground = False
    m.look(edge_light=0.08, ao_distance=0.14)
    r = m.root
    P = AirPal('soviet')

    # ---- spine / nose: cockpit section ahead of the wings, dark radome
    spine = [
        (-0.3, CY + 0.01, 0.0, 0.0, 0.0),
        (-0.26, CY + 0.012, 0.03, 0.028, 0.02),
        (0.0, CY + 0.012, 0.045, 0.038, 0.03),
        (0.14, CY + 0.008, 0.044, 0.04, 0.034),
        (0.26, CY + 0.002, 0.036, 0.032, 0.03),
        (0.34, CY - 0.002, 0.028, 0.024, 0.024),
    ]
    xloft(r, P.top, spine, seg=14, ex=2.2, belly=P.belly, belly_ny=-0.4)
    xloft(r, P.dark, [(0.34, CY - 0.002, 0.028, 0.024, 0.024), (0.4, CY - 0.004, 0.02, 0.017, 0.017), (0.45, CY - 0.006, 0.0, 0.0, 0.0)], seg=14)
    cyl(r, P.steel, 0.0025, 0.05, (0.47, CY - 0.006, 0), ROT_X, seg=4)
    sphere(r, P.glass, 0.032, (0.19, CY + 0.042, 0), seg=12, rings=7, scale=(2.0, 0.8, 0.85))
    box(r, P.dark, (0.006, 0.024, 0.05), (0.13, CY + 0.045, 0), bevel=0.002)

    # ---- engines: two nacelles under the body, box intakes, nozzles with the afterburner glow
    for s in (-1, 1):
        z = 0.048 * s
        xloft(r, P.top, [(-0.395, CY - 0.012, 0.03, 0.028, 0.03), (-0.3, CY - 0.012, 0.036, 0.034, 0.036), (0.0, CY - 0.014, 0.036, 0.03, 0.036),
                         (0.1, CY - 0.018, 0.034, 0.026, 0.034), (0.105, CY - 0.018, 0.0, 0.0, 0.0)], seg=12, ex=2.6, at=(0, 0, z),
              belly=P.belly, belly_ny=-0.35)
        box(r, P.dark2, (0.06, 0.038, 0.05), (0.12, CY - 0.03, z), bevel=0.006)
        box(r, P.black, (0.004, 0.028, 0.04), (0.151, CY - 0.03, z))
        cyl(r, P.gun, 0.03, 0.05, (-0.415, CY - 0.012, z), ROT_X, r2=0.026, seg=12)
        cyl(r, P.black, 0.022, 0.004, (-0.44, CY - 0.012, z), ROT_X, seg=10)
        cyl(r, glow_material('glow:ab', 0xff8a3a), 0.02, 0.003, (-0.437, CY - 0.012, z), (0, 0, PI / 2), seg=10)

    # ---- wings + leading-edge extensions (one plate a side), centre body plate, stabilators
    for s in (-1, 1):
        outline = [(0.2, 0.03), (0.07, 0.11), (-0.17, 0.305), (-0.235, 0.305), (-0.255, 0.07), (-0.05, 0.03)]
        wing(r, P.top_flat, outline if s > 0 else [(x, -z) for (x, z) in reversed(outline)], CY - 0.004, 0.014, bevel=0.004)
        wing(r, P.top_flat, [(-0.3, 0.05), (-0.38, 0.175), (-0.43, 0.175), (-0.42, 0.05)] if s > 0 else
             [(-0.42, -0.05), (-0.43, -0.175), (-0.38, -0.175), (-0.3, -0.05)], CY - 0.008, 0.008)
        # canted twin fins with red stars, white tip lamps
        prism(r, P.top, [(-0.25, 0.0), (-0.41, 0.0), (-0.445, 0.15), (-0.395, 0.15)], 0.01, (0, CY + 0.012, 0.062 * s),
              (0.2 * s, 0, 0), bevel=0.003)
        side_star(m, r, P, (-0.385, CY + 0.095, 0.083 * s), 0.045, '+z' if s > 0 else '-z')
        light(r, (-0.43, CY + 0.162, 0.093 * s), 0.006, WHITE_L, 'steady', 3.0, housing=P.dark)

    # ---- stores: R-27 under the wings (m0 / m1), short-range missiles outboard
    for s in (-1, 1):
        box(r, P.dark, (0.07, 0.016, 0.008), (-0.05, CY - 0.022, 0.17 * s), bevel=0.002)
        missile(r, P, (-0.05, CY - 0.04, 0.17 * s), 0.011, 0.17)
        box(r, P.dark, (0.05, 0.012, 0.006), (-0.12, CY - 0.018, 0.245 * s), bevel=0.002)
        missile(r, P, (-0.115, CY - 0.03, 0.245 * s), 0.0075, 0.1, tip=P.dark)
        lamp(r, (-0.2, CY, 0.306 * s), 0.012, GREEN if s > 0 else RED, 'steady', 3.6, '+z' if s > 0 else '-z')
        roundel(m, r, P, (-0.13, CY + 0.004, 0.2 * s), 0.085, depth=0.03)
        tail_number(m, r, '31', (0.05, CY - 0.02, (0.048 + 0.037) * s), 0.026, '+z' if s > 0 else '-z', color=0xe8b434)
    m.muzzle('m0', (0.05, 0.05, -0.17), part='root')
    m.muzzle('m1', (0.05, 0.05, 0.17), part='root')
    light(r, (-0.05, CY + 0.05, 0), 0.007, RED, 'blink', 3.4, housing=P.dark)

    # ---- camouflage, walkway and leading-edge highlights on the top
    camo_top(m, r, (-0.08, CY + 0.03, 0), (0.62, 0.62), seed=5, n=12)
    for s in (-1, 1):
        strip(m, r, (0.07, CY + 0.004, 0.115 * s), (-0.165, CY + 0.004, 0.3 * s), '+y', 0.01)
        strip(m, r, (0.2, CY + 0.004, 0.035 * s), (0.075, CY + 0.004, 0.11 * s), '+y', 0.008)

    # ---- gear (short struts: the jet sits on y = 0)
    for (x, z) in ((0.22, 0.0), (-0.12, 0.072), (-0.12, -0.072)):
        bar(r, P.dark, (x, CY - 0.03, z), (x, 0.016, z), 0.009)
        wheel(r, P, (x, 0.016, z), 0.016, 0.012)

