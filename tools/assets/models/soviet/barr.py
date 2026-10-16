"""Soviet barracks (2x2): a two-storey ribbed block with lit dormitory windows, a projecting concrete portal
under a gold-star crest, two red banners and the СЛАВА СССР rooftop board, a guard post with a searchlight and a water
tank on the roof, sandbagged front yard, and the flag (part 'flag', waved by the game) on its pole at the back.
Pivots: node --import tsx tools/assets/rig.ts barr soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'barr'
FACTION = 'soviet'
KIND = 'structure'


def build(m):
    m.set_meta(footprint=(2, 2), height=1.15, radius=1.05)
    look(m, ao_dist=0.38)
    P = Pal()
    r = m.root

    foundation(m, r, P, 2.0, 2.0)
    slab(r, P.tar, -0.3, 0.3, Y0, Y0 + 0.01, 0.42, 0.98)

    # ---- main block
    bx, bz, bw, bd, bh = 0.0, -0.24, 1.56, 0.92, 0.74
    top, fz = hall(r, P, bx, bz, bw, bd, bh, wall=P.wall, parapet=0.045)
    x0, x1 = bx - bw / 2, bx + bw / 2
    # floor band between the storeys (dark steel), pilasters
    box(r, P.wall_dk, (bw + 0.012, 0.05, bd + 0.012), (bx, Y0 + 0.42, bz), bevel=0.006)
    pilasters(r, P.frame, [x0 + 0.03, -0.46, 0.46, x1 - 0.03], fz, Y0 + 0.13, top - 0.06, w=0.06, dz=0.045)
    # windows: two storeys in the outer bays, lit
    for s in (-1, 1):
        window_row(r, (s * 0.62, Y0 + 0.29, fz), 2, (0.085, 0.09), 0.05, dark=(0,) if s < 0 else (), strength=2.1)
        window_row(r, (s * 0.62, Y0 + 0.55, fz), 2, (0.085, 0.09), 0.05, dark=(1,) if s > 0 else (), strength=2.1)
    # banners between the portal and the windows, the board above the portal
    for s in (-1, 1):
        red_banner(m, r, (s * 0.365, top - 0.085, fz + 0.03), (0.2, 0.56))
    tilt_sign(m, r, P, (0, top + 0.05 + 0.13, fz - 0.1), (0.86, 0.24), 'СЛАВА СССР', tilt=0.5, lights=3)
    rivet_row(m, r, (x0 + 0.05, top - 0.17, fz), (x1 - 0.05, top - 0.17, fz))
    neon(r, -0.76, -0.47, top, fz)
    neon(r, 0.47, 0.76, top, fz)
    # sides: windows + a downpipe
    window_row(r, (x1, Y0 + 0.55, bz), 3, (0.08, 0.08), 0.12, facing='+x', dark=(1,), strength=1.5)
    window_row(r, (x0, Y0 + 0.55, bz), 3, (0.08, 0.08), 0.12, facing='-x', dark=(0, 2), strength=1.5)
    downpipe(r, P.steel, (x1 - 0.1, 0, fz), Y0 + 0.13, top - 0.05)

    # ---- entrance portal: projecting concrete, stepped top, heavy door, crest, lamps
    pz = fz + 0.11
    box(r, P.conc_lt, (0.46, 0.58, 0.22), (0, Y0 + 0.29, pz - 0.0), bevel=0.016)
    box(r, P.conc_lt, (0.38, 0.06, 0.2), (0, Y0 + 0.61, pz - 0.01), bevel=0.012)
    box(r, P.trim, (0.5, 0.035, 0.25), (0, Y0 + 0.575, pz), bevel=0.008)
    for s in (-1, 1):
        box(r, P.frame, (0.05, 0.56, 0.05), (s * 0.21, Y0 + 0.28, pz + 0.1), bevel=0.008)
    door(m, r, (0, Y0, pz + 0.11), (0.2, 0.3), kind='double', mat=painted(0x3f4a3a, wear=0.6, rust=0.3, panels=None))
    box(r, P.frame, (0.26, 0.03, 0.06), (0, Y0 + 0.335, pz + 0.12), bevel=0.004)
    crest(m, r, (0, Y0 + 0.45, pz + 0.111), 0.17)
    lamp(r, (-0.16, Y0 + 0.4, pz + 0.11), 0.016, 0xffe0b0, 'steady', facing='+z')
    lamp(r, (0.16, Y0 + 0.4, pz + 0.11), 0.016, 0xffe0b0, 'steady', facing='+z')
    for i in range(3):  # entrance steps
        box(r, P.conc, (0.3 - i * 0.04, 0.02, 0.06), (0, Y0 + 0.01 + i * 0.02, pz + 0.14 - i * 0.03), bevel=0.004)

    # ---- roof: corner lamps, guard post with searchlight, water tank, mast, AC, vents
    rt = top + 0.018
    roof_lights(r, x0 + 0.04, bz - bd / 2 + 0.04, x1 - 0.04, fz - 0.04, top + 0.045, r=0.02)
    gx, gz = -0.52, bz - 0.2
    box(r, P.wall_dk, (0.28, 0.2, 0.28), (gx, rt + 0.1, gz), bevel=0.014)
    box(r, P.void, (0.22, 0.05, 0.285), (gx, rt + 0.15, gz))
    box(r, P.void, (0.285, 0.05, 0.22), (gx, rt + 0.15, gz))
    box(r, P.roof, (0.33, 0.03, 0.33), (gx, rt + 0.215, gz), bevel=0.006)
    box(r, P.trim, (0.34, 0.025, 0.34), (gx, rt + 0.195, gz), bevel=0.004)
    lamp(r, (gx + 0.14, rt + 0.23, gz + 0.14), 0.018)
    # searchlight on the guard post (swept beam is the game's: here a lit lens)
    cyl(r, P.dark, 0.035, 0.05, (gx + 0.06, rt + 0.26, gz + 0.06), (0.9, 0.5, 0), seg=10)
    cyl(r, light_mat(0xfff2d6, 3.0, 'steady'), 0.03, 0.006, (gx + 0.075, rt + 0.278, gz + 0.085), (0.9, 0.5, 0), seg=10)
    # water tank on legs
    wx, wz = 0.44, bz - 0.24
    for (ddx, ddz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        bar(r, P.dark, (wx + ddx * 0.07, rt, wz + ddz * 0.07), (wx + ddx * 0.06, rt + 0.18, wz + ddz * 0.06), 0.016)
    cyl(r, P.wall_lt, 0.12, 0.17, (wx, rt + 0.265, wz), seg=14, bevel=0.008)
    cyl(r, P.trim, 0.123, 0.035, (wx, rt + 0.24, wz), seg=14, caps=False)
    lathe(r, P.wall_dk, [(0.125, 0.0), (0.09, 0.04), (0.0, 0.065)], (wx, rt + 0.35, wz), seg=14)
    m.decal(soviet_star(), at=(wx, rt + 0.29, wz + 0.121), size=(0.07, 0.07), facing='+z', part=r, depth=0.03, team=0)
    antenna(r, (0.68, rt, bz + 0.18), 0.5, light_color=None)
    lamp(r, (0.68, rt + 0.5, bz + 0.18), 0.018)
    ac_unit(r, (0.02, rt, bz - 0.2), 0.11, mat=P.wall_lt)
    roof_vent(r, (-0.2, rt, bz + 0.18), 0.035)
    roof_vent(r, (0.22, rt, bz + 0.2), 0.035)

    # ---- yard: sandbag walls, drums, crates, lamp post, flagpole
    sandbags(r, P, (-0.88, Y0, 0.78), (-0.36, Y0, 0.78), rows=3)
    sandbags(r, P, (0.36, Y0, 0.78), (0.88, Y0, 0.78), rows=3)
    sandbags(r, P, (-0.88, Y0, 0.5), (-0.88, Y0, 0.76), rows=2)
    drums(r, (0.78, Y0, 0.5), 3, colors=(0x4f5636, 0x4f5636, 0x7a1d16))
    crates(r, P, (-0.74, Y0, 0.46), 0.09, 3, 0.4)
    lamp_post(r, P, (0.88, Y0, 0.92), 0.4, yaw=math.pi / 2)
    # flagpole (back left) + the flag part (rest yaw from the procedural anim: the game drives it)
    cyl(r, P.steel, 0.014, 1.15, (-0.84, Y0 + 0.575, -0.84), r2=0.01, seg=6)
    box(r, P.conc_dk, (0.08, 0.04, 0.08), (-0.84, Y0 + 0.02, -0.84), bevel=0.006)
    sphere(r, metal(0xb08a3a, rough=0.35), 0.02, (-0.84, Y0 + 1.16, -0.84), seg=6, rings=4)
    f = m.part('flag', at=(-0.84, 1.14, -0.84))
    fl = cloth(team=True)
    box(f, fl, (0.32, 0.2, 0.008), (0.17, -0.1, 0))
    for (z, fc) in ((0.0045, '+z'), (-0.0045, '-z')):
        m.decal(soviet_star(), at=(0.07, -0.06, z), size=(0.08, 0.08), facing=fc, part=f, depth=0.006, team=0)
