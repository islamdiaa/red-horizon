"""Shared helpers for the ground-vehicle HD models (tools/assets/models/vehicles/*.py).

Not a model: build.mjs skips files starting with '_'. Model scripts load it with

    import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _vk import *

Art rules for vehicles (they are ~60 px wide at the default RTS zoom, so only bold things register):
  * value structure: near-black tracks / tyres, dark running gear and lower hull, mid hull, lighter tops;
  * big geometric chamfers on hulls and turrets (bevel 0.012-0.02): the bake wears them to bare steel and the
    kit adds a catch-light, which gives the bright edge highlights;
  * team colour on large, clean panels (skirts, cheek plates, bins); white roundels / gold stars big enough;
  * emissive head- and marker lights (baked light lenses, animated by mode in the game);
  * chunky stowage (bins, jerry cans, bedrolls, tarps) slightly oversized.
Coordinates are the game's (units face +X, +Z = right side / towards the camera, y up).
"""
import math

from mathutils import Vector

from kit import *  # noqa: F401,F403
from kit import decals as D
from kit import materials as Mt
from kit.core import T

PI = math.pi
ROT_Z = (PI / 2, 0, 0)       # cylinder axis (local Y) -> game Z (wheels, rollers)
ROT_X = (0, 0, -PI / 2)      # cylinder axis -> game +X (barrels, exhausts, drums lying along X)


# ---------------------------------------------------------------------------------------------------------
# palettes

class Pal:
    """Faction paint set. Allied: team-painted hull, dark steel running gear. Soviet: olive drab with team trims."""

    def __init__(self, fac, wear=0.8):
        self.fac = fac
        if fac == 'allies':
            self.hull = team(wear=wear, grime=0.35, rust=0.06, panels=(0.12, 0.09), rough=0.48)
            self.top = self.hull
            self.hull_flat = team(wear=wear, grime=0.35, rust=0.06, panels=None, rough=0.48)
            self.dark = painted(0x30343a, panels=None, wear=0.7, rust=0.18, grime=0.45, streaks=0.25, rough=0.56, metal=0.35, var=0.1)
            self.dark2 = painted(0x3d4249, panels=None, wear=0.7, rust=0.12, grime=0.4, rough=0.54, metal=0.35, var=0.1)
            self.trim = team(wear=wear, grime=0.3, rust=0.05, panels=None, rough=0.45)
            self.accent = painted(0xd8d4c8, panels=None, wear=0.5, rust=0.05, grime=0.3, rough=0.5, var=0.06)  # off-white
        else:
            self.hull = painted(0x76824c, panels=(0.14, 0.1), wear=wear, rust=0.14, grime=0.36, streaks=0.35, rough=0.6, metal=0.2, var=0.14)
            self.top = painted(0xa9b67a, panels=(0.14, 0.1), wear=wear, rust=0.08, grime=0.22, streaks=0.2, rough=0.56, metal=0.18, var=0.1)
            self.hull_flat = painted(0x76824c, panels=None, wear=wear, rust=0.14, grime=0.36, streaks=0.35, rough=0.6, metal=0.2, var=0.14)
            self.dark = painted(0x3e4430, panels=None, wear=0.7, rust=0.22, grime=0.48, streaks=0.3, rough=0.62, metal=0.25, var=0.12)
            self.dark2 = painted(0x4b5235, panels=None, wear=0.72, rust=0.18, grime=0.45, streaks=0.3, rough=0.62, metal=0.22, var=0.12)
            self.trim = team(wear=wear * 0.8, grime=0.3, rust=0.06, panels=(0.12, 0.08), rough=0.5)
            self.accent = painted(0xa89c74, panels=None, wear=0.5, rust=0.1, grime=0.4, rough=0.6, var=0.1)  # tan
        self.trim_flat = team(wear=wear * 0.8, grime=0.3, rust=0.06, panels=None, rough=0.5)
        self.gun = metal(0x3a3e44, rough=0.4, rust=0.22, wear=0.55)
        self.black = metal(0x1e1f22, rough=0.6, rust=0.25, wear=0.3, metal=0.6)
        self.steel = metal(0x8e949a, rough=0.35, rust=0.1, wear=0.3)
        self.rubber = rubber(0x19191b)
        self.wheel = painted(0x2e3236 if fac == 'allies' else 0x353a2a, panels=None, wear=0.75, rust=0.08, grime=0.5, rough=0.6, var=0.08)
        self.hub = metal(0x9aa0a6, rough=0.35, rust=0.15, wear=0.3)
        self.canvas = cloth(0x6b6844, grime=0.45)
        self.tan = cloth(0x9a8a62, grime=0.45)
        self.jerry = painted(0x4c5636, panels=None, wear=0.7, rust=0.3, grime=0.4, rough=0.55, var=0.1)
        self.jerry_red = painted(0x8a2a1e, panels=None, wear=0.7, rust=0.3, grime=0.4, rough=0.55, var=0.1)
        self.wood = painted(0x5e4630, panels=None, wear=0.15, rust=0.0, metal=0.0, rough=0.85, var=0.2)
        self.exhaust = painted(0x35302c, panels=None, wear=0.35, rust=0.7, grime=0.3, rough=0.75, soot=(0.12, 0.3))
        self.glass = glass(0x22303c)
        self.yellow = painted(0xd8a418, panels=None, wear=0.6, rust=0.15, grime=0.35, rough=0.5, var=0.08)


