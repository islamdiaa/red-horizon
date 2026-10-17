"""Spy: trench coat, fedora with a team band, a team tie, gloves, briefcase."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'spy'
FACTION = 'allies'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'allies')
    coat = fabric(0x8a8068)
    s.body(jacket=coat, trousers=fabric(0x3a3a3e), coat=True, coat_len=0.12, coat_mat=coat)
    s.helmet('fedora')
    s.m.decal(D.team_paint(0.9), at=(0.046, 0.285, 0.0), size=(0.01, 0.05), facing='+x', part='skin', depth=0.03, team=1)
    s.held('briefcase', 'prop')
    s.finish(set='unarmed')
