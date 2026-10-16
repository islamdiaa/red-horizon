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
    # red air-recognition band across the engine deck
    sov_hull(m, r, -0.525, 0.445, 0.286, 0.235, side_y=(0.14, 0.28), side_z=0.235, deck_depth=0.014)
    for s in (-1, 1):
        paint(m, r, (0.0, 0.186, 0.345 * s), (1.16, 0.18), '+y', OLIVE_DECK, depth=0.008)
        paint(m, r, (-0.01, 0.215, 0.272 * s), (1.04, 0.075), '+y', OLIVE_DECK, depth=0.008)
    fender_caps(m, r, 0.57, 0.24, 0.186, 0.345, 0.178)
    red(m, r, (-0.45, 0.289, 0.0), (0.13, 0.46), '+y', depth=0.014)
    deck_number(m, r, 'М-01', (-0.45, 0.29, 0.0), 0.09, depth=0.014)
    deck_strips(m, r, -0.525, 0.445, 0.288, 0.235, width=0.016)
    edge_strip(m, r, (0.589, 0.203, -0.22), (0.589, 0.203, 0.22), '+x', 0.016)
    fender_strips(m, r, 1.14, 0.42, 0.185, width=0.016)
    top_lamps(r, 0.42, -0.5, 0.287, 0.2, front=None)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        # track pods between the pairs, outer fenders, team skirts (heavy panels)
        box(r, P.hull_flat, (1.04, 0.05, 0.075), (-0.01, 0.19, 0.272 * s))
        fender(r, P.hull_flat, 1.14, 0.15, 0.178, 0.345 * s, front=0.08, rear=0.06, t=0.014)
        box(r, P.dark, (1.04, 0.02, 0.02), (0.0, 0.176, 0.418 * s), bevel=0.004)
        skirt(r, P.trim_flat, 1.02, 0.085, 0.17, 0.421 * s, panels=3, t=0.016)
        stripe(m, r, (0.0, 0.094, 0.43 * s), (1.0, 0.014), f, 0x2a2c24)
        number(m, r, '01', (-0.33, 0.13, 0.4295 * s), 0.045, f)
        emblem(m, r, 'soviet', (0.25, 0.13, 0.4295 * s), 0.06, facing=f)
        stencil(m, r, 'ЗА РОДИНУ', (-0.04, 0.13, 0.4295 * s), 0.036, facing=f)
        # stowage on the fenders: team bin up front, jerry cans, tool box
        crate(r, P.trim_flat, (0.15, 0.055, 0.1), (0.3, 0.214, 0.35 * s), strap=P.black)
        jerry_rack(r, P, 2, -0.2, 0.186, 0.352 * s, yaw=PI / 2)
        crate(r, P.dark2, (0.12, 0.05, 0.1), (0.04, 0.211, 0.35 * s), strap=P.black)
        # tall exhaust stacks with heat shields and rain caps
        cyl(r, P.exhaust, 0.028, 0.14, (-0.44, 0.33, 0.17 * s), r2=0.024, seg=8)
        cyl(r, P.black, 0.031, 0.016, (-0.44, 0.4, 0.17 * s), seg=8)
        box(r, P.dark2, (0.07, 0.09, 0.01), (-0.44, 0.325, (0.17 + 0.036) * s), bevel=0.003)
        m.point('ex0' if s < 0 else 'ex1', (-0.44, 0.395, 0.17 * s), kind='smoke')
    # engine deck louvres, unditching log, rear plate, lights, tow hooks
    for z in (-0.13, 0.13):
        vent(m, r, (-0.31, 0.288, z), (0.12, 0.1), facing='+y', slats=5, thick=0.01)
    cyl(r, P.wood, 0.028, 0.46, (-0.605, 0.25, 0), ROT_Z, seg=6)
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
    ring = scale_ring([(0.275, -0.1), (0.275, 0.1), (0.175, 0.205), (-0.19, 0.215), (-0.305, 0.152), (-0.305, -0.152), (-0.19, -0.215), (0.175, -0.205)], 1.08)
    top = scale_ring(ring, 0.9, 0.93, -0.012)
    loft(t, P.top, [(0.0, ring), (0.062, scale_ring(ring, 1.0)), (0.108, top)], bevel=0.022)
    roof = scale_ring([(0.14, -0.12), (0.14, 0.12), (-0.15, 0.14), (-0.23, 0.1), (-0.23, -0.1), (-0.15, -0.14)], 1.08)
    loft(t, P.top, [(0.104, roof), (0.14, scale_ring(roof, 0.94))], bevel=0.012)
    team_ring(m, t, top, 0.108, width=0.05, inset=0.032)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        # team cheek plates on the front faces, side numbers
        box(t, P.trim_flat, (0.16, 0.075, 0.016), (0.243, 0.054, 0.167 * s), (0, s * 0.81, 0), bevel=0.005)
        box(t, P.trim_flat, (0.32, 0.064, 0.016), (-0.01, 0.05, 0.229 * s), bevel=0.005)
        number(m, t, '01', (-0.16, 0.058, 0.227 * s), 0.042, f)
        smoke_dischargers(t, P, (0.215, 0.1, 0.183 * s), s, 2)
    top_star(m, t, 'soviet', (0.0, 0.141, 0.0), 0.17, depth=0.03)
    outline_strips(m, t, top, 0.108, width=0.016)
    outline_strips(m, t, scale_ring(roof, 0.94), 0.14, width=0.014)
    # mantlet with bolts, twin searchlights, commander + DShK, loader hatch, periscopes, stowage bin, whips
    box(t, P.dark, (0.09, 0.096, 0.29), (0.3, 0.06, 0), bevel=0.024)
    rivet_row(m, t, (0.345, 0.1, -0.12), (0.345, 0.1, 0.12), facing='+x', spacing=0.035, size=0.012)
    for z in (-0.055, 0.055):
        cyl(t, P.dark, 0.028, 0.03, (0.26, 0.157, z), ROT_X, seg=8)
        cyl(t, light_mat(HEAD, 3.6, 'steady'), 0.022, 0.004, (0.277, 0.157, z), ROT_X, seg=8)
    cyl(t, P.dark2, 0.052, 0.036, (-0.12, 0.156, 0.085), seg=12, bevel=0.005)
    hatch_round(t, P.dark2, 0.043, (-0.12, 0.174, 0.085))
    pintle_mg(t, P, (-0.082, 0.174, 0.085), 0.16)
    hatch_round(t, P.dark2, 0.04, (-0.12, 0.14, -0.09))
    for z in (-0.045, 0.035):
        periscope(t, P.dark, P.glass, (0.12, 0.14, z))
    crate(t, P.canvas, (0.08, 0.07, 0.29), (-0.365, 0.038, 0), strap=P.black, bevel=0.012)
    whip(t, P, (-0.28, 0.108, 0.13), 0.28, pennant=True)
    whip(t, P, (-0.28, 0.108, -0.13), 0.22)
    for s in (-1, 1):
        marker(t, (-0.295, 0.115, 0.065 * s), 0.012, RED, '+y', mode='blink', strength=3.0)

    # ---- twin cannons with evacuators and muzzle brakes
    for i, z in enumerate((-0.075, 0.075)):
        b = m.part(f'b{i}', parent='turret', at=(0.3, 0.055, z))
        gun_barrel(b, P, 0.47, 0.025, (0, 0, 0), brake='t', sleeve=(0.28, 0.075))
        m.muzzle(f'm{i}', (0.79, 0.055, z))

    # ---- missile pods on the turret sides: team cover band, four red-tipped missiles each
    for i, s in ((2, -1), (3, 1)):
        z = 0.29 * s
        box(t, P.dark2, (0.26, 0.1, 0.1), (-0.02, 0.06, z), bevel=0.016)
        box(t, P.trim_flat, (0.075, 0.106, 0.106), (-0.085, 0.06, z), bevel=0.006)
        box(t, P.black, (0.006, 0.084, 0.084), (0.112, 0.06, z))
        for dy in (-0.022, 0.022):
            for dz in (-0.022, 0.022):
                cyl(t, painted(0xb02418, panels=None, wear=0.4, rust=0.05, rough=0.45), 0.014, 0.02, (0.118, 0.06 + dy, z + dz), ROT_X, seg=6, r2=0.006)
        box(t, P.gun, (0.05, 0.03, 0.02), (-0.02, 0.06, z - s * 0.06))
        m.muzzle(f'm{i}', (0.13, 0.06, z))
