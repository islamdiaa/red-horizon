"""Temperate deciduous (linden / lime): a taller, oval crown of stacked leaf clusters on a straight trunk with
a central leader, ~1.5 tall and ~0.8 wide, slightly yellower green than the oak."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nature import *  # noqa: E402,F401,F403

ID, FACTION, KIND = 'linden', None, 'nature'
ATLAS = 512


def build(m):
    m.set_meta(height=1.5, radius=0.41)
    m.look(dirt_h=0.06, ao_distance=0.3)
    lv = leaves(dark=0x385722, light=0x5d8938, sun=0x8baa4d, seed=4, cells=26.0)
    bk = bark(0x6a6056, 0x322b25, seed=4)
    trunk = ([(0, -0.03, 0), (0, 0.1, 0), (0.01, 0.4, 0.0), (0.0, 0.62, 0.01), (0.0, 1.2, 0.0)],
             [0.085, 0.07, 0.06, 0.05, 0.022])
    limbs = [
        ([(0.0, 0.55, 0.0), (0.12, 0.68, 0.05), (0.2, 0.8, 0.08)], [0.035, 0.025, 0.015]),
        ([(0.0, 0.6, 0.0), (-0.1, 0.72, -0.06), (-0.17, 0.86, -0.1)], [0.034, 0.024, 0.015]),
        ([(0.0, 0.75, 0.0), (-0.06, 0.88, 0.12), (-0.1, 1.0, 0.17)], [0.03, 0.022, 0.014]),
    ]
    C = (0.0, 1.0, 0.0)
    clusters = [((0.0, 1.32, 0.0), 0.19, (1.0, 1.0, 1.0))]
    for i, (yy, rr, k, n, ph) in enumerate(((1.12, 0.17, 0.22, 3, 0.3), (0.9, 0.2, 0.23, 4, 1.1), (0.7, 0.14, 0.2, 3, 2.0))):
        for j in range(n):
            a = ph + 2 * math.pi * j / n
            clusters.append(((math.cos(a) * rr, yy + 0.03 * math.sin(3 * a), math.sin(a) * rr), k, (1.0, 1.1, 1.0)))
    broadleaf(m, trunk, limbs, clusters, (C, (0.42, 0.58, 0.42)), lv, bk, seed=4)
