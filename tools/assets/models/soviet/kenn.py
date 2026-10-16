"""Soviet kennel (1x1): a low concrete kennel block under a steep (62 degree) team-red A-frame roof whose south
slope faces the RTS camera almost square-on and carries a big lit gold star (the slope stays clear of the
runtime snow), dark gable ends with vents, red ridge lamps, three arched dog doors under a red ПСАРНЯ board, a
chain-link dog run with a striped barrier, a lamp post and feed sacks.
Pivots: node --import tsx tools/assets/rig.ts kenn soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'kenn'
FACTION = 'soviet'
KIND = 'structure'


def build(m):
    m.set_meta(footprint=(1, 1), height=0.74, radius=0.5)
    look(m, ao_dist=0.26)
    P = Pal()
    r = m.root
    foundation(m, r, P, 1.0, 1.0)
    kz, kw, kd, kh = -0.17, 0.74, 0.42, 0.22
    fz = kz + kd / 2
    box(r, P.conc_dk, (kw + 0.05, 0.05, kd + 0.05), (0, Y0 + 0.025, kz), bevel=0.01)
    box(r, P.conc_lt, (kw, kh - 0.05, kd), (0, Y0 + 0.05 + (kh - 0.05) / 2, kz), bevel=0.012)
    for x in (-kw / 2 + 0.02, kw / 2 - 0.02):
        box(r, P.frame, (0.045, kh - 0.04, 0.045), (x, Y0 + 0.04 + (kh - 0.04) / 2, fz), bevel=0.006)
    # ---- the steep A-frame roof (team red), gold star on the camera-facing slope
    slope = math.radians(62)
    half = kd / 2 + 0.05
    rise = half * math.tan(slope)
    ye = Y0 + kh
    L = math.hypot(half, rise) + 0.02
    roof = team(wear=0.5, panels=(0.2, 0.1))
    for s in (-1, 1):
        box(r, roof, (kw + 0.1, 0.024, L), (0, ye + rise / 2, kz + s * half / 2), (s * slope, 0, 0), bevel=0.006)
    prism(r, P.wall_dk, [(-kd / 2, 0.0), (kd / 2, 0.0), (0.0, rise * kd / 2 / half)], kw - 0.01, (0, ye, kz), rot=(0, -math.pi / 2, 0))
    for sx in (-1, 1):
        vent(m, r, (sx * (kw / 2 - 0.004), ye + 0.09, kz), (0.1, 0.08), facing='+x' if sx > 0 else '-x')
    ry = ye + rise
    box(r, P.dark, (kw + 0.12, 0.035, 0.05), (0, ry + 0.005, kz), bevel=0.006)
    top_star(m, r, (0, ye + rise * 0.48, kz + half * 0.52), 0.27, facing='+z', emit=0.4, depth=0.16)
    for sx in (-1, 1):
        lamp(r, (sx * (kw / 2 + 0.03), ry + 0.02, kz), 0.024)
    box(r, P.dark, (0.05, 0.04, 0.05), (0.0, ry + 0.04, kz), bevel=0.004)
    cyl(r, light_mat(0xfff2d6, 3.0, 'steady'), 0.022, 0.012, (0.0, ry + 0.066, kz + 0.012), (0.6, 0, 0), seg=8)
    # ---- front: red board, dog doors, lintels, numbers
    sign(m, r, (0, Y0 + 0.19, fz + 0.03), (0.58, 0.07), 'ПСАРНЯ', board=P.board, emblem='soviet')
    for i in range(3):
        x = -0.22 + i * 0.22
        box(r, P.void, (0.1, 0.07, 0.01), (x, Y0 + 0.075, fz + 0.002))
        arch(r, P.void, 0.05, 0.01, (x, Y0 + 0.11, fz + 0.002), seg=6)
        stencil(m, r, str(i + 1), (x + 0.07, Y0 + 0.08, fz + 0.002), 0.03, color=0xf2b916)
    # ---- dog run: sand, posts, chain-link, a striped barrier at the gate, bowls, a lamp post
    slab(r, P.sand, -0.43, 0.43, Y0, Y0 + 0.008, fz + 0.04, 0.45)
    mesh = metal(0x4a4d52, rough=0.6)
    for i in range(6):
        bar(r, P.gun, (-0.43 + i * 0.172, Y0, 0.45), (-0.43 + i * 0.172, Y0 + 0.18, 0.45), 0.02)
    for s in (-1, 1):
        for i in range(3):
            bar(r, P.gun, (s * 0.43, Y0, fz + 0.06 + i * 0.13), (s * 0.43, Y0 + 0.18, fz + 0.06 + i * 0.13), 0.02)
        box(r, mesh, (0.004, 0.15, 0.4), (s * 0.43, Y0 + 0.09, (fz + 0.45) / 2))
    box(r, mesh, (0.5, 0.15, 0.004), (-0.18, Y0 + 0.09, 0.45))
    m.decal(grille_img(aspect=0.5 / 0.15, n=5), at=(-0.18, Y0 + 0.09, 0.452), size=(0.5, 0.15), facing='+z', part=r, depth=0.006)
    bar(r, P.gun, (-0.43, Y0 + 0.18, 0.45), (0.08, Y0 + 0.18, 0.45), 0.014)
    # gate barrier: red / white striped boom on a post (the gate is the right third)
    box(r, P.dark, (0.04, 0.1, 0.04), (0.38, Y0 + 0.05, 0.45), bevel=0.006)
    boom = painted(0xd8d4c8, wear=0.4, panels=None)
    box(r, boom, (0.32, 0.03, 0.03), (0.24, Y0 + 0.1, 0.45), bevel=0.006)
    for k in range(3):
        stripe(m, r, (0.13 + k * 0.1, Y0 + 0.1, 0.466), (0.045, 0.034), color=0xb31e17)
    lamp(r, (0.38, Y0 + 0.1, 0.45), 0.018)
    cyl(r, P.steel, 0.04, 0.024, (0.2, Y0 + 0.02, 0.3), r2=0.03, seg=10)
    cyl(r, P.red, 0.032, 0.004, (0.2, Y0 + 0.034, 0.3), seg=10, caps=False)
    box(r, P.white, (0.08, 0.016, 0.016), (-0.22, Y0 + 0.016, 0.3), (0, 0.5, 0), bevel=0.006)
    box(r, cloth(0x8a7a58), (0.1, 0.08, 0.12), (0.42, Y0 + 0.04, kz - 0.06), bevel=0.025)
    box(r, cloth(0x8a7a58), (0.1, 0.07, 0.12), (0.42, Y0 + 0.115, kz - 0.04), (0, 0.3, 0), bevel=0.025)
    lamp_post(r, P, (-0.44, Y0, -0.43), 0.46, yaw=0.0)
