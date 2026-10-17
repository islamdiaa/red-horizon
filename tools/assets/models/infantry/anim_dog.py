"""The attack dog's clip set: baked into public/models/infantry/anim.dog.glb (kit.vat).
    node tools/assets/build.mjs anim.dog
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _dog  # noqa: E402

ID = 'anim.dog'
KIND = 'anim'
RIG = 'dog'


def clips():
    return _dog.clips()


def report():
    return {'ik_reach_mm': round(_dog.REACH['worst'] * 1000, 2), 'per_clip_mm': {k: round(v * 1000, 1) for k, v in _dog.PER_CLIP.items()}}
