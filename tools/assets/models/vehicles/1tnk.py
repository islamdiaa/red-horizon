"""Allied light tank (1tnk, M41 Walker Bulldog style), dressed for the RTS camera: a dark team-shade hull and
running gear under a bright team-painted, slightly oversized octagonal turret (part 'turret') with a big white
star roundel on its roof, light worn edges on every top outline, up-facing marker lamps, fender stowage, the
commander's .50 cal, a bustle rack, gun 'b0' (recoil along -X, thickened) with a T muzzle brake, muzzle 'm0',
exhaust smoke points 'ex0' / 'ex1'. Pivots: node --import tsx tools/assets/rig.ts 1tnk.
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

    # ---- hull: dark belly, upper hull in a DARK team shade (the turret above stays bright), dark glacis plate
    box(r, P.dark, (0.66, 0.07, 0.27), (0, 0.09, 0), bevel=0.01)
    hull = [(-0.37, 0.112), (0.3, 0.112), (0.388, 0.157), (0.262, 0.214), (-0.35, 0.22), (-0.382, 0.174)]
    side_prism(r, P.hull, hull, 0.33, bevel=0.016)
    slope_plate(r, P.dark2, (0.388, 0.157), (0.262, 0.214), 0.26, t=0.01, inset=0.86)
    for s in (-1, 1):
        fender(r, P.hull_flat, 0.78, 0.135, 0.145, Z * s, front=0.07, rear=0.05)
    hull_shade(m, r, -0.39, 0.262, 0.217, 0.165, side_y=(0.1, 0.225), fenders=(0.78, 0.151, Z, 0.14, 0.0))
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        camo(m, r, (0.0, 0.17, 0.167 * s), (0.62, 0.11), f, seed=12 + s, n=3, colors=(0x6a6a6a,))
        number(m, r, '21', (-0.24, 0.17, 0.1665 * s), 0.04, f)
    # bright worn edges (deck, glacis, fenders)
    deck_strips(m, r, -0.35, 0.262, 0.218, 0.165, width=0.016)
    edge_strip(m, r, (0.385, 0.158, -0.155), (0.385, 0.158, 0.155), '+x', 0.014)
    fender_strips(m, r, 0.78, Z + 0.0675, 0.151, width=0.014)

    # ---- stowage: right fender (camera side) jerry cans + tool box, left fender bedroll + bin
    jerry_rack(r, P, 2, 0.12, 0.151, 0.205, yaw=PI / 2)
    crate(r, P.canvas, (0.13, 0.048, 0.085), (-0.08, 0.175, 0.205), strap=P.black)
    crate(r, P.tan, (0.09, 0.044, 0.08), (-0.24, 0.173, 0.205))
    bedroll(r, P, 0.17, 0.024, (0.05, 0.174, -0.205), axis='x', mat=P.tan)
    crate(r, P.canvas, (0.14, 0.048, 0.085), (-0.18, 0.175, -0.205), strap=P.black)
    for i in range(4):
        box(r, P.black, (0.045, 0.012, 0.05), (0.33, 0.188 - 0.002 * i, -0.09 + i * 0.06), (0, 0, -0.42), bevel=0.003)
    # engine deck louvres, rear plate, exhausts, tow cable, lamps
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
    top_lamps(r, 0.245, -0.34, 0.217, 0.142)
    tow_hooks(r, P, 0.39, 0.12, 0.1, 1)
    tow_hooks(r, P, -0.39, 0.12, 0.1, -1)
    emblem(m, r, 'allied_star', (-0.386, 0.15, 0.0), 0.05, facing='-x')

    # ---- turret: bright team paint, 12% oversized, white star roundel on the roof
    t = m.part('turret', at=(-0.03, 0.21, 0))
    base = octo(-0.196, 0.151, 0.14, cf=0.067, cr=0.056)
    top = scale_ring(base, 0.8, 0.86, -0.013)
    loft(t, P.hull, [(0.0, base), (0.053, scale_ring(base, 1.0)), (0.1, top)], bevel=0.016)
    top_star(m, t, 'allies', (0.035, 0.101, -0.005), 0.085)
    outline_strips(m, t, top, 0.1, width=0.016)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        emblem(m, t, 'allied_star', (-0.06, 0.054, 0.141 * s), 0.064, facing=f)
    # mantlet, sight, smoke dischargers
    box(t, P.dark, (0.066, 0.072, 0.118), (0.168, 0.045, 0), bevel=0.016)
    box(t, P.dark2, (0.044, 0.028, 0.038), (0.09, 0.108, -0.072), bevel=0.005)
    for s in (-1, 1):
        smoke_dischargers(t, P, (0.105, 0.075, 0.12 * s), s, 3)
    # commander's cupola with the .50 cal (right), loader's hatch (left), periscope
    cyl(t, P.dark2, 0.04, 0.032, (-0.06, 0.11, 0.058), seg=12, bevel=0.004)
    hatch_round(t, P.dark2, 0.033, (-0.06, 0.126, 0.058))
    pintle_mg(t, P, (-0.028, 0.126, 0.058), 0.13)
    hatch_round(t, P.dark2, 0.032, (-0.065, 0.098, -0.068))
    periscope(t, P.dark, P.glass, (0.075, 0.1, 0.05))
    # bustle rack: bedroll, marker lamp, whips
    box(t, P.black, (0.075, 0.008, 0.25), (-0.225, 0.03, 0), bevel=0.002)
    for z in (-0.115, 0.115):
        box(t, P.black, (0.075, 0.038, 0.007), (-0.225, 0.05, z))
    bedroll(t, P, 0.22, 0.025, (-0.225, 0.062, 0.0), axis='z', mat=P.canvas)
    marker(t, (-0.17, 0.102, 0.0), 0.011, AMBER, '+y', mode='blink', strength=3.0)
    whip(t, P, (-0.15, 0.099, -0.095), 0.22, pennant=True)
    whip(t, P, (-0.15, 0.099, 0.095), 0.18)

    # ---- gun (15% thicker): evacuator sleeve, T muzzle brake; muzzle point
    b = m.part('b0', parent='turret', at=(0.165, 0.04, 0))
    gun_barrel(b, P, 0.27, 0.0168, (0, 0, 0), brake='t', sleeve=(0.17, 0.055))
    m.muzzle('m0', (0.45, 0.04, 0))
