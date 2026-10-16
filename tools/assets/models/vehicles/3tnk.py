"""Soviet heavy tank (3tnk, T-55 style; taken over from PIPE's hero model, tools/assets/models/soviet/3tnk.py),
dressed for the RTS camera: light olive deck over darker olive sides, team-red glacis, red front fender caps and
a red engine-deck band carrying the gold hull number, a 10% larger cast dome turret (part 'turret') with a thick
red roof ring and the gold star on a red disc, twin guns 'b0' / 'b1' (recoil along -X, thickened), muzzles m0 /
m1, five road wheels a side on scrolling tracks, fender fuel drums and stowage, lamps, exhaust smoke point.
Pivots match the procedural rig (node --import tsx tools/assets/rig.ts 3tnk).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = '3tnk'
FACTION = 'soviet'
KIND = 'vehicle'


def build(m):
    m.set_meta(height=0.37, radius=0.46, snow=0.3)
    r = m.root
    P = Pal('soviet')

    # ---- running gear: tracks, five big road wheels, sprocket, idler, return rollers
    L, H, W, Z = 0.9, 0.16, 0.14, 0.235
    running_gear(m, r, P, L, H, W, Z, 5, wheel_k=0.41, rollers=2)

    # ---- hull: belly, welded upper hull (side profile across), team glacis, deck
    box(r, P.dark, (0.82, 0.08, 0.34), (0, 0.1, 0), bevel=0.01)
    hull = [(-0.46, 0.12), (0.36, 0.12), (0.49, 0.168), (0.34, 0.242), (-0.43, 0.248), (-0.475, 0.205)]
    side_prism(r, P.hull, hull, 0.42, bevel=0.017)
    slope_plate(r, P.trim, (0.49, 0.168), (0.34, 0.242), 0.36, t=0.012, inset=0.88)
    rivet_row(m, r, (0.452, 0.19, -0.15), (0.452, 0.19, 0.15), facing='+y', spacing=0.032, size=0.012)
    for s in (-1, 1):
        fender(r, P.hull_flat, 0.94, 0.165, 0.166, Z * s, front=0.08, rear=0.06, t=0.012)
        box(r, P.trim_flat, (0.76, 0.08, 0.012), (-0.02, 0.126, (Z + 0.084) * s), bevel=0.003)
        for x in (-0.3, 0.0, 0.3):
            bar(r, P.black, (x, 0.165, (Z + 0.084) * s), (x, 0.1, (Z + 0.084) * s), 0.008)
    # paint: light deck, dark sides, red fender caps and engine-deck band with the gold number
    sov_hull(m, r, -0.43, 0.34, 0.246, 0.21, side_y=(0.13, 0.24), side_z=0.21)
    paint(m, r, (0.0, 0.172, Z), (0.92, 0.165), '+y', OLIVE_DECK, depth=0.008)
    paint(m, r, (0.0, 0.172, -Z), (0.92, 0.165), '+y', OLIVE_DECK, depth=0.008)
    fender_caps(m, r, 0.47, 0.2, 0.172, Z, 0.165)
    red(m, r, (-0.375, 0.247, 0.0), (0.11, 0.42), '+y')
    deck_number(m, r, 'Т-305', (-0.375, 0.248, 0.0), 0.075)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        stencil(m, r, '305', (-0.2, 0.135, (Z + 0.091) * s), 0.045, facing=f, color=0xe8e4da)
    deck_strips(m, r, -0.43, 0.34, 0.247, 0.21, width=0.016)
    edge_strip(m, r, (0.487, 0.169, -0.17), (0.487, 0.169, 0.17), '+x', 0.016)
    fender_strips(m, r, 0.94, Z + 0.0775, 0.172, width=0.016)

    # ---- stowage: red bins up front, fuel drums right, tool box + exhaust left
    for s in (-1, 1):
        crate(r, P.trim_flat, (0.12, 0.055, 0.11), (0.26, 0.2, 0.245 * s), strap=P.black, bevel=0.007)
    for i in range(3):
        cyl(r, P.dark2, 0.036, 0.1, (0.1 - i * 0.12, 0.208, 0.25), ROT_X, seg=10, bevel=0.003)
    crate(r, P.dark2, (0.16, 0.052, 0.105), (0.03, 0.198, -0.245), strap=P.black)
    crate(r, P.canvas, (0.1, 0.044, 0.09), (-0.14, 0.194, -0.245))
    cyl(r, P.exhaust, 0.025, 0.16, (-0.36, 0.205, -0.27), ROT_X, seg=8)
    cyl(r, P.black, 0.031, 0.03, (-0.44, 0.205, -0.27), ROT_X, seg=8)
    m.point('exhaust', (-0.392, 0.2, -0.271), kind='smoke')
    # engine deck vents (beside the turret ring), unditching log on the rear plate, lamps, tow hooks
    for z in (-0.14, 0.14):
        vent(m, r, (-0.27, 0.247, z), (0.12, 0.08), facing='+y', slats=5, thick=0.008)
    box(r, P.dark2, (0.03, 0.06, 0.38), (-0.47, 0.17, 0), bevel=0.006)
    cyl(r, P.wood, 0.026, 0.4, (-0.495, 0.21, 0), ROT_Z, seg=8)
    hazard_stripes(m, r, (-0.476, 0.152, 0.0), (0.26, 0.03), facing='-x')
    for s in (-1, 1):
        headlight(r, (0.44, 0.21, 0.15 * s), 0.016, guard=P.black)
        marker(r, (-0.47, 0.215, 0.15 * s), 0.011)
        box(r, P.black, (0.03, 0.022, 0.03), (0.475, 0.13, 0.12 * s), bevel=0.004)
    top_lamps(r, 0.32, -0.41, 0.247, 0.185, front=None)

    # ---- turret: 10% larger cast dome, red ring band at the ring, cheek plates, mantlet, cupola, MG, searchlight
    t = m.part('turret', at=(-0.05, 0.236, 0))
    k = 1.1
    prof = [(0.22 * k, 0.0), (0.218 * k, 0.02), (0.207 * k, 0.057), (0.17 * k, 0.099), (0.1 * k, 0.124), (0.0, 0.13)]
    lathe(t, P.top, prof, (0, 0, 0), seg=20, scale=(1.1, 1.0, 1.0))
    lathe(t, P.trim, [(0.226 * k, -0.002), (0.229 * k, 0.006), (0.226 * k, 0.02), (0.205 * k, 0.022)], (0, 0, 0), seg=20,
          scale=(1.1, 1.0, 1.0), cap_bottom=False, cap_top=False)
    for s in (-1, 1):
        for (a, w) in ((0.85, 0.14), (1.5, 0.14)):
            ang = a * s
            box(t, P.trim_flat, (w, 0.075, 0.015), (math.cos(ang) * 0.25 * 1.1, 0.048, math.sin(ang) * 0.231), (0, PI / 2 - ang, 0), bevel=0.003)
    # roof: thick red ring band, gold star on a red disc, light edge
    red_ring(m, t, (0.0, 0.1, 0.0), 0.2 * 1.1, 0.2, inner=0.7, depth=0.05)
    top_star(m, t, 'soviet', (-0.01, 0.131, 0.0), 0.13, depth=0.04)
    box(t, P.dark, (0.105, 0.08, 0.22), (0.225, 0.052, 0), bevel=0.02)
    for z in (-0.05, 0.05):
        cyl(t, P.black, 0.026, 0.04, (0.28, 0.052, z), ROT_X, seg=8)
    cyl(t, P.dark2, 0.046, 0.042, (-0.07, 0.14, -0.08), seg=12, bevel=0.004)
    dome(t, P.top, 0.044, (-0.07, 0.161, -0.08), seg=12, rings=3, h=0.018)
    hatch_round(t, P.dark2, 0.036, (-0.055, 0.128, 0.085))
    pintle_mg(t, P, (-0.03, 0.142, 0.085), 0.15)
    cyl(t, P.black, 0.026, 0.03, (0.17, 0.138, 0.125), ROT_X, seg=8)
    cyl(t, light_mat(HEAD, 3.6, 'steady'), 0.021, 0.004, (0.187, 0.138, 0.125), ROT_X, seg=8)
    crate(t, P.canvas, (0.075, 0.06, 0.22), (-0.27, 0.042, 0), strap=P.black, bevel=0.01)
    cyl(t, P.gun, 0.017, 0.21, (-0.22, 0.105, 0.0), ROT_Z, seg=8)
    whip(t, P, (-0.19, 0.115, -0.14), 0.26, pennant=True)
    marker(t, (-0.2, 0.118, 0.08), 0.011, RED, '+y', mode='blink', strength=3.0)
    for s in (-1, 1):
        smoke_dischargers(t, P, (0.05, 0.11, 0.205 * s), s, 3)

    # ---- twin guns (15% thicker) with evacuators and muzzle brakes
    for i, z in enumerate((-0.05, 0.05)):
        b = m.part(f'b{i}', parent='turret', at=(0.24, 0.05, z))
        gun_barrel(b, P, 0.42, 0.0167, (0, 0, 0), brake='ring', sleeve=(0.27, 0.065))
        m.muzzle(f'm{i}', (0.66, 0.05, z))
