"""Landing ship, Allied dress (white star in the well deck, haze grey). See _lst.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lst import build_lst  # noqa: E402

ID = 'lst'
FACTION = 'allies'
KIND = 'naval'


def build(m):
    build_lst(m, FACTION)
