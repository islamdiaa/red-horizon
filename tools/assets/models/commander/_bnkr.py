"""Bunker (2x2, Commander rules), shared by bnkr_soviet.py / bnkr_allies.py: a dug-in concrete blockhouse with
battered walls, earth berms on the flanks, a thick overhanging roof slab with a team band, two firing slits per side
(muzzles m0..m7: south pair, east, north, west) glowing warm inside, a garrison soldier behind each camera-side slit
(parts g0..g3, shown by the game per soldier inside), an observation cupola with a lit vision band, a hatch, roof
sandbags, the faction crest and a sandbagged yard. Layout and pivots: commander-structures.ts bunker().
"""
import math

from _cmd import *  # noqa: F401,F403


def slits(w, d):
    out = []
    for k in (-1, 1):
        out.append((k * w * 0.22, d / 2, 0.0))
    for k in (1, -1):
        out.append((w / 2, k * d * 0.22, math.pi / 2))
    for k in (1, -1):
        out.append((k * w * 0.22, -d / 2, math.pi))
    for k in (-1, 1):
        out.append((-w / 2, k * d * 0.22, -math.pi / 2))
    return out


def build_bnkr(m, fac):
    D = Dress(fac)
    sov = D.sov
    D.look(m, ao_dist=0.3)
    m.set_meta(footprint=(2, 2), height=0.8, radius=1.0)
    r = m.root
    conc = SV.deep(concrete(0x8a867e, joints=(0.3, 0.12), grime=0.85, streaks=0.9, wear=0.75), 0.82) if sov else \
        AL.tune(concrete(0xc9c5ba, joints=(0.3, 0.12), grime=0.7, streaks=0.9, wear=0.7), ao=0.85)
    conc_dk = D.conc_dk
    earth = AL.tune(concrete(0x6b6250, grime=0.5, streaks=0.0, wear=0.2, tex='rough_concrete', rough=0.97), ao=0.9)
    w, d, h = 1.36, 1.24, 0.44

    box(r, D.conc, (1.98, Y0, 1.98), (0, Y0 / 2, 0), bevel=0.018)
    for s in (-1, 1):
        prism(r, earth, [(0.0, 0.0), (0.26, 0.0), (0.04, h * 0.72), (0.0, h * 0.72)], d + 0.1, (s * (w / 2 - 0.02), Y0, 0),
              (0, 0 if s > 0 else math.pi, 0), bevel=0.02)
    # battered body: a loft from the footing up to the roof line
    loft(r, conc_dk, [(Y0, [(-w / 2 - 0.03, -d / 2 - 0.03), (w / 2 + 0.03, -d / 2 - 0.03), (w / 2 + 0.03, d / 2 + 0.03), (-w / 2 - 0.03, d / 2 + 0.03)]),
                      (Y0 + 0.06, [(-w / 2 - 0.03, -d / 2 - 0.03), (w / 2 + 0.03, -d / 2 - 0.03), (w / 2 + 0.03, d / 2 + 0.03), (-w / 2 - 0.03, d / 2 + 0.03)])])
    i1 = 0.12
    loft(r, conc, [(Y0 + 0.06, [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]),
                   (Y0 + h, [(-w / 2 + i1, -d / 2 + i1), (w / 2 - i1, -d / 2 + i1), (w / 2 - i1, d / 2 - i1), (-w / 2 + i1, d / 2 - i1)])], bevel=0.012)
    rt = Y0 + h
    box(r, conc, (w - 0.1, 0.12, d - 0.1), (0, rt + 0.06, 0), bevel=0.035)
    box(r, D.trim, (w - 0.08, 0.035, d - 0.08), (0, rt + 0.015, 0), bevel=0.006)
    box(r, conc_dk, (w - 0.42, 0.06, d - 0.42), (0, rt + 0.15, 0), bevel=0.02)

    # ---- firing slits + muzzle points, the garrison behind the camera-side slits
    sy = Y0 + 0.27
    ss = slits(w - 0.16, d - 0.16)
    for i, (x, z, yaw) in enumerate(ss):
        F = T((x, 0, z), (0, yaw, 0))
        def xf(v, F=F):
            return tuple(F @ SV.v3(v))
        box(r, D.void, (0.28, 0.08, 0.05), xf((0, sy, -0.01)), (0, yaw, 0))
        box(r, conc, (0.36, 0.03, 0.1), xf((0, sy + 0.058, 0.03)), (0, yaw, 0), bevel=0.008)
        box(r, light_mat(0xffc27a, 1.2, 'flicker'), (0.24, 0.05, 0.004), xf((0, sy - 0.006, 0.019)), (0, yaw, 0))
        m.point(f'm{i}', (x + math.sin(yaw) * 0.07, sy, z + math.cos(yaw) * 0.07), None, (0, yaw - math.pi / 2, 0), 'muzzle')
    # heads and helmets in the slits, silhouetted against the warm glow inside
    for k, si in enumerate((0, 1, 2, 7)):
        x, z, yaw = ss[si]
        g = m.part(f'g{k}', at=(x + math.sin(yaw) * 0.03, sy - 0.03, z + math.cos(yaw) * 0.03), rot=(0, yaw, 0), ground=False, cull=False)
        sphere(g, painted(0xc89070, panels=None, wear=0.1), 0.017, (0, 0.012, 0), seg=8, rings=5)
        lathe(g, painted(0x3a4130 if sov else 0x4f5636, panels=None, wear=0.5), [(0.03, 0.0), (0.026, 0.014), (0.012, 0.024), (0.0, 0.026)], (0, 0.018, 0), seg=10)
        cyl(g, D.gun, 0.004, 0.09, (0.03, 0.0, 0.03), (math.pi / 2, 0, 0), seg=5)

    # ---- roof: observation cupola, hatch, sandbags, mast, lamp
    cx, cz = -0.18, -0.12
    ct = rt + 0.18
    cyl(r, conc_dk, 0.24, 0.16, (cx, ct + 0.08, cz), r2=0.27, seg=8, bevel=0.01)
    cyl(r, D.void, 0.222, 0.035, (cx, ct + 0.17, cz), seg=8)
    cyl(r, light_mat(0xffc27a, 1.4, 'flicker'), 0.216, 0.016, (cx, ct + 0.166, cz), seg=8, caps=False)
    cyl(r, conc, 0.27, 0.08, (cx, ct + 0.225, cz), r2=0.2, seg=8, bevel=0.01)
    cyl(r, D.trim, 0.205, 0.02, (cx, ct + 0.27, cz), seg=8)
    cyl(r, D.gun, 0.012, 0.16, (cx + 0.08, ct + 0.34, cz - 0.04), seg=6)
    if sov:
        SV.crest(m, r, (cx, ct + 0.09, cz + 0.262), 0.13, facing=(-0.12, 0, 0))
    else:
        AL.roundel(m, r, (cx, ct + 0.09, cz + 0.262), 0.12, facing=(-0.12, 0, 0))
    cyl(r, D.gun, 0.08, 0.04, (0.32, rt + 0.2, -0.18), seg=12, bevel=0.006)
    bar(r, metal(0x9aa2ab, rough=0.35), (0.26, rt + 0.225, -0.18), (0.38, rt + 0.225, -0.18), 0.012)
    bag_wall(r, D.sand, (-0.05, rt + 0.12, d / 2 - 0.12), (0.45, rt + 0.12, d / 2 - 0.12), rows=2)
    bag_wall(r, D.sand, (w / 2 - 0.12, rt + 0.12, -0.05), (w / 2 - 0.12, rt + 0.12, 0.25), rows=2)
    antenna(r, (0.5, rt + 0.12, -0.4), 0.42)
    D.lamp(r, (-0.56, rt + 0.13, 0.46), 0.016)
    # front face: crest and number on the battered wall
    if sov:
        SV.crest(m, r, (0.3, Y0 + 0.16, d / 2 - 0.035), 0.16, facing=(-0.27, 0, 0))
    stencil(m, r, 'ДОТ-4' if sov else 'B-4', (-0.3, Y0 + 0.14, d / 2 - 0.03), 0.05, facing=(-0.27, 0, 0), color=0xe8e4da)
    # yard: ammo crates, a sandbag wall, the rear entry trench
    D.crates(r, (0.8, Y0, 0.8), 0.07, 2, 0.4)
    bag_wall(r, D.sand, (-0.82, Y0, 0.88), (-0.38, Y0, 0.88), rows=3)
    box(r, D.void, (0.22, 0.012, 0.2), (0.36, Y0 + 0.002, -d / 2 - 0.12))
    for i in range(3):
        box(r, conc_dk, (0.22, 0.02, 0.05), (0.36, Y0 - 0.01 - i * 0.012, -d / 2 - 0.05 - i * 0.05))
