"""Bunker (bnkr), allies dress. See _bnkr.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _bnkr import build_bnkr  # noqa: E402

ID = 'bnkr'
FACTION = 'allies'
KIND = 'defense'
ATLAS = 512


def build(m):
    build_bnkr(m, FACTION)
