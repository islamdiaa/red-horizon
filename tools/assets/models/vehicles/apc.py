"""Allied APC (apc, M113 style): boxy team-painted aluminium hull with dark camouflage, dark lower hull and
running gear, trim vane on the glacis, big cargo hatch, rear ramp door, side stowage, commander's .50 cal
behind a gun shield on a ring mount (part 'mg' with the gun 'b0', muzzle 'm0').
Pivots: node --import tsx tools/assets/rig.ts apc.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = 'apc'
FACTION = 'allies'
KIND = 'vehicle'


def build(m):
    m.set_meta(height=0.34, radius=0.38, snow=0.3)
    r = m.root
    P = Pal('allies')

    L, H, W, Z = 0.7, 0.125, 0.11, 0.2
    running_gear(m, r, P, L, H, W, Z, 5, wheel_k=0.4, rollers=0)
    box(r, P.dark, (0.64, 0.06, 0.3), (0, 0.08, 0), bevel=0.008)
    for s in (-1, 1):
        fender(r, P.hull_flat, 0.72, 0.125, 0.128, Z * s, front=0.05, rear=0.04)
    hull = [(-0.362, 0.092), (0.3, 0.092), (0.38, 0.152), (0.272, 0.27), (-0.358, 0.27)]
    side_prism(r, P.hull, hull, 0.37, bevel=0.018)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        camo(m, r, (-0.03, 0.2, 0.186 * s), (0.62, 0.13), f, seed=61 + s, n=4)
        emblem(m, r, 'allied_star', (-0.17, 0.2, 0.1865 * s), 0.065, facing=f)
        number(m, r, '33', (0.12, 0.2, 0.1865 * s), 0.04, f)
        rivet_row(m, r, (-0.33, 0.255, 0.186 * s), (0.24, 0.255, 0.186 * s), facing=f, spacing=0.035, size=0.011)
        # side stowage: long bin and a tarp roll
        crate(r, P.dark2, (0.16, 0.04, 0.032), (-0.12, 0.205, 0.202 * s), strap=P.black, bevel=0.005)
    camo(m, r, (-0.05, 0.271, 0.0), (0.56, 0.34), '+y', seed=63, n=5)
    deck_strips(m, r, -0.358, 0.272, 0.27, 0.185)
    edge_strip(m, r, (0.377, 0.153, -0.17), (0.377, 0.153, 0.17), '+x', 0.012)
    fender_strips(m, r, 0.72, 0.2625, 0.134)
    # glacis trim vane, driver's hatch, engine grille, cargo hatch with a star
    box(r, P.dark2, (0.014, 0.1, 0.31), (0.338, 0.205, 0), (0, 0, 0.83), bevel=0.004)
    for z in (-0.12, 0.12):
        bar(r, P.black, (0.315, 0.235, z), (0.36, 0.21, z), 0.008)
    hatch_round(r, P.dark2, 0.034, (0.08, 0.27, 0.09))
    grille(m, r, (0.17, 0.271, 0.1), (0.08, 0.12), facing='+y', n=4)
    box(r, P.dark2, (0.23, 0.014, 0.21), (-0.17, 0.276, 0), bevel=0.006)
    emblem(m, r, 'allied_star', (-0.17, 0.284, 0.0), 0.11, facing='+y')
    bedroll(r, P, 0.18, 0.02, (-0.17, 0.297, -0.135), axis='x', mat=P.tan)
    # rear: ramp door, tail lights, jerry cans, tow hooks
    box(r, P.dark2, (0.014, 0.155, 0.3), (-0.362, 0.178, 0), bevel=0.004)
    box(r, P.black, (0.006, 0.11, 0.075), (-0.37, 0.18, 0.06), bevel=0.002)
    jerry_rack(r, P, 2, -0.385, 0.16, -0.085, yaw=PI / 2)
    tail_lights(r, -0.37, 0.235, 0.15)
    for s in (-1, 1):
        headlight(r, (0.358, 0.19, 0.13 * s), 0.017, guard=P.black)
        marker(r, (0.27, 0.272, 0.17 * s), 0.008, AMBER, '+y', strength=2.4)
    tow_hooks(r, P, 0.38, 0.11, 0.1, 1)
    whip(r, P, (-0.33, 0.27, 0.16), 0.24, pennant=True)
    whip(r, P, (-0.33, 0.27, -0.16), 0.18)

    # ---- commander's MG: ring mount, wrap-around shield, .50 cal (b0), muzzle
    g = m.part('mg', at=(0.05, 0.265, -0.07))
    cyl(g, P.gun, 0.038, 0.026, (0, 0.013, 0), seg=12, bevel=0.004)
    box(g, P.dark2, (0.012, 0.064, 0.105), (0.052, 0.052, 0), bevel=0.003)
    for s in (-1, 1):
        box(g, P.dark2, (0.055, 0.054, 0.012), (0.03, 0.048, 0.054 * s), (0, -s * 0.5, 0), bevel=0.003)
    box(g, P.gun, (0.08, 0.026, 0.026), (0.01, 0.046, 0), bevel=0.005)
    box(g, P.jerry, (0.03, 0.022, 0.02), (0.0, 0.035, 0.03))
    # gunner (helmet + shoulders) behind the shield
    box(g, P.canvas, (0.045, 0.05, 0.065), (-0.035, 0.05, 0), bevel=0.008)
    sphere(g, P.dark2, 0.022, (-0.03, 0.095, 0), seg=8, rings=5)
    b = m.part('b0', parent='mg', at=(0.05, 0.045, 0))
    cyl(b, P.black, 0.006, 0.13, (0.065, 0, 0), ROT_X, seg=6)
    cyl(b, P.black, 0.0095, 0.05, (0.03, 0, 0), ROT_X, seg=8)
    m.muzzle('m0', (0.18, 0.045, 0), part='mg')
