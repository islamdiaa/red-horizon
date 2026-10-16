"""Allied Chronosphere (2x2): a round white platform with a steel deck, a team band and a glowing chrono
channel ('glow:core'), four white pylons with team collars and blue emitters, the pedestal and the blue core,
the three gyroscopic rings (animated parts ringA > ringB > ringC; the procedural halo effect is kept),
consoles, capacitor cabinets, floodlight masts, hazard edges and an hourglass badge on the deck.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'pdox'
FACTION = 'allies'
KIND = 'structure'

BLUE = 0x3a8cff
CYAN = 0x56dcff


def torus(p, mat, R, t, at=(0, 0, 0), rot=None, seg=24, tseg=6):
    """Ring (torus) of radius R and tube radius t in the part frame: axis along local Y, then `rot`."""
    prof = [(R + t * math.cos(2 * math.pi * k / tseg), t * math.sin(2 * math.pi * k / tseg)) for k in range(tseg + 1)]
    return lathe(p, mat, prof, at, seg=seg, rot=rot, cap_top=False, cap_bottom=False)


def build(m):
    setup(m, ao_dist=0.32)
    m.set_meta(footprint=(2, 2), height=1.3, radius=1.05, keep=['fx:add:3a8cff:0.9'])
    r = m.root

    wall = white()
    frm = frame()
    tr = trim()
    stl = steel(0x8a95a0, panels=(0.2, 0.2))
    core = glow_material('glow:core', BLUE)

    box(r, slab_m(0xa8a398, joints=(0.5, 0.5)), (1.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)
    # ---- platform: white plinth, steel deck, team band, the chrono channel ring
    cyl(r, slab_m(0xc9c5bb), 0.88, 0.1, (0, Y0 + 0.05, 0), r2=0.85, seg=36, bevel=0.012)
    cyl(r, tread(0x6d7680), 0.75, 0.06, (0, Y0 + 0.13, 0), r2=0.7, seg=36, bevel=0.008)
    torus(r, tr, 0.69, 0.018, (0, Y0 + 0.16, 0), seg=36, tseg=4)
    lathe(r, core, [(0.76, 0.0), (0.8, 0.0), (0.8, 0.008), (0.76, 0.008), (0.76, 0.0)], (0, Y0 + 0.1, 0), seg=36, cap_top=False, cap_bottom=False)
    badge(m, r, 'hourglass', (0, Y0 + 0.161, 0.42), 0.28, facing='+y', field='circle', depth=0.03, symbol_scale=0.62)
    hazard_band(m, r, (0, Y0 + 0.1, 0.8), (0.42, 0.04), facing='+y', base=slab_m(0xc9c5bb))
    # ---- pedestal + pylons
    cyl(r, stl, 0.24, 0.3, (0, Y0 + 0.31, 0), r2=0.16, seg=20, bevel=0.01)
    cyl(r, tr, 0.205, 0.04, (0, Y0 + 0.38, 0), r2=0.2, seg=20, caps=False)
    for i in range(4):
        a = i / 4 * math.pi * 2 + math.pi / 4
        x, z = math.cos(a), math.sin(a)
        cyl_between(r, wall, (x * 0.68, Y0 + 0.16, z * 0.68), (x * 0.5, Y0 + 0.7, z * 0.5), 0.04, seg=10)
        box(r, tr, (0.13, 0.09, 0.13), (x * 0.68, Y0 + 0.2, z * 0.68), (0, -a, 0), bevel=0.016)
        cyl(r, frm, 0.05, 0.04, (x * 0.5, Y0 + 0.69, z * 0.5), seg=10)
        sphere(r, core, 0.026, (x * 0.5, Y0 + 0.73, z * 0.5), seg=10, rings=6)
    cy = Y0 + 0.77
    # core: glowing sphere inside a steel cage
    sphere(r, core, 0.2, (0, cy, 0), seg=18, rings=10)
    for k in range(6):
        a = k / 6 * math.pi
        torus(r, gun_m(), 0.215, 0.008, (0, cy, 0), rot=(math.pi / 2, a, 0), seg=16, tseg=3)
    # ---- gyroscopic rings (procedural rest: all at the core centre)
    ra = m.part('ringA', at=(0, 0.82, 0))
    torus(ra, metal(0xb4bac0, rough=0.35, rust=0.05), 0.42, 0.03, rot=(math.pi / 2, 0, 0), seg=28, tseg=6)
    for s in (0.3, 0.3 + math.pi):
        for k in range(3):
            a = s + (k - 1) * 0.18
            box(ra, tr, (0.07, 0.07, 0.075), (math.cos(a) * 0.42, math.sin(a) * 0.42, 0), (0, 0, a), bevel=0.01)
    rb = m.part('ringB', parent='ringA', at=(0, 0, 0))
    torus(rb, wall, 0.34, 0.025, seg=24, tseg=6)
    for i in range(6):
        a = i / 6 * math.pi * 2
        sphere(rb, glow_material('glow:core', CYAN), 0.018, (math.cos(a) * 0.34, 0.028, math.sin(a) * 0.34), seg=8, rings=5)
    rc = m.part('ringC', parent='ringB', at=(0, 0, 0))
    torus(rc, tr, 0.28, 0.018, rot=(0, 0, math.pi / 2), seg=22, tseg=5)

    # ---- consoles, capacitor cabinets, cable runs
    box(r, gun_m(), (0.3, 0.12, 0.1), (0, Y0 + 0.16, 0.8), (-0.3, 0, 0), bevel=0.012)
    box(r, light_mat(CYAN, 1.4, 'steady'), (0.22, 0.05, 0.005), (0, Y0 + 0.185, 0.851), (-0.3, 0, 0))
    for s in (-1, 1):
        box(r, wall, (0.2, 0.24, 0.15), (s * 0.78, Y0 + 0.12, 0.7), bevel=0.014)
        box(r, tr, (0.21, 0.025, 0.16), (s * 0.78, Y0 + 0.24, 0.7), bevel=0.005)
        box(r, light_mat(CYAN, 1.6, 'pulse'), (0.11, 0.06, 0.004), (s * 0.78, Y0 + 0.13, 0.777))
        hazard_band(m, r, (s * 0.78, Y0 + 0.05, 0.777), (0.16, 0.03))
        pipe_run(r, dark_m(), [(s * 0.7, Y0 + 0.04, 0.62), (s * 0.45, Y0 + 0.04, 0.45)], 0.014)
    # ---- floodlight masts at the back, strobes
    for (x, z) in ((-0.86, -0.86), (0.86, -0.86)):
        cyl(r, dark_m(), 0.013, 0.62, (x, Y0 + 0.31, z), r2=0.01, seg=8)
        cyl(r, frm, 0.04, 0.04, (x, Y0 + 0.02, z), seg=8, bevel=0.005)
        floodlight(r, (x, Y0 + 0.62, z + 0.02), yaw=math.atan2(-x, -z) + math.pi, pitch=0.7, s=0.05)
        light(r, (x, Y0 + 0.66, z), 0.012, 0xff2a1a, 'blink')
    m.decal(solid(WHITE_TXT), at=(0, Y0 + 0.055, 0.885), size=(0.3, 0.03), facing='+z', depth=0.02, team=0)
