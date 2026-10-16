"""Allied missile silo (2x1): a heavy concrete silo block with an open launch shaft, hazard edges and
radiation plates, the sliding blast doors (animated parts doorL / doorR, team stripe, hazard chevrons), the
white missile with a red nose and a team band (animated part 'missile', rises out of the shaft), the white
control bunker with red-lit windows, a roundel and a mast, and red warning lamps ('glow:warn').
The procedural m0 muzzle (shaft top) is kept.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403
from _allied import _imgs  # noqa: E402

ID = 'mslo'
FACTION = 'allies'
KIND = 'structure'


def build(m):
    setup(m, ao_dist=0.3)
    m.ground = False  # the missile rests below ground: no ground plane in the AO bake (it would black it out)
    m.set_meta(footprint=(2, 1), height=0.55, radius=1.05)
    r = m.root

    wall = white()
    frm = frame()
    tr = trim()
    rf = roof()
    conc = tune(concrete(0xbab6ab, joints=(0.35, 0.14), grime=0.75, streaks=0.9, wear=0.7), ao=0.85)
    door_m = steel(0x8b96a1, panels=(0.14, 0.14), wear=0.7)
    warn = glow_material('glow:warn', 0xff2a1a)

    box(r, slab_m(0x8d887f), (1.96, Y0, 0.96), (0, Y0 / 2, 0), bevel=0.016)
    # ---- silo block around an open shaft (0.5 x 0.5 at x = -0.2)
    sx, sw, sd, sh = -0.2, 1.42, 0.84, 0.14
    hole = 0.25
    y0, y1 = Y0, Y0 + sh
    slab(r, conc, sx - sw / 2, sx - hole, y0, y1, -sd / 2, sd / 2, bevel=0.02)
    slab(r, conc, sx + hole, sx + sw / 2, y0, y1, -sd / 2, sd / 2, bevel=0.02)
    slab(r, conc, sx - hole, sx + hole, y0, y1, -sd / 2, -hole, bevel=0.01)
    slab(r, conc, sx - hole, sx + hole, y0, y1, hole, sd / 2, bevel=0.01)
    # shaft lining (faces inward) + a dark bottom
    lin = tune(concrete(0x55524d, grime=0.4, streaks=0.2), ao=0.95)
    for s in (-1, 1):
        box(r, lin, (0.02, 0.62, 0.5), (sx + s * (hole + 0.01), y1 - 0.31, 0))
        box(r, lin, (0.5, 0.62, 0.02), (sx, y1 - 0.31, s * (hole + 0.01)))
    box(r, black(), (0.5, 0.01, 0.5), (sx, y1 - 0.6, 0))
    # top: hazard frame round the shaft, radiation plates, a team band on the block
    for s in (-1, 1):
        hazard_band(m, r, (sx, y1, s * 0.3), (0.62, 0.06), facing='+y', base=conc)
        hazard_band(m, r, (sx + s * 0.3, y1, 0), (0.5, 0.06), facing='+y', roll=math.pi / 2, base=conc)
    _rad_plate(m, r, (-0.72, y1, 0.24))
    _rad_plate(m, r, (0.28, y1, -0.26))
    box(r, tr, (sw + 0.012, 0.03, sd + 0.012), (sx, y1 - 0.035, 0), bevel=0.006)
    stencil(m, r, 'DANGER  HIGH EXPLOSIVE', (sx, Y0 + 0.06, sd / 2 + 0.003), 0.035, color=0x2a2e34, depth=0.02)
    for (x, z, y) in ((-0.88, 0.36, y1), (0.48, -0.36, y1), (0.55, 0.15, None)):
        yy = y if y is not None else Y0 + 0.34 + 0.02
        cyl(r, dark_m(), 0.022, 0.03, (x, yy + 0.015, z), seg=8)
        sphere(r, warn, 0.02, (x, yy + 0.04, z), seg=8, rings=5)

    # ---- the missile (rest below the doors; rises with the door anim)
    ms = m.part('missile', at=(-0.2, -0.41, 0))
    body = white(panels=(0.2, 0.12), grime=0.35, streaks=0.4, wear=0.35)
    cyl(ms, body, 0.095, 0.4, (0, 0.2, 0), seg=16)
    lathe(ms, painted(0xc8231a, panels=None, wear=0.35, grime=0.3), [(0.095, 0.0), (0.088, 0.06), (0.065, 0.12), (0.03, 0.17), (0.0, 0.18)], (0, 0.4, 0), seg=16, cap_bottom=False)
    cyl(ms, tr, 0.098, 0.05, (0, 0.3, 0), seg=16, caps=False)
    cyl(ms, frm, 0.098, 0.015, (0, 0.1, 0), seg=16, caps=False)
    for i in range(4):
        a = i / 4 * math.pi * 2 + math.pi / 4
        box(ms, frm, (0.012, 0.1, 0.07), (math.cos(a) * 0.12, 0.06, -math.sin(a) * 0.12), (0, a, 0), bevel=0.003)
    stencil(m, ms, 'USAF', (0, 0.2, 0.097), 0.03, color=0x2a2e34, depth=0.02)

    # ---- blast doors (slide apart along x)
    for (name, s) in (('doorL', -1), ('doorR', 1)):
        d = m.part(name, at=(-0.2, Y0 + 0.14, 0))
        box(d, door_m, (0.27, 0.045, 0.58), (s * 0.135, 0.022, 0), bevel=0.01)
        for i in range(3):
            box(d, frm, (0.014, 0.047, 0.52), (s * (0.05 + i * 0.07), 0.022, 0))
        box(d, tr, (0.022, 0.048, 0.58), (s * 0.011, 0.022, 0))
        m.decal(chevron_img(2, HAZ_Y), at=(s * 0.15, 0.046, 0), size=(0.2, 0.3), facing='+y', part=d, depth=0.01, team=0, rough=0.6,
                roll=-s * math.pi / 2)

    # ---- control bunker (right)
    bx, bz, bw, bd, bh = 0.68, -0.05, 0.42, 0.6, 0.34
    top = block(m, r, bx, bz, bw, bd, bh, wall=wall, cornice=tr, roof_m=rf, cap=frm, pilasters=(bx - bw / 2 + 0.025, bx + bw / 2 - 0.025))
    bfz = bz + bd / 2
    glazing(m, r, (bx, Y0 + 0.22, bfz + 0.004), (0.26, 0.07), 2, lit={0, 1}, color=0xff4a30, emit=0.8)
    roundel(m, r, (bx, Y0 + 0.11, bfz + 0.002), 0.11, plate=wall)
    cyl(r, dark_m(), 0.008, 0.36, (bx + 0.1, top + 0.18, bz - 0.15), r2=0.004, seg=6)
    light(r, (bx + 0.1, top + 0.37, bz - 0.15), 0.011, 0xff2a1a, 'blink')
    ac_unit(r, (bx - 0.05, top, bz - 0.1), 0.08)
    pipe_run(r, dark_m(), [(bx - bw / 2, Y0 + 0.1, -0.2), (0.1, Y0 + 0.1, -0.2)], 0.02)
    floodlight(r, (bx - 0.15, top + 0.02, bfz - 0.03), yaw=-0.5, pitch=0.8, s=0.04)


def _rad_plate(m, r, at):
    """Yellow radiation plate (trefoil) lying on the silo top."""
    from kit import decals as _D
    if 'trefoil' not in _imgs:
        px = 128
        cv = _D.Canvas(px, px, ss=2)
        cv.rect(0, 0, px, px, _D.lin(HAZ_Y))
        c = px / 2
        k = _D.lin(0x111111)
        cv.circle(c, c, px * 0.08, k)
        for i in range(3):
            a0 = math.pi / 2 + i * 2 * math.pi / 3 - math.pi / 6
            pts = [(c + math.cos(a0) * px * 0.13, c + math.sin(a0) * px * 0.13)]
            for j in range(7):
                a = a0 + (math.pi / 3) * j / 6
                pts.append((c + math.cos(a) * px * 0.42, c + math.sin(a) * px * 0.42))
            pts.append((c + math.cos(a0 + math.pi / 3) * px * 0.13, c + math.sin(a0 + math.pi / 3) * px * 0.13))
            cv.poly([(c, c)] + pts, k)
        cv.circle(c, c, px * 0.11, _D.lin(HAZ_Y), r_in=px * 0.08)
        _imgs['trefoil'] = cv.image()
    x, y, z = at
    box(r, frame(), (0.15, 0.008, 0.15), (x, y + 0.004, z))
    m.decal(_imgs['trefoil'], at=(x, y + 0.008, z), size=(0.13, 0.13), facing='+y', depth=0.003, team=0, rough=0.6)
