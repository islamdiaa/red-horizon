"""Soviet radar dome (2x2): a faceted white geodesic radome on a braced lattice tower with a railed platform
(back right), the search dish on its pedestal (part 'dish', spun by the game; back left), and the operations
block across the front: lit window band, VIGILANCE board, banner, antennas with red lamps.
Pivots: node --import tsx tools/assets/rig.ts dome soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'dome'
FACTION = 'soviet'
KIND = 'structure'


def build(m):
    m.set_meta(footprint=(2, 2), height=1.75, radius=1.05)
    look(edge=0.28, ao_dist=0.36)
    P = Pal()
    r = m.root
    foundation(m, r, P, 2.0, 2.0)

    # ---- operations block across the front
    bx, bz, bw, bd, bh = -0.12, 0.42, 1.56, 0.84, 0.52
    top, fz = hall(r, P, bx, bz, bw, bd, bh, wall=P.wall, parapet=0.04)
    x0, x1 = bx - bw / 2, bx + bw / 2
    pilasters(r, P.frame, [x0 + 0.03, x1 - 0.03], fz, Y0 + 0.13, top - 0.06, w=0.06, dz=0.045)
    glazing(m, r, (bx - 0.14, Y0 + 0.24, fz + 0.002), (0.86, 0.1), 8, 1, dark=0.35, seed=11, strength=1.6, t=0.16)
    box(r, P.frame, (0.9, 0.025, 0.04), (bx - 0.14, Y0 + 0.18, fz + 0.02), bevel=0.004)
    slogan(m, r, (bx - 0.14, Y0 + 0.4, fz + 0.03), (0.74, 0.17), 'VIGILANCE', lights=3, emblem='soviet')
    red_banner(m, r, (x0 + 0.13, top - 0.06, fz + 0.03), (0.17, 0.4))
    door(m, r, (bx + 0.56, Y0, fz), (0.16, 0.25), kind='double')
    lamp(r, (bx + 0.56, Y0 + 0.3, fz + 0.012), 0.015, 0xffe0b0, 'steady', facing='+z')
    rivet_row(m, r, (x0 + 0.05, top - 0.085, fz), (x1 - 0.05, top - 0.085, fz))
    neon(r, bx + 0.32, x1 - 0.06, top + 0.04, fz)
    roof_lights(r, x0 + 0.04, bz - bd / 2 + 0.04, x1 - 0.04, fz - 0.04, top + 0.04, r=0.02)
    rt = top + 0.018
    ac_unit(r, (bx - 0.5, rt, bz + 0.08), 0.1, mat=P.wall_lt)
    ac_unit(r, (bx - 0.2, rt, bz + 0.1), 0.09, mat=P.wall_lt)
    dish(r, (bx + 0.3, rt, bz + 0.15), 0.1, mat=P.white, yaw=-0.4, pitch=0.5)
    for (x, z, h) in ((bx + 0.62, bz - 0.25, 0.44), (bx + 0.5, bz - 0.3, 0.3)):
        antenna(r, (x, rt, z), h, light_color=None)
        lamp(r, (x, rt + h, z), 0.017)
    # side windows
    window_row(r, (x1, Y0 + 0.3, bz), 2, (0.08, 0.08), 0.14, facing='+x', strength=1.5)

    # ---- radome tower (back right)
    tx, tz, th = 0.32, -0.5, 1.06
    b0, b1 = 0.3, 0.12
    box(r, P.conc_dk, (0.72, 0.06, 0.72), (tx, Y0 + 0.03, tz), bevel=0.012)
    for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        bar(r, P.gun, (tx + b0 * sx, Y0 + 0.06, tz + b0 * sz), (tx + b1 * sx, Y0 + th, tz + b1 * sz), 0.036)
        box(r, P.conc, (0.1, 0.07, 0.1), (tx + b0 * sx, Y0 + 0.095, tz + b0 * sz), bevel=0.01)
    for i in range(4):
        f0, f1 = i / 4, (i + 1) / 4
        w0, w1 = b0 + (b1 - b0) * f0, b0 + (b1 - b0) * f1
        y1 = Y0 + 0.06 + (th - 0.06) * f0
        y2 = Y0 + 0.06 + (th - 0.06) * f1
        for s in (-1, 1):
            bar(r, P.steel, (tx - w0, y1, tz + w0 * s), (tx + w1, y2, tz + w1 * s), 0.012)
            bar(r, P.steel, (tx + w0 * s, y1, tz - w0), (tx + w1 * s, y2, tz + w1), 0.012)
        rm = P.trim if i in (1, 3) else P.frame
        for (a, b) in (((-w1, -w1), (w1, -w1)), ((-w1, w1), (w1, w1)), ((-w1, -w1), (-w1, w1)), ((w1, -w1), (w1, w1))):
            bar(r, rm, (tx + a[0] * 1.06, y2, tz + a[1] * 1.06), (tx + b[0] * 1.06, y2, tz + b[1] * 1.06), 0.026, 0.02)
    ladder(r, P.rail, (tx, Y0 + 0.06, tz + 0.2), th - 0.06, facing='+z', cage=True)
    # platform with railing
    py = Y0 + th
    cyl(r, P.wall_dk, 0.33, 0.06, (tx, py + 0.03, tz), r2=0.31, seg=16, bevel=0.008)
    cyl(r, P.trim, 0.335, 0.02, (tx, py + 0.01, tz), seg=16, caps=False)
    for k in range(12):
        a = (k / 12) * math.pi * 2
        bar(r, P.rail, (tx + math.cos(a) * 0.32, py + 0.06, tz - math.sin(a) * 0.32), (tx + math.cos(a) * 0.32, py + 0.13, tz - math.sin(a) * 0.32), 0.008)
    cyl(r, P.rail, 0.322, 0.008, (tx, py + 0.13, tz), seg=16, caps=False)
    # the radome: faceted (geodesic) white shell on a team-coloured collar
    cyl(r, P.trim, 0.27, 0.05, (tx, py + 0.085, tz), seg=16)
    rad_m = deep(painted(0xd8d6ce, wear=0.5, grime=0.75, rust=0.2, streaks=1.0, panels=None, rough=0.5), 0.8)
    geodesic(r, rad_m, P.wall_lt, 0.315, (tx, py + 0.33, tz), y_min=-0.2, gap=0.93)
    m.decal(big_star(), at=(tx, py + 0.4, tz + 0.29), size=(0.2, 0.2), facing='+z', part=r, depth=0.08, team=0)
    lamp(r, (tx, py + 0.64, tz), 0.022)
    for a in (0.6, 2.2, 3.8, 5.4):
        lamp(r, (tx + math.cos(a) * 0.31, py + 0.07, tz - math.sin(a) * 0.31), 0.016)

    # ---- search dish (back left): pedestal + the 'dish' part (game spins it around Y)
    px, pz = -0.56, -0.48
    box(r, P.wall_dk, (0.46, 0.13, 0.46), (px, Y0 + 0.065, pz), bevel=0.014)
    cyl(r, P.steel, 0.075, 0.33, (px, Y0 + 0.13 + 0.165, pz), r2=0.06, seg=10)
    box(r, P.wall, (0.2, 0.17, 0.18), (px + 0.12, Y0 + 0.21, pz + 0.12), bevel=0.012)
    grille(m, r, (px + 0.12, Y0 + 0.21, pz + 0.21), (0.15, 0.12))
    lamp(r, (px - 0.2, Y0 + 0.13, pz + 0.2), 0.016)
    d = m.part('dish', at=(-0.56, 0.52, -0.48))
    cyl(d, P.gun, 0.035, 0.08, (0, 0.0, 0), r2=0.03, seg=10)
    box(d, P.gun, (0.08, 0.04, 0.04), (0.0, 0.05, 0), bevel=0.006)
    rot = (0, 0, 1.15)
    lathe(d, P.white, [(0.0, 0.0), (0.1, 0.014), (0.18, 0.05), (0.25, 0.1), (0.24, 0.11), (0.17, 0.065), (0.09, 0.03)], (0.02, 0.12, 0), seg=16, rot=rot,
          cap_top=False, cap_bottom=False)
    from kit.core import T
    F = T((0.02, 0.12, 0), rot)
    a = F @ v3((0, 0.01, 0))
    b = F @ v3((0, 0.17, 0))
    cyl_between(d, P.dark, tuple(a), tuple(b), 0.007, seg=6)
    sphere(d, P.gun, 0.02, tuple(b), seg=8, rings=5)
    cyl(d, P.trim, 0.252, 0.016, tuple(F @ v3((0, 0.1, 0))), rot, seg=16, caps=False)
    lamp(d, (-0.07, 0.07, 0), 0.015)
    pipe_run(r, P.dark, [(px + 0.23, Y0 + 0.1, pz), (bx - 0.3, Y0 + 0.1, pz), (bx - 0.3, Y0 + 0.1, bz - bd / 2)], 0.022)

    # ---- yard: lamp post, a generator box, cable drums
    lamp_post(r, P, (0.86, Y0, 0.05), 0.42, yaw=math.pi)
    box(r, P.olive, (0.2, 0.14, 0.14), (0.86, Y0 + 0.07, -0.95 + 0.1), bevel=0.012)
    vent(m, r, (0.86, Y0 + 0.08, -0.85 + 0.07), (0.12, 0.08))
    cyl(r, painted(0x6a5236, wear=0.4, panels=None), 0.06, 0.05, (-0.95, Y0 + 0.06, -0.05), (math.pi / 2, 0, 0), seg=12)


def geodesic(p, mat, back, R, at, y_min=-1.0, gap=0.9, t=0.014):
    """Geodesic radome: one thin flat plate per icosphere (2 subdivisions) face over a dark backing sphere, so
    every facet catches light on its own and the seams read dark (smooth shading would hide the facets)."""
    import bmesh
    from mathutils import Matrix, Vector
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=R)
    tris = [[Vector(v.co) for v in f.verts] for f in bm.faces]
    bm.free()
    x0, y0, z0 = at
    sphere(p, back, R * 0.95, at, seg=12, rings=7)
    for vs in tris:
        # Blender's icosphere is Z-up: swap to the game frame (y up)
        vs = [Vector((v.x, v.z, -v.y)) for v in vs]
        c = (vs[0] + vs[1] + vs[2]) / 3
        if c.y < y_min:
            continue
        n = c.normalized()
        ex = (vs[0] - c).normalized()
        ey = n.cross(ex)
        M = Matrix((ex, ey, n)).transposed()
        pts = [((v - c).dot(ex) * gap, (v - c).dot(ey) * gap) for v in vs]
        if (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[0][0]) < 0:
            pts = pts[::-1]
        rot = M.to_euler('ZYX')
        cc = c - n * (t * 0.5)
        prism(p, mat, pts, t, (x0 + cc.x, y0 + cc.y, z0 + cc.z), rot=(rot.x, rot.y, rot.z))
