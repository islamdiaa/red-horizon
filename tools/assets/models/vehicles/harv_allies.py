"""Ore truck (harv), Allied dress: team paint with dark steel bin panels. See _harv.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harv import build_harv  # noqa: E402

ID = 'harv'
FACTION = 'allies'
KIND = 'vehicle'


def build(m):
    build_harv(m, FACTION)
