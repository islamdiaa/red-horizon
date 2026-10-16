"""Soviet Iron Curtain (2x2): a stepped octagonal steel platform with a glowing red floor ring, four angular
pylons leaning in over it (team inlays, glowing red strips: glow:core), the suspended core (part 'core') in a
dark cage and the crossed emitter rings (part 'ring'), both driven by the game; the procedural halo effect is
kept. Front control consoles, banners on posts, corner warning lamps. Pivots: node --import tsx tools/assets/rig.ts iron soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'iron'
FACTION = 'soviet'
KIND = 'structure'

RED = 0xff2018


def build(m):
    m.set_meta(footprint=(2, 2), height=1.3, radius=1.05, keep=['fx:add:ff2018:1.0'])
    look(m, ao_dist=0.36)
    P = Pal()
    r = m.root
    foundation(m, r, P, 2.0, 2.0)
    oc = (0, math.pi / 8, 0)
    core_glow = glow_material('glow:core', RED)

    # ---- stepped octagonal platform
    cyl(r, P.wall_dk, 0.9, 0.1, (0, Y0 + 0.05, 0), oc, seg=8, bevel=0.014)
    for i in range(8):
        a = i * math.pi / 4
        m.decal(hazard_img(aspect=0.62 / 0.04), at=(math.sin(a) * 0.83, Y0 + 0.05, math.cos(a) * 0.83), size=(0.62, 0.04), facing=a, part=r, depth=0.05)
    cyl(r, P.wall, 0.68, 0.08, (0, Y0 + 0.14, 0), oc, seg=8, bevel=0.01)
    cyl(r, P.trim, 0.69, 0.025, (0, Y0 + 0.175, 0), oc, seg=8, caps=False)
    cyl(r, P.gun, 0.42, 0.05, (0, Y0 + 0.205, 0), oc, seg=8, bevel=0.008)
    cyl(r, core_glow, 0.48, 0.012, (0, Y0 + 0.186, 0), seg=24)
    cyl(r, P.dark, 0.36, 0.014, (0, Y0 + 0.234, 0), seg=16)
    for k in range(8):
        a = k * math.pi / 4 + math.pi / 8
        cx, cz = math.cos(a) * 0.82, -math.sin(a) * 0.82
        lamp(r, (cx, Y0 + 0.1, cz), 0.02, mode='blink' if k % 2 else 'pulse')

    # ---- four angular pylons leaning inward
    outline = [(-0.13, 0.0), (0.13, 0.0), (0.03, 1.06), (-0.06, 1.12), (-0.11, 0.5)]
    inlay = [(-0.05, 0.2), (0.07, 0.2), (0.01, 0.96), (-0.04, 0.96)]
    for i in range(4):
        a = (i / 4) * math.pi * 2 + math.pi / 4
        x, z = math.cos(a) * 0.62, math.sin(a) * 0.62
        rot = (0, -a, 0.12)
        prism(r, P.wall_dk, outline, 0.15, (x, Y0 + 0.1, z), rot=rot, bevel=0.012)
        prism(r, P.trim, inlay, 0.16, (x, Y0 + 0.1, z), rot=rot)
        from kit.core import T
        M = T((x, Y0 + 0.1, z), rot)
        a0 = M @ v3((-0.105, 0.3, 0.0))
        a1 = M @ v3((-0.055, 1.0, 0.0))
        bar(r, core_glow, tuple(a0), tuple(a1), 0.03, 0.17)
        # big glowing panel through the pylon (shows on both side faces, like the procedural one)
        Y = T((x, Y0 + 0.1, z), (0, -a, 0))
        pc = Y @ v3((0.04, 0.55, 0.0))
        box(r, core_glow, (0.014, 0.52, 0.172), tuple(pc), (0, -a, 0.17))
        c = M @ v3((-0.04, 1.14, 0.0))
        lamp(r, tuple(c), 0.02)
        foot = M @ v3((0.0, 0.0, 0.0))
        box(r, P.gun, (0.3, 0.08, 0.22), (foot.x, Y0 + 0.14, foot.z), (0, -a, 0), bevel=0.012)

    # ---- the suspended core (part 'core') and emitter rings (part 'ring'), at the procedural pivots
    core = m.part('core', at=(0, 0.79, 0))
    lathe(core, core_glow, [(0.0, -0.24), (0.16, 0.0), (0.0, 0.24)], (0, 0, 0), seg=4)
    for k in range(4):
        a = k * math.pi / 2
        bar(core, P.dark, (math.cos(a) * 0.11, -0.3, -math.sin(a) * 0.11), (math.cos(a) * 0.11, 0.3, -math.sin(a) * 0.11), 0.022)
    cyl(core, P.gun, 0.13, 0.03, (0, 0.31, 0), seg=8)
    cyl(core, P.gun, 0.13, 0.03, (0, -0.31, 0), seg=8)
    ring = m.part('ring', at=(0, 0.79, 0))
    sec = [(0.32 + math.cos(t) * 0.022, math.sin(t) * 0.03) for t in [k * math.pi / 2 for k in range(5)]]
    lathe(ring, P.trim, sec, (0, 0, 0), seg=24, rot=(math.pi / 2, 0, 0), cap_top=False, cap_bottom=False)
    lathe(ring, P.gun, sec, (0, 0, 0), seg=24, rot=(0, 0, math.pi / 2), cap_top=False, cap_bottom=False)

    # ---- front consoles, a crest, banners on posts, cable runs
    box(r, P.gun, (0.34, 0.13, 0.1), (0, Y0 + 0.065, 0.82), bevel=0.012)
    box(r, light_mat(RED, 2.4, 'pulse'), (0.26, 0.03, 0.005), (0, Y0 + 0.095, 0.872))
    crest(m, r, (0, Y0 + 0.1, 0.67), 0.11, facing='+z', depth=0.06)
    hazard_stripes(m, r, (0, Y0 + 0.03, 0.872), (0.3, 0.03))
    for s in (-1, 1):
        cyl(r, P.dark, 0.014, 0.74, (s * 0.86, Y0 + 0.37, 0.86), r2=0.011, seg=6)
        red_banner(m, r, (s * 0.86, Y0 + 0.72, 0.875), (0.18, 0.4))
        lamp(r, (s * 0.86, Y0 + 0.75, 0.86), 0.016)
        pipe_run(r, P.dark, [(s * 0.15, Y0 + 0.1, 0.78), (s * 0.4, Y0 + 0.1, 0.5), (s * 0.42, Y0 + 0.2, 0.42)], 0.014)
        yaw = s * 3 * math.pi / 4
        box(r, P.wall, (0.16, 0.18, 0.12), (s * 0.8, Y0 + 0.09, -0.8), (0, yaw, 0), bevel=0.01)
        vent(m, r, (s * (0.8 + 0.0425), Y0 + 0.1, -(0.8 + 0.0425)), (0.11, 0.09), facing=yaw)
