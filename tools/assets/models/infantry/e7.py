"""Tanya: ponytail, team tank top, bare arms, khaki cargo trousers, crossed bandoliers, thigh holsters, twin pistols."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'e7'
FACTION = 'allies'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'allies', build=0.94)
    s.body(trousers=fabric(0x7a6a4c), bare_arms=True, gloves=False, collar=False)
    s.helmet('tanya')
    s.cross_straps(0x3a2c20, 0.01)
    s.belt(mat=leather(0x3a2c20))
    s.holsters()
    s.pistols()
    s.finish(set='pistol')
