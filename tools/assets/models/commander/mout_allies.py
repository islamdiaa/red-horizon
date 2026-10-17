"""Mining outpost (mout), allies dress. See _mout.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _mout import build_mout  # noqa: E402

ID = 'mout'
FACTION = 'allies'
KIND = 'structure'
ATLAS = 512


def build(m):
    build_mout(m, FACTION)
