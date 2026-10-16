"""Soviet heavy tank (3tnk): welded hull with team-colour glacis and side skirts, five road wheels a side on
scrolling tracks, cast turret (part 'turret') with twin guns (parts 'b0' / 'b1', recoil along -X), muzzles
m0 / m1 and the exhaust smoke point. Pivots match the procedural rig (node --import tsx tools/assets/rig.ts 3tnk).
Hero model of the HD pipeline: see tools/assets/README.md.
"""
import math

from kit import *

ID = '3tnk'
FACTION = 'soviet'
KIND = 'vehicle'


def build(m):
    m.set_meta(height=0.37, radius=0.46, snow=0.3)
    r = m.root
    olive = painted(0x77824f, panels=(0.14, 0.1), wear=0.7, rust=0.12, grime=0.4, streaks=0.35, rough=0.6, metal=0.2, var=0.14)
    olive_d = painted(0x4b5235, panels=None, wear=0.65, rust=0.15, grime=0.45, streaks=0.3, rough=0.64)
    olive_l = painted(0x808a63, panels=None, wear=0.6, rust=0.1, rough=0.6)
    trim = team(wear=0.4, rust=0.05, grime=0.25, panels=(0.12, 0.08))
    gun = metal(0x3a3e44, rough=0.42, rust=0.25, wear=0.5)
    dark = metal(0x25272b, rough=0.55, rust=0.3)
    tyre = rubber(0x1f1f21)
    wheel = painted(0x4a5236, wear=0.75, rust=0.4, panels=None)

    # ---- running gear: tracks (scrolling tread), road wheels, sprocket, idler, return rollers
    L, H, W, Z = 0.9, 0.16, 0.14, 0.235
    for s in (-1, 1):
        z = Z * s
        track_belt(r, L, H, W, (0, 0.0, z), link=0.05)
        face = z + s * W * 0.32
        for i in range(5):
            x = -0.3 + i * 0.15
            cyl(r, tyre, 0.066, 0.03, (x, 0.074, face), (math.pi / 2, 0, 0), seg=14, bevel=0.004)
            cyl(r, wheel, 0.052, 0.034, (x, 0.074, face + s * 0.002), (math.pi / 2, 0, 0), seg=12)
            cyl(r, dark, 0.018, 0.04, (x, 0.074, face + s * 0.004), (math.pi / 2, 0, 0), seg=8)
        for (x, rad) in ((L / 2 - H / 2, 0.068), (-(L / 2 - H / 2), 0.06)):
            cyl(r, gun, rad, 0.05, (x, H / 2, face), (math.pi / 2, 0, 0), seg=14, bevel=0.004)
            cyl(r, dark, rad * 0.4, 0.056, (x, H / 2, face), (math.pi / 2, 0, 0), seg=8)
        for x in (-0.15, 0.15):
            cyl(r, dark, 0.02, 0.03, (x, H - 0.012, face - s * 0.02), (math.pi / 2, 0, 0), seg=8)

    # ---- hull: belly, welded upper hull (side profile extruded across), glacis, deck
    box(r, olive_d, (0.82, 0.08, 0.34), (0, 0.1, 0), bevel=0.01)
    hull = [(-0.46, 0.12), (0.36, 0.12), (0.49, 0.168), (0.34, 0.242), (-0.43, 0.248), (-0.475, 0.205)]
    prism(r, olive, hull, 0.42, (0, 0, 0), bevel=0.008)
    # team glacis plate (sloped) with a weld seam and bolts
    gx, gy = (0.49 + 0.34) / 2, (0.168 + 0.242) / 2
    slope = math.atan2(0.242 - 0.168, 0.34 - 0.49)
    box(r, trim, (0.17, 0.012, 0.32), (gx - 0.004, gy + 0.004, 0), (0, 0, slope + math.pi), bevel=0.003)
    rivet_row(m, r, (0.452, 0.19, -0.13), (0.452, 0.19, 0.13), facing='+y', spacing=0.03, size=0.012)
    # fenders over the tracks with team side skirts
    for s in (-1, 1):
        z = Z * s
        box(r, olive_d, (0.92, 0.012, 0.165), (0.0, 0.166, z), bevel=0.003)
        box(r, olive_d, (0.08, 0.012, 0.165), (0.49, 0.15, z), (0, 0, -0.45), bevel=0.003)
        box(r, olive_d, (0.06, 0.012, 0.165), (-0.475, 0.152, z), (0, 0, 0.5), bevel=0.003)
        box(r, trim, (0.76, 0.08, 0.012), (-0.02, 0.126, z + s * 0.084), bevel=0.003)
        for x in (-0.3, 0.0, 0.3):
            bar(r, dark, (x, 0.165, z + s * 0.084), (x, 0.1, z + s * 0.084), 0.008)
    stencil(m, r, '305', (-0.2, 0.135, Z + 0.091), 0.04, facing='+z', color=0xe8e4da)
    stencil(m, r, '305', (-0.2, 0.135, -Z - 0.091), 0.04, facing='-z', color=0xe8e4da)
    # stowage: team bins up front, fuel drums on the right fender, tool box and exhaust on the left
    for s in (-1, 1):
        box(r, trim, (0.11, 0.05, 0.1), (0.26, 0.197, 0.24 * s), bevel=0.006)
    for i in range(3):
        cyl(r, olive_d, 0.034, 0.1, (0.1 - i * 0.12, 0.206, 0.245), (0, 0, math.pi / 2), seg=12, bevel=0.003)
    box(r, olive_d, (0.16, 0.05, 0.1), (0.03, 0.197, -0.24), bevel=0.006)
    box(r, olive_l, (0.1, 0.04, 0.09), (-0.14, 0.192, -0.24), bevel=0.005)
    exh = painted(0x3a3632, wear=0.4, rust=0.7, panels=None, soot=(0.16, 0.24))
    cyl(r, exh, 0.024, 0.16, (-0.36, 0.205, -0.27), (0, 0, math.pi / 2), seg=10)
    cyl(r, exh, 0.03, 0.03, (-0.44, 0.205, -0.27), (0, 0, math.pi / 2), seg=10)
    m.point('exhaust', (-0.392, 0.2, -0.271), kind='smoke')
    # engine deck: louvres, the unditching log, rear plate, lights, tow hooks
    vent(m, r, (-0.3, 0.247, 0.0), (0.15, 0.26), facing='+y', slats=7, thick=0.008)
    cyl(r, painted(0x5a4630, wear=0.2, panels=None, metal=0.0, rough=0.85), 0.024, 0.42, (-0.405, 0.27, 0), (math.pi / 2, 0, 0), seg=10)
    for z in (-0.17, 0.17):
        bar(r, dark, (-0.43, 0.25, z), (-0.39, 0.29, z), 0.006)
    for z in (-0.085, 0.085):
        cyl(r, olive_d, 0.033, 0.15, (-0.485, 0.205, z), (0, 0, math.pi / 2), seg=10)
    for s in (-1, 1):
        light(r, (0.44, 0.205, 0.15 * s), 0.014, 0xfff0c8, 'steady', facing='+x')
        light(r, (-0.465, 0.21, 0.15 * s), 0.01, 0xff2010, 'steady', facing='-x')
        for x in (0.47, -0.47):
            box(r, dark, (0.03, 0.02, 0.03), (x, 0.13, 0.12 * s), bevel=0.004)
    hazard_stripes(m, r, (-0.47, 0.17, 0), (0.24, 0.03), facing='-x')

    # ---- turret: cast dome, team cheek plates and ring band, mantlet, cupola, hatches, MG, searchlight
    t = m.part('turret', at=(-0.05, 0.236, 0))
    dome = [(0.22, 0.0), (0.218, 0.02), (0.207, 0.055), (0.17, 0.095), (0.1, 0.118), (0.0, 0.124)]
    lathe(t, olive, dome, (0, 0, 0), seg=20, scale=(1.1, 1.0, 1.0))
    lathe(t, trim, [(0.226, -0.002), (0.229, 0.006), (0.226, 0.02), (0.205, 0.022)], (0, 0, 0), seg=20, scale=(1.1, 1.0, 1.0), cap_bottom=False, cap_top=False)
    for s in (-1, 1):
        for (a, w) in ((0.85, 0.13), (1.5, 0.13)):
            ang = a * s
            box(t, trim, (w, 0.07, 0.014), (math.cos(ang) * 0.228, 0.046, math.sin(ang) * 0.21), (0, math.pi / 2 - ang, 0), bevel=0.003)
    box(t, olive_d, (0.1, 0.075, 0.21), (0.205, 0.05, 0), bevel=0.02)
    for z in (-0.05, 0.05):
        cyl(t, dark, 0.024, 0.04, (0.255, 0.05, z), (0, 0, math.pi / 2), seg=10)
    cyl(t, olive_d, 0.042, 0.04, (-0.06, 0.13, -0.07), seg=12, bevel=0.004)
    dome_h = [(0.04, 0.0), (0.035, 0.012), (0.0, 0.016)]
    lathe(t, olive_l, dome_h, (-0.06, 0.15, -0.07), seg=12)
    cyl(t, olive_d, 0.034, 0.012, (-0.05, 0.124, 0.075), seg=12, bevel=0.003)
    bar(t, dark, (-0.02, 0.13, 0.075), (-0.02, 0.17, 0.075), 0.008)
    cyl_between(t, gun, (-0.04, 0.172, 0.075), (0.11, 0.172, 0.075), 0.006, 6)
    box(t, dark, (0.04, 0.02, 0.012), (-0.03, 0.172, 0.075))
    cyl(t, dark, 0.024, 0.03, (0.16, 0.13, 0.115), (0, 0, math.pi / 2), seg=10)
    cyl(t, light_mat(0xfff0c8, 1.2, 'steady'), 0.019, 0.004, (0.176, 0.13, 0.115), (0, 0, math.pi / 2), seg=10)
    for z in (-0.03, 0.04):
        box(t, dark, (0.02, 0.02, 0.025), (0.07, 0.125, z))
    box(t, olive_d, (0.07, 0.055, 0.2), (-0.245, 0.04, 0), bevel=0.008)
    cyl(t, gun, 0.016, 0.2, (-0.2, 0.1, 0.0), (math.pi / 2, 0, 0), seg=8)
    antenna(t, (-0.17, 0.11, -0.13), 0.26, light_color=None)
    quad(t, cloth(team=True), (0.05, 0.03), (-0.17 + 0.026, 0.34, -0.13), facing='+z')
    for s in (-1, 1):
        for k in range(3):
            cyl(t, dark, 0.008, 0.035, (0.04 - k * 0.03, 0.105, 0.19 * s), (0.6 * s, 0, 0), seg=6)
    emblem(m, t, 'soviet', (0.02, 0.124, 0.0), 0.11, facing='+y', depth=0.03)
    emblem(m, t, 'soviet', (-0.08, 0.07, 0.235), 0.07, facing=0.35)
    emblem(m, t, 'soviet', (-0.08, 0.07, -0.235), 0.07, facing=math.pi - 0.35)
    stencil(m, t, '305', (-0.22, 0.065, 0.0), 0.035, facing='-x')

    # ---- twin guns (recoil parts) with bore evacuators and muzzle brakes; muzzles
    for i, z in enumerate((-0.05, 0.05)):
        b = m.part(f'b{i}', parent='turret', at=(0.24, 0.05, z))
        barrel(b, gun, 0.42, 0.0145, (0, 0, 0), seg=10, taper=0.85)
        cyl(b, gun, 0.02, 0.06, (0.27, 0, 0), (0, 0, -math.pi / 2), seg=10)
        m.muzzle(f'm{i}', (0.66, 0.05, z))
