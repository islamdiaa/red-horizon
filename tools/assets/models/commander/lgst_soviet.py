"""Logistics centre (lgst), soviet dress. See _lgst.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lgst import build_lgst  # noqa: E402

ID = 'lgst'
FACTION = 'soviet'
KIND = 'structure'
ATLAS = 768


def build(m):
    build_lgst(m, FACTION)
