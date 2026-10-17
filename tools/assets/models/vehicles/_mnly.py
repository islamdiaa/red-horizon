"""Minelayer (mnly) shared by the Soviet and Allied scripts (mnly_soviet.py / mnly_allies.py).

Tracked carrier with a sloped faction glacis, armoured cab with vision blocks and the commander's cupola, an
open hopper stacked with mines (Allied: big AT mines, Soviet: small AP mines), a rear dispensing chute with
the mine that slides down it when one is laid (part 'drop'), the amber beacon ('glow:beacon', blinks while
moving / laying) and a mine-warning plate. Muzzle 'm0' = the drop point behind the chute.
Pivots: node --import tsx tools/assets/rig.ts mnly soviet.
"""
from _vk import *  # noqa: F401,F403


def build_mnly(m, fac):
    m.set_meta(height=0.36, radius=0.4, snow=0.3)
    r = m.root
    P = Pal(fac)
    sov = fac == 'soviet'
    hull = P.hull if not sov else P.hull
    panel = P.trim if sov else P.dark2
    mine_mat = painted(0x4a5236, panels=None, wear=0.6, rust=0.25, grime=0.4, rough=0.6, metal=0.35, var=0.1)

    L, H, W, Z = 0.74, 0.13, 0.11, 0.2
    running_gear(m, r, P, L, H, W, Z, 5, wheel_k=0.4, rollers=0)
    for s in (-1, 1):
        fender(r, P.hull_flat, 0.76, 0.125, 0.135, Z * s, front=0.05, rear=0.04)
    box(r, P.dark, (0.66, 0.06, 0.3), (0, 0.085, 0), bevel=0.01)
    prof = [(-0.372, 0.102), (0.31, 0.102), (0.388, 0.152), (0.332, 0.214), (0.08, 0.218), (-0.372, 0.218)]
    side_prism(r, hull, prof, 0.37, bevel=0.017)
    slope_plate(r, panel, (0.388, 0.152), (0.332, 0.214), 0.3, t=0.01, inset=0.84)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        if not sov:
            camo(m, r, (0.0, 0.16, 0.186 * s), (0.6, 0.09), f, seed=101 + s, n=3, colors=(0x6a6a6a,))
        crate(r, P.canvas, (0.14, 0.036, 0.05), (0.12, 0.155, 0.205 * s), bevel=0.008)
        rivet_row(m, r, (-0.34, 0.205, 0.186 * s), (0.28, 0.205, 0.186 * s), facing=f, spacing=0.035, size=0.01)
    if not sov:
        hull_shade(m, r, -0.38, 0.39, 0.217, 0.185, side_y=(0.1, 0.212), fenders=(0.76, 0.141, Z, 0.125, 0.0), deck=False)
    top_star(m, r, fac, (0.29, 0.218, 0.0), 0.085)
    deck_strips(m, r, -0.372, 0.332, 0.217, 0.185, width=0.016)
    fender_strips(m, r, 0.76, 0.2625, 0.141, width=0.014)
    top_lamps(r, 0.0, -0.355, 0.217, 0.17, front=None)
    # mine warning plate (yellow diamond with a red core) on the right side, emblem on the left
    box(r, P.yellow, (0.06, 0.06, 0.006), (0.2, 0.17, 0.188), (0, 0, PI / 4))
    box(r, painted(0xb02418, panels=None, wear=0.3, rust=0.05, rough=0.5), (0.03, 0.03, 0.006), (0.2, 0.17, 0.191), (0, 0, PI / 4))
    emblem(m, r, 'soviet' if sov else 'allied_star', (0.0, 0.165, -0.1865), 0.06, facing='-z')
    number(m, r, '41', (-0.2, 0.165, 0.1865), 0.035, '+z')

    # ---- armoured cab (front) with vision blocks and the commander's cupola
    cab = [(0.05, 0.215), (0.242, 0.215), (0.202, 0.298), (0.06, 0.303)]
    side_prism(r, P.top, cab, 0.26, bevel=0.013)
    deck_strips(m, r, 0.06, 0.202, 0.3, 0.13, width=0.012)
    box(r, P.glass, (0.006, 0.022, 0.2), (0.224, 0.258, 0), (0, 0, 0.45))
    cyl(r, P.dark2, 0.032, 0.026, (0.11, 0.315, -0.06), seg=12, bevel=0.004)
    hatch_round(r, P.dark2, 0.026, (0.11, 0.328, -0.06))
    cyl(r, P.black, 0.016, 0.012, (0.14, 0.309, 0.09), seg=8)
    dome(r, glow_material('glow:beacon', AMBER), 0.016, (0.14, 0.315, 0.09), seg=8, rings=3, h=0.02)
    whip(r, P, (0.06, 0.303, -0.1), 0.2, pennant=True)
    for s in (-1, 1):
        headlight(r, (0.372, 0.182, 0.12 * s), 0.016, guard=P.black)
    tail_lights(r, -0.376, 0.192, 0.15)
    tow_hooks(r, P, 0.39, 0.12, 0.1, 1)

    # ---- hopper full of mines
    hx, hy, hw, hd, hh = -0.16, 0.215, 0.36, 0.32, 0.09
    for s in (-1, 1):
        box(r, panel if sov else P.hull_flat, (hw, hh, 0.02), (hx, hy + hh / 2, hd / 2 * s), bevel=0.006)
    box(r, P.dark2, (0.02, hh, hd), (hx + hw / 2, hy + hh / 2, 0), bevel=0.006)
    box(r, P.dark2, (0.02, hh * 0.7, hd), (hx - hw / 2, hy + hh * 0.35, 0), bevel=0.006)
    box(r, P.black, (hw - 0.03, 0.01, hd - 0.03), (hx, hy + 0.012, 0))
    hazard_stripes(m, r, (hx - hw / 2 - 0.011, hy + 0.045, 0.0), (hd, 0.03), facing='-x')
    deck_strips(m, r, hx - hw / 2, hx + hw / 2, hy + hh, hd / 2 + 0.01, width=0.014)
    for s in (-1, 1):
        stencil(m, r, 'МИНЫ' if sov else 'MINES', (hx - 0.04, hy + hh * 0.5, (hd / 2 + 0.0105) * s), 0.04, facing='+z' if s > 0 else '-z')
    mr = 0.04 if not sov else 0.03
    for i in range(3):
        for k in range(3):
            mx, mz = hx - 0.11 + i * 0.11, -0.09 + k * 0.09
            cyl(r, mine_mat, mr, 0.046, (mx, hy + 0.042, mz), r2=mr * 0.95, seg=10, bevel=0.004)
            cyl(r, P.black, mr * 0.4, 0.008, (mx, hy + 0.068, mz), seg=6)
    # rear dispensing chute
    box(r, P.gun, (0.2, 0.012, 0.11), (-0.45, 0.12, 0), (0, 0, 0.55), bevel=0.003)
    for s in (-1, 1):
        box(r, P.black, (0.2, 0.026, 0.008), (-0.45, 0.13, 0.058 * s), (0, 0, 0.55))
    # the mine that rides down the chute (shown by the game when one is laid)
    d = m.part('drop', at=(-0.37, 0.17, 0))
    cyl(d, mine_mat, mr, 0.022, (0, 0.012, 0), r2=mr * 0.95, seg=10)
    cyl(d, P.black, mr * 0.4, 0.006, (0, 0.026, 0), seg=6)
    m.muzzle('m0', (-0.5, 0.06, 0), part='root')
