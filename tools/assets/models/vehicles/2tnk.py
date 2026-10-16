"""Allied medium tank (2tnk, M60 / Abrams style): team-painted hull with armoured side skirts (team panels on
a dark frame), six dark road wheels a side on scrolling tracks, angular sloped turret (part 'turret') with
star roundels, bustle rack stowage, commander's .50 cal and loader's shielded MG, gun 'b0' (recoil along -X),
muzzle 'm0', exhaust smoke point. Pivots: node --import tsx tools/assets/rig.ts 2tnk.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = '2tnk'
FACTION = 'allies'
KIND = 'vehicle'


def build(m):
    m.set_meta(height=0.34, radius=0.42, snow=0.3)
    r = m.root
    P = Pal('allies')

    # ---- running gear
    L, H, W, Z = 0.82, 0.14, 0.125, 0.21
    running_gear(m, r, P, L, H, W, Z, 6, wheel_k=0.37, rollers=3)

    # ---- hull
    box(r, P.dark, (0.74, 0.07, 0.3), (0, 0.09, 0), bevel=0.01)
    hull = [(-0.405, 0.112), (0.33, 0.112), (0.44, 0.162), (0.305, 0.228), (-0.385, 0.234), (-0.415, 0.192)]
    side_prism(r, P.hull, hull, 0.36, bevel=0.017)
    slope_plate(r, P.dark2, (0.44, 0.162), (0.305, 0.228), 0.27, t=0.01, inset=0.84)
    for s in (-1, 1):
        fender(r, P.hull_flat, 0.86, 0.15, 0.149, Z * s, front=0.07, rear=0.05)
        # skirt: dark frame rail + four team panels, dark lower band
        box(r, P.dark, (0.8, 0.018, 0.018), (0.0, 0.147, 0.281 * s), bevel=0.004)
        skirt(r, P.trim_flat, 0.78, 0.072, 0.142, 0.283 * s, panels=4, t=0.014)
        stripe(m, r, (0.0, 0.08, 0.291 * s), (0.8, 0.014), '+z' if s > 0 else '-z', 0x26292e)
        number(m, r, '114', (-0.25, 0.115, 0.2915 * s), 0.035, '+z' if s > 0 else '-z')
        crate(r, P.dark2, (0.15, 0.045, 0.085), (-0.2, 0.178, 0.215 * s), strap=P.black)
    hull_shade(m, r, -0.415, 0.305, 0.231, 0.18, side_y=(0.11, 0.24), fenders=(0.86, 0.155, Z, 0.15, 0.0))
    deck_strips(m, r, -0.385, 0.305, 0.232, 0.18, width=0.016)
    edge_strip(m, r, (0.437, 0.163, -0.17), (0.437, 0.163, 0.17), '+x', 0.014)
    fender_strips(m, r, 0.86, 0.285, 0.155, width=0.014)
    top_lamps(r, 0.29, -0.37, 0.232, 0.155)
    jerry_rack(r, P, 2, 0.06, 0.155, 0.228, yaw=PI / 2)
    bedroll(r, P, 0.16, 0.022, (0.04, 0.177, -0.218), axis='x', mat=P.tan)
    # engine deck, rear plate with exhaust grille, jerry rack on the back
    for z in (-0.11, 0.11):
        vent(m, r, (-0.3, 0.236, z), (0.15, 0.08), facing='+y', slats=6, thick=0.008)
    box(r, P.dark2, (0.02, 0.075, 0.33), (-0.415, 0.16, 0), bevel=0.005)
    grille(m, r, (-0.426, 0.165, 0.0), (0.2, 0.05), facing='-x', n=4)
    m.point('exhaust', (-0.43, 0.17, 0.0), kind='smoke')
    jerry_rack(r, P, 3, -0.405, 0.236, 0.0, yaw=0.0, mat=P.jerry)
    for s in (-1, 1):
        headlight(r, (0.395, 0.19, 0.14 * s), 0.018, guard=P.black)
        marker(r, (-0.42, 0.212, 0.15 * s), 0.011)
        marker(r, (0.42, 0.155, 0.2 * s), 0.008, AMBER, '+x')
    tow_hooks(r, P, 0.45, 0.12, 0.11, 1)
    tow_hooks(r, P, -0.42, 0.12, 0.11, -1)
    for s in (-1, 1):
        rivet_row(m, r, (-0.34, 0.235, 0.168 * s), (0.26, 0.229, 0.168 * s), facing='+y', spacing=0.035, size=0.01)

    # ---- turret: angular, sloped cheeks, team paint
    # ---- turret: bright team paint, 12% oversized, white star roundel on the roof
    t = m.part('turret', at=(-0.04, 0.228, 0))
    ring = scale_ring([(0.215, -0.05), (0.215, 0.05), (0.1, 0.155), (-0.15, 0.168), (-0.265, 0.128), (-0.265, -0.128), (-0.15, -0.168), (0.1, -0.155)], 1.12)
    top = scale_ring(ring, 0.86, 0.9, -0.022)
    loft(t, P.hull, [(0.0, ring), (0.048, scale_ring(ring, 1.0)), (0.104, top)], bevel=0.017)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        emblem(m, t, 'allied_star', (-0.08, 0.054, 0.186 * s), 0.075, facing=f)
        number(m, t, '114', (0.045, 0.054, 0.177 * s), 0.03, f)
        smoke_dischargers(t, P, (0.135, 0.078, 0.159 * s), s, 3)
        # appliqué cheek plates in a darker steel
        box(t, P.dark2, (0.123, 0.066, 0.013), (0.174, 0.049, 0.117 * s), (0, s * 0.74, 0), bevel=0.004)
    top_star(m, t, 'allies', (0.02, 0.105, 0.0), 0.095)
    outline_strips(m, t, top, 0.104, width=0.016)
    # mantlet + gunner's sight
    box(t, P.dark, (0.06, 0.076, 0.14), (0.248, 0.047, 0), bevel=0.018)
    box(t, P.dark2, (0.06, 0.034, 0.052), (0.112, 0.12, -0.1), bevel=0.006)
    box(t, P.glass, (0.004, 0.02, 0.038), (0.143, 0.122, -0.1))
    # commander's cupola with the M2 (right), loader with a shielded MG (left)
    cyl(t, P.dark2, 0.046, 0.034, (-0.09, 0.117, 0.084), seg=12, bevel=0.005)
    hatch_round(t, P.dark2, 0.037, (-0.09, 0.134, 0.084))
    pintle_mg(t, P, (-0.056, 0.134, 0.084), 0.14)
    hatch_round(t, P.dark2, 0.033, (-0.078, 0.104, -0.084))
    pintle_mg(t, P, (-0.045, 0.104, -0.084), 0.11, shield=P.dark2)
    # bustle rack with stowage (canvas bags, a bedroll, ammo box), whips with a pennant, wind sensor, lamp
    box(t, P.black, (0.095, 0.008, 0.3), (-0.34, 0.03, 0), bevel=0.002)
    for z in (-0.145, 0.0, 0.145):
        box(t, P.black, (0.095, 0.045, 0.008), (-0.34, 0.054, z))
    box(t, P.black, (0.008, 0.045, 0.3), (-0.386, 0.054, 0))
    crate(t, P.canvas, (0.08, 0.05, 0.11), (-0.34, 0.06, -0.075), bevel=0.012)
    bedroll(t, P, 0.13, 0.025, (-0.34, 0.064, 0.075), axis='z', mat=P.tan)
    crate(t, P.jerry, (0.05, 0.034, 0.05), (-0.34, 0.05, 0.0))
    for s in (-1, 1):
        whip(t, P, (-0.255, 0.104, 0.11 * s), 0.22, pennant=s > 0)
    cyl(t, P.black, 0.004, 0.05, (-0.22, 0.128, 0.0), seg=4)
    box(t, P.dark, (0.016, 0.008, 0.016), (-0.22, 0.154, 0.0))
    marker(t, (-0.27, 0.108, 0.0), 0.011, AMBER, '+y', mode='blink', strength=3.0)

    # ---- gun (15% thicker): thermal sleeve bands, bore evacuator, muzzle reference
    b = m.part('b0', parent='turret', at=(0.22, 0.04, 0))
    gun_barrel(b, P, 0.38, 0.017, (0, 0, 0), brake='ring', sleeve=(0.24, 0.065))
    for x in (0.07, 0.15):
        cyl(b, P.gun, 0.0205, 0.012, (x, 0, 0), ROT_X, seg=10)
    box(b, P.dark, (0.02, 0.012, 0.016), (0.37, 0.018, 0))
    m.muzzle('m0', (0.61, 0.04, 0))
