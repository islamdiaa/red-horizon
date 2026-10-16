"""Soviet Tesla tank (ttnk): olive drab hull with a team glacis and team skirts, six road wheels a side on
scrolling tracks, capacitor housings on the glacis, deck grille, and a squat armoured turret (part 'turret')
carrying the tesla coil: insulator stack, copper windings, three toroids with glowing rims ('glow:coil') and
the orb ('glow:orb'); the procedural discharge halo ('fx') is kept. Muzzle 'm0' = the orb.
Pivots: node --import tsx tools/assets/rig.ts ttnk.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = 'ttnk'
FACTION = 'soviet'
KIND = 'vehicle'
TESLA = 0x8cc8ff


def build(m):
    m.set_meta(height=0.72, radius=0.46, snow=0.3, keep=['fx:add:5aa2ff:0.9'])
    r = m.root
    P = Pal('soviet')
    copper = metal(0xb06a38, rough=0.35, rust=0.15, wear=0.3, metal=0.9)
    porcelain = painted(0xd8d4c8, panels=None, wear=0.3, rust=0.0, grime=0.35, rough=0.35, metal=0.0, var=0.05)

    L, H, W, Z = 0.84, 0.15, 0.13, 0.22
    running_gear(m, r, P, L, H, W, Z, 6, wheel_k=0.38, rollers=2)
    box(r, P.dark, (0.76, 0.08, 0.32), (0, 0.095, 0), bevel=0.01)
    hull = [(-0.432, 0.122), (0.34, 0.122), (0.452, 0.167), (0.312, 0.237), (-0.402, 0.242), (-0.442, 0.202)]
    side_prism(r, P.hull, hull, 0.38, bevel=0.017)
    slope_plate(r, P.trim, (0.452, 0.167), (0.312, 0.237), 0.32, t=0.012, inset=0.84)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        fender(r, P.hull_flat, 0.86, 0.15, 0.16, Z * s, front=0.06, rear=0.05)
        box(r, P.dark, (0.84, 0.018, 0.018), (0.0, 0.16, 0.289 * s), bevel=0.004)
        skirt(r, P.trim_flat, 0.82, 0.07, 0.155, 0.291 * s, panels=4, t=0.014)
        stripe(m, r, (0.0, 0.088, 0.2985 * s), (0.82, 0.012), f, 0x2a2c24)
        number(m, r, '407', (-0.27, 0.12, 0.2985 * s), 0.04, f)
        stencil(m, r, 'ВПЕРЁД', (0.06, 0.12, 0.2985 * s), 0.036, facing=f)
        crate(r, P.dark2, (0.16, 0.04, 0.05), (-0.08, 0.26, 0.165 * s), strap=P.black)
        cyl(r, P.exhaust, 0.02, 0.06, (-0.42, 0.262, 0.13 * s), r2=0.017, seg=8)
        # capacitor housings on the glacis feeding the coil (porcelain + copper rings)
        cyl(r, porcelain, 0.024, 0.075, (0.24, 0.24, 0.11 * s), ROT_X, seg=10)
        for x in (0.205, 0.275):
            cyl(r, copper, 0.026, 0.012, (x, 0.24, 0.11 * s), ROT_X, seg=10)
        headlight(r, (0.42, 0.19, 0.14 * s), 0.017, guard=P.black)
        marker(r, (-0.446, 0.21, 0.15 * s), 0.011)
    sov_hull(m, r, -0.402, 0.312, 0.239, 0.19, side_y=(0.13, 0.235), side_z=0.19)
    for s in (-1, 1):
        paint(m, r, (0.0, 0.167, 0.22 * s), (0.86, 0.15), '+y', OLIVE_DECK, depth=0.008)
    fender_caps(m, r, 0.43, 0.2, 0.167, 0.22, 0.15)
    red(m, r, (-0.36, 0.241, 0.0), (0.085, 0.38), '+y')
    deck_number(m, r, 'Э-407', (-0.36, 0.242, 0.0), 0.065)
    grille(m, r, (-0.25, 0.243, 0.0), (0.11, 0.24), facing='+y', n=6)
    deck_strips(m, r, -0.402, 0.312, 0.24, 0.19, width=0.016)
    edge_strip(m, r, (0.449, 0.168, -0.17), (0.449, 0.168, 0.17), '+x', 0.014)
    fender_strips(m, r, 0.86, 0.295, 0.167, width=0.014)
    top_lamps(r, 0.29, -0.375, 0.239, 0.16)
    tow_hooks(r, P, 0.46, 0.13, 0.12, 1)
    hazard_stripes(m, r, (-0.447, 0.17, 0.0), (0.26, 0.03), facing='-x')

    # ---- turret: squat octagonal base in olive with team appliqué, star, hatch, antenna
    t = m.part('turret', at=(-0.06, 0.238, 0))
    ring = scale_ring([(0.17, -0.07), (0.17, 0.07), (0.08, 0.15), (-0.12, 0.15), (-0.19, 0.08), (-0.19, -0.08), (-0.12, -0.15), (0.08, -0.15)], 1.1)
    top = scale_ring(ring, 0.88)
    loft(t, P.top, [(0.0, ring), (0.054, scale_ring(ring, 1.0)), (0.09, top)], bevel=0.017)
    for s in (-1, 1):
        box(t, P.trim_flat, (0.165, 0.044, 0.014), (-0.02, 0.044, 0.166 * s), bevel=0.004)
        box(t, P.trim_flat, (0.11, 0.044, 0.014), (0.143, 0.044, 0.127 * s), (0, s * 0.73, 0), bevel=0.004)
    team_ring(m, t, top, 0.09, width=0.044, inset=0.026)
    top_star(m, t, 'soviet', (0.115, 0.091, 0.0), 0.075)
    outline_strips(m, t, top, 0.09, width=0.016)
    hatch_round(t, P.dark2, 0.032, (-0.12, 0.09, -0.088))
    whip(t, P, (-0.175, 0.09, 0.12), 0.2, pennant=True)
    marker(t, (-0.17, 0.092, -0.0), 0.011, RED, '+y', mode='blink', strength=3.0)
    # coil column: insulator base, porcelain discs, copper / dark windings, toroids with glowing rims, cap, orb
    cyl(t, porcelain, 0.07, 0.03, (0, 0.099, 0), r2=0.06, seg=12, bevel=0.004)
    for i in range(3):
        cyl(t, porcelain, 0.055 - i * 0.004, 0.016, (0, 0.124 + i * 0.022, 0), r2=0.05 - i * 0.004, seg=12)
    for i in range(6):
        cyl(t, P.black if i % 2 else copper, 0.035, 0.028, (0, 0.19 + i * 0.028, 0), seg=10)
    glow_c = glow_material('glow:coil', TESLA)
    for (hh, rad) in ((0.21, 0.1), (0.27, 0.082), (0.33, 0.064)):
        torus(t, P.steel, rad, 0.015, (0, hh, 0), seg=16, tseg=6)
        cyl(t, glow_c, rad + 0.0152, 0.009, (0, hh, 0), seg=16, caps=False)
    lathe(t, P.gun, [(0.045, 0.0), (0.056, 0.02), (0.036, 0.04), (0.0, 0.046)], (0, 0.36, 0), seg=12)
    sphere(t, glow_material('glow:orb', TESLA), 0.05, (0, 0.43, 0), seg=12, rings=8)
    for s in (-1, 1):
        cyl_between(t, P.black, (0.12, 0.03, 0.1 * s), (0.03, 0.2, 0.03 * s), 0.008, 6)
    m.muzzle('m0', (0, 0.43, 0))
