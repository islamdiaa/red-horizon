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
        camo(m, r, (-0.02, 0.112, 0.291 * s), (0.74, 0.06), '+z' if s > 0 else '-z', seed=31 + s, n=3)
        number(m, r, '114', (-0.25, 0.115, 0.2915 * s), 0.035, '+z' if s > 0 else '-z')
        crate(r, P.dark2, (0.15, 0.045, 0.085), (-0.2, 0.178, 0.215 * s), strap=P.black)
    camo(m, r, (0.22, 0.2, 0), (0.18, 0.34), '+y', seed=33, n=3)
    deck_strips(m, r, -0.385, 0.305, 0.232, 0.18)
    edge_strip(m, r, (0.437, 0.163, -0.17), (0.437, 0.163, 0.17), '+x', 0.012)
    fender_strips(m, r, 0.86, 0.285, 0.155)
    jerry_rack(r, P, 2, 0.06, 0.155, 0.228, yaw=PI / 2)
    bedroll(r, P, 0.16, 0.022, (0.04, 0.177, -0.218), axis='x', mat=P.tan)
    # engine deck, rear plate with exhaust grille, jerry rack on the back
    for z in (-0.11, 0.11):
        vent(m, r, (-0.3, 0.236, z), (0.15, 0.08), facing='+y', slats=6, thick=0.008)
    emblem(m, r, 'allied_star', (-0.3, 0.237, 0.0), 0.06, facing='+y')
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
    t = m.part('turret', at=(-0.04, 0.228, 0))
    ring = [(0.215, -0.05), (0.215, 0.05), (0.1, 0.155), (-0.15, 0.168), (-0.265, 0.128), (-0.265, -0.128), (-0.15, -0.168), (0.1, -0.155)]
    loft(t, P.hull, [(0.0, ring), (0.045, scale_ring(ring, 1.0)), (0.096, scale_ring(ring, 0.86, 0.9, -0.02))], bevel=0.015)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        emblem(m, t, 'allied_star', (-0.07, 0.05, 0.166 * s), 0.07, facing=f)
        number(m, t, '114', (0.04, 0.05, 0.158 * s), 0.028, f)
        smoke_dischargers(t, P, (0.12, 0.072, 0.142 * s), s, 3)
        # appliqué cheek plates in a darker steel
        box(t, P.dark2, (0.11, 0.06, 0.012), (0.155, 0.045, 0.104 * s), (0, s * 0.74, 0), bevel=0.004)
    emblem(m, t, 'allied_star', (-0.11, 0.097, 0.0), 0.08, facing='+y')
    outline_strips(m, t, scale_ring(ring, 0.86, 0.9, -0.02), 0.096)
    # mantlet + gunner's sight
    box(t, P.dark, (0.055, 0.068, 0.125), (0.222, 0.043, 0), bevel=0.016)
    box(t, P.dark2, (0.055, 0.032, 0.048), (0.1, 0.11, -0.09), bevel=0.006)
    box(t, P.glass, (0.004, 0.018, 0.034), (0.128, 0.112, -0.09))
    # commander's cupola with the M2 (right), loader with a shielded MG (left)
    cyl(t, P.dark2, 0.042, 0.032, (-0.08, 0.108, 0.075), seg=12, bevel=0.005)
    hatch_round(t, P.dark2, 0.034, (-0.08, 0.124, 0.075))
    pintle_mg(t, P, (-0.05, 0.124, 0.075), 0.13)
    hatch_round(t, P.dark2, 0.03, (-0.07, 0.096, -0.075))
    pintle_mg(t, P, (-0.04, 0.096, -0.075), 0.1, shield=P.dark2)
    # bustle rack with stowage (canvas bags, a bedroll, ammo box), whips with a pennant, wind sensor, lamp
    box(t, P.black, (0.09, 0.008, 0.27), (-0.31, 0.03, 0), bevel=0.002)
    for z in (-0.13, 0.0, 0.13):
        box(t, P.black, (0.09, 0.042, 0.008), (-0.31, 0.052, z))
    box(t, P.black, (0.008, 0.042, 0.27), (-0.354, 0.052, 0))
    crate(t, P.canvas, (0.075, 0.045, 0.1), (-0.31, 0.057, -0.07), bevel=0.012)
    bedroll(t, P, 0.12, 0.022, (-0.31, 0.06, 0.07), axis='z', mat=P.tan)
    crate(t, P.jerry, (0.05, 0.03, 0.05), (-0.31, 0.047, 0.0))
    for s in (-1, 1):
        whip(t, P, (-0.23, 0.096, 0.1 * s), 0.22, pennant=s > 0)
    cyl(t, P.black, 0.004, 0.05, (-0.2, 0.12, 0.0), seg=4)
    box(t, P.dark, (0.016, 0.008, 0.016), (-0.2, 0.146, 0.0))
    marker(t, (-0.25, 0.1, 0.0), 0.009, AMBER, '+y', mode='blink', strength=2.4)

    # ---- gun: thermal sleeve bands, bore evacuator, muzzle reference
    b = m.part('b0', parent='turret', at=(0.22, 0.04, 0))
    gun_barrel(b, P, 0.38, 0.0148, (0, 0, 0), brake='ring', sleeve=(0.24, 0.06))
    for x in (0.07, 0.15):
        cyl(b, P.gun, 0.0178, 0.012, (x, 0, 0), ROT_X, seg=10)
    box(b, P.dark, (0.02, 0.012, 0.016), (0.37, 0.018, 0))
    m.muzzle('m0', (0.61, 0.04, 0))
