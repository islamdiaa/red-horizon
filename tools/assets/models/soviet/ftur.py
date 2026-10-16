"""Soviet flame tower (1x1): a tapered octagonal concrete bunker with team bands and firing slits, two red
fuel tanks strapped to its back, the armoured nozzle head with four burners and glowing pilot flames / vent
slots (glow:pilot), the muzzle m0 on top, a crest, ОГОНЬ stencil, red drums.
Pivots: node --import tsx tools/assets/rig.ts ftur soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'ftur'
FACTION = 'soviet'
KIND = 'defense'

FIRE = 0xff6a1a


def build(m):
    m.set_meta(footprint=(1, 1), height=0.75, radius=0.5)
    look(edge=0.28, ao_dist=0.24)
    P = Pal()
    r = m.root
    foundation(m, r, P, 1.0, 1.0)
    pilot = glow_material('glow:pilot', FIRE)
    y0 = 0.04
    # ---- tapered octagonal bunker
    conc = deep(concrete(0x8a857c, joints=(0.3, 0.12), grime=0.85, streaks=1.0, wear=0.75), 0.82)
    lathe(r, conc, [(0.37, 0.0), (0.35, 0.12), (0.28, 0.36), (0.26, 0.44), (0.0, 0.44)], (0, Y0, 0), seg=8, rot=(0, math.pi / 8, 0))
    cyl(r, P.trim, 0.355, 0.045, (0, Y0 + 0.085, 0), (0, math.pi / 8, 0), r2=0.345, seg=8, caps=False)
    cyl(r, P.trim, 0.272, 0.04, (0, Y0 + 0.4, 0), (0, math.pi / 8, 0), r2=0.265, seg=8, caps=False)
    # firing slits (dark) with a faint inner glow
    for k in range(4):
        a = k * math.pi / 2
        nx, nz = math.sin(a), math.cos(a)
        rr = 0.3
        box(r, P.void, (0.14, 0.035, 0.02), (nx * rr, Y0 + 0.27, nz * rr), (0, a, 0))
        box(r, P.frame, (0.17, 0.02, 0.05), (nx * (rr + 0.01), Y0 + 0.3, nz * (rr + 0.01)), (0, a, 0), bevel=0.004)
    crest(m, r, (0, Y0 + 0.18, 0.325), 0.12, depth=0.06)
    stencil(m, r, 'ОГОНЬ', (0, Y0 + 0.045, 0.37), 0.045, color=0xf2b916, depth=0.05)
    hazard_stripes(m, r, (0, Y0 + 0.2, -0.31), (0.25, 0.04), facing='-z')
    # ---- fuel tanks on the back, feed pipes
    for (x, z) in ((-0.3, -0.12), (-0.12, -0.3)):
        cyl(r, P.red, 0.072, 0.28, (x, Y0 + 0.16, z), seg=12, bevel=0.006)
        sphere(r, P.red, 0.072, (x, Y0 + 0.3, z), seg=12, rings=5)
        for y in (0.1, 0.22):
            cyl(r, P.dark, 0.076, 0.02, (x, Y0 + y, z), seg=12, caps=False)
    pipe(r, P.steel, (-0.3, Y0 + 0.36, -0.12), (-0.12, Y0 + 0.46, -0.05), 0.016)
    pipe(r, P.steel, (-0.12, Y0 + 0.36, -0.3), (-0.05, Y0 + 0.46, -0.12), 0.016)
    # ---- nozzle head: armoured collar, cap, four burners, pilots, glowing vent slots
    cyl(r, P.gun, 0.17, 0.08, (0, Y0 + 0.48, 0), r2=0.16, seg=12, bevel=0.008)
    lathe(r, P.dark, [(0.165, 0.0), (0.13, 0.08), (0.06, 0.13), (0.0, 0.14)], (0, Y0 + 0.52, 0), seg=12)
    for i in range(4):
        a = (i / 4) * math.pi * 2 + math.pi / 4
        x, z = math.cos(a), math.sin(a)
        cyl(r, P.dark, 0.024, 0.13, (x * 0.17, Y0 + 0.56, z * 0.17), (z * 0.9, 0, -x * 0.9), r2=0.032, seg=8)
        sphere(r, pilot, 0.018, (x * 0.22, Y0 + 0.6, z * 0.22), seg=6, rings=4)
    for i in range(8):
        a = (i / 8) * math.pi * 2
        box(r, pilot, (0.05, 0.02, 0.008), (math.cos(a) * 0.205, Y0 + 0.48, math.sin(a) * 0.205), (0, -a + math.pi / 2, 0))
    m.muzzle('m0', (0, y0 + 0.66, 0), part='root')
    lamp(r, (0.2, Y0 + 0.44, 0.18), 0.018)
    lamp(r, (-0.2, Y0 + 0.44, -0.18), 0.018)
    drums(r, (0.32, Y0, 0.3), 3, colors=(0x7a1d16, 0x7a1d16, 0x7a1d16))
