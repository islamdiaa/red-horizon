"""Landing ship, Soviet dress (gold star on a team disc in the well deck, darker blue-grey). See _lst.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lst import build_lst  # noqa: E402

ID = 'lst'
FACTION = 'soviet'
KIND = 'naval'


def build(m):
    build_lst(m, FACTION)
