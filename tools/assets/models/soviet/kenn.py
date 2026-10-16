"""Soviet kennel (1x1): a concrete kennel block under a steel gable roof with a red gable and gold star, three
arched dog doors with numbers, a chain-link dog run in front, a red lamp and a floodlight.
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
    m.set_meta(footprint=(1, 1), height=0.62, radius=0.5)
    look(edge=0.28, ao_dist=0.24)
    P = Pal()
    r = m.root
    foundation(m, r, P, 1.0, 1.0)
    kz, kw, kd, kh = -0.14, 0.72, 0.44, 0.3
    fz = kz + kd / 2
    box(r, P.conc_dk, (kw + 0.04, 0.05, kd + 0.04), (0, Y0 + 0.025, kz), bevel=0.01)
    box(r, P.wall, (kw, kh - 0.05, kd), (0, Y0 + 0.05 + (kh - 0.05) / 2, kz), bevel=0.014)
    box(r, P.trim, (kw + 0.02, 0.03, kd + 0.02), (0, Y0 + kh - 0.015, kz), bevel=0.006)
    # gable roof: red gable ends (prism), dark steel roof sheets, team ridge
    rise = 0.17
    prism(r, P.red, [(-kd / 2, 0.0), (kd / 2, 0.0), (0.0, rise)], kw - 0.02, (0, Y0 + kh, kz), rot=(0, -math.pi / 2, 0))
    L = math.hypot(kd / 2 + 0.05, rise)
    a = math.atan2(rise, kd / 2 + 0.05)
    for s in (-1, 1):
        box(r, corrugated(0x4e555c, along='y', pitch=0.03, rust=0.5, streaks=0.9), (kw + 0.08, 0.018, L + 0.01),
            (0, Y0 + kh + rise / 2 + 0.008, kz + s * (kd / 4 + 0.012)), (s * a, 0, 0))
    box(r, P.trim, (kw + 0.1, 0.03, 0.035), (0, Y0 + kh + rise + 0.012, kz), bevel=0.006)
    # front fascia: a red board with the star over the doors, banners at the corners
    sign(m, r, (0, Y0 + 0.262, fz + 0.03), (0.6, 0.085), 'K-9 UNIT', board=P.board, emblem='soviet')
    # dog doors: dark arched openings, team lintels, numbers
    for i in range(3):
        x = -0.23 + i * 0.23
        box(r, P.void, (0.11, 0.09, 0.01), (x, Y0 + 0.095, fz + 0.002))
        arch(r, P.void, 0.055, 0.01, (x, Y0 + 0.14, fz + 0.002), seg=6)
        box(r, P.frame, (0.15, 0.02, 0.025), (x, Y0 + 0.205, fz + 0.012), bevel=0.003)
        stencil(m, r, str(i + 1), (x + 0.075, Y0 + 0.17, fz + 0.002), 0.03)
    lamp(r, (kw / 2 - 0.03, Y0 + kh + 0.0, fz - 0.02), 0.018)
    box(r, P.dark, (0.05, 0.035, 0.03), (-kw / 2 + 0.06, Y0 + kh - 0.03, fz + 0.03), (0.3, 0.2, 0), bevel=0.004)
    box(r, light_mat(0xfff2d6, 3.0, 'steady'), (0.04, 0.025, 0.004), (-kw / 2 + 0.06, Y0 + kh - 0.035, fz + 0.047), (0.3, 0.2, 0))
    # dog run: posts, rails, chain-link panels (grille decal on thin panels)
    slab(r, P.sand, -0.42, 0.42, Y0, Y0 + 0.008, 0.1, 0.44)
    mesh = metal(0x4a4d52, rough=0.6)
    for i in range(6):
        bar(r, P.gun, (-0.42 + i * 0.168, Y0, 0.44), (-0.42 + i * 0.168, Y0 + 0.17, 0.44), 0.018)
    for s in (-1, 1):
        for i in range(3):
            bar(r, P.gun, (s * 0.42, Y0, 0.1 + i * 0.165), (s * 0.42, Y0 + 0.17, 0.1 + i * 0.165), 0.018)
    box(r, mesh, (0.84, 0.14, 0.004), (0, Y0 + 0.085, 0.44))
    m.decal(grille_img(aspect=0.84 / 0.14, n=6), at=(0, Y0 + 0.085, 0.442), size=(0.84, 0.14), facing='+z', part=r, depth=0.006)
    for s in (-1, 1):
        box(r, mesh, (0.004, 0.14, 0.34), (s * 0.42, Y0 + 0.085, 0.27))
    bar(r, P.gun, (-0.42, Y0 + 0.17, 0.44), (0.42, Y0 + 0.17, 0.44), 0.012)
    hazard_stripes(m, r, (0, Y0 + 0.02, 0.444), (0.3, 0.03))
    # bowls, a bone, sacks, a crate
    cyl(r, P.steel, 0.035, 0.022, (0.24, Y0 + 0.019, 0.28), r2=0.026, seg=10)
    cyl(r, P.red, 0.028, 0.004, (0.24, Y0 + 0.031, 0.28), seg=10, caps=False)
    box(r, P.white, (0.07, 0.013, 0.013), (-0.22, Y0 + 0.014, 0.3), (0, 0.5, 0), bevel=0.005)
    box(r, cloth(0x8a7a58), (0.09, 0.08, 0.11), (0.38, Y0 + 0.04, kz - 0.08), bevel=0.025)
    box(r, cloth(0x8a7a58), (0.09, 0.07, 0.11), (0.38, Y0 + 0.115, kz - 0.06), (0, 0.3, 0), bevel=0.025)
    crates(r, P, (-0.38, Y0, kz + 0.06), 0.09, 1)
