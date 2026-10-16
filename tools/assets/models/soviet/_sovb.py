"""[SOVB] Shared dressing for the Soviet structures (not a model: build.mjs skips files starting with '_').

Model scripts do:
    import os, sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from _sovb import *

Everything here is built from the public kit API (shapes, materials, decals). Two per-model look knobs are
set through the kit's API: look(m) = m.tune(edge_light, ao_distance), deep(mat) = set_weather(mat, ao=).
The point of the dressing: Soviet structures must read at the default RTS zoom (150-300 px wide), so it
favours big, high-contrast forms: banners, slogan boards, red lamps, lit windows, bold edges, deep grime.
"""
import math

from kit import *
from kit import decals as _D
from kit import materials as _Mt

Y0 = 0.05  # top of the foundation slab


# ---------------------------------------------------------------------------------------------------------
# look knobs (the kit's official per-model / per-material API)

def look(m, edge=0.12, ao_dist=0.42):
    """Per-model bake look: a modest edge catch-light (strong edge light reads as a pale halo at RTS zoom) and a
    longer AO reach (deep contact shadows and crevices on 2x2 / 3x3 structures)."""
    m.tune(edge_light=edge, ao_distance=ao_dist)


def deep(mat, ao=0.8):
    """How much baked AO goes into this material's albedo (kit default 0.55)."""
    return set_weather(mat, ao=ao)


class Pal:
    """The Soviet structure palette (weathering pushed for the RTS zoom)."""

    def __init__(self):
        self.conc = deep(concrete(0x8e897f, joints=(0.5, 0.25), grime=0.8, streaks=0.85, wear=0.75), 0.75)
        self.conc_dk = deep(concrete(0x6c6861, grime=0.85, streaks=0.7, wear=0.7), 0.8)
        self.conc_lt = deep(concrete(0x9a958b, joints=(0.6, 0.3), grime=0.7, streaks=0.8, wear=0.75), 0.72)
        self.wall = deep(painted(0x5c646d, panels=(0.22, 0.16), wear=0.75, grime=0.7, rust=0.35, streaks=0.95), 0.8)
        self.wall_lt = deep(painted(0x68707a, panels=(0.26, 0.2), wear=0.7, grime=0.65, rust=0.3, streaks=0.9), 0.78)
        self.wall_dk = deep(painted(0x474d55, panels=(0.24, 0.18), wear=0.75, grime=0.7, rust=0.4, streaks=0.95), 0.82)
        self.clad = deep(corrugated(0x4e555c, pitch=0.03, rust=0.4, streaks=1.0, wear=0.6, grime=0.7), 0.82)
        self.frame = deep(painted(0x2e3135, wear=0.85, rust=0.35, grime=0.6, panels=None), 0.75)
        self.trim = team(wear=0.6, panels=None)
        self.trim_p = team(wear=0.55, panels=(0.2, 0.16))
        self.red = painted(0xa31c15, wear=0.6, rust=0.25, streaks=0.7, panels=None)
        self.board = painted(0x9e1a14, wear=0.5, rust=0.2, streaks=0.5, panels=None)
        self.dark = metal(0x2a2d31, rough=0.5, rust=0.35)
        self.gun = metal(0x3a3e44, rough=0.45, rust=0.3, wear=0.5)
        self.steel = metal(0x5a6068, rough=0.45, rust=0.35)
        self.rust = rusty(0x5a4a3c, 0.6)
        self.roof = deep(concrete(0x5c5a55, grime=0.85, streaks=0.3, joints=(0.4, 0.4), tex='rough_concrete'), 0.85)
        self.tar = deep(concrete(0x3f3e3b, grime=0.6, streaks=0.2, wear=0.3, tex='rough_concrete', rough=0.95), 0.8)
        self.rail = metal(0x34373b, rough=0.5)
        self.yellow = painted(0xcf9a1c, wear=0.75, rust=0.35, streaks=0.6, panels=None)
        self.olive = painted(0x4f5636, wear=0.6, rust=0.35, panels=None)
        self.white = painted(0xc8c6be, wear=0.55, rust=0.25, grime=0.6, streaks=0.8, panels=None)
        self.band = painted(0xa01812, wear=0.45, rust=0.25, streaks=0.9, panels=None)
        self.copper = metal(0xb06a3c, rough=0.4, rust=0.15)
        self.sand = cloth(0x8a7a58, grime=0.6)
        self.tarp = cloth(0x4a5236, grime=0.5)
        self.void = flat(0x0c0c0e, 0.9)
        self.grate = tread(0x44474b)


# ---------------------------------------------------------------------------------------------------------
# emissives

