"""Landing ship (lst), shared by lst_allies.py / lst_soviet.py: a beamy haze-grey hull with the team sheer strake,
white hull numbers and the black boot topping; the open well deck (dark non-skid with yellow tie-down lines,
hazard markings at the bow, the faction emblem big in the middle, a tarp-covered load and crates) between
team-capped side walls with frames; the clamshell bow doors 'doorL' / 'doorR' and the bow ramp 'ramp' (opened
by the game when beaching: dark tread plate with hazard edges on its inner face, amber ramp lamps on the
animated 'glow:ramp' slot); the aft superstructure with the raked bridge (lit windows, wing lamps), the mast
with the rotating radar ('radar') and the masthead strobe, the funnel (smoke0), the deck crane, rafts,
searchlights, the stern winch, the ensign and a stern lamp. Everything hangs under 'hull'.
Pivots: node --import tsx tools/assets/rig.ts lst.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nk import *  # noqa: E402,F401,F403


def build_lst(m, fac):
    m.set_meta(height=0.45, radius=0.72, snow=0.2)
    m.ground = False
    m.look(edge_light=0.08, ao_distance=0.2)
    P = NavPal(fac, hull=0x99a1a8 if fac == 'allies' else 0x8a939a)
    hl = m.part('hull')
    H = Hull(stations(1.4, 0.48, 0.09, 0.03, 0.06, 0.55, 0.88, 0.0, flare=1.0, n=14))
    H.add(hl, P)
    dy = H.deck_at(0)
    hull_dress(m, hl, H, P, x0=-0.68, x1=0.5, edge=0.008, strake_w=0.018, segs=3)
    hull_number(m, hl, H, 0.42, '1157' if fac == 'allies' else '421', 0.04)

    # ---- well deck between side walls
    box(hl, P.deck, (0.88, 0.01, 0.34), (0.12, dy + 0.004, 0))
    for s in (-1, 1):
        box(hl, P.hull_flat, (0.95, 0.07, 0.03), (0.1, dy + 0.035, 0.2 * s), bevel=0.006)
        box(hl, P.team, (0.95, 0.01, 0.036), (0.1, dy + 0.074, 0.2 * s), bevel=0.003)
        for i in range(6):
            box(hl, P.dark, (0.01, 0.06, 0.008), (-0.3 + i * 0.16, dy + 0.035, (0.2 - 0.019) * s))
    for z in (-0.1, 0.1):
        deck_line(m, hl, (-0.28, dy + 0.009, z), (0.5, dy + 0.009, z), 0.008, 0xd8a418)
    deck_emblem(m, hl, P, (0.2, dy + 0.009, 0), 0.2, depth=0.02)
    hazard_stripes(m, hl, (0.54, dy + 0.009, 0), (0.3, 0.03), facing='+y')
    # load: tarp-covered vehicle, crates
    box(hl, P.canvas, (0.18, 0.06, 0.1), (-0.12, dy + 0.039, -0.07), bevel=0.02)
    box(hl, P.olive, (0.1, 0.05, 0.08), (-0.14, dy + 0.034, 0.09), bevel=0.008)
    box(hl, P.olive, (0.07, 0.04, 0.06), (-0.02, dy + 0.029, 0.11), bevel=0.006)

    # ---- bow doors (clamshell) and the ramp
    bx, by = 0.6, dy + 0.005
    for s in (-1, 1):
        door = m.part('doorL' if s > 0 else 'doorR', parent='hull', at=(bx, by, 0.19 * s))
        prism(door, P.hull_flat, [(0.0, 0.0), (0.1, 0.0), (0.13, 0.05), (0.12, 0.08), (0.0, 0.085)], 0.03, (0, 0, -0.06 * s), bevel=0.006)
        box(door, P.team, (0.12, 0.01, 0.034), (0.06, 0.088, -0.06 * s), bevel=0.003)
    rp = m.part('ramp', parent='hull', at=(bx, by, 0))
    box(rp, P.sup_dk, (0.02, 0.17, 0.3), (0.01, 0.085, 0), bevel=0.006)
    box(rp, tread(0x3a3d42), (0.004, 0.16, 0.27), (0.0, 0.085, 0))
    hazard_stripes(m, rp, (-0.003, 0.16, 0), (0.28, 0.016), facing='-x')
    for s in (-1, 1):
        sphere(hl, glow_material('glow:ramp', 0xffa020), 0.012, (0.55, dy + 0.094, 0.2 * s), seg=8, rings=5)
        cyl(hl, P.dark, 0.013, 0.008, (0.55, dy + 0.083, 0.2 * s), seg=8)

    # ---- aft superstructure: bridge, upper house, mast + radar, funnel
    bridge(m, hl, P, -0.5, dy, 0.24, 0.13, 0.36, roof=P.team)
    house(hl, P.sup, -0.52, dy + 0.13, 0.12, 0.07, 0.2, roof=P.team)
    for s in (-1, 1):
        window_band(hl, P, -0.6, -0.42, dy + 0.06, 0.18, 0.016, s)
        window_band(hl, P, -0.56, -0.48, dy + 0.18, 0.1, 0.012, s)
    top = mast(hl, P, -0.52, dy + 0.2, 0.2, yard=0.18)
    radar_part(m, 'hull', P, 'radar', (-0.52, 0.42, 0), w=0.08)
    strobe(hl, (-0.52, top + 0.012, 0), 0.009, WHITE_L)
    funnel(m, hl, P, 'smoke0', -0.62, dy + 0.05, 0.035, 0.13, rake=0.1)
    for s in (-1, 1):
        raft(hl, P, -0.42, dy + 0.13, 0.16 * s, 0.07)
        cyl(hl, P.dark, 0.012, 0.012, (-0.38, dy + 0.136, 0.17 * s), seg=8)
        lamp(hl, (-0.38, dy + 0.15, 0.17 * s), 0.01, HEAD, 'steady', 3.6, '+x')
    # deck crane, stern winch, ensign, stern lamp
    cyl(hl, P.dark, 0.014, 0.16, (-0.32, dy + 0.08, 0.17), r2=0.012, seg=8)
    cyl_between(hl, P.yellow, (-0.32, dy + 0.15, 0.17), (-0.06, dy + 0.21, 0.17), 0.008, seg=6)
    cyl(hl, P.dark, 0.03, 0.12, (-0.66, dy + 0.03, 0), ROT_Z, seg=10)
    xe = -0.69
    cyl(hl, P.dark, 0.003, 0.12, (xe, H.deck_at(xe) + 0.06, 0), seg=5)
    box(hl, cloth(team=True), (0.05, 0.03, 0.003), (xe - 0.026, H.deck_at(xe) + 0.1, 0))
    nav_ship(hl, P, (-0.705, H.deck_at(-0.705) + 0.02, 0))
