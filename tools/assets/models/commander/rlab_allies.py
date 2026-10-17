"""Research lab (rlab), allies dress. See _rlab.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _rlab import build_rlab  # noqa: E402

ID = 'rlab'
FACTION = 'allies'
KIND = 'structure'
ATLAS = 768


def build(m):
    build_rlab(m, FACTION)