def lamp(p, at, r=0.02, color=0xff2a1a, mode='blink', strength=3.2, housing=None, facing='+y'):
    """Cheap warning lamp (~40 tris): box housing + emissive lens. Bigger than kit.light() by default so it
    reads at RTS zoom."""
    housing = housing or _Mt.metal(0x26282c)
    x, y, z = at
    if facing == '+y':
        box(p, housing, (r * 2.2, r * 0.8, r * 2.2), (x, y + r * 0.4, z), bevel=0.002)
        sphere(p, light_mat(color, strength, mode), r, (x, y + r * 1.1, z), seg=6, rings=4)
    else:
        F = facing_rot(facing)
        from kit.core import T
        M = T(at, F)
        b = M @ _v((0, 0, r * 0.4))
        c = M @ _v((0, 0, r * 1.1))
        box(p, housing, (r * 2.2, r * 2.2, r * 0.8), tuple(b), F, bevel=0.002)
        sphere(p, light_mat(color, strength, mode), r, tuple(c), seg=6, rings=4)


def _v(t):
    from mathutils import Vector
    return Vector((t[0], t[1], t[2]))


def strip_light(p, at, size, color=0xffd9a0, strength=2.2, mode='steady', facing='+z'):
    """Flat emissive strip (lit window band, bay lights, glow ports)."""
    w, h = size
    rot = facing_rot(facing)
    box(p, light_mat(color, strength, mode), (w, h, 0.006), at, rot)


def roof_lights(p, x0, z0, x1, z1, y, r=0.024, mode='blink', color=0xff2a1a):
    for (x, z) in ((x0, z0), (x1, z0), (x0, z1), (x1, z1)):
        lamp(p, (x, y, z), max(r, 0.024), color, mode, strength=3.8)


def roof_sign(m, p, P, at, size, lines, lights=3, emblem='soviet', depth=0.12):
    """Standing rooftop billboard (reads against the snow from the RTS camera): at = board centre, the legs
    go down to at.y - size.h / 2 - 0.05 (the roof), braced back by `depth`."""
    x, y, z = at
    w, h = size
    yb = y - h / 2 - 0.05
    sign(m, p, (x, y, z), (w, h), lines, board=P.board, lights=lights, emblem=emblem)
    for sx in (-0.38, 0.38):
        xx = x + sx * w
        bar(p, P.frame, (xx, yb, z - 0.01), (xx, y + h / 2 - 0.02, z - 0.01), 0.022)
        bar(p, P.frame, (xx, yb, z - depth), (xx, y + h * 0.2, z - 0.012), 0.016)
        box(p, P.frame, (0.05, 0.02, depth + 0.03), (xx, yb + 0.01, z - depth / 2), bevel=0.003)
    bar(p, P.frame, (x - w * 0.45, y, z - 0.012), (x + w * 0.45, y, z - 0.012), 0.016)


# ---------------------------------------------------------------------------------------------------------
# decal images

_imgs = {}


# mullions() and glazing() now come from the kit (kit.decals.mullions / kit.shapes.glazing: same signatures).


