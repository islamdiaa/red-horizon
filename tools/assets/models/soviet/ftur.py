"""Soviet flame tower (1x1): a tall tapered octagonal concrete bunker with team bands, firing slits and a sloped
front armour plate carrying a lit star, crowned by an open fire brazier whose glowing bowl (glow:pilot, flickered
by the game) reads from the RTS camera, four burner nozzles with pilot flames, red fuel tanks with white bands
on its back, the ОГОНЬ stencil, red drums; muzzle m0 above the bowl.
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
    m.set_meta(footprint=(1, 1), height=0.8, radius=0.5)
    look(m, ao_dist=0.26)
    P = Pal()
    r = m.root
    foundation(m, r, P, 1.0, 1.0)
    pilot = glow_material('glow:pilot', FIRE)
    oc = (0, math.pi / 8, 0)
    conc = deep(concrete(0x8e897f, joints=(0.3, 0.12), grime=0.85, streaks=1.0, wear=0.75), 0.8)
    # ---- tapered octagonal bunker (steep sides: no snow on them)
    H = 0.46
    lathe(r, conc, [(0.38, 0.0), (0.36, 0.1), (0.29, H), (0.0, H)], (0, Y0, 0), seg=8, rot=oc)
    cyl(r, P.trim, 0.37, 0.05, (0, Y0 + 0.07, 0), oc, r2=0.355, seg=8, caps=False)
    cyl(r, P.trim, 0.295, 0.045, (0, Y0 + H - 0.04, 0), oc, r2=0.29, seg=8, caps=False)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        nx, nz = math.sin(a), math.cos(a)
        box(r, P.void, (0.13, 0.034, 0.02), (nx * 0.322, Y0 + 0.3, nz * 0.322), (0, a, 0))
        box(r, P.frame, (0.16, 0.022, 0.05), (nx * 0.33, Y0 + 0.33, nz * 0.33), (0, a, 0), bevel=0.004)
    # sloped front armour plate with a lit star (60 degrees: faces the camera, no snow)
    slope_panel(r, P.wall_dk, (0, Y0 + 0.2, 0.345), 0.26, 0.24, slope=math.radians(62), t=0.03)
    top_star(m, r, (0, Y0 + 0.2, 0.36), 0.17, facing='+z', emit=0.4, depth=0.12)
    stencil(m, r, 'ОГОНЬ', (0, Y0 + 0.05, 0.4), 0.05, color=0xf2b916, depth=0.06)
    # ---- fuel tanks on the back, feed pipes
    for (x, z) in ((-0.31, -0.13), (-0.13, -0.31)):
        cyl(r, P.red, 0.08, 0.3, (x, Y0 + 0.17, z), seg=12, bevel=0.006)
        sphere(r, P.red, 0.08, (x, Y0 + 0.32, z), seg=12, rings=5)
        for y in (0.1, 0.24):
            cyl(r, P.white, 0.083, 0.025, (x, Y0 + y, z), seg=12, caps=False)
    pipe(r, P.steel, (-0.31, Y0 + 0.38, -0.13), (-0.13, Y0 + H + 0.06, -0.05), 0.018)
    pipe(r, P.steel, (-0.13, Y0 + 0.38, -0.31), (-0.05, Y0 + H + 0.06, -0.13), 0.018)
    # ---- the brazier: armoured collar, open bowl with a glowing interior, burners, pilots
    yb = Y0 + H
    cyl(r, P.gun, 0.25, 0.07, (0, yb + 0.035, 0), r2=0.24, seg=12, bevel=0.008)
    lathe(r, P.dark, [(0.24, 0.0), (0.26, 0.1), (0.25, 0.13), (0.2, 0.13)], (0, yb + 0.06, 0), seg=12, cap_top=False, cap_bottom=False, double=True)
    lathe_in(r, pilot, [(0.0, 0.03), (0.15, 0.06), (0.205, 0.13)], (0, yb + 0.06, 0), seg=12)  # the glowing bowl, seen over the rim
    cyl(r, P.red, 0.262, 0.03, (0, yb + 0.135, 0), seg=12, caps=False)
    for i in range(4):
        a = (i / 4) * math.pi * 2 + math.pi / 4
        x, z = math.cos(a), math.sin(a)
        cyl(r, P.dark, 0.026, 0.13, (x * 0.27, yb + 0.14, z * 0.27), (z * 0.6, 0, -x * 0.6), r2=0.034, seg=8)
        sphere(r, pilot, 0.022, (x * 0.31, yb + 0.2, z * 0.31), seg=6, rings=4)
    for i in range(8):
        a = (i / 8) * math.pi * 2
        box(r, pilot, (0.06, 0.022, 0.008), (math.cos(a) * 0.252, yb + 0.035, math.sin(a) * 0.252), (0, -a + math.pi / 2, 0))
    m.muzzle('m0', (0, 0.04 + 0.66, 0), part='root')
    lamp(r, (0.24, Y0 + H - 0.02, 0.2), 0.02)
    lamp(r, (-0.24, Y0 + H - 0.02, 0.2), 0.02)
    drums(r, (0.34, Y0, 0.32), 3, colors=(0x7a1d16, 0x7a1d16, 0x7a1d16))
