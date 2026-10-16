"""Soviet war factory (3x3): three ribbed barrel vaults over a heavy assembly hall, a tall slogan fascia
(TANKS FOR THE FRONT) between two banner towers, the big ribbed door (part 'door', rolls up: the game scales it),
amber door beacons (glow:door), a lit bay with a hull on the jig (sparks point 'weld'), office wings with lit
windows, buttressed flanks, a banded stack (smoke0) and roof plant (steam0).
Pivots: node --import tsx tools/assets/rig.ts weap soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'weap'
FACTION = 'soviet'
KIND = 'structure'


def build(m):
    m.set_meta(footprint=(3, 3), height=1.4, radius=1.55)
    look(m)
    P = Pal()
    r = m.root

    foundation(m, r, P, 3.0, 3.0)
    hz, hd, hw, hh = -0.36, 1.98, 2.56, 0.94
    fz = hz + hd / 2  # 0.63
    dw, dh = 1.14, 0.72
    dtop = 0.04 + dh  # 0.76: the door pivot (procedural)
    bayD = 0.5
    bz = fz - bayD

    # ---- apron with chevrons and bollards
    slab(r, P.tar, -0.62, 0.62, Y0, Y0 + 0.01, fz, 1.46)
    for i in range(3):
        m.decal(chevron(), at=(0, Y0 + 0.011, fz + 0.24 + i * 0.22), size=(0.5, 0.16), facing='+y', part=r, depth=0.01)
    for s in (-1, 1):
        cyl(r, P.yellow, 0.028, 0.12, (s * 0.66, Y0 + 0.06, fz + 0.6), seg=8)
        m.decal(hazard_img(aspect=1.0), at=(s * 0.66, Y0 + 0.09, fz + 0.6 + 0.028), size=(0.05, 0.04), facing='+z', part=r, depth=0.01)

    # ---- the hall: plinth, rear block, side blocks either side of the bay, lintel, cornice
    box(r, P.conc, (hw + 0.05, 0.12, hd + 0.05), (0, Y0 + 0.06, hz), bevel=0.014)
    rearD = hd - bayD
    box(r, P.wall, (hw, hh - 0.1, rearD), (0, Y0 + 0.1 + (hh - 0.1) / 2, hz - hd / 2 + rearD / 2), bevel=0.014)
    sideW = (hw - dw) / 2
    for sx in (-1, 1):
        box(r, P.wall, (sideW, hh - 0.1, bayD + 0.01), (sx * (dw / 2 + sideW / 2), Y0 + 0.1 + (hh - 0.1) / 2, fz - bayD / 2), bevel=0.012)
    top = Y0 + hh
    box(r, P.wall_dk, (hw + 0.014, 0.12, hd + 0.014), (0, top - 0.09, hz), bevel=0.008)
    box(r, P.trim, (hw + 0.04, 0.04, hd + 0.04), (0, top - 0.02, hz), bevel=0.01)
    rivet_row(m, r, (-hw / 2 + 0.04, top - 0.09, fz + 0.007), (hw / 2 - 0.04, top - 0.09, fz + 0.007))
    # flanks: sloped buttresses, a steam main on the east wall, vents on the west
    for s in (-1, 1):
        for i in range(4):
            buttress(r, P.conc, (s * hw / 2, Y0, hz - 0.78 + i * 0.5), hh - 0.14, depth=0.13, w=0.09, facing='+x' if s > 0 else '-x')
    pipe_run(r, P.rust, [(hw / 2 + 0.05, Y0 + 0.62, fz - 0.08), (hw / 2 + 0.05, Y0 + 0.62, hz - 0.92), (hw / 2 + 0.05, top + 0.16, hz - 0.92)], 0.032)
    for i in range(2):
        vent(m, r, (-hw / 2, Y0 + 0.55, hz - 0.53 + i * 0.5), (0.2, 0.14), facing='-x')
    junction_box(r, (hw / 2, Y0 + 0.35, hz + 0.2), (0.08, 0.12, 0.03), facing='+x', conduit=0.14)

    # ---- barrel-vault roof: three vaults, ribs, team crown stripe, skylight strips, gutters
    vy = top - 0.005
    for i in range(3):
        x = -hw / 2 + hw / 6 + i * hw / 3
        arch(r, P.wall_dk, 0.425, hd - 0.04, (x, vy, hz), rise=0.24, seg=12)
        for k in range(4):
            z = hz - hd / 2 + 0.2 + k * (hd - 0.4) / 3
            arch(r, P.frame, 0.44, 0.04, (x, vy, z), rise=0.255, seg=10, r_in=0.405)
        roof_paint(m, r, (x, vy + 0.241, hz), (0.07, hd - 0.1))
        if i == 1:
            top_star(m, r, (x, vy + 0.24, hz + 0.3), 0.62, emit=0.35, depth=0.2)
        box(r, glass(lit=0xffc27a, strength=0.9), (0.1, 0.008, hd - 0.5), (x - 0.18, vy + 0.18, hz), (0, 0, 0.62))
        # gable end: dark plate with a lit lunette (fan window)
        arch(r, P.frame, 0.43, 0.02, (x, vy, fz - 0.01), rise=0.245, seg=12)
        if i != 1:
            arch(r, glass(lit=0xffc27a, strength=1.4), 0.22, 0.012, (x, vy + 0.0, fz + 0.002), rise=0.14, seg=8)
            m.decal(mullions(4, 1, aspect=0.44 / 0.14, t=0.14), at=(x, vy + 0.07, fz + 0.01), size=(0.44, 0.14), facing='+z', part=r, depth=0.012)
        if i < 2:
            box(r, P.steel, (0.06, 0.06, hd - 0.02), (x + hw / 6, vy + 0.03, hz), bevel=0.008)
    # roof plant: the stack (smoke0) on a plinth, an exhaust house (steam0), AC units, vents
    box(r, P.wall_dk, (0.28, 0.24, 0.28), (1.0, vy + 0.13, -0.98), bevel=0.014)
    stack(m, r, P, (1.0, 1.08, -0.98), 0.62, 0.1, name='smoke0', r_top=0.075, lights=4, base=False,
          bands=[(0.55, 0.08), (0.72, 0.08)], ladder_side=-math.pi / 2)
    box(r, P.wall_lt, (0.16, 0.16, 0.18), (0.42, vy + 0.08, -0.66), bevel=0.012)
    cyl(r, P.steel, 0.03, 0.08, (0.42, vy + 0.2, -0.66), seg=8)
    m.steam('steam0', (0.4, 1.24, -0.66))
    ac_unit(r, (-0.86, vy + 0.2, -0.98), 0.1, mat=P.wall_lt)
    ac_unit(r, (-0.05, vy + 0.21, -1.05), 0.09, mat=P.wall_lt)
    roof_vent(r, (-0.42, vy + 0.02, 0.1), 0.04)

    # ---- the bay: dark interior, floor lines, side walls, back wall with work lights, gantry, a hull
    box(r, P.void, (dw, dh, 0.012), (0, Y0 + dh / 2, bz + 0.006))
    box(r, P.dark, (dw, 0.012, bayD), (0, Y0 + 0.006, fz - bayD / 2))
    for x in (-0.2, 0.2):
        stripe(m, r, (x, Y0 + 0.013, fz - bayD / 2), (0.03, bayD - 0.05), facing='+y', color=0xd8a21c)
    for sx in (-1, 1):
        box(r, P.gun, (0.012, dh, bayD), (sx * (dw / 2 - 0.006), Y0 + dh / 2, fz - bayD / 2))
    strip_light(r, (0, Y0 + dh - 0.13, bz + 0.016), (0.7, 0.05), color=0xffc27a, strength=2.4)
    for x in (-0.35, 0.0, 0.35):
        box(r, light_mat(0xffd9a0, 2.6, 'steady'), (0.16, 0.008, 0.05), (x, Y0 + dh - 0.012, fz - bayD / 2))
    box(r, P.yellow, (dw - 0.04, 0.05, 0.05), (0, Y0 + dh - 0.07, bz + 0.12), bevel=0.006)
    box(r, P.dark, (0.06, 0.08, 0.06), (0.15, Y0 + dh - 0.13, bz + 0.12), bevel=0.006)
    box(r, P.olive, (0.5, 0.1, 0.24), (0.06, Y0 + 0.1, bz + 0.22), bevel=0.012)
    box(r, P.olive, (0.22, 0.07, 0.17), (0.02, Y0 + 0.185, bz + 0.22), bevel=0.012)
    m.sparks('weld', (0.1, 0.22, 0.33))

    # ---- the door (part 'door': pivot at the top of the opening, the game rolls it up)
    door_p = m.part('door', at=(0, dtop, fz + 0.01))
    box(door_p, corrugated(0x3e444b, along='x', pitch=0.05, rust=0.45, wear=0.65, streaks=0.8), (dw, dh, 0.025), (0, -dh / 2, 0), bevel=0.004)
    for i in range(4):
        box(door_p, P.gun, (dw - 0.02, 0.016, 0.034), (0, -0.09 - i * 0.16, 0), bevel=0.003)
    box(door_p, P.yellow, (dw, 0.035, 0.035), (0, -dh + 0.018, 0), bevel=0.004)
    m.decal(hazard_img(aspect=dw / 0.035), at=(0, -dh + 0.018, 0.018), size=(dw, 0.035), facing='+z', part=door_p, depth=0.01)
    stencil(m, door_p, '02', (0.3, -dh * 0.5, 0.014), 0.24, color=0xf0ece0)
    stripe(m, door_p, (-0.3, -dh * 0.5, 0.014), (0.3, 0.22), color=0xa31c15)
    m.decal(soviet_star(), at=(-0.3, -dh * 0.5, 0.016), size=(0.18, 0.18), facing='+z', part=door_p, depth=0.01, team=0)

    # ---- door frame, fascia with the slogan between the towers
    tw, th_ = 0.34, 1.42
    tx = dw / 2 + tw / 2 + 0.02
    box(r, P.wall_dk, (dw + 0.1, 0.1, 0.07), (0, dtop + 0.05, fz + 0.03), bevel=0.012)
    m.decal(hazard_img(aspect=(dw + 0.08) / 0.045), at=(0, dtop + 0.03, fz + 0.066), size=(dw + 0.08, 0.045), facing='+z', part=r, depth=0.01)
    for sx in (-1, 1):
        box(r, P.wall_dk, (0.05, dh, 0.06), (sx * (dw / 2 + 0.02), Y0 + dh / 2 - 0.005, fz + 0.025), bevel=0.008)
    fx0, fx1 = -(tx - tw / 2), tx - tw / 2
    box(r, P.wall, (fx1 - fx0, 0.36, 0.08), (0, dtop + 0.1 + 0.18, fz + 0.03), bevel=0.012)
    box(r, P.trim, (fx1 - fx0 + 0.01, 0.04, 0.1), (0, dtop + 0.1 + 0.36 + 0.0, fz + 0.03), bevel=0.008)
    slogan(m, r, (0, dtop + 0.29, fz + 0.075), (1.0, 0.28), 'TANKS FOR|THE FRONT', lights=4)
    for sx in (-1, 1):
        sphere(r, glow_material('glow:door', 0xffa020), 0.026, (sx * (dw / 2 + 0.06), dtop + 0.14, fz + 0.09), seg=8, rings=5)
        box(r, P.dark, (0.05, 0.03, 0.05), (sx * (dw / 2 + 0.06), dtop + 0.1, fz + 0.09))

    # ---- banner towers either side of the door
    for sx in (-1, 1):
        x = sx * tx
        tz = fz + 0.02
        box(r, P.conc, (tw + 0.04, 0.1, 0.36), (x, Y0 + 0.05, tz), bevel=0.012)
        box(r, P.wall_dk, (tw, th_ - 0.1, 0.32), (x, Y0 + 0.1 + (th_ - 0.1) / 2, tz), bevel=0.016)
        ttop = Y0 + th_
        box(r, P.wall, (tw + 0.02, 0.1, 0.34), (x, ttop - 0.07, tz), bevel=0.01)
        box(r, P.trim, (tw + 0.04, 0.04, 0.36), (x, ttop - 0.0, tz), bevel=0.008)
        box(r, P.roof, (tw - 0.03, 0.02, 0.29), (x, ttop + 0.02, tz))
        for (a0, a1, b0, b1) in ((x - tw / 2, x + tw / 2, tz + 0.15, tz + 0.18), (x - tw / 2, x + tw / 2, tz - 0.18, tz - 0.15)):
            slab(r, P.frame, a0, a1, ttop + 0.02, ttop + 0.06, b0, b1, bevel=0.004)
        red_banner(m, r, (x, ttop - 0.14, tz + 0.165), (0.26, 0.8))
        emblem(m, r, 'soviet', (x, Y0 + 0.3, tz + 0.161), 0.11)
        lamp(r, (x + sx * 0.12, ttop + 0.06, tz + 0.12), 0.024)
        lamp(r, (x - sx * 0.12, ttop + 0.06, tz - 0.12), 0.02)
        stripe(m, r, (x + sx * (tw / 2 + 0.001), Y0 + 0.75, tz), (0.06, 1.1), facing='+x' if sx > 0 else '-x', team_k=1)

    # ---- office wings (outer front): lit windows, a door, a small roller door
    for sx in (-1, 1):
        wx = sx * 1.1
        window_row(r, (wx, Y0 + 0.6, fz), 2, (0.1, 0.09), 0.06, dark=(0,) if sx < 0 else (), strength=2.1)
        window_row(r, (wx, Y0 + 0.38, fz), 2, (0.1, 0.09), 0.06, dark=(1,) if sx > 0 else (), strength=2.1)
    door(m, r, (1.1, Y0, fz), (0.15, 0.24), kind='double')
    neon(r, 0.95, 1.26, top, fz)
    neon(r, -1.26, -0.95, top, fz)
    door(m, r, (-1.1, Y0, fz), (0.3, 0.24), kind='roller', hazard_frame=True)
    for x in (-hw / 2 + 0.04, hw / 2 - 0.04):
        lamp(r, (x, top + 0.0, fz + 0.0), 0.022)

    # ---- yard clutter, lamp posts
    crates(r, P, (-1.3, Y0, fz + 0.3), 0.1, 3, 0.2)
    drums(r, (1.24, Y0, fz + 0.32), 3)
    lamp_post(r, P, (1.36, Y0, 1.34), 0.44, yaw=math.pi)
    lamp_post(r, P, (-1.36, Y0, 1.34), 0.44, yaw=0.0)


_chev = {}


def chevron():
    """Yellow road chevron (pointing -z, into the factory)."""
    if 'c' in _chev:
        return _chev['c']
    from kit import decals as D
    cv = D.Canvas(256, 80, ss=2)
    col = D.lin(0xd8a21c)
    cv.polys([[(0, 0), (128, 56), (128, 80), (0, 24)], [(128, 56), (256, 0), (256, 24), (128, 80)]], col)
    cv.roughen(0.3, seed=5)
    img = cv.image()
    _chev['c'] = img
    return img
