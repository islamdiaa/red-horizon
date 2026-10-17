"""Soviet bomber (badr, 'Badger'; flies the paratrooper and parabomb support powers), dressed for the RTS camera:
a long team-painted fuselage and swept wings with darker team-shade camouflage over a pale blue-grey belly, big
gold stars on team discs on both wing tops, the glazed navigator's nose with its frame rings, the stepped cockpit
canopy, the dorsal gun turret and the tail gunner's glazing, two turboprop nacelles (parts 'propL' / 'propR':
four blades with yellow tips, spun by the game; blur discs kept), exhaust smoke points, the bomb bay with two
doors 'bayL' / 'bayR' (opened by the game for the drop), a red strobe, red / green wingtip lamps and a white tail
lamp. Pivots: node --import tsx tools/assets/rig.ts badr.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _ak import *  # noqa: E402,F401,F403

ID = 'badr'
FACTION = 'soviet'
KIND = 'aircraft'

CY = 0.13


def build(m):
    m.set_meta(height=0.36, radius=0.85, keep=['fx:rotor'], snow=0.15)
    m.ground = False
    m.look(edge_light=0.08, ao_distance=0.2)
    r = m.root
    P = AirPal('soviet')

    # ---- fuselage, glazed nose, cockpit, tail cone
    body = [
        (-0.735, CY + 0.01, 0.024, 0.026, 0.024),
        (-0.6, CY + 0.012, 0.045, 0.05, 0.046),
        (-0.4, CY + 0.004, 0.072, 0.078, 0.074),
        (-0.2, CY, 0.084, 0.088, 0.086),
        (0.2, CY, 0.086, 0.09, 0.088),
        (0.42, CY - 0.002, 0.08, 0.084, 0.082),
        (0.54, CY - 0.008, 0.064, 0.066, 0.064),
    ]
    xloft(r, P.top, body, seg=16, ex=2.0, belly=P.belly, belly_ny=-0.4)
    xloft(r, P.glass, [(0.54, CY - 0.008, 0.064, 0.066, 0.064), (0.6, CY - 0.012, 0.054, 0.054, 0.052), (0.66, CY - 0.016, 0.034, 0.034, 0.034),
                       (0.695, CY - 0.018, 0.0, 0.0, 0.0)], seg=16)
    for i, (x, rr) in enumerate(((0.565, 0.062), (0.605, 0.054), (0.645, 0.042))):
        torus(r, P.dark, rr, 0.0035, (x, CY - 0.01 - i * 0.002, 0), seg=16, tseg=4, rot=(0, 0, PI / 2))
    sphere(r, P.glass, 0.052, (0.43, CY + 0.065, 0), seg=12, rings=7, scale=(1.8, 0.7, 0.9))
    box(r, P.dark, (0.006, 0.03, 0.09), (0.36, CY + 0.07, 0), bevel=0.002)
    paint(m, r, (0.5, CY + 0.07, 0), (0.06, 0.09), '+y', 0x1c1e21, depth=0.04)
    sphere(r, P.glass, 0.03, (-0.745, CY + 0.01, 0), seg=10, rings=6)
    for s in (-1, 1):
        cyl(r, P.black, 0.0035, 0.06, (-0.79, CY + 0.01, 0.01 * s), ROT_X, seg=5)
    # dorsal turret
    cyl(r, P.dark, 0.034, 0.012, (0.15, CY + 0.088, 0), seg=12)
    dome(r, P.glass, 0.03, (0.15, CY + 0.094, 0), seg=12, rings=4, h=0.022)
    for s in (-1, 1):
        cyl(r, P.black, 0.003, 0.07, (0.18, CY + 0.108, 0.008 * s), ROT_X, seg=4)

    # ---- bomb bay (dark well) + doors
    box(r, P.black, (0.34, 0.006, 0.1), (0.0, CY - 0.083, 0))
    for s in (-1, 1):
        bay = m.part('bayL' if s > 0 else 'bayR', at=(0.0, 0.045, 0.05 * s))
        box(bay, P.belly, (0.34, 0.008, 0.05), (0.0, 0.0, -0.025 * s), bevel=0.002)
    m.muzzle('m0', (0.0, 0.03, 0.0), part='root')
    m.muzzle('m1', (0.05, 0.03, 0.0), part='root')

    # ---- wings, nacelles, props
    for s in (-1, 1):
        outline = [(0.18, 0.06), (0.02, 0.9), (-0.08, 0.9), (-0.13, 0.06)]
        wing(r, P.top_flat, outline if s > 0 else [(x, -z) for (x, z) in reversed(outline)], CY - 0.01, 0.026, bevel=0.006)
        nz = 0.32 * s
        xloft(r, P.top, [(-0.22, CY - 0.008, 0.0, 0.0, 0.0), (-0.18, CY - 0.008, 0.03, 0.03, 0.032), (-0.05, CY - 0.008, 0.055, 0.052, 0.06),
                         (0.12, CY - 0.006, 0.056, 0.054, 0.06), (0.2, CY - 0.005, 0.045, 0.044, 0.046), (0.255, CY - 0.005, 0.036, 0.036, 0.036)],
              seg=14, at=(0, 0, nz), belly=P.belly, belly_ny=-0.45)
        cyl(r, P.dark, 0.04, 0.014, (0.255, CY - 0.005, nz), ROT_X, r2=0.034, seg=12)
        box(r, P.dark2, (0.08, 0.02, 0.04), (0.18, CY - 0.06, nz), bevel=0.006)  # oil cooler
        cyl(r, P.soot, 0.014, 0.004, (-0.215, CY - 0.008, nz), ROT_X, seg=8)
        m.smoke('exL' if s > 0 else 'exR', (-0.2, CY - 0.005, nz))
        pr = m.part('propL' if s > 0 else 'propR', at=(0.275, CY - 0.005, nz))
        lathe(pr, P.red, [(0.026, 0.0), (0.022, 0.025), (0.0, 0.05)], (0, 0, 0), seg=10, rot=(0, 0, -PI / 2))
        tail_blades(pr, P, 4, 0.2, 0.026, axis='x', t=0.008, phase=0.0 if s > 0 else PI / 4)
        # main gear under the nacelle
        bar(r, P.dark, (0.02, CY - 0.06, nz), (0.02, 0.03, nz), 0.014)
        wheel(r, P, (0.02, 0.03, nz + 0.014), 0.03, 0.02)
        wheel(r, P, (0.02, 0.03, nz - 0.014), 0.03, 0.02, hub=False)
        lamp(r, (-0.03, CY - 0.008, 0.902 * s), 0.013, GREEN if s > 0 else RED, 'steady', 3.6, '+z' if s > 0 else '-z')
        roundel(m, r, P, (-0.02, CY + 0.006, 0.64 * s), 0.16, depth=0.04)
        tail_number(m, r, '58', (0.3, CY + 0.02, 0.086 * s), 0.04, '+z' if s > 0 else '-z', color=0xe8b434)
        strip(m, r, (0.17, CY + 0.004, 0.09 * s), (0.02, CY + 0.004, 0.89 * s), '+y', 0.012)
    bar(r, P.dark, (0.45, CY - 0.07, 0), (0.45, 0.022, 0), 0.012)
    wheel(r, P, (0.45, 0.022, 0), 0.022, 0.016)

    # ---- tail: fin, stabilisers, lamps
    fin(r, P.top, [(-0.48, CY + 0.04), (-0.7, CY + 0.04), (-0.745, CY + 0.29), (-0.645, CY + 0.29)], 0.0, 0.02, bevel=0.005)
    wing(r, P.top_flat, [(-0.58, 0.04), (-0.68, 0.3), (-0.74, 0.3), (-0.72, 0.04), (-0.72, -0.04), (-0.74, -0.3), (-0.68, -0.3),
                         (-0.58, -0.04)], CY + 0.01, 0.014, bevel=0.004)
    for s in (-1, 1):
        side_star(m, r, P, (-0.66, CY + 0.17, 0.011 * s), 0.08, '+z' if s > 0 else '-z')
    lamp(r, (-0.75, CY + 0.29, 0), 0.009, WHITE_L, 'steady', 3.0, '-x')
    strobe(r, (-0.3, CY + 0.092, 0), 0.011)

    # ---- camouflage, spine walkway
    camo_top(m, r, (-0.05, CY + 0.06, 0), (1.3, 1.7), seed=13, n=16)
    strip(m, r, (-0.45, CY + 0.088, 0), (0.3, CY + 0.088, 0), '+y', 0.012, color=0x202326)
