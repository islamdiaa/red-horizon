"""Soviet airfield (3x2): a tarmac strip with chasing amber edge lights (glow:run0..3), a barrel-vault hangar
with ribbed doors, a hazard lintel, a red banner and a big crest on the gable, the control tower with a lit
glazed cab and the rotating radar (part 'radar'), fuel tanks with team bands, crates, a lamp post.
Pivots: node --import tsx tools/assets/rig.ts afld soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'afld'
FACTION = 'soviet'
KIND = 'structure'

AMBER = 0xffa020


def build(m):
    m.set_meta(footprint=(3, 2), height=0.9, radius=1.4, snow=0.55)  # the strip is ploughed
    look(edge=0.28, ao_dist=0.34)
    P = Pal()
    r = m.root
    foundation(m, r, P, 3.0, 2.0)

    # ---- the strip: tarmac, markings, edge lights (chasing: glow:run0..3)
    box(r, P.tar, (2.86, 0.02, 1.1), (0, Y0 + 0.01, 0.28), bevel=0.006)
    for i in range(7):
        stripe(m, r, (-1.2 + i * 0.4, Y0 + 0.021, 0.28), (0.22, 0.035), facing='+y', color=0xd8d4c8)
    for z in (-0.22, 0.78):
        stripe(m, r, (0, Y0 + 0.021, z), (2.74, 0.025), facing='+y', color=0xd8d4c8)
    for i in range(8):
        x = -1.3 + i * 0.37
        for z in (-0.27, 0.83):
            box(r, P.dark, (0.03, 0.02, 0.03), (x, Y0 + 0.03, z))
            sphere(r, glow_material(f'glow:run{i % 4}', AMBER), 0.016, (x, Y0 + 0.05, z), seg=6, rings=4)

    # ---- hangar (back left): base walls, barrel vault, ribs, doors, gable crest
    hx, hz, hw, hd = -0.5, -0.62, 1.66, 0.56
    box(r, P.conc, (hw + 0.06, 0.07, hd + 0.06), (hx, Y0 + 0.035, hz), bevel=0.012)
    box(r, P.wall, (hw - 0.04, 0.3, hd), (hx, Y0 + 0.07 + 0.15, hz), bevel=0.014)
    vy = Y0 + 0.36
    arch(r, P.wall_dk, hd / 2 + 0.02, hw, (hx, vy, hz), rise=0.3, seg=12, axis='x')
    for k in range(6):
        arch(r, P.frame, hd / 2 + 0.035, 0.035, (hx - 0.75 + k * 0.3, vy, hz), rise=0.315, seg=10, r_in=hd / 2 - 0.0, axis='x')
    stripe(m, r, (hx, vy + 0.301, hz), (hw - 0.05, 0.06), facing='+y', team_k=1)
    fz = hz + hd / 2
    box(r, P.void, (1.24, 0.3, 0.012), (hx, Y0 + 0.07 + 0.15, fz + 0.002))
    for i in range(6):
        box(r, corrugated(0x4e555c, along='y', pitch=0.025, rust=0.45), (0.195, 0.29, 0.014), (hx - 0.5 + i * 0.2, Y0 + 0.07 + 0.145, fz + 0.012), bevel=0.002)
    box(r, P.wall_dk, (1.32, 0.05, 0.05), (hx, Y0 + 0.395, fz + 0.02), bevel=0.008)
    m.decal(hazard_img(aspect=1.3 / 0.04), at=(hx, Y0 + 0.395, fz + 0.046), size=(1.3, 0.04), facing='+z', part=r, depth=0.01)
    crest(m, r, (hx, vy + 0.15, fz + 0.02), 0.22, depth=0.06)
    red_banner(m, r, (hx - 0.73, Y0 + 0.36, fz + 0.012), (0.15, 0.27))
    red_banner(m, r, (hx + 0.73, Y0 + 0.36, fz + 0.012), (0.15, 0.27))
    for x in (hx - hw / 2 + 0.03, hx + hw / 2 - 0.03):
        lamp(r, (x, Y0 + 0.37, fz - 0.02), 0.02)
    stencil(m, r, '03', (hx + 0.3, Y0 + 0.2, fz + 0.02), 0.11)

    # ---- control tower (back right) + the radar part
    tx, tz = 1.02, -0.62
    ttop, tfz = hall(r, P, tx, tz, 0.34, 0.34, 0.58, wall=P.wall_dk, parapet=0.0, roof=False, cornice=False)
    oct_ = [(-0.21, -0.21), (0.21, -0.21), (0.25, -0.1), (0.25, 0.1), (0.21, 0.21), (-0.21, 0.21), (-0.25, 0.1), (-0.25, -0.1)]
    prism(r, glass(lit=0xffd08a, strength=2.0), [(x, -z) for (x, z) in oct_], 0.15, (tx, Y0 + 0.58 + 0.075, tz), rot=(-math.pi / 2, 0, 0))
    m.decal(mullions(5, 1, aspect=0.42 / 0.15, t=0.14, dark=0.25, seed=41), at=(tx, Y0 + 0.655, tz + 0.212), size=(0.42, 0.15), facing='+z', part=r, depth=0.03, emit=0.0)
    box(r, P.roof, (0.56, 0.035, 0.5), (tx, Y0 + 0.75, tz), bevel=0.01)
    box(r, P.trim, (0.57, 0.025, 0.51), (tx, Y0 + 0.73, tz), bevel=0.005)
    sign(m, r, (tx, Y0 + 0.44, tfz + 0.005), (0.3, 0.1), 'АЭРО', board=P.board)
    window(r, (tx, Y0 + 0.26, tfz), (0.08, 0.08), strength=2.0)
    radar = m.part('radar', at=(1.02, 0.81, -0.62))
    cyl(radar, P.dark, 0.012, 0.08, (0, 0.04, 0), seg=6)
    box(radar, P.gun, (0.035, 0.07, 0.28), (0, 0.11, 0), bevel=0.006)
    m.decal(grille_img(aspect=4.0, n=3), at=(0.018, 0.11, 0), size=(0.27, 0.06), facing='+x', part=radar, depth=0.01)
    lamp(r, (tx + 0.24, Y0 + 0.77, tz - 0.2), 0.02)
    lamp(r, (tx - 0.24, Y0 + 0.77, tz + 0.2), 0.02)
    ladder(r, P.rail, (tx + 0.17, Y0, tz), 0.58, facing='+x')

    # ---- fuel tanks, crates, lamp post, windsock post
    for z in (-0.28, -0.06):
        cyl(r, P.wall_lt, 0.075, 0.34, (1.22, Y0 + 0.11, z), (0, 0, math.pi / 2), seg=12, bevel=0.006)
        cyl(r, P.trim, 0.079, 0.03, (1.22, Y0 + 0.11, z), (0, 0, math.pi / 2), seg=12, caps=False)
        for x in (1.1, 1.34):
            box(r, P.frame, (0.03, 0.05, 0.12), (x, Y0 + 0.025, z), bevel=0.004)
    stencil(m, r, 'FUEL', (1.22, Y0 + 0.11, -0.06 + 0.077), 0.03, color=0xf2b916)
    crates(r, P, (0.38, Y0, -0.82), 0.08, 3, 0.4)
    lamp_post(r, P, (0.3, Y0, -0.36), 0.4, yaw=0.0)
    drums(r, (-1.36, Y0, -0.86), 2)
