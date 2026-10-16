"""Soviet M.A.D. tank (qtnk): heavy olive chassis with team skirts and hazard-striped glacis, six road wheels a
side, the seismic hammer rig: four posts and a team crown with red warning beacons ('glow:warn'), the ram
(part 'ram', winched up while arming, slammed down per pulse), anvil plate, hydraulic cylinders, capacitor
drums with charge bands ('glow:charge'), four outriggers (parts 'leg0'..'leg3', swing down when deployed);
the procedural shock ring ('fx') is kept. Pivots: node --import tsx tools/assets/rig.ts qtnk.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = 'qtnk'
FACTION = 'soviet'
KIND = 'vehicle'


def build(m):
    m.set_meta(height=0.75, radius=0.56, snow=0.3, keep=['fx:add:ffb070:1.4'])
    r = m.root
    P = Pal('soviet')

    L, H, W, Z = 0.98, 0.16, 0.15, 0.27
    running_gear(m, r, P, L, H, W, Z, 6, wheel_k=0.38, rollers=2)
    box(r, P.dark, (0.9, 0.09, 0.42), (0, 0.1, 0), bevel=0.012)
    hull = [(-0.502, 0.132), (0.4, 0.132), (0.512, 0.182), (0.402, 0.247), (-0.472, 0.252), (-0.512, 0.212)]
    side_prism(r, P.hull, hull, 0.47, bevel=0.018)
    hazard_stripes(m, r, (0.462, 0.21, 0.0), (0.4, 0.045), facing='+x')
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        fender(r, P.hull_flat, 1.0, 0.17, 0.17, Z * s, front=0.06, rear=0.05)
        box(r, P.dark, (0.96, 0.018, 0.018), (0.0, 0.205, 0.345 * s), bevel=0.004)
        skirt(r, P.trim_flat, 0.94, 0.08, 0.2, 0.347 * s, panels=4, t=0.016)
        stripe(m, r, (0.0, 0.124, 0.3555 * s), (0.94, 0.012), f, 0x2a2c24)
        number(m, r, '13', (-0.3, 0.165, 0.3555 * s), 0.045, f, color=0xe8b434)
        headlight(r, (0.48, 0.2, 0.17 * s), 0.018, guard=P.black)
        marker(r, (-0.516, 0.222, 0.18 * s), 0.012)
    emblem(m, r, 'soviet', (0.3, 0.253, 0.15), 0.07, facing='+y')
    deck_strips(m, r, -0.472, 0.402, 0.25, 0.235)
    fender_strips(m, r, 1.0, 0.355, 0.178)
    tow_hooks(r, P, 0.52, 0.14, 0.14, 1)
    whip(r, P, (-0.45, 0.252, 0.15), 0.22, pennant=True)

    # ---- the rig: four posts, cross bars, diagonal hydraulics, crown with a team top and beacons
    y0, Hh = 0.25, 0.4
    for (x, z) in ((0.1, 0.12), (0.1, -0.12), (-0.14, 0.12), (-0.14, -0.12)):
        box(r, P.gun, (0.032, Hh, 0.032), (x, y0 + Hh / 2, z), bevel=0.006)
    for z in (-0.12, 0.12):
        box(r, P.gun, (0.24, 0.022, 0.022), (-0.02, y0 + 0.12, z), bevel=0.003)
        cyl_between(r, P.black, (0.1, y0 + 0.02, z), (-0.14, y0 + Hh - 0.04, z), 0.008, 6)
    box(r, P.dark2, (0.31, 0.052, 0.31), (-0.02, y0 + Hh, 0), bevel=0.014)
    box(r, P.trim_flat, (0.314, 0.018, 0.314), (-0.02, y0 + Hh + 0.034, 0), bevel=0.005)
    hazard_stripes(m, r, (-0.02, y0 + Hh, 0.156), (0.28, 0.035), facing='+z')
    hazard_stripes(m, r, (-0.02, y0 + Hh, -0.156), (0.28, 0.035), facing='-z')
    emblem(m, r, 'soviet', (-0.02, y0 + Hh + 0.044, 0.0), 0.16, facing='+y')
    deck_strips(m, r, -0.177, 0.137, y0 + Hh + 0.043, 0.157, width=0.012)
    glow_w = glow_material('glow:warn', RED)
    for (x, z) in ((0.1, 0.12), (-0.14, -0.12)):
        cyl(r, P.black, 0.018, 0.014, (x, y0 + Hh + 0.05, z), seg=8)
        dome(r, glow_w, 0.017, (x, y0 + Hh + 0.057, z), seg=8, rings=3, h=0.022)
    # anvil plate and hydraulic cylinders beside the ram
    cyl(r, P.steel, 0.1, 0.03, (-0.02, y0 + 0.015, 0), r2=0.09, seg=14, bevel=0.004)
    for z in (-0.075, 0.075):
        cyl(r, P.dark, 0.022, 0.22, (-0.02, y0 + Hh - 0.13, z), seg=10)
        cyl(r, P.steel, 0.012, 0.06, (-0.02, y0 + Hh - 0.26, z), seg=8)
    # ---- the ram (moves): rod, hammer head with a yellow band, striking plate
    ram = m.part('ram', at=(-0.02, y0 + 0.24, 0))
    cyl(ram, P.steel, 0.022, 0.26, (0, 0.1, 0), seg=10)
    cyl(ram, P.dark, 0.075, 0.1, (0, -0.04, 0), r2=0.08, seg=14, bevel=0.006)
    cyl(ram, P.yellow, 0.082, 0.02, (0, -0.01, 0), seg=14)
    cyl(ram, P.gun, 0.086, 0.016, (0, -0.085, 0), seg=14, bevel=0.003)
    # ---- capacitor drums at the rear with glowing charge bands
    glow_ch = glow_material('glow:charge', AMBER)
    for z in (-0.1, 0.1):
        cyl(r, P.gun, 0.06, 0.16, (-0.36, 0.33, z), seg=12, bevel=0.005)
        cyl(r, P.black, 0.064, 0.02, (-0.36, 0.41, z), seg=12)
        for i in range(3):
            cyl(r, glow_ch, 0.0625, 0.012, (-0.36, 0.28 + i * 0.045, z), seg=12, caps=False)
        cyl_between(r, P.black, (-0.3, 0.38, z), (-0.1, y0 + Hh - 0.05, z), 0.01, 6)
    # ---- outriggers (swing down when deployed)
    for i, (x, s) in enumerate(((0.36, 1), (0.36, -1), (-0.38, 1), (-0.38, -1))):
        leg = m.part(f'leg{i}', at=(x, 0.22, 0.24 * s))
        box(leg, P.dark2, (0.05, 0.032, 0.2), (0, 0, 0.1 * s), bevel=0.006)
        box(leg, P.black, (0.065, 0.022, 0.075), (0, -0.012, 0.21 * s), bevel=0.004)
        m.decal(D.hazard(aspect=0.16 / 0.03), at=(0, 0.0165, 0.1 * s), size=(0.16, 0.03), facing='+y', part=leg, depth=0.012, roll=PI / 2, team=0, rough=0.6)
