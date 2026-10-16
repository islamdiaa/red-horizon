"""[VEH] Ore truck (harv) shared by the Soviet and Allied scripts (harv_soviet.py / harv_allies.py).

Tracked chassis, glazed cab front-left with roof work lights and the amber beacon ('glow:beacon', blinks
while harvesting / moving), exhaust stack (smoke 'exhaust'), front intake housing with the collector drum
(part 'drum', spins around Z while harvesting), ribbed ore bin with faction panels and hazard bands, and the
ore load (part 'ore', scaled by the load; collapses to nothing when the truck unloads).
Pivots: node --import tsx tools/assets/rig.ts harv soviet.
"""
import random

from _vk import *  # noqa: F401,F403


def build_harv(m, fac):
    m.set_meta(height=0.42, radius=0.5, snow=0.3)
    r = m.root
    P = Pal(fac)
    sov = fac == 'soviet'
    hull = P.hull_flat
    panel = P.trim_flat if sov else P.dark2      # faction panel on the bin
    frame = P.dark

    # ---- running gear + fenders + chassis
    L, H, W, Z = 0.92, 0.15, 0.13, 0.215
    running_gear(m, r, P, L, H, W, Z, 6, x0=-0.04, wheel_k=0.37, rollers=2)
    for s in (-1, 1):
        fender(r, hull, 0.94, 0.15, 0.157, Z * s, x=-0.04, front=0.06, rear=0.04)
    box(r, P.gun, (0.86, 0.08, 0.36), (-0.04, 0.15, 0), bevel=0.012)
    for s in (-1, 1):
        box(r, P.black, (0.8, 0.022, 0.014), (-0.04, 0.128, 0.184 * s))

    # ---- cab (front left): profile across Z, glazing on three sides, roof with work lights and the beacon
    cx, cy, cz = 0.27, 0.19, -0.13
    cab = [(cx - 0.1, cy), (cx + 0.122, cy), (cx + 0.133, cy + 0.08), (cx + 0.1, cy + 0.158), (cx - 0.1, cy + 0.158)]
    side_prism(r, hull, cab, 0.185, z=cz, bevel=0.013)
    box(r, P.glass, (0.05, 0.066, 0.155), (cx + 0.118, cy + 0.113, cz), (0, 0, 0.6))
    for s in (-1, 1):
        box(r, P.glass, (0.145, 0.054, 0.006), (cx - 0.002, cy + 0.106, cz + s * 0.093))
        for x in (cx + 0.04, cx - 0.06):
            box(r, P.black, (0.008, 0.058, 0.008), (x, cy + 0.106, cz + s * 0.094))
    box(r, P.dark2, (0.215, 0.016, 0.2), (cx, cy + 0.166, cz), bevel=0.005)
    bar(r, P.black, (cx + 0.09, cy + 0.178, cz - 0.085), (cx + 0.09, cy + 0.178, cz + 0.085), 0.01)
    for z in (-0.05, 0.05):
        lamp(r, (cx + 0.095, cy + 0.19, cz + z), 0.011, HEAD, 'steady', 3.0, '+x')
    # amber beacon: housing + separately animated glow dome
    cyl(r, P.black, 0.016, 0.012, (cx - 0.03, cy + 0.18, cz), seg=8)
    dome(r, glow_material('glow:beacon', AMBER), 0.016, (cx - 0.03, cy + 0.186, cz), seg=8, rings=3, h=0.022)
    # mirror, cab door handle steps
    box(r, P.black, (0.004, 0.03, 0.02), (cx + 0.12, cy + 0.12, cz - 0.108))
    bar(r, P.black, (cx + 0.1, cy + 0.12, cz - 0.098), (cx + 0.12, cy + 0.12, cz - 0.108), 0.004)
    for y in (cy - 0.03, cy + 0.005):
        box(r, P.steel, (0.04, 0.005, 0.014), (cx, y, cz - 0.1))
    headlight(r, (0.403, 0.235, -0.06), 0.016)
    headlight(r, (0.403, 0.235, -0.2), 0.016)
    if sov:
        emblem(m, r, 'soviet', (cx - 0.02, cy + 0.08, cz - 0.0935), 0.05, facing='-z')
    else:
        emblem(m, r, 'allied_star', (cx - 0.02, cy + 0.06, cz - 0.0935), 0.045, facing='-z')

    # ---- exhaust stack with a rain cap behind the cab
    cyl(r, P.exhaust, 0.018, 0.2, (0.16, 0.29, 0.07), r2=0.016, seg=8)
    cyl(r, P.black, 0.022, 0.024, (0.16, 0.39, 0.07), seg=8)
    box(r, P.black, (0.036, 0.005, 0.036), (0.166, 0.404, 0.07), (0, 0, 0.4))
    m.point('exhaust', (0.16, 0.4, 0.07), kind='smoke')
    crate(r, P.dark2, (0.08, 0.045, 0.07), (0.12, 0.212, 0.13), strap=P.black)
    # front deck: tool locker, hose reel, jerry cans, hydraulic rams to the intake
    crate(r, panel, (0.13, 0.06, 0.11), (0.29, 0.22, 0.12), strap=P.black, bevel=0.01)
    cyl(r, P.black, 0.032, 0.05, (0.28, 0.222, -0.0), ROT_Z, seg=12)
    cyl(r, P.yellow, 0.034, 0.008, (0.28, 0.222, -0.028), ROT_Z, seg=12)
    jerry_rack(r, P, 2, 0.19, 0.19, 0.16, yaw=0.0, mat=P.jerry_red if sov else P.jerry)
    for s in (-1, 1):
        cyl_between(r, P.steel, (0.33, 0.2, 0.2 * s), (0.42, 0.17, 0.2 * s), 0.009, 6)
        cyl_between(r, P.dark, (0.3, 0.205, 0.2 * s), (0.36, 0.188, 0.2 * s), 0.014, 8)

    # ---- front intake housing (hazard band) and side cheeks around the drum
    intake = [(0.4, 0.06), (0.5, 0.08), (0.522, 0.17), (0.44, 0.222), (0.38, 0.2)]
    side_prism(r, P.dark2, intake, 0.5, bevel=0.012)
    hazard_stripes(m, r, (0.483, 0.198, 0.0), (0.46, 0.035), facing='+x')
    for s in (-1, 1):
        box(r, P.gun, (0.15, 0.125, 0.018), (0.47, 0.09, 0.255 * s), bevel=0.006)
        marker(r, (0.525, 0.16, 0.236 * s), 0.009, AMBER, '+x', mode='blink', strength=2.6)
    # collector drum (spins): core, staggered teeth, end rings
    d = m.part('drum', at=(0.53, 0.075, 0))
    cyl(d, P.gun, 0.06, 0.46, (0, 0, 0), ROT_Z, seg=10)
    for z in (-0.235, 0.235):
        cyl(d, P.black, 0.07, 0.014, (0, 0, z), ROT_Z, seg=10)
    for i in range(6):
        a = i / 6 * 2 * PI
        for k in range(3):
            z = -0.15 + k * 0.15 + (i % 2) * 0.05
            box(d, P.steel, (0.026, 0.032, 0.05), (math.cos(a) * 0.066, math.sin(a) * 0.066, z), (0, 0, a))

    # ---- ore bin: floor, ribbed walls (hull paint) with faction panels, rim, ladder, hazard band
    bx, bw, bd, by, bh = -0.17, 0.55, 0.46, 0.19, 0.17
    box(r, painted(0x6c6f72, panels=(0.1, 0.1), wear=0.5, rust=0.35, grime=0.5, rough=0.6, metal=0.5), (bw, 0.02, bd), (bx, by + 0.01, 0), bevel=0.004)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        box(r, hull, (bw, bh, 0.03), (bx, by + bh / 2, (bd / 2 - 0.015) * s), bevel=0.012)
        box(r, panel, (bw * 0.62, bh * 0.52, 0.008), (bx - 0.03, by + bh * 0.48, (bd / 2 + 0.003) * s), bevel=0.003)
        for i in range(4):
            x = bx - bw / 2 + 0.06 + i * 0.145
            box(r, P.dark2, (0.024, bh + 0.014, 0.016), (x, by + bh / 2, (bd / 2 + 0.004) * s), bevel=0.003)
        box(r, P.gun, (bw + 0.012, 0.016, 0.044), (bx, by + bh + 0.006, (bd / 2 - 0.015) * s), bevel=0.004)
        rivet_row(m, r, (bx - bw / 2 + 0.03, by + bh - 0.02, (bd / 2 + 0.002) * s), (bx + bw / 2 - 0.03, by + bh - 0.02, (bd / 2 + 0.002) * s), facing=f, spacing=0.04, size=0.012)
        if sov:
            emblem(m, r, 'soviet', (bx + 0.13, by + bh * 0.48, (bd / 2 + 0.008) * s), 0.075, facing=f)
        else:
            emblem(m, r, 'allied_star', (bx + 0.13, by + bh * 0.48, (bd / 2 + 0.008) * s), 0.07, facing=f)
        number(m, r, 'ORE', (bx - 0.07, by + bh * 0.48, (bd / 2 + 0.008) * s), 0.045, f)
    box(r, hull, (0.03, bh, bd), (bx - bw / 2 + 0.015, by + bh / 2, 0), bevel=0.012)
    box(r, hull, (0.03, bh * 0.8, bd), (bx + bw / 2 - 0.015, by + bh * 0.4, 0), bevel=0.012)
    hazard_stripes(m, r, (bx - bw / 2 - 0.001, by + bh - 0.03, 0.0), (bd - 0.04, 0.035), facing='-x')
    for z in (-0.12, -0.08):
        bar(r, P.steel, (bx - bw / 2 - 0.008, by - 0.03, z), (bx - bw / 2 - 0.008, by + bh, z), 0.006)
    for k in range(5):
        bar(r, P.steel, (bx - bw / 2 - 0.008, by - 0.02 + k * 0.04, -0.12), (bx - bw / 2 - 0.008, by - 0.02 + k * 0.04, -0.08), 0.005)
    tail_lights(r, -0.483, 0.215, 0.15)
    deck_strips(m, r, bx - bw / 2, bx + bw / 2, by + bh + 0.014, 0.232)
    deck_strips(m, r, cx - 0.107, cx + 0.107, cy + 0.174, 0.1, zc=cz, width=0.012)
    fender_strips(m, r, 0.94, 0.29, 0.163, x=-0.04)

    # ---- the load: a mound of ore with gold nuggets and a few bright crystals (scaled by the game)
    o = m.part('ore', at=(bx, by + 0.02, 0))
    dirt = painted(0x7a5a2c, panels=None, wear=0.1, rust=0.0, grime=0.5, rough=0.8, metal=0.1, var=0.3)
    gold = painted(0xc89a30, panels=None, wear=0.0, rust=0.0, grime=0.2, rough=0.35, metal=0.7, var=0.2)
    bright = painted(0xffd860, panels=None, wear=0.0, rust=0.0, grime=0.0, rough=0.25, metal=0.85, var=0.1)
    lathe(o, dirt, [(0.25, 0.0), (0.2, 0.06), (0.1, 0.11), (0.0, 0.14)], (0, 0, 0), seg=10, scale=(1.0, 1.0, 0.82))
    rng = random.Random(7)
    for i in range(16):
        a = rng.uniform(0, 2 * PI)
        dd = math.sqrt(rng.uniform(0, 1)) * 0.2
        yy = 0.14 * (1 - (dd / 0.25) ** 1.6) * 0.9
        sz = rng.uniform(0.022, 0.04)
        sphere(o, bright if i % 4 == 0 else gold, sz, (math.cos(a) * dd, yy, math.sin(a) * dd * 0.82), seg=4, rings=2,
               rot=(rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3)))