# ---------------------------------------------------------------------------------------------------------
# solids

def side_prism(p, mat, pts, width, z=0.0, bevel=0.0, at_x=0.0):
    """Side-profile [(x, y), ...] extruded across Z (hulls, cabs), centred on z."""
    return prism(p, mat, pts, width, (at_x, 0, z), bevel=bevel)


def octo(x0, x1, z, cx=0.0, cf=0.0, cr=0.0):
    """Top-view outline (x, z) of a box from x0 (rear) to x1 (front), half-width z, front corners cut by cf,
    rear corners cut by cr (counter-clockwise seen from above)."""
    return [(x1, -z + cf), (x1, z - cf), (x1 - cf, z), (x0 + cr, z), (x0, z - cr), (x0, -z + cr), (x0 + cr, -z), (x1 - cf, -z)]


def scale_ring(pts, k, kx=None, dx=0.0):
    kx = k if kx is None else kx
    return [(x * kx + dx, z * k) for (x, z) in pts]


def slope_plate(p, mat, a, b, width, z=0.0, t=0.012, inset=0.92, bevel=0.003):
    """Plate lying on the side-profile segment a -> b (x, y), `width` across Z, on its outer side."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    nx, ny = -dy / L, dx / L
    if ny < 0 or (abs(ny) < 1e-6 and nx < 0):
        nx, ny = -nx, -ny
    ang = math.atan2(dy, dx)
    box(p, mat, (L * inset, t, width), ((a[0] + b[0]) / 2 + nx * t / 2, (a[1] + b[1]) / 2 + ny * t / 2, z), (0, 0, ang), bevel=bevel)


# ---------------------------------------------------------------------------------------------------------
# running gear

def tyre_band(p, r, w, at, seg=12, link=0.05):
    """Scrolling tyre tread (the game's track material, belt UVs) around an axle along Z at `at`."""
    mat = Mt.track_material()
    bm, _ = p.target(mat)
    uvl = bm.loops.layers.uv.get('belt') or bm.loops.layers.uv.new('belt')
    x, y, z = at
    reps = max(4, round(2 * PI * r / link))
    r0, r1 = [], []
    for i in range(seg):
        a = 2 * PI * i / seg
        r0.append(bm.verts.new((x + math.cos(a) * r, y + math.sin(a) * r, z - w / 2)))
        r1.append(bm.verts.new((x + math.cos(a) * r, y + math.sin(a) * r, z + w / 2)))
    for i in range(seg):
        j = (i + 1) % seg
        f = bm.faces.new((r0[i], r0[j], r1[j], r1[i]))  # outward
        u0, u1 = reps * i / seg, reps * (i + 1) / seg
        for lp, uv in zip(f.loops, ((u0, 0.0), (u1, 0.0), (u1, 1.0), (u0, 1.0))):
            lp[uvl].uv = uv


def wheel(p, pal, r, w, at, side, rim=None, hub=None, seg=12):
    """Road wheel of a wheeled vehicle: scrolling tread band, black sidewall, painted rim, bright hub."""
    x, y, z = at
    tyre_band(p, r, w, at, seg)
    cyl(p, pal.rubber, r * 0.985, w * 0.94, at, ROT_Z, seg=seg)
    cyl(p, rim or pal.dark2, r * 0.6, 0.012, (x, y, z + side * (w / 2 + 0.003)), ROT_Z, seg=10, bevel=0.003)
    cyl(p, hub or pal.hub, r * 0.24, 0.012, (x, y, z + side * (w / 2 + 0.01)), ROT_Z, seg=6)


def running_gear(m, p, pal, L, H, W, Z, n, x0=0.0, wheel_k=0.4, rollers=2, sides=(-1, 1), wheels=True, link=0.05):
    """Track belts (scrolling tread) + road wheels, drive sprocket (front), idler (rear) and return rollers.
    Wheels sit on the outer half of the belt so they read from the RTS camera."""
    wr = H * wheel_k
    span = L - H * 1.2
    for s in sides:
        z = Z * s
        track_belt(p, L, H, W, (x0, 0.0, z), link=link)
        if not wheels:
            continue
        face = z + s * W * 0.3
        wy = wr + 0.02
        for i in range(n):
            x = x0 - span / 2 + span * i / max(1, n - 1)
            cyl(p, pal.rubber, wr, 0.032, (x, wy, face), ROT_Z, seg=10)
            cyl(p, pal.wheel, wr * 0.8, 0.04, (x, wy, face + s * 0.002), ROT_Z, seg=8)
            cyl(p, pal.hub, wr * 0.3, 0.046, (x, wy, face + s * 0.004), ROT_Z, seg=6)
        sx, ix = x0 + (L / 2 - H / 2), x0 - (L / 2 - H / 2)
        for (xx, rad) in ((sx, H * 0.43), (ix, H * 0.38)):
            cyl(p, pal.gun, rad, 0.05, (xx, H / 2, face), ROT_Z, seg=12)
            cyl(p, pal.hub, rad * 0.35, 0.058, (xx, H / 2, face), ROT_Z, seg=6)
        for k in range(rollers):
            xx = x0 + span * (k + 0.5) / rollers - span / 2
            cyl(p, pal.black, H * 0.12, 0.03, (xx, H - 0.018, face - s * 0.02), ROT_Z, seg=8)


def fender(p, mat, L, W, y, z, x=0.0, front=0.07, rear=0.05, t=0.012, down=0.04):
    """Track guard: flat run plus sloped front / rear lips."""
    box(p, mat, (L, t, W), (x, y, z), bevel=0.003)
    box(p, mat, (front, t, W), (x + L / 2 + front * 0.42, y - down * 0.5, z), (0, 0, -0.55), bevel=0.003)
    box(p, mat, (rear, t, W), (x - L / 2 - rear * 0.42, y - down * 0.4, z), (0, 0, 0.55), bevel=0.003)


def skirt(p, mat, L, h, y_top, z, x=0.0, t=0.014, panels=4, gap_mat=None, bevel=0.004):
    """Armoured side skirt hanging from y_top: `panels` plates with small gaps (one material)."""
    pw = L / panels
    for i in range(panels):
        cx = x - L / 2 + pw * (i + 0.5)
        box(p, mat, (pw - 0.006, h, t), (cx, y_top - h / 2, z), bevel=bevel)


# ---------------------------------------------------------------------------------------------------------
# lights

HEAD = 0xfff0c8
RED = 0xff2414
AMBER = 0xffa020


def _axis_rot(facing):
    """Rotation turning local +Y to the facing direction."""
    return {'+x': (0, 0, -PI / 2), '-x': (0, 0, PI / 2), '+z': (PI / 2, 0, 0), '-z': (-PI / 2, 0, 0), '+y': None, '-y': (PI, 0, 0)}[facing]


def lamp(p, at, r, color, mode='steady', strength=2.8, facing='+x', housing=None):
    """Cheap lamp (~60 tris): dark cup housing + domed emissive lens, pointing along `facing`."""
    rot = _axis_rot(facing)
    M = T(at, rot)
    hz = M.to_3x3() @ Vector((0, 1, 0))
    c = Vector(at)
    cyl(p, housing or Mt.metal(0x26282c, rough=0.5, rust=0.2), r * 1.3, r * 0.8, tuple(c + hz * (r * 0.1)), rot, seg=8)
    lathe(p, Mt.light(color, strength, mode), [(r, 0.0), (r * 0.78, r * 0.42), (0.0, r * 0.62)], tuple(c + hz * (r * 0.5)), seg=8, rot=rot)


def headlight(p, at, r=0.018, facing='+x', strength=4.0, guard=None):
    """Headlamp: dark housing + bright steady lens (emissive in the game, dims when wrecked). Drawn 20% larger
    than asked: lamps must register at the default zoom."""
    r = r * 1.2
    lamp(p, at, r, HEAD, 'steady', strength, facing)
    if guard is not None:
        x, y, z = at
        bar(p, guard, (x + r * 1.2, y + r * 1.6, z - r * 1.3), (x + r * 1.2, y + r * 1.6, z + r * 1.3), 0.004)


def marker(p, at, r=0.011, color=RED, facing='-x', mode='steady', strength=3.2):
    lamp(p, at, r, color, mode, strength, facing)


def tail_lights(p, x, y, z, r=0.011):
    for s in (-1, 1):
        marker(p, (x, y, z * s), r, RED, '-x')


# ---------------------------------------------------------------------------------------------------------
# stowage and fittings

def crate(p, mat, size, at, rot=None, strap=None, bevel=0.006):
    box(p, mat, size, at, rot, bevel=bevel)
    if strap is not None:
        w, h, d = size
        x, y, z = at
        box(p, strap, (0.008, h + 0.004, d + 0.004), (x, y, z), rot)


def jerry(p, mat, at, yaw=0.0, h=0.07):
    """Jerry can standing upright, flat side along X (yaw rotates it)."""
    x, y, z = at
    box(p, mat, (0.052, h, 0.026), (x, y + h / 2, z), (0, yaw, 0), bevel=0.005)
    c, s = math.cos(yaw), math.sin(yaw)
    bar(p, mat, (x - c * 0.012, y + h + 0.006, z + s * 0.012), (x + c * 0.012, y + h + 0.006, z - s * 0.012), 0.008)


def jerry_rack(p, pal, n, x, y, z, yaw=0.0, mat=None, pitch=0.032):
    c, s = math.cos(yaw), math.sin(yaw)
    for i in range(n):
        o = (i - (n - 1) / 2) * pitch
        jerry(p, mat or pal.jerry, (x + s * o, y, z + c * o), yaw)


def bedroll(p, pal, length, r, at, axis='z', mat=None):
    """Rolled tarp / bedroll with two straps. axis: 'z' (across the vehicle) or 'x'."""
    rot = ROT_Z if axis == 'z' else ROT_X
    x, y, z = at
    cyl(p, mat or pal.canvas, r, length, at, rot, seg=10)
    for k in (-0.3, 0.3):
        o = k * length
        pos = (x, y, z + o) if axis == 'z' else (x + o, y, z)
        cyl(p, pal.black, r * 1.08, 0.008, pos, rot, seg=10)


def drum(p, mat, r, length, at, axis='x', bands=None):
    rot = ROT_X if axis == 'x' else ROT_Z if axis == 'z' else None
    cyl(p, mat, r, length, at, rot, seg=12, bevel=0.003)


def hatch_round(p, mat, r, at, ring=None, open_lid=False):
    x, y, z = at
    cyl(p, ring or mat, r * 1.15, 0.014, (x, y + 0.007, z), seg=12, bevel=0.003)
    cyl(p, mat, r, 0.012, (x, y + 0.018, z), seg=12, bevel=0.003)


def periscope(p, mat, glass_mat, at, yaw=0.0):
    x, y, z = at
    box(p, mat, (0.022, 0.02, 0.03), (x, y + 0.01, z), (0, yaw, 0), bevel=0.003)
    box(p, glass_mat, (0.004, 0.01, 0.024), (x + 0.011 * math.cos(yaw), y + 0.012, z - 0.011 * math.sin(yaw)), (0, yaw, 0))


def whip(p, pal, at, h, pennant=False, mat=None):
    x, y, z = at
    cyl(p, pal.black, 0.012, 0.016, (x, y + 0.008, z), seg=6)
    cyl(p, mat or pal.black, 0.0055, h, (x, y + h / 2, z), r2=0.0028, seg=5)
    if pennant:
        box(p, cloth(team=True), (0.058, 0.034, 0.004), (x + 0.031, y + h - 0.022, z))


def pintle_mg(p, pal, at, length=0.12, yaw=0.0, shield=None):
    x, y, z = at
    c, s = math.cos(yaw), math.sin(yaw)
    cyl(p, pal.gun, 0.007, 0.05, (x, y + 0.025, z), seg=6)
    box(p, pal.gun, (0.05, 0.018, 0.016), (x + c * 0.01, y + 0.058, z - s * 0.01), (0, yaw, 0), bevel=0.003)
    cyl_between(p, pal.black, (x + c * 0.03, y + 0.06, z - s * 0.03), (x + c * length, y + 0.06, z - s * length), 0.0055, 6)
    box(p, pal.jerry, (0.024, 0.016, 0.02), (x - c * 0.004, y + 0.045, z - s * 0.004 + 0.018), (0, yaw, 0))
    if shield is not None:
        box(p, shield, (0.008, 0.045, 0.07), (x + c * 0.045, y + 0.065, z - s * 0.045), (0, yaw, 0), bevel=0.002)


def smoke_dischargers(p, pal, at, side, n=3, yaw=0.0):
    x, y, z = at
    for i in range(n):
        cyl(p, pal.black, 0.0085, 0.04, (x - i * 0.022, y, z), (side * 0.7, 0, 0.4), seg=6)


def tow_hooks(p, pal, x, y, z, dirn):
    for s in (-1, 1):
        box(p, pal.black, (0.026, 0.022, 0.026), (x, y, z * s), bevel=0.004)


def exhaust_pipe(p, pal, a, b, r=0.016):
    cyl_between(p, pal.exhaust, a, b, r, 8)
    cyl_between(p, pal.black, b, (b[0] + (b[0] - a[0]) * 0.06, b[1] + (b[1] - a[1]) * 0.06, b[2] + (b[2] - a[2]) * 0.06), r * 0.7, 8)


def gun_barrel(p, pal, length, r, at=(0, 0, 0), brake='t', sleeve=None, taper=0.88, seg=10):
    """Gun along +X from `at` with a thermal sleeve band, bore evacuator and muzzle brake ('t', 'ring' or None)."""
    x, y, z = at
    cyl(p, pal.gun, r, length, (x + length / 2, y, z), ROT_X, r2=r * taper, seg=seg)
    if sleeve:
        sx, sl = sleeve
        cyl(p, pal.gun, r * 1.5, sl, (x + sx, y, z), ROT_X, seg=seg, bevel=0.002)
    re = r * taper
    if brake == 't':
        box(p, pal.black, (length * 0.09, re * 2.2, re * 3.4), (x + length * 0.96, y, z), bevel=0.003)
    elif brake == 'ring':
        cyl(p, pal.black, re * 1.4, length * 0.08, (x + length * 0.96, y, z), ROT_X, seg=seg, bevel=0.002)
    cyl(p, Mt.flat(0x050505, 0.95), re * 0.62, 0.003, (x + length + 0.001 + (length * 0.005 if brake else 0), y, z), ROT_X, seg=8)


# ---------------------------------------------------------------------------------------------------------
# decals

def camo_image(seed=1, n=9, px=256, aspect=1.6, colors=(0x23262b,), alpha=1.0):
    """Blotchy disruptive camouflage (dark shapes on transparent): projected over team paint."""
    import random
    rng = random.Random(seed)
    w, h = int(px * aspect), px
    cv = D.Canvas(w, h, ss=2)
    for i in range(n):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        rr = rng.uniform(0.12, 0.22) * h
        k = rng.randint(7, 10)
        pts = []
        for j in range(k):
            a = 2 * PI * j / k
            q = rr * rng.uniform(0.6, 1.25)
            pts.append((cx + math.cos(a) * q * 1.4, cy + math.sin(a) * q))
        col = colors[i % len(colors)]
        cv.poly([(cx, cy)] + pts + [pts[0]], D.lin(col), alpha)
    cv.roughen(0.25, seed=seed)
    return cv.image()


def camo(m, p, at, size, facing, seed=1, n=8, colors=(0x5a5a5a,), depth=0.03, team_shade=True):
    """Disruptive camouflage blotches. team_shade=True paints them as a DARK SHADE OF THE TEAM COLOUR (grey
    decal colour x team mask), so the hull keeps its team hue at the RTS zoom; False = neutral dark paint."""
    w, h = size
    img = camo_image(seed, n, aspect=w / h, colors=colors if team_shade else (0x23262b,))
    return m.decal(img, at=at, size=(w, h), facing=facing, part=p, depth=depth, team=1 if team_shade else 0, rough=0.62)


def stripe(m, p, at, size, facing, color, team=0, depth=0.02, rough=None):
    """Painted band (solid colour decal). team=1 with a grey colour paints a lighter / darker team shade."""
    return m.decal(D.solid(color), at=at, size=size, facing=facing, part=p, depth=depth, team=team, rough=rough)


def number(m, p, text, at, height, facing, color=0xe8e4da):
    return stencil(m, p, text, at, height, facing=facing, color=color)


EDGE_HL = 0xaeb2b6  # worn bright steel


def edge_strip(m, p, a, b, facing='+y', width=0.014, color=EDGE_HL, depth=0.02):
    """Painted highlight strip along an edge (decal, no triangles): the bright worn edges that make hulls and
    turrets read at the default zoom. `facing` = the surface it is painted on ('+y' for deck / turret-top edges)."""
    from kit.core import euler3, facing_rot
    a, b = Vector(a), Vector(b)
    d = b - a
    F = euler3(facing_rot(facing))
    lx = F.inverted() @ d
    roll = math.atan2(lx.y, lx.x)
    return m.decal(D.solid(color), at=tuple((a + b) / 2), size=(d.length + width * 0.5, width), facing=facing, part=p,
                   depth=depth, roll=roll, team=0, rough=0.38, metal=0.6)


def outline_strips(m, p, pts, y, facing='+y', width=0.014, inset=0.004, closed=True, skip=()):
    """Highlight strips along a top-view outline [(x, z), ...] at height y (turret roofs, decks)."""
    n = len(pts)
    cx = sum(x for x, _ in pts) / n
    cz = sum(z for _, z in pts) / n
    q = []
    for (x, z) in pts:
        dx, dz = x - cx, z - cz
        L = math.hypot(dx, dz) or 1.0
        q.append((x - dx / L * inset, z - dz / L * inset))
    for i in range(n if closed else n - 1):
        if i in skip:
            continue
        (x0, z0), (x1, z1) = q[i], q[(i + 1) % n]
        edge_strip(m, p, (x0, y, z0), (x1, y, z1), facing, width)


def deck_strips(m, p, x0, x1, y, half_w, front=True, rear=True, inset=0.007, width=0.014, zc=0.0):
    """Highlight strips around a rectangular deck top (x0 rear .. x1 front, |z - zc| <= half_w) at height y."""
    zi = half_w - inset
    for s in (-1, 1):
        edge_strip(m, p, (x0 + inset, y, zc + zi * s), (x1 - inset, y, zc + zi * s), '+y', width)
    if front:
        edge_strip(m, p, (x1 - inset, y, zc - zi), (x1 - inset, y, zc + zi), '+y', width)
    if rear:
        edge_strip(m, p, (x0 + inset, y, zc - zi), (x0 + inset, y, zc + zi), '+y', width)


def fender_strips(m, p, L, z_outer, y_top, x=0.0, width=0.012):
    for s in (-1, 1):
        edge_strip(m, p, (x - L / 2 + 0.01, y_top, (z_outer - 0.005) * s), (x + L / 2 - 0.01, y_top, (z_outer - 0.005) * s), '+y', width)


# ---------------------------------------------------------------------------------------------------------
# camera-first dressing (the RTS camera looks down ~40 degrees: tops dominate at the default zoom)

TEAM_NEUTRAL = 0xdbdbdb   # decal colour that equals clean team paint (linear 0.7 = kit TEAM_GREY)
TEAM_DARK = 0xa4a4a4      # ~0.55 x team colour: darker team shade (Allied decks / hull sides)
TEAM_DARKER = 0x8a8a8a    # ~0.37 x team colour


def team_shade(m, p, at, size, facing='+y', shade=TEAM_DARK, depth=0.03, roll=0.0):
    """Repaint an area in a darker / lighter shade of the team colour (decal: grey colour x team mask)."""
    return m.decal(D.solid(shade), at=at, size=size, facing=facing, part=p, depth=depth, roll=roll, team=1, rough=0.5)


def disc_image(px=128, ring=None, ring_w=0.12):
    cv = D.Canvas(px, px, ss=2)
    c = px / 2
    cv.circle(c, c, px * 0.48, D.lin(0xffffff))
    if ring is not None:
        cv.circle(c, c, px * 0.48, D.lin(ring), r_in=px * (0.48 - ring_w))
    return cv.image()


def team_disc(m, p, at, d, facing='+y', shade=TEAM_NEUTRAL, depth=0.03):
    """A team-coloured disc (behind a star: the turret-top recognition mark)."""
    return m.decal(disc_image(), at=at, size=(d, d), facing=facing, part=p, depth=depth, team=1, tint=D.lin(shade), rough=0.5)


def top_star(m, p, fac, at, d, facing='+y', depth=0.03):
    """Recognition mark on a top surface. Soviet: gold star on a team disc; Allied: white star roundel."""
    if fac == 'soviet':
        team_disc(m, p, at, d, facing, depth=depth)
        emblem(m, p, 'soviet', at, d * 0.9, facing=facing, depth=depth)
    else:
        emblem(m, p, 'allied_star', at, d, facing=facing, depth=depth)


def team_ring(m, p, pts, y, width=0.026, inset=0.016):
    """Team-colour band just inside a top-view outline (turret-roof rim seen from above)."""
    n = len(pts)
    cx = sum(x for x, _ in pts) / n
    cz = sum(z for _, z in pts) / n
    q = []
    for (x, z) in pts:
        dx, dz = x - cx, z - cz
        L = math.hypot(dx, dz) or 1.0
        q.append((x - dx / L * inset, z - dz / L * inset))
    from kit.core import euler3, facing_rot
    F = euler3(facing_rot('+y'))
    for i in range(n):
        (x0, z0), (x1, z1) = q[i], q[(i + 1) % n]
        a, b = Vector((x0, y, z0)), Vector((x1, y, z1))
        d = b - a
        lx = F.inverted() @ d
        m.decal(D.solid(TEAM_NEUTRAL), at=tuple((a + b) / 2), size=(d.length + width * 0.8, width), facing='+y', part=p,
                depth=0.025, roll=math.atan2(lx.y, lx.x), team=1, rough=0.5)


def top_lamps(p, x_front, x_rear, y, z, front=AMBER, rear=RED, r=0.011):
    """Small up-facing marker lamps at the deck corners: they read from the RTS camera (side lamps don't)."""
    for s in (-1, 1):
        if front is not None:
            lamp(p, (x_front, y, z * s), r, front, 'steady', 3.2, '+y')
        if rear is not None:
            lamp(p, (x_rear, y, z * s), r, rear, 'steady', 3.2, '+y')


def hull_shade(m, p, x0, x1, deck_y, half_w, side_y=None, fenders=None, shade=TEAM_DARK, deck_depth=0.012, deck=True):
    """Darker team shade on a hull: the deck top (x0..x1, |z| <= half_w at deck_y; a thin box so stowage on top
    keeps its own paint), optionally the sides (side_y = (y0, y1)) and fender tops (fenders = (L, y_top, Z, W, x))."""
    if deck:
        team_shade(m, p, ((x0 + x1) / 2, deck_y, 0.0), (x1 - x0, half_w * 2), '+y', shade, depth=deck_depth)
    for s in (-1, 1):
        f = '+z' if s > 0 else '-z'
        if side_y is not None:
            y0, y1 = side_y
            team_shade(m, p, ((x0 + x1) / 2, (y0 + y1) / 2, half_w * s), (x1 - x0 + 0.06, y1 - y0), f, shade, depth=0.018)
        if fenders is not None:
            L, yt, Z, W, x = fenders
            team_shade(m, p, (x, yt, Z * s), (L + 0.1, W), '+y', shade, depth=0.007)


# ---------------------------------------------------------------------------------------------------------
# Soviet camera-first dress (coordinator-approved STYLE exception: team red on up to ~35% of the hull top)

OLIVE_DECK = 0x9ca86c   # light olive on decks / roofs (separates from snow AND dark ground)
OLIVE_SIDE = 0x56603a   # darker olive on hull sides
GOLD = 0xe8b434


def paint(m, p, at, size, facing, color, depth=0.012, roll=0.0, rough=None):
    """Plain colour paint (decal, team mask cleared): deck / side repaint."""
    return m.decal(D.solid(color), at=at, size=size, facing=facing, part=p, depth=depth, roll=roll, team=0, rough=rough)


def red(m, p, at, size, facing='+y', depth=0.012, roll=0.0):
    """Team-red paint (bands, panels)."""
    return team_shade(m, p, at, size, facing, TEAM_NEUTRAL, depth=depth, roll=roll)


def sov_hull(m, p, x0, x1, deck_y, half_w, side_y=None, side_z=None, deck_col=OLIVE_DECK, side_col=OLIVE_SIDE, deck_depth=0.012):
    """Light olive deck (x0..x1, |z| <= half_w at deck_y) over darker olive sides (side_y = (y0, y1) at |z| = side_z)."""
    paint(m, p, ((x0 + x1) / 2, deck_y, 0.0), (x1 - x0, half_w * 2), '+y', deck_col, depth=deck_depth)
    if side_y is not None:
        y0, y1 = side_y
        for s in (-1, 1):
            paint(m, p, ((x0 + x1) / 2, (y0 + y1) / 2, (side_z or half_w) * s), (x1 - x0 + 0.08, y1 - y0), '+z' if s > 0 else '-z',
                  side_col, depth=0.02)


def fender_caps(m, p, x_front, L, y_top, Z, W, depth=0.03):
    """Red front ends of the track guards (incl. the sloped lips)."""
    for s in (-1, 1):
        red(m, p, (x_front - L / 2 + 0.03, y_top, Z * s), (L + 0.06, W), '+y', depth=depth)


def deck_number(m, p, text, at, h, color=GOLD, roll=-PI / 2, depth=0.012):
    """Big painted hull number on a top deck (Cyrillic -> Russo One). roll=-pi/2: runs across the hull (+z),
    letter tops towards the bow."""
    img = D.text([text], px_h=96, color=color, wear=0.2)
    return m.decal(img, at=at, size=(h * img.aspect, h), facing='+y', part=p, depth=depth, roll=roll, team=0)


def annulus_image(r_in, px=256):
    cv = D.Canvas(px, px, ss=2)
    c = px / 2
    cv.circle(c, c, px * 0.49, D.lin(0xffffff), r_in=px * 0.49 * r_in)
    return cv.image()


def red_ring(m, p, at, rx, rz, inner=0.7, depth=0.05):
    """Thick team-red ring seen from above (round turret roofs): outer radii rx / rz, inner = fraction."""
    return m.decal(annulus_image(inner), at=at, size=(rx * 2, rz * 2), facing='+y', part=p, depth=depth, team=1,
                   tint=D.lin(TEAM_NEUTRAL), rough=0.5)
