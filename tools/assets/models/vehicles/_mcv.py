"""Mobile construction vehicle (mcv) shared by the Soviet and Allied scripts (mcv_soviet.py / mcv_allies.py).

Long tracked carrier with faction skirts, a glazed cab with roof work lights and two amber beacons
('glow:beacon', blinking), an off-white construction module with team bands, hazard stripes and hatches, a
folded yellow crane boom, stacked structure frames, a generator and the comms dish (part 'dish', spins).
Pivots: node --import tsx tools/assets/rig.ts mcv soviet.
"""
from _vk import *  # noqa: F401,F403


def build_mcv(m, fac):
    m.set_meta(height=0.5, radius=0.55, snow=0.3)
    r = m.root
    P = Pal(fac)
    sov = fac == 'soviet'
    hull = P.hull_flat
    white = painted(0xd2cfc4, panels=(0.16, 0.12), wear=0.6, rust=0.08, grime=0.45, streaks=0.5, rough=0.55, metal=0.15, var=0.08)
    crane = P.yellow

    # ---- running gear, fenders, skirts, chassis
    L, H, W, Z = 1.02, 0.15, 0.13, 0.235
    running_gear(m, r, P, L, H, W, Z, 5, wheel_k=0.39, rollers=2)
    for s in (-1, 1):
        fender(r, hull, 1.04, 0.15, 0.157, Z * s, front=0.06, rear=0.05)
        box(r, P.dark, (0.92, 0.016, 0.016), (-0.04, 0.152, 0.306 * s), bevel=0.003)
        skirt(r, P.trim_flat if sov else P.dark2, 0.9, 0.058, 0.148, 0.308 * s, x=-0.04, panels=4, t=0.014)
    box(r, P.gun, (0.98, 0.08, 0.4), (0, 0.15, 0), bevel=0.012)

    # ---- cab: profile across Z, raked windscreen, side glass, roof light bar, beacons
    cab = [(0.32, 0.18), (0.532, 0.18), (0.562, 0.242), (0.502, 0.332), (0.34, 0.342)]
    side_prism(r, hull, cab, 0.46, bevel=0.016)
    box(r, P.glass, (0.07, 0.066, 0.4), (0.533, 0.29, 0), (0, 0, 0.98))
    for z in (-0.07, 0.07):
        box(r, P.black, (0.075, 0.006, 0.008), (0.536, 0.29, z), (0, 0, 0.98))
    for s in (-1, 1):
        box(r, P.glass, (0.12, 0.052, 0.006), (0.42, 0.29, 0.231 * s))
    bar(r, P.black, (0.51, 0.35, -0.21), (0.51, 0.35, 0.21), 0.012)
    for z in (-0.16, -0.06, 0.06, 0.16):
        lamp(r, (0.515, 0.362, z), 0.011, HEAD, 'steady', 3.0, '+x')
    for s in (-1, 1):
        cyl(r, P.black, 0.017, 0.012, (0.42, 0.348, 0.15 * s), seg=8)
        dome(r, glow_material('glow:beacon', AMBER), 0.017, (0.42, 0.354, 0.15 * s), seg=8, rings=3, h=0.022)
        headlight(r, (0.556, 0.222, 0.17 * s), 0.017, guard=P.black)
    grille(m, r, (0.561, 0.215, 0.0), (0.2, 0.04), facing='+x', n=3)
    tow_hooks(r, P, 0.565, 0.17, 0.12, 1)
    if sov:
        for s in (-1, 1):
            emblem(m, r, 'soviet', (0.43, 0.23, 0.232 * s), 0.055, facing='+z' if s > 0 else '-z')
    else:
        for s in (-1, 1):
            emblem(m, r, 'allied_star', (0.43, 0.23, 0.232 * s), 0.05, facing='+z' if s > 0 else '-z')

    # ---- construction module: off-white walls, hull-paint roof, team bands, hazard stripes, hatches, vents
    mod = [(-0.532, 0.18), (0.3, 0.18), (0.3, 0.382), (0.262, 0.412), (-0.502, 0.412), (-0.532, 0.382)]
    side_prism(r, white, mod, 0.5, bevel=0.018)
    box(r, hull, (0.8, 0.03, 0.46), (-0.115, 0.418, 0), bevel=0.01)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        box(r, P.trim_flat, (0.84, 0.052, 0.012), (-0.115, 0.36, 0.252 * s), bevel=0.004)
        for i in range(3):
            box(r, P.gun, (0.018, 0.14, 0.012), (-0.4 + i * 0.28, 0.27, 0.253 * s))
        hazard_stripes(m, r, (-0.115, 0.205, 0.252 * s), (0.8, 0.035), facing=f)
        box(r, P.gun, (0.12, 0.09, 0.008), (-0.26, 0.28, 0.252 * s), bevel=0.003)
        vent(m, r, (0.0, 0.27, 0.251 * s), (0.09, 0.06), facing=f, slats=4, thick=0.006)
        number(m, r, 'MCV' if not sov else '07', (0.17, 0.3, 0.2515 * s), 0.04, f, color=0x30302c)
        stencil(m, r, 'СТРОЙКА' if sov else 'ENGINEERS', (0.08, 0.36, 0.2585 * s), 0.034, facing=f)
    # team outline round the roof (reads from the camera), bright worn edges, up-facing lamps
    if sov:
        paint(m, r, (-0.115, 0.433, 0.0), (0.8, 0.46), '+y', OLIVE_DECK, depth=0.012)
        paint(m, r, (0.42, 0.337, 0.0), (0.18, 0.46), '+y', OLIVE_DECK, depth=0.014)
        for s in (-1, 1):
            paint(m, r, (0.0, 0.164, Z * s), (1.04, 0.15), '+y', OLIVE_DECK, depth=0.008)
        fender_caps(m, r, 0.52, 0.2, 0.164, Z, 0.15)
        deck_number(m, r, 'К-07', (0.41, 0.338, 0.0), 0.065, depth=0.014)
    team_ring(m, r, [(0.285, -0.23), (0.285, 0.23), (-0.515, 0.23), (-0.515, -0.23)], 0.433, width=0.05, inset=0.04)
    deck_strips(m, r, -0.515, 0.285, 0.433, 0.23, width=0.016)
    deck_strips(m, r, 0.34, 0.5, 0.339, 0.23, rear=False, width=0.016)
    fender_strips(m, r, 1.04, 0.31, 0.164, width=0.014)
    for s in (-1, 1):
        lamp(r, (-0.49, 0.434, 0.205 * s), 0.012, RED, 'steady', 3.2, '+y')
    # ---- roof: folded crane boom, structure frames, generator, emblem
    box(r, crane, (0.66, 0.048, 0.064), (-0.12, 0.457, -0.13), bevel=0.01)
    for i in range(3):
        box(r, P.black, (0.014, 0.05, 0.066), (-0.36 + i * 0.2, 0.457, -0.13))
    box(r, crane, (0.095, 0.095, 0.115), (0.21, 0.475, -0.13), bevel=0.016)
    cyl(r, P.dark, 0.034, 0.135, (0.21, 0.475, -0.13), ROT_Z, seg=10)
    box(r, P.steel, (0.025, 0.035, 0.025), (-0.46, 0.43, -0.13), bevel=0.004)
    hazard_stripes(m, r, (0.258, 0.475, -0.13), (0.11, 0.05), facing='+x')
    for x in (-0.42, -0.28, -0.14):
        box(r, P.gun, (0.022, 0.052, 0.2), (x, 0.459, 0.1), bevel=0.005)
    for z in (0.02, 0.18):
        box(r, P.gun, (0.32, 0.018, 0.022), (-0.28, 0.49, z), bevel=0.004)
    box(r, P.dark2, (0.16, 0.07, 0.16), (0.03, 0.468, 0.12), bevel=0.014)
    grille(m, r, (0.03, 0.504, 0.12), (0.12, 0.12), facing='+y', n=5)
    top_star(m, r, fac, (0.15, 0.434, -0.0), 0.12)
    for s in (-1, 1):
        emblem(m, r, 'soviet' if sov else 'allied_star', (-0.43, 0.29, 0.2515 * s), 0.09, facing='+z' if s > 0 else '-z')
    whip(r, P, (-0.5, 0.433, 0.2), 0.26, pennant=True)
    # comms dish (spins)
    d = m.part('dish', at=(0.2, 0.43, 0.15))
    cyl(d, P.dark, 0.012, 0.06, (0, 0.03, 0), seg=6)
    lathe(d, P.accent if not sov else painted(0xd8d4c8, panels=None, wear=0.4, rust=0.05, rough=0.5),
          [(0.0, 0.0), (0.04, 0.012), (0.07, 0.036), (0.068, 0.04), (0.038, 0.017), (0.0, 0.006)], (0, 0.062, 0), seg=12, rot=(0, 0, 0.9))
    cyl_between(d, P.black, (0.0, 0.065, 0), (0.045, 0.1, 0), 0.004, 4)
    # ---- rear: hazard plate, tail lights, door, jerry cans
    hazard_stripes(m, r, (-0.533, 0.24, 0.0), (0.44, 0.04), facing='-x')
    box(r, P.dark, (0.02, 0.12, 0.2), (-0.535, 0.31, 0), bevel=0.004)
    tail_lights(r, -0.542, 0.33, 0.2)
    jerry_rack(r, P, 2, -0.56, 0.18, 0.15, yaw=0.0)
