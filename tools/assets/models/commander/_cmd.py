"""Shared dressing for the Commander-rules structures and upgrade modules (not a model: build.mjs skips '_' files).

The scripts in this directory build the HD versions of src/render/models/commander-structures.ts: the same
layout, pivots, part names and points as the procedural model (node --import tsx tools/assets/rig.ts <id> <faction>,
node --import tsx tools/assets/footprint.ts <id> <faction>), dressed with the existing faction kits:

    import os, sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from _cmd import *            # kit + SV (soviet/_sovb.py) + AL (allies/_allied.py) + the helpers below

`Dress(fac)` gives one palette for both sides (walls, frames, trims, roofs, lamps) so a faction-dressed structure
is written once (`build_x(m, fac)` in a `_x.py`, with thin `x_soviet.py` / `x_allies.py` scripts).
Upgrade modules stand on their host's slab: their local y = 0 is the slab top (the game anchors them there).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
for d in ('soviet', 'allies'):
    p = os.path.join(HERE, '..', d)
    if p not in sys.path:
        sys.path.insert(0, p)

from kit import *  # noqa: E402,F401,F403
from kit import decals as _D  # noqa: E402
from kit.core import T, facing_rot  # noqa: E402,F401
import _sovb as SV  # noqa: E402
import _allied as AL  # noqa: E402

Y0 = 0.05  # top of the foundation slab (HD)


class Dress:
    """Faction palette for structures written once for both sides."""

    def __init__(self, fac):
        self.fac = fac
        self.sov = fac == 'soviet'
        if self.sov:
            P = SV.Pal()
            self.P = P
            self.wall = P.wall
            self.wall_lt = P.wall_lt
            self.wall_dk = P.wall_dk
            self.clad = P.clad
            self.conc = P.conc
            self.conc_dk = P.conc_dk
            self.conc_lt = P.conc_lt
            self.frame = P.frame
            self.trim = P.trim
            self.roof = P.roof
            self.tar = P.tar
            self.steel = P.steel
            self.dark = P.dark
            self.gun = P.gun
            self.rail = P.rail
            self.yellow = P.yellow
            self.olive = P.olive
            self.rust = P.rust
            self.sand = P.sand
            self.grate = P.grate
            self.void = P.void
            self.white = P.white
            self.pipe = P.steel
            self.board = P.board
            self.win = 0xffc27a
        else:
            self.P = None
            self.wall = AL.white()
            self.wall_lt = AL.white(tone=0xeeebe3)
            self.wall_dk = AL.offwhite()
            self.clad = corrugated(0x7f8a95, pitch=0.03, rust=0.25, streaks=0.9)
            self.conc = AL.slab_m(0x9d988e)
            self.conc_dk = AL.slab_m(0x85807a)
            self.conc_lt = AL.slab_m(0xb3aea3)
            self.frame = AL.frame()
            self.trim = AL.trim()
            self.roof = AL.roof()
            self.tar = AL.asphalt()
            self.steel = AL.steel()
            self.dark = AL.dark_m()
            self.gun = AL.gun_m()
            self.rail = AL.rail_m()
            self.yellow = AL.yellow()
            self.olive = painted(0x4f5636, wear=0.6, rust=0.3, panels=None)
            self.rust = rusty(0x5a4a3c, 0.5)
            self.sand = cloth(0xa08f68, grime=0.6)
            self.grate = tread(0x44474b)
            self.void = AL.black()
            self.white = AL.white(panels=None)
            self.pipe = AL.steel(0x8d99a6, panels=None)
            self.board = None
            self.win = AL.WIN_WARM

    # ---- per-model bake knobs
    def look(self, m, ao_dist=0.38):
        if self.sov:
            SV.look(m, ao_dist=ao_dist)
        else:
            AL.setup(m, ao_dist=ao_dist)

    # ---- building blocks
    def block(self, m, p, x, z, w, d, h, wall=None, y0=Y0, parapet=True, cornice=True, roof=True, plinth=0.1):
        """Plinth, walls, team cornice, roof inside a parapet. Returns (roof top y, front z)."""
        wall = wall or self.wall
        if self.sov:
            top, fz = SV.hall(p, self.P, x, z, w, d, h, wall=wall, plinth=plinth, cornice=cornice, roof=roof,
                              parapet=0.045 if parapet else 0, y0=y0)
            return top, fz
        top = AL.block(m, p, x, z, w, d, h, wall=wall, cornice=self.trim if cornice else None, roof_m=self.roof,
                       cap=self.frame, plinth=plinth, y0=y0, band=cornice, parapet=parapet)
        return top - 0.014, z + d / 2

    def slogan(self, m, p, at, size, sov_lines, all_text, facing='+z', lights=2):
        if self.sov:
            sign(m, p, at, size, sov_lines, facing=facing, board=self.board, lights=lights, emblem='soviet')
        else:
            AL.lit_sign(m, p, at, size, all_text, facing=facing, lights=lights)

    def banner(self, m, p, at, size, facing='+z'):
        if self.sov:
            SV.red_banner(m, p, at, size, facing=facing)
        else:
            AL.eagle_banner(m, p, at, size, facing=facing)

    def crest(self, m, p, at, size, facing='+z'):
        """Faction crest painted on a wall: gold star on red (Soviet), star roundel (Allied)."""
        if self.sov:
            SV.crest(m, p, at, size, facing=facing)
        else:
            AL.roundel(m, p, at, size, facing=facing)

    def lamp(self, p, at, r=0.018, mode='blink'):
        """Warning lamp: Soviet red blinkers, Allied white strobes."""
        if self.sov:
            SV.lamp(p, at, r, 0xff2a1a, mode)
        else:
            AL.strobe(p, at, r)

    def corner_lamps(self, p, x0, z0, x1, z1, y):
        if self.sov:
            SV.roof_lights(p, x0, z0, x1, z1, y)
        else:
            for (x, z) in ((x0, z1), (x1, z0)):
                AL.strobe(p, (x, y, z))

    def lamp_post(self, p, at, h=0.4, yaw=0.0):
        if self.sov:
            SV.lamp_post(p, self.P, at, h, yaw)
        else:
            AL.lamp_post(p, at, h, yaw)

    def drums(self, p, at, n=3):
        if self.sov:
            SV.drums(p, at, n)
        else:
            AL.drums(p, at, n)

    def crates(self, p, at, s=0.09, n=3, rot=0.2):
        if self.sov:
            SV.crates(p, self.P, at, s, n, rot)
        else:
            AL.crates(p, at, n, s, rot)

    def hazard(self, m, p, at, size, facing='+z'):
        if self.sov:
            hazard_stripes(m, p, at, size, facing=facing)
        else:
            AL.hazard_band(m, p, at, size, facing=facing)

    def stack(self, m, p, at, h, r, name, r_top=None, lights=3):
        """Smokestack: Soviet sooty steel with red bands, Allied white concrete with team bands."""
        x, y, z = at
        if self.sov:
            SV.stack(m, p, self.P, at, h, r, name=name, r_top=r_top, lights=lights, base=True, seg=16)
            return
        top_y = y + h
        shell = AL.tune(concrete(0xd8d5cc, grime=0.6, streaks=1.0, wear=0.5, joints=(0.6, 0.12), soot=(top_y - h * 0.3, top_y - 0.02)), ao=0.8)
        cyl(p, AL.slab_m(0x7c7870), r + 0.05, 0.08, (x, y + 0.04, z), r2=r + 0.02, seg=16, bevel=0.008)
        chimney(m, p, at, h, r, r_top if r_top is not None else r * 0.78, mat=shell, band_mat=AL.trim(wear=0.5), cap=AL.dark_m(),
                smoke=name, bands=[(0.34, 0.07), (0.62, 0.06)], lights=lights, glow_ring=False, seg=16)


def ore_pile(p, at, r, h, n=6, seed=1):
    """A heap of raw ore: an earthy cone with gold-glinting nuggets (low emit, reads in the shade)."""
    x, y, z = at
    earth = AL.tune(concrete(0x8a6a3e, grime=0.4, streaks=0.0, wear=0.3, tex='rough_concrete', rough=0.95), ao=0.9)
    lathe(p, earth, [(r, 0.0), (r * 0.82, h * 0.4), (r * 0.5, h * 0.78), (0.0, h)], (x, y, z), seg=12, cap_bottom=False)
    gold = light_mat(0xe8b434, 0.25, 'steady')
    import random
    rnd = random.Random(seed)
    for i in range(n):
        a = rnd.random() * math.pi * 2
        d = rnd.random() * r * 0.75
        s = r * rnd.uniform(0.1, 0.16)
        yy = y + h * max(0.0, 1 - (d / r) ** 1.3) - s * 0.4
        cyl(p, gold, s, s * 2.2, (x + math.cos(a) * d, yy + s, z + math.sin(a) * d), (0.3 * (i % 3 - 1), i * 1.1, 0.2), r2=0.0, seg=5)


def bag_wall(p, mat, a, b, rows=2, h=0.045, w=0.08):
    """Staggered sandbags from a to b (ground points), rounded bags."""
    from mathutils import Vector
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    if L < 0.05:
        return
    yaw = -math.atan2(d.z, d.x)
    n = max(1, int(round(L / 0.11)))
    for r_ in range(rows):
        k = n - (r_ % 2)
        for i in range(k):
            t = (i + 0.5 + 0.5 * (r_ % 2)) / n
            c = a + d * t
            box(p, mat, (L / n * 0.94, h, w - r_ * 0.01), (c.x, a.y + h * (r_ + 0.5) * 0.95, c.z), (0, yaw, 0), bevel=0.014)


def lattice_tower(p, mat, at, h, base=0.09, top=0.05, levels=6):
    """Four-legged lattice tower (crane masts, floodlight towers) from at.y up h."""
    x, y, z = at
    for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        bar(p, mat, (x + sx * base, y, z + sz * base), (x + sx * top, y + h, z + sz * top), 0.016)
    for k in range(1, levels + 1):
        f0, f1 = (k - 1) / levels, k / levels
        w0 = base + (top - base) * f0
        w1 = base + (top - base) * f1
        y0_, y1_ = y + h * f0, y + h * f1
        for s in (-1, 1):
            bar(p, mat, (x - w0, y0_, z + s * w0), (x + w1, y1_, z + s * w1), 0.008)
            bar(p, mat, (x + s * w0, y0_, z - w0), (x + s * w1, y1_, z + w1), 0.008)


def container(p, at, length, mat, axis='x', h=0.16, w=0.17):
    """Shipping container (ribbed sides, doors at the +x end)."""
    x, y, z = at
    if axis == 'x':
        box(p, mat, (length, h, w), (x, y + h / 2, z), bevel=0.008)
        for i in range(int(length / 0.05)):
            xx = x - length / 2 + 0.03 + i * 0.05
            box(p, mat, (0.012, h - 0.03, w + 0.008), (xx, y + h / 2, z))
        box(p, AL.dark_m(), (0.008, h - 0.02, w - 0.02), (x + length / 2 + 0.002, y + h / 2, z))
    else:
        box(p, mat, (w, h, length), (x, y + h / 2, z), bevel=0.008)
        for i in range(int(length / 0.05)):
            zz = z - length / 2 + 0.03 + i * 0.05
            box(p, mat, (w + 0.008, h - 0.03, 0.012), (x, y + h / 2, zz))
        box(p, AL.dark_m(), (w - 0.02, h - 0.02, 0.008), (x, y + h / 2, z + length / 2 + 0.002))


def soldier(p, at, yaw=0.0, uniform=0x4f5636, helmet=0x3f4730):
    """Infantry silhouette (helmet + shoulders + face) facing yaw (0 = +z): bunker slits, training yards."""
    x, y, z = at
    u = cloth(uniform, grime=0.5)
    box(p, u, (0.07, 0.05, 0.04), (x, y + 0.025, z), (0, yaw, 0), bevel=0.01)
    sphere(p, painted(0xc89070, panels=None, wear=0.1), 0.017, (x + math.sin(yaw) * 0.004, y + 0.066, z + math.cos(yaw) * 0.004), seg=8, rings=5)
    lathe(p, painted(helmet, panels=None, wear=0.5), [(0.03, 0.0), (0.026, 0.014), (0.012, 0.024), (0.0, 0.026)], (x, y + 0.07, z), seg=10)


def fac_light(fac):
    return 0xff2a1a if fac == 'soviet' else 0xf0f4ff
