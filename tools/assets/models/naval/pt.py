"""Allied gunboat (pt, fast patrol boat), dressed for the RTS camera: haze-grey lofted hull with a team sheer
strake and white hull numbers over the black boot topping, a dark non-skid deck with crisp bright edge lines and
white deck markings, the forward 2-inch gun mount (part 'turret', team-roofed shield; barrel 'b0' recoils), the
raked bridge with lit windows and red / green wing lamps, the aft cabin with the white star on its roof, the
lattice mast with the rotating radar ('radar') and the masthead strobe, depth-charge racks and K-guns aft
(muzzles m2 / m3), twin MGs on the bridge wings, a life raft, bollards, the team ensign and a stern lamp.
Everything hangs under 'hull' (bob / roll / sink in the game). Pivots: node --import tsx tools/assets/rig.ts pt.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nk import *  # noqa: E402,F401,F403

ID = 'pt'
FACTION = 'allies'
KIND = 'naval'
ATLAS = 512


def build(m):
    m.set_meta(height=0.32, radius=0.46, snow=0.2)
    m.ground = False
    m.look(edge_light=0.08, ao_distance=0.14)
    P = NavPal('allies')
    hl = m.part('hull')
    H = Hull(stations(0.92, 0.25, 0.065, 0.03, 0.05, 0.15, 0.78, 0.08, n=14))
    H.add(hl, P)
    dy = H.deck_at(0)
    hull_dress(m, hl, H, P, edge=0.007, strake_w=0.014, segs=3)
    hull_number(m, hl, H, 0.3, '27', 0.034)

    # ---- forward gun (turret) + barrel
    tx = 0.24
    t = m.part('turret', parent='hull', at=(tx, H.deck_at(tx), 0))
    cyl(t, P.dark, 0.045, 0.02, (0, 0.01, 0), r2=0.04, seg=14, bevel=0.003)
    prism(t, P.sup, [(-0.035, 0.0), (0.03, 0.0), (0.04, 0.03), (0.02, 0.06), (-0.035, 0.06)], 0.074, (0, 0.02, 0), bevel=0.005)
    box(t, P.team, (0.062, 0.008, 0.076), (-0.006, 0.084, 0), bevel=0.002)
    box(t, P.dark, (0.016, 0.03, 0.03), (0.035, 0.045, 0), bevel=0.004)
    b0 = m.part('b0', parent='turret', at=(0.03, 0.045, 0))
    cyl(b0, P.gun, 0.009, 0.13, (0.065, 0, 0), ROT_X, r2=0.007, seg=10)
    cyl(b0, P.black, 0.011, 0.016, (0.122, 0, 0), ROT_X, seg=10)
    cyl(b0, P.soot, 0.005, 0.002, (0.131, 0, 0), ROT_X, seg=8)
    m.muzzle('m0', (0.17, 0.045, 0), part='turret')
    m.muzzle('m1', (0.17, 0.045, 0), part='turret')
    # forecastle: bollards, anchor, deck lines
    for s in (-1, 1):
        bollards(hl, P, 0.34, H.deck_at(0.34), 0.05 * s, 2)
    deck_line(m, hl, (0.15, H.deck_at(0.15) + 0.001, 0), (0.4, H.deck_at(0.4) + 0.001, 0), 0.006)
    strip(m, hl, (0.36, H.deck_at(0.36) + 0.001, 0.0), (0.42, H.deck_at(0.42) + 0.001, 0.0), '+y', 0.012, color=0x1a1b1d)

    # ---- bridge, aft cabin, mast + radar, lights
    bridge(m, hl, P, 0.03, dy, 0.17, 0.085, 0.15, roof=P.team)
    house(hl, P.sup, -0.13, dy, 0.16, 0.05, 0.13, roof=P.team)
    for s in (-1, 1):
        window_band(hl, P, -0.19, -0.07, dy + 0.032, 0.065, 0.012, s)
    deck_emblem(m, hl, P, (-0.13, dy + 0.063, 0), 0.1)
    top = mast(hl, P, -0.01, dy + 0.1, 0.17, yard=0.11)
    radar_part(m, 'hull', P, 'radar', (-0.01, 0.275, 0), w=0.07)
    strobe(hl, (-0.01, top + 0.012, 0), 0.008, WHITE_L)
    cyl(hl, P.dark, 0.014, 0.012, (0.06, dy + 0.091, 0), seg=10)
    lamp(hl, (0.06, dy + 0.105, 0), 0.011, HEAD, 'steady', 3.8, '+x')  # searchlight
    for s in (-1, 1):
        cyl(hl, P.black, 0.004, 0.05, (0.12, dy + 0.068, 0.088 * s), ROT_X, seg=5)
        box(hl, P.dark, (0.02, 0.014, 0.012), (0.095, dy + 0.066, 0.088 * s), bevel=0.002)

    # ---- stern: depth-charge racks + K-guns (secondary), raft, ensign, stern lamp, exhaust
    xr = -0.36
    for s in (-1, 1):
        box(hl, P.dark, (0.12, 0.01, 0.05), (xr, H.deck_at(xr) + 0.005, 0.05 * s))
        for i in range(3):
            cyl(hl, P.olive, 0.014, 0.034, (xr - 0.04 + i * 0.04, H.deck_at(xr) + 0.024, 0.05 * s), ROT_Z, seg=8)
        xk = -0.26
        yk = H.deck_at(xk)
        cyl(hl, P.dark, 0.012, 0.02, (xk, yk + 0.01, 0.08 * s), r2=0.01, seg=8)
        cyl(hl, P.dark, 0.011, 0.05, (xk, yk + 0.035, 0.092 * s), (0.6 * s, 0, 0), seg=8)
        cyl(hl, P.olive, 0.013, 0.03, (xk, yk + 0.06, 0.11 * s), (0.6 * s, 0, 0), seg=8)
    m.point('m2', (-0.26, 0.135, 0.11), part='hull', kind='muzzle')
    m.point('m3', (-0.26, 0.135, -0.11), part='hull', kind='muzzle')
    raft(hl, P, -0.2, dy + 0.05, 0.0, 0.06)
    hazard_stripes(m, hl, (-0.42, H.deck_at(-0.42) + 0.001, 0), (0.16, 0.02), facing='+y')
    xe = -0.44
    cyl(hl, P.dark, 0.003, 0.1, (xe, H.deck_at(xe) + 0.05, 0), seg=5)
    box(hl, cloth(team=True), (0.05, 0.03, 0.003), (xe - 0.026, H.deck_at(xe) + 0.08, 0))
    nav_ship(hl, P, (-0.455, H.deck_at(-0.455) + 0.02, 0))
    m.smoke('exhaust', (-0.3, 0.095, 0), part='hull')
