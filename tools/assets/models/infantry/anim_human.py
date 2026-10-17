"""The humanoid clip set (every soldier type): baked into public/models/infantry/anim.human.glb (kit.vat).
    node tools/assets/build.mjs anim.human            # (--preview writes a stick-figure contact sheet)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _clips  # noqa: E402

ID = 'anim.human'
KIND = 'anim'
RIG = 'human'


def clips():
    return _clips.clips()


def report():
    bad = {k: round(v * 1000, 1) for k, v in sorted(_clips.PER_CLIP.items(), key=lambda kv: -kv[1]) if v > 0.003}
    return {'ik_reach_mm': round(_clips.REACH['worst'] * 1000, 2), 'over_3mm': bad}
