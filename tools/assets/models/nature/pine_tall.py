"""Tall, narrow temperate conifer: six drooping tiers, ~1.9 tall, lowest tier radius ~0.42."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nature import *  # noqa: E402,F401,F403

ID, FACTION, KIND = 'pine_tall', None, 'nature'
ATLAS = 512


def build(m):
    m.set_meta(height=1.9, radius=0.42)
    m.look(dirt_h=0.06, ao_distance=0.3)
    nd = needles(dark=0x223e29, mid=0x375f3c, light=0x4a7645, fresh=0x638b4b, seed=2)
    conifer(m, H=1.9, R0=0.42, tiers=6, seed=2, n0=8, y0=0.34, needles_mat=nd, hk=0.92, sub=False)
