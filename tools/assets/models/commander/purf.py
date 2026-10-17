"""Allied ore purifier (2x2, Commander rules): a white purification hall whose sawtooth roof lights glow cyan over
the vats, two tall distillation columns with team bands and ring catwalks, a pressure sphere on legs, an eagle
banner, an ore intake hopper feeding the hall and crates of purified ingots by the door.
Layout and pivots: src/render/models/commander-structures.ts orePurifier().
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _cmd import *  # noqa: E402,F401,F403

ID = 'purf'
FACTION = 'allies'
KIND = 'structure'
ATLAS = 512

CYAN = 0x5ae0ff


def build(m):
    D = Dress('allies')
    D.look(m, ao_dist=0.34)
    m.set_meta(footprint=(2, 2), height=1.55, radius=1.05)
    r = m.root

    box(r, D.conc, (1.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)
    box(r, D.tar, (0.5, 0.012, 0.7), (0.66, Y0 + 0.006, 0.6), bevel=0.003)

    # ---- purification hall (front left): white, pilasters, glazed sawtooth roof glowing cyan over the vats
    hx, hz, hw, hd, hh = -0.24, 0.34, 1.3, 0.7, 0.46
    top, fz = D.block(m, r, hx, hz, hw, hd, hh)
    for x in (hx - hw / 2 + 0.03, hx - 0.2, hx + 0.24, hx + hw / 2 - 0.03):
        box(r, D.frame, (0.05, hh - 0.14, 0.03), (x, Y0 + 0.1 + (hh - 0.14) / 2, fz + 0.012), bevel=0.006)
    for i in range(3):
        x = hx - hw / 2 + 0.24 + i * 0.4
        prism(r, D.steel, [(-0.17, 0.0), (0.17, 0.0), (0.0, 0.16)], hd - 0.14, (x, top + 0.012, hz), rot=(0, 0, 0), bevel=0.006)
        box(r, light_mat(CYAN, 1.6, 'pulse'), (0.2, 0.004, hd - 0.18), (x + 0.085, top + 0.095, hz), (0, 0, -0.76))
        box(r, D.trim, (0.03, 0.025, hd - 0.1), (x, top + 0.175, hz), bevel=0.004)
    AL.lit_sign(m, r, (hx + 0.02, Y0 + 0.36, fz + 0.025), (0.86, 0.15), 'ORE PURIFICATION', lights=2)
    window_row(r, (hx - 0.12, Y0 + 0.19, fz), 4, (0.09, 0.08), 0.055, lit=AL.WIN_COOL, dark=(2,), strength=1.8)
    AL.lit_doorway(m, r, (hx + 0.48, Y0, fz), (0.16, 0.24))
    AL.eagle_banner(m, r, (hx - hw / 2 + 0.12, top - 0.06, fz + 0.03), (0.16, 0.3))
    AL.hazard_band(m, r, (hx, Y0 + 0.07, fz + 0.02), (hw - 0.12, 0.04))
    for x in (hx - hw / 2 + 0.06, hx + hw / 2 - 0.06):
        AL.floodlight(r, (x, top + 0.03, fz - 0.03), yaw=0.0, pitch=0.75, s=0.045)
    # east wall: cyan sight ports into the vats
    for i in range(2):
        box(r, AL.black(), (0.012, 0.08, 0.12), (hx + hw / 2 + 0.004, Y0 + 0.26, hz - 0.15 + i * 0.3))
        box(r, light_mat(CYAN, 1.8, 'pulse'), (0.006, 0.06, 0.1), (hx + hw / 2 + 0.01, Y0 + 0.26, hz - 0.15 + i * 0.3))

    # ---- distillation columns (back left)
    for (x, z, rad, h) in ((-0.66, -0.52, 0.15, 1.42), (-0.26, -0.66, 0.12, 1.12)):
        cyl(r, AL.slab_m(0x7c7870), rad + 0.05, 0.08, (x, Y0 + 0.04, z), r2=rad + 0.04, seg=16, bevel=0.008)
        cyl(r, AL.white(panels=(0.2, 0.18)), rad, h, (x, Y0 + 0.08 + h / 2, z), seg=18)
        for f in (0.22, 0.5, 0.78):
            cyl(r, D.trim, rad + 0.01, 0.045, (x, Y0 + 0.08 + h * f, z), seg=18, caps=False)
        cyl(r, D.grate, rad + 0.075, 0.012, (x, Y0 + 0.08 + h * 0.64, z), seg=18)
        cyl(r, D.rail, rad + 0.072, 0.008, (x, Y0 + 0.14 + h * 0.64, z), seg=18, caps=False)
        for k in range(8):
            a = k / 8 * math.pi * 2
            bar(r, D.rail, (x + math.cos(a) * (rad + 0.07), Y0 + 0.08 + h * 0.64, z + math.sin(a) * (rad + 0.07)),
                (x + math.cos(a) * (rad + 0.07), Y0 + 0.14 + h * 0.64, z + math.sin(a) * (rad + 0.07)), 0.006)
        lathe(r, AL.steel(0x8a95a0, panels=None), [(rad + 0.01, 0.0), (rad * 0.6, 0.06), (0.03, 0.09)], (x, Y0 + 0.08 + h, z), seg=18, cap_bottom=False)
        cyl(r, D.gun, 0.025, 0.09, (x, Y0 + 0.08 + h + 0.13, z), seg=8)
        ladder(r, D.rail, (x + rad * 0.72, Y0 + 0.08, z + rad * 0.72), h - 0.06, facing=math.pi / 4, rung=0.07)
        box(r, light_mat(CYAN, 2.0, 'pulse'), (0.04, 0.16, 0.006), (x, Y0 + 0.08 + h * 0.36, z + rad + 0.004))
        box(r, D.frame, (0.06, 0.18, 0.004), (x, Y0 + 0.08 + h * 0.36, z + rad + 0.001))
    light(r, (-0.66, Y0 + 1.42 + 0.26, -0.52), 0.014, 0xff2a1a, 'blink')
    pipe_run(r, D.pipe, [(-0.66, Y0 + 1.25, -0.37), (-0.66, Y0 + 1.25, -0.2), (-0.66, top + 0.06, -0.2)], 0.024)
    pipe_run(r, D.pipe, [(-0.26, Y0 + 0.95, -0.54), (-0.26, Y0 + 0.95, -0.2), (-0.26, top + 0.06, -0.2)], 0.02)

    # ---- pressure sphere on legs (back right), team band
    sx, sz, sr = 0.46, -0.52, 0.27
    sy = Y0 + 0.34
    for k in range(6):
        a = k / 6 * math.pi * 2
        bar(r, D.steel, (sx + math.cos(a) * sr * 0.85, Y0, sz + math.sin(a) * sr * 0.85), (sx + math.cos(a) * sr * 0.8, sy + 0.04, sz + math.sin(a) * sr * 0.8), 0.022)
        box(r, AL.slab_m(0x7c7870), (0.05, 0.03, 0.05), (sx + math.cos(a) * sr * 0.85, Y0 + 0.015, sz + math.sin(a) * sr * 0.85))
    sphere(r, AL.white(panels=(0.16, 0.16)), sr, (sx, sy + sr * 0.6, sz), seg=20, rings=12)
    cyl(r, D.trim, sr + 0.006, 0.055, (sx, sy + sr * 0.6, sz), seg=20, caps=False)
    AL.strobe(r, (sx, sy + sr * 1.62, sz))
    pipe_run(r, D.pipe, [(sx - sr, sy + 0.1, sz), (0.1, sy + 0.1, sz), (0.1, top + 0.06, -0.02)], 0.026)

    # ---- ore intake (front right): hopper on a frame, the ore heap in it, conveyor into the hall
    ix, iz = 0.68, 0.5
    box(r, AL.slab_m(0x7c7870), (0.36, 0.06, 0.4), (ix, Y0 + 0.03, iz), bevel=0.01)
    for (dx, dz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        bar(r, D.steel, (ix + dx * 0.12, Y0 + 0.06, iz + dz * 0.13), (ix + dx * 0.12, Y0 + 0.3, iz + dz * 0.13), 0.022)
    lathe(r, AL.steel(0x8a95a0, panels=(0.12, 0.12)), [(0.06, 0.0), (0.19, 0.18), (0.2, 0.22)], (ix, Y0 + 0.28, iz), seg=4, rot=(0, math.pi / 4, 0), cap_top=False)
    ore_pile(r, (ix, Y0 + 0.4, iz), 0.13, 0.07, 5, seed=3)
    bar(r, D.steel, (ix - 0.06, Y0 + 0.3, iz - 0.02), (ix - 0.5, Y0 + 0.12, iz - 0.02), 0.06, 0.12)
    AL.hazard_band(m, r, (ix, Y0 + 0.1, iz + 0.21), (0.3, 0.04))
    # purified output: gleaming ingot crates by the door
    gold = metal(0xd7b04a, rough=0.3, rust=0.0)
    for i in range(3):
        box(r, gold, (0.1, 0.03, 0.05), (0.26 + (i % 2) * 0.11, Y0 + 0.015 + (i // 2) * 0.03, 0.86), bevel=0.006)
    D.lamp_post(r, (0.9, Y0, 0.86), 0.38, yaw=math.pi / 2)
    D.drums(r, (0.85, Y0, -0.05), 3)
