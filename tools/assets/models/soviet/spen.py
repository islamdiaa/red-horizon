"""Soviet sub pen (3x3, on water): a massive concrete U-boat bunker on pilings: two bays with ribbed roller
shutters (parts door0 / door1, rolled up by the game), hazard lintels and lit interiors (a submarine docked in
the right bay), a thick roof with a beam grid, a painted star and the СЛАВА ФЛОТУ billboard, the command tower
with lit windows, AA nests in sandbag rings, vent shafts (smoke0), piers with bollards, red lamps and banners.
Pivots: node --import tsx tools/assets/rig.ts spen soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'spen'
FACTION = 'soviet'
KIND = 'naval'

TOP = 0.1      # pier deck
ROOF = 0.5     # underside of the roof slab
ZB, ZF = -0.75, 1.3


def platform(r, P, x, z, w, d):
    """Concrete deck on pilings (only the piling tops show above the water)."""
    box(r, P.conc_dk, (w, 0.08, d), (x, TOP - 0.04, z), bevel=0.012)
    box(r, P.conc, (w + 0.012, 0.025, d + 0.012), (x, TOP - 0.085, z), bevel=0.006)
    nx = max(2, round(w / 0.45))
    nz = max(2, round(d / 0.45))
    pil = deep(concrete(0x4a4a46, grime=0.9, streaks=0.4, wear=0.3), 0.8)
    for i in range(nx):
        for k in range(nz):
            if 0 < i < nx - 1 and 0 < k < nz - 1:
                continue
            px = x - w / 2 + 0.05 + (w - 0.1) * i / (nx - 1)
            pz = z - d / 2 + 0.05 + (d - 0.1) * k / (nz - 1)
            cyl(r, pil, 0.032, 0.5, (px, TOP - 0.1 - 0.25, pz), r2=0.034, seg=4, caps=False)


def build(m):
    m.set_meta(footprint=(3, 3), height=1.05, radius=1.55)
    look(m, ao_dist=0.4)
    P = Pal()
    r = m.root
    bunker = deep(concrete(0x8e897f, joints=(0.6, 0.2), grime=0.9, streaks=1.0, wear=0.75), 0.85)
    bayD = ZF - ZB
    zc = (ZB + ZF) / 2
    # ---- walls between / beside the bays, back block
    for (x, w) in ((-1.27, 0.26), (0.0, 0.3), (1.27, 0.26)):
        platform(r, P, x, zc, w, bayD)
        box(r, bunker, (w, ROOF - TOP, bayD), (x, TOP + (ROOF - TOP) / 2, zc), bevel=0.02)
    platform(r, P, 0, -1.12, 2.8, 0.72)
    box(r, bunker, (2.8, ROOF - TOP, 0.72), (0, TOP + (ROOF - TOP) / 2, -1.12), bevel=0.02)
    # ---- roof slab + beam grid, team fascia
    slab_z = zc - 0.37
    box(r, deep(concrete(0xa8a398, joints=(0.5, 0.5), grime=0.7, streaks=0.9), 0.7), (2.88, 0.1, bayD + 0.76), (0, ROOF + 0.05, slab_z), bevel=0.03)
    for i in range(6):
        box(r, bunker, (2.8, 0.07, 0.11), (0, ROOF + 0.135, -1.3 + i * 0.5), bevel=0.015)
    for x in (-1.27, 0.0, 1.27):
        box(r, bunker, (0.13, 0.07, 2.6), (x, ROOF + 0.135, -0.07), bevel=0.015)
    box(r, P.trim, (2.9, 0.05, 0.06), (0, ROOF + 0.04, ZF + 0.012), bevel=0.008)
    top_star(m, r, (0.64, ROOF + 0.101, 0.2), 0.95, emit=0.35)
    tilt_sign(m, r, P, (0.0, ROOF + 0.17 + 0.15, ZF - 0.16), (1.0, 0.26), 'СЛАВА ФЛОТУ', tilt=0.5, lights=4)
    for (x, z) in ((-1.4, ZF), (1.4, ZF), (-1.4, -1.46), (1.4, -1.46)):
        lamp(r, (x, ROOF + 0.1, z - 0.04 if z > 0 else z + 0.04), 0.024)

    # ---- command tower (back left)
    tx, tz = -0.9, -1.1
    ry = ROOF + 0.1
    box(r, bunker, (0.5, 0.36, 0.42), (tx, ry + 0.18, tz), bevel=0.02)
    box(r, P.trim, (0.54, 0.04, 0.46), (tx, ry + 0.36, tz), bevel=0.01)
    window_row(r, (tx, ry + 0.25, tz + 0.21), 3, (0.08, 0.055), 0.05, strength=2.0)
    window_row(r, (tx + 0.25, ry + 0.25, tz), 3, (0.08, 0.055), 0.05, facing='+x', dark=(0, 2), strength=2.0)
    box(r, P.gun, (0.16, 0.08, 0.16), (tx - 0.08, ry + 0.42, tz - 0.05), bevel=0.01)
    lamp(r, (tx - 0.08, ry + 0.46, tz - 0.05), 0.02)
    for (dx, dz, h) in ((0.15, -0.12, 0.42), (-0.15, 0.12, 0.3)):
        antenna(r, (tx + dx, ry + 0.38, tz + dz), h, light_color=None)
        lamp(r, (tx + dx, ry + 0.38 + h, tz + dz), 0.016)
    # ---- AA nests, vent shafts (smoke0 on the left one)
    for (ax, az) in ((0.95, -1.1), (-0.2, 0.9)):
        lathe(r, P.sand, [(0.13, 0.0), (0.18, 0.0), (0.17, 0.06), (0.135, 0.06)], (ax, ry + 0.07, az), seg=12)
        cyl(r, P.gun, 0.05, 0.05, (ax, ry + 0.095, az), r2=0.045, seg=8)
        for s in (-1, 1):
            cyl(r, P.dark, 0.006, 0.16, (ax + 0.05, ry + 0.16, az + 0.014 * s), (0, 0, -1.1), seg=4)
    for (vx, vz) in ((0.3, -1.1), (0.55, -1.1), (-0.4, -0.2)):
        cyl(r, P.gun, 0.048, 0.08, (vx, ry + 0.11, vz), r2=0.044, seg=8)
        cyl(r, P.void, 0.04, 0.004, (vx, ry + 0.151, vz), seg=8)
    m.smoke('smoke0', (-0.4, 0.75, -0.2))

    # ---- bays: lintels, hazard stripes, interiors, shutters
    for i, (bx, bw) in enumerate(((-0.64, 0.98), (0.64, 0.98))):
        box(r, P.conc_dk, (bw + 0.04, 0.09, 0.07), (bx, ROOF - 0.045, ZF), bevel=0.01)
        m.decal(hazard_img(aspect=bw / 0.035), at=(bx, ROOF - 0.05, ZF + 0.036), size=(bw, 0.035), facing='+z', part=r, depth=0.01)
        box(r, P.void, (bw, ROOF - TOP, 0.02), (bx, TOP + (ROOF - TOP) / 2, ZB + 0.01))
        box(r, P.dark, (bw, 0.01, bayD), (bx, ROOF - 0.005, zc))
        for zz in (-0.3, 0.4):
            box(r, light_mat(0xffd9a0, 2.4, 'steady'), (0.4, 0.01, 0.035), (bx, ROOF - 0.012, zz))
        box(r, P.conc_lt, (0.1, 0.02, bayD - 0.1), (bx + (bw / 2 - 0.05) * (1 if i else -1), TOP + 0.01, zc), bevel=0.004)
        d = m.part(f'door{i}', at=(bx, 0.42, 1.27))
        dh = ROOF - TOP - 0.1
        box(d, corrugated(0x4a5057, along='x', pitch=0.05, rust=0.5, wear=0.65, streaks=0.9), (bw - 0.04, dh, 0.03), (0, -dh / 2, 0), bevel=0.004)
        box(d, P.trim, (bw - 0.04, 0.03, 0.04), (0, -dh + 0.015, 0))
        stencil(m, d, f'0{i + 1}', (0.28, -dh * 0.5, 0.016), 0.12)
    # docked submarine (right bay)
    hull = painted(0x2e3236, wear=0.4, rust=0.4, grime=0.6, streaks=0.5, panels=None)
    lathe(r, hull, [(0.0, -0.55), (0.06, -0.48), (0.085, -0.2), (0.085, 0.3), (0.06, 0.5), (0.0, 0.58)], (0.64, -0.01, 0.15), seg=10,
          rot=(math.pi / 2, 0, 0), scale=(1, 1, 0.72))
    box(r, hull, (0.05, 0.11, 0.17), (0.64, 0.09, 0.1), bevel=0.01)

    # ---- piers (front) with bollards, lamps, banners; a ladder
    for s in (-1, 1):
        platform(r, P, 1.27 * s, ZF + 0.12, 0.26, 0.26)
        cyl(r, P.dark, 0.018, 0.035, (1.27 * s, TOP + 0.017, ZF + 0.15), r2=0.022, seg=8)
        lamp(r, (1.36 * s, TOP, ZF + 0.2), 0.02)
        red_banner(m, r, (1.27 * s, ROOF - 0.02, ZF + 0.03), (0.2, 0.32))
        m.decal(big_star(), at=(1.401 * s, TOP + 0.2, 0.3), size=(0.22, 0.22), facing='+x' if s > 0 else '-x', part=r, depth=0.03, team=0)
    red_banner(m, r, (0.0, ROOF - 0.02, ZF + 0.03), (0.22, 0.34))
    ladder(r, P.rail, (-1.40, TOP, -0.4), ROOF - TOP, facing='-x')
