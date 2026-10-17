"""Soviet rifleman: SSh-40 helmet, team-coloured greatcoat over the gymnastyorka, belt with ammo pouches, a
veshmeshok sack and the rolled greatcoat (skatka) across the chest, AK."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'e1'
FACTION = 'soviet'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'soviet')
    s.body(coat=True, coat_len=0.098)
    s.helmet('ssh40')
    s.belt(y=0.214)
    s.pouches([(0.044, -0.026), (0.044, 0.026)], y=0.208)
    s.pack('soviet')
    s.skatka()
    s.rifle('ak')
    s.finish(set='rifle')
