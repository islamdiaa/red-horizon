"""Soviet Mammoth tank (4tnk): four tracks (inner pair hidden under the hull), olive drab hull with a team
glacis, team skirts and track pods, tall exhaust stacks (smoke ex0 / ex1), a huge angular turret (part
'turret') with twin cannons 'b0' / 'b1' (recoil along -X, muzzles m0 / m1) and two missile pods (muzzles
m2 / m3, red-tipped missiles), crew hatches, DShK, searchlights. Pivots: node --import tsx tools/assets/rig.ts 4tnk.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = '4tnk'
FACTION = 'soviet'
KIND = 'vehicle'


def build(m):
    m.set_meta(height=0.45, radius=0.6, snow=0.3)
    r = m.root
    P = Pal('soviet')

    # ---- running gear: inner pair (belts only), outer pair with five big road wheels
    running_gear(m, r, P, 1.06, 0.17, 0.12, 0.2, 6, wheels=False)
    running_gear(m, r, P, 1.1, 0.17, 0.13, 0.345, 5, wheel_k=0.41, rollers=2)

    # ---- hull
    box(r, P.dark, (1.0, 0.09, 0.62), (0, 0.11, 0), bevel=0.012)
    hull = [(-0.565, 0.132), (0.47, 0.132), (0.592, 0.202), (0.445, 0.28), (-0.525, 0.29), (-0.582, 0.238)]
    side_prism(r, P.hull, hull, 0.47, bevel=0.02)
    slope_plate(r, P.trim, (0.592, 0.202), (0.445, 0.28), 0.42, t=0.014, inset=0.86)
    rivet_row(m, r, (0.57, 0.219, -0.18), (0.57, 0.219, 0.18), facing='+y', spacing=0.035, size=0.013)
    deck_strips(m, r, -0.525, 0.445, 0.288, 0.235)
    edge_strip(m, r, (0.589, 0.203, -0.22), (0.589, 0.203, 0.22), '+x', 0.014)
    fender_strips(m, r, 1.14, 0.42, 0.185)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        # track pods between the pairs, outer fenders, team skirts (heavy panels)
        box(r, P.hull_flat, (1.04, 0.05, 0.075), (-0.01, 0.19, 0.272 * s))
        fender(r, P.hull_flat, 1.14, 0.15, 0.178, 0.345 * s, front=0.08, rear=0.06, t=0.014)
        box(r, P.dark, (1.04, 0.02, 0.02), (0.0, 0.176, 0.418 * s), bevel=0.004)
        skirt(r, P.trim_flat, 1.02, 0.085, 0.17, 0.421 * s, panels=3, t=0.016)
        stripe(m, r, (0.0, 0.094, 0.43 * s), (1.0, 0.014), f, 0x2a2c24)
        number(m, r, '01', (-0.33, 0.13, 0.4295 * s), 0.045, f)
        emblem(m, r, 'soviet', (0.2, 0.13, 0.4295 * s), 0.06, facing=f)
        # stowage on the fenders: team bin up front, jerry cans, tool box
        crate(r, P.trim_flat, (0.15, 0.055, 0.1), (0.3, 0.214, 0.35 * s), strap=P.black)
        jerry_rack(r, P, 2, -0.2, 0.186, 0.352 * s, yaw=PI / 2)
        crate(r, P.dark2, (0.12, 0.05, 0.1), (0.04, 0.211, 0.35 * s), strap=P.black)
        # tall exhaust stacks with heat shields and rain caps
        cyl(r, P.exhaust, 0.028, 0.14, (-0.44, 0.33, 0.17 * s), r2=0.024, seg=10)
        cyl(r, P.black, 0.031, 0.016, (-0.44, 0.4, 0.17 * s), seg=10)
        box(r, P.dark2, (0.07, 0.09, 0.01), (-0.44, 0.325, (0.17 + 0.036) * s), bevel=0.003)
        m.point('ex0' if s < 0 else 'ex1', (-0.44, 0.395, 0.17 * s), kind='smoke')
    # engine deck louvres, unditching log, rear plate, lights, tow hooks
    vent(m, r, (-0.34, 0.291, -0.0), (0.16, 0.2), facing='+y', slats=7, thick=0.01)
    cyl(r, P.wood, 0.03, 0.5, (-0.5, 0.29, 0), ROT_Z, seg=8)
    for z in (-0.2, 0.2):
        bar(r, P.black, (-0.53, 0.27, z), (-0.48, 0.32, z), 0.008)
    box(r, P.dark2, (0.03, 0.06, 0.44), (-0.575, 0.2, 0), bevel=0.006)
    hazard_stripes(m, r, (-0.592, 0.2, 0.0), (0.36, 0.04), facing='-x')
    for s in (-1, 1):
        headlight(r, (0.552, 0.235, 0.18 * s), 0.022, guard=P.black)
        marker(r, (-0.585, 0.248, 0.19 * s), 0.013)
    tow_hooks(r, P, 0.6, 0.15, 0.15, 1)
    tow_hooks(r, P, -0.59, 0.15, 0.15, -1)
    for s in (-1, 1):
        rivet_row(m, r, (-0.5, 0.292, 0.21 * s), (0.4, 0.283, 0.21 * s), facing='+y', spacing=0.04, size=0.012)

    # ---- turret: huge angular casting with a raised roof, team cheek appliqué
    t = m.part('turret', at=(-0.05, 0.283, 0))
    ring = [(0.275, -0.1), (0.275, 0.1), (0.175, 0.205), (-0.19, 0.215), (-0.305, 0.152), (-0.305, -0.152), (-0.19, -0.215), (0.175, -0.205)]
    loft(t, P.top, [(0.0, ring), (0.06, scale_ring(ring, 1.0)), (0.104, scale_ring(ring, 0.9, 0.93, -0.012))], bevel=0.02)
    roof = [(0.14, -0.12), (0.14, 0.12), (-0.15, 0.14), (-0.23, 0.1), (-0.23, -0.1), (-0.15, -0.14)]
    loft(t, P.hull_flat, [(0.1, roof), (0.135, scale_ring(roof, 0.94))], bevel=0.01)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        # team cheek plates on the front faces, side numbers
        box(t, P.trim_flat, (0.15, 0.07, 0.016), (0.225, 0.05, 0.155 * s), (0, s * 0.81, 0), bevel=0.005)
        box(t, P.trim_flat, (0.3, 0.06, 0.016), (-0.01, 0.046, 0.212 * s), bevel=0.005)
        number(m, t, '01', (-0.15, 0.055, 0.21 * s), 0.04, f)
        smoke_dischargers(t, P, (0.2, 0.095, 0.17 * s), s, 3)
    emblem(m, t, 'soviet', (0.0, 0.136, 0.0), 0.15, facing='+y', depth=0.03)
    outline_strips(m, t, scale_ring(ring, 0.9, 0.93, -0.012), 0.104)
    outline_strips(m, t, scale_ring(roof, 0.94), 0.135, width=0.012)
    # mantlet with bolts, twin searchlights, commander + DShK, loader hatch, periscopes, stowage bin, whips
    box(t, P.dark, (0.085, 0.09, 0.27), (0.275, 0.058, 0), bevel=0.022)
    rivet_row(m, t, (0.318, 0.095, -0.11), (0.318, 0.095, 0.11), facing='+x', spacing=0.035, size=0.012)
    for z in (-0.05, 0.05):
        cyl(t, P.dark, 0.026, 0.03, (0.24, 0.15, z), ROT_X, seg=8)
        cyl(t, light_mat(HEAD, 2.6, 'steady'), 0.02, 0.004, (0.257, 0.15, z), ROT_X, seg=8)
    cyl(t, P.dark2, 0.048, 0.034, (-0.1, 0.148, 0.075), seg=12, bevel=0.005)
    hatch_round(t, P.dark2, 0.04, (-0.1, 0.165, 0.075))
    pintle_mg(t, P, (-0.065, 0.165, 0.075), 0.15)
    hatch_round(t, P.dark2, 0.038, (-0.1, 0.135, -0.08))
    for z in (-0.04, 0.03):
        periscope(t, P.dark, P.glass, (0.1, 0.135, z))
    crate(t, P.dark2, (0.075, 0.065, 0.27), (-0.335, 0.035, 0), strap=P.black, bevel=0.01)
    whip(t, P, (-0.26, 0.104, 0.12), 0.28, pennant=True)
    whip(t, P, (-0.26, 0.104, -0.12), 0.22)
    for s in (-1, 1):
        marker(t, (-0.275, 0.11, 0.06 * s), 0.01, RED, '+y', mode='blink', strength=2.6)

    # ---- twin cannons with evacuators and muzzle brakes
    for i, z in enumerate((-0.075, 0.075)):
        b = m.part(f'b{i}', parent='turret', at=(0.3, 0.055, z))
        gun_barrel(b, P, 0.47, 0.022, (0, 0, 0), brake='t', sleeve=(0.28, 0.07))
        m.muzzle(f'm{i}', (0.79, 0.055, z))

    # ---- missile pods on the turret sides: team cover band, four red-tipped missiles each
    for i, s in ((2, -1), (3, 1)):
        z = 0.27 * s
        box(t, P.dark2, (0.26, 0.1, 0.1), (-0.02, 0.06, z), bevel=0.016)
        box(t, P.trim_flat, (0.075, 0.106, 0.106), (-0.085, 0.06, z), bevel=0.006)
        box(t, P.black, (0.006, 0.084, 0.084), (0.112, 0.06, z))
        for dy in (-0.022, 0.022):
            for dz in (-0.022, 0.022):
                cyl(t, painted(0xb02418, panels=None, wear=0.4, rust=0.05, rough=0.45), 0.014, 0.02, (0.118, 0.06 + dy, z + dz), ROT_X, seg=6, r2=0.006)
        box(t, P.gun, (0.05, 0.03, 0.02), (-0.02, 0.06, z - s * 0.06))
        m.muzzle(f'm{i}', (0.13, 0.06, z))
