"""Allied construction yard (3x3): assembly hall with a glazed sawtooth roof and a half-raised assembly door
(lit bay), the command tower with a glass control cab, star roundel, floodlights, dish and mast, the vehicle
bay annex, the yellow tower crane (animated part 'crane') and a front yard with a prefab module going up.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403

ID = 'fact'
FACTION = 'allies'
KIND = 'structure'


def build(m):
    setup(m)
    m.set_meta(footprint=(3, 3), height=1.7, radius=1.55)
    r = m.root

    wall = white()
    wall2 = offwhite()
    stl = steel()
    frm = frame()
    tr = trim()
    rf = roof()
    base = slab_m(0x8d887f)
    yel = yellow()
    glass_lit = glass(lit=0xc4defa, strength=0.45)
    rail = rail_m()
    rstl = steel(0xa3acb5, panels=(0.18, 0.5), grime=0.6, streaks=0.5)

    # ---- foundation: slab, asphalt apron with lane marks, front hazard kerb
    box(r, slab_m(0x9d988e, joints=(0.5, 0.5)), (2.98, Y0, 2.98), (0, Y0 / 2, 0), bevel=0.02)
    box(r, asphalt(), (2.2, 0.012, 1.16), (-0.25, Y0 + 0.006, 0.76), bevel=0.003)
    for i in range(5):
        mark(m, r, solid(HAZ_Y), (-1.2 + i * 0.42, Y0 + 0.012, 0.2), (0.18, 0.035), asphalt(), rough=0.6)
    hazard_band(m, r, (-0.25, Y0 + 0.012, 1.31), (2.2, 0.06), facing='+y', base=asphalt())
    mark(m, r, chevron_img(3), (-0.74, Y0 + 0.012, 0.42), (0.36, 0.42), asphalt(), roll=math.pi, rough=0.6)

    # ---- assembly hall (back left)
    hx, hz, hw, hd, hh = -0.48, -0.75, 1.8, 1.26, 0.92
    fz = hz + hd / 2
    ex = hx + hw / 2
    top = block(m, r, hx, hz, hw, hd, hh, wall=wall, cornice=tr, roof_m=rf, cap=frm,
                pilasters=(hx - hw / 2 + 0.03, -0.32, 0.12, ex - 0.03), side_pilasters=(hz - 0.3, hz + 0.3), parapet=False)
    rt = Y0 + hh
    # glazed sawtooth roof: three teeth along z, the glazing faces the camera (+z) and glows faintly
    n_t = 3
    tz0 = hz - hd / 2 + 0.03
    pitch = (hd - 0.06) / n_t
    for i in range(n_t):
        z0 = tz0 + i * pitch
        z1 = z0 + pitch
        _tooth(m, r, rstl, glass_lit, tr, frm, hx, rt, z0, z1, hw - 0.06)
    parapet_rect(r, frm, hx - hw / 2 - 0.025, hz - hd / 2 - 0.025, ex + 0.025, fz + 0.025, rt - 0.01, h=0.05, t=0.035)
    # roof plant on the hall: vent stack (steam0), AC units
    cyl(r, gun_m(), 0.035, 0.11, (-1.14, rt + 0.055 + 0.0, -1.25), seg=10)
    cyl(r, frm, 0.05, 0.02, (-1.14, rt + 0.115, -1.25), seg=10, bevel=0.004)
    m.steam('steam0', (-1.14, 1.08, -1.25))

    # front facade: half-raised assembly door with a lit bay, banner, lit sign, windows, doorway
    dx, dw, dh = -0.72, 0.66, 0.66
    open_h = 0.26
    box(r, black(), (dw, dh, 0.01), (dx, Y0 + dh / 2, fz + 0.003))
    box(r, light_mat(WIN_WARM, 1.0, 'steady'), (dw * 0.86, open_h * 0.8, 0.004), (dx, Y0 + open_h * 0.45, fz + 0.006))
    box(r, asphalt(0x2c2d30), (dw, 0.006, 0.12), (dx, Y0 + 0.003, fz - 0.06))
    shutter = corrugated(0x6c7680, along='x', pitch=0.024, rust=0.35, streaks=0.8)
    box(r, shutter, (dw - 0.02, dh - open_h, 0.014), (dx, Y0 + open_h + (dh - open_h) / 2, fz + 0.012), bevel=0.003)
    box(r, yel, (dw - 0.02, 0.026, 0.024), (dx, Y0 + open_h + 0.013, fz + 0.016), bevel=0.004)
    jt = 0.055
    for s in (-1, 1):
        box(r, frm, (jt, dh + 0.04, 0.06), (dx + s * (dw / 2 + jt / 2), Y0 + (dh + 0.04) / 2, fz + 0.03), bevel=0.01)
        m.decal(haz_img((dh + 0.04) / jt), at=(dx + s * (dw / 2 + jt / 2), Y0 + (dh + 0.04) / 2, fz + 0.061),
                size=(dh + 0.04, jt * 0.9), facing='+z', depth=0.02, team=0, roll=math.pi / 2)
    box(r, frm, (dw + 2 * jt + 0.04, 0.075, 0.07), (dx, Y0 + dh + 0.04, fz + 0.035), bevel=0.012)
    m.decal(haz_img((dw + 2 * jt) / 0.06), at=(dx, Y0 + dh + 0.04, fz + 0.071), size=(dw + 2 * jt, 0.06), facing='+z', depth=0.02, team=0)
    for s in (-1, 1):
        light(r, (dx + s * (dw / 2 + jt / 2), Y0 + dh + 0.08, fz + 0.05), 0.02, 0xffa020, 'blink')
    stencil(m, r, 'BAY 1', (dx, Y0 + open_h + 0.22, fz + 0.02), 0.07, color=WHITE_TXT)
    eagle_banner(m, r, (hx - hw / 2 + 0.1, top - 0.08, fz + 0.03), (0.17, 0.56))
    lit_sign(m, r, (0.05, Y0 + 0.72, fz + 0.03), (0.7, 0.21), 'ALLIED|ENGINEERS', lights=3, scales=[1.0, 1.0])
    window_row(r, (0.02, Y0 + 0.44, fz), 3, (0.1, 0.1), 0.05, lit=WIN_WARM, dark=(1,))
    lit_doorway(m, r, (0.3, Y0 + 0.0, fz), (0.15, 0.26))
    hazard_band(m, r, (0.03, Y0 + 0.07, fz + 0.022), (0.72, 0.05))
    rivet_row(m, r, (hx - hw / 2 + 0.05, top - 0.09, fz + 0.001), (ex - 0.05, top - 0.09, fz + 0.001))
    for x in (hx - hw / 2 + 0.06, ex - 0.06):
        strobe(r, (x, rt + 0.04, fz - 0.02))

    # ---- command tower (back right): the landmark
    tx, tz, tw, th = 1.0, -0.86, 0.66, 1.22
    tfz = tz + tw / 2
    block(m, r, tx, tz, tw, tw, th, wall=wall, cornice=tr, roof_m=rf, cap=frm, pilasters=(tx - tw / 2 + 0.03, tx + tw / 2 - 0.03),
          side_pilasters=(tz - 0.2, tz + 0.2), band=False, parapet=False)
    # big star roundel high on the camera face (the annex hides the lower part), team band, windows
    roundel(m, r, (tx, Y0 + 1.0, tfz + 0.002), 0.34)
    box(r, tr, (tw + 0.012, 0.06, tw + 0.012), (tx, Y0 + 0.78, tz), bevel=0.006)
    window_row(r, (tx, Y0 + 0.66, tfz), 3, (0.08, 0.08), 0.05, lit=WIN_WARM, dark=(1,))
    ladder(r, rail, (tx + tw / 2, Y0 + 0.1, tz + 0.15), th - 0.1, facing='+x', rung=0.08)
    # control cab: flared glass band, steel deck, overhanging roof with team trim
    cy = Y0 + th
    box(r, frm, (tw + 0.1, 0.055, tw + 0.1), (tx, cy + 0.027, tz), bevel=0.012)
    cab_h = 0.2
    box(r, glass(0x2b4762), (tw + 0.01, cab_h, tw + 0.01), (tx, cy + 0.055 + cab_h / 2, tz))
    gy = cy + 0.055 + cab_h / 2
    for (fc, at_, lit) in (('+z', (tx, gy, tz + tw / 2 + 0.006), {0, 1, 3}), ('-x', (tx - tw / 2 - 0.006, gy, tz), {1, 2}),
                           ('+x', (tx + tw / 2 + 0.006, gy, tz), {0, 3})):
        m.decal(windows_img(4, 1, lit=set(), dark=0x2b4762, frame=0x23272c), at=at_, size=(tw, cab_h), facing=fc, depth=0.012, team=0, rough=0.12)
        m.decal(lit_panes_img(4, 1, lit=lit, color=WIN_COOL), at=at_, size=(tw, cab_h), facing=fc, depth=0.012, team=0, emit=0.9)
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(r, frm, (0.03, cab_h, 0.03), (tx + sx * (tw / 2 + 0.012), cy + 0.055 + cab_h / 2, tz + sz * (tw / 2 + 0.012)), bevel=0.004)
    ctop = cy + 0.055 + cab_h
    box(r, tr, (tw + 0.16, 0.035, tw + 0.16), (tx, ctop + 0.017, tz), bevel=0.01)
    box(r, rf, (tw + 0.12, 0.03, tw + 0.12), (tx, ctop + 0.045, tz), bevel=0.01)
    rtop = ctop + 0.06
    for (sx, sz) in ((-1, 1), (1, 1)):
        floodlight(r, (tx + sx * (tw / 2 + 0.02), rtop + 0.02, tz + sz * (tw / 2 + 0.02)), yaw=sx * 0.5, pitch=0.75, s=0.055)
    for (sx, sz) in ((-1, -1), (1, -1)):
        strobe(r, (tx + sx * (tw / 2 + 0.03), rtop + 0.005, tz + sz * (tw / 2 + 0.03)))
    # mast with beacon, dish, AC
    mx, mz = tx + 0.18, tz - 0.16
    cyl(r, gun_m(), 0.016, 0.5, (mx, rtop + 0.25, mz), r2=0.008, seg=6)
    for k in range(3):
        bar(r, rail, (mx - 0.06 + k * 0.0, rtop + 0.14 + k * 0.11, mz), (mx + 0.06, rtop + 0.14 + k * 0.11, mz), 0.008)
    light(r, (mx, rtop + 0.5, mz), 0.016, 0xff2a1a, 'blink')
    dish(r, (tx - 0.14, rtop, tz - 0.12), 0.12, mat=white(panels=None), yaw=2.4, pitch=0.7)
    ac_unit(r, (tx - 0.12, rtop, tz + 0.2), 0.1)
    # catwalk across the tower front at the annex roof height
    catwalk(m, r, (tx, Y0 + 0.5, tfz + 0.05), tw - 0.04, 0.09, axis='x', rail=rail, sides=(False, True))

    # ---- vehicle bay annex (right front)
    ax, az, aw, ad, ah = 1.0, 0.06, 0.68, 0.62, 0.48
    afz = az + ad / 2
    atop = block(m, r, ax, az, aw, ad, ah, wall=wall2, cornice=tr, roof_m=rf, cap=frm,
                 pilasters=(ax - aw / 2 + 0.025, ax + aw / 2 - 0.025))
    door(m, r, (ax - 0.08, Y0 + 0.0, afz), (0.36, 0.31), kind='roller', hazard_frame=True)
    stencil(m, r, '01', (ax + 0.23, Y0 + 0.36, afz + 0.002), 0.08, color=0xe8b51a)
    light(r, (ax - 0.08, Y0 + 0.37, afz + 0.03), 0.014, 0xffa020, 'blink')
    roundel(m, r, (ax - 0.02, atop + 0.002, az + 0.02), 0.4, facing='+y')
    ac_unit(r, (ax + 0.22, atop, az - 0.18), 0.09)
    roof_vent(r, (ax - 0.25, atop, az - 0.2), 0.03)
    for x in (ax - aw / 2 + 0.04, ax + aw / 2 - 0.04):
        strobe(r, (x, atop + 0.035, afz - 0.02))
    # stair up to the catwalk, pipes from the hall to the annex
    for k in range(6):
        box(r, stl, (0.2, 0.012, 0.05), (ax - 0.52 + 0.0, Y0 + 0.04 + k * 0.08, az + 0.16 - k * 0.045), bevel=0.002)
    bar(r, rail, (ax - 0.62, Y0, az + 0.18), (ax - 0.62, Y0 + 0.5, az - 0.07), 0.01)
    bar(r, rail, (ax - 0.42, Y0, az + 0.18), (ax - 0.42, Y0 + 0.5, az - 0.07), 0.01)
    pipe_run(r, steel(0x8a96a3), [(0.42, Y0 + 0.62, hz + 0.3), (0.62, Y0 + 0.62, hz + 0.3), (0.62, Y0 + 0.62, az - 0.31)], 0.03)

    # ---- crane tower (front left) + the animated crane
    cx, cz = -1.02, 0.6
    box(r, slab_m(0x7f7a72), (0.3, 0.06, 0.3), (cx, Y0 + 0.03, cz), bevel=0.012)
    ch = 1.11
    yb = Y0 + 0.06
    k_ = 0.075
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        box(r, yel, (0.028, ch, 0.028), (cx + sx * k_, yb + ch / 2, cz + sz * k_), bevel=0.004)
    nlev = 8
    for i in range(nlev):
        ya = yb + i * ch / nlev
        yb2 = ya + ch / nlev
        for (a, b) in (((-k_, -k_), (k_, -k_)), ((k_, -k_), (k_, k_)), ((k_, k_), (-k_, k_)), ((-k_, k_), (-k_, -k_))):
            if i % 2:
                a, b = b, a
            bar(r, yel, (cx + a[0], ya, cz + a[1]), (cx + b[0], yb2, cz + b[1]), 0.012)
    c = m.part('crane', at=(cx, 1.22, cz), rot=(0, 0.6, 0))
    _crane(m, c, yel, frm, glass_lit)
    hazard_band(m, r, (cx, Y0 + 0.03, cz + 0.152), (0.3, 0.05))

    # ---- front yard: a prefab module going up, materials, lamps, floodlight
    sx_, sz_ = -0.3, 0.6
    box(r, frm, (0.56, 0.04, 0.5), (sx_, Y0 + 0.02, sz_), bevel=0.008)
    for (ddx, ddz) in ((-0.25, -0.22), (0.25, -0.22), (-0.25, 0.22), (0.25, 0.22)):
        box(r, stl, (0.03, 0.46, 0.03), (sx_ + ddx, Y0 + 0.27, sz_ + ddz), bevel=0.004)
    for y in (0.26, 0.49):
        bar(r, yel, (sx_ - 0.265, Y0 + y, sz_ + 0.22), (sx_ + 0.265, Y0 + y, sz_ + 0.22), 0.024)
        bar(r, yel, (sx_ - 0.265, Y0 + y, sz_ - 0.22), (sx_ + 0.265, Y0 + y, sz_ - 0.22), 0.024)
        bar(r, yel, (sx_ - 0.25, Y0 + y, sz_ - 0.235), (sx_ - 0.25, Y0 + y, sz_ + 0.235), 0.024)
        bar(r, yel, (sx_ + 0.25, Y0 + y, sz_ - 0.235), (sx_ + 0.25, Y0 + y, sz_ + 0.235), 0.024)
    box(r, wall, (0.48, 0.21, 0.035), (sx_, Y0 + 0.145, sz_ - 0.22), bevel=0.006)
    box(r, wall, (0.035, 0.21, 0.42), (sx_ - 0.25, Y0 + 0.145, sz_), bevel=0.006)
    box(r, wall, (0.24, 0.2, 0.035), (sx_ - 0.12, Y0 + 0.36, sz_ - 0.22), bevel=0.006)
    box(r, tr, (0.24, 0.03, 0.04), (sx_ - 0.12, Y0 + 0.475, sz_ - 0.22), bevel=0.004)
    box(r, painted(0x8a7552, panels=None, wear=0.3, rust=0.0, rough=0.85, metal=0.0), (0.58, 0.014, 0.1), (sx_, Y0 + 0.27, sz_ + 0.28))
    ladder(r, rail, (sx_ + 0.2, Y0, sz_ + 0.24), 0.27)
    light(r, (sx_ + 0.25, Y0 + 0.53, sz_ + 0.22), 0.016, 0xffa020, 'blink')
    for i in range(3):
        box(r, stl, (0.5, 0.025, 0.04), (-0.05 - 0.0, Y0 + 0.0125 + i * 0.026, 1.04 + (i % 2) * 0.05), bevel=0.004)
    for i in range(3):
        box(r, wall2, (0.34, 0.03, 0.22), (0.42, Y0 + 0.015 + i * 0.032, 1.04), (0, i * 0.08, 0), bevel=0.006)
    crates(r, (0.4, Y0, 0.62), 3, 0.11)
    drums(r, (-0.62, Y0, 1.06), 4)
    lamp_post(r, (1.36, Y0, 1.32), 0.44, yaw=math.pi)
    lamp_post(r, (-1.38, Y0, 1.32), 0.44, yaw=math.pi)
    flood_mast(m, r, (0.66, Y0, 1.3), 0.5, n=2, yaw=math.pi, s=0.05)
    flag_pole(m, r, (1.28, Y0, 0.62), 0.92, (0.36, 0.22), yaw=0.35)


def _tooth(m, r, stl, glass_m, tr, frm, hx, rt, z0, z1, w):
    """One sawtooth bay along x: the glazed vertical face at the back (z0, facing north) and the light steel
    slope falling towards the camera (z1) with a lit skylight strip; a team ridge cap."""
    hgt = 0.2
    depth = z1 - z0
    L = math.hypot(depth - 0.02, hgt)
    a = math.atan2(hgt, depth - 0.02)
    zc = z0 + 0.02 + (depth - 0.02) / 2
    yc = rt + hgt / 2 + 0.01
    box(r, stl, (w, 0.024, L), (hx, yc, zc), (a, 0, 0), bevel=0.004)
    # skylight strip along the slope (dark glass + lit panes), slightly proud of the sheet
    import mathutils as _mu
    F = T((hx, yc, zc), (a, 0, 0))
    n_ = F.to_3x3() @ _mu.Vector((0, 1, 0))
    c = F @ _mu.Vector((0, 0.013, -L * 0.08))
    box(r, glass(0x2b4762), (w - 0.14, 0.006, L * 0.36), tuple(c), (a, 0, 0))
    fc = tuple(c + n_ * 0.004)
    sz = (w - 0.14, L * 0.36 * math.cos(a))
    m.decal(windows_img(12, 1, lit=set(), dark=0x2b4762, frame=0x30353b), at=fc, size=sz, facing='+y', depth=0.06, team=0, rough=0.12)
    m.decal(lit_panes_img(12, 1, lit={1, 4, 5, 9}, color=WIN_COOL), at=fc, size=sz, facing='+y', depth=0.06, team=0, emit=0.7)
    # north glazing (vertical, faces -z) and the ridge cap
    box(r, glass_m, (w - 0.02, hgt - 0.02, 0.01), (hx, rt + hgt / 2 + 0.01, z0 + 0.025))
    box(r, tr, (w + 0.02, 0.04, 0.07), (hx, rt + hgt + 0.014, z0 + 0.03), bevel=0.008)
    for s in (-1, 1):
        prism(r, frm, [(0.0, hgt), (0.0, 0.0), (depth - 0.02, 0.0)], 0.03, (hx + s * (w / 2), rt, z0 + 0.02), (0, -math.pi / 2, 0))


def _crane(m, c, yel, frm, glass_m):
    """Tower-crane top in the part frame (jib along +x): slewing ring, cab, A-frame, lattice jib and counter-jib,
    counterweights, pendants, trolley + hook, beacons."""
    cyl(c, frm, 0.1, 0.04, (0, 0.02, 0), seg=12, bevel=0.006)
    box(c, yel, (0.2, 0.09, 0.18), (0, 0.085, 0), bevel=0.014)
    box(c, yel, (0.1, 0.08, 0.1), (0.06, 0.09, 0.12), bevel=0.01)
    box(c, glass_m, (0.085, 0.05, 0.004), (0.06, 0.1, 0.171))
    box(c, glass_m, (0.004, 0.05, 0.08), (0.111, 0.1, 0.12))
    # A-frame
    for s in (-1, 1):
        bar(c, yel, (-0.06, 0.13, s * 0.05), (0, 0.36, 0), 0.016)
        bar(c, yel, (0.06, 0.13, s * 0.05), (0, 0.36, 0), 0.016)
    light(c, (0, 0.37, 0), 0.016, 0xff2a1a, 'blink')
    # jib: triangular truss (two bottom chords, one top chord), diagonal lacing
    jl = 1.3
    y_b, y_t, half = 0.12, 0.2, 0.04
    bar(c, yel, (0.08, y_b, -half), (jl, y_b, -half), 0.018)
    bar(c, yel, (0.08, y_b, half), (jl, y_b, half), 0.018)
    bar(c, yel, (0.08, y_t, 0), (jl - 0.04, y_t - 0.02, 0), 0.018)
    nseg = 9
    for i in range(nseg):
        x0 = 0.08 + i * (jl - 0.08) / nseg
        x1 = x0 + (jl - 0.08) / nseg
        yt0 = y_t - 0.02 * (x0 / jl)
        yt1 = y_t - 0.02 * (x1 / jl)
        bar(c, yel, (x0, y_b, -half), (x1, yt1, 0), 0.009)
        bar(c, yel, (x0, y_b, half), (x1, yt1, 0), 0.009)
        bar(c, yel, (x0, y_b, -half), (x0, y_b, half), 0.008)
    # counter-jib with counterweight blocks
    bar(c, yel, (-0.08, y_b, -0.035), (-0.42, y_b, -0.035), 0.022)
    bar(c, yel, (-0.08, y_b, 0.035), (-0.42, y_b, 0.035), 0.022)
    box(c, painted(0x7d7f7c, panels=None, wear=0.3, rust=0.2), (0.12, 0.012, 0.09), (-0.24, y_b + 0.012, 0))
    for k in range(3):
        box(c, slab_m(0x8a857c), (0.045, 0.1, 0.11), (-0.31 - k * 0.048, y_b - 0.03, 0), bevel=0.006)
    # pendants (top of the A-frame to the jib tips)
    bar(c, frm, (0, 0.36, 0), (jl * 0.75, y_t - 0.015, 0), 0.005)
    bar(c, frm, (0, 0.36, 0), (-0.4, y_b + 0.01, 0), 0.005)
    # trolley, hook block on a cable
    box(c, frm, (0.06, 0.025, 0.1), (0.95, y_b - 0.02, 0), bevel=0.004)
    bar(c, frm, (0.95, y_b - 0.03, 0), (0.95, -0.42, 0), 0.004)
    box(c, yel, (0.04, 0.05, 0.03), (0.95, -0.44, 0), bevel=0.006)
    m.decal(haz_img(4), at=(0.95, -0.44, 0.0155), size=(0.04, 0.012), facing='+z', part=c, depth=0.01, team=0)
    light(c, (jl, y_b + 0.02, 0), 0.013, 0xff2a1a, 'blink')
