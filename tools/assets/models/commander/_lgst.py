"""Logistics centre (3x2, Commander rules), shared by lgst_soviet.py / lgst_allies.py: a gabled warehouse with three
roller doors and the SUPPLY THE FRONT / LOGISTICS board, a container yard under a travelling gantry crane (part
'gantry' runs along the rails, its 'trolley' along the beam carrying a container: driven by the game), a repair
canopy over a vehicle lift with amber beacons and a wrench sign, fuel tanks and a comms mast.
Layout and pivots: src/render/models/commander-structures.ts logisticsCentre().
"""
import math

from _cmd import *  # noqa: F401,F403


def build_lgst(m, fac):
    D = Dress(fac)
    sov = D.sov
    D.look(m, ao_dist=0.38)
    m.set_meta(footprint=(3, 2), height=1.05, radius=1.6)
    r = m.root
    crane = D.yellow if sov else D.trim

    box(r, D.conc, (2.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)
    # ---- warehouse (back left), gable roof along x
    wx, wz, ww, wd, wh = -0.6, -0.42, 1.66, 0.92, 0.56
    top, fz = D.block(m, r, wx, wz, ww, wd, wh, wall=D.clad if sov else D.wall, roof=False, parapet=False)
    roof_m = D.roof
    prism(r, roof_m, [(-wd / 2 - 0.05, 0.0), (wd / 2 + 0.05, 0.0), (wd / 2 + 0.05, 0.02), (0.0, 0.25), (-wd / 2 - 0.05, 0.02)], ww + 0.08, (wx, top - 0.01, wz), (0, math.pi / 2, 0), bevel=0.006)
    box(r, D.trim, (ww + 0.1, 0.03, 0.05), (wx, top + 0.235, wz), bevel=0.006)
    for x in (wx - ww / 2 + 0.03, wx - 0.24, wx + 0.24, wx + ww / 2 - 0.03):
        box(r, D.frame, (0.05, wh - 0.14, 0.03), (x, Y0 + 0.1 + (wh - 0.14) / 2, fz + 0.012), bevel=0.006)
    for dx in (-0.48, 0.0, 0.48):
        door(m, r, (wx + dx, Y0, fz), (0.34, 0.34), kind='roller', hazard_frame=True)
        light(r, (wx + dx + 0.19, Y0 + 0.42, fz + 0.03), 0.013, 0xffa020, 'blink', facing='+z')
    D.slogan(m, r, (wx + 0.24, Y0 + 0.47, fz + 0.03), (0.62, 0.15), 'SUPPLY THE|FRONT', 'LOGISTICS', lights=2)
    stencil(m, r, '12' if sov else 'L-3', (wx - 0.72, Y0 + 0.45, fz + 0.002), 0.07, color=0xe8b434)
    D.corner_lamps(r, wx - ww / 2 + 0.04, wz - wd / 2 + 0.04, wx + ww / 2 - 0.04, fz - 0.04, top + 0.03)
    dish(r, (wx + 0.5, top + 0.12, wz - 0.12), 0.09, yaw=0.3, pitch=0.6)

    # ---- container yard (right) under the gantry crane
    yx = 0.92
    box(r, D.tar, (1.06, 0.012, 1.8), (yx, Y0 + 0.006, 0.0))
    team_c = team(wear=0.6, rust=0.3, panels=None)
    olive = painted(0x4f5636, wear=0.6, rust=0.35, panels=None)
    navy = painted(0x1d3a78, wear=0.6, rust=0.3, panels=None)
    rustc = painted(0x8a3a24, wear=0.6, rust=0.4, panels=None)
    for (x, y, z, mat) in ((yx - 0.18, 0.0, -0.62, team_c), (yx + 0.18, 0.0, -0.62, olive), (yx - 0.18, 0.16, -0.62, navy),
                           (yx - 0.18, 0.0, -0.2, rustc), (yx + 0.18, 0.0, -0.2, team_c), (yx + 0.18, 0.16, -0.2, olive),
                           (yx - 0.18, 0.0, 0.22, olive), (yx + 0.18, 0.0, 0.22, navy)):
        container(r, (x, Y0 + y, z), 0.38, mat, axis='z')
    for s in (-1, 1):
        bar(r, D.dark, (yx + s * 0.47, Y0 + 0.012, -0.88), (yx + s * 0.47, Y0 + 0.012, 0.88), 0.02, 0.012)
    g = m.part('gantry', at=(yx, Y0, -0.1))
    for s in (-1, 1):
        for zz in (-0.12, 0.12):
            box(g, crane, (0.05, 0.84, 0.05), (s * 0.47, 0.44, zz), bevel=0.006)
        box(g, D.dark, (0.08, 0.05, 0.34), (s * 0.47, 0.03, 0.0), bevel=0.006)
        box(g, crane, (0.04, 0.04, 0.24), (s * 0.47, 0.6, 0.0))
        for zz in (-0.12, 0.12):
            cyl(g, D.gun, 0.022, 0.03, (s * 0.47, 0.022, zz), (math.pi / 2, 0, 0), seg=10)
    for zz in (-0.1, 0.1):
        box(g, crane, (1.04, 0.08, 0.08), (0, 0.88, zz), bevel=0.008)
    hazard_stripes(m, g, (0, 0.88, 0.142), (0.9, 0.05))
    for x in (-0.5, 0.5):
        light(g, (x, 0.93, 0.0), 0.014, 0xffa020, 'blink')
    t = m.part('trolley', parent='gantry', at=(0, 0.9, 0))
    box(t, D.dark, (0.14, 0.07, 0.26), (0, 0.06, 0), bevel=0.008)
    box(t, glass(lit=0xcfe6ff), (0.08, 0.05, 0.012), (0, 0.06, 0.136))
    for x in (-0.04, 0.04):
        cyl(t, D.steel, 0.003, 0.4, (x, -0.2, 0), seg=4)
    box(t, D.yellow, (0.16, 0.025, 0.06), (0, -0.41, 0))
    container(t, (0, -0.6, 0), 0.36, team_c, axis='z')

    # ---- repair canopy (front left) over a vehicle lift
    px, pz = -0.62, 0.5
    for (dx, dz) in ((-0.42, -0.2), (0.42, -0.2), (-0.42, 0.34), (0.42, 0.34)):
        box(r, D.frame, (0.04, 0.42, 0.04), (px + dx, Y0 + 0.21, pz + dz), bevel=0.006)
    box(r, roof_m, (0.96, 0.03, 0.66), (px, Y0 + 0.43, pz + 0.07), (0.08, 0, 0), bevel=0.006)
    box(r, D.trim, (0.98, 0.045, 0.03), (px, Y0 + 0.43, pz + 0.41), bevel=0.006)
    box(r, D.yellow, (0.52, 0.03, 0.3), (px, Y0 + 0.08, pz + 0.04), bevel=0.006)
    for s in (-1, 1):
        box(r, D.dark, (0.03, 0.06, 0.26), (px + s * 0.2, Y0 + 0.04, pz + 0.04))
    hazard_stripes(m, r, (px, Y0 + 0.002, pz + 0.36), (0.86, 0.05), facing='+y')
    for x in (px - 0.4, px + 0.4):
        light(r, (x, Y0 + 0.46, pz + 0.4), 0.016, 0xffa020, 'blink')
    sign(m, r, (px, Y0 + 0.51, pz + 0.43), (0.24, 0.1), 'REPAIR' if not sov else 'РЕМОНТ', board=painted(0x26282c, panels=None), text_color=0xf2b916, lights=0)
    cyl(r, light_mat(0xfff2d6, 1.4, 'steady'), 0.05, 0.006, (px, Y0 + 0.41, pz + 0.04), seg=12)
    # fuel tanks, comms mast, lamp, crates
    tank = D.wall_lt if sov else AL.white(panels=None)
    for z in (0.3, 0.6):
        cyl(r, tank, 0.08, 0.36, (0.06, Y0 + 0.11, z), (0, 0, math.pi / 2), seg=14)
        cyl(r, D.trim, 0.083, 0.035, (0.0, Y0 + 0.11, z), (0, 0, math.pi / 2), seg=14, caps=False)
        for s in (-1, 1):
            box(r, D.frame, (0.04, 0.09, 0.13), (0.06 + s * 0.11, Y0 + 0.045, z))
    for (sx_, sz_) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        bar(r, D.dark, (0.12 + sx_ * 0.05, Y0, 0.86 + sz_ * 0.05), (0.12 + sx_ * 0.01, Y0 + 0.9, 0.86 + sz_ * 0.01), 0.012)
    for k in range(1, 5):
        y = Y0 + 0.9 * k / 5
        w = 0.05 - 0.04 * k / 5
        box(r, D.trim if k % 2 else D.white, (w * 2 + 0.01, 0.03, w * 2 + 0.01), (0.12, y, 0.86))
    light(r, (0.12, Y0 + 0.92, 0.86), 0.016, 0xff2a1a, 'blink')
    D.lamp_post(r, (-1.4, Y0, 0.88), 0.38, yaw=math.pi / 2)
    D.crates(r, (-1.3, Y0, 0.2), 0.08, 3, 0.2)
