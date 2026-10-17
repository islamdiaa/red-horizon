"""Chinook transport helicopter, Soviet dress: team roof with darker team camouflage and the gold star on a team disc over an olive belly. See _chinook.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _chinook import build_tran  # noqa: E402

ID = 'tran'
FACTION = 'soviet'
KIND = 'aircraft'


def build(m):
    build_tran(m, FACTION)
