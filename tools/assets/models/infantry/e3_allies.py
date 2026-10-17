"""Allied rocket soldier: M1 helmet, team field jacket, webbing, Dragon launcher with its tracker, missile pack."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'e3'
FACTION = 'allies'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'allies')
    s.body()
    s.helmet('m1')
    s.belt()
    s.straps()
    s.pouches([(0.046, -0.024), (0.046, 0.024)], y=0.206)
    s.rockets_pack('allied')
    s.launcher('dragon')
    s.finish(set='launcher')
