"""Allied light tank (1tnk, M41 Walker Bulldog style): team-painted welded hull with dark camouflage, dark
lower hull and running gear (5 road wheels a side on scrolling tracks), fender stowage, octagonal turret
(part 'turret') with star roundels, commander's .50 cal and a bustle rack, gun 'b0' (recoil along -X) with a
T muzzle brake, muzzle 'm0', exhaust smoke points 'ex0' / 'ex1'. Pivots: node --import tsx tools/assets/rig.ts 1tnk.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = '1tnk'
FACTION = 'allies'
KIND = 'vehicle'


def build(m):
    m.set_meta(height=0.32, radius=0.38, snow=0.3)
    r = m.root
    P = Pal('allies')

    # ---- running gear
    L, H, W, Z = 0.74, 0.135, 0.12, 0.19
    running_gear(m, r, P, L, H, W, Z, 5, wheel_k=0.4, rollers=2)

    # ---- hull: dark belly, team upper hull (side profile across Z), dark glacis plate
    box(r, P.dark, (0.66, 0.07, 0.27), (0, 0.09, 0), bevel=0.01)
    hull = [(-0.37, 0.112), (0.3, 0.112), (0.388, 0.157), (0.262, 0.214), (-0.35, 0.22), (-0.382, 0.174)]
    side_prism(r, P.hull, hull, 0.33, bevel=0.016)
    slope_plate(r, P.dark2, (0.388, 0.157), (0.262, 0.214), 0.26, t=0.01, inset=0.86)
    # fenders over the tracks
    for s in (-1, 1):
        fender(r, P.hull_flat, 0.78, 0.135, 0.145, Z * s, front=0.07, rear=0.05)
    # bright worn edges (deck, glacis, fenders)
    deck_strips(m, r, -0.35, 0.262, 0.218, 0.165)
    edge_strip(m, r, (0.385, 0.158, -0.155), (0.385, 0.158, 0.155), '+x', 0.012)
    fender_strips(m, r, 0.78, Z + 0.0675, 0.151)
    # camouflage over the team paint: deck, hull sides, fenders
    camo(m, r, (0.0, 0.17, 0.166), (0.62, 0.11), '+z', seed=12, n=4)
    camo(m, r, (0.0, 0.17, -0.166), (0.62, 0.11), '-z', seed=13, n=4)
    camo(m, r, (0.2, 0.2, 0), (0.2, 0.3), '+y', seed=14, n=3)
    emblem(m, r, 'allied_star', (-0.27, 0.222, 0.0), 0.09, facing='+y')

    # ---- stowage: right fender (camera side) jerry cans + tool box, left fender bedroll + bin
    jerry_rack(r, P, 2, 0.12, 0.151, 0.205, yaw=PI / 2)
    crate(r, P.dark2, (0.13, 0.045, 0.08), (-0.08, 0.174, 0.205), strap=P.black)
    crate(r, P.canvas, (0.09, 0.04, 0.075), (-0.24, 0.171, 0.205))
    bedroll(r, P, 0.17, 0.022, (0.05, 0.172, -0.205), axis='x', mat=P.tan)
    crate(r, P.dark2, (0.14, 0.045, 0.08), (-0.18, 0.174, -0.205), strap=P.black)
    # spare track links on the glacis
    for i in range(4):
        box(r, P.black, (0.045, 0.012, 0.05), (0.33, 0.188 - 0.002 * i, -0.09 + i * 0.06), (0, 0, -0.42), bevel=0.003)
    # engine deck louvres, rear plate, exhausts, tow cable, lights
    for z in (-0.105, 0.105):
        vent(m, r, (-0.27, 0.221, z), (0.13, 0.07), facing='+y', slats=5, thick=0.008)
    box(r, P.dark2, (0.022, 0.07, 0.3), (-0.375, 0.15, 0), bevel=0.005)
    for s in (-1, 1):
        exhaust_pipe(r, P, (-0.36, 0.152, 0.09 * s), (-0.42, 0.152, 0.09 * s), 0.017)
        m.point('ex0' if s < 0 else 'ex1', (-0.422, 0.155, 0.091 * s), kind='smoke')
    cyl_between(r, P.black, (-0.3, 0.226, 0.15), (0.18, 0.222, 0.15), 0.006, 6)
    for s in (-1, 1):
        headlight(r, (0.34, 0.172, 0.125 * s), 0.017, guard=P.black)
        marker(r, (-0.386, 0.192, 0.135 * s), 0.011)
    tow_hooks(r, P, 0.39, 0.12, 0.1, 1)
    tow_hooks(r, P, -0.39, 0.12, 0.1, -1)
    emblem(m, r, 'allied_star', (-0.386, 0.15, 0.0), 0.05, facing='-x')
    rivet_row(m, r, (-0.3, 0.221, 0.15), (0.22, 0.216, 0.15), facing='+y', spacing=0.035, size=0.01)
    rivet_row(m, r, (-0.3, 0.221, -0.15), (0.22, 0.216, -0.15), facing='+y', spacing=0.035, size=0.01)

    # ---- turret: sloped octagonal cast turret in team paint
    t = m.part('turret', at=(-0.03, 0.21, 0))
    base = octo(-0.175, 0.135, 0.125, cf=0.06, cr=0.05)
    loft(t, P.hull, [(0.0, base), (0.05, scale_ring(base, 1.0)), (0.094, scale_ring(base, 0.8, 0.86, -0.012))], bevel=0.014)
    emblem(m, t, 'allied_star', (-0.06, 0.095, -0.0), 0.075, facing='+y')
    outline_strips(m, t, scale_ring(base, 0.8, 0.86, -0.012), 0.094)
    for s in (-1, 1):
        emblem(m, t, 'allied_star', (-0.05, 0.05, 0.126 * s), 0.064, facing='+z' if s > 0 else '-z')
        number(m, t, '21', (0.05, 0.05, 0.121 * s), 0.03, '+z' if s > 0 else '-z')
    # mantlet, sight, smoke dischargers
    box(t, P.dark, (0.06, 0.064, 0.105), (0.148, 0.042, 0), bevel=0.014)
    box(t, P.dark2, (0.04, 0.026, 0.035), (0.08, 0.102, -0.065), bevel=0.005)
    for s in (-1, 1):
        smoke_dischargers(t, P, (0.095, 0.07, 0.108 * s), s, 3)
    # commander's cupola with the .50 cal (right), loader's hatch (left), periscope
    cyl(t, P.dark2, 0.036, 0.03, (-0.05, 0.103, 0.05), seg=12, bevel=0.004)
    hatch_round(t, P.dark2, 0.03, (-0.05, 0.118, 0.05))
    pintle_mg(t, P, (-0.02, 0.118, 0.05), 0.12)
    hatch_round(t, P.dark2, 0.03, (-0.05, 0.092, -0.06))
    periscope(t, P.dark, P.glass, (0.06, 0.094, -0.02))
    # bustle rack: bedroll and a jerry can, marker light
    box(t, P.black, (0.07, 0.008, 0.23), (-0.2, 0.03, 0), bevel=0.002)
    for z in (-0.105, 0.105):
        box(t, P.black, (0.07, 0.035, 0.007), (-0.2, 0.048, z))
    bedroll(t, P, 0.2, 0.022, (-0.2, 0.058, 0.0), axis='z', mat=P.canvas)
    marker(t, (-0.18, 0.098, 0.07), 0.009, AMBER, '+y', mode='blink', strength=2.4)
    whip(t, P, (-0.13, 0.093, -0.085), 0.22, pennant=True)
    whip(t, P, (-0.13, 0.093, 0.085), 0.18)

    # ---- gun: evacuator sleeve, T muzzle brake; muzzle point
    b = m.part('b0', parent='turret', at=(0.165, 0.04, 0))
    gun_barrel(b, P, 0.27, 0.0145, (0, 0, 0), brake='t', sleeve=(0.17, 0.05))
    m.muzzle('m0', (0.45, 0.04, 0))
