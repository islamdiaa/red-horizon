"""Thief: black beanie, dark clothes, a team bandana over the face and a team armband, loot sack, crowbar."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'thf'
FACTION = 'allies'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'allies')
    s.body(jacket=fabric(0x2a2c30), trousers=fabric(0x232427))
    s.helmet('beanie')
    s.mask(fabric(0xb4b4b4, team=True))
    s.armband('l', team_=1, img=D.team_paint(1.0))
    s.cross_straps(0x3a3226, 0.01)
    s.loot_sack()
    s.held('crowbar')
    s.finish(set='unarmed')
