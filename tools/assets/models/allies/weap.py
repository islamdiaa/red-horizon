"""Allied war factory (3x3): a white assembly hall under three light barrel-vault roofs (team crown stripes,
lit skylights, lunette windows), two flanking towers with big eagle banners and floodlights, the MOTOR POOL
sign, a roller door (animated part 'door', rolls up into the lintel) in front of a lit vehicle bay, an apron
with chevrons and bollards, office wings, roof plant with a stack (smoke0) and steam vent (steam0).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _allied import *  # noqa: E402,F401,F403
from _allied import _imgs  # noqa: E402

ID = 'weap'
FACTION = 'allies'
KIND = 'structure'


def build(m):
    setup(m)
    m.set_meta(footprint=(3, 3), height=1.4, radius=1.55)
    r = m.root

    wall = white()
    wall2 = offwhite()
    frm = frame()
    tr = trim()
    rf = roof()
    stl = steel()
    vault = steel(0xa9b2bb, panels=(0.14, 0.45), grime=0.65, streaks=0.6, rust=0.15)
    yel = yellow()
    rail = rail_m()

    hz, hd, hw, hh = -0.36, 1.98, 2.56, 0.94
    fz = hz + hd / 2          # 0.63: front wall plane
    bz = hz - hd / 2
    dw, dh, bayD = 1.14, 0.72, 0.5

    # ---- foundation + apron with chevrons, bollards, hazard edge
    box(r, slab_m(0x9d988e), (2.98, Y0, 2.98), (0, Y0 / 2, 0), bevel=0.02)
    box(r, asphalt(), (1.3, 0.012, 0.82), (0, Y0 + 0.006, fz + 0.42), bevel=0.003)
    mark(m, r, chevron_img(3), (0, Y0 + 0.012, fz + 0.42), (0.56, 0.6), asphalt(), rough=0.6)
    hazard_band(m, r, (0, Y0 + 0.012, fz + 0.785), (1.26, 0.05), facing='+y', base=asphalt())
    for s in (-1, 1):
        cyl(r, yel, 0.028, 0.11, (s * 0.66, Y0 + 0.055, fz + 0.66), seg=10, bevel=0.005)
        cyl(r, black(), 0.029, 0.02, (s * 0.66, Y0 + 0.08, fz + 0.66), seg=10, caps=False)

    # ---- hall: rear block, front sections either side of the bay, lintel above the door
    box(r, slab_m(0x8d887f), (hw + 0.04, 0.1, hd + 0.04), (0, Y0 + 0.05, hz), bevel=0.012)
    rearD = hd - bayD
    box(r, wall, (hw, hh - 0.1, rearD), (0, Y0 + 0.1 + (hh - 0.1) / 2, bz + rearD / 2), bevel=0.012)
    sideW = (hw - dw) / 2
    for sx in (-1, 1):
        box(r, wall, (sideW, hh - 0.1, bayD + 0.02), (sx * (dw / 2 + sideW / 2), Y0 + 0.1 + (hh - 0.1) / 2, fz - bayD / 2), bevel=0.012)
    box(r, wall, (dw + 0.02, hh - dh, bayD + 0.02), (0, Y0 + dh + (hh - dh) / 2, fz - bayD / 2), bevel=0.01)
    box(r, tr, (hw + 0.05, 0.065, hd + 0.05), (0, Y0 + hh - 0.035, hz), bevel=0.01)
    top = Y0 + hh
    # side buttresses (dark), pipes on the east wall
    for s in (-1, 1):
        for i in range(4):
            box(r, frm, (0.06, hh - 0.12, 0.1), ((hw / 2 + 0.02) * s, Y0 + (hh - 0.12) / 2 + 0.02, hz - 0.8 + i * 0.5), bevel=0.01)
    pipe_run(r, steel(0x8d99a6, panels=None), [(hw / 2 + 0.06, Y0 + 0.6, hz + 0.6), (hw / 2 + 0.06, Y0 + 0.6, hz - 0.9),
                                              (hw / 2 + 0.06, top + 0.15, hz - 0.9)], 0.026)

    # ---- barrel-vault roofs (3 along x): light steel, team crown stripe, skylight strip, ribs, lunettes
    vr, vh, vlen = 0.42, 0.24, hd - 0.06
    for i in range(3):
        x = -hw / 2 + hw / 6 + i * hw / 3
        arc = [(vr * math.cos(math.pi * k / 12), vh * math.sin(math.pi * k / 12)) for k in range(13)]
        prism(r, vault, arc, vlen, (x, top, hz))
        # crown stripe (team) + skylight strip on the camera-facing flank
        box(r, tr, (0.07, 0.012, vlen + 0.01), (x, top + vh + 0.002, hz), bevel=0.003)
        sk = glass(0x2b4762)
        box(r, sk, (0.13, 0.008, vlen - 0.4), (x + 0.2, top + 0.213, hz + 0.05), (0, 0, -0.3))
        m.decal(windows_img(10, 1, lit=set(), dark=0x2b4762, frame=0x30353b), at=(x + 0.2, top + 0.222, hz + 0.05), size=(vlen - 0.42, 0.11),
                facing='+y', depth=0.05, team=0, rough=0.12, roll=math.pi / 2)
        m.decal(lit_panes_img(10, 1, lit={(i * 3 + 1) % 10, (i * 3 + 5) % 10, (i * 7 + 8) % 10}, color=WIN_COOL), at=(x + 0.2, top + 0.222, hz + 0.05),
                size=(vlen - 0.42, 0.11), facing='+y', depth=0.05, team=0, emit=0.7, roll=math.pi / 2)
        # ribs: three arched bands
        for zz in (hz - vlen / 2 + 0.04, hz, hz + vlen / 2 - 0.04):
            outer = [((vr + 0.014) * math.cos(math.pi * k / 8), (vh + 0.014) * math.sin(math.pi * k / 8)) for k in range(9)]
            inner = [((vr - 0.01) * math.cos(math.pi * k / 8), (vh - 0.01) * math.sin(math.pi * k / 8)) for k in range(9)]
            prism(r, frm, outer + inner[::-1], 0.03, (x, top, zz))
        # lunette on the front end: dark glass fan with lit panes
        m.decal(_lunette_img(), at=(x, top + vh * 0.45, hz + vlen / 2 + 0.002), size=(vr * 1.5, vh * 0.85), facing='+z', depth=0.02, team=0,
                rough=0.15, emit=0.55)
        m.decal(_lunette_img(frame_only=True), at=(x, top + vh * 0.45, hz + vlen / 2 + 0.002), size=(vr * 1.5, vh * 0.85), facing='+z', depth=0.02,
                team=0, rough=0.4)
        if i < 2:  # valley gutter between vaults
            box(r, frm, (0.06, 0.05, vlen), (x + hw / 6, top + 0.02, hz))
    # roof plant: stack (smoke0) on a plinth, AC units, vents (steam0)
    box(r, stl, (0.26, 0.2, 0.26), (1.0, top + 0.08, hz - 0.62), bevel=0.014)
    stack_m = tune(concrete(0xd8d5cc, grime=0.6, streaks=1.0, joints=(0.6, 0.12), soot=(1.45, 1.72)), ao=0.8)
    chimney(m, r, (1.0, top + 0.18, hz - 0.62), 0.6, 0.085, 0.066, mat=stack_m, band_mat=trim(), cap=dark_m(), smoke='smoke0',
            bands=[(0.5, 0.1), (0.78, 0.08)], lights=2, glow_ring=False, light_r=0.012)
    ac_unit(r, (-0.86, top + vh - 0.02, hz - 0.62), 0.11)
    ac_unit(r, (-0.05, top + vh - 0.02, hz - 0.72), 0.1)
    roof_vent(r, (0.4, top + 0.17, hz - 0.3), 0.04)
    m.steam('steam0', (0.4, 1.24, -0.66))

    # ---- flanking towers with eagle banners, floodlights, beacons
    tw, th, td = 0.34, 1.42, 0.32
    for sx in (-1, 1):
        tx = sx * (dw / 2 + tw / 2 + 0.02)
        tz = fz + 0.02
        box(r, slab_m(0x8d887f), (tw + 0.04, 0.1, td + 0.05), (tx, Y0 + 0.05, tz + 0.01), bevel=0.012)
        box(r, wall, (tw, th - 0.1, td), (tx, Y0 + 0.1 + (th - 0.1) / 2, tz), bevel=0.016)
        for cx in (-1, 1):
            box(r, frm, (0.04, th - 0.16, 0.04), (tx + cx * (tw / 2 - 0.005), Y0 + 0.1 + (th - 0.16) / 2, tz + td / 2 - 0.005), bevel=0.006)
        box(r, tr, (tw + 0.04, 0.07, td + 0.04), (tx, Y0 + th - 0.04, tz), bevel=0.01)
        box(r, rf, (tw - 0.02, 0.02, td - 0.02), (tx, Y0 + th + 0.004, tz))
        parapet_rect(r, frm, tx - tw / 2 - 0.02, tz - td / 2 - 0.02, tx + tw / 2 + 0.02, tz + td / 2 + 0.02, Y0 + th - 0.01, h=0.045, t=0.03)
        eagle_banner(m, r, (tx, Y0 + th - 0.1, tz + td / 2 + 0.006), (0.26, 0.72))
        stencil(m, r, 'A' if sx < 0 else 'B', (tx, Y0 + 0.36, tz + td / 2 + 0.002), 0.1, color=0xe8b51a)
        light(r, (tx + sx * 0.13, Y0 + th + 0.045, tz + 0.12), 0.02, 0xff2a1a, 'blink')
        floodlight(r, (tx - sx * 0.08, Y0 + th + 0.05, tz + td / 2 - 0.02), yaw=0.0, pitch=0.75, s=0.055)
        strobe(r, (tx - sx * 0.13, Y0 + th + 0.045, tz - 0.1))

    # ---- door frame, hazard lintel, lit sign
    box(r, frm, (dw + 0.08, 0.1, 0.07), (0, Y0 + dh + 0.05, fz + 0.035), bevel=0.012)
    hazard_band(m, r, (0, Y0 + dh + 0.05, fz + 0.071), (dw + 0.04, 0.05))
    for s in (-1, 1):
        box(r, frm, (0.05, dh, 0.06), (s * (dw / 2 + 0.025), Y0 + dh / 2, fz + 0.03), bevel=0.01)
        rivet_row(m, r, (s * (dw / 2 + 0.025), Y0 + 0.05, fz + 0.061), (s * (dw / 2 + 0.025), Y0 + dh - 0.05, fz + 0.061))
        # door beacons: separately animated glow (the procedural 'glow:door' slot drives them)
        cyl(r, dark_m(), 0.026, 0.02, (s * (dw / 2 + 0.06), Y0 + dh + 0.11, fz + 0.075), seg=10)
        sphere(r, glow_material('glow:door', 0xffa020), 0.022, (s * (dw / 2 + 0.06), Y0 + dh + 0.135, fz + 0.075), seg=10, rings=6)
    lit_sign(m, r, (0, Y0 + dh + 0.165, fz + 0.03), (dw - 0.2, 0.15), 'MOTOR POOL', lights=3)

    # ---- the vehicle bay (visible when the door is up): dark walls, lit back wall, gantry, floor lines
    bayz = fz - bayD
    box(r, flat(0x1a1c1f, 0.9), (dw, dh, 0.02), (0, Y0 + dh / 2, bayz + 0.01))
    box(r, light_mat(WIN_WARM, 0.9, 'steady'), (dw * 0.6, 0.12, 0.004), (0, Y0 + dh - 0.16, bayz + 0.022))
    box(r, asphalt(0x36373a), (dw, 0.012, bayD), (0, Y0 + 0.006, fz - bayD / 2))
    for x in (-0.22, 0.22):
        mark(m, r, solid(HAZ_Y), (x, Y0 + 0.012, fz - bayD / 2), (0.03, bayD - 0.05), asphalt(0x36373a))
    for s in (-1, 1):
        box(r, gun_m(), (0.014, dh, bayD), (s * (dw / 2 - 0.007), Y0 + dh / 2, fz - bayD / 2))
    box(r, yel, (dw - 0.04, 0.045, 0.05), (0, Y0 + dh - 0.07, bayz + 0.13), bevel=0.006)
    box(r, dark_m(), (0.07, 0.09, 0.07), (0.15, Y0 + dh - 0.13, bayz + 0.13), bevel=0.006)
    for x in (-0.35, 0, 0.35):
        box(r, light_mat(0xfff2d8, 2.0, 'steady'), (0.16, 0.008, 0.05), (x, Y0 + dh - 0.008, fz - bayD / 2))
    m.sparks('weld', (0.1, 0.22, 0.33))

    # ---- the roller door: hangs below its pivot at the lintel, rolls up (scale y) into it
    d = m.part('door', at=(0, Y0 + dh - 0.01, fz + 0.01))
    shutter = corrugated(0x8792a0, along='x', pitch=0.03, rust=0.3, streaks=0.85)
    box(d, shutter, (dw, dh - 0.01, 0.022), (0, -(dh - 0.01) / 2, 0), bevel=0.004)
    box(d, yel, (dw, 0.035, 0.032), (0, -(dh - 0.01) + 0.017, 0.002), bevel=0.005)
    m.decal(haz_img(dw / 0.035), at=(0, -(dh - 0.01) + 0.017, 0.0185), size=(dw, 0.03), facing='+z', part=d, depth=0.012, team=0)
    stencil(m, d, 'B2', (0.3, -dh * 0.45, 0.0115), 0.17, color=WHITE_TXT, wear=0.35)
    m.decal(symbol_img('eagle'), at=(-0.28, -dh * 0.45, 0.0115), size=(0.24, 0.24), facing='+z', part=d, depth=0.012, team=0, rough=0.6)

    # ---- office wings: lit windows, a doorway, a small roller door
    for sx in (-1, 1):
        wx = sx * 1.06
        window_row(r, (wx, Y0 + 0.62, fz), 2, (0.1, 0.09), 0.06, lit=WIN_WARM, dark=(0,) if sx < 0 else ())
        window_row(r, (wx, Y0 + 0.4, fz), 2, (0.1, 0.09), 0.06, lit=WIN_WARM, dark=(1,) if sx > 0 else ())
    lit_doorway(m, r, (1.06, Y0, fz), (0.15, 0.24))
    door(m, r, (-1.06, Y0, fz), (0.3, 0.25), kind='roller', hazard_frame=True)
    hazard_band(m, r, (1.06, Y0 + 0.07, fz + 0.022), (0.42, 0.04))
    rivet_row(m, r, (-hw / 2 + 0.05, top - 0.1, fz + 0.001), (-dw / 2 - tw - 0.05, top - 0.1, fz + 0.001))
    rivet_row(m, r, (dw / 2 + tw + 0.05, top - 0.1, fz + 0.001), (hw / 2 - 0.05, top - 0.1, fz + 0.001))
    for x in (-hw / 2 + 0.05, hw / 2 - 0.05):
        strobe(r, (x, top + 0.03, fz))

    # ---- yard clutter, lamps
    crates(r, (-1.32, Y0, fz + 0.3), 3, 0.1)
    drums(r, (1.24, Y0, fz + 0.3), 3)
    lamp_post(r, (1.36, Y0, 1.34), 0.44, yaw=math.pi)
    lamp_post(r, (-1.36, Y0, 1.34), 0.44, yaw=math.pi)


def _lunette_img(frame_only=False):
    """Half-moon fan window (dark glass, a few lit panes); frame_only: just the mullions + rim."""
    from kit import decals as _D
    key = ('lunette', frame_only)
    if key in _imgs:
        return _imgs[key]
    W, H = 256, 128
    cv = _D.Canvas(W, H, ss=2)
    cx, cy = W / 2, 0.0
    rad = W / 2 - 2
    if not frame_only:
        # panes: fan sectors (alternate lit / dark)
        n = 7
        for k in range(n):
            a0, a1 = math.pi * k / n, math.pi * (k + 1) / n
            pts = [(cx, cy)]
            for j in range(5):
                a = a0 + (a1 - a0) * j / 4
                pts.append((cx + math.cos(a) * rad * 0.94, cy + math.sin(a) * rad * 0.94 * H * 2 / W))
            col = WIN_COOL if k in (1, 4, 5) else 0x2b4762
            cv.poly(pts, _D.lin(col))
    else:
        for k in range(8):
            a = math.pi * k / 7
            x1, y1 = cx + math.cos(a) * rad, cy + math.sin(a) * rad * H * 2 / W
            dx, dy = -math.sin(a) * 3, math.cos(a) * 3
            cv.poly([(cx - dx, cy - dy), (x1 - dx, y1 - dy), (x1 + dx, y1 + dy), (cx + dx, cy + dy)], _D.lin(0x2a2e34))
        pts_o, pts_i = [], []
        for j in range(25):
            a = math.pi * j / 24
            pts_o.append((cx + math.cos(a) * rad, cy + math.sin(a) * rad * H * 2 / W))
            pts_i.append((cx + math.cos(a) * rad * 0.92, cy + math.sin(a) * rad * 0.92 * H * 2 / W))
        for j in range(24):
            cv.poly([pts_i[j], pts_o[j], pts_o[j + 1], pts_i[j + 1]], _D.lin(0x2a2e34))
    _imgs[key] = cv.image()
    return _imgs[key]
