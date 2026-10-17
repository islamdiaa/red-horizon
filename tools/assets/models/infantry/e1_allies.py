"""Allied rifleman: M1 helmet with a camouflage band, team-coloured field jacket, webbing (suspenders, belt with
ammo pouches, canteen), a small pack with a bedroll, M16."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'e1'
FACTION = 'allies'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'allies')
    s.body()
    s.helmet('m1')
    s.belt()
    s.straps()
    s.pouches([(0.046, -0.024), (0.046, 0.024), (0.03, -0.048)], y=0.206)
    s.canteen()
    s.pack('allied')
    s.rifle('m16')
    s.finish(set='rifle')
