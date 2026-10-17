"""Shared helpers for the aircraft HD models (tools/assets/models/aircraft/*.py). Not a model (build.mjs skips
files starting with '_'). Model scripts load it with

    import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from _ak import *

It re-exports the ground-vehicle helpers (../vehicles/_vk.py: lamps, decal strips, team shades, stars).

Art rules for aircraft (seen from above at ~40 degrees, 50-90 px long at the default zoom, often over water):
  * the top is the whole picture: team paint on the upper surfaces, broken by darker team-shade camouflage or
    dark panels; recognition marks (white star roundels / gold stars on team discs) big on wing and boom tops;
  * strong value steps: near-black intakes, exhausts, rotor blades and anti-glare panels against the team top,
    a pale (Soviet) or dark (Allied) belly line on the sides, dark-blue canopy glass with a bright frame;
  * running lights that read at night: red port / green starboard wingtip lamps, a white tail lamp, a landing
    light, and the anti-collision strobe as the animated 'glow:strobe' slot;
  * rotors: dark blades with yellow tips in the 'rotor' / 'trotor' parts (the game spins them); the procedural
    rotor-blur discs are kept (keep=['fx:rotor']).
Aircraft face +X with the lowest point (gear) at y = 0; the game lifts the root to the flight altitude.
"""
import math
import os
import sys

import bmesh

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'vehicles'))
from _vk import *  # noqa: E402,F401,F403
from _vk import lamp, HEAD, RED, AMBER, PI, ROT_X, ROT_Z  # noqa: E402,F401
from kit import decals as D  # noqa: E402
from kit import materials as Mt  # noqa: E402
from kit.core import T  # noqa: E402
from kit.shapes import _emit  # noqa: E402

GREEN = 0x38ff5a
WHITE_L = 0xf4f6ff


# ---------------------------------------------------------------------------------------------------------
# palette

class AirPal:
    """Aircraft paint set. Allied: team-painted tops over dark gunmetal; Soviet: team tops (with darker team camo)
    over a pale blue-grey belly."""

    def __init__(self, fac):
        self.fac = fac
        self.top = team(wear=0.45, grime=0.28, rust=0.03, panels=None, rough=0.46)
        self.top_flat = team(wear=0.45, grime=0.28, rust=0.03, panels=None, rough=0.46)
        if fac == 'allies':
            self.belly = painted(0x3d434a, panels=None, wear=0.55, rust=0.05, grime=0.35, streaks=0.3, rough=0.5, metal=0.3, var=0.08)
            self.dark = painted(0x30353b, panels=None, wear=0.6, rust=0.08, grime=0.4, streaks=0.3, rough=0.52, metal=0.35, var=0.08)
        else:
            self.belly = painted(0x9aa5ac, panels=None, wear=0.45, rust=0.04, grime=0.3, streaks=0.35, rough=0.5, metal=0.25, var=0.07)
            self.dark = painted(0x33383d, panels=None, wear=0.6, rust=0.1, grime=0.42, streaks=0.3, rough=0.54, metal=0.3, var=0.1)
        self.dark2 = painted(0x454b52, panels=None, wear=0.6, rust=0.06, grime=0.35, rough=0.5, metal=0.35, var=0.08)
        self.gun = metal(0x3a3e44, rough=0.4, rust=0.15, wear=0.5)
        self.black = metal(0x1b1c1f, rough=0.55, rust=0.1, wear=0.25, metal=0.6)
        self.steel = metal(0x8e949a, rough=0.35, rust=0.05, wear=0.3)
        self.rubber = rubber(0x19191b)
        self.glass = glass(0x14273a)
        self.blade = painted(0x25282c, panels=None, wear=0.35, rust=0.0, grime=0.2, streaks=0.0, rough=0.5, metal=0.2, var=0.05)
        self.yellow = painted(0xe0aa14, panels=None, wear=0.4, rust=0.0, grime=0.2, rough=0.5, var=0.05)
        self.white = painted(0xdedcd4, panels=None, wear=0.3, rust=0.0, grime=0.25, rough=0.45, var=0.05)
        self.red = painted(0xa8261c, panels=None, wear=0.35, rust=0.0, grime=0.25, rough=0.45, var=0.05)
        self.olive = painted(0x4b5235, panels=None, wear=0.6, rust=0.1, grime=0.4, rough=0.55, var=0.1)
        self.exhaust = painted(0x2e2a27, panels=None, wear=0.3, rust=0.5, grime=0.3, rough=0.75, var=0.1)
        self.soot = Mt.flat(0x070707, 0.95)


