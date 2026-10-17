"""Tall winter conifer heavily laden with snow (as pine_snow), ~1.9 tall, lowest tier radius ~0.42."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nature import *  # noqa: E402,F401,F403

ID, FACTION, KIND = 'pine_snow_tall', None, 'nature'
ATLAS = 512


def build(m):
    m.set_meta(height=1.92, radius=0.42)
    m.look(dirt_h=0.06, ao_distance=0.3)
    nd = needles(dark=0x1d372d, mid=0x305443, light=0x40674e, fresh=0x527652, seed=6)
    conifer(m, H=1.9, R0=0.42, tiers=6, seed=6, n0=8, y0=0.34, needles_mat=nd, snow='heavy', sub=False, hk=0.92)
