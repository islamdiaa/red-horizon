"""rock_wall_snow: see _rocks.wall with snow on the flat tops and ledges (thick on top, a dusting on the ledges)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _rocks import *  # noqa: E402,F401,F403

ID, FACTION, KIND = 'rock_wall_snow', None, 'nature'
ATLAS = 512


def build(m):
    wall(m, snow=True)
