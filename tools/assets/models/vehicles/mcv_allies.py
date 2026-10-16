"""Mobile construction vehicle (mcv), Allied dress: team paint with dark steel skirts. See _mcv.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _mcv import build_mcv  # noqa: E402

ID = 'mcv'
FACTION = 'allies'
KIND = 'vehicle'


def build(m):
    build_mcv(m, FACTION)
