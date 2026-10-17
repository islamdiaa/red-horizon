"""Allied heavy cruiser (ca), dressed for the RTS camera: a long haze-grey lofted hull with the team sheer strake,
white hull numbers and the black boot topping; a planked teak deck with light toe rails, the dark armoured citadel
deck and white deck markings, a big white star on the forecastle and a second one on the quarterdeck; three
team-roofed twin 8-inch turrets (fore 'turret' b0 / b2, superfiring 'turretB' bb0 / bb1, aft 'turretA' b1 / b3,
facing aft at rest; barrels recoil), the stepped bridge tower with lit windows, wing lamps, the director and
rangefinder, the tall mast with the rotating radar ('radar') and the masthead strobe, two big raked funnels with
team bands (smoke0 / smoke1), the aft control house with its own mast and radar ('radar2'), twin 5-inch side
mounts, CIWS, AA tubs, boats, rafts, the aircraft crane, searchlights, the team ensign and a stern lamp.
Everything hangs under 'hull'. Pivots: node --import tsx tools/assets/rig.ts ca.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nk import *  # noqa: E402,F401,F403

ID = 'ca'
FACTION = 'allies'
KIND = 'naval'


def twin_turret(m, P, name, at, size, bnames, mnames, blen, brad, rot=None):
    t = m.part(name, parent='hull', at=at, rot=rot)
    gunhouse(t, P, size)
    s = size
    for k, (bn, mn) in enumerate(zip(bnames, mnames)):
        z = -0.2 * s + 0.4 * s * k
        box(t, P.dark, (0.06 * s, 0.12 * s, 0.1 * s), (0.53 * s, 0.2 * s, z), bevel=0.004)
        b = m.part(bn, parent=name, at=(0.5 * s, 0.2 * s, z))
        cyl(b, P.gun, brad, blen, (blen / 2, 0, 0), ROT_X, r2=brad * 0.85, seg=8)
        cyl(b, P.dark, brad * 1.5, blen * 0.2, (blen * 0.1, 0, 0), ROT_X, seg=8)
        cyl(b, P.soot, brad * 0.55, 0.002, (blen + 0.001, 0, 0), ROT_X, seg=8)
        m.muzzle(mn, (0.5 * s + blen + 0.01, 0.2 * s, z), part=name)
    # rangefinder ears
    for z in (-1, 1):
        cyl(t, P.dark, 0.02, 0.05, (-0.12 * s, 0.38 * s, z * 0.43 * s), ROT_Z, seg=8)
    return t


def build(m):
    m.set_meta(height=0.7, radius=1.15, snow=0.2)
    m.ground = False
    m.look(edge_light=0.08, ao_distance=0.22)
    P = NavPal('allies')
    P.teak = painted(0x8a6a48, panels=(0.4, 0.01), rivets=False, wear=0.1, rust=0.0, grime=0.4, streaks=0.05, rough=0.85, metal=0.0, var=0.2)
    hl = m.part('hull')
    H = Hull(stations(2.35, 0.5, 0.1, 0.05, 0.1, 0.15, 0.7, 0.2, n=18))
    H.add(hl, P, deck=P.teak)
    dy = H.deck_at(0)
    hull_dress(m, hl, H, P, edge=0.009, strake_w=0.02, segs=5)
    hull_number(m, hl, H, 0.82, '68', 0.05)

    # ---- armoured citadel deck, forecastle and quarterdeck marks
    box(hl, P.deck, (1.12, 0.012, 0.36), (-0.06, dy + 0.006, 0), bevel=0.004)
    deck_emblem(m, hl, P, (0.92, H.deck_at(0.92) + 0.002, 0), 0.22, depth=0.04)
    deck_emblem(m, hl, P, (-0.93, H.deck_at(-0.93) + 0.002, 0), 0.2, depth=0.04)
    for s in (-1, 1):
        cyl(hl, P.dark, 0.016, 0.014, (1.0, H.deck_at(1.0) + 0.007, 0.045 * s), seg=10)
        strip(m, hl, (1.0, H.deck_at(1.0) + 0.002, 0.045 * s), (1.07, H.deck_at(1.07) + 0.002, 0.03 * s), '+y', 0.01, color=0x161718)
        for x in (0.75, -0.85, -1.02):
            bollards(hl, P, x, H.deck_at(x), (H.half_at(x) - 0.03) * s, 2)

    # ---- main battery: fore, superfiring, aft (aft one faces aft at rest)
    fx = 0.6
    cyl(hl, P.sup_dk, 0.13, 0.03, (fx, H.deck_at(fx) + 0.005, 0), r2=0.125, seg=14)
    twin_turret(m, P, 'turret', (fx, H.deck_at(fx) + 0.02, 0), 0.26, ('b0', 'b2'), ('m0', 'm2'), 0.36, 0.014)
    bx = 0.36
    cyl(hl, P.sup_dk, 0.11, 0.07, (bx, H.deck_at(bx) + 0.035, 0), r2=0.105, seg=14)
    twin_turret(m, P, 'turretB', (bx, H.deck_at(bx) + 0.07, 0), 0.21, ('bb0', 'bb1'), ('mb0', 'mb1'), 0.28, 0.012)
    ax = -0.68
    cyl(hl, P.sup_dk, 0.13, 0.03, (ax, H.deck_at(ax) + 0.005, 0), r2=0.125, seg=14)
    twin_turret(m, P, 'turretA', (ax, H.deck_at(ax) + 0.02, 0), 0.26, ('b1', 'b3'), ('m1', 'm3'), 0.36, 0.014, rot=(0, PI, 0))

    # ---- superstructure: citadel house, bridge tower, director, mast, funnels, aft control
    house(hl, P.sup, 0.0, dy, 0.5, 0.08, 0.3, roof=P.team)
    for s in (-1, 1):
        window_band(hl, P, -0.2, 0.2, dy + 0.05, 0.15, 0.016, s)
    bridge(m, hl, P, 0.16, dy + 0.08, 0.2, 0.12, 0.24, roof=P.team)
    house(hl, P.sup, 0.12, dy + 0.2, 0.12, 0.08, 0.14, roof=P.team)
    for s in (-1, 1):
        window_band(hl, P, 0.08, 0.16, dy + 0.25, 0.07, 0.014, s)
    cyl(hl, P.dark, 0.035, 0.1, (0.12, dy + 0.33, 0), r2=0.03, seg=12)
    box(hl, P.sup, (0.07, 0.04, 0.06), (0.12, dy + 0.4, 0), bevel=0.006)
    box(hl, P.dark, (0.016, 0.016, 0.22), (0.12, dy + 0.39, 0), bevel=0.003)
    top = mast(hl, P, 0.06, dy + 0.42, 0.28, yard=0.22)
    radar_part(m, 'hull', P, 'radar', (0.06, 0.7, 0), w=0.13)
    strobe(hl, (0.06, top + 0.012, 0), 0.01, WHITE_L)
    funnel(m, hl, P, 'smoke0', -0.08, dy + 0.08, 0.055, 0.17)
    funnel(m, hl, P, 'smoke1', -0.25, dy + 0.08, 0.055, 0.16)
    house(hl, P.sup, -0.42, dy, 0.18, 0.1, 0.22, roof=P.team)
    for s in (-1, 1):
        window_band(hl, P, -0.49, -0.35, dy + 0.07, 0.11, 0.014, s)
    top2 = mast(hl, P, -0.42, dy + 0.11, 0.2, yard=0.16, platform=False)
    radar_part(m, 'hull', P, 'radar2', (-0.42, 0.34, 0), w=0.09)

    # ---- secondary battery, AA, CIWS, boats, rafts, crane, searchlights
    for s in (-1, 1):
        for x in (0.08, -0.16):
            cyl(hl, P.dark, 0.03, 0.014, (x, dy + 0.087, 0.12 * s), r2=0.028, seg=12)
            prism(hl, P.sup, [(-0.03, 0.0), (0.025, 0.0), (0.032, 0.016), (0.02, 0.032), (-0.03, 0.032)], 0.05,
                  (x, dy + 0.094, 0.12 * s), bevel=0.004)
            box(hl, P.team, (0.05, 0.006, 0.046), (x - 0.003, dy + 0.128, 0.12 * s))
            for dz in (-0.01, 0.01):
                cyl(hl, P.gun, 0.004, 0.07, (x + 0.06, dy + 0.108, 0.12 * s + dz), ROT_X, seg=6)
        for x in (0.28, -0.3, -0.52):
            cyl(hl, P.sup_dk, 0.017, 0.02, (x, H.deck_at(x) + 0.01, (H.half_at(x) - 0.045) * s), seg=10)
            cyl(hl, P.gun, 0.003, 0.04, (x + 0.02, H.deck_at(x) + 0.028, (H.half_at(x) - 0.045) * s), (0, 0, -1.0), seg=5)
        raft(hl, P, -0.16, dy + 0.087, 0.2 * s, 0.09)
        ciws(hl, P, -0.32, dy + 0.1, 0.1 * s)
        boat(hl, P, -0.52, dy, 0.17 * s, 0.12)
        cyl(hl, P.dark, 0.014, 0.014, (0.2, dy + 0.3, 0.1 * s), seg=8)
        lamp(hl, (0.2, dy + 0.316, 0.1 * s), 0.013, HEAD, 'steady', 3.8, '+x')
    cyl(hl, P.dark, 0.012, 0.16, (-0.34, dy + 0.18, 0.12), r2=0.01, seg=8)
    cyl_between(hl, P.yellow, (-0.34, dy + 0.26, 0.12), (-0.2, dy + 0.2, 0.15), 0.007, seg=6)
    xloft(hl, P.white, [(-0.38, dy + 0.11, 0.0, 0.0, 0.0), (-0.36, dy + 0.11, 0.016, 0.02, 0.02), (-0.28, dy + 0.11, 0.016, 0.02, 0.02),
                        (-0.26, dy + 0.11, 0.0, 0.0, 0.0)], seg=8, at=(0, 0, -0.07))

    # ---- stern: ensign, lamp; bow: jack staff
    xe = -1.13
    cyl(hl, P.dark, 0.003, 0.12, (xe, H.deck_at(xe) + 0.06, 0), seg=5)
    box(hl, cloth(team=True), (0.05, 0.03, 0.003), (xe - 0.026, H.deck_at(xe) + 0.1, 0))
    nav_ship(hl, P, (-1.15, H.deck_at(-1.15) + 0.02, 0))
    deck_line(m, hl, (0.18, H.deck_at(0.18) + 0.013, 0), (0.25, H.deck_at(0.25) + 0.013, 0), 0.006)
