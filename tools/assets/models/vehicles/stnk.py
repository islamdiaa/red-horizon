"""Allied phase transport (stnk): faceted team-painted APC with dark camouflage and dark side armour, five road
wheels a side, rear doors, four phase-emitter pylons and a glazed dome projector ('glow:phase', flicker faster
while phased), a small missile turret (part 'turret', launcher 'b0', muzzles m0 / m1). The procedural phase
shimmer shell ('fx', owner-only cloak) is kept. Pivots: node --import tsx tools/assets/rig.ts stnk.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = 'stnk'
FACTION = 'allies'
KIND = 'vehicle'
PURPLE = 0xb07aff


def build(m):
    m.set_meta(height=0.4, radius=0.42, snow=0.3, keep=['fx:add:9a7aff:0.4'])
    r = m.root
    P = Pal('allies')
    glow_p = glow_material('glow:phase', PURPLE)

    L, H, W, Z = 0.74, 0.125, 0.11, 0.205
    running_gear(m, r, P, L, H, W, Z, 5, wheel_k=0.4, rollers=0)
    box(r, P.dark, (0.68, 0.06, 0.3), (0, 0.08, 0), bevel=0.008)
    hull = [(-0.382, 0.092), (0.31, 0.092), (0.402, 0.142), (0.302, 0.237), (0.122, 0.272), (-0.342, 0.272), (-0.392, 0.222)]
    side_prism(r, P.hull, hull, 0.38, bevel=0.018)
    hull_shade(m, r, -0.4, 0.4, 0.272, 0.19, side_y=(0.1, 0.27), fenders=(0.76, 0.136, Z, 0.12, 0.0), deck=False)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        fender(r, P.hull_flat, 0.76, 0.12, 0.13, Z * s, front=0.05, rear=0.04)
        prism(r, P.dark2, [(-0.362, 0.1), (0.3, 0.1), (0.362, 0.162), (-0.372, 0.182)], 0.022, (0, 0, 0.2 * s), bevel=0.005)
        camo(m, r, (-0.02, 0.21, 0.191 * s), (0.55, 0.06), f, seed=92 + s, n=2, colors=(0x6a6a6a,))
        rivet_row(m, r, (-0.3, 0.15, 0.2115 * s), (0.25, 0.15, 0.2115 * s), facing=f, spacing=0.035, size=0.01)
        number(m, r, '5', (-0.15, 0.2, 0.191 * s), 0.045, f)
        headlight(r, (0.385, 0.172, 0.12 * s), 0.015, guard=P.black)
        marker(r, (-0.398, 0.225, 0.14 * s), 0.011)
    top_star(m, r, 'allies', (-0.21, 0.273, 0.0), 0.12)
    deck_strips(m, r, -0.342, 0.122, 0.272, 0.19, width=0.016)
    fender_strips(m, r, 0.76, 0.26, 0.136, width=0.014)
    top_lamps(r, 0.0, -0.33, 0.272, 0.172, front=None)
    # rear doors
    box(r, P.dark2, (0.014, 0.135, 0.27), (-0.392, 0.17, 0), bevel=0.004)
    box(r, P.black, (0.016, 0.12, 0.005), (-0.394, 0.17, 0))
    tow_hooks(r, P, 0.41, 0.11, 0.1, 1)
    whip(r, P, (-0.34, 0.272, 0.12), 0.2, pennant=True)
    # phase emitter pylons + domed projector
    for (x, z) in ((0.18, 0.15), (0.18, -0.15), (-0.3, 0.15), (-0.3, -0.15)):
        cyl(r, P.gun, 0.014, 0.075, (x, 0.3, z), r2=0.011, seg=8)
        cyl(r, P.steel, 0.022, 0.012, (x, 0.333, z), seg=10)
        sphere(r, glow_p, 0.016, (x, 0.348, z), seg=8, rings=5)
    cyl(r, P.gun, 0.07, 0.016, (-0.08, 0.278, 0), seg=14)
    dome(r, glass(0x3a4a66), 0.062, (-0.08, 0.284, 0), seg=14, rings=4)
    sphere(r, glow_p, 0.026, (-0.08, 0.3, 0), seg=4, rings=2)

    # ---- small missile turret
    t = m.part('turret', at=(0.12, 0.27, 0))
    cyl(t, P.dark2, 0.062, 0.034, (0, 0.017, 0), r2=0.056, seg=12, bevel=0.004)
    b = m.part('b0', parent='turret', at=(0.0, 0.05, 0))
    box(b, P.hull_flat, (0.14, 0.05, 0.084), (0.03, 0, 0), bevel=0.012)
    box(b, P.dark, (0.008, 0.038, 0.068), (0.101, 0, 0))
    edge_strip(m, b, (-0.035, 0.025, -0.036), (0.095, 0.025, -0.036), '+y', 0.012)
    edge_strip(m, b, (-0.035, 0.025, 0.036), (0.095, 0.025, 0.036), '+y', 0.012)
    red = painted(0xb02418, panels=None, wear=0.4, rust=0.05, rough=0.45)
    for z in (-0.016, 0.016):
        cyl(b, red, 0.012, 0.012, (0.107, 0, z), ROT_X, seg=6, r2=0.005)
    box(t, P.gun, (0.02, 0.03, 0.03), (-0.01, 0.035, 0))
    m.muzzle('m0', (0.1, 0.05, -0.016))
    m.muzzle('m1', (0.1, 0.05, 0.016))
