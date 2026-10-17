"""Attack dog (German shepherd type): tan coat with a black saddle, deep chest, team collar with a tag; skinned to
the quadruped rig (kit.rig.DOG, clips in _dog.py)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector  # noqa: E402

from kit import *  # noqa: E402,F401,F403
from kit import decals as D  # noqa: E402
from kit.rig import DOG  # noqa: E402
from kit.skin import Skin, mix, ring  # noqa: E402

ID = 'dog'
FACTION = 'soviet'
KIND = 'infantry'
P = DOG.pos


def fur(color, grime=0.3):
    m = cloth(color, grime=grime)
    set_weather(m, streaks=0.0, wear=0.0)
    return m


def build(m):
    m.look(edge_light=0.03, dirt_h=0.05, ao_distance=0.05, ao=0.6)
    sk = Skin(m, DOG)
    p = sk.part
    tan = fur(0x9a7044)
    dark = fur(0x2a211a)
    # torso along +X (tube 'b' = vertical, 'a' = lateral)
    sk.tube(tan, [
        ring((-0.116, 0.128, 0.0), 0.016, 0.016, {'hips': 1}),
        ring((-0.104, 0.130, 0.0), 0.025, 0.026, {'hips': 1}),
        ring((-0.082, 0.131, 0.0), 0.028, 0.030, {'hips': 1}),
        ring((-0.048, 0.132, 0.0), 0.025, 0.026, mix(('hips', 0.5), ('spine', 0.5)), front_bias=0.1),
        ring((-0.012, 0.133, 0.0), 0.025, 0.027, {'spine': 1}, front_bias=0.1),
        ring((0.022, 0.128, 0.0), 0.030, 0.037, mix(('spine', 0.35), ('chest', 0.65)), front_bias=-0.1),
        ring((0.054, 0.125, 0.0), 0.031, 0.040, {'chest': 1}, front_bias=-0.1),
        ring((0.080, 0.133, 0.0), 0.025, 0.031, mix(('chest', 0.7), ('neck', 0.3))),
        ring((0.092, 0.142, 0.0), 0.016, 0.018, mix(('chest', 0.3), ('neck', 0.7))),
    ], seg=10, front=(0, 1, 0), cap0=True)
    # the black saddle along the back
    m.decal(D.solid(0x231a14), at=(-0.03, 0.17, 0.0), size=(0.17, 0.056), facing='+y', part='skin', depth=0.06)
    # neck to the head
    sk.tube(tan, [
        ring((0.078, 0.140, 0.0), 0.021, 0.024, mix(('chest', 0.5), ('neck', 0.5))),
        ring((0.098, 0.158, 0.0), 0.018, 0.019, {'neck': 1}),
        ring((0.114, 0.174, 0.0), 0.016, 0.017, mix(('neck', 0.4), ('head', 0.6))),
    ], seg=10, front=(-0.6, 0.8, 0))
    # head: skull, muzzle, lower jaw, nose, ears, eyes
    H = P('head')
    sk.rigid(sphere(p, tan, 1.0, at=H + Vector((0.008, 0.007, 0.0)), seg=10, rings=7, scale=(0.026, 0.021, 0.0195)), 'head')
    sk.rigid(sphere(p, tan, 1.0, at=H + Vector((0.038, -0.001, 0.0)), seg=8, rings=6, scale=(0.022, 0.0115, 0.0118)), 'head')
    sk.rigid(sphere(p, dark, 1.0, at=H + Vector((0.044, 0.004, 0.0)), seg=8, rings=5, scale=(0.016, 0.006, 0.009)), 'head')
    sk.rigid(sphere(p, fur(0x1a1512, 0.1), 0.0055, at=H + Vector((0.06, 0.002, 0.0)), seg=6, rings=4), 'head')
    J = P('jaw')
    sk.rigid(sphere(p, tan, 1.0, at=J + Vector((0.022, -0.005, 0.0)), seg=8, rings=5, scale=(0.02, 0.0055, 0.0095)), 'jaw')
    sk.rigid(box(p, flat(0x8a2a28, rough=0.4), (0.022, 0.003, 0.012), J + Vector((0.02, -0.001, 0.0))), 'jaw')  # tongue
    for s in (-1, 1):
        sk.rigid(cyl(p, dark, 0.008, 0.024, H + Vector((0.0, 0.032, 0.011 * s)), rot=(0.25 * s, 0, 0.15), r2=0.0015, seg=6), 'head')
        sk.rigid(box(p, flat(0x120e0c, rough=0.3), (0.004, 0.004, 0.005), H + Vector((0.028, 0.012, 0.012 * s))), 'head')
    # team collar with a brass tag
    sk.tube(cloth(0xb4b4b4, team=True), [
        ring((0.084, 0.142, 0.0), 0.0215, 0.0235, {'neck': 1}, side=(0, 0, 1)),
        ring((0.090, 0.150, 0.0), 0.0205, 0.0225, {'neck': 1}, side=(0, 0, 1)),
    ], seg=10, front=(-0.6, 0.8, 0))
    sk.rigid(box(p, metal(0xb08a3a, rough=0.4, metal=0.85), (0.004, 0.009, 0.007), (0.106, 0.128, 0.0)), 'neck')
    # tail
    sk.tube(tan, [
        ring(P('tail') + Vector((0.006, -0.002, 0.0)), 0.009, 0.01, mix(('hips', 0.5), ('tail', 0.5))),
        ring(P('tail2'), 0.008, 0.009, mix(('tail', 0.5), ('tail2', 0.5))),
        ring(P('tail2') + Vector((-0.028, 0.004, 0.0)), 0.006, 0.0065, {'tail2': 1}),
        ring(P('tail2') + Vector((-0.046, 0.0, 0.0)), 0.002, 0.002, {'tail2': 1}),
    ], seg=6, front=(0, 1, 0))
    # legs: shoulder / hip -> elbow / stifle -> carpus / hock, paws
    for front in (True, False):
        for side in ('l', 'r'):
            pre = 'f' if front else 'h'
            up, lo, pw = pre + 'leg_' + side, pre + 'shin_' + side, pre + 'paw_' + side
            parent = 'chest' if front else 'hips'
            A, Bk, C = P(up), P(lo), P(pw)
            col = tan
            sk.tube([col, col, col, col], [
                ring(A + Vector((0.0, 0.016, 0.0)), 0.016 if front else 0.019, 0.02 if front else 0.024, mix((parent, 0.65), (up, 0.35))),
                ring(A, 0.014 if front else 0.016, 0.017 if front else 0.021, mix((parent, 0.25), (up, 0.75))),
                ring(A.lerp(Bk, 0.6), 0.0105, 0.012 if front else 0.014, {up: 1}),
                ring(Bk, 0.0085, 0.0095, mix((up, 0.5), (lo, 0.5))),
                ring(C + Vector((0.0, 0.004, 0.0)), 0.0065, 0.007, mix((lo, 0.6), (pw, 0.4))),
            ], seg=7, front=(1, 0, 0))
            sk.rigid(sphere(p, col, 1.0, at=C + Vector((0.007, -0.006, 0.0)), seg=7, rings=5, scale=(0.0125, 0.0065, 0.0085)), pw)
    m.points = {}
    m.set_meta(height=0.2, radius=0.14, set='dog', rig='dog', points={'m0': {'bone': 'head', 'at': list(H + Vector((0.062, -0.004, 0.0))), 'kind': 'muzzle'}})
