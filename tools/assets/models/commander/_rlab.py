"""Research lab (3x2, Commander rules), shared by rlab_soviet.py / rlab_allies.py. Soviet: a ribbed brutalist
institute with two storeys of lit windows, the SCIENCE FOR THE PEOPLE board and a red banner; Allied: a white lab with
a long glazed curtain wall (lab-blue panes) and the RESEARCH DIVISION sign. Both: an observatory on the roof (part
'scope' slews), a fume stack (smoke0), and the reinforced test chamber whose ports and spinning test rig (part
'rig') glow while research runs ('glow:lab', driven by the game). Layout: commander-structures.ts researchLab().
"""
import math

from _cmd import *  # noqa: F401,F403


def build_rlab(m, fac):
    D = Dress(fac)
    sov = D.sov
    D.look(m, ao_dist=0.38)
    m.set_meta(footprint=(3, 2), height=1.25, radius=1.6)
    r = m.root
    lab = 0x6cff9a if sov else 0x7ad8ff

    box(r, D.conc, (2.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)
    box(r, D.tar, (0.5, 0.012, 0.4), (-0.66, Y0 + 0.006, 0.76))
    # ---- main block
    mx, mz, mw, md, mh = -0.42, -0.12, 1.9, 1.1, 0.62
    top, fz = D.block(m, r, mx, mz, mw, md, mh)
    x0, x1 = mx - mw / 2, mx + mw / 2
    if sov:
        SV.pilasters(r, D.frame, [x0 + 0.03 + i * (mw - 0.06) / 8 for i in range(9)], fz, Y0 + 0.13, top - 0.08, w=0.045, dz=0.035)
        for (y, dark) in ((0.24, (1, 4, 6)), (0.46, (0, 3, 5, 7))):
            for i in range(8):
                x = x0 + 0.03 + (i + 0.5) * (mw - 0.06) / 8
                window(r, (x, Y0 + y, fz), (0.1, 0.08), lit=None if i in dark else D.win, strength=2.0)
        sign(m, r, (mx + 0.5, Y0 + 0.6, fz + 0.035), (0.66, 0.2), 'SCIENCE|FOR THE PEOPLE', board=D.board, lights=3, emblem='soviet')
        SV.red_banner(m, r, (mx - 0.66, top - 0.06, fz + 0.03), (0.2, 0.42))
        SV.neon(r, x0 + 0.05, x0 + 0.5, top, fz)
    else:
        AL.glazing(m, r, (mx, Y0 + 0.36, fz + 0.004), (mw - 0.22, 0.3), 12, lit={0, 1, 3, 4, 6, 7, 9, 10}, color=AL.WIN_COOL, emit=0.85)
        box(r, light_mat(lab, 1.4, 'pulse'), (mw - 0.3, 0.02, 0.004), (mx, Y0 + 0.24, fz + 0.012))
        AL.lit_sign(m, r, (mx + 0.32, Y0 + 0.6, fz + 0.03), (0.74, 0.14), 'RESEARCH DIVISION', lights=3)
        AL.roundel(m, r, (mx - 0.66, Y0 + 0.6, fz + 0.003), 0.12)
        for x in (x0 + 0.06, x1 - 0.06):
            AL.floodlight(r, (x, top + 0.035, fz - 0.03), yaw=0.0, pitch=0.75, s=0.045)
    door(m, r, (mx - 0.24, Y0, fz), (0.2, 0.2), kind='double')
    D.corner_lamps(r, x0 + 0.04, mz - md / 2 + 0.04, x1 - 0.04, fz - 0.04, top + 0.03)
    rivet_row(m, r, (x0 + 0.05, top - 0.09, fz + 0.001), (x1 - 0.05, top - 0.09, fz + 0.001))
    # roof: observatory (part 'scope'), fume stack, AC, mast
    rt = top + 0.015
    ox, oz = mx - 0.42, mz - 0.12
    cyl(r, D.wall_dk, 0.32, 0.16, (ox, rt + 0.065, oz), r2=0.34, seg=20, bevel=0.008)
    cyl(r, D.trim, 0.325, 0.035, (ox, rt + 0.135, oz), seg=20, caps=False)
    sc = m.part('scope', at=(ox, 0.835, oz))
    shell = D.white if sov else AL.white(panels=(0.14, 0.14))
    if sov:
        dome(sc, shell, 0.3, (0, 0, 0), seg=20, rings=6)
    else:
        AL.geodome(sc, shell, 0.3, (0, 0, 0), subdiv=2, cut=0.0)
    box(sc, D.void, (0.1, 0.3, 0.2), (0, 0.17, 0.2), (-0.6, 0, 0))
    cyl(sc, D.gun, 0.03, 0.26, (0, 0.22, 0.12), (0.6, 0, 0), r2=0.04, seg=10)
    D.stack(m, r, (mx + 0.36, rt, mz - 0.3), 0.42, 0.07, 'smoke0', r_top=0.055, lights=2)
    ac_unit(r, (mx + 0.1, rt, mz + 0.22), 0.1)
    ac_unit(r, (mx + 0.64, rt, mz + 0.2), 0.09, rot=0.2)
    antenna(r, (mx + 0.78, rt, mz - 0.32), 0.5)

    # ---- test chamber (right)
    tx, tz = 1.0, -0.1
    box(r, D.conc_dk, (0.86, 0.1, 0.9), (tx, Y0 + 0.05, tz), bevel=0.016)
    drum = D.conc if sov else AL.white(panels=(0.2, 0.12))
    cyl(r, drum, 0.38, 0.5, (tx, Y0 + 0.35, tz), r2=0.36, seg=24, bevel=0.01)
    for k in range(6):
        a = k / 6 * math.pi * 2 + 0.3
        box(r, D.wall_dk, (0.07, 0.5, 0.08), (tx + math.cos(a) * 0.39, Y0 + 0.35, tz + math.sin(a) * 0.39), (0, -a, 0), bevel=0.01)
    cyl(r, D.trim, 0.372, 0.045, (tx, Y0 + 0.56, tz), seg=24, caps=False)
    cyl(r, D.steel, 0.37, 0.06, (tx, Y0 + 0.63, tz), r2=0.3, seg=24)
    for a in (math.pi / 2 - 0.5, math.pi / 2, math.pi / 2 + 0.5):
        x = tx + math.cos(a) * 0.38
        z = tz + math.sin(a) * 0.38
        yaw = math.pi / 2 - a
        box(r, D.void, (0.1, 0.12, 0.03), (x, Y0 + 0.36, z), (0, yaw, 0))
        box(r, glow_material('glow:lab', lab), (0.08, 0.1, 0.008), (x + math.cos(a) * 0.016, Y0 + 0.36, z + math.sin(a) * 0.016), (0, yaw, 0))
    rg = m.part('rig', at=(tx, 0.70, tz))
    cyl(rg, D.gun, 0.05, 0.12, (0, 0.06, 0), r2=0.07, seg=12)
    copper = metal(0xb06a3c, rough=0.35, rust=0.1)
    for k in range(3):
        a = k / 3 * math.pi * 2
        bar(rg, D.steel, (0, 0.12, 0), (math.cos(a) * 0.26, 0.12, math.sin(a) * 0.26), 0.03)
        sphere(rg, copper, 0.04, (math.cos(a) * 0.26, 0.12, math.sin(a) * 0.26), seg=10, rings=6)
    cyl(rg, copper, 0.02, 0.22, (0, 0.23, 0), r2=0.03, seg=10)
    sphere(rg, glow_material('glow:lab', lab), 0.04, (0, 0.37, 0), seg=10, rings=6)
    pipe_run(r, D.pipe, [(x1, Y0 + 0.44, tz - 0.25), (tx - 0.3, Y0 + 0.44, tz - 0.25)], 0.026)
    pipe_run(r, D.dark, [(x1, Y0 + 0.3, tz + 0.1), (tx - 0.37, Y0 + 0.3, tz + 0.1)], 0.02)
    hazard_stripes(m, r, (tx, Y0 + 0.002, tz + 0.52), (0.7, 0.05), facing='+y')
    stencil(m, r, 'LAB 2' if not sov else 'НИИ-2', (tx, Y0 + 0.16, tz + 0.392), 0.05, color=0x2a2e34 if not sov else 0xe8b434)
    D.lamp_post(r, (1.36, Y0, 0.86), 0.38, yaw=math.pi / 2)
    D.crates(r, (0.62, Y0, 0.78), 0.08, 2, 0.2)
