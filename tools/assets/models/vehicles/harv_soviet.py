"""Ore truck (harv), Soviet dress: olive drab with team bin panels. See _harv.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harv import build_harv  # noqa: E402

ID = 'harv'
FACTION = 'soviet'
KIND = 'vehicle'


def build(m):
    build_harv(m, FACTION)
