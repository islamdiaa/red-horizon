"""Allied destroyer (dd), dressed for the RTS camera: a long haze-grey lofted hull with the team sheer strake,
white hull numbers and the black boot topping; a dark non-skid deck with crisp bright edge lines, white deck
markings and the white star on the forecastle; the fore gun ('fgun', team-roofed gunhouse, barrel 'fb0' recoils),
the raked bridge with lit windows and wing lamps, the lattice mast with the rotating radar ('radar'), two raked
funnels with team bands and sooty caps (smoke0 / smoke1), the midships deckhouse, boats on chocks, rafts,
torpedo tubes, CIWS mounts, the aft missile launcher ('turret' with the elevated twin box 'arm', muzzles m0 / m1),
depth-charge racks and K-guns on the stern (m2 / m3), the team ensign, searchlights, the masthead strobe and a
stern lamp. Everything hangs under 'hull'. Pivots: node --import tsx tools/assets/rig.ts dd.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nk import *  # noqa: E402,F401,F403

ID = 'dd'
FACTION = 'allies'
KIND = 'naval'


def build(m):
    m.set_meta(height=0.5, radius=0.74, snow=0.2)
    m.ground = False
    m.look(edge_light=0.08, ao_distance=0.18)
    P = NavPal('allies')
    hl = m.part('hull')
    H = Hull(stations(1.5, 0.34, 0.085, 0.045, 0.07, 0.12, 0.72, 0.14, n=16))
    H.add(hl, P)
    dy = H.deck_at(0)
    hull_dress(m, hl, H, P, edge=0.008, strake_w=0.016, segs=4)
    hull_number(m, hl, H, 0.5, '962', 0.04)

    # ---- forecastle: emblem, anchor gear, bollards, deck lines
    deck_emblem(m, hl, P, (0.6, H.deck_at(0.6) + 0.001, 0), 0.13, depth=0.03)
    for s in (-1, 1):
        cyl(hl, P.dark, 0.012, 0.012, (0.69, H.deck_at(0.69) + 0.006, 0.03 * s), seg=10)
        strip(m, hl, (0.69, H.deck_at(0.69) + 0.001, 0.03 * s), (0.74, H.deck_at(0.74) + 0.001, 0.025 * s), '+y', 0.008, color=0x161718)
        bollards(hl, P, 0.5, H.deck_at(0.5), (H.half_at(0.5) - 0.025) * s, 2)
        bollards(hl, P, -0.64, H.deck_at(-0.64), (H.half_at(-0.64) - 0.025) * s, 2)
    deck_line(m, hl, (0.28, H.deck_at(0.28) + 0.001, 0), (0.52, H.deck_at(0.52) + 0.001, 0), 0.006)

    # ---- fore gun (follows the launcher's bearing in the game)
    fx = 0.42
    fg = m.part('fgun', parent='hull', at=(fx, H.deck_at(fx), 0))
    gunhouse(fg, P, 0.15)
    fb = m.part('fb0', parent='fgun', at=(0.075, 0.03, 0))
    cyl(fb, P.gun, 0.011, 0.17, (0.085, 0, 0), ROT_X, r2=0.009, seg=10)
    cyl(fb, P.dark, 0.017, 0.04, (0.02, 0, 0), ROT_X, seg=10)
    cyl(fb, P.soot, 0.006, 0.002, (0.171, 0, 0), ROT_X, seg=8)
    m.muzzle('fm0', (0.255, 0.03, 0), part='fgun')

    # ---- superstructure: bridge, midships house, mast + radar, funnels, aft house
    bridge(m, hl, P, 0.2, dy, 0.2, 0.12, 0.2, roof=P.team)
    house(hl, P.sup, 0.03, dy, 0.2, 0.09, 0.18, roof=P.team)
    for s in (-1, 1):
        window_band(hl, P, -0.05, 0.11, dy + 0.055, 0.09, 0.014, s)
    deck_hatch(m, hl, (0.03, dy + 0.103, 0), (0.12, 0.1))
    top = mast(hl, P, 0.14, dy + 0.13, 0.25, yard=0.16)
    box(hl, P.dark, (0.04, 0.03, 0.04), (0.14, top - 0.01, 0), bevel=0.004)
    radar_part(m, 'hull', P, 'radar', (0.14, 0.375, 0), w=0.1)
    strobe(hl, (0.14, top + 0.012, 0), 0.009, WHITE_L)
    funnel(m, hl, P, 'smoke0', -0.04, dy + 0.09, 0.04, 0.11)
    funnel(m, hl, P, 'smoke1', -0.16, dy + 0.06, 0.036, 0.1)
    house(hl, P.sup, -0.2, dy, 0.22, 0.06, 0.17, roof=P.team)
    for s in (-1, 1):
        window_band(hl, P, -0.28, -0.12, dy + 0.035, 0.085, 0.012, s)
        raft(hl, P, -0.09, dy + 0.02, 0.13 * s, 0.08)
        raft(hl, P, 0.06, dy + 0.02, 0.135 * s, 0.07)
        cyl(hl, P.dark, 0.012, 0.11, (-0.04, dy + 0.025, 0.12 * s), ROT_X, seg=8)
        cyl(hl, P.dark, 0.012, 0.11, (-0.04, dy + 0.025, 0.095 * s), ROT_X, seg=8)
        boat(hl, P, -0.2, dy + 0.06, 0.06 * s, 0.1)
        cyl(hl, P.dark, 0.012, 0.012, (0.27, dy + 0.126, 0.08 * s), seg=8)
        lamp(hl, (0.27, dy + 0.14, 0.08 * s), 0.01, HEAD, 'steady', 3.6, '+x')
    ciws(hl, P, -0.3, dy + 0.06, 0)
    ciws(hl, P, 0.33, dy + 0.12, 0)

    # ---- aft missile launcher (the turret) and its elevated twin box
    tz = -0.42
    t = m.part('turret', parent='hull', at=(tz, H.deck_at(tz), 0))
    cyl(t, P.dark, 0.065, 0.03, (0, 0.015, 0), r2=0.058, seg=16, bevel=0.004)
    box(t, P.sup, (0.07, 0.06, 0.08), (-0.02, 0.06, 0), bevel=0.008)
    arm = m.part('arm', parent='turret', at=(0, 0.08, 0), rot=(0, 0, 0.35))
    box(arm, P.dark, (0.03, 0.03, 0.16), (0, 0, 0), bevel=0.004)
    for i, z in ((0, -0.05), (1, 0.05)):
        box(arm, P.team, (0.12, 0.05, 0.045), (0.04, 0, z), bevel=0.006)
        box(arm, P.black, (0.004, 0.044, 0.04), (0.1, 0, z))
        for dy2 in (-0.012, 0.012):
            for dz in (-0.011, 0.011):
                cyl(arm, P.red, 0.006, 0.004, (0.102, dy2, z + dz), ROT_X, seg=6)
        m.muzzle(f'm{i}', (0.11, 0, z), part='arm')
    hazard_stripes(m, hl, (-0.42, H.deck_at(-0.42) + 0.001, 0.11), (0.16, 0.014), facing='+y')
    hazard_stripes(m, hl, (-0.42, H.deck_at(-0.42) + 0.001, -0.11), (0.16, 0.014), facing='+y')

    # ---- stern: depth-charge racks, K-guns (m2 / m3), ensign, stern lamp
    xr = -0.66
    for s in (-1, 1):
        box(hl, P.dark, (0.12, 0.01, 0.05), (xr, H.deck_at(xr) + 0.005, 0.06 * s))
        for i in range(3):
            cyl(hl, P.olive, 0.014, 0.034, (xr - 0.04 + i * 0.04, H.deck_at(xr) + 0.024, 0.06 * s), ROT_Z, seg=8)
        xk = -0.56
        yk = H.deck_at(xk)
        cyl(hl, P.dark, 0.012, 0.02, (xk, yk + 0.01, 0.11 * s), r2=0.01, seg=8)
        cyl(hl, P.dark, 0.011, 0.05, (xk, yk + 0.035, 0.122 * s), (0.6 * s, 0, 0), seg=8)
        cyl(hl, P.olive, 0.013, 0.03, (xk, yk + 0.06, 0.14 * s), (0.6 * s, 0, 0), seg=8)
    m.point('m2', (-0.56, 0.155, 0.14), part='hull', kind='muzzle')
    m.point('m3', (-0.56, 0.155, -0.14), part='hull', kind='muzzle')
    xe = -0.73
    cyl(hl, P.dark, 0.003, 0.13, (xe, H.deck_at(xe) + 0.065, 0), seg=5)
    box(hl, cloth(team=True), (0.05, 0.03, 0.003), (xe - 0.026, H.deck_at(xe) + 0.11, 0))
    nav_ship(hl, P, (-0.745, H.deck_at(-0.745) + 0.02, 0))
    deck_line(m, hl, (-0.62, H.deck_at(-0.62) + 0.001, 0), (-0.5, H.deck_at(-0.5) + 0.001, 0), 0.006, 0xd8a418)
