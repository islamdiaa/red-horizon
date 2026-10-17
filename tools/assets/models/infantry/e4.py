"""Soviet flamethrower: gas-mask helmet, fireproof apron over the team tunic, twin fuel tanks and the wand."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _soldier import *  # noqa: E402,F401,F403

ID = 'e4'
FACTION = 'soviet'
KIND = 'infantry'


def build(m):
    s = Soldier(m, 'soviet')
    s.body()
    s.helmet('gasmask')
    s.apron()
    s.belt()
    s.flamer()
    s.finish(set='flamer')
