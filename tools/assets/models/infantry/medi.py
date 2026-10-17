"""Allied field medic: white helmet with red crosses, team jacket under a white tabard with crosses, red-cross armband, medkit."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'medi'
FACTION = 'allies'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'allies')
    s.body()
    s.helmet('medic')
    s.apron(0xe4e0d8)
    s.chest_patch(red_cross(), at=(0.05, 0.272, 0.0), size=0.036)
    s.armband('l', img=red_cross())
    s.belt()
    s.held('medkit', 'prop')
    s.muzzle('m0', (0.004, 0.0, 0.0))  # the healing glow starts at the right hand
    s.finish(set='unarmed')
