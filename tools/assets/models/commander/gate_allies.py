"""Fortress gate (gate), allies dress. See _gate.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _gate import build_gate  # noqa: E402

ID = 'gate'
FACTION = 'allies'
KIND = 'defense'
ATLAS = 512


def build(m):
    build_gate(m, FACTION)
