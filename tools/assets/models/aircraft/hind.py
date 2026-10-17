"""Soviet assault helicopter (hind, Mi-24 'Hind'), dressed for the RTS camera: team-painted upper fuselage with
darker team-shade camouflage over a pale blue-grey belly, stepped double-bubble canopies (gunner low in front,
pilot behind), twin engines on top with dust-filter intakes and outward-bent exhausts, the long tapering tail
boom with fin and stabilisers, anhedral stub wings with UB-32 rocket pods and wingtip missile rails, the chin
gatling turret with its sensor pod, gold stars on team discs on the wing tops, red / green wingtip lamps, a red
strobe, a landing light. Parts: 'rotor' (5 drooped blades, yellow tips) and 'trotor' (3 blades) spin in the game.
Pivots match the procedural rig (node --import tsx tools/assets/rig.ts hind).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _ak import *  # noqa: E402,F401,F403

ID = 'hind'
FACTION = 'soviet'
KIND = 'aircraft'


def build(m):
    m.set_meta(height=0.4, radius=0.52, keep=['fx:rotor'], snow=0.2)
    m.ground = False
    m.look(edge_light=0.08, ao_distance=0.18)
    r = m.root
    P = AirPal('soviet')

    # ---- fuselage: nose / gunner section, pilot step, cabin, engine deck, tapering tail boom
    body = [
        (-0.70, 0.195, 0.0, 0.0, 0.0),
        (-0.66, 0.195, 0.019, 0.02, 0.02),
        (-0.52, 0.19, 0.026, 0.027, 0.026),
        (-0.36, 0.182, 0.038, 0.042, 0.04),
        (-0.27, 0.168, 0.062, 0.07, 0.062),
        (-0.18, 0.152, 0.086, 0.098, 0.092),
        (0.0, 0.15, 0.09, 0.1, 0.1),
        (0.14, 0.142, 0.088, 0.085, 0.094),
        (0.22, 0.118, 0.074, 0.05, 0.072),
        (0.33, 0.1, 0.062, 0.04, 0.054),
        (0.42, 0.092, 0.046, 0.032, 0.042),
        (0.465, 0.088, 0.024, 0.018, 0.022),
        (0.48, 0.088, 0.0, 0.0, 0.0),
    ]
    xloft(r, P.top, body, seg=16, ex=2.5, belly=P.belly, belly_ny=-0.42)

    # stepped bubble canopies (dark glass) with frame rings
    sphere(r, P.glass, 0.05, (0.355, 0.125, 0), seg=12, rings=7, scale=(1.35, 0.85, 0.92))
    sphere(r, P.glass, 0.058, (0.215, 0.17, 0), seg=12, rings=7, scale=(1.3, 0.85, 0.9))
    # anti-glare panel ahead of the pilot, nose blister
    paint(m, r, (0.27, 0.165, 0), (0.06, 0.1), '+y', 0x1d1f22, depth=0.04)

    # ---- engine deck: two nacelles, gearbox hump, intakes, exhausts
    for s in (-1, 1):
        z = 0.058 * s
        xloft(r, P.top, [(-0.2, 0.248, 0.0, 0.0, 0.0), (-0.17, 0.248, 0.034, 0.034, 0.03), (0.08, 0.252, 0.043, 0.042, 0.035),
                         (0.13, 0.252, 0.042, 0.04, 0.034), (0.135, 0.252, 0.0, 0.0, 0.0)], seg=12, at=(0, 0, z))
        box(r, P.dark2, (0.055, 0.06, 0.06), (0.135, 0.252, z), bevel=0.01)  # dust filter box
        cyl(r, P.black, 0.022, 0.004, (0.164, 0.252, z), ROT_X, seg=10)
        vent(m, r, (0.135, 0.283, z), (0.045, 0.045), facing='+y', slats=4, thick=0.004)
        # exhaust: outward-bent pipe and soot
        a = (-0.17, 0.244, 0.062 * s)
        b = (-0.225, 0.232, 0.092 * s)
        cyl_between(r, P.exhaust, a, b, 0.026, seg=10)
        cyl_between(r, P.soot, b, (b[0] - 0.003, b[1] - 0.001, b[2] + 0.004 * s), 0.021, seg=10)
        m.point(f'ex{0 if s < 0 else 1}', (-0.228, 0.231, 0.094 * s))
    xloft(r, P.top, [(-0.12, 0.27, 0.0, 0.0, 0.0), (-0.09, 0.27, 0.03, 0.022, 0.02), (0.06, 0.27, 0.034, 0.03, 0.02),
                     (0.1, 0.268, 0.0, 0.0, 0.0)], seg=10)
    cyl(r, P.gun, 0.024, 0.05, (0.0, 0.3, 0), r2=0.02, seg=10)
    strobe(r, (-0.075, 0.302, 0), 0.01)

    # ---- tail: fin (leaning), stabilisers, tail rotor gearbox
    fin(r, P.top, [(-0.6, 0.18), (-0.665, 0.17), (-0.725, 0.345), (-0.67, 0.345), (-0.64, 0.24)], 0.0, 0.02, bevel=0.004)
    wing(r, P.top_flat, [(-0.545, 0.0), (-0.565, 0.115), (-0.62, 0.115), (-0.615, 0.0)], 0.19, 0.01)
    wing(r, P.top_flat, [(-0.545, 0.0), (-0.565, 0.115), (-0.62, 0.115), (-0.615, 0.0)], 0.19, 0.01, z_mirror=True)
    cyl(r, P.gun, 0.016, 0.03, (-0.68, 0.28, -0.012), ROT_Z, seg=8)
    lamp(r, (-0.705, 0.25, 0), 0.008, WHITE_L, 'steady', 3.0, '-x')

    # ---- stub wings (anhedral), pylons, rocket pods, wingtip missile rails
    for s in (-1, 1):
        sw = s * 0.18
        box(r, P.top_flat, (0.12, 0.014, 0.2), (0.0, 0.128, sw), (-0.18 * s, 0, 0), bevel=0.004)
        for zz in (0.14, 0.22):
            y = 0.1 - (zz - 0.14) * 0.18
            box(r, P.dark, (0.04, 0.026, 0.012), (0.0, y + 0.028, zz * s), bevel=0.003)
            rocket_pod(r, P, (0.0, y, zz * s), 0.026, 0.11)
        box(r, P.dark, (0.05, 0.06, 0.012), (0.0, 0.1, 0.285 * s), bevel=0.003)
        for dz in (-0.014, 0.014):
            missile(r, P, (0.012, 0.072, 0.285 * s + dz), 0.009, 0.11, body=P.olive)
        lamp(r, (0.0, 0.132, 0.292 * s), 0.012, GREEN if s > 0 else RED, 'steady', 3.6, '+z' if s > 0 else '-z')
        # gold star on a team disc, on top of each wing, and a red star on the boom
        roundel(m, r, P, (0.0, 0.15, 0.2 * s), 0.1, depth=0.04)
        side_star(m, r, P, (-0.44, 0.185, 0.034 * s), 0.055, '+z' if s > 0 else '-z')
        tail_number(m, r, '24', (0.31, 0.1, 0.06 * s), 0.03, '+z' if s > 0 else '-z', color=0xe8b434)
        # main gear: strut, axle, wheel
        bar(r, P.dark, (-0.02, 0.07, 0.07 * s), (-0.02, 0.025, 0.1 * s), 0.012)
        wheel(r, P, (-0.02, 0.025, 0.105 * s), 0.025, 0.02)
    m.muzzle('m1', (0.07, 0.1, 0.19), part='root')
    # nose gear
    bar(r, P.dark, (0.28, 0.06, 0), (0.28, 0.02, 0), 0.01)
    wheel(r, P, (0.28, 0.02, 0), 0.02, 0.016)

    # ---- chin gatling turret and sensor pod
    sphere(r, P.gun, 0.03, (0.385, 0.05, 0), seg=10, rings=6)
    for k in range(4):
        a = k * PI / 2
        cyl(r, P.black, 0.0035, 0.06, (0.435, 0.045 + math.sin(a) * 0.007, math.cos(a) * 0.007), ROT_X, seg=5)
    cyl(r, P.dark, 0.012, 0.008, (0.462, 0.045, 0), ROT_X, seg=8)
    m.muzzle('m0', (0.47, 0.045, 0), part='root')
    box(r, P.dark, (0.04, 0.026, 0.026), (0.37, 0.058, -0.052), bevel=0.006)
    cyl(r, P.glass, 0.009, 0.004, (0.391, 0.058, -0.052), ROT_X, seg=8)
    landing_light(r, (0.4, 0.05, 0.035), 0.009)

    # ---- camouflage and paint on the top
    camo_top(m, r, (-0.12, 0.25, 0), (0.78, 0.22), seed=7, n=12)
    strip(m, r, (-0.16, 0.25, 0.0), (0.12, 0.25, 0.0), '+y', 0.012, color=0x202326)  # walkway between the engines
    strip(m, r, (-0.06, 0.137, 0.09), (0.06, 0.142, 0.27), '+y', 0.012)            # wing leading edges
    strip(m, r, (-0.06, 0.137, -0.09), (0.06, 0.142, -0.27), '+y', 0.012)

    # ---- rotors
    rot = m.part('rotor', at=(0.0, 0.325, 0.0))
    rotor_hub(rot, P, 0.045)
    blades(rot, P, 5, 0.53, 0.044, 0.045, droop=0.03, y=0.012)
    tr = m.part('trotor', at=(-0.68, 0.28, -0.024))
    cyl(tr, P.gun, 0.013, 0.016, (0, 0, -0.004), ROT_Z, seg=8)
    tail_blades(tr, P, 3, 0.13, 0.02, axis='z')
