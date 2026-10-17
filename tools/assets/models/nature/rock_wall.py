"""rock_wall: see _rocks.wall (neutral light-grey stone: the game tints it per climate)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _rocks import *  # noqa: E402,F401,F403

ID, FACTION, KIND = 'rock_wall', None, 'nature'
ATLAS = 512


def build(m):
    wall(m, snow=False)