# ---------------------------------------------------------------------------------------------------------
# lofted bodies

def _ring(st, seg, ex):
    x, yc, hw, top, bot = st[:5]
    e = st[5] if len(st) > 5 else ex
    pts = []
    for i in range(seg):
        a = 2 * PI * i / seg
        c, s = math.cos(a), math.sin(a)
        z = hw * math.copysign(abs(c) ** (2.0 / e), c)
        y = yc + (top if s > 0 else bot) * math.copysign(abs(s) ** (2.0 / e), s)
        pts.append((x, y, z))
    return pts


def xloft(p, mat, stations, seg=14, ex=2.0, at=(0, 0, 0), rot=None, belly=None, belly_ny=-0.3, smooth=True):
    """Closed body through vertical cross-sections along X (fuselages, booms, nacelles, pods, hulls).
    stations = [(x, yc, half_width, top, bottom[, exponent]), ...] tail -> nose; each section is a
    superellipse (exponent 2 = ellipse, 3-4 = boxy) around (yc, z=0); a station with zero size closes that
    end to a point. belly = a second material for the faces whose normal points down (ny < belly_ny): a clean
    two-tone paint line along the body. Preset cylindrical UVs (quarter-turn islands, arc length per station)."""
    uvname = Mt.ATLAS_UV

    def build(bm):
        uvl = bm.loops.layers.uv.get(uvname) or bm.loops.layers.uv.new(uvname)
        pre = bm.faces.layers.float.get('rh_preuv') or bm.faces.layers.float.new('rh_preuv')
        sm = bm.faces.layers.float.get('rh_smooth') or bm.faces.layers.float.new('rh_smooth')
        rings, radii = [], []
        for st in stations:
            if st[2] < 1e-5 and st[3] < 1e-5 and st[4] < 1e-5:
                rings.append([bm.verts.new((st[0], st[1], 0.0))])
                radii.append(0.0)
            else:
                pts = _ring(st, seg, ex)
                rings.append([bm.verts.new(v) for v in pts])
                per = sum(math.dist(pts[i], pts[(i + 1) % seg]) for i in range(seg))
                radii.append(per / (2 * PI))
        side = []
        for k in range(len(rings) - 1):
            A, B = rings[k], rings[k + 1]
            for i in range(seg):
                j = (i + 1) % seg
                if len(A) == 1 and len(B) == 1:
                    continue
                if len(A) == 1:
                    f = bm.faces.new((A[0], B[j], B[i]))
                elif len(B) == 1:
                    f = bm.faces.new((A[i], A[j], B[0]))
                else:
                    f = bm.faces.new((A[i], A[j], B[j], B[i]))
                side.append((f, k, i))
        caps = []
        if len(rings[0]) > 1:
            caps.append(bm.faces.new(list(reversed(rings[0]))))
        if len(rings[-1]) > 1:
            caps.append(bm.faces.new(rings[-1]))
        faces = [f for f, _, _ in side] + caps
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        # UVs: u = arc position around the section (per quarter turn), v = x
        for f, k, i in side:
            am = 2 * PI * (i + 0.5) / seg
            q = math.floor(am / (PI / 2))
            a0 = q * PI / 2
            for lp in f.loops:
                v = lp.vert
                kk = k if v in rings[k] else k + 1
                ring = rings[kk]
                if len(ring) == 1:
                    u = (am - a0) * radii[k if kk == k + 1 else k + 1] * 0.5
                else:
                    ii = ring.index(v)
                    a = 2 * PI * ii / seg
                    if a < a0 - 1e-6 and ii == 0:
                        a = 2 * PI
                    if i == seg - 1 and ii == 0:
                        a = 2 * PI
                    u = (a - a0) * radii[kk]
                lp[uvl].uv = (u, v.co.x)
            f[pre] = 1.0
            if smooth:
                f[sm] = 1.0
        for f in caps:
            for lp in f.loops:
                lp[uvl].uv = (lp.vert.co.z, lp.vert.co.y)
            f[pre] = 1.0
        return [v for r in rings for v in r]
    verts, faces = _emit(p, mat, build, T(at, rot))
    if belly is not None:
        _, mi = p.target(belly)
        for f in faces:
            f.normal_update()
            if f.normal.y < belly_ny:
                f.material_index = mi
    return verts, faces


