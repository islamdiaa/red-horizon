"""Chinook transport helicopter, Allied dress: team roof with the white star roundel over a dark gunmetal belly. See _chinook.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _chinook import build_tran  # noqa: E402

ID = 'tran'
FACTION = 'allies'
KIND = 'aircraft'


def build(m):
    build_tran(m, FACTION)
