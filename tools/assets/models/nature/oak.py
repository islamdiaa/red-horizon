"""Temperate deciduous broadleaf (oak): a ~0.6 trunk forking into four limbs under a lumpy crown of leaf
clusters, ~0.95 wide and ~1.3 tall (vegetation.ts broadleafGeometry is the far LOD)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nature import *  # noqa: E402,F401,F403

ID, FACTION, KIND = 'oak', None, 'nature'
ATLAS = 512


def build(m):
    m.set_meta(height=1.3, radius=0.48)
    m.look(dirt_h=0.06, ao_distance=0.3)
    lv = leaves(dark=0x2f5224, light=0x52843a, sun=0x7ca24b, seed=3)
    bk = bark(0x66574a, 0x30261d, seed=3, moss=0x4f6030)
    fork = (0.02, 0.58, 0.0)
    trunk = ([(0, -0.03, 0), (0, 0.1, 0), (0.015, 0.35, 0.01), fork], [0.1, 0.082, 0.07, 0.06])
    limbs = [
        ([fork, (0.14, 0.72, 0.05), (0.27, 0.86, 0.09)], [0.05, 0.036, 0.02]),
        ([fork, (-0.1, 0.74, 0.08), (-0.24, 0.88, 0.15)], [0.048, 0.034, 0.02]),
        ([fork, (-0.03, 0.75, -0.12), (-0.06, 0.9, -0.26)], [0.046, 0.032, 0.018]),
        ([fork, (0.04, 0.82, 0.0), (0.03, 1.02, 0.02)], [0.045, 0.032, 0.018]),
    ]
    C = (0.0, 0.95, 0.0)
    clusters = [
        ((0.02, 1.04, 0.0), 0.29, (1.1, 0.82, 1.05)),
        ((0.26, 0.92, 0.08), 0.24, (1.0, 0.82, 1.0)),
        ((-0.24, 0.94, 0.15), 0.23, (1.0, 0.8, 1.0)),
        ((-0.06, 0.95, -0.26), 0.24, (1.0, 0.8, 1.0)),
        ((0.21, 0.86, -0.19), 0.2, (1.0, 0.85, 1.0)),
        ((-0.27, 0.82, -0.1), 0.19, (1.0, 0.85, 1.0)),
        ((0.07, 0.8, 0.27), 0.2, (1.0, 0.85, 1.0)),
        ((0.12, 1.14, 0.1), 0.17, (1.0, 0.9, 1.0)),
        ((-0.12, 1.12, -0.08), 0.17, (1.0, 0.9, 1.0)),
    ]
    broadleaf(m, trunk, limbs, clusters, (C, (0.5, 0.4, 0.5)), lv, bk, seed=3)
