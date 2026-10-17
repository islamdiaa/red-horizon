"""Shock trooper: team gas-mask helmet, armoured vest and pauldrons, tesla backpack with copper coils, tesla gun."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'shok'
FACTION = 'soviet'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'soviet', build=1.04)
    s.body()
    s.helmet('gasmask')
    s.armour_vest()
    s.belt()
    s.tesla_pack()
    s.rifle('tesla')
    s.finish(set='rifle')
