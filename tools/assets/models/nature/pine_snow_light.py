"""Lightly dusted winter conifer: mostly green, snow only on the top surfaces of the tiers. ~1.3 tall."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nature import *  # noqa: E402,F401,F403

ID, FACTION, KIND = 'pine_snow_light', None, 'nature'
ATLAS = 512


def build(m):
    m.set_meta(height=1.3, radius=0.44)
    m.look(dirt_h=0.06, ao_distance=0.3)
    nd = needles(dark=0x213c2d, mid=0x355942, light=0x466e4b, fresh=0x5d8150, dust=0.12, seed=7)
    conifer(m, H=1.3, R0=0.44, tiers=5, seed=7, n0=8, y0=0.3, needles_mat=nd, snow='light', hk=0.95, sub=False)
