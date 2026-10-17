"""Desert tree (umbrella acacia): a flat-topped umbrella crown ~1.1 wide on a crooked, forked trunk, dusty olive
foliage, ~1.1 tall."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nature import *  # noqa: E402,F401,F403

ID, FACTION, KIND = 'acacia', None, 'nature'
ATLAS = 512


def build(m):
    m.set_meta(height=1.1, radius=0.55)
    m.look(dirt_h=0.06, ao_distance=0.3)
    lv = leaves(dark=0x484c32, light=0x797c57, sun=0x99956f, seed=8, cells=30.0, inner=0.45)
    bk = bark(0x75604c, 0x3a2e24, seed=8)
    fork = (-0.02, 0.4, 0.02)
    trunk = ([(0, -0.03, 0), (0.0, 0.1, 0.0), (0.05, 0.25, -0.01), fork], [0.075, 0.062, 0.055, 0.05])
    limbs = [
        ([fork, (0.15, 0.58, 0.04), (0.3, 0.74, 0.08), (0.36, 0.84, 0.1)], [0.042, 0.032, 0.024, 0.016]),
        ([fork, (-0.14, 0.6, -0.06), (-0.27, 0.76, -0.12), (-0.32, 0.86, -0.13)], [0.04, 0.03, 0.022, 0.015]),
        ([fork, (0.0, 0.6, -0.12), (0.04, 0.78, -0.26), (0.05, 0.88, -0.3)], [0.034, 0.026, 0.02, 0.014]),
        ([fork, (-0.08, 0.6, 0.12), (-0.1, 0.78, 0.26), (-0.1, 0.86, 0.3)], [0.032, 0.025, 0.018, 0.013]),
    ]
    C = (0.0, 0.93, 0.0)
    sq = (1.0, 0.42, 1.0)
    clusters = [
        ((0.02, 0.98, 0.0), 0.3, sq),
        ((0.27, 0.94, 0.08), 0.28, sq),
        ((-0.26, 0.95, -0.08), 0.28, sq),
        ((0.02, 0.96, -0.27), 0.26, sq),
        ((-0.09, 0.93, 0.27), 0.25, sq),
        ((0.38, 0.9, -0.17), 0.18, sq),
        ((-0.4, 0.91, 0.17), 0.17, sq),
        ((0.2, 0.92, 0.3), 0.16, sq),
    ]
    broadleaf(m, trunk, limbs, clusters, (C, (0.58, 0.16, 0.58)), lv, bk, seed=8, flat=0.3, bottom=-0.2, lump=0.2)