def big_star(px=256, color=0xe8b434, ring=0x7a1410, field=0xa01812):
    """A gold star on a red disc with a dark red ring (crest for towers and gables)."""
    key = ('bstar', px, color, ring, field)
    if key in _imgs:
        return _imgs[key]
    cv = _D.Canvas(px, px)
    c = px / 2
    cv.circle(c, c, px * 0.49, _D.lin(ring))
    cv.circle(c, c, px * 0.43, _D.lin(field))
    pts = _D.star_points(c, c * 0.98, px * 0.36)
    tris = [((c, c * 0.98), pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
    cv.fill(cv.cover(tris), _D.lin(color), 1.0, 0.65)
    img = cv.image()
    _imgs[key] = img
    return img


def stripe(m, p, at, size, facing='+z', color=0xa01812, team_k=None, depth=0.02, emit=None):
    """Painted stripe / panel (free: a solid decal). team_k=1 paints it in the team colour."""
    c = 0xdadada if team_k else color
    return m.decal(solid(c), at=at, size=size, facing=facing, part=p, depth=depth, team=team_k if team_k else 0,
                   rough=0.6, emit=emit)


def panel_lines(m, p, at, size, facing='+z', depth=0.02):
    """A recessed panel outline with corner rivets (free)."""
    w, h = size
    return m.decal(panel_outline(aspect=w / h), at=at, size=size, facing=facing, part=p, depth=depth, color=True)


# ---------------------------------------------------------------------------------------------------------
# faction dressing (big and bold)

def red_banner(m, p, at, size, facing='+z', emblem='soviet', color=0xb31e17, rod=None):
    """Large hanging banner (bright red cloth, gold star, gold hem). at = top centre on the wall."""
    banner(m, p, at, size, facing=facing, emblem=emblem, color=color, rod=rod)


def slogan(m, p, at, size, lines, facing='+z', lights=3, emblem='soviet', board=None, frame=None, emit=None):
    """Big red slogan board with lamps (keep it >= 0.5 wide)."""
    sign(m, p, at, size, lines, facing=facing, board=board or Pal_board(), lights=lights, emblem=emblem, frame=frame, emit=emit)


def Pal_board():
    return painted(0x9e1a14, wear=0.5, rust=0.2, streaks=0.5, panels=None)


def crest(m, p, at, size, facing='+z', depth=0.03, emit=None):
    """Gold star on a red disc (decal)."""
    return m.decal(big_star(), at=at, size=(size, size), facing=facing, part=p, depth=depth, team=0, emit=emit)


# ---------------------------------------------------------------------------------------------------------
# building blocks

def foundation(m, p, P, w, d, apron=None, kerb=True):
    """Concrete slab (0..Y0) over the footprint, a chamfered kerb, an optional darker apron (x0, x1, z0, z1)."""
    box(p, P.conc, (w - 0.02, Y0, d - 0.02), (0, Y0 / 2, 0), bevel=0.018)
    if apron:
        x0, x1, z0, z1 = apron
        slab(p, P.tar, x0, x1, Y0, Y0 + 0.01, z0, z1)


def hall(p, P, x, z, w, d, h, wall=None, plinth=0.13, cornice=True, roof=True, parapet=0.04, roof_mat=None, y0=Y0):
    """Plinth + walls + team cornice + roof slab + parapet. Returns (top y, front z)."""
    wall = wall or P.wall
    box(p, P.conc, (w + 0.05, plinth, d + 0.05), (x, y0 + plinth / 2, z), bevel=0.014)
    box(p, wall, (w, h - plinth, d), (x, y0 + plinth + (h - plinth) / 2, z), bevel=0.012)
    top = y0 + h
    if cornice:
        box(p, P.trim, (w + 0.06, 0.075, d + 0.06), (x, top - 0.0375, z), bevel=0.01)
    if roof:
        box(p, roof_mat or P.roof, (w - 0.02, 0.02, d - 0.02), (x, top + 0.008, z))
    if parapet:
        t = 0.05
        x0, x1, z0, z1 = x - w / 2, x + w / 2, z - d / 2, z + d / 2
        for (a0, a1, b0, b1) in ((x0, x1, z1 - t / 2, z1 + t / 2), (x0, x1, z0 - t / 2, z0 + t / 2),
                                 (x0 - t / 2, x0 + t / 2, z0 + t / 2, z1 - t / 2), (x1 - t / 2, x1 + t / 2, z0 + t / 2, z1 - t / 2)):
            slab(p, P.frame, a0, a1, top, top + parapet, b0, b1, bevel=0.006)
    return top, z + d / 2


def pilasters(p, mat, xs, z, y0, y1, w=0.06, dz=0.045, facing='+z'):
    """Vertical pilasters / ribs on a +z (or +x) wall."""
    for x in xs:
        if facing == '+z':
            box(p, mat, (w, y1 - y0, dz), (x, (y0 + y1) / 2, z + dz / 2 - 0.004), bevel=0.008)
        else:
            box(p, mat, (dz, y1 - y0, w), (z + dz / 2 - 0.004, (y0 + y1) / 2, x), bevel=0.008)


def buttress(p, mat, at, h, depth=0.14, w=0.08, facing='+z'):
    """Sloped concrete / steel buttress against a wall (at = foot centre on the wall)."""
    x, y, z = at
    pts = [(0.0, 0.0), (depth, 0.0), (depth, h * 0.18), (0.0, h)]
    if facing == '+z':
        prism(p, mat, pts, w, (x, y, z), rot=(0, -math.pi / 2, 0))
    elif facing == '-z':
        prism(p, mat, pts, w, (x, y, z), rot=(0, math.pi / 2, 0))
    elif facing == '+x':
        prism(p, mat, pts, w, (x, y, z))
    else:
        prism(p, mat, pts, w, (x, y, z), rot=(0, math.pi, 0))


def drums(p, at, n=3, colors=(0x7a1d16, 0x3e4a2c, 0x7a1d16), r=0.04, h=0.11):
    x, y, z = at
    for i in range(n):
        a = i * 2.1
        c = colors[i % len(colors)]
        cyl(p, painted(c, wear=0.65, rust=0.55, panels=None), r, h, (x + math.cos(a) * r * 1.15 * (i > 0), y + h / 2, z + math.sin(a) * r * 1.15 * (i > 0)), seg=10, bevel=0.004)


def crates(p, P, at, s=0.09, n=3, rot=0.2):
    x, y, z = at
    mat = painted(0x5a5236, wear=0.55, rust=0.2, panels=None)
    pos = [(0, 0, 0), (s * 1.05, 0, s * 0.1), (s * 0.5, s, 0.02)][:n]
    for (dx, dy, dz) in pos:
        box(p, mat, (s, s, s), (x + dx * math.cos(rot), y + dy + s / 2, z + dz - dx * math.sin(rot)), (0, rot, 0), bevel=0.006)


def sandbags(p, P, a, b, rows=2, h=0.045, w=0.08):
    """A sandbag wall from a to b (ground points)."""
    from mathutils import Vector
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    yaw = -math.atan2(d.z, d.x)
    n = max(1, int(L / 0.1))
    for r_ in range(rows):
        off = 0.5 * (r_ % 2)
        for i in range(n - (r_ % 2)):
            t = (i + 0.5 + off) / n
            c = a + d * t
            box(p, P.sand, (L / n * 0.96, h, w - r_ * 0.01), (c.x, a.y + h * (r_ + 0.5), c.z), (0, yaw, 0), bevel=0.012)


def lamp_post(p, P, at, h=0.42, yaw=0.0, color=0xffe0b0):
    """Street lamp: pole + arm + a warm lamp head (steady)."""
    x, y, z = at
    bar(p, P.rail, (x, y, z), (x, y + h, z), 0.018)
    ax, az = math.cos(yaw) * 0.08, -math.sin(yaw) * 0.08
    bar(p, P.rail, (x, y + h, z), (x + ax, y + h, z + az), 0.014)
    box(p, P.dark, (0.07, 0.022, 0.045), (x + ax, y + h - 0.006, z + az), (0, yaw, 0))
    box(p, light_mat(color, 2.6, 'steady'), (0.05, 0.006, 0.03), (x + ax, y + h - 0.02, z + az), (0, yaw, 0))


def stack(m, p, P, at, h, r, name=None, r_top=None, bands=None, lights=4, ladder_side=None, base=True, seg=18):
    """Soviet smokestack: sooty dark steel, red bands, red crown lights + glow ring, smoke point `name`."""
    x, y, z = at
    rt = r * 0.8 if r_top is None else r_top
    top_y = y + h
    shell = painted(0x3f4347, panels=(0.3, 0.12), wear=0.55, rust=0.4, streaks=1.0, soot=(top_y - h * 0.35, top_y - 0.02))
    if base:
        cyl(p, P.conc_dk, r + 0.05, 0.08, (x, y + 0.04, z), r2=r + 0.02, seg=seg, bevel=0.01)
    chimney(m, p, (x, y, z), h, r, rt, mat=shell, band_mat=P.band, cap=P.dark, smoke=name,
            bands=bands or [(0.5, 0.07), (0.66, 0.07), (0.82, 0.07)], lights=lights, ladder_side=ladder_side, seg=seg,
            light_r=0.02)


def arch(p, mat, r, depth, at, rise=None, seg=10, r_in=None, axis='z'):
    """Barrel vault / arched rib: a half-ellipse outline (half-width r, height `rise`) extruded along `axis`
    ('z' or 'x') by depth; at = centre of the springing line. r_in makes it an arched rib (annulus)."""
    rise = r if rise is None else rise
    k = rise / r
    outer = [(math.cos(math.pi * i / seg) * r, math.sin(math.pi * i / seg) * r * k) for i in range(seg + 1)]
    if r_in:
        inner = [(math.cos(math.pi * i / seg) * r_in, math.sin(math.pi * i / seg) * r_in * k) for i in range(seg, -1, -1)]
        pts = outer + inner
    else:
        pts = outer
    rot = None if axis == 'z' else (0, math.pi / 2, 0)
    return prism(p, mat, pts, depth, at, rot=rot)


def v3(t):
    """mathutils Vector from a tuple (for matrix math in model scripts)."""
    return _v(t)


def neon(p, x0, x1, top, fz, color=0xff2a1a, strength=2.2, h=0.014, mode='steady'):
    """Red accent light strip along a +z facade, just low enough under the cornice (top) to show from the
    RTS camera (the reference's red-lit roof edges)."""
    y = top - 0.075 - 0.04
    box(p, light_mat(color, strength, mode), (x1 - x0, h, 0.008), ((x0 + x1) / 2, y, fz + 0.006))
    box(p, _Mt.metal(0x26282c), (x1 - x0 + 0.01, h + 0.008, 0.006), ((x0 + x1) / 2, y, fz + 0.002))


# ---------------------------------------------------------------------------------------------------------
# top-facing dressing that survives the winter (the runtime settles snow on every non-emissive surface whose
# normal.y > ~0.55, i.e. flatter than ~57 degrees). From the ~40 degree RTS camera a surface sloped ~60 degrees
# toward +z is seen almost face-on and stays snow-free; lightly emissive paint stays clear of snow too.

def tilt_sign(m, p, P, at, size, lines, tilt=0.5, lights=3, emblem='soviet', emit=0.5, legs=True, board=None,
              text_color=0xf2eee4, depth=None):
    """Rooftop billboard leaning back by `tilt` radians (top toward -z) so it faces the RTS camera: at = board
    centre, legs down to the roof at at.y - h/2*cos(tilt) - 0.05. Lit letters (emit) read by day and night."""
    x, y, z = at
    w, h = size
    board = board or P.board
    rot = (-tilt, 0.0, 0.0)
    from kit.core import T
    F = T(at, rot)

    def W(px, py, pz):
        return tuple(F @ v3((px, py, pz)))
    box(p, board, (w, h, 0.016), at, rot, bevel=0.003)
    for (yy, hh) in ((h / 2, 0.016), (-h / 2, 0.016)):
        box(p, P.frame, (w + 0.016, hh, 0.024), W(0, yy, 0.002), rot)
    tw = w * (0.74 if emblem else 0.94)
    tx = -w * 0.11 if emblem else 0.0
    hp = h * math.cos(tilt)  # projected height on the z-facing decal plane
    dd = depth or (h * math.sin(tilt) * 0.5 + 0.03)
    nl = len(lines.split('|')) if isinstance(lines, str) else len(lines)
    img = text(lines, px_h=192, aspect=tw / (hp * 0.86), color=text_color, scales=[1.45, 1.0] if nl == 2 else None)
    m.decal(img, at=W(tx, 0, 0.009), size=(tw, hp * 0.86), facing='+z', part=p, depth=dd, team=0, emit=emit)
    if emblem:
        es = min(hp * 0.86, w * 0.24)
        m.decal(_D.soviet_star(), at=W(w / 2 - w * 0.13, 0, 0.009), size=(es, es), facing='+z', part=p, depth=dd, team=0,
                emit=emit * 0.6)
    for i in range(lights):
        lx = -w / 2 + w * (i + 0.5) / lights
        bar(p, P.frame, W(lx, h / 2, 0.0), W(lx, h / 2 + 0.03, 0.05), 0.006)
        box(p, light_mat(0xffd9a0, 2.2, 'steady'), (0.05, 0.008, 0.02), W(lx, h / 2 + 0.032, 0.055), rot)
    if legs:
        yb = y - h / 2 * math.cos(tilt) - 0.05
        for sx in (-0.4, 0.4):
            xx = x + sx * w
            top = W(sx * w, h * 0.3, -0.008)
            bar(p, P.frame, (xx, yb, top[2]), top, 0.022)
            bot = W(sx * w, -h / 2, -0.008)
            bar(p, P.frame, (xx, yb, bot[2]), bot, 0.018)
            box(p, P.frame, (0.05, 0.02, abs(top[2] - bot[2]) + 0.06), (xx, yb + 0.01, (top[2] + bot[2]) / 2), bevel=0.003)


def slope_panel(p, mat, at, w, length, slope=1.05, t=0.02):
    """A plate sloping down toward +z at `slope` radians from horizontal (60 deg default): at = centre."""
    box(p, mat, (w, t, length), at, (slope, 0.0, 0.0), bevel=0.004)


def top_star(m, p, at, size, facing='+y', emit=0.35, depth=0.03, ring=True):
    """Gold star (on a red disc when ring) painted on an up-facing surface, lightly emissive so the runtime snow
    leaves it clear and it glows faintly at night."""
    img = big_star() if ring else _D.soviet_star()
    return m.decal(img, at=at, size=(size, size), facing=facing, part=p, depth=depth, team=0, emit=emit)


def roof_paint(m, p, at, size, color=0xa31c15, emit=0.32, facing='+y', depth=0.02, team_k=None):
    """A painted band / panel on a roof that stays visible through the snow (faintly emissive paint)."""
    c = 0xdadada if team_k else color
    return m.decal(solid(c), at=at, size=size, facing=facing, part=p, depth=depth, team=team_k if team_k else 0, rough=0.6,
                   emit=emit)
