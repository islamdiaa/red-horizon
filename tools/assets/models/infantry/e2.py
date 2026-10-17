"""Soviet grenadier: ushanka, team greatcoat, a grenade bandolier across the chest, satchel, grenade in the hand."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'e2'
FACTION = 'soviet'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'soviet')
    s.body(coat=True, coat_len=0.09)
    s.helmet('ushanka')
    s.belt(y=0.214)
    s.grenades(4)
    s.cross_straps(WEB_SOV)
    s.satchel(0.06)
    s.pack('soviet')
    s.held('grenade')
    s.finish(set='grenade')
