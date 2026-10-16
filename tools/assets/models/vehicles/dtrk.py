"""Soviet demolition truck (dtrk): olive 6x6 truck (scrolling tyres) with team cab doors, the driver, a
flatbed with side rails, and the nuclear device (part 'device'): a fat yellow cylinder with black hazard bands,
end caps, trefoils, cargo straps and the arming panel (red 'glow:arm' blinks fast when armed, green
'glow:arm2'). Pivots: node --import tsx tools/assets/rig.ts dtrk.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _vk import *  # noqa: E402,F401,F403

ID = 'dtrk'
FACTION = 'soviet'
KIND = 'vehicle'


def trefoil_img(px=192):
    cv = D.Canvas(px, px, ss=2)
    c = px / 2
    blk = D.lin(0x111111)
    for k in range(3):
        a0 = math.radians(90 + k * 120 - 30)
        pts = []
        for i in range(9):
            a = a0 + math.radians(60) * i / 8
            pts.append((c + math.cos(a) * px * 0.47, c + math.sin(a) * px * 0.47))
        for i in range(9):
            a = a0 + math.radians(60) * (8 - i) / 8
            pts.append((c + math.cos(a) * px * 0.17, c + math.sin(a) * px * 0.17))
        # fan from the inner arc's middle (star-shaped around it)
        mid = (c + math.cos(a0 + math.radians(30)) * px * 0.3, c + math.sin(a0 + math.radians(30)) * px * 0.3)
        cv.poly([mid] + pts + [pts[0]], blk)
    cv.circle(c, c, px * 0.11, blk)
    return cv.image()


def crew(p, P, at, helmet):
    x, y, z = at
    box(p, P.dark2, (0.042, 0.052, 0.062), (x, y + 0.026, z), bevel=0.008)
    sphere(p, painted(0xd0a080, panels=None, wear=0.0, rust=0.0, rough=0.7, metal=0.0), 0.016, (x + 0.006, y + 0.066, z), seg=8, rings=4)
    dome(p, helmet, 0.022, (x + 0.004, y + 0.068, z), seg=8, rings=3, h=0.018)


def build(m):
    m.set_meta(height=0.42, radius=0.44, snow=0.3)
    r = m.root
    P = Pal('soviet')
    bomb = painted(0xd8a418, panels=None, wear=0.55, rust=0.1, grime=0.4, streaks=0.4, rough=0.5, var=0.08)
    blk = painted(0x18181a, panels=None, wear=0.5, rust=0.05, grime=0.3, rough=0.5, var=0.05)
    strap = cloth(0x5a5440, grime=0.5)

    wr, ww = 0.068, 0.056
    for x in (0.3, -0.12, -0.3):
        for s in (-1, 1):
            wheel(r, P, wr, ww, (x, wr, 0.165 * s), s)
    box(r, P.dark, (0.86, 0.05, 0.22), (-0.01, 0.09, 0), bevel=0.008)
    # ---- cab
    cab = [(0.18, 0.1), (0.45, 0.1), (0.462, 0.176), (0.402, 0.272), (0.2, 0.282)]
    side_prism(r, P.hull, cab, 0.32, bevel=0.016)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        box(r, P.trim_flat, (0.145, 0.09, 0.008), (0.3, 0.162, 0.162 * s), bevel=0.003)
        box(r, P.glass, (0.1, 0.05, 0.006), (0.3, 0.232, 0.161 * s))
        emblem(m, r, 'soviet', (0.3, 0.165, 0.1665 * s), 0.05, facing=f)
        box(r, P.hull_flat, (0.16, 0.014, 0.075), (0.3, 0.155, 0.165 * s), bevel=0.004)
        headlight(r, (0.46, 0.152, 0.115 * s), 0.017, guard=P.black)
    box(r, P.glass, (0.07, 0.072, 0.272), (0.422, 0.232, 0), (0, 0, 0.98))
    crew(r, P, (0.34, 0.16, -0.07), P.dark)
    box(r, P.top, (0.17, 0.014, 0.26), (0.3, 0.289, 0), bevel=0.005)
    top_star(m, r, 'soviet', (0.31, 0.297, -0.035), 0.12)
    grille(m, r, (0.459, 0.14, 0.0), (0.2, 0.04), facing='+x', n=3)
    box(r, P.gun, (0.022, 0.024, 0.3), (0.47, 0.11, 0), bevel=0.004)
    tow_hooks(r, P, 0.48, 0.1, 0.08, 1)
    whip(r, P, (0.22, 0.282, -0.12), 0.22, pennant=True)
    marker(r, (0.26, 0.297, 0.09), 0.013, AMBER, '+y', mode='blink', strength=3.4)
    # ---- flatbed with side rails, rear fenders, hazard plate, tail lights
    box(r, P.dark2, (0.6, 0.036, 0.32), (-0.17, 0.13, 0), bevel=0.008)
    for s in (-1, 1):
        box(r, P.gun, (0.6, 0.04, 0.014), (-0.17, 0.168, 0.155 * s), bevel=0.003)
        for x in (-0.12, -0.3):
            box(r, P.hull_flat, (0.15, 0.012, 0.075), (x, 0.158, 0.163 * s), bevel=0.004)
    deck_strips(m, r, 0.2, 0.402, 0.279, 0.16, width=0.012)
    for s in (-1, 1):
        edge_strip(m, r, (-0.465, 0.188, 0.155 * s), (0.125, 0.188, 0.155 * s), '+y', 0.01)
    hazard_stripes(m, r, (-0.471, 0.13, 0.0), (0.3, 0.032), facing='-x')
    tail_lights(r, -0.475, 0.155, 0.13)
    crate(r, P.jerry, (0.06, 0.05, 0.06), (0.1, 0.173, -0.1), strap=P.black)
    cyl_between(r, painted(0xb02418, panels=None, wear=0.3, rust=0.05, rough=0.5), (0.15, 0.2, 0.08), (-0.08, 0.32, 0.06), 0.006, 6)

    # ---- the device
    d = m.part('device', at=(-0.18, 0.245, 0))
    cyl(d, bomb, 0.1, 0.42, (0, 0, 0), ROT_X, seg=16)
    for x in (-0.17, -0.07, 0.07, 0.17):
        cyl(d, blk, 0.102, 0.03, (x, 0, 0), ROT_X, seg=16)
    for sx in (-1, 1):
        lathe(d, P.gun, [(0.1, 0.0), (0.086, 0.04), (0.04, 0.065), (0.0, 0.07)], (0.21 * sx, 0, 0), seg=16, rot=(0, 0, -PI / 2 * sx))
        rivet_row(m, d, (0.215 * sx, 0.06, -0.04), (0.215 * sx, 0.06, 0.04), facing='+y', spacing=0.03, size=0.01)
    tre = trefoil_img()
    for f, at in (('+z', (0, 0, 0.101)), ('-z', (0, 0, -0.101)), ('+y', (0, 0.101, 0))):
        m.decal(tre, at=at, size=(0.085, 0.085), facing=f, part=d, depth=0.03, team=0)
    for x in (-0.12, 0.12):
        box(d, strap, (0.026, 0.212, 0.216), (x, -0.012, 0), bevel=0.004)
    for f, z in (('+z', 0.1015), ('-z', -0.1015)):
        stencil(m, d, 'ОПАСНО', (0.13, -0.035, z), 0.022, facing=f, color=0x111111)
    box(d, P.dark, (0.06, 0.032, 0.05), (0.09, 0.1, 0.0), bevel=0.006)
    sphere(d, glow_material('glow:arm', RED), 0.016, (0.09, 0.125, 0), seg=10, rings=6)
    box(d, glow_material('glow:arm2', 0x40ff60), (0.02, 0.006, 0.012), (0.072, 0.118, 0.018))
