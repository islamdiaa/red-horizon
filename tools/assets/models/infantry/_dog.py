"""Attack dog: pose builder and clips for the quadruped rig (kit.rig.DOG). Baked into anim.dog.glb by anim_dog.py.

Clips: dog.idle (panting, tail wag, looking around), dog.walk (trot: diagonal pairs), dog.run (rotary gallop with
spine flex), dog.bite (crouch, lunge with the jaws open, snap, recover), dog.death / dog.death2 (collapse on the
side / a yelping flip). Strides in model units per cycle (the game draws dogs at 1.2x).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit.anim import TAU, Clip, Keys, M4, V, clamp, ik2, kick, lean, noise1, rx, ry, rz, smooth  # noqa: E402
from kit.rig import DOG, I3, frame_rot  # noqa: E402
from mathutils import Vector  # noqa: E402

SK = DOG
P = SK.pos
REACH = {'worst': 0.0}
PER_CLIP = {}
_CUR = ['']
HIPS_Y = P('hips').y
GROUND = 0.0
PAW_H = 0.016  # carpus / hock height over the ground when planted
# trot and gallop: seconds per cycle, model units per cycle (a planted paw sweeps about +-30 degrees)
WALK_T, WALK_S = 0.32, 0.18
RUN_T, RUN_S = 0.26, 0.34


class DogBody:
    def __init__(self):
        self.W = {}
        self.R = {}

    def _place(self, name, parent, rot):
        off = P(name) - P(parent)
        p = self.W[parent].translation + self.R[parent] @ off
        self.R[name] = rot
        self.W[name] = M4(p, rot)
        return p

    def torso(self, hips_pos, hips_rot=I3, spine=I3, chest=I3, neck=I3, head=I3, jaw=I3, tail=I3, tail2=I3):
        self.R['hips'] = hips_rot
        self.W['hips'] = M4(V(hips_pos), hips_rot)
        self._place('spine', 'hips', hips_rot @ spine)
        self._place('chest', 'spine', self.R['spine'] @ chest)
        self._place('neck', 'chest', self.R['chest'] @ neck)
        self._place('head', 'neck', self.R['neck'] @ head)
        self._place('jaw', 'head', self.R['head'] @ jaw)
        self._place('tail', 'hips', hips_rot @ tail)
        self._place('tail2', 'tail', self.R['tail'] @ tail2)

    def leg(self, front, side, paw, paw_rot=None):
        """Two-bone IK to the carpus / hock `paw` target; front elbows bend back, hind knees forward."""
        pre = ('f' if front else 'h')
        up, lo, pw = pre + 'leg_' + side, pre + 'shin_' + side, pre + 'paw_' + side
        parent = 'chest' if front else 'hips'
        root = self.W[parent].translation + self.R[parent] @ (P(up) - P(parent))
        l1 = (P(lo) - P(up)).length
        l2 = (P(pw) - P(lo)).length
        fwd = self.R[parent] @ Vector((1, 0, 0))
        pole = -fwd if front else fwd
        mid, end = ik2(root, l1, l2, V(paw), pole)
        e = (end - V(paw)).length
        REACH['worst'] = max(REACH['worst'], e)
        PER_CLIP[_CUR[0]] = max(PER_CLIP.get(_CUR[0], 0.0), e)
        ax = Vector((0, 0, 1))
        r1 = frame_rot((P(lo) - P(up)).normalized(), ax, (mid - root).normalized(), self.R[parent] @ ax)
        r2 = frame_rot((P(pw) - P(lo)).normalized(), ax, (end - mid).normalized(), self.R[parent] @ ax)
        self.R[up], self.W[up] = r1, M4(root, r1)
        self.R[lo], self.W[lo] = r2, M4(mid, r2)
        pr = paw_rot if paw_rot is not None else ry(0) @ self.R[parent].copy()
        self.R[pw], self.W[pw] = pr, M4(end, pr)

    def pose(self):
        for n in SK.names:
            if n not in self.W:
                raise KeyError(n)
        return dict(self.W)


def rest_paw(front, side):
    pre = ('f' if front else 'h')
    return P(pre + 'paw_' + side)


def stand_legs(b, t=0.0, spread=0.0):
    for front in (True, False):
        for side in ('l', 'r'):
            p = rest_paw(front, side)
            b.leg(front, side, (p.x + (0.004 if front else -0.004), PAW_H, p.z * (1 + spread)), ry(0.0))


def c_idle(t):
    br = math.sin(t * TAU / 1.0)  # panting: fast shallow breaths
    look = Keys([(0.0, 0.0), (0.8, 0.0), (1.2, 0.5), (2.0, 0.5), (2.4, -0.4), (3.2, -0.4), (3.6, 0.0), (4.0, 0.0)])(t)
    b = DogBody()
    b.torso(V(P('hips').x, HIPS_Y - 0.004 + br * 0.0015, 0.0), lean(-0.02), spine=lean(0.01 * br), chest=lean(-0.01 * br),
            neck=ry(look * 0.4) @ lean(-0.1), head=ry(look * 0.5) @ lean(0.12 + 0.03 * math.sin(t * TAU / 2.0)), jaw=rz(-0.18 - 0.1 * (0.5 + 0.5 * br)),
            tail=ry(0.5 * math.sin(t * TAU * 1.5)) @ rz(0.5), tail2=ry(0.4 * math.sin(t * TAU * 1.5 - 0.8)))
    stand_legs(b, t)
    return b.pose()


def gait(t, period, stride, phases, lift, bob, flex, head_bob, gallop=False, st=0.5):
    """phases: per leg (lf, rf, lh, rh) the phase offset of its stance start; stance fraction depends on the gait."""
    ph = (t / period) % 1.0
    travel = stride * st
    b = DogBody()
    sp = math.sin(TAU * ph)
    sp2 = math.sin(TAU * 2 * ph)
    hy = HIPS_Y - 0.004 + bob * (math.cos(TAU * 2 * ph) if not gallop else math.sin(TAU * ph + 0.6))
    b.torso(V(P('hips').x, hy, 0.0), lean(0.06 * sp if gallop else 0.0) @ rx(0.04 * sp),
            spine=lean(-flex * sp), chest=lean(flex * sp * 0.8),
            neck=lean(-0.18 + head_bob * sp2), head=lean(0.2 - head_bob * sp2 * 0.6), jaw=rz(-0.25 if gallop else -0.12),
            tail=rz(0.6 if gallop else 0.4) @ ry(0.2 * math.sin(TAU * ph)), tail2=rz(0.2) @ ry(0.15 * math.sin(TAU * ph - 0.9)))
    legs = [('l', True), ('r', True), ('l', False), ('r', False)]
    for (side, front), off in zip(legs, phases):
        p = (ph - off) % 1.0
        rp = rest_paw(front, side)
        if p < st:
            k = p / st
            x = travel * (0.5 - k)
            y = 0.0
        else:
            k = (p - st) / (1 - st)
            x = travel * (-0.5 + smooth(k))
            y = lift * math.sin(math.pi * k) * (1.2 if not front else 1.0)
        b.leg(front, side, (rp.x + x, PAW_H + y, rp.z * 0.85), ry(0.0) @ lean(-0.3 * math.sin(math.pi * clamp((p - st) / (1 - st), 0, 1)) if p >= st else 0.0))
    return b.pose()


def c_walk(t):
    return gait(t, WALK_T, WALK_S, (0.0, 0.5, 0.5, 0.0), 0.022, 0.003, 0.03, 0.03, st=0.5)


def c_run(t):
    # rotary gallop: lead legs fall close after their pair
    return gait(t, RUN_T, RUN_S, (0.0, 0.1, 0.55, 0.65), 0.04, 0.012, 0.22, 0.08, gallop=True, st=0.3)


def c_bite(t):
    """Crouch, lunge with the jaws wide (the hit at ~0.18 s), snap shut, pull back (0.6 s)."""
    lunge = Keys([(0.0, 0.0), (0.08, -0.4), (0.2, 1.0, 'out'), (0.32, 0.9), (0.6, 0.0)])(t)
    jaw = Keys([(0.0, 0.1), (0.1, 0.6), (0.18, 0.75), (0.22, 0.0), (0.3, 0.05), (0.6, 0.1)])(t)
    b = DogBody()
    hx = P('hips').x + 0.03 * max(0.0, lunge)
    b.torso(V(hx, HIPS_Y - 0.006 - 0.012 * max(0.0, -lunge) + 0.01 * max(0.0, lunge), 0.0), lean(0.12 * max(0.0, lunge) - 0.05 * max(0.0, -lunge)),
            spine=lean(-0.08 * lunge), chest=lean(0.06 * lunge), neck=lean(-0.3 * max(0.0, lunge) - 0.1), head=lean(0.1 + 0.15 * max(0.0, lunge)),
            jaw=rz(-0.1 - 0.75 * jaw), tail=rz(0.45), tail2=rz(0.1))
    for front in (True, False):
        for side in ('l', 'r'):
            p = rest_paw(front, side)
            dx = (0.05 * max(0.0, lunge) if front else 0.0)
            b.leg(front, side, (p.x + dx, PAW_H + (0.03 * max(0.0, lunge) * math.sin(math.pi * min(1.0, t / 0.3)) if front else 0.0), p.z), ry(0.0))
    return b.pose()


def c_death(t, flip=False):
    """Collapse onto the right side (flip: a yelping half-roll first)."""
    D = 1.2 if not flip else 1.4
    k = smooth(t / (0.55 if not flip else 0.8))
    roll = (math.pi / 2 - 0.12) * k + (0.6 * math.sin(math.pi * min(1.0, t / 0.5)) if flip else 0.0)
    y = HIPS_Y - 0.004 - (HIPS_Y - 0.004 - 0.04) * k + (0.05 * math.sin(math.pi * min(1.0, t / 0.4)) if flip else 0.0)
    b = DogBody()
    b.torso(V(P('hips').x - 0.01 * k, y, 0.035 * k), rx(roll), spine=lean(0.05 * k), chest=lean(-0.05 * k),
            neck=lean(-0.1 + 0.25 * k) @ rx(-0.2 * k), head=lean(0.1 - 0.3 * k), jaw=rz(-0.25 * k), tail=rz(0.4 - 0.5 * k), tail2=rz(-0.1 * k))
    # legs: from standing to splayed out sideways along the ground
    for front in (True, False):
        for side in ('l', 'r'):
            p = rest_paw(front, side)
            s = 1 if side == 'r' else -1
            hip = b.W['chest' if front else 'hips'].translation
            lying = V(p.x + (0.03 if front else -0.03), 0.03 + (0.02 if s < 0 else 0.0), hip.z + 0.07 + (0.02 if s < 0 else 0.0))
            stand = V(p.x, PAW_H, p.z)
            b.leg(front, side, stand.lerp(lying, k), b.R['chest' if front else 'hips'])
    del D
    return b.pose()


def _wrap(name, fn):
    def f(t):
        _CUR[0] = name
        return fn(t)
    return f


def clips():
    cs = [
        Clip('dog.idle', 4.0, c_idle, loop=True, fps=12),
        Clip('dog.walk', WALK_T, c_walk, loop=True, fps=24, stride=WALK_S),
        Clip('dog.run', RUN_T, c_run, loop=True, fps=30, stride=RUN_S),
        Clip('dog.bite', 0.6, c_bite, loop=False, fps=30, shot=0.18),
        Clip('dog.death', 1.2, c_death, loop=False, fps=20),
        Clip('dog.death2', 1.4, lambda t: c_death(t, True), loop=False, fps=20),
    ]
    for c in cs:
        c.fn = _wrap(c.name, c.fn)
    return cs
