"""Minelayer (mnly), Allied dress: team paint with camouflage, AT mines. See _mnly.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _mnly import build_mnly  # noqa: E402

ID = 'mnly'
FACTION = 'allies'
KIND = 'vehicle'


def build(m):
    build_mnly(m, FACTION)
