"""Desert scrub tree / big dry bush: a dense, twiggy dry olive-brown shrub, ~0.7 tall, ~0.8 wide."""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nature import *  # noqa: E402,F401,F403

ID, FACTION, KIND = 'scrub', None, 'nature'
ATLAS = 512


def build(m):
    m.set_meta(height=0.7, radius=0.42)
    m.look(dirt_h=0.05, ao_distance=0.26)
    lv = leaves(dark=0x4d4832, light=0x7e7657, sun=0x958e6c, seed=9, cells=40.0, inner=0.5, twigs=0x4a3626)
    bk = bark(0x6e5642, 0x3a2b20, seed=9)
    stems = []
    for i, (x, z) in enumerate(((0.13, 0.08), (-0.12, 0.1), (0.02, -0.15), (-0.1, -0.08))):
        stems.append(([(x * 0.2, -0.02, z * 0.2), (x * 0.6, 0.1, z * 0.6), (x, 0.22, z)], [0.028, 0.022, 0.015]))
    C = (0.0, 0.35, 0.0)
    sq = (1.0, 0.75, 1.0)
    clusters = [
        ((0.0, 0.42, 0.0), 0.24, sq),
        ((0.22, 0.31, 0.08), 0.2, sq),
        ((-0.21, 0.32, -0.08), 0.2, sq),
        ((0.05, 0.33, -0.23), 0.19, sq),
        ((-0.06, 0.3, 0.23), 0.19, sq),
        ((0.12, 0.5, 0.1), 0.15, sq),
        ((-0.12, 0.47, -0.12), 0.14, sq),
    ]
    rng = random.Random(9)
    twigs = []
    for i in range(16):
        a = rng.random() * 6.28
        el = 0.2 + rng.random() * 0.9
        d = (math.cos(a) * math.cos(el), math.sin(el), math.sin(a) * math.cos(el))
        o = (0.0, 0.32, 0.0)
        r0, r1 = 0.18 + rng.random() * 0.08, 0.38 + rng.random() * 0.1
        twigs.append(((o[0] + d[0] * r0, o[1] + d[1] * r0 * 0.75, o[2] + d[2] * r0),
                      (o[0] + d[0] * r1, o[1] + d[1] * r1 * 0.8, o[2] + d[2] * r1), 0.009))
    # (the stems are the 'trunk' list of limbs; no single trunk)
    r = m.root
    for i, (pts, rad) in enumerate(stems):
        tube(r, bk, pts, rad, seg=4, cap=True, seed=90 + i)
    for i, (at, rr, s) in enumerate(clusters):
        clump(r, lv, at, rr, 900 + i, squash=s, lump=0.3, flat=0.4, bottom=-0.4, crown=(C, (0.42, 0.32, 0.42)),
              shade=0.86 + rng.random() * 0.28)
    for (a, b, w) in twigs:
        spike(r, bk, a, b, w)