def wing(p, mat, outline, y, t, bevel=0.004, z_mirror=False):
    """Flat wing / stabiliser / fin plate: top-view outline [(x, z), ...] at height y (centre), thickness t."""
    pts = outline if not z_mirror else [(x, -z) for (x, z) in reversed(outline)]
    return prism(p, mat, pts, t, (0, y, 0), (PI / 2, 0, 0), bevel=bevel)


def fin(p, mat, outline, z, t, bevel=0.003):
    """Vertical fin: side-view outline [(x, y), ...] extruded across Z (thickness t) at z."""
    return prism(p, mat, outline, t, (0, 0, z), bevel=bevel)


# ---------------------------------------------------------------------------------------------------------
# rotors, props, gear, stores

def blades(p, pal, n, R, chord, hub_r, droop=0.035, y=0.0, phase=0.0, t=0.007, tip=0.05):
    """Main rotor: n drooped blades from the hub (in the rotor part's frame, rotating about Y), yellow tips."""
    for i in range(n):
        a = phase + 2 * PI * i / n
        c, s = math.cos(a), -math.sin(a)
        L = R - tip
        mid = hub_r + L / 2
        rot = (0.0, a, -droop)  # yaw to the blade direction, then the droop (in the blade frame)
        box(p, pal.blade, (L, t, chord), (c * mid, y - math.sin(droop) * mid, s * mid), rot)
        tm = hub_r + L + tip / 2
        box(p, pal.yellow, (tip, t, chord), (c * tm, y - math.sin(droop) * tm, s * tm), rot)
        # blade grip at the hub
        gm = hub_r * 0.75
        box(p, pal.gun, (hub_r * 0.9, 0.016, chord * 0.9), (c * gm, y, s * gm), (0.0, a, 0.0), bevel=0.003)


def rotor_hub(p, pal, r, h=0.03, cap=True):
    cyl(p, pal.gun, r, h, (0, 0, 0), seg=12, bevel=0.004)
    cyl(p, pal.dark, r * 0.6, h * 0.9, (0, h * 0.85, 0), r2=r * 0.4, seg=10)
    if cap:
        dome(p, pal.gun, r * 0.42, (0, h * 1.3, 0), seg=10, rings=3)


def tail_blades(p, pal, n, R, chord, axis='z', phase=0.0, t=0.006):
    """Tail rotor / propeller: n blades radiating in the plane normal to `axis` ('z': tail rotor, 'x': prop)."""
    for i in range(n):
        a = phase + 2 * PI * i / n
        L = R * 0.85
        if axis == 'z':
            d = (math.cos(a), math.sin(a), 0.0)
            box(p, pal.blade, (L, chord, t), (d[0] * L / 2, d[1] * L / 2, 0), (0, 0, a))
            box(p, pal.yellow, (R * 0.15, chord, t), (d[0] * (L + R * 0.075), d[1] * (L + R * 0.075), 0), (0, 0, a))
        else:
            d = (0.0, math.cos(a), math.sin(a))
            box(p, pal.blade, (t, L, chord), (0, d[1] * L / 2, d[2] * L / 2), (a, 0.25, 0))
            box(p, pal.yellow, (t, R * 0.15, chord), (0, d[1] * (L + R * 0.075), d[2] * (L + R * 0.075)), (a, 0.25, 0))


def wheel(p, pal, at, r, w, hub=True):
    cyl(p, pal.rubber, r, w, at, ROT_Z, seg=10)
    if hub:
        x, y, z = at
        cyl(p, pal.steel, r * 0.5, w * 1.08, at, ROT_Z, seg=8)


def strut(p, pal, a, b, w=0.01):
    bar(p, pal.dark, a, b, w)


def rocket_pod(p, pal, at, r, L, mat=None):
    """UB-32 / Hydra pod along +X centred at `at`: tube, nose fairing, dark honeycomb face."""
    x, y, z = at
    mat = mat or pal.olive
    cyl(p, mat, r, L, at, ROT_X, seg=8, bevel=0.003)
    cyl(p, mat, r, r * 1.4, (x - L / 2 - r * 0.7, y, z), (0, 0, PI / 2), r2=r * 0.35, seg=8)
    cyl(p, pal.black, r * 0.86, 0.004, (x + L / 2 + 0.002, y, z), ROT_X, seg=10)
    cyl(p, pal.dark, r * 1.04, 0.01, (x + L * 0.28, y, z), ROT_X, seg=10)


