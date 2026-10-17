"""Mining outpost (2x2, Commander rules), shared by mout_soviet.py / mout_allies.py: a forward refinery with ONE dock
under the right column. The unloading lane (green guide lamps, 'glow:dock') leads to a steel intake house whose mouth
glows ('glow:proc') over the rollers (parts roll0..roll3, turned by the game while a truck unloads); a conveyor
gallery climbs to the processing shed with its crusher house (steam0); a site cabin with a radio mast, a floodlight
mast over the lane, a fuel tank and an ore spill. No silos. Layout: commander-structures.ts miningOutpost().
"""
import math

from _cmd import *  # noqa: F401,F403


def build_mout(m, fac):
    D = Dress(fac)
    D.look(m, ao_dist=0.34)
    m.set_meta(footprint=(2, 2), height=1.15, radius=1.05)
    r = m.root
    sov = D.sov

    box(r, D.conc, (1.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)
    # ---- unloading lane (right column)
    lx = 0.5
    box(r, D.tar, (0.78, 0.022, 1.0), (lx, Y0 + 0.011, 0.5), bevel=0.006)
    for s in (-1, 1):
        AL.hazard_band(m, r, (lx + s * 0.37, Y0 + 0.022, 0.5), (0.98, 0.045), facing='+y', roll=math.pi / 2, base=D.tar)
    for i in range(3):
        AL.mark(m, r, solid(AL.HAZ_Y), (lx, Y0 + 0.022, 0.55 + i * 0.16), (0.24, 0.035), D.tar, rough=0.6)
        for s in (-1, 1):
            cyl(r, D.dark, 0.016, 0.02, (lx + s * 0.34, Y0 + 0.03, 0.5 + i * 0.2), seg=8)
            sphere(r, glow_material('glow:dock', 0x40ff70), 0.013, (lx + s * 0.34, Y0 + 0.046, 0.5 + i * 0.2), seg=8, rings=5)
    # ---- intake house at the head of the lane
    iz = -0.12
    itop, ifz = D.block(m, r, lx, iz, 0.7, 0.5, 0.58, wall=D.clad, plinth=0.08)
    prism(r, D.steel, [(0.0, 0.14), (0.26, 0.32), (0.26, 0.42), (0.0, 0.42)], 0.5, (lx, Y0, ifz - 0.01), (0, -math.pi / 2, 0), bevel=0.006)
    for s in (-1, 1):
        prism(r, D.frame, [(0.0, 0.14), (0.26, 0.32), (0.26, 0.42), (0.0, 0.42)], 0.025, (lx + s * 0.26, Y0, ifz - 0.01), (0, -math.pi / 2, 0))
    box(r, D.void, (0.42, 0.22, 0.02), (lx, Y0 + 0.14, ifz + 0.005))
    box(r, glow_material('glow:proc', 0xff7a22), (0.36, 0.045, 0.01), (lx, Y0 + 0.07, ifz + 0.016))
    box(r, light_mat(0xff8a30, 1.0, 'flicker'), (0.34, 0.08, 0.004), (lx, Y0 + 0.17, ifz + 0.016))
    hazard_stripes(m, r, (lx, Y0 + 0.4, ifz + 0.265), (0.5, 0.05))
    box(r, D.frame, (0.42, 0.04, 0.3), (lx, Y0 + 0.02, ifz + 0.18), bevel=0.006)
    for i in range(4):
        rl = m.part(f'roll{i}', at=(lx, Y0 + 0.045, iz + 0.3 + i * 0.065))
        cyl(rl, metal(0x9aa2ab, rough=0.35), 0.019, 0.34, (0, 0, 0), (0, 0, math.pi / 2), seg=10)
        box(rl, D.dark, (0.34, 0.008, 0.006), (0, 0.018, 0))
    D.corner_lamps(r, lx - 0.33, iz - 0.23, lx + 0.33, ifz - 0.02, itop + 0.03)
    stencil(m, r, 'DOCK 1' if not sov else 'ПРИЁМ', (lx + 0.22, Y0 + 0.5, ifz + 0.002), 0.045, color=0xe8b434)

    # ---- processing shed (back) + crusher house on its roof
    sx, sz = -0.36, -0.5
    stop, sfz = D.block(m, r, sx, sz, 1.12, 0.8, 0.5)
    for x in (sx - 0.53, sx - 0.1, sx + 0.33):
        box(r, D.frame, (0.045, 0.36, 0.03), (x, Y0 + 0.1 + 0.18, sfz + 0.012), bevel=0.006)
    box(r, D.steel, (0.5, 0.18, 0.4), (sx - 0.12, stop + 0.11, sz - 0.08), bevel=0.014)
    box(r, D.roof, (0.54, 0.025, 0.44), (sx - 0.12, stop + 0.21, sz - 0.08), bevel=0.006)
    grille(m, r, (sx - 0.12, stop + 0.225, sz - 0.08), (0.3, 0.2), facing='+y')
    vent(m, r, (sx - 0.12, stop + 0.11, sz + 0.122), (0.3, 0.1), facing='+z')
    m.steam('steam0', (sx - 0.12, stop + 0.27, sz - 0.08))
    ac_unit(r, (sx + 0.36, stop + 0.02, sz + 0.1), 0.09)
    window_row(r, (sx - 0.22, Y0 + 0.3, sfz), 3, (0.08, 0.07), 0.06, lit=D.win, dark=(1,), strength=1.8)
    D.slogan(m, r, (sx - 0.22, Y0 + 0.43, sfz + 0.025), (0.5, 0.15), 'ORE FOR THE|FRONT', 'FORWARD MINING', lights=2)
    # conveyor gallery from the intake up onto the shed roof
    a = (lx - 0.3, Y0 + 0.5, iz - 0.05)
    b = (sx + 0.2, stop + 0.16, sz + 0.05)
    bar(r, D.steel, a, b, 0.12, 0.08)
    bar(r, D.roof, (a[0], a[1] + 0.05, a[2]), (b[0], b[1] + 0.05, b[2]), 0.14, 0.016)
    mx, my, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2
    bar(r, D.frame, (mx, Y0, mz), (mx, my - 0.04, mz), 0.03)

    # ---- site cabin (front left) with a radio mast; the floodlight mast over the lane
    cx, cz = -0.5, 0.42
    ctop, cfz = D.block(m, r, cx, cz, 0.52, 0.4, 0.3, plinth=0.06, cornice=not sov)
    window_row(r, (cx - 0.06, Y0 + 0.18, cfz), 2, (0.08, 0.07), 0.08, lit=D.win, dark=(1,), strength=1.8)
    door(m, r, (cx + 0.17, Y0, cfz), (0.1, 0.18), kind='hatch')
    antenna(r, (cx - 0.16, ctop + 0.02, cz - 0.08), 0.5, guy=False)
    if sov:
        SV.red_banner(m, r, (cx + 0.17, ctop - 0.03, cfz + 0.03), (0.12, 0.2))
    else:
        AL.roundel(m, r, (cx, Y0 + 0.24, cfz + 0.003), 0.08)
    if sov:
        cyl(r, D.gun, 0.016, 1.05, (-0.06, Y0 + 0.525, 0.2), r2=0.011, seg=8)
        bar(r, D.gun, (-0.17, Y0 + 1.04, 0.2), (0.05, Y0 + 1.04, 0.2), 0.014)
        for x in (-0.13, 0.01):
            AL.floodlight(r, (x, Y0 + 1.05, 0.22), yaw=0.4 if x > 0 else 0.9, pitch=0.7, s=0.045)
        SV.lamp(r, (-0.06, Y0 + 1.08, 0.2), 0.014)
    else:
        AL.flood_mast(m, r, (-0.06, Y0, 0.2), 1.05, n=2, yaw=0.6, s=0.045)
    # ore spill, fuel tank, crates
    ore_pile(r, (-0.62, Y0, 0.86), 0.14, 0.06, 5, seed=7)
    tank = D.wall_lt if sov else AL.white(panels=None)
    cyl(r, tank, 0.07, 0.3, (-0.82, Y0 + 0.1, -0.02), (0, math.pi / 2, math.pi / 2), seg=12)
    for s in (-1, 1):
        box(r, D.frame, (0.04, 0.08, 0.11), (-0.82 + s * 0.09, Y0 + 0.04, -0.02))
    cyl(r, D.trim, 0.073, 0.035, (-0.82, Y0 + 0.1, -0.02), (0, 0, math.pi / 2), seg=12, caps=False)
    D.crates(r, (-0.18, Y0, 0.84), 0.08, 2, 0.3)
