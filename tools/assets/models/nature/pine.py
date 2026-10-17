"""Temperate conifer (spruce / fir): five drooping tiers of jagged branch fronds over a short brown trunk.
~1.48 tall, lowest tier radius ~0.47 (matches vegetation.ts tieredPineGeometry, the far LOD)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nature import *  # noqa: E402,F401,F403

ID, FACTION, KIND = 'pine', None, 'nature'
ATLAS = 512


def build(m):
    m.set_meta(height=1.48, radius=0.47)
    m.look(dirt_h=0.06, ao_distance=0.3)
    conifer(m, H=1.48, R0=0.47, tiers=5, seed=1, n0=9, sub=False)
