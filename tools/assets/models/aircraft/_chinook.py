"""Chinook transport helicopter (tran), shared by tran_allies.py / tran_soviet.py: a long boxy fuselage with the
team-painted roof and a recognition mark on it, forward and aft rotor pylons (the aft one tall, with the two
engine pods on its flanks), fuel sponsons along the lower sides, round cabin windows, the open crew door, the
glazed cockpit, four-wheel gear, the rear cargo ramp (part 'ramp', lowered by the game when unloading; its inner
face is dark tread plate with hazard edges), tandem three-blade rotors 'rotorF' / 'rotorR' (counter-rotating in
the game), red / green side lamps, the red belly strobe, a landing light.
Pivots: node --import tsx tools/assets/rig.ts tran.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _ak import *  # noqa: E402,F401,F403


def build_tran(m, fac):
    m.set_meta(height=0.42, radius=0.55, keep=['fx:rotor'], snow=0.2)
    m.ground = False
    m.look(edge_light=0.08, ao_distance=0.2)
    r = m.root
    P = AirPal(fac)
    if fac == 'soviet':
        P.belly = painted(0x5c6440, panels=None, wear=0.55, rust=0.08, grime=0.4, streaks=0.35, rough=0.58, metal=0.2, var=0.12)
    W = 0.1  # half width

    # ---- fuselage: boxy cabin, rounded roof, nose; open rear (closed by the ramp)
    body = [
        (-0.47, 0.168, W, 0.092, 0.09, 4.2),
        (-0.3, 0.168, W, 0.094, 0.094, 4.2),
        (0.26, 0.168, W, 0.094, 0.094, 4.2),
        (0.37, 0.162, 0.096, 0.082, 0.09, 3.6),
        (0.43, 0.15, 0.082, 0.06, 0.078, 3.0),
        (0.465, 0.14, 0.055, 0.036, 0.055, 2.6),
        (0.478, 0.138, 0.0, 0.0, 0.0),
    ]
    xloft(r, P.top, body, seg=16, ex=4.0, belly=P.belly, belly_ny=-0.35)
    box(r, P.black, (0.004, 0.15, 0.17), (-0.468, 0.168, 0))  # cargo hold seen when the ramp is down
    # cockpit glazing (wraps the nose), eyebrow windows
    loft(r, P.glass, [(0.17, [(0.44, -0.07), (0.44, 0.07), (0.36, 0.096), (0.36, -0.096)]),
                      (0.232, [(0.39, -0.05), (0.39, 0.05), (0.34, 0.08), (0.34, -0.08)])])
    for s in (-1, 1):
        box(r, P.glass, (0.04, 0.03, 0.004), (0.375, 0.135, 0.099 * s))
    paint(m, r, (0.43, 0.165, 0), (0.05, 0.1), '+y', 0x1c1e21, depth=0.03)

    # ---- pylons: forward (short) and aft (tall, with the engines)
    prism(r, P.top, [(0.38, 0.25), (0.2, 0.25), (0.235, 0.3), (0.35, 0.3)], 0.1, (0, 0, 0), bevel=0.01)
    prism(r, P.top, [(-0.22, 0.25), (-0.47, 0.25), (-0.5, 0.385), (-0.35, 0.385)], 0.12, (0, 0, 0), bevel=0.012)
    box(r, P.dark2, (0.12, 0.03, 0.07), (-0.3, 0.27, 0), bevel=0.006)
    grille(m, r, (-0.3, 0.286, 0), (0.1, 0.05), facing='+y', n=6, thick=0.004)
    for s in (-1, 1):
        z = 0.128 * s
        xloft(r, P.dark2, [(-0.47, 0.285, 0.022, 0.024, 0.024), (-0.44, 0.285, 0.034, 0.034, 0.032), (-0.3, 0.285, 0.035, 0.035, 0.033),
                           (-0.26, 0.285, 0.026, 0.028, 0.026), (-0.255, 0.285, 0.0, 0.0, 0.0)], seg=12, at=(0, 0, z))
        cyl(r, P.black, 0.022, 0.005, (-0.257, 0.285, z), ROT_X, seg=10)
        cyl(r, P.soot, 0.02, 0.004, (-0.471, 0.285, z), ROT_X, seg=10)
        bar(r, P.dark, (-0.38, 0.27, 0.06 * s), (-0.38, 0.28, 0.105 * s), 0.016)
        # fuel sponsons
        xloft(r, P.belly, [(-0.33, 0.1, 0.0, 0.0, 0.0), (-0.29, 0.1, 0.022, 0.036, 0.03), (0.13, 0.1, 0.024, 0.038, 0.03),
                           (0.2, 0.1, 0.0, 0.0, 0.0)], seg=10, ex=3.0, at=(0, 0, (W + 0.02) * s))
        # cabin windows (dark round panes) and the crew door
        for i in range(6):
            m.decal(disc_image(ring=0x101214, ring_w=0.18), at=(0.17 - i * 0.085, 0.2, (W + 0.002) * s), size=(0.028, 0.028),
                    facing='+z' if s > 0 else '-z', part=r, depth=0.02, team=0, tint=D.lin(0x5a6e80), rough=0.1)
        box(r, P.black, (0.06, 0.09, 0.004), (0.27, 0.15, (W + 0.001) * s))
        # gear
        bar(r, P.dark, (0.25, 0.09, W * s), (0.25, 0.024, (W + 0.018) * s), 0.012)
        wheel(r, P, (0.25, 0.024, (W + 0.022) * s), 0.024, 0.02)
        bar(r, P.dark, (-0.24, 0.09, (W + 0.04) * s), (-0.24, 0.024, (W + 0.05) * s), 0.012)
        wheel(r, P, (-0.24, 0.024, (W + 0.058) * s), 0.024, 0.02)
        # lamps
        lamp(r, (0.0, 0.11, (W + 0.046) * s), 0.012, GREEN if s > 0 else RED, 'steady', 3.6, '+z' if s > 0 else '-z')
    strobe(r, (0.05, 0.074, 0), 0.01)
    landing_light(r, (0.42, 0.088, 0.03), 0.009)
    lamp(r, (-0.505, 0.38, 0), 0.008, WHITE_L, 'steady', 3.0, '-x')

    # ---- roof paint: recognition mark, walkway, camouflage (Soviet), number
    if fac == 'soviet':
        camo_top(m, r, (0.0, 0.27, 0), (0.95, 0.22), seed=11, n=12)
    roundel(m, r, P, (-0.06, 0.262, 0), 0.13, depth=0.05)
    for s in (-1, 1):
        strip(m, r, (-0.16, 0.262, 0.074 * s), (0.18, 0.262, 0.074 * s), '+y', 0.01, color=0x202326)
        side_star(m, r, P, (-0.2, 0.18, (W + 0.002) * s), 0.07, '+z' if s > 0 else '-z')
        tail_number(m, r, '51' if fac == 'allies' else '35', (0.3, 0.215, (W + 0.002) * s), 0.034, '+z' if s > 0 else '-z',
                    color=0xe8e4da if fac == 'allies' else 0xe8b434)
        strip(m, r, (-0.45, 0.255, 0.06 * s), (-0.3, 0.255, 0.06 * s), '+y', 0.008)

    # ---- rear cargo ramp (hinged at the bottom of the tail)
    rp = m.part('ramp', at=(-0.48, 0.085, 0))
    box(rp, P.belly, (0.012, 0.15, 2 * W - 0.012), (-0.004, 0.075, 0), bevel=0.003)
    box(rp, tread(0x3a3d42), (0.004, 0.14, 2 * W - 0.03), (0.004, 0.075, 0))
    hazard_stripes(m, rp, (0.007, 0.145, 0), (0.16, 0.012), facing='+x')

    # ---- tandem rotors (three blades each, counter-rotating in the game)
    for name, x, y in (('rotorF', 0.3, 0.305), ('rotorR', -0.43, 0.385)):
        cyl(r, P.gun, 0.024, 0.03, (x, y - 0.012, 0), seg=10)
        rot = m.part(name, at=(x, y, 0.0))
        rotor_hub(rot, P, 0.036)
        blades(rot, P, 3, 0.38, 0.04, 0.036, droop=0.03, y=0.012, phase=0.0 if name == 'rotorF' else PI / 3)
