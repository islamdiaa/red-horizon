"""Winter conifer heavily laden with snow: white mantles on the upper side of every tier, the dark green
undersides and branch tips still showing. ~1.48 tall, lowest tier radius ~0.47."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nature import *  # noqa: E402,F401,F403

ID, FACTION, KIND = 'pine_snow', None, 'nature'
ATLAS = 512


def build(m):
    m.set_meta(height=1.5, radius=0.47)
    m.look(dirt_h=0.06, ao_distance=0.3)
    nd = needles(dark=0x1e382d, mid=0x325642, light=0x43694d, fresh=0x557952, seed=5)
    conifer(m, H=1.48, R0=0.47, tiers=5, seed=5, n0=9, needles_mat=nd, snow='heavy', sub=False)
