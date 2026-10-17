"""Allied attack helicopter (heli, AH-64D Apache Longbow), dressed for the RTS camera: team-painted upper fuselage
over a dark gunmetal belly line, flat-panel tandem canopy (gunner low in front, pilot behind and higher), avionics
sponsons, engine nacelles high on the sides with intakes and black-hole IR exhausts, the tail boom with fin and
stabilator, stub wings with Hellfire racks outboard and Hydra pods inboard, the chin 30 mm cannon under the TADS
nose turret, white star roundels on the wing tops and the engine deck, red / green wingtip lamps, a white strobe on
the fin, a landing light. Parts: 'rotor' (4 blades with yellow tips, Longbow radar dome) and 'trotor' (scissor
tail rotor) spin in the game. Pivots match the procedural rig (node --import tsx tools/assets/rig.ts heli).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _ak import *  # noqa: E402,F401,F403

ID = 'heli'
FACTION = 'allies'
KIND = 'aircraft'


def build(m):
    m.set_meta(height=0.36, radius=0.45, keep=['fx:rotor'], snow=0.2)
    m.ground = False
    m.look(edge_light=0.08, ao_distance=0.16)
    r = m.root
    P = AirPal('allies')

    # ---- fuselage: narrow keel, engine bay, tail boom (boxy sections)
    body = [
        (-0.575, 0.15, 0.0, 0.0, 0.0),
        (-0.55, 0.15, 0.015, 0.018, 0.016),
        (-0.4, 0.148, 0.022, 0.026, 0.024),
        (-0.24, 0.142, 0.036, 0.045, 0.04),
        (-0.17, 0.136, 0.054, 0.07, 0.064),
        (0.04, 0.132, 0.058, 0.078, 0.074),
        (0.17, 0.118, 0.054, 0.05, 0.062),
        (0.3, 0.104, 0.046, 0.036, 0.05),
        (0.36, 0.1, 0.034, 0.026, 0.038),
        (0.378, 0.1, 0.0, 0.0, 0.0),
    ]
    xloft(r, P.top, body, seg=16, ex=3.2, belly=P.belly, belly_ny=-0.45)

    # flat-panel tandem canopy: gunner (front, low) and pilot (higher), dark frames between
    loft(r, P.glass, [(0.12, [(0.31, -0.044), (0.31, 0.044), (0.2, 0.048), (0.2, -0.048)]),
                      (0.172, [(0.255, -0.03), (0.255, 0.03), (0.2, 0.036), (0.2, -0.036)])])
    loft(r, P.glass, [(0.15, [(0.18, -0.048), (0.18, 0.048), (0.05, 0.05), (0.05, -0.05)]),
                      (0.218, [(0.125, -0.034), (0.125, 0.034), (0.055, 0.036), (0.055, -0.036)])])
    box(r, P.dark, (0.012, 0.07, 0.1), (0.192, 0.165, 0), bevel=0.003)
    box(r, P.dark, (0.008, 0.07, 0.102), (0.052, 0.185, 0), bevel=0.003)
    paint(m, r, (0.325, 0.13, 0), (0.05, 0.07), '+y', 0x1c1e21, depth=0.03)  # anti-glare nose

    # ---- avionics sponsons along the lower sides
    for s in (-1, 1):
        xloft(r, P.top, [(-0.15, 0.1, 0.0, 0.0, 0.0), (-0.12, 0.1, 0.02, 0.028, 0.026), (0.16, 0.1, 0.022, 0.03, 0.028),
                         (0.22, 0.1, 0.0, 0.0, 0.0)], seg=10, ex=3.0, at=(0, 0, 0.066 * s), belly=P.belly, belly_ny=-0.45)
    # ---- engine nacelles high on the sides, intakes, black-hole exhausts
    for s in (-1, 1):
        z = 0.083 * s
        xloft(r, P.top, [(-0.145, 0.175, 0.03, 0.03, 0.03), (0.0, 0.175, 0.035, 0.035, 0.034), (0.06, 0.175, 0.033, 0.033, 0.032),
                         (0.065, 0.175, 0.0, 0.0, 0.0)], seg=12, at=(0, 0, z), belly=P.belly, belly_ny=-0.6)
        cyl(r, P.black, 0.026, 0.006, (0.064, 0.175, z), ROT_X, seg=10)
        box(r, P.dark, (0.06, 0.045, 0.034), (-0.168, 0.18, 0.088 * s), bevel=0.008)
        box(r, P.soot, (0.004, 0.022, 0.022), (-0.199, 0.18, 0.088 * s))
        m.point(f'ex{0 if s < 0 else 1}', (-0.2, 0.18, 0.088 * s))
        # engine deck vent (top), walkway line
        vent(m, r, (-0.04, 0.21, z), (0.1, 0.04), facing='+y', slats=6, thick=0.004)

    # ---- tail: fin, stabilator, tail wheel, tail rotor gearbox
    fin(r, P.top, [(-0.47, 0.14), (-0.535, 0.14), (-0.57, 0.31), (-0.53, 0.31)], 0.0, 0.016, bevel=0.003)
    wing(r, P.top_flat, [(-0.505, 0.0), (-0.52, 0.11), (-0.565, 0.11), (-0.56, 0.0)], 0.155, 0.009)
    wing(r, P.top_flat, [(-0.505, 0.0), (-0.52, 0.11), (-0.565, 0.11), (-0.56, 0.0)], 0.155, 0.009, z_mirror=True)
    bar(r, P.dark, (-0.46, 0.125, 0), (-0.47, 0.035, 0), 0.01)
    wheel(r, P, (-0.47, 0.022, 0), 0.016, 0.012)
    cyl(r, P.gun, 0.013, 0.02, (-0.535, 0.24, 0.008), ROT_Z, seg=8)
    strobe(r, (-0.565, 0.318, 0), 0.009, WHITE_L)
    lamp(r, (-0.578, 0.16, 0), 0.008, WHITE_L, 'steady', 3.0, '-x')

    # ---- stub wings: Hellfire racks outboard, Hydra pods inboard
    for s in (-1, 1):
        box(r, P.top_flat, (0.09, 0.012, 0.18), (0.0, 0.122, 0.14 * s), (0.08 * s, 0, 0), bevel=0.004)
        box(r, P.dark, (0.03, 0.022, 0.01), (0.0, 0.105, 0.12 * s), bevel=0.002)
        rocket_pod(r, P, (0.01, 0.088, 0.12 * s), 0.022, 0.09)
        box(r, P.dark, (0.1, 0.012, 0.03), (0.01, 0.106, 0.198 * s), bevel=0.002)
        for dy in (-0.014, 0.012):
            for dz in (-0.011, 0.011):
                missile(r, P, (0.012, 0.093 + dy, 0.198 * s + dz), 0.0075, 0.085)
        lamp(r, (0.0, 0.128, 0.232 * s), 0.012, GREEN if s > 0 else RED, 'steady', 3.6, '+z' if s > 0 else '-z')
        roundel(m, r, P, (0.0, 0.135, 0.15 * s), 0.08, depth=0.04)
        tail_number(m, r, '07', (0.2, 0.1, 0.057 * s), 0.028, '+z' if s > 0 else '-z')
        side_star(m, r, P, (-0.36, 0.148, 0.024 * s), 0.04, '+z' if s > 0 else '-z')
        # main gear
        bar(r, P.dark, (0.15, 0.075, 0.055 * s), (0.13, 0.024, 0.068 * s), 0.011)
        bar(r, P.dark, (0.1, 0.07, 0.05 * s), (0.13, 0.03, 0.066 * s), 0.008)
        wheel(r, P, (0.13, 0.022, 0.072 * s), 0.022, 0.018)
    m.muzzle('m0', (0.08, 0.09, -0.155), part='root')
    m.muzzle('m1', (0.08, 0.09, 0.155), part='root')
    roundel(m, r, P, (-0.075, 0.21, 0), 0.075, depth=0.05)

    # ---- chin cannon and the TADS nose turret
    sphere(r, P.gun, 0.022, (0.24, 0.048, 0), seg=10, rings=6)
    cyl(r, P.black, 0.0055, 0.1, (0.3, 0.042, 0), ROT_X, seg=6)
    sphere(r, P.dark, 0.03, (0.36, 0.098, 0), seg=10, rings=6, scale=(0.9, 1.0, 1.0))
    for s in (-1, 1):
        cyl(r, P.glass, 0.011, 0.004, (0.386, 0.098, 0.012 * s), ROT_X, seg=8)
    landing_light(r, (0.33, 0.065, 0.02), 0.008)

    # ---- top paint: walkway lines, wing leading-edge highlights
    strip(m, r, (-0.15, 0.209, 0.0), (0.02, 0.209, 0.0), '+y', 0.01, color=0x202326)
    for s in (-1, 1):
        strip(m, r, (0.043, 0.13, 0.06 * s), (0.043, 0.135, 0.225 * s), '+y', 0.01)

    # ---- mast, rotor (with the Longbow radar dome) and scissor tail rotor
    cyl(r, P.gun, 0.02, 0.06, (0.02, 0.24, 0), r2=0.016, seg=10)
    rot = m.part('rotor', at=(0.02, 0.272, 0.0))
    rotor_hub(rot, P, 0.04, cap=False)
    blades(rot, P, 4, 0.47, 0.04, 0.04, droop=0.03, y=0.012)
    cyl(rot, P.gun, 0.012, 0.03, (0, 0.045, 0), seg=8)
    sphere(rot, P.white, 0.04, (0, 0.075, 0), seg=12, rings=6, scale=(1.0, 0.62, 1.0))
    tr = m.part('trotor', at=(-0.535, 0.24, 0.022))
    cyl(tr, P.gun, 0.01, 0.014, (0, 0, 0.002), ROT_Z, seg=8)
    tail_blades(tr, P, 2, 0.065, 0.016, axis='z')
    tail_blades(tr, P, 2, 0.065, 0.016, axis='z', phase=0.6)
