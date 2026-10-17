"""Allied engineer: yellow hard hat, team overalls with hi-vis bands, tool belt, toolbox."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'e6'
FACTION = 'allies'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'allies')
    s.body(trousers=fabric(0x6a6048))
    s.helmet('hardhat')
    s.decal_band(0xd8b020, 0.262)
    s.decal_band(0xd8b020, 0.292)
    s.belt()
    s.pouches([(0.044, -0.03), (0.044, 0.03), (0.0, 0.062)], y=0.204, mat=leather(0x5a4430))
    s.held('toolbox', 'prop')
    s.finish(set='unarmed')
