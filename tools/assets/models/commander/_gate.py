"""Fortress gate (1x1, Commander rules), shared by gate_soviet.py / gate_allies.py: two heavy concrete pillars the
height of the concrete wall's posts with buttresses and team bands, a gatehouse lintel with the faction crest and
hazard stripes, and the ribbed steel portcullis (part 'door', raised by the game with the building's door value)
under amber beacons ('glow:gate'). Everything sits in part 'gate', which the game turns along north-south walls.
Layout and pivots: src/render/models/commander-structures.ts fortressGate().
"""
import math

from _cmd import *  # noqa: F401,F403
from kit import decals as _D  # noqa: E402


def build_gate(m, fac):
    D = Dress(fac)
    sov = D.sov
    D.look(m, ao_dist=0.26)
    m.set_meta(footprint=(1, 1), height=1.15, radius=0.55)
    r = m.root
    wall = SV.deep(concrete(0x8a867e, joints=(0.25, 0.2), grime=0.85, streaks=0.9, wear=0.75), 0.82) if sov else \
        AL.tune(concrete(0xc0bcb1, joints=(0.25, 0.2), grime=0.7, streaks=0.9, wear=0.7), ao=0.85)
    dark = D.conc_dk

    box(r, D.conc, (0.98, Y0, 0.98), (0, Y0 / 2, 0), bevel=0.014)
    g = m.part('gate', at=(0, 0, 0))
    box(g, D.tar, (0.6, 0.012, 0.98), (0, Y0 + 0.006, 0))
    for s in (-1, 1):
        x = s * 0.4
        box(g, dark, (0.24, 0.08, 0.5), (x, Y0 + 0.04, 0), bevel=0.015)
        box(g, wall, (0.2, 1.02, 0.42), (x, Y0 + 0.51, 0), bevel=0.025)
        for zz in (-1, 1):
            prism(g, dark, [(0.0, 0.0), (0.07, 0.0), (0.07, 0.15), (0.0, 0.9)], 0.07, (x + s * 0.1, Y0, zz * 0.2), (0, 0 if s > 0 else math.pi, 0), bevel=0.008)
        box(g, dark, (0.25, 0.06, 0.47), (x, Y0 + 1.05, 0), bevel=0.012)
        box(g, D.trim, (0.215, 0.03, 0.435), (x, Y0 + 0.95, 0), bevel=0.006)
        for zz in (-1, 1):
            m.decal(_D.panel_outline(aspect=0.2 / 0.5), at=(x, Y0 + 0.55, zz * 0.211), size=(0.16, 0.42), facing='+z' if zz > 0 else '-z', part=g, depth=0.02, color=True)
        if sov:
            SV.lamp(g, (x, Y0 + 1.08, 0.12), 0.02)
        else:
            AL.floodlight(g, (x, Y0 + 1.08, 0.18), yaw=0.0, pitch=0.7, s=0.045)
    # lintel / gatehouse beam, crest both sides, hazard stripes under it, beacons
    box(g, wall, (0.98, 0.2, 0.36), (0, Y0 + 0.96, 0), bevel=0.02)
    box(g, dark, (1.0, 0.04, 0.4), (0, Y0 + 1.08, 0), bevel=0.01)
    for zz, f in ((1, '+z'), (-1, '-z')):
        hazard_stripes(m, g, (0, Y0 + 0.875, zz * 0.181), (0.56, 0.05), facing=f)
        if sov:
            SV.crest(m, g, (0, Y0 + 0.98, zz * 0.181), 0.15, facing=f)
        else:
            AL.roundel(m, g, (0, Y0 + 0.98, zz * 0.181), 0.13, facing=f)
        sphere(g, glow_material('glow:gate', 0xffa020), 0.016, (0.3, Y0 + 1.12, zz * 0.12), seg=8, rings=5)
        box(g, D.dark, (0.04, 0.02, 0.04), (0.3, Y0 + 1.1, zz * 0.12))
    # the portcullis
    dr = m.part('door', parent='gate', at=(0, 0, 0))
    plate = painted(0x5c646d if sov else 0x87909a, panels=(0.2, 0.16), wear=0.75, grime=0.6, rust=0.4, streaks=0.8)
    box(dr, plate, (0.58, 0.78, 0.06), (0, Y0 + 0.4, 0), bevel=0.01)
    for i in range(4):
        box(dr, D.frame, (0.6, 0.035, 0.08), (0, Y0 + 0.1 + i * 0.2, 0), bevel=0.006)
    for x in (-0.18, 0.0, 0.18):
        box(dr, D.steel, (0.04, 0.76, 0.075), (x, Y0 + 0.4, 0), bevel=0.006)
    box(dr, D.trim, (0.58, 0.04, 0.085), (0, Y0 + 0.72, 0), bevel=0.006)
    for zz, f in ((0.042, '+z'), (-0.042, '-z')):
        hazard_stripes(m, dr, (0, Y0 + 0.04, zz), (0.56, 0.05), facing=f)
        rivet_row(m, dr, (-0.26, Y0 + 0.6, zz), (0.26, Y0 + 0.6, zz), facing=f)
