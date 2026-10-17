"""Mechanic: team cap with goggles, grey overalls (team-tinted), tool belt, big wrench, oil can."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'mech'
FACTION = 'allies'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'allies')
    s.body(jacket=fabric(0x8a8e96, grime=0.5), trousers=fabric(0x6a6e78, grime=0.5))
    s.helmet('cap')
    s.m.decal(D.team_paint(1.0), at=(0.046, 0.276, 0.02), size=(0.02, 0.016), facing='+x', part='skin', depth=0.03, team=1)
    s.armband('l', team_=1, img=D.team_paint(1.0))
    s.belt(mat=leather(0x3a2c20))
    s.pouches([(0.044, -0.03), (0.0, 0.062)], y=0.204, mat=leather(0x5a4430))
    s.held('wrench')
    s.held('oilcan', 'prop')
    s.finish(set='unarmed')
