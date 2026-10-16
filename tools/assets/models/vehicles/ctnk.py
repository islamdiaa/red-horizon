"""Allied Chrono tank (ctnk): team-painted hull with dark camouflage and dark skirts, five road wheels a side,
the chrono emitter on the rear deck (coil housing, copper rods with chrome balls, glowing core and the
hovering gyro ring, part 'emitter', 'glow:chrono'; the procedural halo 'fx' is kept), and a low turret (part
'turret') with twin missile pods (parts 'pod0' / 'pod1', recoil along -X, muzzles m0 / m1).
Pivots: node --import tsx tools/assets/rig.ts ctnk.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = 'ctnk'
FACTION = 'allies'
KIND = 'vehicle'
CYAN = 0x5ae0ff


def build(m):
    m.set_meta(height=0.48, radius=0.44, snow=0.3, keep=['fx:add:5ae0ff:0.7'])
    r = m.root
    P = Pal('allies')
    copper = metal(0xb06a38, rough=0.35, rust=0.15, wear=0.3, metal=0.9)
    chrome = metal(0xc8ccd2, rough=0.18, rust=0.0, wear=0.1, metal=1.0)
    glow_c = glow_material('glow:chrono', CYAN)

    L, H, W, Z = 0.8, 0.13, 0.12, 0.205
    running_gear(m, r, P, L, H, W, Z, 5, wheel_k=0.4, rollers=2)
    box(r, P.dark, (0.72, 0.07, 0.3), (0, 0.085, 0), bevel=0.01)
    hull = [(-0.412, 0.112), (0.3, 0.112), (0.442, 0.152), (0.282, 0.218), (-0.382, 0.224), (-0.422, 0.182)]
    side_prism(r, P.hull, hull, 0.36, bevel=0.017)
    slope_plate(r, P.dark2, (0.442, 0.152), (0.282, 0.218), 0.28, t=0.01, inset=0.84)
    hull_shade(m, r, -0.422, 0.282, 0.221, 0.18, side_y=(0.11, 0.23), fenders=(0.82, 0.149, Z, 0.14, 0.0))
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        fender(r, P.hull_flat, 0.82, 0.14, 0.143, Z * s, front=0.06, rear=0.05)
        box(r, P.dark2, (0.8, 0.06, 0.014), (0.0, 0.115, 0.27 * s), bevel=0.004)
        camo(m, r, (0.0, 0.165, 0.181 * s), (0.66, 0.08), f, seed=82 + s, n=3, colors=(0x6a6a6a,))
        number(m, r, '62', (0.0, 0.118, 0.2775 * s), 0.036, f)
        emblem(m, r, 'allied_star', (-0.2, 0.17, 0.181 * s), 0.06, facing=f)
        headlight(r, (0.42, 0.168, 0.12 * s), 0.016, guard=P.black)
        marker(r, (-0.425, 0.19, 0.13 * s), 0.011)
    tow_hooks(r, P, 0.45, 0.12, 0.1, 1)
    deck_strips(m, r, -0.382, 0.282, 0.222, 0.18, width=0.016)
    fender_strips(m, r, 0.82, 0.275, 0.15, width=0.014)
    top_lamps(r, 0.26, -0.37, 0.221, 0.155)

    # ---- chrono emitter on the rear deck
    box(r, P.gun, (0.16, 0.05, 0.22), (-0.3, 0.248, 0), bevel=0.014)
    hazard_stripes(m, r, (-0.3, 0.248, 0.111), (0.15, 0.03), facing='+z')
    for z in (-0.08, 0.08):
        cyl(r, copper, 0.016, 0.09, (-0.3, 0.31, z), seg=8)
        sphere(r, chrome, 0.019, (-0.3, 0.362, z), seg=10, rings=6)
    cyl(r, P.dark, 0.05, 0.02, (-0.3, 0.282, 0), r2=0.06, seg=12)
    cyl(r, glow_c, 0.045, 0.004, (-0.3, 0.294, 0), seg=12)
    em = m.part('emitter', at=(-0.3, 0.35, 0))
    torus(em, chrome, 0.1, 0.014, (0, 0, 0))
    torus(em, glow_c, 0.1, 0.008, (0, 0.009, 0), seg=16, tseg=4)
    for i in range(3):
        a = i / 3 * 2 * PI
        box(em, P.steel, (0.032, 0.012, 0.012), (math.cos(a) * 0.1, 0, math.sin(a) * 0.1), (0, -a, 0))

    # ---- low turret with twin missile pods
    t = m.part('turret', at=(0.02, 0.218, 0))
    ring = scale_ring([(0.15, -0.06), (0.15, 0.06), (0.08, 0.1), (-0.12, 0.1), (-0.16, 0.06), (-0.16, -0.06), (-0.12, -0.1), (0.08, -0.1)], 1.12)
    top = scale_ring(ring, 0.85)
    loft(t, P.hull, [(0.0, ring), (0.044, scale_ring(ring, 1.0)), (0.078, top)], bevel=0.015)
    outline_strips(m, t, top, 0.078, width=0.014)
    top_star(m, t, 'allies', (0.03, 0.079, -0.0), 0.075)
    hatch_round(t, P.dark2, 0.028, (-0.08, 0.078, 0.045))
    marker(t, (-0.12, 0.08, -0.045), 0.01, AMBER, '+y', mode='blink', strength=3.0)
    box(t, P.glass, (0.022, 0.018, 0.05), (0.122, 0.052, 0), bevel=0.004)
    whip(t, P, (-0.13, 0.072, -0.07), 0.18, pennant=True)
    red = painted(0xb02418, panels=None, wear=0.4, rust=0.05, rough=0.45)
    for i, s in ((0, -1), (1, 1)):
        z = 0.15 * s
        box(t, P.gun, (0.05, 0.03, 0.04), (0.0, 0.03, 0.105 * s), bevel=0.005)
        pod = m.part(f'pod{i}', parent='turret', at=(0.0, 0.06, z))
        box(pod, P.trim_flat, (0.25, 0.094, 0.094), (0, 0, 0), bevel=0.017)
        box(pod, P.dark, (0.02, 0.072, 0.072), (0.116, 0, 0), bevel=0.003)
        for dy in (-0.02, 0.02):
            for dz in (-0.02, 0.02):
                cyl(pod, red, 0.012, 0.016, (0.128, dy, dz), ROT_X, seg=6, r2=0.005)
        deck_strips(m, pod, -0.125, 0.125, 0.047, 0.047, width=0.012)
        stripe(m, pod, (-0.06, 0.0475, 0), (0.05, 0.094), '+y', 0x26292e)
        rivet_row(m, pod, (-0.1, 0.0475, -0.03 * s), (0.08, 0.0475, -0.03 * s), facing='+y', spacing=0.03, size=0.01)
        m.muzzle(f'm{i}', (0.14, 0.06, z))
