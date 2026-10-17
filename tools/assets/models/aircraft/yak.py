"""Soviet ground-attack plane (yak, Yak-9 style piston fighter), dressed for the RTS camera: team-painted
fuselage, wings and tail with darker team-shade camouflage over a pale blue-grey belly, gold stars on team discs on
the wing tops, a red-bordered star on the fin, the dark engine cowling with exhaust stubs and an oil cooler scoop,
the framed bubble canopy, wing cannons (muzzles m0 / m1), red / green wingtip lamps, fixed main gear and tail
wheel, and the three-blade propeller with the red spinner (part 'prop', spun by the game; the procedural blur
disc is kept). Pivots: node --import tsx tools/assets/rig.ts yak.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _ak import *  # noqa: E402,F401,F403

ID = 'yak'
FACTION = 'soviet'
KIND = 'aircraft'

CY = 0.1


def build(m):
    m.set_meta(height=0.22, radius=0.4, keep=['fx:rotor'], snow=0.15)
    m.ground = False
    m.look(edge_light=0.08, ao_distance=0.14)
    r = m.root
    P = AirPal('soviet')

    # ---- fuselage: cowling (dark), cockpit, tapering rear fuselage
    body = [
        (-0.335, CY + 0.004, 0.0, 0.0, 0.0),
        (-0.32, CY + 0.004, 0.01, 0.014, 0.012),
        (-0.2, CY + 0.004, 0.026, 0.034, 0.03),
        (-0.04, CY + 0.004, 0.045, 0.048, 0.05),
        (0.12, CY, 0.05, 0.05, 0.054),
        (0.17, CY, 0.05, 0.048, 0.052),
    ]
    xloft(r, P.top, body, seg=14, ex=2.2, belly=P.belly, belly_ny=-0.4)
    xloft(r, P.dark, [(0.17, CY, 0.05, 0.048, 0.052), (0.25, CY, 0.05, 0.046, 0.05), (0.272, CY, 0.044, 0.04, 0.044),
                      (0.276, CY, 0.0, 0.0, 0.0)], seg=14, ex=2.2)
    for s in (-1, 1):
        for i in range(3):
            box(r, P.exhaust, (0.016, 0.012, 0.012), (0.19 + i * 0.024, CY + 0.024, 0.049 * s), bevel=0.002)
    xloft(r, P.belly, [(-0.06, CY - 0.05, 0.0, 0.0, 0.0), (-0.03, CY - 0.05, 0.024, 0.02, 0.022), (0.06, CY - 0.05, 0.026, 0.02, 0.024),
                       (0.075, CY - 0.05, 0.0, 0.0, 0.0)], seg=10, ex=3.0)
    cyl(r, P.black, 0.018, 0.004, (0.074, CY - 0.052, 0), ROT_X, seg=8)
    # canopy (bubble + frames) and the dorsal fairing behind it
    sphere(r, P.glass, 0.034, (0.03, CY + 0.046, 0), seg=12, rings=7, scale=(2.1, 0.95, 0.82))
    for x in (0.0, 0.055):
        box(r, P.dark, (0.005, 0.03, 0.058), (x, CY + 0.05, 0), bevel=0.002)
    xloft(r, P.top, [(-0.2, CY + 0.03, 0.0, 0.0, 0.0), (-0.16, CY + 0.034, 0.012, 0.012, 0.01), (-0.03, CY + 0.046, 0.02, 0.022, 0.012),
                     (-0.02, CY + 0.046, 0.0, 0.0, 0.0)], seg=8)

    # ---- wings, tailplane, fin
    wing(r, P.top_flat, [(0.125, -0.04), (0.125, 0.04), (0.085, 0.385), (0.005, 0.385), (-0.045, 0.04), (-0.045, -0.04),
                         (0.005, -0.385), (0.085, -0.385)], CY - 0.03, 0.016, bevel=0.005)
    wing(r, P.top_flat, [(-0.23, 0.0), (-0.265, 0.125), (-0.31, 0.125), (-0.315, 0.0), (-0.31, -0.125), (-0.265, -0.125)],
         CY + 0.004, 0.008)
    fin(r, P.top, [(-0.22, CY + 0.01), (-0.32, CY + 0.01), (-0.335, CY + 0.11), (-0.295, CY + 0.11)], 0.0, 0.01, bevel=0.003)

    # ---- guns, lamps, marks
    for s in (-1, 1):
        cyl(r, P.black, 0.0055, 0.08, (0.16, CY - 0.025, 0.12 * s), ROT_X, seg=6)
        lamp(r, (0.04, CY - 0.024, 0.386 * s), 0.012, GREEN if s > 0 else RED, 'steady', 3.6, '+z' if s > 0 else '-z')
        roundel(m, r, P, (0.04, CY - 0.02, 0.26 * s), 0.1, depth=0.03)
        side_star(m, r, P, (-0.29, CY + 0.06, 0.006 * s), 0.05, '+z' if s > 0 else '-z')
        tail_number(m, r, '17', (-0.12, CY + 0.004, 0.032 * s), 0.03, '+z' if s > 0 else '-z', color=0xe8e4da)
        # main gear
        bar(r, P.dark, (0.09, CY - 0.035, 0.1 * s), (0.09, 0.024, 0.104 * s), 0.01)
        wheel(r, P, (0.09, 0.024, 0.104 * s), 0.024, 0.014)
    m.muzzle('m0', (0.19, 0.075, -0.12), part='root')
    m.muzzle('m1', (0.19, 0.075, 0.12), part='root')
    bar(r, P.dark, (-0.28, CY - 0.02, 0), (-0.3, 0.014, 0), 0.007)
    wheel(r, P, (-0.3, 0.014, 0), 0.013, 0.009)
    lamp(r, (-0.338, CY + 0.06, 0), 0.007, WHITE_L, 'steady', 3.0, '-x')

    # ---- camouflage and leading-edge highlights
    camo_top(m, r, (-0.02, CY, 0), (0.62, 0.78), seed=9, n=12)
    for s in (-1, 1):
        strip(m, r, (0.12, CY - 0.021, 0.05 * s), (0.083, CY - 0.021, 0.375 * s), '+y', 0.01)

    # ---- propeller: red spinner + three blades (spins about X)
    pr = m.part('prop', at=(0.28, CY, 0))
    lathe(pr, P.red, [(0.032, 0.0), (0.03, 0.02), (0.02, 0.045), (0.0, 0.062)], (0, 0, 0), seg=12, rot=(0, 0, -PI / 2))
    tail_blades(pr, P, 3, 0.16, 0.026, axis='x', t=0.008)
