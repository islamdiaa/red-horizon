"""Soviet rocket soldier: SSh-40, team tunic, RPG-7 with spare rockets in the back pack."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'e3'
FACTION = 'soviet'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'soviet')
    s.body(jacket_len=0.02)
    s.helmet('ssh40')
    s.belt()
    s.straps()
    s.pouches([(0.046, -0.026), (0.046, 0.026)], y=0.206)
    s.rockets_pack('soviet')
    s.launcher('rpg')
    s.finish(set='launcher')