def missile(p, pal, at, r, L, body=None, tip=None, fins=True):
    """A missile along +X centred at `at` (white body, red / dark tip, small fins)."""
    x, y, z = at
    body = body or pal.white
    cyl(p, body, r, L * 0.82, (x - L * 0.09, y, z), ROT_X, seg=8)
    cyl(p, tip or pal.red, r, L * 0.18, (x + L * 0.41, y, z), ROT_X, r2=r * 0.15, seg=8)
    if fins:
        for k in range(2):
            box(p, pal.dark, (L * 0.12, 0.003, r * 4.2), (x - L * 0.42, y, z), (k * PI / 2, 0, 0))


def nav_lights(p, port, starboard, r=0.011, tail=None, facing_p='-z', facing_s='+z'):
    """Red port / green starboard wingtip lamps (+ an optional white tail lamp), baked steady emissives."""
    lamp(p, port, r, RED, 'steady', 3.6, facing_p)
    lamp(p, starboard, r, GREEN, 'steady', 3.6, facing_s)
    if tail is not None:
        lamp(p, tail, r * 0.9, WHITE_L, 'steady', 3.2, '-x')


def strobe(p, at, r=0.011, color=RED):
    """Anti-collision beacon: the animated 'glow:strobe' slot (blinks with the procedural strobe)."""
    sphere(p, glow_material('glow:strobe', color), r, at, seg=8, rings=5)
    cyl(p, Mt.metal(0x26282c), r * 1.15, r * 0.6, (at[0], at[1] - r * 0.7, at[2]), seg=8)


def landing_light(p, at, r=0.012, facing='+x'):
    lamp(p, at, r, HEAD, 'steady', 4.2, facing)


# ---------------------------------------------------------------------------------------------------------
# decals

def roundel(m, p, pal, at, d, facing='+y', depth=0.03):
    """Recognition mark: Soviet gold star on a team disc ringed white; Allied white star roundel."""
    if pal.fac == 'soviet':
        m.decal(disc_image(ring=0xe8e4da, ring_w=0.07), at=at, size=(d * 1.04, d * 1.04), facing=facing, part=p, depth=depth,
                team=0, rough=0.5)
        team_disc(m, p, at, d * 0.92, facing, depth=depth)
        emblem(m, p, 'soviet', at, d * 0.98, facing=facing, depth=depth)
    else:
        emblem(m, p, 'allied_star', at, d, facing=facing, depth=depth)


def side_star(m, p, pal, at, d, facing, depth=0.03):
    """Star on a side (boom, fin): Soviet red star with a white border, Allied white star roundel."""
    if pal.fac == 'soviet':
        m.decal(D.soviet_star(color=0xc81e16, border=0xf0ece4), at=at, size=(d, d), facing=facing, part=p, depth=depth, team=0)
    else:
        emblem(m, p, 'allied_star', at, d, facing=facing, depth=depth)


def strip(m, p, a, b, facing='+y', width=0.012, color=None, depth=0.02):
    """Bright painted edge / walkway line (decal)."""
    if color is None:
        return edge_strip(m, p, a, b, facing, width, depth=depth)
    from mathutils import Vector
    from kit.core import euler3, facing_rot
    a, b = Vector(a), Vector(b)
    d = b - a
    F = euler3(facing_rot(facing))
    lx = F.inverted() @ d
    roll = math.atan2(lx.y, lx.x)
    return m.decal(D.solid(color), at=tuple((a + b) / 2), size=(d.length + width * 0.5, width), facing=facing, part=p,
                   depth=depth, roll=roll, team=0, rough=0.5)


def tail_number(m, p, text, at, h, facing, color=0xe8e4da, depth=0.02):
    return stencil(m, p, text, at, h, facing=facing, color=color, depth=depth)


def camo_top(m, p, at, size, seed=3, n=9, shade=0x707070, depth=0.08):
    """Darker team-shade blotches over the team top (Soviet two-tone camouflage). Moved to the front of the decal
    list (decals are composited in order): markings painted later stay on top of it."""
    d = camo(m, p, at, size, '+y', seed=seed, n=n, colors=(shade,), depth=depth, team_shade=True)
    m.decals.remove(d)
    m.decals.insert(0, d)
    return d
