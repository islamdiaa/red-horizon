"""Soviet Tesla coil (1x2): armoured octagonal plinth with a crest and hazard band, a four-leg lattice tower
with team rings around a copper-wound column, four coil discs with blue under-glow (glow:coil), the crown
toroid and the orb (glow:orb, muzzle m0; the procedural halo effect is kept), and the capacitor bank on the
front cell (pulsing blue gauges, insulators, DANGER stencil). Pivots: node --import tsx tools/assets/rig.ts tsla soviet.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sovb import *  # noqa: E402,F403

ID = 'tsla'
FACTION = 'soviet'
KIND = 'defense'

BLUE = 0x5aa2ff


def ring(p, mat, R, t, at, seg=14, h=None):
    """Flat-ish toroid (lathe of a 4-point section): outer radius R, section half-width t."""
    h = h if h is not None else t
    x, y, z = at
    lathe(p, mat, [(R - t, 0.0), (R, h * 0.5), (R - t * 0.2, h), (R - t * 1.6, h * 0.55), (R - t, 0.0)], (x, y - h / 2, z), seg=seg,
          cap_top=False, cap_bottom=False)


def build(m):
    m.set_meta(footprint=(1, 2), height=2.3, radius=0.75, keep=['fx:add:5aa2ff:0.9'])
    look(m, ao_dist=0.3)
    P = Pal()
    r = m.root
    foundation(m, r, P, 1.0, 2.0)
    tz = -0.42
    oct_ = (0, math.pi / 8, 0)

    # ---- armoured octagonal plinth
    cyl(r, P.conc_dk, 0.47, 0.08, (0, Y0 + 0.04, tz), oct_, seg=8, bevel=0.012)
    cyl(r, P.wall_dk, 0.42, 0.24, (0, Y0 + 0.2, tz), oct_, seg=8, bevel=0.01)
    cyl(r, P.dark, 0.425, 0.05, (0, Y0 + 0.2, tz), oct_, seg=8, caps=False)
    for i in range(8):
        a = i * math.pi / 4
        fc = a  # yaw of the face normal
        nx, nz = math.sin(fc), math.cos(fc)
        m.decal(hazard_img(aspect=0.32 / 0.045), at=(nx * 0.39, Y0 + 0.2, tz + nz * 0.39), size=(0.32, 0.045), facing=fc, part=r, depth=0.05)
    cyl(r, P.wall, 0.37, 0.05, (0, Y0 + 0.345, tz), oct_, seg=8, bevel=0.008)
    cyl(r, P.trim, 0.36, 0.025, (0, Y0 + 0.38, tz), oct_, seg=8)
    crest(m, r, (0, Y0 + 0.115, tz + 0.39), 0.13, depth=0.05)
    for s in (-1, 1):
        lamp(r, (s * 0.25, Y0 + 0.37, tz + 0.25), 0.018)

    # ---- lattice tower
    ty = Y0 + 0.37
    th = 1.18
    L0, L1 = 0.28, 0.1
    for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        bar(r, P.gun, (L0 * sx, ty, tz + L0 * sz), (L1 * sx, ty + th, tz + L1 * sz), 0.04)
    for i in range(4):
        f0, f1 = i / 4, (i + 1) / 4
        w0, w1 = L0 + (L1 - L0) * f0, L0 + (L1 - L0) * f1
        y1, y2 = ty + th * f0, ty + th * f1
        for s in (-1, 1):
            bar(r, P.dark, (-w0, y1, tz + w0 * s), (w1, y2, tz + w1 * s), 0.014)
            bar(r, P.dark, (w0 * s, y1, tz - w0), (w1 * s, y2, tz + w1), 0.014)
        rm = P.trim if i % 2 == 0 else P.frame
        for (a, b) in (((-w1, -w1), (w1, -w1)), ((-w1, w1), (w1, w1)), ((-w1, -w1), (-w1, w1)), ((w1, -w1), (w1, w1))):
            bar(r, rm, (a[0] * 1.08, y2, tz + a[1] * 1.08), (b[0] * 1.08, y2, tz + b[1] * 1.08), 0.03, 0.02)
    lamp(r, (0.2, ty + th * 0.5, tz + 0.2), 0.018)
    lamp(r, (-0.2, ty + th * 0.5, tz - 0.2), 0.018)

    # ---- coil column: dark core, copper windings, coil discs with blue under-glow (glow:coil)
    cyl(r, P.dark, 0.12, 0.5, (0, ty + 0.25, tz), r2=0.1, seg=10)
    for i in range(9):
        cyl(r, P.copper if i % 2 == 0 else P.dark, 0.088, 0.13, (0, ty + 0.56 + i * 0.13, tz), seg=10, caps=(i == 8))
    for (h, rad) in ((0.62, 0.3), (0.94, 0.25), (1.24, 0.205), (1.5, 0.165)):
        ring(r, P.gun, rad + 0.03, 0.045, (0, ty + h, tz), seg=14, h=0.07)
        cyl(r, P.trim, rad + 0.008, 0.014, (0, ty + h + 0.036, tz), seg=14, caps=False)
        cyl(r, glow_material('glow:coil', BLUE), rad - 0.005, 0.03, (0, ty + h - 0.04, tz), seg=14, caps=False)
        for a in (math.pi / 4, -math.pi / 4):
            box(r, P.dark, (rad * 2 - 0.06, 0.018, 0.018), (0, ty + h, tz), (0, a, 0))

    # ---- crown: cap, toroid, the orb (glow:orb), muzzle m0
    capY = ty + 1.74
    lathe(r, P.gun, [(0.1, 0.0), (0.13, 0.04), (0.09, 0.09), (0.0, 0.1)], (0, capY - 0.04, tz), seg=14)
    sec = [(0.16 + math.cos(a) * 0.05, math.sin(a) * 0.05) for a in [i * math.pi / 3 for i in range(-3, 4)]]
    lathe(r, P.dark, [(rr, yy) for (rr, yy) in sec], (0, capY + 0.05, tz), seg=16, cap_top=False, cap_bottom=False)
    cyl(r, P.copper, 0.212, 0.016, (0, capY + 0.05, tz), seg=16, caps=False)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        lamp(r, (math.cos(a) * 0.17, capY + 0.1, tz - math.sin(a) * 0.17), 0.016)
    sphere(r, glow_material('glow:orb', BLUE), 0.13, (0, capY + 0.2, tz), seg=12, rings=8)
    m.muzzle('m0', (0, 2.32, -0.42), part='root')

    # ---- capacitor bank on the front cell
    gz = 0.48
    box(r, P.conc_dk, (0.74, 0.06, 0.68), (0, Y0 + 0.03, gz), bevel=0.012)
    box(r, P.wall, (0.66, 0.28, 0.58), (0, Y0 + 0.2, gz), bevel=0.02)
    box(r, P.wall_dk, (0.68, 0.08, 0.6), (0, Y0 + 0.3, gz), bevel=0.01)
    box(r, P.trim, (0.69, 0.025, 0.61), (0, Y0 + 0.345, gz), bevel=0.006)
    box(r, P.roof, (0.62, 0.02, 0.54), (0, Y0 + 0.36, gz))
    gfz = gz + 0.29
    for i in range(3):
        x = -0.2 + i * 0.2
        for k in range(3):
            cyl(r, P.white, 0.036 - k * 0.004, 0.032, (x, Y0 + 0.39 + k * 0.034, gz - 0.12), seg=8)
        cyl(r, P.copper, 0.012, 0.05, (x, Y0 + 0.5, gz - 0.12), seg=6)
        box(r, P.void, (0.14, 0.1, 0.008), (x, Y0 + 0.18, gfz + 0.001))
        box(r, light_mat(BLUE, 2.6, 'pulse'), (0.11, 0.07, 0.006), (x, Y0 + 0.18, gfz + 0.005))
        pipe(r, P.dark, (x, Y0 + 0.53, gz - 0.12), (x * 0.4, ty + 0.2, tz + 0.12), 0.01, flanges=False, seg=5)
    grille(m, r, (0, Y0 + 0.37, gz + 0.12), (0.3, 0.18), facing='+y')
    hazard_stripes(m, r, (0, Y0 + 0.075, gfz + 0.002), (0.6, 0.045))
    stencil(m, r, 'ОПАСНО', (0, Y0 + 0.285, gfz + 0.012), 0.05, color=0xf2b916)
    for s in (-1, 1):
        lamp(r, (s * 0.3, Y0 + 0.37, gz + 0.26), 0.018)
        stripe(m, r, (s * 0.331, Y0 + 0.19, gz), (0.5, 0.06), facing='+x' if s > 0 else '-x', team_k=1)
    junction_box(r, (0.33, Y0 + 0.2, gz - 0.1), (0.06, 0.1, 0.03), facing='+x', conduit=0.1)
